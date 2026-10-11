---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/ucWalkinAutoBatchService.test.ts"
source_hash: "dc6ee7a1e98428b7747dd512ece56a3731d09367806e6700fe5e0e5cc5671860"
managed_by: "sync-ksp-vault"
---
# ucWalkinAutoBatchService.test.ts

> Source: `server/ucWalkinAutoBatchService.test.ts`
> SHA-256: `dc6ee7a1e98428b7747dd512ece56a3731d09367806e6700fe5e0e5cc5671860`

````typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { getUcWalkinBatchConfig } from './ucWalkinAutoBatchService.js';
import { closeDatabasePools } from './db/connection.js';

test('UC WALKIN batch config defaults and bounds', async (t) => {
  t.after(async () => {
    await closeDatabasePools();
  });
  const config = await getUcWalkinBatchConfig();
  assert.equal(typeof config.enabled, 'boolean');
  assert.ok(config.intervalMinutes >= 5 && config.intervalMinutes <= 1440);
  assert.ok(config.scanDays >= 1 && config.scanDays <= 365);
  assert.equal(typeof config.autoFixClinical, 'boolean');
  assert.equal(typeof config.autoInsertWalkin, 'boolean');
});

````
