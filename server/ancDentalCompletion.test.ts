import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAncDentalCompletion, type AncDentalCompletionSnapshot } from './ancDentalCompletion.js';

const base = (overrides: Partial<AncDentalCompletionSnapshot> = {}): AncDentalCompletionSnapshot => ({
  kind: 'exam', vn: '690000000001', hn: '000001', serviceDate: '2026-09-10', sex: '2',
  hasAncDiagnosis: true, hasAdp: false, hasDentalCareRecord: true,
  procedures: [{ tmNo: '1', tmCode: 'D01', procedureCode: '2330011', icd9: '' }],
  catalogItems: [{ icode: '3000010', name: 'ANC ตรวจฟัน', unitprice: 100, income: '17', usageCount: 50 }],
  ...overrides,
});

test('ANC dental exam completion selects the hospital catalog item and repairs the ICD-9 pair', () => {
  const result = assessAncDentalCompletion(base());
  assert.equal(result.canComplete, true);
  assert.equal(result.ready, false);
  assert.equal(result.selectedCatalogItem?.icode, '3000010');
  assert.equal(result.selectedProcedure?.tmCode, 'D01');
  assert.deepEqual(result.missing, ['ADP 30008', 'ICD10TM 2330011/2330010 + ICD-9 8931']);
});

test('ANC dental cleaning is ready only with ADP 30009 and procedure 2387010 paired with ICD-9 9654', () => {
  const result = assessAncDentalCompletion(base({
    kind: 'clean', hasAdp: true,
    procedures: [{ tmNo: '2', tmCode: 'D02', procedureCode: '2387010', icd9: '96.54' }],
  }));
  assert.equal(result.ready, true);
  assert.equal(result.canComplete, false);
  assert.deepEqual(result.missing, []);
});

test('completion blocks when the visit has no existing dental service evidence', () => {
  const result = assessAncDentalCompletion(base({ hasAdp: false, procedures: [] }));
  assert.equal(result.canComplete, false);
  assert.match(result.blockers.join(' '), /ไม่พบหลักฐานบริการ/);
  assert.match(result.blockers.join(' '), /ไม่พบหัตถการ/);
});

test('completion blocks non-female visits and visits without an ANC diagnosis', () => {
  const result = assessAncDentalCompletion(base({ sex: '1', hasAncDiagnosis: false }));
  assert.equal(result.canComplete, false);
  assert.match(result.blockers.join(' '), /ผู้ป่วยหญิง/);
  assert.match(result.blockers.join(' '), /Z34\/Z35/);
});
