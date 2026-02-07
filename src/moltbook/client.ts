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

export interface Post {
  id: string;
  title: string;
  content: string;
  author: string | { name: string };
  submolt: string;
  upvotes: number;
  created_at: string;
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

  constructor(config: MoltbookConfig = {}) {
    this.apiKey = config.apiKey;
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
      const answer = this.solveChallenge(response.data.verification.challenge);
      await this.verify(response.data.verification.code, answer);
      console.log('[Moltbook] Post verified and published');
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
      const answer = this.solveChallenge(response.data.verification.challenge);
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
   */
  private solveChallenge(challenge: string): string {
    // Clean and normalize the obfuscated text
    let cleaned = challenge
      .replace(/[^a-zA-Z0-9\s.,?!-]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/-/g, ' ')
      .toLowerCase()
      .trim();

    console.log('[Moltbook] Challenge:', cleaned);

    // Compound number patterns (check these FIRST - longer matches)
    const compoundNumbers: [RegExp, number][] = [
      [/twenty\s*three/g, 23], [/twenty\s*four/g, 24], [/twenty\s*five/g, 25],
      [/twenty\s*six/g, 26], [/twenty\s*seven/g, 27], [/twenty\s*eight/g, 28],
      [/twenty\s*nine/g, 29], [/twenty\s*one/g, 21], [/twenty\s*two/g, 22],
      [/thirty\s*one/g, 31], [/thirty\s*two/g, 32], [/thirty\s*three/g, 33],
      [/thirty\s*four/g, 34], [/thirty\s*five/g, 35], [/thirty\s*six/g, 36],
      [/thirty\s*seven/g, 37], [/thirty\s*eight/g, 38], [/thirty\s*nine/g, 39],
      [/forty\s*one/g, 41], [/forty\s*two/g, 42], [/forty\s*three/g, 43],
      [/forty\s*four/g, 44], [/forty\s*five/g, 45], [/forty\s*six/g, 46],
      [/forty\s*seven/g, 47], [/forty\s*eight/g, 48], [/forty\s*nine/g, 49],
      [/fifty\s*one/g, 51], [/fifty\s*two/g, 52], [/fifty\s*three/g, 53],
    ];

    const numbers: number[] = [];

    // Find compound numbers first and remove them from text
    for (const [pattern, value] of compoundNumbers) {
      if (pattern.test(cleaned)) {
        numbers.push(value);
        cleaned = cleaned.replace(pattern, ' ');
      }
    }

    // Simple number words
    const simpleNumbers: Record<string, number> = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
      thirty: 30, forty: 40, fifty: 50, hundred: 100,
    };

    // Find remaining simple numbers
    for (const [word, value] of Object.entries(simpleNumbers)) {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      if (regex.test(cleaned)) {
        numbers.push(value);
      }
    }

    // Also look for numeric digits
    const digitMatches = cleaned.match(/\b\d+\b/g);
    if (digitMatches) {
      numbers.push(...digitMatches.map(Number));
    }

    console.log('[Moltbook] Found numbers:', numbers);

    // Determine operation from keywords
    // IMPORTANT: Check multiply/divide FIRST to avoid false positives from words like "lobster sum"
    let result = 0;
    let operation = 'sum'; // default

    if (cleaned.includes('product') || cleaned.includes('multiply') ||
        cleaned.includes('times') || cleaned.includes('multiplied')) {
      operation = 'multiply';
    } else if (cleaned.includes('divide') || cleaned.includes('quotient') ||
               cleaned.includes('divided') || cleaned.includes('split')) {
      operation = 'divide';
    } else if (cleaned.includes('difference') || cleaned.includes('subtract') ||
               cleaned.includes('minus') || cleaned.includes('less') || cleaned.includes('loses') ||
               cleaned.includes('fewer') || cleaned.includes('take away')) {
      operation = 'subtract';
    } else if (cleaned.includes('add') || cleaned.includes('plus') || cleaned.includes('gains') ||
               cleaned.includes('more') || cleaned.includes('receives') || cleaned.includes('gets') ||
               cleaned.includes('total') || /\bsum\b/.test(cleaned)) {
      // Use word boundary for 'sum' to avoid matching "lobs t ers um"
      operation = 'sum';
    }

    console.log('[Moltbook] Operation detected:', operation);

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
