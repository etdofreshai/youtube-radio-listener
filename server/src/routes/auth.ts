/**
 * Auth API routes.
 * Simple password verification for app access.
 * Password is set via APP_PASSWORD env var.
 * If APP_PASSWORD is not set, password check is bypassed (dev mode).
 */

import { Router, Request, Response } from 'express';

const router = Router();

// POST /api/auth/verify — verify app password
router.post('/verify', (req: Request, res: Response) => {
  const { password } = req.body;
  const appPassword = process.env.APP_PASSWORD;

  // Dev mode: no password configured, allow access
  if (!appPassword || appPassword.trim() === '') {
    return res.json({ 
      valid: true, 
      devMode: true,
      message: 'No APP_PASSWORD configured — access granted (dev mode)' 
    });
  }

  // Production mode: verify password
  if (password === appPassword) {
    return res.json({ valid: true, devMode: false });
  }

  return res.status(401).json({ valid: false, error: 'Invalid password' });
});

// GET /api/auth/status — check if password is required
router.get('/status', (_req: Request, res: Response) => {
  const appPassword = process.env.APP_PASSWORD;
  const requiresPassword = !!(appPassword && appPassword.trim() !== '');
  res.json({ requiresPassword });
});

export default router;
