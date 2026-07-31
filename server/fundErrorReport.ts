import { getRevenueOpportunitySourceRows, getSpecificFundData } from './db.js';
import { pushLineMessages, type LineMessage } from './lineMessaging.js';
import { buildRevenueOpportunityMonitor } from './revenueOpportunityMonitor.js';

type FundRow = Record<string, unknown>;

export type FundError = {
  hn: string;
  serviceDate: string;
  missing: string[];
};

export type FundErrorSection = {
  id: string;
  name: string;
  checked: number;
  errors: FundError[];
  queryError?: string;
};

type FundSpec = { id: string; name: string };

const OP_REFER_TRANSPORT_FUND: FundSpec = {
  id: 'op_refer_self_transport',
  name: 'OP Refer — เบิกค่ารถทั้งที่ผู้ป่วยไปเอง',
};

export const LINE_ALERT_EXCLUDED_FUND_IDS = new Set([
  'anc',
  'anc_ultrasound',
  'anc_dental_exam',
  'anc_dental_clean',
]);

export const isLineAlertExcludedFund = (fundId: string) => LINE_ALERT_EXCLUDED_FUND_IDS.has(fundId);

export const REPORT_FUNDS: FundSpec[] = [
  { id: 'palliative', name: 'Palliative Care' },
  { id: 'telemedicine', name: 'Telemedicine' },
  { id: 'drugp', name: 'ส่งยาไปรษณีย์' },
  { id: 'herb', name: 'สมุนไพร / ยาไทย' },
  { id: 'knee', name: 'ยาพอกเข่า (43 แฟ้ม)' },
  { id: 'instrument', name: 'อวัยวะเทียม' },
  { id: 'preg_test', name: 'ตรวจครรภ์ (UPT)' },
  { id: 'anc_lab_1', name: 'ANC Lab 1' },
  { id: 'anc_lab_2', name: 'ANC Lab 2' },
  { id: 'postnatal_care', name: 'ดูแลหลังคลอด' },
  { id: 'postnatal_supplements', name: 'เสริมธาตุเหล็กหลังคลอด' },
  { id: 'fluoride', name: 'เคลือบฟลูออไรด์' },
  { id: 'fp', name: 'วางแผนครอบครัว' },
  { id: 'contraceptive_pill', name: 'ยาคุมกำเนิด' },
  { id: 'condom', name: 'ยาฉีดคุมกำเนิด' },
  { id: 'cacervix', name: 'คัดกรองมะเร็งปากมดลูก' },
  { id: 'fpg_screening', name: 'คัดกรองเบาหวาน' },
  { id: 'cholesterol_screening', name: 'คัดกรองหัวใจหลอดเลือด' },
  { id: 'anemia_screening', name: 'คัดกรองโลหิตจาง' },
  { id: 'syphilis_screening_male', name: 'คัดกรองซิฟิลิส (ชาย)' },
  { id: 'iron_supplement', name: 'เสริมธาตุเหล็ก' },
  { id: 'ferrokid_child', name: 'เสริมธาตุเหล็กเด็ก (Ferrokid)' },
  { id: 'mental_health_counselling', name: 'ปรึกษาสุขภาพจิต' },
  { id: 'gender_affirming_hormone', name: 'ฮอร์โมนยืนยันเพศสภาพ' },
  { id: 'osteoporosis_screening', name: 'คัดกรองกระดูกพรุน' },
  { id: 'autism_tdas_screening', name: 'คัดกรองออทิสติก TDAS' },
  { id: 'clopidogrel', name: 'ยา Clopidogrel' },
];

const flag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'Y' || value === 'y';
const text = (value: unknown) => String(value ?? '').trim();
const present = (value: unknown) => text(value) !== '';
const cleanCode = (value: unknown) => text(value).replace(/\./g, '').toUpperCase();
const codes = (row: FundRow) => [
  row.pdx, row.main_diag, row.diag_code, row.dx0, row.dx1, row.dx2, row.dx3, row.dx4, row.dx5,
  row.z515_code, row.z718_code, row.fp_diags, row.anc_diags, row.pp_diags, row.preg_diags,
].flatMap((value) => text(value).split(/[^A-Za-z0-9.]+/)).map(cleanCode).filter(Boolean);
const hasCode = (row: FundRow, wanted: string[]) => {
  const available = new Set(codes(row));
  return wanted.some((value) => available.has(cleanCode(value)));
};
const hasPrefix = (row: FundRow, prefix: string) => codes(row).some((value) => value.startsWith(cleanCode(prefix)));
const hasListedCode = (value: unknown, wanted: string[]) => {
  const available = new Set(text(value).split(',').map(cleanCode).filter(Boolean));
  return wanted.some((code) => available.has(cleanCode(code)));
};
const isUcsLike = (row: FundRow) => {
  const hip = `${text(row.hipdata_code)} ${text(row.fund)} ${text(row.hipdata_desc)}`.toUpperCase();
  return ['UCS', 'UC', 'WEL', 'UNK'].some((code) => hip.includes(code));
};
export const isFundReportEligible = (fundId: string, row: FundRow) => {
  if (['palliative', 'telemedicine', 'drugp'].includes(fundId)) return isUcsLike(row);
  if (fundId === 'herb') return isUcsLike(row);
  return true;
};
const requireValue = (missing: string[], met: boolean, label: string) => { if (!met) missing.push(label); };
const addWebNearStatusMissing = (
  missing: string[],
  adpMet: boolean,
  adpLabel: string,
  requirements: Array<{ met: boolean; label: string }>,
) => {
  const missingRequirements = requirements.filter((requirement) => !requirement.met);
  if (adpMet) {
    missing.push(...missingRequirements.map((requirement) => requirement.label));
  } else if (missingRequirements.length === 0 && adpLabel) {
    missing.push(adpLabel);
  }
};

export const getFundMissingConditions = (fundId: string, row: FundRow) => {
  const missing: string[] = [];
  const age = Number(row.age_y ?? row.age ?? -1);
  const ageMonths = Number(row.age_month ?? -1);
  const female = text(row.sex) === '2';
  const male = text(row.sex) === '1';
  const hip = `${text(row.hipdata_code)} ${text(row.fund)} ${text(row.hipdata_desc)}`.toUpperCase();
  const ucs = ['UCS', 'UC', 'WEL', 'UNK'].some((code) => hip.includes(code));
  const ancDiag = flag(row.has_anc_diag) || hasPrefix(row, 'Z34') || hasPrefix(row, 'Z35') || present(row.anc_diags);
  const fpDiag = flag(row.has_fp_diag) || hasPrefix(row, 'Z30');
  const ppDiag = flag(row.has_pp_diag) || hasCode(row, ['Z390', 'Z391', 'Z392']);

  switch (fundId) {
    case 'palliative':
    {
      const hasDiag = flag(row.has_pal_diag) || hasCode(row, ['Z515', 'Z718']);
      const hasAdp = flag(row.has_pal_adp) || flag(row.has_30001) || flag(row.has_cons01) || flag(row.has_eva001);
      if (!ucs) break;
      addWebNearStatusMissing(missing, hasAdp, 'ADP 30001/Cons01/Eva001', [{ met: hasDiag, label: 'Diagnosis Z515/Z718' }]);
      break;
    }
    case 'telemedicine':
      if (!ucs) break;
      requireValue(missing, flag(row.has_telmed) || text(row.ovstist_export_code) === '5', 'ADP/Export TELMED');
      break;
    case 'drugp':
      if (!ucs) break;
      requireValue(missing, flag(row.has_drugp), 'ADP DRUGP');
      requireValue(missing, Number(row.drug_count ?? 0) > 0, 'รายการยา');
      break;
    case 'herb':
      if (!(ucs || hip.includes('WEL'))) break;
      requireValue(missing, Number(row.herb_total_price ?? 0) > 0 || flag(row.has_herb), 'รายการสมุนไพร/ยอดราคา');
      break;
    case 'knee':
      requireValue(missing, flag(row.knee_age_eligible) || age >= 40, 'อายุ 40 ปีขึ้นไป');
      requireValue(missing, (flag(row.has_knee_diag_m17) || hasPrefix(row, 'M17')) && (flag(row.has_knee_diag_u5753) || hasCode(row, ['U5753'])), 'Diagnosis M17 และ U57.53');
      requireValue(missing, flag(row.has_knee_massage_thigh), 'หัตถการ 872-78-11');
      requireValue(missing, flag(row.has_knee_massage_knee), 'หัตถการ 873-78-11');
      requireValue(missing, flag(row.has_knee_massage_lower_leg), 'หัตถการ 874-78-11');
      requireValue(missing, flag(row.has_knee_poultice), 'หัตถการ 873-78-35');
      requireValue(missing, Number(row.knee_poultice_14d_count ?? 0) <= 5, 'เกิน 5 ครั้งใน 2 สัปดาห์');
      break;
    case 'instrument': requireValue(missing, Number(row.instrument_price ?? 0) > 0 || flag(row.has_instrument), 'อุปกรณ์/ยอดอวัยวะเทียม'); break;
    case 'cacervix':
      addWebNearStatusMissing(
        missing,
        flag(row.has_cx_adp) || present(row.ca_adp_codes),
        'ADP คัดกรอง',
        [{ met: flag(row.has_cx_diag) || present(row.ca_diags), label: 'Diagnosis/บริการคัดกรอง' }],
      );
      break;
    case 'fp':
      addWebNearStatusMissing(missing, flag(row.has_fp_adp) || present(row.fp_adp_codes), 'ADP/หัตถการ FP', [{ met: fpDiag, label: 'Diagnosis Z30x' }]);
      break;
    case 'anc':
      addWebNearStatusMissing(missing, flag(row.has_anc_visit) || hasListedCode(row.anc_adp_codes, ['30011']), 'ADP 30011', [
        { met: female, label: 'เพศหญิง' },
        { met: ancDiag, label: 'Diagnosis Z34/Z35' },
      ]);
      break;
    case 'anc_ultrasound':
    {
      const hasAncUs = flag(row.has_anc_us) || hasListedCode(row.anc_adp_codes, ['30010']);
      if (!hasAncUs) break;
      const requirements = [
        { met: female, label: 'เพศหญิง' },
        { met: ancDiag, label: 'Diagnosis Z34/Z35' },
      ];
      addWebNearStatusMissing(missing, hasAncUs, 'ADP 30010', requirements);
      break;
    }
    case 'anc_lab_1':
      addWebNearStatusMissing(missing, flag(row.has_anc_lab1) || hasListedCode(row.anc_adp_codes, ['30012']), 'ADP 30012', [
        { met: female, label: 'เพศหญิง' }, { met: ancDiag, label: 'Diagnosis Z34/Z35' },
        ...([['anc_lab1_cbc','CBC'],['anc_lab1_dcip','DCIP'],['anc_lab1_abo','ABO group'],['anc_lab1_rh','Rh grouping'],['anc_lab1_hbsag','HBsAg'],['anc_lab1_syphilis','Treponema Pallidum Ab'],['anc_lab1_hiv','HIV-Ab Screening']] as const)
          .map(([key, label]) => ({ met: flag(row[key]), label })),
      ]);
      break;
    case 'anc_lab_2':
      addWebNearStatusMissing(missing, flag(row.has_anc_lab2) || hasListedCode(row.anc_adp_codes, ['30013']), 'ADP 30013', [
        { met: female, label: 'เพศหญิง' }, { met: ancDiag, label: 'Diagnosis Z34/Z35' },
        ...([['anc_lab2_hiv','Anti-HIV ANC 2'],['anc_lab2_syphilis','Treponema Pallidum Ab ANC 2'],['anc_lab2_cbc','CBC']] as const)
          .map(([key, label]) => ({ met: flag(row[key]), label })),
      ]);
      break;
    case 'anc_dental_exam':
    case 'anc_dental_clean': {
      const exam = fundId === 'anc_dental_exam';
      addWebNearStatusMissing(
        missing,
        flag(row[exam ? 'has_anc_dental_exam' : 'has_anc_dental_clean']) || hasListedCode(row.anc_adp_codes, [exam ? '30008' : '30009']),
        `ADP ${exam ? '30008' : '30009'}`,
        [{ met: female, label: 'เพศหญิง' }, { met: ancDiag, label: 'Diagnosis Z34/Z35' }, { met: hasPrefix(row, 'K'), label: 'Diagnosis K*' }],
      );
      break;
    }
    case 'preg_test':
      addWebNearStatusMissing(missing, flag(row.has_preg_item) || flag(row.has_upt) || flag(row.has_specific_adp), 'ADP 30014', [
        { met: flag(row.has_preg_diag) || hasCode(row, ['Z320', 'Z321']) || present(row.preg_diags), label: 'Diagnosis Z320/Z321' },
        { met: flag(row.has_preg_lab) || present(row.preg_lab_name) || present(row.preg_result), label: 'Lab UPT/31101' },
      ]);
      break;
    case 'postnatal_care': addWebNearStatusMissing(missing, flag(row.has_post_care), 'ADP 30015', [{ met: ppDiag, label: 'Diagnosis Z390/Z391/Z392' }]); break;
    case 'postnatal_supplements':
      addWebNearStatusMissing(missing, flag(row.has_post_supp), 'ADP 30016', [
        { met: female, label: 'เพศหญิง' },
        { met: flag(row.has_post_supp_diag) || hasCode(row, ['Z391', 'Z392']), label: 'Diagnosis Z391/Z392' },
        { met: flag(row.has_post_iron_med), label: 'ยาเสริมธาตุเหล็ก' },
      ]); break;
    case 'fluoride': requireValue(missing, flag(row.has_specific_adp) || hasListedCode(row.anc_adp_codes, ['15001']), 'ADP 15001'); break;
    case 'contraceptive_pill':
      addWebNearStatusMissing(missing, flag(row.has_specific_adp) || hasListedCode(row.fp_adp_codes, ['FP003_1', 'FP003_2']), 'ADP FP003_1/FP003_2', [{ met: hasCode(row, ['Z304']), label: 'Diagnosis Z304' }]); break;
    case 'condom': addWebNearStatusMissing(missing, flag(row.has_specific_adp) || hasListedCode(row.fp_adp_codes, ['FP003_4']), 'ADP FP003_4', [{ met: fpDiag, label: 'Diagnosis Z30x' }]); break;
    case 'fpg_screening':
      addWebNearStatusMissing(missing, flag(row.has_fpg_adp), 'ADP 12003', [
        { met: flag(row.age_eligible), label: 'อายุ 35-59 ปี' }, { met: flag(row.has_fpg_lab), label: 'Lab FPG' },
        { met: flag(row.has_fpg_diag) || hasCode(row, ['Z131','Z133','Z136']), label: 'Diagnosis Z131/Z133/Z136' },
      ]); break;
    case 'cholesterol_screening':
      addWebNearStatusMissing(missing, flag(row.has_chol_adp), 'ADP 12004', [
        { met: flag(row.age_eligible), label: 'อายุ 45-70 ปี' }, { met: flag(row.has_chol_lab), label: 'Lab Total Cholesterol และ HDL' },
        { met: flag(row.has_chol_diag) || hasCode(row, ['Z136']), label: 'Diagnosis Z136' },
      ]); break;
    case 'anemia_screening': {
      const ageEligible = flag(row.age_eligible) || (age >= 13 && age <= 24) || (ageMonths >= 6 && ageMonths <= 12) || (age >= 3 && age <= 6);
      const requiresCbc = age >= 13 && age <= 24;
      const requiresHbHct = (ageMonths >= 6 && ageMonths <= 12) || (age >= 3 && age <= 6);
      const labOk = requiresCbc ? flag(row.has_anemia_cbc) : requiresHbHct ? flag(row.has_anemia_hbhct) : flag(row.has_anemia_lab);
      addWebNearStatusMissing(missing, flag(row.has_anemia_adp), 'ADP 13001', [
        { met: ageEligible, label: 'ช่วงอายุตามเกณฑ์' },
        { met: labOk, label: requiresCbc ? 'Lab CBC' : requiresHbHct ? 'Lab Hb/Hct' : 'Lab CBC / Hb/Hct' },
        { met: flag(row.has_anemia_diag) || hasCode(row, ['Z130','Z138']), label: 'Diagnosis Z130/Z138' },
      ]); break;
    }
    case 'syphilis_screening_male': requireValue(missing, male, 'เพศชาย'); requireValue(missing, flag(row.has_syphilis_lab) || present(row.syphilis_lab_names) || present(row.syphilis_service_names), 'Lab Treponema/Syphilis'); break;
    case 'iron_supplement': addWebNearStatusMissing(missing, flag(row.has_iron_adp), 'ADP 14001', [
      { met: flag(row.age_eligible) || (female && age >= 13 && age <= 45), label: 'หญิงอายุ 13-45 ปี' },
      { met: flag(row.has_iron_diag) || hasCode(row, ['Z130']), label: 'Diagnosis Z130' },
      { met: flag(row.has_iron_med), label: 'ยาเสริมธาตุเหล็ก' },
    ]); break;
    case 'ferrokid_child': requireValue(missing, flag(row.ferrokid_age_eligible) || (ageMonths >= 6 && ageMonths <= 12), 'อายุ 6-12 เดือน'); requireValue(missing, flag(row.has_ferrokid_diag) || hasCode(row, ['Z130']), 'Diagnosis Z130'); requireValue(missing, flag(row.has_ferrokid_med) || flag(row.has_ferrokid), 'ยา Ferrokid'); break;
    case 'hepc':
    case 'hepb': {
      const labPrefix = fundId === 'hepc' ? 'hepc' : 'hepb';
      const hasScreeningLab =
        flag(row[`has_${labPrefix}_lab`])
        || present(row[`${labPrefix}_lab_names`])
        || present(row[`${labPrefix}_service_names`]);
      if (!hasScreeningLab) break;
      requireValue(missing, flag(row.birth_before_2535) || (present(row.birthday) && new Date(text(row.birthday)) < new Date('1992-01-01')), 'เกิดก่อน พ.ศ.2535');
      requireValue(missing, flag(row.has_z115_diag) || hasCode(row, ['Z115']), 'Diagnosis Z11.5');
      break;
    }
    case 'mental_health_counselling':
    case 'gender_affirming_hormone':
    case 'latent_tb_screening':
    case 'osteoporosis_screening':
    case 'autism_tdas_screening':
      requireValue(missing, flag(row.age_eligible), 'อายุ/กลุ่มเป้าหมายตามเกณฑ์'); requireValue(missing, flag(row.sex_eligible), 'เพศตามเกณฑ์'); requireValue(missing, flag(row.has_specific_evidence) || present(row.specific_lab_names) || present(row.specific_service_names), text(row.specific_evidence_label) || 'หลักฐานบริการ/Lab'); break;
    case 'clopidogrel': requireValue(missing, flag(row.has_clopidogrel) || flag(row.has_clopidogrel_drug), 'รายการยา Clopidogrel'); break;
  }
  return missing;
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const buildOpReferSelfTransportErrorSection = (
  opdRows: FundRow[],
  startDate: string,
  endDate: string,
): FundErrorSection => {
  const monitor = buildRevenueOpportunityMonitor({
    startDate,
    endDate,
    palliativeRows: [],
    instrumentRows: [],
    opdRows,
    ipdRows: [],
  });
  const referItems = monitor.items.filter((item) => item.category === 'op_refer');
  const errors = referItems
    .filter((item) => item.dataAction === 'remove_transport_adp')
    .map((item) => ({
      hn: item.hn || 'ไม่ระบุ HN',
      serviceDate: item.serviceDate || startDate,
      missing: item.missing.filter((issue) => issue.startsWith('ติด C:')),
    }))
    .filter((item) => item.missing.length > 0);
  return {
    ...OP_REFER_TRANSPORT_FUND,
    checked: referItems.length,
    errors,
  };
};

export const queryFundErrorReport = async (
  startDate: string,
  endDate: string,
  onProgress?: (current: number, total: number, fund: FundSpec) => void,
) => {
  const sections: FundErrorSection[] = [];
  const totalReports = REPORT_FUNDS.length + 1;
  for (const [index, fund] of REPORT_FUNDS.entries()) {
    onProgress?.(index + 1, totalReports, fund);
    try {
      const rows = await getSpecificFundData(fund.id, startDate, endDate, { includeTracking: false, throwOnError: true });
      const eligibleRows = rows.filter((row) => isFundReportEligible(fund.id, row));
      const errors = eligibleRows.map((row) => ({
        hn: text(row.hn) || 'ไม่ระบุ HN',
        serviceDate: text(row.serviceDate) || startDate,
        missing: getFundMissingConditions(fund.id, row),
      })).filter((item) => item.missing.length > 0);
      sections.push({ ...fund, checked: eligibleRows.length, errors });
    } catch (error) {
      sections.push({ ...fund, checked: 0, errors: [], queryError: errorMessage(error).slice(0, 180) });
    }
  }
  onProgress?.(totalReports, totalReports, OP_REFER_TRANSPORT_FUND);
  try {
    const rows = await getRevenueOpportunitySourceRows(startDate, endDate);
    sections.push(buildOpReferSelfTransportErrorSection(rows.opdRows, startDate, endDate));
  } catch (error) {
    sections.push({
      ...OP_REFER_TRANSPORT_FUND,
      checked: 0,
      errors: [],
      queryError: errorMessage(error).slice(0, 180),
    });
  }
  return sections;
};

const formatFundErrorDetail = (missing: string[]) => (
  missing.some((item) => item.startsWith('ติด C:'))
    ? missing.join(', ')
    : `ขาด ${missing.join(', ')}`
);

export const formatFundErrorReport = (sections: FundErrorSection[], startDate: string, endDate: string) => {
  const alertSections = sections.filter((section) => !isLineAlertExcludedFund(section.id));
  const totalErrors = alertSections.reduce((sum, section) => sum + section.errors.length, 0);
  const lines = [`📋 ตรวจสอบกองทุน/43 แฟ้ม`, `วันที่ ${startDate}${endDate === startDate ? '' : ` ถึง ${endDate}`}`, `ตรวจ ${alertSections.length} กองทุน • พบผิด ${totalErrors} รายการ`, ''];
  for (const section of alertSections) {
    if (section.queryError) {
      lines.push(`❗ ${section.name}`, `ตรวจ query ไม่สำเร็จ: ${section.queryError}`, '');
    } else if (section.errors.length === 0) {
      lines.push(`✅ ${section.name}: ไม่พบข้อผิดพลาด (ตรวจ ${section.checked})`);
    } else {
      lines.push(`❌ ${section.name}: ผิด ${section.errors.length}/${section.checked}`);
      section.errors.forEach((item, index) => lines.push(`${index + 1}. HN ${item.hn} — ${formatFundErrorDetail(item.missing)}`));
      lines.push('');
    }
  }
  lines.push('🔒 รายงานนี้แสดงเฉพาะ HN ไม่มีข้อมูลระบุตัวบุคคลอื่น');
  return lines.join('\n').trim();
};

export const chunkLineText = (report: string, maxLength = 4500) => {
  const chunks: string[] = [];
  let current = '';
  for (const rawLine of report.split('\n')) {
    const line = rawLine.length > maxLength ? rawLine.slice(0, maxLength - 1) + '…' : rawLine;
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
};

const splitFundSection = (section: FundErrorSection, maxLength = 4500) => {
  const title = `❌ ${section.name}: ผิด ${section.errors.length}/${section.checked}`;
  const messages: string[] = [];
  let currentLines = [title];

  section.errors.forEach((item, index) => {
    const line = `${index + 1}. HN ${item.hn} — ${formatFundErrorDetail(item.missing)}`;
    const candidate = [...currentLines, line].join('\n');
    if (candidate.length > maxLength && currentLines.length > 1) {
      messages.push(currentLines.join('\n'));
      currentLines = [`${title} (ต่อ)`];
    }
    currentLines.push(line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line);
  });

  if (currentLines.length > 1) messages.push(currentLines.join('\n'));
  return messages;
};

export const buildDailyFundLineMessages = (
  sections: FundErrorSection[],
  reportDate: string,
  maxLength = 4500,
) => {
  const alertSections = sections.filter((section) => !isLineAlertExcludedFund(section.id));
  const totalErrors = alertSections.reduce((sum, section) => sum + section.errors.length, 0);
  const messages = [
    [
      '📋 ตรวจสอบกองทุน/43 แฟ้ม',
      `วันที่ ${reportDate}`,
      `ตรวจ ${alertSections.length} กองทุน • พบผิด ${totalErrors} รายการ`,
    ].join('\n'),
  ];

  for (const section of alertSections) {
    if (section.queryError) {
      messages.push(`❗ ${section.name}\nตรวจ query ไม่สำเร็จ: ${section.queryError}`);
    } else if (section.errors.length > 0) {
      messages.push(...splitFundSection(section, maxLength));
    }
  }
  return messages;
};

const pushTextMessages = async (messages: string[]) => {
  const targetId = text(process.env.LINE_TARGET_ID);
  if (!targetId) throw new Error('LINE_TARGET_ID is not configured');
  for (let index = 0; index < messages.length; index += 5) {
    const lineMessages: LineMessage[] = messages.slice(index, index + 5).map((value) => ({ type: 'text', text: value }));
    await pushLineMessages(targetId, lineMessages);
  }
  return messages.length;
};

export const sendDailyFundErrorReportToLine = async (sections: FundErrorSection[], reportDate: string) => (
  pushTextMessages(buildDailyFundLineMessages(sections, reportDate))
);

export const sendFundErrorReportToLine = async (report: string, startChunk = 0) => {
  const chunks = chunkLineText(report).slice(Math.max(0, startChunk));
  return pushTextMessages(chunks);
};
