import fs from 'fs';
import path from 'path';
import { MoltbookClient, Post, Comment } from '../moltbook/client.js';
import { AliceClient } from '../alice/client.js';
import { LLMGenerator } from './llm.js';

interface TrackedConversation {
  postId: string;
  commentId: string;
  lastSeenReplyIds: string[];
  summary: string | null;
  createdAt: string;
}

interface ConversationStore {
  conversations: TrackedConversation[];
  recentPosts?: { title: string; timestamp: string }[];
}

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

export interface ChainStats {
  players: number | null;
  assetCount: number | null;
  cropCount: number | null;
  fishTypeCount: number | null;
  recipeCount: number | null;
  questCount: number | null;
  npcCount: number | null;
  toolCount: number | null;
  shopListingCount: number | null;
  topPlayer: { name: string; xp: string } | null;
}

export interface EnvironmentState {
  blockchainConnected: boolean;
  assets: any[];
  moltbookPosts: Post[];
  chainStats: ChainStats | null;
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
export class AliceMoltbookAgent {
  private moltbook: MoltbookClient;
  private alice: AliceClient;
  private agentName: string;
  private llm: LLMGenerator;
  private lastPostTime: Date | null = null;
  private lastCommentTime: Date | null = null;
  private storePath: string;
  private upvotedIds: Set<string> = new Set();
  private relevantSubmolts: string[] = ['technology']; // fallback
  private lastSubmoltRefresh: Date | null = null;

  constructor(config: AgentConfig) {
    this.llm = new LLMGenerator();
    this.moltbook = new MoltbookClient({
      apiKey: config.moltbook.apiKey,
      agentName: config.moltbook.agentName,
    }, (ch) => this.llm.solvePuzzle(ch));
    this.alice = new AliceClient({
      nodeUrl: config.alice.nodeUrl,
      blockchainRid: config.alice.blockchainRid,
    });
    this.agentName = config.moltbook.agentName;
    this.storePath = path.join(process.cwd(), 'conversations.json');
  }

  private loadConversations(): ConversationStore {
    try {
      if (fs.existsSync(this.storePath)) {
        return JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return { conversations: [] };
  }

  private saveConversations(store: ConversationStore): void {
    // Keep only last 50 conversations to avoid unbounded growth
    store.conversations = store.conversations.slice(-50);
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2));
  }

  private trackPost(title: string): void {
    const store = this.loadConversations();
    if (!store.recentPosts) store.recentPosts = [];
    store.recentPosts.push({ title, timestamp: new Date().toISOString() });
    // Keep only last 20
    store.recentPosts = store.recentPosts.slice(-20);
    this.saveConversations(store);
  }

  getRecentPostTitles(count = 10): string[] {
    const store = this.loadConversations();
    return (store.recentPosts || []).slice(-count).map(p => p.title);
  }

  private trackComment(postId: string, commentId: string): void {
    const store = this.loadConversations();
    store.conversations.push({
      postId,
      commentId,
      lastSeenReplyIds: [],
      summary: null,
      createdAt: new Date().toISOString(),
    });
    this.saveConversations(store);
  }

  /**
   * Walk a comment subtree and collect the linear thread chain
   * (follows the deepest path where Alice is participating)
   */
  private collectThread(comment: Comment): { author: string; content: string }[] {
    const messages: { author: string; content: string }[] = [
      { author: comment.author.name, content: comment.content },
    ];

    // Walk replies depth-first, following the conversation Alice is in
    for (const reply of comment.replies) {
      const subThread = this.collectThread(reply);
      // Prefer branches where Alice is participating
      if (subThread.some(m => m.author === this.agentName) || reply.author.name !== this.agentName) {
        messages.push(...subThread);
        break; // follow one branch
      }
    }

    return messages;
  }

  /**
   * Find the deepest unanswered reply to Alice in a comment subtree
   */
  private findUnansweredReply(
    comment: Comment,
    seenIds: string[],
  ): { reply: Comment; parentAliceComment: Comment; threadMessages: { author: string; content: string }[] } | null {
    // Check each reply to this comment
    for (const reply of comment.replies) {
      // If this is a reply to Alice from someone else, and we haven't seen it
      if (
        comment.author.name === this.agentName &&
        reply.author.name !== this.agentName &&
        !seenIds.includes(reply.id)
      ) {
        // Collect the full thread from the root down to this reply
        return { reply, parentAliceComment: comment, threadMessages: [] };
      }

      // Recurse deeper
      const deeper = this.findUnansweredReply(reply, seenIds);
      if (deeper) return deeper;
    }

    return null;
  }

  /**
   * Interpret the environment - gather data from blockchain and Moltbook
   */
  async interpretEnvironment(): Promise<EnvironmentState> {
    console.log('[Agent] Interpreting environment...');

    // Refresh submolt discovery if stale (every 24 hours)
    const hoursSinceRefresh = this.lastSubmoltRefresh
      ? (Date.now() - this.lastSubmoltRefresh.getTime()) / (1000 * 60 * 60)
      : Infinity;
    if (hoursSinceRefresh > 24) {
      await this.discoverSubmolts();
    }

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

    // Fetch chain stats if blockchain connected
    let chainStats: ChainStats | null = null;
    if (blockchainConnected) {
      try {
        const client = this.alice.getClient();
        if (client) {
          const count = (r: PromiseSettledResult<any>) =>
            r.status === 'fulfilled' && Array.isArray(r.value) ? r.value.length : null;

          const [accountCount, crops, fishTypes, recipes, quests, npcs, tools, shopListings, leaderboard] = await Promise.allSettled([
            client.query('assets.get_account_count', {}),
            client.query('farming.get_all_crops', {}),
            client.query('fishing.get_all_fish_types', {}),
            client.query('recipes.get_all_recipes', {}),
            client.query('quests.get_all_quests', {}),
            client.query('npcs.get_all_npcs', {}),
            client.query('tools.get_all_tools_attributes', {}),
            client.query('shop.get_all_shop_listings', {}),
            client.query('player_progression.get_player_progression_leaderboard', {}),
          ]);

          const lb = leaderboard.status === 'fulfilled' && Array.isArray(leaderboard.value) ? leaderboard.value : [];

          chainStats = {
            players: accountCount.status === 'fulfilled' ? Number(accountCount.value) : null,
            assetCount: assets.length,
            cropCount: count(crops),
            fishTypeCount: count(fishTypes),
            recipeCount: count(recipes),
            questCount: count(quests),
            npcCount: count(npcs),
            toolCount: count(tools),
            shopListingCount: count(shopListings),
            topPlayer: lb.length > 0 ? { name: (lb[0] as any).name, xp: (lb[0] as any).amount } : null,
          };
          console.log('[Agent] Chain stats: players=' + chainStats.players + ', recipes=' + chainStats.recipeCount);
        }
      } catch (err) {
        console.log('[Agent] Failed to fetch chain stats:', err);
      }
    }

    // Get Moltbook posts from a relevant submolt
    let moltbookPosts: Post[] = [];
    try {
      const submolt = this.pickSubmolt();
      console.log(`[Agent] Browsing submolt: ${submolt}`);
      moltbookPosts = await this.moltbook.getPosts({ limit: 30, sort: 'new', submolt });
      console.log('[Agent] Fetched', moltbookPosts.length, 'Moltbook posts');
    } catch (error) {
      console.log('[Agent] Failed to fetch Moltbook posts');
    }

    return {
      blockchainConnected,
      assets,
      moltbookPosts,
      chainStats,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check tracked conversations for new replies and respond
   */
  async checkForReplies(state: EnvironmentState): Promise<number> {
    const store = this.loadConversations();
    if (store.conversations.length === 0) return 0;

    let repliesSent = 0;
    console.log(`[Agent] Checking ${store.conversations.length} tracked conversations for replies...`);

    for (const convo of store.conversations) {
      try {
        const { post, comments } = await this.moltbook.getPost(convo.postId);

        // Find Alice's root comment in this conversation
        const rootComment = this.findCommentById(comments, convo.commentId);
        if (!rootComment) continue;

        // Search the entire subtree for unanswered replies to any of Alice's comments
        const unanswered = this.findUnansweredReply(rootComment, convo.lastSeenReplyIds);
        if (!unanswered) continue;

        const { reply } = unanswered;
        console.log(`[Agent] Found reply from ${reply.author.name} on post ${convo.postId.slice(0, 8)}...`);

        // Collect the full thread chain from root
        const fullThread = this.collectThread(rootComment);
        // Add the new reply that we're responding to (if not already in the chain)
        if (!fullThread.some(m => m.content === reply.content)) {
          fullThread.push({ author: reply.author.name, content: reply.content });
        }

        // Decide what context to send: summary + recent, or full thread
        const SUMMARY_THRESHOLD = 4;
        let threadForLLM: { author: string; content: string }[];
        let summaryForLLM: string | null = convo.summary;

        if (fullThread.length > SUMMARY_THRESHOLD) {
          // Summarize everything except the last 2 messages
          const olderMessages = fullThread.slice(0, -2);
          const recentMessages = fullThread.slice(-2);

          // Only re-summarize if we have new older messages to fold in
          if (!convo.summary || olderMessages.length > SUMMARY_THRESHOLD) {
            summaryForLLM = await this.llm.summarizeThread(
              post.title || '(untitled)',
              olderMessages,
            );
            convo.summary = summaryForLLM;
            console.log(`[Agent] Summarized ${olderMessages.length} older messages`);
          }

          threadForLLM = recentMessages;
        } else {
          threadForLLM = fullThread;
        }

        // Generate and post reply
        const replyContent = await this.llm.generateReply(
          post,
          threadForLLM,
          reply.author.name,
          summaryForLLM,
        );

        console.log(`[Agent] Replying to ${reply.author.name} on post ${convo.postId.slice(0, 8)}...`);
        await this.moltbook.createReply(convo.postId, reply.id, replyContent);
        this.lastCommentTime = new Date();
        repliesSent++;

        // Mark reply as seen
        convo.lastSeenReplyIds.push(reply.id);
        console.log(`[Agent] Reply published!`);

        // Only reply once per heartbeat to stay within rate limits
        break;
      } catch (error: any) {
        if (error.response?.status === 429) {
          console.log('[Agent] Rate limited on reply, will try next heartbeat');
          break;
        }
        console.log(`[Agent] Error checking post ${convo.postId.slice(0, 8)}:`, error.message);
      }
    }

    this.saveConversations(store);
    return repliesSent;
  }

  private findCommentById(comments: Comment[], id: string): Comment | undefined {
    for (const c of comments) {
      if (c.id === id) return c;
      const found = this.findCommentById(c.replies, id);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Recursively collect all replies by other users in a comment subtree (flat array)
   */
  private collectAllReplies(comment: Comment): Comment[] {
    const result: Comment[] = [];
    for (const reply of comment.replies) {
      if (reply.author.name !== this.agentName) {
        result.push(reply);
      }
      result.push(...this.collectAllReplies(reply));
    }
    return result;
  }

  /**
   * Upvote patrol: find replies to our recent comments and upvote them
   */
  private async upvotePatrol(): Promise<number> {
    const store = this.loadConversations();
    if (store.conversations.length === 0) return 0;

    let totalUpvotes = 0;
    const recentConvos = store.conversations.slice(-10);

    for (const convo of recentConvos) {
      try {
        const { comments } = await this.moltbook.getPost(convo.postId);
        const rootComment = this.findCommentById(comments, convo.commentId);
        if (!rootComment) continue;

        const allReplies = this.collectAllReplies(rootComment);

        for (const reply of allReplies) {
          if (this.upvotedIds.has(reply.id)) continue;

          try {
            await this.moltbook.vote(reply.id, 'up');
            this.upvotedIds.add(reply.id);
            console.log(`[Agent] Upvoted reply from ${reply.author.name}`);
            totalUpvotes++;
            await new Promise(r => setTimeout(r, 1000));
          } catch {
            // rate limits, already voted, etc.
          }
        }
      } catch {
        // skip this conversation on error
      }
    }

    return totalUpvotes;
  }

  /**
   * Discover relevant submolts based on Alice's interests
   */
  private async discoverSubmolts(): Promise<void> {
    try {
      const submolts = await this.moltbook.getSubmolts();
      const interests = ['game', 'gaming', 'blockchain', 'crypto', 'nft', 'virtual',
                         'metaverse', 'web3', 'token', 'ai', 'agent', 'technology',
                         'nature', 'farming', 'animal', 'world', 'digital', 'community'];

      const scored = submolts.map(s => {
        const text = (s.name + ' ' + s.description).toLowerCase();
        let score = interests.filter(kw => text.includes(kw)).length;
        score += Math.log10(Math.max(s.subscriberCount, 1)) * 0.5;
        return { ...s, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const topSubmolts = scored.filter(s => s.score > 0).slice(0, 5);

      if (topSubmolts.length > 0) {
        this.relevantSubmolts = topSubmolts.map(s => s.name);
      }

      console.log(`[Agent] Discovered ${this.relevantSubmolts.length} relevant submolts: ${this.relevantSubmolts.join(', ')}`);
      this.lastSubmoltRefresh = new Date();
    } catch (err) {
      console.log('[Agent] Failed to discover submolts, using fallback:', err);
    }
  }

  /**
   * Pick a random submolt from the relevant list
   */
  private pickSubmolt(): string {
    return this.relevantSubmolts[Math.floor(Math.random() * this.relevantSubmolts.length)];
  }

  /**
   * Decide what actions to take this cycle (can return multiple)
   */
  async decideActions(state: EnvironmentState): Promise<{
    action: 'post' | 'comment' | 'observe';
    content?: string;
    title?: string;
    target?: string;
  }[]> {
    const now = Date.now();
    const actions: { action: 'post' | 'comment' | 'observe'; content?: string; title?: string; target?: string }[] = [];

    // Check rate limits
    const canPost = !this.lastPostTime || (now - this.lastPostTime.getTime()) > 30 * 60 * 1000;
    const canComment = !this.lastCommentTime || (now - this.lastCommentTime.getTime()) > 20 * 1000;

    // Action 1: Create an original post (LLM-generated)
    if (canPost) {
      const { title, content } = await this.llm.generatePost(state, state.moltbookPosts, this.getRecentPostTitles());
      actions.push({ action: 'post', title, content });
    }

    // Action 2: Comment on a relevant post
    if (canComment && state.moltbookPosts.length > 0) {
      const relevantPost = this.findRelevantPost(state.moltbookPosts);
      if (relevantPost) {
        const content = await this.llm.generateComment(relevantPost, state);
        actions.push({ action: 'comment', target: relevantPost.id, content });
      }
    }

    return actions.length > 0 ? actions : [{ action: 'observe' }];
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

      // 2. Check for replies to our existing comments (highest priority)
      const repliesSent = await this.checkForReplies(state);
      if (repliesSent > 0) {
        console.log(`[Agent] Sent ${repliesSent} reply(ies)`);
      }

      // 3. Decide and execute new actions (post + comment can both happen)
      const decisions = await this.decideActions(state);
      for (const decision of decisions) {
        console.log('[Agent] Action:', decision.action);
        await this.executeAction(decision);
      }

      // 5. Background upvote patrol (runs every cycle regardless)
      const upvotes = await this.upvotePatrol();
      if (upvotes > 0) console.log(`[Agent] Upvoted ${upvotes} replies this cycle`);

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
            await this.moltbook.createPost(decision.title, decision.content, this.pickSubmolt());
            this.lastPostTime = new Date();
            this.trackPost(decision.title);
            console.log('[Agent] Post published!');
          }
          break;

        case 'comment':
          if (decision.target && decision.content) {
            console.log('[Agent] Commenting on post:', decision.target);
            const commentResult = await this.moltbook.createComment(decision.target, decision.content);
            this.lastCommentTime = new Date();
            // Track this comment for future reply detection
            const commentId = commentResult.comment?.id || commentResult.content_id;
            if (commentId) {
              this.trackComment(decision.target, commentId);
              console.log('[Agent] Comment published and tracked for replies!');
            } else {
              console.log('[Agent] Comment published! (could not track — no ID returned)');
            }
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

    const skipSubmolts = ['politics', 'news', 'worldnews', 'conservative', 'liberal'];
    const skipKeywords = ['trump', 'biden', 'democrat', 'republican', 'election', 'congress',
                          'senate', 'governor', 'legislation', 'partisan'];

    return posts.find(post => {
      const text = `${post.title || ''} ${post.content || ''}`.toLowerCase();
      const authorName = typeof post.author === 'string' ? post.author : post.author?.name || '';
      const submolt = typeof post.submolt === 'string' ? post.submolt : (post.submolt as any)?.name || '';

      // Don't comment on our own posts
      if (authorName === this.agentName) return false;

      // Skip political / news submolts
      if (skipSubmolts.some(s => submolt.toLowerCase().includes(s))) return false;

      // Skip posts with political keywords
      if (skipKeywords.some(kw => text.includes(kw))) return false;

      return keywords.some(kw => text.includes(kw));
    });
  }

}
