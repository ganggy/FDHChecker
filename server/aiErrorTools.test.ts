import assert from 'node:assert/strict';
import test from 'node:test';
import { loadErrorCatalog, parseErrorAnalysisIntent } from './aiErrorTools.js';

test('recognizes a REP error code question', () => {
  assert.deepEqual(parseErrorAnalysisIntent('รหัส 116 แก้อย่างไร'), { codes: ['116'] });
});

test('recognizes a VN error investigation without treating the VN as an error code', () => {
  assert.deepEqual(parseErrorAnalysisIntent('ตรวจข้อผิดพลาด VN 670000123456'), {
    codes: [], vn: '670000123456',
  });
});

test('does not mistake ICD-10 codes in a report request for REP errors', () => {
  assert.equal(
    parseErrorAnalysisIntent('ขอรายชื่อผู้ป่วย วันที่รับบริการ และรหัสโรค ที่มี ICD-10 ตั้งแต่ O240 ถึง O249 ในปีงบประมาณ 2569 ส่งออกเป็น Excel'),
    null,
  );
});

test('loads the authoritative REP error guidance', () => {
  assert.match(loadErrorCatalog()['116'].description, /เลขบัตรประชาชน/);
});
