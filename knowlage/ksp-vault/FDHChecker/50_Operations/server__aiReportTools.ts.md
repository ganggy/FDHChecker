---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/aiReportTools.ts"
source_hash: "10a10842feae96c11cf1b3cda91c43228423a06558a643bf09950e2f65fb2d1e"
managed_by: "sync-ksp-vault"
---
# aiReportTools.ts

> Source: `server/aiReportTools.ts`
> SHA-256: `10a10842feae96c11cf1b3cda91c43228423a06558a643bf09950e2f65fb2d1e`

````typescript
import { getDiagsAndProcedures, getUTFConnection, getVisitChargeItems } from './db.js';
import {
  buildReportAttachment,
  type ExportableReport,
  type ReportAttachment,
  type ReportFormat,
} from './aiReportExport.js';

export type OpdCountIntent = {
  kind: 'opd-count';
  dateStart: string;
  dateEnd: string;
  format?: ReportFormat;
};

export type OpdListIntent = {
  kind: 'opd-list';
  dateStart: string;
  dateEnd: string;
  format?: ReportFormat;
};

export type PatientLookupIntent = {
  kind: 'patient-lookup';
  identifierType: 'hn' | 'vn' | 'an' | 'cid' | 'name';
  identifier: string;
  countVisits?: boolean;
  topic?: 'labs' | 'medications' | 'appointments' | 'diagnoses';
  format?: ReportFormat;
};

export type VisitDetailIntent = {
  kind: 'visit-detail';
  vn: string;
  format?: ReportFormat;
};

export type PatientReportIntent =
  | OpdCountIntent
  | OpdListIntent
  | PatientLookupIntent
  | VisitDetailIntent;

type OpdCountResult = {
  dateStart: string;
  dateEnd: string;
  uniquePatients: number;
  visits: number;
};

export type PatientToolAnswer = {
  answer: string;
  report: {
    type: PatientReportIntent['kind'];
    source: 'HOSxP';
    dateStart?: string;
    dateEnd?: string;
    identifierType?: string;
    identifier?: string;
    totalRows?: number;
    returnedRows?: number;
    truncated?: boolean;
  };
  attachment?: ReportAttachment;
};

const MAX_EXPORT_ROWS = Math.min(5_000, Math.max(100, Number(process.env.AI_EXPORT_MAX_ROWS) || 2_000));

const bangkokIsoDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const validIsoDate = (year: number, month: number, day: number) => {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year
    || value.getUTCMonth() + 1 !== month
    || value.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00+07:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return bangkokIsoDate(value);
};

const extractDateRange = (question: string, now: Date) => {
  const today = bangkokIsoDate(now);
  if (/เดือนนี้/.test(question)) {
    return { dateStart: `${today.slice(0, 7)}-01`, dateEnd: today };
  }
  if (/เมื่อวาน/.test(question)) {
    const yesterday = addDays(today, -1);
    return { dateStart: yesterday, dateEnd: yesterday };
  }

  const dates: string[] = [];
  for (const match of question.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const parsed = validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (parsed) dates.push(parsed);
  }
  for (const match of question.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) {
    const suppliedYear = Number(match[3]);
    const parsed = validIsoDate(
      suppliedYear >= 2400 ? suppliedYear - 543 : suppliedYear,
      Number(match[2]),
      Number(match[1]),
    );
    if (parsed) dates.push(parsed);
  }
  if (dates.length) {
    const sorted = dates.sort();
    return { dateStart: sorted[0], dateEnd: sorted[sorted.length - 1] };
  }
  return { dateStart: today, dateEnd: today };
};

const requestedFormat = (question: string): ReportFormat | undefined => {
  if (/excel|xlsx|เอ็กเซล/.test(question)) return 'xlsx';
  if (/word|docx|เวิร์ด/.test(question)) return 'docx';
  if (/\bcsv\b/.test(question)) return 'csv';
  if (/\bjson\b/.test(question)) return 'json';
  if (/สร้างไฟล์|ส่งออก|ดาวน์โหลด/.test(question)) return 'xlsx';
  return undefined;
};

const labeledIdentifier = (question: string, label: string, length = '{4,20}') => {
  const match = question.match(new RegExp(`(?:^|\\s)(?:${label})\\s*[:#-]?\\s*([0-9]${length})(?=\\s|$|[,.?])`, 'i'));
  return match?.[1] || '';
};

export const parsePatientReportIntent = (
  question: string,
  now = new Date(),
): PatientReportIntent | null => {
  const normalized = question.trim().toLowerCase();
  const format = requestedFormat(normalized);
  const vn = labeledIdentifier(normalized, 'vn|วีเอ็น');
  const an = labeledIdentifier(normalized, 'an|เอเอ็น');
  const hn = labeledIdentifier(normalized, 'hn|เอชเอ็น');
  const cid = labeledIdentifier(normalized, 'cid|เลขบัตร|เลขประชาชน', '{13}');
  const formatOption = format ? { format } : {};
  const topic = /(?:ผล(?:ตรวจ)?(?:แล็บ|แลบ)|\blab\b)/.test(normalized)
    ? 'labs' as const
    : /ยา|เวชภัณฑ์|medication/.test(normalized)
      ? 'medications' as const
      : /นัด|appointment/.test(normalized)
        ? 'appointments' as const
        : /วินิจฉัย|โรค|diagnos/.test(normalized)
          ? 'diagnoses' as const
          : undefined;
  const topicOption = topic ? { topic } : {};

  if (vn && /วินิจฉัย|หัตถการ|ยา|ค่าใช้จ่าย|รายละเอียด|visit|ครั้งนี้/.test(normalized)) {
    return { kind: 'visit-detail', vn, ...formatOption };
  }
  if (vn) return { kind: 'patient-lookup', identifierType: 'vn', identifier: vn, ...topicOption, ...formatOption };
  if (an) return { kind: 'patient-lookup', identifierType: 'an', identifier: an, ...topicOption, ...formatOption };
  if (hn) return { kind: 'patient-lookup', identifierType: 'hn', identifier: hn, ...topicOption, ...formatOption };
  if (cid) return { kind: 'patient-lookup', identifierType: 'cid', identifier: cid, ...topicOption, ...formatOption };

  const asksVisitCount = /(?:เคย)?(?:มา|รับบริการ|รักษา|เข้าโรงพยาบาล).*?(?:กี่ครั้ง|กี่หน|จำนวนครั้ง)/.test(normalized);
  const directNameMatch = normalized.match(
    /^((?:(?:นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)\s*)?[ก-๙a-z]+\s+[ก-๙a-z]+)\s+(?:เคย)?(?:มา|รับบริการ|รักษา|เข้าโรงพยาบาล)/,
  );
  const labeledNameMatch = normalized.match(/(?:คนไข้ชื่อ|ผู้ป่วยชื่อ|ค้น(?:หา)?(?:คนไข้|ผู้ป่วย)?ชื่อ)\s*[:#-]?\s*([^\d,?]{2,60})/);
  const rawName = directNameMatch?.[1] || labeledNameMatch?.[1];
  if (rawName) {
    const identifier = rawName
      .replace(/\s+(?:เคย)?(?:มา|รับบริการ|รักษา|เข้าโรงพยาบาล).*$/u, '')
      .trim();
    return {
      kind: 'patient-lookup',
      identifierType: 'name',
      identifier,
      ...(asksVisitCount ? { countVisits: true } : {}),
      ...formatOption,
    };
  }

  const asksAboutOpd = /\bopd\b|ผู้ป่วยนอก|คนไข้นอก/.test(normalized);
  if (!asksAboutOpd) return null;
  const dateRange = extractDateRange(normalized, now);
  const asksForCount = /กี่คน|จำนวน|ยอดรวม|เท่าไหร่|เท่าไร/.test(normalized);
  const asksForRows = /รายชื่อ|รายการ|แสดง|ทั้งหมด|รายละเอียด|สร้างไฟล์|ส่งออก|ดาวน์โหลด/.test(normalized);
  if (asksForCount && !format && !/รายชื่อ|รายการ|แสดง/.test(normalized)) {
    return { kind: 'opd-count', ...dateRange };
  }
  if (asksForRows || format) return {
    kind: 'opd-list',
    ...dateRange,
    ...(format ? { format } : {}),
  };
  return null;
};

const thaiDate = (date: string) => new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  dateStyle: 'long',
}).format(new Date(`${date}T12:00:00+07:00`));

const rangeLabel = (start: string, end: string) => (
  start === end ? thaiDate(start) : `${thaiDate(start)} ถึง ${thaiDate(end)}`
);

export const getOpdCount = async (dateStart: string, dateEnd = dateStart): Promise<OpdCountResult> => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         COUNT(DISTINCT NULLIF(TRIM(hn), '')) AS unique_patients,
         COUNT(DISTINCT NULLIF(TRIM(vn), '')) AS visits
       FROM ovst
       WHERE vstdate BETWEEN ? AND ?`,
      [dateStart, dateEnd],
    );
    const row = (rows as Array<Record<string, unknown>>)[0] || {};
    return {
      dateStart,
      dateEnd,
      uniquePatients: Number(row.unique_patients || 0),
      visits: Number(row.visits || 0),
    };
  } finally {
    connection.release();
  }
};

export const formatOpdCountAnswer = (result: OpdCountResult) => {
  const label = rangeLabel(result.dateStart, result.dateEnd);
  if (!result.visits) return `ช่วงวันที่ ${label} ยังไม่พบผู้รับบริการ OPD ใน HOSxP`;
  if (result.uniquePatients === result.visits) {
    return `ช่วงวันที่ ${label} มีผู้รับบริการ OPD ${result.uniquePatients.toLocaleString('th-TH')} คน (${result.visits.toLocaleString('th-TH')} VN)`;
  }
  return `ช่วงวันที่ ${label} มีผู้รับบริการ OPD ${result.uniquePatients.toLocaleString('th-TH')} คน รวม ${result.visits.toLocaleString('th-TH')} ครั้งรับบริการ (VN)`;
};

const getOpdRows = async (dateStart: string, dateEnd: string) => {
  const connection = await getUTFConnection();
  try {
    const [countRows] = await connection.query(
      'SELECT COUNT(DISTINCT vn) AS total FROM ovst WHERE vstdate BETWEEN ? AND ?',
      [dateStart, dateEnd],
    );
    const total = Number((countRows as Array<Record<string, unknown>>)[0]?.total || 0);
    const [rows] = await connection.query(
      `SELECT
         DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
         TIME_FORMAT(o.vsttime, '%H:%i') AS serviceTime,
         o.hn,
         o.vn,
         COALESCE(o.an, '') AS an,
         CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
         CASE COALESCE(v.sex, p.sex) WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' ELSE '' END AS sex,
         COALESCE(v.age_y, TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate)) AS age,
         COALESCE(pt.name, '') AS fund,
         COALESCE(c.name, '') AS clinic,
         COALESCE((SELECT d.icd10 FROM ovstdiag d WHERE d.vn = o.vn AND d.diagtype = '1' LIMIT 1), '') AS mainDiag
       FROM ovst o
       LEFT JOIN patient p ON p.hn = o.hn
       LEFT JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       LEFT JOIN clinic c ON c.clinic = o.main_dep
       WHERE o.vstdate BETWEEN ? AND ?
       ORDER BY o.vstdate DESC, o.vsttime DESC
       LIMIT ?`,
      [dateStart, dateEnd, MAX_EXPORT_ROWS],
    );
    return { total, rows: rows as Array<Record<string, unknown>> };
  } finally {
    connection.release();
  }
};

const patientHnFromIdentifier = async (
  identifierType: PatientLookupIntent['identifierType'],
  identifier: string,
) => {
  const connection = await getUTFConnection();
  try {
    if (identifierType === 'hn') return identifier;
    if (identifierType === 'cid') {
      const [rows] = await connection.query('SELECT hn FROM patient WHERE cid = ? LIMIT 1', [identifier]);
      return String((rows as Array<Record<string, unknown>>)[0]?.hn || '');
    }
    if (identifierType === 'vn') {
      const [rows] = await connection.query('SELECT hn FROM ovst WHERE vn = ? LIMIT 1', [identifier]);
      return String((rows as Array<Record<string, unknown>>)[0]?.hn || '');
    }
    if (identifierType === 'an') {
      const [rows] = await connection.query('SELECT hn FROM ipt WHERE an = ? LIMIT 1', [identifier]);
      return String((rows as Array<Record<string, unknown>>)[0]?.hn || '');
    }
    return '';
  } finally {
    connection.release();
  }
};

const getPatientProfilesByName = async (name: string) => {
  const connection = await getUTFConnection();
  try {
    const terms = name.split(/\s+/).filter(Boolean).slice(0, 3);
    if (!terms.length) return [];
    const conditions = terms.map(() => `CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) LIKE ?`);
    const [rows] = await connection.query(
      `SELECT p.hn,
         CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
         DATE_FORMAT(p.birthday, '%Y-%m-%d') AS birthDate,
         CASE p.sex WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' ELSE '' END AS sex,
         p.cid
       FROM patient p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.hn
       LIMIT 20`,
      terms.map((term) => `%${term}%`),
    );
    return rows as Array<Record<string, unknown>>;
  } finally {
    connection.release();
  }
};

const getPatientVisitCounts = async (hns: string[]) => {
  if (!hns.length) return [];
  const connection = await getUTFConnection();
  try {
    const placeholders = hns.map(() => '?').join(', ');
    const [rows] = await connection.query(
      `SELECT p.hn,
         CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
         COUNT(DISTINCT NULLIF(o.vn, '')) AS visitCount,
         COUNT(DISTINCT NULLIF(i.an, '')) AS admissionCount,
         DATE_FORMAT(MIN(o.vstdate), '%Y-%m-%d') AS firstVisitDate,
         DATE_FORMAT(MAX(o.vstdate), '%Y-%m-%d') AS lastVisitDate
       FROM patient p
       LEFT JOIN ovst o ON o.hn = p.hn
       LEFT JOIN ipt i ON i.hn = p.hn
       WHERE p.hn IN (${placeholders})
       GROUP BY p.hn, p.pname, p.fname, p.lname
       ORDER BY patientName, p.hn`,
      hns,
    );
    return rows as Array<Record<string, unknown>>;
  } finally {
    connection.release();
  }
};

const getPatientProfileAndHistory = async (hn: string) => {
  const connection = await getUTFConnection();
  try {
    const [profileRows] = await connection.query(
      `SELECT p.hn,
         CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
         DATE_FORMAT(p.birthday, '%Y-%m-%d') AS birthDate,
         TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
         CASE p.sex WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' ELSE '' END AS sex,
         COALESCE(p.bloodgrp, '') AS bloodGroup,
         COALESCE(p.cid, '') AS cid,
         COALESCE(p.hometel, '') AS phone,
         COALESCE(p.drugallergy, '') AS drugAllergy
       FROM patient p
       WHERE p.hn = ?
       LIMIT 1`,
      [hn],
    );
    const profile = (profileRows as Array<Record<string, unknown>>)[0] || null;
    if (!profile) return null;

    const [visitRows] = await connection.query(
      `SELECT DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
         TIME_FORMAT(o.vsttime, '%H:%i') AS serviceTime,
         o.vn,
         COALESCE(o.an, '') AS an,
         COALESCE(pt.name, '') AS fund,
         COALESCE(c.name, '') AS clinic,
         COALESCE((SELECT d.icd10 FROM ovstdiag d WHERE d.vn = o.vn AND d.diagtype = '1' LIMIT 1), '') AS mainDiag
       FROM ovst o
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       LEFT JOIN clinic c ON c.clinic = o.main_dep
       WHERE o.hn = ?
       ORDER BY o.vstdate DESC, o.vsttime DESC
       LIMIT 20`,
      [hn],
    );
    const [admissionRows] = await connection.query(
      `SELECT i.an, DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admitDate,
         DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dischargeDate,
         COALESCE(w.name, '') AS ward, COALESCE(a.pdx, a.dx0, '') AS primaryDiagnosis
       FROM ipt i
       LEFT JOIN an_stat a ON a.an = i.an
       LEFT JOIN ward w ON w.ward = i.ward
       WHERE i.hn = ?
       ORDER BY i.regdate DESC
       LIMIT 10`,
      [hn],
    );
    return {
      profile,
      visits: visitRows as Array<Record<string, unknown>>,
      admissions: admissionRows as Array<Record<string, unknown>>,
    };
  } finally {
    connection.release();
  }
};

const getPatientLabs = async (hn: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT DATE_FORMAT(h.order_date, '%Y-%m-%d') AS serviceDate,
         h.vn,
         i.lab_items_name AS labName,
         COALESCE(o.lab_order_result, '') AS result,
         COALESCE(i.lab_items_normal_value, '') AS normalValue
       FROM lab_head h
       JOIN lab_order o ON o.lab_order_number = h.lab_order_number
       JOIN lab_items i ON i.lab_items_code = o.lab_items_code
       WHERE h.hn = ?
       ORDER BY h.order_date DESC, h.lab_order_number DESC
       LIMIT 50`,
      [hn],
    );
    return rows as Array<Record<string, unknown>>;
  } finally {
    connection.release();
  }
};

const getPatientMedications = async (hn: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS serviceDate,
         o.vn, o.icode,
         COALESCE(NULLIF(sd.name, ''), NULLIF(d.name, ''), o.icode) AS drugName,
         COALESCE(o.qty, 0) AS qty,
         COALESCE(o.unitprice, 0) AS unitPrice,
         COALESCE(o.sum_price, o.qty * o.unitprice, 0) AS price
       FROM opitemrece o
       JOIN ovst v ON v.vn = o.vn
       LEFT JOIN drugitems d ON d.icode = o.icode
       LEFT JOIN s_drugitems sd ON sd.icode = o.icode
       WHERE v.hn = ?
         AND (d.icode IS NOT NULL OR sd.icode IS NOT NULL)
       ORDER BY v.vstdate DESC, o.vn DESC
       LIMIT 50`,
      [hn],
    );
    return rows as Array<Record<string, unknown>>;
  } finally {
    connection.release();
  }
};

const getPatientAppointments = async (hn: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT DATE_FORMAT(a.nextdate, '%Y-%m-%d') AS appointmentDate,
         COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '') AS appointmentTime,
         COALESCE(c.name, '') AS clinic,
         COALESCE(k.department, '') AS department,
         COALESCE(a.app_cause, '') AS appointmentCause
       FROM oapp a
       LEFT JOIN clinic c ON c.clinic = a.clinic
       LEFT JOIN kskdepartment k ON k.depcode = a.depcode
       WHERE a.hn = ? AND COALESCE(a.oapp_status_id, 1) <> 4
       ORDER BY a.nextdate DESC, a.nexttime DESC
       LIMIT 30`,
      [hn],
    );
    return rows as Array<Record<string, unknown>>;
  } finally {
    connection.release();
  }
};

const getVisitHeader = async (vn: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT o.hn, o.vn, COALESCE(o.an, '') AS an,
         DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
         TIME_FORMAT(o.vsttime, '%H:%i') AS serviceTime,
         CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
         COALESCE(pt.name, '') AS fund, COALESCE(c.name, '') AS clinic
       FROM ovst o
       LEFT JOIN patient p ON p.hn = o.hn
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       LEFT JOIN clinic c ON c.clinic = o.main_dep
       WHERE o.vn = ?
       LIMIT 1`,
      [vn],
    );
    return (rows as Array<Record<string, unknown>>)[0] || null;
  } finally {
    connection.release();
  }
};

const opdReport = (
  title: string,
  subtitle: string,
  rows: Array<Record<string, unknown>>,
  metadata: ExportableReport['metadata'],
): ExportableReport => ({
  title,
  subtitle,
  metadata,
  columns: [
    { key: 'serviceDate', label: 'วันที่', width: 12 },
    { key: 'serviceTime', label: 'เวลา', width: 8 },
    { key: 'hn', label: 'HN', width: 12 },
    { key: 'vn', label: 'VN', width: 14 },
    { key: 'patientName', label: 'ชื่อผู้ป่วย', width: 28 },
    { key: 'sex', label: 'เพศ', width: 8 },
    { key: 'age', label: 'อายุ', width: 8 },
    { key: 'fund', label: 'สิทธิ', width: 24 },
    { key: 'clinic', label: 'คลินิก', width: 22 },
    { key: 'mainDiag', label: 'วินิจฉัยหลัก', width: 14 },
  ],
  rows,
});

const patientReport = (
  title: string,
  rows: Array<Record<string, unknown>>,
): ExportableReport => ({
  title,
  subtitle: 'ข้อมูลผู้ป่วยและประวัติรับบริการจาก HOSxP',
  columns: [
    { key: 'serviceDate', label: 'วันที่', width: 12 },
    { key: 'serviceTime', label: 'เวลา', width: 8 },
    { key: 'hn', label: 'HN', width: 12 },
    { key: 'vn', label: 'VN', width: 14 },
    { key: 'an', label: 'AN', width: 14 },
    { key: 'patientName', label: 'ชื่อผู้ป่วย', width: 28 },
    { key: 'fund', label: 'สิทธิ', width: 24 },
    { key: 'clinic', label: 'คลินิก/หอผู้ป่วย', width: 22 },
    { key: 'mainDiag', label: 'วินิจฉัยหลัก', width: 14 },
  ],
  rows,
  wordColumnKeys: ['serviceDate', 'hn', 'vn', 'patientName', 'fund', 'clinic', 'mainDiag'],
});

const patientTopicReport = (
  topic: NonNullable<PatientLookupIntent['topic']>,
  hn: string,
  patientName: string,
  rows: Array<Record<string, unknown>>,
): ExportableReport => {
  const definitions: Record<NonNullable<PatientLookupIntent['topic']>, {
    title: string;
    columns: ExportableReport['columns'];
    wordColumnKeys: string[];
  }> = {
    labs: {
      title: `ผลตรวจทางห้องปฏิบัติการ HN ${hn}`,
      columns: [
        { key: 'serviceDate', label: 'วันที่', width: 12 },
        { key: 'vn', label: 'VN', width: 14 },
        { key: 'labName', label: 'รายการตรวจ', width: 30 },
        { key: 'result', label: 'ผลตรวจ', width: 18 },
        { key: 'normalValue', label: 'ค่าปกติ', width: 20 },
      ],
      wordColumnKeys: ['serviceDate', 'vn', 'labName', 'result', 'normalValue'],
    },
    medications: {
      title: `รายการยาล่าสุด HN ${hn}`,
      columns: [
        { key: 'serviceDate', label: 'วันที่', width: 12 },
        { key: 'vn', label: 'VN', width: 14 },
        { key: 'icode', label: 'รหัสยา', width: 12 },
        { key: 'drugName', label: 'ชื่อยา', width: 32 },
        { key: 'qty', label: 'จำนวน', width: 9 },
        { key: 'unitPrice', label: 'ราคาต่อหน่วย', width: 12 },
        { key: 'price', label: 'รวม', width: 12 },
      ],
      wordColumnKeys: ['serviceDate', 'vn', 'icode', 'drugName', 'qty', 'price'],
    },
    appointments: {
      title: `ประวัติวันนัด HN ${hn}`,
      columns: [
        { key: 'appointmentDate', label: 'วันนัด', width: 12 },
        { key: 'appointmentTime', label: 'เวลา', width: 9 },
        { key: 'clinic', label: 'คลินิก', width: 24 },
        { key: 'department', label: 'แผนก', width: 24 },
        { key: 'appointmentCause', label: 'สาเหตุการนัด', width: 32 },
      ],
      wordColumnKeys: ['appointmentDate', 'appointmentTime', 'clinic', 'department', 'appointmentCause'],
    },
    diagnoses: {
      title: `ประวัติวินิจฉัย HN ${hn}`,
      columns: [
        { key: 'serviceDate', label: 'วันที่', width: 12 },
        { key: 'vn', label: 'VN', width: 14 },
        { key: 'an', label: 'AN', width: 14 },
        { key: 'clinic', label: 'คลินิก/หอผู้ป่วย', width: 24 },
        { key: 'mainDiag', label: 'วินิจฉัยหลัก', width: 18 },
      ],
      wordColumnKeys: ['serviceDate', 'vn', 'an', 'clinic', 'mainDiag'],
    },
  };
  const definition = definitions[topic];
  return {
    title: definition.title,
    subtitle: patientName,
    metadata: [
      { label: 'HN', value: hn },
      { label: 'ชื่อผู้ป่วย', value: patientName },
      { label: 'จำนวนรายการ', value: rows.length.toLocaleString('th-TH') },
    ],
    columns: definition.columns,
    rows,
    wordColumnKeys: definition.wordColumnKeys,
  };
};

export const answerPatientReportQuestion = async (
  intent: PatientReportIntent,
): Promise<PatientToolAnswer> => {
  if (intent.kind === 'opd-count') {
    const result = await getOpdCount(intent.dateStart, intent.dateEnd);
    return {
      answer: formatOpdCountAnswer(result),
      report: { type: intent.kind, source: 'HOSxP', dateStart: intent.dateStart, dateEnd: intent.dateEnd },
    };
  }

  if (intent.kind === 'opd-list') {
    const result = await getOpdRows(intent.dateStart, intent.dateEnd);
    const report = opdReport(
      'รายงานผู้รับบริการ OPD',
      `ช่วงวันที่ ${rangeLabel(intent.dateStart, intent.dateEnd)}`,
      result.rows,
      [
        { label: 'ช่วงวันที่', value: rangeLabel(intent.dateStart, intent.dateEnd) },
        { label: 'จำนวนทั้งหมด', value: `${result.total.toLocaleString('th-TH')} VN` },
      ],
    );
    const output = intent.format
      ? await buildReportAttachment(intent.format, report, `fdh-opd-${intent.dateStart}-to-${intent.dateEnd}`)
      : undefined;
    return {
      answer: result.total
        ? `พบผู้รับบริการ OPD ${result.total.toLocaleString('th-TH')} VN ช่วงวันที่ ${rangeLabel(intent.dateStart, intent.dateEnd)}${result.total > result.rows.length ? ` แสดง ${result.rows.length.toLocaleString('th-TH')} รายการแรก` : ''}${output ? ` และสร้างไฟล์ ${output.filename} แล้ว` : ''}`
        : `ไม่พบผู้รับบริการ OPD ช่วงวันที่ ${rangeLabel(intent.dateStart, intent.dateEnd)}`,
      report: {
        type: intent.kind,
        source: 'HOSxP',
        dateStart: intent.dateStart,
        dateEnd: intent.dateEnd,
        totalRows: result.total,
        returnedRows: result.rows.length,
        truncated: result.total > result.rows.length,
      },
      attachment: output,
    };
  }

  if (intent.kind === 'visit-detail') {
    const header = await getVisitHeader(intent.vn);
    if (!header) {
      return {
        answer: `ไม่พบ VN ${intent.vn} ใน HOSxP`,
        report: { type: intent.kind, source: 'HOSxP', identifierType: 'vn', identifier: intent.vn },
      };
    }
    const clinical = await getDiagsAndProcedures(intent.vn);
    const items = await getVisitChargeItems(intent.vn);
    const clinicalNote = clinical.clinical as { cc?: unknown; hpi?: unknown };
    const diagnoses = clinical.diagnoses.map((item) => `${item.code || ''} ${item.name || ''}`.trim()).filter(Boolean);
    const procedures = clinical.procedures.map((item) => `${item.code || ''} ${item.name || ''}`.trim()).filter(Boolean);
    const answer = [
      `VN ${intent.vn} — ${header.patientName || ''} (HN ${header.hn || '-'}) วันที่ ${header.serviceDate || '-'} เวลา ${header.serviceTime || '-'}`,
      `คลินิก: ${header.clinic || '-'} | สิทธิ: ${header.fund || '-'}`,
      `อาการสำคัญ: ${clinicalNote.cc || '-'}`,
      `วินิจฉัย: ${diagnoses.slice(0, 8).join(', ') || '-'}`,
      `หัตถการ: ${procedures.slice(0, 8).join(', ') || '-'}`,
      `รายการยา/บริการ: ${items.length.toLocaleString('th-TH')} รายการ ยอดรวม ${items.reduce((sum, item) => sum + Number(item.price || 0), 0).toLocaleString('th-TH')} บาท`,
    ].join('\n');
    const rows = items.map((item) => ({ ...header, ...item, mainDiag: diagnoses.join(', ') }));
    const report: ExportableReport = {
      title: `รายละเอียด VN ${intent.vn}`,
      subtitle: `${header.patientName || ''} | HN ${header.hn || '-'}`,
      metadata: [
        { label: 'วันที่รับบริการ', value: `${header.serviceDate || '-'} ${header.serviceTime || ''}`.trim() },
        { label: 'คลินิก', value: String(header.clinic || '-') },
        { label: 'วินิจฉัย', value: diagnoses.join(', ') || '-' },
      ],
      columns: [
        { key: 'icode', label: 'รหัสรายการ', width: 13 },
        { key: 'drugName', label: 'ยา/บริการ', width: 32 },
        { key: 'itemType', label: 'ประเภท', width: 15 },
        { key: 'qty', label: 'จำนวน', width: 9 },
        { key: 'unitPrice', label: 'ราคาต่อหน่วย', width: 13 },
        { key: 'price', label: 'รวม', width: 12 },
        { key: 'mainDiag', label: 'วินิจฉัย', width: 22 },
      ],
      rows,
      wordColumnKeys: ['icode', 'drugName', 'itemType', 'qty', 'unitPrice', 'price'],
    };
    const output = intent.format
      ? await buildReportAttachment(intent.format, report, `fdh-vn-${intent.vn}`)
      : undefined;
    return {
      answer: `${answer}${output ? `\nสร้างไฟล์ ${output.filename} แล้ว` : ''}`,
      report: {
        type: intent.kind,
        source: 'HOSxP',
        identifierType: 'vn',
        identifier: intent.vn,
        totalRows: items.length,
        returnedRows: items.length,
      },
      attachment: output,
    };
  }

  if (intent.identifierType === 'name') {
    const rows = await getPatientProfilesByName(intent.identifier);
    if (intent.countVisits && rows.length) {
      const counts = await getPatientVisitCounts(rows.map((row) => String(row.hn || '')).filter(Boolean));
      const report: ExportableReport = {
        title: `จำนวนครั้งรับบริการของ ${intent.identifier}`,
        subtitle: 'นับจำนวน VN ไม่ซ้ำจากประวัติ HOSxP',
        columns: [
          { key: 'hn', label: 'HN', width: 12 },
          { key: 'patientName', label: 'ชื่อผู้ป่วย', width: 30 },
          { key: 'visitCount', label: 'จำนวนครั้งรับบริการ', width: 18 },
          { key: 'admissionCount', label: 'จำนวน IPD', width: 12 },
          { key: 'firstVisitDate', label: 'มาครั้งแรก', width: 12 },
          { key: 'lastVisitDate', label: 'มาครั้งล่าสุด', width: 12 },
        ],
        rows: counts,
        wordColumnKeys: ['hn', 'patientName', 'visitCount', 'admissionCount', 'firstVisitDate', 'lastVisitDate'],
      };
      const output = intent.format
        ? await buildReportAttachment(intent.format, report, 'fdh-patient-visit-count')
        : undefined;
      return {
        answer: counts.map((row) => (
          `${row.patientName || intent.identifier} (HN ${row.hn || '-'}) เคยมารับบริการ ${Number(row.visitCount || 0).toLocaleString('th-TH')} ครั้ง`
          + ` โดยนับ VN ไม่ซ้ำ พบการนอนโรงพยาบาล ${Number(row.admissionCount || 0).toLocaleString('th-TH')} ครั้ง`
          + ` มาครั้งแรก ${row.firstVisitDate || '-'} และครั้งล่าสุด ${row.lastVisitDate || '-'}`
        )).concat(output ? [`สร้างไฟล์ ${output.filename} แล้ว`] : []).join('\n'),
        report: {
          type: intent.kind,
          source: 'HOSxP',
          identifierType: 'name',
          identifier: intent.identifier,
          totalRows: counts.length,
          returnedRows: counts.length,
        },
        attachment: output,
      };
    }
    const report: ExportableReport = {
      title: `ผลค้นหาผู้ป่วยชื่อ ${intent.identifier}`,
      subtitle: 'ค้นจากชื่อ-นามสกุลใน HOSxP',
      columns: [
        { key: 'hn', label: 'HN', width: 12 },
        { key: 'patientName', label: 'ชื่อผู้ป่วย', width: 30 },
        { key: 'birthDate', label: 'วันเกิด', width: 12 },
        { key: 'sex', label: 'เพศ', width: 8 },
        { key: 'cid', label: 'CID', width: 16 },
      ],
      rows,
    };
    const output = intent.format
      ? await buildReportAttachment(intent.format, report, 'fdh-patient-search')
      : undefined;
    return {
      answer: rows.length
        ? `พบ ${rows.length.toLocaleString('th-TH')} คน: ${rows.slice(0, 10).map((row) => `${row.hn} ${row.patientName}`).join(', ')}${output ? ` และสร้างไฟล์ ${output.filename} แล้ว` : ''}`
        : `ไม่พบผู้ป่วยชื่อ ${intent.identifier}`,
      report: {
        type: intent.kind,
        source: 'HOSxP',
        identifierType: 'name',
        identifier: intent.identifier,
        totalRows: rows.length,
        returnedRows: rows.length,
      },
      attachment: output,
    };
  }

  const hn = await patientHnFromIdentifier(intent.identifierType, intent.identifier);
  const data = hn ? await getPatientProfileAndHistory(hn) : null;
  if (!data) {
    return {
      answer: `ไม่พบผู้ป่วยจาก ${intent.identifierType.toUpperCase()} ${intent.identifier}`,
      report: {
        type: intent.kind,
        source: 'HOSxP',
        identifierType: intent.identifierType,
        identifier: intent.identifier,
      },
    };
  }
  const { profile, visits, admissions } = data;
  const rows: Array<Record<string, unknown>> = [
    ...visits.map((visit) => ({ ...visit, hn: profile.hn, patientName: profile.patientName })),
    ...admissions.map((admission) => ({
      serviceDate: admission.admitDate,
      hn: profile.hn,
      an: admission.an,
      patientName: profile.patientName,
      clinic: admission.ward,
      mainDiag: admission.primaryDiagnosis,
    })),
  ];
  if (intent.topic) {
    let topicRows: Array<Record<string, unknown>>;
    if (intent.topic === 'labs') topicRows = await getPatientLabs(hn);
    else if (intent.topic === 'medications') topicRows = await getPatientMedications(hn);
    else if (intent.topic === 'appointments') topicRows = await getPatientAppointments(hn);
    else topicRows = rows.filter((row) => Boolean(row.mainDiag));

    const topicLabels = {
      labs: 'ผลตรวจทางห้องปฏิบัติการล่าสุด',
      medications: 'รายการยาล่าสุด',
      appointments: 'วันนัด',
      diagnoses: 'ประวัติวินิจฉัยหลัก',
    } as const;
    const report = patientTopicReport(
      intent.topic,
      String(profile.hn || hn),
      String(profile.patientName || '-'),
      topicRows,
    );
    const output = intent.format
      ? await buildReportAttachment(intent.format, report, `fdh-patient-${profile.hn}-${intent.topic}`)
      : undefined;
    const preview = topicRows.slice(0, 8).map((row) => {
      if (intent.topic === 'labs') return `${row.serviceDate || '-'} ${row.labName || '-'}: ${row.result || '-'}`;
      if (intent.topic === 'medications') return `${row.serviceDate || '-'} ${row.drugName || '-'} จำนวน ${row.qty || 0}`;
      if (intent.topic === 'appointments') return `${row.appointmentDate || '-'} ${row.appointmentTime || ''} ${row.clinic || row.department || '-'}`;
      return `${row.serviceDate || '-'} ${row.mainDiag || '-'}`;
    });
    return {
      answer: topicRows.length
        ? [`${profile.patientName || '-'} | HN ${profile.hn}`, `${topicLabels[intent.topic]} ${topicRows.length.toLocaleString('th-TH')} รายการ`, ...preview, output ? `สร้างไฟล์ ${output.filename} แล้ว` : ''].filter(Boolean).join('\n')
        : `ไม่พบ${topicLabels[intent.topic]}ของ HN ${profile.hn}`,
      report: {
        type: intent.kind,
        source: 'HOSxP',
        identifierType: intent.identifierType,
        identifier: intent.identifier,
        totalRows: topicRows.length,
        returnedRows: topicRows.length,
      },
      attachment: output,
    };
  }
  const report = patientReport(`ประวัติผู้ป่วย HN ${profile.hn}`, rows);
  report.metadata = [
    { label: 'ชื่อผู้ป่วย', value: String(profile.patientName || '') },
    { label: 'HN', value: String(profile.hn || '') },
    { label: 'CID', value: String(profile.cid || '') },
    { label: 'วันเกิด', value: String(profile.birthDate || '') },
    { label: 'เพศ/อายุ', value: `${profile.sex || '-'} / ${profile.age || '-'} ปี` },
    { label: 'หมู่เลือด', value: String(profile.bloodGroup || '-') },
    { label: 'แพ้ยา', value: String(profile.drugAllergy || '-') },
  ];
  const output = intent.format
    ? await buildReportAttachment(intent.format, report, `fdh-patient-${profile.hn}`)
    : undefined;
  const recent = visits[0];
  return {
    answer: [
      `${profile.patientName || '-'} | HN ${profile.hn} | CID ${profile.cid || '-'}`,
      `เพศ ${profile.sex || '-'} อายุ ${profile.age || '-'} ปี วันเกิด ${profile.birthDate || '-'} หมู่เลือด ${profile.bloodGroup || '-'}`,
      `แพ้ยา: ${profile.drugAllergy || '-'} | โทร: ${profile.phone || '-'}`,
      `ประวัติที่พบ: OPD ล่าสุด ${visits.length.toLocaleString('th-TH')} รายการ และ IPD ล่าสุด ${admissions.length.toLocaleString('th-TH')} รายการ`,
      recent ? `ครั้งล่าสุด ${recent.serviceDate} VN ${recent.vn} คลินิก ${recent.clinic || '-'} วินิจฉัยหลัก ${recent.mainDiag || '-'}` : 'ไม่พบประวัติ OPD ล่าสุด',
      output ? `สร้างไฟล์ ${output.filename} แล้ว` : '',
    ].filter(Boolean).join('\n'),
    report: {
      type: intent.kind,
      source: 'HOSxP',
      identifierType: intent.identifierType,
      identifier: intent.identifier,
      totalRows: rows.length,
      returnedRows: rows.length,
    },
    attachment: output,
  };
};

````
