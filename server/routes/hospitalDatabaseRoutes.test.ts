import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createHospitalDatabaseRouter } from './hospitalDatabaseRoutes.js';
import { hospitalDatabaseResponseGuard, recordHospitalDatabaseFailure } from '../hospitalDatabaseContext.js';
import { UnsupportedPostgresQueryError } from '../postgresSql.js';

test('database settings redact secrets, retest saves, and do not activate or save failed targets', async () => {
  const initial = { type: 'mysql' as const, host: 'localhost', port: 3306, database: 'hospital_a', schema: '', user: 'reader', password: 'secret-value', ssl: false };
  let saved = { ...initial };
  let tests = 0, saves = 0;
  const app = express(); app.use(express.json());
  app.use('/db', createHospitalDatabaseRouter({
    active: initial, read: () => saved,
    test: async (value) => {
      tests++;
      if (value.database === 'broken') throw new Error('secret-value in driver error');
      const compatible = value.database !== 'missing';
      return { connected: true, compatible, missing: compatible ? [] : ['ovst.vn'], mode: 'read-only', message: compatible ? 'connected' : 'missing columns' };
    },
    save: (value) => { saves++; saved = value as typeof saved; },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/db`;
  const post = (action: string, database: string) => fetch(`${url}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...initial, database }) });
  try {
    const first = await (await fetch(url)).json();
    assert.equal(first.data.passwordConfigured, true);
    assert.ok(!JSON.stringify(first).includes('secret-value'));
    assert.equal(first.restartRequired, false);
    assert.equal((await post('test', 'hospital_b')).status, 200);
    assert.equal(saves, 0);
    const failed = await post('save', 'broken');
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes('secret-value'));
    assert.equal((await post('save', 'missing')).status, 422);
    assert.equal(saves, 0);
    assert.equal((await post('save', 'hospital_b')).status, 200);
    assert.equal(tests, 4);
    assert.equal(saves, 1);
    const final = await (await fetch(url)).json();
    assert.equal(final.restartRequired, true);
    assert.equal(final.active.database, 'hospital_a');
    assert.equal(final.data.database, 'hospital_b');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('a swallowed PostgreSQL failure cannot return an empty successful report or affect another request', async () => {
  const app = express();
  app.use(hospitalDatabaseResponseGuard);
  app.get('/failed', async (_req, res) => {
    recordHospitalDatabaseFailure(new UnsupportedPostgresQueryError('รูปแบบรายงานไม่รองรับ'));
    await Promise.resolve();
    res.json({ success: true, data: [] });
  });
  app.get('/good', (_req, res) => res.json({ success: true, data: [] }));
  app.get('/export', (_req, res) => {
    recordHospitalDatabaseFailure(new UnsupportedPostgresQueryError('รูปแบบส่งออกไม่รองรับ'));
    res.attachment('report.zip').send(Buffer.from('partial archive'));
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const [failed, good] = await Promise.all([fetch(`${url}/failed`), fetch(`${url}/good`)]);
    assert.equal(failed.status, 422);
    assert.equal((await failed.json()).success, false);
    assert.equal(good.status, 200);
    assert.equal((await good.json()).success, true);
    const archive = await fetch(`${url}/export`);
    assert.equal(archive.status, 422);
    assert.equal(archive.headers.get('content-disposition'), null);
    assert.equal((await archive.json()).success, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
