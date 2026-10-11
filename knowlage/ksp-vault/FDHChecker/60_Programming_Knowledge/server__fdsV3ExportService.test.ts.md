---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/fdsV3ExportService.test.ts"
source_hash: "8145414145c42b408df5c2ca6910d1ed52d04b90663a152a392db72b985ca634"
managed_by: "sync-ksp-vault"
---
# fdsV3ExportService.test.ts

> Source: `server/fdsV3ExportService.test.ts`
> SHA-256: `8145414145c42b408df5c2ca6910d1ed52d04b90663a152a392db72b985ca634`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateFdsV3TransactionId,
  buildFdsV3PayloadFrom16Files,
  validateFdsV3Payload,
} from './fdsV3ExportService.js';
import type { FdhExportData } from './fdhExport.js';

test('generateFdsV3TransactionId creates 27-character transaction ID', () => {
  const txId = generateFdsV3TransactionId('10665', 42);
  assert.equal(txId.length, 27);
  assert.ok(txId.startsWith('10665-'));
  assert.ok(txId.endsWith('-000042'));
});

test('buildFdsV3PayloadFrom16Files converts 16-file mock data into valid FDS v3 JSON', () => {
  const mockData: FdhExportData = {
    INS: [{ HN: '00001', SEQ: '690101000001', CID: '1100500123456', HOSPMAIN: '10665', INSCL: 'UCS', HTYPE: '1' }],
    PAT: [{ HN: '00001', FNAME: 'สมชาย', LNAME: 'ใจดี', DOB: '1985-05-15', SEX: '1', CHANGWAT: '10', AMPHUR: '01', PERSON_ID: '1100500123456', IDTYPE: '1' }],
    OPD: [{ HN: '00001', SEQ: '690101000001', CLINIC: '00100', DATEOPD: '2026-10-10', TIMEOPD: '09:30', DETAIL: 'ไข้หวัด', TYPEIN: '1', TYPEOUT: '1', UUC: '1' }],
    ORF: [],
    ODX: [{ HN: '00001', SEQ: '690101000001', DIAG: 'J00', DXTYPE: '1', DRDX: 'ว12345', DATEDX: '2026-10-10' }],
    OOP: [],
    IPD: [],
    IRF: [],
    IDX: [],
    IOP: [],
    CHT: [{ HN: '00001', SEQ: '690101000001', INVOICE_NO: 'INV-001', TOTAL: 250 }],
    CHA: [{ HN: '00001', SEQ: '690101000001', INVOICE_NO: 'INV-001', CHRGITEM: '31', AMOUNT: 250 }],
    AER: [],
    ADP: [{ HN: '00001', SEQ: '690101000001', CODE: 'LAB01', TYPE: '2', QTY: 1, RATE: 100, TOTAL: 100, TMLTCODE: '300001' }],
    LVD: [],
    DRU: [{ HN: '00001', SEQ: '690101000001', DID: 'DRUG01', DIDSTD: '123456789012345678901234', DIDNAME: 'Paracetamol', AMOUNT: 10, DRUGPRIC: 15, TOTAL: 150 }],
  };

  const config = {
    hcode: '10665',
    hisSecret: 'TEST_SECRET_KEY',
    hisSourceKey: 'TEST_SOURCE_KEY',
    hisName: 'HOSxP',
    hisVersion: '4.5.2',
  };

  const payload = buildFdsV3PayloadFrom16Files(mockData, config, 'โรงพยาบาลทดสอบ');

  assert.equal(payload.fdhVersion, '3.0.0.59');
  assert.equal(payload.hcode, '10665');
  assert.equal(payload.totalVisits.total, 1);
  assert.equal(payload.data.length, 1);

  const visit = payload.data[0];
  assert.equal(visit.patient.hn, '00001');
  assert.equal(visit.patient.id, '1100500123456');
  assert.equal(visit.patient.name.given, 'สมชาย');
  assert.equal(visit.encounter.opd?.clinic, '00100');
  assert.equal(visit.encounter.diagnosisIcd10[0].icd10, 'J00');
  assert.equal(visit.benefits.claim.inscl, 'UCS');

  // Verify Validation
  const validation = validateFdsV3Payload(payload);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.ucVisits, 1);
});

````
