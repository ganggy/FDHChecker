---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/apiPagePermissions.test.ts"
source_hash: "61d9feb5b1764919f52d3b5375cdd9b4c8e4d8d2f07797b0600e2eeb80e58c91"
managed_by: "sync-ksp-vault"
---
# apiPagePermissions.test.ts

> Source: `server/apiPagePermissions.test.ts`
> SHA-256: `61d9feb5b1764919f52d3b5375cdd9b4c8e4d8d2f07797b0600e2eeb80e58c91`

````typescript
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
      ['/official-receivable/aging', 'GET', 'officialReceivable', 200],
      ['/official-receivable/aging', 'GET', 'receivable', 200],
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

````
