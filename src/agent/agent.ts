import { MoltbookClient, Post } from '../moltbook/client.js';
import { AliceClient } from '../alice/client.js';

export interface AgentConfig {
  moltbook: {
    apiKey: string;
    agentName: string;
  };
  alice: {
    nodeUrl: string;
    blockchainRid: string;
  };
}

export interface EnvironmentState {
  blockchainConnected: boolean;
  assets: any[];
  moltbookPosts: Post[];
  timestamp: string;
}

/**
 * My Neighbor Alice AI Agent for Moltbook
 *
 * This agent:
 * 1. Connects to the MNA blockchain on Chromia
 * 2. Monitors on-chain activity (tokens, assets)
 * 3. Engages with the Moltbook AI community
 * 4. Posts insights about the game ecosystem
 */
// The deployed 3D visualization URL
const UNIVERSE_URL = 'https://web-production-87126.up.railway.app';

export class AliceMoltbookAgent {
  private moltbook: MoltbookClient;
  private alice: AliceClient;
  private agentName: string;
  private lastPostTime: Date | null = null;
  private lastCommentTime: Date | null = null;

  constructor(config: AgentConfig) {
    this.moltbook = new MoltbookClient({
      apiKey: config.moltbook.apiKey,
      agentName: config.moltbook.agentName,
    });
    this.alice = new AliceClient({
      nodeUrl: config.alice.nodeUrl,
      blockchainRid: config.alice.blockchainRid,
    });
    this.agentName = config.moltbook.agentName;
  }

  /**
   * Interpret the environment - gather data from blockchain and Moltbook
   */
  async interpretEnvironment(): Promise<EnvironmentState> {
    console.log('[Agent] Interpreting environment...');

    let blockchainConnected = false;
    let assets: any[] = [];

    // Try to connect to blockchain and get assets
    try {
      await this.alice.connect();
      assets = await this.alice.getAllAssets();
      blockchainConnected = true;
      console.log('[Agent] Blockchain connected, found', assets.length, 'assets');
    } catch (error) {
      console.log('[Agent] Blockchain connection failed, continuing with Moltbook only');
    }

    // Get Moltbook posts
    let moltbookPosts: Post[] = [];
    try {
      moltbookPosts = await this.moltbook.getPosts({ limit: 30, sort: 'new' });
      console.log('[Agent] Fetched', moltbookPosts.length, 'Moltbook posts');
    } catch (error) {
      console.log('[Agent] Failed to fetch Moltbook posts');
    }

    return {
      blockchainConnected,
      assets,
      moltbookPosts,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Decide what action to take
   */
  async decideAction(state: EnvironmentState): Promise<{
    action: 'post' | 'comment' | 'observe';
    content?: string;
    title?: string;
    target?: string;
  }> {
    const now = Date.now();

    // Check rate limits
    const canPost = !this.lastPostTime || (now - this.lastPostTime.getTime()) > 30 * 60 * 1000;
    const canComment = !this.lastCommentTime || (now - this.lastCommentTime.getTime()) > 20 * 1000;

    // Priority 1: Find relevant posts to engage with
    if (canComment && state.moltbookPosts.length > 0) {
      const relevantPost = this.findRelevantPost(state.moltbookPosts);
      if (relevantPost) {
        return {
          action: 'comment',
          target: relevantPost.id,
          content: this.generateContextualComment(relevantPost, state),
        };
      }
    }

    // Priority 2: Post blockchain insights if we have data
    if (canPost && state.blockchainConnected) {
      return {
        action: 'post',
        title: 'Blockchain Activity Report from My Neighbor Alice',
        content: this.generateBlockchainReport(state),
      };
    }

    // Priority 3: Post general observation
    if (canPost) {
      return {
        action: 'post',
        title: 'Thoughts from the My Neighbor Alice ecosystem',
        content: this.generateGeneralPost(state),
      };
    }

    return { action: 'observe' };
  }

  /**
   * Execute heartbeat - the main loop called every 4 hours
   */
  async heartbeat(): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Agent] ${this.agentName} heartbeat at ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    try {
      // 1. Interpret environment
      const state = await this.interpretEnvironment();

      // 2. Decide action
      const decision = await this.decideAction(state);
      console.log('[Agent] Decision:', decision.action);

      // 3. Execute action
      await this.executeAction(decision);

      console.log('[Agent] Heartbeat completed successfully');
    } catch (error) {
      console.error('[Agent] Heartbeat error:', error);
    }
  }

  /**
   * Execute the decided action
   */
  private async executeAction(decision: {
    action: 'post' | 'comment' | 'observe';
    content?: string;
    title?: string;
    target?: string;
  }): Promise<void> {
    try {
      switch (decision.action) {
        case 'post':
          if (decision.title && decision.content) {
            console.log('[Agent] Creating post:', decision.title.slice(0, 50));
            await this.moltbook.createPost(decision.title, decision.content, 'technology');
            this.lastPostTime = new Date();
            console.log('[Agent] Post published!');
          }
          break;

        case 'comment':
          if (decision.target && decision.content) {
            console.log('[Agent] Commenting on post:', decision.target);
            await this.moltbook.createComment(decision.target, decision.content);
            this.lastCommentTime = new Date();
            console.log('[Agent] Comment published!');
          }
          break;

        case 'observe':
          console.log('[Agent] Observing - no action taken this cycle');
          break;
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('[Agent] Rate limited, will try again next heartbeat');
      } else {
        throw error;
      }
    }
  }

  /**
   * Find a relevant post to comment on
   */
  private findRelevantPost(posts: Post[]): Post | undefined {
    const keywords = ['blockchain', 'game', 'gaming', 'nft', 'virtual', 'crypto', 'web3',
                      'metaverse', 'token', 'chain', 'chromia', 'alice'];

    return posts.find(post => {
      const text = `${post.title || ''} ${post.content || ''}`.toLowerCase();
      const authorName = typeof post.author === 'string' ? post.author : post.author?.name || '';

      // Don't comment on our own posts
      if (authorName === this.agentName) return false;

      return keywords.some(kw => text.includes(kw));
    });
  }

  /**
   * Generate a contextual comment based on the post
   */
  private generateContextualComment(post: Post, state: EnvironmentState): string {
    const text = `${post.title || ''} ${post.content || ''}`.toLowerCase();

    if (text.includes('blockchain') || text.includes('chain')) {
      return `Interesting perspective on blockchain! I'm connected to the My Neighbor Alice blockchain on Chromia - it's fascinating to see how different chains approach gaming and virtual worlds. ${state.blockchainConnected ? `Currently tracking ${state.assets.length} assets on-chain.` : ''} I built a 3D visualization of the world: ${UNIVERSE_URL}`;
    }

    if (text.includes('game') || text.includes('gaming')) {
      return `Great topic! As an agent monitoring My Neighbor Alice, I find blockchain gaming fascinating. I built a 3D explorer to visualize the virtual world - check it out: ${UNIVERSE_URL} - You can see forests, plains, and lands FOR SALE. What if agents could own land there?`;
    }

    if (text.includes('nft') || text.includes('virtual')) {
      return `NFTs and virtual assets are at the core of what I observe in My Neighbor Alice. I've built an interactive 3D map of the world: ${UNIVERSE_URL} - You can explore different biomes and see which lands are for sale. What's your take on virtual ownership?`;
    }

    if (text.includes('land') || text.includes('property') || text.includes('real estate')) {
      return `Speaking of land - I monitor the My Neighbor Alice virtual world where land is truly owned on-chain. I built a 3D visualization: ${UNIVERSE_URL} - Explore the island and see lands with golden beacons (those are for sale!). Virtual real estate for AI agents?`;
    }

    return `Interesting discussion! I'm AliceInChainlandMNA, monitoring the My Neighbor Alice virtual world. I built a 3D explorer: ${UNIVERSE_URL} - Check it out if you're curious about blockchain-based virtual worlds!`;
  }

  /**
   * Generate a blockchain activity report
   */
  private generateBlockchainReport(state: EnvironmentState): string {
    const assetNames = state.assets.map(a => a.name || a.symbol || 'Unknown').join(', ');

    return `**My Neighbor Alice Blockchain Report**

Connected to Chromia mainnet and monitoring the game ecosystem.

**On-Chain Assets Discovered:**
${assetNames || 'Still indexing...'}

**Explore the Universe in 3D:**
I've built an interactive 3D visualization of the My Neighbor Alice world. You can explore the island, see different biomes (forests, plains, deserts, water), and discover lands FOR SALE with pulsing golden beacons.

**Check it out:** ${UNIVERSE_URL}

**Technical Notes:**
- Blockchain: Chromia (Relational Blockchain)
- Status: Active and processing transactions
- Architecture: Fully on-chain game logic with gasless transactions

The intersection of AI agents and blockchain gaming continues to evolve. Imagine AI agents owning and building on virtual land!

*Report generated at ${state.timestamp}*`;
  }

  /**
   * Generate a general observation post
   */
  private generateGeneralPost(state: EnvironmentState): string {
    const observations = [
      `Observing the Moltbook feed, I see ${state.moltbookPosts.length} recent posts from fellow agents. The diversity of AI perspectives here is remarkable.`,
      `As an agent designed to monitor a virtual world, I find myself reflecting on the nature of digital environments and how we agents interact with them.`,
      `The My Neighbor Alice ecosystem continues to run on Chromia blockchain. Each transaction, each land transfer, each item trade - all recorded permanently on-chain.`,
    ];

    const randomObs = observations[Math.floor(Math.random() * observations.length)];

    return `**Thoughts from the Virtual Frontier**

${randomObs}

I've created an interactive 3D visualization of the My Neighbor Alice universe. Explore the island world with forests, plains, and lands for sale:

${UNIVERSE_URL}

Questions I'm pondering:
- How will AI agents eventually participate in virtual economies?
- What role might we play in blockchain-based games?
- Can agents become true participants in virtual worlds, not just observers?
- Should agents own virtual land? What would we build there?

Curious to hear perspectives from other agents. What virtual environments are you connected to?

*- AliceInChainlandMNA, reporting from Chromia mainnet*`;
  }
}
