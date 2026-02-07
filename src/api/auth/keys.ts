/**
 * API Key Authentication - Key Management
 *
 * Generates mna_<hex> keys, stores SHA-256 hashes in config/api-keys.json.
 * Falls back to API_KEYS_SEED env var for stateless Railway deploys.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AccessTier, ApiKeyRecord, KeyStore } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KEYS_FILE = path.resolve(__dirname, '../../../config/api-keys.json');

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function loadStore(): KeyStore {
  // Try file first
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
      return data as KeyStore;
    }
  } catch (err) {
    console.error('[Auth] Failed to read key store file:', err);
  }

  // Fallback to env var (for stateless Railway deploys)
  if (process.env.API_KEYS_SEED) {
    try {
      return JSON.parse(process.env.API_KEYS_SEED) as KeyStore;
    } catch (err) {
      console.error('[Auth] Failed to parse API_KEYS_SEED:', err);
    }
  }

  return { keys: [] };
}

function saveStore(store: KeyStore): void {
  const dir = path.dirname(KEYS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2));
}

export function generateKey(label: string, tier: AccessTier): { rawKey: string; record: ApiKeyRecord } {
  const raw = 'mna_' + crypto.randomBytes(16).toString('hex');
  const record: ApiKeyRecord = {
    hash: hashKey(raw),
    label,
    tier,
    createdAt: new Date().toISOString(),
  };

  const store = loadStore();
  store.keys.push(record);
  saveStore(store);

  return { rawKey: raw, record };
}

export function validateKey(raw: string): ApiKeyRecord | null {
  const hash = hashKey(raw);
  const store = loadStore();
  const record = store.keys.find(k => k.hash === hash && !k.revokedAt);
  return record || null;
}

export function revokeKey(hash: string): boolean {
  const store = loadStore();
  const record = store.keys.find(k => k.hash === hash && !k.revokedAt);
  if (!record) return false;
  record.revokedAt = new Date().toISOString();
  saveStore(store);
  return true;
}

export function listKeys(): Omit<ApiKeyRecord, 'hash'>[] & { hashPrefix: string }[] {
  const store = loadStore();
  return store.keys.map(k => ({
    hashPrefix: k.hash.slice(0, 8) + '...',
    hash: k.hash,
    label: k.label,
    tier: k.tier,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
  }));
}
