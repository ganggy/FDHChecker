import { getRepstmConnection, getUTFConnection } from './db/connection.js';
import { ensureRepstmTables } from './db/schema.js';
import { loadErrorCatalog } from './aiErrorTools.js';
import { parseFlexibleDateTime } from './utils/dataNormalization.js';

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

export interface ExecutivePipelineMetrics {
  totalHospitalVisits: number;
  hospitalOpdVisits: number;
  hospitalIpdVisits: number;
  totalClaimedCount: number;
  totalClaimedAmount: number;
  submissionRate: number;
  unclaimedCount: number;
  unclaimedRate: number;
  totalReimbursedCount: number;
  totalReimbursedAmount: number;
  reimbursementVisitRate: number;
  reimbursementAmountRate: number;
  totalDeniedCount: number;
  totalDeniedAmount: number;
  denialVisitRate: number;
  denialAmountRate: number;
  pendingTransferAmount: number;
  pendingTransferCount: number;
  pendingTransferRate: number;
  transferredAmount: number;
  transferredCount: number;
  transferredRate: number;
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
  pipeline: ExecutivePipelineMetrics;
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
  let rawMeta = '';
  let rawObj: any = null;
  if (typeof rawData === 'string') {
    try {
      rawObj = JSON.parse(rawData);
    } catch {
      rawMeta = rawData.slice(0, 200);
    }
  } else if (rawData && typeof rawData === 'object') {
    rawObj = rawData;
  }

  if (rawObj && typeof rawObj === 'object') {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(rawObj)) {
      if (v === null || v === undefined) continue;
      const keyUpper = k.toUpperCase().trim();
      const valStr = String(v).trim();

      // If it's a standard e-Claim column header where '-' or '0' means absent
      if (['DENT', 'OTHERS', 'AE', 'INST', 'IP', 'DMIS', 'DRUG', 'FS'].includes(keyUpper)) {
        if (!valStr || valStr === '-' || valStr === '0' || valStr === '0.00') {
          continue; // Skip this header completely so regex won't match 'dent' or 'others'
        }
        if (keyUpper === 'DENT') {
          parts.push('ทันตกรรม dental');
        } else if (keyUpper === 'OTHERS') {
          parts.push('บริการอื่นๆ');
        } else {
          parts.push(`${k} ${valStr}`);
        }
        continue;
      }

      // Special check for DMISHD or HD
      if (['DMISHD', 'HD'].includes(keyUpper)) {
        if (valStr && valStr !== '-' && valStr !== '0' && valStr !== '0.00') {
          parts.push('ฟอกไต dialysis');
        }
        continue;
      }

      // For all other fields (clinical columns, Thai headers, Diag, Proc, Projcode, etc.)
      parts.push(`${k} ${valStr}`);
    }
    rawMeta = parts.join(' ');
  }

  const combinedText = `${patientType || ''} ${department || ''} ${filename || ''} ${rawMeta}`.toLowerCase();

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
    combinedText.includes('dental') ||
    /\bdent\b/i.test(combinedText) ||
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

  // 6. IPD / OPD Classification based on explicit indicators
  const fileText = String(filename || '').toUpperCase();
  const rawText = rawMeta.toUpperCase();

  const isExplicitOp = (
    /(?:^|[_\s.-])OP(?:UCS|LGO|BKK|CS)?(?=[\d_\s.-]|$)/i.test(fileText) ||
    fileText.includes('OPUCS') || fileText.includes('OPLGO') || fileText.includes('OPBKK') || fileText.includes('OPCS') ||
    fileText.includes(' 1 OP') || fileText.includes(' 2 OP') || fileText.includes('(ข้อมูลปกติ) OP') ||
    department === 'OP' || department === 'OPD' ||
    (patientType && (patientType.toUpperCase().includes('OP') || patientType.includes('นอก'))) ||
    rawText.includes('พึงรับ OP')
  );

  const isExplicitIp = (
    /(?:^|[_\s.-])IP(?:UCS|LGO|BKK|CS)?(?=[\d_\s.-]|$)/i.test(fileText) ||
    fileText.includes('IPUCS') || fileText.includes('IPLGO') || fileText.includes('IPBKK') || fileText.includes('IPCS') ||
    fileText.includes('FOCD') || fileText.includes('_IP_') || fileText.includes(' IP ') || fileText.includes(' IP_') || fileText.includes('_IP.') ||
    department === 'IPD' || (patientType && (patientType.toUpperCase().includes('IP') || patientType.includes('ใน')))
  );

  // If explicit OP and not explicit IP, it is definitely OPD
  if (isExplicitOp && !isExplicitIp) {
    return 'OPD';
  }

  // Real AN check: AN is typically a 9-digit year-based admission number (e.g. 67xxxxxxx, 68xxxxxxx, 69xxxxxxx)
  // whereas NHSO TRAN_ID is 57xxxxxxx, 58xxxxxxx, etc.
  const cleanAn = String(an || '').trim();
  const isLikelyTranId = /^5\d{8}$/.test(cleanAn);
  const hasValidAn = cleanAn !== '' && cleanAn !== '0' && !isLikelyTranId;

  if (isExplicitIp || (hasValidAn && !isExplicitOp) || (department === 'IP' && !isExplicitOp)) {
    return 'IPD';
  }

  // 7. OPD:
  if (
    department === 'OP' ||
    department === 'OPD' ||
    (patientType && (patientType.toUpperCase().includes('OP') || patientType.includes('นอก'))) ||
    isExplicitOp
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

  // Extract specific textual metadata fields only (prevent column header false positives like "กองทุน IP พรบ.")
  let rawMeta = '';
  if (typeof rawData === 'string') {
    try {
      const obj = JSON.parse(rawData);
      rawMeta = [
        obj.pttype,
        obj.pttype_name,
        obj.maininscl,
        obj.subinscl,
        obj.fund,
        obj.projectcode,
        obj.note,
        obj.description,
        obj['ชดเชยจาก'],
        obj['สิทธิ'],
        obj['สิทธิการรักษา'],
      ].filter(Boolean).join(' ');
    } catch {
      rawMeta = rawData.slice(0, 200);
    }
  } else if (rawData && typeof rawData === 'object') {
    const obj = rawData as Record<string, unknown>;
    rawMeta = [
      obj.pttype,
      obj.pttype_name,
      obj.maininscl,
      obj.subinscl,
      obj.fund,
      obj.projectcode,
      obj.note,
      obj.description,
      obj['ชดเชยจาก'],
      obj['สิทธิ'],
      obj['สิทธิการรักษา'],
    ].filter(Boolean).join(' ');
  }

  const metaText = `${main} ${sub} ${fileStr} ${rawMeta}`.toUpperCase();

  // 1. OFC (Civil Servant / Comptroller General / ข้าราชการเบิกตรง)
  // รวมถึงระบบไต CHI / COCD / FOCD / CSCD / CHIHD / CORTBIL ของกรมบัญชีกลาง
  if (
    main === 'OFC' ||
    main === 'CS' ||
    main === 'CSMBS' ||
    main === 'CSCD' ||
    main === 'CHIHD' ||
    main === 'CORTBIL' ||
    fileStr.includes('COCD') ||
    fileStr.includes('FOCD') ||
    fileStr.includes('CHIHD') ||
    fileStr.includes('CHI_') ||
    fileStr.includes('CSCD') ||
    fileStr.includes('CORTBIL') ||
    fileStr.includes('OPCS') ||
    fileStr.includes('IPCS') ||
    fileStr.includes('CSMBS') ||
    fileStr.includes('OPBKK') ||
    fileStr.includes('IPBKK') ||
    metaText.includes('เบิกจ่ายตรง') ||
    metaText.includes('ข้าราชการ')
  ) {
    return 'OFC';
  }

  // 2. LGO (Local Government Organization / อปท.)
  // รวมถึง LGO-HD (ไตเทียม อปท.)
  if (
    main === 'LGO' ||
    main === 'BKK' ||
    main === 'PTY' ||
    fileStr.includes('LGO') ||
    fileStr.includes('IPLGO') ||
    fileStr.includes('OPLGO') ||
    metaText.includes('อปท') ||
    metaText.includes('ท้องถิ่น')
  ) {
    return 'LGO';
  }

  // 3. SSS (Social Security Scheme / ประกันสังคม)
  // รวมถึง SOCD / SSS-HD (ไตเทียม ประกันสังคม)
  if (
    main === 'SSS' ||
    main === 'SS' ||
    main === 'SOCD' ||
    fileStr.includes('SOCD') ||
    fileStr.includes('SSS') ||
    metaText.includes('ประกันสังคม')
  ) {
    return 'SSS';
  }

  // 4. A9 / INS (Car Accident Protection ACT / Compensation Fund)
  // ตรวจเฉพาะรหัสสิทธิหรือชื่อไฟล์หรือ metadata ที่เจาะจง พรบ.
  // ไม่ match ข้อความทั้งบรรทัดเพื่อป้องกันคอลัมน์ "กองทุน IP พรบ."
  if (
    main === 'INS' ||
    main === 'A9' ||
    main === 'ACT' ||
    fileStr.includes('A9') ||
    metaText.includes('คุ้มครองผู้ประสบภัย') ||
    metaText.includes('กองทุนเงินทดแทน') ||
    metaText.includes('พรบ.') ||
    metaText.includes('พ.ร.บ.') ||
    metaText.includes(' พรบ ') ||
    main.includes('พรบ')
  ) {
    return 'A9_INS';
  }

  // 5. Foreign / Self Pay (ต่างด้าว / ชำระเอง)
  if (
    main === 'NRD' ||
    main === 'A1' ||
    main === 'CSH' ||
    main === 'SELF' ||
    main === 'FRG' ||
    metaText.includes('ต่างด้าว') ||
    metaText.includes('จ่ายเอง') ||
    metaText.includes('ชำระเอง') ||
    metaText.includes('เงินสด')
  ) {
    return 'FOREIGN_SELF';
  }

  // 6. UCS (Universal Coverage Scheme / บัตรทอง สปสช.)
  // ครอบคลุม:
  // - รหัสหลัก: UCS, WEL, UC, PUC, UP
  // - รหัสรายการ Statement UC: HC.., IP.., AE.., DM.., ANC
  // - ไฟล์ e-Claim: ECLAIM, E-CLAIM, NHSO, STATEMENT UC, OPUCS, IPUCS, DCKD, STM_11101_IP, STM_11101_OP, R08
  const isUcs =
    main === 'UCS' ||
    main === 'WEL' ||
    main === 'UC' ||
    main === 'PUC' ||
    main === 'UP' ||
    main === 'HD' ||
    main.startsWith('HC') ||
    main.startsWith('IP') ||
    main.startsWith('AE') ||
    main.startsWith('DM') ||
    main === 'ANC' ||
    fileStr.includes('ECLAIM') ||
    fileStr.includes('E-CLAIM') ||
    fileStr.includes('UCS') ||
    fileStr.includes('UC') ||
    fileStr.includes('NHSO') ||
    fileStr.includes('DCKD') ||
    fileStr.includes('OPUCS') ||
    fileStr.includes('IPUCS') ||
    fileStr.includes('STM_11101_IP') ||
    fileStr.includes('STM_11101_OP') ||
    fileStr.includes('R08') ||
    metaText.includes('บัตรทอง') ||
    metaText.includes('หลักประกัน') ||
    metaText.includes('สปสช') ||
    metaText.includes('NHSO');

  if (isUcs) {
    if (
      sub === '91' ||
      sub === '92' ||
      sub === '93' ||
      sub === '94' ||
      sub === '95' ||
      sub === '96' ||
      sub.includes('OUT') ||
      sub.includes('AE') ||
      sub.includes('WALKIN') ||
      sub.includes('ANYWHERE') ||
      fileStr.includes('OUTCUP') ||
      fileStr.includes('OUT_CUP') ||
      metaText.includes('นอกCUP') ||
      metaText.includes('นอกเขต') ||
      metaText.includes('ข้ามเขต') ||
      metaText.includes('ปฐมภูมิไปที่ไหนก็ได้') ||
      metaText.includes('WALKIN')
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
  UCS: 'UCS (สิทธิหลักประกันสุขภาพถ้วนหน้า)',
  WEL: 'WEL (สิทธิสวัสดิการผู้มีรายได้น้อย/ชุมชน)',
  PUC: 'PUC (สิทธิหลักประกันสุขภาพถ้วนหน้า)',
  UP: 'UP (สิทธิบัตรทอง)',
  OFC: 'OFC (ข้าราชการ กรมบัญชีกลาง)',
  CSMBS: 'CSMBS (สิทธิสวัสดิการรักษาพยาบาลข้าราชการ)',
  LGO: 'LGO (ข้าราชการท้องถิ่น อปท.)',
  SSS: 'SSS (ประกันสังคม)',
  ACT: 'ACT (พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ)',
  A9: 'A9 (กองทุนเงินทดแทน)',
  '71': '71 (เด็กอายุ 0-12 ปีบริบูรณ์)',
  '72': '72 (ผู้สูงอายุเกิน 60 ปีบริบูรณ์)',
  '73': '73 (คนพิการ)',
  '74': '74 (ผู้มีรายได้น้อย)',
  '75': '75 (ผู้นำชุมชน/อสม.)',
  '76': '76 (ทหารผ่านศึก)',
  '77': '77 (พระภิกษุ/สามเณร/ผู้นำศาสนา)',
  '82': '82 (นักเรียน/เยาวชน)',
  '88': '88 (ประชาชนทั่วไปใน CUP)',
  '89': '89 (บริการปฐมภูมิ/ทั่วไป)',
  '90': '90 (บุคคลที่มีปัญหาสถานะ/สิทธิ)',
  '91': '91 (ผู้มีสิทธิสวัสดิการข้ามเขต)',
  '94': '94 (ผู้ประสบอุบัติเหตุ/ฉุกเฉิน)',
  '95': '95 (บริการพิเศษ/ส่งต่อ)',
  O1: 'O1 (ข้าราชการ/ลูกจ้างประจำ)',
  O2: 'O2 (บุคคลในครอบครัวข้าราชการ)',
  O3: 'O3 (ข้าราชการบำนาญ)',
  O4: 'O4 (ครอบครัวข้าราชการบำนาญ)',
  L1: 'L1 (ข้าราชการ อปท.)',
  L2: 'L2 (ครอบครัว อปท.)',
  S1: 'S1 (ผู้ประกันตน ม.33)',
  S2: 'S2 (ผู้ประกันตน ม.39)',
  S3: 'S3 (ผู้ประกันตน ม.40)',
  ANC: 'ANC (ฝากครรภ์และส่งเสริมสุขภาพ)',
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
    if (base.includes('OPUCS') || base.includes('IPUCS')) return 'e-Claim UCS (สปสช.)';
    if (base.includes('ECLAIM')) return 'e-Claim (สปสช.)';
    return base.slice(0, 16);
  } else {
    return 'ไม่ระบุรหัสย่อย';
  }

  const upper = raw.toUpperCase();
  if (SUB_SCHEME_FRIENDLY_NAMES[upper]) {
    return SUB_SCHEME_FRIENDLY_NAMES[upper];
  }
  if (upper.startsWith('HC')) return `HC (บริการปฐมภูมิ: ${upper})`;
  if (upper.startsWith('IP')) return `IP (บริการผู้ป่วยใน: ${upper})`;
  if (upper.startsWith('AE')) return `AE (อุบัติเหตุฉุกเฉิน: ${upper})`;
  if (upper.startsWith('DM')) return `DMIS (โรคเรื้อรัง: ${upper})`;

  return raw;
}


/**
 * Query total hospital patient visits (OPD visits and IPD admissions) from HOSxP.
 */
export async function getHospitalVisits(
  hosConn: any,
  params: {
    startDate?: string;
    endDate?: string;
    budgetYear?: string;
    serviceCategory?: string;
    rightScheme?: string;
  }
): Promise<{ total: number; opd: number; ipd: number }> {
  // Determine date bounds
  let sDate = params.startDate;
  let eDate = params.endDate;
  if (!sDate || !eDate) {
    if (params.budgetYear) {
      const by = parseInt(params.budgetYear, 10);
      if (!isNaN(by) && by > 2500) {
        sDate = `${by - 543 - 1}-10-01`;
        eDate = `${by - 543}-09-30`;
      }
    }
  }

  let ovstWhere = 'WHERE 1=1';
  let iptWhere = 'WHERE 1=1';
  const ovstParams: any[] = [];
  const iptParams: any[] = [];

  if (sDate && eDate) {
    ovstWhere += ' AND o.vstdate >= ? AND o.vstdate <= ?';
    ovstParams.push(sDate, eDate);
    iptWhere += ' AND i.regdate >= ? AND i.regdate <= ?';
    iptParams.push(sDate, eDate);
  }

  let countOpd = true;
  let countIpd = true;
  let joinPttype = false;

  // Right Scheme mapping
  if (params.rightScheme && params.rightScheme !== 'ALL') {
    joinPttype = true;
    let hipCodes: string[] = [];
    if (params.rightScheme === 'OFC') hipCodes = ['OFC', 'CS'];
    else if (params.rightScheme === 'LGO') hipCodes = ['LGO'];
    else if (params.rightScheme === 'SSS') hipCodes = ['SSS', 'SSI'];
    else if (params.rightScheme === 'UCS_INCUP' || params.rightScheme === 'UCS_OUTCUP') hipCodes = ['UCS', 'WEL', 'UP', 'PUC'];
    else if (params.rightScheme === 'A9_INS') hipCodes = ['ACT', 'A9', 'INS'];
    else if (params.rightScheme === 'FOREIGN_SELF') hipCodes = ['FRG', 'CSH', 'NRD', 'DIS'];

    if (hipCodes.length > 0) {
      ovstWhere += ` AND p.hipdata_code IN (${hipCodes.map(() => '?').join(',')})`;
      ovstParams.push(...hipCodes);
      iptWhere += ` AND p.hipdata_code IN (${hipCodes.map(() => '?').join(',')})`;
      iptParams.push(...hipCodes);
    }
  }

  // Service Category mapping
  if (params.serviceCategory && params.serviceCategory !== 'ALL') {
    if (params.serviceCategory === 'IPD') {
      countOpd = false;
    } else if (params.serviceCategory === 'OPD') {
      countIpd = false;
    } else if (params.serviceCategory === 'DENTAL') {
      countIpd = false;
      ovstWhere += " AND (o.main_dep IN ('005', '048') OR EXISTS (SELECT 1 FROM dtmain dt WHERE dt.vn = o.vn))";
    } else if (params.serviceCategory === 'THAI_MED') {
      countIpd = false;
      ovstWhere += " AND o.main_dep = '025'";
    } else if (params.serviceCategory === 'PHYSICAL_THERAPY') {
      countIpd = false;
      ovstWhere += " AND o.main_dep = '012'";
    } else if (params.serviceCategory === 'DIALYSIS') {
      countIpd = false;
      ovstWhere += " AND o.main_dep = '060'";
    }
  }

  let opdCount = 0;
  let ipdCount = 0;

  try {
    if (countOpd) {
      const fromClause = joinPttype ? 'FROM ovst o JOIN pttype p ON o.pttype = p.pttype' : 'FROM ovst o';
      const [opdRows] = await hosConn.query(`SELECT COUNT(*) as cnt ${fromClause} ${ovstWhere}`, ovstParams);
      opdCount = Number((opdRows as any[])[0]?.cnt || 0);
    }

    if (countIpd) {
      const fromClause = joinPttype ? 'FROM ipt i JOIN pttype p ON i.pttype = p.pttype' : 'FROM ipt i';
      const [ipdRows] = await hosConn.query(`SELECT COUNT(*) as cnt ${fromClause} ${iptWhere}`, iptParams);
      ipdCount = Number((ipdRows as any[])[0]?.cnt || 0);
    }
  } catch (err) {
    console.warn('[ExecutiveMonitor] Error counting hospital visits:', err);
  }

  return {
    total: opdCount + ipdCount,
    opd: opdCount,
    ipd: ipdCount,
  };
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

  const isAllYears = budgetYear.toUpperCase() === 'ALL';
  let effectiveStartDate = params.startDate;
  let effectiveEndDate = params.endDate;
  if (!effectiveStartDate || !effectiveEndDate) {
    if (!isAllYears) {
      const by = parseInt(budgetYear, 10);
      if (!isNaN(by) && by > 2500) {
        effectiveStartDate = `${by - 543 - 1}-10-01`;
        effectiveEndDate = `${by - 543}-09-30`;
      }
    }
  }

  const repConn = await getRepstmConnection();

  // Preload HOSxP clinical data: dental registry and total hospital visits
  let dentalVnSet = new Set<string>();
  let hospitalVisits = { total: 0, opd: 0, ipd: 0 };
  try {
    const hosConn = await getUTFConnection();
    try {
      const [dtRows] = await hosConn.query(
        effectiveStartDate && effectiveEndDate
          ? `SELECT DISTINCT vn FROM dtmain WHERE vn IS NOT NULL AND vstdate >= ? AND vstdate <= ?`
          : `SELECT DISTINCT vn FROM dtmain WHERE vn IS NOT NULL`,
        effectiveStartDate && effectiveEndDate ? [effectiveStartDate, effectiveEndDate] : []
      );
      dentalVnSet = new Set((dtRows as any[]).map(r => String(r.vn)));

      hospitalVisits = await getHospitalVisits(hosConn, {
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        budgetYear,
        serviceCategory: params.serviceCategory,
        rightScheme: params.rightScheme,
      });
    } finally {
      hosConn.release();
    }
  } catch (err) {
    console.warn('[ExecutiveMonitor] Unable to load HOSxP clinical visits/dtmain (continuing with statement data):', err);
  }

  try {
    // 1. Fetch SMT transfers for the budget year
    const smtQuery = isAllYears
      ? `SELECT * FROM smt_budget_transfers ORDER BY run_date DESC, id DESC`
      : `SELECT * FROM smt_budget_transfers WHERE budget_year = ? ORDER BY run_date DESC, id DESC`;
    const smtParams = isAllYears ? [] : [budgetYear];
    const [smtRowsRaw] = await repConn.query(smtQuery, smtParams);
    const smtRows = (smtRowsRaw as any[]) || [];

    // 2. Fetch Statement data (both STM and REP)
    let statementWhere = `WHERE NOT EXISTS (
      SELECT 1 FROM repstm_import_batch replacement 
      WHERE replacement.replaces_batch_id = repstm_statement_data.batch_id
    )`;
    const statementQueryParams: unknown[] = [];

    if (effectiveStartDate && effectiveEndDate) {
      statementWhere += ` AND (
        (service_datetime >= ? AND service_datetime <= ?)
        OR (senddate >= ? AND senddate <= ?)
        OR (created_at >= ? AND created_at <= ?)
      )`;
      const startDateTime = `${effectiveStartDate} 00:00:00`;
      const endDateTime = `${effectiveEndDate} 23:59:59`;
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
    if (effectiveStartDate && effectiveEndDate) {
      repDataWhere += ` AND (
        (admdate >= ? AND admdate <= ?)
        OR (senddate >= ? AND senddate <= ?)
        OR (created_at >= ? AND created_at <= ?)
      )`;
      const startDateTime = `${effectiveStartDate} 00:00:00`;
      const endDateTime = `${effectiveEndDate} 23:59:59`;
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

    const tranIdToVisitKey = new Map<string, string>();

    const processRow = (row: any) => {
      // Extract raw_data JSON object if available
      let rawObj: any = null;
      if (row.raw_data) {
        if (typeof row.raw_data === 'string') {
          try { rawObj = JSON.parse(row.raw_data); } catch {}
        } else if (typeof row.raw_data === 'object') {
          rawObj = row.raw_data;
        }
      }

      // Multi-hospital summary file filter (e.g. R08 regional reports):
      // Only keep records for this hospital ('11101') if the record has an explicit external hospital code
      if (rawObj) {
        const rowHcode = String(rawObj['รหัส'] || rawObj['HCODE'] || rawObj['hcode'] || rawObj['HOSPCODE'] || '').trim();
        if (rowHcode && /^\d{5}$/.test(rowHcode) && rowHcode !== '11101') {
          return; // Skip data belonging to other hospitals in regional multi-hospital files
        }
      }

      // Extract or derive real clinical service date
      let rowDate = row.service_date || '';
      if (!rowDate && rawObj) {
        const rawDateStr = rawObj['วันเข้ารักษา'] || rawObj['วันที่รับบริการ'] || rawObj['วันที่'] || rawObj['DATE_SERV'] || rawObj['vstdate'] || rawObj['dateadm'] || '';
        const parsed = parseFlexibleDateTime(rawDateStr);
        if (parsed) rowDate = parsed.slice(0, 10);
      }
      if (!rowDate && row.send_date) {
        rowDate = row.send_date;
      }
      if (!rowDate && row.filename) {
        const m = String(row.filename).match(/25(\d{2})(\d{2})/);
        if (m) {
          const beYear = parseInt(`25${m[1]}`, 10);
          const month = m[2];
          const ceYear = beYear - 543;
          rowDate = `${ceYear}-${month}-15`;
        }
      }

      // If user filtered by a specific date range / fiscal year, ensure the row's service date matches
      if (effectiveStartDate && effectiveEndDate && rowDate) {
        if (rowDate < effectiveStartDate || rowDate > effectiveEndDate) return;
      }

      const vn = String(row.vn || rawObj?.['SEQ NO'] || rawObj?.vn || rawObj?.VN || '').trim();
      const isDental = vn !== '' && dentalVnSet.has(vn);

      const sKey = isDental
        ? 'DENTAL'
        : classifyServiceCategory(row.patient_type, row.department, row.an, row.filename, row.raw_data);
      const rKey = classifyRightScheme(row.maininscl, row.subinscl, row.filename, row.raw_data);

      if (params.serviceCategory && params.serviceCategory !== 'ALL' && sKey !== params.serviceCategory) return;
      if (params.rightScheme && params.rightScheme !== 'ALL' && rKey !== params.rightScheme) return;

      const isInv = row.data_type === 'INV';
      const isStm = row.data_type === 'STM';

      const rowAmount = Number(row.amount || 0);
      const rowInvoice = Number(row.invoice_amount || 0);
      const rowPaid = Number(row.paid_amount || 0);

      const claimed = isInv ? rowPaid : Math.max(rowInvoice, rowAmount, isStm ? rowPaid : 0);
      // Reimbursed amount: recognized whenever paid_amount / compensated is recorded
      const paid = Math.max(0, rowPaid);

      const cFlag = isCCode(row.errorcode);
      const errorCodes = String(row.errorcode || '')
        .split(/[,|;/\s]+/)
        .map(c => c.trim().toUpperCase())
        .filter(c => Boolean(c) && !['-', '0', 'NULL'].includes(c));

      // Key by vn/an or tran_id or id with cross-referencing between tables
      const tranId = (row.tran_id && String(row.tran_id).trim() !== '') ? String(row.tran_id).trim() : null;
      const cleanAn = String(row.an || '').trim();
      const isLikelyTranId = /^5\d{8}$/.test(cleanAn);
      const hasRealAn = cleanAn !== '' && cleanAn !== '0' && !isLikelyTranId;

      let visitKey = '';
      if (tranId && tranIdToVisitKey.has(tranId)) {
        visitKey = tranIdToVisitKey.get(tranId)!;
      } else if (hasRealAn && (row.patient_type === 'IP' || sKey === 'IPD')) {
        visitKey = 'AN_' + cleanAn;
      } else if (vn) {
        visitKey = 'VN_' + vn;
      } else if (tranId || isLikelyTranId) {
        visitKey = 'TRAN_' + (tranId || cleanAn);
      } else {
        visitKey = 'ID_' + (row.data_type || '') + '_' + row.id;
      }
      if (tranId) tranIdToVisitKey.set(tranId, visitKey);

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
        // Upgrade to DENTAL if either statement or HOSxP indicates dental care
        if (sKey === 'DENTAL' && agg.serviceKey !== 'DENTAL') {
          agg.serviceKey = 'DENTAL';
        }
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
    for (const r of repDataRows) processRow(r);

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

    const totalHospitalVisits = hospitalVisits.total;
    const hospitalOpdVisits = hospitalVisits.opd;
    const hospitalIpdVisits = hospitalVisits.ipd;

    const submissionRate = totalHospitalVisits > 0
      ? Math.min(100, Math.round((totalClaimedCount / totalHospitalVisits) * 10000) / 100)
      : (totalClaimedCount > 0 ? 100 : 0);
    const unclaimedCount = Math.max(0, totalHospitalVisits - totalClaimedCount);
    const unclaimedRate = totalHospitalVisits > 0
      ? Math.round((unclaimedCount / totalHospitalVisits) * 10000) / 100
      : 0;

    const reimbursementVisitRate = totalClaimedCount > 0
      ? Math.round((totalReimbursedCount / totalClaimedCount) * 10000) / 100
      : 0;
    const reimbursementAmountRate = totalClaimedAmount > 0
      ? Math.round((totalReimbursedAmount / totalClaimedAmount) * 10000) / 100
      : 0;

    const denialVisitRate = totalClaimedCount > 0
      ? Math.round((totalPendingCCount / totalClaimedCount) * 10000) / 100
      : 0;
    const denialAmountRate = totalClaimedAmount > 0
      ? Math.round((totalPendingCAmount / totalClaimedAmount) * 10000) / 100
      : 0;

    const pendingTransferAmount = Math.round(totalSmtWaitAmount * 100) / 100;
    const pendingTransferCount = smtRows.filter(r => Number(r.wait_amount || 0) > 0).length;
    const pendingTransferRate = totalSmtAllocatedAmount > 0
      ? Math.round((totalSmtWaitAmount / totalSmtAllocatedAmount) * 10000) / 100
      : 0;

    const transferredAmount = Math.round(totalSmtNetTransferred * 100) / 100;
    const transferredCount = smtRows.filter(r => Number(r.net_total || 0) > 0).length;
    const transferredRate = totalSmtAllocatedAmount > 0
      ? Math.round((totalSmtNetTransferred / totalSmtAllocatedAmount) * 10000) / 100
      : 0;

    const pipeline: ExecutivePipelineMetrics = {
      totalHospitalVisits,
      hospitalOpdVisits,
      hospitalIpdVisits,
      totalClaimedCount,
      totalClaimedAmount: Math.round(totalClaimedAmount * 100) / 100,
      submissionRate,
      unclaimedCount,
      unclaimedRate,
      totalReimbursedCount,
      totalReimbursedAmount: Math.round(totalReimbursedAmount * 100) / 100,
      reimbursementVisitRate,
      reimbursementAmountRate,
      totalDeniedCount: totalPendingCCount,
      totalDeniedAmount: Math.round(totalPendingCAmount * 100) / 100,
      denialVisitRate,
      denialAmountRate,
      pendingTransferAmount,
      pendingTransferCount,
      pendingTransferRate,
      transferredAmount,
      transferredCount,
      transferredRate,
    };

    return {
      period: {
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
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
      pipeline,
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
