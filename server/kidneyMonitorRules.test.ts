import assert from 'node:assert';
import test from 'node:test';
import { isDialysisMonitorVisit } from './kidneyMonitorRules.js';

test('excludes an unrelated PP visit assigned to dialysis department', () => {
  assert.equal(isDialysisMonitorVisit({
    mainDepartment: '060',
    hasDialysisDiagnosis: 0,
    hasDialysisService: 0,
  }), false);
});

test('includes dialysis department visits with diagnosis or service evidence', () => {
  assert.equal(isDialysisMonitorVisit({
    mainDepartment: '060',
    hasDialysisDiagnosis: 1,
    hasDialysisService: 0,
  }), true);
  assert.equal(isDialysisMonitorVisit({
    mainDepartment: '060',
    hasDialysisDiagnosis: 0,
    hasDialysisService: '1',
  }), true);
});

test('excludes dialysis evidence recorded outside the dialysis department', () => {
  assert.equal(isDialysisMonitorVisit({
    mainDepartment: '001',
    hasDialysisDiagnosis: 1,
    hasDialysisService: 1,
  }), false);
});
