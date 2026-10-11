---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiCapabilityHelp.test.ts"
source_hash: "7e7fff2812540a735a8961b68d3a60dad2c73310efed45a308852226a0e67ae4"
managed_by: "sync-ksp-vault"
---
# aiCapabilityHelp.test.ts

> Source: `server/aiCapabilityHelp.test.ts`
> SHA-256: `7e7fff2812540a735a8961b68d3a60dad2c73310efed45a308852226a0e67ae4`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { answerAiCapabilityQuestion, parseAiCapabilityQuestion } from './aiCapabilityHelp.js';

test('routes a short Word capability question to FDH document help', () => {
  assert.equal(parseAiCapabilityQuestion('word ทำอะไรได้บ้าง'), 'word');
  assert.equal(parseAiCapabilityQuestion('โปรแกรม Word สร้างอะไรได้'), 'word');
  const answer = answerAiCapabilityQuestion('word');
  assert.match(answer, /AI ในระบบ FDH/);
  assert.match(answer, /Word \(\.docx\)/);
  assert.match(answer, /รายชื่อและสรุปผู้ป่วย OPD/);
});

test('routes general FDH AI capability questions', () => {
  assert.equal(parseAiCapabilityQuestion('AI FDH ช่วยอะไรได้บ้าง'), 'all');
  assert.match(answerAiCapabilityQuestion('all'), /Excel \(\.xlsx\), CSV และ JSON/);
});

test('does not intercept an actual report export request', () => {
  assert.equal(parseAiCapabilityQuestion('ขอ Word รายชื่อ OPD วันนี้'), null);
  assert.equal(parseAiCapabilityQuestion('ทำผลเมื่อกี้เป็น Word'), null);
});

````
