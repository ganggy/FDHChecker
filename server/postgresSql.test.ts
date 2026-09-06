import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { compilePostgresQuery, UnsupportedPostgresQueryError } from './postgresSql.js';
import { hospitalPool } from './hospitalDatabase.js';
import { getEligibleVisits, getSpecificFundData } from './db.js';
import { REPORT_FUNDS, getFundMissingConditions } from './fundErrorReport.js';
import { mergeFdhClaimDetails } from './fdhClaimDetailMerge.js';

test('HOSxP read expressions execute against PostgreSQL and preserve codes and aliases', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE ovst (vn text PRIMARY KEY, vstdate date, birthday date, pttype text, qty numeric, note text);
      INSERT INTO ovst VALUES ('0001', '2026-09-05', '2000-09-06', '01', 1.25, NULL),
        ('0002', '2026-09-06', '2000-09-06', '02', 2.50, 'test');`);
    const run = async (sql: string, values: unknown[] = []) => {
      const query = compilePostgresQuery(sql, values);
      return (await db.query(query.text, query.values)).rows as Record<string, unknown>[];
    };
    assert.deepEqual(await run(`SELECT vn, DATE_FORMAT(vstdate, '%Y-%m-%d') AS serviceDate,
      TIMESTAMPDIFF(YEAR, birthday, vstdate) AS age, IFNULL(note, 'empty') AS note,
      IF(qty > 2, 'large', 'small') AS size FROM ovst WHERE vn = ?`, ['0001']),
    [{ vn: '0001', serviceDate: '2026-09-05', age: 25, note: 'empty', size: 'small' }]);
    assert.deepEqual(await run(`SELECT GROUP_CONCAT(DISTINCT pttype ORDER BY pttype SEPARATOR ', ') AS codes FROM ovst`), [{ codes: '01, 02' }]);
    assert.deepEqual(await run(`SELECT GROUP_CONCAT(DISTINCT pttype ORDER BY qty DESC SEPARATOR ', ') AS codes FROM ovst`), [{ codes: '02, 01' }]);
    assert.deepEqual(await run(`SELECT vn FROM ovst WHERE vn IN (?) ORDER BY vn LIMIT 1, 1`, [['0001', '0002']]), [{ vn: '0002' }]);
    assert.deepEqual(await run(`SELECT vn FROM ovst WHERE note REGEXP ? AND note LIKE ?`, ['TEST', 'TE%']), [{ vn: '0002' }]);
    assert.deepEqual(await run(`SELECT TIMESTAMPDIFF(MONTH, birthday, vstdate) AS months,
      DATEDIFF(vstdate, DATE_SUB(vstdate, INTERVAL 1 DAY)) AS days FROM ovst WHERE vn = ?`, ['0001']), [{ months: 311, days: 1 }]);
    assert.deepEqual(await run(`SELECT vn FROM ovst WHERE vstdate = DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY)`, ['2026-09-05']), [{ vn: '0002' }]);
    assert.deepEqual(await run(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`, ['public', 'ovst', 'vn']), [{ COLUMN_NAME: 'vn' }]);
  } finally { await db.close(); }
});

test('parameters remain bound in textual order across nested queries, literals and comments', () => {
  const value = "x' OR 1=1 --";
  const query = compilePostgresQuery(`SELECT ? AS first, '?' AS literal,
    (SELECT ? AS nested) AS second FROM ovst /* ? */ WHERE vn IN (?) -- ?\n LIMIT ?`, [value, 'middle', ['001', '002'], 1]);
  assert.deepEqual(query.values, [value, 'middle', '001', '002', 1]);
  assert.ok(!query.text.includes(value));
  assert.match(query.text, /\$1 AS "first"/);
  assert.match(query.text, /\$2 AS "nested"/);
  assert.match(query.text, /IN \(\$3, \$4\)/);
  assert.match(query.text, /LIMIT \$5/);
});

test('unsupported or write SQL fails closed without disclosing SQL or parameters', () => {
  for (const sql of [
    'DELETE FROM patient', 'UPDATE ovst SET pttype = 1', 'CREATE TABLE x(id int)',
    'SELECT 1; SELECT 2', 'SELECT * FROM ovst FOR UPDATE', 'SELECT GET_LOCK(?, 10)',
    "SELECT DATE_FORMAT(vstdate, '%Q') FROM ovst", 'SELECT * FROM other_database.ovst',
    '/*!50000 DELETE FROM patient */ SELECT 1',
  ]) {
    assert.throws(() => compilePostgresQuery(sql, sql.includes('?') ? ['secret-value'] : []), (error: unknown) => {
      assert.ok(error instanceof UnsupportedPostgresQueryError);
      assert.ok(!error.message.includes('secret-value'));
      assert.ok(!error.message.includes(sql));
      return true;
    });
  }
  assert.throws(() => compilePostgresQuery('SELECT ?', []), UnsupportedPostgresQueryError);
  assert.throws(() => compilePostgresQuery('SELECT 1', ['unused']), UnsupportedPostgresQueryError);
  assert.throws(() => compilePostgresQuery('SELECT * FROM ovst WHERE vn IN (?)', [[]]), UnsupportedPostgresQueryError);
});

test('actual eligible-visit and enabled fund read queries pass the PostgreSQL compiler', async (context) => {
  let compiled = 0;
  context.mock.method(hospitalPool, 'getConnection', async () => ({
    query: async (sql: string, values: unknown[] = []) => {
      compilePostgresQuery(sql, values); compiled++;
      return [[], []];
    },
    release() {},
  }));
  await getEligibleVisits('2026-09-05', '2026-09-05');
  for (const fund of REPORT_FUNDS) {
    await assert.doesNotReject(() => getSpecificFundData(fund.id, '2026-09-05', '2026-09-05', { includeTracking: false, throwOnError: true }), fund.id);
  }
  assert.ok(compiled >= REPORT_FUNDS.length + 1);
});

test('actual DRUGP report executes on PostgreSQL HOSxP fixture with joined dimensions and time fields', async (context) => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE patient(hn text PRIMARY KEY, cid text, pname text, fname text, lname text);
      CREATE TABLE pttype(pttype text PRIMARY KEY, name text, hipdata_code text);
      CREATE TABLE ovst(vn text PRIMARY KEY, hn text, pttype text, vstdate date, vsttime time);
      CREATE TABLE opitemrece(vn text, icode text, qty numeric);
      CREATE TABLE s_drugitems(icode text PRIMARY KEY, nhso_adp_code text);
      CREATE TABLE drugitems(icode text PRIMARY KEY);
      INSERT INTO patient VALUES ('000001', 'SYNTHETIC', '', 'ทดสอบ', 'ระบบ');
      INSERT INTO pttype VALUES ('01', 'UCS', 'UCS');
      INSERT INTO ovst VALUES ('TEST-VN', '000001', '01', '2026-09-05', '08:30:00');
      INSERT INTO s_drugitems VALUES ('POST', 'DRUGP'), ('MED', NULL);
      INSERT INTO drugitems VALUES ('MED');
      INSERT INTO opitemrece VALUES ('TEST-VN', 'POST', 1), ('TEST-VN', 'MED', 10);
    `);
    context.mock.method(hospitalPool, 'getConnection', async () => ({
      query: async (sql: string, values: unknown[] = []) => {
        const compiled = compilePostgresQuery(sql, values);
        const result = await db.query(compiled.text, compiled.values);
        return [result.rows, result.fields];
      }, release() {},
    }));
    const rows = await getSpecificFundData('drugp', '2026-09-05', '2026-09-05', { includeTracking: false, throwOnError: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hn, '000001');
    assert.equal(rows[0].vsttime, '08:30:00');
    assert.equal(rows[0].serviceDate, '2026-09-05');
    assert.equal(rows[0].patientName, 'ทดสอบ ระบบ');
    assert.deepEqual(getFundMissingConditions('drugp', rows[0]), []);
    assert.deepEqual(await getSpecificFundData('drugp', '2026-09-06', '2026-09-06', { includeTracking: false, throwOnError: true }), []);
  } finally { await db.close(); }
});

test('FDH import merge keeps empty-status semantics and recomputes IPD calendar days', () => {
  const opd = [{ vn: '0001', fdh_status_label: 'accepted' }];
  assert.equal(mergeFdhClaimDetails(opd, [{ vn: '0001', claim_status: '' }], 'OPD')[0].fdh_status_label, 'accepted');
  const rows = mergeFdhClaimDetails([{ an: '0002', dchdate: '2026-09-01', fdh_transaction_uid: 'old' }],
    [{ an: '0002', claim_status: 'received', upload_uid: 'new', sent_at: '2026-09-05 01:00:00' }], 'IPD');
  assert.equal(rows[0].fdh_transaction_uid, 'new');
  assert.equal(rows[0].fdh_days_from_discharge, 4);
  assert.equal(rows[0].fdh_days_note, 'ส่ง FDH แล้ว');
  const sentAt = new Date('2026-09-04T18:00:00Z');
  const dated = mergeFdhClaimDetails([{ an: '0002', dchdate: '2026-09-01' }], [{ an: '0002', sent_at: sentAt, sent_at_day: '2026-09-05' }], 'IPD')[0];
  assert.equal(dated.fdh_reservation_datetime, sentAt);
  assert.equal(dated.fdh_days_from_discharge, 4);
  assert.equal(mergeFdhClaimDetails(opd, [], 'OPD')[0], opd[0]);
});
