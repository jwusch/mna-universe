/**
 * API Key Authentication - Express Middleware
 *
 * Extracts API key from Authorization header or query param,
 * validates it, attaches tier to req.auth, applies per-tier rate limiting.
 */

import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { validateKey } from './keys.js';
import { trackRequest } from './usage.js';
import type { AccessTier, AuthInfo } from './types.js';

// Per-tier rate limits (requests per 15-minute window)
const TIER_LIMITS: Record<AccessTier, number> = {
  free: 30,
  basic: 300,
  pro: 1000,
};

// Endpoints restricted by tier
const TIER_ACCESS: Record<string, AccessTier> = {
  '/api/v1/assets': 'basic',
  '/api/v1/lands/raw': 'pro',
};

/**
 * Auth middleware: extract key, validate, attach tier to req.auth
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  let rawKey: string | undefined;

  // Check Authorization: Bearer header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7);
  }

  // Check query param fallback
  if (!rawKey && typeof req.query.api_key === 'string') {
    rawKey = req.query.api_key;
  }

  if (rawKey && rawKey.startsWith('mna_')) {
    const record = validateKey(rawKey);
    if (record) {
      req.auth = {
        tier: record.tier,
        keyHash: record.hash,
        label: record.label,
      };
      next();
      return;
    }
  }

  // No key or invalid key = free tier
  req.auth = { tier: 'free' };
  next();
}

/**
 * Per-tier rate limiter using express-rate-limit
 */
export const tierRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req: Request) => {
    const tier = req.auth?.tier || 'free';
    return TIER_LIMITS[tier];
  },
  keyGenerator: (req: Request) => {
    // Use key hash for authenticated users, IP for free tier
    return req.auth?.keyHash || req.ip || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit exceeded for your tier. Upgrade your API key for higher limits.' },
});

/**
 * Endpoint access check middleware
 */
export function tierAccessCheck(req: Request, res: Response, next: NextFunction): void {
  const tier = req.auth?.tier || 'free';
  const tiers: AccessTier[] = ['free', 'basic', 'pro'];
  const userLevel = tiers.indexOf(tier);

  // Check if this endpoint requires a higher tier
  const requiredTier = TIER_ACCESS[req.path];
  if (requiredTier) {
    const requiredLevel = tiers.indexOf(requiredTier);
    if (userLevel < requiredLevel) {
      res.status(403).json({
        success: false,
        error: `This endpoint requires a '${requiredTier}' tier API key.`,
        currentTier: tier,
        upgrade: 'Contact the admin to get an API key with the required access level.',
      });
      return;
    }
  }

  // Track usage
  if (req.auth?.keyHash) {
    trackRequest(req.auth.keyHash, req.path);
  } else {
    trackRequest('free:' + (req.ip || 'unknown'), req.path);
  }

  next();
}
