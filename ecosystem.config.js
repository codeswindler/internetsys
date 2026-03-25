module.exports = {
  apps: [
    {
      name: 'pulselynk-api',
      script: 'dist/main.js',
      cwd: './backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
      }
    }
  ]
};
