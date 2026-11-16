import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFundGroup, determineMonitorStage } from './dailyClaimMonitorService.js';

test('classifyFundGroup categorizes UCS, OFC, SSS, LGO, OTHER accurately', () => {
  assert.equal(classifyFundGroup('UCS', 'บัตรทอง').fundGroup, 'UCS');
  assert.equal(classifyFundGroup('WEL', 'ผู้มีรายได้น้อย').fundGroup, 'UCS');
  assert.equal(classifyFundGroup('OFC', 'ข้าราชการเบิกตรง').fundGroup, 'OFC');
  assert.equal(classifyFundGroup('SSS', 'ประกันสังคม').fundGroup, 'SSS');
  assert.equal(classifyFundGroup('LGO', 'สิทธิ อปท.').fundGroup, 'LGO');
  assert.equal(classifyFundGroup('CASH', 'ชำระเงินเอง').fundGroup, 'OTHER');
});

test('determineMonitorStage prioritizes REP outcomes, then FDH status, then clinical/close completeness', () => {
  // REP Passed
  const passed = determineMonitorStage({
    fundGroup: 'UCS',
    patientType: 'OPD',
    income: 500,
    cid: '1234567890123',
    diagCount: 1,
    mainDiagCount: 1,
    chargeCount: 2,
    hasCloseCode: true,
    closeStatus: 'Y',
    fdhStatus: 'SENT',
    repStatus: 'PASS',
  });
  assert.equal(passed.stage, 'rep_passed');

  // REP Rejected
  const rejected = determineMonitorStage({
    fundGroup: 'UCS',
    patientType: 'OPD',
    income: 500,
    cid: '1234567890123',
    diagCount: 1,
    mainDiagCount: 1,
    chargeCount: 2,
    hasCloseCode: true,
    closeStatus: 'Y',
    fdhStatus: 'SENT',
    repStatus: 'REJECT',
  });
  assert.equal(rejected.stage, 'rep_rejected');

  // Pending Close for UCS OPD
  const pendingClose = determineMonitorStage({
    fundGroup: 'UCS',
    patientType: 'OPD',
    income: 500,
    cid: '1234567890123',
    diagCount: 1,
    mainDiagCount: 1,
    chargeCount: 2,
    hasCloseCode: false,
    closeStatus: '',
    fdhStatus: '',
    repStatus: '',
  });
  assert.equal(pendingClose.stage, 'pending_close');

  // SSS OPD does not require NHSO close code -> ready immediately when diag/charge complete
  const sssReady = determineMonitorStage({
    fundGroup: 'SSS',
    patientType: 'OPD',
    income: 500,
    cid: '1234567890123',
    diagCount: 1,
    mainDiagCount: 1,
    chargeCount: 2,
    hasCloseCode: false,
    closeStatus: '',
    fdhStatus: '',
    repStatus: '',
  });
  assert.equal(sssReady.stage, 'ready');

  // Incomplete due to missing diag
  const incomplete = determineMonitorStage({
    fundGroup: 'UCS',
    patientType: 'OPD',
    income: 500,
    cid: '1234567890123',
    diagCount: 0,
    mainDiagCount: 0,
    chargeCount: 2,
    hasCloseCode: true,
    closeStatus: 'Y',
    fdhStatus: '',
    repStatus: '',
  });
  assert.equal(incomplete.stage, 'incomplete');
  assert.ok(incomplete.issues.includes('ยังไม่ลง DIAG'));
});
