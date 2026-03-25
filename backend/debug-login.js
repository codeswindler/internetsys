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
    
    const isReset = process.argv.includes('--reset');
    const testPass = 'lynkmepulse26';

    if (isReset) {
      console.log('🔄 Resetting password to: ' + testPass);
      const newHash = await bcrypt.hash(testPass, 10);
      await ds.query("UPDATE admins SET username = 'pulselynk', passwordHash = ? WHERE username = 'pulselynk' OR id = '3fcd8064-9661-47ce-9aa0-988e21937ac4'", [newHash]);
      console.log('✅ Reset complete!');
    }

    // 1. Check if the user exists
    let admin = (await ds.query("SELECT * FROM admins WHERE username = 'pulselynk' OR email = 'admin@pulselynk.co.ke'"))[0];
    
    if (!admin) {
      console.log('📝 User "pulselynk" not found. Creating default admin...');
      const newHash = await bcrypt.hash(testPass, 10);
      await ds.query(
        "INSERT INTO admins (id, username, email, passwordHash, phone) VALUES (?, ?, ?, ?, ?)",
        ['3fcd8064-9661-47ce-9aa0-988e21937ac4', 'pulselynk', 'admin@pulselynk.co.ke', newHash, '0700000000']
      );
      console.log('✅ Default admin created!');
      admin = (await ds.query("SELECT * FROM admins WHERE username = 'pulselynk'"))[0];
    }
    
    console.log('✅ Found admin:', admin.username, '(' + admin.email + ')');
    
    // 2. Test the password
    const isMatch = await bcrypt.compare(testPass, admin.passwordHash);
    
    if (isMatch) {
      console.log('✅ SUCCESS: The password "' + testPass + '" matches the database hash!');
    } else {
      console.error('❌ FAILURE: The password does not match the hash in the database.');
      console.log('Database Hash:', admin.passwordHash);
      console.log('👉 Tip: Run: node debug-login.js --reset');
    }
    
    process.exit();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

debug();
