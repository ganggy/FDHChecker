---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/utils/ancDentalRules.ts"
source_hash: "887602004e0e42ed32150e80f25c9cf0773372d216a8021ca04b8a3ab1092a89"
managed_by: "sync-ksp-vault"
---
# ancDentalRules.ts

> Source: `src/utils/ancDentalRules.ts`
> SHA-256: `887602004e0e42ed32150e80f25c9cf0773372d216a8021ca04b8a3ab1092a89`

````typescript
import businessRules from '../config/business_rules.json';

const normalizeCode = (value: unknown) => String(value ?? '').replace(/\./g, '').trim().toUpperCase();
export const ANC_DENTAL_EXAM_PROCEDURE_CODES = businessRules.adp_codes.anc_dental_exam_procedures;
export const ANC_DENTAL_CLEAN_PROCEDURE_CODES = businessRules.adp_codes.anc_dental_clean_procedures;
export const ANC_DENTAL_EXAM_ICD9 = normalizeCode(businessRules.adp_codes.anc_dental_exam_icd9);
export const ANC_DENTAL_CLEAN_ICD9 = normalizeCode(businessRules.adp_codes.anc_dental_clean_icd9);

export const hasMatchingDentalProcedureIcd9 = (
    procedurePairs: unknown,
    allowedCodes: readonly string[],
    requiredIcd9: string,
) => {
    const allowed = new Set(allowedCodes.map(normalizeCode));
    const required = normalizeCode(requiredIcd9);
    return String(procedurePairs ?? '')
        .split(',')
        .map((pair) => pair.split(':').map(normalizeCode))
        .some(([procedureCode, icd9]) => allowed.has(procedureCode) && icd9 === required);
};

````
