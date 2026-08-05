---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiErrorTools.test.ts"
source_hash: "3e32e802d978c629a0ebba5ecd9dbd7757ac0d374d428f011e2148de44c087ba"
managed_by: "sync-ksp-vault"
---
# aiErrorTools.test.ts

> Source: `server/aiErrorTools.test.ts`
> SHA-256: `3e32e802d978c629a0ebba5ecd9dbd7757ac0d374d428f011e2148de44c087ba`

````typescript
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

````
