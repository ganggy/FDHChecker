---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/kidneyMonitorRules.test.ts"
source_hash: "7672d4b4f3345db8c7d28d57b23157625cc98bccc3cff2b07e6873b36537a5e1"
managed_by: "sync-ksp-vault"
---
# kidneyMonitorRules.test.ts

> Source: `server/kidneyMonitorRules.test.ts`
> SHA-256: `7672d4b4f3345db8c7d28d57b23157625cc98bccc3cff2b07e6873b36537a5e1`

````typescript
import assert from 'node:assert';
import test from 'node:test';
import {
  findKidneyTrackingIssues,
  getKidneyTrackingRight,
  isDialysisMonitorVisit,
  isKidneyUnitServiceVisit,
  summarizeKidneyTrackingVisits,
} from './kidneyMonitorRules.js';

test('keeps every visit served by the dialysis unit in the page visit scope', () => {
  assert.equal(isKidneyUnitServiceVisit({
    mainDepartment: '060',
    hasDialysisDiagnosis: 0,
    hasDialysisService: 0,
  }), true);
  assert.equal(isKidneyUnitServiceVisit({
    mainDepartment: '001',
    hasDialysisDiagnosis: 1,
    hasDialysisService: 1,
  }), false);
});

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

test('separates the four kidney tracking rights without changing evidence eligibility', () => {
  assert.equal(getKidneyTrackingRight({ hipdata_code: 'OFC', pttypeName: 'CSCD' }), 'civilServant');
  assert.equal(getKidneyTrackingRight({ hipdata_code: 'SSS', pttypeName: 'ประกันสังคม' }), 'socialSecurity');
  assert.equal(getKidneyTrackingRight({ hipdata_code: 'UCS', pttypeName: 'ผู้สูงอายุ' }), 'nhso');
  assert.equal(getKidneyTrackingRight({ hipdata_code: 'LGO', pttypeName: 'อปท.' }), 'localGovernment');
  assert.equal(getKidneyTrackingRight({ hipdata_code: '', pttypeName: 'ไม่ทราบสิทธิ' }), 'other');
});

test('summarizes sessions and distinct patients by tracking right', () => {
  const summary = summarizeKidneyTrackingVisits([
    { hn: '001', hipdata_code: 'OFC' },
    { hn: '001', hipdata_code: 'OFC' },
    { hn: '002', hipdata_code: 'SSS' },
    { hn: '003', hipdata_code: 'UCS' },
    { hn: '004', hipdata_code: 'LGO' },
  ]);

  assert.equal(summary.totalSessions, 5);
  assert.equal(summary.totalPatients, 4);
  assert.deepEqual(summary.byRight.civilServant, { sessions: 2, patients: 1 });
  assert.deepEqual(summary.byRight.socialSecurity, { sessions: 1, patients: 1 });
  assert.deepEqual(summary.byRight.nhso, { sessions: 1, patients: 1 });
  assert.deepEqual(summary.byRight.localGovernment, { sessions: 1, patients: 1 });
});

test('service-visit scope and four-right summary use the same records', () => {
  const rows = [
    { hn: '001', mainDepartment: '060', hipdata_code: 'OFC', hasDialysisDiagnosis: 1 },
    { hn: '002', mainDepartment: '060', hipdata_code: 'SSS', hasDialysisDiagnosis: 0, hasDialysisService: 0 },
    { hn: '003', mainDepartment: '001', hipdata_code: 'UCS', hasDialysisService: 1 },
  ];
  const serviceVisits = rows.filter(isKidneyUnitServiceVisit);
  const summary = summarizeKidneyTrackingVisits(serviceVisits);

  assert.equal(serviceVisits.length, 2);
  assert.equal(summary.totalSessions, serviceVisits.length);
  assert.equal(summary.byRight.civilServant.sessions + summary.byRight.socialSecurity.sessions, 2);
});

test('reports changed rights and visit-level validation issues', () => {
  const issues = findKidneyTrackingIssues([
    { hn: '001', patientName: 'ผู้ป่วยหนึ่ง', vn: 'v1', serviceDate: '2026-06-01', mainDepartment: '060', hipdata_code: 'UCS', hasDialysisDiagnosis: 1 },
    { hn: '001', patientName: 'ผู้ป่วยหนึ่ง', vn: 'v2', serviceDate: '2026-06-03', mainDepartment: '060', hipdata_code: 'OFC', hasDialysisService: 1 },
    { hn: '002', patientName: 'ผู้ป่วยสอง', vn: 'v3', serviceDate: '2026-06-04', mainDepartment: '060', hipdata_code: '', pttypeName: 'ไม่ทราบสิทธิ' },
  ]);

  assert.equal(issues.rightChanged, 1);
  assert.equal(issues.missingEvidence, 1);
  assert.equal(issues.unknownRight, 1);
  assert.equal(issues.missingHn, 0);
  assert.equal(issues.total, 3);
  assert.deepEqual(issues.issues.find((issue) => issue.kind === 'RIGHT_CHANGED')?.visits.map((visit) => visit.hipdataCode), ['UCS', 'OFC']);
});

````
