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
  sex?: unknown;
  ageDays?: unknown;
  wardName?: unknown;
  hasTamiflu?: unknown;
  hasInfluenzaTest?: unknown;
  hasCtScan?: unknown;
  hasReferral?: unknown;
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
const numericCodeRange = (code: string, prefix: string, start: number, end: number) => {
  if (!code.startsWith(prefix)) return false;
  const value = Number(code.slice(prefix.length, prefix.length + 2));
  return Number.isInteger(value) && value >= start && value <= end;
};
const truthy = (value: unknown) => value === true || value === 1 || String(value ?? '').trim() === '1';
const isFemaleSex = (value: unknown) => ['2', 'F', 'FEMALE', 'หญิง'].includes(String(value ?? '').trim().toUpperCase());
const isMaleSex = (value: unknown) => ['1', 'M', 'MALE', 'ชาย'].includes(String(value ?? '').trim().toUpperCase());
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

  // เงื่อนไขเพิ่มเติมจากงานประกันของโรงพยาบาล
  const femaleOnlyCodes = matching(diagnoses, (code) => (
    code === 'A34' || code === 'B373' || numericCodeRange(code, 'C', 51, 58) || code === 'C796'
    || code.startsWith('D06') || ['D070', 'D071', 'D072', 'D073'].some((prefix) => code.startsWith(prefix))
    || numericCodeRange(code, 'D', 25, 28) || code.startsWith('D39') || code.startsWith('E28')
    || code === 'E894' || code === 'F525' || code.startsWith('F53') || code === 'I863'
    || code === 'L292' || code === 'L705' || code.startsWith('M800') || code.startsWith('M801')
    || code.startsWith('M810') || code.startsWith('M811') || code.startsWith('M830')
    || numericCodeRange(code, 'N', 70, 98) || code.startsWith('N992') || code.startsWith('N993')
    || numericCodeRange(code, 'O', 0, 99) || code === 'P546' || code.startsWith('Q50') || code.startsWith('Q52')
    || code.startsWith('R87') || code === 'S314' || ['S374', 'S375', 'S376'].some((prefix) => code.startsWith(prefix))
    || ['T192', 'T193'].some((prefix) => code.startsWith(prefix)) || code === 'T833' || code.startsWith('Y76')
    || ['Z014', 'Z124', 'Z301', 'Z303', 'Z305', 'Z311', 'Z312', 'Z437', 'Z875', 'Z975'].includes(code)
    || numericCodeRange(code, 'Z', 32, 36) || code.startsWith('Z39')
  ));
  if (femaleOnlyCodes.length > 0 && !isFemaleSex(input.sex)) {
    add({ code: 'INS-IPD03', severity: 'risk', title: 'รหัสโรคที่ใช้ได้เฉพาะเพศหญิง', message: 'พบ ICD ในกลุ่มที่งานประกันกำหนดให้ใช้กับผู้ป่วยเพศหญิงเท่านั้น แต่ข้อมูลเพศไม่ใช่หญิง', evidence: femaleOnlyCodes });
  }

  const injuryCodes = matching(diagnoses, (code) => code.startsWith('S') || code.startsWith('T'));
  const externalCauseCodes = matching(diagnoses, (code) => /^[VWXY]/.test(code));
  if (injuryCodes.length > 0 && externalCauseCodes.length === 0) {
    add({ code: 'INS-IPD04', severity: 'risk', title: 'Injury / External cause', message: 'เมื่อให้รหัส S หรือ T ต้องมีรหัสสาเหตุภายนอก V/W/X/Y ร่วมด้วย', evidence: injuryCodes });
  }

  const incompleteAccidentCodes = matching(diagnoses, (code) => /^[STVWXY]/.test(code) && code.length < 5);
  if (incompleteAccidentCodes.length > 0) {
    add({ code: 'INS-IPD04A', severity: 'risk', title: 'รหัสอุบัติเหตุไม่ครบ 5 หลัก', message: 'รหัสอุบัติเหตุ/การบาดเจ็บกลุ่ม S, T, V, W, X, Y ต้องมีอย่างน้อย 5 หลักหลังตัดจุดออก', evidence: incompleteAccidentCodes });
  }

  if (/^O8[0-4]/.test(principal)) {
    const otherOCodes = diagnoses.filter((code) => code.startsWith('O') && code !== principal);
    if (otherOCodes.length > 0) {
      add({ code: 'INS-IPD05', severity: 'risk', title: 'Delivery code as principal diagnosis', message: 'เมื่อ O80.0-O84.9 เป็น PDx ต้องไม่มีรหัส O กลุ่มอื่นร่วมในการให้รหัสครั้งนี้', evidence: [principal, ...otherOCodes] });
    }
  }

  if (/^T31[0-9]/.test(principal)) {
    add({ code: 'INS-IPD06', severity: 'risk', title: 'Burn extent code as PDx', message: 'ห้ามใช้ T31.0-T31.9 เป็น Principal diagnosis', evidence: [principal] });
  }

  const hasB451 = hasExact(diagnoses, 'B451');
  const hasG021 = hasExact(diagnoses, 'G021');
  if (hasB451 !== hasG021) {
    add({ code: 'INS-IPD07', severity: 'risk', title: 'Cryptococcal meningitis dagger/asterisk pair', message: 'B45.1 และ G02.1 ต้องให้รหัสคู่กัน', evidence: matching(diagnoses, (code) => code === 'B451' || code === 'G021') });
  }

  const hivCodes = matching(diagnoses, (code) => code === 'R75' || code === 'Z21' || /^B2[0-4]/.test(code));
  const hivGroups = new Set(hivCodes.map((code) => code === 'R75' || code === 'Z21' ? code : code.slice(0, 3)));
  if (hivGroups.size > 1) {
    add({ code: 'INS-IPD08', severity: 'risk', title: 'HIV status codes are mutually exclusive', message: 'R75, Z21 และกลุ่ม B20-B24 ใช้ร่วมกันไม่ได้ ให้เลือกสถานะที่ตรงที่สุดเพียงกลุ่มเดียว', evidence: hivCodes });
  }

  const dmCodes = matching(diagnoses, (code) => numericCodeRange(code, 'E', 10, 14));
  const abnormalGlucoseCodes = matching(diagnoses, (code) => code.startsWith('R73'));
  if (dmCodes.length > 0 && abnormalGlucoseCodes.length > 0) {
    add({ code: 'INS-IPD09', severity: 'risk', title: 'Diabetes with abnormal glucose code', message: 'เมื่อวินิจฉัย DM ด้วย E10-E14 แล้ว ต้องไม่มี R73.- ร่วม', evidence: [...dmCodes, ...abnormalGlucoseCodes] });
  }

  const ageDays = Number(input.ageDays);
  if (hasExact(diagnoses, 'Z380') && (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 15)) {
    add({ code: 'INS-IPD10', severity: 'risk', title: 'Singleton liveborn infant', message: 'Z38.0 ใช้ได้เฉพาะทารกแรกเกิดอายุ 0-15 วัน', evidence: ['Z380', Number.isFinite(ageDays) ? `อายุ ${ageDays} วัน` : 'ไม่พบอายุเป็นวัน'] });
  }

  if (hasExact(diagnoses, 'Z370') && (!isFemaleSex(input.sex) || !hasExact(diagnoses, 'O800'))) {
    add({ code: 'INS-IPD11', severity: 'risk', title: 'Outcome of delivery', message: 'Z37.0 ใช้ได้เฉพาะผู้ป่วยเพศหญิงและต้องมี O80.0 ร่วม', evidence: ['Z370', ...matching(diagnoses, (code) => code === 'O800')] });
  }

  const d68Codes = matching(diagnoses, (code) => /^D68[0-9]/.test(code));
  if (d68Codes.length > 0 && !hasExact(diagnoses, 'Y442')) {
    add({ code: 'INS-T01', severity: 'risk', title: 'Coagulation defect / drug external cause', message: 'D68.0-D68.9 ต้องมี Y44.2 ร่วมตามเงื่อนไขงานประกัน', evidence: d68Codes });
  }

  const incompletePoisoningCodes = matching(diagnoses, (code) => numericCodeRange(code, 'T', 36, 50) && code.length < 5);
  if (incompletePoisoningCodes.length > 0) {
    add({ code: 'INS-T02', severity: 'risk', title: 'Poisoning code fifth character', message: 'T36-T50 ต้องระบุอักขระตำแหน่งที่ 5 ของรหัสให้ครบ', evidence: incompletePoisoningCodes });
  }

  const substanceSpecific = matching(diagnoses, (code) => /^F1[0-8]/.test(code));
  if (/^F1[0-8]/.test(principal) && substanceSpecific.some((code) => code.slice(0, 3) !== principal.slice(0, 3))) {
    add({ code: 'INS-T03', severity: 'risk', title: 'Multiple substance categories', message: 'เมื่อ PDx และ SDx อยู่ต่างกลุ่มใน F10-F18 ให้ทบทวนการใช้ F19 ตามเงื่อนไขงานประกัน', evidence: substanceSpecific });
  }

  if (hasExact(diagnoses, 'N10') && hasExact(diagnoses, 'N200')) {
    add({ code: 'INS-T04', severity: 'review', title: 'N10 with N20.0', message: 'พบ N10 และ N20.0 ร่วมกัน งานประกันระบุให้ทบทวนการเปลี่ยนรหัสเป็น F19 ก่อนส่งเบิก', evidence: ['N10', 'N200'] });
  }

  const tbCodes = matching(diagnoses, (code) => numericCodeRange(code, 'A', 15, 19));
  if (tbCodes.length > 0 && hasExact(diagnoses, 'B24')) {
    add({ code: 'INS-T06', severity: 'review', title: 'Tuberculosis with HIV disease', message: 'พบ A15-A19 ร่วม B24 งานประกันระบุให้ทบทวน PDx B20.0 และ SDx A15-A16', evidence: [...tbCodes, 'B24'] });
  }

  if (principal === 'I693') {
    add({ code: 'INS-T07', severity: 'risk', title: 'Sequelae of cerebral infarction as PDx', message: 'I69.3 ไม่ควรเป็น PDx; ใช้เพื่อระบุความพิการหรือความบกพร่องที่เหลืออยู่', evidence: ['I693'] });
  }

  if (hasExact(diagnoses, 'L893') && /HOME|โฮม|บ้าน/i.test(String(input.wardName ?? ''))) {
    add({ code: 'INS-T08', severity: 'risk', title: 'Pressure ulcer in Home ward', message: 'งานประกันกำหนดห้าม Admit รหัส L89.3 ใน Home ward', evidence: ['L893', String(input.wardName || 'Home ward')] });
  }
  if (hasExact(diagnoses, 'L89')) {
    add({ code: 'INS-T09', severity: 'risk', title: 'Incomplete pressure ulcer code', message: 'ห้ามใช้ L89 ที่ไม่ครบหลัก ควรระบุ L89.0-L89.3 ให้ชัดเจน', evidence: ['L89'] });
  }

  if (hasExact(diagnoses, 'J111') && !truthy(input.hasTamiflu)) {
    add({ code: 'INS-T10', severity: 'review', title: 'Influenza with other respiratory manifestations', message: 'J11.1 ต้องทบทวนหลักฐานการให้ Tamiflu/Oseltamivir', evidence: ['J111'] });
  }
  if (hasPrefix(diagnoses, 'J10') && !truthy(input.hasInfluenzaTest)) {
    add({ code: 'INS-T11', severity: 'review', title: 'Influenza virus identified', message: 'J10 ต้องมีผลตรวจ Influenza สนับสนุน', evidence: matching(diagnoses, (code) => code.startsWith('J10')) });
  }

  const strokeCtCodes = matching(diagnoses, (code) => numericCodeRange(code, 'I', 60, 63));
  if (strokeCtCodes.length > 0 && !truthy(input.hasCtScan)) {
    add({ code: 'INS-T13', severity: 'review', title: 'Stroke imaging evidence', message: 'I60-I63 ต้องมีหลักฐาน CT scan ตามเงื่อนไขงานประกัน', evidence: strokeCtCodes });
  }
  if (hasExact(diagnoses, 'I64') && !truthy(input.hasReferral)) {
    add({ code: 'INS-T14', severity: 'risk', title: 'Unspecified stroke referral', message: 'I64 ใช้ในกรณี Refer เท่านั้น แต่ไม่พบหลักฐานส่งต่อ/รับส่งต่อ', evidence: ['I64'] });
  }

  if (hasExact(diagnoses, 'A419')) {
    add({ code: 'INS-T15', severity: 'risk', title: 'A41.9 local insurance restriction', message: 'งานประกันกำหนดห้ามใช้ A41.9 และให้ทบทวน R50.9 ตามเอกสารเงื่อนไขของโรงพยาบาล', evidence: ['A419'] });
  }
  if (hasExact(diagnoses, 'R572') && !hasExact(diagnoses, 'A419')) {
    add({ code: 'INS-T16', severity: 'risk', title: 'Septic shock local pair', message: 'R57.2 ต้องมี A41.9 ร่วมตามเงื่อนไขงานประกัน', evidence: ['R572'] });
  }

  const maleOnlyCodes = matching(diagnoses, (code) => numericCodeRange(code, 'N', 40, 51));
  if (maleOnlyCodes.length > 0 && !isMaleSex(input.sex)) {
    add({ code: 'INS-T17', severity: 'risk', title: 'Male-only diagnosis', message: 'N40-N51 ใช้ได้เฉพาะผู้ป่วยเพศชาย', evidence: maleOnlyCodes });
  }
  const perinatalCodes = matching(diagnoses, (code) => numericCodeRange(code, 'P', 0, 96));
  if (perinatalCodes.length > 0 && (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 28)) {
    add({ code: 'INS-T19', severity: 'risk', title: 'Perinatal diagnosis age', message: 'P00-P96 ใช้ได้เฉพาะทารกอายุ 0-28 วัน', evidence: [...perinatalCodes, Number.isFinite(ageDays) ? `อายุ ${ageDays} วัน` : 'ไม่พบอายุเป็นวัน'] });
  }

  if (hasExact(procedures, '9904')) {
    const transfusionDx = matching(diagnoses, (code) => ['D56', 'D64', 'D62', 'D630', 'D638'].some((prefix) => code.startsWith(prefix)));
    if (transfusionDx.length === 0) {
      add({ code: 'INS-T20', severity: 'risk', title: 'Blood transfusion diagnosis support', message: 'หัตถการ 99.04 ต้องมี PDx หรือ SDx กลุ่ม D56, D64, D62, D63.0 หรือ D63.8 สนับสนุน', evidence: ['9904'] });
    }
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
