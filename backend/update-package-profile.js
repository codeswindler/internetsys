const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

async function updatePackage() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'internetsys',
    });

    console.log('Updating flash step package profile to default...');
    const [result] = await connection.execute(
      "UPDATE packages SET bandwidthProfile = 'default' WHERE name = 'flash step'"
    );
    console.log('Affected rows:', result.affectedRows);

    await connection.end();
  } catch (error) {
    console.error('Update failed:', error);
  }
}

updatePackage();
