import { getUTFConnection } from './db.js';
import { answerPatientReportQuestion } from './aiReportTools.js';
import { buildReportAttachment, type ExportableReport, type ReportFormat } from './aiReportExport.js';
import { generateAgentText } from './aiService.js';

export type HospitalReportId = 'discharge-summary' | 'operative-note' | 'lab-report' | 'bed-occupancy' | 'cost-per-drg' | 'payer-mix';

export type HospitalReportRequest = {
  reportId: HospitalReportId;
  identifier?: string;
  identifierType?: 'hn' | 'vn' | 'an';
  dateStart?: string;
  dateEnd?: string;
  format?: ReportFormat;
  aiSummary?: boolean;
  instructions?: string;
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

const requireDateRange = (request: HospitalReportRequest) => {
  if (!validDate(request.dateStart) || !validDate(request.dateEnd)) throw new Error('กรุณาระบุวันที่เริ่มต้นและสิ้นสุดให้ถูกต้อง');
  if (request.dateStart! > request.dateEnd!) throw new Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
  const days = (Date.parse(`${request.dateEnd}T00:00:00Z`) - Date.parse(`${request.dateStart}T00:00:00Z`)) / 86_400_000;
  if (days > 366) throw new Error('ช่วงรายงานต้องไม่เกิน 366 วัน');
  return { dateStart: request.dateStart!, dateEnd: request.dateEnd! };
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

const bedOccupancy = async (): Promise<ReportResult> => {
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
    return {
      title: 'รายงานจำนวนผู้ครองเตียงปัจจุบัน',
      subtitle: 'ผู้ป่วยในที่ยังไม่จำหน่าย แยกตามวอร์ด',
      rows: rows as Array<Record<string, unknown>>,
      columns: [
        { key: 'wardCode', label: 'รหัสวอร์ด' }, { key: 'ward', label: 'วอร์ด', width: 28 },
        { key: 'occupiedBeds', label: 'ครองเตียง' }, { key: 'averageStayDays', label: 'วันนอนเฉลี่ย' },
      ],
      notes: ['ยังไม่คำนวณอัตราครองเตียงและเตียงว่างจนกว่าจะกำหนดจำนวนเตียงมาตรฐานของแต่ละวอร์ด'],
    };
  } finally {
    connection.release();
  }
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
  else if (request.reportId === 'bed-occupancy') report = await bedOccupancy();
  else if (request.reportId === 'cost-per-drg') report = await costPerDrg(request);
  else if (request.reportId === 'payer-mix') report = await payerMix(request);
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
