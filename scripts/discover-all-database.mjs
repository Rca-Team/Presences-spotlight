import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const candidateTables = [
  'profiles',
  'face_descriptors',
  'attendance_records',
  'notifications',
  'emergency_events',
  'subjects',
  'timetable',
  'user_roles',
  'roles',
  'permissions',
  'role_permissions',
  'gate_passes',
  'substitutions',
  'device_telemetry',
  'face_samples',
  'attendance_cutoffs',
  'parent_contacts',
  'email_queue',
  'email_logs',
  'system_settings',
  'jarvis_conversations',
  'jarvis_memories',
  'jarvis_actions',
  'visitors',
  'classes',
  'sections',
  'teacher_assignments',
  'students',
  'teachers',
  'audit_logs'
];

async function main() {
  console.log('=== Checking Supabase Database Tables ===\n');
  
  const foundTables = [];
  for (const t of candidateTables) {
    try {
      const { count, error, data } = await supabase.from(t).select('*', { count: 'exact', head: true });
      if (!error) {
        // Also fetch 1 sample row to see schema
        const { data: sample } = await supabase.from(t).select('*').limit(1);
        const cols = sample && sample[0] ? Object.keys(sample[0]) : [];
        console.log(`✅ Table "${t}": ${count ?? 0} rows | Columns: [${cols.join(', ')}]`);
        foundTables.push({ name: t, count: count ?? 0, cols, sample: sample?.[0] });
      } else {
        // Not found or error
        if (!error.message.includes('relation') && !error.message.includes('does not exist')) {
          console.log(`⚠️ Table "${t}" error: ${error.message}`);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Also check auth.users count
  const { data: { users }, error: authErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  console.log(`\n👥 Supabase Auth Users: ${users ? users.length : 0} users found`);
  if (users && users.length > 0) {
    console.log('Sample Auth User:', { id: users[0].id, email: users[0].email, created_at: users[0].created_at });
  }

  console.log('\nFound tables summary:', foundTables.map(t => ({ name: t.name, count: t.count })));
}

main().catch(console.error);
