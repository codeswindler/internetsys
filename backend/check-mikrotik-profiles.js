const { RouterOSAPI } = require('routeros');

async function checkProfiles() {
  const api = new RouterOSAPI({
    host: '192.168.100.113',
    user: 'admin',
    password: 'ww',
    port: 8728,
    timeout: 5,
  });

  try {
    console.log(`Connecting to ${api.options.host}...`);
    await api.connect();
    console.log('Successfully connected to MikroTik.');

    console.log('\n--- Hotspot User Profiles ---');
    const hotspotProfiles = await api.write('/ip/hotspot/user/profile/print');
    console.log(hotspotProfiles.map(p => p.name));

    console.log('\n--- PPP Profiles ---');
    const pppProfiles = await api.write('/ppp/profile/print');
    console.log(pppProfiles.map(p => p.name));

  } catch (error) {
    console.error('Operation failed:', error.message || error);
  } finally {
    try {
      await api.close();
      console.log('Connection closed.');
    } catch (e) {}
  }
}

checkProfiles();
