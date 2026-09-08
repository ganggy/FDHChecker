import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAiSessionToken,
  getAiAuthStatus,
  isAccessKeyMatch,
  resetAiAccessKeyCache,
  verifyAiSessionToken,
} from './aiAuth.js';

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

test('accepts an authenticated application user when native WebViews cannot retain the AI cookie', () => {
  const previousKey = process.env.FDH_AI_ACCESS_KEY;
  process.env.FDH_AI_ACCESS_KEY = 'server-secret';
  resetAiAccessKeyCache();
  try {
    const request = {
      authUser: { id: 42, username: 'mobile-user' },
      header: () => '',
    };
    assert.equal(getAiAuthStatus(request as never).authenticated, true);
  } finally {
    if (previousKey === undefined) delete process.env.FDH_AI_ACCESS_KEY;
    else process.env.FDH_AI_ACCESS_KEY = previousKey;
    resetAiAccessKeyCache();
  }
});
