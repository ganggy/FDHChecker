import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOpdCountAnswer, parsePatientReportIntent } from './aiReportTools.js';

const now = new Date('2026-08-02T05:00:00.000Z');

test('recognizes a Thai question asking for today OPD patient count', () => {
  assert.deepEqual(parsePatientReportIntent('วันนี้คนไข้ OPD กี่คน', now), {
    kind: 'opd-count',
    date: '2026-08-02',
  });
});

test('accepts a Thai Buddhist calendar date', () => {
  assert.deepEqual(parsePatientReportIntent('ผู้ป่วยนอกทั้งหมดวันที่ 01/08/2569', now), {
    kind: 'opd-count',
    date: '2026-08-01',
  });
});

test('does not route a general OPD guidance question to the database', () => {
  assert.equal(parsePatientReportIntent('อธิบายขั้นตอนตรวจสอบ OPD', now), null);
});

test('formats unique patients and visits without asking the model to calculate', () => {
  const answer = formatOpdCountAnswer({
    date: '2026-08-02',
    uniquePatients: 120,
    visits: 125,
  });
  assert.match(answer, /120/);
  assert.match(answer, /125/);
  assert.match(answer, /VN/);
});
