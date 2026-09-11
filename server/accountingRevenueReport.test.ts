import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateRevenueRows, classifyRevenueRight } from './accountingRevenueReport.js';

test('classifies known accounting right groups from the receivable mapping', () => {
  assert.equal(classifyRevenueRight({ pttype: '20' }).key, 'agency');
  assert.equal(classifyRevenueRight({ pttype: '21' }).key, 'local');
  assert.equal(classifyRevenueRight({ pttype: '31' }).key, 'sss');
  assert.equal(classifyRevenueRight({ pttype: '23' }).key, 'migrant');
  assert.equal(classifyRevenueRight({ pttype: '11' }).key, 'uc');
});

test('uses hospital hipdata codes and preserves source totals', () => {
  const rows = aggregateRevenueRows([
    { pttype: 'X1', pttype_name: 'สิทธิท้องถิ่น', hipdata_code: 'LGO', service_count: 3, actual_charge: 900 },
    { pttype: 'X2', pttype_name: 'สิทธิที่ยังไม่จับคู่', service_count: 2, actual_charge: 100, adjrw: 1.25 },
  ], 'ipd');
  assert.equal(rows.find((row) => row.key === 'local')?.service_count, 3);
  assert.equal(rows.find((row) => row.key === 'other')?.service_count, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.service_count, 0), 5);
  assert.equal(rows.reduce((sum, row) => sum + row.actual_charge, 0), 1000);
  assert.equal(rows.reduce((sum, row) => sum + row.adjrw, 0), 1.25);
});
