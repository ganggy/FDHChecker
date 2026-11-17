import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import iconv from 'iconv-lite';
import {
  claimDocument,
  cleanSssInvoiceNo,
  evaluateSssCandidate,
  explainSssCheckCode,
  normalizeSssClinic,
  normalizeSssDoctorLicense,
  normalizeSssEndDateTime,
  normalizeSssIcd10,
  resolveSssDrugCategoryAndTmt,
} from './sssClaim.js';

const valid = {
  cid: '1234567890123', pdx: 'I10', clinic: '01', hospmain: '11101', income: 100,
  charge_total: 100, charge_mismatch_count: 0, missing_bill_group_count: 0,
  missing_item_name_count: 0, mixed_hn_count: 0, visit_outcome: 'กลับบ้าน',
  doctor_license: 'ว12345', missing_drug_usage_count: 0, missing_tmlt_count: 0,
  end_datetime: '2026-08-07 10:00:00', right_begin_date: '2026-01-01', right_expire_date: '2026-12-31',
};

test('SSS candidate passes without any NHSO close-right field', () => {
  assert.deepEqual(evaluateSssCandidate(valid), []);
});

test('SSS candidate blocks invalid patient, diagnosis and charge data', () => {
  const issues = evaluateSssCandidate({ ...valid, cid: '', pdx: '', income: 0, missing_bill_group_count: 1 });
  assert.deepEqual(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code), [
    'SSS-PAT01', 'SSS-DX01', 'SSS-CHG01', 'SSS-CHG02', 'SSS-CHG03',
  ]);
});

test('SSS candidate keeps documentation gaps as warnings', () => {
  const issues = evaluateSssCandidate({ ...valid, doctor_license: '', missing_drug_usage_count: 1, missing_tmlt_count: 1 });
  assert.deepEqual(issues.map((issue) => issue.code), ['SSS-DOC01', 'SSS-DRU01', 'SSS-LAB01']);
  assert.ok(issues.every((issue) => issue.severity === 'warning'));
});

test('SSS claimDocument calculates MD5 checksum using windows-874 (cp874) bytes for Thai text', () => {
  const doc = claimDocument(
    '11101',
    'โรงพยาบาลโคกศรีสุพรรณ',
    '1246',
    1,
    '<BILLTRAN>\r\n01||2026-11-09T09:00:00|11101|691109090000|691109090000|0001234||150.00|0.00||A|1234567890123|นายทดสอบ ระบบ|11101|80|150.00||0.00\r\n</BILLTRAN>\r\n<BillItems>\r\n</BillItems>',
    new Date('2026-11-09T11:35:17'),
  );
  const cp874Buf = iconv.encode(doc, 'cp874');
  const endNoteIdx = cp874Buf.indexOf(Buffer.from('<?EndNote', 'ascii'));
  assert.ok(endNoteIdx > 0);
  const expectedMd5 = crypto.createHash('md5').update(cp874Buf.subarray(0, endNoteIdx)).digest('hex');
  const endNoteText = cp874Buf.subarray(endNoteIdx).toString('ascii');
  assert.equal(endNoteText, `<?EndNote Checksum="${expectedMd5}"?>`);
});

test('cleanSssInvoiceNo sanitizes quotes, multiple debt IDs and falls back to VN', () => {
  // Empty or quote strings should fall back to VN
  assert.equal(cleanSssInvoiceNo('""', '691109000172'), '691109000172');
  assert.equal(cleanSssInvoiceNo("''", '691109000172'), '691109000172');
  assert.equal(cleanSssInvoiceNo('   ', '691109000172'), '691109000172');
  assert.equal(cleanSssInvoiceNo(null, '691109000172'), '691109000172');
  assert.equal(cleanSssInvoiceNo(undefined, '691109000172'), '691109000172');

  // Single clean debt ID
  assert.equal(cleanSssInvoiceNo('442526', '691109000172'), '442526');

  // Quoted receipt string
  assert.equal(cleanSssInvoiceNo("'1005:12'", '691109000172'), '1005:12');

  // Multiple debt IDs should take the first one without quotes
  assert.equal(cleanSssInvoiceNo('214432,214434', '691109000172'), '214432');

  // Receipt with amount suffix should strip hash and amount
  assert.equal(cleanSssInvoiceNo('148:0649#1,030.00', '691109000172'), '148:0649');
});

test('explainSssCheckCode translates SOCDBIL codes and claimDocument supports TFlag E', () => {
  const explanations = explainSssCheckCode('C01,W05,W07,');
  assert.equal(explanations.length, 3);
  assert.ok(explanations[0].startsWith('C01:'));
  assert.ok(explanations[1].startsWith('W05:'));
  assert.ok(explanations[2].startsWith('W07:'));

  const docE = claimDocument('11101', 'รพ.โคกศรีสุพรรณ', '1249', 1, '<BILLTRAN>\r\n</BILLTRAN>', new Date('2026-11-17T14:00:00'), 'E');
  assert.ok(docE.includes('TFlag="E"'));
});

test('SSS Auto-Fix normalizers fix S15/R21, W05, W07, S18, and R51', () => {
  // S15 / R21 Doctor license
  assert.equal(normalizeSssDoctorLicense('ว.12345'), 'ว12345');
  assert.equal(normalizeSssDoctorLicense('พว.59110'), 'พ59110');
  assert.equal(normalizeSssDoctorLicense('นพ. 45678'), 'ว45678');
  assert.equal(normalizeSssDoctorLicense(''), '-');

  // W05 Clinic
  assert.equal(normalizeSssClinic('1'), '01');
  assert.equal(normalizeSssClinic('00'), '01');
  assert.equal(normalizeSssClinic('12'), '12');

  // W07 EndDateTime
  assert.equal(normalizeSssEndDateTime('2026-11-03', '09:00:00', ''), '2026-11-03T09:15:00');
  assert.equal(normalizeSssEndDateTime('2026-11-03', '09:00:00', '2026-11-03 09:00:00'), '2026-11-03T09:15:00');
  assert.equal(normalizeSssEndDateTime('2026-11-03', '09:00:00', '2026-11-03 09:25:00'), '2026-11-03T09:25:00');
  // Empty EndDateTime with drug order time (rxDateTime) should add +30 minutes from rxDateTime
  assert.equal(normalizeSssEndDateTime('2026-11-03', '09:00:00', '', '2026-11-03 09:20:00'), '2026-11-03T09:50:00');
  assert.equal(normalizeSssEndDateTime('2026-11-03', '09:00:00', null, '2026-11-03 08:25:00'), '2026-11-03T09:30:00');

  // S18 ICD-10
  assert.equal(normalizeSssIcd10('J06.9'), 'J069');
  assert.equal(normalizeSssIcd10('e11.9'), 'E119');

  // R51 TMT / PrdCat
  assert.deepEqual(resolveSssDrugCategoryAndTmt('123456', ''), { prdCat: '1', tmtId: '123456' });
  assert.deepEqual(resolveSssDrugCategoryAndTmt('', ''), { prdCat: '4', tmtId: '' });
});
