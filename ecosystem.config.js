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
    }
  ]
};
