---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/systemUpdateStatus.test.ts"
source_hash: "ccfa8335d8465945fe0e5993e7eaa5f226b5f87a0a16d43d9b1e6c0c5780cd11"
managed_by: "sync-ksp-vault"
---
# systemUpdateStatus.test.ts

> Source: `server/systemUpdateStatus.test.ts`
> SHA-256: `ccfa8335d8465945fe0e5993e7eaa5f226b5f87a0a16d43d9b1e6c0c5780cd11`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSystemUpdateStatus } from '../src/services/systemUpdateStatus.js';

test('HTTP errors and a proxy HTML response never become a successful status', async context => {
  for (const response of [new Response('unavailable', { status: 503 }), new Response('<html>proxy</html>'), Response.json({ success: true })]) {
    context.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(fetchSystemUpdateStatus(), /ยังอ่านสถานะ/);
  }
});

test('a stalled request is aborted and a subsequent request can confirm completion', async context => {
  let aborted = false;
  context.mock.method(globalThis, 'fetch', (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  }));
  await assert.rejects(fetchSystemUpdateStatus(false, 20), /ตอบสถานะช้า/);
  assert.equal(aborted, true);
  const data = { currentCommit: 'new-version', job: { id: 'same-job', status: 'completed', progress: 100 } };
  context.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data }));
  assert.deepEqual(await fetchSystemUpdateStatus(), data);
});

test('expired authorization is distinguished from an update failure', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  await assert.rejects(fetchSystemUpdateStatus(), /เข้าสู่ระบบ/);
});

````
