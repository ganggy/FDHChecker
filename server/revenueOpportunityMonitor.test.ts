import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRevenueOpportunityMonitor } from './revenueOpportunityMonitor.js';

test('marks palliative diagnosis without ADP as a data error', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [{ vn: '1', z515_code: 'Z515', patientName: 'A' }],
    instrumentRows: [],
    opdRows: [],
    ipdRows: [],
  });
  assert.equal(result.summary.dataErrors, 1);
  assert.match(result.items[0].missing.join(' '), /รหัสบริการ/);
  assert.equal(result.conclusion.verdict, 'risk_detected');
});

test('does not classify charge as paid amount', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [{ vn: '2', instrument_price: 16800, instrument_items: 'อุปกรณ์', has_stm_import: false }],
    opdRows: [],
    ipdRows: [],
  });
  assert.equal(result.summary.knownCharges, 16800);
  assert.equal(result.summary.knownPaid, 0);
  assert.equal(result.items[0].status, 'ready');
});

test('does not classify FDH act amount as cash received', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [{ vn: '8', instrument_price: 1000, instrument_items: 'อุปกรณ์', fdh_act_amt: 750, fdh_claim_status_message: 'อนุมัติ' }],
    opdRows: [],
    ipdRows: [],
  });
  assert.equal(result.summary.knownClaims, 750);
  assert.equal(result.summary.knownPaid, 0);
  assert.equal(result.items[0].status, 'submitted');
});

test('only includes explicit OP Refer and CSCD rows in those categories', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [],
    opdRows: [
      { vn: '3', fund: 'บัตรทอง รับส่งต่อต่างจังหวัด OP Refer', has_refer_record: 1, refer_no_raw: 'RF001', refer_no: 'IN:RF001', refer_direction: 'IN', refer_date: '2026-06-01', refer_hospcode: '12345', main_diag: 'J189', has_receipt: 1, total_price: 900, has_close: 1 },
      { vn: '4', fund: 'UC ใน CUP', main_diag: 'J189', has_receipt: 1, total_price: 900, has_close: 1 },
      { vn: '7', fund: 'UC ใน CUP', has_refer_record: 1, refer_no_raw: 'RF007', refer_no: 'OUT:RF007', refer_direction: 'OUT', refer_date: '2026-06-01', refer_hospcode: '12345', main_diag: 'J189', has_receipt: 1, total_price: 900, has_close: 1 },
    ],
    ipdRows: [
      { an: '5', pttype: 'CSCD เบิกหน่วยงานต้นสังกัด', pdx: 'A000', dchdate: '2026-06-02', drg: '001', totalPrice: 1000 },
      { an: '6', pttype: 'UCS', pdx: 'A000', dchdate: '2026-06-02', drg: '001', totalPrice: 1000 },
    ],
  });
  assert.deepEqual(result.items.map((item) => item.visitCode).sort(), ['3', '5', '7']);
  assert.match(result.items.find((item) => item.visitCode === '7')?.missing.join(' ') || '', /ช่องทาง/);
});

test('OP Refer requires refer number, date, direction and a five-digit provider code', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [],
    opdRows: [{
      vn: '9',
      fund: 'OP Refer',
      has_refer_record: 1,
      refer_hospcode: '1234A',
      main_diag: 'J189',
      has_receipt: 1,
      total_price: 900,
      has_close: 1,
    }],
    ipdRows: [],
  });
  const missing = result.items[0].missing.join(' ');
  assert.match(missing, /เลขที่ใบส่งต่อ/);
  assert.match(missing, /5 หลัก/);
  assert.match(missing, /วันที่ส่งต่อ/);
  assert.match(missing, /ทิศทาง/);
  assert.equal(result.items[0].status, 'data_error');
});
