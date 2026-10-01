import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { canAccessApiPage } from './apiPagePermissions.js';

test('HTTP permissions separate reading from imports and match settlement menu', async () => {
  const app = express();
  app.use((req, res) => {
    const role = String(req.headers['x-fixture-role'] || '');
    if (!role) return void res.sendStatus(401);
    res.sendStatus(canAccessApiPage(req.path, req.method, { menu_permissions: [role] }) ? 200 : 403);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cases = [
      ['/repstm/import', 'POST', 'reconciliation', 403],
      ['/repstm/import', 'POST', 'repstm', 200],
      ['/repstm/manage/batches', 'GET', 'reconciliation', 200],
      ['/receivables/settlement/execute', 'POST', 'receivable', 403],
      ['/receivables/settlement/execute', 'POST', 'receivableSettlement', 200],
      ['/hosxp/audit', 'POST', 'staff', 403],
      ['/hosxp/audit', 'POST', 'ipd', 200],
      ['/moph-claim/vaccine/check', 'POST', 'mophDmht', 403],
      ['/moph-claim/vaccine/check', 'POST', 'mophVaccine', 200],
      ['/new-unregistered-route', 'GET', 'staff', 403],
      ['/hosxp/audit', 'POST', '', 401],
    ] as const;
    for (const [path, method, role, status] of cases) {
      const result = await fetch(base + path, { method, headers: { 'x-fixture-role': role } });
      assert.equal(result.status, status, `${role} ${method} ${path}`);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
