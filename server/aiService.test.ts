import assert from 'node:assert/strict';
import test from 'node:test';
import { containsPatientIdentifier, validateReportPayload } from './aiService.js';

test('accepts a small aggregate report', () => {
  const input = { title: 'ยอดแยกตามกองทุน', rows: [{ fund: 'UCS', total: 120 }] };
  assert.equal(validateReportPayload(input), input);
});

test('rejects patient identifiers in report rows', () => {
  assert.throws(
    () => validateReportPayload({ title: 'รายงาน', rows: [{ hn: '000001', total: 1 }] }),
    /sensitive patient field/i,
  );
});

test('rejects nested identifiers and identifier values', () => {
  assert.throws(
    () => validateReportPayload({ title: 'รายงาน', rows: [{ detail: { cid: '1234567890123' } }] }),
    /sensitive patient field/i,
  );
  assert.equal(containsPatientIdentifier('ช่วยดู HN 000123 ให้หน่อย'), true);
  assert.equal(containsPatientIdentifier('สรุปจำนวนผู้รับบริการรายเดือน'), false);
});

test('rejects more than the configured aggregate row limit', () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ department: index, total: 1 }));
  assert.throws(() => validateReportPayload({ title: 'รายงาน', rows }), /limit of 50 rows/i);
});
