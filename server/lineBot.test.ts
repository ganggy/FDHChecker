import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { extractQuestion, shouldAnswerEvent, verifyLineSignature, wasBotMentioned } from './lineBot.js';
import { tokenizeThai } from './vaultKnowledge.js';

test('verifies a valid LINE HMAC signature', () => {
  const body = Buffer.from('{"events":[]}');
  const secret = 'test-secret';
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(verifyLineSignature(body, signature, secret), true);
  assert.equal(verifyLineSignature(Buffer.from('changed'), signature, secret), false);
});

test('answers group text only when the bot is mentioned', () => {
  const event = {
    type: 'message',
    mode: 'active' as const,
    replyToken: 'reply-token',
    source: { type: 'group' as const, groupId: 'group' },
    message: {
      type: 'text',
      text: '@FDH Bot การเบิกฟอกไตต้องใช้อะไร',
      mention: { mentionees: [{ type: 'user' as const, index: 0, length: 8, isSelf: true }] },
    },
  };
  assert.equal(wasBotMentioned(event), true);
  assert.equal(shouldAnswerEvent(event), true);
  assert.equal(extractQuestion(event), 'การเบิกฟอกไตต้องใช้อะไร');
});

test('ignores ordinary group text and standby events', () => {
  const groupEvent = {
    type: 'message',
    mode: 'active' as const,
    replyToken: 'reply-token',
    source: { type: 'group' as const, groupId: 'group' },
    message: { type: 'text', text: 'คุยกันตามปกติ' },
  };
  assert.equal(shouldAnswerEvent(groupEvent), false);
  assert.equal(shouldAnswerEvent({ ...groupEvent, mode: 'standby' }), false);
});

test('Thai tokenizer extracts useful words', () => {
  const tokens = tokenizeThai('การเบิกจ่ายค่าฟอกไตสำหรับผู้ป่วย');
  assert(tokens.includes('ฟอกไต'));
  assert(tokens.includes('ผู้ป่วย'));
});
