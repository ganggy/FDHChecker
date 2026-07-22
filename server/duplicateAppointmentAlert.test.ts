import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDuplicateAppointmentMessages,
  getNextIsoDate,
  groupDuplicateAppointments,
  shouldRunDuplicateAppointmentAlert,
  type AppointmentItem,
} from './duplicateAppointmentAlert.js';

const appointment = (values: Partial<AppointmentItem> = {}): AppointmentItem => ({
  appointmentId: 1,
  hn: '000000001',
  nextDate: '2026-07-23',
  nextTime: '08:00',
  clinicCode: '001',
  clinicName: 'คลินิกทั่วไป',
  departmentCode: '010',
  departmentName: 'ห้องตรวจ 1',
  cause: 'รักษาต่อเนื่อง',
  ...values,
});

test('groups only patients with multiple active appointment rows', () => {
  const report = groupDuplicateAppointments([
    appointment({ appointmentId: 2, nextTime: '10:00' }),
    appointment({ appointmentId: 1, nextTime: '08:00' }),
    appointment({ appointmentId: 3, hn: '000000002' }),
  ], '2026-07-23');
  assert.equal(report.duplicatePatients.length, 1);
  assert.equal(report.appointmentCount, 2);
  assert.deepEqual(report.duplicatePatients[0]?.appointments.map((item) => item.appointmentId), [1, 2]);
});

test('LINE alert identifies HN, time, clinic and prevention action', () => {
  const report = groupDuplicateAppointments([
    appointment(),
    appointment({ appointmentId: 2, nextTime: '13:00', clinicName: 'คลินิกสุขภาพจิต' }),
  ], '2026-07-23');
  const message = buildDuplicateAppointmentMessages(report).join('\n');
  assert.match(message, /HN 000000001/);
  assert.match(message, /08:00 คลินิกทั่วไป/);
  assert.match(message, /13:00 คลินิกสุขภาพจิต/);
  assert.match(message, /พยาบาลที่รับผิดชอบคลินิก/);
  assert.match(message, /ป้องกันการเปิด Visit ซ้ำซ้อน/);
});

test('does not create a LINE message when tomorrow has no duplicates', () => {
  const report = groupDuplicateAppointments([appointment()], '2026-07-23');
  assert.deepEqual(buildDuplicateAppointmentMessages(report), []);
});

test('omits an unreadable appointment cause from the alert', () => {
  const report = groupDuplicateAppointments([
    appointment({ cause: '????????' }),
    appointment({ appointmentId: 2, cause: '' }),
  ], '2026-07-23');
  assert.doesNotMatch(buildDuplicateAppointmentMessages(report).join('\n'), /\?\?\?\?/);
});

test('appointment alert runs once at 11:00 and calculates tomorrow safely', () => {
  assert.equal(getNextIsoDate('2026-07-31'), '2026-08-01');
  assert.equal(shouldRunDuplicateAppointmentAlert('11:00', { date: '2026-07-22', time: '11:00' }, null), true);
  assert.equal(shouldRunDuplicateAppointmentAlert('11:00', { date: '2026-07-22', time: '10:59' }, null), false);
  assert.equal(shouldRunDuplicateAppointmentAlert('11:00', { date: '2026-07-22', time: '11:00' }, '2026-07-22'), false);
});
