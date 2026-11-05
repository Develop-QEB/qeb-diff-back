// PM2 ecosystem para qeb-diff-back.
//
// Primer deploy en el VPS:
//   cd /ruta/a/qeb-diff-back
//   npm install
//   npm run build
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
// Actualizaciones:
//   git pull
//   npm install
//   npm run build
//   pm2 reload qeb-diff-back --update-env

module.exports = {
  apps: [
    {
      name: 'qeb-diff-back',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '600M',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      time: true,
    },
  ],
};
