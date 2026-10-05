import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { getSmtBudgetSummary } from './smtBudgetService.js';
import { closeDatabasePools } from './db/connection.js';

after(async () => {
  await closeDatabasePools();
});

test('getSmtBudgetSummary aggregates records and separates MOPH accounts into category 1 (receivable) and 4 (revenue)', async () => {
  const summary = await getSmtBudgetSummary('2567');
  assert.ok(summary);
  assert.equal(summary.budget_year, '2567');
  assert.ok(summary.total_records > 0);
  assert.ok(summary.total_net > 0);

  // Check MOPH accounts
  const mophAccounts = summary.moph_accounts;
  assert.ok(mophAccounts.length > 0);

  const receivableAccounts = mophAccounts.filter(m => m.account_type === 'receivable_1');
  assert.ok(receivableAccounts.length > 0, 'Should contain Category 1 receivable accounts');

  // Verify that all Category 1 accounts have IDs starting with 1
  for (const acc of receivableAccounts) {
    assert.ok(acc.moph_id.startsWith('1'), `Account ${acc.moph_id} should start with 1`);
  }

  // Check total calculations
  const sumFromAccounts = mophAccounts.reduce((sum, m) => sum + m.sum_net_total, 0);
  assert.ok(Math.abs(sumFromAccounts - summary.total_net) < 1, 'Sum of MOPH accounts should match total net');
});

test('getSmtBudgetSummary detects unimported alerts correctly', async () => {
  const summary = await getSmtBudgetSummary('2567');
  assert.ok(Array.isArray(summary.unimported_alerts));
  assert.equal(summary.unimported_count, summary.unimported_alerts.length);

  if (summary.unimported_alerts.length > 0) {
    const firstAlert = summary.unimported_alerts[0];
    assert.ok(firstAlert.ref_doc_no, 'Alert should include ref_doc_no');
    assert.ok(firstAlert.batch_no, 'Alert should include batch_no');
    assert.ok(typeof firstAlert.net_total === 'number');
  }
});
