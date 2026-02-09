/**
 * My Neighbor Alice Universe API Server
 *
 * Express server providing REST endpoints for land and asset data,
 * serving the 3D visualization frontend.
 *
 * NOW WITH REAL DATA from mkpl-api.prod.myneighboralice.com!
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';
import { CronJob } from 'cron';
import { AliceClient, Land } from '../alice/client.js';
import { AliceMoltbookAgent } from '../agent/agent.js';
import { authMiddleware, tierRateLimiter, tierAccessCheck } from './auth/middleware.js';
import { adminRouter } from './auth/admin.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// MNA Marketplace API
const MNA_API_BASE = 'https://mkpl-api.prod.myneighboralice.com';

// Handle BigInt serialization for JSON responses
const bigIntReplacer = (key: string, value: any) => {
  return typeof value === 'bigint' ? value.toString() : value;
};
const PORT = process.env.PORT || process.env.API_PORT || 3001;

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3000',
  process.env.UNIVERSE_URL || 'https://web-production-87126.up.railway.app',
].filter(Boolean) as string[];

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://mkpl-api.prod.myneighboralice.com", "https://dapps0.chromaway.com:7740", "https://node.chromia.com"],
    },
  },
}));
app.use(cors({ origin: ALLOWED_ORIGINS }));

// Auth middleware: extract API key, validate, attach tier, rate limit per tier
app.use('/api/', authMiddleware);
app.use('/api/', tierRateLimiter);
app.use('/api/', tierAccessCheck);

// Admin routes (protected by ADMIN_API_KEY)
app.use('/api/admin', adminRouter);

// Serve static files from visualization directory
app.use(express.static(path.join(__dirname, '../visualization'), {
  dotfiles: 'deny',
  index: 'index.html',
  maxAge: '1d',
}));

// Initialize Alice client for Chromia blockchain
const aliceClient = new AliceClient({
  nodeUrl: process.env.CHROMIA_NODE_URL || 'https://dapps0.chromaway.com:7740',
  blockchainRid: process.env.MNA_BLOCKCHAIN_RID || '',
});

// Cache for real land data
interface RealLand {
  id: string;
  plotId: number;
  name: string;
  island: string;
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
  soilType: string;
  soilFertility: number;
  waterType: string;
  waterQuality: number;
  forSale: boolean;
  price?: number;
  seller?: string;
  image?: string;
}

let landCache: RealLand[] = [];
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DISK_CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutes for startup disk cache

// Disk cache directory
const CACHE_DIR = path.join(__dirname, '../../cache');

// Visualization transform cache (invalidated when landCache updates)
let vizCache: any[] = [];
let vizCacheTimestamp = 0;

// Marketplace cache: per-type with 5-min TTL
const marketplaceCache = new Map<string, { data: any[]; timestamp: number }>();

// Guard against concurrent land fetches
let refreshInProgress = false;

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('[Cache] Failed to create cache directory:', err);
  }
}

/**
 * Write data to disk cache
 */
function writeDiskCache(filename: string, data: any) {
  try {
    ensureCacheDir();
    const filePath = path.join(CACHE_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify({ data, timestamp: Date.now() }));
    console.log(`[Cache] Wrote ${filename} to disk`);
  } catch (err) {
    console.error(`[Cache] Failed to write ${filename}:`, err);
  }
}

/**
 * Read data from disk cache. Returns null if file doesn't exist.
 * If maxAge is provided, returns null if cache is older than maxAge.
 */
function readDiskCache(filename: string, maxAge?: number): { data: any; timestamp: number } | null {
  try {
    const filePath = path.join(CACHE_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (maxAge && (Date.now() - raw.timestamp) > maxAge) return null;
    return raw;
  } catch (err) {
    console.error(`[Cache] Failed to read ${filename}:`, err);
    return null;
  }
}

/**
 * Append a chain-stats snapshot for growth tracking over time
 */
function appendSnapshot(players: number, assetCount: number) {
  try {
    ensureCacheDir();
    const filePath = path.join(CACHE_DIR, 'chain-snapshots.json');
    let snapshots: any[] = [];
    try {
      if (fs.existsSync(filePath)) {
        snapshots = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch { /* ignore corrupt file */ }

    snapshots.push({ timestamp: Date.now(), players, assetCount });

    // Keep last 2016 entries (~7 days at 5min intervals)
    if (snapshots.length > 2016) snapshots = snapshots.slice(-2016);

    fs.writeFileSync(filePath, JSON.stringify(snapshots));
  } catch (err) {
    console.error('[Snapshots] Failed to save:', err);
  }
}

/**
 * Calculate player growth from snapshots
 */
function getPlayerGrowth(): { growth24h: number | null; growth7d: number | null } {
  try {
    const filePath = path.join(CACHE_DIR, 'chain-snapshots.json');
    if (!fs.existsSync(filePath)) return { growth24h: null, growth7d: null };

    const snapshots: any[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (snapshots.length < 2) return { growth24h: null, growth7d: null };

    const latest = snapshots[snapshots.length - 1];
    const now = Date.now();

    const find = (targetAge: number) => snapshots.reduce((best, s) =>
      Math.abs(s.timestamp - (now - targetAge)) < Math.abs(best.timestamp - (now - targetAge)) ? s : best
    );

    const snap24h = find(24 * 60 * 60 * 1000);
    const snap7d = find(7 * 24 * 60 * 60 * 1000);

    return {
      growth24h: snap24h?.players ? latest.players - snap24h.players : null,
      growth7d: snap7d?.players ? latest.players - snap7d.players : null,
    };
  } catch {
    return { growth24h: null, growth7d: null };
  }
}

/**
 * Delay helper for rate limiting
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch a single page of lands from MNA API with retry
 */
async function fetchLandPage(cursor?: number, retries = 3): Promise<{ lands: any[]; nextCursor?: number; total: number }> {
  const url = cursor
    ? `${MNA_API_BASE}/api/nfts?type=land&cursor=${cursor}`
    : `${MNA_API_BASE}/api/nfts?type=land`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 30000 });
      return {
        lands: response.data.result || [],
        nextCursor: response.data.cursor,
        total: response.data.total || 0,
      };
    } catch (error: any) {
      console.error(`[API] Page fetch failed (attempt ${attempt}/${retries}):`, error.message);
      if (attempt < retries) {
        await delay(1000 * attempt); // Exponential backoff
      } else {
        throw error;
      }
    }
  }
  return { lands: [], total: 0 };
}

/**
 * Perform the actual API fetch of all land data (no caching logic here)
 */
async function fetchLandsFromAPI(): Promise<RealLand[]> {
  console.log('[API] Fetching ALL real land data from MNA Marketplace...');

  // First, fetch all lands for sale to build the price map
  let forSaleLands: any[] = [];
  let forSaleCursor: number | undefined;

  console.log('[API] Fetching lands for sale...');
  do {
    const url = forSaleCursor
      ? `${MNA_API_BASE}/api/nfts?type=land&status=onSale&cursor=${forSaleCursor}`
      : `${MNA_API_BASE}/api/nfts?type=land&status=onSale`;
    const response = await axios.get(url);
    forSaleLands = forSaleLands.concat(response.data.result || []);
    forSaleCursor = response.data.cursor;
  } while (forSaleCursor);

  console.log(`[API] Found ${forSaleLands.length} lands for sale`);

  // Create a map of lands for sale with their prices
  const forSaleMap = new Map<number, { price: number; seller: string }>();
  forSaleLands.forEach((nft: any) => {
    const plotId = nft.metadata?.land?.plotId || nft.metadata?.tokenId;
    const sale = nft.latestSale;
    if (plotId && sale) {
      forSaleMap.set(plotId, {
        price: sale.listingPrice ? sale.listingPrice / 1000000 : 0,
        seller: sale.seller?.nickName || sale.seller?.wallet?.slice(0, 6) + '...' || 'Unknown',
      });
    }
  });

  // Now fetch ALL lands with pagination
  const allLands: any[] = [];
  let cursor: number | undefined;
  let totalLands = 0;
  let pageCount = 0;

  console.log('[API] Fetching all lands with pagination...');
  do {
    try {
      const page = await fetchLandPage(cursor);
      allLands.push(...page.lands);
      cursor = page.nextCursor;
      totalLands = page.total;
      pageCount++;

      if (pageCount % 10 === 0) {
        console.log(`[API] Progress: ${allLands.length}/${totalLands} lands fetched...`);
      }

      // Small delay between requests to avoid rate limiting
      if (cursor) {
        await delay(100);
      }
    } catch (error: any) {
      console.error(`[API] Failed to fetch page ${pageCount + 1}, stopping pagination:`, error.message);
      break;
    }
  } while (cursor && allLands.length < totalLands);

  console.log(`[API] Fetched ${allLands.length} total lands in ${pageCount} pages`);

  // Transform to our format
  const lands: RealLand[] = [];
  const seenPlots = new Set<number>();

  allLands.forEach((nft: any) => {
    const land = nft.metadata?.land;
    if (!land) return;

    const plotId = land.plotId || nft.metadata?.tokenId;
    if (seenPlots.has(plotId)) return;
    seenPlots.add(plotId);

    const saleInfo = forSaleMap.get(plotId);

    lands.push({
      id: String(nft.id),
      plotId,
      name: nft.metadata?.name || `Plot #${plotId}`,
      island: land.island || 'Unknown',
      region: land.region || 'Unknown',
      x: parseInt(land.x) || 0,
      y: parseInt(land.y) || 0,
      width: parseInt(land.width) || 100,
      height: parseInt(land.height) || 100,
      soilType: land.soilType || 'unknown',
      soilFertility: land.soilFertility || 1,
      waterType: land.waterType || 'unknown',
      waterQuality: land.waterQuality || 1,
      forSale: !!saleInfo || nft.status === 'onSale',
      price: saleInfo?.price,
      seller: saleInfo?.seller,
      image: nft.metadata?.image,
    });
  });

  console.log(`[API] Processed ${lands.length} unique lands (${forSaleMap.size} for sale)`);
  return lands;
}

/**
 * Update in-memory and disk caches with fresh land data
 */
function updateLandCaches(lands: RealLand[]) {
  landCache = lands;
  lastFetch = Date.now();
  vizCache = [];
  vizCacheTimestamp = 0;
  writeDiskCache('lands.json', lands);
}

/**
 * Background refresh: fetch fresh data without blocking callers
 */
function triggerBackgroundRefresh() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  console.log('[API] Starting background refresh of land data...');

  fetchLandsFromAPI()
    .then(lands => {
      updateLandCaches(lands);
      console.log(`[API] Background refresh complete: ${lands.length} lands`);
    })
    .catch(err => {
      console.error('[API] Background refresh failed:', err);
    })
    .finally(() => {
      refreshInProgress = false;
    });
}

/**
 * Fetch ALL real land data with stale-while-revalidate pattern:
 * - If memory cache exists (any age): return immediately
 * - If stale (> 5 min): trigger non-blocking background refresh
 * - If no cache at all: block and fetch (first load only)
 */
async function fetchRealLands(): Promise<RealLand[]> {
  const now = Date.now();

  // If memory cache exists, return it (may be stale)
  if (landCache.length > 0) {
    // If stale, trigger background refresh
    if ((now - lastFetch) > CACHE_TTL) {
      triggerBackgroundRefresh();
    }
    return landCache;
  }

  // No memory cache — try disk cache
  const diskData = readDiskCache('lands.json');
  if (diskData) {
    console.log(`[API] Loaded ${diskData.data.length} lands from disk cache`);
    landCache = diskData.data;
    lastFetch = diskData.timestamp;
    // Trigger background refresh if disk cache is stale
    if ((now - diskData.timestamp) > CACHE_TTL) {
      triggerBackgroundRefresh();
    }
    return landCache;
  }

  // No cache at all — blocking first fetch
  try {
    const lands = await fetchLandsFromAPI();
    updateLandCaches(lands);
    return lands;
  } catch (error) {
    console.error('[API] Error fetching from MNA API:', error);
    // Last resort: try disk cache of any age
    const fallback = readDiskCache('lands.json');
    if (fallback) {
      console.log(`[API] Using stale disk cache as fallback (${fallback.data.length} lands)`);
      landCache = fallback.data;
      lastFetch = fallback.timestamp;
      return landCache;
    }
    return [];
  }
}

/**
 * Transform real lands to visualization format
 */
function transformForVisualization(lands: RealLand[]) {
  // Find coordinate bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  lands.forEach(land => {
    minX = Math.min(minX, land.x);
    maxX = Math.max(maxX, land.x);
    minY = Math.min(minY, land.y);
    maxY = Math.max(maxY, land.y);
  });

  // Scale factor: divide by 100 to get reasonable 3D coordinates
  // Original coords are like 5400-10500, so divide by 100 = 54-105 range
  const scaleFactor = 100;

  return lands.map(land => {
    // Use actual coordinates divided by scale factor for proper spacing
    const normX = land.x / scaleFactor;
    const normY = land.y / scaleFactor;

    // Map region to biome for visualization
    let biome = 'plains';
    const region = land.region.toLowerCase();
    if (region.includes('forest') || region.includes('grove') || region.includes('woods')) {
      biome = 'forest';
    } else if (region.includes('beach') || region.includes('shore') || region.includes('coast') || region.includes('falls')) {
      biome = 'water';
    } else if (region.includes('desert') || region.includes('sand') || region.includes('dune')) {
      biome = 'desert';
    } else if (region.includes('gulch') || region.includes('hollow') || region.includes('shadow')) {
      biome = 'forest'; // Dark/shadowy areas as forest
    }

    // Also use soil type
    if (land.soilType === 'sand' && biome === 'plains') {
      biome = 'desert';
    }

    // Map land size based on width/height
    let size: 'small' | 'medium' | 'large' = 'medium';
    const area = land.width * land.height;
    if (area <= 5000) size = 'small';
    else if (area >= 20000) size = 'large';

    return {
      id: land.id,
      plotId: land.plotId,
      name: land.name,
      island: land.island,
      region: land.region,
      x: normX,
      y: normY,
      realX: land.x,
      realY: land.y,
      width: land.width / scaleFactor,
      height: land.height / scaleFactor,
      size,
      biome,
      soilType: land.soilType,
      waterType: land.waterType,
      forSale: land.forSale,
      price: land.price,
      seller: land.seller,
      image: land.image,
      owner: land.seller || '0x????',
    };
  });
}

// API Routes

/**
 * GET /api/v1/lands
 * Returns all lands from the REAL MNA Marketplace API
 */
app.get('/api/v1/lands', async (req, res) => {
  try {
    const realLands = await fetchRealLands();

    // Use viz cache if available and fresh
    if (vizCache.length === 0 || vizCacheTimestamp !== lastFetch) {
      vizCache = transformForVisualization(realLands);
      vizCacheTimestamp = lastFetch;
    }

    let lands = vizCache;

    // Apply filters with input validation
    if (req.query.forSale === 'true') {
      lands = lands.filter((l: any) => l.forSale);
    }
    if (typeof req.query.island === 'string' && req.query.island.length <= 100) {
      const island = req.query.island.toLowerCase();
      lands = lands.filter((l: any) => l.island.toLowerCase().includes(island));
    }
    if (typeof req.query.region === 'string' && req.query.region.length <= 100) {
      const region = req.query.region.toLowerCase();
      lands = lands.filter((l: any) => l.region.toLowerCase().includes(region));
    }

    const tier = req.auth?.tier || 'free';
    const totalBeforeCap = lands.length;

    // HTTP cache headers
    const etag = `"lands-${lastFetch}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.set('ETag', etag);

    res.json({
      success: true,
      data: lands,
      source: 'mna-marketplace-api',
      tier,
      stats: {
        total: lands.length,
        totalAvailable: totalBeforeCap,
        forSale: lands.filter((l: any) => l.forSale).length,
        islands: [...new Set(realLands.map(l => l.island))],
        regions: [...new Set(realLands.map(l => l.region))],
      }
    });
  } catch (error) {
    console.error('[API] Error fetching lands:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch lands' });
  }
});

/**
 * GET /api/v1/lands/raw
 * Returns raw land data without transformation
 */
app.get('/api/v1/lands/raw', async (req, res) => {
  try {
    const realLands = await fetchRealLands();
    res.json({
      success: true,
      data: realLands,
      source: 'mna-marketplace-api',
    });
  } catch (error) {
    console.error('[API] Error fetching raw lands:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch lands' });
  }
});

/**
 * GET /api/v1/marketplace
 * Returns items currently for sale (with per-type caching)
 */
app.get('/api/v1/marketplace', async (req, res) => {
  try {
    const allowedTypes = ['land', 'item', 'avatar', 'decoration'];
    const type = allowedTypes.includes(req.query.type as string) ? req.query.type as string : 'land';

    let transformed: any[];
    const cached = marketplaceCache.get(type);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      transformed = cached.data;
    } else {
      // Try disk cache first
      const diskCacheFile = `marketplace-${type}.json`;
      const diskData = cached ? null : readDiskCache(diskCacheFile, CACHE_TTL);

      if (diskData) {
        transformed = diskData.data;
        marketplaceCache.set(type, { data: diskData.data, timestamp: diskData.timestamp });
      } else {
        const response = await axios.get(`${MNA_API_BASE}/api/nfts`, {
          params: { type, status: 'onSale', limit: 100 },
        });
        const items = response.data.result || [];

        transformed = items.map((nft: any) => ({
          id: nft.id,
          name: nft.metadata?.name,
          type: nft.metadata?.type,
          image: nft.metadata?.image,
          price: nft.latestSale?.listingPrice ? nft.latestSale.listingPrice / 1000000 : null,
          seller: nft.latestSale?.seller?.nickName || 'Unknown',
          chain: nft.chain,
          land: nft.metadata?.land,
        }));

        marketplaceCache.set(type, { data: transformed, timestamp: now });
        writeDiskCache(diskCacheFile, transformed);
      }
    }

    // Free tier: cap results at 20
    const tier = req.auth?.tier || 'free';
    const limited = tier === 'free' && transformed.length > 20;
    const data = tier === 'free' ? transformed.slice(0, 20) : transformed;

    // HTTP cache headers
    res.set('Cache-Control', 'public, max-age=300');

    res.json({
      success: true,
      data,
      source: 'mna-marketplace-api',
      tier,
      ...(limited ? { limited: true, message: 'Free tier limited to 20 results. Use an API key for full access.' } : {}),
    });
  } catch (error) {
    console.error('[API] Error fetching marketplace:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch marketplace' });
  }
});

/**
 * GET /api/v1/assets
 * Returns FT4 tokens (ALICE, BJORN) from Chromia blockchain
 */
app.get('/api/v1/assets', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');

    if (process.env.MNA_BLOCKCHAIN_RID) {
      const assets = await aliceClient.getAllAssets();

      if (assets.length > 0) {
        const jsonStr = JSON.stringify({ success: true, data: assets, source: 'chromia-blockchain' }, bigIntReplacer);
        res.setHeader('Content-Type', 'application/json');
        res.send(jsonStr);
        return;
      }
    }

    // Fallback
    res.json({
      success: true,
      data: [
        { id: 'alice', name: 'ALICE', symbol: 'ALICE', decimals: 18, type: 'ft4' },
        { id: 'bjorn', name: 'BJORN', symbol: 'BJORN', decimals: 18, type: 'ft4' },
      ],
      source: 'fallback'
    });
  } catch (error) {
    console.error('[API] Error fetching assets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch assets' });
  }
});

// Chain stats cache
let chainStatsCache: { data: any; timestamp: number } | null = null;
const CHAIN_STATS_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/v1/chain-stats
 * Returns live blockchain stats from Chromia (public data, free queries)
 */
app.get('/api/v1/chain-stats', async (req, res) => {
  try {
    const now = Date.now();

    // Return cached if fresh
    if (chainStatsCache && (now - chainStatsCache.timestamp) < CHAIN_STATS_TTL) {
      res.set('Cache-Control', 'public, max-age=300');
      const jsonStr = JSON.stringify({ success: true, ...chainStatsCache.data, cached: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }

    // Ensure client is connected
    if (!process.env.MNA_BLOCKCHAIN_RID) {
      res.json({ success: false, error: 'Blockchain not configured' });
      return;
    }

    await aliceClient.connect();
    const client = aliceClient.getClient();
    if (!client) {
      res.json({ success: false, error: 'Blockchain client not available' });
      return;
    }

    // Query multiple stats in parallel
    const [accountCount, gameInfo, allAssets, storefrontConfigs] = await Promise.allSettled([
      client.query('assets.get_account_count', {}),
      client.query('game_info.get_all', {}),
      client.query('assets.get_all_assets', {}),
      client.query('storefronts.get_storefronts_configs', {}),
    ]);

    const stats = {
      players: accountCount.status === 'fulfilled' ? accountCount.value : null,
      gameVersion: gameInfo.status === 'fulfilled' ? (gameInfo.value as any)?.version || gameInfo.value : null,
      gameInfo: gameInfo.status === 'fulfilled' ? gameInfo.value : null,
      assetCount: allAssets.status === 'fulfilled' && Array.isArray(allAssets.value) ? allAssets.value.length : null,
      storefrontConfig: storefrontConfigs.status === 'fulfilled' ? storefrontConfigs.value : null,
      fetchedAt: new Date().toISOString(),
    };

    // Cache the result and save snapshot
    chainStatsCache = { data: stats, timestamp: now };
    if (stats.players != null) {
      appendSnapshot(Number(stats.players), stats.assetCount || 0);
    }

    const growth = getPlayerGrowth();
    res.set('Cache-Control', 'public, max-age=300');
    const jsonStr = JSON.stringify({ success: true, ...stats, growth }, bigIntReplacer);
    res.setHeader('Content-Type', 'application/json');
    res.send(jsonStr);
  } catch (error: any) {
    console.error('[API] Error fetching chain stats:', error);
    // Return stale cache on error
    if (chainStatsCache) {
      const jsonStr = JSON.stringify({ success: true, ...chainStatsCache.data, cached: true, stale: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch chain stats' });
  }
});

// Leaderboard cache
let leaderboardCache: { data: any; timestamp: number } | null = null;

/**
 * GET /api/v1/leaderboard
 * Returns top players and whale stats from Chromia
 */
app.get('/api/v1/leaderboard', async (req, res) => {
  try {
    const now = Date.now();

    if (leaderboardCache && (now - leaderboardCache.timestamp) < CHAIN_STATS_TTL) {
      res.set('Cache-Control', 'public, max-age=300');
      const jsonStr = JSON.stringify({ success: true, ...leaderboardCache.data, cached: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }

    if (!process.env.MNA_BLOCKCHAIN_RID) {
      res.json({ success: false, error: 'Blockchain not configured' });
      return;
    }

    await aliceClient.connect();
    const client = aliceClient.getClient();
    if (!client) {
      res.json({ success: false, error: 'Blockchain client not available' });
      return;
    }

    const [xpBoard, mostAnimals, mostPlaceables, mostCollateralized, mostSales] = await Promise.allSettled([
      client.query('player_progression.get_player_progression_leaderboard', {}),
      client.query('statistics.get_player_with_most_animals', {}),
      client.query('statistics.get_player_with_most_placeables', {}),
      client.query('statistics.get_player_with_most_collateralized', {}),
      client.query('statistics.get_player_with_most_sales', {}),
    ]);

    const topPlayers = xpBoard.status === 'fulfilled' && Array.isArray(xpBoard.value)
      ? xpBoard.value.slice(0, 10).map((p: any) => ({ name: p.name, xp: p.amount }))
      : [];

    const whales = {
      mostAnimals: mostAnimals.status === 'fulfilled' ? mostAnimals.value : null,
      mostPlaceables: mostPlaceables.status === 'fulfilled' ? mostPlaceables.value : null,
      mostCollateralized: mostCollateralized.status === 'fulfilled'
        ? (Array.isArray(mostCollateralized.value) ? mostCollateralized.value[0] : mostCollateralized.value) : null,
      mostSales: mostSales.status === 'fulfilled'
        ? (Array.isArray(mostSales.value) ? mostSales.value[0] : mostSales.value) : null,
    };

    const data = { topPlayers, whales, fetchedAt: new Date().toISOString() };
    leaderboardCache = { data, timestamp: now };

    res.set('Cache-Control', 'public, max-age=300');
    const jsonStr = JSON.stringify({ success: true, ...data }, bigIntReplacer);
    res.setHeader('Content-Type', 'application/json');
    res.send(jsonStr);
  } catch (error: any) {
    console.error('[API] Error fetching leaderboard:', error);
    if (leaderboardCache) {
      const jsonStr = JSON.stringify({ success: true, ...leaderboardCache.data, cached: true, stale: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
  }
});

// Field guide cache (30 min TTL — game content rarely changes)
let fieldGuideCache: { data: any; timestamp: number } | null = null;
const FIELD_GUIDE_TTL = 30 * 60 * 1000;

/**
 * GET /api/v1/field-guide
 * Returns resource node prototypes linked to their loot tables and required tools
 */
app.get('/api/v1/field-guide', async (req, res) => {
  try {
    const now = Date.now();

    if (fieldGuideCache && (now - fieldGuideCache.timestamp) < FIELD_GUIDE_TTL) {
      res.set('Cache-Control', 'public, max-age=1800');
      res.json({ success: true, ...fieldGuideCache.data, cached: true });
      return;
    }

    if (!process.env.MNA_BLOCKCHAIN_RID) {
      res.json({ success: false, error: 'Blockchain not configured' });
      return;
    }

    await aliceClient.connect();
    const client = aliceClient.getClient();
    if (!client) {
      res.json({ success: false, error: 'Blockchain client not available' });
      return;
    }

    const [nodeProtos, lootTables, tools] = await Promise.allSettled([
      client.query('plot_nodes.get_node_prototypes', {}),
      client.query('loot_tables.get_loot_tables', {}),
      client.query('tools.get_all_tools_attributes', {}),
    ]);

    const nodes = nodeProtos.status === 'fulfilled' && Array.isArray(nodeProtos.value) ? nodeProtos.value : [];
    const loots = lootTables.status === 'fulfilled' && Array.isArray(lootTables.value) ? lootTables.value : [];
    const toolList = tools.status === 'fulfilled' && Array.isArray(tools.value) ? tools.value : [];

    // Build loot table lookup
    const lootMap: Record<string, any> = {};
    for (const lt of loots) {
      lootMap[(lt as any).name] = lt;
    }

    // Build tool category lookup: category_id -> tool tiers
    const toolCategoryMap: Record<string, string> = {};
    for (const t of toolList) {
      const cat = (t as any).tool_category;
      if (cat && !(cat in toolCategoryMap)) {
        toolCategoryMap[cat] = cat;
      }
    }
    // Map numeric tool_category to category name
    const toolCatNumToName: Record<number, string> = { 0: 'axe', 1: 'hammer', 2: 'pickaxe', 3: 'shovel', 4: 'sickle' };

    // Build grouped tools by category
    const toolsByCategory: Record<string, any[]> = {};
    for (const t of toolList) {
      const cat = (t as any).tool_category;
      if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
      toolsByCategory[cat].push(t);
    }
    // Sort each category by tier
    for (const cat of Object.keys(toolsByCategory)) {
      toolsByCategory[cat].sort((a: any, b: any) => a.tier - b.tier);
    }

    // Join nodes → loot + tools
    const resourceNodes = nodes
      .filter((n: any) => n.type === 'resource_node')
      .map((n: any) => {
        const attrs = n.attrs || {};
        const loot = lootMap[attrs.loot_table_name] || null;
        const toolCatName = toolCatNumToName[attrs.tool_category] || `category_${attrs.tool_category}`;
        const requiredTools = toolsByCategory[toolCatName] || [];

        return {
          name: n.name,
          resourceType: n.name.replace('resourcenode_', '').replace(/_t\d+$/, ''),
          tier: attrs.tier,
          charges: attrs.charges,
          harvestTime: attrs.harvest_time,
          replenishTime: attrs.replenish_duration,
          moxieDrain: attrs.moxie_drain,
          durabilityCost: attrs.durability_cost,
          toolCategory: toolCatName,
          tools: requiredTools.map((t: any) => ({
            name: t.name,
            tier: t.tier,
            durability: t.max_durability,
          })),
          drops: loot ? loot.entries.map((e: any) => ({
            item: e.reward_name,
            amount: e.reward_amount,
            weight: e.weight,
          })) : [],
        };
      })
      .sort((a: any, b: any) => {
        const typeOrder = ['wood', 'stone', 'ore', 'fiber', 'sediment'];
        const ai = typeOrder.indexOf(a.resourceType);
        const bi = typeOrder.indexOf(b.resourceType);
        if (ai !== bi) return ai - bi;
        return a.tier - b.tier;
      });

    const economyNodes = nodes
      .filter((n: any) => n.type === 'economy_node')
      .map((n: any) => ({ name: n.name, width: n.width, height: n.height }));

    // Mystery box loot table
    const mysteryBox = loots.find((lt: any) => (lt as any).name.includes('mysterybox'));

    const data = {
      resourceNodes,
      economyNodes,
      mysteryBox: mysteryBox || null,
      toolCategories: Object.entries(toolsByCategory).map(([cat, items]) => ({
        category: cat,
        tools: (items as any[]).map((t: any) => ({
          name: t.name,
          tier: t.tier,
          durability: t.max_durability,
          moxieDrain: t.moxie_drain,
        })),
      })),
      totalNodes: nodes.length,
      totalLootTables: loots.length,
      totalTools: toolList.length,
      fetchedAt: new Date().toISOString(),
    };

    fieldGuideCache = { data, timestamp: now };

    res.set('Cache-Control', 'public, max-age=1800');
    res.json({ success: true, ...data });
  } catch (error: any) {
    console.error('[API] Error fetching field guide:', error);
    if (fieldGuideCache) {
      res.json({ success: true, ...fieldGuideCache.data, cached: true, stale: true });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch field guide' });
  }
});

// Per-plot cache (5 min TTL)
const plotCache = new Map<number, { data: any; timestamp: number }>();
const PLOT_CACHE_TTL = 5 * 60 * 1000;

// Per-player cache (5 min TTL)
const playerCache = new Map<string, { data: any; timestamp: number }>();
const PLAYER_CACHE_TTL = 5 * 60 * 1000;

// Storefront listings cache (2 min TTL)
let storefrontCache: { data: any; timestamp: number } | null = null;
const STOREFRONT_CACHE_TTL = 2 * 60 * 1000;

// Economy cache (10 min TTL — game content changes slowly)
let economyCache: { data: any; timestamp: number } | null = null;
const ECONOMY_TTL = 10 * 60 * 1000;

/**
 * GET /api/v1/economy
 * Returns game economy stats: crops, fish, recipes, tools, shops, quests, NPCs
 */
app.get('/api/v1/economy', async (req, res) => {
  try {
    const now = Date.now();

    if (economyCache && (now - economyCache.timestamp) < ECONOMY_TTL) {
      res.set('Cache-Control', 'public, max-age=600');
      const jsonStr = JSON.stringify({ success: true, ...economyCache.data, cached: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }

    if (!process.env.MNA_BLOCKCHAIN_RID) {
      res.json({ success: false, error: 'Blockchain not configured' });
      return;
    }

    await aliceClient.connect();
    const client = aliceClient.getClient();
    if (!client) {
      res.json({ success: false, error: 'Blockchain client not available' });
      return;
    }

    const [crops, seeds, fishTypes, baits, registeredFish, recipes, quests, shopListings, shops, tools, npcs, lootTables, bjornConfig, storefrontConfig, feesConfig] = await Promise.allSettled([
      client.query('farming.get_all_crops', {}),
      client.query('farming.get_all_seeds', {}),
      client.query('fishing.get_all_fish_types', {}),
      client.query('fishing.get_all_baits', {}),
      client.query('fishing.get_all_registered_fishes', {}),
      client.query('recipes.get_all_recipes', {}),
      client.query('quests.get_all_quests', {}),
      client.query('shop.get_all_shop_listings', {}),
      client.query('shop.get_all_shops', {}),
      client.query('tools.get_all_tools_attributes', {}),
      client.query('npcs.get_all_npcs', {}),
      client.query('loot_tables.get_loot_tables', {}),
      client.query('bjorn_extraction.get_bjorn_extraction_configs', {}),
      client.query('storefronts.get_storefronts_configs', {}),
      client.query('assets.get_fees_config', {}),
    ]);

    const count = (r: PromiseSettledResult<any>) =>
      r.status === 'fulfilled' && Array.isArray(r.value) ? r.value.length : null;

    const data = {
      farming: {
        crops: count(crops),
        seeds: count(seeds),
      },
      fishing: {
        fishTypes: count(fishTypes),
        baits: count(baits),
        registeredFish: count(registeredFish),
      },
      crafting: {
        recipes: count(recipes),
      },
      quests: {
        total: count(quests),
      },
      shops: {
        listings: count(shopListings),
        shops: count(shops),
      },
      tools: {
        total: count(tools),
      },
      npcs: {
        total: count(npcs),
      },
      lootTables: {
        total: count(lootTables),
      },
      bjornExtraction: bjornConfig.status === 'fulfilled' ? bjornConfig.value : null,
      storefrontConfig: storefrontConfig.status === 'fulfilled' ? storefrontConfig.value : null,
      feesConfig: feesConfig.status === 'fulfilled' ? feesConfig.value : null,
      fetchedAt: new Date().toISOString(),
    };

    economyCache = { data, timestamp: now };

    res.set('Cache-Control', 'public, max-age=600');
    const jsonStr = JSON.stringify({ success: true, ...data }, bigIntReplacer);
    res.setHeader('Content-Type', 'application/json');
    res.send(jsonStr);
  } catch (error: any) {
    console.error('[API] Error fetching economy:', error);
    if (economyCache) {
      const jsonStr = JSON.stringify({ success: true, ...economyCache.data, cached: true, stale: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch economy data' });
  }
});

/**
 * GET /api/v1/plots/:plotNumber
 * Returns detailed plot data from the Chromia blockchain
 */
app.get('/api/v1/plots/:plotNumber', async (req, res) => {
  try {
    const plotNumber = parseInt(req.params.plotNumber, 10);
    if (isNaN(plotNumber)) {
      res.status(400).json({ success: false, error: 'Invalid plot number' });
      return;
    }

    // Check per-plot cache
    const now = Date.now();
    const cached = plotCache.get(plotNumber);
    if (cached && (now - cached.timestamp) < PLOT_CACHE_TTL) {
      res.set('Cache-Control', 'public, max-age=300');
      const jsonStr = JSON.stringify({ success: true, ...cached.data, cached: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }

    if (!process.env.MNA_BLOCKCHAIN_RID) {
      res.json({ success: false, error: 'Blockchain not configured' });
      return;
    }

    await aliceClient.connect();
    const client = aliceClient.getClient();
    if (!client) {
      res.json({ success: false, error: 'Blockchain client not available' });
      return;
    }

    // Generate plot_id Buffer from plot_number
    const plotId = await client.query('plots.generate_plot_id', { plot_number: plotNumber });

    // Phase 1: Query all plot data in parallel
    const [plotMeta, plotMap, farmingState, fishList, plotNodes, placedItems] = await Promise.allSettled([
      client.query('plots.get_plot_meta', { plot_id: plotId }),
      client.query('plots.get_plot_map', { plot_id: plotId }),
      client.query('farming.state_at_plot', { plot_id: plotId }),
      client.query('fishing.get_fish_master_list', { plot_id: plotId }),
      client.query('plot_nodes.get_nodes_on_plot', { plot_id: plotId }),
      client.query('placeables.all_placeables_at', { griddable_uid: plotId }),
    ]);

    // Phase 2: If we have an owner, fetch avatar + placeables inventory
    let avatarData: any = null;
    let placeablesInventory: any = null;
    const meta = plotMeta.status === 'fulfilled' ? plotMeta.value as any : null;
    const ownerName = meta?.owner_name;
    if (ownerName) {
      try {
        const player = await client.query('player.find_by_username', { username: ownerName }) as any;
        if (player?.id) {
          const [avatarResult, inventoryResult] = await Promise.allSettled([
            client.query('avatar.get', { account_id: player.id }),
            client.query('placeables.all_my_placeables', { account_id: player.id }),
          ]);
          avatarData = avatarResult.status === 'fulfilled' ? avatarResult.value : null;
          placeablesInventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value : null;
        }
      } catch (_) { /* owner lookup failed, continue without */ }
    }

    const placedArr = placedItems.status === 'fulfilled' && Array.isArray(placedItems.value) ? placedItems.value : [];

    const data = {
      plotNumber,
      meta,
      map: plotMap.status === 'fulfilled' ? plotMap.value : null,
      farming: farmingState.status === 'fulfilled' ? farmingState.value : null,
      fishing: fishList.status === 'fulfilled' ? fishList.value : null,
      nodes: plotNodes.status === 'fulfilled' ? plotNodes.value : null,
      placeables: {
        placedCount: placedArr.length,
        placed: placedArr,
        inventory: Array.isArray(placeablesInventory)
          ? placeablesInventory.map((p: any) => ({ name: p.name || p.prototype_name || 'unknown', amount: p.amount ?? 1 }))
          : [],
      },
      avatar: avatarData ? {
        equippables: Array.isArray(avatarData) ? avatarData.map((e: any) => ({ name: e.name || e.prototype_name || String(e) }))
          : avatarData.equippables ? avatarData.equippables.map((e: any) => ({ name: e.name || e.prototype_name || String(e) }))
          : [],
      } : null,
      fetchedAt: new Date().toISOString(),
    };

    plotCache.set(plotNumber, { data, timestamp: now });

    res.set('Cache-Control', 'public, max-age=300');
    const jsonStr = JSON.stringify({ success: true, ...data }, bigIntReplacer);
    res.setHeader('Content-Type', 'application/json');
    res.send(jsonStr);
  } catch (error: any) {
    console.error('[API] Error fetching plot:', error?.message || error);
    // Return stale cache on error
    const stale = plotCache.get(parseInt(req.params.plotNumber, 10));
    if (stale) {
      const jsonStr = JSON.stringify({ success: true, ...stale.data, cached: true, stale: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch plot data' });
  }
});

/**
 * GET /api/v1/players/:username
 * Returns player profile data from the Chromia blockchain
 */
app.get('/api/v1/players/:username', async (req, res) => {
  try {
    const username = req.params.username;
    if (!username || username.length > 50) {
      res.status(400).json({ success: false, error: 'Invalid username' });
      return;
    }

    // Check per-player cache (case-insensitive key)
    const cacheKey = username.toLowerCase();
    const now = Date.now();
    const cached = playerCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < PLAYER_CACHE_TTL) {
      res.set('Cache-Control', 'public, max-age=300');
      const jsonStr = JSON.stringify({ success: true, ...cached.data, cached: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }

    if (!process.env.MNA_BLOCKCHAIN_RID) {
      res.json({ success: false, error: 'Blockchain not configured' });
      return;
    }

    await aliceClient.connect();
    const client = aliceClient.getClient();
    if (!client) {
      res.json({ success: false, error: 'Blockchain client not available' });
      return;
    }

    // Find player by username
    const player = await client.query('player.find_by_username', { username }) as any;
    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    // Get plots, progression, and leaderboard position in parallel
    const [plots, progression, leaderboardPos] = await Promise.allSettled([
      client.query('plots.get_plot_ids_by_player', { username }),
      client.query('player_progression.get_player_progression', { account_id: player.id }),
      client.query('player_progression.get_player_leaderboard_position', { account_id: player.id }),
    ]);

    // Structure plots data with count and plot numbers
    const plotsRaw = plots.status === 'fulfilled' && Array.isArray(plots.value) ? plots.value : [];
    const plotNumbers = plotsRaw.map((p: any) => p.plot_number ?? p).filter(Boolean);

    // Merge progression + leaderboard position
    const prog = progression.status === 'fulfilled' ? progression.value as any : null;
    const lbPos = leaderboardPos.status === 'fulfilled' ? leaderboardPos.value : null;

    const data = {
      player: {
        username: player.username,
        tokens: player.tokens,
        dateOfBirth: player.date_of_birth,
        isGuest: player.is_guest,
        residence: player.residence,
      },
      plots: {
        count: plotsRaw.length,
        plotNumbers,
      },
      progression: prog ? {
        ...prog,
        rank: lbPos ?? null,
      } : null,
      fetchedAt: new Date().toISOString(),
    };

    playerCache.set(cacheKey, { data, timestamp: now });

    res.set('Cache-Control', 'public, max-age=300');
    const jsonStr = JSON.stringify({ success: true, ...data }, bigIntReplacer);
    res.setHeader('Content-Type', 'application/json');
    res.send(jsonStr);
  } catch (error: any) {
    console.error('[API] Error fetching player:', error);
    // Return stale cache on error
    const stale = playerCache.get(req.params.username?.toLowerCase());
    if (stale) {
      const jsonStr = JSON.stringify({ success: true, ...stale.data, cached: true, stale: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch player data' });
  }
});

/**
 * GET /api/v1/storefront/listings
 * Returns storefront floor prices for game assets from the Chromia blockchain
 */
app.get('/api/v1/storefront/listings', async (req, res) => {
  try {
    const now = Date.now();

    if (storefrontCache && (now - storefrontCache.timestamp) < STOREFRONT_CACHE_TTL) {
      res.set('Cache-Control', 'public, max-age=120');
      const jsonStr = JSON.stringify({ success: true, ...storefrontCache.data, cached: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }

    if (!process.env.MNA_BLOCKCHAIN_RID) {
      res.json({ success: false, error: 'Blockchain not configured' });
      return;
    }

    await aliceClient.connect();
    const client = aliceClient.getClient();
    if (!client) {
      res.json({ success: false, error: 'Blockchain client not available' });
      return;
    }

    // Get all assets
    const allAssets = await client.query('assets.get_all_assets', {});
    const assetList = Array.isArray(allAssets) ? allAssets : (allAssets as any)?.data || [];

    // Pick first 20 assets and query floor prices in parallel
    const sample = assetList.slice(0, 20);
    const floorPrices = await Promise.allSettled(
      sample.map((a: any) => client.query('storefronts.get_floor_price_for_listing', { asset_id: a.id }))
    );

    // Combine: name + floor price data, filter out nulls
    const listings = sample
      .map((asset: any, i: number) => {
        const priceResult = floorPrices[i];
        const priceData = priceResult.status === 'fulfilled' ? priceResult.value : null;
        if (!priceData) return null;
        return {
          name: asset.name,
          templateName: asset.template_name,
          floorAlice: (priceData as any).cheapest_item_alice ?? null,
          floorBjorn: (priceData as any).cheapest_item_bjorn ?? null,
          totalAmount: (priceData as any).total_amount ?? null,
          totalListings: (priceData as any).total_listings ?? null,
        };
      })
      .filter(Boolean);

    const data = {
      listings,
      totalAssetsQueried: sample.length,
      fetchedAt: new Date().toISOString(),
    };

    storefrontCache = { data, timestamp: now };

    res.set('Cache-Control', 'public, max-age=120');
    const jsonStr = JSON.stringify({ success: true, ...data }, bigIntReplacer);
    res.setHeader('Content-Type', 'application/json');
    res.send(jsonStr);
  } catch (error: any) {
    console.error('[API] Error fetching storefront listings:', error);
    // Return stale cache on error
    if (storefrontCache) {
      const jsonStr = JSON.stringify({ success: true, ...storefrontCache.data, cached: true, stale: true }, bigIntReplacer);
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch storefront listings' });
  }
});

/**
 * GET /api/v1/health
 * Health check endpoint
 */
app.get('/api/v1/health', async (req, res) => {
  let mnaApiStatus = 'unknown';
  try {
    await axios.get(`${MNA_API_BASE}/api/nfts?limit=1`, { timeout: 5000 });
    mnaApiStatus = 'connected';
  } catch {
    mnaApiStatus = 'error';
  }

  res.json({
    status: 'ok',
  });
});

// Serve the visualization frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../visualization/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   My Neighbor Alice Universe - REAL DATA Edition          ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${String(PORT).padEnd(5)}                ║
║                                                           ║
║  Data Sources:                                            ║
║    MNA Marketplace API (REAL land data!)                  ║
║    Chromia Blockchain (ALICE/BJORN tokens)                ║
║                                                           ║
║  API endpoints (tiered access):                           ║
║    GET /api/v1/lands       - Real land plots              ║
║    GET /api/v1/lands/raw   - Raw land data     [pro]      ║
║    GET /api/v1/marketplace - Items for sale               ║
║    GET /api/v1/assets      - FT4 tokens        [basic+]   ║
║    GET /api/v1/chain-stats - Chromia blockchain stats     ║
║    GET /api/v1/leaderboard - Top players + whales         ║
║    GET /api/v1/economy     - Game economy data            ║
║    GET /api/v1/plots/:id   - Plot deep-dive    [tier2]    ║
║    GET /api/v1/players/:u  - Player lookup     [tier2]    ║
║    GET /api/v1/storefront/listings - Floor prices [tier2] ║
║    GET /api/v1/health      - Health check                 ║
║                                                           ║
║  Admin: POST/GET/DELETE /api/admin/keys                   ║
║         GET /api/admin/usage                              ║
║                                                           ║
║  Auth: ${process.env.ADMIN_API_KEY ? 'ADMIN_API_KEY configured' : 'ADMIN_API_KEY not set (admin disabled)'}
╠═══════════════════════════════════════════════════════════╣
║  3D Visualization: http://localhost:${String(PORT).padEnd(5)}                 ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Load disk cache on startup, then refresh in background
  ensureCacheDir();
  const diskStartup = readDiskCache('lands.json', DISK_CACHE_MAX_AGE);
  if (diskStartup) {
    landCache = diskStartup.data;
    lastFetch = diskStartup.timestamp;
    console.log(`[API] Loaded ${landCache.length} lands from disk cache (age: ${Math.round((Date.now() - diskStartup.timestamp) / 1000)}s)`);
    // Refresh in background if stale
    if ((Date.now() - diskStartup.timestamp) > CACHE_TTL) {
      triggerBackgroundRefresh();
    }
  } else {
    // No disk cache — blocking fetch on first startup
    fetchRealLands().then(lands => {
      console.log(`[API] Pre-loaded ${lands.length} real lands from MNA Marketplace`);
    });
  }

  // Start Moltbook heartbeat agent if explicitly enabled and API key is configured
  if (process.env.ENABLE_HEARTBEAT === 'true' && process.env.MOLTBOOK_API_KEY) {
    const agent = new AliceMoltbookAgent({
      moltbook: {
        apiKey: process.env.MOLTBOOK_API_KEY,
        agentName: process.env.MOLTBOOK_AGENT_NAME || 'MyNeighborAliceBot',
      },
      alice: {
        nodeUrl: process.env.CHROMIA_NODE_URL || 'https://node.chromia.com',
        blockchainRid: process.env.MNA_BLOCKCHAIN_RID || '',
      },
    });

    console.log('[Moltbook] Starting heartbeat agent...');
    agent.heartbeat().catch(err => console.error('[Moltbook] Initial heartbeat error:', err));

    new CronJob(
      '*/30 * * * *',
      async () => {
        console.log(`[Moltbook] Scheduled heartbeat at ${new Date().toISOString()}`);
        await agent.heartbeat().catch(err => console.error('[Moltbook] Heartbeat error:', err));
      },
      null,
      true,
      'UTC'
    );
    console.log('[Moltbook] Heartbeat scheduled every 30 minutes');
  } else {
    console.log('[Moltbook] Heartbeat agent disabled (set ENABLE_HEARTBEAT=true to enable)');
  }
});
