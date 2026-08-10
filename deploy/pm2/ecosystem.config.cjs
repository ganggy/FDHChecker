module.exports = {
  apps: [{
    name: 'fdh-checker-api',
    cwd: '/opt/FDHChecker',
    script: 'server/dist/server/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    kill_timeout: 35000,
    listen_timeout: 10000,
    env: {
      NODE_ENV: 'production',
      PORT: 3506,
    },
    output: '/var/log/fdh-checker/api-output.log',
    error: '/var/log/fdh-checker/api-error.log',
    merge_logs: true,
    time: true,
  }],
};
