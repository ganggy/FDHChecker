export type IpdLosMatchType = 'exact' | 'prefix';

export type IpdLosRule = {
  id: string;
  diagnosisCode: string;
  matchType: IpdLosMatchType;
  targetLos: number;
  note: string;
  active: boolean;
};

export type IpdLosAssessment = {
  los_target: number | null;
  los_variance: number | null;
  los_status: 'over' | 'within' | 'no_rule';
  los_rule_code: string | null;
  los_rule_match_type: IpdLosMatchType | null;
  los_rule_note: string | null;
};

const defaultRule = (
  id: string,
  diagnosisCode: string,
  matchType: IpdLosMatchType,
  targetLos: number,
  averageLos: number | string,
  label: string,
): IpdLosRule => ({
  id,
  diagnosisCode,
  matchType,
  targetLos,
  note: `${label} · LOS เฉลี่ยมาตรฐาน ${averageLos} วัน`,
  active: true,
});

// Source: “รายงาน วันนอนที่เหมาะสม ใน 30 อันดับโรคผู้ป่วยใน”
// Khok Si Suphan Hospital, 1 Oct 2024 – 4 Aug 2026. The warning target uses
// the report's “maximum appropriate LOS” column; averages remain explanatory.
export const DEFAULT_IPD_LOS_RULES: IpdLosRule[] = [
  defaultRule('default-a09', 'A09', 'prefix', 6, 3, 'Diarrhoea and gastroenteritis'),
  defaultRule('default-j18', 'J18', 'prefix', 11, 4, 'Pneumonia, organism unspecified'),
  defaultRule('default-r50', 'R50', 'prefix', 10, 4, 'Fever of unknown origin'),
  defaultRule('default-i10', 'I10', 'prefix', 6, 2, 'Essential hypertension'),
  defaultRule('default-f15', 'F15', 'prefix', 23, 14, 'Mental and behavioral disorders due to stimulants'),
  defaultRule('default-a41', 'A41', 'prefix', 12, 5, 'Other septicaemia'),
  defaultRule('default-r10', 'R10', 'prefix', 5, 2, 'Abdominal and pelvic pain'),
  defaultRule('default-e11', 'E11', 'prefix', 9, 3, 'Non-insulin-dependent diabetes mellitus'),
  defaultRule('default-n18', 'N18', 'prefix', 7, 3, 'Chronic renal failure'),
  defaultRule('default-j45', 'J45', 'prefix', 8, 3, 'Asthma'),
  defaultRule('default-j44', 'J44', 'prefix', 9, 3, 'Chronic obstructive pulmonary disease'),
  defaultRule('default-r42', 'R42', 'prefix', 5, 2, 'Dizziness and giddiness'),
  defaultRule('default-j11', 'J11', 'prefix', 11, 4, 'Influenza, virus not identified'),
  defaultRule('default-d56', 'D56', 'prefix', 5, 2, 'Thalassaemia'),
  defaultRule('default-j20', 'J20', 'prefix', 8, 2, 'Acute bronchitis'),
  defaultRule('default-r53', 'R53', 'prefix', 6, 2, 'Malaise and fatigue'),
  defaultRule('default-f100', 'F100', 'exact', 7, 3, 'Alcohol-related disorder F100'),
  defaultRule('default-f101', 'F101', 'exact', 27, 9, 'Alcohol-related disorder F101'),
  defaultRule('default-f102', 'F102', 'exact', 27, 9, 'Alcohol-related disorder F102'),
  defaultRule('default-f103', 'F103', 'exact', 7, 3, 'Alcohol-related disorder F103'),
  defaultRule('default-f104', 'F104', 'exact', 14, 5, 'Alcohol-related disorder F104'),
  defaultRule('default-f105', 'F105', 'exact', 14, 5, 'Alcohol-related disorder F105'),
  defaultRule('default-f106', 'F106', 'exact', 27, 9, 'Alcohol-related disorder F106'),
  defaultRule('default-i50', 'I50', 'prefix', 10, 4, 'Heart failure'),
  defaultRule('default-n39', 'N39', 'prefix', 10, 4, 'Other disorders of urinary system'),
  defaultRule('default-n10', 'N10', 'prefix', 12, 4, 'Acute tubulo-interstitial nephritis'),
  defaultRule('default-j12', 'J12', 'prefix', 11, 4, 'Viral pneumonia'),
  defaultRule('default-a050', 'A050', 'exact', 6, 3, 'Bacterial foodborne intoxication A050'),
  defaultRule('default-a503', 'A503', 'exact', 6, 3, 'รหัส A503 ตามเอกสารต้นฉบับ'),
  defaultRule('default-a052', 'A052', 'exact', 6, 3, 'Bacterial foodborne intoxication A052'),
  defaultRule('default-a051', 'A051', 'exact', 12, 4, 'Bacterial foodborne intoxication A051'),
  defaultRule('default-j21', 'J21', 'prefix', 16, 6, 'Acute bronchiolitis'),
  defaultRule('default-e87', 'E87', 'prefix', 7, 3, 'Fluid, electrolyte and acid-base disorder'),
  defaultRule('default-l02', 'L02', 'prefix', 13, 5, 'Cutaneous abscess, furuncle and carbuncle'),
  defaultRule('default-l03', 'L03', 'prefix', 13, 5, 'Cellulitis'),
  defaultRule('default-f20', 'F20', 'prefix', 28, 14, 'Schizophrenia'),
  defaultRule('default-j00', 'J00', 'prefix', 7, 3, 'Acute nasopharyngitis'),
  defaultRule('default-s06', 'S06', 'prefix', 5, 2, 'Intracranial injury'),
  defaultRule('default-r11', 'R11', 'prefix', 8, 3, 'Nausea and vomiting'),
  defaultRule('default-a40', 'A40', 'prefix', 12, 5, 'Sepsis (IP AI Pre-Audit)'),
  defaultRule('default-m726', 'M726', 'exact', 8, 3, 'Necrotizing fasciitis (IP AI Pre-Audit)'),
  defaultRule('default-r57', 'R57', 'prefix', 10, 4, 'Shock (IP AI Pre-Audit)'),
  defaultRule('default-d60', 'D60', 'prefix', 4, 3, 'Anemia D60–D64 (IP AI Pre-Audit)'),
  defaultRule('default-d61', 'D61', 'prefix', 4, 3, 'Anemia D60–D64 (IP AI Pre-Audit)'),
  defaultRule('default-d62', 'D62', 'prefix', 4, 3, 'Anemia D60–D64 (IP AI Pre-Audit)'),
  defaultRule('default-d63', 'D63', 'prefix', 4, 3, 'Anemia D60–D64 (IP AI Pre-Audit)'),
  defaultRule('default-d64', 'D64', 'prefix', 4, 3, 'Anemia D60–D64 (IP AI Pre-Audit)'),
  defaultRule('default-f19', 'F19', 'prefix', 24, 8, 'Substance-related disorder (IP AI Pre-Audit)'),
  defaultRule('default-i251', 'I251', 'exact', 7, 3, 'Atherosclerotic heart disease (IP AI Pre-Audit)'),
];

const normalizeDiagnosisCode = (value: unknown) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '');

export const normalizeIpdLosRules = (value: unknown): IpdLosRule[] => {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 500).map((item, index) => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const diagnosisCode = normalizeDiagnosisCode(source.diagnosisCode);
    const rawTarget = Number(source.targetLos);
    const targetLos = Number.isFinite(rawTarget) ? Math.round(rawTarget * 10) / 10 : 0;
    return {
      id: String(source.id || `ipd-los-${index + 1}`).trim().slice(0, 80),
      diagnosisCode,
      matchType: source.matchType === 'prefix' ? 'prefix' : 'exact',
      targetLos,
      note: String(source.note || '').trim().slice(0, 250),
      active: source.active !== false,
    };
  });
};

export const validateIpdLosRules = (value: unknown) => {
  if (!Array.isArray(value)) return { ok: false as const, error: 'รูปแบบรายการ LOS ไม่ถูกต้อง' };
  if (value.length > 500) return { ok: false as const, error: 'กำหนดกฎ LOS ได้ไม่เกิน 500 รายการ' };

  const rules = normalizeIpdLosRules(value);
  const seen = new Set<string>();
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!/^[A-Z][A-Z0-9]{1,6}$/.test(rule.diagnosisCode)) {
      return { ok: false as const, error: `รายการที่ ${index + 1}: รหัส ICD-10 ไม่ถูกต้อง` };
    }
    if (!(rule.targetLos > 0 && rule.targetLos <= 365)) {
      return { ok: false as const, error: `รายการที่ ${index + 1}: LOS ต้องมากกว่า 0 และไม่เกิน 365 วัน` };
    }
    const uniqueKey = `${rule.matchType}:${rule.diagnosisCode}`;
    if (seen.has(uniqueKey)) {
      return { ok: false as const, error: `พบกฎซ้ำ: ${rule.diagnosisCode} (${rule.matchType === 'prefix' ? 'กลุ่มรหัส' : 'รหัสตรงกัน'})` };
    }
    seen.add(uniqueKey);
  }
  return { ok: true as const, rules };
};

export const findIpdLosRule = (principalDiagnosis: unknown, rules: IpdLosRule[]) => {
  const diagnosis = normalizeDiagnosisCode(principalDiagnosis);
  if (!diagnosis) return null;

  return rules
    .filter((rule) => rule.active && (
      rule.matchType === 'exact'
        ? diagnosis === rule.diagnosisCode
        : diagnosis.startsWith(rule.diagnosisCode)
    ))
    .sort((left, right) => {
      if (left.matchType !== right.matchType) return left.matchType === 'exact' ? -1 : 1;
      return right.diagnosisCode.length - left.diagnosisCode.length;
    })[0] || null;
};

export const assessIpdLos = (principalDiagnosis: unknown, actualLos: unknown, rules: IpdLosRule[]): IpdLosAssessment => {
  const rule = findIpdLosRule(principalDiagnosis, rules);
  if (!rule) {
    return {
      los_target: null,
      los_variance: null,
      los_status: 'no_rule',
      los_rule_code: null,
      los_rule_match_type: null,
      los_rule_note: null,
    };
  }

  const parsedActualLos = Number(actualLos);
  const actual = Number.isFinite(parsedActualLos) ? parsedActualLos : 0;
  const variance = Math.round((actual - rule.targetLos) * 10) / 10;
  return {
    los_target: rule.targetLos,
    los_variance: variance,
    los_status: variance > 0 ? 'over' : 'within',
    los_rule_code: rule.diagnosisCode,
    los_rule_match_type: rule.matchType,
    los_rule_note: rule.note || null,
  };
};
