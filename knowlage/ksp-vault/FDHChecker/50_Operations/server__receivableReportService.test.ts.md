---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/receivableReportService.test.ts"
source_hash: "3c7a17c9f92cd10947f371e4411f3f1fb13bc08f04780d54197b1fc80e0b0690"
managed_by: "sync-ksp-vault"
---
# receivableReportService.test.ts

> Source: `server/receivableReportService.test.ts`
> SHA-256: `3c7a17c9f92cd10947f371e4411f3f1fb13bc08f04780d54197b1fc80e0b0690`

````typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDebtorForPttype, DEBTOR_METADATA } from './receivableReportService.js';

test('resolveDebtorForPttype maps known HOSxP pttypes to correct debtors and metadata', () => {
  // Pttype 10 -> ชำระเงิน OP
  const pttype10 = resolveDebtorForPttype('10', false);
  assert.equal(pttype10.debtorCode, '1102050102.106');
  assert.equal(pttype10.controlRegister, 'รายตัว');

  // Pttype 77 -> UC-OP ใน CUP
  const pttype77 = resolveDebtorForPttype('77', false);
  assert.equal(pttype77.debtorCode, '1102050101.201');
  assert.equal(pttype77.recognition, 'ตัดด้วยเงินกองทุน');
  assert.equal(pttype77.controlRegister, 'รายสิทธิ');

  // Pttype 31 -> ประกันสังคม กองทุนทดแทน (ทันตกรรม)
  const pttype31 = resolveDebtorForPttype('31', false);
  assert.equal(pttype31.debtorCode, '1102050101.307');
  assert.equal(pttype31.recognition, 'เฉพาะทันตกรรม');
  assert.equal(pttype31.controlRegister, 'รายสิทธิ');

  // Pttype 30 (IPD) -> กรมบัญชีกลาง IP
  const pttype30Ipd = resolveDebtorForPttype('30', true);
  assert.equal(pttype30Ipd.debtorCode, '1102050101.402');
  assert.equal(pttype30Ipd.controlRegister, 'รายตัว');

  // Pttype 77 (IPD) -> UC-IP ใน CUP
  const pttype77Ipd = resolveDebtorForPttype('77', true);
  assert.equal(pttype77Ipd.debtorCode, '1102050101.202');
  assert.equal(pttype77Ipd.controlRegister, 'รายสิทธิ');
});

test('DEBTOR_METADATA contains required standard accounts', () => {
  assert.ok(DEBTOR_METADATA['1102050101.201']);
  assert.equal(DEBTOR_METADATA['1102050101.201'].register, 'รายสิทธิ');
  assert.ok(DEBTOR_METADATA['1102050101.401']);
  assert.ok(DEBTOR_METADATA['1102050102.801']);
});

````
