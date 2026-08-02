import { getRepstmConnection, getUTFConnection } from './db.js';
import { queryDailyWorkOverview, type DailyWorkOverview } from './dailyWorkOverview.js';
import { queryDuplicateAppointments } from './duplicateAppointmentAlert.js';
import {
  buildReportAttachment,
  type ExportableReport,
  type ReportAttachment,
  type ReportFormat,
} from './aiReportExport.js';

export type OperationalIntent = {
  kind: 'appointment-duplicates' | 'appointment-clinics' | 'claim-completeness' | 'department-errors' | 'patient-identity-duplicates';
  date: string;
  format?: ReportFormat;
};

export type OperationalAnswer = {
  answer: string;
  report: {
    type: OperationalIntent['kind'];
    source: 'HOSxP' | 'HOSxP/FDHChecker';
    date: string;
    totalRows?: number;
    returnedRows?: number;
  };
  attachment?: ReportAttachment;
};

const bangkokIsoDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00+07:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return bangkokIsoDate(value);
};

const validIsoDate = (year: number, month: number, day: number) => {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const extractDate = (question: string, now: Date) => {
  const today = bangkokIsoDate(now);
  if (/พรุ่งนี้|วันรุ่งขึ้น/.test(question)) return addDays(today, 1);
  if (/เมื่อวาน|วานนี้/.test(question)) return addDays(today, -1);
  if (/วันนี้/.test(question)) return today;
  const iso = question.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) || today;
  const slash = question.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (slash) {
    const suppliedYear = Number(slash[3]);
    return validIsoDate(suppliedYear >= 2400 ? suppliedYear - 543 : suppliedYear, Number(slash[2]), Number(slash[1])) || today;
  }
  return today;
};

const requestedFormat = (question: string): ReportFormat | undefined => {
  if (/excel|xlsx|เอ็กเซล/.test(question)) return 'xlsx';
  if (/word|docx|เวิร์ด/.test(question)) return 'docx';
  if (/\bcsv\b/.test(question)) return 'csv';
  if (/\bjson\b/.test(question)) return 'json';
  if (/สร้างไฟล์|ส่งออก|ดาวน์โหลด/.test(question)) return 'xlsx';
  return undefined;
};

export const parseOperationalIntent = (question: string, now = new Date()): OperationalIntent | null => {
  const normalized = question.trim().toLowerCase();
  const date = extractDate(normalized, now);
  const format = requestedFormat(normalized);
  const formatOption = format ? { format } : {};

  if (
    /(?:hn|cid|คนไข้|ผู้ป่วย|บุคคล).*(?:ซ้ำ|หลาย\s*hn)/i.test(normalized)
    && /(?:hn|cid|เลขประจำตัว|คนเดียว|บุคคลเดียว)/i.test(normalized)
  ) {
    return { kind: 'patient-identity-duplicates', date, ...formatOption };
  }
  if (/(?:นัด.*(?:ซ้ำ|ซ้อน))|(?:(?:ซ้ำซ้อน|นัดซ้ำ).*นัด)/.test(normalized)) {
    return { kind: 'appointment-duplicates', date, ...formatOption };
  }
  if (
    /(?:นัด.*(?:คลินิก|แผนก).*(?:อะไร|ไหน|บ้าง))|(?:(?:คลินิก|แผนก).*มีนัด)/.test(normalized)
    || /มีนัด(?:ที่|ของ)?(?:คลินิก|แผนก)/.test(normalized)
  ) {
    return { kind: 'appointment-clinics', date, ...formatOption };
  }
  if (/(?:เบิก|ส่ง(?:เคลม|เบิก|.*fdh)).*(?:ครบ|หรือไม่|ไหม|ยัง)/.test(normalized)) {
    return { kind: 'claim-completeness', date, ...formatOption };
  }
  if (
    /(?:ข้อมูล.*(?:ไม่สมบ(?:ูรณ์|รูณ์|รณ์)|ผิดพลาด|ผิด).*(?:แผนก|หน่วยงาน))/.test(normalized)
    || /(?:(?:แผนก|หน่วยงาน).*(?:ผิดพลาด|ผิด|ไม่สมบ(?:ูรณ์|รูณ์|รณ์)))/.test(normalized)
  ) {
    return { kind: 'department-errors', date, ...formatOption };
  }
  return null;
};

const thaiDate = (date: string) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' })
  .format(new Date(`${date}T12:00:00+07:00`));

const getAppointmentClinicSummary = async (date: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COALESCE(NULLIF(c.name, ''), NULLIF(k.department, ''), NULLIF(a.clinic, ''), NULLIF(a.depcode, ''), 'ไม่ระบุคลินิก') AS clinic,
         COUNT(*) AS appointmentCount,
         COUNT(DISTINCT NULLIF(a.hn, '')) AS patientCount,
         MIN(COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '')) AS firstTime,
         MAX(COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '')) AS lastTime
       FROM oapp a
       LEFT JOIN clinic c ON c.clinic = a.clinic
       LEFT JOIN kskdepartment k ON k.depcode = a.depcode
       WHERE a.nextdate = ? AND COALESCE(a.oapp_status_id, 1) <> 4
       GROUP BY clinic
       ORDER BY appointmentCount DESC, clinic`,
      [date],
    );
    return rows as Array<Record<string, unknown>>;
  } finally {
    connection.release();
  }
};

const missingFdhStatus = (value: unknown) => {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || /ไม่พบ|ไม่มีรายการ|ยังไม่ส่ง|ไม่ประสงค์เบิก|unclaimed|not found|no data/.test(text);
};

const getClaimCompleteness = async (date: string) => {
  const hosConnection = await getUTFConnection();
  let repConnection: Awaited<ReturnType<typeof getRepstmConnection>> | null = null;
  try {
    const [visitRows] = await hosConnection.query(
      `SELECT o.vn,
         COALESCE((SELECT s.transaction_uid FROM fdh_claim_status s WHERE s.vn = o.vn ORDER BY s.updated_at DESC LIMIT 1), '') AS transactionUid,
         COALESCE((SELECT s.fdh_reservation_status FROM fdh_claim_status s WHERE s.vn = o.vn ORDER BY s.updated_at DESC LIMIT 1), '') AS reservationStatus,
         COALESCE((SELECT s.fdh_claim_status_message FROM fdh_claim_status s WHERE s.vn = o.vn ORDER BY s.updated_at DESC LIMIT 1), '') AS statusMessage
       FROM ovst o
       WHERE o.vstdate = ? AND COALESCE(o.an, '') = '' AND COALESCE(o.vn, '') <> ''`,
      [date],
    );
    const visits = visitRows as Array<Record<string, unknown>>;
    const submitted = new Set<string>();
    for (const row of visits) {
      const vn = String(row.vn || '').trim();
      const status = row.reservationStatus || row.statusMessage;
      if (vn && (String(row.transactionUid || '').trim() || !missingFdhStatus(status))) submitted.add(vn);
    }

    const vns = visits.map((row) => String(row.vn || '').trim()).filter(Boolean);
    if (vns.length) {
      try {
        repConnection = await getRepstmConnection();
        for (let index = 0; index < vns.length; index += 500) {
          const chunk = vns.slice(index, index + 500);
          const [importRows] = await repConnection.query(
            `SELECT vn, claim_status, upload_uid, sent_at
             FROM fdh_claim_detail_row
             WHERE vn IN (${chunk.map(() => '?').join(',')})
             ORDER BY COALESCE(updated_at, created_at) DESC`,
            chunk,
          );
          for (const row of importRows as Array<Record<string, unknown>>) {
            const vn = String(row.vn || '').trim();
            if (vn && (String(row.upload_uid || row.sent_at || '').trim() || !missingFdhStatus(row.claim_status))) submitted.add(vn);
          }
        }
      } catch (error) {
        console.warn('Unable to compare imported FDH ClaimDetail for AI completeness:', (error as Error).message);
      }
    }
    return { total: vns.length, submitted: submitted.size, missing: Math.max(0, vns.length - submitted.size) };
  } finally {
    repConnection?.release();
    hosConnection.release();
  }
};

export type DepartmentErrorRank = {
  department: string;
  affectedVisits: number;
  affectedPatients: number;
  issueCount: number;
  issues: string;
};

export const rankDepartmentErrors = (overview: DailyWorkOverview): DepartmentErrorRank[] => {
  const grouped = new Map<string, { visits: Set<string>; patients: Set<string>; issueCount: number; issues: Map<string, number> }>();
  for (const category of overview.categories) {
    for (const visit of category.visits) {
      const department = visit.departmentName || visit.departmentCode || 'ไม่ระบุแผนก';
      const current = grouped.get(department) || { visits: new Set<string>(), patients: new Set<string>(), issueCount: 0, issues: new Map<string, number>() };
      current.visits.add(visit.vn);
      if (visit.hn) current.patients.add(visit.hn);
      current.issueCount += 1;
      current.issues.set(category.label, (current.issues.get(category.label) || 0) + 1);
      grouped.set(department, current);
    }
  }
  return [...grouped.entries()].map(([department, value]) => ({
    department,
    affectedVisits: value.visits.size,
    affectedPatients: value.patients.size,
    issueCount: value.issueCount,
    issues: [...value.issues.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label} ${count}`).join(', '),
  })).sort((a, b) => b.affectedVisits - a.affectedVisits || b.issueCount - a.issueCount || a.department.localeCompare(b.department, 'th'));
};

const maybeAttachment = async (intent: OperationalIntent, report: ExportableReport, name: string) => (
  intent.format ? buildReportAttachment(intent.format, report, name) : undefined
);

const getPatientIdentityDuplicates = async () => {
  const connection = await getUTFConnection();
  try {
    const [summaryRows] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM (
           SELECT hn FROM patient WHERE COALESCE(hn, '') <> '' GROUP BY hn HAVING COUNT(*) > 1
         ) duplicate_hn) AS duplicateHnGroups,
         (SELECT COUNT(*) FROM (
           SELECT cid FROM patient
           WHERE cid REGEXP '^[0-9]{13}$' AND cid <> '0000000000000' AND COALESCE(hn, '') <> ''
           GROUP BY cid HAVING COUNT(DISTINCT hn) > 1
         ) duplicate_cid) AS duplicateCidGroups`,
    );
    const summary = (summaryRows as Array<Record<string, unknown>>)[0] || {};
    const [detailRows] = await connection.query(
      `SELECT 'HN ซ้ำหลาย record' AS duplicateType, p.hn AS duplicateKey,
          COUNT(*) AS recordCount, p.hn AS hns,
          GROUP_CONCAT(DISTINCT TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) SEPARATOR ' | ') AS patientNames
       FROM patient p
       WHERE COALESCE(p.hn, '') <> ''
       GROUP BY p.hn
       HAVING COUNT(*) > 1
       UNION ALL
       SELECT 'CID เดียวหลาย HN' AS duplicateType, p.cid AS duplicateKey,
          COUNT(DISTINCT p.hn) AS recordCount,
          GROUP_CONCAT(DISTINCT p.hn ORDER BY p.hn SEPARATOR ', ') AS hns,
          GROUP_CONCAT(DISTINCT TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) SEPARATOR ' | ') AS patientNames
       FROM patient p
       WHERE p.cid REGEXP '^[0-9]{13}$' AND p.cid <> '0000000000000' AND COALESCE(p.hn, '') <> ''
       GROUP BY p.cid
       HAVING COUNT(DISTINCT p.hn) > 1
       ORDER BY recordCount DESC, duplicateKey
       LIMIT 500`,
    );
    return {
      duplicateHnGroups: Number(summary.duplicateHnGroups || 0),
      duplicateCidGroups: Number(summary.duplicateCidGroups || 0),
      rows: detailRows as Array<Record<string, unknown>>,
    };
  } finally {
    connection.release();
  }
};

export const answerOperationalQuestion = async (intent: OperationalIntent): Promise<OperationalAnswer> => {
  const dateLabel = thaiDate(intent.date);
  if (intent.kind === 'patient-identity-duplicates') {
    const result = await getPatientIdentityDuplicates();
    const report: ExportableReport = {
      title: 'ตรวจสอบผู้ป่วยซ้ำจาก HN และ CID',
      subtitle: 'ตรวจจากตาราง patient ใน HOSxP',
      metadata: [
        { label: 'HN ซ้ำหลาย record', value: `${result.duplicateHnGroups.toLocaleString('th-TH')} กลุ่ม` },
        { label: 'CID เดียวหลาย HN', value: `${result.duplicateCidGroups.toLocaleString('th-TH')} กลุ่ม` },
      ],
      columns: [
        { key: 'duplicateType', label: 'ประเภทซ้ำ', width: 22 },
        { key: 'duplicateKey', label: 'HN/CID ที่ซ้ำ', width: 18 },
        { key: 'recordCount', label: 'จำนวน record/HN', width: 16 },
        { key: 'hns', label: 'HN ที่เกี่ยวข้อง', width: 30 },
        { key: 'patientNames', label: 'ชื่อที่บันทึก', width: 40 },
      ],
      rows: result.rows,
    };
    const output = await maybeAttachment(intent, report, 'fdh-patient-identity-duplicates');
    return {
      answer: [
        `ตรวจจากตาราง patient พบเลข HN เดียวกันซ้ำหลาย record ${result.duplicateHnGroups.toLocaleString('th-TH')} กลุ่ม`,
        `พบ CID เดียวกันแต่ผูกมากกว่า 1 HN จำนวน ${result.duplicateCidGroups.toLocaleString('th-TH')} กลุ่ม`,
        'สองกรณีนี้มีความหมายต่างกัน: HN ซ้ำคือเลข HN เดิมมีหลายแถว ส่วน CID ซ้ำคือบุคคลเดียวอาจมีหลาย HN',
        result.rows.length >= 500 ? 'รายละเอียดแสดงสูงสุด 500 กลุ่ม' : '',
        output ? `สร้างไฟล์ ${output.filename} แล้ว` : '',
      ].filter(Boolean).join('\n'),
      report: {
        type: intent.kind, source: 'HOSxP', date: intent.date,
        totalRows: result.duplicateHnGroups + result.duplicateCidGroups,
        returnedRows: result.rows.length,
      },
      attachment: output,
    };
  }
  if (intent.kind === 'appointment-duplicates') {
    const result = await queryDuplicateAppointments(intent.date);
    const rows = result.duplicatePatients.flatMap((patient) => patient.appointments.map((appointment) => ({
      hn: patient.hn,
      appointmentCount: patient.appointments.length,
      time: appointment.nextTime,
      clinic: appointment.clinicName || appointment.clinicCode,
      department: appointment.departmentName || appointment.departmentCode,
      cause: appointment.cause,
    })));
    const report: ExportableReport = {
      title: 'รายงานผู้ป่วยนัดซ้ำซ้อน', subtitle: dateLabel,
      metadata: [
        { label: 'ผู้ป่วยนัดซ้ำ', value: `${result.duplicatePatients.length} คน` },
        { label: 'จำนวนนัดรวม', value: `${result.appointmentCount} นัด` },
      ],
      columns: [
        { key: 'hn', label: 'HN', width: 12 }, { key: 'appointmentCount', label: 'นัดของคนนี้', width: 12 },
        { key: 'time', label: 'เวลา', width: 9 }, { key: 'clinic', label: 'คลินิก', width: 24 },
        { key: 'department', label: 'แผนก', width: 24 }, { key: 'cause', label: 'สาเหตุการนัด', width: 30 },
      ], rows,
    };
    const output = await maybeAttachment(intent, report, `fdh-duplicate-appointments-${intent.date}`);
    return {
      answer: result.duplicatePatients.length
        ? `${dateLabel} มีผู้ป่วยนัดซ้ำซ้อน ${result.duplicatePatients.length.toLocaleString('th-TH')} คน รวม ${result.appointmentCount.toLocaleString('th-TH')} นัด${output ? `\nสร้างไฟล์ ${output.filename} แล้ว` : ''}`
        : `${dateLabel} ไม่พบผู้ป่วยที่มีนัดซ้ำซ้อน`,
      report: { type: intent.kind, source: 'HOSxP', date: intent.date, totalRows: result.duplicatePatients.length, returnedRows: rows.length },
      attachment: output,
    };
  }

  if (intent.kind === 'appointment-clinics') {
    const rows = await getAppointmentClinicSummary(intent.date);
    const totalAppointments = rows.reduce((sum, row) => sum + Number(row.appointmentCount || 0), 0);
    const report: ExportableReport = {
      title: 'สรุปคลินิกที่มีนัด', subtitle: dateLabel,
      columns: [
        { key: 'clinic', label: 'คลินิก/แผนก', width: 30 }, { key: 'patientCount', label: 'ผู้ป่วย', width: 10 },
        { key: 'appointmentCount', label: 'จำนวนนัด', width: 10 }, { key: 'firstTime', label: 'เริ่ม', width: 9 }, { key: 'lastTime', label: 'สิ้นสุด', width: 9 },
      ], rows,
    };
    const output = await maybeAttachment(intent, report, `fdh-appointment-clinics-${intent.date}`);
    return {
      answer: rows.length
        ? [`${dateLabel} มีนัด ${totalAppointments.toLocaleString('th-TH')} นัด ใน ${rows.length.toLocaleString('th-TH')} คลินิก/แผนก`, ...rows.slice(0, 12).map((row) => `• ${row.clinic}: ${Number(row.appointmentCount || 0).toLocaleString('th-TH')} นัด (${Number(row.patientCount || 0).toLocaleString('th-TH')} คน)`), output ? `สร้างไฟล์ ${output.filename} แล้ว` : ''].filter(Boolean).join('\n')
        : `${dateLabel} ไม่พบรายการนัดที่ยังใช้งานอยู่`,
      report: { type: intent.kind, source: 'HOSxP', date: intent.date, totalRows: rows.length, returnedRows: rows.length },
      attachment: output,
    };
  }

  if (intent.kind === 'claim-completeness') {
    const result = await getClaimCompleteness(intent.date);
    const rows = [{ date: intent.date, totalVisits: result.total, submitted: result.submitted, missing: result.missing, percent: result.total ? Math.round(result.submitted / result.total * 1000) / 10 : 0 }];
    const report: ExportableReport = {
      title: 'ความครบถ้วนการส่ง FDH', subtitle: dateLabel,
      columns: [
        { key: 'date', label: 'วันที่', width: 12 }, { key: 'totalVisits', label: 'OPD ทั้งหมด', width: 14 },
        { key: 'submitted', label: 'พบหลักฐานส่ง FDH', width: 18 }, { key: 'missing', label: 'ยังไม่พบ', width: 12 }, { key: 'percent', label: 'ร้อยละ', width: 10 },
      ], rows,
    };
    const output = await maybeAttachment(intent, report, `fdh-claim-completeness-${intent.date}`);
    const state = result.total === 0 ? 'ไม่พบ OPD สำหรับตรวจสอบ' : result.missing === 0 ? 'พบหลักฐานส่ง FDH ครบ' : 'ยังพบรายการที่ไม่มีหลักฐานส่ง FDH';
    return {
      answer: `${dateLabel}: ${state}\nOPD ${result.total.toLocaleString('th-TH')} VN • พบหลักฐานส่ง ${result.submitted.toLocaleString('th-TH')} • ยังไม่พบ ${result.missing.toLocaleString('th-TH')}\nหมายเหตุ: เปรียบเทียบ OPD ทุก VN ของวันนั้น รายการที่ไม่เข้าเกณฑ์เบิกอาจรวมอยู่ในจำนวน “ยังไม่พบ”${output ? `\nสร้างไฟล์ ${output.filename} แล้ว` : ''}`,
      report: { type: intent.kind, source: 'HOSxP/FDHChecker', date: intent.date, totalRows: result.total, returnedRows: 1 },
      attachment: output,
    };
  }

  const overview = await queryDailyWorkOverview(intent.date);
  const rows = rankDepartmentErrors(overview);
  const report: ExportableReport = {
    title: 'อันดับแผนกที่ข้อมูลไม่สมบูรณ์', subtitle: dateLabel,
    metadata: [
      { label: 'VN ที่ต้องตรวจสอบ', value: overview.affectedVisits.toLocaleString('th-TH') },
      { label: 'ผู้ป่วยที่ได้รับผลกระทบ', value: overview.affectedPatients.toLocaleString('th-TH') },
    ],
    columns: [
      { key: 'department', label: 'แผนก', width: 30 }, { key: 'affectedVisits', label: 'VN ผิดพลาด', width: 13 },
      { key: 'affectedPatients', label: 'ผู้ป่วย', width: 10 }, { key: 'issueCount', label: 'จำนวนประเด็น', width: 13 }, { key: 'issues', label: 'รายละเอียด', width: 45 },
    ], rows,
  };
  const output = await maybeAttachment(intent, report, `fdh-department-errors-${intent.date}`);
  return {
    answer: rows.length
      ? [`${dateLabel} แผนกที่มี VN ข้อมูลไม่สมบูรณ์มากที่สุดคือ ${rows[0].department} จำนวน ${rows[0].affectedVisits.toLocaleString('th-TH')} VN (${rows[0].issueCount.toLocaleString('th-TH')} ประเด็น)`, ...rows.slice(0, 5).map((row, index) => `${index + 1}. ${row.department}: ${row.affectedVisits.toLocaleString('th-TH')} VN — ${row.issues}`), output ? `สร้างไฟล์ ${output.filename} แล้ว` : ''].filter(Boolean).join('\n')
      : `${dateLabel} ไม่พบข้อมูล OPD ที่ไม่สมบูรณ์ตามเกณฑ์ตรวจรายวัน`,
    report: { type: intent.kind, source: 'HOSxP/FDHChecker', date: intent.date, totalRows: rows.length, returnedRows: rows.length },
    attachment: output,
  };
};
