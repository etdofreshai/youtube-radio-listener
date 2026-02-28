import { Router } from 'express';
import { getStatus } from '../deps';

const router = Router();

router.get('/health', async (_req, res) => {
  const deps = await getStatus();
  const allRequired = deps.filter(d => d.required);
  const missingRequired = allRequired.filter(d => !d.available);

  res.json({
    status: missingRequired.length === 0 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '0.1.0',
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
