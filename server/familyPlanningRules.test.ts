import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFamilyPlanningEvidence } from '../src/utils/familyPlanningRules.js';

test('family-planning removal requires Z308 and ICD-9 8605', () => {
  assert.deepEqual(evaluateFamilyPlanningEvidence({ diagnosisCodes: 'Z308', adpCodes: 'FP002_2' }).missing, ['FP002_2: ICD-9 8605']);
  assert.equal(evaluateFamilyPlanningEvidence({ diagnosisCodes: 'Z308', adpCodes: 'FP002_2', procedureCodes: '8605' }).matched, true);
});

test('all contraceptive medicine codes require Z304', () => {
  for (const code of ['FP003_1', 'FP003_2', 'FP003_3', 'FP003_4']) {
    assert.deepEqual(evaluateFamilyPlanningEvidence({ diagnosisCodes: 'Z308', adpCodes: code }, [code]).missing, [`${code}: Diagnosis Z304`]);
    assert.equal(evaluateFamilyPlanningEvidence({ diagnosisCodes: 'Z304', adpCodes: code }, [code]).matched, true);
  }
});

test('other existing FP services retain the generic Z30 pairing', () => {
  assert.equal(evaluateFamilyPlanningEvidence({ diagnosisCodes: 'Z301', adpCodes: 'FP001' }).matched, true);
  assert.deepEqual(evaluateFamilyPlanningEvidence({ adpCodes: 'FP001' }).missing, ['FP001: Diagnosis Z30x']);
});

test('emergency pill and injection enforce annual limits', () => {
  assert.deepEqual(evaluateFamilyPlanningEvidence({ diagnosisCodes: 'Z304', adpCodes: 'FP003_3', emergencyPillYearQuantity: 3 }).missing, ['FP003_3: เกิน 2 แผง/ปี (พบ 3)']);
  assert.deepEqual(evaluateFamilyPlanningEvidence({ diagnosisCodes: 'Z304', adpCodes: 'FP003_4', injectionYearCount: 6 }).missing, ['FP003_4: เกิน 5 ครั้ง/ปี (พบ 6)']);
});
