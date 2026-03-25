const http = require('http');

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'GET',
      headers: { ...headers }
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
    req.end();
  });
}

function post(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
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

    const profiles = await get('http://localhost:3000/routers/sync/all-profiles', {
      Authorization: `Bearer ${login.access_token}`
    });
    console.log('Unique Profiles found:', profiles);
    
    // We expect 'premium test' (Hotspot) AND 'default' (PPP) to be there.
    if (profiles.includes('premium test') && profiles.includes('default')) {
      console.log('VERIFICATION SUCCESS: Both Hotspot and PPP profiles found.');
    } else {
      console.log('VERIFICATION FAILED: Missing profiles in the list.');
    }
  } catch (e) {
    console.error('Failed:', e.message);
  }
}

run();
