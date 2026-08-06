import businessRules from '../config/business_rules.json';

const normalizeCode = (value: unknown) => String(value ?? '').replace(/\./g, '').trim().toUpperCase();
const collectCodes = (value: unknown) => String(value ?? '')
    .split(',')
    .map(normalizeCode)
    .filter(Boolean);

export const ANC_DENTAL_EXAM_PROCEDURE_CODES = businessRules.adp_codes.anc_dental_exam_procedures;
export const ANC_DENTAL_CLEAN_PROCEDURE_CODES = businessRules.adp_codes.anc_dental_clean_procedures;

export const getMatchingDentalProcedureAdpCodes = (
    procedureCodes: unknown,
    dentalAdpCodes: unknown,
    allowedCodes: readonly string[],
) => {
    const procedures = new Set(collectCodes(procedureCodes));
    const adpCodes = new Set(collectCodes(dentalAdpCodes));
    return allowedCodes
        .map(normalizeCode)
        .filter((code) => procedures.has(code) && adpCodes.has(code));
};
