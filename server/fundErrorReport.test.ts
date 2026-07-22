import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyFundLineMessages, chunkLineText, formatFundErrorReport, getFundMissingConditions, isFundReportEligible } from './fundErrorReport.js';

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

test('ANC ultrasound LINE rule matches the web actionable-status rule', () => {
  const ancVisitOnly = getFundMissingConditions('anc_ultrasound', {
    sex: '2', has_anc_diag: 'Y', has_anc_us: 'N', has_anc_us_proc: 'N', anc_adp_codes: '30011',
  });
  assert.deepEqual(ancVisitOnly, []);

  const procedureWithoutAdp = getFundMissingConditions('anc_ultrasound', {
    sex: '2', has_anc_diag: 'Y', has_anc_us: 'N', has_anc_us_proc: 'Y', anc_adp_codes: '30011',
  });
  assert.deepEqual(procedureWithoutAdp, ['ADP 30010']);

  const adpWithoutProcedure = getFundMissingConditions('anc_ultrasound', {
    sex: '2', has_anc_diag: 'Y', has_anc_us: 'Y', has_anc_us_proc: 'N', anc_adp_codes: '30010',
  });
  assert.deepEqual(adpWithoutProcedure, ['Ultrasound ANC']);
});

test('near-match funds do not alert until the web considers the visit actionable', () => {
  const cases: Array<{ fund: string; row: Record<string, unknown>; expected: string[] }> = [
    {
      fund: 'preg_test',
      row: { has_preg_diag: 'Y', has_preg_lab: 'N', has_preg_item: 'N' },
      expected: [],
    },
    {
      fund: 'preg_test',
      row: { has_preg_diag: 'Y', has_preg_lab: 'Y', has_preg_item: 'N' },
      expected: ['ADP 30014'],
    },
    {
      fund: 'anc_lab_1',
      row: { sex: '2', has_anc_diag: 'Y', has_anc_lab1: 'N' },
      expected: [],
    },
    {
      fund: 'anc_dental_exam',
      row: { sex: '2', has_anc_diag: 'Y', has_anc_dental_exam: 'N', pdx: 'Z340' },
      expected: [],
    },
    {
      fund: 'fpg_screening',
      row: { age_eligible: 'Y', has_fpg_lab: 'Y', has_fpg_diag: 'N', has_fpg_adp: 'N' },
      expected: [],
    },
    {
      fund: 'fpg_screening',
      row: { age_eligible: 'Y', has_fpg_lab: 'Y', has_fpg_diag: 'Y', has_fpg_adp: 'N' },
      expected: ['ADP 12003'],
    },
    {
      fund: 'postnatal_supplements',
      row: { sex: '2', has_post_supp_diag: 'Y', has_post_iron_med: 'N', has_post_supp: 'N' },
      expected: [],
    },
  ];

  for (const item of cases) {
    assert.deepEqual(getFundMissingConditions(item.fund, item.row), item.expected, item.fund);
  }
});

test('ineligible rights are excluded instead of reported as missing clinical data', () => {
  const sssDrugp = { hipdata_code: 'SSS', has_drugp: 'Y', drug_count: 3 };
  assert.equal(isFundReportEligible('drugp', sssDrugp), false);
  assert.deepEqual(getFundMissingConditions('drugp', sssDrugp), []);

  const ucsDrugp = { hipdata_code: 'UCS', has_drugp: 'Y', drug_count: 3 };
  assert.equal(isFundReportEligible('drugp', ucsDrugp), true);
  assert.deepEqual(getFundMissingConditions('drugp', ucsDrugp), []);
});

test('palliative report alerts when Z515 or Z718 is used outside the allowed disease group', () => {
  const outsideDiseaseGroup = {
    hipdata_code: 'UCS', has_pal_diag: 'Y', has_pal_adp: 'Y', has_pal_disease: 'N',
  };
  assert.deepEqual(getFundMissingConditions('palliative', outsideDiseaseGroup), [
    'ไม่พบโรคหลัก K70.4/K71.7/K72.0/K72.1/K72.9/N18.5',
  ]);

  const validPalliative = {
    hipdata_code: 'UCS', has_pal_diag: 'Y', has_pal_adp: 'Y', has_pal_disease: 'Y',
  };
  assert.deepEqual(getFundMissingConditions('palliative', validPalliative), []);

  const validDiseaseWithoutAdp = {
    hipdata_code: 'UCS', has_pal_diag: 'Y', has_pal_adp: 'N', palliative_disease_codes: 'N18.5',
  };
  assert.deepEqual(getFundMissingConditions('palliative', validDiseaseWithoutAdp), ['ADP 30001/Cons01/Eva001']);
});
