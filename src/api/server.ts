/**
 * My Neighbor Alice Universe API Server
 *
 * Express server providing REST endpoints for land and asset data,
 * serving the 3D visualization frontend.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { AliceClient, Land } from '../alice/client.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

// Initialize Alice client
const aliceClient = new AliceClient({
  nodeUrl: process.env.CHROMIA_NODE_URL || 'https://dapps0.chromaway.com:7740',
  blockchainRid: process.env.MNA_BLOCKCHAIN_RID || '',
});

// Generate a large island world with 100+ plots
function generateIslandWorld(): Land[] {
  const lands: Land[] = [];
  const centerX = 7;
  const centerY = 7;
  const maxRadius = 8;

  const namesPrefixes = ['Sunny', 'Misty', 'Golden', 'Silver', 'Crystal', 'Shadow', 'Ancient', 'Hidden', 'Royal', 'Wild'];
  const namesSuffixes = ['Meadow', 'Grove', 'Heights', 'Valley', 'Shore', 'Point', 'Hollow', 'Ridge', 'Bay', 'Field'];
  const sizes: ('small' | 'medium' | 'large')[] = ['small', 'medium', 'large'];

  let id = 1;

  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      // Calculate distance from center for island shape
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Create island shape - skip plots too far from center
      if (distance > maxRadius) continue;

      // Add some randomness to island edges
      if (distance > maxRadius - 1.5 && Math.random() > 0.6) continue;

      // Determine biome based on position
      let biome: string;
      if (distance > maxRadius - 2) {
        // Outer ring is water/beach
        biome = Math.random() > 0.3 ? 'water' : 'desert';
      } else if (distance > maxRadius - 4) {
        // Middle ring is mixed
        const rand = Math.random();
        if (rand < 0.4) biome = 'plains';
        else if (rand < 0.7) biome = 'forest';
        else biome = 'desert';
      } else {
        // Inner area - more forest and plains
        const rand = Math.random();
        if (rand < 0.5) biome = 'forest';
        else if (rand < 0.85) biome = 'plains';
        else biome = 'water'; // inland lakes
      }

      // Generate random owner
      const ownerNum = Math.floor(Math.random() * 1000).toString(16).padStart(4, '0');

      // Some lands are for sale (about 20%)
      const forSale = Math.random() < 0.2;
      const price = forSale ? Math.floor(50 + Math.random() * 450) : undefined;

      // Random size weighted toward medium
      const sizeRand = Math.random();
      const size = sizeRand < 0.25 ? 'small' : sizeRand < 0.75 ? 'medium' : 'large';

      // Generate name
      const prefix = namesPrefixes[Math.floor(Math.random() * namesPrefixes.length)];
      const suffix = namesSuffixes[Math.floor(Math.random() * namesSuffixes.length)];

      lands.push({
        id: String(id++),
        name: `${prefix} ${suffix}`,
        owner: `0x${ownerNum}`,
        x,
        y,
        size,
        biome,
        forSale,
        price,
      });
    }
  }

  return lands;
}

// Mock data for development (when blockchain isn't available)
const mockLands: Land[] = generateIslandWorld();

const mockAssets = [
  { id: 'alice', name: 'ALICE', symbol: 'ALICE', decimals: 18, type: 'ft4' },
  { id: 'bjorn', name: 'BJORN', symbol: 'BJORN', decimals: 18, type: 'ft4' },
];

// API Routes

/**
 * GET /api/v1/lands
 * Returns all lands from the blockchain (or mock data)
 */
app.get('/api/v1/lands', async (req, res) => {
  try {
    // Try to get real data from blockchain
    if (process.env.MNA_BLOCKCHAIN_RID) {
      const lands = await aliceClient.getLands({
        limit: 100,
        owner: req.query.owner as string | undefined,
        forSale: req.query.forSale === 'true' ? true : undefined,
        biome: req.query.biome as string | undefined,
      });

      if (lands.length > 0) {
        res.json({ success: true, data: lands, source: 'blockchain' });
        return;
      }
    }

    // Fall back to mock data
    let filteredLands = [...mockLands];

    if (req.query.biome) {
      filteredLands = filteredLands.filter(l => l.biome === req.query.biome);
    }
    if (req.query.forSale === 'true') {
      filteredLands = filteredLands.filter(l => l.forSale);
    }
    if (req.query.owner) {
      filteredLands = filteredLands.filter(l => l.owner === req.query.owner);
    }

    res.json({ success: true, data: filteredLands, source: 'mock' });
  } catch (error) {
    console.error('[API] Error fetching lands:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch lands' });
  }
});

/**
 * GET /api/v1/assets
 * Returns FT4 tokens (ALICE, BJORN)
 */
app.get('/api/v1/assets', async (req, res) => {
  try {
    // Try to get real data from blockchain
    if (process.env.MNA_BLOCKCHAIN_RID) {
      const assets = await aliceClient.getAllAssets();

      if (assets.length > 0) {
        // Use custom serialization to handle BigInt
        const jsonStr = JSON.stringify({ success: true, data: assets, source: 'blockchain' }, bigIntReplacer);
        res.setHeader('Content-Type', 'application/json');
        res.send(jsonStr);
        return;
      }
    }

    // Fall back to mock data
    res.json({ success: true, data: mockAssets, source: 'mock' });
  } catch (error) {
    console.error('[API] Error fetching assets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch assets' });
  }
});

/**
 * GET /api/v1/health
 * Health check endpoint
 */
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    blockchainConfigured: !!process.env.MNA_BLOCKCHAIN_RID
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
║     My Neighbor Alice Universe - API & 3D Visualization   ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                 ║
║  API endpoints:                                           ║
║    GET /api/v1/lands   - Get all lands                    ║
║    GET /api/v1/assets  - Get FT4 tokens                   ║
║    GET /api/v1/health  - Health check                     ║
╠═══════════════════════════════════════════════════════════╣
║  3D Visualization: http://localhost:${PORT}                  ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
