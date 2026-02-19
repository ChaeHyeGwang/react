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
        DB_PATH: './database/management_system.db'
      },
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',  // 메모리 제한 증가
      node_args: '--max-old-space-size=1024',  // Node.js 힙 메모리 증가 (1GB)
      error_file: './server/logs/prod-error.log',
      out_file: './server/logs/prod-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};

