/**
 * 🎯 자동 출석 서비스 (v5)
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 📌 핵심 원칙
 * ═══════════════════════════════════════════════════════════════════
 * - 충전금액 > 0 이면 출석 로그 추가
 * - 충전금액 = 0 이면 출석 로그 제거
 * - 모든 날짜는 KST (Asia/Seoul) 기준
 * - 단순하고 명확한 로직
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 📌 이월 설정 (rollover) 상세 설명
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 1️⃣ 이월 X (rollover = 'X') - 기본값
 *    - 매월 1일에 출석일이 초기화됨
 *    - 예: 12월 28~31일 연속 출석 (4일) → 1월 1일 충전 시 1일부터 시작
 *    - 월이 바뀌면 이전 월 출석은 연속일 계산에서 제외
 * 
 * 2️⃣ 이월 O (rollover = 'O')
 *    - 월 경계와 관계없이 연속 출석일 계속 누적
 *    - 30일 초과 시 순환: 31일→1일, 60일→30일, 61일→1일
 *    - 예: 12월 28~31일 (4일) → 1월 1~3일 연속 시 7일로 표시
 *    - 30일 연속 후 다음날 충전 시 1일부터 다시 시작
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 📌 버전 히스토리
 * ═══════════════════════════════════════════════════════════════════
 * v3: 트랜잭션, 날짜 변경 처리, 이름 정규화
 * v4: 자동 생성 보완, 캐싱, 수동 모드 전환 처리
 * v5: KST 일관성, 이월 로직 문서화, 동시성 처리
 * 
 * 참고: 수동 출석은 attendance.js + attendanceLog.js에서 처리
 */

const db = require('../database/db');
const { getAccountOfficeId, getSiteNoteData } = require('./siteNotesService');
const { 
  addAttendanceLog, 
  removeAttendanceLog 
} = require('../utils/attendanceLog');
const { getKSTDateString } = require('../utils/time');

// 개발 모드 확인 (로그 출력 여부)
const DEBUG = process.env.NODE_ENV !== 'production';
const log = (...args) => DEBUG && console.log(...args);

// 🔧 요청 단위 캐시 (매 요청마다 초기화)
let settingsCache = new Map();
let identityCache = new Map();
let officeIdCache = new Map();

/**
 * 캐시 초기화 (각 요청 시작 시 호출)
 */
function clearCache() {
  settingsCache.clear();
  identityCache.clear();
  officeIdCache.clear();
}

/**
 * 🔧 이름 정규화 - trim + 연속 공백 제거
 */
function normalizeName(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ');
}

/**
 * 충전금액 파싱 - 첫 번째 숫자 추출
 */
function parseCharge(value) {
  if (!value) return 0;
  const str = String(value).trim();
  const match = str.match(/^(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * 사이트 설정 조회 (출석타입, 이월 설정) - 캐싱 적용
 */
async function getSiteSettings(accountId, siteName, identityName) {
  const cacheKey = `${accountId}:${siteName}:${identityName}`;
  
  // 캐시 확인
  if (settingsCache.has(cacheKey)) {
    return settingsCache.get(cacheKey);
  }
  
  try {
    // officeId 캐싱
    let officeId = officeIdCache.get(accountId);
    if (officeId === undefined) {
      officeId = await getAccountOfficeId(accountId);
      officeIdCache.set(accountId, officeId);
    }
    
    const notes = await getSiteNoteData({ siteName, identityName, accountId, officeId });
    const settings = {
      attendanceType: notes?.data?.attendanceType || '자동',
      rollover: notes?.data?.rollover || 'X'  // 기본값: 이월 안함
    };
    
    // 캐시 저장
    settingsCache.set(cacheKey, settings);
    return settings;
  } catch (e) {
    const defaultSettings = { attendanceType: '자동', rollover: 'X' };
    settingsCache.set(cacheKey, defaultSettings);
    return defaultSettings;
  }
}

/**
 * Identity ID 조회/생성 - 캐싱 및 자동 생성 적용
 */
async function getIdentityId(accountId, identityName, createIfMissing = false) {
  const cacheKey = `${accountId}:${identityName}`;
  
  // 캐시 확인
  if (identityCache.has(cacheKey)) {
    return identityCache.get(cacheKey);
  }
  
  let row = await db.get(
    'SELECT id FROM identities WHERE account_id = ? AND name = ?',
    [accountId, identityName]
  );
  
  // 없으면 자동 생성
  if (!row && createIfMissing) {
    try {
      const result = await db.run(
        `INSERT INTO identities (account_id, name, phone, memo, display_order, status) 
         VALUES (?, ?, '', '자동생성', 999, 'active')`,
        [accountId, identityName]
      );
      const newId = result.id;
      identityCache.set(cacheKey, newId);
      log(`   [출석] 명의 자동 생성: ${identityName} (id: ${newId})`);
      return newId;
    } catch (e) {
      // UNIQUE constraint 위반 시 다시 조회
      row = await db.get(
        'SELECT id FROM identities WHERE account_id = ? AND name = ?',
        [accountId, identityName]
      );
    }
  }
  
  const id = row?.id || null;
  identityCache.set(cacheKey, id);
  return id;
}

/**
 * Site Account ID 조회/생성
 */
async function getSiteAccountId(identityId, siteName, createIfMissing = false) {
  if (!identityId) return null;
  
  let row = await db.get(
    'SELECT id FROM site_accounts WHERE identity_id = ? AND site_name = ?',
    [identityId, siteName]
  );
  
  if (!row && createIfMissing) {
    try {
      const result = await db.run(
        `INSERT INTO site_accounts (identity_id, site_name, status, notes, status_history) 
         VALUES (?, ?, 'auto', '자동생성', '[]')`,
        [identityId, siteName]
      );
      log(`   [출석] 사이트 계정 자동 생성: ${siteName} (id: ${result.id})`);
      return result.id;
    } catch (e) {
      // UNIQUE constraint 위반 시 다시 조회
      row = await db.get(
        'SELECT id FROM site_accounts WHERE identity_id = ? AND site_name = ?',
        [identityId, siteName]
      );
    }
  }
  
  return row?.id;
}

/**
 * 출석 로그 추가 (attendanceLog.js의 함수 사용)
 */
async function insertLog(accountId, siteName, identityName, date) {
  return await addAttendanceLog({
    accountId,
    siteName,
    identityName,
    attendanceDate: date
  });
}

/**
 * 출석 로그 삭제 (attendanceLog.js의 함수 사용)
 */
async function deleteLog(accountId, siteName, identityName, date) {
  return await removeAttendanceLog({
    accountId,
    siteName,
    identityName,
    attendanceDate: date
  });
}

/**
 * 🔧 날짜 문자열에서 이전 날짜 계산 (KST 기준, UTC 오류 방지)
 * @param {string} dateStr - 'YYYY-MM-DD' 형식
 * @returns {string} 이전 날짜 'YYYY-MM-DD'
 */
function getPreviousDateKST(dateStr) {
  // UTC 시간대 오류 방지: 정오(12:00)를 기준으로 계산
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  date.setDate(date.getDate() - 1);
  
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 연속 출석일 계산 (이월 설정 반영)
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 이월 X: 월 경계에서 중단                                      │
 * │ 이월 O: 30일 초과 시 순환 (31일→1일, 60일→30일, 61일→1일)      │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * @param {number} accountId - 계정 ID
 * @param {string} siteName - 사이트명
 * @param {string} identityName - 명의명
 * @param {string} rollover - 'O' 또는 'X'
 * @param {string} includeDate - 방금 추가한 날짜 (DB 캐시 문제 해결용)
 * @returns {number} 연속 출석일
 */
async function calcConsecutiveDays(accountId, siteName, identityName, rollover = 'X') {
  // 커밋 후 호출되므로 DB에서 최신 데이터를 확실히 조회
  const logs = await db.all(
    `SELECT attendance_date FROM site_attendance_log
     WHERE account_id = ? AND site_name = ? AND identity_name = ?
     ORDER BY attendance_date DESC`,
    [accountId, siteName, identityName]
  );
  
  const dates = new Set(logs.map(l => l.attendance_date));
  if (dates.size === 0) return 0;
  
  // 가장 최근 날짜 찾기 (includeDate가 더 최근일 수 있음)
  const allDates = Array.from(dates).sort().reverse();
  let checkDate = allDates[0];
  
  // 현재 월 계산 (이월 X일 때 월 경계 체크용)
  const currentMonth = checkDate.substring(0, 7); // YYYY-MM
  
  let days = 0;
  while (dates.has(checkDate)) {
    // 이월 X인 경우: 월이 바뀌면 중단
    if (rollover === 'X') {
      const checkMonth = checkDate.substring(0, 7);
      if (checkMonth !== currentMonth) {
        break;
      }
    }
    
    days++;
    // KST 기준 이전 날짜 계산 (UTC 오류 방지)
    checkDate = getPreviousDateKST(checkDate);
    if (days > 365) break;
  }
  
  // 이월 O인 경우: 30일 초과 시 순환 (31일 → 1일, 60일 → 30일, 61일 → 1일)
  if (rollover === 'O' && days > 30) {
    const remainder = days % 30;
    return remainder === 0 ? 30 : remainder;
  }
  
  return days;
}

/**
 * site_attendance 테이블 업데이트
 */
async function updateAttendance(accountId, identityId, siteAccountId, days, lastDate) {
  await db.run(
    `INSERT OR REPLACE INTO site_attendance 
     (account_id, identity_id, site_account_id, period_type, period_value, attendance_days, last_recorded_at, updated_at)
     VALUES (?, ?, ?, 'total', 'all', ?, ?, datetime('now'))`,
    [accountId, identityId, siteAccountId, days, lastDate]
  );
}

/**
 * 🎯 단일 사이트 출석 처리 (독립적으로 호출 시 사용)
 * 주의: 트랜잭션 내에서 사용하면 안됨 (커밋 후 출석일 조회 필요)
 */
async function processSiteAttendance(accountId, siteName, identityName, chargeValue, date) {
  // 사이트 설정 조회 (출석타입, 이월 설정)
  const settings = await getSiteSettings(accountId, siteName, identityName);
  
  // '수동'이면 스킵
  if (settings.attendanceType !== '자동') {
    log(`   [출석] ${identityName}/${siteName}: 수동 모드 - 스킵`);
    return null;
  }
  
  // 충전금액 파싱
  const charge = parseCharge(chargeValue);
  
  // 핵심 로직: 충전 > 0 이면 추가, 아니면 제거
  if (charge > 0) {
    await insertLog(accountId, siteName, identityName, date);
  } else {
    await deleteLog(accountId, siteName, identityName, date);
  }
  
  // 이월 설정 반영하여 출석일 계산
  const days = await calcConsecutiveDays(accountId, siteName, identityName, settings.rollover);
  
  // 출석일 테이블 업데이트 (가능한 경우)
  // 충전이 있으면 identity와 site_account 자동 생성
  const identityId = await getIdentityId(accountId, identityName, charge > 0);
  if (identityId) {
    const siteAccountId = await getSiteAccountId(identityId, siteName, charge > 0);
    if (siteAccountId) {
      await updateAttendance(accountId, identityId, siteAccountId, days, charge > 0 ? date : null);
    } else {
      log(`   [출석] ${identityName}/${siteName}: siteAccountId 없음 (출석일: ${days})`);
    }
  } else {
    log(`   [출석] ${identityName}/${siteName}: identityId 없음 (출석일: ${days})`);
  }
  
  log(`   [출석] ${identityName}/${siteName}: ${days}일 (이월: ${settings.rollover})`);
  return days;
}

/**
 * 수동 모드 전환 시 기존 자동 출석 로그 삭제
 * - 사이트 설정에서 '자동' → '수동'으로 변경할 때 호출
 * @param {number} accountId - 계정 ID
 * @param {string} siteName - 사이트명
 * @param {string} identityName - 명의명
 * @param {boolean} deleteAllLogs - true면 모든 로그 삭제, false면 유지
 */
async function handleModeChange(accountId, siteName, identityName, deleteAllLogs = false) {
  if (!deleteAllLogs) {
    log(`[출석] ${identityName}/${siteName}: 수동 모드 전환 - 기존 로그 유지`);
    return { deleted: 0 };
  }
  
  try {
    const result = await db.run(
      `DELETE FROM site_attendance_log 
       WHERE account_id = ? AND site_name = ? AND identity_name = ?`,
      [accountId, normalizeName(siteName), normalizeName(identityName)]
    );
    
    log(`[출석] ${identityName}/${siteName}: 수동 모드 전환 - ${result.changes}개 로그 삭제`);
    return { deleted: result.changes };
  } catch (error) {
    console.error('[출석] 수동 모드 전환 시 로그 삭제 실패:', error);
    throw error;
  }
}

/**
 * 레코드 수정 시 출석 처리 (트랜잭션 적용)
 * @param {number} accountId - 계정 ID
 * @param {object} oldRecord - 이전 레코드 (수정 전)
 * @param {object} newRecord - 새 레코드 (수정 후)
 * @param {string} newRecordDate - 새 레코드 날짜
 * @param {string} oldRecordDate - 이전 레코드 날짜 (날짜 변경 감지용, 옵션)
 */
async function handleUpdateRecord(accountId, oldRecord, newRecord, newRecordDate, oldRecordDate = null) {
  // 요청 시작 시 캐시 초기화
  clearCache();
  
  const result = {};
  const sitesToCalculate = []; // 커밋 후 출석일 계산할 사이트 목록
  const newDate = newRecordDate ? newRecordDate.split('T')[0] : null;
  const oldDate = oldRecordDate ? oldRecordDate.split('T')[0] : (oldRecord?.record_date ? oldRecord.record_date.split('T')[0] : null);
  
  if (!newDate && !oldDate) return result;
  
  log(`\n[출석] 레코드 업데이트 - 새 날짜: ${newDate}, 이전 날짜: ${oldDate}`);
  
  // 1단계: 트랜잭션 내에서 로그 추가/삭제만 수행
  try {
    await db.beginTransaction();
    
    // 날짜가 변경된 경우: 이전 날짜의 모든 로그 제거
    const dateChanged = oldDate && newDate && oldDate !== newDate;
    if (dateChanged) {
      log(`[출석] 날짜 변경 감지: ${oldDate} → ${newDate}, 이전 날짜 로그 정리`);
      for (let i = 1; i <= 4; i++) {
        const oldSite = normalizeName(oldRecord?.[`site_name${i}`]);
        const oldIdentity = normalizeName(oldRecord?.[`identity${i}`]);
        if (oldSite && oldIdentity) {
          await processLogOnly(accountId, oldSite, oldIdentity, '', oldDate);
          log(`   [출석] ${oldIdentity}/${oldSite}: ${oldDate} 로그 제거`);
        }
      }
    }
    
    for (let i = 1; i <= 4; i++) {
      // 이름 정규화 적용
      const oldSite = normalizeName(oldRecord?.[`site_name${i}`]);
      const oldIdentity = normalizeName(oldRecord?.[`identity${i}`]);
      const oldChargeRaw = oldRecord?.[`charge_withdraw${i}`] || '';
      
      const newSite = normalizeName(newRecord?.[`site_name${i}`]);
      const newIdentity = normalizeName(newRecord?.[`identity${i}`]);
      const newChargeRaw = newRecord?.[`charge_withdraw${i}`] || '';
      
      const oldCharge = parseCharge(oldChargeRaw);
      const newCharge = parseCharge(newChargeRaw);
      
      // 명의/사이트가 변경되었는지 확인
      const siteChanged = oldSite && oldIdentity && (oldSite !== newSite || oldIdentity !== newIdentity);
      
      // 새 데이터가 있을 때만 처리
      if (newSite && newIdentity && newDate) {
        // 출석 로그 추가/삭제가 필요한 경우:
        // 1) 충전금액이 변경된 경우
        // 2) 명의/사이트가 변경된 경우 (같은 금액이라도 새 명의/사이트에 로그 생성 필요)
        // 3) 날짜가 변경된 경우 (같은 금액이라도 새 날짜에 로그 생성 필요)
        const needsLogUpdate = oldCharge !== newCharge || siteChanged || dateChanged;
        
        if (needsLogUpdate) {
          await processLogOnly(accountId, newSite, newIdentity, newChargeRaw, newDate);
          log(`   [출석] ${newIdentity}/${newSite}: 출석 로그 처리 (금액변경: ${oldCharge !== newCharge}, 사이트변경: ${!!siteChanged}, 날짜변경: ${!!dateChanged}), 출석 로그 ${newCharge > 0 ? '추가' : '삭제'}`);
        }
        // 충전금액이 변경되지 않았어도 출석일은 재계산해야 함 (다른 날짜의 출석 로그가 변경되었을 수 있음)
        sitesToCalculate.push({ siteName: newSite, identityName: newIdentity, chargeRaw: newChargeRaw, date: newDate });
      }
      
      // 명의/사이트가 변경된 경우 기존 데이터도 처리 (로그 제거) - 같은 날짜 내에서
      if (siteChanged && !dateChanged && newDate) {
        await processLogOnly(accountId, oldSite, oldIdentity, '', newDate);
        sitesToCalculate.push({ siteName: oldSite, identityName: oldIdentity, chargeRaw: '', date: newDate });
      }
    }
    
    await db.commit();
    log(`[출석] 트랜잭션 커밋 완료`);
  } catch (error) {
    await db.rollback();
    console.error('[출석] 트랜잭션 롤백:', error);
    throw error;
  }
  
  // 2단계: 커밋 후 출석일 조회 (DB에 확실히 반영된 상태에서)
  for (const { siteName, identityName, chargeRaw, date } of sitesToCalculate) {
    const days = await calculateAndUpdateAttendance(accountId, siteName, identityName, chargeRaw, date);
    if (days !== null) {
      result[`${identityName}||${siteName}`] = days;
    }
  }
  
  log(`[출석] 처리 완료:`, result);
  return result;
}

/**
 * 로그 추가/삭제만 수행 (출석일 계산 없음)
 */
async function processLogOnly(accountId, siteName, identityName, chargeValue, date) {
  const settings = await getSiteSettings(accountId, siteName, identityName);
  if (settings.attendanceType !== '자동') {
    log(`   [출석] ${identityName}/${siteName}: 수동 모드 - 스킵`);
    return;
  }
  
  const charge = parseCharge(chargeValue);
  if (charge > 0) {
    await insertLog(accountId, siteName, identityName, date);
  } else {
    await deleteLog(accountId, siteName, identityName, date);
  }
}

/**
 * 출석일 계산 및 업데이트 (커밋 후 호출)
 */
async function calculateAndUpdateAttendance(accountId, siteName, identityName, chargeValue, date) {
  const settings = await getSiteSettings(accountId, siteName, identityName);
  if (settings.attendanceType !== '자동') {
    return null;
  }
  
  const charge = parseCharge(chargeValue);
  const days = await calcConsecutiveDays(accountId, siteName, identityName, settings.rollover);
  
  // 출석일 테이블 업데이트
  const identityId = await getIdentityId(accountId, identityName, charge > 0);
  if (identityId) {
    const siteAccountId = await getSiteAccountId(identityId, siteName, charge > 0);
    if (siteAccountId) {
      await updateAttendance(accountId, identityId, siteAccountId, days, charge > 0 ? date : null);
    }
  }
  
  log(`   [출석] ${identityName}/${siteName}: ${days}일 (이월: ${settings.rollover})`);
  return days;
}

/**
 * 새 레코드 생성 시 출석 처리
 */
async function handleNewRecord(accountId, record, recordDate) {
  log('\n[출석] 새 레코드 생성');
  return handleUpdateRecord(accountId, null, record, recordDate);
}

/**
 * 레코드 삭제 시 출석 처리
 */
async function handleDeleteRecord(accountId, record, recordDate) {
  log('\n[출석] 레코드 삭제');
  return handleUpdateRecord(accountId, record, null, recordDate);
}

module.exports = {
  handleNewRecord,
  handleUpdateRecord,
  handleDeleteRecord,
  handleModeChange,  // 수동 모드 전환 시 로그 처리
  clearCache         // 캐시 초기화 (테스트용)
};
