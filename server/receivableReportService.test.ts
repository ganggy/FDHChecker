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
});

test('DEBTOR_METADATA contains required standard accounts', () => {
  assert.ok(DEBTOR_METADATA['1102050101.201']);
  assert.equal(DEBTOR_METADATA['1102050101.201'].register, 'รายสิทธิ');
  assert.ok(DEBTOR_METADATA['1102050101.401']);
  assert.ok(DEBTOR_METADATA['1102050102.801']);
});
