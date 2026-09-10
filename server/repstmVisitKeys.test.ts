import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStatementVisitKeys } from './repstmVisitKeys.js';

test('uses the real VN when legacy matched_visit_code contains a statement number', () => {
  assert.deepEqual(resolveStatementVisitKeys({
    vn: '690702145241',
    matched_visit_code: '690700015',
    tran_id: '793460707',
  }), ['690702145241']);
});

test('uses a REP transaction match before legacy matched_visit_code', () => {
  const transactionToVisit = new Map([['793460707', '690702145241']]);
  assert.deepEqual(resolveStatementVisitKeys({
    matched_visit_code: '690700015',
    tran_id: '793460707',
  }, transactionToVisit), ['690702145241']);
});

test('keeps matched_visit_code as a fallback for rows without verified identifiers', () => {
  assert.deepEqual(resolveStatementVisitKeys({ matched_visit_code: '690702145241' }), ['690702145241']);
});
