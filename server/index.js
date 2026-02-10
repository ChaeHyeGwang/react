const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();
const { initSocket } = require('./socket');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const identityRoutes = require('./routes/identities');
const siteRoutes = require('./routes/sites');
const communityRoutes = require('./routes/communities');
const settlementRoutes = require('./routes/settlements');
const drbetRoutes = require('./routes/drbet');
const finishRoutes = require('./routes/finish');
const telegramRoutes = require('./routes/telegram');
const siteNotesRoutes = require('./routes/siteNotes');
const statisticsRoutes = require('./routes/statistics');
const backupRoutes = require('./routes/backup');
const officeRoutes = require('./routes/offices');
const calendarRoutes = require('./routes/calendar');
const attendanceRoutes = require('./routes/attendance');
const communityNotesRoutes = require('./routes/communityNotes');
const auditLogRoutes = require('./routes/auditLogs');
const { startScheduler } = require('./tools/backup-scheduler');
const { cleanupOldAuditLogs } = require('./utils/auditLog');
const apiLogger = require('./middleware/apiLogger');
const routeNamer = require('./middleware/routeNamer');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Socket.IO 초기화
const io = initSocket(server);

// Trust proxy 설정 (rate limiter를 위해)
app.set('trust proxy', 1);

// 보안 미들웨어 (HSTS 비활성화 - HTTP 접속 허용)
app.use(helmet({
  hsts: false, // HTTPS 강제하지 않음
  contentSecurityPolicy: false // CSP 비활성화 (개발 환경)
}));
// 로컬 네트워크 접근을 위한 CORS 설정 (ngrok 포함)
app.use(cors({
  origin: function(origin, callback) {
    // 로컬 네트워크(192.168.x.x), localhost, ngrok 허용
    if (!origin || 
        origin.includes('localhost') || 
        origin.includes('127.0.0.1') ||
        origin.includes('ngrok.io') ||
        origin.includes('ngrok-free.app') ||
        origin.match(/^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));

// Rate limiting (개발 환경에서는 느슨하게 설정)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 1000, // 최대 1000 요청 (개발용)
  skip: (req) => {
    // 로컬 네트워크에서의 요청은 Rate Limit 제외
    const ip = req.ip || req.connection.remoteAddress;
    return ip === '::1' || ip === '127.0.0.1' || ip.includes('192.168');
  }
});
app.use(limiter);

// 로깅 (프로덕션에서는 최소화)
if (process.env.NODE_ENV === 'production') {
  // 프로덕션: 에러만 로깅
  app.use(morgan('combined', {
    skip: (req, res) => res.statusCode < 400
  }));
} else {
  // 개발: 모든 요청 로깅
  app.use(morgan('combined'));
}

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Socket.IO: 요청 헤더에서 소켓 ID 추출하여 req에 저장 (자기 자신에게 이벤트 전송 방지)
app.use((req, res, next) => {
  req.socketId = req.headers['x-socket-id'] || null;
  next();
});

// 라우트 한글 이름 태깅 → API 로그
app.use(routeNamer);
app.use(apiLogger);

// 그룹 태그 미들웨어
const tag = (name) => (req, res, next) => { req.apiNamePrefix = name; next(); };

// 라우트 설정
app.use('/api/auth', tag('AUTH'), authRoutes);
app.use('/api/users', tag('USERS'), userRoutes);
app.use('/api/identities', tag('IDENTITIES'), identityRoutes);
app.use('/api/sites', tag('SITES'), siteRoutes);
app.use('/api/communities', tag('COMMUNITIES'), communityRoutes);
app.use('/api/settlements', tag('SETTLEMENTS'), settlementRoutes);
app.use('/api/drbet', tag('DRBET'), drbetRoutes);
app.use('/api/finish', tag('FINISH'), finishRoutes);
app.use('/api/telegram', tag('TELEGRAM'), telegramRoutes);
app.use('/api/site-notes', tag('SITE_NOTES'), siteNotesRoutes);
app.use('/api/statistics', tag('STATISTICS'), statisticsRoutes);
app.use('/api/backup', tag('BACKUP'), backupRoutes);
app.use('/api/offices', tag('OFFICES'), officeRoutes);
app.use('/api/calendar', tag('CALENDAR'), calendarRoutes);
app.use('/api/attendance', tag('ATTENDANCE'), attendanceRoutes);
app.use('/api/community-notes', tag('COMMUNITY_NOTES'), communityNotesRoutes);
app.use('/api/audit-logs', tag('AUDIT_LOGS'), auditLogRoutes);

// 기본 라우트
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: '출석 관리 시스템 API 서버',
    timestamp: new Date().toISOString()
  });
});

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: '서버 내부 오류가 발생했습니다.',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 프론트엔드 정적 파일 서빙 (프로덕션 빌드)
const clientBuildPath = path.join(__dirname, '../client/build');
const fs = require('fs');

if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  
  // React Router를 위한 fallback: 모든 라우트를 index.html로
  app.get('*', (req, res) => {
    // API 라우트는 제외
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  // 빌드 폴더가 없으면 API만 서빙
  app.use('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
    } else {
      res.status(404).send('프론트엔드가 빌드되지 않았습니다. client 폴더에서 npm run build를 실행하세요.');
    }
  });
}

// 비동기 서버 시작
(async () => {
  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 출석 관리 시스템 API 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📊 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`🌐 네트워크 접속: http://[로컬IP]:${PORT}/api/health`);
    
    // 자동 백업 스케줄러 시작 (매일 03:00, 14일 보관)
    try {
      startScheduler({ time: '0 3 * * *', retentionDays: 14 });
    } catch (e) {
      console.error('백업 스케줄러 시작 실패:', e);
    }

    // 감사 로그 자동 정리 (90일 이상 오래된 로그 삭제)
    try {
      await cleanupOldAuditLogs();
      console.log('📋 감사 로그 정리 완료');
    } catch (e) {
      console.error('감사 로그 정리 실패:', e);
    }
  });
})();
