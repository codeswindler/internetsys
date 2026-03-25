const mysql = require('mysql2/promise');

async function verify() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'internetsys'
  });

  console.log('--- Transactions in Database ---');
  const [rows] = await connection.execute('SELECT * FROM transactions ORDER BY createdAt DESC LIMIT 10');
  console.table(rows);

  if (rows.length > 0) {
    console.log('✅ Found ' + rows.length + ' transactions.');
  } else {
    console.log('❌ No transactions found.');
  }

  await connection.end();
}

verify().catch(console.error);
