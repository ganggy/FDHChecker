---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiAuth.test.ts"
source_hash: "1c0376d706d5a856afa310a44080ef6ba32a1b07336951b4ed1acba13f560741"
managed_by: "sync-ksp-vault"
---
# aiAuth.test.ts

> Source: `server/aiAuth.test.ts`
> SHA-256: `1c0376d706d5a856afa310a44080ef6ba32a1b07336951b4ed1acba13f560741`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiSessionToken, isAccessKeyMatch, verifyAiSessionToken } from './aiAuth.js';

test('creates and verifies a signed AI session token', () => {
  const now = 1_700_000_000_000;
  const token = createAiSessionToken('server-secret', now, 'fixed-nonce');
  assert.equal(verifyAiSessionToken(token, 'server-secret', now + 1_000), true);
  assert.equal(verifyAiSessionToken(token, 'wrong-secret', now + 1_000), false);
});

test('rejects expired or modified AI sessions', () => {
  const now = 1_700_000_000_000;
  const token = createAiSessionToken('server-secret', now, 'fixed-nonce');
  assert.equal(verifyAiSessionToken(`${token}x`, 'server-secret', now + 1_000), false);
  assert.equal(verifyAiSessionToken(token, 'server-secret', now + 13 * 60 * 60_000), false);
});

test('compares access keys without accepting partial values', () => {
  assert.equal(isAccessKeyMatch('same-key', 'same-key'), true);
  assert.equal(isAccessKeyMatch('same', 'same-key'), false);
});

````
