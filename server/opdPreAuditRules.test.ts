import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpdPreAuditResult, evaluateOpdPreAudit } from './opdPreAuditRules.js';

const codes = (row: Record<string, unknown>) => evaluateOpdPreAudit(row).map((issue) => issue.code);

test('OPD audit passes a documented visit with completed lab and valid charges', () => {
  assert.deepEqual(codes({ has_provider: 1, has_clinical_note: 1, has_lab_order: 1, has_lab_result: 1 }), []);
});

test('OPD audit detects missing documentation and unfinished lab', () => {
  assert.deepEqual(codes({ has_lab_order: 1 }), ['OPD-DOC01', 'OPD-DOC02', 'OPD-LAB01']);
});

test('OPD audit detects mutually exclusive OPD service charges', () => {
  assert.ok(codes({ has_provider: 1, has_clinical_note: 1, has_55020: 1, has_55021: 1 }).includes('OPD-CHG03'));
});

test('OPD audit detects observation and OPD service fee collision', () => {
  assert.ok(codes({ has_provider: 1, has_clinical_note: 1, has_observation_charge: 1, has_55020: 1 }).includes('OPD-CHG04'));
});

test('OPD audit warns when any S diagnosis has fewer than five characters', () => {
  const findings = evaluateOpdPreAudit({
    has_provider: 1,
    has_clinical_note: 1,
    main_diag: 'S06.0',
    diagnosis_codes: 'J189,S06.0,S0999',
  });

  assert.deepEqual(findings, [{
    code: 'OPD-DX01',
    message: 'รหัสวินิจฉัยกลุ่ม S ต้องมีอย่างน้อย 5 หลักหลังตัดจุด: S060',
    severity: 'warning',
  }]);
});

test('OPD audit accepts five-character S diagnoses after removing punctuation', () => {
  assert.deepEqual(codes({
    has_provider: 1,
    has_clinical_note: 1,
    diagnosis_codes: 'S06.00, S0999',
  }), []);
});

test('IPD rows are outside OPD audit scope', () => {
  assert.deepEqual(codes({ an: '6600001' }), []);
  assert.equal(buildOpdPreAuditResult({ serviceType: 'ผู้ป่วยใน' }), null);
});

test('OPD audit returns a summarized API result', () => {
  assert.deepEqual(buildOpdPreAuditResult({
    serviceType: 'ผู้ป่วยนอก',
    has_provider: 1,
    has_clinical_note: 1,
    has_lab_order: 1,
    has_lab_result: 1,
  }), {
    status: 'clear',
    findingCount: 0,
    blockingCount: 0,
    reviewCount: 0,
    findings: [],
  });

  const blocked = buildOpdPreAuditResult({ serviceType: 'OPD', has_lab_order: 1 });
  assert.equal(blocked?.status, 'blocking');
  assert.equal(blocked?.blockingCount, 1);
  assert.equal(blocked?.reviewCount, 2);
});
