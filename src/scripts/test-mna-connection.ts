import { createClient } from 'postchain-client';
import { createConnection } from '@chromia/ft4';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test connection to My Neighbor Alice blockchain and explore available data
 */

const MAINNET_NODES = [
  'https://dapps0.chromaway.com:7740',
  'https://system.chromaway.com:7740',
  'https://chromia-mainnet.w3coins.io:7740',
];

async function main() {
  console.log('='.repeat(60));
  console.log('Testing My Neighbor Alice Blockchain Connection');
  console.log('='.repeat(60));
  console.log();

  const blockchainRid = process.env.MNA_BLOCKCHAIN_RID;

  if (!blockchainRid) {
    console.error('MNA_BLOCKCHAIN_RID not set');
    process.exit(1);
  }

  console.log('Blockchain RID:', blockchainRid);
  console.log();

  try {
    // Connect using directory chain for proper node resolution
    const client = await createClient({
      directoryNodeUrlPool: MAINNET_NODES,
      blockchainRid: blockchainRid,
    });

    console.log('✓ Connected to My Neighbor Alice blockchain!\n');

    // Create FT4 connection
    const ft4 = createConnection(client);

    // Try to get assets (tokens/NFTs on the chain)
    console.log('Fetching FT4 assets...');
    try {
      const assets = await ft4.getAllAssets();
      console.log('✓ Found assets:', assets.data?.length || 0);
      if (assets.data && assets.data.length > 0) {
        console.log('\nSample assets:');
        for (const asset of assets.data.slice(0, 5)) {
          console.log(`  - ${asset.name || asset.symbol || 'Unknown'} (${asset.type || 'token'})`);
        }
      }
    } catch (e: any) {
      console.log('  Assets query failed:', e.message?.slice(0, 100));
    }

    // Try common game-related query patterns
    console.log('\nTrying game-specific queries...\n');

    const queries = [
      // World/map related
      { name: 'world.get_lands', params: {} },
      { name: 'world.get_all_lands', params: { page_size: 10, page_cursor: null } },
      { name: 'land.get_all', params: { limit: 10 } },
      { name: 'map.get_chunks', params: {} },

      // Player related
      { name: 'player.get_all', params: { limit: 10 } },
      { name: 'account.get_all', params: { page_size: 10 } },

      // Items/NFT related
      { name: 'item.get_all', params: { limit: 10 } },
      { name: 'nft.get_all', params: { page_size: 10 } },
      { name: 'inventory.get_items', params: {} },

      // Marketplace
      { name: 'market.get_listings', params: { limit: 10 } },
      { name: 'marketplace.get_active', params: {} },
      { name: 'trading.get_orders', params: {} },

      // Events/transactions
      { name: 'events.get_recent', params: { limit: 10 } },
      { name: 'history.get_transactions', params: { limit: 10 } },

      // Game state
      { name: 'game.get_state', params: {} },
      { name: 'game.get_config', params: {} },
      { name: 'config.get_all', params: {} },

      // Generic
      { name: 'get_info', params: {} },
      { name: 'version', params: {} },
    ];

    for (const q of queries) {
      try {
        const result = await client.query(q.name, q.params);
        console.log(`✓ ${q.name} - SUCCESS!`);
        console.log(`  Result:`, JSON.stringify(result).slice(0, 200));
      } catch (e: any) {
        if (e.message?.includes('Unknown query')) {
          // Skip - not found
        } else if (e.message?.includes('Missing argument')) {
          console.log(`? ${q.name} - exists but needs different params`);
        } else {
          // Other error - might be interesting
          console.log(`? ${q.name} - ${e.message?.slice(0, 50)}`);
        }
      }
    }

    console.log('\n✓ Connection test complete!');
    console.log('\nThe My Neighbor Alice blockchain is accessible.');
    console.log('Further query discovery may require MNA documentation or GitHub.');

  } catch (error: any) {
    console.error('Connection failed:', error.message);
  }
}

main();
