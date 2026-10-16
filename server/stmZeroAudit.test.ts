import test from 'node:test';
import assert from 'node:assert/strict';
import { pickImportColumn } from './utils/importColumnLookup.js';
import { statementEncounterIdentity, findStatementEncounter, uniqueHisEncounter, extractFiveDigitHcode, matchesHospitalIdentity, resolveHospitalEncounter } from './stmEncounterIdentity.js';
import { repSheetZeroReasons } from '../src/utils/repSheetZeroAudit.js';
import { isDataSheetZero, includeAuditSupplement, detectTypeFromSheetName } from '../src/utils/repstmImportClassification.js';
import { readZeroAuditSourceRows } from './repositories/stmZero.repository.js';
import { PGlite } from '@electric-sql/pglite';
import { compilePostgresQuery } from './postgresSql.js';
import type { PoolConnection } from 'mysql2/promise';
import { isExplicitZero, originalPaidAmount, classifyZeroAction, canPrepareZeroResend, resolveUniqueRepVisit, type StmZeroRow } from '../src/utils/stmZeroAudit.js';
const row = { matched: true, has_payment: false, paid_amount: 0, action: 'review', errorcode: '', verifycode: '', maininscl: '', raw_data: {} } as StmZeroRow;
test('REP Data Sheet 0 is always archived as a supplement without including unrelated sheets', () => {
  for (const name of ['Data Sheet 0', 'data_sheet_0', ' Data sheet 0 ', 'Sheet0']) {
    assert.equal(isDataSheetZero(name), true);
    assert.equal(detectTypeFromSheetName(name), 'REP');
    assert.equal(includeAuditSupplement(name, 'REP', false), true);
  }
  assert.equal(includeAuditSupplement('Data Drug', 'REP', false), false);
  assert.equal(includeAuditSupplement('Data Sheet 0', 'STM', false), false);
  assert.equal(isDataSheetZero('Data Sheet 01'), false);
});
test('REP reasons preserve original text and distinguish known and unknown codes', () => {
  const result = repSheetZeroReasons({ ...row, errorcode: 'C101, D999', raw_data: { เหตุผลที่ไม่ชดเชย: 'ข้อความจากไฟล์ตัวอย่าง', patient_name: 'ห้ามใช้เป็นเหตุผล' } }, { '101': { type: 'Corrective', description: 'คำอธิบายตัวอย่าง', guide: 'แนวทางตัวอย่าง' } });
  assert.deepEqual(result.original, [{ label: 'เหตุผลที่ไม่ชดเชย', text: 'ข้อความจากไฟล์ตัวอย่าง' }]);
  assert.equal(result.explanations[0].description, 'คำอธิบายตัวอย่าง');
  assert.equal(result.explanations[1].known, false);
  assert.equal(repSheetZeroReasons({ ...row, raw_data: {} }, {}).original.length, 0);
});
test('REP Sheet 0 query reads only active REP sheets, including absent and positive amounts, and scopes by hcode', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE repstm_import_batch (id int PRIMARY KEY, data_type text, source_filename text, sheet_name text, created_at timestamp, replaces_batch_id int, hcode text);
      CREATE TABLE repstm_import_row (id int PRIMARY KEY, batch_id int, data_type text, paid_amount numeric);
      INSERT INTO repstm_import_batch VALUES
        (1, 'REP', 'rep-demo.xls', 'Data Sheet 0', '2026-09-20', NULL, '10999'),
        (2, 'STM', 'stm-demo.xls', 'Data Sheet 0', '2026-09-20', NULL, '10999'),
        (3, 'REP', 'rep-demo.xls', 'Data Drug', '2026-09-20', NULL, '10999'),
        (4, 'REP', 'rep-old.xls', 'Data Sheet 0', '2026-09-20', NULL, '10999'),
        (5, 'REP', 'rep-new.xls', 'Data Sheet 0', '2026-09-20', 4, '04567'),
        (6, 'REP', 'rep-outside.xls', 'Data Sheet 0', '2026-08-20', NULL, '10999');
      INSERT INTO repstm_import_row VALUES (1,1,'REP',NULL), (2,1,'REP',10), (3,2,'STM',0), (4,3,'REP',NULL), (5,4,'REP',NULL), (6,5,'REP',0), (7,6,'REP',0);`);
    const connection = { async query(sql: string, values: unknown[]) {
      const query = compilePostgresQuery(sql, values);
      return [(await db.query(query.text, query.values)).rows];
    } } as unknown as Pick<PoolConnection, 'query'>;
    const rows = await readZeroAuditSourceRows(connection, '2026-09-01', '2026-09-30', 'rep-sheet-zero');
    assert.deepEqual(rows.map(r => r.id), [6, 2, 1]);
    assert.ok(rows.every(r => r.audit_id.startsWith('raw-')));
    // Scoped to PCU 04567 -> only sees batch 5 (row 6)
    const pcuRows = await readZeroAuditSourceRows(connection, '2026-09-01', '2026-09-30', 'rep-sheet-zero', undefined, '04567');
    assert.deepEqual(pcuRows.map(r => r.id), [6]);
    const detail = await readZeroAuditSourceRows(connection, '2026-09-01', '2026-09-30', 'rep-sheet-zero', ['raw-2']);
    assert.deepEqual(detail.map(r => r.id), [2]);
    assert.deepEqual(await readZeroAuditSourceRows(connection, '2026-09-01', '2026-09-30', 'rep-sheet-zero', ['stm-2']), []);
  } finally { await db.close(); }
});
test('blank and missing payments are not zero', () => {
  for (const value of [null, undefined, '', ' ', 'invalid', 0.01]) assert.equal(isExplicitZero(value), false);
  assert.equal(isExplicitZero('0.00'), true);
  assert.equal(originalPaidAmount({ paid_amount: '' }), null);
  assert.equal(originalPaidAmount({ ชดเชยสุทธิ: '0' }), 0);
});
test('guidance distinguishes approval, appeal, correction and deferred payout', () => {
  for (const [code, action] of [['W305', 'approval'], ['D305', 'approval'], ['D001', 'appeal'], ['D011', 'correction'], ['D012', 'appeal']]) {
    assert.equal(classifyZeroAction({ ...row, errorcode: code }), action);
  }
  assert.equal(classifyZeroAction({ ...row, maininscl: 'HERB_GB' }), 'deferred');
  assert.equal(classifyZeroAction({ ...row, has_payment: true }), 'paid');
});
test('unmatched, unknown payments, paid visits and appeal queues cannot prepare resend', () => {
  assert.equal(canPrepareZeroResend(row), true);
  for (const change of [{ matched: false }, { paid_amount: null }, { has_payment: true }, { payment_uncertain: true }, { action: 'appeal' as const }, { action: 'approval' as const }, { action: 'deferred' as const }]) {
    assert.equal(canPrepareZeroResend({ ...row, ...change }), false);
  }
});
test('TRAN_ID matching requires same HN and one distinct encounter', () => {
  const a = { tran_id: 'DEMO-T', hn: 'DEMO-H', vn: 'DEMO-V', an: '' };
  assert.deepEqual(resolveUniqueRepVisit('DEMO-H', 'DEMO-T', [a, a]), { vn: 'DEMO-V', an: '' });
  assert.equal(resolveUniqueRepVisit('OTHER-H', 'DEMO-T', [a]), null);
  assert.equal(resolveUniqueRepVisit('', 'DEMO-T', [a]), null);
  assert.equal(resolveUniqueRepVisit('DEMO-H', 'DEMO-T', [a, { ...a, vn: 'OTHER-V' }]), null);
  assert.equal(resolveUniqueRepVisit('DEMO-H', 'DEMO-T', [{ ...a, an: 'DEMO-T', vn: '' }]), null);
});

test('identifier headers cannot match substrings of transaction or insurance columns', () => {
  for (const raw of [{ TRAN_ID: 'DEMO-T', MAININSCL: 'UCS' }, { AN: '', TRAN_ID: 'DEMO-T' }]) {
    assert.equal(pickImportColumn(raw, ['AN']), '');
    assert.equal(pickImportColumn(raw, ['HN', 'VN', 'IP']), '');
  }
  assert.equal(pickImportColumn({ ' AN ': 'DEMO-A', TRAN_ID: 'DEMO-T' }, ['AN']), 'DEMO-A');
  assert.equal(pickImportColumn({ 'paid_amount (บาท)': '0.00' }, ['paid_amount']), '0.00');
});

test('legacy OP UCS transaction-as-AN is corrected without trusting stored department', () => {
  const identity = statementEncounterIdentity({ source_filename: 'STM_DEMO_OPUCS202608_02.xls', an: 'DEMO-T', department: 'IP',
    raw_data: { TRAN_ID: 'DEMO-T', HN: 'DEMO-H', วันเข้ารักษา: '07/08/2026 10:15:00' } });
  assert.equal(identity.kind, 'OP');
  assert.equal(identity.an, '');
  assert.equal(identity.tranId, 'DEMO-T');
  assert.equal(identity.serviceDatetime, '2026-08-07 10:15:00');
  assert.equal(statementEncounterIdentity({ raw_data: { TRAN_ID: 'DEMO-T' }, an: 'DEMO-T' }).kind, 'UNKNOWN');
  assert.equal(statementEncounterIdentity({ raw_data: { AN: 'DEMO-A', TRAN_ID: 'DEMO-T' } }).kind, 'IP');
});

test('OP recovery uses the service minute, permits omitted seconds, and rejects ambiguity', async () => {
  const identity = statementEncounterIdentity({ source_filename: 'STM_DEMO_OPUCS202608.xls', raw_data: { HN: 'DEMO-H', วันเข้ารักษา: '07/08/2026 10:15:00' } });
  let queries = 0;
  const connection = { async query(sql: string, values: string[]) {
    queries++;
    assert.match(sql, /FROM ovst/);
    assert.match(sql, /v\.vsttime >= \? AND v\.vsttime <= \?/);
    assert.deepEqual(values, ['DEMO-H', '2026-08-07', '10:15:00', '10:15:59']);
    return [[{ visit_code: 'DEMO-V', hn: 'DEMO-H' }]];
  } };
  assert.deepEqual(await findStatementEncounter(connection, identity), { kind: 'OP', visit_code: 'DEMO-V', hn: 'DEMO-H' });
  assert.equal(queries, 1);
  assert.equal(await findStatementEncounter({ async query() { return [[{ visit_code: 'DEMO-V1', hn: 'DEMO-H' }, { visit_code: 'DEMO-V2', hn: 'DEMO-H' }]]; } }, identity), null);
  assert.equal(uniqueHisEncounter('DEMO-H', 'UNKNOWN', [{ kind: 'OP', visit_code: 'DEMO-V', hn: 'DEMO-H' }, { kind: 'IP', visit_code: 'DEMO-A', hn: 'DEMO-H' }]), null);
  assert.equal(uniqueHisEncounter('OTHER-H', 'OP', [{ kind: 'OP', visit_code: 'DEMO-V', hn: 'DEMO-H' }]), null);
});

test('strict facility HCODE and patient identity verification prevents cross-facility VN collisions', async () => {
  assert.equal(extractFiveDigitHcode('04567 รพ.สต.บ้านตัวอย่าง', 'REP_10999_202608.xls'), '04567');
  assert.equal(extractFiveDigitHcode('', 'STM_04567_OPUCS202608.xls'), '04567');

  const pcuIdentity = statementEncounterIdentity({
    source_filename: 'REP_04567_202608.xls',
    raw_data: { HCODE: '04567', SEQ: '690807101500', HN: '0012345', PID: '1100100100101', วันเข้ารักษา: '07/08/2026 10:15:00' },
  });
  assert.equal(pcuIdentity.hcode, '04567');

  // Hospital visit with same VN/HN/CID/date but different hospital_code (10999 vs 04567) MUST be rejected
  assert.equal(
    matchesHospitalIdentity(pcuIdentity, 'OP', {
      visit_code: '690807101500',
      hn: '0012345',
      cid: '1100100100101',
      service_date: '2026-08-07',
      service_time: '10:15:00',
      hcode: '10999',
    }),
    false,
  );

  // Matching hcode + patient + date succeeds
  assert.equal(
    matchesHospitalIdentity(pcuIdentity, 'OP', {
      visit_code: '690807101500',
      hn: '0012345',
      cid: '1100100100101',
      service_date: '2026-08-07',
      service_time: '10:15:00',
      hcode: '04567',
    }),
    true,
  );

  // VN-only row without service_date or 13-digit CID cannot auto-link by key alone
  const vnOnlyIdentity = statementEncounterIdentity({
    raw_data: { SEQ: '690807101500', HN: '0012345' },
  });
  const mockHospital = {
    async query(sql: string) {
      if (sql.includes('opdconfig')) return [[{ hospitalcode: '04567' }]];
      return [[{ visit_code: '690807101500', hn: '0012345', cid: '1100100100101', service_date: '2026-08-07', service_time: '10:15:00' }]];
    },
  };
  assert.equal(await resolveHospitalEncounter(mockHospital, vnOnlyIdentity, true), null);
});

