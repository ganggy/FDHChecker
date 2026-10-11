---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/collaboration.test.ts"
source_hash: "33636721450dcaed32e7335ab71cfc8f8d3880ebc6030ed327dc0bf77a40fede"
managed_by: "sync-ksp-vault"
---
# collaboration.test.ts

> Source: `server/collaboration.test.ts`
> SHA-256: `33636721450dcaed32e7335ab71cfc8f8d3880ebc6030ed327dc0bf77a40fede`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeChatMessage, validateChatAttachment } from './collaboration.js';

test('sanitizeChatMessage trims, normalizes newlines, and removes null bytes', () => {
  assert.equal(sanitizeChatMessage('  สวัสดี\r\nทีม\u0000  '), 'สวัสดี\nทีม');
});

test('sanitizeChatMessage limits messages to 2,000 characters', () => {
  assert.equal(sanitizeChatMessage('ก'.repeat(2_050)).length, 2_000);
});

test('sanitizeChatMessage handles missing values', () => {
  assert.equal(sanitizeChatMessage(undefined), '');
});

test('validateChatAttachment accepts a real PNG signature', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.equal(validateChatAttachment(png, 'image/png'), 'image/png');
});

test('validateChatAttachment rejects executable web content', () => {
  assert.throws(() => validateChatAttachment(Buffer.from('<script>alert(1)</script>'), 'text/html'), /ไม่รองรับ/);
});

test('validateChatAttachment rejects a spoofed PDF', () => {
  assert.throws(() => validateChatAttachment(Buffer.from('not a pdf'), 'application/pdf'), /PDF/);
});

````
