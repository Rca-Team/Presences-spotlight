async function testProxySession() {
  // 1. Login to get cookie
  const loginRes = await fetch('https://www.presences.dev/api/appwrite/v1/account/sessions/email', {
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
  console.log('Login status:', loginRes.status);
  const cookieHeader = loginRes.headers.get('set-cookie');
  console.log('Set-Cookie received:', !!cookieHeader);

  // Extract the cookie to send
  const cookie = cookieHeader.split(';')[0];
  console.log('Cookie string:', cookie.substring(0, 40) + '...');

  // 2. Fetch account with cookie
  const accRes = await fetch('https://www.presences.dev/api/appwrite/v1/account', {
    headers: {
      'X-Appwrite-Project': '6ad309e200176195d398',
      'Cookie': cookie
    }
  });
  console.log('Account status with cookie:', accRes.status);
  const accData = await accRes.json();
  console.log('Account data:', accData.$id, accData.email, accData.labels);
}

testProxySession().catch(console.error);
