export type RevenueMonitorStatus = 'data_error' | 'ready' | 'submitted' | 'paid';
export type ReferBillingEligibility = 'claimable' | 'not_claimable' | 'review';
export type ReferDataAction = 'no_fix_self' | 'no_fix_complete' | 'no_fix_not_claimable' | 'remove_transport_adp' | 'fix_ambulance' | 'fix_adp' | 'review';

export interface RevenueMonitorItem {
  id: string;
  category: 'palliative' | 'instrument' | 'op_refer' | 'ipd_cscd';
  categoryLabel: string;
  serviceDate: string;
  visitCode: string;
  hn: string;
  patientName: string;
  fund: string;
  evidence: string[];
  missing: string[];
  instruction: string;
  status: RevenueMonitorStatus;
  statusLabel: string;
  chargeAmount: number | null;
  claimAmount: number | null;
  paidAmount: number | null;
  eligibility?: ReferBillingEligibility;
  eligibilityLabel?: string;
  eligibilityReasons?: string[];
  transportMode?: 'ambulance' | 'self' | 'unknown';
  dataAction?: ReferDataAction;
  dataActionLabel?: string;
  dataActionReasons?: string[];
}

export interface RevenueMonitorCategory {
  key: RevenueMonitorItem['category'];
  label: string;
  description: string;
  total: number;
  dataErrors: number;
  ready: number;
  submitted: number;
  paid: number;
  knownCharges: number;
  knownClaims: number;
  knownPaid: number;
}

export interface RevenueOpportunityMonitorResult {
  generatedAt: string;
  startDate: string;
  endDate: string;
  conclusion: {
    verdict: 'insufficient_evidence' | 'risk_detected' | 'no_risk_detected';
    label: string;
    explanation: string;
    limitations: string[];
  };
  summary: {
    totalCandidates: number;
    dataErrors: number;
    awaitingClaim: number;
    submitted: number;
    paid: number;
    knownCharges: number;
    knownClaims: number;
    knownPaid: number;
  };
  categories: RevenueMonitorCategory[];
  alerts: Array<{ severity: 'danger' | 'warning' | 'info'; title: string; message: string; count: number }>;
  items: RevenueMonitorItem[];
}

type SourceRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? '').trim();
const numberOrNull = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const flag = (value: unknown) => ['1', 'Y', 'YES', 'TRUE'].includes(text(value).toUpperCase());
const normalizeReferProviderCode = (value: unknown) => {
  const code = text(value).replace(/\s+/g, '').toUpperCase();
  return code === 'EA0010710' ? '10710' : code;
};
const isValidReferProviderCode = (value: unknown) => {
  const code = text(value).replace(/\s+/g, '').toUpperCase();
  return /^\d{5}$/.test(code) || code === 'EA0010710';
};
const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed != null) return parsed;
  }
  return null;
};

const trackingStatus = (row: SourceRow, missing: string[]) => {
  if (missing.length > 0) {
    return { status: 'data_error' as const, statusLabel: 'ข้อมูลไม่ครบ' };
  }
  const paid = firstNumber(row.inv_net_amount, row.stm_paid_amount);
  if ((paid ?? 0) > 0 || flag(row.has_inv_import)) {
    return { status: 'paid' as const, statusLabel: 'พบยอดรับ/ชดเชย' };
  }
  if (flag(row.has_stm_import) || flag(row.has_rep_import) || flag(row.has_fdh_import) || text(row.fdh_claim_status_message)) {
    return { status: 'submitted' as const, statusLabel: 'ส่งแล้ว/รอผล' };
  }
  return { status: 'ready' as const, statusLabel: 'พร้อมตรวจและส่งเบิก' };
};

const commonAmounts = (row: SourceRow) => ({
  claimAmount: firstNumber(row.rep_amount, row.fdh_act_amt),
  paidAmount: firstNumber(row.inv_net_amount, row.stm_paid_amount),
});

export const evaluateOpReferBillingEligibility = (row: SourceRow): {
  eligibility: ReferBillingEligibility;
  label: string;
  reasons: string[];
  transportMode: 'ambulance' | 'self' | 'unknown';
} => {
  const direction = text(row.refer_direction).toUpperCase();
  const isOutbound = direction === 'OUT' || direction === 'BOTH' || flag(row.has_refer_out);
  const isInbound = direction === 'IN' || direction === 'BOTH' || flag(row.has_refer_in);
  const isAmbulance = flag(row.with_ambulance);
  const transportMode = isOutbound ? (isAmbulance ? 'ambulance' : 'self') : 'unknown';
  const isIpd = text(row.service_type).toUpperCase() === 'IP' || flag(row.is_ipd);
  const isAdmitted = flag(row.is_admitted) || Boolean(text(row.an));
  const isUcInCup = /UC\s*ใน\s*CUP/i.test(text(row.finance_name));
  const destination = normalizeReferProviderCode(row.referout_hospcode || row.refer_hospcode);
  const isSakonHospital = destination === '10710';
  // referin has no refer_in_province field. For this hospital, code 10710 is
  // Sakon Hospital and is the concrete same-province signal for either leg.
  const isInProvince = flag(row.refer_in_province) || isSakonHospital;

  if (isOutbound && !isAmbulance) {
    return {
      eligibility: 'not_claimable',
      label: 'ไม่เบิกค่ารถ — ระบบถือว่าเดินทางเอง',
      reasons: ['ช่อง Ambulance ไม่ได้ทำเครื่องหมาย', 'หากใช้รถพยาบาลจริง ให้ตรวจหลักฐานก่อนแก้ข้อมูลต้นทาง'],
      transportMode,
    };
  }
  if (isIpd) {
    return {
      eligibility: 'claimable',
      label: 'เบิกได้ — IPD ทุกสิทธิ์',
      reasons: ['เป็นบริการผู้ป่วยใน', ...(isOutbound ? ['มีหลักฐาน Ambulance'] : [])],
      transportMode,
    };
  }
  if (isInbound && isAdmitted) {
    return {
      eligibility: 'claimable',
      label: 'เบิกได้ — กลับมาแล้ว Admit',
      reasons: ['พบ Refer กลับและเชื่อมกับ Admission'],
      transportMode,
    };
  }
  if (isUcInCup && isInProvince) {
    return {
      eligibility: 'not_claimable',
      label: 'เบิกไม่ได้ — UC OP ในจังหวัด',
      reasons: ['เป็น UC ใน CUP', 'เป็น OP ภายในจังหวัด', 'ใช้กฎเดียวกันทั้งขาไปและขากลับ'],
      transportMode,
    };
  }
  if (!isIpd && isSakonHospital && !isUcInCup) {
    return {
      eligibility: 'claimable',
      label: 'เบิกได้ — OP ส่ง รพ.สกลนคร',
      reasons: ['ปลายทาง 10710 โรงพยาบาลสกลนคร', 'ไม่ใช่ UC ใน CUP', ...(isOutbound ? ['มีหลักฐาน Ambulance'] : [])],
      transportMode,
    };
  }
  return {
    eligibility: 'review',
    label: 'ต้องตรวจสิทธิ/ปลายทางเพิ่มเติม',
    reasons: [
      isUcInCup ? 'พบสิทธิ UC ใน CUP' : 'ไม่ใช่ UC ใน CUP',
      destination ? `ปลายทาง ${destination}` : 'ไม่พบรหัสปลายทาง',
      isAdmitted ? 'พบ Admission' : 'ไม่พบ Admission',
    ],
    transportMode,
  };
};

const buildPalliativeItem = (row: SourceRow): RevenueMonitorItem => {
  const diagnosis = [text(row.z515_code), text(row.z718_code)].filter(Boolean);
  const adpCodes = [
    flag(row.has_30001) ? '30001' : '',
    flag(row.has_cons01) ? 'CONS01' : '',
    flag(row.has_eva001) ? 'EVA001' : '',
  ].filter(Boolean);
  const missing: string[] = [];
  if (diagnosis.length === 0) missing.push('ขาดรหัสวินิจฉัย Palliative (เช่น Z51.5/Z71.8 ตามเกณฑ์ที่ตั้งไว้)');
  if (adpCodes.length === 0) missing.push('ขาดรหัสบริการ Palliative ในรายการค่าใช้จ่าย');
  const tracking = trackingStatus(row, missing);
  return {
    id: `palliative:${text(row.vn)}`,
    category: 'palliative',
    categoryLabel: 'Palliative',
    serviceDate: text(row.serviceDate),
    visitCode: text(row.vn),
    hn: text(row.hn),
    patientName: text(row.patientName),
    fund: text(row.pttypename),
    evidence: [
      diagnosis.length ? `Diagnosis: ${diagnosis.join(', ')}` : '',
      adpCodes.length ? `ADP: ${adpCodes.join(', ')}` : '',
      text(row.close_code) ? `ปิดสิทธิ: ${text(row.close_code)}` : '',
    ].filter(Boolean),
    missing,
    instruction: missing.length
      ? 'ตรวจบันทึก Diagnosis ให้ตรงเวชระเบียน แล้วตรวจรายการค่าบริการ/ADP ก่อนปิดสิทธิและส่งเคลม ห้ามเติมรหัสจากการคาดเดา'
      : 'ตรวจสิทธิ ปิดสิทธิ และติดตาม ClaimDetail → REP → STM/INV จนพบยอดรับจริง',
    ...tracking,
    chargeAmount: null,
    ...commonAmounts(row),
  };
};

const buildInstrumentItem = (row: SourceRow): RevenueMonitorItem => {
  const price = numberOrNull(row.instrument_price);
  const items = text(row.instrument_items);
  const missing: string[] = [];
  if (!items) missing.push('ไม่พบชื่ออุปกรณ์/อวัยวะเทียม');
  if ((price ?? 0) <= 0) missing.push('ยอดอุปกรณ์เป็นศูนย์หรือไม่มีราคา');
  const tracking = trackingStatus(row, missing);
  return {
    id: `instrument:${text(row.vn)}`,
    category: 'instrument',
    categoryLabel: 'Instrument',
    serviceDate: text(row.serviceDate),
    visitCode: text(row.vn),
    hn: text(row.hn),
    patientName: text(row.patientName),
    fund: text(row.pttypename),
    evidence: [
      items ? `รายการ: ${items}` : '',
      flag(row.has_oa) ? 'กลุ่ม OA' : '',
      flag(row.has_dm) ? 'กลุ่ม DM' : '',
      text(row.close_code) ? `ปิดสิทธิ: ${text(row.close_code)}` : '',
    ].filter(Boolean),
    missing,
    instruction: missing.length
      ? 'ตรวจ icode ให้ผูก nondrugitems และ NHSO ADP type/code ถูกต้อง พร้อมจำนวนและราคา ก่อนส่งเบิก'
      : 'ตรวจสิทธิ/หลักฐานประกอบของอุปกรณ์ แล้วติดตามผล REP และยอด STM/INV',
    ...tracking,
    chargeAmount: price,
    ...commonAmounts(row),
  };
};

const buildReferItem = (row: SourceRow): RevenueMonitorItem => {
  const fund = text(row.fund);
  const referHospcode = text(row.refer_hospcode);
  const referNumber = text(row.refer_no_raw);
  const referDirection = text(row.refer_direction);
  const missing: string[] = [];
  if (!flag(row.has_refer_record)) missing.push('ไม่พบระเบียน Refer in/out ที่เชื่อมกับ VN');
  if (flag(row.has_refer_record) && !referNumber) missing.push('ระเบียน Refer ขาดเลขที่ใบส่งต่อ');
  if (flag(row.has_refer_record) && !isValidReferProviderCode(referHospcode)) {
    missing.push(referHospcode
      ? `รหัสหน่วยบริการต้นทาง/ปลายทางไม่ถูกต้อง (พบ ${referHospcode})`
      : 'ระเบียน Refer ขาดรหัสหน่วยบริการต้นทาง/ปลายทาง');
  }
  if (flag(row.has_refer_record) && !text(row.refer_date)) missing.push('ระเบียน Refer ขาดวันที่ส่งต่อ');
  if (flag(row.has_refer_record) && !['IN', 'OUT'].includes(referDirection)) missing.push('ระเบียน Refer ไม่ระบุทิศทางรับเข้า/ส่งต่อ');
  if (!text(row.main_diag)) missing.push('ขาด Diagnosis หลัก');
  if (!flag(row.has_receipt) || (numberOrNull(row.total_price) ?? 0) <= 0) missing.push('ขาดรายการค่าใช้จ่ายหรือยอดเป็นศูนย์');
  if (!flag(row.has_close)) missing.push('ยังไม่พบ EP/การปิดสิทธิ');
  const billingEligibility = evaluateOpReferBillingEligibility(row);
  const referAdpCodes = text(row.refer_adp_codes)
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const hasAnyReferS1 = flag(row.has_refer_adp_s) || referAdpCodes.some((code) => /^S1/.test(code));
  const hasReferAdpS18 = referAdpCodes.some((code) => /^S18/.test(code))
    || (flag(row.has_refer_adp_s) && referAdpCodes.length === 0);
  const selfTravelTransportChargeConflict = billingEligibility.transportMode === 'self' && hasAnyReferS1;
  if (billingEligibility.eligibility === 'claimable' && !hasReferAdpS18) {
    missing.push('ใบสั่งยา/รายการค่าใช้จ่ายขาด ADP รหัส S18xx (เช่น S1801/S1802 ตามบริการจริง) สำหรับค่า Refer — เสี่ยงสูญเสียรายได้');
  }
  if (selfTravelTransportChargeConflict) {
    missing.push(`ติด C: ผู้ป่วย Refer ไปเอง แต่พบข้อเบิกค่ารถ ADP ${referAdpCodes.join(', ') || 'S1...'} — ให้ลบรายการข้อเบิกค่ารถ Refer ออกจากใบสั่งยา`);
  }
  const dataAction: {
    key: ReferDataAction;
    label: string;
    reasons: string[];
  } = billingEligibility.transportMode === 'self'
    ? hasAnyReferS1
      ? {
          key: 'remove_transport_adp',
          label: 'ติด C — ต้องลบข้อเบิกค่ารถ Refer',
          reasons: [
            'ข้อมูล Refer ระบุว่าผู้ป่วยไปเอง',
            `พบ ADP ${referAdpCodes.join(', ') || 'S1...'}`,
            'ค่ารถ Refer เบิกไม่ได้ ให้ลบรายการ S1... จากใบสั่งยา',
          ],
        }
      : {
          key: 'no_fix_self',
          label: 'ไม่ต้องแก้ — Refer ไปเอง',
          reasons: ['ไม่ได้เลือก Ambulance', 'ไม่พบ ADP ค่ารถ S18xx', 'ถือเป็นการเดินทางเองตามข้อมูลต้นทาง'],
        }
    : billingEligibility.eligibility === 'not_claimable'
      ? {
          key: 'no_fix_not_claimable',
          label: 'ไม่ต้องแก้ข้อมูล — กฎไม่ให้เบิก',
          reasons: ['ข้อมูลการเดินทางไม่ขัดแย้ง', 'ไม่ส่งเบิกตามเงื่อนไขสิทธิ'],
        }
      : billingEligibility.eligibility === 'review'
        ? {
            key: 'review',
            label: 'ต้องทบทวนเอกสารก่อนตัดสินใจ',
            reasons: ['สิทธิหรือปลายทางยังไม่ชัดเจน'],
          }
        : !hasReferAdpS18
          ? {
              key: 'fix_adp',
              label: 'ควรแก้ — ขาด ADP ค่า Refer S18xx',
              reasons: ['รายการเข้าเกณฑ์เบิก', 'ไม่พบ S1801/S1802 ตามบริการจริง', 'เสี่ยงสูญเสียรายได้'],
            }
          : {
              key: 'no_fix_complete',
              label: 'ไม่ต้องแก้ — Ambulance/ADP ครบ',
              reasons: ['พบข้อมูลการเดินทางและ ADP S18xx สอดคล้องกัน'],
            };
  const tracking = trackingStatus(row, missing);
  const instruction = billingEligibility.eligibility === 'not_claimable'
    ? selfTravelTransportChargeConflict
      ? `ผู้ป่วย Refer ไปเอง เบิกค่ารถไม่ได้ ให้ลบรายการ ADP ${referAdpCodes.join(', ') || 'S1...'} ที่เป็นข้อเบิกค่ารถออกจากใบสั่งยา แล้วตรวจข้อมูลใหม่ก่อนส่งเคลม`
      : billingEligibility.transportMode === 'self'
      ? 'ไม่ส่งเบิกค่ารถ เพราะไม่ได้ทำเครื่องหมาย Ambulance และระบบถือว่าเดินทางเอง หากใช้รถพยาบาลจริงให้ตรวจใบนำส่ง/ทะเบียนรถก่อนแก้ข้อมูลต้นทาง'
      : 'ไม่ส่งเบิกค่า OP Refer ตามกฎ UC ใน CUP สำหรับ OP ภายในจังหวัด ทั้งขาไปและขากลับ'
    : billingEligibility.eligibility === 'review'
      ? 'ให้ผู้รับผิดชอบตรวจกลุ่มสิทธิ จุดรับส่ง และสถานะ Admit กับเอกสาร Refer ก่อนตัดสินใจส่งเบิก'
      : missing.length
        ? 'รายการเข้าเกณฑ์เบิก แต่ต้องตรวจเลขและวันที่ Refer ทิศทาง รหัสหน่วยบริการ Diagnosis ค่าใช้จ่าย EP และ ADP รหัส S18xx ในใบสั่งยาให้ครบก่อนส่ง'
        : 'รายการเข้าเกณฑ์เบิก ให้ตรวจแฟ้ม ORF หลักฐาน Ambulance/Admission และ ADP รหัส S18xx ในใบสั่งยา แล้วส่งตามรอบพร้อมติดตามผลตอบกลับ';
  return {
    id: `op_refer:${text(row.vn)}`,
    category: 'op_refer',
    categoryLabel: 'OP Refer',
    serviceDate: text(row.serviceDate),
    visitCode: text(row.vn),
    hn: text(row.hn),
    patientName: text(row.patientName),
    fund,
    evidence: [
      text(row.refer_no) ? `Refer: ${text(row.refer_no)}` : '',
      referDirection ? `ทิศทาง: ${referDirection === 'IN' ? 'รับเข้า' : referDirection === 'OUT' ? 'ส่งต่อ' : referDirection}` : '',
      text(row.refer_date) ? `วันที่ Refer: ${text(row.refer_date)}` : '',
      referHospcode ? `หน่วยบริการ: ${referHospcode}${referHospcode.replace(/\s+/g, '').toUpperCase() === 'EA0010710' ? ' (รหัสสถานพยาบาล 10710)' : ''}` : '',
      text(row.finance_name) ? `กลุ่มสิทธิ: ${text(row.finance_name)}` : '',
      billingEligibility.transportMode === 'ambulance' ? 'Ambulance: ✓ รถพยาบาล' : '',
      billingEligibility.transportMode === 'self' ? 'Ambulance: ✗ ถือว่าเดินทางเอง' : '',
      referAdpCodes.length ? `ADP ค่า Refer: ${referAdpCodes.join(', ')}` : '',
      text(row.refer_adp_items) ? `รายการ ADP: ${text(row.refer_adp_items)}` : '',
      text(row.an) ? `Admit: AN ${text(row.an)}` : '',
      text(row.main_diag) ? `Diagnosis: ${text(row.main_diag)}` : '',
      text(row.project_code) ? `Project: ${text(row.project_code)}` : '',
      flag(row.has_close) ? `ปิดสิทธิ: ${text(row.close_code) || 'พบ EP'}` : '',
    ].filter(Boolean),
    missing,
    instruction,
    ...tracking,
    statusLabel: selfTravelTransportChargeConflict ? 'ข้อมูลผิดพลาด (ติด C)' : tracking.statusLabel,
    chargeAmount: numberOrNull(row.total_price),
    claimAmount: null,
    paidAmount: null,
    eligibility: billingEligibility.eligibility,
    eligibilityLabel: billingEligibility.label,
    eligibilityReasons: billingEligibility.reasons,
    transportMode: billingEligibility.transportMode,
    dataAction: dataAction.key,
    dataActionLabel: dataAction.label,
    dataActionReasons: dataAction.reasons,
  };
};

const buildCscdItem = (row: SourceRow): RevenueMonitorItem => {
  const missing: string[] = [];
  if (!text(row.pdx)) missing.push('ขาด Diagnosis หลักของ IPD');
  if (!text(row.dchdate)) missing.push('ผู้ป่วยยังไม่จำหน่าย/ยังสรุปเคสไม่ได้');
  if ((numberOrNull(row.totalPrice) ?? 0) <= 0) missing.push('ยอดค่าใช้จ่าย IPD เป็นศูนย์');
  if (text(row.dchdate) && !text(row.drg)) missing.push('ยังไม่พบ DRG');
  const tracking = trackingStatus({
    ...row,
    has_fdh_import: Boolean(text(row.fdh_claim_detail_status) || text(row.fdh_transaction_uid)),
    fdh_claim_status_message: row.fdh_status_label,
    fdh_act_amt: row.fdh_act_amt,
  }, missing);
  return {
    id: `ipd_cscd:${text(row.an)}`,
    category: 'ipd_cscd',
    categoryLabel: 'IPD สิทธิ CSCD',
    serviceDate: text(row.admDate),
    visitCode: text(row.an),
    hn: text(row.hn),
    patientName: text(row.patientName),
    fund: text(row.pttype),
    evidence: [
      text(row.pdx) ? `PDX: ${text(row.pdx)}` : '',
      text(row.drg) ? `DRG: ${text(row.drg)} / RW ${text(row.rw) || '-'}` : '',
      text(row.ward) ? `Ward: ${text(row.ward)}` : '',
      text(row.fdh_status_label),
    ].filter(Boolean),
    missing,
    instruction: missing.length
      ? 'ให้ทีม Ward/เวชระเบียนตรวจวันจำหน่าย สรุป Diagnosis/Procedure และ DRG จากเวชระเบียนจริง แล้วทีมการเงินตรวจค่าใช้จ่ายก่อนส่ง'
      : 'ตรวจความสอดคล้องสิทธิ CSCD, DRG/RW และค่าใช้จ่าย จากนั้นติดตามสถานะ FDH/ผลชดเชย',
    ...tracking,
    chargeAmount: numberOrNull(row.totalPrice),
    claimAmount: numberOrNull(row.fdh_act_amt),
    paidAmount: null,
  };
};

const CATEGORY_META: Array<Pick<RevenueMonitorCategory, 'key' | 'label' | 'description'>> = [
  { key: 'ipd_cscd', label: 'IPD สิทธิ CSCD', description: 'กลุ่มที่ข้อความอ้างว่ารายรับสูง ต้องดู DRG/RW ค่าใช้จ่าย และผลชดเชยจริง' },
  { key: 'op_refer', label: 'OP Refer', description: 'ตรวจสิทธิรับส่งต่อ Ambulance, Admit, ปลายทาง, Diagnosis, เลข Refer และ EP' },
  { key: 'instrument', label: 'Instrument', description: 'ตรวจการผูกอุปกรณ์กับ ADP code จำนวน ราคา และผลตอบกลับ' },
  { key: 'palliative', label: 'Palliative', description: 'ตรวจ Diagnosis คู่กับรหัสบริการ ไม่สรุปจากชื่อคลินิกเพียงอย่างเดียว' },
];

export const buildRevenueOpportunityMonitor = (input: {
  startDate: string;
  endDate: string;
  palliativeRows: SourceRow[];
  instrumentRows: SourceRow[];
  opdRows: SourceRow[];
  ipdRows: SourceRow[];
}): RevenueOpportunityMonitorResult => {
  const referRows = input.opdRows.filter((row) => flag(row.has_refer_record) || /OP\s*Refer|รับส่งต่อ|Refer/i.test(text(row.fund)));
  const cscdRows = input.ipdRows.filter((row) => /CSCD/i.test(text(row.pttype)));
  const items = [
    ...input.palliativeRows.map(buildPalliativeItem),
    ...input.instrumentRows.map(buildInstrumentItem),
    ...referRows.map(buildReferItem),
    ...cscdRows.map(buildCscdItem),
  ].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || a.visitCode.localeCompare(b.visitCode));

  const sumKnown = (rows: RevenueMonitorItem[], key: 'chargeAmount' | 'claimAmount' | 'paidAmount') =>
    Math.round(rows.reduce((sum, row) => sum + (row[key] ?? 0), 0) * 100) / 100;
  const categories = CATEGORY_META.map((meta) => {
    const rows = items.filter((item) => item.category === meta.key);
    return {
      ...meta,
      total: rows.length,
      dataErrors: rows.filter((row) => row.status === 'data_error').length,
      ready: rows.filter((row) => row.status === 'ready').length,
      submitted: rows.filter((row) => row.status === 'submitted').length,
      paid: rows.filter((row) => row.status === 'paid').length,
      knownCharges: sumKnown(rows, 'chargeAmount'),
      knownClaims: sumKnown(rows, 'claimAmount'),
      knownPaid: sumKnown(rows, 'paidAmount'),
    };
  });
  const dataErrors = items.filter((item) => item.status === 'data_error').length;
  const ready = items.filter((item) => item.status === 'ready').length;
  const submitted = items.filter((item) => item.status === 'submitted').length;
  const paid = items.filter((item) => item.status === 'paid').length;
  const limitations = [
    'ยังไม่มีข้อมูลยอดและจำนวนผู้ป่วยของ “หน่วยงานกลุ่มเปรียบเทียบ” จึงยืนยันอันดับสูง/กลาง/ต่ำไม่ได้',
    'ยอดค่าบริการ (charge) ไม่เท่ากับยอดเคลม และยอดเคลมไม่เท่ากับเงินที่ได้รับจริง',
    'การพบสัญญาณข้อมูลไม่ครบเป็นคิวให้คนตรวจเวชระเบียน ไม่ใช่คำสั่งให้เติมรหัสโดยไม่มีหลักฐาน',
  ];
  const verdict = dataErrors > 0 ? 'risk_detected' as const : items.length > 0 ? 'no_risk_detected' as const : 'insufficient_evidence' as const;
  const alerts: RevenueOpportunityMonitorResult['alerts'] = [];
  if (dataErrors > 0) alerts.push({ severity: 'danger', title: 'พบรายการเสี่ยงข้อมูลไม่ครบ', message: 'ควรให้ผู้รับผิดชอบตรวจหลักฐานและแก้ที่ต้นทางก่อนส่ง', count: dataErrors });
  if (ready > 0) alerts.push({ severity: 'warning', title: 'ข้อมูลพร้อมแต่ยังไม่พบผลการส่ง', message: 'ตรวจคิวส่งเคลมและกำหนดผู้รับผิดชอบ', count: ready });
  if (submitted > 0) alerts.push({ severity: 'info', title: 'ส่งแล้วแต่ยังไม่พบยอดรับ', message: 'ติดตาม REP/STM/INV และรหัสปฏิเสธตามรอบ', count: submitted });

  return {
    generatedAt: new Date().toISOString(),
    startDate: input.startDate,
    endDate: input.endDate,
    conclusion: {
      verdict,
      label: verdict === 'risk_detected' ? 'พบความเสี่ยงที่ต้องตรวจ แต่ยังยืนยันข้อความเรื่องอันดับไม่ได้' : verdict === 'no_risk_detected' ? 'ยังไม่พบความผิดพลาดจากกฎที่ตรวจ และยังยืนยันอันดับไม่ได้' : 'ข้อมูลไม่พอสำหรับยืนยันหรือโต้แย้ง',
      explanation: 'ระบบใช้เส้นทางหลักฐาน บริการ → ความครบถ้วน → การส่งเคลม → REP/STM/INV แทนการตัดสินจากยอดรวมเพียงตัวเดียว',
      limitations,
    },
    summary: {
      totalCandidates: items.length,
      dataErrors,
      awaitingClaim: ready,
      submitted,
      paid,
      knownCharges: sumKnown(items, 'chargeAmount'),
      knownClaims: sumKnown(items, 'claimAmount'),
      knownPaid: sumKnown(items, 'paidAmount'),
    },
    categories,
    alerts,
    items,
  };
};
