import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSssCandidate } from './sssClaim.js';

const valid = {
  cid: '1234567890123', pdx: 'I10', clinic: '01', hospmain: '11101', income: 100,
  charge_total: 100, charge_mismatch_count: 0, missing_bill_group_count: 0,
  missing_item_name_count: 0, mixed_hn_count: 0, visit_outcome: 'กลับบ้าน',
  doctor_license: 'ว12345', missing_drug_usage_count: 0, missing_tmlt_count: 0,
  end_datetime: '2026-08-07 10:00:00', right_begin_date: '2026-01-01', right_expire_date: '2026-12-31',
};

test('SSS candidate passes without any NHSO close-right field', () => {
  assert.deepEqual(evaluateSssCandidate(valid), []);
});

test('SSS candidate blocks invalid patient, diagnosis and charge data', () => {
  const issues = evaluateSssCandidate({ ...valid, cid: '', pdx: '', income: 0, missing_bill_group_count: 1 });
  assert.deepEqual(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code), [
    'SSS-PAT01', 'SSS-DX01', 'SSS-CHG01', 'SSS-CHG02', 'SSS-CHG03',
  ]);
});

test('SSS candidate keeps documentation gaps as warnings', () => {
  const issues = evaluateSssCandidate({ ...valid, doctor_license: '', missing_drug_usage_count: 1, missing_tmlt_count: 1 });
  assert.deepEqual(issues.map((issue) => issue.code), ['SSS-DOC01', 'SSS-DRU01', 'SSS-LAB01']);
  assert.ok(issues.every((issue) => issue.severity === 'warning'));
});
