const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'RootPass123!',
    database: 'pulselynk'
  });

  console.log('--- SEARCHING FOR WILSON ---');
  const [users] = await conn.execute("SELECT id, name, username FROM users WHERE name LIKE '%wilson%' OR username LIKE '%wilson%'");
  console.log('Users found:', users);

  if (users.length > 0) {
    const userIds = users.map(u => u.id);
    const placeholders = userIds.map(() => '?').join(',');
    console.log(`--- SUBSCRIPTIONS FOR FOUND USERS (${userIds.join(', ')}) ---`);
    const [subs] = await conn.execute(`SELECT s.id, s.status, s.packageId, p.name as packageName FROM subscriptions s LEFT JOIN packages p ON s.packageId = p.id WHERE s.userId IN (${placeholders})`, userIds);
    console.log('Subscriptions:', subs);
  } else {
    console.log('No user found containing "wilson"');
  }

  await conn.end();
}

run().catch(console.error);
