---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/ipdPreAuditRules.test.ts"
source_hash: "e3ee2069d8e431275b98e65750e394bd306e7286691b9ea6b795f37f2a24a685"
managed_by: "sync-ksp-vault"
---
# ipdPreAuditRules.test.ts

> Source: `server/ipdPreAuditRules.test.ts`
> SHA-256: `e3ee2069d8e431275b98e65750e394bd306e7286691b9ea6b795f37f2a24a685`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateIpdPreAudit } from './ipdPreAuditRules.js';

test('flags J44.0 without a respiratory infection code', () => {
  const result = evaluateIpdPreAudit({ diagnoses: ['J44.0'], principalDiagnosis: 'J44.0' });
  assert.equal(result.status, 'risk');
  assert.equal(result.findings[0]?.code, 'CR13_1');
});

test('accepts the COPD infection pairing without a coding risk', () => {
  const result = evaluateIpdPreAudit({ diagnoses: ['J44.0', 'J18.9'], principalDiagnosis: 'J44.0' });
  assert.equal(result.status, 'clear');
});

test('checks PTCA vessel count and stent count/type pairing', () => {
  const result = evaluateIpdPreAudit({ procedures: ['00.66', '00.45'] });
  assert.equal(result.status, 'risk');
  assert.deepEqual(result.findings.map((finding) => finding.code), ['CR58', 'CR58']);
});

test('marks sepsis as chart review and septic shock without sepsis as risk', () => {
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['A41.9'] }).status, 'review');
  const shock = evaluateIpdPreAudit({ diagnoses: ['R57.2'] });
  assert.equal(shock.status, 'risk');
  assert.equal(shock.findings[0]?.code, 'CR37');
});

test('flags redundant volume overload with heart failure', () => {
  const result = evaluateIpdPreAudit({ diagnoses: ['E87.7', 'I50.0'] });
  assert.equal(result.status, 'risk');
  assert.equal(result.findings[0]?.code, 'CR8');
});

test('blocks missing principal diagnosis and invalid discharge time', () => {
  const result = evaluateIpdPreAudit({
    includeDocumentAudit: true,
    diagnoses: ['J18.9'],
    admissionAt: '2026-08-04 10:00:00',
    dischargeAt: '2026-08-04 09:00:00',
  });
  assert.equal(result.status, 'risk');
  assert.deepEqual(result.findings.slice(0, 2).map((finding) => finding.code), ['IPD-DOC01', 'IPD-DOC02']);
});

test('reviews short stay, procedures and active cancer documentation', () => {
  const result = evaluateIpdPreAudit({
    includeDocumentAudit: true,
    diagnoses: ['C50.9'],
    principalDiagnosis: 'C50.9',
    procedures: ['85.21'],
    admissionAt: '2026-08-04 08:00:00',
    dischargeAt: '2026-08-04 16:00:00',
  });
  assert.equal(result.status, 'review');
  assert.deepEqual(result.findings.map((finding) => finding.code), ['IPD-DOC03', 'IPD-DOC05', 'IPD-DOC06']);
});

test('flags possible split admission within 24 hours', () => {
  const result = evaluateIpdPreAudit({
    includeDocumentAudit: true,
    diagnoses: ['J18.9'],
    principalDiagnosis: 'J18.9',
    admissionAt: '2026-08-04 08:00:00',
    dischargeAt: '2026-08-05 12:00:00',
    previousDischargeAt: '2026-08-03 20:00:00',
  });
  assert.equal(result.status, 'risk');
  assert.equal(result.findings[0]?.code, 'IPD-DOC04');
});

````
