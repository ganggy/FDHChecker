import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import iconv from 'iconv-lite';
import { claimDocument, cleanSssInvoiceNo, evaluateSssCandidate } from './sssClaim.js';

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
