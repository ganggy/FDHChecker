import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationalIntent, rankDepartmentErrors } from './aiOperationalTools.js';
import { classifyDailyWorkVisits, type DailyWorkVisit } from './dailyWorkOverview.js';

const now = new Date('2026-08-02T05:00:00.000Z');

test('recognizes flexible appointment operational questions', () => {
  assert.deepEqual(parseOperationalIntent('พรุ่งนี้คนไข้มีนัดซ้ำซ้อนกี่คน', now), {
    kind: 'appointment-duplicates', date: '2026-08-03',
  });
  assert.deepEqual(parseOperationalIntent('พรุ่งนี้มีนัดคลินิกอะไรบ้าง', now), {
    kind: 'appointment-clinics', date: '2026-08-03',
  });
  assert.deepEqual(parseOperationalIntent('วันพรุ่งนี้แผนกไหนมีนัดบ้าง ทำ Excel', now), {
    kind: 'appointment-clinics', date: '2026-08-03', format: 'xlsx',
  });
});

test('recognizes claim completeness and department-error questions with common spelling variants', () => {
  assert.deepEqual(parseOperationalIntent('เมื่อวานเบิกครบหรือไม่', now), {
    kind: 'claim-completeness', date: '2026-08-01',
  });
  assert.deepEqual(parseOperationalIntent('ข้อมูลไม่สมบรูณ์เมื่อวานแผนกไหน ผิดพลาดเยอะสุด', now), {
    kind: 'department-errors', date: '2026-08-01',
  });
  assert.equal(parseOperationalIntent('เมื่อวานหน่วยงานใดข้อมูลผิดมากที่สุด', now)?.kind, 'department-errors');
});

test('recognizes duplicate HN and same-person multiple-HN questions', () => {
  assert.equal(parseOperationalIntent('มีคนไข้ HN ซ้ำกันในระบบหรือไม่', now)?.kind, 'patient-identity-duplicates');
  assert.equal(parseOperationalIntent('มีคนไข้คนเดียวกันแต่หลาย HN หรือไม่', now)?.kind, 'patient-identity-duplicates');
  assert.deepEqual(parseOperationalIntent('ขอ Excel รายชื่อ CID ซ้ำหลาย HN', now), {
    kind: 'patient-identity-duplicates', date: '2026-08-02', format: 'xlsx',
  });
});

const visit = (values: Partial<DailyWorkVisit>): DailyWorkVisit => ({
  vn: '1', hn: '1', serviceDate: '2026-08-01', pttype: '01', hipdataCode: 'UCS',
  diagCount: 1, mainDiagCount: 1, chargeCount: 1, totalCharge: 100,
  hasCloseCode: true, closeStatus: 'Y', ...values,
});

test('ranks departments by distinct affected visits then issue count', () => {
  const overview = classifyDailyWorkVisits([
    visit({ vn: '1', hn: '1', departmentName: 'อายุรกรรม', diagCount: 0, chargeCount: 0 }),
    visit({ vn: '2', hn: '2', departmentName: 'อายุรกรรม', mainDiagCount: 0 }),
    visit({ vn: '3', hn: '3', departmentName: 'ทันตกรรม', diagCount: 0 }),
  ], '2026-08-01');
  const ranked = rankDepartmentErrors(overview);
  assert.equal(ranked[0].department, 'อายุรกรรม');
  assert.equal(ranked[0].affectedVisits, 2);
  assert.equal(ranked[0].issueCount, 3);
});
