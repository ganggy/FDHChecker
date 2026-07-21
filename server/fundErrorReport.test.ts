import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyFundLineMessages, chunkLineText, formatFundErrorReport, getFundMissingConditions } from './fundErrorReport.js';

test('knee report identifies missing procedures', () => {
  const missing = getFundMissingConditions('knee', {
    age_y: 61, has_knee_diag_m17: 'Y', has_knee_diag_u5753: 'Y',
    has_knee_massage_thigh: 'Y', has_knee_massage_knee: 'N',
    has_knee_massage_lower_leg: 'Y', has_knee_poultice: 'N', knee_poultice_14d_count: 0,
  });
  assert.deepEqual(missing, ['หัตถการ 873-78-11', 'หัตถการ 873-78-35']);
});

test('formatted report contains HN but no patient identity fields', () => {
  const report = formatFundErrorReport([{ id: 'knee', name: 'ยาพอกเข่า', checked: 1, errors: [{ hn: '0001', serviceDate: '2026-07-21', missing: ['หัตถการ'] }] }], '2026-07-21', '2026-07-21');
  assert.match(report, /HN 0001/);
  assert.doesNotMatch(report, /patientName|cid/i);
});

test('LINE chunks stay below configured length', () => {
  const chunks = chunkLineText(Array.from({ length: 20 }, (_, index) => `${index} ${'x'.repeat(30)}`).join('\n'), 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
});

test('daily LINE report separates summary and each error fund', () => {
  const messages = buildDailyFundLineMessages([
    { id: 'a', name: 'กองทุน A', checked: 2, errors: [{ hn: '001', serviceDate: '2026-07-21', missing: ['ADP'] }] },
    { id: 'b', name: 'กองทุน B', checked: 0, errors: [] },
    { id: 'c', name: 'กองทุน C', checked: 1, errors: [{ hn: '002', serviceDate: '2026-07-21', missing: ['Diagnosis'] }] },
  ], '2026-07-21');
  assert.equal(messages.length, 3);
  assert.match(messages[0], /วันที่ 2026-07-21/);
  assert.match(messages[1], /^❌ กองทุน A/);
  assert.match(messages[2], /^❌ กองทุน C/);
  assert.ok(messages.every((message) => !message.includes('กองทุน B')));
});

test('large fund is split without mixing another fund', () => {
  const errors = Array.from({ length: 8 }, (_, index) => ({ hn: String(index), serviceDate: '2026-07-21', missing: ['รายการยาที่มีรายละเอียดค่อนข้างยาว'] }));
  const messages = buildDailyFundLineMessages([{ id: 'a', name: 'กองทุน A', checked: 8, errors }], '2026-07-21', 120);
  assert.ok(messages.length > 2);
  assert.ok(messages.slice(1).every((message) => message.startsWith('❌ กองทุน A')));
  assert.ok(messages.every((message) => message.length <= 120));
});

test('unfinished hepatitis B and C funds are excluded from the daily report', async () => {
  const { REPORT_FUNDS } = await import('./fundErrorReport.js');
  assert.equal(REPORT_FUNDS.some((fund) => fund.id === 'hepb' || fund.id === 'hepc'), false);
});
