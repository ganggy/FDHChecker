---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/fundErrorReport.test.ts"
source_hash: "6b3f78f8b346c8f765db5e59bed69a0de37a4d5508eb5791909481e34b7e40a9"
managed_by: "sync-ksp-vault"
---
# fundErrorReport.test.ts

> Source: `server/fundErrorReport.test.ts`
> SHA-256: `6b3f78f8b346c8f765db5e59bed69a0de37a4d5508eb5791909481e34b7e40a9`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpReferSelfTransportErrorSection,
  buildDailyFundLineMessages,
  chunkLineText,
  formatFundErrorReport,
  getFundMissingConditions,
  isFundReportEligible,
  REPORT_FUNDS,
} from './fundErrorReport.js';

test('LINE report flags S1 transport claims when OP Refer patient travels independently', () => {
  const section = buildOpReferSelfTransportErrorSection([{
    vn: '14',
    hn: '000014',
    serviceDate: '2026-07-24',
    fund: 'OP Refer',
    has_refer_record: 1,
    has_refer_out: 1,
    refer_no_raw: 'RF014',
    refer_no: 'OUT:RF014',
    refer_direction: 'OUT',
    refer_date: '2026-07-24',
    refer_hospcode: '10710',
    with_ambulance: '',
    service_type: 'OP',
    refer_adp_codes: 'S1801, S1901',
    has_refer_adp_s: 1,
    main_diag: 'J189',
    has_receipt: 1,
    total_price: 900,
    has_close: 1,
  }], '2026-07-24', '2026-07-24');

  assert.equal(section.checked, 1);
  assert.equal(section.errors.length, 1);
  assert.match(section.errors[0].missing.join(' '), /ติด C.*S1801, S1901.*ลบรายการข้อเบิกค่ารถ/);
  const messages = buildDailyFundLineMessages([section], '2026-07-24');
  assert.match(messages.join('\n'), /OP Refer — เบิกค่ารถทั้งที่ผู้ป่วยไปเอง/);
  assert.match(messages.join('\n'), /HN 000014 — ติด C:/);
  assert.doesNotMatch(messages.join('\n'), /— ขาด ติด C:/);
});

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

test('hepatitis screening only warns about other conditions after a matching lab exists', () => {
  assert.deepEqual(getFundMissingConditions('hepc', {
    birth_before_2535: 'Y',
    has_z115_diag: 'N',
    has_hepc_lab: 'N',
  }), []);
  assert.deepEqual(getFundMissingConditions('hepb', {
    birth_before_2535: 'N',
    has_z115_diag: 'N',
    has_hepb_lab: 'N',
  }), []);

  assert.deepEqual(getFundMissingConditions('hepc', {
    birth_before_2535: 'Y',
    has_z115_diag: 'N',
    has_hepc_lab: 'Y',
  }), ['Diagnosis Z11.5']);
  assert.deepEqual(getFundMissingConditions('hepb', {
    birth_before_2535: 'N',
    has_z115_diag: 'Y',
    hepb_lab_names: 'HBsAg',
  }), ['เกิดก่อน พ.ศ.2535']);
});

test('NTIP/TB Data Hub is excluded from the daily LINE report', async () => {
  const { REPORT_FUNDS } = await import('./fundErrorReport.js');
  assert.equal(REPORT_FUNDS.some((fund) => fund.id === 'latent_tb_screening'), false);
});

test('temporarily disabled ANC funds are excluded from LINE alerts', () => {
  const excludedFundIds = ['anc', 'anc_ultrasound', 'anc_dental_exam', 'anc_dental_clean'];
  assert.ok(excludedFundIds.every((fundId) => !REPORT_FUNDS.some((fund) => fund.id === fundId)));

  const sections = excludedFundIds.map((id) => ({
    id,
    name: id,
    checked: 1,
    errors: [{ hn: '001', serviceDate: '2026-07-24', missing: ['ADP'] }],
  }));
  const dailyMessages = buildDailyFundLineMessages(sections, '2026-07-24');
  const formattedReport = formatFundErrorReport(sections, '2026-07-24', '2026-07-24');

  assert.equal(dailyMessages.length, 1);
  assert.match(dailyMessages[0], /ตรวจ 0 กองทุน • พบผิด 0 รายการ/);
  assert.match(formattedReport, /ตรวจ 0 กองทุน • พบผิด 0 รายการ/);
  assert.ok(excludedFundIds.every((fundId) => !dailyMessages.join('\n').includes(fundId)));
  assert.ok(excludedFundIds.every((fundId) => !formattedReport.includes(fundId)));
});

test('ANC ultrasound LINE rule matches the web actionable-status rule', () => {
  const ancVisitOnly = getFundMissingConditions('anc_ultrasound', {
    sex: '2', has_anc_diag: 'Y', has_anc_us: 'N', has_anc_us_proc: 'N', anc_adp_codes: '30011',
  });
  assert.deepEqual(ancVisitOnly, []);

  const procedureWithoutAdp = getFundMissingConditions('anc_ultrasound', {
    sex: '2', has_anc_diag: 'Y', has_anc_us: 'N', has_anc_us_proc: 'Y', anc_adp_codes: '30011',
  });
  assert.deepEqual(procedureWithoutAdp, []);

  const adpWithoutProcedure = getFundMissingConditions('anc_ultrasound', {
    sex: '2', has_anc_diag: 'Y', has_anc_us: 'Y', has_anc_us_proc: 'N', anc_adp_codes: '30010',
  });
  assert.deepEqual(adpWithoutProcedure, []);

  const adpWithoutAncDiagnosis = getFundMissingConditions('anc_ultrasound', {
    sex: '2', has_anc_diag: 'N', has_anc_us: 'Y', anc_adp_codes: '30010',
  });
  assert.deepEqual(adpWithoutAncDiagnosis, ['Diagnosis Z34/Z35']);
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

````
