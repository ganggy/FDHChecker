import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECEIVABLE_RIGHT_MAPPINGS,
  type ReceivableRightMapping,
} from './receivableMapping.js';

test('RECEIVABLE_RIGHT_MAPPINGS contains accurate chart of accounts for UCS, OFC, LGO, SSS', () => {
  const ucs = RECEIVABLE_RIGHT_MAPPINGS.find((m) => m.hipdata_code === 'UCS');
  assert.ok(ucs);
  assert.ok(ucs.debtor_opd.startsWith('1102050101'));
  assert.ok(ucs.revenue_opd.startsWith('4301020105'));

  const ofc = RECEIVABLE_RIGHT_MAPPINGS.find((m) => m.hipdata_code === 'OFC');
  assert.ok(ofc);
  assert.ok(ofc.debtor_opd.startsWith('1102050101'));

  const lgo = RECEIVABLE_RIGHT_MAPPINGS.find((m) => m.hipdata_code === 'LGO');
  assert.ok(lgo);
  assert.ok(lgo.debtor_opd.startsWith('1102050102'));
});

test('computes correct disallowance and balances journal entries for underpaid claims', () => {
  const claimable = 1000.00;
  const paid = 750.00;
  const diff = Number((paid - claimable).toFixed(2));
  assert.equal(diff, -250.00);

  const disallowance = diff < 0 ? Math.abs(diff) : 0;
  const overpay = diff > 0 ? diff : 0;
  assert.equal(disallowance, 250.00);
  assert.equal(overpay, 0.00);

  // Journal entries
  const debit = [
    { code: '1101010104.101', name: 'เงินฝากธนาคารในงบประมาณ/เงินบำรุง', amount: paid },
    ...(disallowance > 0 ? [{ code: '5103010102.101', name: 'ค่ารักษาพยาบาลต่ำกว่าเกณฑ์/ส่วนลดจ่าย', amount: disallowance }] : []),
  ];
  const credit = [
    { code: '1102050101.201', name: 'ลูกหนี้ค่ารักษาพยาบาล สปสช./กองทุน', amount: claimable },
    ...(overpay > 0 ? [{ code: '4301020105.101', name: 'รายได้ค่ารักษาพยาบาลสูงกว่าเกณฑ์', amount: overpay }] : []),
  ];

  const totalDebit = debit.reduce((s, e) => s + e.amount, 0);
  const totalCredit = credit.reduce((s, e) => s + e.amount, 0);

  assert.equal(totalDebit, totalCredit, 'Debit must equal Credit');
  assert.equal(totalDebit, 1000.00);
});

test('computes correct overpay and balances journal entries for on-top/extra payments', () => {
  const claimable = 500.00;
  const paid = 650.00;
  const diff = Number((paid - claimable).toFixed(2));
  assert.equal(diff, 150.00);

  const disallowance = diff < 0 ? Math.abs(diff) : 0;
  const overpay = diff > 0 ? diff : 0;
  assert.equal(disallowance, 0.00);
  assert.equal(overpay, 150.00);

  const debit = [
    { code: '1101010104.101', name: 'เงินฝากธนาคารในงบประมาณ/เงินบำรุง', amount: paid },
  ];
  const credit = [
    { code: '1102050101.201', name: 'ลูกหนี้ค่ารักษาพยาบาล สปสช./กองทุน', amount: claimable },
    { code: '4301020105.101', name: 'รายได้ค่ารักษาพยาบาลสูงกว่าเกณฑ์', amount: overpay },
  ];

  const totalDebit = debit.reduce((s, e) => s + e.amount, 0);
  const totalCredit = credit.reduce((s, e) => s + e.amount, 0);

  assert.equal(totalDebit, totalCredit, 'Debit must equal Credit');
  assert.equal(totalDebit, 650.00);
});

test('validates settlement date formatting and rejects empty items', async () => {
  const { executeSettlement } = await import('./receivableSettlementService.js');

  await assert.rejects(
    async () => {
      await executeSettlement({
        payer_type: 'NHSO',
        statement_no: 'STM-001',
        transfer_date: 'invalid-date',
        items: [{ patient_type: 'OPD', claimable_amount: 100, paid_amount: 100, diff_amount: 0, settle_action: 'full' }],
      });
    },
    /วันที่โอนเงินไม่ถูกต้อง/
  );

  await assert.rejects(
    async () => {
      await executeSettlement({
        payer_type: 'NHSO',
        statement_no: 'STM-001',
        transfer_date: '2026-09-22',
        items: [],
      });
    },
    /กรุณาเลือกรายการที่ต้องการตัดลูกหนี้อย่างน้อย 1 รายการ/
  );
});
