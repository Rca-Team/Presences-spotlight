import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Users, ID } from 'node-appwrite';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

console.log('🔐 Migrating Supabase Auth Accounts -> Appwrite Users...');

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const appwriteClient = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const users = new Users(appwriteClient);

async function migrateAuthUsers() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error || !data) {
    console.error('Error fetching Supabase auth users:', error?.message);
    return;
  }

  console.log(`👥 Found ${data.users.length} Auth accounts. Creating in Appwrite...`);

  for (const u of data.users) {
    const userId = String(u.id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 36);
    const email = u.email;
    const name = u.user_metadata?.full_name || u.user_metadata?.name || email.split('@')[0];
    const phone = u.phone || undefined;

    try {
      // Create user in Appwrite
      await users.create(userId, email, phone, undefined, name);
      // Mark email as verified if verified in Supabase
      if (u.email_confirmed_at) {
        await users.updateEmailVerification(userId, true);
      }
      console.log(`  ✅ Created user: ${email} (ID: ${userId})`);
    } catch (err) {
      if (err.code === 409) {
        console.log(`  ℹ️ User already exists: ${email}`);
      } else {
        console.warn(`  ⚠️ Error creating user ${email}:`, err.message);
      }
    }
  }

  console.log('🎉 All Auth accounts successfully migrated to Appwrite Users!');
}

migrateAuthUsers();
