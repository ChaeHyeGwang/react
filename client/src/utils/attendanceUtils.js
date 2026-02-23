import axiosInstance from '../api/axios';

/**
 * 출석 통계 조회
 */
export async function getAttendanceStats(siteName, identityName) {
  try {
    if (!siteName || !identityName || siteName.trim() === '' || identityName.trim() === '') {
      console.warn('⚠️ [attendanceUtils] 필수 파라미터 누락:', { siteName, identityName });
      return null;
    }
    
    const response = await axiosInstance.get('/attendance/stats', {
      params: { siteName, identityName }
    });
    
    if (response.data.success) {
      return response.data;
    }
    console.warn('⚠️ [attendanceUtils] success=false:', response.data);
    return null;
  } catch (error) {
    console.error('❌ [attendanceUtils] 출석 통계 조회 실패:', error);
    console.error('에러 상세:', error.response?.data || error.message);
    return null;
  }
}

/**
 * 출석 로그 조회
 */
export async function getAttendanceLogs(siteName, identityName, yearMonth) {
  try {
    const response = await axiosInstance.get('/attendance/logs', {
      params: { siteName, identityName, yearMonth }
    });
    
    if (response.data.success) {
      return response.data.logs || [];
    }
    return [];
  } catch (error) {
    console.error('출석 로그 조회 실패:', error);
    return [];
  }
}

/**
 * 출석 토글 (추가/제거)
 * - desiredState: true = 출완(로그 있어야 함), false = 출필(로그 없어야 함)
 *   생략 시 서버에서 기존 토글 방식으로 처리
 */
export async function toggleAttendance(siteName, identityName, attendanceDate, desiredState) {
  try {
    const response = await axiosInstance.post('/attendance/toggle', {
      siteName,
      identityName,
      attendanceDate,
      desiredState
    });
    
    if (response.data.success) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.error('출석 토글 실패:', error);
    throw error;
  }
}

/**
 * KST Intl.DateTimeFormat (서버와 동일한 타임존 사용)
 */
const KST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function formatKSTDate(date = new Date()) {
  // en-CA 로케일은 YYYY-MM-DD 형식으로 반환
  return KST_FORMATTER.format(date);
}

/**
 * 연속 출석 계산 (클라이언트 측)
 */
export function calculateConsecutiveDays(logs, endDate = null) {
  if (!logs || logs.length === 0) {
    return 0;
  }

  const targetDate = endDate || getTodayDateString();
  const logSet = new Set(logs);
  
  let consecutiveDays = 0;
  let checkDate = targetDate;

  for (let i = 0; i < 365; i++) { // 최대 365일
    if (logSet.has(checkDate)) {
      consecutiveDays++;
      checkDate = getPreviousDay(checkDate);
    } else {
      break;
    }
  }

  return consecutiveDays;
}

/**
 * 오늘 날짜 문자열 (YYYY-MM-DD, KST 기준)
 */
export function getTodayDateString() {
  return formatKSTDate(new Date());
}

/**
 * 현재 년-월 문자열 (YYYY-MM, KST 기준)
 */
export function getCurrentMonthString() {
  return formatKSTDate(new Date()).substring(0, 7);
}

/**
 * 이전 날짜 계산 (UTC 오류 방지: 정오 기준 계산)
 */
export function getPreviousDay(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  date.setDate(date.getDate() - 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 최근 N일의 출석 여부 배열 반환
 */
export function getRecentAttendance(logs, days = 7) {
  const logSet = new Set(logs);
  const result = [];
  let checkDate = getTodayDateString();
  
  for (let i = 0; i < days; i++) {
    result.push({
      date: checkDate,
      attended: logSet.has(checkDate)
    });
    checkDate = getPreviousDay(checkDate);
  }
  
  return result;
}

/**
 * 출석률 계산
 */
export function calculateAttendanceRate(logs, yearMonth) {
  if (!yearMonth) {
    yearMonth = getCurrentMonthString();
  }
  
  const monthLogs = logs.filter(log => log.startsWith(yearMonth));
  const daysInMonth = getDaysInMonth(yearMonth);
  
  // 이번 달이면 오늘(KST)까지만 계산
  const todayStr = getTodayDateString();
  const todayDay = parseInt(todayStr.split('-')[2], 10);
  const targetDays = yearMonth === getCurrentMonthString() ? todayDay : daysInMonth;
  
  const rate = (monthLogs.length / targetDays) * 100;
  return Math.round(rate);
}

/**
 * 특정 월의 총 일수
 */
export function getDaysInMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

/**
 * 출석 캘린더 데이터 생성
 */
export function generateAttendanceCalendar(logs, yearMonth) {
  if (!yearMonth) {
    yearMonth = getCurrentMonthString();
  }
  
  const logSet = new Set(logs);
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = getDaysInMonth(yearMonth);
  const calendar = [];
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendar.push({
      date: dateString,
      day,
      attended: logSet.has(dateString)
    });
  }
  
  return calendar;
}

export default {
  getAttendanceStats,
  getAttendanceLogs,
  toggleAttendance,
  calculateConsecutiveDays,
  getTodayDateString,
  getCurrentMonthString,
  getPreviousDay,
  getRecentAttendance,
  calculateAttendanceRate,
  generateAttendanceCalendar
};

