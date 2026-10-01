import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRepSheetZeroFix } from './repSheetZeroAutoFix.js';

test('detectRepSheetZeroFix returns empty opportunities if no VN and AN', async () => {
  const result = await detectRepSheetZeroFix({
    vn: '',
    an: '',
    hn: '12345',
  });
  assert.equal(result.canAutoFix, false);
  assert.equal(result.opportunities.length, 0);
});
