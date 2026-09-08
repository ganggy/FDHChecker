import assert from 'node:assert/strict';
import test from 'node:test';
import { getWalkinConfirmationText, validateUcWalkinRange } from './ucOutsideCupWalkin.js';

test('UC WALKIN range starts from fiscal year 2568', () => {
  assert.deepEqual(validateUcWalkinRange('2024-10-01', '2025-09-30'), { startDate: '2024-10-01', endDate: '2025-09-30' });
  assert.throws(() => validateUcWalkinRange('2024-09-30', '2025-09-30'), /2568/);
});

test('UC WALKIN confirmation includes the exact current count', () => {
  assert.equal(getWalkinConfirmationText(8581), 'เพิ่ม WALKIN 8581 รายการ');
});
