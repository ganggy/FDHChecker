import assert from 'node:assert/strict';
import test from 'node:test';
import { assessHerbalDiagnosisCompletion, type HerbalCompletionSnapshot } from './herbalDiagnosisCompletion.js';

const snapshot = (overrides: Partial<HerbalCompletionSnapshot> = {}): HerbalCompletionSnapshot => ({
  vn: '690000000001',
  hn: '000001',
  serviceDate: '2026-09-11',
  diagnosisCodes: [],
  herbItems: 'ครีมไพล',
  ...overrides,
});

test('offers only diagnosis codes associated with recognized herbal medicines', () => {
  const result = assessHerbalDiagnosisCompletion(snapshot());
  assert.equal(result.canComplete, true);
  assert.deepEqual(result.diagnosisCandidates.map((candidate) => candidate.code), ['M179', 'M549']);
  assert.ok(result.diagnosisCandidates.every((candidate) => candidate.medicines.includes('ครีมไพล')));
});

test('marks an existing compatible diagnosis and does not require completion', () => {
  const result = assessHerbalDiagnosisCompletion(snapshot({ diagnosisCodes: ['M17.9'] }));
  assert.equal(result.ready, true);
  assert.equal(result.diagnosisCandidates.find((candidate) => candidate.code === 'M179')?.alreadyPresent, true);
});

test('blocks automatic completion for an unknown herbal product', () => {
  const result = assessHerbalDiagnosisCompletion(snapshot({ herbItems: 'ผลิตภัณฑ์ไม่ทราบชื่อ' }));
  assert.equal(result.canComplete, false);
  assert.match(result.blockers.join(' '), /ไม่อยู่ในตารางจับคู่/);
});
