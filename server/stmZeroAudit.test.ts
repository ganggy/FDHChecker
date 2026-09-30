import test from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitZero, originalPaidAmount, classifyZeroAction, canPrepareZeroResend, resolveUniqueRepVisit, type StmZeroRow } from '../src/utils/stmZeroAudit.js';
const row = { matched: true, has_payment: false, paid_amount: 0, action: 'review', errorcode: '', verifycode: '', maininscl: '', raw_data: {} } as StmZeroRow;
test('blank and missing payments are not zero', () => {
  for (const value of [null, undefined, '', ' ', 'invalid', 0.01]) assert.equal(isExplicitZero(value), false);
  assert.equal(isExplicitZero('0.00'), true);
  assert.equal(originalPaidAmount({ paid_amount: '' }), null);
  assert.equal(originalPaidAmount({ ชดเชยสุทธิ: '0' }), 0);
});
test('guidance distinguishes approval, appeal, correction and deferred payout', () => {
  for (const [code, action] of [['W305', 'approval'], ['D305', 'approval'], ['D001', 'appeal'], ['D011', 'correction'], ['D012', 'appeal']]) {
    assert.equal(classifyZeroAction({ ...row, errorcode: code }), action);
  }
  assert.equal(classifyZeroAction({ ...row, maininscl: 'HERB_GB' }), 'deferred');
  assert.equal(classifyZeroAction({ ...row, has_payment: true }), 'paid');
});
test('unmatched, unknown payments, paid visits and appeal queues cannot prepare resend', () => {
  assert.equal(canPrepareZeroResend(row), true);
  for (const change of [{ matched: false }, { paid_amount: null }, { has_payment: true }, { payment_uncertain: true }, { action: 'appeal' as const }, { action: 'approval' as const }, { action: 'deferred' as const }]) {
    assert.equal(canPrepareZeroResend({ ...row, ...change }), false);
  }
});
test('TRAN_ID matching requires same HN and one distinct encounter', () => {
  const a = { tran_id: 'DEMO-T', hn: 'DEMO-H', vn: 'DEMO-V', an: '' };
  assert.deepEqual(resolveUniqueRepVisit('DEMO-H', 'DEMO-T', [a, a]), { vn: 'DEMO-V', an: '' });
  assert.equal(resolveUniqueRepVisit('OTHER-H', 'DEMO-T', [a]), null);
  assert.equal(resolveUniqueRepVisit('', 'DEMO-T', [a]), null);
  assert.equal(resolveUniqueRepVisit('DEMO-H', 'DEMO-T', [a, { ...a, vn: 'OTHER-V' }]), null);
});
