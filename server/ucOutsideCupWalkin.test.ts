import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWalkinVisitAudit, getWalkinConfirmationText, validateUcWalkinRange } from './ucOutsideCupWalkin.js';

test('UC WALKIN range starts from fiscal year 2568', () => {
  assert.deepEqual(validateUcWalkinRange('2024-10-01', '2025-09-30'), { startDate: '2024-10-01', endDate: '2025-09-30' });
  assert.throws(() => validateUcWalkinRange('2024-09-30', '2025-09-30'), /2568/);
});

test('UC WALKIN confirmation includes the exact current count', () => {
  assert.equal(getWalkinConfirmationText(8581), 'เพิ่ม WALKIN 8581 รายการ');
});

test('Dental Audit: scaling (96.54) with caries (K02.1) flags C-804-SCALING', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101001',
    hn: '000001',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K02.1', diagtype: '1' }],
    procedures: [{ code: '96.54', type: 'Dental' }],
    chargeItems: [{ icode: '30009', sum_price: 300, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-SCALING');
  assert.ok(issue, 'Should find C-804-SCALING');
  assert.match(issue.recommendation, /K05/);
});

test('Dental Audit: scaling (96.54) with gingivitis (K05.1) passes scaling check', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101002',
    hn: '000002',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K05.1', diagtype: '1' }],
    procedures: [{ code: '96.54', type: 'Dental' }],
    chargeItems: [{ icode: '30009', sum_price: 300, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'valid');
  assert.equal(result.issues.length, 0);
});

test('Dental Audit: filling (23.2) with gingivitis (K05.1) flags C-804-FILLING', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101003',
    hn: '000003',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K05.1', diagtype: '1' }],
    procedures: [{ code: '23.2', type: 'Dental' }],
    chargeItems: [{ icode: '30010', sum_price: 400, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-FILLING');
  assert.ok(issue, 'Should find C-804-FILLING');
  assert.match(issue.recommendation, /K02/);
});

test('Dental Audit: filling (23.2) with caries (K02.1) passes filling check', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101004',
    hn: '000004',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K02.1', diagtype: '1' }],
    procedures: [{ code: '23.2', type: 'Dental' }],
    chargeItems: [{ icode: '30010', sum_price: 400, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.audit_status, 'valid');
  assert.equal(result.issues.length, 0);
});

test('Dental Audit: impacted tooth removal (23.19) without K01 flags C-804-IMPACTED', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101005',
    hn: '000005',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K02.1', diagtype: '1' }],
    procedures: [{ code: '23.19', type: 'Dental' }],
    chargeItems: [{ icode: '30011', sum_price: 500, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-IMPACTED');
  assert.ok(issue, 'Should find C-804-IMPACTED');
  assert.match(issue.recommendation, /K01/);
});

test('Dental Audit: Z01.2 as PDX when having active dental filling flags C-800-Z012-PDX', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101006',
    hn: '000006',
    service_date: '2024-10-15',
    diagnoses: [
      { code: 'Z01.2', diagtype: '1' },
      { code: 'K02.1', diagtype: '2' },
    ],
    procedures: [{ code: '23.2', type: 'Dental' }],
    chargeItems: [{ icode: '30010', sum_price: 400, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-800-Z012-PDX');
  assert.ok(issue, 'Should find C-800-Z012-PDX');
});

test('General Audit: missing PDX flags C-MISSING-PDX', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101007',
    hn: '000007',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'J00', diagtype: '2' }],
    procedures: [],
    chargeItems: [{ icode: '10001', sum_price: 150 }],
    has_walkin: true,
  });

  assert.equal(result.audit_status, 'critical');
  assert.ok(result.issues.some((i) => i.code === 'C-MISSING-PDX'));
});

test('General Audit: external cause (V01) as PDX flags C-801-EXTERNAL-PDX', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101008',
    hn: '000008',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'V01.1', diagtype: '1' }],
    procedures: [],
    chargeItems: [{ icode: '10001', sum_price: 150 }],
    has_walkin: true,
  });

  assert.equal(result.audit_status, 'critical');
  assert.ok(result.issues.some((i) => i.code === 'C-801-EXTERNAL-PDX'));
});

test('General Audit: duplicate secondary diagnosis same as PDX flags C-803-DUPLICATE-DX', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101009',
    hn: '000009',
    service_date: '2024-10-15',
    diagnoses: [
      { code: 'J00', diagtype: '1' },
      { code: 'J00', diagtype: '2' },
    ],
    procedures: [],
    chargeItems: [{ icode: '10001', sum_price: 150 }],
    has_walkin: true,
  });

  assert.equal(result.audit_status, 'critical');
  assert.ok(result.issues.some((i) => i.code === 'C-803-DUPLICATE-DX'));
});

test('General Audit: missing WALKIN icode flags WRN-MISSING-WALKIN', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101010',
    hn: '000010',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'J00', diagtype: '1' }],
    procedures: [],
    chargeItems: [{ icode: '10001', sum_price: 150 }],
    has_walkin: false,
  });

  assert.equal(result.audit_status, 'warning');
  assert.ok(result.issues.some((i) => i.code === 'WRN-MISSING-WALKIN'));
  assert.equal(result.can_auto_fix, true);
  assert.ok(result.auto_fix_actions.includes('INSERT_WALKIN'));
});

test('Auto-Fix tagging: dental issues correctly identify auto-fix actions', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101011',
    hn: '000011',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'Z01.2', diagtype: '1' }],
    procedures: [
      { code: '96.54', type: 'Dental' },
      { code: '23.19', type: 'Dental' },
    ],
    chargeItems: [{ icode: '30009', sum_price: 300, income: '13' }],
    has_walkin: false,
  });

  assert.equal(result.can_auto_fix, true);
  assert.ok(result.auto_fix_actions.includes('ADD_K051'), 'Should suggest ADD_K051 for scaling');
  assert.ok(result.auto_fix_actions.includes('ADD_K011'), 'Should suggest ADD_K011 for impacted tooth');
  assert.ok(result.auto_fix_actions.includes('SWAP_Z012'), 'Should suggest SWAP_Z012');
  assert.ok(result.auto_fix_actions.includes('INSERT_WALKIN'), 'Should suggest INSERT_WALKIN');
});

test('Dental Audit: ANC dental procedure mixed in curative filling flags C-808-ANC-PROC-MIXED with REMOVE_ANC_PROC', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101012',
    hn: '000012',
    sex: '2',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K02.1', diagtype: '1' }],
    procedures: [
      { code: '23.2', type: 'Dental' },
      { code: '2330011', name: 'ตรวจสุขภาพช่องปากหญิงตั้งครรภ์', type: 'Dental' },
    ],
    chargeItems: [{ icode: '30010', sum_price: 400, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-808-ANC-PROC-MIXED');
  assert.ok(issue, 'Should find C-808-ANC-PROC-MIXED');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'REMOVE_ANC_PROC');
  assert.equal(result.can_auto_fix, true);
  assert.ok(result.auto_fix_actions.includes('REMOVE_ANC_PROC'));
});

test('Dental Audit: male patient with ANC dental procedure flags C-808-ANC-PROC-MIXED with REMOVE_ANC_PROC', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101013',
    hn: '000013',
    sex: '1', // Male
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K05.1', diagtype: '1' }],
    procedures: [
      { code: '96.54', type: 'Dental' },
      { code: '2387010', name: 'ขัดฟันหญิงมีครรภ์', type: 'Dental' },
    ],
    chargeItems: [{ icode: '30009', sum_price: 300, income: '13' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-808-ANC-PROC-MIXED');
  assert.ok(issue, 'Should find C-808-ANC-PROC-MIXED for male patient');
  assert.ok(result.auto_fix_actions.includes('REMOVE_ANC_PROC'));
});

test('Dental Audit: numeric procedure code (8931) in ovstdiag without procedures flags C-804-MISSING-PROC with SYNC_DENTAL_PROC', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101014',
    hn: '000014',
    service_date: '2024-10-15',
    diagnoses: [
      { code: 'K05.1', diagtype: '1' },
      { code: 'Z01.2', diagtype: '2' },
      { code: '8931', diagtype: '2' },
    ],
    procedures: [],
    chargeItems: [{ icode: '3000047', sum_price: 100, income: '66', name: 'ค่าบริการทั่วไปผู้ป่วยนอก' }],
    department: 'ทันตกรรม',
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-MISSING-PROC');
  assert.ok(issue, 'Should find C-804-MISSING-PROC');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'SYNC_DENTAL_PROC');
  assert.equal(result.can_auto_fix, true);
  assert.ok(result.auto_fix_actions.includes('SYNC_DENTAL_PROC'));
});

test('Dental Audit: numeric procedure code in ovstdiag when procedures already exist flags C-804-NUMERIC-DX with REMOVE_NUMERIC_DX', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101015',
    hn: '000015',
    service_date: '2024-10-15',
    diagnoses: [
      { code: 'K05.1', diagtype: '1' },
      { code: '8931', diagtype: '2' },
    ],
    procedures: [{ code: '96.54', type: 'Dental' }],
    chargeItems: [{ icode: '3000047', sum_price: 100, income: '66' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-NUMERIC-DX');
  assert.ok(issue, 'Should find C-804-NUMERIC-DX');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'REMOVE_NUMERIC_DX');
  assert.equal(result.can_auto_fix, true);
  assert.ok(result.auto_fix_actions.includes('REMOVE_NUMERIC_DX'));
});

test('Dental Audit: dental visit with K05.1 and Z01.2 but no procedures flags C-804-MISSING-PROC with ADD_DENTAL_EXAM', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '670101016',
    hn: '000016',
    service_date: '2024-10-15',
    diagnoses: [
      { code: 'K05.1', diagtype: '1' },
      { code: 'Z01.2', diagtype: '2' },
    ],
    procedures: [],
    chargeItems: [{ icode: '3000047', sum_price: 100, income: '66' }],
    department: 'ทันตกรรม',
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-MISSING-PROC');
  assert.ok(issue, 'Should find C-804-MISSING-PROC');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'ADD_DENTAL_EXAM');
  assert.equal(result.can_auto_fix, true);
  assert.ok(result.auto_fix_actions.includes('ADD_DENTAL_EXAM'));
});
test('Dental Audit: standard oral examination (2330010) on male patient does NOT trigger C-808-ANC-PROC-MIXED', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '690923000159',
    hn: '000005492',
    sex: '1', // Male (e.g. นายก้อน)
    service_date: '2026-09-23',
    diagnoses: [{ code: 'Z01.2', diagtype: '1' }],
    procedures: [{ code: '2330010', name: 'ตรวจสุขภาพช่องปาก', type: 'Dental' }],
    chargeItems: [{ icode: '3000047', sum_price: 100, income: '66' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  const ancIssue = result.issues.find((i) => i.code === 'C-808-ANC-PROC-MIXED');
  assert.equal(ancIssue, undefined, '2330010 must not be flagged as ANC procedure');
  assert.equal(result.audit_status, 'valid');
});

test('Dental Audit: dental visit with procedures but no diagnosis flags C-MISSING-PDX and C-800-NO-DENTAL-DX with ADD_DENTAL_PDX', () => {
  const result = evaluateWalkinVisitAudit({
    vn: '690923000159',
    hn: '000005492',
    sex: '1',
    service_date: '2026-09-23',
    diagnoses: [], // completely missing diagnosis
    procedures: [{ code: '2330010', name: 'ตรวจสุขภาพช่องปาก', type: 'Dental' }],
    chargeItems: [{ icode: '3000047', sum_price: 100, income: '66' }],
    has_walkin: true,
  });

  assert.equal(result.is_dental, true);
  assert.equal(result.audit_status, 'critical');
  const missingPdx = result.issues.find((i) => i.code === 'C-MISSING-PDX');
  assert.ok(missingPdx, 'Should flag C-MISSING-PDX');
  assert.equal(missingPdx.autoFixable, true);
  assert.equal(missingPdx.fixAction, 'ADD_DENTAL_PDX');

  const noDentalDx = result.issues.find((i) => i.code === 'C-800-NO-DENTAL-DX');
  assert.ok(noDentalDx, 'Should flag C-800-NO-DENTAL-DX');
  assert.equal(noDentalDx.autoFixable, true);
  assert.equal(noDentalDx.fixAction, 'ADD_DENTAL_PDX');

  assert.equal(result.can_auto_fix, true);
  assert.ok(result.auto_fix_actions.includes('ADD_DENTAL_PDX'));
});
