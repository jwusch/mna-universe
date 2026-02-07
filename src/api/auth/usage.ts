/**
 * API Key Authentication - Usage Tracking
 *
 * In-memory request counter per key and endpoint.
 * Resets on server restart (acceptable for current scale).
 */

interface UsageEntry {
  count: number;
  firstRequest: number;
  lastRequest: number;
}

// key hash -> endpoint -> usage
const usageMap = new Map<string, Map<string, UsageEntry>>();

// Overall stats
let totalRequests = 0;

export function trackRequest(keyHash: string, endpoint: string): void {
  totalRequests++;

  let endpoints = usageMap.get(keyHash);
  if (!endpoints) {
    endpoints = new Map();
    usageMap.set(keyHash, endpoints);
  }

  const existing = endpoints.get(endpoint);
  const now = Date.now();
  if (existing) {
    existing.count++;
    existing.lastRequest = now;
  } else {
    endpoints.set(endpoint, { count: 1, firstRequest: now, lastRequest: now });
  }
}

export function getUsageByKey(keyHash: string): Record<string, UsageEntry> {
  const endpoints = usageMap.get(keyHash);
  if (!endpoints) return {};
  return Object.fromEntries(endpoints);
}

export function getAllUsage(): {
  totalRequests: number;
  keys: Record<string, Record<string, UsageEntry>>;
} {
  const keys: Record<string, Record<string, UsageEntry>> = {};
  for (const [hash, endpoints] of usageMap) {
    keys[hash.slice(0, 8) + '...'] = Object.fromEntries(endpoints);
  }
  return { totalRequests, keys };
}
