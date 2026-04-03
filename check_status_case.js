const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'internetsys'
  });

  console.log('--- Subscriptions Status Case Check ---');
  const [rows] = await connection.execute('SELECT DISTINCT status FROM subscriptions');
  console.log('Unique status values in DB:', rows.map(r => `"${r.status}"`));

  const [samples] = await connection.execute('SELECT id, status FROM subscriptions LIMIT 5');
  console.table(samples);

  await connection.end();
}

check().catch(console.error);
