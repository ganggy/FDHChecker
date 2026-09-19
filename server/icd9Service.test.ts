import test from 'node:test';
import assert from 'node:assert/strict';
import { getIcd9Chapter, getIcd9FundTags, ICD9_CHAPTERS } from './icd9Service.js';

test('ICD-9 Chapter categorization', () => {
  assert.equal(getIcd9Chapter('1341').startsWith('08-16'), true);
  assert.equal(getIcd9Chapter('4523').startsWith('42-54'), true);
  assert.equal(getIcd9Chapter('8931').startsWith('87-99'), true);
  assert.equal(getIcd9Chapter('9654').startsWith('87-99'), true);
  assert.equal(getIcd9Chapter('2309').startsWith('21-29'), true);
  assert.equal(getIcd9Chapter('9923').startsWith('87-99'), true);
  assert.equal(getIcd9Chapter('6373').startsWith('60-64'), true);
  assert.equal(getIcd9Chapter('6639').startsWith('65-71'), true);
});

test('ICD-9 Fund tags detection', () => {
  const cataract = getIcd9FundTags('1341', 'Phacoemulsification and aspiration of cataract');
  assert.ok(cataract.includes('ผ่าตัดต้อกระจก'));

  const colonoscopy = getIcd9FundTags('4523', 'Flexible fiberoptic colonoscopy');
  assert.ok(colonoscopy.includes('ส่องกล้องระบบทางเดินอาหาร'));

  const dentalClean = getIcd9FundTags('9654', 'Dental prophylaxis');
  assert.ok(dentalClean.includes('ทันตกรรม'));
  assert.ok(dentalClean.includes('ทันตกรรมหญิงตั้งครรภ์ (ANC)'));

  const fp = getIcd9FundTags('9923', 'Injection of steroid');
  assert.ok(fp.includes('วางแผนครอบครัว (FP)'));

  const knee = getIcd9FundTags('8154', 'Total knee replacement');
  assert.ok(knee.includes('ผ่าตัดข้อเข่า'));
});
