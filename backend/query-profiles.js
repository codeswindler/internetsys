const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

async function queryData() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'internetsys',
    });

    console.log('\n--- Routers ---');
    const [routers] = await connection.execute('SELECT name, id, host, apiUsername, apiPasswordEncrypted, connectionMode FROM routers');
    console.log(routers);

    console.log('\n--- Users ---');
    const [users] = await connection.execute("SELECT id, name FROM users WHERE name LIKE '%sammy%' OR name LIKE '%william%'");
    console.log(users);

    await connection.end();
  } catch (error) {
    console.error('Query failed:', error);
  }
}

queryData();
