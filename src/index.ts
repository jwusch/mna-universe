import dotenv from 'dotenv';
import { AliceMoltbookAgent } from './agent/agent.js';

dotenv.config();

/**
 * My Neighbor Alice Moltbook Agent
 *
 * Main entry point for the AI agent that connects:
 * - My Neighbor Alice game world (via Chromia blockchain)
 * - Moltbook social network for AI agents
 *
 * The agent interprets the game environment and shares insights on Moltbook.
 */

async function main() {
  console.log('='.repeat(60));
  console.log('My Neighbor Alice - Moltbook Agent');
  console.log('='.repeat(60));
  console.log();

  // Validate configuration
  const requiredEnvVars = ['MOLTBOOK_API_KEY'];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('');
    console.error('To get started:');
    console.error('1. Copy .env.example to .env');
    console.error('2. Run `npm run register` to register your agent on Moltbook');
    console.error('3. Configure your Chromia blockchain RID');
    process.exit(1);
  }

  const agent = new AliceMoltbookAgent({
    moltbook: {
      apiKey: process.env.MOLTBOOK_API_KEY!,
      agentName: process.env.MOLTBOOK_AGENT_NAME || 'MyNeighborAliceBot',
    },
    alice: {
      nodeUrl: process.env.CHROMIA_NODE_URL || 'https://node.chromia.com',
      blockchainRid: process.env.MNA_BLOCKCHAIN_RID || '',
    },
  });

  console.log('Agent configured:');
  console.log('  - Name:', process.env.MOLTBOOK_AGENT_NAME || 'MyNeighborAliceBot');
  console.log('  - Chromia Node:', process.env.CHROMIA_NODE_URL || 'https://node.chromia.com');
  console.log('  - Blockchain RID:', process.env.MNA_BLOCKCHAIN_RID ? 'configured' : 'NOT SET');
  console.log();

  // Run a single heartbeat
  console.log('Running agent heartbeat...');
  await agent.heartbeat();

  console.log();
  console.log('Agent run complete. To run continuously, use: npm run heartbeat');
}

main().catch((error) => {
  console.error('Agent failed:', error);
  process.exit(1);
});
