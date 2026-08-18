import assert from 'node:assert/strict';
import test from 'node:test';
import { attachKidneyRepStmTracking } from './kidneyRepStmTracking.js';

test('links kidney REP and STM by VN and transaction id', () => {
  const result = attachKidneyRepStmTracking(
    [{ vn: 'V100', hn: 'H100', serviceDate: '2026-07-01' }],
    [{ id: 1, vn: 'V100', hn: 'H100', service_date: '2026-07-01', rep_no: 'REP-1', tran_id: 'CHIHD:S1', compensated: 1500 }],
    [{ id: 2, hn: 'H100', service_date: '2026-07-01', statement_no: 'STM-1', tran_id: 'CHIHD:S1', paid_amount: 1500 }],
  );
  assert.equal(result.data[0].claimTrackingStatus, 'MATCHED');
  assert.equal(result.data[0].repAmount, 1500);
  assert.equal(result.data[0].stmPaidAmount, 1500);
  assert.equal(result.summary.matchedVisits, 1);
});

test('falls back to HN and service date and reports amount difference', () => {
  const result = attachKidneyRepStmTracking(
    [{ vn: 'V200', hn: 'H200', serviceDate: '2026-07-02' }],
    [{ id: 3, hn: 'H200', service_date: '2026-07-02', rep_no: 'REP-2', compensated: 1200 }],
    [{ id: 4, hn: 'H200', service_date: '2026-07-02', statement_no: 'STM-2', paid_amount: 1000 }],
  );
  assert.equal(result.data[0].claimTrackingStatus, 'AMOUNT_DIFFERENT');
  assert.equal(result.data[0].repStmDiff, -200);
  assert.equal(result.summary.differentVisits, 1);
  assert.equal(result.summary.amountDiff, -200);
});

test('shows missing REP and waiting STM distinctly', () => {
  const result = attachKidneyRepStmTracking(
    [{ vn: 'V300', hn: 'H300', serviceDate: '2026-07-03' }, { vn: 'V301', hn: 'H301', serviceDate: '2026-07-03' }],
    [{ id: 5, vn: 'V301', hn: 'H301', service_date: '2026-07-03', rep_no: 'REP-3', compensated: 900 }],
    [],
  );
  assert.equal(result.data[0].claimTrackingStatus, 'NO_REP');
  assert.equal(result.data[1].claimTrackingStatus, 'WAITING_STM');
  assert.equal(result.summary.pendingRep, 1);
  assert.equal(result.summary.pendingStm, 1);
});
