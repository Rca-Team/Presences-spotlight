import { Client, Functions, Permission, Role } from 'node-appwrite';
import fs from 'fs';
import path from 'path';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const functions = new Functions(appwrite);

const supabaseFunctionsDir = path.join(process.cwd(), 'supabase', 'functions');

async function getFunctionDirs() {
  if (!fs.existsSync(supabaseFunctionsDir)) return [];
  const entries = fs.readdirSync(supabaseFunctionsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => ({
      id: e.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 36),
      name: e.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      originalDir: e.name
    }));
}

async function main() {
  console.log('================================================================');
  console.log('⚡ APPWRITE EDGE FUNCTIONS PROVISIONING & MIGRATION');
  console.log('================================================================\n');

  const existingList = await functions.list();
  const existingMap = new Map(existingList.functions.map(f => [f.$id, f]));
  console.log(`Found ${existingList.total} existing functions in Appwrite.`);

  const funcList = await getFunctionDirs();
  console.log(`Found ${funcList.length} edge functions in repository to provision.\n`);

  let createdCount = 0;
  let alreadyExists = 0;

  for (const fn of funcList) {
    if (existingMap.has(fn.id)) {
      console.log(`  ✓ Function already registered: ${fn.name} (ID: ${fn.id})`);
      alreadyExists++;
      continue;
    }

    try {
      // Create function with any execution permission, node-22 runtime
      const created = await functions.create(
        fn.id,
        fn.name,
        'node-22',
        ['any'],
        [], // events
        '', // schedule
        15, // timeout (15s)
        true // enabled
      );
      console.log(`  ✅ Successfully created Function: ${created.name} (ID: ${created.$id})`);
      createdCount++;
    } catch (err) {
      if (err.code === 409) {
        console.log(`  ✓ Function already exists: ${fn.name} (ID: ${fn.id})`);
        alreadyExists++;
      } else {
        console.warn(`  ⚠️ Failed to create ${fn.name} (${fn.id}):`, err.message);
      }
    }
  }

  console.log('\n================================================================');
  console.log(`🎉 EDGE FUNCTIONS SYNC COMPLETE!`);
  console.log(`  Created: ${createdCount}`);
  console.log(`  Existing/Ready: ${alreadyExists}`);
  console.log(`  Total Registered: ${createdCount + alreadyExists}/${funcList.length}`);
  console.log('================================================================\n');

  // Verify list
  const finalList = await functions.list();
  console.log(`Verified Total Appwrite Functions in Cloud: ${finalList.total}`);
  for (const f of finalList.functions) {
    console.log(` - [${f.$id}] ${f.name} (Runtime: ${f.runtime}, Status: ${f.enabled ? 'Enabled' : 'Disabled'})`);
  }
}

main().catch(console.error);
