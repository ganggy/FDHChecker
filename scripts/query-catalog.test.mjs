import assert from 'node:assert/strict';
import test from 'node:test';
import { extractQueriesFromSource, readAllowedTables } from './lib/query-catalog.mjs';

const allowed = new Set(['patient', 'ovst']);

test('extracts parameterized read-only queries with source metadata', () => {
  const source = `const findPatient = async () => connection.query(
    'SELECT p.hn FROM patient p JOIN ovst o ON o.hn = p.hn WHERE o.vstdate = ?', [date]
  );`;
  const [query] = extractQueriesFromSource(source, 'server/example.ts', allowed);
  assert.equal(query.functionName, 'findPatient');
  assert.deepEqual(query.tables, ['patient', 'ovst']);
  assert.match(query.sql, /\?/);
});

test('rejects mutations, interpolated SQL, and tables outside the AI allowlist', () => {
  const source = `
    connection.query('UPDATE patient SET fname = ? WHERE hn = ?', values);
    connection.query(\`SELECT hn FROM patient WHERE hn = \${hn}\`);
    connection.query('SELECT password FROM users');
  `;
  assert.deepEqual(extractQueriesFromSource(source, 'server/unsafe.ts', allowed), []);
});

test('reads only the allowlist declaration', () => {
  const result = readAllowedTables("export const AI_ALLOWED_HOSXP_TABLES = new Set(['patient', 'ovst']); const secret='users';");
  assert.deepEqual([...result], ['patient', 'ovst']);
});
