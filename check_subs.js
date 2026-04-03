const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'internetsys'
  });

  console.log('--- Subscriptions in Database ---');
  const [rows] = await connection.execute('SELECT id, userId, packageId, status, startedAt, expiresAt, createdAt FROM subscriptions ORDER BY createdAt DESC LIMIT 20');
  console.table(rows);

  // Check if there are any that match the logic in findAllActive
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log('\n--- Actionable Subscriptions (Hand-rolled SQL) ---');
  console.log('Current UTC Time:', now);
  const [actionable] = await connection.execute(`
    SELECT id, status, expiresAt FROM subscriptions 
    WHERE status = 'pending' 
       OR (status = 'active' AND (expiresAt IS NULL OR expiresAt > ?))
  `, [now]);
  console.table(actionable);

  await connection.end();
}

check().catch(console.error);
