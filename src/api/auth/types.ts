/**
 * API Key Authentication - Type Definitions
 */

export type AccessTier = 'free' | 'basic' | 'pro';

export interface ApiKeyRecord {
  hash: string;
  label: string;
  tier: AccessTier;
  createdAt: string;
  revokedAt?: string;
}

export interface AuthInfo {
  tier: AccessTier;
  keyHash?: string;
  label?: string;
}

export interface KeyStore {
  keys: ApiKeyRecord[];
}

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}
