---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiCapabilityHelp.test.ts"
source_hash: "411aa5aee80129aa6ed8d631bd24399e358ef7475dddcdee87a1d4e36ad80c23"
managed_by: "sync-ksp-vault"
---
# aiCapabilityHelp.test.ts

> Source: `server/aiCapabilityHelp.test.ts`
> SHA-256: `411aa5aee80129aa6ed8d631bd24399e358ef7475dddcdee87a1d4e36ad80c23`

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
