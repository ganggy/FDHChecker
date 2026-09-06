---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/opdPreAuditRules.test.ts"
source_hash: "ed5a8cf9a6855ab525129277b4b1e1ddd2585aa6c43530a9b90a2e088d832403"
managed_by: "sync-ksp-vault"
---
# opdPreAuditRules.test.ts

> Source: `server/opdPreAuditRules.test.ts`
> SHA-256: `ed5a8cf9a6855ab525129277b4b1e1ddd2585aa6c43530a9b90a2e088d832403`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateOpdPreAudit } from './opdPreAuditRules.js';

const codes = (row: Record<string, unknown>) => evaluateOpdPreAudit(row).map((issue) => issue.code);

test('OPD audit passes a documented visit with completed lab and valid charges', () => {
  assert.deepEqual(codes({ has_provider: 1, has_clinical_note: 1, has_lab_order: 1, has_lab_result: 1 }), []);
});

test('OPD audit detects missing documentation and unfinished lab', () => {
  assert.deepEqual(codes({ has_lab_order: 1 }), ['OPD-DOC01', 'OPD-DOC02', 'OPD-LAB01']);
});

test('OPD audit detects mutually exclusive OPD service charges', () => {
  assert.ok(codes({ has_provider: 1, has_clinical_note: 1, has_55020: 1, has_55021: 1 }).includes('OPD-CHG03'));
});

test('OPD audit detects observation and OPD service fee collision', () => {
  assert.ok(codes({ has_provider: 1, has_clinical_note: 1, has_observation_charge: 1, has_55020: 1 }).includes('OPD-CHG04'));
});

test('IPD rows are outside OPD audit scope', () => {
  assert.deepEqual(codes({ an: '6600001' }), []);
});

````
