import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSettlementJournal, classifyMatchLevel } from './receivableSettlementService.js';

test('classifyMatchLevel ranks exact > strong > weak > none', () => {
  assert.equal(classifyMatchLevel({ tran_id: 'T1', hn: 'H1', service_date: '2026-01-01' }), 'exact');
  assert.equal(classifyMatchLevel({ hn: 'H1', vn: 'V1' }), 'strong');
  assert.equal(classifyMatchLevel({ hn: 'H1', an: 'A1' }), 'strong');
  assert.equal(classifyMatchLevel({ cid: 'C1', service_date: '2026-01-01' }), 'weak');
  assert.equal(classifyMatchLevel({}), 'none');
  assert.equal(classifyMatchLevel({ tran_id: 'T1', hn: 'H1', service_date: '2026-01-01', mapping_known: false }), 'none');
});

test('buildSettlementJournal credits each debtor account separately and balances', () => {
  const { entries, isBalanced } = buildSettlementJournal([
    { debtor_code: 'DEMO-DEBTOR-A', claimable_amount: 100, paid_amount: 80, diff_amount: -20 },
    { debtor_code: 'DEMO-DEBTOR-B', claimable_amount: 50, paid_amount: 60, diff_amount: 10 },
    { debtor_code: 'DEMO-DEBTOR-A', claimable_amount: 30, paid_amount: 30, diff_amount: 0 },
  ]);
  assert.equal(isBalanced, true);
  const credit = (code: string) => entries.find(e => e.type === 'CREDIT' && e.account_code === code)?.amount;
  assert.equal(credit('DEMO-DEBTOR-A'), 130);
  assert.equal(credit('DEMO-DEBTOR-B'), 50);
  assert.equal(entries.find(e => e.type === 'DEBIT' && e.account_code === '1101010104.101')?.amount, 170);
  assert.equal(entries.filter(e => e.type === 'CREDIT').length, 3);
});
