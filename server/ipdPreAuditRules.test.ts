import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateIpdPreAudit } from './ipdPreAuditRules.js';

test('flags J44.0 without a respiratory infection code', () => {
  const result = evaluateIpdPreAudit({ diagnoses: ['J44.0'], principalDiagnosis: 'J44.0' });
  assert.equal(result.status, 'risk');
  assert.equal(result.findings[0]?.code, 'CR13_1');
});

test('accepts the COPD infection pairing without a coding risk', () => {
  const result = evaluateIpdPreAudit({ diagnoses: ['J44.0', 'J18.9'], principalDiagnosis: 'J44.0' });
  assert.equal(result.status, 'clear');
});

test('checks PTCA vessel count and stent count/type pairing', () => {
  const result = evaluateIpdPreAudit({ procedures: ['00.66', '00.45'] });
  assert.equal(result.status, 'risk');
  assert.deepEqual(result.findings.map((finding) => finding.code), ['CR58', 'CR58']);
});

test('marks sepsis as chart review and septic shock without sepsis as risk', () => {
  const sepsis = evaluateIpdPreAudit({ diagnoses: ['A41.9'] });
  assert.equal(sepsis.status, 'risk');
  assert.equal(sepsis.findings.some((finding) => finding.code === 'CR1'), true);
  assert.equal(sepsis.findings.some((finding) => finding.code === 'INS-T15'), true);
  const shock = evaluateIpdPreAudit({ diagnoses: ['R57.2'] });
  assert.equal(shock.status, 'risk');
  assert.equal(shock.findings.some((finding) => finding.code === 'CR37'), true);
});

test('flags redundant volume overload with heart failure', () => {
  const result = evaluateIpdPreAudit({ diagnoses: ['E87.7', 'I50.0'] });
  assert.equal(result.status, 'risk');
  assert.equal(result.findings[0]?.code, 'CR8');
});

test('blocks missing principal diagnosis and invalid discharge time', () => {
  const result = evaluateIpdPreAudit({
    includeDocumentAudit: true,
    diagnoses: ['J18.9'],
    admissionAt: '2026-08-04 10:00:00',
    dischargeAt: '2026-08-04 09:00:00',
  });
  assert.equal(result.status, 'risk');
  assert.deepEqual(result.findings.slice(0, 2).map((finding) => finding.code), ['IPD-DOC01', 'IPD-DOC02']);
});

test('reviews short stay, procedures and active cancer documentation', () => {
  const result = evaluateIpdPreAudit({
    includeDocumentAudit: true,
    diagnoses: ['C50.9'],
    principalDiagnosis: 'C50.9',
    procedures: ['85.21'],
    admissionAt: '2026-08-04 08:00:00',
    dischargeAt: '2026-08-04 16:00:00',
  });
  assert.equal(result.status, 'review');
  assert.deepEqual(result.findings.map((finding) => finding.code), ['IPD-DOC03', 'IPD-DOC05', 'IPD-DOC06']);
});

test('flags possible split admission within 24 hours', () => {
  const result = evaluateIpdPreAudit({
    includeDocumentAudit: true,
    diagnoses: ['J18.9'],
    principalDiagnosis: 'J18.9',
    admissionAt: '2026-08-04 08:00:00',
    dischargeAt: '2026-08-05 12:00:00',
    previousDischargeAt: '2026-08-03 20:00:00',
  });
  assert.equal(result.status, 'risk');
  assert.equal(result.findings[0]?.code, 'IPD-DOC04');
});

test('applies sex and newborn restrictions from hospital insurance audit', () => {
  const femaleOnly = evaluateIpdPreAudit({ diagnoses: ['N80.0'], sex: '1', ageDays: 10000 });
  assert.equal(femaleOnly.findings.some((finding) => finding.code === 'INS-IPD03'), true);

  const maleOnly = evaluateIpdPreAudit({ diagnoses: ['N40.0'], sex: '2' });
  assert.equal(maleOnly.findings.some((finding) => finding.code === 'INS-T17'), true);

  const newborn = evaluateIpdPreAudit({ diagnoses: ['P07.0', 'Z38.0'], sex: '1', ageDays: 30 });
  assert.deepEqual(newborn.findings.filter((finding) => ['INS-IPD10', 'INS-T19'].includes(finding.code)).map((finding) => finding.code), ['INS-IPD10', 'INS-T19']);
});

test('requires external causes and validates delivery principal coding', () => {
  const injury = evaluateIpdPreAudit({ diagnoses: ['S37.4'], sex: '2' });
  assert.equal(injury.findings.some((finding) => finding.code === 'INS-IPD04'), true);

  const injuryWithCause = evaluateIpdPreAudit({ diagnoses: ['S37.4', 'V89.2'], sex: '2' });
  assert.equal(injuryWithCause.findings.some((finding) => finding.code === 'INS-IPD04'), false);

  const delivery = evaluateIpdPreAudit({ diagnoses: ['O80.0', 'O72.1'], principalDiagnosis: 'O80.0', sex: '2' });
  assert.equal(delivery.findings.some((finding) => finding.code === 'INS-IPD05'), true);
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['T31.2'], principalDiagnosis: 'T31.2' }).findings.some((finding) => finding.code === 'INS-IPD06'), true);
});

test('requires five-character injury and external-cause diagnosis codes', () => {
  const incomplete = evaluateIpdPreAudit({ diagnoses: ['S37.4', 'W19'] });
  const finding = incomplete.findings.find((item) => item.code === 'INS-IPD04A');
  assert.deepEqual(finding?.evidence, ['S374', 'W19']);

  const complete = evaluateIpdPreAudit({ diagnoses: ['S37.40', 'W19.00'] });
  assert.equal(complete.findings.some((item) => item.code === 'INS-IPD04A'), false);
});

test('checks required and mutually exclusive diagnosis pairs', () => {
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['B45.1'] }).findings.some((finding) => finding.code === 'INS-IPD07'), true);
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['B45.1', 'G02.1'] }).findings.some((finding) => finding.code === 'INS-IPD07'), false);
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['Z21', 'B20.0'] }).findings.some((finding) => finding.code === 'INS-IPD08'), true);
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['E11.9', 'R73.9'] }).findings.some((finding) => finding.code === 'INS-IPD09'), true);
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['Z37.0'], sex: '2' }).findings.some((finding) => finding.code === 'INS-IPD11'), true);
});

test('checks local insurance evidence for medicine lab imaging and referral', () => {
  const missingEvidence = evaluateIpdPreAudit({ diagnoses: ['J11.1', 'J10.1', 'I63.9', 'I64'] });
  assert.deepEqual(
    missingEvidence.findings.filter((finding) => ['INS-T10', 'INS-T11', 'INS-T13', 'INS-T14'].includes(finding.code)).map((finding) => finding.code),
    ['INS-T10', 'INS-T11', 'INS-T13', 'INS-T14'],
  );
  const completeEvidence = evaluateIpdPreAudit({ diagnoses: ['J11.1', 'J10.1', 'I63.9', 'I64'], hasTamiflu: 1, hasInfluenzaTest: 1, hasCtScan: 1, hasReferral: 1 });
  assert.equal(completeEvidence.findings.some((finding) => ['INS-T10', 'INS-T11', 'INS-T13', 'INS-T14'].includes(finding.code)), false);
});

test('checks hospital insurance table rules and transfusion support', () => {
  const result = evaluateIpdPreAudit({ diagnoses: ['D68.9', 'I69.3', 'L89'], principalDiagnosis: 'I69.3', procedures: ['99.04'] });
  for (const expected of ['INS-T01', 'INS-T07', 'INS-T09', 'INS-T20']) {
    assert.equal(result.findings.some((finding) => finding.code === expected), true, expected);
  }
  assert.equal(evaluateIpdPreAudit({ diagnoses: ['D64.9'], procedures: ['99.04'] }).findings.some((finding) => finding.code === 'INS-T20'), false);
});
