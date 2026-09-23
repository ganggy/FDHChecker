import { getUTFConnection } from './db.js';

export type DentalCategory =
  | 'ALL'
  | 'SCALING'
  | 'FILLING'
  | 'EXTRACTION'
  | 'EXAM'
  | 'PREVENTION'
  | 'ANC'
  | 'PROSTHODONTIC'
  | 'OTHER';

export type DentalAuditIssue = {
  code: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  recommendation: string;
  category: 'dental' | 'clinical' | 'billing';
  autoFixable?: boolean;
  fixAction?: DentalAutoFixAction;
};

export type DentalAutoFixAction =
  | 'ADD_K051'
  | 'ADD_K021'
  | 'ADD_K011'
  | 'SWAP_Z012'
  | 'ADD_DENTAL_PDX'
  | 'SYNC_DENTAL_PROC'
  | 'REMOVE_NUMERIC_DX'
  | 'ADD_DENTAL_EXAM'
  | 'REMOVE_ANC_PROC'
  | 'REMOVE_DUP_DX';

export type DentalAuditVisit = {
  vn: string;
  hn: string;
  patient_name: string;
  sex: string;
  age_y: number;
  service_date: string;
  service_time: string;
  pttype: string;
  pttype_name: string;
  pttype_group: 'UC' | 'SSS' | 'OFC' | 'LGO' | 'CASH' | 'OTHER';
  department: string;
  diagnoses: Array<{
    code: string;
    name?: string;
    diagtype: string;
  }>;
  procedures: Array<{
    code: string;
    name?: string;
    type?: string;
    tooth?: string;
    tmcode?: string;
    icd10tm?: string;
  }>;
  chargeItems: Array<{
    icode: string;
    name?: string;
    qty?: number;
    unitprice?: number;
    sum_price?: number;
    income?: string;
  }>;
  total_charge: number;
  categories: DentalCategory[];
  issues: DentalAuditIssue[];
  audit_status: 'critical' | 'warning' | 'valid';
  can_auto_fix: boolean;
  auto_fix_actions: DentalAutoFixAction[];
};

export type DentalAuditSummary = {
  total_visits: number;
  valid_count: number;
  critical_count: number;
  warning_count: number;
  auto_fixable_count: number;
  total_amount: number;
  by_category: Record<DentalCategory, number>;
  by_scheme: {
    uc: number;
    sss: number;
    ofc: number;
    lgo: number;
    cash: number;
    other: number;
  };
};

const cleanCode = (val: unknown) =>
  String(val || '')
    .trim()
    .toUpperCase()
    .replace(/[.\s-]/g, '');

export const classifyDentalCategories = (
  procedures: Array<{ code: string; name?: string }>,
  diagnoses: Array<{ code: string; name?: string }>,
  chargeItems: Array<{ icode: string; name?: string; income?: string }>
): DentalCategory[] => {
  const cats = new Set<DentalCategory>();
  const procs = procedures || [];
  const diags = diagnoses || [];

  for (const p of procs) {
    const c = cleanCode(p.code);
    const n = String(p.name || '').toLowerCase();

    // SCALING (ขูดหินปูน / ปริทันต์)
    if (
      c === '9654' ||
      c === '9651' ||
      c === '2387010' ||
      c === '2277310' ||
      c === '2287310' ||
      n.includes('ขูดหินปูน') ||
      n.includes('ขัดฟัน') ||
      n.includes('scaling') ||
      n.includes('prophylaxis') ||
      n.includes('ปริทันต์')
    ) {
      cats.add('SCALING');
    }

    // FILLING (อุดฟัน / ฟันผุ)
    if (
      c.startsWith('232') ||
      c.startsWith('234') ||
      c === '232' ||
      c === '234' ||
      c === '23.2' ||
      c === '23.4' ||
      n.includes('อุดฟัน') ||
      n.includes('amalgam') ||
      n.includes('composite') ||
      n.includes('glass ionomer') ||
      n.includes('restoration')
    ) {
      cats.add('FILLING');
    }

    // EXTRACTION (ถอนฟัน / ผ่าฟันคุด / ศัลย์)
    if (
      c.startsWith('230') ||
      c.startsWith('231') ||
      c === '230' ||
      c === '231' ||
      c === '2319' ||
      c === '23.0' ||
      c === '23.1' ||
      c === '23.19' ||
      n.includes('ถอนฟัน') ||
      n.includes('ผ่าฟันคุด') ||
      n.includes('extraction') ||
      n.includes('impaction') ||
      n.includes('ผ่าตัด') ||
      n.includes('ศัลย์')
    ) {
      cats.add('EXTRACTION');
    }

    // EXAM (ตรวจฟัน / ให้คำแนะนำ)
    if (
      c === '2330010' ||
      c === '8931' ||
      c === '89.31' ||
      n.includes('ตรวจสุขภาพช่องปาก') ||
      n.includes('ตรวจฟัน') ||
      n.includes('oral exam')
    ) {
      cats.add('EXAM');
    }

    // PREVENTION (ทันตกรรมป้องกัน / ฟลูออไรด์ / เคลือบหลุมร่องฟัน)
    if (
      c.startsWith('2387') ||
      c.startsWith('2330') ||
      n.includes('เคลือบหลุมร่องฟัน') ||
      n.includes('sealant') ||
      n.includes('ฟลูออไรด์') ||
      n.includes('fluoride') ||
      n.includes('ป้องกัน')
    ) {
      cats.add('PREVENTION');
    }

    // ANC (ทันตกรรมหญิงตั้งครรภ์)
    if (
      c === '2330011' ||
      (c === '2387010' && (n.includes('ครรภ์') || n.includes('anc'))) ||
      n.includes('หญิงมีครรภ์') ||
      n.includes('หญิงตั้งครรภ์') ||
      n.includes('anc')
    ) {
      cats.add('ANC');
    }

    // PROSTHODONTIC (ฟันเทียม / รากฟันเทียม)
    if (
      c.startsWith('234') ||
      c === '9997' ||
      c === '99.97' ||
      n.includes('ฟันเทียม') ||
      n.includes('denture') ||
      n.includes('รากฟันเทียม') ||
      n.includes('implant')
    ) {
      cats.add('PROSTHODONTIC');
    }
  }

  // Check from diagnoses if procedures were empty
  for (const d of diags) {
    const c = cleanCode(d.code);
    if (c.startsWith('K05')) cats.add('SCALING');
    else if (c.startsWith('K02')) cats.add('FILLING');
    else if (c.startsWith('K01')) cats.add('EXTRACTION');
    else if (c.startsWith('Z012')) cats.add('EXAM');
    else if (c.startsWith('Z298')) cats.add('PREVENTION');
    else if (c.startsWith('Z34') || c.startsWith('Z35')) cats.add('ANC');
    else if (c.startsWith('K081') || c.startsWith('K084')) cats.add('PROSTHODONTIC');
  }

  // Check from charge items if still empty
  if (cats.size === 0) {
    for (const ci of chargeItems) {
      const n = String(ci.name || '').toLowerCase();
      if (n.includes('ขูดหินปูน') || n.includes('ขัดฟัน')) cats.add('SCALING');
      else if (n.includes('อุดฟัน')) cats.add('FILLING');
      else if (n.includes('ถอนฟัน') || n.includes('ผ่าฟัน')) cats.add('EXTRACTION');
      else if (n.includes('ตรวจ')) cats.add('EXAM');
      else if (n.includes('ฟันเทียม')) cats.add('PROSTHODONTIC');
    }
  }

  if (cats.size === 0) {
    cats.add('OTHER');
  }

  return Array.from(cats);
};

export const classifyPttypeGroup = (
  pcode?: string,
  hipdataCode?: string,
  name?: string
): 'UC' | 'SSS' | 'OFC' | 'LGO' | 'CASH' | 'OTHER' => {
  const p = String(pcode || '').trim().toUpperCase();
  const hip = String(hipdataCode || '').trim().toUpperCase();
  const n = String(name || '').toLowerCase();

  if (p === 'UC' || hip === 'UCS' || n.includes('ประกันสุขภาพถ้วนหน้า') || n.includes('บัตรทอง') || n.includes('uc')) {
    return 'UC';
  }
  if (p === 'SS' || hip === 'SSS' || n.includes('ประกันสังคม')) {
    return 'SSS';
  }
  if (p === 'LG' || hip === 'LGO' || n.includes('อปท') || n.includes('ท้องถิ่น')) {
    return 'LGO';
  }
  if (p === 'OF' || hip === 'OFC' || n.includes('ข้าราชการ') || n.includes('จ่ายตรง')) {
    return 'OFC';
  }
  if (p === 'AA' || n.includes('ชำระเงิน') || n.includes('เงินสด') || n.includes('ต่างด้าว')) {
    return 'CASH';
  }
  return 'OTHER';
};

export const evaluateDentalVisitAudit = (visit: {
  vn: string;
  hn: string;
  patient_name?: string;
  sex?: string;
  age_y?: number;
  service_date: string;
  service_time?: string;
  pttype?: string;
  pttype_group?: 'UC' | 'SSS' | 'OFC' | 'LGO' | 'CASH' | 'OTHER';
  department?: string;
  diagnoses: Array<{ code: string; name?: string; diagtype: string }>;
  procedures: Array<{ code: string; name?: string; type?: string; tooth?: string; tmcode?: string; icd10tm?: string }>;
  chargeItems?: Array<{ icode: string; name?: string; qty?: number; unitprice?: number; sum_price?: number; income?: string }>;
  total_charge?: number;
}): {
  categories: DentalCategory[];
  issues: DentalAuditIssue[];
  audit_status: 'critical' | 'warning' | 'valid';
  total_charge: number;
  can_auto_fix: boolean;
  auto_fix_actions: DentalAutoFixAction[];
} => {
  const issues: DentalAuditIssue[] = [];
  const diagnoses = visit.diagnoses || [];
  const procedures = visit.procedures || [];
  const chargeItems = visit.chargeItems || [];

  const pdxList = diagnoses.filter((d) => String(d.diagtype).trim() === '1');
  const pdx = pdxList[0]?.code ? cleanCode(pdxList[0].code) : '';
  const secondaryDx = diagnoses
    .filter((d) => String(d.diagtype).trim() !== '1')
    .map((d) => cleanCode(d.code))
    .filter(Boolean);
  const allDxCodes = diagnoses.map((d) => cleanCode(d.code)).filter(Boolean);

  let totalCharge = Number(visit.total_charge || 0);
  if (!totalCharge && chargeItems.length > 0) {
    totalCharge = chargeItems.reduce(
      (sum, item) => sum + Number(item.sum_price ?? (Number(item.qty || 0) * Number(item.unitprice || 0))),
      0
    );
  }

  const categories = classifyDentalCategories(procedures, diagnoses, chargeItems);

  // Dental Audit Rules

  // Rule 1: ขูดหินปูน (Scaling: 9654, 9651, 2387010, 2277310, 2287310)
  const hasScalingProc = procedures.some((p) => {
    const c = cleanCode(p.code);
    return (
      c === '9654' ||
      c === '9651' ||
      c === '2387010' ||
      c === '2277310' ||
      c === '2287310' ||
      String(p.name || '').includes('ขูดหินปูน') ||
      String(p.name || '').includes('ขัดฟัน')
    );
  });
  if (hasScalingProc) {
    const hasGingivitisDx = allDxCodes.some((c) => c.startsWith('K05'));
    const isPrimaryCaries = pdx.startsWith('K02');
    if (!hasGingivitisDx && isPrimaryCaries) {
      issues.push({
        code: 'C-804-SCALING',
        level: 'critical',
        title: 'หัตถการขูดหินปูน (96.54) แต่ให้รหัสโรคฟันผุ (K02.x) เป็นโรคหลัก',
        detail:
          'หัตถการขูดหินปูนเพื่อรักษาเหงือกอักเสบ ต้องมีรหัสวินิจฉัยกลุ่มโรคเหงือก (K05.0 หรือ K05.1) หากลงเฉพาะ K02.1 เสี่ยงติด C Error 804 หรือปฏิเสธการจ่าย',
        recommendation: 'เพิ่มรหัส K05.1 (Chronic gingivitis) เป็นโรครอง (diagtype=2)',
        category: 'dental',
        autoFixable: true,
        fixAction: 'ADD_K051',
      });
    }
  }

  // Rule 2: อุดฟัน (Filling / Restoration: 23.2, 23.4, 234xxxx)
  const hasFillingProc = procedures.some((p) => {
    const c = cleanCode(p.code);
    return (
      c.startsWith('232') ||
      c.startsWith('234') ||
      c === '232' ||
      c === '234' ||
      String(p.name || '').includes('อุดฟัน')
    );
  });
  if (hasFillingProc) {
    const hasCariesDx = allDxCodes.some((c) => c.startsWith('K02'));
    if (!hasCariesDx) {
      issues.push({
        code: 'C-804-FILLING',
        level: 'critical',
        title: 'มีหัตถการอุดฟัน (23.2) แต่ไม่มีรหัสวินิจฉัยโรคฟันผุ (K02.x)',
        detail:
          'การทำหัตถการอุดฟันเพื่อรักษาโรคฟันผุ จำเป็นต้องมีรหัสการวินิจฉัยโรคฟันผุ (K02.0-K02.9) ในเวชระเบียน',
        recommendation: 'เพิ่มรหัส K02.1 (Caries of dentine) เป็นโรครอง (diagtype=2)',
        category: 'dental',
        autoFixable: true,
        fixAction: 'ADD_K021',
      });
    }
  }

  // Rule 3: ผ่าฟันคุด (Impaction removal: 23.19, 23190xx)
  const hasImpactedProc = procedures.some((p) => {
    const c = cleanCode(p.code);
    return c === '2319' || c.startsWith('23190') || String(p.name || '').includes('ผ่าฟันคุด');
  });
  if (hasImpactedProc) {
    const hasImpactedDx = allDxCodes.some((c) => c.startsWith('K01'));
    if (!hasImpactedDx) {
      issues.push({
        code: 'C-804-IMPACTED',
        level: 'critical',
        title: 'มีหัตถการผ่าฟันคุด (23.19) แต่ไม่มีรหัสโรคฟันคุด (K01.x)',
        detail: 'หัตถการผ่าฟันคุดจำเป็นต้องมีรหัสวินิจฉัยฟันคุด (K01.1 Impacted teeth) เสี่ยงถูกปฏิเสธชดเชยค่าผ่าฟันคุด',
        recommendation: 'เพิ่มรหัส K01.1 (Impacted teeth) เป็นโรครอง (diagtype=2)',
        category: 'dental',
        autoFixable: true,
        fixAction: 'ADD_K011',
      });
    }
  }

  // Rule 4: ใช้ Z01.2 เป็นโรคหลักเมื่อมีหัตถการรักษาจริง
  const hasCurativeDentalProc = procedures.some((p) => {
    const c = cleanCode(p.code);
    return (
      c.startsWith('230') ||
      c.startsWith('231') ||
      c.startsWith('232') ||
      c.startsWith('234') ||
      c === '9654' ||
      c === '9651' ||
      c === '2387010' ||
      c === '2277310' ||
      c === '2287310' ||
      String(p.name || '').includes('อุดฟัน') ||
      String(p.name || '').includes('ถอนฟัน') ||
      String(p.name || '').includes('ขูดหินปูน') ||
      String(p.name || '').includes('ผ่าฟันคุด')
    );
  });
  if (pdx.startsWith('Z012') && hasCurativeDentalProc) {
    issues.push({
      code: 'C-800-Z012-PDX',
      level: 'critical',
      title: 'ใช้ Z01.2 (ตรวจฟัน) เป็นโรคหลัก ขณะที่มีหัตถการรักษา (อุด/ถอน/ขูดหินปูน)',
      detail:
        'หากมีการรักษาทางทันตกรรม e-Claim กำหนดให้ใช้รหัสโรคที่เป็นพยาธิสภาพ (เช่น K02.1, K05.1, K01.1) เป็นโรคหลัก (PDX) และให้ Z01.2 เป็นโรครอง (diagtype=2)',
      recommendation: 'สลับรหัสโรคที่รักษาขึ้นเป็นโรคหลัก (PDX) และเปลี่ยน Z01.2 เป็นโรครอง (diagtype=2)',
      category: 'dental',
      autoFixable: true,
      fixAction: 'SWAP_Z012',
    });
  }

  // Rule 5: ไม่มีรหัสวินิจฉัยหลัก (PDX) หรือไม่มีรหัสโรคฟัน
  const hasDentalDx = allDxCodes.some(
    (c) => (c.startsWith('K0') && c >= 'K00' && c <= 'K089') || c.startsWith('K1') || c.startsWith('Z012')
  );
  if (!pdx) {
    issues.push({
      code: 'C-MISSING-PDX',
      level: 'critical',
      title: 'ขาดรหัสการวินิจฉัยโรคหลัก (PDX)',
      detail: 'ไม่พบรหัสโรคหลัก (diagtype=1) ในเวชระเบียน ทำให้ไม่สามารถส่งเบิก e-Claim หรือบันทึกเวชระเบียนที่สมบูรณ์ได้',
      recommendation: 'กำหนดรหัสโรคหลักที่สอดคล้องกับหัตถการทันตกรรม (เช่น Z01.2, K05.1, K02.1) ให้อัตโนมัติ',
      category: 'clinical',
      autoFixable: true,
      fixAction: 'ADD_DENTAL_PDX',
    });
  }
  if (!hasDentalDx) {
    issues.push({
      code: 'C-800-NO-DENTAL-DX',
      level: 'critical',
      title: 'มีบริการทันตกรรมแต่ไม่พบรหัสวินิจฉัยหมวดฟัน (K00-K14 หรือ Z01.2)',
      detail: 'พบการให้บริการทางทันตกรรมแต่ไม่มีรหัสโรคทางทันตกรรมใน ovstdiag เสี่ยงติด C Error 800',
      recommendation: 'เพิ่มรหัสวินิจฉัยโรคทางทันตกรรมที่เหมาะสม (เช่น Z01.2, K05.1, K02.1) ให้อัตโนมัติ',
      category: 'dental',
      autoFixable: true,
      fixAction: 'ADD_DENTAL_PDX',
    });
  }

  // Rule 6: มีค่าบริการทันตกรรมแต่ไม่มีหัตถการใน dtmain
  const hasDentalCharge = chargeItems.some(
    (i) => i.income === '08' || i.income === '13' || String(i.name || '').includes('ทันต') || String(i.name || '').includes('ฟัน')
  );
  if (procedures.length === 0 && (hasDentalCharge || pdx.startsWith('Z012') || hasDentalDx)) {
    const numInDx = diagnoses.filter((d) => /^\d{3,5}$/.test(cleanCode(d.code)));
    if (numInDx.length > 0) {
      const numCodesStr = numInDx.map((d) => d.code).join(', ');
      issues.push({
        code: 'C-804-MISSING-PROC',
        level: 'critical',
        title: 'พบรหัสหัตถการตัวเลขตกค้างในช่องวินิจฉัยโรค แต่แฟ้มหัตถการว่าง',
        detail: `มีการให้บริการทันตกรรม แต่ไม่พบหัตถการใน dtmain โดยพบรหัส (${numCodesStr}) ตกค้างอยู่ในช่องวินิจฉัยโรค (ovstdiag) เสี่ยงติด C Error 804`,
        recommendation: `ย้ายรหัสหัตถการ (${numCodesStr}) จากช่องวินิจฉัยเข้าสู่ระบบทันตกรรม (dtmain) และลบรหัสตกค้างออกจาก ovstdiag`,
        category: 'dental',
        autoFixable: true,
        fixAction: 'SYNC_DENTAL_PROC',
      });
    } else {
      issues.push({
        code: 'C-804-MISSING-PROC',
        level: 'critical',
        title: 'มีบริการทันตกรรมแต่ไม่มีการบันทึกหัตถการในระบบ (dtmain)',
        detail: 'มีการให้บริการทันตกรรมแต่ไม่มีการลงรหัสหัตถการใน dtmain ทำให้แฟ้มหัตถการว่าง เสี่ยงติด C Error 804',
        recommendation: 'บันทึกหัตถการตรวจสุขภาพช่องปาก (Oral examination: 2330010 / 89.31) ลงใน dtmain ให้อัตโนมัติ',
        category: 'dental',
        autoFixable: true,
        fixAction: 'ADD_DENTAL_EXAM',
      });
    }
  }

  // Rule 7: มีรหัสตัวเลขหัตถการตกค้างใน ovstdiag เมื่อมีหัตถการใน dtmain แล้ว
  if (procedures.length > 0) {
    const numInDx = diagnoses.filter((d) => /^\d{3,5}$/.test(cleanCode(d.code)));
    if (numInDx.length > 0) {
      const numCodesStr = numInDx.map((d) => d.code).join(', ');
      issues.push({
        code: 'C-804-NUMERIC-DX',
        level: 'critical',
        title: 'พบรหัสตัวเลขหัตถการปนอยู่ในช่องวินิจฉัยโรค (ovstdiag)',
        detail: `พบรหัสตัวเลข (${numCodesStr}) ใน ovstdiag ทั้งที่มีหัตถการใน dtmain อยู่แล้ว เสี่ยงติด C Error 800/804`,
        recommendation: 'ลบรหัสหัตถการตัวเลขตกค้างออกจาก ovstdiag',
        category: 'dental',
        autoFixable: true,
        fixAction: 'REMOVE_NUMERIC_DX',
      });
    }
  }

  // Rule 8: รหัสหัตถการ ANC ปะปน
  const sex = String(visit.sex || '').trim().toUpperCase();
  const isMale = sex === '1' || sex === 'M' || sex === 'ชาย';
  const hasPregnancyDx = allDxCodes.some((c) => c.startsWith('Z34') || c.startsWith('Z35') || c.startsWith('O'));
  const hasAncProc = procedures.some((p) => {
    const c = cleanCode(p.code);
    const n = String(p.name || '').toLowerCase();
    return (
      c === '2330011' ||
      (c === '2387010' && (n.includes('ครรภ์') || n.includes('anc'))) ||
      n.includes('หญิงมีครรภ์') ||
      n.includes('หญิงตั้งครรภ์') ||
      n.includes('anc')
    );
  });
  if (hasAncProc && (isMale || hasCurativeDentalProc || !hasPregnancyDx)) {
    issues.push({
      code: 'C-808-ANC-PROC-MIXED',
      level: 'critical',
      title: 'พบหัตถการส่งเสริมป้องกัน ANC ปะปนในบริการทันตกรรมปกติ',
      detail:
        'ตรวจพบหัตถการตรวจสุขภาพช่องปาก/ขัดฟันหญิงตั้งครรภ์ (ANC) ปะปนในการรักษาปกติ หรือผู้ป่วยไม่ใช่กลุ่มเป้าหมาย ANC เสี่ยงติด C Error หรือถูกปฏิเสธชดเชย',
      recommendation: 'ลบหัตถการส่งเสริมป้องกัน ANC ออกจาก dtmain ให้เหลือเฉพาะหัตถการรักษาจริง',
      category: 'dental',
      autoFixable: true,
      fixAction: 'REMOVE_ANC_PROC',
    });
  }

  // Rule 9: โรครองซ้ำกับโรคหลัก (C-803)
  if (pdx && secondaryDx.includes(pdx)) {
    issues.push({
      code: 'C-803-DUPLICATE-DX',
      level: 'critical',
      title: 'รหัสการวินิจฉัยอื่นซ้ำกับโรคหลัก (C-803)',
      detail: `พบรหัสโรครองซ้ำกับโรคหลัก (${pdx}) ระบบ e-Claim จะปฏิเสธการจ่ายด้วย C-803`,
      recommendation: 'ลบรหัสโรคที่ซ้ำกับโรคหลักออกจาก ovstdiag ใน HOSxP',
      category: 'clinical',
      autoFixable: true,
      fixAction: 'REMOVE_DUP_DX',
    });
  }

  // Rule 10: ขาดรายการค่าบริการทันตกรรม
  if (!hasDentalCharge && procedures.length > 0 && totalCharge <= 0) {
    issues.push({
      code: 'WRN-DENTAL-NO-CHARGE',
      level: 'warning',
      title: 'มีหัตถการทันตกรรมแต่ไม่พบรายการค่ารักษาในใบสั่งยา',
      detail: 'พบการบันทึกหัตถการใน dtmain แต่มียอดรวมค่ารักษาเป็น 0 หรือไม่มีรายการค่าบริการใน opitemrece',
      recommendation: 'ตรวจสอบการลงรายการยาและค่าบริการใน HOSxP',
      category: 'billing',
    });
  }

  // Rule 11: แจ้งเตือนสิทธิประกันสังคม 900 บาท/ปี
  if (visit.pttype_group === 'SSS') {
    const isCurative = hasScalingProc || hasFillingProc || hasImpactedProc;
    if (isCurative && totalCharge > 900) {
      issues.push({
        code: 'WRN-SSS-DENTAL-LIMIT',
        level: 'warning',
        title: 'ยอดค่าบริการทันตกรรมเกินวงเงินเบิกจ่ายประกันสังคม (900 บาท/ปี)',
        detail: `ผู้ป่วยใช้สิทธิประกันสังคม ยอดค่ารักษาทันตกรรมรวม ${totalCharge.toLocaleString()} บาท เกินสิทธิประโยชน์ 900 บาท/ปี ผู้ป่วยอาจต้องชำระส่วนเกิน`,
        recommendation: 'ตรวจสอบยอดเรียกเก็บและการชำระเงินส่วนเกินของผู้ประกันตน',
        category: 'billing',
      });
    }
  }

  // Deduplicate issues by code
  const uniqueIssues: DentalAuditIssue[] = [];
  const seenCodes = new Set<string>();
  for (const issue of issues) {
    if (!seenCodes.has(issue.code)) {
      seenCodes.add(issue.code);
      uniqueIssues.push(issue);
    }
  }

  const hasCritical = uniqueIssues.some((i) => i.level === 'critical');
  const hasWarning = uniqueIssues.some((i) => i.level === 'warning');
  const audit_status: 'critical' | 'warning' | 'valid' = hasCritical ? 'critical' : hasWarning ? 'warning' : 'valid';

  const autoFixableIssues = uniqueIssues.filter((i) => i.autoFixable);
  const can_auto_fix = autoFixableIssues.length > 0;
  const auto_fix_actions = Array.from(
    new Set(autoFixableIssues.map((i) => i.fixAction as DentalAutoFixAction).filter(Boolean))
  );

  return {
    categories,
    issues: uniqueIssues,
    audit_status,
    total_charge: totalCharge,
    can_auto_fix,
    auto_fix_actions,
  };
};

export const getDentalClinicalAudit = async (input: {
  startDate?: string;
  endDate?: string;
  scheme?: 'ALL' | 'UC' | 'SSS' | 'OFC' | 'LGO' | 'CASH';
  category?: DentalCategory;
  auditStatus?: 'ALL' | 'CRITICAL' | 'WARNING' | 'VALID' | 'CAN_FIX';
  search?: string;
  page?: number;
  pageSize?: number;
}) => {
  const connection = await getUTFConnection();
  const today = new Date().toISOString().slice(0, 10);
  const currentMonthStart = today.slice(0, 8) + '01';

  const startDate = input.startDate || currentMonthStart;
  const endDate = input.endDate || today;

  const page = Math.max(1, Math.trunc(Number(input.page || 1)));
  const pageSize = Math.max(10, Math.min(200, Math.trunc(Number(input.pageSize || 50))));

  try {
    const whereConditions: string[] = [
      'o.vstdate BETWEEN ? AND ?',
      "IFNULL(o.an, '') = ''",
      `(
        o.main_dep IN (SELECT depcode FROM kskdepartment WHERE department LIKE '%ทันต%')
        OR EXISTS (SELECT 1 FROM dtmain dm WHERE dm.vn = o.vn)
        OR EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND (dx.icd10 LIKE 'K0%' OR dx.icd10 LIKE 'K1%' OR dx.icd10 = 'Z012'))
        OR EXISTS (SELECT 1 FROM opitemrece oi WHERE oi.vn = o.vn AND oi.income IN ('08', '13'))
      )`,
    ];
    const whereParams: unknown[] = [startDate, endDate];

    // Scheme filter
    if (input.scheme && input.scheme !== 'ALL') {
      if (input.scheme === 'UC') {
        whereConditions.push(
          `(pt.pcode = 'UC' OR pt.hipdata_code = 'UCS' OR pt.name LIKE '%ประกันสุขภาพถ้วนหน้า%' OR pt.name LIKE '%บัตรทอง%')`
        );
      } else if (input.scheme === 'SSS') {
        whereConditions.push(`(pt.pcode = 'SS' OR pt.hipdata_code = 'SSS' OR pt.name LIKE '%ประกันสังคม%')`);
      } else if (input.scheme === 'OFC') {
        whereConditions.push(`(pt.pcode = 'OF' OR pt.hipdata_code = 'OFC' OR pt.name LIKE '%ข้าราชการ%' OR pt.name LIKE '%จ่ายตรง%')`);
      } else if (input.scheme === 'LGO') {
        whereConditions.push(`(pt.pcode = 'LG' OR pt.hipdata_code = 'LGO' OR pt.name LIKE '%อปท%' OR pt.name LIKE '%ท้องถิ่น%')`);
      } else if (input.scheme === 'CASH') {
        whereConditions.push(`(pt.pcode = 'AA' OR pt.name LIKE '%ชำระเงิน%' OR pt.name LIKE '%เงินสด%')`);
      }
    }

    if (input.search && input.search.trim()) {
      const q = `%${input.search.trim()}%`;
      whereConditions.push('(o.vn LIKE ? OR o.hn LIKE ? OR p.fname LIKE ? OR p.lname LIKE ?)');
      whereParams.push(q, q, q, q);
    }

    const whereClause = whereConditions.join(' AND ');

    // Fetch visits
    const [allVisitRows] = await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
              TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
              COALESCE(pt.name, o.pttype) AS pttype_name,
              pt.pcode, pt.hipdata_code,
              COALESCE(CONCAT(p.pname, p.fname, ' ', p.lname), '') AS patient_name,
              COALESCE(p.sex, '') AS sex,
              COALESCE(TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate), 0) AS age_y,
              COALESCE(k.department, o.main_dep, '') AS department
       FROM ovst o
       LEFT JOIN patient p ON p.hn = o.hn
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
       WHERE ${whereClause}
       ORDER BY o.vstdate DESC, o.vsttime DESC
       LIMIT 10000`,
      whereParams
    );

    const visits = (Array.isArray(allVisitRows) ? allVisitRows : []) as Array<Record<string, unknown>>;
    if (visits.length === 0) {
      return {
        summary: {
          total_visits: 0,
          valid_count: 0,
          critical_count: 0,
          warning_count: 0,
          auto_fixable_count: 0,
          total_amount: 0,
          by_category: {
            ALL: 0,
            SCALING: 0,
            FILLING: 0,
            EXTRACTION: 0,
            EXAM: 0,
            PREVENTION: 0,
            ANC: 0,
            PROSTHODONTIC: 0,
            OTHER: 0,
          },
          by_scheme: { uc: 0, sss: 0, ofc: 0, lgo: 0, cash: 0, other: 0 },
        },
        data: [],
        total: 0,
        page,
        pageSize,
      };
    }

    const vns = visits.map((v) => String(v.vn || ''));

    // Fetch diagnoses
    const [diagRows] = await connection.query(
      `SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name
       FROM ovstdiag d
       LEFT JOIN icd101 i ON i.code = d.icd10
       WHERE d.vn IN (${vns.map(() => '?').join(',')})
       ORDER BY d.vn, d.diagtype`,
      vns
    );

    // Fetch dental procedures from dtmain
    const [dentalOperRows] = await connection.query(
      `SELECT dm.vn,
              COALESCE(NULLIF(dm.icd9, ''), NULLIF(tm.icd10tm_operation_code, ''), NULLIF(tm.icd9cm, ''), dm.tmcode, '') AS code,
              COALESCE(tm.name, 'หัตถการทันตกรรม') AS name,
              'Dental' AS type,
              COALESCE(dm.tmcode, '') AS tmcode,
              COALESCE(tm.icd10tm_operation_code, '') AS icd10tm
       FROM dtmain dm
       LEFT JOIN dttm tm ON tm.code = dm.tmcode
       WHERE dm.vn IN (${vns.map(() => '?').join(',')})`,
      vns
    );

    // Fetch doctor operations
    const [doctorOperRows] = await connection.query(
      `SELECT dop.vn, dop.icd9 AS code, COALESCE(i.name, '') AS name, 'Doctor' AS type
       FROM doctor_operation dop
       LEFT JOIN icd9cm1 i ON REPLACE(i.code, '.', '') = REPLACE(dop.icd9, '.', '')
       WHERE dop.vn IN (${vns.map(() => '?').join(',')})`,
      vns
    );

    // Fetch charge items
    const [chargeRows] = await connection.query(
      `SELECT opi.vn, opi.icode, opi.qty, opi.unitprice, opi.sum_price, opi.income,
              COALESCE(sd.name, '') AS name
       FROM opitemrece opi
       LEFT JOIN s_drugitems sd ON sd.icode = opi.icode
       WHERE opi.vn IN (${vns.map(() => '?').join(',')})`,
      vns
    );

    const diagsByVn = new Map<string, Array<{ code: string; name?: string; diagtype: string }>>();
    for (const r of (Array.isArray(diagRows) ? diagRows : []) as Array<Record<string, unknown>>) {
      const vn = String(r.vn || '');
      if (!diagsByVn.has(vn)) diagsByVn.set(vn, []);
      diagsByVn.get(vn)?.push({
        code: String(r.icd10 || ''),
        name: String(r.name || ''),
        diagtype: String(r.diagtype || '4'),
      });
    }

    const procsByVn = new Map<string, Array<{ code: string; name?: string; type?: string; tooth?: string; tmcode?: string; icd10tm?: string }>>();
    for (const r of (Array.isArray(dentalOperRows) ? dentalOperRows : []) as Array<Record<string, unknown>>) {
      const vn = String(r.vn || '');
      if (!procsByVn.has(vn)) procsByVn.set(vn, []);
      procsByVn.get(vn)?.push({
        code: String(r.code || ''),
        name: String(r.name || ''),
        type: 'Dental',
        tooth: String(r.tooth || ''),
        tmcode: String(r.tmcode || ''),
        icd10tm: String(r.icd10tm || ''),
      });
    }
    for (const r of (Array.isArray(doctorOperRows) ? doctorOperRows : []) as Array<Record<string, unknown>>) {
      const vn = String(r.vn || '');
      if (!procsByVn.has(vn)) procsByVn.set(vn, []);
      procsByVn.get(vn)?.push({
        code: String(r.code || ''),
        name: String(r.name || ''),
        type: 'Doctor',
      });
    }

    const chargesByVn = new Map<string, Array<{ icode: string; name?: string; qty?: number; unitprice?: number; sum_price?: number; income?: string }>>();
    for (const r of (Array.isArray(chargeRows) ? chargeRows : []) as Array<Record<string, unknown>>) {
      const vn = String(r.vn || '');
      if (!chargesByVn.has(vn)) chargesByVn.set(vn, []);
      chargesByVn.get(vn)?.push({
        icode: String(r.icode || ''),
        name: String(r.name || ''),
        qty: Number(r.qty || 0),
        unitprice: Number(r.unitprice || 0),
        sum_price: Number(r.sum_price || 0),
        income: String(r.income || ''),
      });
    }

    const allAuditedVisits: DentalAuditVisit[] = [];
    const summaryCounts: DentalAuditSummary = {
      total_visits: 0,
      valid_count: 0,
      critical_count: 0,
      warning_count: 0,
      auto_fixable_count: 0,
      total_amount: 0,
      by_category: {
        ALL: 0,
        SCALING: 0,
        FILLING: 0,
        EXTRACTION: 0,
        EXAM: 0,
        PREVENTION: 0,
        ANC: 0,
        PROSTHODONTIC: 0,
        OTHER: 0,
      },
      by_scheme: { uc: 0, sss: 0, ofc: 0, lgo: 0, cash: 0, other: 0 },
    };

    for (const row of visits) {
      const vn = String(row.vn || '');
      const diags = diagsByVn.get(vn) || [];
      const procs = procsByVn.get(vn) || [];
      const charges = chargesByVn.get(vn) || [];

      const pttypeGroup = classifyPttypeGroup(
        String(row.pcode || ''),
        String(row.hipdata_code || ''),
        String(row.pttype_name || '')
      );

      const auditResult = evaluateDentalVisitAudit({
        vn,
        hn: String(row.hn || ''),
        patient_name: String(row.patient_name || ''),
        sex: String(row.sex || ''),
        age_y: Number(row.age_y || 0),
        service_date: String(row.service_date || ''),
        service_time: String(row.service_time || ''),
        pttype: String(row.pttype || ''),
        pttype_group: pttypeGroup,
        department: String(row.department || ''),
        diagnoses: diags,
        procedures: procs,
        chargeItems: charges,
      });

      // Update global summary counts
      summaryCounts.total_visits++;
      summaryCounts.total_amount += auditResult.total_charge;
      if (auditResult.audit_status === 'valid') summaryCounts.valid_count++;
      else if (auditResult.audit_status === 'critical') summaryCounts.critical_count++;
      else if (auditResult.audit_status === 'warning') summaryCounts.warning_count++;
      if (auditResult.can_auto_fix) summaryCounts.auto_fixable_count++;

      // Scheme counts
      if (pttypeGroup === 'UC') summaryCounts.by_scheme.uc++;
      else if (pttypeGroup === 'SSS') summaryCounts.by_scheme.sss++;
      else if (pttypeGroup === 'OFC') summaryCounts.by_scheme.ofc++;
      else if (pttypeGroup === 'LGO') summaryCounts.by_scheme.lgo++;
      else if (pttypeGroup === 'CASH') summaryCounts.by_scheme.cash++;
      else summaryCounts.by_scheme.other++;

      // Category counts
      for (const cat of auditResult.categories) {
        summaryCounts.by_category[cat] = (summaryCounts.by_category[cat] || 0) + 1;
      }

      // Check category filter
      if (input.category && input.category !== 'ALL' && !auditResult.categories.includes(input.category)) {
        continue;
      }

      // Check audit status filter
      if (input.auditStatus && input.auditStatus !== 'ALL') {
        if (input.auditStatus === 'CRITICAL' && auditResult.audit_status !== 'critical') continue;
        if (input.auditStatus === 'WARNING' && auditResult.audit_status !== 'warning') continue;
        if (input.auditStatus === 'VALID' && auditResult.audit_status !== 'valid') continue;
        if (input.auditStatus === 'CAN_FIX' && !auditResult.can_auto_fix) continue;
      }

      allAuditedVisits.push({
        vn,
        hn: String(row.hn || ''),
        patient_name: String(row.patient_name || ''),
        sex: String(row.sex || ''),
        age_y: Number(row.age_y || 0),
        service_date: String(row.service_date || ''),
        service_time: String(row.service_time || ''),
        pttype: String(row.pttype || ''),
        pttype_name: String(row.pttype_name || ''),
        pttype_group: pttypeGroup,
        department: String(row.department || ''),
        diagnoses: diags,
        procedures: procs,
        chargeItems: charges,
        total_charge: auditResult.total_charge,
        categories: auditResult.categories,
        issues: auditResult.issues,
        audit_status: auditResult.audit_status,
        can_auto_fix: auditResult.can_auto_fix,
        auto_fix_actions: auditResult.auto_fix_actions,
      });
    }

    summaryCounts.by_category.ALL = summaryCounts.total_visits;

    const filteredTotal = allAuditedVisits.length;
    const paginatedData = allAuditedVisits.slice((page - 1) * pageSize, page * pageSize);

    return {
      summary: summaryCounts,
      data: paginatedData,
      total: filteredTotal,
      page,
      pageSize,
    };
  } finally {
    connection.release();
  }
};

export const fixDentalClinicalVisit = async (input: {
  vn: string;
  actorUserId?: number | null;
  actorName?: string;
}): Promise<{
  success: boolean;
  vn: string;
  actionsApplied: string[];
  remainingIssues: DentalAuditIssue[];
}> => {
  const vn = String(input.vn || '').trim();
  if (!vn) throw new Error('ไม่ระบุ VN สำหรับการแก้ไข');

  const connection = await getUTFConnection();
  try {
    await connection.query('START TRANSACTION');

    // 1. Fetch visit info
    const [visitRows] = await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
              TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
              COALESCE(pt.name, o.pttype) AS pttype_name, pt.pcode, pt.hipdata_code,
              COALESCE(CONCAT(p.pname, p.fname, ' ', p.lname), '') AS patient_name,
              COALESCE(p.sex, '') AS sex,
              COALESCE(TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate), 0) AS age_y,
              COALESCE(k.department, o.main_dep, '') AS department
       FROM ovst o
       LEFT JOIN patient p ON p.hn = o.hn
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
       WHERE o.vn = ? LIMIT 1`,
      [vn]
    );
    const visit = (Array.isArray(visitRows) ? visitRows[0] : null) as Record<string, unknown> | null;
    if (!visit) {
      await connection.query('ROLLBACK');
      throw new Error(`ไม่พบข้อมูลวิสิต VN ${vn}`);
    }

    // 2. Fetch diagnoses, procedures, and charges
    const [diagRows] = await connection.query(
      `SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name, d.ovst_diag_id
       FROM ovstdiag d
       LEFT JOIN icd101 i ON i.code = d.icd10
       WHERE d.vn = ? ORDER BY d.diagtype`,
      [vn]
    );
    const [dentalOperRows] = await connection.query(
      `SELECT dm.vn,
              COALESCE(NULLIF(dm.icd9, ''), NULLIF(tm.icd10tm_operation_code, ''), NULLIF(tm.icd9cm, ''), dm.tmcode, '') AS code,
              COALESCE(tm.name, 'หัตถการทันตกรรม') AS name,
              'Dental' AS type,
              COALESCE(dm.tmcode, '') AS tmcode,
              COALESCE(tm.icd10tm_operation_code, '') AS icd10tm
       FROM dtmain dm
       LEFT JOIN dttm tm ON tm.code = dm.tmcode
       WHERE dm.vn = ?`,
      [vn]
    );
    const [doctorOperRows] = await connection.query(
      `SELECT dop.vn, dop.icd9 AS code, COALESCE(i.name, '') AS name, 'Doctor' AS type
       FROM doctor_operation dop
       LEFT JOIN icd9cm1 i ON REPLACE(i.code, '.', '') = REPLACE(dop.icd9, '.', '')
       WHERE dop.vn = ?`,
      [vn]
    );
    const [chargeRows] = await connection.query(
      `SELECT opi.vn, opi.icode, opi.qty, opi.unitprice, opi.sum_price, opi.income,
              COALESCE(sd.name, '') AS name
       FROM opitemrece opi
       LEFT JOIN s_drugitems sd ON sd.icode = opi.icode
       WHERE opi.vn = ?`,
      [vn]
    );

    const diags = (Array.isArray(diagRows) ? diagRows : []).map((r) => ({
      code: String((r as Record<string, unknown>).icd10 || ''),
      name: String((r as Record<string, unknown>).name || ''),
      diagtype: String((r as Record<string, unknown>).diagtype || '4'),
    }));
    const procs = [
      ...(Array.isArray(dentalOperRows) ? dentalOperRows : []).map((r) => ({
        code: String((r as Record<string, unknown>).code || ''),
        name: String((r as Record<string, unknown>).name || ''),
        type: 'Dental',
        tooth: String((r as Record<string, unknown>).tooth || ''),
        tmcode: String((r as Record<string, unknown>).tmcode || ''),
        icd10tm: String((r as Record<string, unknown>).icd10tm || ''),
      })),
      ...(Array.isArray(doctorOperRows) ? doctorOperRows : []).map((r) => ({
        code: String((r as Record<string, unknown>).code || ''),
        name: String((r as Record<string, unknown>).name || ''),
        type: 'Doctor',
      })),
    ];
    const charges = (Array.isArray(chargeRows) ? chargeRows : []).map((r) => ({
      icode: String((r as Record<string, unknown>).icode || ''),
      name: String((r as Record<string, unknown>).name || ''),
      qty: Number((r as Record<string, unknown>).qty || 0),
      unitprice: Number((r as Record<string, unknown>).unitprice || 0),
      sum_price: Number((r as Record<string, unknown>).sum_price || 0),
      income: String((r as Record<string, unknown>).income || ''),
    }));

    const pttypeGroup = classifyPttypeGroup(
      String(visit.pcode || ''),
      String(visit.hipdata_code || ''),
      String(visit.pttype_name || '')
    );

    const evaluated = evaluateDentalVisitAudit({
      vn,
      hn: String(visit.hn || ''),
      patient_name: String(visit.patient_name || ''),
      sex: String(visit.sex || ''),
      age_y: Number(visit.age_y || 0),
      service_date: String(visit.service_date || ''),
      service_time: String(visit.service_time || ''),
      pttype: String(visit.pttype || ''),
      pttype_group: pttypeGroup,
      department: String(visit.department || ''),
      diagnoses: diags,
      procedures: procs,
      chargeItems: charges,
    });

    if (!evaluated.can_auto_fix || evaluated.auto_fix_actions.length === 0) {
      await connection.query('COMMIT');
      return {
        success: true,
        vn,
        actionsApplied: ['ไม่มีรายการข้อผิดพลาดที่สามารถแก้ไขอัตโนมัติได้'],
        remainingIssues: evaluated.issues,
      };
    }

    const executedActions: string[] = [];

    // Helper: Doctor code & HN for inserts
    const [ovstData] = await connection.query(
      `SELECT hn, vstdate, vsttime, doctor, staff FROM ovst WHERE vn = ? LIMIT 1`,
      [vn]
    );
    const ovstRow = (Array.isArray(ovstData) ? ovstData[0] : null) as Record<string, unknown> | null;
    const ovstHn = String(ovstRow?.hn || visit.hn);
    const ovstVstdate = ovstRow?.vstdate;
    const ovstVsttime = ovstRow?.vsttime;
    const ovstDoctor = String(ovstRow?.doctor || '900');
    const ovstStaff = String(ovstRow?.staff || input.actorName || 'dental');

    for (const action of evaluated.auto_fix_actions) {
      if (action === 'ADD_K051') {
        const [existsK051] = await connection.query(
          `SELECT 1 FROM ovstdiag WHERE vn = ? AND icd10 = 'K051' LIMIT 1`,
          [vn]
        );
        if (!Array.isArray(existsK051) || existsK051.length === 0) {
          await connection.query(
            `INSERT INTO ovstdiag (vn, hn, vstdate, vsttime, icd10, diagtype, doctor, staff)
             VALUES (?, ?, ?, ?, 'K051', '2', ?, ?)`,
            [vn, ovstHn, ovstVstdate, ovstVsttime, ovstDoctor, ovstStaff]
          );
          executedActions.push('เพิ่มรหัสโรคเหงือกอักเสบ K05.1 (diagtype=2) สำหรับหัตถการขูดหินปูน');
        }
      } else if (action === 'ADD_K021') {
        const [existsK021] = await connection.query(
          `SELECT 1 FROM ovstdiag WHERE vn = ? AND icd10 = 'K021' LIMIT 1`,
          [vn]
        );
        if (!Array.isArray(existsK021) || existsK021.length === 0) {
          await connection.query(
            `INSERT INTO ovstdiag (vn, hn, vstdate, vsttime, icd10, diagtype, doctor, staff)
             VALUES (?, ?, ?, ?, 'K021', '2', ?, ?)`,
            [vn, ovstHn, ovstVstdate, ovstVsttime, ovstDoctor, ovstStaff]
          );
          executedActions.push('เพิ่มรหัสโรคฟันผุ K02.1 (diagtype=2) สำหรับหัตถการอุดฟัน');
        }
      } else if (action === 'ADD_K011') {
        const [existsK011] = await connection.query(
          `SELECT 1 FROM ovstdiag WHERE vn = ? AND icd10 = 'K011' LIMIT 1`,
          [vn]
        );
        if (!Array.isArray(existsK011) || existsK011.length === 0) {
          await connection.query(
            `INSERT INTO ovstdiag (vn, hn, vstdate, vsttime, icd10, diagtype, doctor, staff)
             VALUES (?, ?, ?, ?, 'K011', '2', ?, ?)`,
            [vn, ovstHn, ovstVstdate, ovstVsttime, ovstDoctor, ovstStaff]
          );
          executedActions.push('เพิ่มรหัสฟันคุด K01.1 (diagtype=2) สำหรับหัตถการผ่าฟันคุด');
        }
      } else if (action === 'SWAP_Z012') {
        // Find best curative disease code
        const hasK02 = diags.some((d) => cleanCode(d.code).startsWith('K02'));
        const hasK05 = diags.some((d) => cleanCode(d.code).startsWith('K05'));
        const hasK01 = diags.some((d) => cleanCode(d.code).startsWith('K01'));
        let newPdx = 'K021';
        if (hasK05) newPdx = 'K051';
        else if (hasK02) newPdx = 'K021';
        else if (hasK01) newPdx = 'K011';

        await connection.query(
          `UPDATE ovstdiag SET diagtype = '2' WHERE vn = ? AND (icd10 = 'Z012' OR icd10 LIKE 'Z01.2%')`,
          [vn]
        );
        const [existingNewPdx] = await connection.query(
          `SELECT ovst_diag_id FROM ovstdiag WHERE vn = ? AND icd10 = ? LIMIT 1`,
          [vn, newPdx]
        );
        if (Array.isArray(existingNewPdx) && existingNewPdx.length > 0) {
          await connection.query(
            `UPDATE ovstdiag SET diagtype = '1' WHERE vn = ? AND ovst_diag_id = ?`,
            [vn, (existingNewPdx[0] as Record<string, unknown>).ovst_diag_id]
          );
        } else {
          await connection.query(
            `INSERT INTO ovstdiag (vn, hn, vstdate, vsttime, icd10, diagtype, doctor, staff)
             VALUES (?, ?, ?, ?, ?, '1', ?, ?)`,
            [vn, ovstHn, ovstVstdate, ovstVsttime, newPdx, ovstDoctor, ovstStaff]
          );
        }
        await connection.query(`UPDATE vn_stat SET pdx = ? WHERE vn = ?`, [newPdx, vn]).catch(() => {});
        executedActions.push(`สลับรหัสโรคหลักจาก Z01.2 เป็น ${newPdx} และเปลี่ยน Z01.2 เป็นโรครอง (diagtype=2)`);
      } else if (action === 'ADD_DENTAL_PDX') {
        // Determine appropriate dental PDX based on procedures
        let dentalPdx = 'Z012';
        const hasImpacted = procs.some((p) => cleanCode(p.code) === '2319' || String(p.name || '').includes('ฟันคุด'));
        const hasScaling = procs.some((p) => ['9654', '9651', '2387010', '2277310', '2287310'].includes(cleanCode(p.code)) || String(p.name || '').includes('ขูดหินปูน'));
        const hasFillingOrExt = procs.some((p) => cleanCode(p.code).startsWith('230') || cleanCode(p.code).startsWith('232') || String(p.name || '').includes('อุดฟัน') || String(p.name || '').includes('ถอนฟัน'));

        if (hasImpacted) dentalPdx = 'K011';
        else if (hasScaling) dentalPdx = 'K051';
        else if (hasFillingOrExt) dentalPdx = 'K021';
        else dentalPdx = 'Z012';

        const [curPdx] = await connection.query(
          `SELECT ovst_diag_id, icd10 FROM ovstdiag WHERE vn = ? AND diagtype = '1' LIMIT 1`,
          [vn]
        );
        const curPdxRow = (Array.isArray(curPdx) ? curPdx[0] : null) as Record<string, unknown> | null;

        if (curPdxRow) {
          await connection.query(
            `UPDATE ovstdiag SET icd10 = ? WHERE vn = ? AND ovst_diag_id = ?`,
            [dentalPdx, vn, curPdxRow.ovst_diag_id]
          );
        } else {
          await connection.query(
            `INSERT INTO ovstdiag (vn, hn, vstdate, vsttime, icd10, diagtype, doctor, staff)
             VALUES (?, ?, ?, ?, ?, '1', ?, ?)`,
            [vn, ovstHn, ovstVstdate, ovstVsttime, dentalPdx, ovstDoctor, ovstStaff]
          );
        }

        await connection.query(`UPDATE vn_stat SET pdx = ? WHERE vn = ?`, [dentalPdx, vn]).catch(() => {});
        await connection.query(`UPDATE dtmain SET icd = ? WHERE vn = ? AND (icd IS NULL OR icd = '')`, [dentalPdx, vn]).catch(() => {});
        executedActions.push(`เพิ่มรหัสวินิจฉัยหลักทันตกรรม (${dentalPdx}) ใน ovstdiag, vn_stat และ dtmain`);
      } else if (action === 'SYNC_DENTAL_PROC') {
        const [numDxRows] = await connection.query(
          `SELECT ovst_diag_id, icd10, diagtype, doctor FROM ovstdiag WHERE vn = ? AND icd10 REGEXP '^[0-9]'`,
          [vn]
        );
        const numericItems = (Array.isArray(numDxRows) ? numDxRows : []) as Array<Record<string, unknown>>;
        if (numericItems.length > 0) {
          const [maxTmRows] = await connection.query(
            `SELECT COALESCE(MAX(tm_no), 0) AS max_no FROM dtmain WHERE vn = ?`,
            [vn]
          );
          let nextTmNo = Number((maxTmRows as Array<{ max_no: number }>)[0]?.max_no || 0);

          const [maxIdRows] = await connection.query(`SELECT COALESCE(MAX(dtmain_id), 0) AS max_id FROM dtmain`);
          let nextDtmainId = Number((maxIdRows as Array<{ max_id: number }>)[0]?.max_id || 0);

          const primaryIcd = diags.find((d) => d.diagtype === '1')?.code || 'Z012';
          const syncedDesc: string[] = [];

          for (const item of numericItems) {
            const rawCode = String(item.icd10 || '').trim();
            const cCode = rawCode.replace(/[.\s-]/g, '');
            const ovstDiagId = Number(item.ovst_diag_id);

            const [dttmMatches] = await connection.query(
              `SELECT code, name, icd9cm, icd10tm_operation_code FROM dttm
               WHERE icd9cm = ? OR REPLACE(icd9cm, '.', '') = ? OR code = ?
               ORDER BY code ASC LIMIT 1`,
              [rawCode, cCode, cCode]
            );
            const dttmMatch = (Array.isArray(dttmMatches) ? dttmMatches[0] : null) as Record<string, unknown> | null;
            let tmcode = dttmMatch ? String(dttmMatch.code) : '';
            let icd9 = dttmMatch ? String(dttmMatch.icd10tm_operation_code || dttmMatch.icd9cm || rawCode) : rawCode;

            if (!tmcode) {
              if (cCode === '8931') {
                tmcode = '3002';
                icd9 = '2330010';
              } else if (cCode === '9997') {
                tmcode = '1062';
                icd9 = '9997';
              } else {
                tmcode = cCode;
              }
            }

            nextTmNo++;
            nextDtmainId++;

            await connection.query(
              `INSERT INTO dtmain (
                dtmain_id, vn, hn, vstdate, vsttime, doctor, tmcode, icd9, icd, tm_no, fee
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
              [
                nextDtmainId,
                vn,
                ovstHn,
                ovstVstdate,
                ovstVsttime,
                String(item.doctor || ovstDoctor),
                tmcode,
                icd9,
                primaryIcd,
                nextTmNo,
              ]
            );

            await connection.query(`DELETE FROM ovstdiag WHERE vn = ? AND ovst_diag_id = ?`, [vn, ovstDiagId]);
            syncedDesc.push(`${rawCode} (เข้า dtmain รหัส ${tmcode})`);
          }

          if (syncedDesc.length > 0) {
            executedActions.push(`ย้ายรหัสหัตถการ ${syncedDesc.join(', ')} จาก ovstdiag เข้าสู่ dtmain เรียบร้อย`);
          }
        }
      } else if (action === 'REMOVE_NUMERIC_DX') {
        const [delRes] = await connection.query(
          `DELETE FROM ovstdiag WHERE vn = ? AND icd10 REGEXP '^[0-9]'`,
          [vn]
        );
        const delCount = Number((delRes as { affectedRows?: number }).affectedRows || 0);
        if (delCount > 0) {
          executedActions.push(`ลบรหัสหัตถการตัวเลขตกค้าง (${delCount} รายการ) ออกจาก ovstdiag เรียบร้อย`);
        }
      } else if (action === 'ADD_DENTAL_EXAM') {
        const [existingDm] = await connection.query(
          `SELECT COUNT(*) AS cnt FROM dtmain WHERE vn = ?`,
          [vn]
        );
        const dmCount = Number((existingDm as Array<{ cnt: number }>)[0]?.cnt || 0);
        if (dmCount === 0) {
          const [maxTmRows] = await connection.query(
            `SELECT COALESCE(MAX(tm_no), 0) AS max_no FROM dtmain WHERE vn = ?`,
            [vn]
          );
          const nextTmNo = Number((maxTmRows as Array<{ max_no: number }>)[0]?.max_no || 0) + 1;

          const [maxIdRows] = await connection.query(`SELECT COALESCE(MAX(dtmain_id), 0) AS max_id FROM dtmain`);
          const nextDtmainId = Number((maxIdRows as Array<{ max_id: number }>)[0]?.max_id || 0) + 1;

          const [dttmMatches] = await connection.query(
            `SELECT code, icd9cm, icd10tm_operation_code FROM dttm WHERE code = '3002' LIMIT 1`
          );
          const dttmRow = (Array.isArray(dttmMatches) ? dttmMatches[0] : null) as Record<string, unknown> | null;
          const tmcode = dttmRow ? String(dttmRow.code) : '3002';
          const icd9 = dttmRow ? String(dttmRow.icd10tm_operation_code || dttmRow.icd9cm || '2330010') : '2330010';

          const hasZ012 = diags.some((d) => cleanCode(d.code).startsWith('Z012'));
          const primaryIcd = hasZ012 ? 'Z012' : diags.find((d) => d.diagtype === '1')?.code || 'Z012';

          await connection.query(
            `INSERT INTO dtmain (
              dtmain_id, vn, hn, vstdate, vsttime, doctor, tmcode, icd9, icd, tm_no, fee, scount, tcount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
            [
              nextDtmainId,
              vn,
              ovstHn,
              ovstVstdate,
              ovstVsttime,
              ovstDoctor,
              tmcode,
              icd9,
              primaryIcd,
              nextTmNo,
            ]
          );

          if (diags.length === 0) {
            await connection.query(
              `INSERT INTO ovstdiag (vn, hn, vstdate, vsttime, icd10, diagtype, doctor, staff)
               VALUES (?, ?, ?, ?, 'Z012', '1', ?, ?)`,
              [vn, ovstHn, ovstVstdate, ovstVsttime, ovstDoctor, ovstStaff]
            );
            await connection.query(`UPDATE vn_stat SET pdx = 'Z012' WHERE vn = ?`, [vn]).catch(() => {});
          }

          executedActions.push(`บันทึกหัตถการตรวจสุขภาพช่องปาก (Oral examination: รหัส ${tmcode} / ${icd9}) ลงใน dtmain เรียบร้อย`);
        }
      } else if (action === 'REMOVE_ANC_PROC') {
        const [delDmRes] = await connection.query(
          `DELETE dm FROM dtmain dm
           LEFT JOIN dttm tm ON tm.code = dm.tmcode
           WHERE dm.vn = ?
             AND (
               COALESCE(tm.icd10tm_operation_code, '') IN ('2330011', '2387010')
               OR dm.tmcode IN ('2330011', '2387010')
               OR COALESCE(dm.icd9, '') IN ('2330011', '2387010')
               OR COALESCE(tm.name, '') LIKE '%หญิงมีครรภ์%'
               OR COALESCE(tm.name, '') LIKE '%หญิงตั้งครรภ์%'
               OR COALESCE(tm.name, '') LIKE '%ANC%'
             )`,
          [vn]
        );
        const deletedDm = Number((delDmRes as { affectedRows?: number }).affectedRows || 0);

        const [delDopRes] = await connection.query(
          `DELETE FROM doctor_operation WHERE vn = ? AND icd9 IN ('2330011', '2387010')`,
          [vn]
        );
        const deletedDop = Number((delDopRes as { affectedRows?: number }).affectedRows || 0);

        await connection.query(
          `DELETE opi FROM opitemrece opi
           JOIN s_drugitems sd ON sd.icode = opi.icode
           WHERE opi.vn = ?
             AND (
               sd.nhso_adp_code IN ('30008', '30009')
               OR sd.name LIKE '%หญิงมีครรภ์%'
               OR sd.name LIKE '%หญิงตั้งครรภ์%'
             )`,
          [vn]
        ).catch(() => {});

        const totalDeleted = deletedDm + deletedDop;
        if (totalDeleted > 0) {
          executedActions.push(`ลบหัตถการส่งเสริมป้องกัน ANC จำนวน ${totalDeleted} รายการ ออกจาก dtmain`);
        }
      } else if (action === 'REMOVE_DUP_DX') {
        const pdxCode = diags.find((d) => d.diagtype === '1')?.code;
        if (pdxCode) {
          const [delDupRes] = await connection.query(
            `DELETE FROM ovstdiag WHERE vn = ? AND diagtype != '1' AND icd10 = ?`,
            [vn, pdxCode]
          );
          const delCount = Number((delDupRes as { affectedRows?: number }).affectedRows || 0);
          if (delCount > 0) {
            executedActions.push(`ลบรหัสโรคที่ซ้ำกับโรคหลัก (${pdxCode}) จำนวน ${delCount} รายการ ออกจาก ovstdiag`);
          }
        }
      }
    }

    await connection.query('COMMIT');

    // Re-evaluate to get remaining issues
    const [reDiagRows] = await connection.query(
      `SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name
       FROM ovstdiag d
       LEFT JOIN icd101 i ON i.code = d.icd10
       WHERE d.vn = ? ORDER BY d.diagtype`,
      [vn]
    );
    const [reDentalRows] = await connection.query(
      `SELECT dm.vn,
              COALESCE(NULLIF(dm.icd9, ''), NULLIF(tm.icd10tm_operation_code, ''), NULLIF(tm.icd9cm, ''), dm.tmcode, '') AS code,
              COALESCE(tm.name, 'หัตถการทันตกรรม') AS name,
              'Dental' AS type,
              COALESCE(dm.tmcode, '') AS tmcode,
              COALESCE(tm.icd10tm_operation_code, '') AS icd10tm
       FROM dtmain dm
       LEFT JOIN dttm tm ON tm.code = dm.tmcode
       WHERE dm.vn = ?`,
      [vn]
    );
    const [reDocRows] = await connection.query(
      `SELECT dop.vn, dop.icd9 AS code, COALESCE(i.name, '') AS name, 'Doctor' AS type
       FROM doctor_operation dop
       LEFT JOIN icd9cm1 i ON REPLACE(i.code, '.', '') = REPLACE(dop.icd9, '.', '')
       WHERE dop.vn = ?`,
      [vn]
    );

    const reDiags = (Array.isArray(reDiagRows) ? reDiagRows : []).map((r) => ({
      code: String((r as Record<string, unknown>).icd10 || ''),
      name: String((r as Record<string, unknown>).name || ''),
      diagtype: String((r as Record<string, unknown>).diagtype || '4'),
    }));
    const reProcs = [
      ...(Array.isArray(reDentalRows) ? reDentalRows : []).map((r) => ({
        code: String((r as Record<string, unknown>).code || ''),
        name: String((r as Record<string, unknown>).name || ''),
        type: 'Dental',
        tooth: String((r as Record<string, unknown>).tooth || ''),
        tmcode: String((r as Record<string, unknown>).tmcode || ''),
        icd10tm: String((r as Record<string, unknown>).icd10tm || ''),
      })),
      ...(Array.isArray(reDocRows) ? reDocRows : []).map((r) => ({
        code: String((r as Record<string, unknown>).code || ''),
        name: String((r as Record<string, unknown>).name || ''),
        type: 'Doctor',
      })),
    ];

    const reEvaluated = evaluateDentalVisitAudit({
      vn,
      hn: String(visit.hn || ''),
      patient_name: String(visit.patient_name || ''),
      sex: String(visit.sex || ''),
      age_y: Number(visit.age_y || 0),
      service_date: String(visit.service_date || ''),
      service_time: String(visit.service_time || ''),
      pttype: String(visit.pttype || ''),
      pttype_group: pttypeGroup,
      department: String(visit.department || ''),
      diagnoses: reDiags,
      procedures: reProcs,
      chargeItems: charges,
    });

    return {
      success: true,
      vn,
      actionsApplied: executedActions,
      remainingIssues: reEvaluated.issues,
    };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

export const batchFixDentalClinicalVisits = async (input: {
  vns: string[];
  actorUserId?: number | null;
  actorName?: string;
}): Promise<{
  success: boolean;
  totalRequested: number;
  fixedCount: number;
  failedCount: number;
  results: Array<{
    vn: string;
    success: boolean;
    actionsApplied: string[];
    error?: string;
  }>;
}> => {
  const vns = Array.isArray(input.vns) ? input.vns.map(String).map((v) => v.trim()).filter(Boolean) : [];
  if (vns.length === 0) throw new Error('ไม่พบรายการ VN ที่ต้องการแก้ไข');

  const results: Array<{
    vn: string;
    success: boolean;
    actionsApplied: string[];
    error?: string;
  }> = [];

  let fixedCount = 0;
  let failedCount = 0;

  for (const vn of vns) {
    try {
      const res = await fixDentalClinicalVisit({
        vn,
        actorUserId: input.actorUserId,
        actorName: input.actorName,
      });
      fixedCount++;
      results.push({
        vn,
        success: true,
        actionsApplied: res.actionsApplied,
      });
    } catch (err) {
      failedCount++;
      results.push({
        vn,
        success: false,
        actionsApplied: [],
        error: err instanceof Error ? err.message : 'แก้ไขไม่สำเร็จ',
      });
    }
  }

  return {
    success: failedCount === 0,
    totalRequested: vns.length,
    fixedCount,
    failedCount,
    results,
  };
};
