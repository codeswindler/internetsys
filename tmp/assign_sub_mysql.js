const mysql = require('mysql2/promise');

async function run() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'RootPass123!',
    database: 'pulselynk'
  });
  try {
    const userId = '2c242abd-292d-44fb-b2a6-19c0a91af8db';
    
    // 1. Get a Package
    const [pkgs] = await connection.execute('SELECT id, name FROM package LIMIT 1');
    const pkg = pkgs[0];
    if (!pkg) throw new Error('No packages found');

    // 2. Get a Router
    const [routers] = await connection.execute('SELECT id, name FROM router LIMIT 1');
    const router = routers[0];
    if (!router) throw new Error('No routers found');

    // 3. Insert Subscription
    const subId = require('crypto').randomUUID();
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000);
    
    // Format dates for MySQL
    const toSqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

    await connection.execute(
      `INSERT INTO subscriptions (id, userId, packageId, routerId, status, startedAt, expiresAt, amountPaid, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 100.00, NOW(), NOW())`,
      [subId, userId, pkg.id, router.id, toSqlDate(now), toSqlDate(expires)]
    );

    console.log(`SUCCESS: Assigned 1hr ACTIVE subscription to user ${userId}`);
    console.log(`Using Package: ${pkg.name}, Router: ${router.name}`);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await connection.end();
  }
}

run();
