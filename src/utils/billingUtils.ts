import businessRules from '../config/business_rules.json';
import { getAnemiaRuleBand } from '../config/fundRuleCatalog';

const rules = businessRules as any;
const insuranceMapping = rules.insurance_mapping || {};
const diagnosisPatterns = rules.diagnosis_patterns || {};

const ofcCodes = new Set(
    [...(insuranceMapping.OFC_LGO?.hipdata_codes || []), 'OFC', 'LGO', 'A1']
        .map((value: string) => value.toUpperCase())
);
const sssCodes = new Set(['SSS']);
const ucsCodes = new Set(
    [...(insuranceMapping.UCS_SSS?.hipdata_codes || []), ...(insuranceMapping.UC_EPO?.hipdata_codes || []), 'UCS', 'UC', 'WEL', 'UNK']
        .filter((value: string) => value.toUpperCase() !== 'SSS')
        .map((value: string) => value.toUpperCase())
);

const ofcKeywords = [...(insuranceMapping.OFC_LGO?.keywords || []), 'CSCD']
    .map((value: string) => value.toLowerCase());
const sssKeywords = ['ประกันสังคม', 'sss'];
const ucsKeywords = [
    ...(insuranceMapping.UCS_SSS?.keywords || []),
    ...(insuranceMapping.UC_EPO?.keywords || []),
]
    .filter((value: string) => !sssKeywords.includes(value.toLowerCase()))
    .map((value: string) => value.toLowerCase());

const hasAnyKeyword = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword));
const dialysisPattern = diagnosisPatterns.dialysis_regex || diagnosisPatterns.dialysis || '^(N185|Z49)';

type FundNoteKind = 'matched' | 'warning' | 'ep';
type FundNoteGroup = 'palliative' | 'drug' | 'other';

interface FundNote {
    label: string;
    kind: FundNoteKind;
    group: FundNoteGroup;
}

const toBool = (value: unknown) => value === true || value === 1 || value === '1' || value === 'Y' || value === 'y';
const cleanDiag = (value: unknown) => String(value ?? '').replace(/\./g, '').trim().toUpperCase();
const cleanCode = (value: unknown) => String(value ?? '').replace(/\./g, '').trim().toUpperCase();
const hasValue = (value: unknown) => String(value ?? '').trim() !== '';
const collectCodeValues = (value: unknown) =>
    String(value ?? '')
        .split(',')
        .map((part) => cleanCode(part))
        .filter(Boolean);
const hasAnyCodeValue = (value: unknown, codesToCheck: string[]) => {
    const available = new Set(collectCodeValues(value));
    return codesToCheck.map(cleanCode).some((code) => available.has(code));
};
const hasDiagCode = (item: any, codes: string[]) => {
    const targets = new Set(codes.map((code) => cleanDiag(code)));
    return [
        item?.pdx,
        item?.main_diag,
        item?.diag_code,
        item?.dx0,
        item?.dx1,
        item?.dx2,
        item?.dx3,
        item?.dx4,
        item?.dx5,
    ].some((value) => targets.has(cleanDiag(value)));
};
const collectDiagValues = (item: any) => {
    const baseValues = [
        item?.pdx,
        item?.main_diag,
        item?.diag_code,
        item?.dx0,
        item?.dx1,
        item?.dx2,
        item?.dx3,
        item?.dx4,
        item?.dx5,
        item?.z515_code,
        item?.z718_code,
    ]
        .map(cleanDiag)
        .filter(Boolean);

    [item?.fp_diags, item?.diag_list, item?.diagnosis_list, item?.anc_diags, item?.pp_diags]
        .filter(Boolean)
        .join(',')
        .split(/[^A-Z0-9.]+/)
        .map(cleanDiag)
        .filter(Boolean)
        .forEach((code) => baseValues.push(code));

    return Array.from(new Set(baseValues));
};
const hasDiagRegex = (item: any, regex: RegExp) => collectDiagValues(item).some((code) => regex.test(code));
const hasText = (value: unknown, regex: RegExp) => regex.test(String(value ?? ''));
const hasDiagPrefix = (item: any, prefix: string) => {
    const normalizedPrefix = cleanDiag(prefix);
    return collectDiagValues(item).some((code) => code.startsWith(normalizedPrefix));
};
const getAnemiaAgeBandLabel = (item: any) => {
    const band = getAnemiaRuleBand(item);
    if (band) return band.ageLabel;
    const ageMonths = Number(item?.age_month ?? item?.ageMonths ?? item?.age_months ?? -1);
    const ageYears = Number(item?.age_y ?? item?.age ?? -1);
    if (ageYears >= 13 && ageYears <= 24) return '13-24 ปี';
    if (ageMonths >= 6 && ageMonths <= 12) return '6-12 เดือน';
    if (ageYears >= 3 && ageYears <= 6) return '3-6 ปี';
    if (toBool(item?.anemia_age_eligible)) return '13-24 ปี / 6-12 เดือน / 3-6 ปี';
    return '';
};
const getAnemiaLabRequirement = (item: any) => {
    const band = getAnemiaRuleBand(item);
    if (band) return { label: band.labLabel, kind: band.id === 'cbc_13_24y' ? 'cbc' as const : 'hbhct' as const };
    const ageMonths = Number(item?.age_month ?? item?.ageMonths ?? item?.age_months ?? -1);
    const ageYears = Number(item?.age_y ?? item?.age ?? -1);
    if (ageYears >= 13 && ageYears <= 24) return { label: 'Lab CBC', kind: 'cbc' as const };
    if ((ageMonths >= 6 && ageMonths <= 12) || (ageYears >= 3 && ageYears <= 6)) return { label: 'Lab Hb/Hct', kind: 'hbhct' as const };
    return { label: 'Lab CBC / Hb/Hct', kind: 'any' as const };
};
const getAncLab1Requirements = (item: any, hasAncDiag: boolean) => ([
    { met: String(item?.sex ?? '').trim() === '2', label: ' เพศหญิง' },
    { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
    { met: toBool(item?.anc_lab1_cbc), label: ' CBC' },
    { met: toBool(item?.anc_lab1_dcip), label: ' DCIP' },
    { met: toBool(item?.anc_lab1_abo), label: ' ABO group' },
    { met: toBool(item?.anc_lab1_rh), label: ' Rh grouping' },
    { met: toBool(item?.anc_lab1_hbsag), label: ' HBsAg' },
    { met: toBool(item?.anc_lab1_syphilis), label: ' Treponema Pallidum Ab' },
    { met: toBool(item?.anc_lab1_hiv), label: ' HIV-Ab Screening' },
]);

const getAncLab2Requirements = (item: any, hasAncDiag: boolean) => ([
    { met: String(item?.sex ?? '').trim() === '2', label: ' เพศหญิง' },
    { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
    { met: toBool(item?.anc_lab2_hiv), label: ' Anti-HIV ANC 2' },
    { met: toBool(item?.anc_lab2_syphilis), label: ' Treponema Pallidum Ab ANC 2' },
    { met: toBool(item?.anc_lab2_cbc), label: ' CBC' },
]);

const addWarningFundNote = (notes: FundNote[], title: string, missingParts: string[], group: FundNoteGroup = 'other') => {
    const filteredMissing = missingParts.filter(Boolean);
    if (filteredMissing.length === 0) return;
    notes.push({
        label: `⚠️ ${title}: ขาด${filteredMissing.join(' + ')}`,
        kind: 'warning',
        group,
    });
};

const getNearFundMissingParts = (
    adpMet: boolean,
    adpLabel: string,
    requirements: Array<{ met: boolean; label: string }>,
    _shouldShowMissing?: boolean
) => {
    const missingRequirementLabels = requirements.filter((requirement) => !requirement.met).map((requirement) => requirement.label);
    const allRequirementsMet = missingRequirementLabels.length === 0;

    if (adpMet) {
        return allRequirementsMet ? [] : missingRequirementLabels;
    }

    // Only show "Missing ADP" warning IF they meet clinical criteria (Evidence) 
    // This matches SpecificFundPage logic
    if (allRequirementsMet || _shouldShowMissing) {
        return allRequirementsMet ? [adpLabel] : [...missingRequirementLabels, adpLabel];
    }

    return [];
};

export const evaluateBillingLogic = (item: any) => {
    const hipdataCode = String(item?.hipdata_code ?? '').trim();
    const hipdataCodeUpper = hipdataCode.toUpperCase();
    const hipdataText = `${hipdataCode} ${item?.fund || ''} ${item?.hipdata_desc || ''}`.trim();
    const hipdataTextLower = hipdataText.toLowerCase();

    const isOFC_LGO = ofcCodes.has(hipdataCodeUpper) || hasAnyKeyword(hipdataTextLower, ofcKeywords);
    const isSSS = !isOFC_LGO && (sssCodes.has(hipdataCodeUpper) || hasAnyKeyword(hipdataTextLower, sssKeywords));
    const isUCS = !isOFC_LGO && !isSSS && (ucsCodes.has(hipdataCodeUpper) || hasAnyKeyword(hipdataTextLower, ucsKeywords));

    let opacity = 1;
    let bgStyle = 'transparent';
    let billingStatusLabel = '';
    let isUUC1 = false;
    let hasNoDiagnosis = false;
    const fundNotes: FundNote[] = [];

    if (isSSS) {
        opacity = 0.5;
        bgStyle = 'rgba(245, 158, 11, 0.05)';
        billingStatusLabel = item.hipdata_code === 'CSCD' ? 'UUC2 ไม่ประสงค์เบิก' : 'เบิกไม่ได้ (UUC2/SSS)';
    } else if (!item.hipdata_code || (!isOFC_LGO && !isUCS)) {
        opacity = 0.5;
        billingStatusLabel = `เบิกไม่ได้ (${item.hipdata_code || 'ชำระเงิน'})`;
    } else if (isOFC_LGO) {
        bgStyle = 'rgba(16, 185, 129, 0.08)';
        billingStatusLabel = 'เบิกได้ทั้ง Visit (OFC/LGO)';
        isUUC1 = true;
    } else if (isUCS) {
        const age = Number(item?.age_y ?? item?.age ?? 0);
        const hasDiag = !!(item?.pdx || item?.main_diag);

        const palliativeDiag = toBool(item?.has_pal_diag) || hasDiagCode(item, ['Z515', 'Z718']);
        const palliativeAdp = toBool(item?.has_pal_adp) || toBool(item?.has_30001) || toBool(item?.has_cons01) || toBool(item?.has_eva001);
        const palliativeMatch = palliativeDiag && palliativeAdp;

        if (toBool(item?.has_telmed) || String(item?.ovstist_export_code ?? '').trim() === String(rules.project_codes?.ovstist_tele ?? '5').trim()) {
            fundNotes.push({ label: '📱 Telemedicine', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_drugp)) {
            fundNotes.push({ label: '📦 EMS ส่งยา', kind: 'matched', group: 'drug' });
        }
        if (toBool(item?.has_herb) || Number(item?.herb_total_price || 0) > 0) {
            fundNotes.push({ label: '🌿 สมุนไพร', kind: 'matched', group: 'drug' });
        }
        if (toBool(item?.has_instrument)) {
            fundNotes.push({ label: '🦾 อวัยวะเทียม', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_clopidogrel)) {
            fundNotes.push({ label: '💊 Clopidogrel', kind: 'matched', group: 'drug' });
        }

        const hasKneeDiag = toBool(item?.has_knee_diag) || hasDiagCode(item, ['M17', 'U5753']);
        const hasKneeService = toBool(item?.has_knee_oper)
            || toBool(item?.has_knee_poultice)
            || hasText(item?.proc_name, /KNEE|เข่า/)
            || hasText(item?.service_name, /KNEE|เข่า/);
        if (hasKneeService || (age >= 40 && hasKneeDiag)) {
            if (age >= 40 && hasKneeDiag && toBool(item?.has_knee_oper)) {
                fundNotes.push({ label: '🦵 พอกเข่า (43 แฟ้ม)', kind: 'matched', group: 'other' });
            } else {
                addWarningFundNote(fundNotes, 'พอกเข่า', [
                    age >= 40 ? '' : ' อายุ 40 ปีขึ้นไป',
                    hasKneeDiag ? '' : ' Diagnosis M17/U57.53',
                    toBool(item?.has_knee_oper) ? '' : ' หัตถการ/กิจกรรม 43 แฟ้มยังไม่ครบ',
                ].filter(Boolean), 'other');
            }
        }

        const hasFpgAge = toBool(item?.fpg_age_eligible);
        const hasFpgAdp = toBool(item?.has_fpg_adp) || hasAnyCodeValue(item?.adp_names, ['12003']) || hasAnyCodeValue(item?.anc_adp_codes, ['12003']);
        const hasFpgLab = toBool(item?.has_fpg_lab);
        const hasFpgDiag = toBool(item?.has_fpg_diag) || hasDiagCode(item, ['Z131', 'Z133', 'Z136']);
        const fpgNearMissing = getNearFundMissingParts(hasFpgAdp, ' ADP 12003', [
            { met: hasFpgAge, label: ' อายุ 35-59 ปี' },
            { met: hasFpgLab, label: ' Lab FPG' },
            { met: hasFpgDiag, label: ' DX Z131/Z133/Z136' },
        ], hasFpgAge && (hasFpgLab || hasFpgDiag));
        if (hasFpgAge && hasFpgAdp && hasFpgLab && hasFpgDiag) {
            fundNotes.push({ label: '🩸 คัดกรองเบาหวาน', kind: 'matched', group: 'other' });
        } else {
            addWarningFundNote(fundNotes, 'คัดกรองเบาหวาน', fpgNearMissing);
        }

        const hasCholAge = toBool(item?.chol_age_eligible);
        const hasCholAdp = toBool(item?.has_chol_adp) || hasAnyCodeValue(item?.adp_names, ['12004']) || hasAnyCodeValue(item?.anc_adp_codes, ['12004']);
        const hasCholLab = toBool(item?.has_chol_lab);
        const hasCholDiag = toBool(item?.has_chol_diag) || hasDiagCode(item, ['Z136']);
        const cholNearMissing = getNearFundMissingParts(hasCholAdp, ' ADP 12004', [
            { met: hasCholAge, label: ' อายุ 45-59 ปี' },
            { met: hasCholLab, label: ' Lab Cholesterol/HDL' },
            { met: hasCholDiag, label: ' DX Z136' },
        ], hasCholAge && (hasCholLab || hasCholDiag));
        if (hasCholAge && hasCholAdp && hasCholLab && hasCholDiag) {
            fundNotes.push({ label: '🧪 คัดกรองไขมัน', kind: 'matched', group: 'other' });
        } else {
            addWarningFundNote(fundNotes, 'คัดกรองไขมัน', cholNearMissing);
        }

        const anemiaAgeYears = Number(item?.age_y ?? item?.age ?? -1);
        const anemiaAgeMonths = Number(item?.age_month ?? item?.ageMonths ?? item?.age_months ?? -1);
        const hasAnemiaAge = toBool(item?.anemia_age_eligible)
            || (anemiaAgeYears >= 13 && anemiaAgeYears <= 24)
            || (anemiaAgeMonths >= 6 && anemiaAgeMonths <= 12)
            || (anemiaAgeYears >= 3 && anemiaAgeYears <= 6);
        const anemiaAgeBand = getAnemiaAgeBandLabel(item);
        const anemiaLabRequirement = getAnemiaLabRequirement(item);
        const hasAnemiaAdp = toBool(item?.has_anemia_adp) || hasAnyCodeValue(item?.adp_names, ['13001']) || hasAnyCodeValue(item?.anc_adp_codes, ['13001']);
        const hasAnemiaCbc = toBool(item?.has_anemia_cbc);
        const hasAnemiaHbHct = toBool(item?.has_anemia_hbhct);
        const hasAnemiaLab = anemiaLabRequirement.kind === 'cbc'
            ? hasAnemiaCbc
            : anemiaLabRequirement.kind === 'hbhct'
                ? hasAnemiaHbHct
                : toBool(item?.has_anemia_lab);
        const hasAnemiaDiag = toBool(item?.has_anemia_diag) || hasDiagCode(item, ['Z130']);
        const anemiaNearMissing = getNearFundMissingParts(hasAnemiaAdp, ' ADP 13001', [
            { met: hasAnemiaAge, label: ` อายุ ${anemiaAgeBand || '13-24 ปี / 6-12 เดือน / 3-6 ปี'}` },
            { met: hasAnemiaLab, label: ` ${anemiaLabRequirement.label}` },
            { met: hasAnemiaDiag, label: ' DX Z130' },
        ], hasAnemiaAge && (hasAnemiaLab || hasAnemiaDiag));
        if (hasAnemiaAge && hasAnemiaAdp && hasAnemiaLab && hasAnemiaDiag) {
            const anemiaSummaryLabel = `🩸 ${getAnemiaRuleBand(item)?.fullCondition || 'คัดกรองโลหิตจางจากการขาดธาตุเหล็ก Diagnosis Z130/Z138 ADP 13001'}`;
            fundNotes.push({
                label: anemiaSummaryLabel,
                kind: 'matched',
                group: 'other'
            });
        } else {
            addWarningFundNote(fundNotes, 'คัดกรองโลหิตจางจากการขาดธาตุเหล็ก', anemiaNearMissing);
        }

        const hasIronAge = toBool(item?.iron_age_eligible) || (String(item?.sex ?? '').trim() === '2' && age >= 13 && age <= 45);
        const hasIronAdp = toBool(item?.has_iron_adp) || hasAnyCodeValue(item?.adp_names, ['14001']) || hasAnyCodeValue(item?.anc_adp_codes, ['14001']);
        const hasIronDiag = toBool(item?.has_iron_diag) || hasDiagCode(item, ['Z130']);
        const hasIronMed = toBool(item?.has_iron_med) || toBool(item?.has_iron);
        const ironNearMissing = getNearFundMissingParts(hasIronAdp, ' ADP 14001', [
            { met: hasIronAge, label: ' หญิงอายุ 13-45 ปี' },
            { met: hasIronDiag, label: ' DX Z130' },
            { met: hasIronMed, label: ' ยาเสริมธาตุเหล็ก' },
        ], hasIronAge && (hasIronMed || hasIronDiag));
        if (hasIronAge && hasIronAdp && hasIronDiag && hasIronMed) {
            fundNotes.push({ label: '💊 เสริมธาตุเหล็ก', kind: 'matched', group: 'drug' });
        } else {
            addWarningFundNote(fundNotes, 'เสริมธาตุเหล็ก', ironNearMissing, 'drug');
        }

        const ferrokidAgeYears = Number(item?.age_y ?? item?.age ?? -1);
        const ferrokidAgeMonths = Number(item?.age_month ?? -1);
        const hasFerrokidAge = toBool(item?.ferrokid_age_eligible)
            || (ferrokidAgeMonths >= 2 && ferrokidAgeMonths <= 144)
            || (ferrokidAgeYears >= 0 && ferrokidAgeYears <= 12);
        const hasFerrokidDiag = toBool(item?.has_ferrokid_diag) || hasDiagCode(item, ['Z130']);
        const hasFerrokidMed = toBool(item?.has_ferrokid_med) || toBool(item?.has_ferrokid);
        const ferrokidNearMissing = [
            !hasFerrokidDiag ? ' DX Z130' : '',
            !hasFerrokidMed ? ' ยา Ferrokid' : '',
        ].filter(Boolean);
        if (hasFerrokidAge && hasFerrokidDiag && hasFerrokidMed) {
            fundNotes.push({ label: '🧒 เสริมธาตุเหล็กเด็ก (Ferrokid)', kind: 'matched', group: 'drug' });
        } else if (hasFerrokidAge && (hasFerrokidDiag || hasFerrokidMed) && ferrokidNearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'เสริมธาตุเหล็กเด็ก (Ferrokid)', ferrokidNearMissing, 'drug');
        }

        const hasPregLab = toBool(item?.has_preg_lab) || hasValue(item?.preg_lab_name) || hasValue(item?.preg_result);
        const hasPregDiag = toBool(item?.has_preg_diag) || hasDiagCode(item, ['Z320', 'Z321']);
        const hasPregItem = toBool(item?.has_preg_item) || toBool(item?.has_upt) || hasValue(item?.preg_item_name);
        const uptNearMissing = getNearFundMissingParts(hasPregItem, ' ADP 30014', [
            { met: hasPregDiag, label: ' DX Z320/Z321' },
            { met: hasPregLab, label: ' 31101/Lab UPT' },
        ], hasPregDiag && hasPregLab);
        if (hasPregLab && hasPregDiag && hasPregItem) {
            fundNotes.push({ label: '🧪 ตรวจครรภ์ (UPT)', kind: 'matched', group: 'other' });
        } else {
            addWarningFundNote(fundNotes, 'ตรวจครรภ์ (UPT)', uptNearMissing);
        }

        const hasAncDiag = toBool(item?.has_anc_diag) || hasDiagRegex(item, /^Z3[45]/) || hasValue(item?.anc_diags);
        const isFemale = String(item?.sex ?? '').trim() === '2';
        const hasAncVisitAdp = toBool(item?.has_anc_visit) || hasAnyCodeValue(item?.anc_adp_codes, ['30011']);
        const ancVisitEvidence = hasAncVisitAdp || hasAncDiag;
        const ancVisitNearMissing = getNearFundMissingParts(hasAncVisitAdp, ' ADP 30011', [
            { met: isFemale, label: ' เพศหญิง' },
            { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
        ], isFemale && hasAncDiag);
        if (ancVisitEvidence && !isFemale) {
            fundNotes.push({ label: '⚠️ ANC Visit: เพศชาย ไม่สามารถรับบริการ', kind: 'warning', group: 'other' });
        } else if (hasAncVisitAdp && isFemale && hasAncDiag) {
            fundNotes.push({ label: '🤰 ANC Visit', kind: 'matched', group: 'other' });
        } else if (ancVisitNearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'ANC Visit', ancVisitNearMissing);
        }
        const hasAncUsAdp = toBool(item?.has_anc_us) || hasAnyCodeValue(item?.anc_adp_codes, ['30010']);
        const hasAncUsProc = toBool(item?.has_anc_us_proc);
        const hasAncUsComplete = hasAncUsAdp && hasAncUsProc;
        const ancUsEvidence = hasAncUsAdp || hasAncUsProc || hasAncDiag;
        const ancUsNearMissing = getNearFundMissingParts(hasAncUsAdp, ' ADP 30010', [
            { met: isFemale, label: ' เพศหญิง' },
            { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
            { met: hasAncUsProc, label: ' Ultrasound ANC' },
        ], isFemale && hasAncDiag && hasAncUsProc);
        if (ancUsEvidence && !isFemale) {
            fundNotes.push({ label: '⚠️ ANC Ultrasound: เพศชาย ไม่สามารถรับบริการ', kind: 'warning', group: 'other' });
        } else if (hasAncUsComplete && isFemale && hasAncDiag) {
            fundNotes.push({ label: '📽️ ANC Ultrasound', kind: 'matched', group: 'other' });
        } else if (ancUsNearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'ANC Ultrasound', ancUsNearMissing);
        }
        const ancLab1Requirements = getAncLab1Requirements(item, hasAncDiag);
        const ancLab1Adp = toBool(item?.has_anc_lab1) || hasAnyCodeValue(item?.anc_adp_codes, ['30012']);
        const ancLab1NearMissing = getNearFundMissingParts(ancLab1Adp, ' ADP 30012', ancLab1Requirements, toBool(item?.anc_lab1_complete));
        if ((ancLab1Adp || toBool(item?.anc_lab1_complete)) && !isFemale) {
            fundNotes.push({ label: '⚠️ ANC Lab 1: เพศชาย ไม่สามารถรับบริการ', kind: 'warning', group: 'other' });
        } else if (ancLab1Adp && ancLab1Requirements.every((requirement) => requirement.met)) {
            fundNotes.push({ label: '🧬 ANC Lab 1', kind: 'matched', group: 'other' });
        } else if (ancLab1NearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'ANC Lab 1', ancLab1NearMissing);
        }
        const ancLab2Requirements = getAncLab2Requirements(item, hasAncDiag);
        const ancLab2Adp = toBool(item?.has_anc_lab2) || hasAnyCodeValue(item?.anc_adp_codes, ['30013']);
        const ancLab2NearMissing = getNearFundMissingParts(ancLab2Adp, ' ADP 30013', ancLab2Requirements, toBool(item?.anc_lab2_hiv) && toBool(item?.anc_lab2_syphilis));
        if ((ancLab2Adp || (toBool(item?.anc_lab2_hiv) && toBool(item?.anc_lab2_syphilis))) && !isFemale) {
            fundNotes.push({ label: '⚠️ ANC Lab 2: เพศชาย ไม่สามารถรับบริการ', kind: 'warning', group: 'other' });
        } else if (ancLab2Adp && ancLab2Requirements.every((requirement) => requirement.met)) {
            fundNotes.push({ label: '🧪 ANC Lab 2', kind: 'matched', group: 'other' });
        } else if (ancLab2NearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'ANC Lab 2', ancLab2NearMissing);
        }
        const hasDentalDiagK = hasDiagPrefix(item, 'K');
        const hasAncDentalExamAdp = toBool(item?.has_anc_dental_exam) || hasAnyCodeValue(item?.anc_adp_codes, ['30008']);
        const ancDentalExamNearMissing = getNearFundMissingParts(hasAncDentalExamAdp, ' ADP 30008', [
            { met: isFemale, label: ' เพศหญิง' },
            { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
            { met: hasDentalDiagK, label: ' Diagnosis K*' },
        ], isFemale && hasAncDiag && hasDentalDiagK);
        if (hasAncDentalExamAdp && isFemale && hasAncDiag && hasDentalDiagK) {
            fundNotes.push({ label: '🦷 ANC ตรวจฟัน', kind: 'matched', group: 'other' });
        } else if (isFemale && (hasAncDentalExamAdp || hasAncDiag || hasDentalDiagK) && ancDentalExamNearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'ANC ตรวจฟัน', ancDentalExamNearMissing);
        }
        const hasAncDentalCleanAdp = toBool(item?.has_anc_dental_clean) || hasAnyCodeValue(item?.anc_adp_codes, ['30009']);
        const ancDentalCleanNearMissing = getNearFundMissingParts(hasAncDentalCleanAdp, ' ADP 30009', [
            { met: isFemale, label: ' เพศหญิง' },
            { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
            { met: hasDentalDiagK, label: ' Diagnosis K*' },
        ], isFemale && hasAncDiag && hasDentalDiagK);
        if (hasAncDentalCleanAdp && isFemale && hasAncDiag && hasDentalDiagK) {
            fundNotes.push({ label: '🪥 ANC ขัดทำความสะอาดฟัน', kind: 'matched', group: 'other' });
        } else if (isFemale && (hasAncDentalCleanAdp || hasAncDiag || hasDentalDiagK) && ancDentalCleanNearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'ANC ขัดทำความสะอาดฟัน', ancDentalCleanNearMissing);
        }

        const hasPpDiag = toBool(item?.has_pp_diag) || hasDiagCode(item, ['Z390', 'Z391', 'Z392']);
        const hasPpSpecificDiag = toBool(item?.has_pp_specific_diag) || hasDiagCode(item, ['Z391', 'Z392']);
        const hasPostIronMed = toBool(item?.has_post_iron_med);
        const hasPostCareAdp = toBool(item?.has_post_care) || hasAnyCodeValue(item?.pp_adp_codes, ['30015']);
        const postCareNearMissing = getNearFundMissingParts(hasPostCareAdp, ' ADP 30015', [
            { met: isFemale, label: ' เพศหญิง' },
            { met: hasPpDiag, label: ' Diagnosis Z390/Z391/Z392' },
        ], isFemale && hasPpDiag);
        if (isFemale && hasPostCareAdp && hasPpDiag) {
            fundNotes.push({ label: '🤱 ตรวจหลังคลอด', kind: 'matched', group: 'other' });
        } else if (isFemale && (hasPpDiag || hasPostCareAdp) && postCareNearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'ตรวจหลังคลอด', postCareNearMissing);
        }
        const hasPostSuppAdp = toBool(item?.has_post_supp) || hasAnyCodeValue(item?.pp_adp_codes, ['30016']);
        const postSuppNearMissing = getNearFundMissingParts(hasPostSuppAdp, ' ADP 30016', [
            { met: isFemale, label: ' เพศหญิง' },
            { met: hasPpSpecificDiag, label: ' Diagnosis Z391/Z392' },
            { met: hasPostIronMed, label: ' ยาเสริมธาตุเหล็ก' },
        ], isFemale && (hasPpSpecificDiag || hasPostSuppAdp));
        if (isFemale && hasPostSuppAdp && hasPpSpecificDiag && hasPostIronMed) {
            fundNotes.push({ label: '💊 เสริมธาตุเหล็กหลังคลอด', kind: 'matched', group: 'drug' });
        } else if (isFemale && (hasPpSpecificDiag || hasPostSuppAdp) && postSuppNearMissing.length > 0) {
            addWarningFundNote(fundNotes, 'เสริมธาตุเหล็กหลังคลอด', postSuppNearMissing, 'drug');
        }

        if (toBool(item?.has_fluoride)) {
            fundNotes.push({ label: '🦷 เคลือบฟลูออไรด์', kind: 'matched', group: 'other' });
        }

        const hasFpDiag = toBool(item?.has_fp_diag) || hasDiagRegex(item, /^Z30/);
        const hasZ304Diag = toBool(item?.has_z304_diag) || hasDiagCode(item, ['Z304']);
        const hasFpAnyAdp = toBool(item?.has_fp_adp);
        const fpPillNearMissing = getNearFundMissingParts(toBool(item?.has_fp_pill), ' ADP FP003_1/FP003_2', [
            { met: hasZ304Diag, label: ' Diagnosis Z304 (การเฝ้าระวังสถาณะการใช้ยาคุมกำเนิด)' },
        ], hasZ304Diag);
        if (toBool(item?.has_fp_pill) && hasZ304Diag) {
            fundNotes.push({ label: '💊 ยาคุมกำเนิด', kind: 'matched', group: 'drug' });
        } else {
            addWarningFundNote(fundNotes, 'ยาคุมกำเนิด', fpPillNearMissing, 'drug');
        }
        const fpCondomNearMissing = getNearFundMissingParts(toBool(item?.has_fp_condom), ' ADP FP003_4', [
            { met: hasFpDiag, label: ' Diagnosis Z30x' },
        ], hasFpDiag);
        if (toBool(item?.has_fp_condom) && hasFpDiag) {
            fundNotes.push({ label: '🛡️ ถุงยางอนามัย', kind: 'matched', group: 'other' });
        } else {
            addWarningFundNote(fundNotes, 'ถุงยางอนามัย', fpCondomNearMissing);
        }
        const fpNearMissing = getNearFundMissingParts(hasFpAnyAdp, ' ADP/หัตถการ FP', [
            { met: hasFpDiag, label: ' Diagnosis Z30x' },
        ], hasFpDiag);
        if (!toBool(item?.has_fp_pill) && !toBool(item?.has_fp_condom)) {
            addWarningFundNote(fundNotes, 'วางแผนครอบครัว', fpNearMissing);
        }

        const cxNearMissing = getNearFundMissingParts(toBool(item?.has_cx_adp), ' ADP คัดกรอง', [
            { met: toBool(item?.has_cx_diag), label: ' Diagnosis/บริการคัดกรอง' },
        ], toBool(item?.has_cx_diag));
        if (toBool(item?.has_cx_diag) && toBool(item?.has_cx_adp)) {
            fundNotes.push({ label: '🎀 คัดกรองมะเร็งปากมดลูก', kind: 'matched', group: 'other' });
        } else {
            addWarningFundNote(fundNotes, 'คัดกรองมะเร็งปากมดลูก', cxNearMissing);
        }

        if (palliativeMatch) {
            fundNotes.push({ label: '🕊️ Palliative Care', kind: 'matched', group: 'palliative' });
        } else {
            const palliativeNearMissing = getNearFundMissingParts(palliativeAdp, ' ADP 30001/Cons01/Eva001', [
                { met: palliativeDiag, label: ' Diagnosis Z515/Z718' },
            ], palliativeDiag);
            addWarningFundNote(fundNotes, 'Palliative Care', palliativeNearMissing, 'palliative');
        }

        if (toBool(item?.has_chemo_diag)) {
            fundNotes.push({ label: '⚗️ เคมีบำบัด', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_hepc_diag)) {
            fundNotes.push({ label: '🩹 ไวรัสตับอักเสบซี', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_rehab_diag)) {
            fundNotes.push({ label: '♿ ฟื้นฟูสมรรถภาพ', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_crrt_diag)) {
            fundNotes.push({ label: '🏥 ฟอกเลือด (CRRT)', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_robot_item)) {
            fundNotes.push({ label: '🤖 ผ่าตัดหุ่นยนต์', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_proton_diag)) {
            fundNotes.push({ label: '⚛️ รังสีรักษา (Proton)', kind: 'matched', group: 'other' });
        }
        if (toBool(item?.has_cxr_item)) {
            fundNotes.push({ label: '🩻 อ่านฟิล์ม CXR', kind: 'matched', group: 'other' });
        }

        const dialysisRegex = new RegExp(dialysisPattern);
        const isDialysis = dialysisRegex.test(item?.pdx || item?.main_diag || '');
        const isOutsideArea = (item?.fund || '').includes('นอกเขต') ||
            (item?.fund || '').includes('ฉุกเฉิน') ||
            (item?.fund || '').endsWith('AE') ||
            (item?.fund || '').includes('OP Refer');

        if (isDialysis && isOutsideArea) {
            fundNotes.push({ label: '🩸 ล้างไต (นอกเขต)', kind: 'matched', group: 'other' });
        } else if (isDialysis) {
            fundNotes.push({ label: '⚠️ ล้างไต (ในเขต)', kind: 'warning', group: 'other' });
        }

        if (item?.serviceType === 'ผู้ป่วยนอก' && !hasDiag) {
            hasNoDiagnosis = true;
            bgStyle = 'rgba(239, 68, 68, 0.2)';
            fundNotes.push({ label: '🛑 ขาด Diag (ICD10)', kind: 'warning', group: 'other' });
        }

        const palliativeActive = fundNotes.some((note) => note.group === 'palliative');
        const visibleFundNotes = palliativeActive
            ? fundNotes.filter((note) => note.group === 'palliative' || note.group === 'drug')
            : fundNotes;

        const matchedFund = visibleFundNotes.some((note) => note.kind === 'matched');
        const incompleteFund = visibleFundNotes.some((note) => note.kind === 'warning');

        if (item?.serviceType === 'ผู้ป่วยใน') {
            opacity = 0.6;
            bgStyle = 'rgba(245, 158, 11, 0.05)';
            billingStatusLabel = 'UUC2 (ผู้ป่วยใน)';
            isUUC1 = false;
        } else if (hasNoDiagnosis) {
            billingStatusLabel = '⚠️ รอระบุวินิจฉัย (ICD10)';
            isUUC1 = false;
        } else if (item?.project_code === 'OP AE' || isOutsideArea) {
            bgStyle = 'rgba(59, 130, 246, 0.05)';
            billingStatusLabel = (item?.fund || '').includes('OP Refer') ? 'UUC1 UCS Refer บัตรทองส่งต่อ' : 'UUC1 UCS AE บัตรทองฉุกเฉินต่างจังหวัด';
            isUUC1 = true;
        } else if (matchedFund) {
            bgStyle = 'rgba(59, 130, 246, 0.05)';
            billingStatusLabel = 'UUC1 เงื่อนไขครบ';
            isUUC1 = true;
        } else if (incompleteFund) {
            bgStyle = 'rgba(254, 242, 242, 1)';
            billingStatusLabel = isDialysis && !isOutsideArea ? '⚠️ UUC2 (เบิกค่าล้างไตในเขตไม่ได้)' : '⚠️ ใกล้เข้าเงื่อนไขกองทุนพิเศษ';
            isUUC1 = false;
        } else {
            bgStyle = 'rgba(245, 158, 11, 0.05)';
            billingStatusLabel = 'UUC2 ไม่ประสงค์เบิก';
            isUUC1 = false;
        }

        if (item?.serviceType !== 'ผู้ป่วยใน' && toBool(item?.has_close)) {
            visibleFundNotes.push({ label: '🔐 ปิดสิทธิแล้ว (EP)', kind: 'ep', group: 'other' });
        } else if (item?.serviceType !== 'ผู้ป่วยใน' && isUUC1) {
            visibleFundNotes.push({ label: '🔐 ยังไม่ปิดสิทธิ (EP)', kind: 'ep', group: 'other' });
            billingStatusLabel = 'UUC1 รอปิดสิทธิ (EP)';
        }

        return {
            opacity,
            bgStyle,
            billingStatusLabel,
            specialFundNotes: visibleFundNotes.map((note) => note.label),
            isUUC1,
            incompleteFund,
            hasNoDiagnosis,
            matchedFund,
        };
    }

    if (item?.serviceType !== 'ผู้ป่วยใน' && toBool(item?.has_close)) {
        fundNotes.push({ label: '🔐 ปิดสิทธิแล้ว (EP)', kind: 'ep', group: 'other' });
    } else if (item?.serviceType !== 'ผู้ป่วยใน' && isUUC1) {
        fundNotes.push({ label: '🔐 ยังไม่ปิดสิทธิ (EP)', kind: 'ep', group: 'other' });
        billingStatusLabel = 'UUC1 รอปิดสิทธิ (EP)';
    }

    return {
        opacity,
        bgStyle,
        billingStatusLabel,
        specialFundNotes: fundNotes.map((note) => note.label),
        isUUC1,
        incompleteFund: false,
        hasNoDiagnosis,
        matchedFund: false,
    };
};
