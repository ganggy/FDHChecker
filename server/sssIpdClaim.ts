import AdmZip from 'adm-zip';
import crypto from 'crypto';
import iconv from 'iconv-lite';
import { getRepstmConnection, getUTFConnection } from './db.js';
import type { SssCandidateOptions, SssNetworkType, SssValidationIssue } from './sssClaim.js';

export interface SssIpdCandidate extends Record<string, unknown> {
  an: string;
  vn: string;
  network_type: 'IN' | 'OUT';
  validation_status: 'ready' | 'warning' | 'error';
  issues: SssValidationIssue[];
}

const text = (value: unknown) => String(value ?? '').trim();
const number = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: unknown) => number(value).toFixed(2);
const dateOnly = (value: unknown) => text(value).slice(0, 10);
const xml = (value: unknown) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const pipeValue = (value: unknown) => text(value).replace(/[|\r\n]+/g, ' ').replace(/[<>]/g, ' ').trim();
const pipeRow = (values: unknown[]) => values.map(pipeValue).join('|');
const isoDateTime = (date: unknown, time: unknown) => `${dateOnly(date)}T${text(time).slice(0, 8) || '00:00:00'}`;

export const evaluateSssIpdCandidate = (row: Record<string, unknown>): SssValidationIssue[] => {
  const issues: SssValidationIssue[] = [];
  const add = (severity: 'error' | 'warning', code: string, message: string) => issues.push({ severity, code, message });
  if (!/^\d{13}$/.test(text(row.cid))) add('error', 'AIPN-PAT01', 'ไม่มีเลขบัตรประชาชน 13 หลัก');
  if (!text(row.pdx) || /^[VWXY]/i.test(text(row.pdx))) add('error', 'AIPN-DX01', 'PDX ว่างหรือไม่ใช่รหัสวินิจฉัยหลักที่ส่ง AIPN ได้');
  if (!/^(0[1-9]|1[0-2])$/.test(text(row.clinic))) add('error', 'AIPN-SVC01', 'รหัสคลินิกไม่อยู่ในช่วง 01-12');
  if (!text(row.dischs)) add('error', 'AIPN-ADM01', 'ไม่มีสถานะจำหน่าย');
  if (!text(row.discht)) add('error', 'AIPN-ADM02', 'ไม่มีประเภทจำหน่าย');
  if (!text(row.hospmain) && text(row.hipdata_code) !== 'SSI') add('error', 'AIPN-INS01', 'ไม่มี HospMain');
  if (number(row.income) <= 0) add('error', 'AIPN-CHG01', 'ค่าใช้จ่ายเป็นศูนย์');
  if (Math.abs(number(row.charge_total) - number(row.income)) > 0.01) add('error', 'AIPN-CHG02', 'ยอดรายละเอียดค่าใช้จ่ายไม่ตรงยอดรวม AN');
  if (number(row.missing_bill_group_count) > 0) add('error', 'AIPN-CHG03', 'ยัง Map กลุ่มบัญชี 1 ไม่ครบ');
  if (number(row.missing_item_name_count) > 0) add('error', 'AIPN-CHG04', 'มีรายการค่าใช้จ่ายที่ไม่มีชื่อ');
  if (number(row.mixed_hn_count) > 0) add('error', 'AIPN-CHG05', 'พบ HN อื่นในรายการค่าใช้จ่ายของ AN');
  if (!text(row.doctor_license)) add('error', 'AIPN-DOC01', 'ไม่มีเลขใบอนุญาตแพทย์ผู้วินิจฉัย');
  if (number(row.missing_operation_time_count) > 0) add('error', 'AIPN-OP01', 'หัตถการไม่มีวันเวลาเริ่มหรือสิ้นสุด');
  if (number(row.operation_outside_admit_count) > 0) add('error', 'AIPN-OP02', 'หัตถการอยู่นอกช่วง Admit');
  if (number(row.missing_operation_doctor_count) > 0) add('error', 'AIPN-OP03', 'หัตถการไม่มีเลขใบอนุญาตแพทย์');
  if (number(row.missing_tmt_count) > 0) add('warning', 'AIPN-DRU01', 'มียาที่ควรตรวจสอบการ Map TMT/บัญชียา สกส.');
  if (number(row.missing_tmlt_count) > 0) add('warning', 'AIPN-LAB01', 'มี LAB ที่ยังไม่ Map TMLT');
  if (number(row.service_outside_admit_count) > 0) add('warning', 'AIPN-SVC02', 'มีวันที่ให้บริการอยู่นอกช่วง Admit');
  // AuthCode/AuthDate are deliberately not blocking checks, matching the supplied AIPN routine.
  return issues;
};

export const buildSssIpdCandidateSql = (networkType: SssNetworkType) => `
  SELECT
    i.an, i.vn, i.hn,
    DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admit_date, TIME_FORMAT(i.regtime, '%H:%i:%s') AS admit_time,
    DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS discharge_date, TIME_FORMAT(i.dchtime, '%H:%i:%s') AS discharge_time,
    DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS service_date, TIME_FORMAT(i.dchtime, '%H:%i:%s') AS service_time,
    CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) AS patient_name,
    COALESCE(NULLIF(pt.cid,''), pc.cardno, '') AS cid,
    pt.pname AS title, CONCAT(COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) AS namepat,
    DATE_FORMAT(pt.birthday, '%Y-%m-%d') AS dob, pt.sex,
    CASE WHEN pt.marrystatus IN ('1','2','3') THEN pt.marrystatus ELSE '4' END AS marry,
    LPAD(COALESCE(pt.chwpart,''), 2, '0') AS changwat, LPAD(COALESCE(pt.amppart,''), 2, '0') AS ampur,
    CASE WHEN pt.nationality IN ('44','45','46','48','56','57','99') THEN pt.nationality ELSE '97' END AS nation,
    i.pttype, ptt.name AS pttype_name, ptt.hipdata_code, COALESCE(ptt.pttype_eclaim_id,'') AS pttype_eclaim_id,
    CASE WHEN i.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%' THEN 'OUT' ELSE 'IN' END AS network_type,
    COALESCE(hospmain(i.an), '') AS hospmain, COALESCE(sp.nhso_code, '') AS clinic,
    COALESCE(ds.nhso_dchstts, i.dchstts, '') AS dischs, COALESCE(dt.nhso_dchtype, i.dchtype, '') AS discht,
    COALESCE(i.ward, '') AS ward, COALESCE(i.leave_home_day, 0) AS leave_day,
    CAST(COALESCE(i.bw,0) / 1000 AS DECIMAL(10,3)) AS birth_weight,
    COALESCE((SELECT dx.icd10 FROM iptdiag dx WHERE dx.an=i.an AND dx.diagtype='1' ORDER BY dx.ipt_diag_id LIMIT 1),'') AS pdx,
    COALESCE(doc.licenseno, '') AS doctor_license,
    COALESCE((SELECT ah.claim_code FROM authenhos ah WHERE ah.vn=i.vn AND COALESCE(ah.claim_code,'')<>'' LIMIT 1),'') AS auth_code,
    ROUND(COALESCE(a.income,0),2) AS income,
    ROUND(COALESCE((SELECT SUM(oo.sum_price) FROM opitemrece oo WHERE oo.an=i.an),0),2) AS charge_total,
    ROUND(COALESCE((SELECT SUM(CASE WHEN oo.paidst IN ('01','03') THEN oo.sum_price ELSE 0 END) FROM opitemrece oo WHERE oo.an=i.an),0),2) AS paid_money,
    (SELECT COUNT(*) FROM opitemrece oo LEFT JOIN income inc ON inc.income=oo.income WHERE oo.an=i.an AND COALESCE(inc.group1,0)=0) AS missing_bill_group_count,
    (SELECT COUNT(*) FROM opitemrece oo LEFT JOIN s_drugitems sd ON sd.icode=oo.icode WHERE oo.an=i.an AND COALESCE(TRIM(sd.name),'')='') AS missing_item_name_count,
    (SELECT COUNT(*) FROM opitemrece oo WHERE oo.an=i.an AND COALESCE(oo.hn,i.hn)<>i.hn) AS mixed_hn_count,
    (SELECT COUNT(*) FROM opitemrece oo JOIN income inc ON inc.income=oo.income LEFT JOIN s_drugitems sd ON sd.icode=oo.icode WHERE oo.an=i.an AND inc.group1 IN (3,4) AND COALESCE(sd.tpu_code_list,'')='') AS missing_tmt_count,
    (SELECT COUNT(*) FROM opitemrece oo JOIN income inc ON inc.income=oo.income LEFT JOIN s_drugitems sd ON sd.icode=oo.icode WHERE oo.an=i.an AND inc.group1 IN (6,7) AND (COALESCE(sd.tmlt_code,'')='' OR sd.tmlt_code LIKE '%X%')) AS missing_tmlt_count,
    (SELECT COUNT(*) FROM opitemrece oo WHERE oo.an=i.an AND DATE(oo.rxdate) NOT BETWEEN i.regdate AND i.dchdate) AS service_outside_admit_count,
    (SELECT COUNT(*) FROM iptoprt op WHERE op.an=i.an AND (op.opdate IS NULL OR op.enddate IS NULL)) AS missing_operation_time_count,
    (SELECT COUNT(*) FROM iptoprt op WHERE op.an=i.an AND (TIMESTAMP(op.opdate,COALESCE(op.optime,'00:00:00')) NOT BETWEEN TIMESTAMP(i.regdate,i.regtime) AND TIMESTAMP(i.dchdate,i.dchtime) OR TIMESTAMP(op.enddate,COALESCE(op.endtime,'00:00:00')) NOT BETWEEN TIMESTAMP(i.regdate,i.regtime) AND TIMESTAMP(i.dchdate,i.dchtime))) AS operation_outside_admit_count,
    (SELECT COUNT(*) FROM iptoprt op LEFT JOIN doctor od ON od.code=op.doctor WHERE op.an=i.an AND COALESCE(od.licenseno,'')='') AS missing_operation_doctor_count
  FROM ipt i
  JOIN patient pt ON pt.hn=i.hn
  LEFT JOIN ptcardno pc ON pc.hn=pt.hn AND pc.cardtype='02'
  LEFT JOIN an_stat a ON a.an=i.an
  JOIN pttype ptt ON ptt.pttype=i.pttype
  LEFT JOIN spclty sp ON sp.spclty=i.spclty
  LEFT JOIN dchstts ds ON ds.dchstts=i.dchstts
  LEFT JOIN dchtype dt ON dt.dchtype=i.dchtype
  LEFT JOIN doctor doc ON doc.code=i.admdoctor
  WHERE i.dchdate BETWEEN ? AND ? AND i.dchdate IS NOT NULL
    AND (ptt.hipdata_code IN ('SSS','SSI','SS') OR ptt.pcode='A7' OR (ptt.name LIKE '%ประกันสังคม%' AND COALESCE(ptt.hipdata_code,'')<>'A9') OR ptt.pttype_eclaim_id BETWEEN 10 AND 15)
    ${networkType === 'IN' ? "AND NOT (i.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%')" : ''}
    ${networkType === 'OUT' ? "AND (i.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%')" : ''}
  ORDER BY i.dchdate DESC, i.dchtime DESC, i.an DESC
`;

export const getSssIpdCandidates = async (options: SssCandidateOptions): Promise<SssIpdCandidate[]> => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(buildSssIpdCandidateSql(options.networkType || 'ALL'), [options.startDate, options.endDate]);
    return (Array.isArray(rows) ? rows as Record<string, unknown>[] : []).map((row) => {
      const issues = evaluateSssIpdCandidate(row);
      return { ...row, an: text(row.an), vn: text(row.vn), network_type: text(row.network_type) === 'OUT' ? 'OUT' : 'IN', validation_status: issues.some((issue) => issue.severity === 'error') ? 'error' : issues.length ? 'warning' : 'ready', issues } as SssIpdCandidate;
    });
  } finally { connection.release(); }
};

type CatalogRow = Record<string, unknown>;
const loadCatalog = async (table: 'claimcat' | 'chi_drugcatalog' | 'labitem', codes: string[]) => {
  if (!codes.length) return [] as CatalogRow[];
  const connection = await getRepstmConnection();
  try {
    const placeholders = codes.map(() => '?').join(',');
    const query = table === 'claimcat'
      ? `SELECT icode, bill_code, claim_amount, income, rev_date, remark, claim_cat, start_date, finish_date FROM claimcat WHERE maininscl='SSS' AND icode IN (${placeholders})`
      : table === 'chi_drugcatalog'
        ? `SELECT hospdrugcode, tmtid, unitprice FROM chi_drugcatalog WHERE hospdrugcode IN (${placeholders})`
        : `SELECT icode, tmlt_code FROM labitem WHERE icode IN (${placeholders})`;
    const [rows] = await connection.query(query, codes);
    return Array.isArray(rows) ? rows as CatalogRow[] : [];
  } catch { return []; }
  finally { connection.release(); }
};

const upayPlan = (row: Record<string, unknown>) => {
  const hip = text(row.hipdata_code).toUpperCase();
  const id = text(row.pttype_eclaim_id).padStart(2, '0');
  if (hip === 'SSI') return '86';
  if (id === '10') return '80';
  if (id === '13') return '81';
  if (id === '14') return '85';
  if (['11','12','15'].includes(id)) return '95';
  return hip.startsWith('SS') ? '80' : '00';
};

export const buildAipnDocument = (options: { admission: Record<string, unknown>; diagnoses: Record<string, unknown>[]; operations: Record<string, unknown>[]; items: Record<string, unknown>[]; hcode: string; hospitalName: string; generatedAt?: Date }) => {
  const row = options.admission;
  const now = (options.generatedAt || new Date()).toISOString().replace(/\.\d{3}Z$/, '');
  const authCode = text(row.auth_code);
  const authDate = authCode ? isoDateTime(row.admit_date, row.admit_time) : '0000-00-00T00:00:00';
  const ipadt = pipeRow([row.an,row.hn,0,row.cid,row.title,row.namepat,row.dob,row.sex,row.marry,row.changwat,row.ampur,row.nation,'O','O',isoDateTime(row.admit_date,row.admit_time),isoDateTime(row.discharge_date,row.discharge_time),row.leave_day||0,row.dischs,row.discht,number(row.birth_weight).toFixed(3),row.ward,row.clinic||'01']);
  const ipdx = options.diagnoses.map((diag,index) => pipeRow([index+1,diag.diagtype,text(diag.codeset)==='TT'?'ICD-10-TM':'ICD-10',text(diag.icd10).replace(/\./g,''),diag.code_name,diag.doctor_license,''])).join('\r\n');
  const ipop = options.operations.map((op,index) => pipeRow([index+1,'ICD9CM',text(op.icd9).replace(/\./g,''),op.code_name,op.doctor_license,isoDateTime(op.opdate||row.admit_date,op.optime||row.admit_time),isoDateTime(op.enddate||op.opdate||row.discharge_date,op.endtime||op.optime||row.discharge_time),'XXXX:Undefine'])).join('\r\n');
  const billItems = options.items.map((item,index) => pipeRow([index+1,dateOnly(item.rxdate),item.income,['03','04','06','07'].includes(text(item.income).padStart(2,'0'))?(item.oldcode||item.icode):item.icode,item.item_name,item.qty,money(item.unitprice),money(item.amount),money(item.discount),0,0,'SS',item.bill_group,item.cs_code,item.code_system,item.standard_code,item.claim_cat,item.revision_date||'0000-00-00',money(item.claim_unit_price),money(item.claim_amount)])).join('\r\n');
  const drgCharge = options.items.filter((item) => text(item.claim_cat)==='D').reduce((sum,item) => sum+number(item.amount),0);
  const xdrgClaim = options.items.filter((item) => text(item.claim_cat)==='T').reduce((sum,item) => sum+number(item.claim_amount),0);
  const careAs = text(row.hospmain) === options.hcode ? 'M' : 'B';
  const body = `<CIPN>\r\n<Header>\r\n\t<DocClass>IPClaim</DocClass>\r\n\t<DocSysID version="2.1">AIPN</DocSysID>\r\n\t<serviceEvent>ADT</serviceEvent>\r\n\t<authorID>${xml(options.hcode)}</authorID>\r\n\t<authorName>${xml(options.hospitalName)}</authorName>\r\n\t<effectiveTime>${now}</effectiveTime>\r\n\t<Prgs>FDHChecker</Prgs>\r\n</Header>\r\n<ClaimAuth>\r\n\t<AuthCode>${xml(authCode)}</AuthCode>\r\n\t<AuthDT>${authDate}</AuthDT>\r\n\t<UPayPlan>${upayPlan(row)}</UPayPlan>\r\n\t<ServiceType>IP</ServiceType>\r\n\t<ProjectCode></ProjectCode>\r\n\t<EventCode></EventCode>\r\n\t<UserReserve></UserReserve>\r\n\t<Hmain>${xml(row.hospmain)}</Hmain>\r\n\t<Hcare>${xml(options.hcode)}</Hcare>\r\n\t<CareAs>${careAs}</CareAs>\r\n\t<ServiceSubType></ServiceSubType>\r\n</ClaimAuth>\r\n<IPADT>\r\n${ipadt}\r\n</IPADT>\r\n<IPDx Reccount="${options.diagnoses.length}">\r\n${ipdx}\r\n</IPDx>\r\n<IPOp Reccount="${options.operations.length}">\r\n${ipop}\r\n</IPOp>\r\n<Invoices>\r\n<InvNumber>${xml(row.an)}</InvNumber>\r\n<InvDT>${now}</InvDT>\r\n<BillItems Reccount="${options.items.length}">\r\n${billItems}\r\n</BillItems>\r\n<InvAddDiscount>0.00</InvAddDiscount>\r\n<DRGCharge>${money(drgCharge)}</DRGCharge>\r\n<XDRGClaim>${money(xdrgClaim)}</XDRGClaim>\r\n</Invoices>\r\n<Coinsurance>\r\n</Coinsurance>\r\n</CIPN>\r\n`;
  const checksum = crypto.createHash('md5').update(iconv.encode(body,'cp874')).digest('hex');
  return `<?xml version="1.0" encoding="windows-874"?>\r\n${body}<?EndNote HMAC="${checksum}"?>`;
};

export const buildSssIpdExportZip = async (options: SssCandidateOptions & { ans: string[]; hcode: string; hospitalName: string }) => {
  if (!/^\d{5}$/.test(options.hcode) || options.hcode === '00000') throw new Error('HCODE หน่วยบริการไม่ถูกต้อง');
  const requested = new Set(options.ans.map(text).filter(Boolean));
  const selected = (await getSssIpdCandidates(options)).filter((row) => requested.has(row.an));
  if (selected.length !== requested.size) throw new Error('มีบาง AN ไม่อยู่ในสิทธิ์/เครือข่าย/ช่วงวันที่ที่เลือก กรุณาดึงข้อมูลใหม่');
  const blocked = selected.filter((row) => row.validation_status === 'error');
  if (blocked.length) throw new Error(`มี ${blocked.length} AN ที่ยังติด Error และไม่สามารถส่งออก AIPN ได้`);
  const ans = selected.map((row) => row.an);
  const placeholders = ans.map(() => '?').join(',');
  const connection = await getUTFConnection();
  try {
    const [diagRows] = await connection.query(`SELECT dx.an,dx.icd10,dx.diagtype,COALESCE(ic.name,'') code_name,COALESCE(d.licenseno,'') doctor_license,COALESCE(ic.codeset,'') codeset FROM iptdiag dx LEFT JOIN icd101 ic ON ic.code=dx.icd10 LEFT JOIN doctor d ON d.code=dx.doctor WHERE dx.an IN (${placeholders}) ORDER BY dx.an,dx.diagtype,dx.ipt_diag_id`,ans);
    const [opRows] = await connection.query(`SELECT op.an,op.icd9,COALESCE(ic.name,'') code_name,COALESCE(d.licenseno,'') doctor_license,op.opdate,op.optime,op.enddate,op.endtime FROM iptoprt op LEFT JOIN icd9cm1 ic ON ic.code=op.icd9 LEFT JOIN doctor d ON d.code=op.doctor WHERE op.an IN (${placeholders}) ORDER BY op.an,op.opdate,op.optime`,ans);
    const [chargeRows] = await connection.query(`SELECT oo.an,oo.rxdate,oo.income,oo.icode,sd.oldcode,COALESCE(NULLIF(sd.name,''),oo.icode) item_name,oo.qty,oo.unitprice,oo.sum_price amount,CASE WHEN oo.paidst='04' THEN oo.sum_price ELSE 0 END discount,oo.paidst,oo.item_type,COALESCE(inc.group1,0) income_group,COALESCE(sd.tpu_code_list,'') tmt_code,COALESCE(sd.tmlt_code,'') tmlt_code,COALESCE(sd.nhso_adp_code,'') adp_code FROM opitemrece oo LEFT JOIN income inc ON inc.income=oo.income LEFT JOIN s_drugitems sd ON sd.icode=oo.icode WHERE oo.an IN (${placeholders}) AND COALESCE(oo.sum_price,0)<>0 ORDER BY oo.an,oo.rxdate,oo.icode`,ans);
    const diagnoses = Array.isArray(diagRows)?diagRows as Record<string,unknown>[]:[];
    const operations = Array.isArray(opRows)?opRows as Record<string,unknown>[]:[];
    const charges = Array.isArray(chargeRows)?chargeRows as Record<string,unknown>[]:[];
    const codes = [...new Set(charges.map((item)=>text(item.icode)).filter(Boolean))];
    const [claimCatalog,drugCatalog,labCatalog] = await Promise.all([loadCatalog('claimcat',codes),loadCatalog('chi_drugcatalog',codes),loadCatalog('labitem',codes)]);
    const drugMap = new Map(drugCatalog.map((item)=>[text(item.hospdrugcode),item]));
    const labMap = new Map(labCatalog.map((item)=>[text(item.icode),item]));
    const catalogFor = (item: Record<string,unknown>) => claimCatalog.find((cat)=>text(cat.icode)===text(item.icode)&&(!cat.start_date||dateOnly(item.rxdate)>=dateOnly(cat.start_date))&&(!cat.finish_date||dateOnly(item.rxdate)<=dateOnly(cat.finish_date)));
    const normalizedItems = charges.map((item)=>{
      const incomeGroup=text(item.income_group).padStart(2,'0'); const catalog=catalogFor(item); const paid=['01','03'].includes(text(item.paidst)); const claimCat=paid?'X':catalog?'T':'D';
      const billGroup=incomeGroup==='04'&&text(item.item_type)==='H'?'04':text(catalog?.income||incomeGroup).padStart(2,'0'); const drug=drugMap.get(text(item.icode)); const lab=labMap.get(text(item.icode));
      const standardCode=['03','04'].includes(billGroup)?text(drug?.tmtid||item.tmt_code):['06','07'].includes(billGroup)?text(lab?.tmlt_code||item.tmlt_code):''; const claimUnit=paid?number(item.unitprice):number(catalog?.claim_amount)||number(item.unitprice);
      return {...item,bill_group:billGroup,cs_code:billGroup==='01'?item.adp_code:['03','04'].includes(billGroup)?'':item.adp_code,code_system:['03','04'].includes(billGroup)?'TMT':['06','07'].includes(billGroup)?'TMLT':'',standard_code:standardCode,claim_cat:claimCat,revision_date:dateOnly(catalog?.rev_date)||'0000-00-00',claim_unit_price:claimUnit,claim_amount:number(item.qty)*claimUnit};
    });
    const byAn=(rows:Record<string,unknown>[])=>rows.reduce<Map<string,Record<string,unknown>[]>>((map,item)=>{const key=text(item.an);map.set(key,[...(map.get(key)||[]),item]);return map;},new Map());
    const diagMap=byAn(diagnoses),opMap=byAn(operations),itemMap=byAn(normalizedItems); const generatedAt=new Date(); const stamp=generatedAt.toISOString().replace(/[-:.TZ]/g,'').slice(0,14); const zip=new AdmZip();
    selected.forEach((admission)=>{const document=buildAipnDocument({admission,diagnoses:diagMap.get(admission.an)||[],operations:opMap.get(admission.an)||[],items:itemMap.get(admission.an)||[],hcode:options.hcode,hospitalName:options.hospitalName,generatedAt});zip.addFile(`${options.hcode}-AIPN-${admission.an.replace(/\//g,'=')}-${stamp}.XML`,iconv.encode(document,'cp874'));});
    return {buffer:zip.toBuffer(),filename:`${options.hcode}AIPN${stamp.slice(-6)}.ZIP`,summary:{admissionCount:selected.length,diagnosisCount:diagnoses.length,operationCount:operations.length,chargeCount:charges.length}};
  } finally { connection.release(); }
};

