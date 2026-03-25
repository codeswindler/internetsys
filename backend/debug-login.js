const { DataSource } = require('typeorm');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function debug() {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pulselynk',
  });

  try {
    await ds.initialize();
    console.log('✅ Connected to MariaDB');
    
    // 1. Check if the user exists
    const admin = (await ds.query("SELECT * FROM admins WHERE username = 'pulselynk'"))[0];
    if (!admin) {
      console.error('❌ ERROR: User "pulselynk" not found in database!');
      process.exit(1);
    }
    
    console.log('✅ Found admin:', admin.username, '(' + admin.email + ')');
    
    // 2. Test the password
    const testPass = 'lynkmepulse26';
    const isMatch = await bcrypt.compare(testPass, admin.passwordHash);
    
    if (isMatch) {
      console.log('✅ SUCCESS: The password "lynkmepulse26" matches the database hash!');
    } else {
      console.error('❌ FAILURE: The password does not match the hash in the database.');
      console.log('Database Hash:', admin.passwordHash);
    }
    
    process.exit();
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    process.exit(1);
  }
}

debug();
