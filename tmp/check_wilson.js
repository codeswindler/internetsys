const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'RootPass123!',
      database: 'pulselynk'
    });
    const [users] = await conn.execute('SELECT id, username, name FROM users');
    console.log('--- ALL USERS ---');
    console.log(users);
    
    // Look for Wilson
    const wilson = users.find(u => (u.name && u.name.toLowerCase().includes('wilson')) || (u.username && u.username.toLowerCase().includes('wilson')));
    if (wilson) {
      console.log('--- WILSON FOUND ---', wilson.id);
      const [subs] = await conn.execute('SELECT id, status, startedAt, expiresAt, packageId FROM subscriptions WHERE userId = ?', [wilson.id]);
      console.log('--- WILSON SUBS ---');
      console.log(subs);
    } else {
      console.log('Wilson not found by name. Checking all active subs...');
      const [activeSubs] = await conn.execute('SELECT s.id, s.status, s.userId, u.name as userName FROM subscriptions s LEFT JOIN users u ON s.userId = u.id WHERE s.status IN ("ACTIVE", "active")');
      console.log('--- ALL ACTIVE SUBS ---');
      console.log(activeSubs);
    }
    await conn.end();
  } catch (err) {
    console.error(err);
  }
}
run();
