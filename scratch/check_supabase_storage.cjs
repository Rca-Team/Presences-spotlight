const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';

async function listSupabaseBuckets() {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  console.log('Buckets status:', res.status);
  const data = await res.json();
  console.log('Buckets:', data);

  for (const b of data) {
    const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${b.name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefix: '', limit: 20 })
    });
    const items = await listRes.json();
    console.log(`Bucket ${b.name}: ${Array.isArray(items) ? items.length : 0} items at root`, Array.isArray(items) ? items.map(i => i.name) : items);
  }
}

listSupabaseBuckets().catch(console.error);
