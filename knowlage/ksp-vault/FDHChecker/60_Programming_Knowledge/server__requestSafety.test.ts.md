---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/requestSafety.test.ts"
source_hash: "edd597d136b773d6757fe32263c427f8f0330db45d57c34367977e406d9b816d"
managed_by: "sync-ksp-vault"
---
# requestSafety.test.ts

> Source: `server/requestSafety.test.ts`
> SHA-256: `edd597d136b773d6757fe32263c427f8f0330db45d57c34367977e406d9b816d`

````typescript
import assert from 'node:assert';
import test from 'node:test';
import { boundedInteger, fetchWithTimeout } from './httpClient.js';
import { parseIsoDateUtc, validateDateRange } from './requestSafety.js';

test('parseIsoDateUtc accepts real ISO dates and rejects invalid calendar dates', () => {
  assert.equal(parseIsoDateUtc('2024-02-29'), Date.UTC(2024, 1, 29));
  assert.equal(parseIsoDateUtc('2025-02-29'), null);
  assert.equal(parseIsoDateUtc('16/07/2026'), null);
});

test('validateDateRange treats the range as inclusive', () => {
  const result = validateDateRange('2026-01-01', '2026-04-03', 93);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.daySpan, 93);
});

test('validateDateRange rejects incomplete, reversed, and oversized ranges', () => {
  assert.equal(validateDateRange('2026-01-01', '', 93).ok, false);
  assert.equal(validateDateRange('2026-01-02', '2026-01-01', 93).ok, false);
  assert.equal(validateDateRange('2026-01-01', '2026-04-04', 93).ok, false);
});

test('boundedInteger applies fallback, truncation, and bounds', () => {
  assert.equal(boundedInteger('invalid', 90, 5, 300), 90);
  assert.equal(boundedInteger('12.8', 90, 5, 300), 12);
  assert.equal(boundedInteger('-1', 90, 5, 300), 5);
  assert.equal(boundedInteger('999', 90, 5, 300), 300);
});

test('fetchWithTimeout supports successful fetches', async () => {
  const response = await fetchWithTimeout('data:text/plain,ok', {}, 1_000);
  assert.equal(await response.text(), 'ok');
});

````
