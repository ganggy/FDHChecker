---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/hospitalReportTools.ts"
source_hash: "6832fe4a96c49b63eca799ccf07d09de3af044586865a2155895a644e47d0aa2"
managed_by: "sync-ksp-vault"
---
# hospitalReportTools.ts

> Source: `server/hospitalReportTools.ts`
> SHA-256: `6832fe4a96c49b63eca799ccf07d09de3af044586865a2155895a644e47d0aa2`

````typescript
import { getUTFConnection } from './db.js';
import { answerPatientReportQuestion } from './aiReportTools.js';
import { buildReportAttachment, type ExportableReport, type ReportFormat } from './aiReportExport.js';
import { generateAgentText } from './aiService.js';

export type HospitalReportId = 'discharge-summary' | 'operative-note' | 'lab-report' | 'bed-occupancy' | 'cost-per-drg' | 'payer-mix' | 'pcu-death';

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
  return null;
};

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
  else if (request.reportId === 'bed-occupancy') report = await bedOccupancy(request);
  else if (request.reportId === 'cost-per-drg') report = await costPerDrg(request);
  else if (request.reportId === 'payer-mix') report = await payerMix(request);
  else if (request.reportId === 'pcu-death') report = await communityDeathReport(request);
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

````
