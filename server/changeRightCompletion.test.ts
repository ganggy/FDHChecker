import test from 'node:test';
import assert from 'node:assert/strict';
import { assessChangeRightCompletion, type ChangeRightCompletionSnapshot } from './changeRightCompletion.js';

const baseSnapshot = (overrides: Partial<ChangeRightCompletionSnapshot> = {}): ChangeRightCompletionSnapshot => ({
  vn: '691109000223',
  hn: '00001',
  an: '',
  serviceDate: '2026-11-09',
  pttype: '89',
  hipdataCode: 'UCS',
  hospmain: '11101',
  hospitalCode: '11101',
  beginDate: '2026-11-09',
  daysSinceBegin: 0,
  ucaeCode: 'C',
  hadPrevOtherHmain: true,
  prevHospmain: '10710',
  zeroPriceWalkinCount: 0,
  zeroPriceWalkinIcodes: [],
  allowFirstVisitConfirm: false,
  ...overrides,
});

test('assessChangeRightCompletion marks visit ready when UCAE=C, own HMAIN, and no WALKIN', () => {
  const res = assessChangeRightCompletion(baseSnapshot());
  assert.equal(res.ready, true);
  assert.equal(res.canComplete, false);
  assert.deepEqual(res.missing, []);
  assert.deepEqual(res.blockers, []);
});

test('assessChangeRightCompletion flags missing UCAE=C as auto-completable within 15 days when prior HMAIN differs', () => {
  const res = assessChangeRightCompletion(baseSnapshot({ ucaeCode: '', daysSinceBegin: 5, hadPrevOtherHmain: true }));
  assert.equal(res.ready, false);
  assert.equal(res.canComplete, true);
  assert.equal(res.needsUcaeC, true);
  assert.equal(res.needsWalkinCleanup, false);
});

test('assessChangeRightCompletion allows cleaning conflicting zero-price WALKIN even when UCAE=C already set', () => {
  const res = assessChangeRightCompletion(baseSnapshot({
    ucaeCode: 'C',
    daysSinceBegin: 200,
    hadPrevOtherHmain: false,
    zeroPriceWalkinCount: 1,
    zeroPriceWalkinIcodes: ['3010982'],
  }));
  assert.equal(res.ready, false);
  assert.equal(res.canComplete, true);
  assert.equal(res.needsUcaeC, false);
  assert.equal(res.needsWalkinCleanup, true);
});

test('assessChangeRightCompletion blocks missing UCAE=C without prior other HMAIN unless explicitly confirmed', () => {
  const blocked = assessChangeRightCompletion(baseSnapshot({
    ucaeCode: '',
    daysSinceBegin: 0,
    hadPrevOtherHmain: false,
    prevHospmain: '',
    allowFirstVisitConfirm: false,
  }));
  assert.equal(blocked.canComplete, false);
  assert.match(blocked.blockers[0] || '', /ไม่พบประวัติ hospmain/);

  const confirmed = assessChangeRightCompletion(baseSnapshot({
    ucaeCode: '',
    daysSinceBegin: 0,
    hadPrevOtherHmain: false,
    prevHospmain: '',
    allowFirstVisitConfirm: true,
  }));
  assert.equal(confirmed.canComplete, true);
});

test('assessChangeRightCompletion blocks IPD, non-UC, and foreign HMAIN visits', () => {
  const ipd = assessChangeRightCompletion(baseSnapshot({ an: '690001', ucaeCode: '' }));
  assert.equal(ipd.canComplete, false);

  const nonUc = assessChangeRightCompletion(baseSnapshot({ hipdataCode: 'OFC', ucaeCode: '' }));
  assert.equal(nonUc.canComplete, false);

  const foreign = assessChangeRightCompletion(baseSnapshot({ hospmain: '10710', ucaeCode: '' }));
  assert.equal(foreign.canComplete, false);
});
