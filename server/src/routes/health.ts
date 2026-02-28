import { Router } from 'express';
import { getStatus } from '../deps';
import * as store from '../store';

const router = Router();

router.get('/health', async (_req, res) => {
  const deps = await getStatus();
  const allRequired = deps.filter(d => d.required);
  const missingRequired = allRequired.filter(d => !d.available);

  // Database check
  let dbStatus: { available: boolean; store: string; error?: string } = {
    available: true,
    store: store.isPostgres() ? 'postgresql' : 'memory',
  };

  if (store.isPostgres()) {
    try {
      const { checkConnection } = await import('../db/pool');
      const ok = await checkConnection();
      dbStatus.available = ok;
      if (!ok) dbStatus.error = 'Connection check failed';
    } catch (err) {
      dbStatus.available = false;
      dbStatus.error = err instanceof Error ? err.message : String(err);
    }
  }

  res.json({
    status: missingRequired.length === 0 && dbStatus.available ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '0.2.0',
    database: dbStatus,
    dependencies: deps.map(d => ({
      name: d.name,
      available: d.available,
      version: d.version,
      required: d.required,
      error: d.error,
    })),
  });
});

export default router;
