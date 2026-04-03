const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/internetsys' });

async function run() {
  await client.connect();
  try {
    // 1. Find User (using the ID from the logs)
    const userId = '2c242abd-292d-44fb-b2a6-19c0a91af8db';
    const userRes = await client.query('SELECT * FROM "user" WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      console.error('User not found: ' + userId);
      return;
    }
    const user = userRes.rows[0];
    console.log('Found User:', user.phone);

    // 2. Find a Package
    const pkgRes = await client.query('SELECT id, name FROM package LIMIT 1');
    const pkg = pkgRes.rows[0];
    if (!pkg) {
      console.error('No packages found');
      return;
    }
    console.log('Using Package:', pkg.name);

    // 3. Find a Router
    const routerRes = await client.query('SELECT id, name FROM router LIMIT 1');
    const router = routerRes.rows[0];
    if (!router) {
      console.error('No routers found');
      return;
    }
    console.log('Using Router:', router.name);

    // 4. Create Active Subscription
    const subId = crypto.randomUUID();
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour later
    
    await client.query(
      `INSERT INTO subscriptions (id, "userId", "packageId", "routerId", status, "startedAt", "expiresAt", "amountPaid", "createdAt", "updatedAt") 
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, 100.00, NOW(), NOW())`,
      [subId, userId, pkg.id, router.id, now, expires]
    );

    console.log('SUCCESS: Assigned 1hr ACTIVE subscription to', user.phone);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
