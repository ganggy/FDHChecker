---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/mophVaccineRules.ts"
source_hash: "cf5d51a6f6bd9c57a989d7b63f3e220ea31b5dd4b8ebdf44afe6ee23042d8659"
managed_by: "sync-ksp-vault"
---
# mophVaccineRules.ts

> Source: `server/mophVaccineRules.ts`
> SHA-256: `cf5d51a6f6bd9c57a989d7b63f3e220ea31b5dd4b8ebdf44afe6ee23042d8659`

````typescript
export const AP_VACCINE_CODE = 'P41';
export const AP_VACCINE_RULE_EFFECTIVE_DATE = '2026-06-05';

export type ApVaccineRule = {
  effectiveDate: string;
  minimumGaWeek: number;
  maximumGaWeek: number | null;
  label: string;
};

const LEGACY_AP_RULE: ApVaccineRule = {
  effectiveDate: AP_VACCINE_RULE_EFFECTIVE_DATE,
  minimumGaWeek: 27,
  maximumGaWeek: 36,
  label: 'GA 27–36 สัปดาห์ (Visit ก่อน 5 มิ.ย. 2569)',
};

const CURRENT_AP_RULE: ApVaccineRule = {
  effectiveDate: AP_VACCINE_RULE_EFFECTIVE_DATE,
  minimumGaWeek: 16,
  maximumGaWeek: null,
  label: 'GA ตั้งแต่ 16 สัปดาห์ขึ้นไป (Visit ตั้งแต่ 5 มิ.ย. 2569)',
};

const normalizeServiceDate = (value: unknown) => String(value || '').trim().slice(0, 10);

const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const getApVaccineRule = (serviceDate: unknown): ApVaccineRule => (
  normalizeServiceDate(serviceDate) >= AP_VACCINE_RULE_EFFECTIVE_DATE
    ? CURRENT_AP_RULE
    : LEGACY_AP_RULE
);

export const validateApVaccineEligibility = (row: {
  vaccineCode?: unknown;
  serviceDate?: unknown;
  pregNo?: unknown;
  ga?: unknown;
}): string => {
  if (String(row.vaccineCode || '').trim().toUpperCase() !== AP_VACCINE_CODE) return '';

  const serviceDate = normalizeServiceDate(row.serviceDate);
  if (!isIsoDate(serviceDate)) return 'Error:ไม่ระบุวันที่รับบริการ';

  const pregNo = Number(row.pregNo);
  if (!Number.isFinite(pregNo) || pregNo < 1) return 'Error:ไม่ระบุครรภ์ที่';

  const ga = Number(row.ga);
  if (!Number.isFinite(ga) || ga <= 0) return 'Error:ไม่ระบุอายุครรภ์';

  const rule = getApVaccineRule(serviceDate);
  if (ga < rule.minimumGaWeek || (rule.maximumGaWeek !== null && ga > rule.maximumGaWeek)) {
    return serviceDate >= AP_VACCINE_RULE_EFFECTIVE_DATE
      ? 'Error:อายุครรภ์ต้องตั้งแต่ 16 สัปดาห์ขึ้นไป (Visit ตั้งแต่ 5 มิ.ย. 2569)'
      : 'Error:อายุครรภ์ต้อง 27–36 สัปดาห์ (Visit ก่อน 5 มิ.ย. 2569)';
  }

  return '';
};

````
