import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDentalCategories,
  classifyPttypeGroup,
  evaluateDentalVisitAudit,
} from './dentalAudit';

test('Dental Category: scaling procedure correctly identifies SCALING category', () => {
  const cats = classifyDentalCategories(
    [{ code: '96.54', name: 'ขูดหินปูนทั้งปาก' }],
    [{ code: 'K05.1', diagtype: '1' }],
    []
  );
  assert.ok(cats.includes('SCALING'));
});

test('Dental Category: filling procedure correctly identifies FILLING category', () => {
  const cats = classifyDentalCategories(
    [{ code: '23.2', name: 'อุดฟันด้วยอมัลกัม' }],
    [{ code: 'K02.1', diagtype: '1' }],
    []
  );
  assert.ok(cats.includes('FILLING'));
});

test('Dental Category: extraction and impaction correctly identifies EXTRACTION category', () => {
  const cats = classifyDentalCategories(
    [{ code: '23.19', name: 'ผ่าฟันคุด' }],
    [{ code: 'K01.1', diagtype: '1' }],
    []
  );
  assert.ok(cats.includes('EXTRACTION'));
});

test('Dental Category: oral exam correctly identifies EXAM category', () => {
  const cats = classifyDentalCategories(
    [{ code: '2330010', name: 'ตรวจสุขภาพช่องปาก' }],
    [{ code: 'Z01.2', diagtype: '1' }],
    []
  );
  assert.ok(cats.includes('EXAM'));
});

test('Dental Category: ANC procedure correctly identifies ANC category', () => {
  const cats = classifyDentalCategories(
    [{ code: '2330011', name: 'ตรวจสุขภาพช่องปากหญิงตั้งครรภ์' }],
    [{ code: 'Z34.0', diagtype: '1' }],
    []
  );
  assert.ok(cats.includes('ANC'));
});

test('Pttype Group: classifies UC, SSS, OFC, LGO, CASH properly', () => {
  assert.equal(classifyPttypeGroup('UC', 'UCS', 'บัตรทอง'), 'UC');
  assert.equal(classifyPttypeGroup('SS', 'SSS', 'ประกันสังคมมาตรา 33'), 'SSS');
  assert.equal(classifyPttypeGroup('OF', 'OFC', 'ข้าราชการจ่ายตรง'), 'OFC');
  assert.equal(classifyPttypeGroup('LG', 'LGO', 'อปท.เบิกจ่ายตรง'), 'LGO');
  assert.equal(classifyPttypeGroup('AA', '', 'ชำระเงินเอง'), 'CASH');
});

test('Dental Audit: scaling with caries as PDX flags C-804-SCALING with ADD_K051', () => {
  const result = evaluateDentalVisitAudit({
    vn: '670101001',
    hn: '000001',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K02.1', diagtype: '1' }],
    procedures: [{ code: '96.54', type: 'Dental' }],
    chargeItems: [{ icode: '30009', sum_price: 300, income: '13' }],
  });

  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-SCALING');
  assert.ok(issue, 'Should find C-804-SCALING');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'ADD_K051');
  assert.equal(result.can_auto_fix, true);
});

test('Dental Audit: filling without caries flags C-804-FILLING with ADD_K021', () => {
  const result = evaluateDentalVisitAudit({
    vn: '670101002',
    hn: '000002',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K05.1', diagtype: '1' }],
    procedures: [{ code: '23.2', type: 'Dental' }],
    chargeItems: [{ icode: '30010', sum_price: 400, income: '13' }],
  });

  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-FILLING');
  assert.ok(issue, 'Should find C-804-FILLING');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'ADD_K021');
});

test('Dental Audit: impaction removal without K01 flags C-804-IMPACTED with ADD_K011', () => {
  const result = evaluateDentalVisitAudit({
    vn: '670101003',
    hn: '000003',
    service_date: '2024-10-15',
    diagnoses: [{ code: 'K02.1', diagtype: '1' }],
    procedures: [{ code: '23.19', type: 'Dental' }],
    chargeItems: [{ icode: '30012', sum_price: 600, income: '13' }],
  });

  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-804-IMPACTED');
  assert.ok(issue, 'Should find C-804-IMPACTED');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'ADD_K011');
});

test('Dental Audit: Z01.2 as PDX during active filling flags C-800-Z012-PDX with SWAP_Z012', () => {
  const result = evaluateDentalVisitAudit({
    vn: '670101004',
    hn: '000004',
    service_date: '2024-10-15',
    diagnoses: [
      { code: 'Z01.2', diagtype: '1' },
      { code: 'K02.1', diagtype: '2' },
    ],
    procedures: [{ code: '23.2', type: 'Dental' }],
    chargeItems: [{ icode: '30010', sum_price: 400, income: '13' }],
  });

  assert.equal(result.audit_status, 'critical');
  const issue = result.issues.find((i) => i.code === 'C-800-Z012-PDX');
  assert.ok(issue, 'Should find C-800-Z012-PDX');
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.fixAction, 'SWAP_Z012');
});

test('Dental Audit: completely missing diagnosis flags C-MISSING-PDX and C-800-NO-DENTAL-DX with ADD_DENTAL_PDX', () => {
  const result = evaluateDentalVisitAudit({
    vn: '670101005',
    hn: '000005',
    service_date: '2024-10-15',
    diagnoses: [],
    procedures: [{ code: '2330010', type: 'Dental' }],
    chargeItems: [{ icode: '3000047', sum_price: 100, income: '13' }],
  });

  assert.equal(result.audit_status, 'critical');
  assert.ok(result.issues.some((i) => i.code === 'C-MISSING-PDX' && i.fixAction === 'ADD_DENTAL_PDX'));
  assert.ok(result.issues.some((i) => i.code === 'C-800-NO-DENTAL-DX' && i.fixAction === 'ADD_DENTAL_PDX'));
  assert.ok(result.auto_fix_actions.includes('ADD_DENTAL_PDX'));
});

test('Dental Audit: male patient with 2330010 (oral exam) does NOT flag ANC issue', () => {
  const result = evaluateDentalVisitAudit({
    vn: '670101006',
    hn: '000006',
    sex: '1', // Male
    service_date: '2024-10-15',
    diagnoses: [{ code: 'Z01.2', diagtype: '1' }],
    procedures: [{ code: '2330010', type: 'Dental', name: 'ตรวจสุขภาพช่องปาก' }],
    chargeItems: [{ icode: '3000047', sum_price: 100, income: '13' }],
  });

  assert.equal(result.audit_status, 'valid');
  assert.equal(result.issues.find((i) => i.code === 'C-808-ANC-PROC-MIXED'), undefined);
});
