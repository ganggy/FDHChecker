import AdmZip from 'adm-zip';
import crypto from 'crypto';
import iconv from 'iconv-lite';
import type mysql from 'mysql2/promise';
import { getRepstmConnection, getUTFConnection } from './db.js';

export type SssNetworkType = 'ALL' | 'IN' | 'OUT';
export type SssImportType = 'REP' | 'STM';

export interface SssCandidateOptions {
  startDate: string;
  endDate: string;
  networkType?: SssNetworkType;
}

export interface SssValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface SssCandidate extends Record<string, unknown> {
  vn: string;
  network_type: 'IN' | 'OUT';
  validation_status: 'ready' | 'warning' | 'error';
  issues: SssValidationIssue[];
}

const SSS_IMPORT_BATCH_SQL = `
  CREATE TABLE IF NOT EXISTS sss_import_batch (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    import_type VARCHAR(8) NOT NULL,
    source_filename VARCHAR(255) NOT NULL,
    network_type VARCHAR(8) NOT NULL DEFAULT 'ALL',
    imported_by VARCHAR(128) NULL,
    row_count INT NOT NULL DEFAULT 0,
    file_hash CHAR(64) NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sss_import_file_hash (import_type, file_hash),
    INDEX idx_sss_import_type_created (import_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const SSS_IMPORT_ROW_SQL = `
  CREATE TABLE IF NOT EXISTS sss_import_row (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    row_no INT NOT NULL,
    status_code VARCHAR(32) NULL,
    station VARCHAR(32) NULL,
    hcode VARCHAR(16) NULL,
    hmain VARCHAR(16) NULL,
    auth_code VARCHAR(64) NULL,
    service_datetime VARCHAR(32) NULL,
    invoice_no VARCHAR(64) NULL,
    hn VARCHAR(32) NULL,
    vn VARCHAR(32) NULL,
    cid VARCHAR(32) NULL,
    amount DECIMAL(15,2) NULL,
    claim_amount DECIMAL(15,2) NULL,
    paid_amount DECIMAL(15,2) NULL,
    check_code TEXT NULL,
    raw_data JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sss_import_batch (batch_id),
    INDEX idx_sss_import_vn (vn),
    INDEX idx_sss_import_hn (hn),
    INDEX idx_sss_import_invoice (invoice_no),
    CONSTRAINT fk_sss_import_batch FOREIGN KEY (batch_id) REFERENCES sss_import_batch(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const ensureSssImportTables = async (connection: mysql.PoolConnection) => {
  await connection.query(SSS_IMPORT_BATCH_SQL);
  await connection.query(SSS_IMPORT_ROW_SQL);
};

const text = (value: unknown) => String(value ?? '').trim();
const number = (value: unknown) => Number(value ?? 0) || 0;
const xml = (value: unknown) => text(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');
const money = (value: unknown) => number(value).toFixed(2);
const pipeValue = (value: unknown) => xml(value).replace(/[|\r\n]+/g, ' ').trim();
const pipeRow = (values: unknown[]) => values.map(pipeValue).join('|');

export const evaluateSssCandidate = (row: Record<string, unknown>): SssValidationIssue[] => {
  const issues: SssValidationIssue[] = [];
  const add = (severity: 'error' | 'warning', code: string, message: string) => issues.push({ severity, code, message });
  if (!/^\d{13}$/.test(text(row.cid))) add('error', 'SSS-PAT01', 'ไม่มีเลขบัตรประชาชน 13 หลัก');
  if (!text(row.pdx)) add('error', 'SSS-DX01', 'ไม่มี PDX');
  if (!/^(0[1-9]|1[0-2]|99)$/.test(text(row.clinic))) add('error', 'SSS-SVC01', 'รหัสคลินิกไม่ตรงมาตรฐาน 01-12 หรือ 99');
  if (!text(row.hospmain)) add('error', 'SSS-INS01', 'ไม่มี HospMain');
  if (number(row.income) <= 0) add('error', 'SSS-CHG01', 'ค่าใช้จ่ายเป็นศูนย์');
  if (Math.abs(number(row.charge_total) - number(row.income)) > 0.01 || number(row.charge_mismatch_count) > 0) {
    add('error', 'SSS-CHG02', 'ยอดรายละเอียดค่าใช้จ่ายไม่ตรงกับยอดรวม');
  }
  if (number(row.missing_bill_group_count) > 0) add('error', 'SSS-CHG03', 'มีรายการที่ยังไม่ Map BILLMUAD');
  if (number(row.missing_item_name_count) > 0) add('error', 'SSS-CHG04', 'มีรายการค่าใช้จ่ายที่ไม่มีชื่อรายการ');
  if (number(row.mixed_hn_count) > 0) add('error', 'SSS-VIS01', 'พบ HN อื่นในรายการค่าใช้จ่ายของ VN');
  if (/ADMIT/i.test(text(row.visit_outcome))) add('error', 'SSS-VIS02', 'ผลการรักษา Admit ต้องตรวจสอบเส้นทางเคลม');
  if (!text(row.doctor_license)) add('warning', 'SSS-DOC01', 'ไม่พบเลขใบอนุญาตผู้ให้บริการ');
  if (number(row.missing_drug_usage_count) > 0) add('warning', 'SSS-DRU01', 'มีรายการยาที่ไม่มีวิธีใช้ยา');
  if (number(row.missing_tmlt_count) > 0) add('warning', 'SSS-LAB01', 'มีรายการ LAB ที่ยังไม่ Map TMLT');
  if (!text(row.end_datetime)) add('warning', 'SSS-SVC02', 'ไม่พบเวลาสิ้นสุดรับบริการ');
  if (!text(row.right_begin_date)) add('warning', 'SSS-INS02', 'ไม่มีวันที่เริ่มใช้สิทธิ์');
  if (!text(row.right_expire_date)) add('warning', 'SSS-INS03', 'ไม่มีวันหมดอายุสิทธิ์');
  return issues;
};

export const buildSssCandidateSql = (networkType: SssNetworkType) => `
  SELECT
    o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
    TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time,
    CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
    COALESCE(NULLIF(pt.cid, ''), pc.cardno, '') AS cid,
    o.pttype, ptt.name AS pttype_name, ptt.hipdata_code,
    CASE WHEN o.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%' THEN 'OUT' ELSE 'IN' END AS network_type,
    COALESCE(v.hospmain, '') AS hospmain,
    DATE_FORMAT(v.pttype_begin, '%Y-%m-%d') AS right_begin_date,
    DATE_FORMAT(v.pttype_expire, '%Y-%m-%d') AS right_expire_date,
    COALESCE(sp.nhso_code, '') AS clinic,
    COALESCE(v.pdx, '') AS pdx,
    COALESCE(ost.name, '') AS visit_outcome,
    COALESCE(doc.licenseno, '') AS doctor_license,
    COALESCE(NULLIF(v.debt_id_list, ''), NULLIF(v.rcpno_list, ''), o.vn) AS invoice_no,
    ROUND(COALESCE(v.income, 0), 2) AS income,
    ROUND(COALESCE(v.rcpt_money, 0), 2) AS receipt_money,
    ROUND(COALESCE((SELECT SUM(oi.sum_price) FROM opitemrece oi WHERE oi.vn = o.vn), 0), 2) AS charge_total,
    ROUND(COALESCE((SELECT SUM(oi.sum_price) FROM opitemrece oi WHERE oi.vn = o.vn AND oi.paidst IN ('01','03')), 0), 2) AS paid_money,
    (SELECT COUNT(*) FROM opitemrece oi WHERE oi.vn = o.vn AND ABS(COALESCE(oi.qty,0) * COALESCE(oi.unitprice,0) - COALESCE(oi.sum_price,0)) > 0.01) AS charge_mismatch_count,
    (SELECT COUNT(*) FROM opitemrece oi LEFT JOIN income inc ON inc.income = oi.income LEFT JOIN income_report2 g ON g.group_id = inc.group2 WHERE oi.vn = o.vn AND COALESCE(g.cscd_group, '') = '') AS missing_bill_group_count,
    (SELECT COUNT(*) FROM opitemrece oi LEFT JOIN s_drugitems sd ON sd.icode = oi.icode WHERE oi.vn = o.vn AND COALESCE(TRIM(sd.name), '') = '') AS missing_item_name_count,
    (SELECT COUNT(*) FROM opitemrece oi WHERE oi.vn = o.vn AND COALESCE(oi.hn, o.hn) <> o.hn) AS mixed_hn_count,
    (SELECT COUNT(*) FROM opitemrece oi JOIN drugitems di ON di.icode = oi.icode WHERE oi.vn = o.vn AND COALESCE(TRIM(CONCAT(COALESCE(oi.drugusage,''), COALESCE(oi.sp_use,''))), '') = '') AS missing_drug_usage_count,
    (SELECT COUNT(*) FROM opitemrece oi JOIN income inc ON inc.income = oi.income LEFT JOIN s_drugitems sd ON sd.icode = oi.icode WHERE oi.vn = o.vn AND inc.group2 IN (6,7) AND (COALESCE(sd.tmlt_code,'') = '' OR sd.tmlt_code LIKE '%X%')) AS missing_tmlt_count,
    DATE_FORMAT((SELECT MAX(CONCAT(pd.outdate, ' ', pd.outtime)) FROM ptdepart pd WHERE pd.vn = o.vn AND COALESCE(pd.outdepcode, '') <> ''), '%Y-%m-%d %H:%i:%s') AS end_datetime
  FROM ovst o
  JOIN patient pt ON pt.hn = o.hn
  LEFT JOIN ptcardno pc ON pc.hn = pt.hn AND pc.cardtype = '02'
  JOIN pttype ptt ON ptt.pttype = o.pttype
  LEFT JOIN vn_stat v ON v.vn = o.vn
  LEFT JOIN spclty sp ON sp.spclty = o.spclty
  LEFT JOIN ovstost ost ON ost.ovstost = o.ovstost
  LEFT JOIN doctor doc ON doc.code = o.doctor
  WHERE o.vstdate BETWEEN ? AND ?
    AND COALESCE(o.an, '') = ''
    AND (ptt.hipdata_code IN ('SSS','SSI','SS') OR ptt.pcode = 'A7' OR (ptt.name LIKE '%ประกันสังคม%' AND COALESCE(ptt.hipdata_code,'') <> 'A9'))
    ${networkType === 'IN' ? "AND NOT (o.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%')" : ''}
    ${networkType === 'OUT' ? "AND (o.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%')" : ''}
  ORDER BY o.vstdate DESC, o.vsttime DESC, o.vn DESC
`;

export const getSssCandidates = async (options: SssCandidateOptions): Promise<SssCandidate[]> => {
  const connection = await getUTFConnection();
  try {
    const networkType = options.networkType || 'ALL';
    const [rows] = await connection.query(buildSssCandidateSql(networkType), [options.startDate, options.endDate]);
    return (Array.isArray(rows) ? rows as Record<string, unknown>[] : []).map((row) => {
      const issues = evaluateSssCandidate(row);
      const hasError = issues.some((issue) => issue.severity === 'error');
      return {
        ...row,
        vn: text(row.vn),
        network_type: text(row.network_type) === 'OUT' ? 'OUT' : 'IN',
        validation_status: hasError ? 'error' : issues.length ? 'warning' : 'ready',
        issues,
        // Deliberately no EP/Authen/close-right validation in the SSS workflow.
      } as SssCandidate;
    });
  } finally {
    connection.release();
  }
};

const withChecksum = (document: string) => `${document}<?EndNote Checksum="${crypto.createHash('md5').update(document).digest('hex')}"?>`;
const claimDocument = (hcode: string, hospitalName: string, sessionNo: string, recordCount: number, sections: string) => withChecksum(
  `<?xml version="1.0" encoding="windows-874"?>\r\n<ClaimRec System="OP" PayPlan="SS" Version="0.93" Prgs="FDHChecker" TFlag="A">\r\n` +
  `<Header><HCODE>${xml(hcode)}</HCODE><HNAME>${xml(hospitalName)}</HNAME><DATETIME>${new Date().toISOString().replace(/\.\d{3}Z$/, '')}</DATETIME><SESSNO>${xml(sessionNo)}</SESSNO><RECCOUNT>${recordCount}</RECCOUNT></Header>\r\n` +
  `${sections}\r\n</ClaimRec>\r\n`
);

export const buildSssExportZip = async (options: SssCandidateOptions & { vns: string[]; hcode: string; hospitalName: string }) => {
  if (!/^\d{5}$/.test(options.hcode) || options.hcode === '00000') throw new Error('HCODE หน่วยบริการไม่ถูกต้อง');
  const candidates = await getSssCandidates(options);
  const requested = new Set(options.vns.map(text).filter(Boolean));
  const selected = candidates.filter((row) => requested.has(row.vn));
  if (selected.length !== requested.size) throw new Error('มีบาง VN ไม่อยู่ในสิทธิ์/เครือข่าย/ช่วงวันที่ที่เลือก กรุณาดึงข้อมูลใหม่');
  const blocked = selected.filter((row) => row.validation_status === 'error');
  if (blocked.length > 0) throw new Error(`มี ${blocked.length} รายการที่ยังติด Error และไม่สามารถส่งออกได้`);

  const connection = await getUTFConnection();
  try {
    const placeholders = selected.map(() => '?').join(',');
    const [chargeRows] = await connection.query(
      `SELECT oi.vn, oi.icode, oi.qty, oi.unitprice, oi.sum_price, oi.paidst,
              COALESCE(g.cscd_group, '') AS bill_group, COALESCE(sd.nhso_adp_code, '') AS standard_code,
              COALESCE(sd.tpu_code_list, '') AS tmt_code, COALESCE(sd.name, oi.icode) AS item_name,
              COALESCE(oi.drugusage, oi.sp_use, '') AS drug_usage,
              CASE WHEN di.icode IS NULL THEN 0 ELSE 1 END AS is_drug
       FROM opitemrece oi
       LEFT JOIN income inc ON inc.income = oi.income
       LEFT JOIN income_report2 g ON g.group_id = inc.group2
       LEFT JOIN s_drugitems sd ON sd.icode = oi.icode
       LEFT JOIN drugitems di ON di.icode = oi.icode
       WHERE oi.vn IN (${placeholders}) AND COALESCE(oi.sum_price, 0) > 0
       ORDER BY oi.vn, oi.icode`,
      selected.map((row) => row.vn),
    );
    const [diagRows] = await connection.query(
      `SELECT vn, icd10, diagtype FROM ovstdiag WHERE vn IN (${placeholders}) ORDER BY vn, diagtype, ovst_diag_id`,
      selected.map((row) => row.vn),
    );
    const charges = Array.isArray(chargeRows) ? chargeRows as Record<string, unknown>[] : [];
    const diagnoses = Array.isArray(diagRows) ? diagRows as Record<string, unknown>[] : [];
    const byVisit = <T extends Record<string, unknown>>(rows: T[]) => rows.reduce<Map<string, T[]>>((map, row) => {
      const key = text(row.vn);
      map.set(key, [...(map.get(key) || []), row]);
      return map;
    }, new Map());
    const chargeMap = byVisit(charges);
    const diagMap = byVisit(diagnoses);
    const sessionNo = String(Date.now()).slice(-4);

    const billTran = selected.map((row) => {
      const claimAmount = Math.max(0, number(row.income) - number(row.paid_money));
      return pipeRow(['01', '', `${row.service_date}T${row.service_time}`, options.hcode, row.invoice_no || row.vn,
        row.invoice_no || row.vn, row.hn, '', money(row.income), money(row.paid_money), '', 'A', row.cid,
        row.patient_name, row.hospmain, '80', money(claimAmount), '', '0.00']);
    }).join('\r\n');
    const billItems = selected.flatMap((row) => (chargeMap.get(row.vn) || []).map((item) => {
      const claim = ['01', '03'].includes(text(item.paidst)) ? 0 : number(item.sum_price);
      return pipeRow([row.invoice_no || row.vn, row.service_date, item.bill_group, item.icode,
        item.standard_code || item.tmt_code, item.item_name, item.qty, money(item.unitprice), money(item.sum_price),
        money(claim > 0 ? item.unitprice : 0), money(claim), row.vn, 'OP1']);
    })).join('\r\n');
    const dispensing = selected.map((row) => {
      const items = (chargeMap.get(row.vn) || []).filter((item) => number(item.is_drug) === 1);
      if (!items.length) return '';
      const charge = items.reduce((sum, item) => sum + number(item.sum_price), 0);
      const paid = items.filter((item) => ['01', '03'].includes(text(item.paidst))).reduce((sum, item) => sum + number(item.sum_price), 0);
      return pipeRow([options.hcode, row.vn, row.invoice_no || row.vn, row.hn, row.cid,
        `${row.service_date} ${row.service_time}`, `${row.service_date} ${row.service_time}`, row.doctor_license,
        items.length, money(charge), money(charge - paid), money(paid), '0.00', 'HP', 'SS', '1', row.vn, '']);
    }).filter(Boolean).join('\r\n');
    const dispensedItems = selected.flatMap((row) => (chargeMap.get(row.vn) || []).filter((item) => number(item.is_drug) === 1).map((item) => pipeRow([
      row.vn, '1', item.icode, item.tmt_code || item.standard_code, '', item.item_name, '-', item.drug_usage,
      item.drug_usage, item.qty, money(item.unitprice), money(item.sum_price), money(item.unitprice), money(item.sum_price),
      '', 'OD', 'OP1', '', '',
    ]))).join('\r\n');
    const services = selected.map((row) => pipeRow([row.invoice_no || row.vn, row.vn, 'EC', options.hcode, row.hn,
      row.cid, '1', '01', '9', '9', '', row.doctor_license, row.clinic || '01', `${row.service_date}T${row.service_time}`,
      row.end_datetime || `${row.service_date} ${row.service_time}`, '', '', '', '0.00', 'Y', '', 'OP1'])).join('\r\n');
    const opdDx = selected.flatMap((row) => (diagMap.get(row.vn) || []).map((diag) => pipeRow([
      'EC', row.vn, diag.diagtype || '1', 'IT', text(diag.icd10).replace(/\./g, ''), '',
    ]))).join('\r\n');

    const files = [
      ['BillTran.txt', claimDocument(options.hcode, options.hospitalName, sessionNo, selected.length, `<BILLTRAN>\r\n${billTran}\r\n</BILLTRAN>\r\n<BillItems>\r\n${billItems}\r\n</BillItems>`)],
      ['BillDisp.txt', claimDocument(options.hcode, options.hospitalName, sessionNo, dispensing ? dispensing.split('\r\n').length : 0, `<Dispensing>\r\n${dispensing}\r\n</Dispensing>\r\n<DispensedItems>\r\n${dispensedItems}\r\n</DispensedItems>`)],
      ['OPServices.txt', claimDocument(options.hcode, options.hospitalName, sessionNo, selected.length, `<OPServices>\r\n${services}\r\n</OPServices>\r\n<OPDx>\r\n${opdDx}\r\n</OPDx>`)],
    ] as const;
    const zip = new AdmZip();
    files.forEach(([filename, content]) => zip.addFile(filename, iconv.encode(content, 'cp874')));
    const dateStamp = options.endDate.replace(/-/g, '');
    return {
      buffer: zip.toBuffer(),
      filename: `${options.hcode}_SSOPBIL_${sessionNo}_01_${dateStamp}.zip`,
      summary: { visitCount: selected.length, chargeCount: charges.length, diagnosisCount: diagnoses.length },
    };
  } finally {
    connection.release();
  }
};

const pick = (row: Record<string, unknown>, names: string[]) => {
  const entries = Object.entries(row);
  for (const name of names) {
    const found = entries.find(([key]) => key.trim().toLowerCase() === name.toLowerCase());
    if (found && text(found[1])) return text(found[1]);
  }
  return '';
};

export const importSssResponseRows = async (payload: {
  importType: SssImportType;
  sourceFilename: string;
  networkType?: SssNetworkType;
  importedBy?: string;
  notes?: string;
  rows: Record<string, unknown>[];
}) => {
  const cleanRows = payload.rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  if (!cleanRows.length) throw new Error('ไม่พบข้อมูล REP/STM สำหรับนำเข้า');
  const digest = crypto.createHash('sha256').update(JSON.stringify(cleanRows)).digest('hex');
  const connection = await getRepstmConnection();
  try {
    await ensureSssImportTables(connection);
    const [existingRows] = await connection.query(`SELECT id, row_count, created_at FROM sss_import_batch WHERE import_type = ? AND file_hash = ? LIMIT 1`, [payload.importType, digest]);
    if (Array.isArray(existingRows) && existingRows.length) {
      const existing = existingRows[0] as Record<string, unknown>;
      return { duplicate: true, batchId: Number(existing.id), rowCount: Number(existing.row_count), importedAt: existing.created_at };
    }
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO sss_import_batch (import_type, source_filename, network_type, imported_by, row_count, file_hash, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [payload.importType, payload.sourceFilename, payload.networkType || 'ALL', payload.importedBy || null, cleanRows.length, digest, payload.notes || null],
    );
    const batchId = Number((result as mysql.ResultSetHeader).insertId);
    for (let index = 0; index < cleanRows.length; index += 1) {
      const row = cleanRows[index];
      await connection.query(
        `INSERT INTO sss_import_row (batch_id, row_no, status_code, station, hcode, hmain, auth_code, service_datetime, invoice_no, hn, vn, cid, amount, claim_amount, paid_amount, check_code, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [batchId, index + 1, pick(row, ['Status','สถานะ','status_code']) || null, pick(row, ['Station','สถานี']) || null, pick(row, ['HCode','HOSPCODE']) || null, pick(row, ['HMain']) || null, pick(row, ['AuthCode']) || null, pick(row, ['DTTran','วันที่รับบริการ','service_date']) || null, pick(row, ['InvNo','Invoice','เลขที่ใบแจ้งหนี้']) || null, pick(row, ['HN']) || null, pick(row, ['VN','SEQ']) || null, pick(row, ['PID','CID']) || null, number(pick(row, ['Amount','ยอดเงิน'])) || null, number(pick(row, ['ClaimAmt','Claim Amount','ยอดชดเชย'])) || null, number(pick(row, ['Paid','ยอดรับ'])) || null, pick(row, ['CheckCode','Error','errorcode']) || null, JSON.stringify(row)],
      );
    }
    await connection.commit();
    return { duplicate: false, batchId, rowCount: cleanRows.length };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
};

export const getSssImportHistory = async (limit = 30) => {
  const connection = await getRepstmConnection();
  try {
    await ensureSssImportTables(connection);
    const [rows] = await connection.query(
      `SELECT b.id, b.import_type, b.source_filename, b.network_type, b.imported_by, b.row_count, b.notes, b.created_at,
              COALESCE(SUM(r.claim_amount), 0) AS claim_amount, COALESCE(SUM(r.paid_amount), 0) AS paid_amount,
              SUM(CASE WHEN COALESCE(r.check_code,'') <> '' OR COALESCE(r.status_code,'') IN ('C','D','R') THEN 1 ELSE 0 END) AS error_count
       FROM sss_import_batch b LEFT JOIN sss_import_row r ON r.batch_id = b.id
       GROUP BY b.id ORDER BY b.id DESC LIMIT ?`,
      [Math.max(1, Math.min(100, Math.trunc(limit) || 30))],
    );
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } finally {
    connection.release();
  }
};
