import { getUTFConnection } from './db.js';
import { answerPatientReportQuestion } from './aiReportTools.js';
import { buildReportAttachment, type ExportableReport, type ReportFormat } from './aiReportExport.js';
import { generateAgentText } from './aiService.js';

export type HospitalReportId =
  | 'discharge-summary' | 'operative-note' | 'lab-report' | 'bed-occupancy'
  | 'daily-service-summary' | 'opd-department-workload' | 'opd-diagnosis-ranking'
  | 'ipd-admission-discharge' | 'ipd-ward-performance' | 'referral-report'
  | 'drug-utilization' | 'lab-workload' | 'claim-data-completeness'
  | 'cost-per-drg' | 'payer-mix' | 'revenue-by-category'
  | 'pcu-death' | 'pcu-patient-service' | 'pcu-visit-service-detail';

export type HospitalReportRequest = {
  reportId: HospitalReportId;
  identifier?: string;
  identifierType?: 'hn' | 'vn' | 'an';
  dateStart?: string;
  dateEnd?: string;
  format?: ReportFormat;
  aiSummary?: boolean;
  instructions?: string;
  registeredBeds?: number;
  operationalBeds?: number;
};
type ReportResult = {
  title: string;
  subtitle: string;
  rows: Array<Record<string, unknown>>;
  columns: ExportableReport['columns'];
  metadata?: ExportableReport['metadata'];
  notes: string[];
};

const validDate = (value: string | undefined) => /^20\d{2}-\d{2}-\d{2}$/.test(String(value || ''));
const safeIdentifier = (value: string | undefined) => String(value || '').trim().replace(/[^0-9A-Za-z_-]/g, '').slice(0, 30);
const safeFormat = (value: unknown): ReportFormat | undefined => (
  ['docx', 'xlsx', 'csv', 'json'].includes(String(value)) ? value as ReportFormat : undefined
);

export const HOSPITAL_PCU_SCOPE = {
  addressId: '471501',
  tambon: 'ตองโขบ',
  amphoe: 'โคกศรีสุพรรณ',
  province: 'สกลนคร',
  villages: [1, 2, 4, 5, 7, 8, 9, 10, 13, 14, 15, 16],
} as const;

const bangkokDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value('year'), month: value('month'), day: value('day') };
};

export const fiscalYearDateRange = (fiscalYears = 3, referenceDate = new Date()) => {
  const boundedYears = Math.min(3, Math.max(1, Math.trunc(fiscalYears)));
  const current = bangkokDateParts(referenceDate);
  const lastFiscalYear = current.year + (current.month >= 10 ? 544 : 543);
  const firstFiscalYear = lastFiscalYear - boundedYears + 1;
  return {
    fiscalYears: Array.from({ length: boundedYears }, (_, index) => firstFiscalYear + index),
    dateStart: `${firstFiscalYear - 544}-10-01`,
    dateEnd: `${lastFiscalYear - 543}-09-30`,
  };
};

const rangeForExplicitFiscalYears = (years: number[]) => {
  const distinct = Array.from(new Set(years)).sort((a, b) => a - b);
  if (!distinct.length || distinct.some((year) => year < 2500 || year > 2700)) return null;
  const lastYear = distinct[distinct.length - 1];
  if (lastYear - distinct[0] > 2) throw new Error('รายงานข้อมูลรายบุคคลเลือกได้ไม่เกิน 3 ปีงบประมาณ');
  return {
    fiscalYears: Array.from({ length: lastYear - distinct[0] + 1 }, (_, index) => distinct[0] + index),
    dateStart: `${distinct[0] - 544}-10-01`,
    dateEnd: `${lastYear - 543}-09-30`,
  };
};

export const parseCommunityDeathReportIntent = (
  question: string,
  referenceDate = new Date(),
): HospitalReportRequest | null => {
  const normalized = String(question || '').normalize('NFKC').toLowerCase();
  if (!/(เสียชีวิต|ผู้ตาย|การตาย)/.test(normalized)) return null;
  if (!/(pcu|พี\s*ซี\s*ยู|เขตโรงพยาบาล|ตองโขบ)/i.test(normalized)) return null;
  const explicitYears = [...normalized.matchAll(/25\d{2}/g)].map((match) => Number(match[0]));
  const range = rangeForExplicitFiscalYears(explicitYears)
    || fiscalYearDateRange(/(?:3|สาม)\s*ปี/.test(normalized) ? 3 : 3, referenceDate);
  const format = /word|docx|เวิร์ด/.test(normalized)
    ? 'docx'
    : /csv/.test(normalized)
      ? 'csv'
      : /json/.test(normalized)
        ? 'json'
        : /excel|xlsx|เอ็กเซล|ไฟล์/.test(normalized)
          ? 'xlsx'
          : undefined;
  return {
    reportId: 'pcu-death',
    dateStart: range.dateStart,
    dateEnd: range.dateEnd,
    ...(format ? { format: format as ReportFormat } : {}),
    aiSummary: true,
    instructions: `ปีงบประมาณ ${range.fiscalYears.join(', ')}`,
  };
};

export const parseHospitalReportIntent = (
  question: string,
  referenceDate = new Date(),
): HospitalReportRequest | null => {
  const death = parseCommunityDeathReportIntent(question, referenceDate);
  if (death) return death;
  const normalized = String(question || '').normalize('NFKC').toLowerCase();
  const requestedFormat = /word|docx|เวิร์ด/.test(normalized)
    ? 'docx'
    : /csv/.test(normalized)
      ? 'csv'
      : /json/.test(normalized)
        ? 'json'
        : /excel|xlsx|เอ็กเซล|ไฟล์/.test(normalized)
          ? 'xlsx'
          : undefined;
  if (/(ครองเตียง|สถานะเตียง|เตียงว่าง|จำนวนเตียง|เตียงตามการขึ้นทะเบียน|กรอบเตียง|รวมทุกตึก)/.test(normalized)) {
    const registeredBeds = Number(normalized.match(/(\d+)\s*เตียงตามการขึ้นทะเบียน/)?.[1] || 0);
    const operationalBeds = Number(normalized.match(/(?:และ|,)?\s*(\d+)\s*(?:เตียง)?\s*ตาม\s*(?:กบรส|บรส|กรอบ)/)?.[1] || 0);
    return {
      reportId: 'bed-occupancy',
      ...(registeredBeds > 0 && registeredBeds <= 5_000 ? { registeredBeds } : {}),
      ...(operationalBeds > 0 && operationalBeds <= 5_000 ? { operationalBeds } : {}),
      ...(requestedFormat ? { format: requestedFormat as ReportFormat } : {}), aiSummary: true,
    };
  }
  if (/(สัดส่วนสิทธิ|สิทธิการรักษา|payer\s*mix)/.test(normalized)) {
    const current = bangkokDateParts(referenceDate);
    const yearMonth = `${current.year}-${String(current.month).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
    return {
      reportId: 'payer-mix', dateStart: `${yearMonth}-01`, dateEnd: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
      ...(requestedFormat ? { format: requestedFormat as ReportFormat } : {}), aiSummary: true,
    };
  }
  if (/(รพ\.?\s*สต|โรงพยาบาลส่งเสริมสุขภาพตำบล|หน่วยบริการประจำ)/.test(normalized)
    && /(สรุปบริการ|รายละเอียดบริการ|มาทำอะไร|ค่ายา|รายการยา|ยาอะไร|lab|แล็บ|ห้องปฏิบัติการ|หัตถการ)/.test(normalized)) {
    const current = bangkokDateParts(referenceDate);
    const yearMonth = `${current.year}-${String(current.month).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
    return {
      reportId: 'pcu-visit-service-detail',
      dateStart: `${yearMonth}-01`,
      dateEnd: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
      ...(requestedFormat ? { format: requestedFormat as ReportFormat } : {}),
      aiSummary: true,
    };
  }
  if (/(รพ\.?\s*สต|โรงพยาบาลส่งเสริมสุขภาพตำบล|หน่วยบริการประจำ)/.test(normalized)
    && /(คนไข้|ผู้ป่วย|รับบริการ|visit|ค่าใช้จ่าย|refer|ส่งต่อ)/.test(normalized)) {
    const current = bangkokDateParts(referenceDate);
    const yearMonth = `${current.year}-${String(current.month).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
    return {
      reportId: 'pcu-patient-service',
      dateStart: `${yearMonth}-01`,
      dateEnd: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
      ...(requestedFormat ? { format: requestedFormat as ReportFormat } : {}),
      aiSummary: true,
    };
  }
  return null;
};

const requireDateRange = (request: HospitalReportRequest) => {
  if (!validDate(request.dateStart) || !validDate(request.dateEnd)) throw new Error('กรุณาระบุวันที่เริ่มต้นและสิ้นสุดให้ถูกต้อง');
  if (request.dateStart! > request.dateEnd!) throw new Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
  const days = (Date.parse(`${request.dateEnd}T00:00:00Z`) - Date.parse(`${request.dateStart}T00:00:00Z`)) / 86_400_000;
  if (days > 366) throw new Error('ช่วงรายงานต้องไม่เกิน 366 วัน');
  return { dateStart: request.dateStart!, dateEnd: request.dateEnd! };
};

export const parseHospitalReportInstructionFilters = (instructions = '') => {
  const normalized = String(instructions || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const ucTerm = '(?:uc|ucs|บัตรทอง|หลักประกันสุขภาพ)';
  const excludesUc = new RegExp(`(?:ไม่เอา|ไม่รวม|ยกเว้น|ตัด).{0,20}${ucTerm}`, 'i').test(normalized);
  const onlyUc = !excludesUc && (
    new RegExp(`(?:เฉพาะ|เท่านั้น|only).{0,24}(?:สิทธิ(?:์)?\\s*)?${ucTerm}`, 'i').test(normalized)
    || new RegExp(`${ucTerm}.{0,24}(?:เฉพาะ|เท่านั้น|only)`, 'i').test(normalized)
  );
  return { payerGroup: onlyUc ? 'uc' as const : undefined };
};

const dischargeSummary = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const identifier = safeIdentifier(request.identifier);
  const type = request.identifierType === 'hn' ? 'hn' : 'an';
  if (!identifier) throw new Error('กรุณาระบุ AN หรือ HN');
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT i.an, i.vn, i.hn,
         TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
         DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admitDate,
         DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dischargeDate,
         COALESCE(w.name, i.ward) AS ward,
         COALESCE(pt.name, i.pttype) AS payer,
         COALESCE(a.pdx, '') AS primaryDiagnosis,
         CONCAT_WS(', ', NULLIF(a.dx0, ''), NULLIF(a.dx1, ''), NULLIF(a.dx2, ''), NULLIF(a.dx3, ''), NULLIF(a.dx4, ''), NULLIF(a.dx5, '')) AS otherDiagnoses,
         COALESCE(a.drg, '') AS drg, COALESCE(a.rw, 0) AS rw,
         COALESCE(a.income, 0) AS totalCharge,
         CASE WHEN i.dchdate IS NULL THEN 'ยังไม่จำหน่าย' ELSE 'จำหน่ายแล้ว' END AS dischargeStatus
       FROM ipt i
       JOIN patient p ON p.hn = i.hn
       LEFT JOIN an_stat a ON a.an = i.an
       LEFT JOIN ward w ON w.ward = i.ward
       LEFT JOIN pttype pt ON pt.pttype = i.pttype
       WHERE ${type === 'hn' ? 'i.hn' : 'i.an'} = ?
       ORDER BY i.regdate DESC, i.regtime DESC
       LIMIT 1`,
      [identifier],
    );
    const data = rows as Array<Record<string, unknown>>;
    if (!data.length) throw new Error(`ไม่พบข้อมูลผู้ป่วยในสำหรับ ${type.toUpperCase()} ${identifier}`);
    return {
      title: 'รายงานสรุปประวัติการรักษาผู้ป่วยใน',
      subtitle: `ข้อมูลจาก HOSxP สำหรับ ${type.toUpperCase()} ${identifier}`,
      rows: data,
      columns: [
        { key: 'an', label: 'AN' }, { key: 'hn', label: 'HN' }, { key: 'patientName', label: 'ชื่อผู้ป่วย', width: 24 },
        { key: 'admitDate', label: 'วันที่รับไว้' }, { key: 'dischargeDate', label: 'วันที่จำหน่าย' }, { key: 'ward', label: 'วอร์ด' },
        { key: 'primaryDiagnosis', label: 'วินิจฉัยหลัก' }, { key: 'otherDiagnoses', label: 'วินิจฉัยร่วม', width: 28 },
        { key: 'drg', label: 'DRG' }, { key: 'rw', label: 'RW' }, { key: 'totalCharge', label: 'ค่าใช้จ่าย' },
        { key: 'dischargeStatus', label: 'สถานะ' },
      ],
      notes: ['คำแนะนำก่อนกลับบ้านและรายการยากลับบ้านยังต้องตรวจจากเวชระเบียน/คำสั่งแพทย์ก่อนลงนาม'],
    };
  } finally {
    connection.release();
  }
};

const operativeNote = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const vn = safeIdentifier(request.identifier);
  if (!vn) throw new Error('กรุณาระบุ VN ของการรับบริการ');
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT o.vn, o.icd9 AS procedureCode, COALESCE(i.name, '') AS procedureName
       FROM doctor_operation o
       LEFT JOIN icd9cm1 i ON i.code = o.icd9
       WHERE o.vn = ?
       ORDER BY o.icd9`,
      [vn],
    );
    const data = rows as Array<Record<string, unknown>>;
    if (!data.length) throw new Error(`ไม่พบรายการหัตถการ doctor_operation สำหรับ VN ${vn}`);
    return {
      title: 'รายงานบันทึกการผ่าตัดและหัตถการ',
      subtitle: `รายการหัตถการที่บันทึกใน HOSxP สำหรับ VN ${vn}`,
      rows: data,
      columns: [
        { key: 'vn', label: 'VN' }, { key: 'procedureCode', label: 'รหัส ICD9' },
        { key: 'procedureName', label: 'หัตถการ', width: 36 },
      ],
      notes: ['รายนามทีมผ่าตัด รายละเอียดขั้นตอน และภาวะแทรกซ้อนต้องเชื่อมแบบฟอร์ม OR เพิ่มเติมก่อนใช้เป็น Operative Note ฉบับลงนาม'],
    };
  } finally {
    connection.release();
  }
};

const bedOccupancy = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT i.ward AS wardCode, COALESCE(w.name, i.ward, 'ไม่ระบุวอร์ด') AS ward,
         COUNT(DISTINCT i.an) AS occupiedBeds,
         ROUND(AVG(DATEDIFF(CURDATE(), i.regdate)), 1) AS averageStayDays
       FROM ipt i
       LEFT JOIN ward w ON w.ward = i.ward
       WHERE i.dchdate IS NULL
       GROUP BY i.ward, w.name
       ORDER BY occupiedBeds DESC, ward`,
    );
    const data = rows as Array<Record<string, unknown>>;
    const occupied = data.reduce((sum, row) => sum + Number(row.occupiedBeds || 0), 0);
    const capacityNotes = [
      request.registeredBeds
        ? `จำนวนเตียงตามทะเบียน ${request.registeredBeds} เตียง: ครอง ${occupied} เตียง (${((occupied * 100) / request.registeredBeds).toFixed(1)}%)`
        : '',
      request.operationalBeds
        ? `กรอบเตียงให้บริการ ${request.operationalBeds} เตียง: ครอง ${occupied} เตียง (${((occupied * 100) / request.operationalBeds).toFixed(1)}%)`
        : '',
    ].filter(Boolean);
    return {
      title: 'รายงานจำนวนผู้ครองเตียงปัจจุบัน',
      subtitle: 'ผู้ป่วยในที่ยังไม่จำหน่าย แยกตามวอร์ด',
      rows: data,
      columns: [
        { key: 'wardCode', label: 'รหัสวอร์ด' }, { key: 'ward', label: 'วอร์ด', width: 28 },
        { key: 'occupiedBeds', label: 'ครองเตียง' }, { key: 'averageStayDays', label: 'วันนอนเฉลี่ย' },
      ],
      metadata: [
        ...(request.registeredBeds ? [{ label: 'เตียงตามทะเบียน', value: String(request.registeredBeds) }] : []),
        ...(request.operationalBeds ? [{ label: 'กรอบเตียงให้บริการ', value: String(request.operationalBeds) }] : []),
      ],
      notes: capacityNotes.length
        ? [...capacityNotes, 'อัตรารวมใช้จำนวนผู้ป่วยที่ยังไม่จำหน่ายเทียบกับจำนวนเตียงรวมที่ผู้ใช้ยืนยัน']
        : ['ยังไม่คำนวณอัตราครองเตียงและเตียงว่างจนกว่าจะกำหนดจำนวนเตียงมาตรฐานของแต่ละวอร์ด'],
    };
  } finally {
    connection.release();
  }
};

const communityDeathReport = async (request: HospitalReportRequest): Promise<ReportResult> => {
  if (!validDate(request.dateStart) || !validDate(request.dateEnd)) throw new Error('กรุณาระบุช่วงปีงบประมาณให้ถูกต้อง');
  if (request.dateStart! > request.dateEnd!) throw new Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
  const days = (Date.parse(`${request.dateEnd}T00:00:00Z`) - Date.parse(`${request.dateStart}T00:00:00Z`)) / 86_400_000;
  if (days > 1_096) throw new Error('รายงานข้อมูลรายบุคคลเลือกได้ไม่เกิน 3 ปีงบประมาณ');
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         YEAR(COALESCE(pd.death_date, p.death_date, pt.deathday)) + 543
           + IF(MONTH(COALESCE(pd.death_date, p.death_date, pt.deathday)) >= 10, 1, 0) AS fiscalYear,
         COALESCE(NULLIF(p.patient_hn, ''), NULLIF(pt.hn, ''), '') AS hn,
         TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
         COALESCE(NULLIF(p.cid, ''), NULLIF(pt.cid, ''), '') AS cid,
         DATE_FORMAT(COALESCE(p.birthdate, pt.birthday), '%Y-%m-%d') AS birthDate,
         CONCAT_WS(' ',
           CONCAT('บ้านเลขที่ ', COALESCE(NULLIF(h.address, ''), '-')),
           CONCAT('หมู่ ', v.village_moo),
           CONCAT('ตำบล${HOSPITAL_PCU_SCOPE.tambon}'),
           CONCAT('อำเภอ${HOSPITAL_PCU_SCOPE.amphoe}'),
           CONCAT('จังหวัด${HOSPITAL_PCU_SCOPE.province}')
         ) AS address,
         DATE_FORMAT(COALESCE(pd.death_date, p.death_date, pt.deathday), '%Y-%m-%d') AS deathDate,
         COALESCE(NULLIF(pd.death_diag_1, ''), NULLIF(pt.death_diag, ''), '') AS mainDiseaseCode,
         COALESCE(main_icd.name, '') AS mainDiseaseName,
         COALESCE(NULLIF(pd.death_cause, ''), NULLIF(pd.death_diag_1, ''), NULLIF(pt.death_diag, ''), '') AS deathCauseCode,
         COALESCE(NULLIF(pd.death_cause_text, ''), cause_icd.name, main_icd.name, '') AS deathCause
       FROM person p
       JOIN house h ON h.house_id = p.house_id
       JOIN village v ON v.village_id = COALESCE(p.village_id, h.village_id)
       LEFT JOIN person_death pd ON pd.person_id = p.person_id
       LEFT JOIN patient pt ON pt.hn = p.patient_hn
       LEFT JOIN icd101 main_icd ON main_icd.code = COALESCE(NULLIF(pd.death_diag_1, ''), NULLIF(pt.death_diag, ''))
       LEFT JOIN icd101 cause_icd ON cause_icd.code = NULLIF(pd.death_cause, '')
       WHERE COALESCE(pd.death_date, p.death_date, pt.deathday) BETWEEN ? AND ?
         AND v.address_id = ?
         AND CAST(v.village_moo AS UNSIGNED) IN (${HOSPITAL_PCU_SCOPE.villages.map(() => '?').join(', ')})
       ORDER BY deathDate, patientName
       LIMIT 2000`,
      [request.dateStart, request.dateEnd, HOSPITAL_PCU_SCOPE.addressId, ...HOSPITAL_PCU_SCOPE.villages],
    );
    return {
      title: 'รายงานผู้เสียชีวิตในเขต PCU โรงพยาบาล',
      subtitle: `ปีงบประมาณตามวันที่เสียชีวิต ${request.dateStart} ถึง ${request.dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'fiscalYear', label: 'ปีงบประมาณ' },
        { key: 'hn', label: 'HN' },
        { key: 'patientName', label: 'ชื่อ-สกุล', width: 24 },
        { key: 'cid', label: 'CID', width: 16 },
        { key: 'birthDate', label: 'วันเดือนปีเกิด' },
        { key: 'address', label: 'ที่อยู่', width: 45 },
        { key: 'deathDate', label: 'วันที่เสียชีวิต' },
        { key: 'mainDiseaseCode', label: 'รหัสโรคหลัก' },
        { key: 'mainDiseaseName', label: 'โรคหลัก (ถ้ามี)', width: 30 },
        { key: 'deathCauseCode', label: 'รหัสสาเหตุการตาย' },
        { key: 'deathCause', label: 'สาเหตุการตาย', width: 34 },
      ],
      metadata: [
        { label: 'ขอบเขตพื้นที่', value: `PCU โรงพยาบาล ต.${HOSPITAL_PCU_SCOPE.tambon} หมู่ ${HOSPITAL_PCU_SCOPE.villages.join(', ')}` },
        { label: 'แหล่งข้อมูล', value: 'person, person_death, patient, house, village, icd101' },
      ],
      notes: [
        'เป็นข้อมูลลับระดับบุคคล ใช้เฉพาะผู้มีสิทธิ์และห้ามส่งต่อนอกงานบริการโดยไม่มีฐานกฎหมาย',
        'โรคหลักและสาเหตุการตายแสดงตามรหัสที่บันทึกใน HOSxP เท่านั้น AI ไม่เติมหรือวินิจฉัยข้อมูลที่ว่าง',
        'ขอบเขต PCU อิงภาพยืนยันพื้นที่: ตำบลตองโขบ หมู่ 1, 2, 4, 5, 7, 8, 9, 10, 13, 14, 15, 16',
      ],
    };
  } finally {
    connection.release();
  }
};

const dailyServiceSummary = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT d.serviceDate,
         COALESCE(opd.opdVisits, 0) AS opdVisits,
         COALESCE(opd.opdPatients, 0) AS opdPatients,
         COALESCE(opd.opdCharge, 0) AS opdCharge,
         COALESCE(ipd.admissions, 0) AS ipdAdmissions,
         COALESCE(dch.discharges, 0) AS ipdDischarges,
         COALESCE(dch.ipdCharge, 0) AS ipdDischargeCharge
       FROM (
         SELECT vstdate AS serviceDate FROM ovst WHERE vstdate BETWEEN ? AND ?
         UNION SELECT regdate FROM ipt WHERE regdate BETWEEN ? AND ?
         UNION SELECT dchdate FROM ipt WHERE dchdate BETWEEN ? AND ?
       ) d
       LEFT JOIN (
         SELECT o.vstdate, COUNT(DISTINCT o.vn) AS opdVisits, COUNT(DISTINCT o.hn) AS opdPatients,
           ROUND(SUM(COALESCE(v.income, 0)), 2) AS opdCharge
         FROM ovst o LEFT JOIN vn_stat v ON v.vn = o.vn
         WHERE o.vstdate BETWEEN ? AND ? GROUP BY o.vstdate
       ) opd ON opd.vstdate = d.serviceDate
       LEFT JOIN (
         SELECT regdate, COUNT(DISTINCT an) AS admissions FROM ipt
         WHERE regdate BETWEEN ? AND ? GROUP BY regdate
       ) ipd ON ipd.regdate = d.serviceDate
       LEFT JOIN (
         SELECT i.dchdate, COUNT(DISTINCT i.an) AS discharges, ROUND(SUM(COALESCE(a.income, 0)), 2) AS ipdCharge
         FROM ipt i LEFT JOIN an_stat a ON a.an = i.an
         WHERE i.dchdate BETWEEN ? AND ? GROUP BY i.dchdate
       ) dch ON dch.dchdate = d.serviceDate
       ORDER BY d.serviceDate`,
      [dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd],
    );
    return {
      title: 'รายงานภาพรวมบริการประจำวัน', subtitle: `${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'serviceDate', label: 'วันที่' }, { key: 'opdVisits', label: 'OPD (ครั้ง)' },
        { key: 'opdPatients', label: 'OPD (คน)' }, { key: 'opdCharge', label: 'ค่าใช้จ่าย OPD' },
        { key: 'ipdAdmissions', label: 'รับเข้า IPD' }, { key: 'ipdDischarges', label: 'จำหน่าย IPD' },
        { key: 'ipdDischargeCharge', label: 'ค่าใช้จ่าย IPD ที่จำหน่าย' },
      ],
      notes: ['ยอด OPD อิงวันรับบริการ ส่วนยอด IPD อิงวันจำหน่าย จึงไม่ควรนำมารวมเป็นรายรับทางบัญชีโดยตรง'],
    };
  } finally { connection.release(); }
};

const opdDepartmentWorkload = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COALESCE(NULLIF(o.main_dep, ''), 'ไม่ระบุ') AS departmentCode,
         COALESCE(NULLIF(k.department, ''), NULLIF(o.main_dep, ''), 'ไม่ระบุแผนก') AS department,
         COUNT(DISTINCT o.vn) AS visits, COUNT(DISTINCT o.hn) AS patients,
         ROUND(COUNT(DISTINCT o.vn) / NULLIF(COUNT(DISTINCT o.vstdate), 0), 1) AS averageVisitsPerServiceDay,
         ROUND(SUM(COALESCE(v.income, 0)), 2) AS totalCharge,
         ROUND(AVG(COALESCE(v.income, 0)), 2) AS averageChargePerVisit
       FROM ovst o
       LEFT JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
       WHERE o.vstdate BETWEEN ? AND ?
       GROUP BY o.main_dep, k.department ORDER BY visits DESC`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานภาระงานผู้ป่วยนอกแยกแผนก', subtitle: `${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'departmentCode', label: 'รหัสแผนก' }, { key: 'department', label: 'แผนก', width: 30 },
        { key: 'visits', label: 'จำนวนครั้ง' }, { key: 'patients', label: 'จำนวนคน' },
        { key: 'averageVisitsPerServiceDay', label: 'เฉลี่ยครั้ง/วันบริการ' }, { key: 'totalCharge', label: 'ค่าใช้จ่ายรวม' },
        { key: 'averageChargePerVisit', label: 'เฉลี่ย/ครั้ง' },
      ],
      notes: ['แผนกอิง main_dep ที่บันทึกใน ovst และอาจต่างจากจุดให้บริการจริงหากไม่ได้ปิด visit สมบูรณ์'],
    };
  } finally { connection.release(); }
};

const opdDiagnosisRanking = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COALESCE(NULLIF(v.pdx, ''), 'ไม่ระบุ') AS diagnosisCode,
         COALESCE(NULLIF(i.tname, ''), NULLIF(i.name, ''), 'ไม่ระบุชื่อโรค') AS diagnosis,
         COUNT(DISTINCT v.vn) AS visits, COUNT(DISTINCT v.hn) AS patients,
         ROUND(COUNT(DISTINCT v.vn) * 100.0 / NULLIF((SELECT COUNT(DISTINCT x.vn) FROM vn_stat x WHERE x.vstdate BETWEEN ? AND ?), 0), 2) AS visitPercent,
         ROUND(SUM(COALESCE(v.income, 0)), 2) AS totalCharge
       FROM vn_stat v LEFT JOIN icd101 i ON i.code = v.pdx
       WHERE v.vstdate BETWEEN ? AND ?
       GROUP BY v.pdx, i.tname, i.name ORDER BY visits DESC LIMIT 500`,
      [dateStart, dateEnd, dateStart, dateEnd],
    );
    return {
      title: 'รายงานอันดับโรคผู้ป่วยนอก', subtitle: `วินิจฉัยหลัก ${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'diagnosisCode', label: 'ICD-10' }, { key: 'diagnosis', label: 'ชื่อโรค', width: 38 },
        { key: 'visits', label: 'จำนวนครั้ง' }, { key: 'patients', label: 'จำนวนคน' },
        { key: 'visitPercent', label: 'สัดส่วน (%)' }, { key: 'totalCharge', label: 'ค่าใช้จ่ายรวม' },
      ],
      notes: ['นับตามวินิจฉัยหลัก (pdx) ของ visit และแยก “ไม่ระบุ” เพื่อใช้ติดตามความครบถ้วนของการลงรหัส'],
    };
  } finally { connection.release(); }
};

const ipdAdmissionDischarge = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT i.an, i.hn,
         TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
         DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admitDate, DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dischargeDate,
         COALESCE(NULLIF(w.name, ''), i.ward, 'ไม่ระบุวอร์ด') AS ward,
         COALESCE(NULLIF(a.pdx, ''), '') AS primaryDiagnosis,
         COALESCE(NULLIF(a.drg, ''), '') AS drg, COALESCE(a.rw, 0) AS rw,
         CASE WHEN i.dchdate IS NULL THEN DATEDIFF(CURDATE(), i.regdate) ELSE DATEDIFF(i.dchdate, i.regdate) END AS stayDays,
         ROUND(COALESCE(a.income, 0), 2) AS totalCharge,
         CASE WHEN i.dchdate IS NULL THEN 'กำลังรักษา' ELSE 'จำหน่ายแล้ว' END AS status
       FROM ipt i JOIN patient p ON p.hn = i.hn
       LEFT JOIN an_stat a ON a.an = i.an LEFT JOIN ward w ON w.ward = i.ward
       WHERE i.regdate BETWEEN ? AND ? OR i.dchdate BETWEEN ? AND ?
       ORDER BY i.regdate, i.an LIMIT 20000`,
      [dateStart, dateEnd, dateStart, dateEnd],
    );
    return {
      title: 'ทะเบียนรับเข้าและจำหน่ายผู้ป่วยใน', subtitle: `รับเข้าหรือจำหน่ายระหว่าง ${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'an', label: 'AN' }, { key: 'hn', label: 'HN' }, { key: 'patientName', label: 'ชื่อ-สกุล', width: 25 },
        { key: 'admitDate', label: 'วันที่รับเข้า' }, { key: 'dischargeDate', label: 'วันที่จำหน่าย' },
        { key: 'ward', label: 'วอร์ด', width: 24 }, { key: 'primaryDiagnosis', label: 'วินิจฉัยหลัก' },
        { key: 'drg', label: 'DRG' }, { key: 'rw', label: 'RW' }, { key: 'stayDays', label: 'วันนอน' },
        { key: 'totalCharge', label: 'ค่าใช้จ่าย' }, { key: 'status', label: 'สถานะ' },
      ],
      notes: ['เป็นข้อมูลระดับบุคคล จำกัด 20,000 รายการต่อครั้ง และรวมเคสที่รับเข้าหรือจำหน่ายอยู่ในช่วงที่เลือก'],
    };
  } finally { connection.release(); }
};

const ipdWardPerformance = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COALESCE(NULLIF(w.name, ''), i.ward, 'ไม่ระบุวอร์ด') AS ward,
         COUNT(DISTINCT i.an) AS dischargedCases,
         ROUND(AVG(GREATEST(DATEDIFF(i.dchdate, i.regdate), 1)), 1) AS averageStayDays,
         SUM(GREATEST(DATEDIFF(i.dchdate, i.regdate), 1)) AS patientDays,
         ROUND(AVG(COALESCE(a.rw, 0)), 4) AS averageRw,
         ROUND(SUM(COALESCE(a.rw, 0)), 4) AS totalRw,
         ROUND(SUM(COALESCE(a.income, 0)), 2) AS totalCharge,
         ROUND(AVG(COALESCE(a.income, 0)), 2) AS averageChargePerCase
       FROM ipt i LEFT JOIN an_stat a ON a.an = i.an LEFT JOIN ward w ON w.ward = i.ward
       WHERE i.dchdate BETWEEN ? AND ?
       GROUP BY i.ward, w.name ORDER BY dischargedCases DESC`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานผลงานผู้ป่วยในแยกวอร์ด', subtitle: `เคสจำหน่าย ${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'ward', label: 'วอร์ด', width: 28 }, { key: 'dischargedCases', label: 'เคสจำหน่าย' },
        { key: 'averageStayDays', label: 'วันนอนเฉลี่ย' }, { key: 'patientDays', label: 'วันนอนรวม' },
        { key: 'averageRw', label: 'RW เฉลี่ย' }, { key: 'totalRw', label: 'RW รวม' },
        { key: 'totalCharge', label: 'ค่าใช้จ่ายรวม' }, { key: 'averageChargePerCase', label: 'เฉลี่ย/เคส' },
      ],
      notes: ['คำนวณจากเคสที่จำหน่ายในช่วงเวลา วันนอนขั้นต่ำต่อเคสใช้ 1 วันเพื่อการสรุปภาระงาน'],
    };
  } finally { connection.release(); }
};

const referralSummary = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT x.direction, x.hospcode,
         COALESCE(NULLIF(h.name, ''), NULLIF(x.hospcode, ''), 'ไม่ระบุสถานพยาบาล') AS hospital,
         COUNT(*) AS referralCount, COUNT(DISTINCT x.hn) AS patients
       FROM (
         SELECT 'รับส่งต่อเข้า' AS direction, r.hn, COALESCE(NULLIF(r.refer_hospcode, ''), NULLIF(r.hospcode, '')) AS hospcode
         FROM referin r WHERE r.refer_date BETWEEN ? AND ?
         UNION ALL
         SELECT 'ส่งต่อออก' AS direction, r.hn, COALESCE(NULLIF(r.refer_hospcode, ''), NULLIF(r.hospcode, '')) AS hospcode
         FROM referout r WHERE r.refer_date BETWEEN ? AND ?
       ) x LEFT JOIN hospcode h ON h.hospcode = x.hospcode
       GROUP BY x.direction, x.hospcode, h.name ORDER BY x.direction, referralCount DESC`,
      [dateStart, dateEnd, dateStart, dateEnd],
    );
    return {
      title: 'รายงานการรับและส่งต่อผู้ป่วย', subtitle: `${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'direction', label: 'ทิศทาง' }, { key: 'hospcode', label: 'รหัสสถานพยาบาล' },
        { key: 'hospital', label: 'สถานพยาบาลต้นทาง/ปลายทาง', width: 38 },
        { key: 'referralCount', label: 'จำนวนครั้ง' }, { key: 'patients', label: 'จำนวนคน' },
      ],
      notes: ['สรุปจาก referin/referout ตามวันที่ส่งต่อ ไม่ใช่แบบฟอร์มส่งเวรหรือใบ Refer ฉบับลงนาม'],
    };
  } finally { connection.release(); }
};

const drugUtilization = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT oi.icode AS itemCode, COALESCE(NULLIF(d.name, ''), oi.icode) AS itemName,
         COALESCE(NULLIF(d.units, ''), '') AS unit,
         COUNT(DISTINCT oi.vn) AS visits, COUNT(DISTINCT oi.hn) AS patients,
         ROUND(SUM(COALESCE(oi.qty, 0)), 2) AS totalQuantity,
         ROUND(SUM(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0)), 2) AS totalCharge
       FROM opitemrece oi JOIN s_drugitems d ON d.icode = oi.icode
       WHERE oi.vstdate BETWEEN ? AND ? AND COALESCE(d.is_medication, 'N') = 'Y'
       GROUP BY oi.icode, d.name, d.units ORDER BY totalQuantity DESC LIMIT 1000`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานการใช้ยา', subtitle: `${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'itemCode', label: 'รหัสยา' }, { key: 'itemName', label: 'ชื่อยา', width: 42 }, { key: 'unit', label: 'หน่วย' },
        { key: 'visits', label: 'จำนวน Visit' }, { key: 'patients', label: 'จำนวนคน' },
        { key: 'totalQuantity', label: 'จำนวนจ่ายรวม' }, { key: 'totalCharge', label: 'มูลค่าตามรายการ' },
      ],
      notes: ['เป็นปริมาณรายการที่ลงใน opitemrece ไม่ใช่ยอดคงคลังหรือ stock movement และจำกัด 1,000 รายการยา'],
    };
  } finally { connection.release(); }
};

const labWorkload = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT lo.lab_items_code AS labCode,
         COALESCE(NULLIF(li.lab_items_name, ''), NULLIF(lo.lab_items_name_ref, ''), lo.lab_items_code) AS labName,
         COUNT(*) AS orderedTests,
         SUM(CASE WHEN NULLIF(lo.lab_order_result, '') IS NOT NULL THEN 1 ELSE 0 END) AS resultedTests,
         SUM(CASE WHEN lo.abnormal_result = 'Y' THEN 1 ELSE 0 END) AS abnormalResults,
         COUNT(DISTINCT lh.vn) AS visits,
         ROUND(SUM(CASE WHEN lo.abnormal_result = 'Y' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS abnormalPercent
       FROM lab_head lh JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
       LEFT JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
       WHERE lh.order_date BETWEEN ? AND ?
       GROUP BY lo.lab_items_code, li.lab_items_name, lo.lab_items_name_ref
       ORDER BY orderedTests DESC LIMIT 1000`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานปริมาณงานห้องปฏิบัติการ', subtitle: `${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'labCode', label: 'รหัส Lab' }, { key: 'labName', label: 'รายการตรวจ', width: 40 },
        { key: 'orderedTests', label: 'จำนวนสั่งตรวจ' }, { key: 'resultedTests', label: 'มีผลแล้ว' },
        { key: 'abnormalResults', label: 'ผลผิดปกติ' }, { key: 'abnormalPercent', label: 'ผิดปกติ (%)' },
        { key: 'visits', label: 'จำนวน Visit' },
      ],
      notes: ['สถานะผลผิดปกติอิง abnormal_result ที่ระบบ Lab บันทึก ไม่ใช้ AI ตีความค่าผลตรวจ'],
    };
  } finally { connection.release(); }
};

const claimDataCompleteness = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
         TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
         COALESCE(p.cid, '') AS cid, COALESCE(o.pttype, '') AS payerCode,
         COALESCE(v.pdx, '') AS primaryDiagnosis, ROUND(COALESCE(v.income, 0), 2) AS totalCharge,
         CONCAT_WS(', ',
           CASE WHEN NULLIF(p.cid, '') IS NULL THEN 'ไม่มี CID' END,
           CASE WHEN NULLIF(o.pttype, '') IS NULL THEN 'ไม่มีสิทธิ' END,
           CASE WHEN NULLIF(v.pdx, '') IS NULL THEN 'ไม่มีวินิจฉัยหลัก' END,
           CASE WHEN COALESCE(v.income, 0) <= 0 THEN 'ไม่มียอดค่าใช้จ่าย' END
         ) AS missingData
       FROM ovst o JOIN patient p ON p.hn = o.hn LEFT JOIN vn_stat v ON v.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ?
         AND (NULLIF(p.cid, '') IS NULL OR NULLIF(o.pttype, '') IS NULL OR NULLIF(v.pdx, '') IS NULL OR COALESCE(v.income, 0) <= 0)
       ORDER BY o.vstdate, o.vn LIMIT 20000`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานความครบถ้วนข้อมูลก่อนส่งเคลม', subtitle: `OPD ${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'serviceDate', label: 'วันที่' }, { key: 'vn', label: 'VN' }, { key: 'hn', label: 'HN' },
        { key: 'patientName', label: 'ชื่อ-สกุล', width: 25 }, { key: 'cid', label: 'CID' },
        { key: 'payerCode', label: 'สิทธิ' }, { key: 'primaryDiagnosis', label: 'วินิจฉัยหลัก' },
        { key: 'totalCharge', label: 'ค่าใช้จ่าย' }, { key: 'missingData', label: 'ข้อมูลที่ต้องแก้', width: 38 },
      ],
      notes: ['เป็นด่านตรวจพื้นฐาน CID/สิทธิ/วินิจฉัยหลัก/ยอดค่าใช้จ่าย ไม่ทดแทนกฎเฉพาะกองทุนในหน้าตรวจก่อนส่ง'],
    };
  } finally { connection.release(); }
};

const revenueByCategory = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COALESCE(NULLIF(oi.income, ''), 'ไม่ระบุ') AS incomeCode,
         COALESCE(NULLIF(i.name, ''), NULLIF(oi.income, ''), 'ไม่ระบุหมวด') AS incomeCategory,
         COUNT(*) AS itemCount, COUNT(DISTINCT oi.vn) AS visits, COUNT(DISTINCT oi.hn) AS patients,
         ROUND(SUM(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0)), 2) AS totalCharge,
         ROUND(AVG(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0)), 2) AS averagePerItem
       FROM opitemrece oi LEFT JOIN income i ON i.income = oi.income
       WHERE oi.vstdate BETWEEN ? AND ?
       GROUP BY oi.income, i.name ORDER BY totalCharge DESC`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานค่าใช้จ่ายแยกหมวดบริการ', subtitle: `${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'incomeCode', label: 'รหัสหมวด' }, { key: 'incomeCategory', label: 'หมวดค่าใช้จ่าย', width: 36 },
        { key: 'itemCount', label: 'จำนวนรายการ' }, { key: 'visits', label: 'จำนวน Visit' },
        { key: 'patients', label: 'จำนวนคน' }, { key: 'totalCharge', label: 'ค่าใช้จ่ายรวม' },
        { key: 'averagePerItem', label: 'เฉลี่ย/รายการ' },
      ],
      notes: ['เป็นราคาค่าบริการจาก opitemrece ไม่ใช่รายรับที่รับเงินจริงหรือยอดชดเชยจากกองทุน'],
    };
  } finally { connection.release(); }
};

const costPerDrg = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COALESCE(NULLIF(a.drg, ''), 'ไม่ระบุ DRG') AS drg,
         COUNT(DISTINCT a.an) AS cases,
         ROUND(AVG(COALESCE(a.rw, 0)), 4) AS averageRw,
         ROUND(SUM(COALESCE(a.income, 0)), 2) AS totalCharge,
         ROUND(AVG(COALESCE(a.income, 0)), 2) AS averageChargePerCase
       FROM an_stat a
       WHERE a.dchdate BETWEEN ? AND ?
       GROUP BY COALESCE(NULLIF(a.drg, ''), 'ไม่ระบุ DRG')
       ORDER BY totalCharge DESC
       LIMIT 500`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานค่าใช้จ่ายต่อกลุ่ม DRG', subtitle: `วันที่จำหน่าย ${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'drg', label: 'DRG' }, { key: 'cases', label: 'จำนวนเคส' }, { key: 'averageRw', label: 'RW เฉลี่ย' },
        { key: 'totalCharge', label: 'ยอดเรียกเก็บรวม' }, { key: 'averageChargePerCase', label: 'เฉลี่ยต่อเคส' },
      ],
      notes: ['ค่า income เป็นยอดค่าใช้จ่าย/เรียกเก็บจาก HOSxP ไม่ใช่ต้นทุนทางบัญชีจริง จนกว่าจะเชื่อมข้อมูลต้นทุน'],
    };
  } finally {
    connection.release();
  }
};

const payerMix = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT o.pttype AS payerCode, COALESCE(pt.name, o.pttype, 'ไม่ระบุสิทธิ') AS payer,
         COUNT(DISTINCT o.hn) AS patients, COUNT(DISTINCT o.vn) AS visits,
         ROUND(COUNT(DISTINCT o.vn) * 100.0 / NULLIF((SELECT COUNT(DISTINCT x.vn) FROM ovst x WHERE x.vstdate BETWEEN ? AND ?), 0), 2) AS visitPercent
       FROM ovst o
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       WHERE o.vstdate BETWEEN ? AND ?
       GROUP BY o.pttype, pt.name
       ORDER BY visits DESC`,
      [dateStart, dateEnd, dateStart, dateEnd],
    );
    return {
      title: 'รายงานสัดส่วนสิทธิการรักษา', subtitle: `ผู้ป่วยนอก ${dateStart} ถึง ${dateEnd}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'payerCode', label: 'รหัสสิทธิ' }, { key: 'payer', label: 'สิทธิการรักษา', width: 34 },
        { key: 'patients', label: 'จำนวนคน' }, { key: 'visits', label: 'จำนวนครั้ง' }, { key: 'visitPercent', label: 'สัดส่วน (%)' },
      ],
      notes: ['จัดกลุ่มตามรหัส pttype ที่บันทึกในแต่ละ OPD visit'],
    };
  } finally {
    connection.release();
  }
};

const pcuPatientService = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const filters = parseHospitalReportInstructionFilters(request.instructions);
  const payerFilterClause = filters.payerGroup === 'uc' ? " AND COALESCE(pt.uc, 'N') = 'Y'" : '';
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         COALESCE(NULLIF(o.hospsub, ''), 'ไม่ระบุ') AS pcuCode,
         COALESCE(NULLIF(hc.name, ''), IF(NULLIF(o.hospsub, '') IS NULL, 'ไม่ระบุหน่วยบริการประจำ', o.hospsub)) AS pcuName,
         o.hn,
         TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
         COALESCE(p.cid, '') AS cid,
         CASE p.sex WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' ELSE COALESCE(p.sex, '') END AS sex,
         TIMESTAMPDIFF(YEAR, p.birthday, MAX(o.vstdate)) AS ageAtLastVisit,
         COUNT(DISTINCT o.vn) AS visitCount,
         DATE_FORMAT(MIN(o.vstdate), '%Y-%m-%d') AS firstVisitDate,
         DATE_FORMAT(MAX(o.vstdate), '%Y-%m-%d') AS lastVisitDate,
         ROUND(SUM(COALESCE(vs.income, 0)), 2) AS totalCharge,
         ROUND(AVG(COALESCE(vs.income, 0)), 2) AS averageChargePerVisit,
         GROUP_CONCAT(DISTINCT COALESCE(NULLIF(vt.visit_type_name, ''), NULLIF(o.visit_type, ''), 'ไม่ระบุ') ORDER BY COALESCE(vt.visit_type_name, o.visit_type) SEPARATOR ', ') AS serviceTypes,
         GROUP_CONCAT(DISTINCT COALESCE(NULLIF(pt.name, ''), NULLIF(o.pttype, ''), 'ไม่ระบุ') ORDER BY COALESCE(pt.name, o.pttype) SEPARATOR ', ') AS payers,
         GROUP_CONCAT(DISTINCT COALESCE(NULLIF(k.department, ''), NULLIF(o.main_dep, '')) ORDER BY COALESCE(k.department, o.main_dep) SEPARATOR ', ') AS serviceDepartments,
         SUM(COALESCE(rf.referInCount, 0)) AS referInCount,
         SUM(COALESCE(rf.referOutCount, 0)) AS referOutCount,
         GROUP_CONCAT(DISTINCT NULLIF(rf.referDetails, '') ORDER BY rf.referDetails SEPARATOR '; ') AS referDetails,
         GROUP_CONCAT(DISTINCT NULLIF(vs.pdx, '') ORDER BY vs.pdx SEPARATOR ', ') AS mainDiagnoses
       FROM ovst o
       JOIN patient p ON p.hn = o.hn
       LEFT JOIN vn_stat vs ON vs.vn = o.vn
       LEFT JOIN hospcode hc ON hc.hospcode = o.hospsub
       LEFT JOIN visit_type vt ON vt.visit_type = o.visit_type
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
       LEFT JOIN (
         SELECT x.vn,
           SUM(CASE WHEN x.direction = 'IN' THEN 1 ELSE 0 END) AS referInCount,
           SUM(CASE WHEN x.direction = 'OUT' THEN 1 ELSE 0 END) AS referOutCount,
           GROUP_CONCAT(DISTINCT CONCAT(x.direction, ':', COALESCE(NULLIF(rh.name, ''), NULLIF(x.hospcode, ''), 'ไม่ระบุ')) ORDER BY x.direction, x.hospcode SEPARATOR ', ') AS referDetails
         FROM (
           SELECT vn, 'IN' AS direction, COALESCE(NULLIF(refer_hospcode, ''), NULLIF(hospcode, '')) AS hospcode FROM referin
           UNION ALL
           SELECT vn, 'OUT' AS direction, COALESCE(NULLIF(refer_hospcode, ''), NULLIF(hospcode, '')) AS hospcode FROM referout
         ) x
         LEFT JOIN hospcode rh ON rh.hospcode = x.hospcode
         WHERE NULLIF(x.vn, '') IS NOT NULL
         GROUP BY x.vn
       ) rf ON rf.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ?
         AND NULLIF(o.hn, '') IS NOT NULL
         ${payerFilterClause}
       GROUP BY o.hospsub, hc.name, o.hn, p.pname, p.fname, p.lname, p.cid, p.sex, p.birthday
       ORDER BY pcuName, visitCount DESC, patientName
       LIMIT 20000`,
      [dateStart, dateEnd],
    );
    return {
      title: 'รายงานผู้มารับบริการแยกราย รพ.สต.',
      subtitle: `ผู้ป่วยนอก ${dateStart} ถึง ${dateEnd} จัดกลุ่มตามหน่วยบริการประจำใน visit${filters.payerGroup === 'uc' ? ' · เฉพาะสิทธิ UC' : ''}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'pcuCode', label: 'รหัสหน่วยบริการ' }, { key: 'pcuName', label: 'รพ.สต./หน่วยบริการประจำ', width: 32 },
        { key: 'hn', label: 'HN' }, { key: 'patientName', label: 'ชื่อ-สกุล', width: 24 }, { key: 'cid', label: 'CID', width: 16 },
        { key: 'sex', label: 'เพศ' }, { key: 'ageAtLastVisit', label: 'อายุ ณ ครั้งล่าสุด' },
        { key: 'visitCount', label: 'จำนวนครั้งรับบริการ' }, { key: 'firstVisitDate', label: 'วันที่มาครั้งแรก' },
        { key: 'lastVisitDate', label: 'วันที่มาครั้งล่าสุด' }, { key: 'totalCharge', label: 'ค่าใช้จ่ายรวม' },
        { key: 'averageChargePerVisit', label: 'ค่าใช้จ่ายเฉลี่ย/visit' }, { key: 'serviceTypes', label: 'ประเภทรับบริการ', width: 22 },
        { key: 'payers', label: 'สิทธิการรักษา', width: 30 }, { key: 'serviceDepartments', label: 'แผนกที่รับบริการ', width: 30 },
        { key: 'referInCount', label: 'Refer in (ครั้ง)' }, { key: 'referOutCount', label: 'Refer out (ครั้ง)' },
        { key: 'referDetails', label: 'รายละเอียด Refer', width: 35 }, { key: 'mainDiagnoses', label: 'วินิจฉัยหลัก', width: 24 },
      ],
      metadata: [
        { label: 'ระดับข้อมูล', value: '1 แถวต่อ HN ต่อหน่วยบริการประจำ' },
        { label: 'แหล่งค่าใช้จ่าย', value: 'vn_stat.income (ยอดค่าใช้จ่ายของ visit)' },
        ...(filters.payerGroup === 'uc' ? [{ label: 'ตัวกรองสิทธิ', value: "UC ตาม pttype.uc = 'Y'" }] : []),
      ],
      notes: [
        'จัดกลุ่ม รพ.สต./หน่วยบริการจาก ovst.hospsub ของแต่ละ visit ไม่ใช่จากที่อยู่ปัจจุบันของผู้ป่วย',
        ...(filters.payerGroup === 'uc' ? ["กรองเฉพาะ visit ที่สิทธิใน HOSxP กำหนด pttype.uc = 'Y'"] : []),
        'ค่าใช้จ่ายเป็นยอดค่าใช้จ่ายใน HOSxP ไม่ใช่ต้นทุนทางบัญชีหรือยอดชดเชยที่ได้รับ',
        'ข้อมูลชื่อและ CID เป็นข้อมูลส่วนบุคคล ใช้เฉพาะผู้มีสิทธิ์และเก็บไฟล์อย่างปลอดภัย',
        'รายงานจำกัดไม่เกิน 20,000 แถวต่อครั้ง; หากข้อมูลมากให้แบ่งช่วงวันที่',
      ],
    };
  } finally {
    connection.release();
  }
};

export const pcuVisitServiceDetail = async (request: HospitalReportRequest): Promise<ReportResult> => {
  const { dateStart, dateEnd } = requireDateRange(request);
  const filters = parseHospitalReportInstructionFilters(request.instructions);
  const payerFilterClause = filters.payerGroup === 'uc' ? " AND COALESCE(pt.uc, 'N') = 'Y'" : '';
  const connection = await getUTFConnection();
  try {
    await connection.query('SET SESSION group_concat_max_len = 65535');
    const [rows] = await connection.query(
      `SELECT
         COALESCE(NULLIF(o.hospsub, ''), 'ไม่ระบุ') AS pcuCode,
         COALESCE(NULLIF(hc.name, ''), IF(NULLIF(o.hospsub, '') IS NULL, 'ไม่ระบุหน่วยบริการประจำ', o.hospsub)) AS pcuName,
         DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
         TIME_FORMAT(o.vsttime, '%H:%i') AS serviceTime,
         o.vn, o.hn,
         TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
         COALESCE(p.cid, '') AS cid,
         COALESCE(NULLIF(scr.cc, ''), NULLIF(o.diag_text, ''), NULLIF(vs.pdx, ''), 'ไม่ระบุอาการสำคัญ') AS chiefComplaint,
         COALESCE(NULLIF(vs.pdx, ''), '') AS mainDiagnosisCode,
         COALESCE(NULLIF(icd.tname, ''), NULLIF(icd.name, ''), '') AS mainDiagnosisName,
         COALESCE(NULLIF(k.department, ''), NULLIF(o.main_dep, ''), 'ไม่ระบุแผนก') AS serviceDepartment,
         COALESCE(NULLIF(vt.visit_type_name, ''), NULLIF(o.visit_type, ''), 'ไม่ระบุ') AS serviceType,
         COALESCE(NULLIF(pt.name, ''), NULLIF(o.pttype, ''), 'ไม่ระบุสิทธิ') AS payer,
         ROUND(COALESCE(vs.income, items.calculatedTotal, 0), 2) AS totalCharge,
         ROUND(COALESCE(items.drugCost, 0), 2) AS drugCost,
         COALESCE(items.drugItems, '') AS drugItems,
         ROUND(COALESCE(items.labCost, 0), 2) AS labCost,
         COALESCE(labs.labItems, '') AS labItems,
         ROUND(COALESCE(items.otherServiceCost, 0), 2) AS otherServiceCost,
         COALESCE(items.otherServiceItems, '') AS otherServiceItems,
         COALESCE(proc.procedures, '') AS procedures,
         COALESCE(rf.referInCount, 0) AS referInCount,
         COALESCE(rf.referOutCount, 0) AS referOutCount,
         COALESCE(rf.referDetails, '') AS referDetails
       FROM ovst o
       JOIN patient p ON p.hn = o.hn
       LEFT JOIN vn_stat vs ON vs.vn = o.vn
       LEFT JOIN opdscreen scr ON scr.vn = o.vn
       LEFT JOIN icd101 icd ON icd.code = vs.pdx
       LEFT JOIN hospcode hc ON hc.hospcode = o.hospsub
       LEFT JOIN visit_type vt ON vt.visit_type = o.visit_type
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
       LEFT JOIN (
         SELECT oi.vn,
           ROUND(SUM(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0)), 2) AS calculatedTotal,
           ROUND(SUM(CASE WHEN COALESCE(sd.is_medication, 'N') = 'Y' OR inc.name LIKE '%ค่ายา%' THEN COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0) ELSE 0 END), 2) AS drugCost,
           GROUP_CONCAT(DISTINCT CASE WHEN COALESCE(sd.is_medication, 'N') = 'Y' OR inc.name LIKE '%ค่ายา%'
             THEN CONCAT(CONVERT(COALESCE(NULLIF(sd.name, ''), NULLIF(ndi.name, ''), oi.icode) USING utf8mb4),
               ' x', COALESCE(oi.qty, 0), ' = ', ROUND(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0), 2), ' บาท') END
             ORDER BY COALESCE(sd.name, ndi.name, oi.icode) SEPARATOR '; ') AS drugItems,
           ROUND(SUM(CASE WHEN inc.income_group = '01' OR inc.name LIKE '%ห้องปฏิบัติการ%' THEN COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0) ELSE 0 END), 2) AS labCost,
           ROUND(SUM(CASE WHEN NOT (COALESCE(sd.is_medication, 'N') = 'Y' OR COALESCE(inc.name, '') LIKE '%ค่ายา%' OR inc.income_group = '01' OR COALESCE(inc.name, '') LIKE '%ห้องปฏิบัติการ%')
             THEN COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0) ELSE 0 END), 2) AS otherServiceCost,
           GROUP_CONCAT(DISTINCT CASE WHEN NOT (COALESCE(sd.is_medication, 'N') = 'Y' OR COALESCE(inc.name, '') LIKE '%ค่ายา%' OR inc.income_group = '01' OR COALESCE(inc.name, '') LIKE '%ห้องปฏิบัติการ%')
             THEN CONCAT(CONVERT(COALESCE(NULLIF(ndi.name, ''), NULLIF(sd.name, ''), oi.icode) USING utf8mb4),
               ' x', COALESCE(oi.qty, 0), ' = ', ROUND(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0), 2), ' บาท') END
             ORDER BY COALESCE(ndi.name, sd.name, oi.icode) SEPARATOR '; ') AS otherServiceItems
         FROM opitemrece oi
         LEFT JOIN s_drugitems sd ON sd.icode = oi.icode
         LEFT JOIN nondrugitems ndi ON ndi.icode = oi.icode
         LEFT JOIN income inc ON inc.income = oi.income
         WHERE oi.vstdate BETWEEN ? AND ? AND NULLIF(oi.vn, '') IS NOT NULL
         GROUP BY oi.vn
       ) items ON items.vn = o.vn
       LEFT JOIN (
         SELECT lh.vn,
           GROUP_CONCAT(DISTINCT CONCAT(CONVERT(COALESCE(NULLIF(li.lab_items_name, ''), NULLIF(lo.lab_items_name_ref, ''), lo.lab_items_code) USING utf8mb4),
             CASE WHEN NULLIF(lo.lab_order_result, '') IS NOT NULL THEN CONCAT(' = ', CONVERT(lo.lab_order_result USING utf8mb4), COALESCE(CONCAT(' ', CONVERT(NULLIF(li.lab_items_unit, '') USING utf8mb4)), '')) ELSE ' (สั่งตรวจ)' END,
             CASE WHEN lo.abnormal_result = 'Y' THEN ' [ผิดปกติ]' ELSE '' END)
             ORDER BY COALESCE(li.lab_items_name, lo.lab_items_name_ref) SEPARATOR '; ') AS labItems
         FROM lab_head lh
         JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
         LEFT JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
         WHERE lh.order_date BETWEEN ? AND ? AND NULLIF(lh.vn, '') IS NOT NULL
         GROUP BY lh.vn
       ) labs ON labs.vn = o.vn
       LEFT JOIN (
         SELECT dop.vn,
           GROUP_CONCAT(DISTINCT CONCAT(CONVERT(COALESCE(NULLIF(dop.icd9, ''), '') USING utf8mb4),
             CASE WHEN NULLIF(i9.name, '') IS NOT NULL THEN CONCAT(' ', CONVERT(i9.name USING utf8mb4)) ELSE '' END)
             ORDER BY dop.icd9 SEPARATOR '; ') AS procedures
         FROM doctor_operation dop
         LEFT JOIN icd9cm1 i9 ON i9.code = dop.icd9
         WHERE dop.begin_date_time >= ? AND dop.begin_date_time < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY dop.vn
       ) proc ON proc.vn = o.vn
       LEFT JOIN (
         SELECT x.vn,
           SUM(CASE WHEN x.direction = 'IN' THEN 1 ELSE 0 END) AS referInCount,
           SUM(CASE WHEN x.direction = 'OUT' THEN 1 ELSE 0 END) AS referOutCount,
           GROUP_CONCAT(DISTINCT CONCAT(x.direction, ':', CONVERT(COALESCE(NULLIF(rh.name, ''), NULLIF(x.hospcode, ''), 'ไม่ระบุ') USING utf8mb4)) ORDER BY x.direction, x.hospcode SEPARATOR ', ') AS referDetails
         FROM (
           SELECT vn, 'IN' AS direction, COALESCE(NULLIF(refer_hospcode, ''), NULLIF(hospcode, '')) AS hospcode FROM referin
           UNION ALL
           SELECT vn, 'OUT' AS direction, COALESCE(NULLIF(refer_hospcode, ''), NULLIF(hospcode, '')) AS hospcode FROM referout
         ) x
         LEFT JOIN hospcode rh ON rh.hospcode = x.hospcode
         WHERE NULLIF(x.vn, '') IS NOT NULL
         GROUP BY x.vn
       ) rf ON rf.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ? AND NULLIF(o.vn, '') IS NOT NULL
         ${payerFilterClause}
       ORDER BY pcuName, o.vstdate, o.vsttime, patientName
       LIMIT 20000`,
      [dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd],
    );
    return {
      title: 'สรุปรายละเอียดบริการราย Visit แยกราย รพ.สต.',
      subtitle: `ผู้ป่วยนอก ${dateStart} ถึง ${dateEnd} · 1 แถวต่อ VN${filters.payerGroup === 'uc' ? ' · เฉพาะสิทธิ UC' : ''}`,
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'pcuCode', label: 'รหัสหน่วยบริการ' }, { key: 'pcuName', label: 'รพ.สต./หน่วยบริการประจำ', width: 32 },
        { key: 'serviceDate', label: 'วันที่รับบริการ' }, { key: 'serviceTime', label: 'เวลา' },
        { key: 'vn', label: 'VN' }, { key: 'hn', label: 'HN' }, { key: 'patientName', label: 'ชื่อ-สกุล', width: 24 },
        { key: 'cid', label: 'CID', width: 16 }, { key: 'chiefComplaint', label: 'มารับบริการด้วยเรื่อง', width: 36 },
        { key: 'mainDiagnosisCode', label: 'รหัสวินิจฉัยหลัก' }, { key: 'mainDiagnosisName', label: 'วินิจฉัยหลัก', width: 32 },
        { key: 'serviceDepartment', label: 'แผนก', width: 24 }, { key: 'serviceType', label: 'ประเภทบริการ' },
        { key: 'payer', label: 'สิทธิการรักษา', width: 28 }, { key: 'totalCharge', label: 'ค่าใช้จ่ายรวม' },
        { key: 'drugCost', label: 'ค่ายา' }, { key: 'drugItems', label: 'รายการยา/จำนวน/ราคา', width: 48 },
        { key: 'labCost', label: 'ค่า Lab' }, { key: 'labItems', label: 'รายการและผล Lab', width: 50 },
        { key: 'otherServiceCost', label: 'ค่าบริการอื่น' }, { key: 'otherServiceItems', label: 'รายการบริการอื่น', width: 50 },
        { key: 'procedures', label: 'หัตถการ', width: 36 }, { key: 'referInCount', label: 'Refer in' },
        { key: 'referOutCount', label: 'Refer out' }, { key: 'referDetails', label: 'รายละเอียด Refer', width: 35 },
      ],
      metadata: [
        { label: 'ระดับข้อมูล', value: '1 แถวต่อ Visit (VN)' },
        { label: 'แหล่งค่าใช้จ่าย', value: 'vn_stat.income และรายละเอียด opitemrece' },
        ...(filters.payerGroup === 'uc' ? [{ label: 'ตัวกรองสิทธิ', value: "UC ตาม pttype.uc = 'Y'" }] : []),
      ],
      notes: [
        ...(filters.payerGroup === 'uc' ? ["กรองเฉพาะ visit ที่สิทธิใน HOSxP กำหนด pttype.uc = 'Y'"] : []),
        'ค่ายาและค่าบริการคำนวณจากรายการ opitemrece; ยอดรวมหลักใช้ vn_stat.income เมื่อมีข้อมูล',
        'ค่า Lab มาจากหมวดค่าใช้จ่ายห้องปฏิบัติการ ส่วนรายการ/ผล Lab มาจาก lab_head และ lab_order',
        'ช่องมารับบริการด้วยเรื่องใช้ Chief Complaint ก่อน แล้วจึงใช้ข้อความวินิจฉัยหรือรหัสวินิจฉัยเป็นข้อมูลสำรอง',
        'ข้อมูลชื่อ CID รายการยา และผล Lab เป็นข้อมูลสุขภาพส่วนบุคคล ใช้เฉพาะผู้มีสิทธิ์และเก็บไฟล์อย่างปลอดภัย',
        'รายงานจำกัดไม่เกิน 20,000 visits ต่อครั้ง; หากข้อมูลมากให้แบ่งช่วงวันที่',
      ],
    };
  } finally {
    connection.release();
  }
};

const aiSummary = async (report: ReportResult, instructions = '') => {
  try {
    return await generateAgentText(
      'คุณเป็นผู้ช่วยจัดทำรายงานโรงพยาบาล สรุปจากข้อมูล Backend ที่ให้เท่านั้น ห้ามวินิจฉัย ห้ามเดาข้อมูลที่ไม่มี ระบุข้อจำกัดสำคัญ และใช้ภาษาไทยกระชับ',
      `ชื่อรายงาน: ${report.title}\nคำขอเพิ่มเติม: ${instructions.slice(0, 500)}\nข้อจำกัด: ${report.notes.join('; ')}\nข้อมูล (${report.rows.length} แถว): ${JSON.stringify(report.rows.slice(0, 50))}`,
      { temperature: 0.1, maxTokens: 700 },
    );
  } catch {
    return `พบข้อมูล ${report.rows.length.toLocaleString('th-TH')} รายการ กรุณาตรวจรายละเอียดและข้อจำกัดก่อนนำรายงานไปใช้`;
  }
};

export const runHospitalReport = async (input: HospitalReportRequest) => {
  const request = { ...input, format: safeFormat(input.format) };
  if (request.reportId === 'lab-report') {
    const identifier = safeIdentifier(request.identifier);
    const identifierType = request.identifierType === 'vn' ? 'vn' : 'hn';
    if (!identifier) throw new Error('กรุณาระบุ HN หรือ VN');
    return answerPatientReportQuestion({
      kind: 'patient-lookup', identifierType, identifier, topic: 'labs',
      ...(request.format ? { format: request.format } : {}),
    });
  }
  let report: ReportResult;
  if (request.reportId === 'discharge-summary') report = await dischargeSummary(request);
  else if (request.reportId === 'operative-note') report = await operativeNote(request);
  else if (request.reportId === 'bed-occupancy') report = await bedOccupancy(request);
  else if (request.reportId === 'daily-service-summary') report = await dailyServiceSummary(request);
  else if (request.reportId === 'opd-department-workload') report = await opdDepartmentWorkload(request);
  else if (request.reportId === 'opd-diagnosis-ranking') report = await opdDiagnosisRanking(request);
  else if (request.reportId === 'ipd-admission-discharge') report = await ipdAdmissionDischarge(request);
  else if (request.reportId === 'ipd-ward-performance') report = await ipdWardPerformance(request);
  else if (request.reportId === 'referral-report') report = await referralSummary(request);
  else if (request.reportId === 'drug-utilization') report = await drugUtilization(request);
  else if (request.reportId === 'lab-workload') report = await labWorkload(request);
  else if (request.reportId === 'claim-data-completeness') report = await claimDataCompleteness(request);
  else if (request.reportId === 'cost-per-drg') report = await costPerDrg(request);
  else if (request.reportId === 'payer-mix') report = await payerMix(request);
  else if (request.reportId === 'revenue-by-category') report = await revenueByCategory(request);
  else if (request.reportId === 'pcu-death') report = await communityDeathReport(request);
  else if (request.reportId === 'pcu-patient-service') report = await pcuPatientService(request);
  else if (request.reportId === 'pcu-visit-service-detail') report = await pcuVisitServiceDetail(request);
  else throw new Error('รายงานนี้ยังไม่พร้อมใช้งาน');

  const exportable: ExportableReport = {
    title: report.title, subtitle: report.subtitle,
    metadata: [...(report.metadata || []), ...report.notes.map((note, index) => ({ label: `ข้อจำกัด ${index + 1}`, value: note }))],
    columns: report.columns, rows: report.rows,
  };
  const attachment = request.format
    ? await buildReportAttachment(request.format, exportable, `hospital-${request.reportId}`)
    : undefined;
  return {
    answer: request.aiSummary === false
      ? `สร้าง ${report.title} จากข้อมูล ${report.rows.length.toLocaleString('th-TH')} รายการแล้ว`
      : await aiSummary(report, request.instructions),
    title: report.title,
    subtitle: report.subtitle,
    rows: report.rows.slice(0, 100),
    totalRows: report.rows.length,
    columns: report.columns,
    notes: report.notes,
    attachment,
  };
};
