import assert from 'node:assert/strict';
import test from 'node:test';
import type { HospitalConnection } from './hospitalDatabase.js';
import { readVisitClinical, readVisitItems } from './visitDetails.js';
import { attachFundEligibility, excludedScreeningCode } from './fundEligibility.js';
import { parseSiteWalkinSettings, parseVillageScope, readHospitalIdentity } from './siteProfile.js';
import { PGlite } from '@electric-sql/pglite';
import { compilePostgresQuery } from './postgresSql.js';

function fakeConnection(schema: Record<string, string[]>, run: (sql: string, values: unknown[]) => unknown[]) {
  return { query: async (sql: string, values: unknown[]) => [sql.includes('information_schema.columns')
    ? Object.entries(schema).flatMap(([table_name, columns]) => columns.map(column_name => ({ table_name, column_name })))
    : run(sql, values)] } as unknown as HospitalConnection;
}

test('missing optional procedure tables do not discard OPD diagnoses', async () => {
  const connection = fakeConnection({ ovstdiag: ['vn', 'icd10', 'diagtype'] }, (sql, values) => {
    assert.ok(sql.includes('FROM ovstdiag')); assert.deepEqual(values, ['visit-test']);
    return [{ code: 'Z131', type: '1' }];
  });
  const result = await readVisitClinical(connection, 'visit-test');
  assert.equal(result.diagnoses[0].code, 'Z131');
  assert.deepEqual(result.procedures, []);
  assert.ok(result.warnings.length > 0);
});

test('IPD clinical lookup uses AN and does not accidentally use the admission VN', async () => {
  const connection = fakeConnection({ iptdiag: ['an', 'icd10'], iptoprt: ['an', 'icd9'] }, (sql, values) => {
    assert.ok(sql.includes('.an = ?')); assert.deepEqual(values, ['admission-test']);
    return [{ code: sql.includes('iptdiag') ? 'Z000' : '9999' }];
  });
  const result = await readVisitClinical(connection, 'visit-test', 'admission-test');
  assert.equal(result.diagnoses.length, 1); assert.equal(result.procedures.length, 1);
});

test('items survive missing s_drugitems mappings and zero-price medications', async () => {
  const connection = fakeConnection({ opitemrece: ['an', 'vn', 'icode'], drugitems: ['icode', 'name'] }, (sql, values) => {
    assert.ok(!sql.includes('JOIN s_drugitems'));
    assert.ok(!sql.includes('sum_price > 0'));
    assert.ok(sql.includes('o.an = ?')); assert.deepEqual(values, ['an-test']);
    return [{ icode: 'drug-test', item_name: 'Synthetic medicine', qty: 2, unitprice: 0, sum_price: 0, is_drug: 1 }];
  });
  const rows = await readVisitItems(connection, 'vn-test', 'an-test');
  assert.equal(rows[0].drugName, 'Synthetic medicine'); assert.equal(rows[0].price, 0);
});

test('screening ranges normalize dots and preserve the requested endpoints', () => {
  for (const code of ['E11.0', 'e119']) assert.equal(excludedScreeningCode('fpg_screening', code), true);
  for (const code of ['E109', 'E120']) assert.equal(excludedScreeningCode('fpg_screening', code), false);
  for (const code of ['I10', 'I11.0', 'I119', 'I12.0']) assert.equal(excludedScreeningCode('cholesterol_screening', code), true);
  assert.equal(excludedScreeningCode('cholesterol_screening', 'I129'), false);
});

test('all-patient history is queried without a visit/date filter, including IPD', async () => {
  const connection = fakeConnection({ ovstdiag: ['vn', 'icd10'], ovst: ['vn', 'hn'], iptdiag: ['an', 'icd10'], ipt: ['an', 'hn'] }, (sql, values) => {
    assert.ok(sql.includes('JOIN ipt')); assert.ok(!sql.includes('BETWEEN'));
    assert.deepEqual(values, ['test-hn', 'test-hn']);
    return [{ hn: 'test-hn', icd10: 'E11.9' }];
  });
  const [row] = await attachFundEligibility(connection, 'fpg_screening', [{ hn: 'test-hn', vn: 'new-visit' }]);
  assert.equal(row.eligibility_blocked, true); assert.match(String(row.eligibility_reason), /E11.9/);
});

test('missing history sources require review rather than declaring eligibility', async () => {
  const connection = fakeConnection({}, () => []);
  const [row] = await attachFundEligibility(connection, 'fpg_screening', [{ hn: 'test-hn' }]);
  assert.equal(row.eligibility_blocked, true); assert.equal(row.eligibility_review, true);
});

test('ultrasound is checked per pregnancy, with missing linkage and repeated quantities held for review', async () => {
  const connection = fakeConnection({ person_anc_service: ['vn', 'person_anc_id'], opitemrece: ['vn', 'icode', 'qty'], s_drugitems: ['icode', 'nhso_adp_code'] }, sql => sql.startsWith('SELECT DISTINCT vn')
    ? [{ vn: 'v1', person_anc_id: 1 }, { vn: 'v2', person_anc_id: 2 }, { vn: 'v3', person_anc_id: 3 }]
    : [{ vn: 'v1', person_anc_id: 1, qty: 1 }, { vn: 'old', person_anc_id: 1, qty: 1 }, { vn: 'v2', person_anc_id: 2, qty: 1 }, { vn: 'v3', person_anc_id: 3, qty: 2 }]);
  const result = await attachFundEligibility(connection, 'anc_ultrasound', ['v1', 'v2', 'v3', 'missing'].map(vn => ({ vn, hn: 'same-test-patient' })));
  assert.deepEqual(result.map(row => row.eligibility_blocked), [true, false, true, true]);
});

test('hospital identity comes from opdconfig and UC/village scope has no copied hospital defaults', async () => {
  const connection = fakeConnection({}, () => [{ hospitalname: 'Synthetic Hospital', hospitalcode: '99999' }]);
  assert.deepEqual(await readHospitalIdentity(connection), { hospital_name: 'Synthetic Hospital', hospital_code: '99999' });
  assert.deepEqual(parseSiteWalkinSettings({ uc_walkin_pttypes: ['50', '51'], uc_walkin_icode: 'testcode' }), { pttypes: ['50', '51'], icode: 'testcode' });
  assert.throws(() => parseSiteWalkinSettings(null));
  assert.throws(() => parseSiteWalkinSettings({ uc_walkin_pttypes: ["50') OR 1=1"], uc_walkin_icode: 'test' }));
  assert.deepEqual(parseVillageScope(['8', '19']), ['8', '19']);
  assert.throws(() => parseVillageScope([]));
});

test('the detail view retains real summary diagnoses when the separate diagnosis table is empty', async () => {
  const connection = fakeConnection({ ovstdiag: ['vn', 'icd10'], vn_stat: ['vn', 'pdx', 'dx0'] }, (sql, values) => {
    assert.deepEqual(values, ['visit-test']);
    return sql.includes('FROM vn_stat') ? [{ pdx: 'Z131', dx0: 'Z136' }] : [];
  });
  const result = await readVisitClinical(connection, 'visit-test');
  assert.deepEqual(result.diagnoses.map(row => row.code), ['Z131', 'Z136']);
  assert.ok(result.warnings.some(warning => warning.includes('vn_stat')));
});

test('portable detail and eligibility SQL execute on an isolated PostgreSQL schema', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE ovst(vn text, hn text);
      CREATE TABLE ovstdiag(vn text, icd10 text, diagtype text);
      CREATE TABLE vn_stat(hn text, pdx text, dx0 text);
      CREATE TABLE ipt(an text, hn text);
      CREATE TABLE iptdiag(an text, icd10 text);
      CREATE TABLE opitemrece(vn text, an text, icode text, income text, qty numeric, unitprice numeric, sum_price numeric);
      CREATE TABLE drugitems(icode text, name text);
      CREATE TABLE s_drugitems(icode text, nhso_adp_code text);
      CREATE TABLE person_anc_service(vn text, person_anc_id integer);
      CREATE TABLE dtmain(vn text, tmcode text);
      INSERT INTO ovst VALUES ('old','test-hn'),('current','test-hn');
      INSERT INTO ovstdiag VALUES ('old','E11.9','1'),('current','Z131','1');
      INSERT INTO vn_stat VALUES ('only-summary-hn','E110','Z131');
      INSERT INTO opitemrece VALUES ('current',NULL,'med','01',2,0,0),('anc',NULL,'us','02',1,0,0);
      INSERT INTO drugitems VALUES ('med','Synthetic medicine');
      INSERT INTO s_drugitems VALUES ('us','30010');
      INSERT INTO person_anc_service VALUES ('anc',1);
      INSERT INTO dtmain VALUES ('current','testprocedure');
    `);
    const connection = { query: async (sql: string, values: unknown[] = []) => {
      const query = compilePostgresQuery(sql, sql.includes('information_schema.columns') ? ['public', ...values.slice(1)] : values);
      return [(await db.query(query.text, query.values)).rows];
    } } as unknown as HospitalConnection;
    const clinical = await readVisitClinical(connection, 'current');
    assert.equal(clinical.diagnoses[0].code, 'Z131');
    assert.equal(clinical.procedures[0].code, 'testprocedure');
    const items = await readVisitItems(connection, 'current');
    assert.equal(items[0].drugName, 'Synthetic medicine');
    assert.equal(items[0].price, 0);
    const screening = await attachFundEligibility(connection, 'fpg_screening', [{ hn: 'test-hn', vn: 'current' }]);
    assert.equal(screening[0].eligibility_blocked, true);
    const summaryOnly = await attachFundEligibility(connection, 'fpg_screening', [{ hn: 'only-summary-hn' }]);
    assert.match(String(summaryOnly[0].eligibility_reason), /E110/);
    assert.equal(summaryOnly[0].eligibility_review, false);
    const anc = await attachFundEligibility(connection, 'anc_ultrasound', [{ hn: 'test-hn', vn: 'anc' }]);
    assert.equal(anc[0].eligibility_blocked, false);
  } finally { await db.close(); }
});
