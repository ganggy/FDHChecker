---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/aiReportTools.test.ts"
source_hash: "72fd99df152536b8f103095b6f34d5f72f5570ca1d851df8e2499f7c6e076ddd"
managed_by: "sync-ksp-vault"
---
# aiReportTools.test.ts

> Source: `server/aiReportTools.test.ts`
> SHA-256: `72fd99df152536b8f103095b6f34d5f72f5570ca1d851df8e2499f7c6e076ddd`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOpdCountAnswer, parsePatientReportIntent } from './aiReportTools.js';

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
