import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearConversationState,
  getConversationLastAction,
  getConversationHistory,
  getConversationPatientContext,
  getConversationUiContext,
  parseFormatOnlyFollowup,
  rememberConversationExchange,
  setConversationLastAction,
  setConversationPatientContext,
} from './aiConversationalAgent.js';

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
