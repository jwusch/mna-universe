import { createClient } from 'postchain-client';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

/**
 * Full Chromia MNA blockchain discovery
 *
 * Uses rell.get_app_structure to enumerate ALL modules and queries,
 * then probes each query to see which ones return data for free.
 */

async function main() {
  const nodeUrl = process.env.CHROMIA_NODE_URL || 'https://dapps0.chromaway.com:7740';
  const blockchainRid = process.env.MNA_BLOCKCHAIN_RID;

  if (!blockchainRid) {
    console.error('ERROR: MNA_BLOCKCHAIN_RID not set in .env');
    process.exit(1);
  }

  console.log('Connecting to Chromia...');
  console.log('  Node:', nodeUrl);
  console.log('  RID:', blockchainRid);

  const client = await createClient({
    nodeUrlPool: nodeUrl,
    blockchainRid: blockchainRid,
  });

  console.log('Connected!\n');

  // Step 1: Get the full app structure
  console.log('='.repeat(70));
  console.log('STEP 1: Fetching rell.get_app_structure');
  console.log('='.repeat(70));

  let appStructure: any;
  try {
    appStructure = await client.query('rell.get_app_structure', {});
    console.log('Got app structure! Type:', typeof appStructure);

    // Save raw structure to file
    const rawPath = 'cache/chromia-app-structure-raw.json';
    fs.mkdirSync('cache', { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(appStructure, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    console.log(`Saved raw structure to ${rawPath}`);
  } catch (error: any) {
    console.error('Failed to get app structure:', error.message);
    console.log('\nTrying alternative discovery methods...');

    // Try without the rell prefix
    for (const alt of ['get_app_structure', 'rell.get_module_args', 'get_module_args']) {
      try {
        const result = await client.query(alt, {});
        console.log(`  ${alt} returned:`, typeof result);
        appStructure = result;
        break;
      } catch (e: any) {
        console.log(`  ${alt}: ${e.message?.slice(0, 60)}`);
      }
    }

    if (!appStructure) {
      console.error('\nCould not retrieve app structure. Falling back to brute-force probing.');
    }
  }

  // Step 2: Parse modules and queries from structure
  console.log('\n' + '='.repeat(70));
  console.log('STEP 2: Parsing modules and queries');
  console.log('='.repeat(70));

  const allQueries: string[] = [];

  if (appStructure) {
    // The structure format varies - try to extract queries
    try {
      const parsed = typeof appStructure === 'string' ? JSON.parse(appStructure) : appStructure;

      // Walk the structure to find all queries
      function extractQueries(obj: any, prefix = '') {
        if (!obj || typeof obj !== 'object') return;

        // Check if this level has queries
        if (obj.queries) {
          const queries = typeof obj.queries === 'object' ? Object.keys(obj.queries) : [];
          queries.forEach((q: string) => {
            const fullName = prefix ? `${prefix}.${q}` : q;
            allQueries.push(fullName);
          });
        }

        // Check for modules
        if (obj.modules) {
          const modules = typeof obj.modules === 'object' ? obj.modules : {};
          for (const [modName, modData] of Object.entries(modules)) {
            const modPrefix = prefix ? `${prefix}.${modName}` : modName;
            extractQueries(modData, modPrefix);
          }
        }

        // Also walk top-level keys that might be module names
        for (const [key, value] of Object.entries(obj)) {
          if (key === 'queries' || key === 'modules' || key === 'operations') continue;
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Could be a module
            if ((value as any).queries || (value as any).modules) {
              const modPrefix = prefix ? `${prefix}.${key}` : key;
              extractQueries(value, modPrefix);
            }
          }
        }
      }

      extractQueries(parsed);
      console.log(`Found ${allQueries.length} queries across the app structure`);
    } catch (e: any) {
      console.error('Failed to parse structure:', e.message);
    }
  }

  // If we didn't find queries from structure, use a comprehensive brute-force list
  if (allQueries.length === 0) {
    console.log('Using brute-force module probing...');

    // Known module prefixes from MNA/Chromia ecosystem
    const modules = [
      'assets', 'ft4', 'game_info', 'storefronts', 'marketplace',
      'nft', 'nfts', 'land', 'lands', 'plot', 'plots',
      'player', 'players', 'account', 'accounts',
      'crafting', 'farming', 'fishing', 'cooking',
      'inventory', 'items', 'equipment',
      'quest', 'quests', 'mission', 'missions',
      'season', 'seasons', 'event', 'events',
      'leaderboard', 'leaderboards', 'ranking', 'rankings',
      'guild', 'guilds', 'clan', 'clans',
      'trade', 'trades', 'auction', 'auctions',
      'world', 'map', 'region', 'regions', 'island', 'islands',
      'avatar', 'avatars', 'character', 'characters',
      'decoration', 'decorations', 'building', 'buildings',
      'reward', 'rewards', 'achievement', 'achievements',
      'token', 'tokens', 'balance', 'balances',
      'transaction', 'transactions', 'transfer', 'transfers',
      'config', 'settings', 'game', 'system', 'admin',
      'original', 'originals', 'collection', 'collections',
      'social', 'friend', 'friends', 'chat', 'mail',
      'pet', 'pets', 'animal', 'animals',
      'recipe', 'recipes', 'blueprint', 'blueprints',
      'shop', 'store', 'vendor',
      'weather', 'time', 'calendar',
      'rell',
    ];

    const suffixes = [
      'get_all', 'get_count', 'get_config', 'get_configs',
      'get_by_id', 'get_by_owner', 'get_by_type', 'get_by_name',
      'get_active', 'get_recent', 'get_top', 'get_list',
      'get_info', 'get_stats', 'get_status', 'get_state',
    ];

    for (const mod of modules) {
      for (const suffix of suffixes) {
        allQueries.push(`${mod}.${suffix}`);
      }
    }
  }

  // Also add the queries we already know work
  const knownWorking = [
    'assets.get_account_count',
    'game_info.get_all',
    'assets.get_all_assets',
    'assets.get_all_non_tradeable_assets',
    'storefronts.get_storefronts_configs',
  ];
  for (const q of knownWorking) {
    if (!allQueries.includes(q)) allQueries.push(q);
  }

  // Deduplicate
  const uniqueQueries = [...new Set(allQueries)];
  console.log(`\nTotal queries to probe: ${uniqueQueries.length}`);

  // Step 3: Probe each query
  console.log('\n' + '='.repeat(70));
  console.log('STEP 3: Probing queries (this may take a few minutes)');
  console.log('='.repeat(70));

  const results: {
    working: { name: string; type: string; preview: string; count?: number }[];
    paramRequired: { name: string; error: string }[];
    notFound: string[];
    otherErrors: { name: string; error: string }[];
  } = {
    working: [],
    paramRequired: [],
    notFound: [],
    otherErrors: [],
  };

  let probed = 0;
  for (const queryName of uniqueQueries) {
    probed++;
    if (probed % 50 === 0) {
      console.log(`  Progress: ${probed}/${uniqueQueries.length}...`);
    }

    try {
      const result = await client.query(queryName, {});
      const type = Array.isArray(result) ? `array[${result.length}]` : typeof result;

      let preview = '';
      if (Array.isArray(result)) {
        preview = result.length > 0
          ? JSON.stringify(result[0], (k, v) => typeof v === 'bigint' ? v.toString() : v).slice(0, 200)
          : '(empty array)';
      } else if (typeof result === 'object' && result !== null) {
        preview = JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v).slice(0, 200);
      } else {
        preview = String(result);
      }

      results.working.push({
        name: queryName,
        type,
        preview,
        count: Array.isArray(result) ? result.length : undefined,
      });

      console.log(`  ✓ ${queryName} → ${type}${Array.isArray(result) ? ` (${result.length} items)` : ''}`);
    } catch (error: any) {
      const msg = error.message || String(error);
      if (msg.includes('Unknown query') || msg.includes('not found')) {
        results.notFound.push(queryName);
      } else if (msg.includes('Missing') || msg.includes('parameter') || msg.includes('argument') || msg.includes('required')) {
        results.paramRequired.push({ name: queryName, error: msg.slice(0, 150) });
        console.log(`  ? ${queryName} → needs params: ${msg.slice(0, 80)}`);
      } else {
        results.otherErrors.push({ name: queryName, error: msg.slice(0, 150) });
        if (!msg.includes('Unknown query')) {
          console.log(`  ! ${queryName} → ${msg.slice(0, 80)}`);
        }
      }
    }

    // Small delay to avoid hammering the node
    if (probed % 10 === 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Step 4: Report
  console.log('\n' + '='.repeat(70));
  console.log('DISCOVERY RESULTS');
  console.log('='.repeat(70));

  console.log(`\n✓ WORKING (no params needed): ${results.working.length}`);
  results.working.forEach(q => {
    console.log(`  ${q.name}`);
    console.log(`    Type: ${q.type}`);
    console.log(`    Preview: ${q.preview.slice(0, 120)}`);
  });

  console.log(`\n? EXIST BUT NEED PARAMS: ${results.paramRequired.length}`);
  results.paramRequired.forEach(q => {
    console.log(`  ${q.name}`);
    console.log(`    Error: ${q.error.slice(0, 120)}`);
  });

  console.log(`\n✗ Not found: ${results.notFound.length}`);
  console.log(`! Other errors: ${results.otherErrors.length}`);

  // Save full results
  const reportPath = 'cache/chromia-discovery-results.json';
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to ${reportPath}`);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Working (free):        ${results.working.length}`);
  console.log(`  Need parameters:       ${results.paramRequired.length}`);
  console.log(`  Not found:             ${results.notFound.length}`);
  console.log(`  Other errors:          ${results.otherErrors.length}`);
  console.log(`  Total probed:          ${uniqueQueries.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
