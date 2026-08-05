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

test('loads the authoritative REP error guidance', () => {
  assert.match(loadErrorCatalog()['116'].description, /เลขบัตรประชาชน/);
});
