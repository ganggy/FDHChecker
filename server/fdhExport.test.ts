import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFdhLayouts,
  projectFdhData,
  scopeFdhData,
  serializeFdhFile,
  buildFdhFiles,
  selectFdhUploadFiles,
  uploadFdhFiles,
  validateFdhData,
  type FdhExportData,
} from './fdhExport.js';

const emptyData = (): FdhExportData => ({
  INS: [], PAT: [], OPD: [], ORF: [], ODX: [], OOP: [], IPD: [], IRF: [],
  IDX: [], IOP: [], CHT: [], CHA: [], AER: [], ADP: [], LVD: [], DRU: [],
});

const validFwfData = (): FdhExportData => ({
  ...emptyData(),
  INS: [{ HN: '0001', INSCL: 'FWF', CID: 'F-CODE-1', HCODE: '11101', HOSPMAIN: '11101', HOSPSUB: '11101', PERMITNO: 'AUTH1', SEQ: 'VN1' }],
  PAT: [{ HCODE: '11101', HN: '0001', DOB: '19900101', SEX: '1', MARRIAGE: '1', OCCUPA: '999', NATION: '099', PERSON_ID: '1234567890123', NAMEPAT: 'TEST,MR', TITLE: 'MR', FNAME: 'TEST', LNAME: 'PERSON', IDTYPE: '1' }],
  OPD: [{ HN: '0001', CLINIC: '00100', DATEOPD: '20260720', TIMEOPD: '0900', SEQ: 'VN1', UUC: '1', TYPEIN: '1' }],
  CHT: [{ HN: '0001', AN: '', DATE: '20260720', TOTAL: 100, PAID: 0, PTTYPE: '37', PERSON_ID: '1234567890123', SEQ: 'VN1', INVOICE_NO: 'INV1' }],
  CHA: [{ HN: '0001', AN: '', DATE: '20260720', CHRGITEM: '01', AMOUNT: 100, PERSON_ID: '1234567890123', SEQ: 'VN1' }],
});

const validIpdData = (): FdhExportData => ({
  ...emptyData(),
  INS: [{ HN: '0002', INSCL: 'UCS', CID: '1234567890123', DATEIN: '20260801', HOSPMAIN: '11101', HOSPSUB: '11101', PERMITNO: 'EP123', AN: 'AN001', SEQ: 'VN2' }],
  PAT: [{ HCODE: '11101', HN: '0002', DOB: '19800101', SEX: '2', MARRIAGE: '1', OCCUPA: '999', NATION: '099', PERSON_ID: '1234567890123', NAMEPAT: 'IPD TEST,MS', TITLE: 'MS', FNAME: 'IPD', LNAME: 'TEST', IDTYPE: '1' }],
  IPD: [{ HN: '0002', AN: 'AN001', DATEADM: '20260801', TIMEADM: '0900', DATEDSC: '20260803', TIMEDSC: '1200', DISCHS: '1', DISCHT: '1', WARDDSC: '01', DEPT: '01', UUC: '1', SVCTYPE: 'IMP' }],
  IDX: [{ AN: 'AN001', DIAG: 'J189', DXTYPE: '1', DRDX: 'DOC1' }],
  CHT: [{ HN: '0002', AN: 'AN001', DATE: '20260803', TOTAL: 1000, PAID: 0, PTTYPE: '37', PERSON_ID: '1234567890123', SEQ: 'VN2', INVOICE_NO: 'IPD-INV1' }],
  CHA: [{ HN: '0002', AN: 'AN001', DATE: '20260803', CHRGITEM: '01', AMOUNT: 1000, PERSON_ID: '1234567890123', SEQ: 'VN2' }],
});

test('FWF Migrants INS layout uses HCODE and current ADP/DRU fields', () => {
  const layouts = getFdhLayouts('fwf-migrants');
  assert.equal(layouts.INS.includes('HCODE'), true);
  assert.equal(layouts.INS.includes('DATEIN'), false);
  assert.deepEqual(layouts.ADP.slice(-5), ['GRAVIDA', 'GA_WEEK', 'DCIP/E_screen', 'LMP', 'SP_ITEM']);
  assert.deepEqual(layouts.DRU.slice(-3), ['SIGCODE', 'SIGTEXT', 'PROVIDER']);
});

test('pipe serialization strips delimiters and line breaks', () => {
  const data = validFwfData();
  data.INS[0].CID = 'FC|1\r\nNEXT';
  const output = serializeFdhFile(data, 'INS', 'fwf-migrants', true);
  assert.match(output, /^HN\|INSCL\|SUBTYPE\|CID\|HCODE/);
  assert.equal(output.includes('FC|1'), false);
  assert.equal(output.includes('\nNEXT\r\n'), false);
});

test('preflight accepts a linked and balanced minimal FWF claim', () => {
  const data = validFwfData();
  data.INS[0].PERMITNO = '';
  const result = validateFdhData(projectFdhData(data, 'fwf-migrants'), 'fwf-migrants', '11101');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.totalRows, 5);
});

test('preflight accepts a linked and balanced minimal IPD claim', () => {
  const data = validIpdData();
  const result = validateFdhData(projectFdhData(data, 'standard'), 'standard', '11101');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.counts.IPD, 1);
  assert.equal(result.counts.OPD, 0);
  assert.equal(result.totalRows, 6);
});

test('IPD export scope excludes OPD-specific files without dropping shared claim files', () => {
  const data = validIpdData();
  data.OPD = [{ HN: '0002', SEQ: 'VN2' }];
  data.ODX = [{ HN: '0002', SEQ: 'VN2', DIAG: 'J189' }];
  const scoped = scopeFdhData(data, 'IPD');
  assert.equal(scoped.OPD.length, 0);
  assert.equal(scoped.ODX.length, 0);
  assert.equal(scoped.IPD.length, 1);
  assert.equal(scoped.CHT.length, 1);
  assert.equal(scoped.CHA.length, 1);
});

test('PERMITNO is conditional by fund and remains required for UCS', () => {
  const data = validFwfData();
  data.INS[0] = { ...data.INS[0], INSCL: 'UCS', DATEIN: '20260720', PERMITNO: '' };
  const result = validateFdhData(projectFdhData(data, 'standard'), 'standard', '11101');
  assert.equal(result.errors.some((issue) => issue.code === 'PERMITNO_REQUIRED'), true);
});

test('preflight rejects an AER row that is not refer, accident or emergency', () => {
  const data = validFwfData();
  data.AER = [{
    HN: '0001',
    AN: '',
    DATEOPD: '20260720',
    UCAE: '',
    SEQ: 'VN1',
  }];
  const result = validateFdhData(projectFdhData(data, 'standard'), 'standard', '11101');
  assert.equal(result.errors.some((issue) => issue.code === 'AER_OPTYPE_INVALID'), true);
});

test('preflight rejects placeholder HCODE 00000', () => {
  const data = validFwfData();
  data.INS[0].HCODE = '00000';
  data.PAT[0].HCODE = '00000';
  const result = validateFdhData(data, 'fwf-migrants', '11101');
  assert.equal(result.errors.some((issue) => issue.code === 'FWF_HCODE'), true);
  assert.equal(result.errors.some((issue) => issue.code === 'HCODE_FORMAT' && issue.file === 'PAT'), true);
});

test('preflight blocks missing FCode, missing invoice and unbalanced CHA', () => {
  const data = validFwfData();
  data.INS[0].CID = '';
  data.CHT[0].INVOICE_NO = '';
  data.CHA[0].AMOUNT = 99;
  const result = validateFdhData(data, 'fwf-migrants', '11101');
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((issue) => issue.code === 'FWF_FCODE'), true);
  assert.equal(result.errors.some((issue) => issue.code === 'REQUIRED_FIELD' && issue.field === 'INVOICE_NO'), true);
  assert.equal(result.errors.some((issue) => issue.code === 'CHT_CHA_TOTAL'), true);
});

test('API upload uses multipart type=txt and repeated file fields', async () => {
  const originalFetch = globalThis.fetch;
  let capturedFiles = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    assert.equal(init?.body instanceof FormData, true);
    const form = init?.body as FormData;
    assert.equal(form.get('type'), 'txt');
    capturedFiles = form.getAll('file').length;
    return new Response(JSON.stringify({ status: 200 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const files = selectFdhUploadFiles(buildFdhFiles(validFwfData(), 'fwf-migrants', true));
    const result = await uploadFdhFiles('https://fdh.moph.go.th/api/v2/data_hub/16_files', 'test-token', files);
    assert.equal(result.ok, true);
    assert.equal(capturedFiles, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
