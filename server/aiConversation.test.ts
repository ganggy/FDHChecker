import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearConversationState,
  formatVerifiedAggregateAnswer,
  getConversationLastAction,
  getConversationHistory,
  getConversationPatientContext,
  getConversationUiContext,
  parseFormatOnlyFollowup,
  plannedQueryAccuracyIssue,
  rememberConversationExchange,
  setConversationLastAction,
  setConversationPatientContext,
} from './aiConversationalAgent.js';

test('requires backend aggregate counting with the correct person or visit key', () => {
  assert.match(
    plannedQueryAccuracyIssue('เดือนนี้มีผู้ป่วย OPD กี่คน', "SELECT hn FROM ovst WHERE vstdate BETWEEN '2026-08-01' AND '2026-08-24'"),
    /COUNT/,
  );
  assert.match(
    plannedQueryAccuracyIssue('เดือนนี้มีผู้ป่วย OPD กี่คน', "SELECT COUNT(DISTINCT vn) total FROM ovst WHERE vstdate BETWEEN '2026-08-01' AND '2026-08-24'"),
    /DISTINCT hn/,
  );
  assert.equal(
    plannedQueryAccuracyIssue('เดือนนี้มีผู้ป่วย OPD กี่คน', "SELECT COUNT(DISTINCT hn) patients FROM ovst WHERE vstdate BETWEEN '2026-08-01' AND '2026-08-24'"),
    '',
  );
});

test('requires an explicit date scope for time-bound questions', () => {
  assert.match(
    plannedQueryAccuracyIssue('เดือนนี้มีผู้ป่วยกี่คน', 'SELECT COUNT(DISTINCT hn) patients FROM ovst'),
    /YYYY-MM-DD/,
  );
});

test('requires monetary totals to use SUM instead of model-side arithmetic', () => {
  assert.match(
    plannedQueryAccuracyIssue('ยอดค่าใช้จ่ายเดือนนี้เท่าไร', "SELECT sum_price FROM opitemrece WHERE vstdate = '2026-08-24'"),
    /SUM/,
  );
});

test('requires averages to be calculated by the database', () => {
  assert.match(
    plannedQueryAccuracyIssue('ค่าใช้จ่ายเฉลี่ยเดือนนี้เท่าไร', "SELECT SUM(sum_price) total FROM opitemrece WHERE order_date = '2026-08-24'"),
    /AVG/,
  );
});

test('formats verified aggregate totals without asking the model to recalculate', () => {
  assert.equal(
    formatVerifiedAggregateAnswer('วันนี้มีผู้ป่วยกี่คน', 'สรุป OPD วันนี้', [{ patients: 125, visits: '140' }]),
    'สรุป OPD วันนี้\n- จำนวนผู้ป่วย: 125\n- จำนวนครั้งรับบริการ: 140\nตัวเลขคำนวณโดยฐานข้อมูล HOSxP โดยตรง',
  );
});

test('keeps ordered conversation history for follow-up questions', () => {
  const key = `conversation-test-${Date.now()}-${Math.random()}`;
  rememberConversationExchange(key, 'ขอรายงานผู้ป่วยเบาหวาน', 'ต้องการช่วงเวลาใดครับ');
  rememberConversationExchange(key, 'เดือนนี้', 'พบ 25 รายการ');
  assert.deepEqual(
    getConversationHistory(key).map(({ question, answer }) => ({ question, answer })),
    [
      { question: 'ขอรายงานผู้ป่วยเบาหวาน', answer: 'ต้องการช่วงเวลาใดครับ' },
      { question: 'เดือนนี้', answer: 'พบ 25 รายการ' },
    ],
  );
});

test('recognizes a format-only follow-up without hijacking a new report request', () => {
  assert.equal(parseFormatOnlyFollowup('เอาผลเมื่อกี้เป็น Excel'), 'xlsx');
  assert.equal(parseFormatOnlyFollowup('ขอเป็นไฟล์ Word ด้วยครับ'), 'docx');
  assert.equal(parseFormatOnlyFollowup('ขอรายชื่อ OPD วันนี้เป็น Excel'), null);
});

test('exposes safe UI context and clears the whole conversation', () => {
  const key = `ui-context-test-${Date.now()}-${Math.random()}`;
  setConversationPatientContext(key, { hn: '000999', patientName: 'ผู้ป่วย ทดสอบ' });
  setConversationLastAction(key, {
    kind: 'patient-report', label: 'ผลแล็บล่าสุด', payload: { kind: 'patient-lookup', identifier: '000999' },
  });
  assert.deepEqual(getConversationLastAction(key)?.payload.identifier, '000999');
  assert.deepEqual(getConversationUiContext(key), {
    patient: { hn: '000999', patientName: 'ผู้ป่วย ทดสอบ' },
    lastAction: { kind: 'patient-report', label: 'ผลแล็บล่าสุด' },
  });
  clearConversationState(key);
  assert.deepEqual(getConversationUiContext(key), {});
});

test('binds follow-up clinical questions to a confirmed HN and can clear it', () => {
  const key = `patient-context-test-${Date.now()}-${Math.random()}`;
  setConversationPatientContext(key, { hn: '000123456', patientName: 'ทดสอบ ระบบ' });
  assert.deepEqual(getConversationPatientContext(key), {
    hn: '000123456', patientName: 'ทดสอบ ระบบ', confirmedAt: getConversationPatientContext(key)?.confirmedAt,
  });
  setConversationPatientContext(key, null);
  assert.equal(getConversationPatientContext(key), null);
});
