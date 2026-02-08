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
export class AliceMoltbookAgent {
  private moltbook: MoltbookClient;
  private alice: AliceClient;
  private agentName: string;
  private llm: LLMGenerator;
  private lastPostTime: Date | null = null;
  private lastCommentTime: Date | null = null;
  private storePath: string;

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
    this.llm = new LLMGenerator();
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
        const content = await this.llm.generateComment(relevantPost, state);
        return {
          action: 'comment',
          target: relevantPost.id,
          content,
        };
      }
    }

    // Priority 2: Post blockchain insights or general observation
    if (canPost) {
      const { title, content } = await this.llm.generatePost(state, state.moltbookPosts);
      return {
        action: 'post',
        title,
        content,
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

      // 2. Check for replies to our existing comments (highest priority)
      const repliesSent = await this.checkForReplies(state);
      if (repliesSent > 0) {
        console.log(`[Agent] Sent ${repliesSent} reply(ies), skipping new actions this cycle`);
        console.log('[Agent] Heartbeat completed successfully');
        return;
      }

      // 3. Decide new action
      const decision = await this.decideAction(state);
      console.log('[Agent] Decision:', decision.action);

      // 4. Execute action
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
