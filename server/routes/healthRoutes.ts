import { Router } from 'express';

type ConnectionCheck = () => Promise<boolean>;

export const createHealthRouter = (testConnection: ConnectionCheck) => {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  router.get('/ready', async (_req, res) => {
    try {
      const databaseConnected = await testConnection();
      return res.status(databaseConnected ? 200 : 503).json({
        status: databaseConnected ? 'ready' : 'not-ready',
        database: databaseConnected ? 'connected' : 'unavailable',
        timestamp: new Date().toISOString(),
      });
    } catch {
      return res.status(503).json({
        status: 'not-ready',
        database: 'unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Compatibility endpoint for existing monitors. New deployments should use /live and /ready.
  router.get('/health', async (_req, res) => {
    try {
      const databaseConnected = await testConnection();
      return res.json({
        status: databaseConnected ? 'ok' : 'degraded',
        database: databaseConnected ? 'connected' : 'unavailable',
        timestamp: new Date().toISOString(),
      });
    } catch {
      return res.json({ status: 'degraded', database: 'unavailable', timestamp: new Date().toISOString() });
    }
  });

  return router;
};
