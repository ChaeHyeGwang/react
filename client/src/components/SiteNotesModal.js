import React, { useState, useEffect, useRef } from 'react';
import { getAttendanceStats, getRecentAttendance } from '../utils/attendanceUtils';
import axiosInstance from '../api/axios';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

const SiteNotesModal = ({ 
  isOpen, 
  siteName, 
  recordedBy, 
  data, 
  monthlyStats,
  weeklyStats,
  weekRange, // 주간 범위 (start, end)
  recharges,
  readonly, 
  selectedDate,
  startDate,
  identityName,
  onClose, 
  onSave,
  onDataChange 
}) => {
  const { isAdmin, isOfficeManager } = useAuth();
  const [attendanceStats, setAttendanceStats] = useState(null);
  const [recentAttendance, setRecentAttendance] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const savingRef = useRef(false); // 저장 중복 방지
  const [initialData, setInitialData] = useState(null); // 초기 데이터 저장 (변경 감지용)
  const [showPastAttendanceModal, setShowPastAttendanceModal] = useState(false);
  const [pastAttendanceDate, setPastAttendanceDate] = useState('');
  const [pastAttendanceReason, setPastAttendanceReason] = useState('');
  const [addingPastAttendance, setAddingPastAttendance] = useState(false);
  
  // 기간별 출석 일괄 추가 관련 state
  const [showBulkAttendanceModal, setShowBulkAttendanceModal] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkEndDate, setBulkEndDate] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [addingBulkAttendance, setAddingBulkAttendance] = useState(false);
  
  // 출석 히스토리 관련 state
  const [showAttendanceHistory, setShowAttendanceHistory] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(new Date());
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // 모달이 열릴 때 초기 데이터 저장 (변경 감지용)
  useEffect(() => {
    if (isOpen && data) {
      // 모든 주요 필드를 저장
      setInitialData({
        eventsJson: JSON.stringify(data.events || []),
        // 페이백 정보
        payback: data.payback || '',
        // 정착 정보
        settlement: data.settlement || '',
        settlementTotal: data.settlementTotal || 0,
        settlementPoint: data.settlementPoint || '',
        settlementDays: data.settlementDays || 0,
        settlementRulesJson: JSON.stringify(data.settlementRules || []),
        // 만근
        tenure: data.tenure || '',
        // 출석구분
        attendanceType: data.attendanceType || '자동',
        // 충전금액 범위
        chargeMin: data.chargeMin ?? '',
        chargeMax: data.chargeMax ?? '',
        // 이월 유무
        rollover: data.rollover || '',
        // 요율
        rate: data.rate || ''
      });
    } else {
      setInitialData(null);
    }
  }, [isOpen]); // data가 아닌 isOpen만 dependency로 (열릴 때 한 번만)

  // 주요 정보 변경 여부 확인 함수
  const hasEventChanges = () => {
    if (!initialData) return false;
    
    // 이벤트 정보 비교
    const currentEventsJson = JSON.stringify(data.events || []);
    if (currentEventsJson !== initialData.eventsJson) return true;
    
    // 페이백 정보 비교
    if ((data.payback || '') !== initialData.payback) return true;
    
    // 정착 정보 비교
    if ((data.settlement || '') !== initialData.settlement) return true;
    if ((data.settlementTotal || 0) !== initialData.settlementTotal) return true;
    if ((data.settlementPoint || '') !== initialData.settlementPoint) return true;
    if ((data.settlementDays || 0) !== initialData.settlementDays) return true;
    const currentSettlementRulesJson = JSON.stringify(data.settlementRules || []);
    if (currentSettlementRulesJson !== initialData.settlementRulesJson) return true;
    
    // 만근 비교
    if ((data.tenure || '') !== initialData.tenure) return true;
    
    // 출석구분 비교
    if ((data.attendanceType || '자동') !== initialData.attendanceType) return true;
    
    // 충전금액 범위 비교
    if ((data.chargeMin ?? '') !== initialData.chargeMin) return true;
    if ((data.chargeMax ?? '') !== initialData.chargeMax) return true;
    
    // 이월 유무 비교
    if ((data.rollover || '') !== initialData.rollover) return true;
    
    // 요율 비교
    if ((data.rate || '') !== initialData.rate) return true;
    
    return false;
  };
  
  // 출석 통계 로드
  useEffect(() => {
    // identityName이 있을 때는 자동/수동 구분 없이 항상 통계 로드
    if (isOpen && siteName && identityName && identityName.trim() !== '') {
      loadAttendanceStats();
    } else {
      // 조건 미충족 시 초기화
      setAttendanceStats(null);
      setRecentAttendance([]);
    }
  }, [isOpen, siteName, identityName, data.attendanceType]);
  
  const loadAttendanceStats = async () => {
    setLoadingStats(true);
    try {
      console.log('📊 [출석통계] 조회 시작:', { siteName, identityName });
      const stats = await getAttendanceStats(siteName, identityName);
      console.log('📊 [출석통계] 조회 결과:', stats);
      
      if (stats) {
        setAttendanceStats(stats);
        const recent = getRecentAttendance(stats.recentLogs || [], 7);
        setRecentAttendance(recent);
        console.log('✅ [출석통계] 설정 완료:', { stats, recent });
      } else {
        console.log('⚠️ [출석통계] 데이터 없음');
        setAttendanceStats(null);
        setRecentAttendance([]);
      }
    } catch (error) {
      console.error('❌ [출석통계] 로드 실패:', error);
      setAttendanceStats(null);
      setRecentAttendance([]);
    } finally {
      setLoadingStats(false);
    }
  };
  
  // 출석 히스토리 로드
  const loadAttendanceHistory = async (yearMonth) => {
    if (!siteName || !identityName) return;
    
    setLoadingHistory(true);
    try {
      const response = await axiosInstance.get('/attendance/logs', {
        params: {
          siteName,
          identityName,
          yearMonth
        }
      });
      
      if (response.data?.success && Array.isArray(response.data.logs)) {
        setAttendanceLogs(response.data.logs);
      } else {
        setAttendanceLogs([]);
      }
    } catch (error) {
      console.error('출석 히스토리 로드 실패:', error);
      setAttendanceLogs([]);
    } finally {
      setLoadingHistory(false);
    }
  };
  
  // 히스토리 월 변경 시 로드
  useEffect(() => {
    if (showAttendanceHistory && siteName && identityName) {
      const yearMonth = `${historyMonth.getFullYear()}-${String(historyMonth.getMonth() + 1).padStart(2, '0')}`;
      loadAttendanceHistory(yearMonth);
    }
  }, [showAttendanceHistory, historyMonth, siteName, identityName]);
  
  // 캘린더 렌더링 헬퍼 함수
  const renderAttendanceCalendar = () => {
    const year = historyMonth.getFullYear();
    const month = historyMonth.getMonth();
    
    // 해당 월의 첫날과 마지막 날
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // 첫날의 요일 (0=일요일)
    const firstDayOfWeek = firstDay.getDay();
    
    // 출석 로그를 Set으로 변환 (빠른 조회)
    const attendanceSet = new Set(attendanceLogs);
    
    const weeks = [];
    let currentWeek = [];
    
    // 첫 주의 빈 칸 채우기
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push(null);
    }
    
    // 날짜 채우기
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hasAttendance = attendanceSet.has(dateStr);
      
      currentWeek.push({ day, dateStr, hasAttendance });
      
      // 토요일이거나 마지막 날이면 주 완성
      if (currentWeek.length === 7 || day === lastDay.getDate()) {
        // 마지막 주의 빈 칸 채우기
        while (currentWeek.length < 7) {
          currentWeek.push(null);
        }
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    
    return (
      <div className="space-y-2">
        {/* 월 선택 */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setHistoryMonth(new Date(historyMonth.getFullYear(), historyMonth.getMonth() - 1))}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
          >
            ◀ 이전
          </button>
          <div className="text-lg font-bold text-gray-900 dark:text-white">
            {year}년 {month + 1}월
          </div>
          <button
            onClick={() => setHistoryMonth(new Date(historyMonth.getFullYear(), historyMonth.getMonth() + 1))}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
          >
            다음 ▶
          </button>
        </div>
        
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
          <div className="text-red-600 dark:text-red-400">일</div>
          <div>월</div>
          <div>화</div>
          <div>수</div>
          <div>목</div>
          <div>금</div>
          <div className="text-blue-600 dark:text-blue-400">토</div>
        </div>
        
        {/* 캘린더 그리드 */}
        {loadingHistory ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            로딩 중...
          </div>
        ) : (
          <div className="space-y-1">
            {weeks.map((week, weekIdx) => (
              <div key={weekIdx} className="grid grid-cols-7 gap-1">
                {week.map((cell, cellIdx) => {
                  if (!cell) {
                    return <div key={cellIdx} className="aspect-square" />;
                  }
                  
                  const { day, hasAttendance } = cell;
                  const dayOfWeek = cellIdx;
                  const isSunday = dayOfWeek === 0;
                  const isSaturday = dayOfWeek === 6;
                  
                  return (
                    <div
                      key={cellIdx}
                      className={`
                        aspect-square flex items-center justify-center rounded text-sm
                        ${hasAttendance 
                          ? 'bg-green-500 dark:bg-green-600 text-white font-bold' 
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                        }
                        ${isSunday && !hasAttendance ? 'text-red-600 dark:text-red-400' : ''}
                        ${isSaturday && !hasAttendance ? 'text-blue-600 dark:text-blue-400' : ''}
                      `}
                      title={hasAttendance ? `${cell.dateStr} 출석` : `${cell.dateStr} 미출석`}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        
        {/* 범례 */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-green-500 dark:bg-green-600 rounded"></div>
            <span>출석</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 rounded"></div>
            <span>미출석</span>
          </div>
        </div>
        
        {/* 통계 */}
        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
          <div className="text-sm text-blue-900 dark:text-blue-300 space-y-1">
            <div className="flex justify-between">
              <span>이번 달 출석일:</span>
              <span className="font-bold">{attendanceLogs.length}일</span>
            </div>
            <div className="flex justify-between">
              <span>이번 달 미출석일:</span>
              <span className="font-bold">{lastDay.getDate() - attendanceLogs.length}일</span>
            </div>
            <div className="flex justify-between">
              <span>출석률:</span>
              <span className="font-bold">
                {lastDay.getDate() > 0 ? ((attendanceLogs.length / lastDay.getDate()) * 100).toFixed(1) : 0}%
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };
  
  // 모달이 열려있을 때만 키 이벤트 리스너 등록 (Hook은 early return 전에 호출되어야 함)
  useEffect(() => {
    if (!isOpen || readonly) return;
    
    // 엔터 키 핸들러
    const handleKeyDown = (e) => {
      // readonly 모드이거나 저장 중이면 무시
      if (readonly || savingRef.current) return;
      
      // 🔒 하위 모달이 열려있으면 무시 (과거 날짜 출석, 기간별 출석, 출석 히스토리)
      if (showPastAttendanceModal || showBulkAttendanceModal || showAttendanceHistory) {
        return;
      }
      
      // 엔터 키만 처리 (Shift, Ctrl, Alt 등과 함께 누른 경우 제외)
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // input, textarea, select 요소에 포커스가 있으면 무시 (해당 요소에서 처리)
        const activeElement = document.activeElement;
        if (activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA' || 
          activeElement.tagName === 'SELECT' ||
          activeElement.isContentEditable
        )) {
          // textarea가 아닌 input이나 select에서만 저장 실행
          if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT') {
            e.preventDefault();
            e.stopPropagation();
            if (!savingRef.current) {
              savingRef.current = true;
              onSave(data, hasEventChanges());
              // 저장 완료 후 플래그 리셋 (비동기로 처리)
              setTimeout(() => {
                savingRef.current = false;
              }, 1000);
            }
          }
          return;
        }
        
        // 다른 곳에서 엔터를 누른 경우 저장
        e.preventDefault();
        e.stopPropagation();
        if (!savingRef.current) {
          savingRef.current = true;
          onSave(data, hasEventChanges());
          // 저장 완료 후 플래그 리셋 (비동기로 처리)
          setTimeout(() => {
            savingRef.current = false;
          }, 1000);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, readonly, data, onSave, showPastAttendanceModal, showBulkAttendanceModal, showAttendanceHistory]);
  
  if (!isOpen) return null;
  
  // 주간 범위 계산 함수
  const getWeekRange = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const formatDate = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    return {
      start: formatDate(monday),
      end: formatDate(sunday)
    };
  };
  
  // props로 받은 weekRange 사용, 없으면 로컬 계산
  const displayWeekRange = weekRange || (selectedDate ? getWeekRange(selectedDate) : null);
  
  // 데이터 변경 헬퍼 함수 (부분 업데이트를 전체 데이터로 변환)
  const handleDataChange = (updates) => {
    onDataChange({ ...data, ...updates });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-5xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">사이트 정보 기록 - {siteName}</h3>
          <button className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100" onClick={onClose}>닫기</button>
        </div>
        
        <div className="mb-2 px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded text-xs">
          <span className="font-semibold text-blue-700 dark:text-blue-300">정리한 사람: </span>
          <span className="text-blue-900 dark:text-blue-200">{recordedBy || '(없음)'}</span>
          {!readonly && (
            <span className="text-gray-500 dark:text-gray-400 ml-2">(설정 정보 수정 시에만 변경됩니다)</span>
          )}
        </div>
        
        {/* 이달의 충환 정보 */}
        {monthlyStats && (
          <div className="mb-3 px-3 py-2 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30 rounded-lg border border-purple-200 dark:border-purple-700">
            <h4 className="text-sm font-bold text-purple-700 dark:text-purple-300 mb-2">이달의 충환 정보 ({selectedDate?.substring(0, 7)})</h4>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="bg-white dark:bg-gray-700 rounded px-2 py-1 border border-purple-100 dark:border-purple-700">
                <div className="text-gray-600 dark:text-gray-300 mb-1">토탈 충전금액</div>
                <div className="font-bold text-blue-600 dark:text-blue-400">{((monthlyStats.totalCharge || 0) * 10000).toLocaleString()}원</div>
              </div>
              <div className="bg-white dark:bg-gray-700 rounded px-2 py-1 border border-purple-100 dark:border-purple-700">
                <div className="text-gray-600 dark:text-gray-300 mb-1">토탈 환전금액</div>
                <div className="font-bold text-green-600 dark:text-green-400">{((monthlyStats.totalWithdraw || 0) * 10000).toLocaleString()}원</div>
              </div>
              <div className="bg-white dark:bg-gray-700 rounded px-2 py-1 border border-purple-100 dark:border-purple-700">
                <div className="text-gray-600 dark:text-gray-300 mb-1">환수금액</div>
                <div className={`font-bold ${(monthlyStats.recovery || 0) > 0 ? 'text-red-600 dark:text-red-400' : (monthlyStats.recovery || 0) < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}>
                  {((monthlyStats.recovery || 0) * 10000).toLocaleString()}원
                </div>
              </div>
            </div>
            {/* 날짜별 재충 횟수 (읽기 전용) */}
            {Array.isArray(recharges) && recharges.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-bold text-purple-700 dark:text-purple-300 mb-1">재충 횟수</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 dark:bg-gray-700">
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-32 text-gray-900 dark:text-white">일자</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24 text-gray-900 dark:text-white">재충</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recharges.map((rc, idx) => (
                        <tr key={idx} className="dark:bg-gray-800">
                          <td className="border border-gray-300 dark:border-gray-600 px-2 py-1 text-gray-800 dark:text-gray-200">{rc.date}</td>
                          <td className="border border-gray-300 dark:border-gray-600 px-2 py-1 text-right text-gray-800 dark:text-gray-200">{rc.count}번</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* 이주의 충환 정보 */}
        {weeklyStats && (
          <div className="mb-3 px-3 py-2 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
            <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300 mb-2">
              이주의 충환 정보 {displayWeekRange ? `(${displayWeekRange.start} ~ ${displayWeekRange.end})` : ''}
            </h4>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="bg-white dark:bg-gray-700 rounded px-2 py-1 border border-blue-100 dark:border-blue-700">
                <div className="text-gray-600 dark:text-gray-300 mb-1">토탈 충전금액</div>
                <div className="font-bold text-blue-600 dark:text-blue-400">{((weeklyStats.totalCharge || 0) * 10000).toLocaleString()}원</div>
              </div>
              <div className="bg-white dark:bg-gray-700 rounded px-2 py-1 border border-blue-100 dark:border-blue-700">
                <div className="text-gray-600 dark:text-gray-300 mb-1">토탈 환전금액</div>
                <div className="font-bold text-green-600 dark:text-green-400">{((weeklyStats.totalWithdraw || 0) * 10000).toLocaleString()}원</div>
              </div>
              <div className="bg-white dark:bg-gray-700 rounded px-2 py-1 border border-blue-100 dark:border-blue-700">
                <div className="text-gray-600 dark:text-gray-300 mb-1">환수금액</div>
                <div className={`font-bold ${(weeklyStats.recovery || 0) > 0 ? 'text-red-600 dark:text-red-400' : (weeklyStats.recovery || 0) < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}>
                  {((weeklyStats.recovery || 0) * 10000).toLocaleString()}원
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* 기본 정보 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">만근</label>
            <input 
              type="text" 
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs" 
              value={data.tenure || ''}
              onChange={(e) => !readonly && handleDataChange({ tenure: e.target.value })} 
              disabled={readonly} 
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1 flex items-center gap-1">
              출석구분
              <span 
                className="cursor-help text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                title="📌 출석구분 규칙&#10;• 자동: 충전/환전 기록만으로 자동 출석 처리 (버튼 불필요)&#10;• 수동: 반드시 '출완' 버튼을 클릭해야 출석 인정 (깜빡하면 연속 끊김)"
              >
                ℹ️
              </span>
            </label>
            <select 
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
              value={data.attendanceType || '자동'}
              onChange={(e) => !readonly && handleDataChange({ attendanceType: e.target.value })}
              disabled={readonly}
            >
              <option value="자동">자동 (기록 시 자동 출석)</option>
              <option value="수동">수동 (출완 버튼 필수)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">충전금액 범위</label>
            <div className="flex items-center gap-1">
              <input 
                type="number" 
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs" 
                value={data.chargeMin !== undefined && data.chargeMin !== null ? data.chargeMin : ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? '' : parseInt(e.target.value) || 0;
                  !readonly && handleDataChange({ chargeMin: value });
                }}
                disabled={readonly}
                placeholder="최소"
                min="0"
              />
              <span className="text-gray-500 dark:text-gray-400 text-xs">~</span>
              <input 
                type="number" 
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs" 
                value={data.chargeMax !== undefined && data.chargeMax !== null ? data.chargeMax : ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? '' : parseInt(e.target.value) || 0;
                  !readonly && handleDataChange({ chargeMax: value });
                }}
                disabled={readonly}
                placeholder="최대"
                min="0"
              />
            </div>
          </div>
          {/* 출석일: 자동/수동 상관 없이 항상 연속 출석일수 표시 (읽기 전용) */}
          <div className="col-span-2">
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1 flex items-center gap-1">
              출석일 (연속)
              <span 
                className="cursor-help text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                title="📌 연속 출석일 규칙&#10;• 하루라도 빠지면 즉시 리셋&#10;• 날짜 기준 (KST 00:00~23:59)&#10;• 같은 날 여러 번 기록해도 1일만 카운트&#10;• 충전 또는 환전 중 하나만 있어도 출석 인정&#10;• 이월 O: 월 바뀌어도 유지, 단 30일 초과 시 1일로 리셋&#10;• 이월 X: 매월 1일 자정에 무조건 0일로 리셋"
              >
                ℹ️
              </span>
            </label>
            <div className="space-y-2">
              {loadingStats ? (
                <div className="w-full border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 rounded px-3 py-2 text-center text-sm text-gray-500 dark:text-gray-400">
                  로딩 중...
                </div>
              ) : attendanceStats ? (
                <div className="w-full border-2 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 rounded px-3 py-2">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      🔥 {attendanceStats.consecutiveDays}일
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">연속 출석</div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                      💡 <strong>연속 규칙:</strong> 하루 빠지면 리셋 · 날짜별 1회 카운트 · 충전/환전 중 하나만 있어도 인정 {data.rollover === 'O' && <span className="text-orange-600 dark:text-orange-400">· 이월 O는 30일 초과 시 1일로 리셋</span>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 rounded px-3 py-2 text-center text-sm text-gray-500 dark:text-gray-400">
                  출석 통계를 불러올 수 없습니다
                </div>
              )}
              
              {/* 출석 히스토리 버튼 */}
              {identityName && (
                <button
                  onClick={() => {
                    setShowAttendanceHistory(true);
                    setHistoryMonth(new Date());
                  }}
                  className="w-full bg-blue-500 dark:bg-blue-600 text-white px-3 py-2 rounded text-xs font-semibold hover:bg-blue-600 dark:hover:bg-blue-700 transition-colors"
                >
                  📊 출석 히스토리 보기
                </button>
              )}
              
              {/* 관리자 전용: 과거 날짜 출석 추가 버튼 */}
              {(isAdmin || isOfficeManager) && identityName && !readonly && (
                <button
                  onClick={() => {
                    setShowPastAttendanceModal(true);
                    setPastAttendanceDate('');
                    setPastAttendanceReason('');
                  }}
                  className="w-full bg-orange-500 dark:bg-orange-600 text-white px-3 py-2 rounded text-xs font-semibold hover:bg-orange-600 dark:hover:bg-orange-700 transition-colors"
                >
                  📅 과거 날짜 출석 추가
                </button>
              )}
              
              {/* 관리자 전용: 기간별 출석 일괄 추가 버튼 */}
              {(isAdmin || isOfficeManager) && identityName && !readonly && (
                <button
                  onClick={() => {
                    setShowBulkAttendanceModal(true);
                    setBulkStartDate('');
                    setBulkEndDate('');
                    setBulkReason('');
                  }}
                  className="w-full bg-purple-500 dark:bg-purple-600 text-white px-3 py-2 rounded text-xs font-semibold hover:bg-purple-600 dark:hover:bg-purple-700 transition-colors"
                >
                  📅 기간별 출석 일괄 추가
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1 flex items-center gap-1">
              이월유무
              <span 
                className="cursor-help text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                title="📌 이월 규칙&#10;• O: 월이 바뀌어도 연속 출석일 유지 (단, 30일 초과 시 1일로 리셋)&#10;• X: 매월 1일 자정에 0일로 리셋 (새 달 새 시작)"
              >
                ℹ️
              </span>
            </label>
            <select 
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
              value={data.rollover || ''}
              onChange={(e) => !readonly && handleDataChange({ rollover: e.target.value })}
              disabled={readonly}
            >
              <option value="">선택</option>
              <option value="O">O (연속 유지)</option>
              <option value="X">X (매월 리셋)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">정착 유무</label>
            <select 
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
              value={data.settlement || ''}
              onChange={(e) => !readonly && handleDataChange({ settlement: e.target.value })}
              disabled={readonly}
            >
              <option value="">선택</option>
              <option value="O">O</option>
              <option value="X">X</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">요율 (%)</label>
            <input 
              type="text" 
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs" 
              value={data.rate || ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                  !readonly && handleDataChange({ rate: value });
                }
              }}
              disabled={readonly}
              placeholder="예: 5 또는 5.5"
            />
          </div>
        </div>

        {/* 정착 정보 (정착 유무 = O 일 때만 표시) */}
        {data.settlement === 'O' && (
          <div className="mb-4 border border-gray-300 dark:border-gray-700 rounded p-3 bg-gray-50 dark:bg-gray-800">
            <h4 className="text-sm font-bold mb-2 text-gray-900 dark:text-white">정착 정보</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">시작일</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
                  value={startDate || ''}
                  disabled
                  placeholder="자동 계산"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">기간(일)</label>
                <input
                  type="number"
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
                  value={data.settlementDays || 0}
                  onChange={(e) => !readonly && handleDataChange({ settlementDays: parseInt(e.target.value) || 0 })}
                  disabled={readonly}
                  placeholder="예: 10"
                />
              </div>
              {/* 단일 지급 체크는 제거됨: 지급은 규칙별로 테이블에서 관리 */}
            </div>

            {/* 누적금액·포인트·기간 테이블 (여러 행) */}
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-600 dark:text-gray-300">첫 번째 행이 기본 목표로 사용됩니다. 기간은 상단 값이 공통 적용됩니다.</div>
              {!readonly && (
                <button
                  type="button"
                  className="px-2 py-1 text-xs bg-green-600 dark:bg-green-700 text-white rounded hover:bg-green-700 dark:hover:bg-green-600"
                  onClick={() => {
                    const current = data.settlementRules && Array.isArray(data.settlementRules)
                      ? data.settlementRules
                      : ((data.settlementTotal || data.settlementPoint || data.settlementDays)
                          ? [{ total: data.settlementTotal || 0, point: data.settlementPoint || '' }]
                          : []);
                    const newRules = [...current, { total: 0, point: '' }];
                    // 첫 행을 단일 필드와 동기화
                    const first = newRules[0] || { total: 0, point: '' };
                    handleDataChange({
                      settlementRules: newRules,
                      settlementTotal: first.total || 0,
                      settlementPoint: first.point || ''
                    });
                  }}
                >
                  + 행 추가
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-700">
                    <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-32 text-gray-900 dark:text-white">누적 충전금액(만)</th>
                    <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-32 text-gray-900 dark:text-white">포인트(만)</th>
                    {!readonly && <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-16 text-gray-900 dark:text-white">삭제</th>}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = (data.settlementRules && Array.isArray(data.settlementRules))
                      ? data.settlementRules
                      : ((data.settlementTotal || data.settlementPoint || data.settlementDays)
                          ? [{ total: data.settlementTotal || 0, point: data.settlementPoint || '' }]
                          : []);
                    if (rows.length === 0) {
                      return (
                        <tr>
                          <td colSpan={readonly ? 2 : 3} className="border border-gray-300 dark:border-gray-600 px-2 py-2 text-center text-gray-500 dark:text-gray-400">
                            정착 규칙이 없습니다
                          </td>
                        </tr>
                      );
                    }
                    return rows.map((row, idx) => (
                      <tr key={idx} className="dark:bg-gray-800">
                        <td className="border border-gray-300 dark:border-gray-600 px-2 py-1">
                          <input
                            type="number"
                            className="w-full px-1 py-1 text-xs border-0 bg-transparent dark:bg-transparent dark:text-white focus:outline-none"
                            value={row.total && row.total > 0 ? row.total : ''}
                            onChange={(e) => {
                              if (readonly) return;
                              let num = parseInt(e.target.value) || 0;
                              if (num >= 10000) num = Math.round(num / 10000);
                              const current = [...rows];
                              current[idx] = { ...current[idx], total: num };
                              const first = current[0] || { total: 0, point: '' };
                              handleDataChange({
                                settlementRules: current,
                                settlementTotal: first.total || 0,
                                settlementPoint: first.point || ''
                              });
                            }}
                            placeholder="예: 5"
                            disabled={readonly}
                          />
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-2 py-1">
                          <input
                            type="text"
                            className="w-full px-1 py-1 text-xs border-0 bg-transparent dark:bg-transparent dark:text-white focus:outline-none"
                            value={row.point || ''}
                            onChange={(e) => {
                              if (readonly) return;
                              const current = [...rows];
                              current[idx] = { ...current[idx], point: e.target.value };
                              const first = current[0] || { total: 0, point: '' };
                              handleDataChange({
                                settlementRules: current,
                                settlementTotal: first.total || 0,
                                settlementPoint: first.point || ''
                              });
                            }}
                            placeholder="예: 5"
                            disabled={readonly}
                          />
                        </td>
                        {!readonly && (
                          <td className="border border-gray-300 dark:border-gray-600 px-2 py-1 text-center">
                            <button
                              type="button"
                              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                              onClick={() => {
                                const current = [...rows];
                                const newRules = current.filter((_, i) => i !== idx);
                                const first = newRules[0] || { total: 0, point: '' };
                                handleDataChange({
                                  settlementRules: newRules,
                                  settlementTotal: first.total || 0,
                                  settlementPoint: first.point || ''
                                });
                              }}
                            >
                              🗑️
                            </button>
                          </td>
                        )}
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
            
            {/* ✅ 정착 지급 완료 체크박스 (단일) - identityName이 있을 때만 표시 */}
            {identityName && (
              <div className="mt-4 pt-3 border-t border-gray-300 dark:border-gray-700">
                <label className="flex items-center gap-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={data.settlement_paid === true}
                    onChange={async (e) => {
                      if (readonly) return;
                      
                      // 현재 상태 저장 (확인 다이얼로그 취소 시 원상복구용)
                      const currentState = data.settlement_paid === true;
                      const newState = e.target.checked;
                      
                      // 체크/해제 모두 확인 다이얼로그 표시
                      const message = newState
                        ? `${siteName} - ${identityName}\n\n정착 지급을 완료하시겠습니까?\n\n✅ 확인 시:\n- 모든 정착 조건이 배너에서 영구적으로 사라집니다\n- 다시 표시하려면 이 체크박스를 해제해야 합니다`
                        : `${siteName} - ${identityName}\n\n정착 지급을 취소하시겠습니까?\n\n⚠️ 취소 시:\n- 정착 배너가 다시 표시됩니다`;
                      
                      const confirmed = window.confirm(message);
                      
                      if (!confirmed) {
                        // 확인 다이얼로그에서 취소를 누르면 원래 상태로 되돌림
                        handleDataChange({ 
                          settlement_paid: currentState,
                          settlement_paid_at: currentState ? data.settlement_paid_at : null
                        });
                        return;
                      }
                      
                      try {
                        // 서버에 저장
                        const response = await axiosInstance.post('/site-notes/settlement-paid', {
                          site_name: siteName,
                          identity_name: identityName,
                          is_paid: newState
                        });
                        
                        // 서버 응답 후 로컬 상태 업데이트
                        handleDataChange({ 
                          settlement_paid: newState,
                          settlement_paid_at: newState ? (response.data?.paid_at || new Date().toISOString()) : null
                        });
                        
                        toast.success(newState ? '✅ 정착 지급 완료 처리되었습니다' : '✅ 정착 지급이 취소되었습니다');
                      } catch (error) {
                        console.error('정착 지급 처리 실패:', error);
                        toast.error(error.response?.data?.message || '정착 지급 처리 실패');
                        // 실패 시 원래 상태로 되돌림
                        handleDataChange({ 
                          settlement_paid: currentState,
                          settlement_paid_at: currentState ? data.settlement_paid_at : null
                        });
                      }
                    }}
                    disabled={readonly}
                    className="w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      💰 정착 지급 완료
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      체크 시 배너가 사라지고, 해제 시 배너가 다시 표시됩니다
                    </div>
                    {data.settlement_paid && data.settlement_paid_at && (
                      <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                        ✅ {new Date(data.settlement_paid_at).toLocaleString('ko-KR')} 지급 완료
                      </div>
                    )}
                  </div>
                </label>
              </div>
            )}
          </div>
        )}

        {/* 페이백 정보 */}
        <div className="mb-4 border border-gray-300 dark:border-gray-700 rounded p-3 bg-gray-50 dark:bg-gray-800">
          <h4 className="text-sm font-bold mb-2 text-gray-900 dark:text-white">페이백 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">페이백 타입</label>
              <select 
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
                value={data.payback?.type || '수동'}
                onChange={(e) => !readonly && handleDataChange({ payback: { ...data.payback, type: e.target.value } })}
                disabled={readonly}
              >
                <option value="수동">수동</option>
                <option value="자동">자동</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">페이백 비율 (%)</label>
              <input 
                type="text" 
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
                value={data.payback?.percent || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    !readonly && handleDataChange({ payback: { ...data.payback, percent: value } });
                  }
                }}
                disabled={readonly}
                placeholder="예: 5 또는 5.5"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">페이백 요일</label>
            <div className="flex gap-1 flex-wrap">
              {['월', '화', '수', '목', '금', '토', '일', '당일'].map(day => (
                <button
                  key={day}
                  type="button"
                  className={`px-2 py-1 text-xs rounded ${
                    (data.payback?.days || []).includes(day)
                      ? 'bg-blue-600 dark:bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                  onClick={() => {
                    if (!readonly) {
                      const currentDays = data.payback?.days || [];
                      const newDays = currentDays.includes(day)
                        ? currentDays.filter(d => d !== day)
                        : [...currentDays, day];
                      handleDataChange({ payback: { ...data.payback, days: newDays } });
                    }
                  }}
                  disabled={readonly}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          {(data.payback?.days || []).includes('당일') && (
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">당일 페이백 비율 (%)</label>
              <input 
                type="text" 
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-xs"
                value={data.payback?.sameDayPercent || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    !readonly && handleDataChange({ payback: { ...data.payback, sameDayPercent: value } });
                  }
                }}
                disabled={readonly}
                placeholder="예: 10 또는 10.5"
              />
            </div>
          )}
        </div>

        {/* 이벤트 테이블 */}
        <div className="mb-4 border border-gray-300 dark:border-gray-700 rounded p-3 bg-white dark:bg-gray-800">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">이벤트 정보</h4>
            {!readonly && (
              <button
                type="button"
                className="px-2 py-1 text-xs bg-green-600 dark:bg-green-700 text-white rounded hover:bg-green-700 dark:hover:bg-green-600"
                onClick={() => {
                  handleDataChange({ events: [...(data.events || []), { event: '', detail: '', rolling: '' }] });
                }}
              >
                + 행 추가
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-700">
                  <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-32 text-gray-900 dark:text-white">이벤트</th>
                  <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 text-gray-900 dark:text-white">이벤트내용</th>
                  <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24 text-gray-900 dark:text-white">이벤트롤링 (%)</th>
                  {!readonly && <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-16 text-gray-900 dark:text-white">삭제</th>}
                </tr>
              </thead>
              <tbody>
                {(data.events || []).length === 0 ? (
                  <tr>
                    <td colSpan={readonly ? 3 : 4} className="border border-gray-300 dark:border-gray-600 px-2 py-2 text-center text-gray-500 dark:text-gray-400">
                      이벤트 정보가 없습니다
                    </td>
                  </tr>
                ) : (
                  (data.events || []).map((evt, idx) => (
                    <tr key={idx} className="dark:bg-gray-800">
                      <td className="border border-gray-300 dark:border-gray-600 px-2 py-1">
                        <input
                          type="text"
                          className="w-full px-1 py-1 text-xs border-0 bg-transparent dark:bg-transparent dark:text-white focus:outline-none"
                          value={evt.event}
                          onChange={(e) => {
                            if (!readonly) {
                              const newEvents = [...data.events];
                              newEvents[idx].event = e.target.value;
                              handleDataChange({ events: newEvents });
                            }
                          }}
                          disabled={readonly}
                          placeholder="예: 첫충, 매충"
                        />
                      </td>
                      <td className="border border-gray-300 dark:border-gray-600 px-2 py-1 align-top">
                        <textarea
                          className="w-full px-1 py-1 text-sm leading-relaxed border-0 bg-transparent dark:bg-transparent dark:text-white focus:outline-none resize-none overflow-hidden min-h-[40px]"
                          ref={(el) => {
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${el.scrollHeight}px`;
                            }
                          }}
                          value={evt.detail}
                          onChange={(e) => {
                            if (!readonly) {
                              // 내용 변경 시 높이를 내용에 맞게 자동 조절
                              e.target.style.height = 'auto';
                              e.target.style.height = `${e.target.scrollHeight}px`;
                              const newEvents = [...data.events];
                              newEvents[idx].detail = e.target.value;
                              handleDataChange({ events: newEvents });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (readonly) return;
                            // Ctrl+Enter 로 줄바꿈 강제 입력
                            if (e.ctrlKey && e.key === 'Enter') {
                              e.preventDefault();
                              const target = e.target;
                              const { selectionStart, selectionEnd, value } = target;
                              const nextValue =
                                value.slice(0, selectionStart) + '\n' + value.slice(selectionEnd);
                              const newEvents = [...data.events];
                              newEvents[idx].detail = nextValue;
                              handleDataChange({ events: newEvents });
                              // 줄바꿈 추가 후에도 높이를 다시 맞춰줌
                              requestAnimationFrame(() => {
                                e.target.style.height = 'auto';
                                e.target.style.height = `${e.target.scrollHeight}px`;
                              });
                            }
                          }}
                          disabled={readonly}
                          placeholder="예: 100% 5만 (Ctrl+Enter 로 줄바꿈)"
                        />
                      </td>
                      <td className="border border-gray-300 dark:border-gray-600 px-2 py-1">
                        <input
                          type="text"
                          className="w-full px-1 py-1 text-xs border-0 bg-transparent dark:bg-transparent dark:text-white focus:outline-none"
                          value={evt.rolling || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              if (!readonly) {
                                const newEvents = [...data.events];
                                newEvents[idx].rolling = value;
                                handleDataChange({ events: newEvents });
                              }
                            }
                          }}
                          disabled={readonly}
                          placeholder="예: 10 또는 10.5"
                        />
                      </td>
                      {!readonly && (
                        <td className="border border-gray-300 dark:border-gray-600 px-2 py-1 text-center">
                          <button
                            type="button"
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                            onClick={() => {
                              const newEvents = data.events.filter((_, i) => i !== idx);
                              handleDataChange({ events: newEvents });
                            }}
                          >
                            🗑️
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        {!readonly && (
          <div className="mt-4 flex justify-end gap-2">
            <button className="px-4 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600" onClick={onClose}>취소</button>
            <button className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600" onClick={() => {
              onSave(data, hasEventChanges());
            }}>저장</button>
          </div>
        )}
        {readonly && (
          <div className="mt-3 text-right text-xs text-gray-500 dark:text-gray-400">정리한사람: {recordedBy || '-'}</div>
        )}
      </div>

      {/* 과거 날짜 출석 추가 모달 */}
      {showPastAttendanceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              📅 과거 날짜 출석 추가
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  사이트 / 명의
                </label>
                <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded">
                  {siteName} / {identityName}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  출석 날짜 *
                </label>
                <input
                  type="date"
                  value={pastAttendanceDate}
                  onChange={(e) => setPastAttendanceDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  ⚠️ 오늘 이전 날짜만 선택 가능합니다
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  추가 사유 * (필수)
                </label>
                <textarea
                  value={pastAttendanceReason}
                  onChange={(e) => setPastAttendanceReason(e.target.value)}
                  rows={3}
                  placeholder="예: 깜빡하여 출석 처리 누락, 시스템 오류로 미기록 등"
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  💡 왜 과거 날짜에 출석을 추가하는지 이유를 명확히 입력해주세요
                </div>
              </div>
              
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                <div className="text-xs text-yellow-800 dark:text-yellow-300 space-y-1">
                  <div className="font-bold">⚠️ 주의사항</div>
                  <div>• 이미 출석 기록이 있는 날짜는 추가할 수 없습니다</div>
                  <div>• 추가 후 연속 출석일이 자동으로 재계산됩니다</div>
                  <div>• 모든 변경 내역은 로그로 기록됩니다</div>
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setShowPastAttendanceModal(false);
                  setPastAttendanceDate('');
                  setPastAttendanceReason('');
                }}
                disabled={addingPastAttendance}
                className="flex-1 bg-gray-500 dark:bg-gray-600 text-white px-4 py-2 rounded font-semibold hover:bg-gray-600 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  // 입력 검증
                  if (!pastAttendanceDate) {
                    toast.error('출석 날짜를 선택해주세요');
                    return;
                  }
                  
                  if (!pastAttendanceReason || pastAttendanceReason.trim() === '') {
                    toast.error('추가 사유를 입력해주세요');
                    return;
                  }
                  
                  // 오늘 이후 날짜 체크
                  const selectedDate = new Date(pastAttendanceDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  
                  if (selectedDate >= today) {
                    toast.error('오늘 이전 날짜만 선택할 수 있습니다');
                    return;
                  }
                  
                  try {
                    setAddingPastAttendance(true);
                    
                    const response = await axiosInstance.post('/attendance/add-past', {
                      siteName,
                      identityName,
                      attendanceDate: pastAttendanceDate,
                      reason: pastAttendanceReason.trim()
                    });
                    
                    if (response.data.success) {
                      toast.success(`✅ ${pastAttendanceDate} 출석이 추가되었습니다`);
                      
                      // 출석 통계 다시 로드
                      await loadAttendanceStats();
                      
                      // 모달 닫기
                      setShowPastAttendanceModal(false);
                      setPastAttendanceDate('');
                      setPastAttendanceReason('');
                    }
                  } catch (error) {
                    const errorMessage = error.response?.data?.message || '출석 추가에 실패했습니다';
                    toast.error(errorMessage);
                    console.error('과거 출석 추가 실패:', error);
                  } finally {
                    setAddingPastAttendance(false);
                  }
                }}
                disabled={addingPastAttendance || !pastAttendanceDate || !pastAttendanceReason}
                className="flex-1 bg-orange-500 dark:bg-orange-600 text-white px-4 py-2 rounded font-semibold hover:bg-orange-600 dark:hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addingPastAttendance ? '추가 중...' : '출석 추가'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 기간별 출석 일괄 추가 모달 */}
      {showBulkAttendanceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              📅 기간별 출석 일괄 추가
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  사이트 / 명의
                </label>
                <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded">
                  {siteName} / {identityName}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    시작일 *
                  </label>
                  <input
                    type="date"
                    value={bulkStartDate}
                    onChange={(e) => setBulkStartDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    종료일 *
                  </label>
                  <input
                    type="date"
                    value={bulkEndDate}
                    onChange={(e) => setBulkEndDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              
              {/* 기간 미리보기 */}
              {bulkStartDate && bulkEndDate && bulkStartDate <= bulkEndDate && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
                  <div className="text-sm text-blue-800 dark:text-blue-300">
                    📊 총 <span className="font-bold">
                      {Math.ceil((new Date(bulkEndDate) - new Date(bulkStartDate)) / (1000 * 60 * 60 * 24)) + 1}일
                    </span>의 출석이 추가됩니다
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  추가 사유 * (필수)
                </label>
                <textarea
                  value={bulkReason}
                  onChange={(e) => setBulkReason(e.target.value)}
                  rows={3}
                  placeholder="예: 과거 출석 데이터 일괄 보정, 시스템 마이그레이션 등"
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                />
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  💡 왜 이 기간의 출석을 일괄 추가하는지 이유를 명확히 입력해주세요
                </div>
              </div>
              
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                <div className="text-xs text-yellow-800 dark:text-yellow-300 space-y-1">
                  <div className="font-bold">⚠️ 주의사항</div>
                  <div>• 이미 출석 기록이 있는 날짜는 자동으로 제외됩니다</div>
                  <div>• 최대 365일까지만 일괄 추가할 수 있습니다</div>
                  <div>• 추가 후 연속 출석일이 자동으로 재계산됩니다</div>
                  <div>• 모든 변경 내역은 로그로 기록됩니다</div>
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setShowBulkAttendanceModal(false);
                  setBulkStartDate('');
                  setBulkEndDate('');
                  setBulkReason('');
                }}
                disabled={addingBulkAttendance}
                className="flex-1 bg-gray-500 dark:bg-gray-600 text-white px-4 py-2 rounded font-semibold hover:bg-gray-600 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  // 입력 검증
                  if (!bulkStartDate || !bulkEndDate) {
                    toast.error('시작일과 종료일을 선택해주세요');
                    return;
                  }
                  
                  if (bulkStartDate > bulkEndDate) {
                    toast.error('시작일은 종료일보다 이전이어야 합니다');
                    return;
                  }
                  
                  if (!bulkReason || bulkReason.trim() === '') {
                    toast.error('추가 사유를 입력해주세요');
                    return;
                  }
                  
                  // 오늘 이후 날짜 체크
                  const endDate = new Date(bulkEndDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  
                  if (endDate >= today) {
                    toast.error('오늘 이전 날짜만 선택할 수 있습니다');
                    return;
                  }
                  
                  // 최대 기간 체크 (365일)
                  const daysDiff = Math.ceil((endDate - new Date(bulkStartDate)) / (1000 * 60 * 60 * 24)) + 1;
                  if (daysDiff > 365) {
                    toast.error('최대 365일까지만 일괄 추가할 수 있습니다');
                    return;
                  }
                  
                  try {
                    setAddingBulkAttendance(true);
                    
                    const response = await axiosInstance.post('/attendance/bulk-add', {
                      siteName,
                      identityName,
                      startDate: bulkStartDate,
                      endDate: bulkEndDate,
                      reason: bulkReason.trim()
                    });
                    
                    if (response.data.success) {
                      const { addedCount, skippedCount } = response.data;
                      toast.success(`✅ ${addedCount}일의 출석이 추가되었습니다 (${skippedCount}일 스킵)`);
                      
                      // 출석 통계 다시 로드
                      await loadAttendanceStats();
                      
                      // 모달 닫기
                      setShowBulkAttendanceModal(false);
                      setBulkStartDate('');
                      setBulkEndDate('');
                      setBulkReason('');
                    }
                  } catch (error) {
                    const errorMessage = error.response?.data?.message || '일괄 출석 추가에 실패했습니다';
                    toast.error(errorMessage);
                    console.error('기간별 출석 일괄 추가 실패:', error);
                  } finally {
                    setAddingBulkAttendance(false);
                  }
                }}
                disabled={addingBulkAttendance || !bulkStartDate || !bulkEndDate || !bulkReason}
                className="flex-1 bg-purple-500 dark:bg-purple-600 text-white px-4 py-2 rounded font-semibold hover:bg-purple-600 dark:hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addingBulkAttendance ? '추가 중...' : '일괄 추가'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 출석 히스토리 모달 */}
      {showAttendanceHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                📊 출석 히스토리
              </h3>
              <button
                onClick={() => setShowAttendanceHistory(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <div><strong>사이트:</strong> {siteName}</div>
                <div><strong>명의:</strong> {identityName}</div>
              </div>
            </div>
            
            {renderAttendanceCalendar()}
            
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowAttendanceHistory(false)}
                className="px-4 py-2 bg-gray-500 dark:bg-gray-600 text-white rounded font-semibold hover:bg-gray-600 dark:hover:bg-gray-700 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SiteNotesModal;

