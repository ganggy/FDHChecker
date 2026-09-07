import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateHospitalDatabaseConfig, publicHospitalDatabaseConfig, resolveHospitalDatabaseInput, saveHospitalDatabaseConfig, readHospitalDatabaseConfig } from './hospitalDatabaseConfig.js';
import { resolveRepstmDatabaseConfig } from './repstmConfig.js';

const config = { type: 'postgresql' as const, host: 'localhost', port: 5433, database: 'hospital_b', schema: 'his', user: 'reader', password: 'secret-test', ssl: true };
test('hospital database validation accepts custom database, schema and port and redacts the secret', () => {
  assert.deepEqual(validateHospitalDatabaseConfig(config), config);
  const publicConfig = publicHospitalDatabaseConfig(config);
  assert.equal(publicConfig.passwordConfigured, true);
  assert.ok(!JSON.stringify(publicConfig).includes(config.password));
  assert.ok(!('password' in publicConfig));
  assert.equal(resolveHospitalDatabaseInput(publicConfig, config).password, config.password);
  assert.equal(resolveHospitalDatabaseInput({ ...publicConfig, password: '' }, config).password, '');
  for (const invalid of [{ type: 'sqlite' }, { port: 0 }, { port: 65536 }, { port: 1.5 }, { schema: 'public -c role=admin' }, { host: '' }, { ssl: 'false' }]) {
    assert.throws(() => validateHospitalDatabaseConfig({ ...config, ...invalid }));
  }
});

test('REP/STM authentication keeps legacy MySQL credentials after the HIS override changes type', () => {
  const resolved = resolveRepstmDatabaseConfig({
    HOSXP_HOST: 'legacy-mysql', HOSXP_USER: 'legacy-user', HOSXP_PASSWORD: 'legacy-password', HOSXP_DB_TYPE: 'postgresql',
  });
  assert.deepEqual(resolved, {
    host: 'legacy-mysql', port: 3306, database: 'repstminv', user: 'legacy-user', password: 'legacy-password',
  });
  assert.equal(resolveRepstmDatabaseConfig({ HOSXP_HOST: 'old', REPSTM_HOST: 'dedicated', REPSTM_USER: 'app-user' }).host, 'dedicated');
});

test('saved hospital config survives restart and is separate from source-controlled environment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdh-db-config-'));
  const before = process.env.HOSXP_CONFIG_FILE;
  try {
    process.env.HOSXP_CONFIG_FILE = path.join(dir, 'hospital.json');
    saveHospitalDatabaseConfig(config);
    assert.deepEqual(readHospitalDatabaseConfig(), config);
    saveHospitalDatabaseConfig({ ...config, type: 'mysql', port: 3307, schema: '' });
    assert.equal(readHospitalDatabaseConfig().type, 'mysql');
    assert.deepEqual(fs.readdirSync(dir), ['hospital.json']);
    fs.writeFileSync(process.env.HOSXP_CONFIG_FILE, 'invalid-secret-json');
    assert.throws(readHospitalDatabaseConfig, (error: unknown) => error instanceof Error && !error.message.includes('invalid-secret-json'));
  } finally {
    if (before === undefined) delete process.env.HOSXP_CONFIG_FILE; else process.env.HOSXP_CONFIG_FILE = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
