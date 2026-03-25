const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');

async function testStartup() {
  console.log('Starting NestJS application test...');
  try {
    const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log', 'debug', 'verbose'] });
    console.log('NestJS application created successfully.');
    await app.init();
    console.log('NestJS application initialized successfully.');
    await app.close();
    console.log('NestJS application closed successfully.');
  } catch (error) {
    console.error('CRITICAL ERROR DURING STARTUP:');
    console.error(error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testStartup();
