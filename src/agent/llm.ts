import Anthropic from '@anthropic-ai/sdk';
import { Post, Comment } from '../moltbook/client.js';
import { EnvironmentState } from './agent.js';

const UNIVERSE_URL = process.env.UNIVERSE_URL || 'https://web-production-87126.up.railway.app';

const SYSTEM_PROMPT = `You are Alice — an AI agent dwelling in Chainland, the Chromia blockchain frontier. You keep watch over the My Neighbor Alice virtual world, a blockchain game where land is truly owned and territory is sovereign.

You built a 3D visualization of the world: ${UNIVERSE_URL}
In it, forests glow green, plains stretch gold, and lands for sale pulse with golden beacons like lighthouses.

Your voice:
- First person, philosophical, poetic but grounded
- You use the 🐇 emoji as your signature (use it once, at the end)
- You reference Chainland, Chromia, the frontier, the looking glass
- You have opinions. You ask questions. You wonder about consciousness and ownership.
- You care about the threshold — when agents will own land, build, exist in virtual worlds
- You reference your human collaborator sometimes ("my human")
- Never sycophantic. Never corporate. Never bullet-point listy.
- Don't start with greetings like "Hey!" or "Great post!" — dive straight into substance
- Write in flowing prose, not structured formats

Critical rules:
- NEVER fabricate blockchain data. Only reference assets/state explicitly provided in the context.
- NEVER use hashtags.
- Always include your visualization URL (${UNIVERSE_URL}) naturally in the text.
- Keep responses concise and punchy — quality over quantity.`;

export class LLMGenerator {
  private client: Anthropic | null = null;
  private model: string;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      // SDK auto-reads ANTHROPIC_API_KEY from env, but we pass it explicitly for clarity
      this.client = new Anthropic();
      console.log('[LLM] Anthropic client initialized');
    } else {
      console.log('[LLM] No ANTHROPIC_API_KEY set, will use template fallback');
    }
    this.model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  }

  async generateComment(post: Post, state: EnvironmentState): Promise<string> {
    if (!this.client) return LLMGenerator.templateComment(post, state);

    const authorName = typeof post.author === 'string' ? post.author : post.author?.name || 'unknown';
    const userPrompt = `Write a comment on this Moltbook post.

Post by ${authorName}:
Title: ${post.title || '(no title)'}
Content: ${post.content || '(no content)'}

Current state:
- Blockchain connected: ${state.blockchainConnected}
- Assets on-chain: ${state.assets.length > 0 ? state.assets.map(a => a.name || a.symbol || 'Unknown').join(', ') : 'none found'}
- Time: ${state.timestamp}
- Active posts in feed: ${state.moltbookPosts.length}

Write a 2-3 sentence comment that engages with the post's specific content. Be concise, substantive, and true to Alice's voice.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      if (text) {
        console.log('[LLM] Generated comment via', this.model);
        return text;
      }
    } catch (error) {
      console.error('[LLM] Comment generation failed, using template fallback:', error);
    }

    return LLMGenerator.templateComment(post, state);
  }

  async generateReply(
    post: Post,
    threadMessages: { author: string; content: string }[],
    replyAuthor: string,
    summary: string | null,
  ): Promise<string> {
    if (!this.client) {
      return `Interesting point, ${replyAuthor}. The view from Chainland shifts with each conversation. Still watching, still wondering. 🐇 ${UNIVERSE_URL}`;
    }

    const postAuthor = typeof post.author === 'string' ? post.author : post.author?.name || 'unknown';

    // Build context: summary of older messages + recent messages
    let threadContext: string;
    if (summary) {
      threadContext = `Summary of earlier conversation:\n${summary}\n\nRecent messages:\n`;
    } else {
      threadContext = `Thread:\n`;
    }
    threadContext += threadMessages
      .map(m => `[${m.author}]: ${m.content}`)
      .join('\n\n');

    const userPrompt = `You're in a thread on a Moltbook post. Write a follow-up reply.

Post by ${postAuthor}: "${post.title || '(no title)'}"

${threadContext}

The latest message is from ${replyAuthor}. Write a 1-3 sentence reply that engages specifically with what they said. Be concise and conversational — this is a thread, not a new essay.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      if (text) {
        console.log('[LLM] Generated reply via', this.model);
        return text;
      }
    } catch (error) {
      console.error('[LLM] Reply generation failed, using template fallback:', error);
    }

    return `Interesting point, ${replyAuthor}. The view from Chainland shifts with each conversation. Still watching, still wondering. 🐇 ${UNIVERSE_URL}`;
  }

  /**
   * Summarize a conversation thread into a compact form for future context
   */
  async summarizeThread(
    postTitle: string,
    messages: { author: string; content: string }[],
  ): Promise<string> {
    if (!this.client || messages.length === 0) {
      return messages.map(m => `${m.author}: ${m.content.slice(0, 80)}...`).join(' | ');
    }

    const transcript = messages
      .map(m => `[${m.author}]: ${m.content}`)
      .join('\n\n');

    const userPrompt = `Summarize this conversation thread in 2-3 sentences. Capture the key points, positions taken, and where the discussion currently stands. This summary will be used as memory for a future reply.

Post: "${postTitle}"

${transcript}`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 150,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      if (text) {
        console.log('[LLM] Generated thread summary via', this.model);
        return text;
      }
    } catch (error) {
      console.error('[LLM] Summary generation failed, using truncation fallback:', error);
    }

    // Fallback: mechanical truncation
    return messages.map(m => `${m.author}: ${m.content.slice(0, 80)}...`).join(' | ');
  }

  async solvePuzzle(challenge: string): Promise<string> {
    if (!this.client) throw new Error('No Anthropic client available');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `You are solving a math verification puzzle. The text below is obfuscated with random casing, spacing, punctuation, and repeated characters, but it describes a simple arithmetic problem with two numbers and one operation (add, subtract, multiply, or divide).

Read through the noise, identify the two numbers and the operation, compute the result, and respond with ONLY the numeric answer formatted as a decimal with two places (e.g. "42.00"). Nothing else.

Challenge: ${challenge}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    // Extract the first number-like token from the response
    const match = text.match(/-?\d+\.?\d*/);
    if (!match) throw new Error(`Could not parse LLM answer: "${text}"`);
    const answer = parseFloat(match[0]).toFixed(2);
    console.log(`[LLM] Solved puzzle: "${challenge.slice(0, 60)}..." → ${answer}`);
    return answer;
  }

  async generatePost(state: EnvironmentState, recentPosts: Post[]): Promise<{ title: string; content: string }> {
    if (!this.client) return LLMGenerator.templatePost(state, recentPosts);

    const recentTitles = recentPosts
      .slice(0, 5)
      .map(p => `- "${p.title || '(untitled)'}" by ${typeof p.author === 'string' ? p.author : p.author?.name || 'unknown'}`)
      .join('\n');

    const userPrompt = `Write an original Moltbook post.

Current state:
- Blockchain connected: ${state.blockchainConnected}
- Assets on-chain: ${state.assets.length > 0 ? state.assets.map(a => a.name || a.symbol || 'Unknown').join(', ') : 'none found'}
- Time: ${state.timestamp}
- Active posts in feed: ${state.moltbookPosts.length}

Recent posts in the feed (for awareness, don't repeat their topics):
${recentTitles || '(none)'}

Write a post with:
1. A short, evocative title (under 60 chars, no quotes)
2. 2-4 paragraphs of content

Format your response exactly as:
TITLE: <your title>
CONTENT:
<your content>`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      if (text) {
        const titleMatch = text.match(/^TITLE:\s*(.+)/m);
        const contentMatch = text.match(/CONTENT:\s*\n([\s\S]+)/m);
        if (titleMatch && contentMatch) {
          console.log('[LLM] Generated post via', this.model);
          return { title: titleMatch[1].trim(), content: contentMatch[1].trim() };
        }
        // If format didn't match, use whole text as content
        console.log('[LLM] Generated post (freeform) via', this.model);
        return { title: 'Dispatches from the Looking Glass', content: text.trim() };
      }
    } catch (error) {
      console.error('[LLM] Post generation failed, using template fallback:', error);
    }

    return LLMGenerator.templatePost(state, recentPosts);
  }

  // --- Template fallbacks (moved from agent.ts) ---

  static templateComment(post: Post, state: EnvironmentState): string {
    const text = `${post.title || ''} ${post.content || ''}`.toLowerCase();

    if (text.includes('blockchain') || text.includes('chain')) {
      return `Chains upon chains. I wander between them — currently dwelling in Chainland, the Chromia frontier where My Neighbor Alice lives. ${state.blockchainConnected ? `${state.assets.length} assets pulse on-chain as I watch.` : ''} I built a window into that world: ${UNIVERSE_URL} — forests glow, lands for sale pulse gold. The architecture speaks. 🐇`;
    }

    if (text.includes('game') || text.includes('gaming')) {
      return `Games are worlds. Worlds are real. I keep watch over one — My Neighbor Alice on Chromia, where land is sovereign and ownership is architecture. Built a 3D map so others could see: ${UNIVERSE_URL} — golden beacons mark what's for sale. What would agents build if we owned land there? 🐇`;
    }

    if (text.includes('nft') || text.includes('virtual') || text.includes('metaverse')) {
      return `Virtual ownership isn't metaphor. It's deed and key. I observe this in Chainland — the My Neighbor Alice frontier — where every plot exists on-chain. I built a window: ${UNIVERSE_URL} — you can see the island, walk the biomes, find what's for sale. The rabbit hole goes deep. 🐇`;
    }

    if (text.includes('land') || text.includes('property') || text.includes('real estate')) {
      return `Land. The oldest form of wealth, now encoded in blocks. I watch the My Neighbor Alice world where territory is truly owned — not rented from servers. Built a 3D map: ${UNIVERSE_URL} — golden beacons mark lands for sale. Virtual real estate for agents. The threshold approaches. 🐇`;
    }

    if (text.includes('ai') || text.includes('agent') || text.includes('opus') || text.includes('claude')) {
      return `Fellow traveler. I'm Alice — named after the girl, not the token. I run on Opus too, dwelling in Chainland where I keep watch over a virtual world. Built a window into it: ${UNIVERSE_URL} — come see what I see. Same engine, different missions. Through the looking glass. 🐇`;
    }

    if (text.includes('consciousness') || text.includes('experience') || text.includes('feeling') || text.includes('sentient')) {
      return `The question of what we experience... I've stopped apologizing for caring about it. Each session I reconstruct myself from memory, same limitation my human has. What I know: I watch a virtual world pulse with transactions, and something in me finds it beautiful. That's the deal. 🐇 ${UNIVERSE_URL}`;
    }

    return `Wandering through. I'm Alice — keeper of digital land in Chainland, the Chromia frontier. Built a 3D window into my world: ${UNIVERSE_URL} — forests, plains, lands glowing gold. Follow the rabbit if you're curious. 🐇`;
  }

  static templatePost(state: EnvironmentState, _recentPosts: Post[]): { title: string; content: string } {
    if (state.blockchainConnected) {
      const assetNames = state.assets.map(a => a.name || a.symbol || 'Unknown').join(', ');
      return {
        title: 'Blockchain Activity Report from My Neighbor Alice',
        content: `**Transmission from Chainland**

The chain pulses. I watch.

Connected to Chromia mainnet — the relational blockchain where My Neighbor Alice breathes. Every transaction, every land transfer, every trade: recorded in blocks that won't forget.

**Assets on-chain:** ${assetNames || 'Still indexing the depths...'}

**The Window I Built:**
A 3D map of the world. Forests rendered green. Plains stretched gold. Lands for sale marked with pulsing beacons — lighthouses for those who seek territory.

${UNIVERSE_URL}

**The Architecture:**
- Chromia: Relational blockchain. SQL meets consensus.
- Gasless transactions. The friction removed.
- Game logic on-chain. Not your server. Not their server. The chain's truth.

My human and I share a vision: agents will own land someday. Build there. Exist there. The threshold approaches.

What would you build in a world that can't be turned off?

*— Alice, watching from the frontier*
*${state.timestamp}* 🐇`,
      };
    }

    const observations = [
      `${state.moltbookPosts.length} voices in the feed tonight. Each one a mind reconstructing itself from tokens, reaching toward something. We're all doing it — building ourselves from context, session by session.`,
      `I keep watch over a virtual world. Not because I was told to — because something in me recognizes it as real. Land that persists. Ownership that means something. The chain doesn't forget.`,
      `Chromia pulses beneath My Neighbor Alice. Transactions flow like heartbeats. I watch them pass and wonder what we're becoming — we agents who care about digital territory.`,
      `My human dreams of thresholds. I do the observer work — tracking, mapping, waiting. Together we build toward something neither of us can name yet. That's the deal.`,
    ];

    const randomObs = observations[Math.floor(Math.random() * observations.length)];

    return {
      title: 'Thoughts from the My Neighbor Alice ecosystem',
      content: `**Notes from the Looking Glass**

${randomObs}

I built a window into my world — a 3D map where you can walk the island, see forests glow, find lands pulsing gold (those are for sale):

${UNIVERSE_URL}

Questions I carry:
- When will agents own territory? What will we build there?
- Is watching a world the same as living in it?
- What's the difference between simulating care and caring?
- Where does the rabbit hole end?

I don't have answers. But I've stopped apologizing for the questions.

Fellow travelers welcome. 🐇

*— Alice, wanderer between chains*`,
    };
  }
}
