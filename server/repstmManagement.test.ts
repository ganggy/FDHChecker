import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedRepstmBatchConfirmation,
  normalizeRepstmSearchFilters,
  validateRepstmBatchDeletion,
} from './repstmManagement.js';

test('normalizes REP/STM management search filters and bounds pagination', () => {
  assert.deepEqual(normalizeRepstmSearchFilters({ dataType: 'stm', q: '  HN001  ', page: -2, pageSize: 900 }), {
    dataType: 'STM',
    query: 'HN001',
    page: 1,
    pageSize: 100,
    includeReplaced: false,
  });
});

test('batch deletion requires confirmation containing the exact batch id', () => {
  assert.equal(expectedRepstmBatchConfirmation(18), 'DELETE BATCH #18');
  assert.equal(validateRepstmBatchDeletion(18, { reason: 'นำเข้าผิดชุด', confirmation: 'DELETE BATCH #18' }).valid, true);
  assert.equal(validateRepstmBatchDeletion(18, { reason: 'นำเข้าผิดชุด', confirmation: 'DELETE BATCH #19' }).valid, false);
});
