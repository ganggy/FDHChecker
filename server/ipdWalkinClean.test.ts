import assert from 'node:assert/strict';
import test from 'node:test';
import { isWalkinAdpItem, filterIpdWalkinFromAdp } from './ipdWalkinClean.js';

test('isWalkinAdpItem correctly identifies WALKIN items', () => {
  assert.equal(isWalkinAdpItem('WALKIN'), true);
  assert.equal(isWalkinAdpItem('walkin'), true);
  assert.equal(isWalkinAdpItem('WALKIN_FEE'), true);
  assert.equal(isWalkinAdpItem('55020', '3002598', '3002598'), true);
  assert.equal(isWalkinAdpItem('', '3002598', '3002598'), true);
  assert.equal(isWalkinAdpItem('3002598', '', '3002598'), true);

  assert.equal(isWalkinAdpItem('55021', '3001234', '3002598'), false);
  assert.equal(isWalkinAdpItem('S1801'), false);
  assert.equal(isWalkinAdpItem(''), false);
});

test('filterIpdWalkinFromAdp removes WALKIN from IPD export', () => {
  const adpRows = [
    { HN: '001', AN: '6700001', CODE: 'WALKIN', RATE: 0 },
    { HN: '001', AN: '6700001', CODE: '55020', _ICODE: '3002598', RATE: 0 },
    { HN: '001', AN: '6700001', CODE: '55021', RATE: 100 },
    { HN: '002', AN: '', CODE: 'WALKIN', RATE: 0 },
  ];

  // IPD export
  const ipdFiltered = filterIpdWalkinFromAdp(adpRows, { isIpdExport: true, walkinIcode: '3002598' });
  assert.equal(ipdFiltered.length, 1);
  assert.equal(ipdFiltered[0].CODE, '55021');

  // Any row with AN should have WALKIN removed even if isIpdExport is false
  const genericFiltered = filterIpdWalkinFromAdp(adpRows, { isIpdExport: false, walkinIcode: '3002598' });
  assert.equal(genericFiltered.length, 2);
  assert.equal(genericFiltered.some(r => r.AN === '6700001' && r.CODE === 'WALKIN'), false);
  assert.equal(genericFiltered.some(r => r.AN === '6700001' && r._ICODE === '3002598'), false);
  // OPD row without AN preserved
  assert.equal(genericFiltered.some(r => r.AN === '' && r.CODE === 'WALKIN'), true);
});
