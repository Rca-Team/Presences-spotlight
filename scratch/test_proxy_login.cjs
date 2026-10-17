async function testProxyLogin() {
  try {
    const res = await fetch('https://www.presences.dev/api/appwrite/v1/account/sessions/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': '6ad309e200176195d398'
      },
      body: JSON.stringify({
        email: 'atl@gmail.com',
        password: 'Kvatl@123'
      })
    });
    console.log('Proxy Login Status:', res.status);
    const data = await res.json();
    console.log('Proxy Login Response:', data);
    console.log('Set-Cookie:', res.headers.get('set-cookie'));
  } catch (e) {
    console.error('Proxy Login Error:', e);
  }
}
testProxyLogin();
