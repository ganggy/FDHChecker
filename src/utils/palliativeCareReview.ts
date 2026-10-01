export type PalliativeReviewFacts = {
    z515Code?: unknown;
    z718Code?: unknown;
    isHomeVisit?: unknown;
    hasPalliativeAdp?: unknown;
    hasEligibleDiseaseDiagnosis?: unknown;
    drugCount?: unknown;
    hasMorphine?: unknown;
    morphineNames?: unknown;
};

export type PalliativeReviewResult = {
    hasPalliativeDiagnosis: boolean;
    hasMorphine: boolean;
    morphineNames: string;
    qualifiesForService: boolean;
    isMorphineDispensingOnly: boolean;
    shouldReview: boolean;
    canRemoveDiagnosis: boolean;
    canMarkAsHomeVisit: boolean;
    visitKind: 'home-palliative' | 'palliative-morphine' | 'possible-medication-pickup' | 'hospital-service';
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
    const hasMorphine = toBoolean(facts.hasMorphine) || hasValue(facts.morphineNames);
    const morphineNames = String(facts.morphineNames ?? '').trim();
    const hasPalliativeDiagnosis = hasZ515 || hasZ718;
    const reasons: string[] = [];

    // กลุ่มที่ 1: เคสจ่ายยากลุ่มมอร์ฟีน (Palliative Morphine Dispensing)
    // สำหรับเคสมอร์ฟีน เงื่อนไขคือมีเพียงรหัสโรคหลัก/ร่วม Z51.5 หรือ Z71.8 ร่วมกับยากลุ่มมอร์ฟีน
    // ก็ถือว่าเป็นการจ่ายยาให้ผู้ป่วยสมบูรณ์แล้ว โดยไม่ต้องมี Cons01 หรือ Eva01
    if (hasMorphine) {
        if (!hasPalliativeDiagnosis) {
            reasons.push('จ่ายยากลุ่มมอร์ฟีน แต่ยังขาดรหัสวินิจฉัย Z51.5 หรือ Z71.8');
        }

        const qualifiesForService = hasPalliativeDiagnosis;
        return {
            hasPalliativeDiagnosis,
            hasMorphine: true,
            morphineNames,
            qualifiesForService,
            isMorphineDispensingOnly: true,
            shouldReview: !qualifiesForService,
            canRemoveDiagnosis: false, // ห้ามลบ Diagnosis ของผู้ป่วยที่ได้รับยากลุ่มมอร์ฟีน
            canMarkAsHomeVisit: !isHomeVisit,
            visitKind: 'palliative-morphine',
            visitKindLabel: qualifiesForService
                ? 'จ่ายยากลุ่มมอร์ฟีน (สมบูรณ์ - ไม่ต้องใช้ Cons01/Eva01)'
                : 'จ่ายยากลุ่มมอร์ฟีน (ขาด Z51.5/Z71.8)',
            reasons,
        };
    }

    // กลุ่มที่ 2: บริการการดูแลประคับประคองทั่วไป / เยี่ยมบ้าน (Palliative Care Service)
    if (!isHomeVisit) reasons.push('ไม่ใช่ visit เยี่ยมบ้าน');
    if (!hasPalliativeAdp) reasons.push('ไม่พบ ADP 30001/Cons01/Eva001 ตามบริการจริง');
    if (!hasEligibleDiseaseDiagnosis) reasons.push('ไม่พบโรคหลักในบัญชี Palliative ที่เข้าเกณฑ์');
    if (!hasZ515) reasons.push('ไม่มี Z51.5 (Z71.8 ใช้เดี่ยวไม่ได้)');

    const qualifiesForService = hasPalliativeDiagnosis
        && hasZ515
        && isHomeVisit
        && hasPalliativeAdp
        && hasEligibleDiseaseDiagnosis;
    const canMarkAsHomeVisit = !isHomeVisit
        && (hasPalliativeDiagnosis || hasPalliativeAdp);
    const visitKind = isHomeVisit
        ? 'home-palliative'
        : hasDrugs
            ? 'possible-medication-pickup'
            : 'hospital-service';

    return {
        hasPalliativeDiagnosis,
        hasMorphine: false,
        morphineNames: '',
        qualifiesForService,
        isMorphineDispensingOnly: false,
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
