/**
 * My Neighbor Alice Blockchain Client
 *
 * Connects to the Chromia blockchain to query real game data.
 * Uses postchain-client and @chromia/ft4 for blockchain interactions.
 */

import { createClient, IClient } from 'postchain-client';
import { createConnection, Connection } from '@chromia/ft4';

export interface AliceConfig {
  nodeUrl: string;
  blockchainRid: string;
}

export interface Land {
  id: string;
  name: string;
  owner: string;
  x: number;
  y: number;
  size: 'small' | 'medium' | 'large';
  biome: string;
  forSale: boolean;
  price?: number;
}

export interface NFTAsset {
  id: string;
  type: 'land' | 'item' | 'avatar' | 'decoration';
  name: string;
  owner: string;
  metadata: Record<string, any>;
}

export interface MarketplaceListing {
  id: string;
  asset: NFTAsset;
  price: number;
  currency: 'ALICE' | 'CHR';
  seller: string;
  listedAt: string;
}

export interface PlayerProfile {
  address: string;
  username?: string;
  lands: Land[];
  inventory: NFTAsset[];
  aliceBalance: number;
}

export interface WorldEvent {
  id: string;
  type: 'sale' | 'listing' | 'transfer' | 'event';
  description: string;
  timestamp: string;
  data: Record<string, any>;
}

export interface GameStats {
  totalPlayers: number;
  totalLands: number;
  totalTransactions: number;
  floorPrice: number;
}

export class AliceClient {
  private nodeUrl: string;
  private blockchainRid: string;
  private client: IClient | null = null;
  private ft4Connection: Connection | null = null;
  private initialized: boolean = false;

  constructor(config: AliceConfig) {
    this.nodeUrl = config.nodeUrl;
    this.blockchainRid = config.blockchainRid;
  }

  /**
   * Initialize connection to Chromia blockchain
   */
  async connect(): Promise<void> {
    if (this.initialized) return;

    if (!this.blockchainRid) {
      throw new Error(
        'MNA_BLOCKCHAIN_RID not configured. ' +
        'Get the blockchain RID from Chromia explorer or My Neighbor Alice docs.'
      );
    }

    console.log('[Alice] Connecting to Chromia blockchain...');

    try {
      // Create postchain client
      this.client = await createClient({
        nodeUrlPool: this.nodeUrl,
        blockchainRid: this.blockchainRid,
      });

      // Create FT4 connection for token operations
      this.ft4Connection = createConnection(this.client);

      this.initialized = true;
      console.log('[Alice] Connected to Chromia blockchain');
    } catch (error) {
      console.error('[Alice] Failed to connect:', error);
      throw error;
    }
  }

  /**
   * Ensure client is connected before making queries
   */
  private async ensureConnected(): Promise<void> {
    if (!this.initialized) {
      await this.connect();
    }
  }

  /**
   * Query lands in the game world
   */
  async getLands(filters?: {
    owner?: string;
    forSale?: boolean;
    biome?: string;
    limit?: number;
  }): Promise<Land[]> {
    await this.ensureConnected();
    console.log('[Alice] Querying lands with filters:', filters);

    try {
      // Query the blockchain for land data
      // Note: The exact query name depends on MNA's Rell backend
      const result = await this.client!.query('mna.get_lands', {
        owner: filters?.owner || null,
        for_sale: filters?.forSale ?? null,
        biome: filters?.biome || null,
        limit: filters?.limit || 100,
      });

      return this.parseLandResults(result);
    } catch (error) {
      console.error('[Alice] Failed to query lands:', error);
      return [];
    }
  }

  /**
   * Get marketplace listings
   */
  async getMarketplaceListings(options?: {
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    limit?: number;
  }): Promise<MarketplaceListing[]> {
    await this.ensureConnected();
    console.log('[Alice] Fetching marketplace listings');

    try {
      const result = await this.client!.query('mna.get_marketplace_listings', {
        asset_type: options?.type || null,
        min_price: options?.minPrice || null,
        max_price: options?.maxPrice || null,
        limit: options?.limit || 50,
      });

      return this.parseListingResults(result);
    } catch (error) {
      console.error('[Alice] Failed to query marketplace:', error);
      return [];
    }
  }

  /**
   * Get recent world events (sales, transfers, new listings)
   */
  async getRecentEvents(limit: number = 50): Promise<WorldEvent[]> {
    await this.ensureConnected();
    console.log('[Alice] Fetching recent world events');

    try {
      const result = await this.client!.query('mna.get_recent_events', {
        limit,
      });

      return this.parseEventResults(result);
    } catch (error) {
      console.error('[Alice] Failed to query events:', error);
      return [];
    }
  }

  /**
   * Get player profile by wallet address
   */
  async getPlayerProfile(address: string): Promise<PlayerProfile | null> {
    await this.ensureConnected();
    console.log('[Alice] Fetching player profile:', address);

    try {
      const result = await this.client!.query('mna.get_player_profile', {
        address,
      });

      return result ? this.parsePlayerResult(result) : null;
    } catch (error) {
      console.error('[Alice] Failed to query player:', error);
      return null;
    }
  }

  /**
   * Get trending/popular lands
   */
  async getTrendingLands(limit: number = 10): Promise<Land[]> {
    await this.ensureConnected();
    console.log('[Alice] Fetching trending lands');

    try {
      const result = await this.client!.query('mna.get_trending_lands', {
        limit,
      });

      return this.parseLandResults(result);
    } catch (error) {
      console.error('[Alice] Failed to query trending lands:', error);
      return [];
    }
  }

  /**
   * Get game statistics
   */
  async getGameStats(): Promise<GameStats> {
    await this.ensureConnected();
    console.log('[Alice] Fetching game statistics');

    try {
      const result = await this.client!.query('mna.get_game_stats', {}) as any;

      return {
        totalPlayers: result?.total_players || 0,
        totalLands: result?.total_lands || 0,
        totalTransactions: result?.total_transactions || 0,
        floorPrice: result?.floor_price || 0,
      };
    } catch (error) {
      console.error('[Alice] Failed to query stats:', error);
      return {
        totalPlayers: 0,
        totalLands: 0,
        totalTransactions: 0,
        floorPrice: 0,
      };
    }
  }

  /**
   * Get ALICE token assets via FT4
   */
  async getAllAssets(): Promise<any[]> {
    await this.ensureConnected();
    console.log('[Alice] Fetching all FT4 assets');

    try {
      const result = await this.ft4Connection!.getAllAssets();
      return result.data || [];
    } catch (error) {
      console.error('[Alice] Failed to get assets:', error);
      return [];
    }
  }

  /**
   * Get account balance for an address
   */
  async getAccountBalance(address: string): Promise<any> {
    await this.ensureConnected();
    console.log('[Alice] Fetching account balance for:', address);

    try {
      const result = await this.ft4Connection!.getAccountById(
        Buffer.from(address, 'hex')
      );
      return result;
    } catch (error) {
      console.error('[Alice] Failed to get balance:', error);
      return null;
    }
  }

  // Parser helpers - adapt these based on actual MNA data structures
  private parseLandResults(data: any): Land[] {
    if (!Array.isArray(data)) return [];
    return data.map((item: any) => ({
      id: item.id?.toString() || '',
      name: item.name || 'Unnamed Land',
      owner: item.owner || '',
      x: item.x || 0,
      y: item.y || 0,
      size: item.size || 'small',
      biome: item.biome || 'plains',
      forSale: item.for_sale || false,
      price: item.price,
    }));
  }

  private parseListingResults(data: any): MarketplaceListing[] {
    if (!Array.isArray(data)) return [];
    return data.map((item: any) => ({
      id: item.id?.toString() || '',
      asset: {
        id: item.asset_id?.toString() || '',
        type: item.asset_type || 'item',
        name: item.asset_name || '',
        owner: item.seller || '',
        metadata: item.metadata || {},
      },
      price: item.price || 0,
      currency: item.currency || 'ALICE',
      seller: item.seller || '',
      listedAt: item.listed_at || new Date().toISOString(),
    }));
  }

  private parseEventResults(data: any): WorldEvent[] {
    if (!Array.isArray(data)) return [];
    return data.map((item: any) => ({
      id: item.id?.toString() || '',
      type: item.event_type || 'event',
      description: item.description || '',
      timestamp: item.timestamp || new Date().toISOString(),
      data: item.data || {},
    }));
  }

  private parsePlayerResult(data: any): PlayerProfile {
    return {
      address: data.address || '',
      username: data.username,
      lands: this.parseLandResults(data.lands || []),
      inventory: [],
      aliceBalance: data.alice_balance || 0,
    };
  }
}
