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

