const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  addAttendanceLog,
  removeAttendanceLog,
  getAttendanceStats,
  checkAttendanceExists,
  getAttendanceLogs
} = require('../utils/attendanceLog');
const db = require('../database/db');
const { getAccountOfficeId } = require('../services/siteNotesService');

// 출석 통계 조회 API
router.get('/stats', auth, async (req, res) => {
  try {
    const { siteName, identityName } = req.query;
    
    // 빈 문자열도 체크
    if (!siteName || !identityName || siteName.trim() === '' || identityName.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: '사이트명과 명의명이 필요합니다' 
      });
    }
    
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    const stats = await getAttendanceStats({
      accountId,
      siteName,
      identityName
    });
    
    res.json({
      success: true,
      ...stats
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: '출석 통계 조회 실패',
      error: error.message 
    });
  }
});

// 출석 로그 조회 API
router.get('/logs', auth, async (req, res) => {
  try {
    const { siteName, identityName, yearMonth } = req.query;
    
    if (!siteName || !identityName) {
      return res.status(400).json({ 
        success: false, 
        message: '사이트명과 명의명이 필요합니다' 
      });
    }
    
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    const logs = await getAttendanceLogs({
      accountId,
      siteName,
      identityName,
      yearMonth
    });
    
    res.json({
      success: true,
      logs
    });
    
  } catch (error) {
    console.error('출석 로그 조회 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '출석 로그 조회 실패',
      error: error.message 
    });
  }
});

// 출석 토글 API (추가/제거)
// - desiredState(옵션): true = 출완(로그 있어야 함), false = 출필(로그 없어야 함)
//   전달되지 않으면 기존처럼 토글 동작
router.post('/toggle', auth, async (req, res) => {
  try {
    const { siteName, identityName, attendanceDate, desiredState } = req.body;
    
    if (!siteName || !identityName || !attendanceDate) {
      return res.status(400).json({ 
        success: false, 
        message: '필수 정보가 누락되었습니다' 
      });
    }
    
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    // 현재 출석 상태 확인
    const exists = await checkAttendanceExists({
      accountId,
      siteName,
      identityName,
      attendanceDate
    });
    
    let action = 'noop';

    // 1) desiredState가 명시된 경우: "원하는 상태"에 맞게만 INSERT / DELETE 수행
    if (typeof desiredState === 'boolean') {
      if (desiredState && !exists) {
        // 출완 상태가 되어야 하는데 로그가 없으면 → 추가
        await addAttendanceLog({
          accountId,
          siteName,
          identityName,
          attendanceDate
        });
        action = 'added';
      } else if (!desiredState && exists) {
        // 출필 상태가 되어야 하는데 로그가 있으면 → 삭제
        await removeAttendanceLog({
          accountId,
          siteName,
          identityName,
          attendanceDate
        });
        action = 'removed';
      } else {
        // 이미 원하는 상태와 일치 → 아무 것도 안 함
        action = 'noop';
      }
    } else {
      // 2) desiredState가 없으면 기존 토글 방식 유지 (호환용)
      if (exists) {
        await removeAttendanceLog({
          accountId,
          siteName,
          identityName,
          attendanceDate
        });
        action = 'removed';
      } else {
        await addAttendanceLog({
          accountId,
          siteName,
          identityName,
          attendanceDate
        });
        action = 'added';
      }
    }

    // 출석 로그 추가/제거 후 출석일 재계산
    try {
      // identity_id와 site_account_id 조회
      const identity = await db.get(
        `SELECT i.id AS identity_id
         FROM identities i
         WHERE i.account_id = ? AND i.name = ?`,
        [accountId, identityName]
      );
      
      if (identity) {
        const siteAccount = await db.get(
          `SELECT id FROM site_accounts 
           WHERE identity_id = ? AND site_name = ?
           LIMIT 1`,
          [identity.identity_id, siteName]
        );
        
        if (siteAccount) {
          // 출석 통계 조회 (로그 기반으로 계산)
          const stats = await getAttendanceStats({
            accountId,
            siteName,
            identityName
          });
          
          const consecutiveDays = stats.consecutiveDays || 0;
          const lastAttendanceDate = stats.lastAttendanceDate;
          
          // site_notes에서 rollover 정보 조회
          const officeId = await getAccountOfficeId(accountId);
          const { getSiteNoteData } = require('../services/siteNotesService');
          const siteNotes = await getSiteNoteData({
            siteName,
            identityName,
            accountId,
            officeId
          });
          const rollover = siteNotes?.data?.rollover || 'X';
          
          // 현재 월 계산
          const now = new Date();
          const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
          const year = kstDate.getFullYear();
          const month = String(kstDate.getMonth() + 1).padStart(2, '0');
          const currentMonth = `${year}-${month}`;
          
          const { getKSTDateTimeString } = require('../utils/time');
          const timestamp = getKSTDateTimeString();
          
          // 출석 기록 조회 또는 업데이트
          let attendance = await db.get(
            `SELECT * FROM site_attendance
             WHERE account_id = ? AND identity_id = ? AND site_account_id = ?
             AND period_type = 'total' AND period_value = 'all'`,
            [accountId, identity.identity_id, siteAccount.id]
          );
          
          if (!attendance) {
            // 출석 기록이 없으면 새로 생성
            await db.run(
              `INSERT INTO site_attendance (account_id, identity_id, site_account_id, period_type, period_value, attendance_days, current_month, last_recorded_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [accountId, identity.identity_id, siteAccount.id, 'total', 'all', consecutiveDays, currentMonth, lastAttendanceDate || null, timestamp, timestamp]
            );
          } else {
            // 출석 기록 업데이트 (출석 로그 기반으로 재계산된 값 사용)
            await db.run(
              `UPDATE site_attendance
               SET attendance_days = ?, current_month = ?, last_recorded_at = ?, updated_at = ?
               WHERE account_id = ? AND identity_id = ? AND site_account_id = ?
               AND period_type = 'total' AND period_value = 'all'`,
              [consecutiveDays, currentMonth, lastAttendanceDate || attendance.last_recorded_at, timestamp, accountId, identity.identity_id, siteAccount.id]
            );
          }
        }
      }
    } catch (recalcError) {
      console.error('출석일 재계산 실패:', recalcError);
      // 재계산 실패해도 응답은 정상 반환
    }
    
    // 최신 통계 조회
    const stats = await getAttendanceStats({
      accountId,
      siteName,
      identityName
    });
    
    res.json({
      success: true,
      action,
      ...stats
    });
    
  } catch (error) {
    console.error('출석 토글 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '출석 토글 실패',
      error: error.message 
    });
  }
});

// 배치 출석 통계 조회 API (여러 사이트 한 번에 조회)
router.post('/stats/batch', auth, async (req, res) => {
  try {
    const { sites } = req.body; // sites: [{siteName, identityName}, ...]
    
    if (!Array.isArray(sites) || sites.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: '조회할 사이트 목록이 필요합니다' 
      });
    }
    
    // 최대 100개까지만 허용 (성능 보호)
    if (sites.length > 100) {
      return res.status(400).json({ 
        success: false, 
        message: '한 번에 최대 100개 사이트까지 조회 가능합니다' 
      });
    }
    
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    // 병렬로 모든 사이트 통계 조회
    const results = await Promise.all(
      sites.map(async ({ siteName, identityName }) => {
        try {
          // 빈 값 체크
          if (!siteName || !identityName || siteName.trim() === '' || identityName.trim() === '') {
            return {
              siteName,
              identityName,
              error: '사이트명과 명의명이 필요합니다'
            };
          }
          
          const stats = await getAttendanceStats({
            accountId,
            siteName,
            identityName
          });
          
          return {
            siteName,
            identityName,
            ...stats
          };
        } catch (error) {
          console.error(`배치 조회 실패: ${siteName}/${identityName}`, error);
          return {
            siteName,
            identityName,
            error: error.message,
            consecutiveDays: 0,
            totalDays: 0
          };
        }
      })
    );
    
    res.json({
      success: true,
      results
    });
    
  } catch (error) {
    console.error('배치 출석 통계 조회 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '배치 출석 통계 조회 실패',
      error: error.message 
    });
  }
});

// 과거 날짜 출석 추가 API (관리자 전용)
router.post('/add-past', auth, async (req, res) => {
  try {
    const { siteName, identityName, attendanceDate, reason } = req.body;
    
    // 필수 파라미터 검증
    if (!siteName || !identityName || !attendanceDate) {
      return res.status(400).json({ 
        success: false, 
        message: '사이트명, 명의명, 출석일이 필요합니다' 
      });
    }
    
    // 사유 필수
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: '출석 추가 사유를 입력해주세요' 
      });
    }
    
    // 권한 체크: 관리자 또는 사무실 관리자만 가능
    if (req.user.accountType !== 'super_admin' && !req.user.isOfficeManager) {
      return res.status(403).json({ 
        success: false, 
        message: '관리자만 과거 날짜 출석을 추가할 수 있습니다' 
      });
    }
    
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    // 이미 출석 기록이 있는지 확인
    const exists = await checkAttendanceExists({
      accountId,
      siteName,
      identityName,
      attendanceDate
    });
    
    if (exists) {
      return res.status(400).json({ 
        success: false, 
        message: '해당 날짜에 이미 출석 기록이 있습니다' 
      });
    }
    
    // 출석 로그 추가
    await addAttendanceLog({
      accountId,
      siteName,
      identityName,
      attendanceDate
    });
    
    // 변경 로그 기록 (access_logs에 저장)
    const db = require('../database/db');
    await db.run(
      `INSERT INTO access_logs (account_id, action, details, ip_address, user_agent, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.accountId,
        'PAST_ATTENDANCE_ADD',
        `과거 출석 추가: ${siteName} / ${identityName} / ${attendanceDate} / 사유: ${reason}`,
        req.ip || '',
        req.get('User-Agent') || '',
        new Date().toISOString()
      ]
    );
    
    // 최신 통계 조회
    const stats = await getAttendanceStats({
      accountId,
      siteName,
      identityName
    });
    
    res.json({
      success: true,
      message: '과거 날짜 출석이 추가되었습니다',
      ...stats
    });
    
  } catch (error) {
    console.error('과거 날짜 출석 추가 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '과거 날짜 출석 추가 실패',
      error: error.message 
    });
  }
});

// 기간별 출석 일괄 추가 API (관리자 전용)
router.post('/bulk-add', auth, async (req, res) => {
  try {
    const { siteName, identityName, startDate, endDate, reason } = req.body;
    
    // 필수 파라미터 검증
    if (!siteName || !identityName || !startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        message: '사이트명, 명의명, 시작일, 종료일이 필요합니다' 
      });
    }
    
    // 사유 필수
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: '출석 추가 사유를 입력해주세요' 
      });
    }
    
    // 권한 체크: 관리자 또는 사무실 관리자만 가능
    if (req.user.accountType !== 'super_admin' && !req.user.isOfficeManager) {
      return res.status(403).json({ 
        success: false, 
        message: '관리자만 기간별 출석을 추가할 수 있습니다' 
      });
    }
    
    // 날짜 형식 검증 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ 
        success: false, 
        message: '날짜 형식은 YYYY-MM-DD 형식이어야 합니다 (예: 2025-12-01)' 
      });
    }
    
    // 시작일이 종료일보다 늦으면 오류
    if (startDate > endDate) {
      return res.status(400).json({ 
        success: false, 
        message: '시작일은 종료일보다 이전이어야 합니다' 
      });
    }
    
    // 최대 기간 제한 (365일)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 365) {
      return res.status(400).json({ 
        success: false, 
        message: '최대 365일까지만 일괄 추가할 수 있습니다' 
      });
    }
    
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    // 날짜 범위 내의 모든 날짜 생성
    const dates = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    let addedCount = 0;
    let skippedCount = 0;
    const addedDates = [];
    const skippedDates = [];
    
    // 각 날짜에 대해 출석 로그 추가
    for (const date of dates) {
      try {
        // 이미 출석 기록이 있는지 확인
        const exists = await checkAttendanceExists({
          accountId,
          siteName,
          identityName,
          attendanceDate: date
        });
        
        if (exists) {
          skippedCount++;
          skippedDates.push(date);
          continue;
        }
        
        // 출석 로그 추가
        await addAttendanceLog({
          accountId,
          siteName,
          identityName,
          attendanceDate: date
        });
        
        addedCount++;
        addedDates.push(date);
      } catch (error) {
        console.error(`출석 로그 추가 실패 (${date}):`, error);
        skippedCount++;
        skippedDates.push(date);
      }
    }
    
    // 변경 로그 기록 (access_logs에 저장)
    const db = require('../database/db');
    await db.run(
      `INSERT INTO access_logs (account_id, action, details, ip_address, user_agent, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.accountId,
        'BULK_ATTENDANCE_ADD',
        `기간별 출석 일괄 추가: ${siteName} / ${identityName} / ${startDate}~${endDate} (${addedCount}일 추가, ${skippedCount}일 스킵) / 사유: ${reason}`,
        req.ip || '',
        req.get('User-Agent') || '',
        new Date().toISOString()
      ]
    );
    
    // 최신 통계 조회
    const stats = await getAttendanceStats({
      accountId,
      siteName,
      identityName
    });
    
    res.json({
      success: true,
      message: `${addedCount}일의 출석이 추가되었습니다 (${skippedCount}일 스킵)`,
      addedCount,
      skippedCount,
      totalDays: dates.length,
      addedDates: addedDates.slice(0, 10), // 최대 10개만 반환
      skippedDates: skippedDates.slice(0, 10), // 최대 10개만 반환
      ...stats
    });
    
  } catch (error) {
    console.error('기간별 출석 일괄 추가 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '기간별 출석 일괄 추가 실패',
      error: error.message 
    });
  }
});

module.exports = router;
