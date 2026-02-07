import { createClient } from 'postchain-client';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Discover available query endpoints on the MNA blockchain
 *
 * This script helps you find what queries are available on the
 * My Neighbor Alice Chromia blockchain.
 */

async function main() {
  console.log('='.repeat(60));
  console.log('My Neighbor Alice - Endpoint Discovery');
  console.log('='.repeat(60));
  console.log();

  const nodeUrl = process.env.CHROMIA_NODE_URL || 'https://node.chromia.com';
  const blockchainRid = process.env.MNA_BLOCKCHAIN_RID;

  if (!blockchainRid) {
    console.error('ERROR: MNA_BLOCKCHAIN_RID not set in .env');
    console.error('');
    console.error('To find the blockchain RID:');
    console.error('1. Visit https://explorer.chromia.com');
    console.error('2. Search for "My Neighbor Alice"');
    console.error('3. Copy the blockchain RID from the chain details');
    console.error('');
    console.error('Or check the MNA documentation/Discord for the mainnet RID.');
    process.exit(1);
  }

  console.log('Connecting to Chromia...');
  console.log('  Node URL:', nodeUrl);
  console.log('  Blockchain RID:', blockchainRid);
  console.log();

  try {
    const client = await createClient({
      nodeUrlPool: nodeUrl,
      blockchainRid: blockchainRid,
    });

    console.log('Connected! Attempting to discover endpoints...');
    console.log();

    // Try common query patterns - focus on finding working endpoints
    const queryPatterns = [
      // Known working FT4 queries
      'ft4.get_all_assets',
      'ft4.get_asset_by_id',
      'ft4.get_account_by_id',
      'ft4.get_accounts_by_signer',
      'ft4.get_accounts_by_type',
      'ft4.get_all_accounts',

      // Known working NFT query
      'get_nft_owner',
      'get_nft',
      'get_nfts',
      'get_all_nfts',
      'get_nfts_by_owner',
      'get_nfts_by_type',

      // Token queries
      'get_token',
      'get_tokens',
      'get_all_tokens',
      'get_token_by_id',

      // Original style queries
      'get_original',
      'get_originals',
      'get_all_originals',
      'get_originals_by_owner',

      // Account/balance queries
      'get_account',
      'get_accounts',
      'get_balance',
      'get_balances',

      // Land specific attempts
      'get_land',
      'get_plot',
      'get_plots',
      'get_island',
      'get_islands',
      'get_world',
      'get_map',

      // Marketplace
      'get_listings',
      'get_offers',
      'get_market',

      // Generic data queries
      'get_entities',
      'get_items',
      'get_assets',
      'get_objects',
      'list_all',

      // With 'all' prefix
      'all_lands',
      'all_nfts',
      'all_tokens',
      'all_plots',
    ];

    console.log('Testing query endpoints...\n');

    for (const query of queryPatterns) {
      try {
        const result = await client.query(query, {});
        console.log(`✓ ${query} - AVAILABLE`);
        console.log(`  Response type: ${typeof result}`);
        if (Array.isArray(result)) {
          console.log(`  Items: ${result.length}`);
        }
      } catch (error: any) {
        if (error.message?.includes('Unknown query')) {
          console.log(`✗ ${query} - not found`);
        } else {
          console.log(`? ${query} - error: ${error.message?.slice(0, 50)}`);
        }
      }
    }

    console.log('\nDiscovery complete.');
    console.log('Update src/alice/client.ts with the working query names.');

  } catch (error) {
    console.error('Failed to connect:', error);
    process.exit(1);
  }
}

main();
