import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Databases } from 'node-appwrite';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = 'presences_db';

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);
const databases = new Databases(appwrite);

async function main() {
  console.log('=== Supabase Sample URLs ===');
  const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url, photo_url').limit(10);
  console.log('Profiles sample:');
  for (const p of profiles || []) {
    console.log(`- ID: ${p.id}, name: ${p.full_name}, avatar: ${p.avatar_url}, photo: ${p.photo_url}`);
  }

  const { data: faces } = await supabase.from('face_descriptors').select('id, user_id, image_url').limit(10);
  console.log('\nFace Descriptors sample:');
  for (const f of faces || []) {
    console.log(`- ID: ${f.id}, user: ${f.user_id}, image_url: ${f.image_url}`);
  }

  const { data: att } = await supabase.from('attendance_records').select('id, user_id, image_url, device_info').limit(10);
  console.log('\nAttendance Records sample:');
  for (const a of att || []) {
    console.log(`- ID: ${a.id}, user: ${a.user_id}, image_url: ${a.image_url}, device_info.photo: ${a.device_info?.avatar_url || a.device_info?.photo_url || a.device_info?.image_url}`);
  }
}

main().catch(console.error);
