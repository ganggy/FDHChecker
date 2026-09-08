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
