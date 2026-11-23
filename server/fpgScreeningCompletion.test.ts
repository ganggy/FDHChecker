import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessFpgScreeningCompletion,
  normalizeFpgDiagCode,
  type FpgScreeningCompletionSnapshot,
} from './fpgScreeningCompletion.js';

const baseSnapshot = (overrides: Partial<FpgScreeningCompletionSnapshot> = {}): FpgScreeningCompletionSnapshot => ({
  vn: '691120000001',
  hn: '000000001',
  serviceDate: '2026-11-20',
  age: 45,
  ageEligible: true,
  hasFpgLab: true,
  noDmDiag: true,
  hasFpgDiag: false,
  hasFpgAdp: false,
  catalogItems: [{ icode: '3000123', name: 'คัดกรองเบาหวาน FPG', unitprice: 50, income: '07', usageCount: 120 }],
  ...overrides,
});

test('allows auto-completion when conditions 1+2+3 are met and Z131 + ADP 12003 are missing', () => {
  const result = assessFpgScreeningCompletion(baseSnapshot());
  assert.equal(result.ready, false);
  assert.equal(result.canComplete, true);
  assert.deepEqual(result.missing, ['Diagnosis Z131/Z133/Z136', 'ADP 12003']);
  assert.deepEqual(result.blockers, []);
});

test('blocks auto-completion when visit has diabetes diagnosis (E100-E149)', () => {
  const result = assessFpgScreeningCompletion(baseSnapshot({ noDmDiag: false }));
  assert.equal(result.canComplete, false);
  assert.ok(result.blockers.some((b) => b.includes('E100-E149')));
});

test('blocks auto-completion when age is outside 35-59 or FPG/FBS lab is missing', () => {
  const wrongAge = assessFpgScreeningCompletion(baseSnapshot({ age: 30, ageEligible: false }));
  assert.equal(wrongAge.canComplete, false);
  assert.ok(wrongAge.blockers.some((b) => b.includes('35-59')));

  const noLab = assessFpgScreeningCompletion(baseSnapshot({ hasFpgLab: false }));
  assert.equal(noLab.canComplete, false);
  assert.ok(noLab.blockers.some((b) => b.includes('Lab FPG/FBS')));
});

test('blocks auto-completion when ADP 12003 is missing and hospital catalog has no 12003 item', () => {
  const result = assessFpgScreeningCompletion(baseSnapshot({ catalogItems: [] }));
  assert.equal(result.canComplete, false);
  assert.ok(result.blockers.some((b) => b.includes('12003')));
});

test('marks visit ready when all 5 conditions are already satisfied', () => {
  const result = assessFpgScreeningCompletion(baseSnapshot({ hasFpgDiag: true, hasFpgAdp: true }));
  assert.equal(result.ready, true);
  assert.equal(result.canComplete, false);
  assert.deepEqual(result.missing, []);
});

test('normalizes FPG diagnosis code safely to Z131/Z133/Z136', () => {
  assert.equal(normalizeFpgDiagCode('z13.1'), 'Z131');
  assert.equal(normalizeFpgDiagCode('Z133'), 'Z133');
  assert.equal(normalizeFpgDiagCode('z13.6'), 'Z136');
  assert.equal(normalizeFpgDiagCode('E119'), 'Z131');
});
