---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/mophVaccineRules.test.ts"
source_hash: "9da4bb6f438849bef5b3155caf7ac4c9fe1e0fa9b0ba900c24dd6c84de199531"
managed_by: "sync-ksp-vault"
---
# mophVaccineRules.test.ts

> Source: `server/mophVaccineRules.test.ts`
> SHA-256: `9da4bb6f438849bef5b3155caf7ac4c9fe1e0fa9b0ba900c24dd6c84de199531`

````typescript
import assert from 'node:assert';
import test from 'node:test';
import {
  AP_VACCINE_RULE_EFFECTIVE_DATE,
  getApVaccineRule,
  validateApVaccineEligibility,
} from './mophVaccineRules.js';

const validate = (serviceDate: string, ga: number, pregNo = 1) => validateApVaccineEligibility({
  vaccineCode: 'P41',
  serviceDate,
  pregNo,
  ga,
});

test('aP keeps the legacy GA 27-36 rule for visits before 5 June 2026', () => {
  assert.match(validate('2026-06-04', 26), /27–36/);
  assert.equal(validate('2026-06-04', 27), '');
  assert.equal(validate('2026-06-04', 36), '');
  assert.match(validate('2026-06-04', 37), /27–36/);
});

test('aP uses GA 16 weeks or more from the effective visit date', () => {
  assert.equal(AP_VACCINE_RULE_EFFECTIVE_DATE, '2026-06-05');
  assert.match(validate('2026-06-05', 15), /16 สัปดาห์ขึ้นไป/);
  assert.equal(validate('2026-06-05', 16), '');
  assert.equal(validate('2026-07-01', 40), '');
  assert.equal(getApVaccineRule('2026-06-05').maximumGaWeek, null);
});

test('aP rejects missing visit, gravida, and GA data', () => {
  assert.match(validateApVaccineEligibility({ vaccineCode: 'P41', pregNo: 1, ga: 20 }), /วันที่รับบริการ/);
  assert.match(validateApVaccineEligibility({ vaccineCode: 'P41', serviceDate: '2026-06-05', ga: 20 }), /ครรภ์ที่/);
  assert.match(validateApVaccineEligibility({ vaccineCode: 'P41', serviceDate: '2026-06-05', pregNo: 1 }), /อายุครรภ์/);
});

test('the aP rule does not affect other vaccine codes', () => {
  assert.equal(validateApVaccineEligibility({ vaccineCode: '106' }), '');
});

````
