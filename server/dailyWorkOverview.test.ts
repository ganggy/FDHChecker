import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyWorkOverviewMessages,
  classifyDailyWorkVisits,
  shouldSendDailyWorkOverview,
  type DailyWorkVisit,
} from './dailyWorkOverview.js';

const visit = (values: Partial<DailyWorkVisit> = {}): DailyWorkVisit => ({
  vn: '690000001', hn: '000000001', serviceDate: '2026-07-21', pttype: 'UC', hipdataCode: 'UCS',
  diagCount: 1, mainDiagCount: 1, chargeCount: 1, totalCharge: 100,
  hasCloseCode: true, closeStatus: 'Y', ...values,
});

test('daily work overview classifies operational errors without duplicating affected visit totals', () => {
  const overview = classifyDailyWorkVisits([
    visit({ vn: '1', diagCount: 0, mainDiagCount: 0, chargeCount: 0, totalCharge: 0 }),
    visit({ vn: '2', diagCount: 2, mainDiagCount: 0, hasCloseCode: false }),
    visit({ vn: '3', closeStatus: 'E', hasCloseCode: false }),
  ], '2026-07-21');
  assert.equal(overview.affectedVisits, 3);
  assert.equal(overview.affectedPatients, 1);
  assert.equal(overview.categories.find((item) => item.id === 'missing_diag')?.visits.length, 1);
  assert.equal(overview.categories.find((item) => item.id === 'missing_main_diag')?.visits.length, 1);
  assert.equal(overview.categories.find((item) => item.id === 'close_error')?.visits.length, 1);
});

test('daily work messages contain summary patient counts without HN, VN, or identity fields', () => {
  const overview = classifyDailyWorkVisits([visit({ diagCount: 0 })], '2026-07-21');
  const messages = buildDailyWorkOverviewMessages(overview);
  assert.match(messages.join('\n'), /ต้องตรวจสอบ 1 คน/);
  assert.match(messages.join('\n'), /ตรวจสอบความสมบรูณ์ เวชระเบียนทุกครั้ง ก่อนส่งเบิก นะคะทุกคน 😊/);
  assert.doesNotMatch(messages.join('\n'), /000000001|690000001|patient_name|cid/i);
  assert.equal(messages.length, 1);
});

test('daily work overview schedule matches time and prevents duplicate date', () => {
  assert.equal(shouldSendDailyWorkOverview('15:00', { date: '2026-07-21', time: '15:00' }, null), true);
  assert.equal(shouldSendDailyWorkOverview('15:00', { date: '2026-07-21', time: '14:59' }, null), false);
  assert.equal(shouldSendDailyWorkOverview('15:00', { date: '2026-07-21', time: '15:00' }, '2026-07-21'), false);
});
