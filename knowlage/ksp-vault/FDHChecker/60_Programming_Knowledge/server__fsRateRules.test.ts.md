---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/fsRateRules.test.ts"
source_hash: "a9a555df83b99de838c951c4549a00b0ee3ade4b7121af67cad65d54c3b87120"
managed_by: "sync-ksp-vault"
---
# fsRateRules.test.ts

> Source: `server/fsRateRules.test.ts`
> SHA-256: `a9a555df83b99de838c951c4549a00b0ee3ade4b7121af67cad65d54c3b87120`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFsRate, FS_PROJECT_ITEMS_2569 } from './fsRateRules.js';

const rateByCode = new Map(FS_PROJECT_ITEMS_2569.map((item) => [item.code, item.amount]));

test('FY2569 FS rates include revised screening prices and exclude cancelled services', () => {
  assert.equal(rateByCode.get('12003'), 50);
  assert.equal(rateByCode.get('13001'), 75);
  assert.equal(rateByCode.has('12001'), false);
  assert.equal(rateByCode.has('12002'), false);
});

test('family-planning services use the split implant and medicine rates', () => {
  assert.equal(rateByCode.get('FP002_1'), 2150);
  assert.equal(rateByCode.get('FP002_2'), 350);
  assert.equal(rateByCode.get('FP003_1'), 40);
  assert.equal(rateByCode.get('FP003_2'), 80);
  assert.equal(rateByCode.get('FP003_3'), 50);
  assert.equal(rateByCode.get('FP003_4'), 60);
  assert.equal(rateByCode.has('FP002'), false);
});

test('rate checker reports HOSxP variance without changing the value', () => {
  assert.deepEqual(evaluateFsRate(360, 360), {
    matches: true,
    difference: 0,
    status: 'matched',
    warning: '',
  });

  const mismatch = evaluateFsRate(360, 390);
  assert.equal(mismatch.matches, false);
  assert.equal(mismatch.difference, 30);
  assert.equal(mismatch.status, 'mismatch');
  assert.match(mismatch.warning, /390\.00.*360\.00/);
});

test('ANC oral examination is capped by the paired cleaning service rate', () => {
  assert.equal(rateByCode.get('30008'), 0);
  assert.equal(rateByCode.get('30009'), 500);
  assert.equal(evaluateFsRate(0, 120).difference, 120);
});

````
