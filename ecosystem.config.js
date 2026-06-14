// PM2 process manifest. Used by `pm2 startOrReload ecosystem.config.js`.
module.exports = {
  apps: [
    {
      name: 'filemanager',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p ' + (process.env.PORT || 3000),
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      watch: false,
      kill_timeout: 5000,
      out_file: './pm2-out.log',
      error_file: './pm2-err.log'
    },
    {
      // Standalone WebSocket gateway (wss://<host>/api/v1/ws). Independent of the
      // main app — if it restarts, the site stays up. nginx proxies /api/v1/ws here.
      name: 'filemanager-ws',
      script: 'server/ws-gateway.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        WS_PORT: process.env.WS_PORT || 3001
      },
      autorestart: true,
      watch: false,
      out_file: './pm2-ws-out.log',
      error_file: './pm2-ws-err.log'
    }
  ]
};
