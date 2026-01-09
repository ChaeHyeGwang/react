// PM2 설정 파일
module.exports = {
  apps: [
    {
      // 운영 서버
      name: 'attendance-prod',
      script: 'index.js',
      cwd: './server',
      env: {
        NODE_ENV: 'production',
        PORT: 5001,
        DB_PATH: './database/management_system_prod.db'
      },
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
      error_file: './server/logs/prod-error.log',
      out_file: './server/logs/prod-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};

