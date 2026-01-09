const db = require('../database/db');
const { getKSTDateString } = require('./time');
const { getSiteNoteData, getAccountOfficeId } = require('../services/siteNotesService');

/**
 * 출석 로그 추가
 */
/**
 * 출석 로그 추가 (단순 버전)
 * - INSERT OR IGNORE 사용
 * - 성공 여부 반환
 */
async function addAttendanceLog({ accountId, siteName, identityName, attendanceDate }) {
  if (!accountId || !siteName || !identityName || !attendanceDate) {
    throw new Error('필수 파라미터 누락');
  }

  try {
    const result = await db.run(
      `INSERT OR IGNORE INTO site_attendance_log (account_id, site_name, identity_name, attendance_date, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [accountId, siteName, identityName, attendanceDate]
    );
    
    // changes > 0이면 새로 추가됨, 0이면 이미 존재
    return result.changes > 0;
  } catch (error) {
    console.error('출석 로그 추가 실패:', error.message);
    throw error;
  }
}

/**
 * 출석 로그 삭제 (단순 버전)
 */
async function removeAttendanceLog({ accountId, siteName, identityName, attendanceDate }) {
  if (!accountId || !siteName || !identityName || !attendanceDate) {
    throw new Error('필수 파라미터 누락');
  }

  try {
    const result = await db.run(
      `DELETE FROM site_attendance_log 
       WHERE account_id = ? AND site_name = ? AND identity_name = ? AND attendance_date = ?`,
      [accountId, siteName, identityName, attendanceDate]
    );
    return result.changes > 0;
  } catch (error) {
    console.error('출석 로그 삭제 실패:', error.message);
    throw error;
  }
}

/**
 * 출석 로그 조회 (특정 월)
 */
async function getAttendanceLogs({ accountId, siteName, identityName, yearMonth }) {
  if (!accountId || !siteName || !identityName) {
    return [];
  }

  let query = `SELECT attendance_date FROM site_attendance_log 
               WHERE account_id = ? AND site_name = ? AND identity_name = ?`;
  const params = [accountId, siteName, identityName];

  if (yearMonth) {
    query += ` AND attendance_date LIKE ?`;
    params.push(`${yearMonth}%`);
  }

  query += ` ORDER BY attendance_date DESC`;

  try {
    const rows = await db.all(query, params);
    return rows.map(row => row.attendance_date);
  } catch (error) {
    console.error('출석 로그 조회 실패:', error);
    return [];
  }
}

/**
 * 특정 날짜 출석 여부 확인
 */
async function checkAttendanceExists({ accountId, siteName, identityName, attendanceDate }) {
  if (!accountId || !siteName || !identityName || !attendanceDate) {
    return false;
  }

  try {
    const row = await db.get(
      `SELECT 1 FROM site_attendance_log 
       WHERE account_id = ? AND site_name = ? AND identity_name = ? AND attendance_date = ?`,
      [accountId, siteName, identityName, attendanceDate]
    );
    return !!row;
  } catch (error) {
    console.error('출석 확인 실패:', error);
    return false;
  }
}

/**
 * 연속 출석일 계산
 * - endDate: 기준 날짜 (없으면 오늘)
 * - limitMonth: 'YYYY-MM' 형식, 주어지면 해당 월을 벗어나면 중단 (이월 X용)
 * - rollover: 이월 설정 ('O' 또는 'X')
 */
async function calculateConsecutiveDays({ accountId, siteName, identityName, endDate, limitMonth, rollover }) {
  const logs = await getAttendanceLogs({ accountId, siteName, identityName });
  
  if (logs.length === 0) {
    return 0;
  }

  const targetDate = endDate || getKSTDateString();
  let consecutiveDays = 0;
  let checkDate = targetDate;

  // 빠른 조회를 위해 Set 사용
  const logSet = new Set(logs);

  // 기준 날짜부터 거꾸로 체크
  while (logSet.has(checkDate)) {
    // limitMonth가 설정된 경우, 월이 바뀌면 중단 (이월 X)
    if (limitMonth && !checkDate.startsWith(limitMonth)) {
      break;
    }

    consecutiveDays++;
    checkDate = getPreviousDay(checkDate);
    
    // 최대 365일까지만 체크 (성능 보호)
    if (consecutiveDays >= 365) break;
  }

  // 이월 O인 경우: 30일 초과 시 30으로 나눈 나머지 반환 (1-30 범위로 순환)
  // 예: 30일 → 30일, 31일 → 1일, 60일 → 30일, 61일 → 1일
  if (rollover === 'O' && consecutiveDays > 30) {
    const remainder = consecutiveDays % 30;
    return remainder === 0 ? 30 : remainder;
  }

  return consecutiveDays;
}

/**
 * 총 출석일 계산 (특정 월)
 */
async function calculateTotalDays({ accountId, siteName, identityName, yearMonth }) {
  const logs = await getAttendanceLogs({ accountId, siteName, identityName, yearMonth });
  return logs.length;
}

/**
 * 출석 통계 조회
 */
async function getAttendanceStats({ accountId, siteName, identityName }) {
  const now = new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const yearMonth = `${year}-${month}`;

  // 모든 출석 로그 가져오기 (yearMonth 없이)
  const allLogs = await getAttendanceLogs({ accountId, siteName, identityName });
  const lastAttendance = allLogs.length > 0 ? allLogs[0] : null;
  
  // 현재 월의 로그만 가져오기 (totalDays 계산용)
  const logs = await getAttendanceLogs({ accountId, siteName, identityName, yearMonth });

  // 사이트 설정에서 이월 여부 가져오기 (기본: 'X')
  let rollover = 'X';
  try {
    // site_notes에서 이월 설정 조회 (명의별이 아니므로 identityName은 null)
    const officeId = await getAccountOfficeId(accountId);
    const siteNote = await getSiteNoteData({
      siteName,
      identityName: null, // 이월 설정은 명의별이 아니므로 null
      accountId,
      officeId
    });
    if (siteNote?.data?.rollover && typeof siteNote.data.rollover === 'string') {
      rollover = siteNote.data.rollover;
    }
  } catch (e) {
    // 오류가 발생해도 기본값 'X'를 사용하므로 조용히 처리
    // console.warn('rollover 조회 실패:', e.message);
  }

  // 이월 설정에 따라 연속 출석일 기준 월 제한 결정
  const limitMonth = rollover === 'X' ? yearMonth : null;

  // 연속 출석일은 마지막 출석일을 기준으로 계산
  // 마지막 출석일이 없으면 오늘 날짜를 기준으로 계산
  let consecutiveDays = await calculateConsecutiveDays({
    accountId,
    siteName,
    identityName,
    endDate: lastAttendance || undefined, // 마지막 출석일 기준으로 계산
    limitMonth,
    rollover
  });

  // TODO: attendanceDays(보정값)와 site_attendance의 last_recorded_at(보정 기준일)을
  // 활용한 "보정 + 이후 연속성" 로직은 다음 단계에서 추가 구현

  return {
    consecutiveDays,
    totalDays: logs.length,
    lastAttendanceDate: lastAttendance,
    recentLogs: logs.slice(0, 7) // 최근 7일
  };
}

/**
 * 이전 날짜 계산
 */
function getPreviousDay(dateString) {
  const date = new Date(dateString);
  date.setDate(date.getDate() - 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 월 변경 시 이월 처리
 */
async function handleMonthlyRollover({ accountId, siteName, identityName, rollover }) {
  // 이월 O면 아무것도 안함
  if (rollover === 'O') {
    return;
  }

  // 이월 X면 이전 달 로그는 유지하되, 통계만 초기화
  // (실제로는 통계를 계산할 때 yearMonth 파라미터로 필터링하므로 자동 처리됨)
  return;
}

module.exports = {
  addAttendanceLog,
  removeAttendanceLog,
  getAttendanceLogs,
  checkAttendanceExists,
  calculateConsecutiveDays,
  calculateTotalDays,
  getAttendanceStats,
  handleMonthlyRollover
};

