const mysql = require('mysql2/promise');
const axios = require('axios');
const https = require('https');
const dotenv = require('dotenv');
dotenv.config();

async function precheck() {
  console.log('--- PULSELYNK PRE-CHECK ---');

  // 1. Database Check
  console.log('\n[1/3] Checking Database...');
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'pulselynk',
    });
    console.log('✅ Connected to MySQL.');
    
    const [rows] = await connection.execute('SELECT id, name, vpnUsername FROM routers WHERE vpnUsername = ?', ['pulselynk']);
    if (rows.length > 0) {
      console.log(`✅ Found router "${rows[0].name}" with vpnUsername "pulselynk" in DB.`);
    } else {
      console.log('❌ Could NOT find router with vpnUsername "pulselynk" in database.');
    }
    await connection.end();
  } catch (error) {
    console.error('❌ Database check failed:', error.message);
  }

  // 2. SoftEther API Check
  console.log('\n[2/3] Checking SoftEther API...');
  const vpnUrl = `https://${process.env.VPN_HOST || 'localhost'}:${process.env.VPN_PORT || '5555'}/api`;
  try {
    const response = await axios.post(vpnUrl, {
      jsonrpc: '2.0',
      id: '1',
      method: 'GetServerInfo',
      params: {},
    }, {
      headers: { 'X-VPNADMIN-PASSWORD': process.env.VPN_ADMIN_PASSWORD },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 5000
    });
    console.log('✅ Successfully connected to SoftEther API.');
  } catch (error) {
    console.error('❌ SoftEther API check failed. Check VPN_HOST, VPN_PORT, and VPN_ADMIN_PASSWORD.');
    console.error('Error:', error.message);
  }

  // 3. VPN User Check
  console.log('\n[3/3] Checking for VPN User "pulselynk"...');
  try {
    const response = await axios.post(vpnUrl, {
      jsonrpc: '2.0',
      id: '1',
      method: 'GetUser',
      params: {
        HubName_str: 'DEFAULT',
        Name_str: 'pulselynk',
      },
    }, {
      headers: { 'X-VPNADMIN-PASSWORD': process.env.VPN_ADMIN_PASSWORD },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
    
    if (response.data.result) {
      console.log('✅ User "pulselynk" EXISTS in SoftEther.');
    } else {
      console.log('❌ User "pulselynk" does NOT exist in SoftEther yet.');
    }
  } catch (error) {
    console.log('❌ Could not find user "pulselynk" in SoftEther.');
  }

  console.log('\n--- PRE-CHECK COMPLETE ---');
}

precheck();
