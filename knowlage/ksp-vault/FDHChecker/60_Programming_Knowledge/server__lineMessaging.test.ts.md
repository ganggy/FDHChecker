---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/lineMessaging.test.ts"
source_hash: "229d7f3668f8871747584ec1636b12b3ddad9485d3b263762f240644f4cd57b1"
managed_by: "sync-ksp-vault"
---
# lineMessaging.test.ts

> Source: `server/lineMessaging.test.ts`
> SHA-256: `229d7f3668f8871747584ec1636b12b3ddad9485d3b263762f240644f4cd57b1`

````typescript
import assert from 'node:assert';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  getLineIdCommandReply,
  getLinePushTargetKind,
  getLineWebhookTarget,
  parseLineWebhookPayload,
  validateLineMessages,
  verifyLineWebhookSignature,
} from './lineMessaging.js';

test('verifies LINE webhook signatures against the unmodified body', () => {
  const secret = 'test-secret';
  const body = Buffer.from('{"events":[]}');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(verifyLineWebhookSignature(body, signature, secret), true);
  assert.equal(verifyLineWebhookSignature(Buffer.from('{"events": [ ]}'), signature, secret), false);
  assert.equal(verifyLineWebhookSignature(body, '', secret), false);
});

test('parses webhook payloads and extracts user/group/room targets', () => {
  assert.deepEqual(parseLineWebhookPayload(Buffer.from('{"events":[]}')), { events: [] });
  assert.deepEqual(getLineWebhookTarget({ type: 'group', groupId: 'C123' }), {
    targetId: 'C123',
    sourceType: 'group',
  });
  assert.deepEqual(getLineWebhookTarget({ type: 'user', userId: 'U123' }), {
    targetId: 'U123',
    sourceType: 'user',
  });
  assert.equal(getLineWebhookTarget({ type: 'group' }), null);
});

test('recognizes the FDH target ID command', () => {
  assert.deepEqual(getLineIdCommandReply({
    type: 'message',
    replyToken: 'reply-token',
    source: { type: 'group', groupId: 'C123' },
    message: { type: 'text', text: '#fdh-id' },
  }), {
    replyToken: 'reply-token',
    target: { targetId: 'C123', sourceType: 'group' },
  });
});

test('infers LINE push target kind from target ID prefixes', () => {
  assert.equal(getLinePushTargetKind('U123'), 'user');
  assert.equal(getLinePushTargetKind('C123'), 'group');
  assert.equal(getLinePushTargetKind('R123'), 'room');
  assert.equal(getLinePushTargetKind('x123'), 'unknown');
});

test('validates text and HTTPS image messages', () => {
  assert.deepEqual(validateLineMessages([{ type: 'text', text: ' test ' }]), [{ type: 'text', text: 'test' }]);
  assert.equal(validateLineMessages([{
    type: 'image',
    originalContentUrl: 'https://fdh.example.go.th/report.png',
    previewImageUrl: 'https://fdh.example.go.th/report-preview.png',
  }])[0].type, 'image');
  assert.throws(() => validateLineMessages([{
    type: 'image',
    originalContentUrl: 'http://fdh.example.go.th/report.png',
    previewImageUrl: 'https://fdh.example.go.th/report-preview.png',
  }]), /HTTPS/);
});

````
