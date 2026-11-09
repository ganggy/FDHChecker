import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRepSheetZeroFix } from './repSheetZeroAutoFix.js';

test('detectRepSheetZeroFix returns empty opportunities if no VN and AN', async () => {
  const result = await detectRepSheetZeroFix({
    vn: '',
    an: '',
    hn: '12345',
  });
  assert.equal(result.canAutoFix, false);
  assert.equal(result.opportunities.length, 0);
});

test('evaluateHerbalMedicationMatch recommends diagnosis for herbal meds without matching dx', async () => {
  const { evaluateHerbalMedicationMatch } = await import('../src/utils/herbalMedicationRules.js');
  
  // Case 1: Fah Talai Jone without diagnosis -> invalid, recommends U77, J00, etc.
  const res1 = evaluateHerbalMedicationMatch([], 'ยาแคปซูลฟ้าทะลายโจร');
  assert.equal(res1.status, 'invalid');
  assert.ok(res1.medicineRecommendations.length > 0);
  const codes1 = res1.medicineRecommendations[0].indications.flatMap(i => i.diagnosisCodes);
  assert.ok(codes1.includes('J00') || codes1.includes('U77'));

  // Case 2: Fah Talai Jone with matching diagnosis J00 -> valid
  const res2 = evaluateHerbalMedicationMatch(['J00'], 'ยาแคปซูลฟ้าทะลายโจร');
  assert.equal(res2.status, 'valid');

  // Case 3: Khamin Chan without diagnosis -> invalid, recommends K297, etc.
  const res3 = evaluateHerbalMedicationMatch(['Z000'], 'ยาแคปซูลขมิ้นชัน');
  assert.equal(res3.status, 'invalid');
  assert.ok(res3.medicineRecommendations.length > 0);
});
