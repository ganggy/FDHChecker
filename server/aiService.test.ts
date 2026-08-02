import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReportPayload } from './aiService.js';

test('accepts a small aggregate report', () => {
  const input = { title: 'ยอดแยกตามกองทุน', rows: [{ fund: 'UCS', total: 120 }] };
  assert.equal(validateReportPayload(input), input);
});

test('accepts patient-level fields for authenticated workflows', () => {
  const input = { title: 'รายงาน', rows: [{ hn: '000001', vn: '1234', cid: '1234567890123' }] };
  assert.equal(validateReportPayload(input), input);
});

test('rejects more than the configured aggregate row limit', () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ department: index, total: 1 }));
  assert.throws(() => validateReportPayload({ title: 'รายงาน', rows }), /limit of 50 rows/i);
});
