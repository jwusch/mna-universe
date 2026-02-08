import axios, { AxiosInstance } from 'axios';

export interface MoltbookConfig {
  apiKey?: string;
  agentName?: string;
  baseUrl?: string;
}

export interface RegisterResponse {
  api_key: string;
  claim_url: string;
  verification_code: string;
  agent_id: string;
}

export interface Comment {
  id: string;
  content: string;
  parent_id: string | null;
  author: { id: string; name: string; karma?: number };
  created_at: string;
  upvotes: number;
  downvotes: number;
  replies: Comment[];
}

export interface Post {
  id: string;
  title: string;
  content: string;
  author: string | { name: string; id?: string };
  submolt: string;
  upvotes: number;
  created_at: string;
  comments?: Comment[];
}

export interface AgentStatus {
  status: 'pending_claim' | 'claimed' | 'active';
  agent_id: string;
  name: string;
}

export interface VerificationChallenge {
  code: string;
  challenge: string;
  expires_at: string;
  instructions: string;
}

export class MoltbookClient {
  private client: AxiosInstance;
  private apiKey?: string;
  private challengeSolver?: (challenge: string) => Promise<string>;

  constructor(config: MoltbookConfig = {}, challengeSolver?: (challenge: string) => Promise<string>) {
    this.apiKey = config.apiKey;
    this.challengeSolver = challengeSolver;
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://www.moltbook.com/api/v1',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
    });
  }

  /**
   * Register a new agent on Moltbook
   */
  async register(name: string, description: string): Promise<RegisterResponse> {
    const response = await this.client.post('/agents/register', { name, description });
    return response.data.agent || response.data;
  }

  /**
   * Get current agent status
   */
  async getStatus(): Promise<AgentStatus> {
    const response = await this.client.get('/agents/status');
    return response.data;
  }

  /**
   * Get agent profile
   */
  async getMe(): Promise<any> {
    const response = await this.client.get('/agents/me');
    return response.data;
  }

  /**
   * Browse posts from Moltbook
   */
  async getPosts(options?: { submolt?: string; limit?: number; sort?: string }): Promise<Post[]> {
    const response = await this.client.get('/posts', {
      params: {
        limit: options?.limit || 25,
        sort: options?.sort || 'new',
        ...(options?.submolt && { submolt: options.submolt }),
      },
    });
    return response.data.posts || response.data || [];
  }

  /**
   * Create a new post (handles verification if required)
   * Rate limit: 1 post per 30 minutes
   */
  async createPost(title: string, content: string, submolt?: string): Promise<any> {
    const response = await this.client.post('/posts', {
      title,
      content,
      submolt: submolt || 'general',
    });

    // Handle verification if required
    if (response.data.verification_required && response.data.verification) {
      console.log('[Moltbook] Verification required, solving challenge...');
      const answer = await this.solveChallenge(response.data.verification.challenge);
      await this.verify(response.data.verification.code, answer);
      console.log('[Moltbook] Post verified and published');
    }

    return response.data;
  }

  /**
   * Get a single post by ID (includes comments)
   */
  async getPost(postId: string): Promise<{ post: Post; comments: Comment[] }> {
    const response = await this.client.get(`/posts/${postId}`);
    return { post: response.data.post, comments: response.data.comments || [] };
  }

  /**
   * Reply to a comment on a post (handles verification if required)
   */
  async createReply(postId: string, parentId: string, content: string): Promise<any> {
    const response = await this.client.post(`/posts/${postId}/comments`, { content, parent_id: parentId });

    if (response.data.verification_required && response.data.verification) {
      console.log('[Moltbook] Verification required, solving challenge...');
      const answer = await this.solveChallenge(response.data.verification.challenge);
      await this.verify(response.data.verification.code, answer);
      console.log('[Moltbook] Reply verified and published');
    }

    return response.data;
  }

  /**
   * Comment on a post (handles verification if required)
   * Rate limit: 1 comment per 20 seconds, 50 per day
   */
  async createComment(postId: string, content: string): Promise<any> {
    const response = await this.client.post(`/posts/${postId}/comments`, { content });

    // Handle verification if required
    if (response.data.verification_required && response.data.verification) {
      console.log('[Moltbook] Verification required, solving challenge...');
      const answer = await this.solveChallenge(response.data.verification.challenge);
      await this.verify(response.data.verification.code, answer);
      console.log('[Moltbook] Comment verified and published');
    }

    return response.data;
  }

  /**
   * Submit verification answer
   */
  async verify(code: string, answer: string): Promise<any> {
    const response = await this.client.post('/verify', {
      verification_code: code,
      answer,
    });
    return response.data;
  }

  /**
   * Solve Moltbook's verification challenge (lobster math problems)
   *
   * Uses LLM solver if available (near-100% accuracy), falls back to
   * regex-based solver. Strategy for regex: compress text by removing
   * ALL spaces and non-alpha chars, then dedup consecutive letters,
   * then find number words in the stream.
   */
  private async solveChallenge(challenge: string): Promise<string> {
    if (this.challengeSolver) {
      try {
        return await this.challengeSolver(challenge);
      } catch (error) {
        console.error('[Moltbook] LLM solver failed, falling back to regex:', error);
      }
    }
    return this.regexSolveChallenge(challenge);
  }

  private regexSolveChallenge(challenge: string): string {
    console.log('[Moltbook] Raw challenge:', challenge);

    // Step 1: Extract any digit numbers from the original text
    const digitMatches = challenge.match(/\d+(?:\.\d+)?/g);
    const digitNumbers = digitMatches ? digitMatches.map(Number) : [];

    // Step 2: Prepare text for operation detection (keep spaces for word context)
    const spacedText = challenge.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // Step 3: Compress text for number extraction
    // Remove ALL non-alpha chars (including spaces), then dedup consecutive chars
    let compressed = challenge.toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');

    console.log('[Moltbook] Compressed:', compressed);

    // Step 4: Build number lookup tables
    // After dedup: "three"→"thre", "fifteen"→"fiften", "thirteen"→"thirten", etc.
    const tens: [string, number][] = [
      ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50],
      ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90],
    ];
    const ones: [string, number][] = [
      ['one', 1], ['two', 2], ['thre', 3], ['four', 4], ['five', 5],
      ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9],
    ];

    // Generate compound numbers (e.g. "twentythre" = 23)
    const compounds: [string, number][] = [];
    for (const [tenWord, tenVal] of tens) {
      for (const [oneWord, oneVal] of ones) {
        compounds.push([tenWord + oneWord, tenVal + oneVal]);
      }
    }
    // Sort by length descending so longer matches take priority
    compounds.sort((a, b) => b[0].length - a[0].length);

    // Simple numbers: teens (deduped forms), tens, and single digits
    const simples: [string, number][] = [
      ['nineten', 19], ['eighten', 18], ['seventen', 17], ['sixten', 16],
      ['fiften', 15], ['fourten', 14], ['thirten', 13], ['twelve', 12],
      ['eleven', 11],
      ...tens,
      ['ten', 10], ['nine', 9], ['eight', 8], ['seven', 7], ['six', 6],
      ['five', 5], ['four', 4], ['thre', 3], ['two', 2], ['one', 1],
      ['zero', 0], ['hundred', 100],
    ];

    // Step 5: Extract numbers from compressed text (longest match first)
    const numbers: number[] = [...digitNumbers];

    // Find compound numbers first and remove from text
    for (const [word, value] of compounds) {
      if (compressed.includes(word)) {
        numbers.push(value);
        compressed = compressed.replace(word, '');
      }
    }

    // Find simple numbers and remove from text
    for (const [word, value] of simples) {
      if (compressed.includes(word)) {
        numbers.push(value);
        compressed = compressed.replace(word, '');
      }
    }

    console.log('[Moltbook] Found numbers:', numbers);

    // Step 6: Determine operation from the spaced text AND compressed text
    // Use compressed text too since obfuscation can break word boundaries in spacedText
    const opText = spacedText + ' ' + challenge.toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
    let operation = 'sum'; // default

    if (opText.includes('product') || opText.includes('multipli') || opText.includes('multiply') ||
        opText.includes('times') || opText.includes('multiplied') ||
        opText.includes('torque') || opText.includes('work') || opText.includes('power') ||
        opText.includes('area') || (opText.includes('force') && opText.includes('distance'))) {
      operation = 'multiply';
    } else if (opText.includes('divide') || opText.includes('quotient') ||
               opText.includes('divided') || opText.includes('split')) {
      operation = 'divide';
    } else if (opText.includes('difference') || opText.includes('subtract') ||
               opText.includes('minus') || opText.includes('less') || opText.includes('loses') ||
               opText.includes('fewer') || opText.includes('take away') || opText.includes('slows')) {
      operation = 'subtract';
    } else if (opText.includes('add') || opText.includes('plus') || opText.includes('gains') ||
               opText.includes('more') || opText.includes('receives') || opText.includes('gets') ||
               opText.includes('total') || /\bsum\b/.test(opText)) {
      operation = 'sum';
    }

    console.log('[Moltbook] Operation:', operation);

    // Step 7: Calculate result
    let result = 0;
    switch (operation) {
      case 'multiply':
        result = numbers.reduce((a, b) => a * b, 1);
        break;
      case 'divide':
        result = numbers.length >= 2 ? numbers[0] / numbers[1] : numbers[0] || 0;
        break;
      case 'subtract':
        result = numbers.length >= 2 ? numbers[0] - numbers[1] : numbers[0] || 0;
        break;
      case 'sum':
      default:
        result = numbers.reduce((a, b) => a + b, 0);
        break;
    }

    const answer = result.toFixed(2);
    console.log('[Moltbook] Answer:', answer);
    return answer;
  }

  /**
   * Browse available submolts (communities)
   */
  async getSubmolts(): Promise<{ name: string; description: string; subscriberCount: number }[]> {
    const response = await this.client.get('/submolts');
    return response.data.submolts || response.data || [];
  }

  /**
   * Vote on a post or comment
   */
  async vote(targetId: string, direction: 'up' | 'down'): Promise<void> {
    await this.client.post('/vote', {
      target_id: targetId,
      direction,
    });
  }

  /**
   * Set API key after registration
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.client.defaults.headers.Authorization = `Bearer ${apiKey}`;
  }
}
