import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Users, ID } from 'node-appwrite';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY0NDkwNywiZXhwIjoyMTAzMjIwOTA3fQ.tdJw7UsAe1zSgettFQO-HVxGftgWM3f0j9tqgqeMZ3U';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

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
