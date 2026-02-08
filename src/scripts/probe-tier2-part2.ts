import { createClient } from 'postchain-client';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Probe Tier 2 part 2: Use actual plot IDs from a real player (powerbody)
 * to test queries that need real data.
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
  const fmt = (obj: any) => JSON.stringify(obj, bigIntReplacer, 2);
  const preview = (obj: any, len = 600) => {
    const s = JSON.stringify(obj, bigIntReplacer, 2);
    return s.length > len ? s.slice(0, len) + '\n  ...(truncated)' : s;
  };

  // Step 1: Get powerbody's account_id and plot IDs
  console.log('=== Getting powerbody account ===');
  const playerData = await client.query('player.find_by_username', { username: 'powerbody' }) as any;
  console.log('Player data keys:', Object.keys(playerData));
  console.log('Player username:', playerData.username);
  console.log('Player is_guest:', playerData.is_guest);

  const accountId = playerData.id;
  console.log('Account ID raw type:', typeof accountId);
  console.log('Account ID:', fmt(accountId));

  // Determine hex representation
  let accountIdHex: string;
  if (Buffer.isBuffer(accountId)) {
    accountIdHex = accountId.toString('hex');
  } else if (accountId?.type === 'Buffer' && Array.isArray(accountId.data)) {
    accountIdHex = Buffer.from(accountId.data).toString('hex');
  } else if (typeof accountId === 'string') {
    accountIdHex = accountId;
  } else {
    accountIdHex = String(accountId);
  }
  console.log('Account ID (hex):', accountIdHex);

  console.log('\n=== Getting powerbody\'s plot IDs ===');
  const plotIds = await client.query('plots.get_plot_ids_by_player', { username: 'powerbody' }) as any[];
  console.log(`Found ${plotIds.length} plots`);

  // Get all plot IDs as hex for reference
  for (let i = 0; i < plotIds.length; i++) {
    const id = plotIds[i].id;
    let hex: string;
    if (Buffer.isBuffer(id)) {
      hex = id.toString('hex');
    } else if (id?.type === 'Buffer' && Array.isArray(id.data)) {
      hex = Buffer.from(id.data).toString('hex');
    } else {
      hex = String(id);
    }
    console.log(`  Plot ${i}: ${hex} (type: ${typeof id}, isBuffer: ${Buffer.isBuffer(id)})`);
  }

  // Step 2: Get plot meta from the first real plot
  console.log('\n=== plots.get_plot_meta (real plot ID) ===');
  const realPlotId = plotIds[0].id;
  let realPlotIdHex: string;
  if (Buffer.isBuffer(realPlotId)) {
    realPlotIdHex = realPlotId.toString('hex');
  } else if (realPlotId?.type === 'Buffer' && Array.isArray(realPlotId.data)) {
    realPlotIdHex = Buffer.from(realPlotId.data).toString('hex');
  } else {
    realPlotIdHex = String(realPlotId);
  }
  console.log('Using real plot ID (hex):', realPlotIdHex);
  console.log('Real plot ID raw:', fmt(realPlotId));
  try {
    const meta = await client.query('plots.get_plot_meta', { plot_id: realPlotId });
    console.log('Full plot meta:');
    console.log(preview(meta, 1000));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 3: Get plot meta from owned by account
  console.log('\n=== plots.get_plot_meta_owned_by_account ===');
  try {
    const plots = await client.query('plots.get_plot_meta_owned_by_account', { account_id: accountId }) as any[];
    console.log(`Found ${plots.length} plots for powerbody`);
    if (plots.length > 0) {
      console.log('First plot full data:');
      console.log(preview(plots[0], 1500));
      // Check if there's a plot_number field
      console.log('\nPlot keys:', Object.keys(plots[0]));
      if (plots[0].plot_number !== undefined) {
        console.log('plot_number found:', plots[0].plot_number);
      }
    }
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 4: plots.get_plot_map with real plot
  console.log('\n=== plots.get_plot_map (real plot ID) ===');
  try {
    const map = await client.query('plots.get_plot_map', { plot_id: realPlotId });
    console.log('Plot map:');
    console.log(preview(map, 800));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 5: farming.state_at_plot with real plot
  console.log('\n=== farming.state_at_plot (real plot ID) ===');
  try {
    const state = await client.query('farming.state_at_plot', { plot_id: realPlotId });
    console.log('Farming state:');
    console.log(preview(state, 800));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 6: fishing.get_fish_master_list with real plot
  console.log('\n=== fishing.get_fish_master_list (real plot ID) ===');
  try {
    const fish = await client.query('fishing.get_fish_master_list', { plot_id: realPlotId });
    console.log('Fish master list:');
    console.log(preview(fish, 800));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 7: plot_nodes.get_nodes_on_plot with real plot
  console.log('\n=== plot_nodes.get_nodes_on_plot (real plot ID) ===');
  try {
    const nodes = await client.query('plot_nodes.get_nodes_on_plot', { plot_id: realPlotId });
    console.log('Plot nodes:');
    console.log(preview(nodes, 800));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 8: placeables.all_placeables_at with real plot
  console.log('\n=== placeables.all_placeables_at (real plot ID) ===');
  try {
    const placeables = await client.query('placeables.all_placeables_at', { griddable_uid: realPlotId });
    const arr = placeables as any[];
    console.log(`Found ${arr.length} placeables`);
    if (arr.length > 0) {
      console.log('First placeable:');
      console.log(preview(arr[0], 500));
    }
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 9: npcs.get_npcs_at with real plot
  console.log('\n=== npcs.get_npcs_at (real plot ID) ===');
  try {
    const npcs = await client.query('npcs.get_npcs_at', { griddable_uid: realPlotId });
    const arr = npcs as any[];
    console.log(`Found ${arr.length} NPCs`);
    if (arr.length > 0) {
      console.log('First NPC:');
      console.log(preview(arr[0], 500));
    }
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 10: storefronts with real plot as griddable_uid
  console.log('\n=== storefronts.get_active_listings_for_storefront (real plot ID) ===');
  try {
    const listings = await client.query('storefronts.get_active_listings_for_storefront', { griddable_uid: realPlotId });
    console.log('Storefront listings:');
    console.log(preview(listings, 800));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 11: Try storefronts with hex string of plot_id
  console.log('\n=== storefronts.get_active_listings_for_storefront (hex string) ===');
  try {
    const listings = await client.query('storefronts.get_active_listings_for_storefront', { griddable_uid: realPlotIdHex });
    console.log('Storefront listings (hex):');
    console.log(preview(listings, 800));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 12: Try get_erc_plot_meta with real plot
  console.log('\n=== plots.get_erc_plot_meta (real plot ID) ===');
  try {
    const ercMeta = await client.query('plots.get_erc_plot_meta', { plot_id: realPlotId });
    console.log('ERC plot meta:');
    console.log(preview(ercMeta, 500));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 13: Get floor price with a tradeable asset
  console.log('\n=== storefronts.get_floor_price_for_listing ===');
  // Get a tradeable asset (not in the non-tradeable list)
  const allAssets = await client.query('assets.get_all_assets', {}) as any;
  const nonTradeable = await client.query('assets.get_all_non_tradeable_assets', {}) as string[];
  const nonTradeableSet = new Set(nonTradeable);
  const tradeableAssets = allAssets.data?.filter((a: any) => !nonTradeableSet.has(a.name)) || [];
  console.log(`Found ${tradeableAssets.length} tradeable assets`);
  if (tradeableAssets.length > 0) {
    // Try a few
    for (let i = 0; i < Math.min(5, tradeableAssets.length); i++) {
      const asset = tradeableAssets[i];
      try {
        const price = await client.query('storefronts.get_floor_price_for_listing', { asset_id: asset.id });
        console.log(`  ${asset.name}: floor_price=${fmt(price)}`);
      } catch (e: any) {
        console.log(`  ${asset.name}: FAILED - ${e.message?.slice(0, 100)}`);
      }
    }
  }

  // Step 14: player.get_ft4_inventory (what tokens does powerbody have?)
  console.log('\n=== player.get_ft4_inventory ===');
  try {
    const inv = await client.query('player.get_ft4_inventory', { account_id: accountId }) as any;
    console.log('FT4 inventory:');
    console.log(preview(inv, 600));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 15: land_sharing.get_all_sharees_for_plot
  console.log('\n=== land_sharing.get_all_sharees_for_plot ===');
  try {
    const sharees = await client.query('land_sharing.get_all_sharees_for_plot', { plot_id: realPlotId });
    console.log('Sharees:');
    console.log(preview(sharees, 400));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 16: bjorn_extraction.get_free_claim_status_for_plot
  console.log('\n=== bjorn_extraction.get_free_claim_status_for_plot ===');
  try {
    const claim = await client.query('bjorn_extraction.get_free_claim_status_for_plot', { plot_id: realPlotId });
    console.log('Free claim status:');
    console.log(preview(claim, 400));
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 17: get_plot_meta_by_plot_number — need to find actual plot numbers
  // The plot_meta_owned_by_account might have plot_number
  console.log('\n=== Finding real plot numbers ===');
  try {
    const plots = await client.query('plots.get_plot_meta_owned_by_account', { account_id: accountId }) as any[];
    for (const plot of plots) {
      if (plot.plot_number !== undefined) {
        console.log(`  Found plot_number: ${plot.plot_number}`);
        // Try get_plot_meta_by_plot_number with this number
        try {
          const meta = await client.query('plots.get_plot_meta_by_plot_number', { plot_number: plot.plot_number });
          console.log('  get_plot_meta_by_plot_number result:');
          console.log(`    ${preview(meta, 400)}`);
        } catch (e: any) {
          console.log(`  get_plot_meta_by_plot_number FAILED: ${e.message?.slice(0, 120)}`);
        }
      }
    }
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  // Step 18: storefronts — try different griddable_uid formats
  // Let's check what "griddable" means — it seems to be a specific struct type, not just a byte_array
  console.log('\n=== Debugging griddable_uid format ===');
  // Maybe griddable_uid is a struct with {type: ..., id: ...} or similar
  const uidFormats = [
    // Maybe it's a struct
    { type: 'plot', id: realPlotId },
    { plot_id: realPlotId },
    // Maybe the raw data array
    realPlotId.data,
    // Try as a number (some plots have numeric IDs)
    0,
  ];

  for (const uid of uidFormats) {
    try {
      const listings = await client.query('storefronts.get_active_listings_for_storefront', { griddable_uid: uid });
      console.log(`  format=${JSON.stringify(uid)?.slice(0, 80)} => ${preview(listings, 200)}`);
    } catch (e: any) {
      console.log(`  format=${JSON.stringify(uid)?.slice(0, 80)} FAILED: ${e.message?.slice(0, 120)}`);
    }
  }

  // Step 19: Try storefronts.get_user_transactions
  console.log('\n=== storefronts.get_user_transactions (powerbody) ===');
  try {
    const txs = await client.query('storefronts.get_user_transactions', { account_id: accountId }) as any;
    console.log('User transactions:');
    const arr = Array.isArray(txs) ? txs : (txs?.data || txs);
    console.log(`  Type: ${Array.isArray(arr) ? `array[${arr.length}]` : typeof arr}`);
    if (Array.isArray(arr) && arr.length > 0) {
      console.log('  First transaction:');
      console.log(`    ${preview(arr[0], 500)}`);
      // Check if transactions have griddable_uid or storefront info
      console.log('  Keys:', Object.keys(arr[0]));
    }
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200));
  }

  console.log('\n=== PROBE PART 2 COMPLETE ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
