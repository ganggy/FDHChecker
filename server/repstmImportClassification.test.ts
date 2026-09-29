import assert from 'node:assert/strict';
import test from 'node:test';
import { detectRepstmImportType } from '../src/utils/repstmImportClassification.js';
import * as XLSX from 'xlsx';
import { parseWorksheetRows } from '../src/utils/repstmWorksheetParsing.js';
import { parseFlexibleDateTime } from './utils/dataNormalization.js';
import { importStatementDataRows } from './repositories/receivables.repository.js';
import type { HospitalConnection } from './hospitalDatabase.js';

test('classifies the NHSO eclaim workbook from the reported case as REP even with an Invoice column', () => {
  const type = detectRepstmImportType(
    'eclaim_11101_IP_25681125_172120951.xls',
    ['TRAN_ID', 'HN', 'AN', 'Invoice No.', 'ชดเชยสุทธิ'],
    [{ TRAN_ID: '720706973', HN: '000090053', AN: '680004970', 'Invoice No.': '', ชดเชยสุทธิ: 50 }],
  );
  assert.equal(type, 'REP');
});

test('classifies Rep_eclaim supplementary workbook names as REP', () => {
  assert.equal(detectRepstmImportType('Rep_eclaim_11101_IP_25681125.xls [Data Drug]', ['TRAN_ID'], []), 'REP');
});

test('keeps actual invoice and statement filenames in their declared types', () => {
  assert.equal(detectRepstmImportType('INV_11101_202511.xls', ['Invoice No.'], [{ 'Invoice No.': 'INV-1' }]), 'INV');
  assert.equal(detectRepstmImportType('STM_11101_IPUCS256811_01.xls', ['HOSPCODE', 'PERIOD'], []), 'STM');
});

test('does not treat a generic empty Invoice column as INV', () => {
  assert.equal(detectRepstmImportType('download.xls', ['Invoice No.', 'TRAN_ID'], [{ 'Invoice No.': '', TRAN_ID: '1' }]), null);
});

test('dialysis payment files are detected as STM and retain every visit row', () => {
  const dckdName = 'DCKD6931080031_11101_29 ก.ย. 2569.xlsx';
  const lgoName = 'LGO-HD69-M10_11101_29 ก.ย. 2569.xlsx';
  const preface = [
    ['รายงานสรุป'], ['วันที่จัดพิมพ์รายงาน :'],
    ['รหัสหน่วยบริการ :', '11101'], ['ชื่อหน่วยบริการ :', 'โรงพยาบาลตัวอย่าง'],
    ['งวด :'], ['รหัสผังบัญชี :'],
  ];
  const dckdSheet = XLSX.utils.aoa_to_sheet([
    ...preface,
    ['ลำดับที่', 'Rep No. (งวด)', 'Trans Id', 'HN', 'เลขบัตรประชาชน (PID)', 'ชื่อ-สกุล', 'วันที่เข้ารับบริการ', 'Item_code( SubFund )', 'HCode', 'จำนวนเงินที่ขอเบิก', 'จ่ายชดเชยสุทธิ'],
    [1, 'DCKD-TEST', 'transaction-1', '', '0000000000001', 'ผู้ป่วยสมมติ', '01/09/2569', 'HD', '11101', 1500, 1500],
  ]);
  const lgoSheet = XLSX.utils.aoa_to_sheet([
    ...preface,
    ['ลำดับที่', 'งวด', 'HN', 'เลขบัตรประชาชน', 'ชื่อ-นามสกุล', 'ประเภทผู้ป่วย', 'วันที่ฟอกเลือดด้วยเครื่องไตเทียม', 'จ่ายชดเชยสุทธิ', 'หมายเหตุ'],
    [1, 'LGO-HD69-M10', '', '0000000000002', 'ผู้ป่วยสมมติ', 'ผู้ป่วยนอก', '02/09/2569', 1500, ''],
    [2, 'LGO-HD69-M10', '', '0000000000002', 'ผู้ป่วยสมมติ', 'ผู้ป่วยนอก', '04/09/2569', 1500, ''],
  ]);
  for (const [name, sheet, count] of [[dckdName, dckdSheet, 1], [lgoName, lgoSheet, 2]] as const) {
    const parsed = parseWorksheetRows(sheet, 'STM');
    assert.equal(parsed.rows.length, count);
    assert.equal(detectRepstmImportType(name, parsed.headers, parsed.rows), 'STM');
    assert.equal(parsed.rows[0].HCode, '11101');
    assert.ok(parsed.headers.includes('HCode'));
  }
  assert.equal(parseFlexibleDateTime('02/09/2569'), '2026-09-02 00:00:00');
});

test('dialysis STM import maps claimed and paid amounts and keeps separate sessions', async () => {
  const inserted: unknown[][] = [];
  const repConnection = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO repstm_statement_data')) inserted.push(values || []);
      return [[]];
    },
  } as unknown as HospitalConnection;
  const hosConnection = { query: async () => [[]] } as unknown as HospitalConnection;

  await importStatementDataRows(repConnection, hosConnection, 1, {
    dataType: 'STM',
    sourceFilename: 'DCKD6931080031_11101_29 ก.ย. 2569.xlsx',
    rows: [{
      'Rep No. (งวด)': 'DCKD-TEST', 'Trans Id': 'synthetic-transaction',
      HCode: '11101', 'เลขบัตรประชาชน (PID)': '0000000000001',
      'ชื่อ-สกุล': 'ผู้ป่วยสมมติ', 'วันที่เข้ารับบริการ': '01/09/2569',
      'จำนวนเงินที่ขอเบิก': '1600', 'จ่ายชดเชยสุทธิ': '1500',
    }],
  });
  assert.equal(inserted[0][1], 'STM');
  assert.equal(inserted[0][3], 'DCKD-TEST');
  assert.equal(inserted[0][5], '11101');
  assert.equal(inserted[0][13], '2026-09-01 00:00:00');
  assert.equal(inserted[0][19], 1600);
  assert.equal(inserted[0][20], 1500);

  inserted.length = 0;
  await importStatementDataRows(repConnection, hosConnection, 2, {
    dataType: 'STM',
    sourceFilename: 'LGO-HD69-M10_11101_29 ก.ย. 2569.xlsx',
    rows: ['02/09/2569', '04/09/2569'].map((date, index) => ({
      'ลำดับที่': String(index + 1), งวด: 'LGO-HD69-M10', HCode: '11101',
      'เลขบัตรประชาชน': '0000000000002', 'ชื่อ-นามสกุล': 'ผู้ป่วยสมมติ',
      'ประเภทผู้ป่วย': 'ผู้ป่วยนอก', 'วันที่ฟอกเลือดด้วยเครื่องไตเทียม': date,
      'จ่ายชดเชยสุทธิ': '1500',
    })),
  });
  assert.equal(inserted.length, 2);
  assert.notEqual(inserted[0][2], inserted[1][2]);
  assert.equal(inserted[0][3], 'LGO-HD69-M10');
  assert.equal(inserted[0][13], '2026-09-02 00:00:00');
  assert.equal(inserted[0][15], 'LGO');
  assert.equal(inserted[0][19], 1500);
  assert.equal(inserted[0][20], 1500);
});
