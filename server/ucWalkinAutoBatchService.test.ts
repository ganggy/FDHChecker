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
