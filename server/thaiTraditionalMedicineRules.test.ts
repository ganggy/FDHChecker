import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THAI_MED_SAME_DAY_CODES,
  THAI_MED_CATALOG,
  findThaiMedSameDayConflict,
  suggestCombinedThaiMedCode,
} from '../src/utils/thaiTraditionalMedicineRules.js';
import { evaluateOpdPreAudit } from './opdPreAuditRules.js';
import { validateFdhData, type FdhExportData } from './fdhExport.js';

test('Thai Traditional Medicine: circular ว 447 catalog contains all 5 codes with exact official rates', () => {
  assert.equal(THAI_MED_SAME_DAY_CODES.length, 5);
  assert.equal(THAI_MED_CATALOG['58101'].rate, 200.0);
  assert.equal(THAI_MED_CATALOG['58102'].rate, 200.0);
  assert.equal(THAI_MED_CATALOG['58130'].rate, 250.0);
  assert.equal(THAI_MED_CATALOG['58131'].rate, 250.0);
  assert.equal(THAI_MED_CATALOG['58201'].rate, 150.0);
});

test('Thai Traditional Medicine: findThaiMedSameDayConflict identifies conflicts', () => {
  // Single code -> No conflict
  assert.deepEqual(findThaiMedSameDayConflict(['58101']), ['58101']);
  assert.deepEqual(findThaiMedSameDayConflict(['58130']), ['58130']);

  // Multiple conflicting codes on same day
  const conflict = findThaiMedSameDayConflict(['58101', '58201']);
  assert.equal(conflict.length, 2);
  assert.ok(conflict.includes('58101'));
  assert.ok(conflict.includes('58201'));

  // Suggest combined code
  assert.equal(suggestCombinedThaiMedCode(['58101', '58130']), '58130'); // นวดบำบัด + นวดและประคบบำบัด -> 58130
  assert.equal(suggestCombinedThaiMedCode(['58102', '58201']), '58131'); // นวดฟื้นฟู + ประคบฟื้นฟู -> 58131
});

test('OPD Pre-Audit flags OPD-TM01 when OFC or LGO bills multiple Thai medicine codes on same day', () => {
  // OFC with both 58101 and 58201
  const ofcRow = {
    serviceType: 'OPD',
    hipdata_code: 'OFC',
    fund: 'เบิกจ่ายตรงข้าราชการ',
    thai_med_codes: '58101,58201',
    has_provider: true,
    has_clinical_note: true,
  };
  const ofcIssues = evaluateOpdPreAudit(ofcRow);
  assert.ok(ofcIssues.some((issue) => issue.code === 'OPD-TM01' && issue.severity === 'blocking'));

  // LGO with both 58101 and 58201
  const lgoRow = {
    serviceType: 'OPD',
    hipdata_code: 'LGO',
    fund: 'เบิกจ่ายตรง อปท.',
    thai_med_codes: '58101,58130',
    has_provider: true,
    has_clinical_note: true,
  };
  const lgoIssues = evaluateOpdPreAudit(lgoRow);
  assert.ok(lgoIssues.some((issue) => issue.code === 'OPD-TM01' && issue.severity === 'blocking'));

  // Single code on OFC passes without OPD-TM01
  const singleRow = {
    serviceType: 'OPD',
    hipdata_code: 'OFC',
    fund: 'เบิกจ่ายตรงข้าราชการ',
    thai_med_codes: '58130',
    has_provider: true,
    has_clinical_note: true,
  };
  const singleIssues = evaluateOpdPreAudit(singleRow);
  assert.equal(singleIssues.some((issue) => issue.code === 'OPD-TM01'), false);
});

test('FDH Export validation blocks duplicate Thai medicine codes on same day for OFC and LGO (REP 853)', () => {
  const data: FdhExportData = {
    INS: [
      { HN: '0001', INSCL: 'OFC', DATEIN: '20261009', HOSPMAIN: '11101', HOSPSUB: '11101', PERMITNO: '034843', SEQ: 'VN1' },
      { HN: '0002', INSCL: 'LGO', DATEIN: '20261009', HOSPMAIN: '11101', HOSPSUB: '11101', PERMITNO: '', SEQ: 'VN2' },
    ],
    PAT: [
      { HCODE: '11101', HN: '0001', DOB: '19800101', SEX: '1', MARRIAGE: '1', OCCUPA: '999', NATION: '099', PERSON_ID: '1234567890123', NAMEPAT: 'OFC,MR', TITLE: 'MR', FNAME: 'OFC', LNAME: 'TEST', IDTYPE: '1' },
      { HCODE: '11101', HN: '0002', DOB: '19800101', SEX: '2', MARRIAGE: '1', OCCUPA: '999', NATION: '099', PERSON_ID: '1234567890124', NAMEPAT: 'LGO,MS', TITLE: 'MS', FNAME: 'LGO', LNAME: 'TEST', IDTYPE: '1' },
    ],
    OPD: [
      { HN: '0001', CLINIC: '00100', DATEOPD: '20261009', TIMEOPD: '0900', SEQ: 'VN1', UUC: '1', TYPEIN: '1' },
      { HN: '0002', CLINIC: '00100', DATEOPD: '20261009', TIMEOPD: '1000', SEQ: 'VN2', UUC: '1', TYPEIN: '1' },
    ],
    ORF: [], ODX: [], OOP: [], IPD: [], IRF: [], IDX: [], IOP: [],
    CHT: [
      { HN: '0001', AN: '', DATE: '20261009', TOTAL: 450, PAID: 0, PTTYPE: '37', PERSON_ID: '1234567890123', SEQ: 'VN1', INVOICE_NO: 'INV1' },
      { HN: '0002', AN: '', DATE: '20261009', TOTAL: 250, PAID: 0, PTTYPE: '37', PERSON_ID: '1234567890124', SEQ: 'VN2', INVOICE_NO: 'INV2' },
    ],
    CHA: [
      { HN: '0001', AN: '', DATE: '20261009', CHRGITEM: '01', AMOUNT: 450, PERSON_ID: '1234567890123', SEQ: 'VN1' },
      { HN: '0002', AN: '', DATE: '20261009', CHRGITEM: '01', AMOUNT: 250, PERSON_ID: '1234567890124', SEQ: 'VN2' },
    ],
    AER: [],
    ADP: [
      // Patient 1 (OFC) has 2 conflicting codes on 20261009: 58101 (200) and 58201 (150)
      { HN: '0001', AN: '', DATEOPD: '20261009', TYPE: '4', CODE: '58101', QTY: 1, RATE: 200, SEQ: 'VN1', TOTAL: 200 },
      { HN: '0001', AN: '', DATEOPD: '20261009', TYPE: '4', CODE: '58201', QTY: 1, RATE: 150, SEQ: 'VN1', TOTAL: 150 },
      // Patient 2 (LGO) has single valid code on 20261009: 58130 (250)
      { HN: '0002', AN: '', DATEOPD: '20261009', TYPE: '4', CODE: '58130', QTY: 1, RATE: 250, SEQ: 'VN2', TOTAL: 250 },
    ],
    LVD: [], DRU: [],
  };

  const validation = validateFdhData(data, 'standard', '11101');
  const sameDayErrors = validation.errors.filter((err) => err.code === 'THAI_MED_SAME_DAY_LIMIT');
  assert.equal(sameDayErrors.length, 2); // 2 rows for patient 1 flagged
  assert.ok(sameDayErrors[0].message.includes('HN 0001'));
  assert.ok(sameDayErrors[0].message.includes('ว 447'));
  assert.ok(sameDayErrors[0].message.includes('REP 853'));

  // Patient 2 with single code (58130) did not produce same-day errors
  assert.equal(sameDayErrors.some((err) => err.message.includes('HN 0002')), false);
});
