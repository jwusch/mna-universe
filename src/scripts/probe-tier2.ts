import { createClient } from 'postchain-client';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Probe parameterized Chromia queries for Tier 2 API
 *
 * Tests the exact parameter formats needed for each query.
 */

async function main() {
  const nodeUrl = process.env.CHROMIA_NODE_URL || 'https://dapps0.chromaway.com:7740';
  const blockchainRid = process.env.MNA_BLOCKCHAIN_RID;

  if (!blockchainRid) {
    console.error('ERROR: MNA_BLOCKCHAIN_RID not set in .env');
    process.exit(1);
  }

  console.log('Connecting to Chromia...');
  const client = await createClient({
    nodeUrlPool: nodeUrl,
    blockchainRid: blockchainRid,
  });
  console.log('Connected!\n');

  const bigIntReplacer = (_k: string, v: any) => typeof v === 'bigint' ? v.toString() : v;
  const fmt = (obj: any) => JSON.stringify(obj, bigIntReplacer, 2);
  const preview = (obj: any, len = 500) => {
    const s = JSON.stringify(obj, bigIntReplacer, 2);
    return s.length > len ? s.slice(0, len) + '...' : s;
  };

  // =====================================================================
  // TEST 1: plots.generate_plot_id — convert plot_number to plot_id
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 1: plots.generate_plot_id');
  console.log('='.repeat(70));

  let samplePlotId: any = null;

  for (const plotNum of [1, 100, 1000]) {
    try {
      const result = await client.query('plots.generate_plot_id', { plot_number: plotNum });
      console.log(`  plot_number=${plotNum} => ${fmt(result)}`);
      console.log(`  Type: ${typeof result}, isBuffer: ${(result as any)?.type === 'Buffer'}, isArray: ${Array.isArray((result as any)?.data)}`);
      if (!samplePlotId) samplePlotId = result;
    } catch (e: any) {
      console.log(`  plot_number=${plotNum} FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  // Also try as string
  for (const plotNum of ['1', '100']) {
    try {
      const result = await client.query('plots.generate_plot_id', { plot_number: plotNum });
      console.log(`  plot_number="${plotNum}" (string) => ${fmt(result)}`);
    } catch (e: any) {
      console.log(`  plot_number="${plotNum}" (string) FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 2: plots.get_plot_meta_by_plot_number
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 2: plots.get_plot_meta_by_plot_number');
  console.log('='.repeat(70));

  for (const plotNum of [1, 100, 1000, 4000]) {
    try {
      const result = await client.query('plots.get_plot_meta_by_plot_number', { plot_number: plotNum });
      console.log(`  plot_number=${plotNum} =>`);
      console.log(`    ${preview(result, 300)}`);
    } catch (e: any) {
      console.log(`  plot_number=${plotNum} FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 3: plots.get_plot_map — needs plot_id (Buffer format)
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 3: plots.get_plot_map (using plot_id from generate_plot_id)');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('plots.get_plot_map', { plot_id: samplePlotId });
      console.log(`  plot_id=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  plot_id=<Buffer from plot 1> FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  // Also try raw integer
  try {
    const result = await client.query('plots.get_plot_map', { plot_id: 1 });
    console.log(`  plot_id=1 (integer) => ${preview(result, 300)}`);
  } catch (e: any) {
    console.log(`  plot_id=1 (integer) FAILED: ${e.message?.slice(0, 120)}`);
  }

  // Try hex string
  if (samplePlotId?.data) {
    const hexStr = Buffer.from(samplePlotId.data).toString('hex');
    try {
      const result = await client.query('plots.get_plot_map', { plot_id: hexStr });
      console.log(`  plot_id="${hexStr}" (hex string) => ${preview(result, 300)}`);
    } catch (e: any) {
      console.log(`  plot_id="${hexStr}" (hex string) FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 4: plots.get_plot_meta — needs plot_id
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 4: plots.get_plot_meta');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('plots.get_plot_meta', { plot_id: samplePlotId });
      console.log(`  plot_id=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 5: farming.state_at_plot — needs plot_id
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 5: farming.state_at_plot');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('farming.state_at_plot', { plot_id: samplePlotId });
      console.log(`  plot_id=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 6: fishing.get_fish_master_list — needs plot_id
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 6: fishing.get_fish_master_list');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('fishing.get_fish_master_list', { plot_id: samplePlotId });
      console.log(`  plot_id=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 7: plot_nodes.get_nodes_on_plot — needs plot_id
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 7: plot_nodes.get_nodes_on_plot');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('plot_nodes.get_nodes_on_plot', { plot_id: samplePlotId });
      console.log(`  plot_id=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 8: player.find_by_username
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 8: player.find_by_username');
  console.log('='.repeat(70));

  for (const username of ['powerbody', 'Powerbody', 'POWERBODY', 'alice']) {
    try {
      const result = await client.query('player.find_by_username', { username });
      console.log(`  username="${username}" =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  username="${username}" FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 9: plots.get_plot_ids_by_player — needs username
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 9: plots.get_plot_ids_by_player');
  console.log('='.repeat(70));

  for (const username of ['powerbody', 'Powerbody']) {
    try {
      const result = await client.query('plots.get_plot_ids_by_player', { username });
      console.log(`  username="${username}" =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  username="${username}" FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 10: storefronts.get_active_listings_for_storefront
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 10: storefronts.get_active_listings_for_storefront');
  console.log('='.repeat(70));

  // griddable_uid might be a plot_id. Try the same Buffer format.
  if (samplePlotId) {
    try {
      const result = await client.query('storefronts.get_active_listings_for_storefront', { griddable_uid: samplePlotId });
      console.log(`  griddable_uid=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  griddable_uid=<Buffer from plot 1> FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  // Try string "1" and integer 1
  for (const val of [1, '1', 'storefront_1']) {
    try {
      const result = await client.query('storefronts.get_active_listings_for_storefront', { griddable_uid: val });
      console.log(`  griddable_uid=${JSON.stringify(val)} => ${preview(result, 300)}`);
    } catch (e: any) {
      console.log(`  griddable_uid=${JSON.stringify(val)} FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 11: storefronts.get_floor_price_for_listing
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 11: storefronts.get_floor_price_for_listing');
  console.log('='.repeat(70));

  // First get an asset_id from assets.get_all_assets
  try {
    const assets = await client.query('assets.get_all_assets', {}) as any;
    const firstAsset = assets?.data?.[0];
    if (firstAsset?.id) {
      console.log(`  Using asset: ${firstAsset.name} (id type: ${typeof firstAsset.id}, isBuffer: ${firstAsset.id?.type === 'Buffer'})`);
      try {
        const result = await client.query('storefronts.get_floor_price_for_listing', { asset_id: firstAsset.id });
        console.log(`  asset_id=<first asset Buffer> => ${preview(result, 300)}`);
      } catch (e: any) {
        console.log(`  asset_id=<first asset Buffer> FAILED: ${e.message?.slice(0, 200)}`);
      }
    }
  } catch (e: any) {
    console.log(`  Failed to get assets: ${e.message?.slice(0, 100)}`);
  }

  // Try with a known asset name from the sorting_scores
  try {
    const scores = await client.query('assets.get_sorting_scores', {}) as any[];
    if (scores?.length > 0) {
      const assetId = scores[0].id;
      console.log(`  Using sorting_scores[0].id (type: ${typeof assetId}, isBuffer: ${assetId?.type === 'Buffer'})`);
      try {
        const result = await client.query('storefronts.get_floor_price_for_listing', { asset_id: assetId });
        console.log(`  asset_id=<sorting_scores[0].id> => ${preview(result, 300)}`);
      } catch (e: any) {
        console.log(`  asset_id=<sorting_scores[0].id> FAILED: ${e.message?.slice(0, 200)}`);
      }
    }
  } catch (e: any) {
    console.log(`  Failed to get sorting_scores: ${e.message?.slice(0, 100)}`);
  }

  console.log();

  // =====================================================================
  // TEST 12: plots.get_erc_plot_meta — needs plot_id
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 12: plots.get_erc_plot_meta');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('plots.get_erc_plot_meta', { plot_id: samplePlotId });
      console.log(`  plot_id=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 13: plots.get_occupied_plots — needs region
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 13: plots.get_occupied_plots');
  console.log('='.repeat(70));

  for (const region of ['lummelunda', 'Lummelunda', 'snowflake', 'snowflake_heights', 1, 'island_1']) {
    try {
      const result = await client.query('plots.get_occupied_plots', { region });
      console.log(`  region=${JSON.stringify(region)} => type: ${Array.isArray(result) ? `array[${(result as any[]).length}]` : typeof result}`);
      if (Array.isArray(result) && (result as any[]).length > 0) {
        console.log(`    First item: ${preview((result as any[])[0], 200)}`);
      }
    } catch (e: any) {
      console.log(`  region=${JSON.stringify(region)} FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 14: placeables.all_placeables_at — needs griddable_uid
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 14: placeables.all_placeables_at');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('placeables.all_placeables_at', { griddable_uid: samplePlotId });
      console.log(`  griddable_uid=<Buffer from plot 1> =>`);
      const arr = result as any[];
      console.log(`    type: ${Array.isArray(result) ? `array[${arr.length}]` : typeof result}`);
      if (Array.isArray(result) && arr.length > 0) {
        console.log(`    First: ${preview(arr[0], 300)}`);
      }
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 15: npcs.get_npcs_at — needs griddable_uid
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 15: npcs.get_npcs_at');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('npcs.get_npcs_at', { griddable_uid: samplePlotId });
      console.log(`  griddable_uid=<Buffer from plot 1> =>`);
      const arr = result as any[];
      console.log(`    type: ${Array.isArray(result) ? `array[${arr.length}]` : typeof result}`);
      if (Array.isArray(result) && arr.length > 0) {
        console.log(`    First: ${preview(arr[0], 300)}`);
      }
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 16: plots.get_plot_meta_owned_by_account — get powerbody's account
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 16: plots.get_plot_meta_owned_by_account (using powerbody account)');
  console.log('='.repeat(70));

  try {
    const playerData = await client.query('player.find_by_username', { username: 'powerbody' }) as any;
    if (playerData?.account_id || playerData?.id) {
      const accountId = playerData.account_id || playerData.id;
      console.log(`  powerbody account_id type: ${typeof accountId}, isBuffer: ${accountId?.type === 'Buffer'}`);
      try {
        const plots = await client.query('plots.get_plot_meta_owned_by_account', { account_id: accountId });
        const arr = plots as any[];
        console.log(`  Result: ${Array.isArray(plots) ? `array[${arr.length}]` : typeof plots}`);
        if (Array.isArray(plots) && arr.length > 0) {
          console.log(`  First plot: ${preview(arr[0], 400)}`);
        }
      } catch (e: any) {
        console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
      }
    } else {
      console.log(`  powerbody data has no account_id. Keys: ${Object.keys(playerData || {})}`);
      console.log(`  Data: ${preview(playerData, 300)}`);
    }
  } catch (e: any) {
    console.log(`  Could not find powerbody: ${e.message?.slice(0, 120)}`);
  }

  console.log();

  // =====================================================================
  // TEST 17: admin.list_players — search for players
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 17: admin.list_players');
  console.log('='.repeat(70));

  for (const search of ['power', 'alice', 'a']) {
    try {
      const result = await client.query('admin.list_players', { search }) as any;
      const data = result?.data || result;
      console.log(`  search="${search}" => ${Array.isArray(data) ? `array[${data.length}]` : typeof data}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`    First: ${preview(data[0], 200)}`);
      } else if (!Array.isArray(data)) {
        console.log(`    ${preview(data, 200)}`);
      }
    } catch (e: any) {
      console.log(`  search="${search}" FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 18: Try a couple more plot numbers with get_plot_meta_by_plot_number
  //          to see full shape of the response
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 18: Full response shape from get_plot_meta_by_plot_number');
  console.log('='.repeat(70));

  try {
    const result = await client.query('plots.get_plot_meta_by_plot_number', { plot_number: 1 });
    console.log(`  Full result for plot_number=1:`);
    console.log(`  ${fmt(result)}`);
  } catch (e: any) {
    console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
  }

  console.log();

  // =====================================================================
  // TEST 19: fishing.get_fishing_cards_for_plot
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 19: fishing.get_fishing_cards_for_plot');
  console.log('='.repeat(70));

  if (samplePlotId) {
    try {
      const result = await client.query('fishing.get_fishing_cards_for_plot', { plot_id: samplePlotId });
      console.log(`  plot_id=<Buffer from plot 1> =>`);
      console.log(`    ${preview(result, 400)}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log();

  // =====================================================================
  // TEST 20: free_trials.get_free_trial_data_for_plot
  // =====================================================================
  console.log('='.repeat(70));
  console.log('TEST 20: free_trials.get_free_trial_data_for_plot');
  console.log('='.repeat(70));

  for (const plot_number of [1, 100]) {
    try {
      const result = await client.query('free_trials.get_free_trial_data_for_plot', { plot_number });
      console.log(`  plot_number=${plot_number} => ${preview(result, 300)}`);
    } catch (e: any) {
      console.log(`  plot_number=${plot_number} FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  console.log();

  // =====================================================================
  // SUMMARY
  // =====================================================================
  console.log('='.repeat(70));
  console.log('PROBE COMPLETE');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
