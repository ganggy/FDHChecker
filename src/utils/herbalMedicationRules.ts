export interface HerbalMedicationRule {
    id: string;
    symptom: string;
    diagnosisCodes: string[];
    medicines: string[];
}

export type HerbalMedicationMatchStatus = 'valid' | 'invalid' | 'review' | 'no-herb';

export interface HerbalMedicationAssessment {
    status: HerbalMedicationMatchStatus;
    diagnosisCodes: string[];
    matchedSymptoms: string[];
    matchedMedicines: string[];
    wrongMedicines: string[];
    unknownItems: string[];
    reasons: string[];
}

/** รายการนี้ถอดตามตารางที่ผู้ใช้กำหนด โรงพยาบาลสามารถแก้ไขเพิ่มชื่อการค้าเป็น alias ได้ภายหลัง */
export const HERBAL_MEDICATION_RULES: HerbalMedicationRule[] = [
    {
        id: 'musculoskeletal-pain',
        symptom: 'ปวดกล้ามเนื้อและปวดข้อ',
        diagnosisCodes: ['M179', 'M549', 'U57'],
        medicines: ['ครีมไพล', 'เถาวัลย์เปรียง', 'สหัสธารา', 'ลูกประคบ'],
    },
    {
        id: 'cold-covid',
        symptom: 'ไข้หวัด/โควิด-19',
        diagnosisCodes: ['U5619', 'J00'],
        medicines: ['ปราบชมพูทวีป', 'มะขามป้อม', 'ฟ้าทะลายโจร', 'มะแว้ง'],
    },
    {
        id: 'cough',
        symptom: 'ไอ',
        diagnosisCodes: ['U643', 'J069'],
        medicines: [],
    },
    {
        id: 'dyspepsia',
        symptom: 'ท้องอืด ท้องเฟ้อ',
        diagnosisCodes: ['R101', 'U6670'],
        medicines: ['ธาตุอบเชย', 'ขมิ้นชัน'],
    },
    {
        id: 'constipation',
        symptom: 'ท้องผูก',
        diagnosisCodes: ['K590', 'U6984'],
        medicines: ['มะขามแขก', 'เพชรสังฆาต'],
    },
    {
        id: 'hemorrhoid',
        symptom: 'ริดสีดวงทวารหนัก',
        diagnosisCodes: ['K640', 'K641', 'K642', 'U680'],
        medicines: [],
    },
    {
        id: 'dizziness',
        symptom: 'วิงเวียน',
        diagnosisCodes: ['R42', 'U6131'],
        medicines: ['ชาชงขิง', 'นวโกฐ'],
    },
    {
        id: 'post-stroke-numbness',
        symptom: 'ชาจากอัมพฤกษ์-อัมพาต',
        diagnosisCodes: ['M179', 'M549', 'U610'],
        medicines: ['แก้ลมแก้เส้น', 'ทำลายพระสุเมรุ'],
    },
    {
        id: 'skin',
        symptom: 'ผิวหนัง',
        diagnosisCodes: ['B353', 'B354', 'B356', 'U7081'],
        medicines: ['ทองพันชั่ง', 'พญายอ'],
    },
    {
        id: 'wound',
        symptom: 'แผล',
        diagnosisCodes: ['U7061', 'T220', 'T221', 'X1900'],
        medicines: ['ว่านหางจระเข้', 'เปลือกมังคุด'],
    },
    {
        id: 'insomnia',
        symptom: 'นอนไม่หลับ',
        diagnosisCodes: ['F510', 'G470', 'U7522'],
        medicines: ['ศุขไสยาศน์', 'น้ำมันกัญชา', 'ยาหอมเทพจิตร'],
    },
    {
        id: 'non-infectious-diarrhea',
        symptom: 'ท้องเสีย (ไม่ติดเชื้อ)',
        diagnosisCodes: ['A099', 'U6980'],
        medicines: ['เหลืองปิดสมุทร', 'ยากล้วย'],
    },
    {
        id: 'poor-appetite',
        symptom: 'เบื่ออาหาร',
        diagnosisCodes: ['R630', 'U6681'],
        medicines: ['มะระขี้นก', 'น้ำมันกัญชา'],
    },
];

const normalizeDiagnosisCode = (value: unknown) => String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const normalizeMedicineName = (value: unknown) => String(value ?? '')
    .trim()
    .toLocaleLowerCase('th-TH')
    .replace(/[^\p{L}\p{N}]+/gu, '');

export const collectHerbalDiagnosisCodes = (...values: unknown[]) => Array.from(new Set(
    values
        .flatMap((value) => String(value ?? '').split(/[^A-Za-z0-9.]+/))
        .map(normalizeDiagnosisCode)
        .filter(Boolean),
));

const diagnosisMatchesRule = (diagnosisCode: string, ruleCode: string) => (
    diagnosisCode.startsWith(normalizeDiagnosisCode(ruleCode))
);

export function evaluateHerbalMedicationMatch(
    diagnosisValues: unknown[],
    herbItemsValue: unknown,
): HerbalMedicationAssessment {
    const diagnosisCodes = collectHerbalDiagnosisCodes(...diagnosisValues);
    const herbItems = String(herbItemsValue ?? '').trim();
    if (!herbItems) {
        return {
            status: 'no-herb',
            diagnosisCodes,
            matchedSymptoms: [],
            matchedMedicines: [],
            wrongMedicines: [],
            unknownItems: [],
            reasons: ['ไม่พบรายการยาสมุนไพร'],
        };
    }

    const matchedRules = HERBAL_MEDICATION_RULES.filter((rule) => rule.diagnosisCodes.some(
        (ruleCode) => diagnosisCodes.some((diagnosisCode) => diagnosisMatchesRule(diagnosisCode, ruleCode)),
    ));
    const normalizedHerbItems = normalizeMedicineName(herbItems);
    const medicineRules = new Map<string, HerbalMedicationRule[]>();
    HERBAL_MEDICATION_RULES.forEach((rule) => rule.medicines.forEach((medicine) => {
        medicineRules.set(medicine, [...(medicineRules.get(medicine) ?? []), rule]);
    }));

    const matchedMedicines = Array.from(medicineRules.keys()).filter((medicine) => (
        normalizedHerbItems.includes(normalizeMedicineName(medicine))
    ));
    const matchedRuleIds = new Set(matchedRules.map((rule) => rule.id));
    const wrongMedicines = matchedMedicines.filter((medicine) => (
        !(medicineRules.get(medicine) ?? []).some((rule) => matchedRuleIds.has(rule.id))
    ));
    const unknownItems = herbItems
        .split(/[,;|\n]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !matchedMedicines.some((medicine) => (
            normalizeMedicineName(item).includes(normalizeMedicineName(medicine))
        )));

    const reasons: string[] = [];
    if (diagnosisCodes.length === 0) reasons.push('ไม่พบ Diagnosis สำหรับตรวจสอบยา');
    else if (matchedRules.length === 0) reasons.push(`Diagnosis ${diagnosisCodes.join(', ')} ไม่อยู่ในตารางจับคู่ยาสมุนไพร`);
    if (wrongMedicines.length > 0) reasons.push(`ยาไม่สัมพันธ์กับโรค: ${wrongMedicines.join(', ')}`);
    if (matchedMedicines.length === 0) reasons.push('ชื่อยาไม่อยู่ในตารางจับคู่ ต้องตรวจสอบหรือเพิ่มชื่อยา/ชื่อการค้า');
    else if (unknownItems.length > 0) reasons.push(`มีรายการที่ยังไม่รู้จัก: ${unknownItems.join(', ')}`);
    const groupsWithoutMedicines = matchedRules.filter((rule) => rule.medicines.length === 0);
    if (groupsWithoutMedicines.length > 0 && matchedMedicines.length === 0) {
        reasons.push(`ยังไม่ได้กำหนดรายการยาสำหรับกลุ่ม: ${groupsWithoutMedicines.map((rule) => rule.symptom).join(', ')}`);
    }

    const invalid = wrongMedicines.length > 0 || (matchedMedicines.length > 0 && matchedRules.length === 0);
    const needsReview = !invalid && (matchedRules.length === 0 || matchedMedicines.length === 0 || unknownItems.length > 0);
    return {
        status: invalid ? 'invalid' : needsReview ? 'review' : 'valid',
        diagnosisCodes,
        matchedSymptoms: matchedRules.map((rule) => rule.symptom),
        matchedMedicines,
        wrongMedicines,
        unknownItems,
        reasons,
    };
}
