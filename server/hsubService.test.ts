import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  getHsubDashboardSummary,
  getHsubTransactions,
  getHsubBatches,
} from './hsubService.js';
import { closeDatabasePools } from './db/connection.js';

after(async () => {
  await closeDatabasePools();
});

test('getHsubDashboardSummary calculates CUP hospital allocations and fund categories', async () => {
  const summary = await getHsubDashboardSummary();
  assert.ok(summary, 'Summary should exist');
  assert.ok(summary.total_records > 0, 'Should have imported records');
  assert.ok(summary.total_paid > 0, 'Total paid should be greater than 0');
  assert.ok(summary.hospitals.length >= 5, 'Should include at least 5 CUP sub-centers');

  // Verify sub-centers codes
  const expectedCodes = ['05569', '05570', '05571', '05572', '05573'];
  const hospitalCodes = summary.hospitals.map((h) => h.hcode);
  for (const code of expectedCodes) {
    assert.ok(hospitalCodes.includes(code), `Should contain sub-center HCODE ${code}`);
  }

  // Verify that the sum of hospital allocations equals total_paid
  const sumHospitalPaid = summary.hospitals.reduce((acc, h) => acc + h.total_paid, 0);
  assert.ok(
    Math.abs(sumHospitalPaid - summary.total_paid) < 0.1,
    'Sum of hospital allocations must match overall total_paid'
  );

  // Check fund categories breakdown
  assert.ok(summary.fund_categories.length > 0, 'Should have fund categories breakdown');
  const hcDrugCat = summary.fund_categories.find((c) => c.category_key === 'hc_drug');
  assert.ok(hcDrugCat, 'Should contain Home Care drug category');
  assert.ok(hcDrugCat.total_amount > 0, 'Home care drug amount should be > 0');

  // Check eBudget reconciliation matches
  assert.ok(Array.isArray(summary.ebudget_matches), 'ebudget_matches should be an array');
  assert.ok(summary.ebudget_matches.length > 0, 'Should have matched REP statements');
});

test('getHsubTransactions returns paginated patient items with filtering', async () => {
  const page1 = await getHsubTransactions({ page: 1, limit: 10 });
  assert.ok(page1);
  assert.equal(page1.rows.length, 10);
  assert.ok(page1.total > 0);

  const firstItem = page1.rows[0];
  assert.ok(firstItem.tran_id, 'Item must have tran_id');
  assert.ok(firstItem.rep, 'Item must have rep');
  assert.ok(firstItem.hcode, 'Item must have hcode');

  // Test filter by specific hcode (e.g. 05570)
  const filtered = await getHsubTransactions({ hcode: '05570', page: 1, limit: 20 });
  assert.ok(filtered.rows.length > 0);
  for (const row of filtered.rows) {
    assert.equal(row.hcode, '05570', 'All filtered items should belong to 05570');
  }
});

test('getHsubBatches returns imported file batches metadata', async () => {
  const batches = await getHsubBatches();
  assert.ok(Array.isArray(batches));
  assert.ok(batches.length > 0, 'Should return imported batch records');
  assert.ok(batches[0].filename.endsWith('.xls'), 'Filename should be an excel report');
  assert.ok(batches[0].total_records > 0);
});
