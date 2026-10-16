import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createFacilityDatabaseRouter } from './facilityDatabaseRoutes.js';
import {
  saveFacilityDatabaseConfig,
  readFacilityDatabaseConfig,
  deleteFacilityDatabaseConfig,
  readFacilityDatabaseConfigs,
  publicFacilityDatabaseConfig,
  normalizeFacilityHcode,
  type HospitalDatabaseConfig,
} from '../hospitalDatabaseConfig.js';
import {
  getHospitalPoolForFacility,
  reloadFacilityDatabasePool,
  defaultHospitalPool,
  hospitalPool,
} from '../hospitalDatabase.js';
import {
  runWithFacilityHcode,
  getCurrentFacilityHcode,
  hospitalDatabaseResponseGuard,
} from '../hospitalDatabaseContext.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('facility database config storage validates 5-digit hcode and saves/reads/deletes correctly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdh-facility-db-'));
  const before = process.env.FACILITY_DATABASES_CONFIG_FILE;
  try {
    process.env.FACILITY_DATABASES_CONFIG_FILE = path.join(dir, 'facility-databases.json');

    assert.equal(normalizeFacilityHcode('01234'), '01234');
    assert.throws(() => normalizeFacilityHcode('1234'));
    assert.throws(() => normalizeFacilityHcode('abcde'));

    const testConfig: HospitalDatabaseConfig = {
      type: 'mysql',
      host: '192.168.1.100',
      port: 3306,
      database: 'hosxp_pcu_01234',
      schema: '',
      user: 'pcu_user',
      password: 'super_secret_pcu_pass',
      ssl: false,
    };

    saveFacilityDatabaseConfig('01234', testConfig);
    const read = readFacilityDatabaseConfig('01234');
    assert.deepEqual(read, testConfig);

    const publicCfg = publicFacilityDatabaseConfig('01234', testConfig);
    assert.equal(publicCfg.passwordConfigured, true);
    assert.ok(!JSON.stringify(publicCfg).includes('super_secret_pcu_pass'));

    const all = readFacilityDatabaseConfigs();
    assert.ok('01234' in all);

    const deleted = deleteFacilityDatabaseConfig('01234');
    assert.equal(deleted, true);
    assert.equal(readFacilityDatabaseConfig('01234'), null);
  } finally {
    if (before === undefined) delete process.env.FACILITY_DATABASES_CONFIG_FILE;
    else process.env.FACILITY_DATABASES_CONFIG_FILE = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('facility database router lists, tests, saves and deletes configs with redacted secrets', async () => {
  const sampleFacility: HospitalDatabaseConfig = {
    type: 'mysql',
    host: '10.0.0.50',
    port: 3306,
    database: 'pcu_db',
    schema: '',
    user: 'pcu_admin',
    password: 'pcu_secret_password',
    ssl: false,
  };
  const store: Record<string, HospitalDatabaseConfig> = {
    '09999': { ...sampleFacility },
  };

  const app = express();
  app.use(express.json());
  app.use('/facility-db', createFacilityDatabaseRouter({
    readAll: () => store,
    readOne: (hcode) => store[hcode] || null,
    saveOne: (hcode, cfg) => { store[hcode] = cfg; },
    deleteOne: (hcode) => {
      if (store[hcode]) {
        delete store[hcode];
        return true;
      }
      return false;
    },
    listPublic: () => Object.entries(store).map(([h, c]) => publicFacilityDatabaseConfig(h, c)),
    test: async (cfg) => {
      if (cfg.database === 'broken') throw new Error('network down');
      const compatible = cfg.database !== 'incompatible';
      return {
        connected: true,
        compatible,
        missing: compatible ? [] : ['patient.hn'],
        mode: 'read-only',
        message: compatible ? 'OK' : 'missing columns',
      };
    },
    reload: async () => {},
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/facility-db`;

  try {
    // 1. GET / lists all
    const listRes = await (await fetch(url)).json();
    assert.equal(listRes.success, true);
    assert.equal(listRes.data.length, 1);
    assert.equal(listRes.data[0].hcode, '09999');
    assert.equal(listRes.data[0].passwordConfigured, true);
    assert.ok(!JSON.stringify(listRes).includes('pcu_secret_password'));

    // 2. GET /:hcode
    const singleRes = await (await fetch(`${url}/09999`)).json();
    assert.equal(singleRes.success, true);
    assert.equal(singleRes.data.database, 'pcu_db');
    assert.ok(!JSON.stringify(singleRes).includes('pcu_secret_password'));

    // 3. POST /:hcode/test with invalid network
    const testFail = await fetch(`${url}/09999/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleFacility, database: 'broken' }),
    });
    assert.equal(testFail.status, 502);

    // 4. POST /:hcode/save with incompatible schema
    const saveIncompatible = await fetch(`${url}/01111/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleFacility, database: 'incompatible' }),
    });
    assert.equal(saveIncompatible.status, 422);
    assert.equal('01111' in store, false);

    // 5. POST /:hcode/save valid
    const saveSuccess = await fetch(`${url}/01111/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleFacility, database: 'pcu_new_db' }),
    });
    assert.equal(saveSuccess.status, 200);
    assert.equal(store['01111'].database, 'pcu_new_db');

    // 6. DELETE /:hcode
    const deleteRes = await fetch(`${url}/01111`, { method: 'DELETE' });
    assert.equal(deleteRes.status, 200);
    assert.equal('01111' in store, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('runWithFacilityHcode dynamically routes database context and getHospitalPoolForFacility', async () => {
  assert.equal(getCurrentFacilityHcode(), null);

  runWithFacilityHcode('01234', () => {
    assert.equal(getCurrentFacilityHcode(), '01234');
  });

  assert.equal(getCurrentFacilityHcode(), null);

  // If facility has no custom config, it returns default hospital pool
  const pool = getHospitalPoolForFacility('99999');
  assert.equal(pool, defaultHospitalPool);
});
