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
});

