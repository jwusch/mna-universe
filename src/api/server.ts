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
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';
import { AliceClient, Land } from '../alice/client.js';

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

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from visualization directory
app.use(express.static(path.join(__dirname, '../visualization')));

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

/**
 * Fetch real land data from MNA Marketplace API
 */
async function fetchRealLands(): Promise<RealLand[]> {
  const now = Date.now();
  if (landCache.length > 0 && (now - lastFetch) < CACHE_TTL) {
    return landCache;
  }

  console.log('[API] Fetching real land data from MNA Marketplace...');

  try {
    // Fetch all lands and lands for sale in parallel
    const [allLandsRes, forSaleRes] = await Promise.all([
      axios.get(`${MNA_API_BASE}/api/nfts?type=land&limit=500`),
      axios.get(`${MNA_API_BASE}/api/nfts?type=land&status=onSale&limit=500`),
    ]);

    const allLands = allLandsRes.data.result || [];
    const forSaleLands = forSaleRes.data.result || [];

    // Create a map of lands for sale with their prices
    const forSaleMap = new Map<number, { price: number; seller: string }>();
    forSaleLands.forEach((nft: any) => {
      const plotId = nft.metadata?.land?.plotId || nft.metadata?.tokenId;
      const sale = nft.latestSale;
      if (plotId && sale) {
        forSaleMap.set(plotId, {
          price: sale.listingPrice ? sale.listingPrice / 1000000 : 0, // Convert to ALICE
          seller: sale.seller?.nickName || sale.seller?.wallet?.slice(0, 6) + '...' || 'Unknown',
        });
      }
    });

    // Transform to our format
    const lands: RealLand[] = [];
    const seenPlots = new Set<number>();

    // Process all lands
    [...allLands, ...forSaleLands].forEach((nft: any) => {
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

    console.log(`[API] Fetched ${lands.length} real lands (${forSaleMap.size} for sale)`);

    landCache = lands;
    lastFetch = now;
    return lands;

  } catch (error) {
    console.error('[API] Error fetching from MNA API:', error);
    return landCache; // Return cached data on error
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

  // Normalize coordinates to a reasonable grid
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = 20; // Target grid size

  return lands.map(land => {
    // Normalize to 0-20 range
    const normX = ((land.x - minX) / rangeX) * scale;
    const normY = ((land.y - minY) / rangeY) * scale;

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
      size: 'medium' as const,
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
    let lands = transformForVisualization(realLands);

    // Apply filters
    if (req.query.forSale === 'true') {
      lands = lands.filter(l => l.forSale);
    }
    if (req.query.island) {
      lands = lands.filter(l => l.island.toLowerCase().includes((req.query.island as string).toLowerCase()));
    }
    if (req.query.region) {
      lands = lands.filter(l => l.region.toLowerCase().includes((req.query.region as string).toLowerCase()));
    }

    res.json({
      success: true,
      data: lands,
      source: 'mna-marketplace-api',
      stats: {
        total: lands.length,
        forSale: lands.filter(l => l.forSale).length,
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
 * Returns items currently for sale
 */
app.get('/api/v1/marketplace', async (req, res) => {
  try {
    const type = req.query.type || 'land';
    const response = await axios.get(`${MNA_API_BASE}/api/nfts?type=${type}&status=onSale&limit=100`);
    const items = response.data.result || [];

    const transformed = items.map((nft: any) => ({
      id: nft.id,
      name: nft.metadata?.name,
      type: nft.metadata?.type,
      image: nft.metadata?.image,
      price: nft.latestSale?.listingPrice ? nft.latestSale.listingPrice / 1000000 : null,
      seller: nft.latestSale?.seller?.nickName || 'Unknown',
      chain: nft.chain,
      land: nft.metadata?.land,
    }));

    res.json({
      success: true,
      data: transformed,
      source: 'mna-marketplace-api',
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
    timestamp: new Date().toISOString(),
    mnaMarketplaceApi: mnaApiStatus,
    chromiaBlockchain: !!process.env.MNA_BLOCKCHAIN_RID,
    cachedLands: landCache.length,
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
║   My Neighbor Alice Universe - REAL DATA Edition 🐇       ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${String(PORT).padEnd(5)}                ║
║                                                           ║
║  Data Sources:                                            ║
║    • MNA Marketplace API (REAL land data!)                ║
║    • Chromia Blockchain (ALICE/BJORN tokens)              ║
║                                                           ║
║  API endpoints:                                           ║
║    GET /api/v1/lands       - Real land plots              ║
║    GET /api/v1/lands/raw   - Raw land data                ║
║    GET /api/v1/marketplace - Items for sale               ║
║    GET /api/v1/assets      - FT4 tokens                   ║
║    GET /api/v1/health      - Health check                 ║
╠═══════════════════════════════════════════════════════════╣
║  3D Visualization: http://localhost:${String(PORT).padEnd(5)}                 ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Pre-fetch land data on startup
  fetchRealLands().then(lands => {
    console.log(`[API] Pre-loaded ${lands.length} real lands from MNA Marketplace`);
  });
});
