const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

async function testConnection() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'internetsys',
    });
    console.log('Successfully connected to the database.');
    await connection.end();
  } catch (error) {
    console.error('Database connection failed:', error);
  }
}

testConnection();
