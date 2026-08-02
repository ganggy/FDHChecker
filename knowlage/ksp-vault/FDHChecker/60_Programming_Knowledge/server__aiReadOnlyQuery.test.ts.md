---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiReadOnlyQuery.test.ts"
source_hash: "3305543a7b235bd89e3a5781a3e8dde056446f3d4a046db35d99233c6158f54b"
managed_by: "sync-ksp-vault"
---
# aiReadOnlyQuery.test.ts

> Source: `server/aiReadOnlyQuery.test.ts`
> SHA-256: `3305543a7b235bd89e3a5781a3e8dde056446f3d4a046db35d99233c6158f54b`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReadOnlySql } from './aiReadOnlyQuery.js';

test('accepts an allowlisted SELECT and adds a bounded LIMIT', () => {
  const result = validateReadOnlySql(`SELECT COUNT(DISTINCT o.vn) AS visits FROM ovst o WHERE o.vstdate = '2026-08-02'`);
  assert.match(result.sql, /LIMIT 200$/);
  assert.deepEqual(result.tables, ['ovst']);
});

test('allows CTE names while validating their physical tables', () => {
  const result = validateReadOnlySql(`
    WITH visits AS (SELECT vn, hn FROM ovst WHERE vstdate = '2026-08-02')
    SELECT COUNT(*) AS total FROM visits
  `);
  assert.deepEqual(result.tables, ['ovst']);
});

test('clamps an excessive result limit', () => {
  assert.match(validateReadOnlySql('SELECT hn FROM patient LIMIT 99999').sql, /LIMIT 200$/);
});

test('rejects writes, multiple statements, comments and SELECT INTO', () => {
  for (const sql of [
    "UPDATE patient SET fname='x'",
    'WITH changed AS (DELETE FROM patient RETURNING hn) SELECT * FROM changed',
    'SELECT hn FROM patient; DELETE FROM patient',
    'SELECT hn FROM patient -- bypass',
    "SELECT hn INTO OUTFILE '/tmp/data' FROM patient",
    'SELECT p.hn FROM patient p, secret_table s',
    'SELECT SLEEP(30) FROM patient',
    'SELECT @@version FROM patient',
    'SELECT hn FROM patient FOR UPDATE',
    'SELECT hn FROM patient UNION SELECT password FROM patient',
  ]) assert.throws(() => validateReadOnlySql(sql));
});

test('rejects unknown tables and system schemas', () => {
  assert.throws(() => validateReadOnlySql('SELECT * FROM user_passwords'));
  assert.throws(() => validateReadOnlySql('SELECT * FROM information_schema.tables'));
});

test('does not treat blocked words inside quoted values as commands', () => {
  assert.doesNotThrow(() => validateReadOnlySql("SELECT 'update delete' AS note FROM patient LIMIT 1"));
});

````
