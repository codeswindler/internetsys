const http = require('http');

function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        else resolve(JSON.parse(body));
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  try {
    const login = await post('http://localhost:3000/auth/admin/login', {
      email: 'admin@internetsys.com',
      password: 'RootPass123!'
    });
    console.log('Login success');

    const result = await post('http://localhost:3000/subscriptions/allocate', {
      userId: '644fe4f3-47c4-430f-956f-e44eb74688ef',
      packageId: '7859f109-3dfb-4940-8d25-9b259f8647b0',
      routerId: '9762528d-9011-4dc1-a897-bb552eb06894'
    }, { Authorization: `Bearer ${login.access_token}` });
    console.log('Allocation result:', result);
  } catch (e) {
    console.error('Failed:', e.message);
  }
}

run();
