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

test('offers home-visit correction when palliative evidence exists and visit is not home visit', () => {
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
  assert.equal(result.canMarkAsHomeVisit, true);
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
  assert.equal(result.canMarkAsHomeVisit, true);
});

test('qualifies morphine dispensing visit with Z51.5 without requiring Cons01/Eva01 or home visit', () => {
  const result = reviewPalliativeCareVisit({
    z515Code: 'Z515',
    hasMorphine: true,
    morphineNames: 'MORPHINE',
    isHomeVisit: 0,
    hasPalliativeAdp: 0,
    hasEligibleDiseaseDiagnosis: 0,
  });

  assert.equal(result.hasMorphine, true);
  assert.equal(result.qualifiesForService, true);
  assert.equal(result.shouldReview, false);
  assert.equal(result.canRemoveDiagnosis, false); // Must never delete diagnosis for morphine patient
  assert.equal(result.visitKind, 'palliative-morphine');
  assert.equal(result.isMorphineDispensingOnly, true);
  assert.equal(result.reasons.length, 0);
});

test('qualifies morphine dispensing visit with Z71.8', () => {
  const result = reviewPalliativeCareVisit({
    z718Code: 'Z718',
    hasMorphine: true,
    morphineNames: 'morphine (Prolong release: MST)',
    isHomeVisit: 0,
    hasPalliativeAdp: 0,
  });

  assert.equal(result.hasMorphine, true);
  assert.equal(result.qualifiesForService, true);
  assert.equal(result.shouldReview, false);
  assert.equal(result.canRemoveDiagnosis, false);
});

test('flags morphine dispensing visit when missing Z51.5 / Z71.8', () => {
  const result = reviewPalliativeCareVisit({
    hasMorphine: true,
    morphineNames: 'Morphine sulfate',
    isHomeVisit: 0,
    hasPalliativeAdp: 0,
  });

  assert.equal(result.hasMorphine, true);
  assert.equal(result.qualifiesForService, false);
  assert.equal(result.shouldReview, true);
  assert.equal(result.canRemoveDiagnosis, false); // Even without dx, don't allow delete
  assert.ok(result.reasons.some((r) => r.includes('ขาดรหัสวินิจฉัย Z51.5 หรือ Z71.8')));
});

