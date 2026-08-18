import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createHealthRouter } from './healthRoutes.js';

const withServer = async (connectionResult: boolean, run: (baseUrl: string) => Promise<void>) => {
  const app = express();
  app.use('/api', createHealthRouter(async () => connectionResult));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test('liveness does not depend on the database', async () => {
  await withServer(false, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  });
});

test('readiness returns 503 while the database is unavailable', async () => {
  await withServer(false, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ready`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'not-ready');
  });
});

test('readiness returns 200 after dependencies are available', async () => {
  await withServer(true, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ready`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ready');
  });
});
