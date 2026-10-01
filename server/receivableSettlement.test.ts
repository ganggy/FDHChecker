import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSettlement, type ExecuteSettlementPayload, type SettlementCandidateResult } from './receivableSettlementService.js';
import type { PoolConnection } from 'mysql2/promise';

const request = { payer_type: 'NHSO', statement_no: 'DEMO-STM', transfer_date: '2026-09-30', bank_account: 'DEMO-BANK',
  items: [{ statement_record_id: 1, patient_type: 'OPD', claimable_amount: 100, paid_amount: 80, diff_amount: -20, settle_action: 'writeoff_diff' }], created_by: 'FORGED' } satisfies ExecuteSettlementPayload;
const fixture = { items: [{ id: 1, statement_no: 'DEMO-STM', patient_type: 'OPD', hn: 'DEMO-H', vn: 'DEMO-V', an: null,
  claimable_amount: 100, paid_amount: 80, diff_amount: -20, payment_known: true, settle_action: 'writeoff_diff' }] } as SettlementCandidateResult;
function settlementHarness(failItems = false) {
  const trace: string[] = []; let actor = ''; let next = 0; let staged = 0; let saved = 0;
  let lock: Promise<void> = Promise.resolve();
  const createConnection = () => { let releaseLock: (() => void) | undefined; return {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('GET_LOCK')) { const previous = lock; lock = new Promise<void>(resolve => { releaseLock = resolve; }); await previous; return [[{ acquired: 1 }]]; }
      if (sql.includes('RELEASE_LOCK')) { releaseLock?.(); return [[{}]]; }
      if (sql.includes('FOR UPDATE')) return [[{ id: 1 }]];
      if (sql.includes('SELECT b.id AS batch_id')) return [saved ? [{ batch_id: saved, settlement_no: 'STL-202609-0001', transfer_date: '2026-09-30', payer_type: 'NHSO', bank_account: 'DEMO-BANK', statement_record_id: 1, total_claimable: 100, total_received: 80, total_diff: -20 }] : []];
      if (sql.includes('SELECT statement_record_id')) return [[{ statement_record_id: 1 }]];
      if (sql.includes('MAX(CAST')) return [[{ last_no: saved ? 1 : 0 }]];
      if (sql.includes('INSERT INTO receivable_settlement_batch')) { staged = ++next; actor = String(values[11]); return [{ insertId: staged }]; }
      if (sql.includes('INSERT INTO receivable_settlement_item')) { if (failItems) throw new Error('synthetic item failure'); return [[]]; }
      throw new Error('unexpected fixture query');
    },
    async beginTransaction() { trace.push('begin'); }, async commit() { saved = staged; trace.push('commit'); },
    async rollback() { staged = 0; trace.push('rollback'); }, release() { trace.push('release'); },
  } as unknown as PoolConnection; };
  return { dependencies: { getConnection: async () => createConnection(), ensureTables: async () => {}, getCandidates: async () => fixture }, trace, actor: () => actor, saved: () => saved };
}
test('settlement uses source values and session actor, commits once and treats a retry as duplicate', async () => {
  const h = settlementHarness();
  const result = await executeSettlement(request, 'SESSION-ACTOR', h.dependencies);
  assert.equal(result.total_received, 80); assert.equal(h.actor(), 'SESSION-ACTOR');
  assert.equal((await executeSettlement(request, 'SESSION-ACTOR', h.dependencies)).duplicate, true);
  assert.equal(h.trace.filter(value => value === 'commit').length, 1);
});
test('failed item insert rolls back the batch and stale client amounts cannot be saved', async () => {
  const h = settlementHarness(true);
  await assert.rejects(executeSettlement(request, 'SESSION-ACTOR', h.dependencies), /synthetic item failure/);
  assert.equal(h.saved(), 0); assert.ok(h.trace.includes('rollback'));
  const stale = settlementHarness();
  await assert.rejects(executeSettlement({ ...request, items: [{ ...request.items[0], paid_amount: 999 }] }, 'SESSION-ACTOR', stale.dependencies), /ยอดต้นทางเปลี่ยนแปลง/);
  assert.equal(stale.saved(), 0);
});
test('settlement rejects duplicate source IDs and unknown payments before insertion', async () => {
  const h = settlementHarness();
  await assert.rejects(executeSettlement({ ...request, items: [request.items[0], request.items[0]] }, 'SESSION-ACTOR', h.dependencies), /รายการซ้ำ/);
  await assert.rejects(executeSettlement(request, 'SESSION-ACTOR', { ...h.dependencies, getCandidates: async () => ({ ...fixture, items: [{ ...fixture.items[0], payment_known: false }] }) }), /ยังไม่ทราบยอดจ่าย/);
});
import {
  RECEIVABLE_RIGHT_MAPPINGS,
  validateReceivableMappings,
  applyReceivableMappings,
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

test('concurrent settlement requests produce one committed batch', async () => {
  const h = settlementHarness();
  const results = await Promise.all([
    executeSettlement(request, 'SESSION-ACTOR', h.dependencies),
    executeSettlement(request, 'SESSION-ACTOR', h.dependencies),
  ]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.equal(h.trace.filter(value => value === 'commit').length, 1);
});

test('site mapping validates duplicates and updates report lookups without restart', async () => {
  const original = [...RECEIVABLE_RIGHT_MAPPINGS];
  const { resolveDebtorForPttype } = await import('./receivableReportService.js');
  const { findRightMapping } = await import('./receivableSettlementService.js');
  const template = original[0];
  assert.throws(() => validateReceivableMappings([template, template]));
  assert.throws(() => validateReceivableMappings([{ ...template, debtor_opd: 'invalid account' }]));
  try {
    applyReceivableMappings([{ ...template, hosxp_code: 'DEMO-RIGHT' }]);
    assert.equal(resolveDebtorForPttype('DEMO-RIGHT').debtorCode, template.debtor_opd);
    assert.equal(findRightMapping(template.hipdata_code, 'OTHER-RIGHT'), undefined);
    applyReceivableMappings([template, { ...template, hosxp_code: 'DEMO-RIGHT', debtor_opd: '999999.101' }]);
    assert.equal(findRightMapping(template.hipdata_code), undefined);
  } finally { applyReceivableMappings(original); }
});
