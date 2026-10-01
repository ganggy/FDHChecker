export type PalliativeReviewFacts = {
    z515Code?: unknown;
    z718Code?: unknown;
    isHomeVisit?: unknown;
    hasPalliativeAdp?: unknown;
    hasEligibleDiseaseDiagnosis?: unknown;
    drugCount?: unknown;
    hasMorphine?: unknown;
    morphineNames?: unknown;
    hasPriorPalliative?: unknown;
    priorPalliativeDate?: unknown;
};

export type PalliativeReviewResult = {
    hasPalliativeDiagnosis: boolean;
    hasMorphine: boolean;
    morphineNames: string;
    hasPriorPalliative: boolean;
    priorPalliativeDate: string;
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
    const hasPriorPalliative = toBoolean(facts.hasPriorPalliative);
    const priorPalliativeDate = String(facts.priorPalliativeDate ?? '').trim();
    const hasPalliativeDiagnosis = hasZ515 || hasZ718;
    const reasons: string[] = [];

    // กลุ่มที่ 1: เคสจ่ายยากลุ่มมอร์ฟีน (Palliative Morphine Dispensing)
    // เงื่อนไข: ต้องมีรหัสวินิจฉัย Z51.5 และ Z71.8 ร่วมกับยากลุ่มมอร์ฟีน
    // ถือว่าเป็นการจ่ายยาและวางแผนการดูแลให้ผู้ป่วยแบบประคับประคองสมบูรณ์ โดยไม่ต้องมี Cons01 หรือ Eva01
    if (hasMorphine) {
        if (hasZ515 && hasZ718) {
            return {
                hasPalliativeDiagnosis: true,
                hasMorphine: true,
                morphineNames,
                hasPriorPalliative,
                priorPalliativeDate,
                qualifiesForService: true,
                isMorphineDispensingOnly: true,
                shouldReview: false,
                canRemoveDiagnosis: false, // ห้ามลบ Diagnosis ของผู้ป่วยที่ได้รับยากลุ่มมอร์ฟีน
                canMarkAsHomeVisit: !isHomeVisit,
                visitKind: 'palliative-morphine',
                visitKindLabel: 'จ่ายยากลุ่มมอร์ฟีน (สมบูรณ์ - มี Z51.5 & Z71.8)',
                reasons: [],
            };
        }

        // กรณีเป็นผู้ป่วย Palliative (มีประวัติเดิม หรือมี Z51.5/Z71.8 อยู่แล้วแต่ยังไม่ครบทั้งสองตัว)
        if (hasPriorPalliative || hasValue(priorPalliativeDate) || hasZ515 || hasZ718) {
            const dateMsg = priorPalliativeDate ? ` (พบประวัติเดิมเมื่อ ${priorPalliativeDate})` : '';
            const missingCodes: string[] = [];
            if (!hasZ515) missingCodes.push('Z51.5');
            if (!hasZ718) missingCodes.push('Z71.8');

            const missingDesc = missingCodes.join(' และ ');
            reasons.push(`ผู้ป่วย Palliative ได้รับยากลุ่มมอร์ฟีน แต่ยังขาดรหัสวินิจฉัย ${missingDesc}${dateMsg}`);
            return {
                hasPalliativeDiagnosis: hasZ515 || hasZ718,
                hasMorphine: true,
                morphineNames,
                hasPriorPalliative: true,
                priorPalliativeDate,
                qualifiesForService: false,
                isMorphineDispensingOnly: true,
                shouldReview: true,
                canRemoveDiagnosis: false,
                canMarkAsHomeVisit: !isHomeVisit,
                visitKind: 'palliative-morphine',
                visitKindLabel: `ผู้ป่วย Palliative ได้รับมอร์ฟีน (ขาด ${missingCodes.join(' & ')})`,
                reasons,
            };
        }

        // จ่ายยามอร์ฟีนเฉยๆ (คนไข้ทั่วไป ไม่ใช่ Palliative Care)
        return {
            hasPalliativeDiagnosis: false,
            hasMorphine: true,
            morphineNames,
            hasPriorPalliative: false,
            priorPalliativeDate: '',
            qualifiesForService: false,
            isMorphineDispensingOnly: false,
            shouldReview: false,
            canRemoveDiagnosis: false,
            canMarkAsHomeVisit: false,
            visitKind: 'hospital-service',
            visitKindLabel: 'จ่ายยากลุ่มมอร์ฟีนทั่วไป (ไม่ใช่ Palliative Care)',
            reasons: ['จ่ายยากลุ่มมอร์ฟีนทั่วไป ไม่ได้ระบุเป็นการดูแลแบบประคับประคอง (ไม่ต้องลง Z51.5/Z71.8)'],
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
        hasPriorPalliative,
        priorPalliativeDate,
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
