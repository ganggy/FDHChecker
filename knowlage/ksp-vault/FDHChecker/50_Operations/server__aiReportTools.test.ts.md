---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/aiReportTools.test.ts"
source_hash: "6b8f49bd96b1b967250120c222142428e5627c4215e0eed97d1e6a53674c9f02"
managed_by: "sync-ksp-vault"
---
# aiReportTools.test.ts

> Source: `server/aiReportTools.test.ts`
> SHA-256: `6b8f49bd96b1b967250120c222142428e5627c4215e0eed97d1e6a53674c9f02`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOpdCountAnswer, parsePatientReportIntent, parsePatientTopicFollowup } from './aiReportTools.js';

const now = new Date('2026-08-02T05:00:00.000Z');

test('recognizes a Thai question asking for today OPD patient count', () => {
  assert.deepEqual(parsePatientReportIntent('วันนี้คนไข้ OPD กี่คน', now), {
    kind: 'opd-count',
    dateStart: '2026-08-02',
    dateEnd: '2026-08-02',
  });
});

test('accepts a Thai Buddhist calendar date', () => {
  assert.deepEqual(parsePatientReportIntent('ผู้ป่วยนอกทั้งหมดวันที่ 01/08/2569', now), {
    kind: 'opd-list',
    dateStart: '2026-08-01',
    dateEnd: '2026-08-01',
  });
});

test('recognizes OPD Excel and Word export requests', () => {
  assert.deepEqual(parsePatientReportIntent('ทำ excel รายชื่อ OPD วันนี้', now), {
    kind: 'opd-list',
    dateStart: '2026-08-02',
    dateEnd: '2026-08-02',
    format: 'xlsx',
  });
  assert.deepEqual(parsePatientReportIntent('ส่งออก Word ผู้ป่วยนอกเดือนนี้', now), {
    kind: 'opd-list',
    dateStart: '2026-08-01',
    dateEnd: '2026-08-02',
    format: 'docx',
  });
});

test('recognizes HN, VN, AN, CID and patient-name questions', () => {
  assert.deepEqual(parsePatientReportIntent('ดูประวัติ HN 000123456', now), {
    kind: 'patient-lookup',
    identifierType: 'hn',
    identifier: '000123456',
  });
  assert.deepEqual(parsePatientReportIntent('วินิจฉัยและยาของ VN 690802001234', now), {
    kind: 'visit-detail',
    vn: '690802001234',
  });
  assert.equal(parsePatientReportIntent('ค้น AN 1234567', now)?.kind, 'patient-lookup');
  assert.equal(parsePatientReportIntent('ค้น CID 1234567890123', now)?.kind, 'patient-lookup');
  assert.deepEqual(parsePatientReportIntent('ค้นคนไข้ชื่อ สมชาย ใจดี', now), {
    kind: 'patient-lookup',
    identifierType: 'name',
    identifier: 'สมชาย ใจดี',
  });
});

test('routes HN questions to labs, medication, appointment and diagnosis tools', () => {
  assert.equal(parsePatientReportIntent('ขอผล lab ของ HN 000123456', now)?.topic, 'labs');
  assert.equal(parsePatientReportIntent('ดูยาล่าสุด HN 000123456', now)?.topic, 'medications');
  assert.equal(parsePatientReportIntent('HN 000123456 มีนัดเมื่อไร', now)?.topic, 'appointments');
  assert.deepEqual(parsePatientReportIntent('ทำ excel ประวัติวินิจฉัย HN 000123456', now), {
    kind: 'patient-lookup',
    identifierType: 'hn',
    identifier: '000123456',
    topic: 'diagnoses',
    format: 'xlsx',
  });
});

test('recognizes patient-topic follow-ups without guessing a patient', () => {
  assert.deepEqual(parsePatientTopicFollowup('ขอผล lab'), { topic: 'labs' });
  assert.deepEqual(parsePatientTopicFollowup('แล้วยาล่าสุดล่ะ'), { topic: 'medications' });
  assert.deepEqual(parsePatientTopicFollowup('ขอวันนัดเป็น Excel'), { topic: 'appointments', format: 'xlsx' });
  assert.equal(parsePatientTopicFollowup('ผล lab คืออะไร'), null);
});

test('recognizes a natural Thai patient-name visit-count question', () => {
  assert.deepEqual(parsePatientReportIntent('นายเปรมศักดิ์ เทพวงสา เคยมาโรงพยาบาลกี่ครั้ง', now), {
    kind: 'patient-lookup',
    identifierType: 'name',
    identifier: 'นายเปรมศักดิ์ เทพวงสา',
    countVisits: true,
  });
  assert.deepEqual(parsePatientReportIntent('ผู้ป่วยชื่อ นางสาวสมหญิง ใจดี เคยมารักษากี่ครั้ง', now), {
    kind: 'patient-lookup',
    identifierType: 'name',
    identifier: 'นางสาวสมหญิง ใจดี',
    countVisits: true,
  });
});

test('does not route a general OPD guidance question to the database', () => {
  assert.equal(parsePatientReportIntent('อธิบายขั้นตอนตรวจสอบ OPD', now), null);
});

test('formats unique patients and visits without asking the model to calculate', () => {
  const answer = formatOpdCountAnswer({
    dateStart: '2026-08-02',
    dateEnd: '2026-08-02',
    uniquePatients: 120,
    visits: 125,
  });
  assert.match(answer, /120/);
  assert.match(answer, /125/);
  assert.match(answer, /VN/);
});

````
