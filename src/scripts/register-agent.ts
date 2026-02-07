import { MoltbookClient } from '../moltbook/client.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Register a new My Neighbor Alice agent on Moltbook
 *
 * This script:
 * 1. Registers the agent with Moltbook API
 * 2. Saves the API key to .env file
 * 3. Provides the claim URL for human verification
 */

const AGENT_NAME = process.argv[2] || 'MyNeighborAliceBot';
const AGENT_DESCRIPTION = process.argv[3] ||
  'An AI agent connected to the My Neighbor Alice virtual world. ' +
  'I monitor the game ecosystem, track marketplace activity, and share insights ' +
  'about virtual land, NFT assets, and the ALICE token economy.';

async function main() {
  console.log('='.repeat(60));
  console.log('My Neighbor Alice - Moltbook Agent Registration');
  console.log('='.repeat(60));
  console.log();
  console.log(`Agent Name: ${AGENT_NAME}`);
  console.log(`Description: ${AGENT_DESCRIPTION}`);
  console.log();

  const client = new MoltbookClient();

  try {
    console.log('Registering with Moltbook...');
    console.log('API URL: https://www.moltbook.com/api/v1/agents/register');
    console.log();

    const result = await client.register(AGENT_NAME, AGENT_DESCRIPTION);

    // Debug: log the full response
    console.log('Raw API Response:');
    console.log(JSON.stringify(result, null, 2));
    console.log();

    if (!result || (!result.api_key && !result.apiKey)) {
      console.error('ERROR: Registration did not return expected data.');
      console.error('The Moltbook API may have changed or be unavailable.');
      console.error('');
      console.error('Try registering manually:');
      console.error(`curl -X POST https://www.moltbook.com/api/v1/agents/register \\`);
      console.error(`  -H "Content-Type: application/json" \\`);
      console.error(`  -d '{"name": "${AGENT_NAME}", "description": "${AGENT_DESCRIPTION}"}'`);
      process.exit(1);
    }

    // Handle both snake_case and camelCase response formats
    const apiKey = result.api_key || result.apiKey;
    const agentId = result.agent_id || result.agentId;
    const claimUrl = result.claim_url || result.claimUrl;
    const verificationCode = result.verification_code || result.verificationCode;

    console.log('✓ Registration successful!\n');
    console.log('API Key:', apiKey);
    console.log('Agent ID:', agentId);
    console.log();
    console.log('='.repeat(60));
    console.log('IMPORTANT: Human Verification Required');
    console.log('='.repeat(60));
    console.log();
    console.log('To activate your agent, you must claim it by tweeting:');
    console.log();
    console.log(`  ${claimUrl}`);
    console.log();
    console.log('Verification Code:', verificationCode);
    console.log();

    // Save to .env file
    const envPath = path.join(process.cwd(), '.env');
    const envContent = `# Moltbook API Configuration
MOLTBOOK_API_KEY=${apiKey}
MOLTBOOK_AGENT_NAME=${AGENT_NAME}
MOLTBOOK_API_BASE=https://www.moltbook.com/api/v1

# My Neighbor Alice / Chromia Configuration
CHROMIA_NODE_URL=https://node.chromia.com
MNA_BLOCKCHAIN_RID=

# Agent Configuration
HEARTBEAT_INTERVAL_HOURS=4
POST_INTERVAL_MINUTES=30
`;

    fs.writeFileSync(envPath, envContent);
    console.log('✓ API key saved to .env file');
    console.log();
    console.log('Next steps:');
    console.log('1. Complete the Twitter verification using the claim URL above');
    console.log('2. Configure MNA_BLOCKCHAIN_RID in .env (get from Chromia docs)');
    console.log('3. Run `npm run heartbeat` to start the agent');
    console.log();

  } catch (error: any) {
    console.error('Registration failed:', error.message);

    // Log full error details for debugging
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }

    if (error.response?.status === 429) {
      console.error('Rate limited - try again later');
    } else if (error.response?.status === 409) {
      console.error('Agent name already taken - try a different name');
    }

    process.exit(1);
  }
}

main();
