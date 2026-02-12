/**
 * Socket.IO 서버 모듈
 * - 실시간 데이터 동기화
 * - 편집 중 표시 (다른 사용자 편집 감지)
 * - 데이터 변경 알림
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;

// 현재 편집 중인 사용자 추적: { "페이지:섹션:recordId" -> { socketId, userId, displayName, startedAt } }
const activeEditors = new Map();

/**
 * Socket.IO 서버 초기화
 * @param {http.Server} httpServer - HTTP 서버 인스턴스
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: function (origin, callback) {
        if (!origin ||
          origin.includes('localhost') ||
          origin.includes('127.0.0.1') ||
          origin.includes('ngrok.io') ||
          origin.includes('ngrok-free.app') ||
          /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true
    },
    // 연결 안정성
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // 인증 미들웨어
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('인증 토큰이 필요합니다'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('유효하지 않은 토큰'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[Socket] 연결: ${user.displayName || user.username} (${socket.id})`);

    // 사용자를 자신의 계정 room에 join (계정별 이벤트 전송용)
    if (user.accountId) {
      socket.join(`account:${user.accountId}`);
    }
    if (user.officeId) {
      socket.join(`office:${user.officeId}`);
    }

    // --- 계정 room 참여/이탈 (데이터 변경 알림용) ---
    socket.on('join:account', (room) => {
      // room 형식: "account:123"
      socket.join(room);
      console.log(`[Socket] ${user.displayName || user.username} → ${room} 참여`);
    });

    socket.on('leave:account', (room) => {
      socket.leave(room);
      console.log(`[Socket] ${user.displayName || user.username} → ${room} 이탈`);
    });

    // --- 페이지 참여/이탈 ---
    socket.on('join:page', (page) => {
      socket.join(`page:${page}`);
      // 해당 페이지의 현재 편집자 목록 전송
      const editors = getEditorsForPage(page);
      socket.emit('editors:list', { page, editors });
    });

    socket.on('leave:page', (page) => {
      socket.leave(`page:${page}`);
      // 해당 페이지에서 편집 중이던 항목 정리
      clearEditorsBySocket(socket.id, page);
    });

    // --- 편집 시작/종료 ---
    socket.on('editing:start', ({ page, section, recordId }) => {
      const key = `${page}:${section}:${recordId || 'general'}`;
      activeEditors.set(key, {
        socketId: socket.id,
        userId: user.accountId || user.id,
        displayName: user.displayName || user.username,
        startedAt: Date.now()
      });
      // 같은 페이지의 다른 사용자들에게 알림
      socket.to(`page:${page}`).emit('editing:started', {
        page,
        section,
        recordId,
        user: { id: user.accountId || user.id, displayName: user.displayName || user.username }
      });
    });

    socket.on('editing:end', ({ page, section, recordId }) => {
      const key = `${page}:${section}:${recordId || 'general'}`;
      activeEditors.delete(key);
      socket.to(`page:${page}`).emit('editing:ended', {
        page,
        section,
        recordId,
        user: { id: user.accountId || user.id, displayName: user.displayName || user.username }
      });
    });

    // --- 연결 해제 ---
    socket.on('disconnect', () => {
      console.log(`[Socket] 연결 해제: ${user.displayName || user.username} (${socket.id})`);
      // 이 소켓이 편집 중이던 모든 항목 정리
      const removedKeys = [];
      for (const [key, editor] of activeEditors) {
        if (editor.socketId === socket.id) {
          removedKeys.push(key);
          activeEditors.delete(key);
        }
      }
      // 편집 종료 알림 브로드캐스트
      for (const key of removedKeys) {
        const [page, section, recordId] = key.split(':');
        io.to(`page:${page}`).emit('editing:ended', {
          page,
          section,
          recordId,
          user: { id: user.accountId || user.id, displayName: user.displayName || user.username }
        });
      }
    });
  });

  // 5분마다 오래된 편집 상태 정리 (10분 이상 된 항목)
  setInterval(() => {
    const now = Date.now();
    for (const [key, editor] of activeEditors) {
      if (now - editor.startedAt > 10 * 60 * 1000) {
        const [page, section, recordId] = key.split(':');
        activeEditors.delete(key);
        io.to(`page:${page}`).emit('editing:ended', {
          page, section, recordId,
          user: { id: editor.userId, displayName: editor.displayName }
        });
      }
    }
  }, 5 * 60 * 1000);

  return io;
}

/**
 * 특정 페이지의 편집자 목록 조회
 */
function getEditorsForPage(page) {
  const editors = [];
  for (const [key, editor] of activeEditors) {
    if (key.startsWith(`${page}:`)) {
      const parts = key.split(':');
      editors.push({
        section: parts[1],
        recordId: parts[2],
        user: { id: editor.userId, displayName: editor.displayName },
        startedAt: editor.startedAt
      });
    }
  }
  return editors;
}

/**
 * 특정 소켓의 특정 페이지 편집 상태 정리
 */
function clearEditorsBySocket(socketId, page) {
  for (const [key, editor] of activeEditors) {
    if (editor.socketId === socketId && key.startsWith(`${page}:`)) {
      activeEditors.delete(key);
    }
  }
}

/**
 * 데이터 변경 이벤트 발송 (API 라우트에서 호출)
 *
 * @param {string} eventType - 이벤트 타입 (예: 'drbet:updated', 'finish:updated')
 * @param {Object} data - 이벤트 데이터
 * @param {Object} options - 옵션
 * @param {string} options.room - 특정 room에만 전송 (예: 'page:drbet')
 * @param {string} options.excludeSocket - 제외할 소켓 ID (이벤트 발생 사용자)
 */
function emitDataChange(eventType, data = {}, options = {}) {
  if (!io) return;

  const { room, excludeSocket } = options;

  if (room) {
    if (excludeSocket) {
      io.to(room).except(excludeSocket).emit(eventType, data);
    } else {
      io.to(room).emit(eventType, data);
    }
  } else {
    if (excludeSocket) {
      io.except(excludeSocket).emit(eventType, data);
    } else {
      io.emit(eventType, data);
    }
  }
}

/**
 * IO 인스턴스 반환
 */
function getIO() {
  return io;
}

module.exports = { initSocket, emitDataChange, getIO };
