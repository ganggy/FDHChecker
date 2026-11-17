import type { HospitalConnection } from './hospitalDatabase.js';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import iconv from 'iconv-lite';
import type mysql from 'mysql2/promise';
import { getRepstmConnection, getUTFConnection } from './db.js';
import { getAppSetting, setAppSetting } from './repositories/system.repository.js';

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

const SSS_EXPORT_LOG_SQL = `
  CREATE TABLE IF NOT EXISTS sss_export_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    claim_mode VARCHAR(8) NOT NULL DEFAULT 'OPD',
    vn VARCHAR(32) NOT NULL,
    an VARCHAR(32) NULL,
    hn VARCHAR(32) NULL,
    invoice_no VARCHAR(64) NOT NULL,
    batch_no INT NOT NULL,
    tflag CHAR(1) NOT NULL DEFAULT 'A',
    filename VARCHAR(255) NOT NULL,
    exported_by VARCHAR(128) NULL,
    exported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sss_exp_vn (vn),
    INDEX idx_sss_exp_inv (invoice_no),
    INDEX idx_sss_exp_batch (batch_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const SSS_CLAIM_OVERRIDE_SQL = `
  CREATE TABLE IF NOT EXISTS sss_claim_override (
    vn VARCHAR(32) NOT NULL PRIMARY KEY,
    invoice_no VARCHAR(64) NULL,
    clinic VARCHAR(16) NULL,
    doctor_license VARCHAR(32) NULL,
    hospmain VARCHAR(16) NULL,
    pdx VARCHAR(16) NULL,
    end_datetime VARCHAR(32) NULL,
    tflag CHAR(1) NOT NULL DEFAULT 'E',
    resolved_flag TINYINT(1) NOT NULL DEFAULT 0,
    note TEXT NULL,
    updated_by VARCHAR(128) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const ensureSssImportTables = async (connection: HospitalConnection) => {
  await connection.query(SSS_IMPORT_BATCH_SQL);
  await connection.query(SSS_IMPORT_ROW_SQL);
  await connection.query(SSS_EXPORT_LOG_SQL);
  await connection.query(SSS_CLAIM_OVERRIDE_SQL);
};

const SSS_CHECK_CODE_DICT: Record<string, string> = {
  C01: 'รหัส HospMain / สิทธิการรักษาไม่ตรงฐานข้อมูล สปส. (ต้องตรวจสอบสิทธิ/แก้ HospMain 5 หลัก)',
  C02: 'ยอดเงินเรียกเก็บ (Amount/ClaimAmt) หรือหมวดบริการไม่สอดคล้อง',
  C03: 'ข้อมูลผู้รับบริการ (PID/ชื่อ) ไม่ตรงฐานข้อมูล สปส.',
  C04: 'วันที่รับบริการ (DTTran) ไม่อยู่ในช่วงที่มีสิทธิประกันสังคม',
  S15: 'เลขที่ใบประกอบวิชาชีพ (OPServices.SvPID) ไม่ถูกต้อง (Auto-Fix ได้)',
  S17: 'ข้อมูลผู้ให้บริการหรือสถานพยาบาลใน OPServices ไม่ครบถ้วน',
  S18: 'รหัสวินิจฉัย (OPDx ICD-10) ไม่ถูกต้องหรือไม่ตรง CodeSet IT (Auto-Fix ได้)',
  S48: 'ข้อมูลรหัสบริการ/รายการย่อยใน OPServices ไม่สมบูรณ์',
  R21: 'เลขที่ใบประกอบวิชาชีพผู้สั่งจ่ายยา (Dispensing.Prescb) ผิดรูปแบบ (Auto-Fix ได้)',
  R24: 'ขาดข้อความวิธีใช้ยา (DispensedItems.Sigtext) (Auto-Fix ได้)',
  R33: 'ยอดค่ายาใน BillTran/BillItems หมวด 3,5 ไม่ตรงกับ Dispensing (Auto-Fix ได้)',
  R51: 'รหัสยา TMT / PrdCat ใน DispensedItems ไม่ตรงบัญชีมาตรฐาน (Auto-Fix ได้)',
  R57: 'รายละเอียดรายการยาใน DispensedItems ไม่สอดคล้องกับ Dispensing',
  T15: 'SVRefID ของรายการยาหมวด 3,5 ใน BillItems ไม่สัมพันธ์กับ OPServices/Dispensing (Auto-Fix ได้)',
  W01: 'รหัสยา/เวชภัณฑ์ (TMT/Standard Code) ควรตรวจสอบความสมบูรณ์',
  W05: 'รหัสคลินิก (Clinic) หรือเลขใบอนุญาตผู้ประกอบวิชาชีพไม่ครบถ้วน (Auto-Fix ได้)',
  W07: 'วัน-เวลาสิ้นสุดบริการ (EndDateTime) ว่างหรือน้อยกว่าเวลาเริ่มบริการ (Auto-Fix ได้)',
  W09: 'ข้อมูลรายละเอียดประกอบการจ่ายยา/บริการควรตรวจสอบเพิ่มเติม',
  B34: 'ขาดข้อมูลบังคับใน BILLTRAN (เช่น InvNo / PID / HMain)',
  D34: 'ขาดข้อมูลบังคับใน BILLDISP (เช่น InvNo / DispID)',
  P34: 'ขาดข้อมูลบังคับใน OPServices (เช่น InvNo / SvID / Clinic)',
  T01: 'InvNo ซ้ำกับรายการอื่นในงวดเดียวกัน',
  T02: 'InvNo ซ้ำกับรายการที่เคยส่งเบิกผ่านไปแล้ว',
};

export const explainSssCheckCode = (checkCode: string): string[] => {
  const codes = String(checkCode || '')
    .split(/[,;\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (!codes.length) return [];
  return codes.map((code) => SSS_CHECK_CODE_DICT[code] ? `${code}: ${SSS_CHECK_CODE_DICT[code]}` : `${code}: ตรวจสอบข้อมูลตามรหัสแจ้งเตือนของ สปส.`);
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

export const cleanSssInvoiceNo = (rawInv: unknown, vn: unknown): string => {
  const clean = String(rawInv ?? '')
    .replace(/['"\s]/g, '')
    .split(',')[0]
    .split('#')[0]
    .trim();
  return clean ? clean : String(vn ?? '').trim();
};

export const DEFAULT_SSS_DOCTOR_LICENSE = 'ว51485'; // พญ.ณัฐปภัสร์ นวัตชัยศิริกุล

const isDummyDoctorLicense = (raw: string): boolean => {
  const compact = raw.replace(/[.\s_/]/g, '').trim();
  if (!compact || compact === '-') return true;
  if (/^-?(9{4,6}|0{4,6})$/.test(compact)) return true;
  const digits = compact.replace(/^[ก-ฮ]+/, '');
  return /^(9{4,6}|0{4,6})$/.test(digits);
};

/**
 * แปลงเลขใบประกอบวิชาชีพให้ตรงมาตรฐาน สกส./สปส. (เช่น "ว.12345" -> "ว12345", "พว.59110" -> "พ59110")
 * คัดกรองค่ารหัสจำลองใน HIS (-99999, 9999, 00000) ออกและคืนค่า fallback (ค่าเริ่มต้น "-")
 */
export const normalizeSssDoctorLicense = (raw: unknown, fallback = '-'): string => {
  const rawStr = String(raw ?? '').trim();
  if (isDummyDoctorLicense(rawStr)) return fallback;
  let s = rawStr.replace(/[.\s\-_/]/g, '').trim();
  if (!s) return fallback;
  // Normalize 2-char prefixes like นพ, พญ, ทพ, ทญ, ภก, ภญ, พว, พช
  s = s
    .replace(/^(นพ|พญ)/, 'ว')
    .replace(/^(ทพ|ทญ)/, 'ท')
    .replace(/^(ภก|ภญ)/, 'ภ')
    .replace(/^(พว|พช)/, 'พ');
  const m = s.match(/^([ก-ฮ]{1,3})(\d{3,6})$/);
  if (m && !/^(9{4,6}|0{4,6})$/.test(m[2])) return `${m[1]}${m[2]}`;
  const digitsOnly = s.match(/^(\d{4,6})$/);
  if (digitsOnly && !/^(9{4,6}|0{4,6})$/.test(digitsOnly[1])) return `ว${digitsOnly[1]}`;
  return fallback;
};

export const normalizeSssClinic = (raw: unknown): string => {
  const c = String(raw ?? '').trim().padStart(2, '0');
  return /^(0[1-9]|1[0-2]|99)$/.test(c) ? c : '01';
};

const formatIsoLocal = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const normalizeSssEndDateTime = (
  serviceDate: string,
  serviceTime: string,
  rawEnd: unknown,
  rxDateTime?: unknown,
): string => {
  const cleanTime = /^\d{2}:\d{2}:\d{2}$/.test(serviceTime) ? serviceTime : `${serviceTime || '08:00'}:00`.slice(0, 8);
  const startIso = `${serviceDate}T${cleanTime}`;
  const startMs = new Date(startIso).getTime();
  const candidate = String(rawEnd ?? '').trim().replace(' ', 'T');
  const endMs = candidate ? new Date(candidate).getTime() : NaN;
  if (Number.isFinite(endMs) && Number.isFinite(startMs) && endMs > startMs) {
    return candidate.slice(0, 19);
  }
  const rxCandidate = String(rxDateTime ?? '').trim().replace(' ', 'T');
  const rxMs = rxCandidate ? new Date(rxCandidate).getTime() : NaN;
  if (Number.isFinite(rxMs)) {
    const rxPlus30 = rxMs + 30 * 60 * 1000;
    if (!Number.isFinite(startMs) || rxPlus30 > startMs) {
      return formatIsoLocal(rxPlus30);
    }
    return formatIsoLocal(startMs + 30 * 60 * 1000);
  }
  if (!Number.isFinite(startMs)) return startIso;
  return formatIsoLocal(startMs + 15 * 60 * 1000);
};

export const normalizeSssIcd10 = (raw: unknown): string => {
  const clean = String(raw ?? '').replace(/[\s.]/g, '').toUpperCase().trim();
  return /^[A-Z]\d{2}[A-Z0-9]{0,4}$/.test(clean) ? clean : '';
};

export const resolveSssDrugCategoryAndTmt = (rawTmt: unknown, rawStd: unknown): { prdCat: '1' | '4'; tmtId: string } => {
  const tmtDigits = String(rawTmt ?? '').replace(/\D/g, '');
  if (/^\d{6,7}$/.test(tmtDigits)) {
    return { prdCat: '1', tmtId: tmtDigits };
  }
  const stdDigits = String(rawStd ?? '').replace(/\D/g, '');
  if (/^\d{6,7}$/.test(stdDigits)) {
    return { prdCat: '1', tmtId: stdDigits };
  }
  return { prdCat: '4', tmtId: '' };
};

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
  if (normalizeSssDoctorLicense(row.doctor_license) === '-') add('warning', 'SSS-DOC01', 'ไม่พบเลขใบอนุญาตผู้ให้บริการ');
  if (number(row.missing_drug_usage_count) > 0) add('warning', 'SSS-DRU01', 'มีรายการยาที่ไม่มีวิธีใช้ยา');
  if (number(row.missing_tmlt_count) > 0) add('warning', 'SSS-LAB01', 'มีรายการ LAB ที่ยังไม่ Map TMLT');
  const cleanEnd = text(row.end_datetime);
  if (!cleanEnd) {
    add('warning', 'SSS-SVC02', 'ไม่พบเวลาสิ้นสุดรับบริการ');
  } else {
    const startMs = new Date(`${text(row.service_date)}T${text(row.service_time) || '00:00:00'}`).getTime();
    const endMs = new Date(cleanEnd.replace(' ', 'T')).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      add('warning', 'SSS-SVC02', 'เวลาสิ้นสุดบริการน้อยกว่าหรือเท่ากับเวลาเริ่มบริการ');
    }
  }
  if (!text(row.right_begin_date)) add('warning', 'SSS-INS02', 'ไม่มีวันที่เริ่มใช้สิทธิ์');
  if (!text(row.right_expire_date)) add('warning', 'SSS-INS03', 'ไม่มีวันหมดอายุสิทธิ์');
  return issues;
};

const validLicSql = (expr: string) =>
  `CASE WHEN COALESCE(TRIM(${expr}), '') IN ('', '-', '-99999', '99999', '9999', '-9999', '00000', '0000') THEN NULL ELSE TRIM(${expr}) END`;

const DOCTOR_LICENSE_SUBQUERY = `COALESCE(
  ${validLicSql('doc.licenseno')},
  ${validLicSql('dxdoc.licenseno')},
  (SELECT ${validLicSql('odoc.licenseno')} FROM ovstdiag od JOIN doctor odoc ON odoc.code = od.doctor WHERE od.vn = o.vn AND ${validLicSql('odoc.licenseno')} IS NOT NULL ORDER BY od.diagtype ASC LIMIT 1),
  (SELECT ${validLicSql('rdoc.licenseno')} FROM opitemrece oi JOIN doctor rdoc ON rdoc.code = oi.doctor WHERE oi.vn = o.vn AND ${validLicSql('rdoc.licenseno')} IS NOT NULL LIMIT 1),
  ''
) AS doctor_license`;

const RX_DATETIME_SUBQUERY = `COALESCE(
  DATE_FORMAT((SELECT MAX(CONCAT(oi.rxdate, ' ', oi.rxtime)) FROM opitemrece oi JOIN drugitems di ON di.icode = oi.icode WHERE oi.vn = o.vn AND oi.rxdate IS NOT NULL AND oi.rxtime IS NOT NULL), '%Y-%m-%d %H:%i:%s'),
  DATE_FORMAT((SELECT MAX(CONCAT(oi.rxdate, ' ', oi.rxtime)) FROM opitemrece oi WHERE oi.vn = o.vn AND oi.rxdate IS NOT NULL AND oi.rxtime IS NOT NULL), '%Y-%m-%d %H:%i:%s')
) AS rx_datetime`;

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
    ${DOCTOR_LICENSE_SUBQUERY},
    COALESCE(
      NULLIF(SUBSTRING_INDEX(TRIM(REPLACE(REPLACE(COALESCE(v.debt_id_list, ''), '"', ''), "'", '')), ',', 1), ''),
      NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(TRIM(REPLACE(REPLACE(COALESCE(v.rcpno_list, ''), '"', ''), "'", '')), ',', 1), '#', 1), ''),
      o.vn
    ) AS invoice_no,
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
    DATE_FORMAT((SELECT MAX(CONCAT(pd.outdate, ' ', pd.outtime)) FROM ptdepart pd WHERE pd.vn = o.vn AND COALESCE(pd.outdepcode, '') <> ''), '%Y-%m-%d %H:%i:%s') AS end_datetime,
    ${RX_DATETIME_SUBQUERY}
  FROM ovst o
  JOIN patient pt ON pt.hn = o.hn
  LEFT JOIN ptcardno pc ON pc.hn = pt.hn AND pc.cardtype = '02'
  JOIN pttype ptt ON ptt.pttype = o.pttype
  LEFT JOIN vn_stat v ON v.vn = o.vn
  LEFT JOIN spclty sp ON sp.spclty = o.spclty
  LEFT JOIN ovstost ost ON ost.ovstost = o.ovstost
  LEFT JOIN doctor doc ON doc.code = o.doctor
  LEFT JOIN doctor dxdoc ON dxdoc.code = v.dx_doctor
  WHERE o.vstdate BETWEEN ? AND ?
    AND COALESCE(o.an, '') = ''
    AND (ptt.hipdata_code IN ('SSS','SSI','SS') OR ptt.pcode = 'A7' OR (ptt.name LIKE '%ประกันสังคม%' AND COALESCE(ptt.hipdata_code,'') <> 'A9'))
    ${networkType === 'IN' ? "AND NOT (o.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%')" : ''}
    ${networkType === 'OUT' ? "AND (o.pttype IN ('32','35') OR ptt.name LIKE '%นอกเครือข่าย%')" : ''}
  ORDER BY o.vstdate DESC, o.vsttime DESC, o.vn DESC
`;

export type SssExportStatus = 'UNSENT' | 'SENT' | 'PASSED' | 'ERROR';

export const getSssCandidates = async (options: SssCandidateOptions): Promise<SssCandidate[]> => {
  const connection = await getUTFConnection();
  const repConn = await getRepstmConnection();
  try {
    await ensureSssImportTables(repConn);
    const networkType = options.networkType || 'ALL';
    const [rows] = await connection.query(buildSssCandidateSql(networkType), [options.startDate, options.endDate]);
    const list = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];

    // Look up export log, import response status, and saved overrides in repstminv
    const vnList = list.map((r) => text(r.vn)).filter(Boolean);
    const invList = list.map((r) => cleanSssInvoiceNo(r.invoice_no, r.vn)).filter(Boolean);
    const exportMap = new Map<string, { batch_no: number; invoice_no: string; tflag: string; exported_at: string }>();
    const importMap = new Map<string, { status_code: string; check_code: string }>();
    const overrideMap = new Map<string, Record<string, unknown>>();

    if (vnList.length > 0) {
      const vnPlaceholders = vnList.map(() => '?').join(',');
      const [expRows] = await repConn.query(
        `SELECT vn, invoice_no, batch_no, tflag, exported_at FROM sss_export_log WHERE claim_mode = 'OPD' AND vn IN (${vnPlaceholders}) ORDER BY id ASC`,
        vnList
      );
      if (Array.isArray(expRows)) {
        for (const er of expRows as Record<string, unknown>[]) {
          exportMap.set(text(er.vn), {
            batch_no: number(er.batch_no),
            invoice_no: text(er.invoice_no),
            tflag: text(er.tflag) || 'A',
            exported_at: text(er.exported_at),
          });
        }
      }

      const [ovRows] = await repConn.query(
        `SELECT * FROM sss_claim_override WHERE vn IN (${vnPlaceholders})`,
        vnList
      );
      if (Array.isArray(ovRows)) {
        for (const ov of ovRows as Record<string, unknown>[]) {
          overrideMap.set(text(ov.vn), ov);
        }
      }

      const invPlaceholders = invList.map(() => '?').join(',');
      const [impRows] = await repConn.query(
        `SELECT vn, invoice_no, status_code, check_code FROM sss_import_row WHERE vn IN (${vnPlaceholders}) ${invList.length ? `OR invoice_no IN (${invPlaceholders})` : ''} ORDER BY id ASC`,
        invList.length ? [...vnList, ...invList] : vnList
      );
      if (Array.isArray(impRows)) {
        for (const ir of impRows as Record<string, unknown>[]) {
          const keyVn = text(ir.vn);
          const keyInv = text(ir.invoice_no);
          const val = { status_code: text(ir.status_code).toUpperCase(), check_code: text(ir.check_code) };
          if (keyVn) importMap.set(`VN:${keyVn}`, val);
          if (keyInv) importMap.set(`INV:${keyInv}`, val);
        }
      }
    }

    return list.map((row) => {
      const vn = text(row.vn);
      const ov = overrideMap.get(vn);
      const merged: Record<string, unknown> = {
        ...row,
        ...(ov?.invoice_no ? { invoice_no: text(ov.invoice_no) } : {}),
        ...(ov?.clinic ? { clinic: text(ov.clinic) } : {}),
        ...(ov?.doctor_license ? { doctor_license: text(ov.doctor_license) } : {}),
        ...(ov?.hospmain ? { hospmain: text(ov.hospmain) } : {}),
        ...(ov?.pdx ? { pdx: text(ov.pdx) } : {}),
        ...(ov?.end_datetime ? { end_datetime: text(ov.end_datetime) } : {}),
      };

      const cleanInv = cleanSssInvoiceNo(merged.invoice_no, vn);
      const exp = exportMap.get(vn);
      const imp = importMap.get(`VN:${vn}`) || importMap.get(`INV:${cleanInv}`) || (exp?.invoice_no ? importMap.get(`INV:${exp.invoice_no}`) : undefined);

      let exportStatus: SssExportStatus = 'UNSENT';
      if (imp) {
        if (imp.status_code === 'A' && !imp.check_code) exportStatus = 'PASSED';
        else if (imp.status_code === 'C' || imp.status_code === 'R' || imp.check_code) exportStatus = 'ERROR';
        else exportStatus = 'SENT';
      } else if (exp) {
        exportStatus = 'SENT';
      }

      const issues = evaluateSssCandidate(merged);
      const hasError = issues.some((issue) => issue.severity === 'error');
      return {
        ...merged,
        vn,
        invoice_no: cleanInv,
        network_type: text(merged.network_type) === 'OUT' ? 'OUT' : 'IN',
        validation_status: hasError ? 'error' : issues.length ? 'warning' : 'ready',
        issues,
        export_status: exportStatus,
        last_batch_no: exp?.batch_no || null,
        last_error_code: imp?.check_code || '',
        has_override: Boolean(ov),
      } as SssCandidate;
    });
  } finally {
    connection.release();
    repConn.release();
  }
};

export const formatSssIsoDateTime = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const withChecksum = (document: string) => {
  const cp874Bytes = iconv.encode(document, 'cp874');
  const checksum = crypto.createHash('md5').update(cp874Bytes).digest('hex');
  return `${document}<?EndNote Checksum="${checksum}"?>`;
};

const xmlSection = (tag: string, body: string) => body ? `<${tag}>\r\n${body}\r\n</${tag}>` : `<${tag}>\r\n</${tag}>`;

export const claimDocument = (hcode: string, hospitalName: string, sessionNo: string, recordCount: number, sections: string, now = new Date(), tflag: 'A' | 'E' = 'A') => withChecksum(
  `<?xml version="1.0" encoding="windows-874"?>\r\n<ClaimRec System="OP" PayPlan="SS" Version="0.93" Prgs="FDHChecker" TFlag="${tflag}">\r\n` +
  `<Header>\r\n<HCODE>${xml(hcode)}</HCODE>\r\n<HNAME>${xml(hospitalName)}</HNAME>\r\n<DATETIME>${formatSssIsoDateTime(now)}</DATETIME>\r\n<SESSNO>${xml(sessionNo)}</SESSNO>\r\n<RECCOUNT>${recordCount}</RECCOUNT>\r\n</Header>\r\n` +
  `${sections}\r\n</ClaimRec>\r\n`
);

export interface SssBatchSettings {
  last_ssop_batch?: number;
  last_aipn_batch?: number;
}

export const getSssBatchSettings = async (): Promise<{ last_ssop_batch: number; last_aipn_batch: number }> => {
  try {
    const stored = await getAppSetting<SssBatchSettings>('sss_export_batch_settings');
    return {
      last_ssop_batch: Number(stored?.last_ssop_batch) || 1244,
      last_aipn_batch: Number(stored?.last_aipn_batch) || 10251,
    };
  } catch {
    return { last_ssop_batch: 1244, last_aipn_batch: 10251 };
  }
};

export const saveSssLastBatchNo = async (type: 'SSOP' | 'AIPN', batchNo: number) => {
  const current = await getSssBatchSettings();
  const updated: SssBatchSettings = {
    ...current,
    [type === 'SSOP' ? 'last_ssop_batch' : 'last_aipn_batch']: batchNo,
  };
  await setAppSetting('sss_export_batch_settings', updated);
  return updated;
};

export const updateSssBatchSettings = async (settings: Partial<SssBatchSettings>) => {
  const current = await getSssBatchSettings();
  const updated: SssBatchSettings = {
    ...current,
    ...(settings.last_ssop_batch != null ? { last_ssop_batch: Number(settings.last_ssop_batch) } : {}),
    ...(settings.last_aipn_batch != null ? { last_aipn_batch: Number(settings.last_aipn_batch) } : {}),
  };
  await setAppSetting('sss_export_batch_settings', updated);
  return updated;
};

export const formatSssTimestamp = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
};

export interface SssExportZipOptions extends SssCandidateOptions {
  vns: string[];
  hcode: string;
  hospitalName: string;
  batchNo?: number | string;
  tflag?: 'A' | 'E';
  exportedBy?: string;
}

export const buildSssExportZip = async (options: SssExportZipOptions) => {
  if (!/^\d{5}$/.test(options.hcode) || options.hcode === '00000') throw new Error('HCODE หน่วยบริการไม่ถูกต้อง');
  const candidates = await getSssCandidates(options);
  const requested = new Set(options.vns.map(text).filter(Boolean));
  const selected = candidates.filter((row) => requested.has(row.vn));
  if (selected.length !== requested.size) throw new Error('มีบาง VN ไม่อยู่ในสิทธิ์/เครือข่าย/ช่วงวันที่ที่เลือก กรุณาดึงข้อมูลใหม่');
  const blocked = selected.filter((row) => row.validation_status === 'error');
  if (blocked.length > 0) {
    const details = blocked
      .slice(0, 5)
      .map((row) => {
        const errs = row.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`).join(', ');
        return `VN ${row.vn} (HN ${text(row.hn)}): ${errs}`;
      })
      .join(' | ');
    throw new Error(`มี ${blocked.length} รายการที่ยังติด Error และไม่สามารถส่งออกได้: ${details}${blocked.length > 5 ? ' ...' : ''}`);
  }

  const connection = await getUTFConnection();
  try {
    const placeholders = selected.map(() => '?').join(',');
    const [chargeRows] = await connection.query(
      `SELECT oi.vn, oi.icode, oi.qty, oi.unitprice, oi.sum_price, oi.paidst,
              COALESCE(g.cscd_group, '') AS bill_group, COALESCE(sd.nhso_adp_code, '') AS standard_code,
              COALESCE(NULLIF(TRIM(sd.tpu_code_list), ''), NULLIF(TRIM(di.tmt_tp_code), ''), '') AS tmt_code,
              COALESCE(sd.name, oi.icode) AS item_name,
              COALESCE(NULLIF(TRIM(du.name1), ''), NULLIF(TRIM(du.shortlist), ''), NULLIF(TRIM(oi.drugusage), ''), NULLIF(TRIM(oi.sp_use), ''), 'ใช้ตามแพทย์สั่ง') AS drug_usage,
              CASE WHEN di.icode IS NULL THEN 0 ELSE 1 END AS is_drug
       FROM opitemrece oi
       LEFT JOIN income inc ON inc.income = oi.income
       LEFT JOIN income_report2 g ON g.group_id = inc.group2
       LEFT JOIN s_drugitems sd ON sd.icode = oi.icode
       LEFT JOIN drugitems di ON di.icode = oi.icode
       LEFT JOIN drugusage du ON du.drugusage = oi.drugusage
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
    const batchConfig = await getSssBatchSettings();
    const rawBatch = options.batchNo != null && String(options.batchNo).trim() !== ''
      ? Number(options.batchNo)
      : (batchConfig.last_ssop_batch + 1);
    const numericBatch = Number.isFinite(rawBatch) && rawBatch > 0 ? rawBatch : (batchConfig.last_ssop_batch + 1);
    const sessionNo = String(numericBatch).padStart(4, '0');

    const usedInvNos = new Set<string>();
    const invNoMap = new Map<string, string>();
    selected.forEach((row) => {
      const vnStr = text(row.vn);
      let inv = cleanSssInvoiceNo(row.invoice_no, vnStr);
      if (usedInvNos.has(inv)) {
        inv = vnStr;
      }
      if (usedInvNos.has(inv)) {
        inv = `${vnStr}_${usedInvNos.size + 1}`;
      }
      usedInvNos.add(inv);
      invNoMap.set(vnStr, inv);
    });

    const billTran = selected.map((row) => {
      const vnStr = text(row.vn);
      const invNo = invNoMap.get(vnStr) || vnStr;
      const claimAmount = Math.max(0, number(row.income) - number(row.paid_money));
      return pipeRow(['01', '', `${row.service_date}T${row.service_time}`, options.hcode, invNo,
        invNo, row.hn, '', money(row.income), money(row.paid_money), '', 'A', row.cid,
        row.patient_name, row.hospmain, '80', money(claimAmount), '', '0.00']);
    }).join('\r\n');
    const billItems = selected.flatMap((row) => {
      const vnStr = text(row.vn);
      const invNo = invNoMap.get(vnStr) || vnStr;
      return (chargeMap.get(row.vn) || []).map((item) => {
        const claim = ['01', '03'].includes(text(item.paidst)) ? 0 : number(item.sum_price);
        return pipeRow([invNo, row.service_date, item.bill_group, item.icode,
          item.standard_code || item.tmt_code, item.item_name, item.qty, money(item.unitprice), money(item.sum_price),
          money(claim > 0 ? item.unitprice : 0), money(claim), row.vn, 'OP1']);
      });
    }).join('\r\n');
    const isBillDrugItem = (item: Record<string, unknown>) => ['3', '5'].includes(text(item.bill_group));

    const dispensing = selected.map((row) => {
      const items = (chargeMap.get(row.vn) || []).filter(isBillDrugItem);
      if (!items.length) return '';
      const vnStr = text(row.vn);
      const invNo = invNoMap.get(vnStr) || vnStr;
      const charge = items.reduce((sum, item) => sum + number(item.sum_price), 0);
      const paid = items.filter((item) => ['01', '03'].includes(text(item.paidst))).reduce((sum, item) => sum + number(item.sum_price), 0);
      const docLic = normalizeSssDoctorLicense(row.doctor_license, DEFAULT_SSS_DOCTOR_LICENSE);
      return pipeRow([options.hcode, row.vn, invNo, row.hn, row.cid,
        `${row.service_date} ${row.service_time}`, `${row.service_date} ${row.service_time}`, docLic,
        items.length, money(charge), money(charge - paid), money(paid), '0.00', 'HP', 'SS', '1', row.vn, '']);
    }).filter(Boolean).join('\r\n');
    const dispensedItems = selected.flatMap((row) => (chargeMap.get(row.vn) || []).filter(isBillDrugItem).map((item) => {
      const { prdCat, tmtId } = resolveSssDrugCategoryAndTmt(item.tmt_code, item.standard_code);
      const sigText = text(item.drug_usage) || 'ใช้ตามแพทย์สั่ง';
      return pipeRow([
        row.vn, prdCat, item.icode, tmtId, '', item.item_name, '-', sigText,
        sigText, item.qty, money(item.unitprice), money(item.sum_price), money(item.unitprice), money(item.sum_price),
        '', 'OD', 'OP1', '', '',
      ]);
    })).join('\r\n');
    const services = selected.map((row) => {
      const vnStr = text(row.vn);
      const invNo = invNoMap.get(vnStr) || vnStr;
      const docLic = normalizeSssDoctorLicense(row.doctor_license, DEFAULT_SSS_DOCTOR_LICENSE);
      const clinicCode = normalizeSssClinic(row.clinic);
      const endDt = normalizeSssEndDateTime(text(row.service_date), text(row.service_time), row.end_datetime, row.rx_datetime);
      return pipeRow([invNo, row.vn, 'EC', options.hcode, row.hn,
        row.cid, '1', '01', '9', '9', '', docLic, clinicCode, `${row.service_date}T${row.service_time}`,
        endDt, '', '', '', '0.00', 'Y', '', 'OP1']);
    }).join('\r\n');
    const opdDx = selected.flatMap((row) => {
      const rawDiags = diagMap.get(row.vn) || [];
      const validDiags: Array<{ diagtype?: unknown; cleanIcd: string }> = rawDiags
        .map((diag) => ({ diagtype: diag.diagtype, cleanIcd: normalizeSssIcd10(diag.icd10) }))
        .filter((diag) => Boolean(diag.cleanIcd));
      if (!validDiags.length && text(row.pdx)) {
        const cleanPdx = normalizeSssIcd10(row.pdx);
        if (cleanPdx) validDiags.push({ diagtype: '1', cleanIcd: cleanPdx });
      }
      return validDiags.map((diag) => pipeRow([
        'EC', row.vn, diag.diagtype || '1', 'IT', diag.cleanIcd, '',
      ]));
    }).join('\r\n');

    const tflag: 'A' | 'E' = options.tflag === 'E' ? 'E' : 'A';
    const now = new Date();
    const files = [
      ['BillTran.txt', claimDocument(options.hcode, options.hospitalName, sessionNo, selected.length, `${xmlSection('BILLTRAN', billTran)}\r\n${xmlSection('BillItems', billItems)}`, now, tflag)],
      ['BillDisp.txt', claimDocument(options.hcode, options.hospitalName, sessionNo, dispensing ? dispensing.split('\r\n').length : 0, `${xmlSection('Dispensing', dispensing)}\r\n${xmlSection('DispensedItems', dispensedItems)}`, now, tflag)],
      ['OPServices.txt', claimDocument(options.hcode, options.hospitalName, sessionNo, selected.length, `${xmlSection('OPServices', services)}\r\n${xmlSection('OPDx', opdDx)}`, now, tflag)],
    ] as const;
    const zip = new AdmZip();
    files.forEach(([filename, content]) => zip.addFile(filename, iconv.encode(content, 'cp874')));
    const dateStamp = formatSssTimestamp(now);
    const filename = `${options.hcode}_SSOPBIL_${sessionNo}_01_${dateStamp}.ZIP`;
    await saveSssLastBatchNo('SSOP', numericBatch);

    // Record exported VNs in sss_export_log to prevent duplicate re-export
    const repConn = await getRepstmConnection();
    try {
      await ensureSssImportTables(repConn);
      for (const row of selected) {
        const vnStr = text(row.vn);
        const invNo = invNoMap.get(vnStr) || vnStr;
        await repConn.query(
          `INSERT INTO sss_export_log (claim_mode, vn, hn, invoice_no, batch_no, tflag, filename, exported_by) VALUES ('OPD', ?, ?, ?, ?, ?, ?, ?)`,
          [vnStr, text(row.hn) || null, invNo, numericBatch, tflag, filename, options.exportedBy || null]
        );
        await repConn.query(`UPDATE sss_claim_override SET resolved_flag = 1 WHERE vn = ?`, [vnStr]);
      }
    } finally {
      repConn.release();
    }

    return {
      buffer: zip.toBuffer(),
      filename,
      summary: { visitCount: selected.length, chargeCount: charges.length, diagnosisCount: diagnoses.length, batchNo: numericBatch, tflag },
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

export interface SssErrorCaseRow {
  import_row_id: number;
  batch_id: number;
  source_filename: string;
  imported_at: string;
  status_code: string;
  check_code: string;
  is_warning_only: boolean;
  error_explanations: string[];
  import_invoice_no: string;
  import_cid: string;
  import_service_datetime: string;
  import_hmain: string;
  import_amount: number;
  import_claim_amount: number;
  vn: string;
  hn: string;
  patient_name: string;
  service_date: string;
  service_time: string;
  clinic: string;
  doctor_license: string;
  hospmain: string;
  pdx: string;
  end_datetime: string;
  rx_datetime?: string;
  invoice_no: string;
  tflag: 'A' | 'E';
  has_override: boolean;
  resolved_flag: boolean;
  last_resubmitted_batch: number | null;
  note: string;
  local_errors: string[];
}

const parseThaiDateStr = (raw: string): string | null => {
  // Supports "30/10/2569 13:14" or "2026-10-30T13:14:00"
  const mThai = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mThai) {
    const dd = mThai[1].padStart(2, '0');
    const mm = mThai[2].padStart(2, '0');
    let yyyy = Number(mThai[3]);
    if (yyyy > 2400) yyyy -= 543;
    return `${yyyy}-${mm}-${dd}`;
  }
  const mIso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return mIso ? `${mIso[1]}-${mIso[2]}-${mIso[3]}` : null;
};

export const getSssErrorCases = async (batchId?: number): Promise<SssErrorCaseRow[]> => {
  const repConn = await getRepstmConnection();
  const hosConn = await getUTFConnection();
  try {
    await ensureSssImportTables(repConn);
    const params: unknown[] = [];
    const whereBatch = batchId ? 'AND r.batch_id = ?' : '';
    if (batchId) params.push(batchId);

    const [errRowsRaw] = await repConn.query(
      `SELECT r.id AS import_row_id, r.batch_id, b.source_filename, b.created_at AS imported_at,
              r.status_code, r.check_code, r.invoice_no AS import_invoice_no, r.hn AS import_hn,
              r.vn AS import_vn, r.cid AS import_cid, r.service_datetime AS import_service_datetime,
              r.hmain AS import_hmain, r.amount AS import_amount, r.claim_amount AS import_claim_amount
       FROM sss_import_row r
       JOIN sss_import_batch b ON b.id = r.batch_id
       WHERE (COALESCE(r.check_code, '') <> '' OR COALESCE(r.status_code, '') IN ('C', 'D', 'R'))
       ${whereBatch}
       ORDER BY r.batch_id DESC, r.row_no ASC
       LIMIT 500`,
      params,
    );
    const errRows = Array.isArray(errRowsRaw) ? (errRowsRaw as Record<string, unknown>[]) : [];
    if (!errRows.length) return [];

    // Resolve VNs from sss_export_log or direct VN or CID+Date
    const invNos = errRows.map((r) => text(r.import_invoice_no)).filter(Boolean);
    const invToVnMap = new Map<string, string>();
    if (invNos.length) {
      const [expLogs] = await repConn.query(
        `SELECT invoice_no, vn FROM sss_export_log WHERE invoice_no IN (${invNos.map(() => '?').join(',')}) ORDER BY id DESC`,
        invNos,
      );
      if (Array.isArray(expLogs)) {
        for (const l of expLogs as Record<string, unknown>[]) {
          const inv = text(l.invoice_no);
          if (inv && !invToVnMap.has(inv)) invToVnMap.set(inv, text(l.vn));
        }
      }
    }

    const resolvedVns = new Map<number, string>();
    for (const r of errRows) {
      const rowId = number(r.import_row_id);
      const directVn = text(r.import_vn);
      const inv = text(r.import_invoice_no) || (!/^\d{12}$/.test(directVn) ? directVn : '');
      if (/^\d{12}$/.test(directVn)) {
        resolvedVns.set(rowId, directVn);
      } else if (inv && invToVnMap.has(inv)) {
        resolvedVns.set(rowId, invToVnMap.get(inv)!);
      } else if (/^\d{12}$/.test(inv)) {
        resolvedVns.set(rowId, inv);
      } else {
        // Fallback: lookup HOSxP by debt_id_list or CID + Date
        const cid = text(r.import_cid);
        const dtStr = parseThaiDateStr(text(r.import_service_datetime));
        if (inv) {
          const [vRows] = await hosConn.query(
            `SELECT vn FROM vn_stat WHERE debt_id_list = ? OR FIND_IN_SET(?, debt_id_list) > 0 LIMIT 1`,
            [inv, inv],
          );
          if (Array.isArray(vRows) && vRows.length) {
            resolvedVns.set(rowId, text((vRows[0] as Record<string, unknown>).vn));
            continue;
          }
        }
        if (cid && dtStr) {
          const [oRows] = await hosConn.query(
            `SELECT o.vn FROM ovst o JOIN patient pt ON pt.hn = o.hn WHERE pt.cid = ? AND o.vstdate = ? LIMIT 1`,
            [cid, dtStr],
          );
          if (Array.isArray(oRows) && oRows.length) {
            resolvedVns.set(rowId, text((oRows[0] as Record<string, unknown>).vn));
          }
        }
      }
    }

    const allVns = Array.from(new Set(Array.from(resolvedVns.values()).filter(Boolean)));
    const hosMap = new Map<string, Record<string, unknown>>();
    const ovMap = new Map<string, Record<string, unknown>>();
    const resubMap = new Map<string, { batch_no: number; exported_at: string }>();

    if (allVns.length) {
      const ph = allVns.map(() => '?').join(',');
      const [hosRows] = await hosConn.query(
        `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
                TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time,
                CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
                COALESCE(NULLIF(pt.cid, ''), '') AS cid,
                ROUND(COALESCE(v.income, 0), 2) AS income,
                COALESCE(ost.name, '') AS visit_outcome,
                COALESCE(v.hospmain, '') AS hospmain,
                COALESCE(sp.nhso_code, '') AS clinic,
                COALESCE(v.pdx, '') AS pdx,
                ${DOCTOR_LICENSE_SUBQUERY},
                COALESCE(
                  NULLIF(SUBSTRING_INDEX(TRIM(REPLACE(REPLACE(COALESCE(v.debt_id_list, ''), '"', ''), "'", '')), ',', 1), ''),
                  NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(TRIM(REPLACE(REPLACE(COALESCE(v.rcpno_list, ''), '"', ''), "'", '')), ',', 1), '#', 1), ''),
                  o.vn
                ) AS invoice_no,
                DATE_FORMAT((SELECT MAX(CONCAT(pd.outdate, ' ', pd.outtime)) FROM ptdepart pd WHERE pd.vn = o.vn AND COALESCE(pd.outdepcode, '') <> ''), '%Y-%m-%d %H:%i:%s') AS end_datetime,
                ${RX_DATETIME_SUBQUERY}
         FROM ovst o
         JOIN patient pt ON pt.hn = o.hn
         LEFT JOIN vn_stat v ON v.vn = o.vn
         LEFT JOIN spclty sp ON sp.spclty = o.spclty
         LEFT JOIN ovstost ost ON ost.ovstost = o.ovstost
         LEFT JOIN doctor doc ON doc.code = o.doctor
         LEFT JOIN doctor dxdoc ON dxdoc.code = v.dx_doctor
         WHERE o.vn IN (${ph})`,
        allVns,
      );
      if (Array.isArray(hosRows)) {
        for (const hr of hosRows as Record<string, unknown>[]) {
          hosMap.set(text(hr.vn), hr);
        }
      }

      const [ovRows] = await repConn.query(`SELECT * FROM sss_claim_override WHERE vn IN (${ph})`, allVns);
      if (Array.isArray(ovRows)) {
        for (const ov of ovRows as Record<string, unknown>[]) {
          ovMap.set(text(ov.vn), ov);
        }
      }

      const [expRows] = await repConn.query(
        `SELECT vn, batch_no, exported_at FROM sss_export_log WHERE vn IN (${ph}) ORDER BY id ASC`,
        allVns,
      );
      if (Array.isArray(expRows)) {
        for (const er of expRows as Record<string, unknown>[]) {
          resubMap.set(text(er.vn), { batch_no: number(er.batch_no), exported_at: text(er.exported_at) });
        }
      }
    }

    return errRows.map((r) => {
      const rowId = number(r.import_row_id);
      const vn = resolvedVns.get(rowId) || '';
      const hos = hosMap.get(vn) || {};
      const ov = ovMap.get(vn);
      const resub = resubMap.get(vn);
      const importedAtMs = new Date(String(r.imported_at || 0)).getTime();
      const resubAtMs = resub ? new Date(resub.exported_at).getTime() : 0;
      const isResubmittedAfterImport = Boolean(resub && resubAtMs > importedAtMs);

      const checkCode = text(r.check_code);
      const statusCode = text(r.status_code).toUpperCase();
      const effClinic = text(ov?.clinic) || text(hos.clinic) || '01';
      const effHospmain = text(ov?.hospmain) || text(hos.hospmain) || text(r.import_hmain);
      const effPdx = text(ov?.pdx) || text(hos.pdx);
      const effCid = text(hos.cid) || text(r.import_cid);
      const effIncome = number(hos.income);
      const localErrors: string[] = [];
      if (!/^\d{13}$/.test(effCid)) localErrors.push('ไม่มีเลขบัตรประชาชน 13 หลัก (SSS-PAT01)');
      if (!effPdx) localErrors.push('ไม่มี PDX (SSS-DX01)');
      if (!/^(0[1-9]|1[0-2]|99)$/.test(effClinic)) localErrors.push('รหัสคลินิกไม่ตรง 01-12/99 (SSS-SVC01)');
      if (!effHospmain) localErrors.push('ไม่มี HospMain (SSS-INS01)');
      if (hos.vn && effIncome <= 0) localErrors.push('ค่าใช้จ่ายเป็นศูนย์ (SSS-CHG01)');
      if (/ADMIT/i.test(text(hos.visit_outcome))) localErrors.push('ผลการรักษา Admit (SSS-VIS02)');

      return {
        import_row_id: rowId,
        batch_id: number(r.batch_id),
        source_filename: text(r.source_filename),
        imported_at: text(r.imported_at),
        status_code: statusCode,
        check_code: checkCode,
        is_warning_only: statusCode === 'A',
        error_explanations: explainSssCheckCode(checkCode),
        import_invoice_no: text(r.import_invoice_no),
        import_cid: text(r.import_cid),
        import_service_datetime: text(r.import_service_datetime),
        import_hmain: text(r.import_hmain),
        import_amount: number(r.import_amount),
        import_claim_amount: number(r.import_claim_amount),
        vn,
        hn: text(hos.hn) || text(r.import_hn),
        patient_name: text(hos.patient_name),
        service_date: text(hos.service_date) || (parseThaiDateStr(text(r.import_service_datetime)) || ''),
        service_time: text(hos.service_time),
        clinic: effClinic,
        doctor_license: text(ov?.doctor_license) || text(hos.doctor_license),
        hospmain: effHospmain,
        pdx: effPdx,
        end_datetime: text(ov?.end_datetime) || text(hos.end_datetime),
        rx_datetime: text(hos.rx_datetime),
        invoice_no: text(ov?.invoice_no) || text(r.import_invoice_no) || text(hos.invoice_no) || vn,
        tflag: (text(ov?.tflag) === 'A' ? 'A' : 'E') as 'A' | 'E',
        has_override: Boolean(ov),
        resolved_flag: Boolean(ov?.resolved_flag) || isResubmittedAfterImport,
        last_resubmitted_batch: isResubmittedAfterImport ? (resub?.batch_no || null) : null,
        note: text(ov?.note),
        local_errors: localErrors,
      };
    }).sort((a, b) => {
      const aScore = (a.local_errors.length > 0 ? 0 : 1) * 10 + (a.is_warning_only ? 2 : 0) + (a.resolved_flag ? 1 : 0);
      const bScore = (b.local_errors.length > 0 ? 0 : 1) * 10 + (b.is_warning_only ? 2 : 0) + (b.resolved_flag ? 1 : 0);
      return aScore - bScore;
    });
  } finally {
    repConn.release();
    hosConn.release();
  }
};

export const saveSssClaimOverride = async (payload: {
  vn: string;
  invoice_no?: string;
  clinic?: string;
  doctor_license?: string;
  hospmain?: string;
  pdx?: string;
  end_datetime?: string;
  tflag?: 'A' | 'E';
  note?: string;
  updatedBy?: string;
}) => {
  const vn = text(payload.vn);
  if (!vn) throw new Error('กรุณาระบุ VN');
  const repConn = await getRepstmConnection();
  try {
    await ensureSssImportTables(repConn);
    await repConn.query(
      `INSERT INTO sss_claim_override (vn, invoice_no, clinic, doctor_license, hospmain, pdx, end_datetime, tflag, resolved_flag, note, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON DUPLICATE KEY UPDATE
         invoice_no = VALUES(invoice_no),
         clinic = VALUES(clinic),
         doctor_license = VALUES(doctor_license),
         hospmain = VALUES(hospmain),
         pdx = VALUES(pdx),
         end_datetime = VALUES(end_datetime),
         tflag = VALUES(tflag),
         resolved_flag = 0,
         note = VALUES(note),
         updated_by = VALUES(updated_by)`,
      [
        vn,
        text(payload.invoice_no) || null,
        text(payload.clinic) || null,
        text(payload.doctor_license) || null,
        text(payload.hospmain) || null,
        text(payload.pdx) || null,
        text(payload.end_datetime) || null,
        payload.tflag === 'A' ? 'A' : 'E',
        text(payload.note) || null,
        payload.updatedBy || 'Staff',
      ],
    );
    return { ok: true, vn };
  } finally {
    repConn.release();
  }
};

export const resubmitSssErrorCases = async (options: {
  vns: string[];
  hcode: string;
  hospitalName: string;
  batchNo?: number | string;
  tflag?: 'A' | 'E';
  exportedBy?: string;
}) => {
  const cleanVns = Array.from(new Set(options.vns.map(text).filter(Boolean)));
  if (!cleanVns.length) throw new Error('กรุณาเลือกอย่างน้อย 1 รายการเพื่อส่งออกซ้ำ');

  const hosConn = await getUTFConnection();
  let startDate = '';
  let endDate = '';
  try {
    const ph = cleanVns.map(() => '?').join(',');
    const [rangeRows] = await hosConn.query(
      `SELECT DATE_FORMAT(MIN(vstdate), '%Y-%m-%d') AS min_date, DATE_FORMAT(MAX(vstdate), '%Y-%m-%d') AS max_date FROM ovst WHERE vn IN (${ph})`,
      cleanVns,
    );
    if (Array.isArray(rangeRows) && rangeRows.length) {
      const r = rangeRows[0] as Record<string, unknown>;
      startDate = text(r.min_date);
      endDate = text(r.max_date);
    }
  } finally {
    hosConn.release();
  }

  if (!startDate || !endDate) throw new Error('ไม่พบข้อมูลวันที่รับบริการของ VN ที่เลือกใน HOSxP');

  return buildSssExportZip({
    startDate,
    endDate,
    networkType: 'ALL',
    vns: cleanVns,
    hcode: options.hcode,
    hospitalName: options.hospitalName,
    batchNo: options.batchNo,
    tflag: options.tflag || 'E',
    exportedBy: options.exportedBy,
  });
};

export const autoFixSssErrorCases = async (batchId?: number, updatedBy = 'AutoFix') => {
  const cases = await getSssErrorCases(batchId);
  const targets = cases.filter((c) => !c.is_warning_only && !c.resolved_flag && Boolean(c.vn));
  let fixedCount = 0;
  let manualRequiredCount = 0;

  for (const row of targets) {
    const fixedDoc = normalizeSssDoctorLicense(row.doctor_license, DEFAULT_SSS_DOCTOR_LICENSE);
    const fixedClinic = normalizeSssClinic(row.clinic);
    const fixedEnd = normalizeSssEndDateTime(row.service_date, row.service_time, row.end_datetime, row.rx_datetime);
    const fixedPdx = normalizeSssIcd10(row.pdx) || row.pdx;
    const hasManualCode = /\b(C01|C03|C04)\b/i.test(row.check_code);

    if (hasManualCode) {
      manualRequiredCount += 1;
    } else {
      fixedCount += 1;
    }

    await saveSssClaimOverride({
      vn: row.vn,
      invoice_no: row.invoice_no,
      clinic: fixedClinic,
      doctor_license: fixedDoc,
      hospmain: row.hospmain,
      pdx: fixedPdx,
      end_datetime: fixedEnd.replace('T', ' '),
      tflag: 'E',
      note: hasManualCode
        ? `Auto-Fix รูปแบบข้อมูลแล้ว (ยังต้องตรวจ ${row.check_code} ด้วยตนเอง)`
        : `Auto-Fix อัตโนมัติ (${row.check_code || 'SSOP'})`,
      updatedBy,
    });
  }

  return {
    totalEvaluated: targets.length,
    fixedCount,
    manualRequiredCount,
  };
};

export const autoFixSssCandidates = async (options: {
  startDate: string;
  endDate: string;
  networkType?: SssNetworkType;
  vns?: string[];
  updatedBy?: string;
}) => {
  const candidates = await getSssCandidates({
    startDate: options.startDate,
    endDate: options.endDate,
    networkType: options.networkType || 'ALL',
  });
  const vnFilter = options.vns?.length ? new Set(options.vns.map((v) => v.trim()).filter(Boolean)) : null;
  const targets = candidates.filter((row) => (!vnFilter || vnFilter.has(row.vn)) && row.validation_status !== 'ready');

  let fixedCount = 0;
  let manualRequiredCount = 0;

  for (const row of targets) {
    const currentDoc = text(row.doctor_license);
    const fixedDoc = normalizeSssDoctorLicense(currentDoc, DEFAULT_SSS_DOCTOR_LICENSE);
    const fixedClinic = normalizeSssClinic(row.clinic);
    const fixedEnd = normalizeSssEndDateTime(text(row.service_date), text(row.service_time), row.end_datetime, row.rx_datetime);
    const fixedPdx = normalizeSssIcd10(row.pdx) || text(row.pdx);
    const fixedInv = cleanSssInvoiceNo(row.invoice_no, row.vn);

    const changed = (
      fixedClinic !== text(row.clinic) ||
      fixedDoc !== currentDoc ||
      fixedEnd.replace('T', ' ') !== text(row.end_datetime).replace('T', ' ') ||
      fixedPdx !== text(row.pdx) ||
      fixedInv !== text(row.invoice_no)
    );

    const hasUnfixableError = row.issues.some((iss) => iss.severity === 'error' && iss.code !== 'SSS-SVC01');

    if (!changed) {
      if (hasUnfixableError) manualRequiredCount += 1;
      continue;
    }

    if (hasUnfixableError) manualRequiredCount += 1;
    else fixedCount += 1;

    await saveSssClaimOverride({
      vn: row.vn,
      invoice_no: fixedInv,
      clinic: fixedClinic,
      doctor_license: fixedDoc,
      hospmain: text(row.hospmain) || undefined,
      pdx: fixedPdx || undefined,
      end_datetime: fixedEnd.replace('T', ' '),
      tflag: row.export_status === 'ERROR' ? 'E' : 'A',
      note: 'Auto-Fix ก่อนส่งออก SSOP',
      updatedBy: options.updatedBy || 'AutoFix',
    });
  }

  return {
    totalEvaluated: targets.length,
    fixedCount,
    manualRequiredCount,
  };
};

