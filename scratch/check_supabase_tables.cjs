const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';

const tables = [
  'profiles',
  'attendance_records',
  'timetable',
  'attendance_settings',
  'emergency_events',
  'face_descriptors',
  'user_roles',
  'notifications'
];

async function checkSupabase() {
  for (const table of tables) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'count=exact'
        }
      });
      const range = res.headers.get('content-range');
      console.log(`${table}: status ${res.status}, count: ${range}`);
    } catch (e) {
      console.log(`${table} error:`, e.message);
    }
  }
}

checkSupabase();
