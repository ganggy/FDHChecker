import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewPalliativeCareVisit } from '../src/utils/palliativeCareReview.js';

test('accepts a qualifying home palliative visit', () => {
  const result = reviewPalliativeCareVisit({
    z515Code: 'Z515',
    isHomeVisit: 1,
    hasPalliativeAdp: 'Y',
    hasEligibleDiseaseDiagnosis: 1,
  });
  assert.equal(result.qualifiesForService, true);
  assert.equal(result.shouldReview, false);
  assert.equal(result.canMarkAsHomeVisit, false);
});

test('offers home-visit correction only when every other palliative criterion is complete', () => {
  const result = reviewPalliativeCareVisit({
    z515Code: 'Z515',
    z718Code: 'Z718',
    isHomeVisit: 0,
    hasPalliativeAdp: 1,
    hasEligibleDiseaseDiagnosis: 1,
  });
  assert.equal(result.qualifiesForService, false);
  assert.equal(result.canMarkAsHomeVisit, true);
  assert.deepEqual(result.reasons, ['ไม่ใช่ visit เยี่ยมบ้าน']);
});

test('flags a hospital visit with medicines as a possible medication pickup', () => {
  const result = reviewPalliativeCareVisit({
    z515Code: 'Z515',
    isHomeVisit: 0,
    hasPalliativeAdp: 0,
    hasEligibleDiseaseDiagnosis: 1,
    drugCount: 3,
  });
  assert.equal(result.shouldReview, true);
  assert.equal(result.canRemoveDiagnosis, true);
  assert.equal(result.canMarkAsHomeVisit, false);
  assert.equal(result.visitKind, 'possible-medication-pickup');
  assert.ok(result.reasons.includes('ไม่ใช่ visit เยี่ยมบ้าน'));
});

test('flags Z71.8 recorded without Z51.5', () => {
  const result = reviewPalliativeCareVisit({
    z718Code: 'Z718',
    isHomeVisit: 1,
    hasPalliativeAdp: 1,
    hasEligibleDiseaseDiagnosis: 1,
  });
  assert.equal(result.shouldReview, true);
  assert.equal(result.canRemoveDiagnosis, false);
  assert.ok(result.reasons.includes('ไม่มี Z51.5 (Z71.8 ใช้เดี่ยวไม่ได้)'));
});

test('offers review and removal for palliative service items without Z51.5 or Z71.8', () => {
  const result = reviewPalliativeCareVisit({
    isHomeVisit: false,
    hasPalliativeAdp: true,
    hasEligibleDiseaseDiagnosis: false,
    drugCount: 0,
  });

  assert.equal(result.hasPalliativeDiagnosis, false);
  assert.equal(result.qualifiesForService, false);
  assert.equal(result.shouldReview, true);
  assert.equal(result.canRemoveDiagnosis, false);
});
