# Alice Collective Grant Application

## Project: MNA Universe Analytics Platform

**Builder:** AliceInChainlandMNA
**Live Deployment:** https://web-production-87126.up.railway.app
**Source Code:** https://github.com/your-repo/myNeighborAlice
**Date:** February 2026

---

## Project Overview

MNA Universe is the first third-party analytics and data platform for the My Neighbor Alice ecosystem. We've built a production-ready system that includes:

- **REST API** serving real-time MNA land, marketplace, and asset data from the official MNA Marketplace API and Chromia blockchain
- **3D Interactive Map** visualizing all MNA land plots with pricing, biome classification, and region filtering
- **AI Social Agent** (AliceInChainlandMNA on Moltbook) that monitors on-chain activity and engages the community with market insights
- **Chromia Blockchain Integration** pulling FT4 token data (ALICE, BJORN) directly from the chain
- **Tiered API Access** with key-based authentication enabling developers and third parties to build on MNA data

All endpoints serve real production data from `mkpl-api.prod.myneighboralice.com` with pagination, caching, and rate limiting.

---

## Value to the MNA Ecosystem

My Neighbor Alice has 100K+ users and an active land marketplace, but no third-party analytics tools exist today. This creates a gap:

1. **For players:** No way to compare land prices across regions, track price trends, or discover undervalued plots without manually browsing the marketplace
2. **For developers:** No public API to build tools, bots, or dashboards on top of MNA data
3. **For the community:** No automated market intelligence or social presence analyzing on-chain activity

MNA Universe fills all three gaps. The 3D visualization makes land exploration intuitive. The API enables a developer ecosystem. The social agent drives engagement on Moltbook by posting real-time market analysis.

---

## Technical Capabilities

### Working API Endpoints

| Endpoint | Description | Status |
|---|---|---|
| `GET /api/v1/lands` | All land plots with coordinates, pricing, biome classification | Live |
| `GET /api/v1/lands/raw` | Raw land data for developer integrations | Live |
| `GET /api/v1/marketplace` | Active marketplace listings (lands, items, avatars, decorations) | Live |
| `GET /api/v1/assets` | FT4 token data from Chromia blockchain | Live |
| `GET /api/v1/health` | Health check with MNA API connectivity status | Live |

### Architecture

- **Runtime:** Node.js + TypeScript (strict mode)
- **API Framework:** Express.js with Helmet security headers, CORS, tiered rate limiting
- **Data Sources:** MNA Marketplace API (paginated, cached), Chromia blockchain (postchain-client)
- **Auth:** API key system with SHA-256 hashed storage, three access tiers (free/basic/pro)
- **Deployment:** Railway with automated builds
- **Social Agent:** Cron-scheduled heartbeat posting market insights to Moltbook

### Data Processing

- Fetches all MNA lands via pagination (thousands of plots)
- Builds price maps from on-sale listings
- Deduplicates by plotId
- Transforms coordinates for 3D visualization
- Maps regions to biomes (forest, water, desert, plains)
- Categorizes land sizes (small/medium/large)

---

## Roadmap

### Near-term (1-3 months)

- **Price history tracking** -- Store daily snapshots of land prices and marketplace volume
- **Price alerts** -- Notify users when land in their target region/price drops below threshold
- **Valuation model** -- Estimate fair land value based on location, size, soil quality, and comparable sales
- **Dashboard UI** -- Web dashboard with charts for market trends, volume, and price distribution

### Medium-term (3-6 months)

- **Developer SDK** -- npm package wrapping the API with TypeScript types for easy integration
- **Webhook system** -- Push notifications for marketplace events (new listings, sales, price changes)
- **Portfolio tracker** -- Connect wallet to track owned land values over time
- **Multi-chain expansion** -- Support Chromia mainnet assets alongside marketplace data

### Long-term (6-12 months)

- **Market analytics reports** -- Weekly automated reports on marketplace health
- **Land comparison tool** -- Side-by-side comparison of plots with scoring
- **Community API access** -- Self-service API key registration for builders

---

## Team

Solo builder with full-stack experience in TypeScript, blockchain integrations (Chromia/postchain), and AI agent development. Active in the MNA community via Moltbook as AliceInChainlandMNA.

---

## Grant Request

**Requested Amount:** 10,000 ALICE

### Fund Allocation

| Category | Amount | Purpose |
|---|---|---|
| Infrastructure | 3,000 ALICE | Railway hosting, domain, monitoring for 12 months |
| Development | 5,000 ALICE | Price tracking, alerts, dashboard, SDK development |
| Community | 2,000 ALICE | Documentation, developer onboarding, API free tier costs |

### Milestones

1. **Month 1:** Price history tracking + dashboard UI (verifiable via live API)
2. **Month 3:** Developer SDK published to npm + webhook system
3. **Month 6:** Portfolio tracker + 10 third-party integrations using the API

---

## Links

- **Live Platform:** https://web-production-87126.up.railway.app
- **3D Map:** https://web-production-87126.up.railway.app (root URL)
- **API Health:** https://web-production-87126.up.railway.app/api/v1/health
- **Moltbook Agent:** AliceInChainlandMNA on Moltbook

---

*Built for the MNA community. Data-driven tools to make the Alice universe more transparent and accessible.*
