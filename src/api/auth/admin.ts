/**
 * API Key Authentication - Admin Routes
 *
 * Protected by ADMIN_API_KEY env var via X-Admin-Key header.
 * Provides CRUD operations for API keys and usage stats.
 */

import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { generateKey, listKeys, revokeKey } from './keys.js';
import { getAllUsage, getUsageByKey } from './usage.js';
import type { AccessTier } from './types.js';

const router = Router();

/**
 * Admin auth middleware: validates X-Admin-Key header
 */
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    res.status(503).json({ success: false, error: 'Admin API not configured' });
    return;
  }

  const provided = req.headers['x-admin-key'];
  if (provided !== adminKey) {
    res.status(401).json({ success: false, error: 'Invalid admin key' });
    return;
  }

  next();
}

router.use(adminAuth);
router.use(json());

/**
 * POST /api/admin/keys - Create a new API key
 */
router.post('/keys', (req: Request, res: Response) => {
  const { label, tier } = req.body || {};

  if (!label || typeof label !== 'string' || label.length > 100) {
    res.status(400).json({ success: false, error: 'Invalid label (string, max 100 chars)' });
    return;
  }

  const validTiers: AccessTier[] = ['basic', 'pro'];
  if (!validTiers.includes(tier)) {
    res.status(400).json({ success: false, error: 'Invalid tier. Must be "basic" or "pro"' });
    return;
  }

  const { rawKey, record } = generateKey(label, tier);

  res.status(201).json({
    success: true,
    key: rawKey,
    tier: record.tier,
    label: record.label,
    createdAt: record.createdAt,
    warning: 'Save this key now. It cannot be retrieved again.',
  });
});

/**
 * GET /api/admin/keys - List all API keys (hashes only)
 */
router.get('/keys', (_req: Request, res: Response) => {
  const keys = listKeys();
  res.json({ success: true, data: keys });
});

/**
 * DELETE /api/admin/keys/:hash - Revoke an API key
 */
router.delete('/keys/:hash', (req: Request, res: Response) => {
  const { hash } = req.params;
  if (!hash || hash.length !== 64) {
    res.status(400).json({ success: false, error: 'Invalid key hash' });
    return;
  }

  const revoked = revokeKey(hash);
  if (revoked) {
    res.json({ success: true, message: 'Key revoked' });
  } else {
    res.status(404).json({ success: false, error: 'Key not found or already revoked' });
  }
});

/**
 * GET /api/admin/usage - Get usage statistics
 */
router.get('/usage', (_req: Request, res: Response) => {
  const usage = getAllUsage();
  res.json({ success: true, data: usage });
});

/**
 * GET /api/admin/usage/:hash - Get usage for a specific key
 */
router.get('/usage/:hash', (req: Request, res: Response) => {
  const { hash } = req.params;
  const usage = getUsageByKey(hash);
  res.json({ success: true, data: usage });
});

export { router as adminRouter };
