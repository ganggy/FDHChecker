import assert from 'node:assert/strict';
import test from 'node:test';
import { detectRepstmImportType } from '../src/utils/repstmImportClassification.js';

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
