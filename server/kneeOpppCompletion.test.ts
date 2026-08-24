import test from 'node:test';
import assert from 'node:assert/strict';
import { assessKneeCompletion } from './kneeOpppCompletion.js';

const base = {
  vn: '1', hn: '1', serviceDate: '2026-04-01', ageY: 61, hipdataCode: 'UCS',
  hasM17: true, hasU5753: true,
  existingCodes: ['8737835'] as Array<'8727811' | '8737811' | '8747811' | '8737835'>,
  healthMedServiceId: 10, healthMedProviderId: 20, healthMedDoctorId: 30,
  poulticeSameDayCount: 1, poulticeMax14DayCount: 1,
};

test('allows completion when an existing poultice proves clinical service evidence', () => {
  const result = assessKneeCompletion(base);
  assert.equal(result.canComplete, true);
  assert.deepEqual(result.missingOperations, ['8727811', '8737811', '8747811']);
});

test('blocks automatic completion for diagnosis-only visits', () => {
  const result = assessKneeCompletion({
    ...base,
    existingCodes: [],
    healthMedServiceId: null,
    healthMedProviderId: null,
    poulticeSameDayCount: 0,
    poulticeMax14DayCount: 1,
  });
  assert.equal(result.canComplete, false);
  assert.equal(result.canCreateService, true);
  assert.match(result.blockers.join(' '), /หลักฐาน/);
});

test('allows confirmed completion when an empty service record already exists', () => {
  const result = assessKneeCompletion({
    ...base,
    existingCodes: [],
    healthMedServiceId: 10,
    healthMedProviderId: null,
    healthMedDoctorId: null,
    poulticeSameDayCount: 0,
    poulticeMax14DayCount: 1,
  });
  assert.equal(result.canComplete, false);
  assert.equal(result.canCreateService, true);
});

test('does not offer changes for a complete eligible visit', () => {
  const result = assessKneeCompletion({ ...base, existingCodes: ['8727811', '8737811', '8747811', '8737835'] });
  assert.equal(result.ready, true);
  assert.equal(result.canComplete, false);
  assert.deepEqual(result.missingOperations, []);
});

test('blocks adding poultice when the proposed visit would exceed the 14-day limit', () => {
  const result = assessKneeCompletion({
    ...base,
    existingCodes: ['8727811', '8737811', '8747811'],
    poulticeSameDayCount: 0,
    poulticeMax14DayCount: 6,
  });
  assert.equal(result.canComplete, false);
  assert.match(result.blockers.join(' '), /5 ครั้ง/);
});

test('never invents an unspecified M17 diagnosis', () => {
  const result = assessKneeCompletion({ ...base, hasM17: false });
  assert.equal(result.canComplete, false);
  assert.match(result.blockers.join(' '), /ผู้วินิจฉัย/);
});
