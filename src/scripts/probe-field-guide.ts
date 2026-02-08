import { createClient } from 'postchain-client';

const NODE_URLS = 'https://dapps0.chromaway.com:7740';
const BRID = process.env.MNA_BLOCKCHAIN_RID || 'F31D7A38B33D12A5D948EE9CF170983A7CA5EFFFAAA31094C5B9CF94442D9FA2';

async function main() {
  const client = await createClient({ nodeUrlPool: NODE_URLS, blockchainRid: BRID });

  console.log('=== LOOT TABLES ===');
  const lootTables = await client.query('loot_tables.get_loot_tables', {});
  console.log(JSON.stringify(lootTables, null, 2));

  console.log('\n=== NODE PROTOTYPES ===');
  const nodePrototypes = await client.query('plot_nodes.get_node_prototypes', {});
  console.log(JSON.stringify(nodePrototypes, null, 2));

  // Also grab tools since nodes require tools
  console.log('\n=== TOOLS ===');
  const tools = await client.query('tools.get_all_tools_attributes', {});
  console.log(JSON.stringify(tools, null, 2));
}

main().catch(console.error);
