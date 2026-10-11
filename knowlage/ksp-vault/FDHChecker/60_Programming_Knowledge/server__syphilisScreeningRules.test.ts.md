---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/syphilisScreeningRules.test.ts"
source_hash: "a41f064a14842c50dfe8088bf652154f7048fc750e4530a8f81e93e993c3c515"
managed_by: "sync-ksp-vault"
---
# syphilisScreeningRules.test.ts

> Source: `server/syphilisScreeningRules.test.ts`
> SHA-256: `a41f064a14842c50dfe8088bf652154f7048fc750e4530a8f81e93e993c3c515`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSyphilisScreeningAdpCode,
  isSyphilisScreeningName,
} from '../src/utils/syphilisScreeningRules.js';

test('accepts actual syphilis screening service and laboratory names', () => {
  for (const name of [
    'TPHA 36006',
    'VDRL(RPR) 36003',
    'Treponema Pallidum Antibody',
    'RPR Titer',
    'Syphilis screening',
    'ตรวจคัดกรองซิฟิลิส',
  ]) assert.equal(isSyphilisScreeningName(name), true, name);
});

test('does not match RPR letters embedded inside unrelated names', () => {
  for (const name of ['Interpretation', 'chlorpromazine.', 'PERPHENAZINE', 'urine protein']) {
    assert.equal(isSyphilisScreeningName(name), false, name);
  }
});

test('accepts only the configured HOSxP syphilis service codes', () => {
  assert.equal(isSyphilisScreeningAdpCode('36003'), true);
  assert.equal(isSyphilisScreeningAdpCode('36006'), true);
  assert.equal(isSyphilisScreeningAdpCode('55020'), false);
});


````
