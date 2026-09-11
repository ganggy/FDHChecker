import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHerbalMedicationMatch } from '../src/utils/herbalMedicationRules.js';

test('accepts herbal medicines that match a normalized diagnosis code', () => {
  const result = evaluateHerbalMedicationMatch(['M17.9, U57'], 'ครีมไพล, เถาวัลย์เปรียง');

  assert.equal(result.status, 'valid');
  assert.deepEqual(result.wrongMedicines, []);
  assert.ok(result.matchedSymptoms.includes('ปวดกล้ามเนื้อและปวดข้อ'));
});

test('rejects a known herbal medicine when it does not match the visit diagnosis', () => {
  const result = evaluateHerbalMedicationMatch(['J00'], 'ครีมไพล');

  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.wrongMedicines, ['ครีมไพล']);
  assert.match(result.reasons.join(' '), /ยาไม่สัมพันธ์กับโรค/);
  assert.deepEqual(result.medicineRecommendations, [{
    medicine: 'ครีมไพล',
    indications: [{
      symptom: 'ปวดกล้ามเนื้อและปวดข้อ',
      diagnosisCodes: ['M179', 'M549', 'U57'],
    }],
  }]);
});

test('accepts one medicine that is configured for more than one symptom group', () => {
  const result = evaluateHerbalMedicationMatch(['G47.0'], 'น้ำมันกัญชา');

  assert.equal(result.status, 'valid');
  assert.ok(result.matchedSymptoms.includes('นอนไม่หลับ'));
});

test('allows medicines against any matching diagnosis in the visit', () => {
  const result = evaluateHerbalMedicationMatch(['J00', 'R10.1'], 'ฟ้าทะลายโจร, ขมิ้นชัน');

  assert.equal(result.status, 'valid');
  assert.deepEqual(result.wrongMedicines, []);
});

test('marks an unknown trade name for review instead of claiming it is wrong', () => {
  const result = evaluateHerbalMedicationMatch(['J00'], 'ยาสมุนไพรชื่อการค้าโรงพยาบาล');

  assert.equal(result.status, 'review');
  assert.match(result.reasons.join(' '), /ชื่อยาไม่อยู่ในตารางจับคู่/);
});

test('matches mawaeng and makham pom cough medicines with cough diagnoses', () => {
  const result = evaluateHerbalMedicationMatch(['U643'], 'มะแว้ง(Mawaeng), ยาแก้ไอมะขามป้อม');

  assert.equal(result.status, 'valid');
  assert.deepEqual(result.wrongMedicines, []);
  assert.ok(result.matchedSymptoms.includes('ไอ'));
});

test('recommends hemorrhoid diagnoses for phet sangkhat instead of constipation', () => {
  const result = evaluateHerbalMedicationMatch(['K59.0'], 'เพชรสังฆาต');

  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.medicineRecommendations[0], {
    medicine: 'เพชรสังฆาต',
    indications: [{
      symptom: 'ริดสีดวงทวารหนัก',
      diagnosisCodes: ['K640', 'K641', 'K642', 'U680'],
    }],
  });
});
