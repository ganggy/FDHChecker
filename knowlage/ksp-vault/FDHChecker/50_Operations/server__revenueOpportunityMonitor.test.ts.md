---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/revenueOpportunityMonitor.test.ts"
source_hash: "c06b773d2b6464a6db8d71796dc5e15585e6340be4d87c381ec2006dce868b45"
managed_by: "sync-ksp-vault"
---
# revenueOpportunityMonitor.test.ts

> Source: `server/revenueOpportunityMonitor.test.ts`
> SHA-256: `c06b773d2b6464a6db8d71796dc5e15585e6340be4d87c381ec2006dce868b45`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRevenueOpportunityMonitor, evaluateOpReferBillingEligibility } from './revenueOpportunityMonitor.js';

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
  assert.doesNotMatch(result.items.find((item) => item.visitCode === '7')?.missing.join(' ') || '', /ช่องทาง/);
});

test('OP Refer requires refer number, date, direction and a valid provider code', () => {
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
  assert.match(missing, /รหัสหน่วยบริการ.*ไม่ถูกต้อง/);
  assert.match(missing, /วันที่ส่งต่อ/);
  assert.match(missing, /ทิศทาง/);
  assert.equal(result.items[0].status, 'data_error');
});

test('EA0010710 is accepted as Sakon Hospital and S1801 satisfies the Refer ADP requirement', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [],
    opdRows: [{
      vn: '10',
      fund: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      finance_name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      has_refer_record: 1,
      has_refer_out: 1,
      refer_no_raw: 'RF010',
      refer_no: 'OUT:RF010',
      refer_direction: 'OUT',
      refer_date: '2026-06-10',
      refer_hospcode: 'EA0010710',
      refer_in_province: 'Y',
      with_ambulance: 'Y',
      service_type: 'OP',
      has_refer_adp_s: 1,
      refer_adp_codes: 'S1801',
      main_diag: 'J189',
      has_receipt: 1,
      total_price: 900,
      has_close: 1,
    }],
    ipdRows: [],
  });
  const item = result.items[0];
  assert.equal(item.eligibility, 'claimable');
  assert.equal(item.dataAction, 'no_fix_complete');
  assert.doesNotMatch(item.missing.join(' '), /รหัสหน่วยบริการ|ADP/);
  assert.match(item.evidence.join(' '), /EA0010710.*10710/);
  assert.match(item.evidence.join(' '), /S1801/);
});

test('claimable Refer with Ambulance but without an S18 ADP code is flagged as revenue loss risk', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [],
    opdRows: [{
      vn: '11',
      fund: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      finance_name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      has_refer_record: 1,
      has_refer_out: 1,
      refer_no_raw: 'RF011',
      refer_no: 'OUT:RF011',
      refer_direction: 'OUT',
      refer_date: '2026-06-11',
      refer_hospcode: '10710',
      refer_in_province: 'Y',
      with_ambulance: 'Y',
      service_type: 'OP',
      main_diag: 'J189',
      has_receipt: 1,
      total_price: 900,
      has_close: 1,
    }],
    ipdRows: [],
  });
  assert.equal(result.items[0].eligibility, 'claimable');
  assert.equal(result.items[0].dataAction, 'fix_adp');
  assert.match(result.items[0].missing.join(' '), /ขาด ADP รหัส S18xx.*สูญเสียรายได้/);
  assert.equal(result.items[0].status, 'data_error');
});

test('UC OP in province is not claimable in either refer direction', () => {
  for (const direction of ['IN', 'OUT']) {
    const result = evaluateOpReferBillingEligibility({
      refer_direction: direction,
      has_refer_out: direction === 'OUT' ? 1 : 0,
      with_ambulance: 'Y',
      finance_name: 'UC ใน CUP',
      referout_hospcode: '10710',
      service_type: 'OP',
    });
    assert.equal(result.eligibility, 'not_claimable');
    assert.match(result.label, /UC OP ในจังหวัด/);
  }
});

test('IPD and a returned refer that becomes admitted are claimable', () => {
  const ipd = evaluateOpReferBillingEligibility({
    refer_direction: 'OUT',
    has_refer_out: 1,
    with_ambulance: 'Y',
    service_type: 'IP',
    finance_name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
  });
  assert.equal(ipd.eligibility, 'claimable');
  assert.match(ipd.label, /IPD ทุกสิทธิ์/);

  const returnedAdmit = evaluateOpReferBillingEligibility({
    refer_direction: 'IN',
    has_refer_in: 1,
    is_admitted: 1,
    service_type: 'OP',
    finance_name: 'UC ใน CUP',
    refer_in_province: 'Y',
  });
  assert.equal(returnedAdmit.eligibility, 'claimable');
  assert.match(returnedAdmit.label, /กลับมาแล้ว Admit/);
});

test('OP sent to Sakon Hospital is claimable for non-UC-in-CUP rights with ambulance', () => {
  const result = evaluateOpReferBillingEligibility({
    refer_direction: 'OUT',
    has_refer_out: 1,
    with_ambulance: 'Y',
    service_type: 'OP',
    finance_name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
    referout_hospcode: '10710',
  });
  assert.equal(result.eligibility, 'claimable');
  assert.match(result.label, /OP ส่ง รพ.สกลนคร/);
});

test('refer out without the Ambulance checkbox is treated as self travel and not claimable', () => {
  const result = evaluateOpReferBillingEligibility({
    refer_direction: 'OUT',
    has_refer_out: 1,
    with_ambulance: '',
    service_type: 'IP',
    finance_name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
    referout_hospcode: '10710',
  });
  assert.equal(result.eligibility, 'not_claimable');
  assert.equal(result.transportMode, 'self');
  assert.match(result.label, /เดินทางเอง/);
});

test('self travel with an S18 Refer charge is marked C and must remove the transport claim', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [],
    opdRows: [{
      vn: '12',
      fund: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      finance_name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      has_refer_record: 1,
      has_refer_out: 1,
      refer_no_raw: 'RF012',
      refer_no: 'OUT:RF012',
      refer_direction: 'OUT',
      refer_date: '2026-06-12',
      refer_hospcode: '10710',
      with_ambulance: '',
      service_type: 'OP',
      has_refer_adp_s: 1,
      refer_adp_codes: 'S1802',
      main_diag: 'J189',
      has_receipt: 1,
      total_price: 900,
      has_close: 1,
    }],
    ipdRows: [],
  });
  assert.equal(result.items[0].eligibility, 'not_claimable');
  assert.equal(result.items[0].dataAction, 'remove_transport_adp');
  assert.match(result.items[0].missing.join(' '), /ติด C.*Refer ไปเอง.*S1802.*ลบรายการข้อเบิกค่ารถ/);
  assert.match(result.items[0].instruction, /เบิกค่ารถไม่ได้.*ลบรายการ ADP S1802/);
  assert.equal(result.items[0].statusLabel, 'ข้อมูลผิดพลาด (ติด C)');
  assert.equal(result.items[0].status, 'data_error');
});

test('self travel rejects every S1 transport claim code, not only S18', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [],
    opdRows: [{
      vn: '14',
      fund: 'OP Refer',
      has_refer_record: 1,
      has_refer_out: 1,
      refer_no_raw: 'RF014',
      refer_no: 'OUT:RF014',
      refer_direction: 'OUT',
      refer_date: '2026-06-14',
      refer_hospcode: '10710',
      with_ambulance: '',
      service_type: 'OP',
      refer_adp_codes: 'S1901',
      has_refer_adp_s: 1,
      main_diag: 'J189',
      has_receipt: 1,
      total_price: 900,
      has_close: 1,
    }],
    ipdRows: [],
  });
  assert.equal(result.items[0].dataAction, 'remove_transport_adp');
  assert.match(result.items[0].missing.join(' '), /ติด C.*S1901/);
});

test('self travel without an S18 charge is explicitly classified as no correction needed', () => {
  const result = buildRevenueOpportunityMonitor({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    palliativeRows: [],
    instrumentRows: [],
    opdRows: [{
      vn: '13',
      fund: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      finance_name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
      has_refer_record: 1,
      has_refer_out: 1,
      refer_no_raw: 'RF013',
      refer_no: 'OUT:RF013',
      refer_direction: 'OUT',
      refer_date: '2026-06-13',
      refer_hospcode: '10710',
      with_ambulance: '',
      service_type: 'OP',
      main_diag: 'J189',
      has_receipt: 1,
      total_price: 900,
      has_close: 1,
    }],
    ipdRows: [],
  });
  assert.equal(result.items[0].dataAction, 'no_fix_self');
  assert.match(result.items[0].dataActionLabel || '', /ไม่ต้องแก้.*Refer ไปเอง/);
  assert.doesNotMatch(result.items[0].missing.join(' '), /Ambulance.*ขัดแย้ง|ADP รหัส S18xx/);
});

````
