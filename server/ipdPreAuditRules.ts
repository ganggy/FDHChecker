export type IpdPreAuditSeverity = 'risk' | 'review';

export type IpdPreAuditFinding = {
  code: string;
  severity: IpdPreAuditSeverity;
  title: string;
  message: string;
  evidence: string[];
};

export type IpdPreAuditResult = {
  status: 'clear' | 'review' | 'risk';
  findingCount: number;
  riskCount: number;
  reviewCount: number;
  findings: IpdPreAuditFinding[];
};

export type IpdPreAuditInput = {
  diagnoses?: unknown[];
  procedures?: unknown[];
  principalDiagnosis?: unknown;
  admissionAt?: unknown;
  dischargeAt?: unknown;
  previousDischargeAt?: unknown;
  includeDocumentAudit?: boolean;
};

const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const uniqueCodes = (values: unknown[] = []) => Array.from(new Set(values.map(normalize).filter(Boolean)));
const hasPrefix = (codes: string[], ...prefixes: string[]) => codes.some((code) => prefixes.some((prefix) => code.startsWith(normalize(prefix))));
const hasExact = (codes: string[], ...values: string[]) => values.some((value) => codes.includes(normalize(value)));
const matching = (codes: string[], predicate: (code: string) => boolean) => codes.filter(predicate);
const parseDateTime = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = new Date(text.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const evaluateIpdPreAudit = (input: IpdPreAuditInput): IpdPreAuditResult => {
  const diagnoses = uniqueCodes(input.diagnoses);
  const procedures = uniqueCodes(input.procedures);
  const principal = normalize(input.principalDiagnosis);
  const findings: IpdPreAuditFinding[] = [];
  const add = (finding: IpdPreAuditFinding) => findings.push(finding);

  if (input.includeDocumentAudit && !principal) {
    add({ code: 'IPD-DOC01', severity: 'risk', title: 'Discharge summary / Principal diagnosis', message: 'ไม่พบการวินิจฉัยหลัก (PDx) ซึ่งคู่มือกำหนดว่าเป็นข้อมูลสำคัญของบันทึกสรุปจำหน่ายและอาจถูกปฏิเสธการจ่ายทั้ง admission', evidence: [] });
  }

  const admissionAt = parseDateTime(input.admissionAt);
  const dischargeAt = parseDateTime(input.dischargeAt);
  if (input.includeDocumentAudit && (!admissionAt || !dischargeAt || dischargeAt.getTime() < admissionAt.getTime())) {
    add({ code: 'IPD-DOC02', severity: 'risk', title: 'วันเวลา Admit / Discharge', message: 'วันเวลารับไว้และจำหน่ายไม่ครบหรือไม่สัมพันธ์กัน ต้องทบทวนกับคำสั่งรับไว้ Nurses’ note และ Discharge summary', evidence: [String(input.admissionAt || ''), String(input.dischargeAt || '')].filter(Boolean) });
  } else if (input.includeDocumentAudit && admissionAt && dischargeAt) {
    const stayHours = (dischargeAt.getTime() - admissionAt.getTime()) / 3600000;
    if (stayHours < 24) {
      add({ code: 'IPD-DOC03', severity: 'review', title: 'Short stay / เหตุผลการรับเป็นผู้ป่วยใน', message: `LOS ${stayHours.toFixed(1)} ชั่วโมง ควรทบทวนเหตุผลทางการแพทย์ใน Admission note โดยเฉพาะกรณีรับไว้เพื่อตรวจ เตรียมหัตถการ หรือทำหัตถการไม่ซับซ้อน`, evidence: [`LOS ${stayHours.toFixed(1)} ชั่วโมง`] });
    }
  }

  const previousDischargeAt = parseDateTime(input.previousDischargeAt);
  if (input.includeDocumentAudit && admissionAt && previousDischargeAt) {
    const gapHours = (admissionAt.getTime() - previousDischargeAt.getTime()) / 3600000;
    if (gapHours >= 0 && gapHours <= 24) {
      add({ code: 'IPD-DOC04', severity: 'risk', title: 'Split admission', message: `รับไว้ซ้ำภายใน ${gapHours.toFixed(1)} ชั่วโมง ควรตรวจเหตุผลทางการแพทย์และความเสี่ยงการแบ่ง admission เพื่อเบิกหลายครั้ง`, evidence: [`ช่วงห่าง ${gapHours.toFixed(1)} ชั่วโมง`] });
    }
  }

  if (input.includeDocumentAudit && procedures.length > 0) {
    add({ code: 'IPD-DOC05', severity: 'review', title: 'หลักฐานการทำหัตถการ', message: 'พบ ICD-9 procedure ต้องตรวจ operative/procedure note ให้มี finding ขั้นตอนสำคัญ และการรับรองผู้ทำหัตถการ', evidence: procedures });
  }

  const cancerCodes = matching(diagnoses, (code) => /^C[0-9]{2}/.test(code));
  if (input.includeDocumentAudit && cancerCodes.length > 0) {
    add({ code: 'IPD-DOC06', severity: 'review', title: 'Active cancer documentation', message: 'ทบทวนชนิด ระยะ ตำแหน่งรอยโรค สถานะโรค ประวัติการรักษา และหลักฐาน pathology/radiology ที่สนับสนุนมะเร็งระยะ active', evidence: cancerCodes });
  }

  const sepsisCodes = matching(diagnoses, (code) => code.startsWith('A40') || code.startsWith('A41'));
  if (sepsisCodes.length > 0) {
    add({ code: 'CR1', severity: 'review', title: 'Sepsis', message: 'ทบทวนแหล่งติดเชื้อ เชื้อที่พบ และหลักฐาน qSOFA/organ dysfunction ในเวชระเบียน', evidence: sepsisCodes });
  }

  if (hasExact(diagnoses, 'R572')) {
    add({
      code: 'CR37',
      severity: sepsisCodes.length > 0 ? 'review' : 'risk',
      title: 'Septic shock',
      message: sepsisCodes.length > 0
        ? 'ทบทวน poor tissue perfusion, vasopressor หลังให้สารน้ำ และ lactate > 2 mmol/L'
        : 'พบ R57.2 แต่ไม่พบรหัส sepsis A40-A41 ร่วมกัน',
      evidence: ['R572', ...sepsisCodes],
    });
  }

  const copdCodes = matching(diagnoses, (code) => code.startsWith('J44'));
  if (hasExact(copdCodes, 'J440') && !hasPrefix(diagnoses, 'J09', 'J10', 'J11', 'J12', 'J13', 'J14', 'J15', 'J16', 'J17', 'J18', 'J20', 'J21', 'J22')) {
    add({ code: 'CR13_1', severity: 'risk', title: 'COPD with infection', message: 'พบ J44.0 แต่ไม่พบรหัสการติดเชื้อทางเดินหายใจ/ปอดอักเสบร่วม', evidence: copdCodes });
  } else if (principal === 'J449') {
    add({ code: 'CR13_1', severity: 'review', title: 'COPD unspecified', message: 'J44.9 เป็นโรคหลักผู้ป่วยใน ควรทบทวนความรุนแรง เหตุผลรับไว้ และผลตรวจแยกโรค', evidence: ['J449'] });
  }

  const woundCodes = matching(diagnoses, (code) => code === 'T793' || code === 'M726' || code.startsWith('L03') || code === 'R02');
  if (hasExact(diagnoses, 'T793') && !hasPrefix(diagnoses, 'V', 'W', 'X', 'Y')) {
    add({ code: 'CR19', severity: 'risk', title: 'Post-traumatic wound infection', message: 'พบ T79.3 แต่ไม่พบรหัสสาเหตุภายนอก V/W/X/Y', evidence: woundCodes });
  }
  if (hasExact(diagnoses, 'M726')) {
    const hasExcisionalDebridement = hasExact(procedures, '8622');
    const redundantWoundCode = hasExact(diagnoses, 'T793', 'R02') || hasPrefix(diagnoses, 'L03');
    add({
      code: 'CR19',
      severity: !hasExcisionalDebridement || redundantWoundCode ? 'risk' : 'review',
      title: 'Necrotizing fasciitis',
      message: !hasExcisionalDebridement
        ? 'พบ M72.6 แต่ไม่พบ 86.22 excisional debridement; ต้องทบทวน operative note หรือผลจำหน่าย refer/dead'
        : redundantWoundCode
          ? 'พบ M72.6 ร่วมกับ T79.3/L03/R02 ซึ่งเอกสารระบุว่าไม่ควรให้รหัสซ้ำในแผลเดียวกัน'
          : 'ทบทวน operative note ให้ระบุเนื้อตาย ความลึก เนื้อเยื่อ และเทคนิค excisional debridement',
      evidence: [...woundCodes, ...matching(procedures, (code) => code === '8622' || code === '8628')],
    });
  }

  const aplasticCodes = matching(diagnoses, (code) => code.startsWith('D61') || code === 'D649' || code === 'D70' || code === 'D696' || code === 'D731');
  if (hasPrefix(diagnoses, 'D61')) {
    add({ code: 'CR39', severity: 'review', title: 'Aplastic anemia', message: 'ทบทวนผล bone marrow ที่สนับสนุน hypocellular marrow; กรณีจาก chemotherapy ให้ตรวจรหัส D61.1 และ Y43.2', evidence: aplasticCodes });
  }
  if (['D649', 'D70', 'D696'].every((code) => diagnoses.includes(code)) && hasExact(diagnoses, 'D731')) {
    add({ code: 'CR39', severity: 'risk', title: 'Pancytopenia with known cause', message: 'พบ D73.1 hypersplenism พร้อม D64.9/D70/D69.6 ควรทบทวนการให้รหัส cytopenia ซ้ำเมื่อทราบสาเหตุแล้ว', evidence: aplasticCodes });
  }

  const substanceCodes = matching(diagnoses, (code) => /^F1[0-9]/.test(code) || code === 'Z503' || code === 'Z715' || code === 'Z722');
  if (hasPrefix(diagnoses, 'F19') && matching(diagnoses, (code) => /^F1[0-8]/.test(code)).length > 0) {
    add({ code: 'CR44_1', severity: 'risk', title: 'Multiple drug use', message: 'พบ F19 ร่วมกับรหัสสารเฉพาะ F10-F18 ควรทบทวนว่าซ้ำซ้อนหรือไม่', evidence: substanceCodes });
  }
  if (hasExact(diagnoses, 'Z503', 'Z715')) {
    add({ code: 'CR44_1', severity: 'risk', title: 'Drug rehabilitation', message: 'เมื่อให้ Z50.3 แล้ว เอกสารระบุว่าไม่ต้องให้ Z71.5 ร่วม', evidence: substanceCodes });
  } else if (hasPrefix(diagnoses, 'F152') && !hasExact(diagnoses, 'Z503')) {
    add({ code: 'CR44_1', severity: 'review', title: 'Amphetamine dependence', message: 'ทบทวนประวัติ/ผล urine methamphetamine และกรณีบำบัดต่อเนื่องให้ตรวจ Z50.3', evidence: substanceCodes });
  }

  if (hasExact(diagnoses, 'I251')) {
    add({ code: 'CR45', severity: 'review', title: 'Atherosclerotic heart disease', message: 'ทบทวนหลักฐาน CAG/CT angiogram/cardiac imaging และระดับ stenosis ที่สนับสนุน I25.1', evidence: ['I251', ...matching(procedures, (code) => code === '8855' || code === '8856')] });
  }
  if (hasExact(diagnoses, 'I255')) {
    add({ code: 'CR45', severity: 'review', title: 'Ischemic cardiomyopathy', message: 'ทบทวน LVEF < 40% และประวัติ MI/revascularization หรือ coronary stenosis ตามเกณฑ์', evidence: ['I255'] });
  }

  const hasPtca = hasExact(procedures, '0066');
  const vesselCountCodes = matching(procedures, (code) => ['0040', '0041', '0042', '0043', '0044'].includes(code));
  const stentCountCodes = matching(procedures, (code) => ['0045', '0046', '0047', '0048'].includes(code));
  const stentTypeCodes = matching(procedures, (code) => code === '3606' || code === '3607');
  if (hasPtca && vesselCountCodes.length === 0) {
    add({ code: 'CR58', severity: 'risk', title: 'PCI coding', message: 'พบ 00.66 PTCA แต่ไม่พบรหัสจำนวนหลอดเลือด 00.40-00.44', evidence: ['0066'] });
  }
  if ((stentCountCodes.length > 0) !== (stentTypeCodes.length > 0)) {
    add({ code: 'CR58', severity: 'risk', title: 'Coronary stent coding', message: 'รหัสจำนวน stent 00.45-00.48 และชนิด stent 36.06/36.07 ต้องทบทวนให้ครบคู่', evidence: [...stentCountCodes, ...stentTypeCodes] });
  }

  if (hasExact(diagnoses, 'E872')) {
    add({ code: 'CR5', severity: 'review', title: 'Acidosis', message: 'ทบทวน bicarbonate < 20 mEq/L หรือ pH < 7.30 และหลีกเลี่ยงการให้รหัสซ้ำเมื่อเป็นอาการของ shock/sepsis/DKA/renal failure', evidence: ['E872'] });
  }

  if (hasExact(diagnoses, 'E877')) {
    const hasHeartFailure = hasPrefix(diagnoses, 'I50');
    add({
      code: 'CR8',
      severity: hasHeartFailure ? 'risk' : 'review',
      title: 'Volume overload',
      message: hasHeartFailure
        ? 'พบ E87.7 ร่วมกับ I50.-; เอกสารระบุว่าเมื่อวินิจฉัย congestive heart failure แล้วไม่ต้องให้ fluid overload ร่วม'
        : 'ทบทวนสาเหตุ อาการบวม/หอบ, crepitation, JVP และภาพรังสีที่สนับสนุน E87.7',
      evidence: ['E877', ...matching(diagnoses, (code) => code.startsWith('I50') || code.startsWith('N18'))],
    });
  }

  const riskCount = findings.filter((finding) => finding.severity === 'risk').length;
  const reviewCount = findings.length - riskCount;
  return {
    status: riskCount > 0 ? 'risk' : findings.length > 0 ? 'review' : 'clear',
    findingCount: findings.length,
    riskCount,
    reviewCount,
    findings,
  };
};
