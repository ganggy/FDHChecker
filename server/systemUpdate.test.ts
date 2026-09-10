import assert from 'node:assert/strict';
import test from 'node:test';
import { validateUpdateBranch } from './systemUpdate.js';

test('accepts normal deployment branch names', () => {
  assert.equal(validateUpdateBranch('main'), true);
  assert.equal(validateUpdateBranch('agent/add-local-ai'), true);
  assert.equal(validateUpdateBranch('release/2026.09'), true);
});

test('rejects branch traversal and shell metacharacters', () => {
  assert.equal(validateUpdateBranch('../main'), false);
  assert.equal(validateUpdateBranch('release/../../main'), false);
  assert.equal(validateUpdateBranch('main; reboot'), false);
  assert.equal(validateUpdateBranch('$(whoami)'), false);
});
