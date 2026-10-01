import test from 'node:test';
import assert from 'node:assert/strict';
import { appendIpdAudit, validateIpdAudit } from './ipdAuditService.js';
import type { getUTFConnection } from './db/connection.js';

test('audit rejects invalid inputs before connecting and ignores a forged actor', async () => {
  let connections = 0;
  const connect = (async () => { connections++; throw new Error('unexpected connection'); }) as typeof getUTFConnection;
  await assert.rejects(appendIpdAudit({ an: '', status: 'AUDITED' }, 'SESSION', connect));
  assert.equal(connections, 0);
  assert.equal(validateIpdAudit({ an: 'DEMO-AN', status: 'AUDITED', updated_by: 'FORGED' }, 'SESSION').actor, 'SESSION');
});

test('repeated audit preserves separate events and does not overwrite the legacy table', async () => {
  const events: unknown[][] = []; let releases = 0;
  const connect = (async () => ({
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT an')) return [[{ an: 'DEMO-AN' }]];
      if (sql.startsWith('CREATE TABLE')) return [[]];
      assert.ok(sql.startsWith('INSERT INTO z_fdh_audit_history'));
      assert.ok(!sql.includes('DUPLICATE'));
      events.push(args); return [{ insertId: events.length }];
    }, release: () => { releases++; },
  })) as unknown as typeof getUTFConnection;
  await appendIpdAudit({ an: 'DEMO-AN', status: 'AUDITED', notes: 'First review' }, 'REVIEWER-1', connect);
  await appendIpdAudit({ an: 'DEMO-AN', status: 'AUDITED', notes: 'Second review' }, 'REVIEWER-2', connect);
  assert.equal(events.length, 2); assert.equal(releases, 2);
  assert.equal(events[0][2], 'REVIEWER-1'); assert.equal(events[1][2], 'REVIEWER-2');
});
