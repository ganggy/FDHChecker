import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPromptForContext, estimatePromptTokens, getAiStatus, validateReportPayload } from './aiService.js';

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

test('reports Gemini provider status correctly when configured', async () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  try {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key-123';
    const status = await getAiStatus();
    assert.equal(status.provider, 'gemini');
    assert.equal(status.configured, true);
    assert.equal(status.model, process.env.GEMINI_MODEL || 'gemini-3.8-flash');
  } finally {
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
