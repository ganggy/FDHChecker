---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiService.test.ts"
source_hash: "bb141c53b920c10a414158f64d1c7e3072c3a47ba043012d7cb44491d5a02e3e"
managed_by: "sync-ksp-vault"
---
# aiService.test.ts

> Source: `server/aiService.test.ts`
> SHA-256: `bb141c53b920c10a414158f64d1c7e3072c3a47ba043012d7cb44491d5a02e3e`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReportPayload } from './aiService.js';

test('accepts a small aggregate report', () => {
  const input = { title: 'ยอดแยกตามกองทุน', rows: [{ fund: 'UCS', total: 120 }] };
  assert.equal(validateReportPayload(input), input);
});

test('accepts patient-level fields for authenticated workflows', () => {
  const input = { title: 'รายงาน', rows: [{ hn: '000001', vn: '1234', cid: '1234567890123' }] };
  assert.equal(validateReportPayload(input), input);
});

test('rejects more than the configured aggregate row limit', () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ department: index, total: 1 }));
  assert.throws(() => validateReportPayload({ title: 'รายงาน', rows }), /limit of 50 rows/i);
});

````
