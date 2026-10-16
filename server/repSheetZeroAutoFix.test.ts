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

test('verifyVisitIdentityForAutoFix rejects mismatched HCODE, HN, CID, or serviceDate before auto-complete', async () => {
  const { verifyVisitIdentityForAutoFix } = await import('./repSheetZeroAutoFix.js');
  const mockConn = {
    async query(sql: string) {
      if (sql.includes('opdconfig')) {
        return [[{ hospitalcode: '04567' }]];
      }
      if (sql.includes('FROM ovst')) {
        return [[{ vn: '690807101500', hn: '0000123', cid: '1100100100101', vstdate_str: '2026-08-07', vstdate: '2026-08-07', vsttime: '09:00:00', doctor: '900', claim_code: '' }]];
      }
      return [[]];
    },
  };
  const has = () => true;

  // Exact match passes
  const okResult = await verifyVisitIdentityForAutoFix(mockConn, has, {
    vn: '690807101500',
    hn: '123',
    cid: '1100100100101',
    serviceDate: '2026-08-07',
    hcode: '04567',
  });
  assert.equal(okResult.verified, true);

  // Mismatched HCODE fails
  const wrongHcode = await verifyVisitIdentityForAutoFix(mockConn, has, {
    vn: '690807101500',
    hn: '123',
    hcode: '10999',
  });
  assert.equal(wrongHcode.verified, false);
  assert.match(wrongHcode.reason || '', /รหัสหน่วยบริการ/);

  // Mismatched HN fails
  const wrongHn = await verifyVisitIdentityForAutoFix(mockConn, has, {
    vn: '690807101500',
    hn: '9999999',
    hcode: '04567',
  });
  assert.equal(wrongHn.verified, false);
  assert.match(wrongHn.reason || '', /HN/);

  // Mismatched serviceDate fails
  const wrongDate = await verifyVisitIdentityForAutoFix(mockConn, has, {
    vn: '690807101500',
    hn: '123',
    serviceDate: '2026-08-08',
    hcode: '04567',
  });
  assert.equal(wrongDate.verified, false);
  assert.match(wrongDate.reason || '', /วันที่รับบริการ/);
});

