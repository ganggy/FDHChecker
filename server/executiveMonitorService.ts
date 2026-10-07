import { getRepstmConnection } from './db/connection.js';
import { ensureRepstmTables } from './db/schema.js';
import { loadErrorCatalog } from './aiErrorTools.js';

export type ServiceCategoryKey =
  | 'OPD'
  | 'IPD'
  | 'THAI_MED'
  | 'PHYSICAL_THERAPY'
  | 'DIALYSIS'
  | 'DENTAL'
  | 'PPFS'
  | 'OTHER';

export type RightSchemeKey =
  | 'UCS_INCUP'
  | 'UCS_OUTCUP'
  | 'OFC'
  | 'LGO'
  | 'SSS'
  | 'A9_INS'
  | 'FOREIGN_SELF'
  | 'OTHER';

export const SERVICE_CATEGORY_ORDER: ServiceCategoryKey[] = [
  'OPD',
  'IPD',
  'THAI_MED',
  'PHYSICAL_THERAPY',
  'DIALYSIS',
  'DENTAL',
  'PPFS',
  'OTHER',
];

export const RIGHT_SCHEME_ORDER: RightSchemeKey[] = [
  'UCS_INCUP',
  'UCS_OUTCUP',
  'OFC',
  'LGO',
  'SSS',
  'A9_INS',
  'FOREIGN_SELF',
  'OTHER',
];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategoryKey, { name: string; icon: string; description: string }> = {
  OPD: { name: 'ผู้ป่วยนอกทั่วไป (OPD)', icon: '🩺', description: 'บริการตรวจรักษาผู้ป่วยนอกทั่วไป' },
  IPD: { name: 'ผู้ป่วยใน (IPD)', icon: '🛏️', description: 'บริการผู้ป่วยค้างคืน/นอนโรงพยาบาล' },
  THAI_MED: { name: 'แพทย์แผนไทย', icon: '🌿', description: 'นวด ประคบ สมุนไพร พอกเข่า และเวชกรรมไทย' },
  PHYSICAL_THERAPY: { name: 'กายภาพบำบัด', icon: '🏃', description: 'ฟื้นฟูสมรรถภาพทางกายภาพและเวชกรรมฟื้นฟู' },
  DIALYSIS: { name: 'ฟอกไต / ไตเทียม', icon: '🫘', description: 'ฟอกเลือดด้วยเครื่องไตเทียม HD / CRRT' },
  DENTAL: { name: 'ทันตกรรม', icon: '🦷', description: 'ทันตกรรมป้องกัน บำบัดรักษา และฟื้นฟู' },
  PPFS: { name: 'ส่งเสริมป้องกัน (PPFS)', icon: '🛡️', description: 'ตรวจสุขภาพ ฝากครรภ์ วัคซีน คัดกรองความเสี่ยง' },
  OTHER: { name: 'บริการเฉพาะ / อื่นๆ', icon: '🧩', description: 'บริการกรณีเฉพาะ กองทุนพิเศษ และบริการอื่นๆ' },
};

export const RIGHT_SCHEME_LABELS: Record<RightSchemeKey, { name: string; icon: string; description: string }> = {
  UCS_INCUP: { name: 'บัตรทองใน CUP', icon: '🏥', description: 'สิทธิหลักประกันสุขภาพถ้วนหน้าในเครือข่าย รพ. (รวมงบเหมาจ่ายและบริการส่งเสริม)' },
  UCS_OUTCUP: { name: 'บัตรทองนอก CUP / Walk-in', icon: '🚶', description: 'บัตรทองข้ามเขต / ปฐมภูมิไปที่ไหนก็ได้ / Walk-in / ฉุกเฉิน OPAE' },
  OFC: { name: 'ข้าราชการ (กรมบัญชีกลาง)', icon: '🏛️', description: 'เบิกจ่ายตรงกรมบัญชีกลาง ข้าราชการ/ครอบครัว และระบบไต CHI/CSCD' },
  LGO: { name: 'อปท. (ข้าราชการท้องถิ่น)', icon: '🏢', description: 'องค์กรปกครองส่วนท้องถิ่น เทศบาล อบต. อบจ. เมืองพัทยา และไตเทียม LGO-HD' },
  SSS: { name: 'ประกันสังคม', icon: '🔵', description: 'กองทุนประกันสังคม ม.33, ม.39, ม.40 และไตเทียม SOCD/SSS-HD' },
  A9_INS: { name: 'พรบ. / กองทุนทดแทน', icon: '🚗', description: 'พรบ.คุ้มครองผู้ประสบภัยจากรถ และกองทุนเงินทดแทน' },
  FOREIGN_SELF: { name: 'ต่างด้าว / ชำระเอง', icon: '💵', description: 'แรงงานต่างด้าว ประกันสุขภาพต่างด้าว และชำระเงินเอง' },
  OTHER: { name: 'สิทธิอื่นๆ (ทหารผ่านศึก/คนพิการ/เฉพาะกิจ)', icon: '🏷️', description: 'สิทธิทหารผ่านศึก, ผู้พิการ, ชนกลุ่มน้อย, และสิทธิเฉพาะกิจที่ยังไม่แยกกองทุน' },
};

export interface MetricItem {
  claimedAmount: number;
  claimedCount: number;
  pendingCAmount: number;
  pendingCCount: number;
  reimbursedAmount: number;
  reimbursedCount: number;
  reimbursementRate: number;
}

export interface SubSchemeDetail {
  name: string;
  claimedAmount: number;
  claimedCount: number;
  reimbursedAmount: number;
  reimbursedCount: number;
  pendingCAmount: number;
  pendingCCount: number;
}

export interface RightSchemeSummary extends MetricItem {
  rightKey: RightSchemeKey;
  rightName: string;
  rightIcon: string;
  rightDescription: string;
  subSchemes: SubSchemeDetail[];
}

export interface ServiceCategorySummary extends MetricItem {
  categoryKey: ServiceCategoryKey;
  categoryName: string;
  categoryIcon: string;
  categoryDescription: string;
  smtAllocatedAmount: number;
  smtNetTransferred: number;
  topCCodes: Array<{
    code: string;
    count: number;
    amount: number;
    description: string;
  }>;
}

export interface RightSchemeSummary extends MetricItem {
  rightKey: RightSchemeKey;
  rightName: string;
  rightIcon: string;
  rightDescription: string;
}

export interface SmtBudgetComparison {
  id?: number;
  budgetYear: string;
  fundName: string;
  serviceCategory: ServiceCategoryKey;
  categoryName: string;
  mophId?: string;
  mophDesc?: string;
  allocatedAmount: number;
  netTransferred: number;
  waitAmount: number;
  debtAmount: number;
  stmPaidAmount: number;
  claimedAmount: number;
  claimedCount: number;
  reimbursedAmount: number;
  reimbursedCount: number;
  pendingCAmount: number;
  pendingCCount: number;
  status: 'settled' | 'partial' | 'pending';
  runDate?: string;
  refDocNo?: string;
  batchNo?: string;
}

export interface TopCCodeItem {
  code: string;
  count: number;
  amount: number;
  description: string;
  guide: string;
  category: string;
  affectedServices: string[];
}

export interface ExecutiveMonitorResult {
  period: {
    startDate?: string;
    endDate?: string;
    budgetYear: string;
  };
  summary: {
    totalClaimedAmount: number;
    totalClaimedCount: number;
    totalPendingCAmount: number;
    totalPendingCCount: number;
    totalReimbursedAmount: number;
    totalReimbursedCount: number;
    reimbursementRate: number;
    totalSmtAllocatedAmount: number;
    totalSmtNetTransferred: number;
    totalSmtWaitAmount: number;
    totalSmtDebtAmount: number;
    varianceAmount: number;
  };
  byService: Record<ServiceCategoryKey, ServiceCategorySummary>;
  byRight: Record<RightSchemeKey, RightSchemeSummary>;
  matrix: Record<RightSchemeKey, Record<ServiceCategoryKey, MetricItem>>;
  smtTransfers: SmtBudgetComparison[];
  topCCodes: TopCCodeItem[];
}

/**
 * Classify a service record into one of 8 standardized hospital service categories.
 */
export function classifyServiceCategory(
  patientType?: string | null,
  department?: string | null,
  an?: string | null,
  filename?: string | null,
  rawData?: Record<string, unknown> | string | null
): ServiceCategoryKey {
  const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData || {});
  const combinedText = `${patientType || ''} ${department || ''} ${filename || ''} ${rawStr}`.toLowerCase();

  // 1. Dialysis / Hemodialysis
  if (
    combinedText.includes('ไตเทียม') ||
    combinedText.includes('ฟอกเลือด') ||
    combinedText.includes('ฟอกไต') ||
    combinedText.includes('hemodialysis') ||
    combinedText.includes('chihd') ||
    combinedText.includes('lgo-hd') ||
    combinedText.includes('ca_hd') ||
    combinedText.includes('39.95') ||
    combinedText.includes('z49') ||
    combinedText.includes('ไตวาย')
  ) {
    return 'DIALYSIS';
  }

  // 2. Thai Traditional Medicine
  if (
    combinedText.includes('แผนไทย') ||
    combinedText.includes('แพทย์แผนไทย') ||
    combinedText.includes('ttm') ||
    combinedText.includes('สมุนไพร') ||
    combinedText.includes('พอกเข่า') ||
    combinedText.includes('นวดประคบ') ||
    combinedText.includes('872-78') ||
    combinedText.includes('873-78') ||
    combinedText.includes('874-78')
  ) {
    return 'THAI_MED';
  }

  // 3. Physical Therapy / Rehabilitation
  if (
    combinedText.includes('กายภาพ') ||
    combinedText.includes('เวชกรรมฟื้นฟู') ||
    combinedText.includes('rehab') ||
    combinedText.includes('ฟื้นฟูสมรรถภาพ') ||
    combinedText.includes('pt') ||
    combinedText.includes('z50') ||
    combinedText.includes('หมวด 14')
  ) {
    return 'PHYSICAL_THERAPY';
  }

  // 4. Dental
  if (
    combinedText.includes('ทันตกรรม') ||
    combinedText.includes('ทันต') ||
    combinedText.includes('dent') ||
    combinedText.includes('ขูดหินปูน') ||
    combinedText.includes('อุดฟัน') ||
    combinedText.includes('ถอนฟัน') ||
    combinedText.includes('เคลือบฟลูออไรด์')
  ) {
    return 'DENTAL';
  }

  // 5. PPFS / Health Promotion & Prevention
  if (
    combinedText.includes('ppfs') ||
    combinedText.includes('สร้างเสริมสุขภาพ') ||
    combinedText.includes('ป้องกันโรค') ||
    combinedText.includes('ส่งเสริมป้องกัน') ||
    combinedText.includes('anc') ||
    combinedText.includes('ฝากครรภ์') ||
    combinedText.includes('คุมกำเนิด') ||
    combinedText.includes('ตรวจคัดกรอง') ||
    combinedText.includes('คัดกรอง') ||
    combinedText.includes('วัคซีน') ||
    combinedText.includes('ktb') ||
    combinedText.includes('ppa') ||
    combinedText.includes('ppb') ||
    combinedText.includes('ppc')
  ) {
    return 'PPFS';
  }

  // 6. IPD: has AN or department IP or patientType IP
  if (
    (an && String(an).trim() !== '' && String(an).trim() !== '0') ||
    department === 'IP' ||
    department === 'IPD' ||
    (patientType && (patientType.toUpperCase().includes('IP') || patientType.includes('ใน')))
  ) {
    return 'IPD';
  }

  // 7. OPD:
  if (
    department === 'OP' ||
    department === 'OPD' ||
    (patientType && (patientType.toUpperCase().includes('OP') || patientType.includes('นอก')))
  ) {
    return 'OPD';
  }

  return 'OTHER';
}

/**
 * Classify a service record into one of 8 standardized coverage rights / funds.
 */
export function classifyRightScheme(
  maininscl?: string | null,
  subinscl?: string | null,
  filename?: string | null,
  rawData?: Record<string, unknown> | string | null
): RightSchemeKey {
  const main = String(maininscl || '').trim().toUpperCase();
  const sub = String(subinscl || '').trim().toUpperCase();
  const fileStr = String(filename || '').trim().toUpperCase();
  const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData || {});
  const combined = `${main} ${sub} ${fileStr} ${rawStr}`.toUpperCase();

  // 1. OFC (Civil Servant / Comptroller General / ข้าราชการเบิกตรง)
  // รวมถึงระบบไต CHI / COCD / CSCD / CHIHD ของกรมบัญชีกลาง
  if (
    main === 'OFC' ||
    main === 'CS' ||
    main === 'CSCD' ||
    main === 'CHIHD' ||
    combined.includes('เบิกจ่ายตรง') ||
    combined.includes('ข้าราชการ') ||
    combined.includes('CSCD') ||
    combined.includes('CHIHD') ||
    combined.includes('COCD') ||
    fileStr.includes('COCD') ||
    fileStr.includes('CHIHD') ||
    fileStr.includes('CHI_') ||
    fileStr.includes('CSCD')
  ) {
    return 'OFC';
  }

  // 2. LGO (Local Government Organization / อปท.)
  // รวมถึง LGO-HD (ไตเทียม อปท.)
  if (
    main === 'LGO' ||
    main === 'BKK' ||
    main === 'PTY' ||
    combined.includes('อปท') ||
    combined.includes('ท้องถิ่น') ||
    combined.includes('LGO-HD') ||
    fileStr.includes('LGO-HD') ||
    fileStr.includes('LGO_HD')
  ) {
    return 'LGO';
  }

  // 3. SSS (Social Security Scheme / ประกันสังคม)
  // รวมถึง SOCD / SSS-HD (ไตเทียม ประกันสังคม)
  if (
    main === 'SSS' ||
    main === 'SS' ||
    main === 'SOCD' ||
    combined.includes('ประกันสังคม') ||
    combined.includes('SOCD') ||
    combined.includes('SSS-HD') ||
    fileStr.includes('SOCD') ||
    fileStr.includes('SSS-HD')
  ) {
    return 'SSS';
  }

  // 4. A9 / INS (Car Accident Protection ACT / Compensation Fund)
  if (
    main === 'INS' ||
    main === 'A9' ||
    main === 'ACT' ||
    combined.includes('พรบ') ||
    combined.includes('พ.ร.บ.') ||
    combined.includes('กองทุนเงินทดแทน')
  ) {
    return 'A9_INS';
  }

  // 5. Foreign / Self Pay (ต่างด้าว / ชำระเอง)
  if (
    main === 'NRD' ||
    main === 'A1' ||
    main === 'CSH' ||
    combined.includes('ต่างด้าว') ||
    combined.includes('จ่ายเอง') ||
    combined.includes('ชำระเอง') ||
    combined.includes('SELF')
  ) {
    return 'FOREIGN_SELF';
  }

  // 6. UCS (Universal Coverage Scheme / บัตรทอง สปสช.)
  // รวมถึง:
  // - DCKD (Statement ฟอกไต สปสช. เช่น DCKD6931...)
  // - กองทุนไตเทียม HD ของ สปสช. (ถ้าไม่ระบุเป็นข้าราชการ/ประกันสังคม/อปท.)
  // - e-Claim NHSO, WEL, UC, UCS
  if (
    main === 'UCS' ||
    main === 'WEL' ||
    main === 'UC' ||
    combined.includes('บัตรทอง') ||
    combined.includes('หลักประกัน') ||
    fileStr.startsWith('DCKD') ||
    fileStr.includes('DCKD') ||
    combined.includes('DCKD') ||
    main === 'HD' ||
    combined.includes('ไตเทียม') ||
    combined.includes('ฟอกเลือด') ||
    combined.includes('NHSO')
  ) {
    if (
      sub.includes('OUT') ||
      sub.includes('AE') ||
      sub.includes('WALKIN') ||
      sub.includes('ANYWHERE') ||
      combined.includes('นอกCUP') ||
      combined.includes('นอกเขต') ||
      combined.includes('ข้ามเขต') ||
      combined.includes('ปฐมภูมิไปที่ไหนก็ได้')
    ) {
      return 'UCS_OUTCUP';
    }
    return 'UCS_INCUP';
  }

  return 'OTHER';
}

/**
 * Determine if an error code represents a pending C-code, Deny, or rejection.
 */
export function isCCode(errorCode?: string | null): boolean {
  if (!errorCode) return false;
  const codes = String(errorCode).split(/[,|;/\s]+/).map(c => c.trim().toUpperCase());
  return codes.some(c =>
    c.startsWith('C') ||
    c.startsWith('D') ||
    c.includes('DENY') ||
    c.includes('REJECT') ||
    c.includes('ERROR') ||
    c === '399-1'
  );
}

/**
 * Map an SMT e-Budget fund name or description to a standard Service Category.
 */
export function mapSmtFundToServiceCategory(
  fundName?: string | null,
  efundDesc?: string | null,
  mophDesc?: string | null
): ServiceCategoryKey {
  const text = `${fundName || ''} ${efundDesc || ''} ${mophDesc || ''}`.toLowerCase();
  if (text.includes('ไต') || text.includes('ฟอกเลือด')) return 'DIALYSIS';
  if (text.includes('แผนไทย') || text.includes('แพทย์แผนไทย') || text.includes('สมุนไพร')) return 'THAI_MED';
  if (text.includes('กายภาพ') || text.includes('ฟื้นฟูสมรรถภาพ')) return 'PHYSICAL_THERAPY';
  if (text.includes('ทันต')) return 'DENTAL';
  if (text.includes('สร้างเสริม') || text.includes('ป้องกัน') || text.includes('pp')) return 'PPFS';
  if (text.includes('ผู้ป่วยใน') || text.includes('ip')) return 'IPD';
  if (text.includes('ผู้ป่วยนอก') || text.includes('op') || text.includes('เหมาจ่ายรายหัว')) return 'OPD';
  return 'OTHER';
}

function emptyMetricItem(): MetricItem {
  return {
    claimedAmount: 0,
    claimedCount: 0,
    pendingCAmount: 0,
    pendingCCount: 0,
    reimbursedAmount: 0,
    reimbursedCount: 0,
    reimbursementRate: 0,
  };
}

const SUB_SCHEME_FRIENDLY_NAMES: Record<string, string> = {
  VET: 'VET (ทหารผ่านศึก)',
  DIS: 'DIS (คนพิการ)',
  FRG: 'FRG (แรงงานต่างด้าว)',
  NRD: 'NRD (บุคคลที่ไม่มีสถานะทางทะเบียน / ชนกลุ่มน้อย)',
  CSH: 'CSH (ชำระเงินเอง / เงินสด)',
  UCS: 'UCS (สิทธิหลักประกันสุขภาพ)',
  WEL: 'WEL (สิทธิสวัสดิการผู้มีรายได้น้อย)',
  OFC: 'OFC (ข้าราชการ กรมบัญชีกลาง)',
  LGO: 'LGO (ข้าราชการท้องถิ่น อปท.)',
  SSS: 'SSS (ประกันสังคม)',
  ACT: 'ACT (พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ)',
  A9: 'A9 (กองทุนเงินทดแทน)',
};

/**
 * Extract an informative sub-scheme name from statement/REP row metadata.
 */
export function extractSubSchemeName(row: any): string {
  const sub = String(row.subinscl || '').trim();
  const main = String(row.maininscl || '').trim();
  const file = String(row.filename || '').trim();

  let raw = '';
  if (sub && sub !== '-' && sub !== '0' && sub !== 'NULL') {
    raw = sub;
  } else if (main && main !== '-' && main !== '0' && main !== 'NULL') {
    raw = main;
  } else if (file) {
    const base = file.replace(/\.[^.]+$/, '').toUpperCase();
    if (base.startsWith('DCKD')) return 'DCKD (ฟอกไต สปสช.)';
    if (base.startsWith('COCD') || base.startsWith('CHIHD')) return 'CHI/COCD (ฟอกไต ข้าราชการ)';
    if (base.startsWith('LGO-HD') || base.startsWith('LGO_HD')) return 'LGO-HD (ฟอกไต อปท.)';
    if (base.startsWith('SOCD') || base.startsWith('SSS-HD')) return 'SOCD (ฟอกไต ประกันสังคม)';
    return base.slice(0, 12);
  } else {
    return 'ไม่ระบุรหัสย่อย';
  }

  const upper = raw.toUpperCase();
  return SUB_SCHEME_FRIENDLY_NAMES[upper] || raw;
}


/**
 * Main aggregator for Executive Monitor Dashboard.
 * Integrates REP, STM, and e-Budget / SMT data.
 */
export async function getExecutiveMonitorSummary(params: {
  startDate?: string;
  endDate?: string;
  budgetYear?: string;
  serviceCategory?: string;
  rightScheme?: string;
}): Promise<ExecutiveMonitorResult> {
  await ensureRepstmTables();

  const now = new Date();
  const currentThaiYear = String(now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0));
  const budgetYear = params.budgetYear && params.budgetYear.trim() !== '' ? params.budgetYear.trim() : currentThaiYear;

  const repConn = await getRepstmConnection();

  try {
    // 1. Fetch SMT transfers for the budget year
    const [smtRowsRaw] = await repConn.query(
      `SELECT * FROM smt_budget_transfers
       WHERE budget_year = ?
       ORDER BY run_date DESC, id DESC`,
      [budgetYear]
    );
    const smtRows = (smtRowsRaw as any[]) || [];

    // 2. Fetch Statement data (both STM and REP)
    let statementWhere = `WHERE NOT EXISTS (
      SELECT 1 FROM repstm_import_batch replacement 
      WHERE replacement.replaces_batch_id = repstm_statement_data.batch_id
    )`;
    const statementQueryParams: unknown[] = [];

    if (params.startDate && params.endDate) {
      statementWhere += ` AND (
        (service_datetime >= ? AND service_datetime <= ?)
        OR (senddate >= ? AND senddate <= ?)
        OR (created_at >= ? AND created_at <= ?)
      )`;
      const startDateTime = `${params.startDate} 00:00:00`;
      const endDateTime = `${params.endDate} 23:59:59`;
      statementQueryParams.push(startDateTime, endDateTime, startDateTime, endDateTime, startDateTime, endDateTime);
    }

    const [statementRowsRaw] = await repConn.query(
      `SELECT
         id,
         batch_id,
         data_type,
         statement_no,
         tran_id,
         hn,
         vn,
         an,
         patient_type,
         department,
         DATE_FORMAT(service_datetime, '%Y-%m-%d') AS service_date,
         DATE_FORMAT(senddate, '%Y-%m-%d') AS send_date,
         maininscl,
         subinscl,
         errorcode,
         verifycode,
         COALESCE(amount, 0) AS amount,
         COALESCE(paid_amount, 0) AS paid_amount,
         COALESCE(invoice_amount, 0) AS invoice_amount,
         filename,
         raw_data
       FROM repstm_statement_data
       ${statementWhere}
       ORDER BY id ASC`,
      statementQueryParams
    );
    const statementRows = (statementRowsRaw as any[]) || [];

    // Also check rep_data for any REP rows that may exist only in rep_data table
    let repDataWhere = 'WHERE 1=1';
    const repDataQueryParams: unknown[] = [];
    if (params.startDate && params.endDate) {
      repDataWhere += ` AND (
        (admdate >= ? AND admdate <= ?)
        OR (senddate >= ? AND senddate <= ?)
        OR (created_at >= ? AND created_at <= ?)
      )`;
      const startDateTime = `${params.startDate} 00:00:00`;
      const endDateTime = `${params.endDate} 23:59:59`;
      repDataQueryParams.push(startDateTime, endDateTime, startDateTime, endDateTime, startDateTime, endDateTime);
    }

    const [repDataRowsRaw] = await repConn.query(
      `SELECT
         id,
         batch_id,
         'REP' AS data_type,
         rep_no AS statement_no,
         tran_id,
         hn,
         vn,
         an,
         patient_type,
         department,
         DATE_FORMAT(admdate, '%Y-%m-%d') AS service_date,
         DATE_FORMAT(senddate, '%Y-%m-%d') AS send_date,
         maininscl,
         subinscl,
         errorcode,
         verifycode,
         projectcode,
         COALESCE(income, 0) AS amount,
         COALESCE(compensated, 0) AS paid_amount,
         COALESCE(income, 0) AS invoice_amount,
         filename,
         raw_data
       FROM rep_data
       ${repDataWhere}
       ORDER BY id ASC`,
      repDataQueryParams
    );
    const repDataRows = (repDataRowsRaw as any[]) || [];

    // 3. Initialize metrics
    const matrix: Record<RightSchemeKey, Record<ServiceCategoryKey, MetricItem>> = {} as any;
    const byService: Record<ServiceCategoryKey, ServiceCategorySummary> = {} as any;
    const byRight: Record<RightSchemeKey, RightSchemeSummary> = {} as any;

    for (const rk of RIGHT_SCHEME_ORDER) {
      matrix[rk] = {} as any;
      for (const sk of SERVICE_CATEGORY_ORDER) {
        matrix[rk][sk] = emptyMetricItem();
      }
      byRight[rk] = {
        rightKey: rk,
        rightName: RIGHT_SCHEME_LABELS[rk].name,
        rightIcon: RIGHT_SCHEME_LABELS[rk].icon,
        rightDescription: RIGHT_SCHEME_LABELS[rk].description,
        subSchemes: [],
        ...emptyMetricItem(),
      };
    }

    const subSchemeMaps = new Map<RightSchemeKey, Map<string, SubSchemeDetail>>();
    for (const rk of RIGHT_SCHEME_ORDER) {
      subSchemeMaps.set(rk, new Map());
    }

    for (const sk of SERVICE_CATEGORY_ORDER) {
      byService[sk] = {
        categoryKey: sk,
        categoryName: SERVICE_CATEGORY_LABELS[sk].name,
        categoryIcon: SERVICE_CATEGORY_LABELS[sk].icon,
        categoryDescription: SERVICE_CATEGORY_LABELS[sk].description,
        smtAllocatedAmount: 0,
        smtNetTransferred: 0,
        topCCodes: [],
        ...emptyMetricItem(),
      };
    }

    // Load REP error catalog for descriptive root causes
    let errorCatalog: Record<string, any> = {};
    try {
      errorCatalog = loadErrorCatalog();
    } catch {
      // catalog optional fallback
    }

    const cCodeStatsMap = new Map<string, {
      code: string;
      count: number;
      amount: number;
      services: Set<string>;
    }>();

    const serviceCCodeMap = new Map<ServiceCategoryKey, Map<string, { code: string; count: number; amount: number }>>();
    for (const sk of SERVICE_CATEGORY_ORDER) {
      serviceCCodeMap.set(sk, new Map());
    }

    // 4. Track records and aggregate
    // Use deduplication key so visits appearing in both REP and STM are appropriately credited
    // A single visit has Claimed from REP/STM, and Paid from STM/INV.
    const visitAggregates = new Map<string, {
      serviceKey: ServiceCategoryKey;
      rightKey: RightSchemeKey;
      subSchemeName: string;
      claimedAmount: number;
      reimbursedAmount: number;
      hasC: boolean;
      cAmount: number;
      cCodes: string[];
    }>();

    const processRow = (row: any) => {
      const isRep = row.data_type === 'REP';
      const isStm = row.data_type === 'STM';
      const isInv = row.data_type === 'INV';

      const sKey = classifyServiceCategory(row.patient_type, row.department, row.an, row.filename, row.raw_data);
      const rKey = classifyRightScheme(row.maininscl, row.subinscl, row.filename, row.raw_data);

      if (params.serviceCategory && params.serviceCategory !== 'ALL' && sKey !== params.serviceCategory) return;
      if (params.rightScheme && params.rightScheme !== 'ALL' && rKey !== params.rightScheme) return;

      const rowAmount = Number(row.amount || 0);
      const rowInvoice = Number(row.invoice_amount || 0);
      const rowPaid = Number(row.paid_amount || 0);

      const claimed = isInv ? rowPaid : Math.max(rowInvoice, rowAmount, isStm ? rowPaid : 0);
      const paid = isRep ? 0 : Math.max(0, rowPaid);

      const cFlag = isCCode(row.errorcode);
      const errorCodes = String(row.errorcode || '')
        .split(/[,|;/\s]+/)
        .map(c => c.trim().toUpperCase())
        .filter(c => Boolean(c) && !['-', '0', 'NULL'].includes(c));

      // Key by vn/an or tran_id or id
      const visitKey = String(row.an || row.vn || row.tran_id || `ID_${row.id}`);

      let agg = visitAggregates.get(visitKey);
      if (!agg) {
        agg = {
          serviceKey: sKey,
          rightKey: rKey,
          subSchemeName: extractSubSchemeName(row),
          claimedAmount: claimed,
          reimbursedAmount: paid,
          hasC: cFlag,
          cAmount: cFlag ? claimed : 0,
          cCodes: errorCodes,
        };
        visitAggregates.set(visitKey, agg);
      } else {
        if (claimed > agg.claimedAmount) agg.claimedAmount = claimed;
        if (paid > agg.reimbursedAmount) agg.reimbursedAmount = paid;
        if (cFlag) {
          agg.hasC = true;
          agg.cAmount = Math.max(agg.cAmount, claimed);
        }
        for (const ec of errorCodes) {
          if (!agg.cCodes.includes(ec)) agg.cCodes.push(ec);
        }
      }

      // Track C-code details
      if (cFlag) {
        for (const code of errorCodes) {
          // Global
          const existing = cCodeStatsMap.get(code) || {
            code,
            count: 0,
            amount: 0,
            services: new Set<string>(),
          };
          existing.count++;
          existing.amount += claimed;
          existing.services.add(SERVICE_CATEGORY_LABELS[sKey].name);
          cCodeStatsMap.set(code, existing);

          // By service
          const sMap = serviceCCodeMap.get(sKey)!;
          const sExisting = sMap.get(code) || { code, count: 0, amount: 0 };
          sExisting.count++;
          sExisting.amount += claimed;
          sMap.set(code, sExisting);
        }
      }
    };

    for (const r of statementRows) processRow(r);
    for (const r of repDataRows) {
      // If visit wasn't already processed from repstm_statement_data, process it
      const visitKey = String(r.an || r.vn || r.tran_id || `REP_${r.id}`);
      if (!visitAggregates.has(visitKey)) {
        processRow(r);
      }
    }

    // Now roll up aggregates into matrix, byService, and byRight
    let totalClaimedAmount = 0;
    let totalClaimedCount = 0;
    let totalPendingCAmount = 0;
    let totalPendingCCount = 0;
    let totalReimbursedAmount = 0;
    let totalReimbursedCount = 0;

    for (const agg of visitAggregates.values()) {
      const sk = agg.serviceKey;
      const rk = agg.rightKey;

      const claimed = Math.round(agg.claimedAmount * 100) / 100;
      const reimbursed = Math.round(agg.reimbursedAmount * 100) / 100;
      const cAmount = agg.hasC ? Math.round(agg.cAmount * 100) / 100 : 0;

      // Matrix Cell
      const mCell = matrix[rk][sk];
      mCell.claimedAmount += claimed;
      mCell.claimedCount += 1;
      if (agg.hasC) {
        mCell.pendingCAmount += cAmount;
        mCell.pendingCCount += 1;
      }
      if (reimbursed > 0) {
        mCell.reimbursedAmount += reimbursed;
        mCell.reimbursedCount += 1;
      }

      // By Service
      const sItem = byService[sk];
      sItem.claimedAmount += claimed;
      sItem.claimedCount += 1;
      if (agg.hasC) {
        sItem.pendingCAmount += cAmount;
        sItem.pendingCCount += 1;
      }
      if (reimbursed > 0) {
        sItem.reimbursedAmount += reimbursed;
        sItem.reimbursedCount += 1;
      }

      // By Right
      const rItem = byRight[rk];
      rItem.claimedAmount += claimed;
      rItem.claimedCount += 1;
      if (agg.hasC) {
        rItem.pendingCAmount += cAmount;
        rItem.pendingCCount += 1;
      }
      if (reimbursed > 0) {
        rItem.reimbursedAmount += reimbursed;
        rItem.reimbursedCount += 1;
      }

      // Sub-schemes roll-up
      const subMap = subSchemeMaps.get(rk)!;
      let subDetail = subMap.get(agg.subSchemeName);
      if (!subDetail) {
        subDetail = {
          name: agg.subSchemeName,
          claimedAmount: 0,
          claimedCount: 0,
          reimbursedAmount: 0,
          reimbursedCount: 0,
          pendingCAmount: 0,
          pendingCCount: 0,
        };
        subMap.set(agg.subSchemeName, subDetail);
      }
      subDetail.claimedAmount += claimed;
      subDetail.claimedCount += 1;
      if (agg.hasC) {
        subDetail.pendingCAmount += cAmount;
        subDetail.pendingCCount += 1;
      }
      if (reimbursed > 0) {
        subDetail.reimbursedAmount += reimbursed;
        subDetail.reimbursedCount += 1;
      }

      // Hospital Overall
      totalClaimedAmount += claimed;
      totalClaimedCount += 1;
      if (agg.hasC) {
        totalPendingCAmount += cAmount;
        totalPendingCCount += 1;
      }
      if (reimbursed > 0) {
        totalReimbursedAmount += reimbursed;
        totalReimbursedCount += 1;
      }
    }

    for (const rk of RIGHT_SCHEME_ORDER) {
      byRight[rk].subSchemes = Array.from(subSchemeMaps.get(rk)!.values())
        .map(s => ({
          ...s,
          claimedAmount: Math.round(s.claimedAmount * 100) / 100,
          reimbursedAmount: Math.round(s.reimbursedAmount * 100) / 100,
          pendingCAmount: Math.round(s.pendingCAmount * 100) / 100,
        }))
        .sort((a, b) => b.claimedAmount - a.claimedAmount);
    }

    // 5. Integrate SMT / e-Budget transfers
    let totalSmtAllocatedAmount = 0;
    let totalSmtNetTransferred = 0;
    let totalSmtWaitAmount = 0;
    let totalSmtDebtAmount = 0;

    const smtTransfers: SmtBudgetComparison[] = [];

    for (const r of smtRows) {
      const fundName = String(r.fund_name || r.fund_descr || r.efund_desc || 'งบประมาณจัดสรร').trim();
      const sCat = mapSmtFundToServiceCategory(fundName, r.efund_desc, r.moph_desc);

      const alloc = Number(r.amount || 0);
      const net = Number(r.net_total || 0);
      const wait = Number(r.wait_amount || 0);
      const debt = Number(r.debt_amount || 0);

      totalSmtAllocatedAmount += alloc;
      totalSmtNetTransferred += net;
      totalSmtWaitAmount += wait;
      totalSmtDebtAmount += debt;

      // Add to corresponding service category
      byService[sCat].smtAllocatedAmount += alloc;
      byService[sCat].smtNetTransferred += net;

      // Determine match status
      const sItem = byService[sCat];
      let status: 'settled' | 'partial' | 'pending' = 'pending';
      if (net > 0 && sItem.reimbursedAmount >= net * 0.9) {
        status = 'settled';
      } else if (net > 0 && sItem.reimbursedAmount > 0) {
        status = 'partial';
      }

      smtTransfers.push({
        id: Number(r.id),
        budgetYear: String(r.budget_year || budgetYear),
        fundName,
        serviceCategory: sCat,
        categoryName: SERVICE_CATEGORY_LABELS[sCat].name,
        mophId: r.moph_id ? String(r.moph_id) : undefined,
        mophDesc: r.moph_desc ? String(r.moph_desc) : undefined,
        allocatedAmount: alloc,
        netTransferred: net,
        waitAmount: wait,
        debtAmount: debt,
        stmPaidAmount: sItem.reimbursedAmount,
        claimedAmount: sItem.claimedAmount,
        claimedCount: sItem.claimedCount,
        reimbursedAmount: sItem.reimbursedAmount,
        reimbursedCount: sItem.reimbursedCount,
        pendingCAmount: sItem.pendingCAmount,
        pendingCCount: sItem.pendingCCount,
        status,
        runDate: r.run_date ? String(r.run_date) : undefined,
        refDocNo: r.ref_doc_no ? String(r.ref_doc_no) : undefined,
        batchNo: r.batch_no ? String(r.batch_no) : undefined,
      });
    }

    // 6. Calculate reimbursement rates
    const calcRate = (paid: number, claimed: number) =>
      claimed > 0 ? Math.round((paid / claimed) * 10000) / 100 : 0;

    for (const rk of RIGHT_SCHEME_ORDER) {
      for (const sk of SERVICE_CATEGORY_ORDER) {
        const c = matrix[rk][sk];
        c.reimbursementRate = calcRate(c.reimbursedAmount, c.claimedAmount);
      }
      const r = byRight[rk];
      r.reimbursementRate = calcRate(r.reimbursedAmount, r.claimedAmount);
    }

    for (const sk of SERVICE_CATEGORY_ORDER) {
      const s = byService[sk];
      s.reimbursementRate = calcRate(s.reimbursedAmount, s.claimedAmount);

      // Top C-codes per service
      const sMap = serviceCCodeMap.get(sk)!;
      s.topCCodes = Array.from(sMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(item => {
          const catEntry = errorCatalog[item.code] || errorCatalog[item.code.replace(/^C/, '')];
          return {
            code: item.code,
            count: item.count,
            amount: Math.round(item.amount * 100) / 100,
            description: catEntry?.description || 'รหัสตรวจสอบเงื่อนไขการส่งเบิก',
          };
        });
    }

    // Top 10 C-codes overall
    const topCCodes: TopCCodeItem[] = Array.from(cCodeStatsMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(item => {
        const catEntry = errorCatalog[item.code] || errorCatalog[item.code.replace(/^C/, '')];
        return {
          code: item.code,
          count: item.count,
          amount: Math.round(item.amount * 100) / 100,
          description: catEntry?.description || 'รหัสตรวจสอบเงื่อนไขการส่งเบิก (C-Code / Deny)',
          guide: catEntry?.guide || 'ตรวจสอบความสมบูรณ์ของเอกสาร รหัสโรค หัตถการ หรือบันทึกบริการต้นทางใน HOSxP',
          category: catEntry?.category || (item.code.startsWith('C') ? 'C' : 'Deny'),
          affectedServices: Array.from(item.services),
        };
      });

    const overallRate = calcRate(totalReimbursedAmount, totalClaimedAmount);
    const varianceAmount = Math.max(0, totalClaimedAmount - totalReimbursedAmount);

    return {
      period: {
        startDate: params.startDate,
        endDate: params.endDate,
        budgetYear,
      },
      summary: {
        totalClaimedAmount: Math.round(totalClaimedAmount * 100) / 100,
        totalClaimedCount,
        totalPendingCAmount: Math.round(totalPendingCAmount * 100) / 100,
        totalPendingCCount,
        totalReimbursedAmount: Math.round(totalReimbursedAmount * 100) / 100,
        totalReimbursedCount,
        reimbursementRate: overallRate,
        totalSmtAllocatedAmount: Math.round(totalSmtAllocatedAmount * 100) / 100,
        totalSmtNetTransferred: Math.round(totalSmtNetTransferred * 100) / 100,
        totalSmtWaitAmount: Math.round(totalSmtWaitAmount * 100) / 100,
        totalSmtDebtAmount: Math.round(totalSmtDebtAmount * 100) / 100,
        varianceAmount: Math.round(varianceAmount * 100) / 100,
      },
      byService,
      byRight,
      matrix,
      smtTransfers,
      topCCodes,
    };
  } finally {
    repConn.release();
  }
}
