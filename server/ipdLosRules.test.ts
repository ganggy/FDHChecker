import assert from 'node:assert/strict';
import test from 'node:test';
import { assessIpdLos, findIpdLosRule, normalizeIpdLosRules, validateIpdLosRules } from './ipdLosRules.js';

const rules = normalizeIpdLosRules([
  { id: 'pneumonia', diagnosisCode: 'J18', matchType: 'prefix', targetLos: 5, note: 'Pneumonia', active: true },
  { id: 'exact', diagnosisCode: 'J18.9', matchType: 'exact', targetLos: 4, active: true },
  { id: 'disabled', diagnosisCode: 'A41', matchType: 'prefix', targetLos: 7, active: false },
]);

test('normalizes ICD-10 punctuation and prefers an exact LOS rule', () => {
  assert.equal(findIpdLosRule('j18.9', rules)?.id, 'exact');
  assert.equal(findIpdLosRule('J18.0', rules)?.id, 'pneumonia');
  assert.equal(findIpdLosRule('A41.9', rules), null);
});

test('assesses actual LOS against the configured target', () => {
  assert.deepEqual(assessIpdLos('J18.9', 6, rules), {
    los_target: 4,
    los_variance: 2,
    los_status: 'over',
    los_rule_code: 'J189',
    los_rule_match_type: 'exact',
    los_rule_note: null,
  });
  assert.equal(assessIpdLos('J18.0', 3, rules).los_status, 'within');
  assert.equal(assessIpdLos('I10', 2, rules).los_status, 'no_rule');
});

test('rejects duplicate and invalid LOS rules', () => {
  assert.equal(validateIpdLosRules([{ diagnosisCode: 'J18', matchType: 'prefix', targetLos: 0 }]).ok, false);
  assert.equal(validateIpdLosRules([
    { diagnosisCode: 'J18', matchType: 'prefix', targetLos: 5 },
    { diagnosisCode: 'J18', matchType: 'prefix', targetLos: 6 },
  ]).ok, false);
});
