import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUpdateRunnerConfig, parsePm2ProcessList, reconcileUpdateJob, validateUpdateBranch, type SystemUpdateJob } from './systemUpdate.js';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const now = Date.parse('2026-09-14T08:00:00Z');
const job: SystemUpdateJob = {
  id: 'fixture-job', status: 'running', stage: 'restarting', progress: 89,
  message: '', action: 'update', actor: 'test', changeSummary: 'fixture',
  branch: 'main', fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40),
  startedAt: new Date(now - 300_000).toISOString(),
  updatedAt: new Date(now - 120_000).toISOString(), runnerName: 'fdh-update-fixture-job',
};

test('launch config delegates a one-shot update/rollback to PM2, outside the backend tree', () => {
  for (const action of ['update', 'rollback'] as const) {
    const app = buildUpdateRunnerConfig({ ...job, action }, '/app', '/state').apps[0];
    assert.equal(app.name, job.runnerName);
    assert.equal(app.autorestart, false);
    assert.equal(app.watch, false);
    assert.equal(app.interpreter, 'bash');
    assert.equal(app.env.FDH_UPDATE_ACTION, action);
    assert.equal(app.env.FDH_UPDATE_TO_COMMIT, job.toCommit);
    assert.equal(app.script, path.join('/state', 'runner-fixture-job.sh'));
  }
});

test('dead runner is reported as interrupted, never successful based on progress', () => {
  const result = reconcileUpdateJob(job, false, now);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'interrupted');
  assert.equal(result.progress, 89);
  assert.match(result.message, /update-fixture-job.log/);
});

test('live runner, startup grace and unavailable PM2 do not release active jobs', () => {
  assert.equal(reconcileUpdateJob(job, true, now + 8_000_000), job);
  const unknown = reconcileUpdateJob(job, null, now + 8_000_000);
  assert.equal(unknown.status, 'running');
  assert.match(unknown.message, /PM2/);
  const fresh = { ...job, updatedAt: new Date(now - 20_000).toISOString() };
  assert.equal(reconcileUpdateJob(fresh, false, now), fresh);
});

test('terminal results are preserved and legacy stale workers remain diagnosable', () => {
  for (const status of ['completed', 'failed'] as const) {
    const terminal = { ...job, status };
    assert.equal(reconcileUpdateJob(terminal, false, now), terminal);
  }
  assert.equal(reconcileUpdateJob({ ...job, runnerName: undefined }, null, now + 8_000_000).status, 'failed');
});

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
test('PM2 version warnings do not hide the runner process list', () => {
  const entry = { name: job.runnerName, pid: 42, pm2_env: { status: 'online' } };
  assert.deepEqual(parsePm2ProcessList(`[PM2] warning\nIn memory PM2 version: 7.0.1\n${JSON.stringify([entry])}\n`), [entry]);
  assert.deepEqual(parsePm2ProcessList('warning\n[]\n'), []);
  assert.throws(() => parsePm2ProcessList('PM2 unavailable'), /process list/);
});
test('runner completes and handles timeout, failure and replay with fake services', {
  skip: !existsSync(bash), timeout: 40_000,
}, () => {
  execFileSync(bash, ['deploy/scripts/self-update-runner.test.sh'], {
    cwd: process.cwd(), timeout: 35_000, encoding: 'utf8',
  });
});

test('accepts normal deployment branch names', () => {
  assert.equal(validateUpdateBranch('main'), true);
  assert.equal(validateUpdateBranch('agent/add-local-ai'), true);
  assert.equal(validateUpdateBranch('release/2026.09'), true);
});

test('rejects branch traversal and shell metacharacters', () => {
  assert.equal(validateUpdateBranch('../main'), false);
  assert.equal(validateUpdateBranch('release/../../main'), false);
  assert.equal(validateUpdateBranch('main; reboot'), false);
  assert.equal(validateUpdateBranch('$(whoami)'), false);
});
