import { useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSocket } from '../contexts/SocketContext';

/**
 * 실시간 동기화 커스텀 훅
 *
 * @param {string} pageName - 페이지 이름 (예: 'drbet', 'finish', 'sites')
 * @param {Object} options
 * @param {Function} options.onDataChanged - 데이터 변경 시 호출할 콜백 (데이터 재로드 함수)
 * @param {string[]} options.events - 구독할 이벤트 목록 (예: ['drbet:changed'])
 * @param {boolean} options.showToast - 다른 사용자 변경 시 토스트 알림 표시 여부 (기본: true)
 * @param {number} options.debounceMs - 변경 이벤트 디바운스 시간 (기본: 1000ms)
 */
export function useRealtimeSync(pageName, {
  onDataChanged,
  events = [],
  showToast = true,
  debounceMs = 1000,
} = {}) {
  const { joinPage, leavePage, onDataChange, startEditing, endEditing, editors, connected } = useSocket();
  const debounceTimerRef = useRef(null);
  const onDataChangedRef = useRef(onDataChanged);

  // 최신 콜백을 ref로 유지
  useEffect(() => {
    onDataChangedRef.current = onDataChanged;
  }, [onDataChanged]);

  // 페이지 참여/이탈
  useEffect(() => {
    if (pageName) {
      joinPage(pageName);
      return () => leavePage(pageName);
    }
  }, [pageName, joinPage, leavePage]);

  // 데이터 변경 이벤트 리스너
  useEffect(() => {
    if (!events.length) return;

    const cleanups = events.map(eventType =>
      onDataChange(eventType, (data) => {
        // 토스트 알림
        if (showToast && data.user) {
          toast(`${data.user}님이 데이터를 변경했습니다`, {
            icon: '🔄',
            duration: 3000,
            id: `sync-${eventType}`, // 중복 방지
          });
        }

        // 디바운스된 데이터 리로드
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          if (onDataChangedRef.current) {
            onDataChangedRef.current(data);
          }
        }, debounceMs);
      })
    );

    return () => {
      cleanups.forEach(cleanup => cleanup());
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [events.join(','), onDataChange, showToast, debounceMs]);

  // 편집 시작/종료 래퍼
  const notifyEditStart = useCallback((section, recordId) => {
    startEditing(pageName, section, recordId);
  }, [pageName, startEditing]);

  const notifyEditEnd = useCallback((section, recordId) => {
    endEditing(pageName, section, recordId);
  }, [pageName, endEditing]);

  // 현재 페이지의 다른 사용자 편집 상태
  const getEditorFor = useCallback((section, recordId) => {
    return editors.find(e => e.section === section && (recordId ? e.recordId === recordId : true));
  }, [editors]);

  return {
    connected,
    editors,
    notifyEditStart,
    notifyEditEnd,
    getEditorFor,
  };
}
