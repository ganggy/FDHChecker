export type OpdPreAuditSeverity = 'blocking' | 'warning';

export interface OpdPreAuditIssue {
  code: string;
  message: string;
  severity: OpdPreAuditSeverity;
}

const enabled = (value: unknown) => value === true || value === 1 || value === '1' || value === 'Y' || value === 'y';
const count = (value: unknown) => Number(value ?? 0) || 0;

/**
 * Rules that can be evaluated from structured HOSxP data. Evidence that only
 * exists on paper (device sticker, signed receipt, transport form) is kept out
 * of automatic pass/fail decisions and must remain a manual audit item.
 */
export const evaluateOpdPreAudit = (row: Record<string, unknown>): OpdPreAuditIssue[] => {
  if (row.an) return [];

  const issues: OpdPreAuditIssue[] = [];
  if (!enabled(row.has_provider)) {
    issues.push({ code: 'OPD-DOC01', message: 'ไม่พบแพทย์/ผู้ให้บริการประจำ visit', severity: 'warning' });
  }
  if (!enabled(row.has_clinical_note)) {
    issues.push({ code: 'OPD-DOC02', message: 'ไม่พบบันทึกอาการสำคัญหรือประวัติการเจ็บป่วย', severity: 'warning' });
  }
  if (enabled(row.has_lab_order) && !enabled(row.has_lab_result)) {
    issues.push({ code: 'OPD-LAB01', message: 'มีคำสั่ง LAB แต่ไม่พบผลตรวจใน visit', severity: 'blocking' });
  }
  if (count(row.invalid_charge_qty_count) > 0) {
    issues.push({ code: 'OPD-CHG01', message: 'พบรายการค่าใช้จ่ายที่จำนวนเป็นศูนย์หรือติดลบ', severity: 'blocking' });
  }
  if (count(row.duplicate_charge_count) > 0) {
    issues.push({ code: 'OPD-CHG02', message: 'พบรายการค่าใช้จ่ายรหัสเดียวกันซ้ำ ควรตรวจสอบการเบิกซ้ำ', severity: 'warning' });
  }
  if (enabled(row.has_55020) && enabled(row.has_55021)) {
    issues.push({ code: 'OPD-CHG03', message: 'พบค่าบริการ OPD 55020 และ 55021 พร้อมกัน', severity: 'blocking' });
  }
  if (enabled(row.has_observation_charge) && (enabled(row.has_55020) || enabled(row.has_55021))) {
    issues.push({ code: 'OPD-CHG04', message: 'พบค่าเตียงสังเกตอาการร่วมกับค่าบริการ OPD 55020/55021', severity: 'blocking' });
  }
  if (enabled(row.has_procedure_service) && !enabled(row.has_provider) && (enabled(row.has_55020) || enabled(row.has_55021))) {
    issues.push({ code: 'OPD-CHG05', message: 'visit หัตถการไม่พบผู้ตรวจ แต่มีการเบิกค่าบริการ OPD', severity: 'blocking' });
  }
  if (count(row.invalid_drug_qty_count) > 0) {
    issues.push({ code: 'OPD-DRU01', message: 'พบรายการยาที่จำนวนจ่ายเป็นศูนย์หรือติดลบ', severity: 'blocking' });
  }

  return issues;
};

export const formatOpdPreAuditIssue = (issue: OpdPreAuditIssue) => `${issue.code}: ${issue.message}`;
