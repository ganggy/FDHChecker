import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKtbFile, matchKtbRowsWithHosxp, applyKtbApproveCodes, type KtbParsedRow } from './ktbApproveCode.js';
import type { HospitalConnection } from './hospitalDatabase.js';

test('KTB Approve Code: parseKtbFile parses pipe-delimited text correctly', () => {
  const sampleLine = [
    'EA0011101', 'HCG11101', 'โรงพยาบาลทดสอบ', '0040000439', 'โรงพยาบาลทดสอบ', 'B', '0040001499',
    '19/09/2026', '09:09:59', '19/09/2026', '09:10:25',
    '1234567890123', 'สมศรี', 'มีสุข', '1234567890123',
    '', '', '', '3', '1', '24/04/1955', '04/06/2024',
    '527.75', '5315', '034843', 'Payment', '360892287', '297966741',
    'EDC', 'M4', '', '', '', '', '', 'TMS', '', '', '', '', '', '', ''
  ].join('|');

  const rows = parseKtbFile(Buffer.from(sampleLine, 'utf8'), 'test.txt');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hospitalCode, 'HCG11101');
  assert.equal(rows[0].terminalId, '0040001499');
  assert.equal(rows[0].transactionDate, '2026-09-19');
  assert.equal(rows[0].transactionTime, '09:09:59');
  assert.equal(rows[0].cid, '1234567890123');
  assert.equal(rows[0].patientName, 'สมศรี มีสุข');
  assert.equal(rows[0].amount, 527.75);
  assert.equal(rows[0].approveCode, '034843');
  assert.equal(rows[0].transactionType, 'Payment');
});

test('KTB Approve Code: parseKtbFile ignores empty lines and comments', () => {
  const buffer = Buffer.from(' \n\n  \r\n', 'utf8');
  const rows = parseKtbFile(buffer, 'empty.txt');
  assert.equal(rows.length, 0);
});

test('KTB Approve Code: matchKtbRowsWithHosxp identifies READY_TO_IMPORT, ALREADY_SET, and CONFLICT', async () => {
  const row1: KtbParsedRow = {
    rowNo: 1,
    hospitalCode: 'HCG11101',
    hospitalName: 'โรงพยาบาลทดสอบ',
    merchantId: '0040000439',
    terminalId: '0040001499',
    transactionDate: '2026-09-19',
    transactionTime: '09:09:59',
    transactionDateTime: '2026-09-19 09:09:59',
    cid: '1111111111111',
    patientName: 'นาย ก',
    amount: 500,
    approveCode: '034843',
    transactionType: 'Payment',
    invoiceNo: '123',
    channel: 'EDC',
    rawLine: '',
  };

  const row2: KtbParsedRow = {
    ...row1,
    rowNo: 2,
    cid: '2222222222222',
    approveCode: '034844',
  };

  const row3: KtbParsedRow = {
    ...row1,
    rowNo: 3,
    cid: '3333333333333',
    approveCode: '034845',
  };

  const fakeConn = {
    async query(sql: string, params: any[]) {
      if (sql.includes('FROM ovst o')) {
        const cid = params[0];
        if (cid === '1111111111111') {
          // No auth code
          return [[{ vn: '6909190001', hn: '0001', vstdate: '2026-09-19', vsttime: '09:00:00', pttype: '30', pttype_name: 'ข้าราชการ', patient_name: 'นาย ก', auth_code: '', total_price: '500' }]];
        }
        if (cid === '2222222222222') {
          // Same auth code
          return [[{ vn: '6909190002', hn: '0002', vstdate: '2026-09-19', vsttime: '09:00:00', pttype: '30', pttype_name: 'ข้าราชการ', patient_name: 'นาย ข', auth_code: '034844', total_price: '500' }]];
        }
        if (cid === '3333333333333') {
          // Different auth code
          return [[{ vn: '6909190003', hn: '0003', vstdate: '2026-09-19', vsttime: '09:00:00', pttype: '30', pttype_name: 'ข้าราชการ', patient_name: 'นาย ค', auth_code: '999999', total_price: '500' }]];
        }
        return [[]];
      }
      return [[]];
    },
  } as unknown as HospitalConnection;

  const result = await matchKtbRowsWithHosxp([row1, row2, row3], fakeConn);
  assert.equal(result.totalRows, 3);
  assert.equal(result.readyToImportCount, 1);
  assert.equal(result.items[0].status, 'READY_TO_IMPORT');
  assert.equal(result.alreadySetCount, 1);
  assert.equal(result.items[1].status, 'ALREADY_SET');
  assert.equal(result.conflictCount, 1);
  assert.equal(result.items[2].status, 'CONFLICT');
});

test('KTB Approve Code: applyKtbApproveCodes updates visit_pttype and authenhos', async () => {
  const executedSqls: string[] = [];
  const fakeConn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql: string, params: any[]) {
      executedSqls.push(sql);
      if (sql.includes('SELECT auth_code FROM visit_pttype')) {
        return [[{ auth_code: '' }]];
      }
      return [[]];
    },
  } as unknown as HospitalConnection;

  const result = await applyKtbApproveCodes(
    [
      {
        vn: '6909190001',
        cid: '1111111111111',
        approveCode: '034843',
        transactionDateTime: '2026-09-19 09:09:59',
        terminalId: '0040001499',
      },
    ],
    fakeConn
  );

  assert.equal(result.updatedCount, 1);
  assert.equal(result.updatedVns[0], '6909190001');
  assert.ok(executedSqls.some((s) => s.includes('UPDATE visit_pttype')));
  assert.ok(executedSqls.some((s) => s.includes('INSERT INTO authenhos')));
});
