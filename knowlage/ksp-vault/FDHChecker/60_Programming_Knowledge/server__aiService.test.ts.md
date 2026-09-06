---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiService.test.ts"
source_hash: "55540b4979d4f33f486fcca27c3d8153446a908ea091caca7e191c270a86c8c2"
managed_by: "sync-ksp-vault"
---
# aiService.test.ts

> Source: `server/aiService.test.ts`
> SHA-256: `55540b4979d4f33f486fcca27c3d8153446a908ea091caca7e191c270a86c8c2`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPromptForContext, estimatePromptTokens, validateReportPayload } from './aiService.js';

test('compacts oversized Thai prompts while preserving the newest question at the end', () => {
  const system = 'กฎระบบ'.repeat(600);
  const latestQuestion = 'คำถามล่าสุด: รวมทุกตึก 30 เตียงตามการขึ้นทะเบียน และ 38 ตาม กบรส';
  const prompt = `${'บริบทเก่า'.repeat(12_000)}\n${latestQuestion}`;
  const compacted = compactPromptForContext(system, prompt, 8_192, 1_200);
  assert.ok(estimatePromptTokens(system) + estimatePromptTokens(compacted) <= 8_192 - 1_200 - 512);
  assert.match(compacted, /ตัดบริบทเก่าที่เกินขนาด/);
  assert.ok(compacted.endsWith(latestQuestion));
});

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
