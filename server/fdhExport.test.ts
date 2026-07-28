import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFdhLayouts,
  projectFdhData,
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
