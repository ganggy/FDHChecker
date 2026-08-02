---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/fdhClaimProgress.test.ts"
source_hash: "23b54abb858471dbb14503b19191f3134431f23b203f112606cfe417cfde375f"
managed_by: "sync-ksp-vault"
---
# fdhClaimProgress.test.ts

> Source: `server/fdhClaimProgress.test.ts`
> SHA-256: `23b54abb858471dbb14503b19191f3134431f23b203f112606cfe417cfde375f`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFdhClaimProgress,
  hasFdhSubmissionData,
  isMissingFdhStatus,
} from '../src/utils/fdhClaimProgress.js';

const ready = (row: Record<string, unknown>) => row.ready === true;

test('explicit FDH not-found responses are not counted as submitted', () => {
  assert.equal(isMissingFdhStatus('ยังไม่พบข้อมูลใน FDH'), true);
  assert.equal(hasFdhSubmissionData({ fdh_claim_status_message: 'ยังไม่พบข้อมูลใน FDH' }), false);
  assert.equal(hasFdhSubmissionData({ fdh_claim_status_message: 'ส่งข้อมูลสำเร็จ' }), true);
  assert.equal(hasFdhSubmissionData({ has_fdh_import: true }), true);
});

test('FDH progress identifies records that are ready but not submitted', () => {
  const progress = buildFdhClaimProgress([
    { ready: true },
    { ready: false },
  ], ready);

  assert.equal(progress.stage, 'ready-to-submit');
  assert.equal(progress.readyNotSubmitted, 1);
  assert.equal(progress.needsFixNotSubmitted, 1);
  assert.equal(progress.submitted, 0);
});

test('FDH progress compares local records with partial FDH submissions', () => {
  const progress = buildFdhClaimProgress([
    { ready: true, has_fdh_import: true },
    { ready: true, fdh_claim_status_message: 'Claim accepted' },
    { ready: true, fdh_claim_status_message: 'ไม่พบข้อมูล' },
    { ready: false },
  ], ready);

  assert.equal(progress.stage, 'partially-submitted');
  assert.equal(progress.total, 4);
  assert.equal(progress.submitted, 2);
  assert.equal(progress.notSubmitted, 2);
  assert.equal(progress.coveragePercent, 50);
});

test('FDH progress advances through REP and STM/INV', () => {
  const awaitingRep = buildFdhClaimProgress([
    { ready: true, has_fdh_import: true, has_rep_import: true },
    { ready: true, has_fdh_import: true },
  ], ready);
  assert.equal(awaitingRep.stage, 'awaiting-rep');
  assert.equal(awaitingRep.isFullySubmitted, true);

  const completed = buildFdhClaimProgress([
    { ready: true, has_fdh_import: true, has_rep_import: true, has_stm_import: true },
    { ready: false, has_fdh_import: true, has_rep_import: true, has_inv_import: true },
  ], ready);
  assert.equal(completed.stage, 'completed');
  assert.equal(completed.submittedButIncomplete, 1);
});

````
