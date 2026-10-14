async function testFetch() {
  const url = 'https://sgp.cloud.appwrite.io/v1/storage/buckets/face-images/files/kvs-emblem.png/view?project=6accbd5d00053c5c1ac2';
  const res = await fetch(url);
  console.log('HTTP Status:', res.status, 'Content-Type:', res.headers.get('content-type'), 'Length:', res.headers.get('content-length'));
}

testFetch().catch(console.error);
