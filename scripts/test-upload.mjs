import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);
const storage = new Storage(appwrite);

async function test() {
  console.log('Testing upload to database-exports...');
  const { data: blob, error } = await supabase.storage.from('database_export_01_08_26').download('hello-friend-presence_260801.backup');
  console.log('Supabase download:', { size: blob?.size, error });
  if (!blob) return;

  const buffer = Buffer.from(await blob.arrayBuffer());
  const inputFile = InputFile.fromBuffer(buffer, 'hello-friend-presence_260801.backup');
  try {
    const res = await storage.createFile('database-exports', 'hello_friend_presence_260801', inputFile);
    console.log('Appwrite upload success:', res.$id);
  } catch (err) {
    console.error('Appwrite upload error:', err);
  }
}

test();
