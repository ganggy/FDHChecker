---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiLearningStore.test.ts"
source_hash: "b158fece5ea9f476b3f5f5784c7ffeb9f830c0d90cf1e8a220b434e3b17adc81"
managed_by: "sync-ksp-vault"
---
# aiLearningStore.test.ts

> Source: `server/aiLearningStore.test.ts`
> SHA-256: `b158fece5ea9f476b3f5f5784c7ffeb9f830c0d90cf1e8a220b434e3b17adc81`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { rankLearningExamples, type LearningExample } from './aiLearningStore.js';

const example = (id: number, question: string, rememberCount = 0): LearningExample => ({
  id,
  question,
  correction: '',
  title: '',
  safeSql: 'SELECT COUNT(*) AS total FROM patient LIMIT 200',
  positiveCount: 2,
  negativeCount: 0,
  rememberCount,
  status: 'approved',
});

test('ranks learned examples by Thai question similarity', () => {
  const matches = rankLearningExamples('เดือนก่อนแผนกไหนมีผู้ป่วย OPD มากที่สุด', [
    example(1, 'พรุ่งนี้มีนัดคลินิกอะไรบ้าง'),
    example(2, 'เดือนที่แล้วแผนกไหนมีผู้ป่วย OPD มากที่สุด'),
  ]);
  assert.equal(matches[0]?.id, 2);
});

test('does not return unrelated learned examples', () => {
  assert.deepEqual(rankLearningExamples('อากาศวันนี้เป็นอย่างไร', [
    example(1, 'รายชื่อผู้ป่วยเบาหวานที่ไม่มีผลแล็บ'),
  ]), []);
});

````
