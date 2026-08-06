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
