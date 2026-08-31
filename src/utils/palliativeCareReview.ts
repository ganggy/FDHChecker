export type PalliativeReviewFacts = {
    z515Code?: unknown;
    z718Code?: unknown;
    isHomeVisit?: unknown;
    hasPalliativeAdp?: unknown;
    hasEligibleDiseaseDiagnosis?: unknown;
    drugCount?: unknown;
};

export type PalliativeReviewResult = {
    hasPalliativeDiagnosis: boolean;
    qualifiesForService: boolean;
    shouldReview: boolean;
    canRemoveDiagnosis: boolean;
    canMarkAsHomeVisit: boolean;
    visitKind: 'home-palliative' | 'possible-medication-pickup' | 'hospital-service';
    visitKindLabel: string;
    reasons: string[];
};

const toBoolean = (value: unknown) => (
    value === true
    || value === 1
    || value === '1'
    || String(value ?? '').trim().toUpperCase() === 'Y'
);

const hasValue = (value: unknown) => String(value ?? '').trim() !== '';

export const reviewPalliativeCareVisit = (facts: PalliativeReviewFacts): PalliativeReviewResult => {
    const hasZ515 = hasValue(facts.z515Code);
    const hasZ718 = hasValue(facts.z718Code);
    const isHomeVisit = toBoolean(facts.isHomeVisit);
    const hasPalliativeAdp = toBoolean(facts.hasPalliativeAdp);
    const hasEligibleDiseaseDiagnosis = toBoolean(facts.hasEligibleDiseaseDiagnosis);
    const hasDrugs = Number(facts.drugCount ?? 0) > 0;
    const hasPalliativeDiagnosis = hasZ515 || hasZ718;
    const reasons: string[] = [];

    if (!isHomeVisit) reasons.push('ไม่ใช่ visit เยี่ยมบ้าน');
    if (!hasPalliativeAdp) reasons.push('ไม่พบ ADP 30001/Cons01/Eva001 ตามบริการจริง');
    if (!hasEligibleDiseaseDiagnosis) reasons.push('ไม่พบโรคหลักในบัญชี Palliative ที่เข้าเกณฑ์');
    if (!hasZ515) reasons.push('ไม่มี Z51.5 (Z71.8 ใช้เดี่ยวไม่ได้)');

    const qualifiesForService = hasPalliativeDiagnosis
        && hasZ515
        && isHomeVisit
        && hasPalliativeAdp
        && hasEligibleDiseaseDiagnosis;
    const canMarkAsHomeVisit = hasPalliativeDiagnosis
        && hasZ515
        && !isHomeVisit
        && hasPalliativeAdp
        && hasEligibleDiseaseDiagnosis;
    const visitKind = isHomeVisit
        ? 'home-palliative'
        : hasDrugs
            ? 'possible-medication-pickup'
            : 'hospital-service';

    return {
        hasPalliativeDiagnosis,
        qualifiesForService,
        shouldReview: (hasPalliativeDiagnosis || hasPalliativeAdp) && !qualifiesForService,
        canRemoveDiagnosis: hasPalliativeDiagnosis && !isHomeVisit,
        canMarkAsHomeVisit,
        visitKind,
        visitKindLabel: visitKind === 'home-palliative'
            ? 'เยี่ยมบ้าน'
            : visitKind === 'possible-medication-pickup'
                ? 'อาจมารับยาแทน/รับยาที่ รพ.'
                : 'รับบริการปกติที่โรงพยาบาล',
        reasons,
    };
};
