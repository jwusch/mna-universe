import { createClient } from 'postchain-client';

/**
 * Query the Chromia Directory Chain to find My Neighbor Alice's blockchain RID
 */

const DIRECTORY_CHAIN_BRID = '7E5BE539EF62E48DDA7035867E67734A70833A69D2F162C457282C319AA58AE4';

const MAINNET_NODES = [
  'https://system.chromaway.com:7740',
  'https://dapps0.chromaway.com:7740',
  'https://chromia-mainnet.w3coins.io:7740',
];

async function main() {
  console.log('='.repeat(60));
  console.log('Searching for My Neighbor Alice Blockchain RID');
  console.log('='.repeat(60));
  console.log();

  console.log('Connecting to Chromia Directory Chain...');

  try {
    const client = await createClient({
      directoryNodeUrlPool: MAINNET_NODES,
      blockchainRid: DIRECTORY_CHAIN_BRID,
    });

    console.log('Connected!\n');

    // Get all blockchains with the correct parameter
    console.log('Fetching all blockchains...\n');
    const blockchains = await client.query('get_blockchains', { include_inactive: false });

    console.log(`Found ${blockchains.length} active blockchains\n`);

    // Look for MNA-related blockchains
    console.log('Searching for My Neighbor Alice...\n');

    for (const bc of blockchains) {
      const bcStr = JSON.stringify(bc).toLowerCase();
      if (bcStr.includes('alice') || bcStr.includes('mna') || bcStr.includes('neighbor')) {
        console.log('🎉 FOUND potential MNA blockchain:');
        console.log(JSON.stringify(bc, null, 2));
        console.log();
      }
    }

    // Also get containers and check the pink cluster (where MNA is)
    console.log('Checking containers in pink cluster (where MNA is hosted)...\n');
    const containers = await client.query('get_containers', {});

    const pinkContainers = containers.filter((c: any) => c.cluster === 'pink');
    console.log(`Found ${pinkContainers.length} containers in pink cluster\n`);

    // For each container, try to get its blockchains
    for (const container of pinkContainers.slice(0, 10)) {
      try {
        const containerBcs = await client.query('get_blockchains_for_container', {
          container_name: container.name,
        });
        if (containerBcs && containerBcs.length > 0) {
          console.log(`Container ${container.name.slice(0, 16)}... has ${containerBcs.length} blockchain(s)`);

          for (const cbc of containerBcs) {
            const cbcStr = JSON.stringify(cbc).toLowerCase();
            if (cbcStr.includes('alice') || cbcStr.includes('mna') || cbcStr.includes('neighbor')) {
              console.log('🎉 FOUND MNA!');
              console.log(JSON.stringify(cbc, null, 2));
            }
          }
        }
      } catch (e) {
        // Skip
      }
    }

    // Print first few blockchains to understand structure
    console.log('\nSample blockchain entries:');
    for (const bc of blockchains.slice(0, 5)) {
      console.log(JSON.stringify(bc, null, 2));
      console.log('---');
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

main();
