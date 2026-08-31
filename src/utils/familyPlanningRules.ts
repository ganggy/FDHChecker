export type FamilyPlanningServiceRule = {
    code: string;
    label: string;
    amount: number;
    diagnosis: 'Z304' | 'Z308';
    procedure?: string;
    annualLimit?: { maximum: number; unit: string };
};

export const FAMILY_PLANNING_SERVICE_RULES: FamilyPlanningServiceRule[] = [
    { code: 'FP002_1', label: 'ฝังยาคุมกำเนิด', amount: 2150, diagnosis: 'Z308', procedure: '9923' },
    { code: 'FP002_2', label: 'ถอดยาฝังคุมกำเนิด', amount: 350, diagnosis: 'Z308', procedure: '8605' },
    { code: 'FP003_1', label: 'ยาเม็ดคุมกำเนิดฮอร์โมนรวม Anna', amount: 40, diagnosis: 'Z304' },
    { code: 'FP003_2', label: 'ยาเม็ดคุมกำเนิดฮอร์โมนเดี่ยว Lynestrenol', amount: 80, diagnosis: 'Z304' },
    { code: 'FP003_3', label: 'ยาเม็ดคุมกำเนิดฉุกเฉิน', amount: 50, diagnosis: 'Z304', annualLimit: { maximum: 2, unit: 'แผง/ปี' } },
    { code: 'FP003_4', label: 'ยาฉีดคุมกำเนิด', amount: 60, diagnosis: 'Z304', annualLimit: { maximum: 5, unit: 'ครั้ง/ปี' } },
];

const normalize = (value: unknown) => String(value ?? '').trim().replace(/\./g, '').toUpperCase();

export const splitFamilyPlanningCodes = (value: unknown) => String(value ?? '')
    .split(/[,|;/\s]+/)
    .map(normalize)
    .filter(Boolean);

export const evaluateFamilyPlanningEvidence = (
    facts: { diagnosisCodes?: unknown; adpCodes?: unknown; procedureCodes?: unknown; emergencyPillYearQuantity?: unknown; injectionYearCount?: unknown },
    allowedCodes = FAMILY_PLANNING_SERVICE_RULES.map((rule) => rule.code),
) => {
    const diagnoses = new Set(splitFamilyPlanningCodes(facts.diagnosisCodes));
    const adpCodes = new Set(splitFamilyPlanningCodes(facts.adpCodes));
    const procedures = new Set(splitFamilyPlanningCodes(facts.procedureCodes));
    const allowed = new Set(allowedCodes.map(normalize));
    const services = FAMILY_PLANNING_SERVICE_RULES.filter((rule) => allowed.has(rule.code) && adpCodes.has(rule.code));
    const allKnownCodes = new Set(FAMILY_PLANNING_SERVICE_RULES.map((rule) => rule.code));
    const acceptsOtherFpCodes = allowed.size === allKnownCodes.size && [...allKnownCodes].every((code) => allowed.has(code));
    const otherFpCodes = acceptsOtherFpCodes
        ? [...adpCodes].filter((code) => code.startsWith('FP') && !allKnownCodes.has(code))
        : [];
    const hasZ30Diagnosis = [...diagnoses].some((code) => code.startsWith('Z30'));
    const missing: string[] = [];

    if (services.length === 0) {
        if (otherFpCodes.length > 0 && !hasZ30Diagnosis) {
            missing.push(`${otherFpCodes.join('/')}: Diagnosis Z30x`);
        } else if (otherFpCodes.length === 0 && hasZ30Diagnosis) {
            missing.push(`ADP ${allowedCodes.join('/')}`);
        }
    } else {
        for (const service of services) {
            if (!diagnoses.has(service.diagnosis)) missing.push(`${service.code}: Diagnosis ${service.diagnosis}`);
            if (service.procedure && !procedures.has(service.procedure)) {
                missing.push(`${service.code}: ICD-9 ${service.procedure}`);
            }
            const annualCount = service.code === 'FP003_3'
                ? Number(facts.emergencyPillYearQuantity || 0)
                : service.code === 'FP003_4'
                    ? Number(facts.injectionYearCount || 0)
                    : 0;
            if (service.annualLimit && annualCount > service.annualLimit.maximum) {
                missing.push(`${service.code}: เกิน ${service.annualLimit.maximum} ${service.annualLimit.unit} (พบ ${annualCount})`);
            }
        }
    }

    return {
        services,
        missing: [...new Set(missing)],
        matched: (services.length > 0 || otherFpCodes.length > 0) && missing.length === 0,
        hasEvidence: services.length > 0 || otherFpCodes.length > 0 || hasZ30Diagnosis,
    };
};
