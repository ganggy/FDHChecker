import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnitCostReport, getCostOverrides, saveCostOverride } from './unitCostService.js';

test('getUnitCostReport returns valid structure for TTM department', async () => {
  const report = await getUnitCostReport({
    department: 'ttm',
    facility: '11101',
    category: 'all',
    fund: 'ALL',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });

  assert.equal(report.department, 'ttm');
  assert.equal(report.facility, '11101');
  assert.ok(typeof report.summary.totalRevenue === 'number');
  assert.ok(typeof report.summary.totalCost === 'number');
  assert.ok(typeof report.summary.netProfit === 'number');
  assert.ok(typeof report.summary.marginPct === 'number');
  assert.ok(Array.isArray(report.items));
  assert.ok(Array.isArray(report.fundBreakdown));
  assert.ok(Array.isArray(report.monthlyTrend));

  // Check item fields
  if (report.items.length > 0) {
    const item = report.items[0];
    assert.ok(item.icode);
    assert.ok(item.name);
    assert.ok(typeof item.totalRevenue === 'number');
    assert.ok(typeof item.totalCost === 'number');
    assert.ok(typeof item.netProfit === 'number');
  }
});
