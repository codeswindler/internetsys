const bcrypt = require('bcrypt');
async function testBcrypt() {
  try {
    const hash = await bcrypt.hash('test', 10);
    console.log('Bcrypt hash successful:', hash);
    const match = await bcrypt.compare('test', hash);
    console.log('Bcrypt compare successful:', match);
  } catch (error) {
    console.error('Bcrypt error:', error);
  }
}
testBcrypt();
