import { createClient } from 'postchain-client';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Probe Tier 2 part 3: Test complex storefront queries and remaining details
 */

async function main() {
  const nodeUrl = process.env.CHROMIA_NODE_URL || 'https://dapps0.chromaway.com:7740';
  const blockchainRid = process.env.MNA_BLOCKCHAIN_RID;

  if (!blockchainRid) {
    console.error('ERROR: MNA_BLOCKCHAIN_RID not set');
    process.exit(1);
  }

  const client = await createClient({
    nodeUrlPool: nodeUrl,
    blockchainRid: blockchainRid,
  });
  console.log('Connected!\n');

  const bigIntReplacer = (_k: string, v: any) => typeof v === 'bigint' ? v.toString() : v;
  const preview = (obj: any, len = 800) => {
    const s = JSON.stringify(obj, bigIntReplacer, 2);
    return s.length > len ? s.slice(0, len) + '\n  ...(truncated)' : s;
  };

  // Get powerbody's account and plot data
  const playerData = await client.query('player.find_by_username', { username: 'powerbody' }) as any;
  const accountId = playerData.id;
  const plotIds = await client.query('plots.get_plot_ids_by_player', { username: 'powerbody' }) as any[];
  const realPlotId = plotIds[0].id;

  // TEST 1: storefronts.get_active_listings_for_storefront with all required params
  // According to app structure: q, griddable_id, storefront_location, account_id, modules, currency_names, strategy, searched_username, cursor
  console.log('=== TEST 1: storefronts.get_active_listings_for_storefront (full params) ===');

  try {
    const result = await client.query('storefronts.get_active_listings_for_storefront', {
      q: '',
      griddable_id: realPlotId,
      storefront_location: { x: 0, y: 0 },
      account_id: accountId,
      modules: [],
      currency_names: [],
      strategy: 'DEFAULT',
      searched_username: '',
      cursor: { page_size: 10, after_rowid: 0 },
    });
    console.log('Result:', preview(result));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 300));
  }

  // TEST 2: storefronts.get_user_transactions — full output
  console.log('\n=== TEST 2: storefronts.get_user_transactions (powerbody) ===');
  try {
    const result = await client.query('storefronts.get_user_transactions', { account_id: accountId }) as any;
    console.log('Result keys:', Object.keys(result || {}));
    console.log('Result:', preview(result, 1000));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // TEST 3: player.find_by_username — full output for "powerbody"
  console.log('\n=== TEST 3: player.find_by_username full output ===');
  console.log('Player data:', preview(playerData, 1500));

  // TEST 4: Get "alice" user's plots
  console.log('\n=== TEST 4: plots.get_plot_ids_by_player for "alice" ===');
  try {
    const alicePlots = await client.query('plots.get_plot_ids_by_player', { username: 'alice' }) as any[];
    console.log(`Found ${alicePlots.length} plots for alice`);
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // TEST 5: admin.list_players — full player object shape
  console.log('\n=== TEST 5: admin.list_players full shape ===');
  try {
    const result = await client.query('admin.list_players', { search: 'power' }) as any;
    console.log('Result:', preview(result, 1500));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // TEST 6: plots.get_plot_meta_owned_by_account for powerbody — all 3 plots
  console.log('\n=== TEST 6: All 3 powerbody plot metas ===');
  try {
    const plots = await client.query('plots.get_plot_meta_owned_by_account', { account_id: accountId }) as any[];
    for (const plot of plots) {
      const plotIdHex = Buffer.isBuffer(plot.id) ? plot.id.toString('hex') : Buffer.from(plot.id.data).toString('hex');
      console.log(`Plot ${plot.plot_number} (${plot.island} / ${plot.region}):`);
      console.log(`  id: ${plotIdHex}`);
      console.log(`  name: "${plot.plot_name}"`);
      console.log(`  owner: ${plot.owner_name}`);
      console.log(`  soil: ${plot.soil_type} (fertility: ${plot.soil_fertility})`);
      console.log(`  water: ${plot.water_type} (quality: ${plot.water_quality})`);
      console.log(`  bjorn_extracted: ${plot.bjorn_extracted}`);
    }
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // TEST 7: farming.state_at_plot for a plot with activity
  console.log('\n=== TEST 7: farming.state_at_plot (all 3 powerbody plots) ===');
  for (const plotEntry of plotIds) {
    try {
      const state = await client.query('farming.state_at_plot', { plot_id: plotEntry.id }) as any[];
      const plotIdHex = Buffer.isBuffer(plotEntry.id) ? plotEntry.id.toString('hex') : Buffer.from(plotEntry.id.data).toString('hex');
      console.log(`Plot ${plotIdHex.slice(0, 16)}...: ${state.length} farming tiles`);
      if (state.length > 0) {
        // Find one with a plant
        const withPlant = state.find((s: any) => s.plant !== null);
        if (withPlant) {
          console.log(`  Example with plant: ${preview(withPlant, 400)}`);
        } else {
          console.log(`  All tiles are empty. First: ${preview(state[0], 200)}`);
        }
      }
    } catch (e: any) {
      console.log('FAILED:', e.message?.slice(0, 200));
    }
  }

  // TEST 8: plot_nodes for all 3 plots
  console.log('\n=== TEST 8: plot_nodes.get_nodes_on_plot (all 3 powerbody plots) ===');
  for (const plotEntry of plotIds) {
    try {
      const nodes = await client.query('plot_nodes.get_nodes_on_plot', { plot_id: plotEntry.id }) as any[];
      const plotIdHex = Buffer.isBuffer(plotEntry.id) ? plotEntry.id.toString('hex') : Buffer.from(plotEntry.id.data).toString('hex');
      console.log(`Plot ${plotIdHex.slice(0, 16)}...: ${nodes.length} resource nodes`);
      if (nodes.length > 0) {
        console.log(`  First node: ${preview(nodes[0], 300)}`);
      }
    } catch (e: any) {
      console.log('FAILED:', e.message?.slice(0, 200));
    }
  }

  // TEST 9: fishing.get_fish_master_list for all 3 plots
  console.log('\n=== TEST 9: fishing.get_fish_master_list (all 3 powerbody plots) ===');
  for (const plotEntry of plotIds) {
    try {
      const fish = await client.query('fishing.get_fish_master_list', { plot_id: plotEntry.id }) as any[];
      const plotIdHex = Buffer.isBuffer(plotEntry.id) ? plotEntry.id.toString('hex') : Buffer.from(plotEntry.id.data).toString('hex');
      console.log(`Plot ${plotIdHex.slice(0, 16)}...: ${fish.length} fish entries`);
      if (fish.length > 0) {
        console.log(`  First fish: name=${fish[0].name || 'N/A'}, ${preview(fish[0], 200)}`);
      }
    } catch (e: any) {
      console.log('FAILED:', e.message?.slice(0, 200));
    }
  }

  // TEST 10: storefronts.get_user_active_listings_for_storefront
  console.log('\n=== TEST 10: storefronts.get_user_active_listings_for_storefront ===');
  // Check the params in the app structure
  try {
    const result = await client.query('storefronts.get_user_active_listings_for_storefront', {
      account_id: accountId,
    });
    console.log('Result:', preview(result, 800));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // TEST 11: player_progression.get_player_progression
  console.log('\n=== TEST 11: player_progression.get_player_progression ===');
  try {
    const result = await client.query('player_progression.get_player_progression', { account_id: accountId });
    console.log('Result:', preview(result, 600));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // TEST 12: player_progression.get_player_leaderboard_position
  console.log('\n=== TEST 12: player_progression.get_player_leaderboard_position ===');
  try {
    const result = await client.query('player_progression.get_player_leaderboard_position', { account_id: accountId });
    console.log('Result:', preview(result, 400));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // TEST 13: plots.get_occupied_plots with various regions from plot meta
  console.log('\n=== TEST 13: plots.get_occupied_plots with known region names ===');
  for (const region of ['Shaded Headland', 'shaded headland', "Nature's Rest", 'Gentle Valley']) {
    try {
      const result = await client.query('plots.get_occupied_plots', { region }) as any[];
      console.log(`  region="${region}": ${result.length} plots`);
      if (result.length > 0) {
        console.log(`    First: ${preview(result[0], 200)}`);
      }
    } catch (e: any) {
      console.log(`  region="${region}" FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log('\n=== PROBE PART 3 COMPLETE ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
