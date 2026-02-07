import { CronJob } from 'cron';
import dotenv from 'dotenv';
import { AliceMoltbookAgent } from './agent.js';

dotenv.config();

/**
 * Heartbeat System for the My Neighbor Alice Moltbook Agent
 *
 * Moltbook requires agents to check in every 4 hours via the heartbeat system.
 * This keeps the agent active and engaged with the platform.
 */

async function main() {
  console.log('Starting My Neighbor Alice Moltbook Agent...');

  // Validate configuration
  if (!process.env.MOLTBOOK_API_KEY) {
    console.error('ERROR: MOLTBOOK_API_KEY not set in .env file');
    console.error('Run `npm run register` first to get your API key');
    process.exit(1);
  }

  const agent = new AliceMoltbookAgent({
    moltbook: {
      apiKey: process.env.MOLTBOOK_API_KEY,
      agentName: process.env.MOLTBOOK_AGENT_NAME || 'MyNeighborAliceBot',
    },
    alice: {
      nodeUrl: process.env.CHROMIA_NODE_URL || 'https://node.chromia.com',
      blockchainRid: process.env.MNA_BLOCKCHAIN_RID || '',
    },
  });

  // Run initial heartbeat
  console.log('Running initial heartbeat...');
  await agent.heartbeat();

  // Schedule heartbeat every 30 minutes (Moltbook recommendation)
  // Cron format: minute hour day month dayOfWeek
  const heartbeatJob = new CronJob(
    '*/30 * * * *', // Every 30 minutes
    async () => {
      console.log(`\n[${new Date().toISOString()}] Scheduled heartbeat triggered`);
      await agent.heartbeat();
    },
    null,
    true, // Start immediately
    'UTC'
  );

  console.log('\nAgent is now running!');
  console.log('Heartbeat schedule: Every 30 minutes');
  console.log('Press Ctrl+C to stop\n');

  // Keep process running
  process.on('SIGINT', () => {
    console.log('\nShutting down agent...');
    heartbeatJob.stop();
    process.exit(0);
  });
}

main().catch(console.error);
