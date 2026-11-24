import adpType2Catalog2569 from './config/nhsoAdpType2_2569.json';

export type InstrumentFundKey = 'OFC' | 'UCS' | 'SSS' | 'LGO';

export interface InstrumentType2RateSpec {
  code: string;
  name: string;
  OFC: number;
  UCS: number;
  SSS: number;
  LGO: number;
  FS: number;
  UCEP: number;
}

export interface InstrumentRuleSpec {
  adpCode: string;
  itemNo: string;
  subCategory: string;
  name: string;
  englishName: string;
  unit: string;
  rates: {
    UCS: number;
    LGO: number;
    OFC: number;
    SSS: number;
  };
  indications: string[];
  supportingIcd9: string[];
  pciIcd9: string[];
  supportingIcd10Prefixes: string[];
  instabilityIcd10Prefixes: string[];
}

/**
 * กติกาการเบิกจ่ายรหัส 4511 (4.5.11): แผ่นปิดหน้าอกเพื่อรับหรือปล่อยไฟฟ้าในการกระตุ้นหัวใจ
 * ตามประกาศบัญชีรายการอุปกรณ์/อวัยวะเทียม สปสช. ปี 2569 (UCS 2,850 บาท/ชุด), กรมบัญชีกลาง/สปส./อปท. (OFC/SSS/LGO 3,000 บาท/ชุด)
 */
export const INSTRUMENT_RULE_4511: InstrumentRuleSpec = {
  adpCode: '4511',
  itemNo: '125',
  subCategory: '4.5.11',
  name: 'แผ่นปิดหน้าอกเพื่อรับหรือปล่อยไฟฟ้าในการกระตุ้นหัวใจ',
  englishName: 'Disposable Defibrillation Electrode, Disposable Pacing Electrode',
  unit: 'ชุดละ (2 แผ่น)',
  rates: {
    UCS: 2850,
    LGO: 3000,
    OFC: 3000,
    SSS: 3000,
  },
  indications: [
    '1) ใช้กระตุกหัวใจชั่วคราวโดยต่อกับเครื่องกระตุกหัวใจภายนอกร่างกายในกรณีฉุกเฉิน',
    '2) ใช้ monitor ในการตรวจระบบไฟฟ้าภายในหัวใจ (Cardiac Electrophysiologic Study)',
    '3) ถ้าใช้ monitor ระหว่างทำ PCI ต้องเป็นผู้ป่วยที่มี Cardiovascular Instability เท่านั้น',
  ],
  // 99.60 CPR, 99.61 Atrial cardioversion, 99.62 Other electric countershock/defib,
  // 99.64 Carotid sinus stimulation, 99.69 Other conversion of cardiac rhythm, 37.26 Cardiac EPS
  supportingIcd9: ['9960', '9961', '9962', '9964', '9969', '3726', '3778'],
  // 00.66 PTCA/PCI, 36.01-36.09 Coronary angioplasty/stent
  pciIcd9: ['0066', '3601', '3602', '3605', '3606', '3607', '3609'],
  // Arrhythmias, Cardiac arrest, AV block, Cardiogenic shock, Acute MI
  supportingIcd10Prefixes: ['I46', 'I47', 'I48', 'I49', 'I44', 'I45', 'R57', 'I21', 'I50'],
  // Instability / shock / arrest / malignant arrhythmia for PCI justification
  instabilityIcd10Prefixes: ['R57', 'I46', 'I490', 'I472', 'I442', 'I21', 'I50'],
};

const normalizeCode = (code: string) => code.replace(/[\s.]/g, '').toUpperCase();

const splitCodes = (raw: unknown): string[] =>
  String(raw ?? '')
    .split(',')
    .map((s) => normalizeCode(s))
    .filter(Boolean);

export function resolveInstrumentFundKey(hipdataCode: string, pttypeName: string): InstrumentFundKey {
  const hip = String(hipdataCode || '').toUpperCase();
  const name = String(pttypeName || '');
  if (hip === 'OFC' || hip === 'OF' || name.includes('ข้าราชการ') || name.includes('เบิกตรง')) {
    return 'OFC';
  }
  if (hip === 'SSS' || hip === 'SSI' || hip === 'SS' || name.includes('ประกันสังคม')) {
    return 'SSS';
  }
  if (hip === 'LGO' || hip === 'LG' || name.includes('อปท') || name.includes('ท้องถิ่น')) {
    return 'LGO';
  }
  return 'UCS';
}

export function get4511CeilingByFund(hipdataCode: string, pttypeName: string): {
  fund: InstrumentFundKey;
  ceiling: number;
} {
  const fund = resolveInstrumentFundKey(hipdataCode, pttypeName);
  return { fund, ceiling: INSTRUMENT_RULE_4511.rates[fund] };
}

export interface Instrument4511Evaluation {
  has4511: boolean;
  missing: string[];
  warnings: string[];
  fund: 'UCS' | 'OFC' | 'SSS' | 'LGO';
  ceiling: number;
}

export function evaluateInstrument4511(row: {
  has_4511?: unknown;
  instrument_4511_price?: unknown;
  instrument_4511_qty?: unknown;
  instrument_diags?: unknown;
  instrument_procs?: unknown;
  hipdata_code?: unknown;
  pttypename?: unknown;
}): Instrument4511Evaluation {
  const has4511 = String(row.has_4511 ?? '').toUpperCase() === 'Y';
  const { fund, ceiling } = get4511CeilingByFund(String(row.hipdata_code ?? ''), String(row.pttypename ?? ''));

  if (!has4511) {
    return { has4511: false, missing: [], warnings: [], fund, ceiling };
  }

  const missing: string[] = [];
  const warnings: string[] = [];

  const diags = splitCodes(row.instrument_diags);
  const procs = splitCodes(row.instrument_procs);

  const hasSupportingProc = procs.some((p) => INSTRUMENT_RULE_4511.supportingIcd9.includes(p));
  const hasPciProc = procs.some((p) => INSTRUMENT_RULE_4511.pciIcd9.some((pci) => p.startsWith(pci)));
  const hasSupportingDiag = diags.some((d) =>
    INSTRUMENT_RULE_4511.supportingIcd10Prefixes.some((prefix) => d.startsWith(prefix))
  );
  const hasInstabilityDiag = diags.some((d) =>
    INSTRUMENT_RULE_4511.instabilityIcd10Prefixes.some((prefix) => d.startsWith(prefix))
  );

  // Rule 3: PCI requires Cardiovascular Instability
  if (hasPciProc && !hasInstabilityDiag) {
    missing.push('4511 ใช้ระหว่างทำ PCI ต้องมีรหัสวินิจฉัยภาวะ Cardiovascular Instability (เช่น R57/I46/I49.0)');
  } else if (!hasSupportingProc && !hasSupportingDiag) {
    missing.push('4511 ขาดข้อบ่งชี้ (กระตุกหัวใจฉุกเฉิน 99.60-99.62 / EPS 37.26 หรือ Diag หัวใจเต้นผิดจังหวะ/Cardiac Arrest)');
  }

  // Price check against ceiling per set
  const price = Number(row.instrument_4511_price ?? 0) || 0;
  const qty = Math.max(1, Number(row.instrument_4511_qty ?? 1) || 1);
  const maxAllowed = ceiling * qty;
  if (price > maxAllowed + 0.01) {
    warnings.push(`4511 ยอดเบิก ${price.toLocaleString()} บาท เกินเพดานสิทธิ ${fund} (${ceiling.toLocaleString()} บาท/ชุด)`);
  }

  return { has4511: true, missing, warnings, fund, ceiling };
}

export const INSTRUMENT_TYPE2_2569_CATALOG: InstrumentType2RateSpec[] =
  adpType2Catalog2569 as InstrumentType2RateSpec[];

const normalizeAdpCode = (code: unknown): string => String(code ?? '').trim().toUpperCase();

export const INSTRUMENT_TYPE2_2569_MAP: ReadonlyMap<string, InstrumentType2RateSpec> = new Map(
  INSTRUMENT_TYPE2_2569_CATALOG.map((spec) => [normalizeAdpCode(spec.code), spec])
);

export function getInstrumentType2Spec2569(adpCode: unknown): InstrumentType2RateSpec | undefined {
  const key = normalizeAdpCode(adpCode);
  return key ? INSTRUMENT_TYPE2_2569_MAP.get(key) : undefined;
}

export interface InstrumentVisitItemInput {
  adpCode?: unknown;
  icode?: unknown;
  name?: unknown;
  qty?: unknown;
  unitprice?: unknown;
  sumPrice?: unknown;
}

export interface InstrumentAuditItemIssue {
  adpCode: string;
  icode: string;
  name: string;
  qty: number;
  unitprice: number;
  sumPrice: number;
  ceiling: number;
  excessAmount: number;
  eligibleAmount: number;
}

export interface InstrumentVisit2569Audit {
  fund: InstrumentFundKey;
  checkedCount: number;
  totalBilled: number;
  eligibleAmount: number;
  excessAmount: number;
  unclaimableItems: InstrumentAuditItemIssue[];
  overCeilingItems: InstrumentAuditItemIssue[];
  unknownCodeItems: Array<{
    adpCode: string;
    icode: string;
    name: string;
    qty: number;
    unitprice: number;
    sumPrice: number;
  }>;
  errors: string[];
  warnings: string[];
}

const roundBaht = (n: number): number => Math.round(n * 100) / 100;
const FUND_KEYS: InstrumentFundKey[] = ['OFC', 'UCS', 'SSS', 'LGO'];

/**
 * ตรวจรายการอุปกรณ์/อวัยวะเทียม หมวด 2 (nhso_adp_type_id = 2) เทียบตารางเพดานสิทธิ สปสช./กรมบัญชีกลาง ปี 2569 รายสิทธิ
 */
export function evaluateInstrumentVisit2569(
  items: InstrumentVisitItemInput[],
  hipdataCode: string,
  pttypeName: string
): InstrumentVisit2569Audit {
  const fund = resolveInstrumentFundKey(hipdataCode, pttypeName);
  const unclaimableItems: InstrumentAuditItemIssue[] = [];
  const overCeilingItems: InstrumentAuditItemIssue[] = [];
  const unknownCodeItems: InstrumentVisit2569Audit['unknownCodeItems'] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let totalBilled = 0;
  let eligibleAmount = 0;
  let excessAmount = 0;

  for (const item of items) {
    const adpCode = normalizeAdpCode(item.adpCode);
    const icode = String(item.icode ?? '').trim();
    const rawName = String(item.name ?? '').trim();
    const rawQty = Number(item.qty ?? 1);
    const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;

    const hasExplicitSum =
      item.sumPrice !== undefined &&
      item.sumPrice !== null &&
      String(item.sumPrice).trim() !== '' &&
      Number.isFinite(Number(item.sumPrice));
    const rawUnit = Number(item.unitprice ?? 0);
    const hasPositiveUnit = Number.isFinite(rawUnit) && rawUnit > 0;
    const sumPrice = roundBaht(
      hasExplicitSum ? Math.max(0, Number(item.sumPrice)) : hasPositiveUnit ? rawUnit * qty : 0
    );
    const unitprice = roundBaht(hasPositiveUnit ? rawUnit : sumPrice > 0 ? sumPrice / qty : 0);

    totalBilled = roundBaht(totalBilled + sumPrice);

    const spec = getInstrumentType2Spec2569(adpCode);
    if (!spec) {
      const displayName = rawName || adpCode || icode || '-';
      unknownCodeItems.push({ adpCode, icode, name: displayName, qty, unitprice, sumPrice });
      warnings.push(
        `รหัส ${adpCode || '(ไม่มีรหัส ADP)'} (${displayName}) ไม่พบในบัญชีอวัยวะเทียม/อุปกรณ์ หมวด 2 ปี 2569`
      );
      continue;
    }

    const ceiling = spec[fund];
    const displayName = rawName || spec.name;

    if (ceiling <= 0) {
      const claimableFunds = FUND_KEYS.filter((k) => spec[k] > 0);
      unclaimableItems.push({
        adpCode,
        icode,
        name: displayName,
        qty,
        unitprice,
        sumPrice,
        ceiling: 0,
        excessAmount: sumPrice,
        eligibleAmount: 0,
      });
      excessAmount = roundBaht(excessAmount + sumPrice);
      const allowHint = claimableFunds.length > 0 ? `, เบิกได้เฉพาะ ${claimableFunds.join('/')}` : '';
      errors.push(
        `รหัส ${adpCode} (${displayName}) สิทธิ ${fund} เบิกไม่ได้ตามบัญชี 2569 (เพดาน 0 บ.${allowHint})`
      );
      continue;
    }

    const maxAllowed = roundBaht(ceiling * qty);
    const itemEligible = roundBaht(Math.min(sumPrice, maxAllowed));
    const itemExcess = roundBaht(Math.max(0, sumPrice - maxAllowed));

    eligibleAmount = roundBaht(eligibleAmount + itemEligible);
    excessAmount = roundBaht(excessAmount + itemExcess);

    if (unitprice > ceiling + 0.01 || itemExcess > 0.01) {
      overCeilingItems.push({
        adpCode,
        icode,
        name: displayName,
        qty,
        unitprice,
        sumPrice,
        ceiling,
        excessAmount: itemExcess,
        eligibleAmount: itemEligible,
      });
      warnings.push(
        `รหัส ${adpCode} (${displayName}) ราคา ${unitprice.toLocaleString()} บ./หน่วย เกินเพดาน ${fund} (${ceiling.toLocaleString()} บ.${itemExcess > 0 ? `, ส่วนเกิน ${itemExcess.toLocaleString()} บ.` : ''})`
      );
    }
  }

  return {
    fund,
    checkedCount: items.length,
    totalBilled,
    eligibleAmount,
    excessAmount,
    unclaimableItems,
    overCeilingItems,
    unknownCodeItems,
    errors,
    warnings,
  };
}
