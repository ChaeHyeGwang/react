import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    // SocketProvider 밖에서 호출될 경우 기본값 반환
    return {
      socket: null,
      connected: false,
      editors: [],
      joinPage: () => {},
      leavePage: () => {},
      startEditing: () => {},
      endEditing: () => {},
      onDataChange: () => () => {},
    };
  }
  return context;
};

/**
 * 소켓 서버 URL 결정 (API URL과 동일한 호스트, /api 제외)
 */
function getSocketUrl() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const port = window.location.port;

  if (hostname === 'localhost' || hostname === '127.0.0.1' || /^192\.168\./.test(hostname)) {
    return `${protocol}//${hostname}:5000`;
  }
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [editors, setEditors] = useState([]); // 현재 페이지의 편집자 목록
  const listenersRef = useRef(new Map()); // eventType -> Set<callback>
  const currentPageRef = useRef(null);

  // 소켓 연결
  useEffect(() => {
    if (!user) {
      // 로그인하지 않은 경우 소켓 연결 해제
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    const socketUrl = getSocketUrl();
    const socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[Socket] 연결 성공:', socket.id);
      setConnected(true);

      // 현재 페이지에 재입장
      if (currentPageRef.current) {
        socket.emit('join:page', currentPageRef.current);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] 연결 해제:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] 연결 에러:', err.message);
    });

    // 편집자 목록 수신
    socket.on('editors:list', ({ editors: editorList }) => {
      setEditors(editorList);
    });

    // 다른 사용자 편집 시작
    socket.on('editing:started', ({ page, section, recordId, user: editorUser }) => {
      setEditors(prev => {
        const filtered = prev.filter(e => !(e.section === section && e.recordId === recordId && e.user.id === editorUser.id));
        return [...filtered, { section, recordId, user: editorUser, startedAt: Date.now() }];
      });
    });

    // 다른 사용자 편집 종료
    socket.on('editing:ended', ({ section, recordId, user: editorUser }) => {
      setEditors(prev =>
        prev.filter(e => !(e.section === section && e.recordId === recordId && e.user.id === editorUser.id))
      );
    });

    // 데이터 변경 이벤트 라우팅 (등록된 리스너에 전달)
    const dataEvents = [
      'drbet:changed',
      'finish:changed',
      'sites:changed',
      'settlements:changed',
      'identities:changed',
    ];

    dataEvents.forEach(eventType => {
      socket.on(eventType, (data) => {
        const callbacks = listenersRef.current.get(eventType);
        if (callbacks) {
          callbacks.forEach(cb => cb(data));
        }
      });
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user]);

  // 페이지 참여
  const joinPage = useCallback((page) => {
    currentPageRef.current = page;
    if (socketRef.current?.connected) {
      socketRef.current.emit('join:page', page);
    }
  }, []);

  // 페이지 이탈
  const leavePage = useCallback((page) => {
    if (currentPageRef.current === page) {
      currentPageRef.current = null;
    }
    setEditors([]);
    if (socketRef.current?.connected) {
      socketRef.current.emit('leave:page', page);
    }
  }, []);

  // 편집 시작 알림
  const startEditing = useCallback((page, section, recordId) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('editing:start', { page, section, recordId });
    }
  }, []);

  // 편집 종료 알림
  const endEditing = useCallback((page, section, recordId) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('editing:end', { page, section, recordId });
    }
  }, []);

  // 데이터 변경 이벤트 리스너 등록 (반환값: cleanup 함수)
  const onDataChange = useCallback((eventType, callback) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType).add(callback);

    return () => {
      const callbacks = listenersRef.current.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
      }
    };
  }, []);

  // axios 인터셉터에 소켓 ID 추가
  useEffect(() => {
    if (!socketRef.current) return;
    // 소켓 ID를 전역에서 접근 가능하게 설정
    const updateSocketId = () => {
      if (socketRef.current?.id) {
        window.__socketId = socketRef.current.id;
      }
    };
    socketRef.current.on('connect', updateSocketId);
    updateSocketId();

    return () => {
      window.__socketId = null;
    };
  }, [connected]);

  const value = {
    socket: socketRef.current,
    connected,
    editors,
    joinPage,
    leavePage,
    startEditing,
    endEditing,
    onDataChange,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};
