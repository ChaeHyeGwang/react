const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const {
  upsertSiteAttendance,
  getSiteAttendance
} = require('../utils/siteAttendance');
const {
  getSiteNoteData,
  getAccountOfficeId
} = require('../services/siteNotesService');
const { getKSTDateTimeString } = require('../utils/time');
const { invalidateSummaryForDate } = require('../services/drbetSummary');

// 사이트 메타데이터 조회 (공유 데이터 + 계정별+명의별 출석일 조합)
router.get('/', auth, async (req, res) => {
  try {
    const { site_name, identity_name } = req.query;
    if (!site_name) {
      return res.status(400).json({ success: false, message: 'site_name이 필요합니다' });
    }

    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const accountId = req.user.filterAccountId || req.user.accountId;
    if (!accountId) {
      return res.status(403).json({ success: false, message: '계정을 선택해주세요.' });
    }

    const officeId =
      req.user.filterAccountId && req.user.filterAccountId !== req.user.accountId
        ? (await db.get('SELECT office_id FROM accounts WHERE id = ?', [req.user.filterAccountId]))?.office_id ?? null
        : await getAccountOfficeId(accountId);

    const siteNote = await getSiteNoteData({
      siteName: site_name,
      identityName: identity_name,
      accountId,
      officeId
    });

    res.json({
      success: true,
      data: siteNote
    });
  } catch (error) {
    console.error('site_notes 조회 실패:', error);
    res.status(500).json({ success: false, message: '조회 실패' });
  }
});

// 사이트 메타데이터 bulk 조회
router.post('/bulk', auth, async (req, res) => {
  try {
    const { requests } = req.body;
    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({ success: false, message: 'requests 배열이 필요합니다.' });
    }

    const accountId = req.user.filterAccountId || req.user.accountId;
    if (!accountId) {
      return res.status(403).json({ success: false, message: '계정을 선택해주세요.' });
    }

    const officeId = await getAccountOfficeId(accountId);

    const seen = new Set();
    const normalized = [];
    for (const request of requests) {
      const siteName = (request.site_name || request.siteName || '').trim();
      if (!siteName) continue;
      const identityName = request.identity_name || request.identityName || null;
      const key = `${siteName}||${identityName || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ site_name: siteName, identity_name: identityName });
    }

    if (normalized.length === 0) {
      return res.json({ success: true, results: [] });
    }

    const results = [];
    for (const item of normalized) {
      try {
        const data = await getSiteNoteData({
          siteName: item.site_name,
          identityName: item.identity_name,
          accountId,
          officeId
        });
        results.push({
          site_name: item.site_name,
          identity_name: item.identity_name,
          data
        });
      } catch (error) {
        console.error('site-notes bulk 조회 실패:', item, error);
        results.push({
          site_name: item.site_name,
          identity_name: item.identity_name,
          error: error.message || '조회 실패'
        });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('site-notes bulk 요청 처리 실패:', error);
    res.status(500).json({ success: false, message: 'bulk 조회 실패' });
  }
});

// 사이트 메타데이터 등록/수정 (공유 데이터 + 계정별+명의별 출석일 분리 저장)
router.post('/', auth, async (req, res) => {
  try {
    // ✅ 공백 제거
    const site_name = (req.body.site_name || '').trim();
    const identity_name = req.body.identity_name ? req.body.identity_name.trim() : null;
    const data = req.body.data;
    const updateRecordedBy = req.body.updateRecordedBy === true; // 이벤트/메모 변경 시에만 true
    
    if (!site_name) {
      return res.status(400).json({ success: false, message: 'site_name이 필요합니다' });
    }

    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    // 현재 로그인한 사용자 정보 가져오기
    const account = await db.get(
      'SELECT username, display_name FROM accounts WHERE id = ?',
      [filterAccountId]
    );
    
    if (!account) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다' });
    }

    const recorded_by = account.display_name || account.username;
    const accountId = filterAccountId;

    // 대상 사무실 식별: 현재 계정의 사무실 ID 사용
    // filterAccountId가 있으면 해당 계정의 사무실, 없으면 현재 로그인한 계정의 사무실
    let officeId = req.user.officeId || null;
    if (req.user.filterAccountId) {
      const targetAccount = await db.get('SELECT office_id FROM accounts WHERE id = ?', [req.user.filterAccountId]);
      officeId = targetAccount?.office_id || null;
    }
    
    console.log('[site-notes POST] 저장 파라미터:', {
      site_name,
      identity_name,
      accountId,
      filterAccountId: req.user.filterAccountId,
      userAccountId: req.user.accountId,
      officeId: req.user.officeId,
      filterOfficeId: req.user.filterOfficeId,
      determinedOfficeId: officeId,
      chargeMin: data.chargeMin,
      chargeMax: data.chargeMax
    });

    if (officeId === null || officeId === undefined) {
      return res.status(403).json({ success: false, message: '사무실 정보가 없습니다. 먼저 계정을 사무실에 배정하세요.' });
    }

    // 사무실별 공유 필드만 저장
    const sharedFields = {
      tenure: data.tenure,
      attendanceType: data.attendanceType,
      chargeMin: data.chargeMin !== undefined && data.chargeMin !== null ? Number(data.chargeMin) : undefined,
      chargeMax: data.chargeMax !== undefined && data.chargeMax !== null ? Number(data.chargeMax) : undefined,
      rollover: data.rollover,
      settlement: data.settlement,
      settlementTotal: data.settlementTotal,
      settlementPoint: data.settlementPoint,
      settlementDays: data.settlementDays,
      settlementRules: data.settlementRules,
      payback: data.payback,
      rate: data.rate,
      events: data.events,
      lastUpdated: data.lastUpdated || new Date().toISOString().slice(0, 7)
    };

    console.log('[site-notes POST] sharedFields:', JSON.stringify(sharedFields, null, 2));
    const sharedJson = JSON.stringify(sharedFields);

    // 1. site_notes에 공유 데이터 저장 (사무실별 사이트당 1개 row)
    const existingOfficeRow = await db.get(
      `SELECT id, recorded_by_identity FROM site_notes WHERE site_name = ? AND office_id = ?`,
      [site_name, officeId]
    );
    
    // 기존 recorded_by_identity 저장 (updateRecordedBy가 false일 때 응답에 사용)
    let finalRecordedBy = recorded_by;
    if (existingOfficeRow && !updateRecordedBy) {
      finalRecordedBy = existingOfficeRow.recorded_by_identity || recorded_by;
    }

    if (existingOfficeRow) {
      const timestamp = getKSTDateTimeString();
      // updateRecordedBy가 true일 때만 recorded_by_identity 업데이트
      if (updateRecordedBy) {
        await db.run(
          `UPDATE site_notes 
              SET recorded_by_identity = ?, data = ?, updated_at = ?
            WHERE id = ?`,
          [recorded_by, sharedJson, timestamp, existingOfficeRow.id]
        );
      } else {
        // recorded_by_identity는 유지하고 data만 업데이트
        await db.run(
          `UPDATE site_notes 
              SET data = ?, updated_at = ?
            WHERE id = ?`,
          [sharedJson, timestamp, existingOfficeRow.id]
        );
      }
      console.log('[site-notes POST] 공유 데이터 업데이트 완료:', { id: existingOfficeRow.id, officeId, site_name, updateRecordedBy });
    } else {
      // INSERT OR REPLACE를 사용하여 동시성 문제 방지
      // UNIQUE 제약조건 위반 시 자동으로 UPDATE됨
      try {
        const insertTimestamp = getKSTDateTimeString();
        const insertResult = await db.run(
          `INSERT INTO site_notes (site_name, office_id, recorded_by_identity, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [site_name, officeId, recorded_by, sharedJson, insertTimestamp, insertTimestamp]
        );
        console.log('[site-notes POST] 공유 데이터 생성 완료:', { id: insertResult.id, officeId, site_name });
      } catch (error) {
        // UNIQUE 제약조건 위반 시 (동시성 문제로 인한 중복 삽입 시도)
        if (error.message && error.message.includes('UNIQUE constraint')) {
          console.log('[site-notes POST] UNIQUE 제약조건 위반 감지, 기존 데이터 업데이트 시도');
          // 기존 데이터를 다시 찾아서 업데이트
          const retryRow = await db.get(
            `SELECT id FROM site_notes WHERE site_name = ? AND office_id = ?`,
            [site_name, officeId]
          );
          if (retryRow) {
            const retryTimestamp = getKSTDateTimeString();
            // updateRecordedBy가 true일 때만 recorded_by_identity 업데이트
            if (updateRecordedBy) {
              await db.run(
                `UPDATE site_notes 
                    SET recorded_by_identity = ?, data = ?, updated_at = ?
                  WHERE id = ?`,
                [recorded_by, sharedJson, retryTimestamp, retryRow.id]
              );
            } else {
              await db.run(
                `UPDATE site_notes 
                    SET data = ?, updated_at = ?
                  WHERE id = ?`,
                [sharedJson, retryTimestamp, retryRow.id]
              );
            }
            console.log('[site-notes POST] 공유 데이터 재시도 업데이트 완료:', { id: retryRow.id, officeId, site_name, updateRecordedBy });
          } else {
            throw error; // 재시도해도 찾지 못하면 에러 throw
          }
        } else {
          throw error; // 다른 에러는 그대로 throw
        }
      }
    }

    // 2. 출석일은 site_attendance 테이블에 저장
    if (identity_name) {
      let context = await db.get(
        `SELECT 
           i.id AS identity_id,
           sa.id AS site_account_id
         FROM identities i
         INNER JOIN accounts a ON i.account_id = a.id
         LEFT JOIN site_accounts sa ON sa.identity_id = i.id AND sa.site_name = ?
         WHERE a.id = ? AND i.name = ?
         ORDER BY sa.id ASC
         LIMIT 1`,
        [site_name, accountId, identity_name]
      );

      // site_account_id가 없으면 자동으로 사이트 생성
      if (context?.identity_id && !context?.site_account_id) {
        const result = await db.run(
          `INSERT INTO site_accounts (identity_id, site_name, status, display_order, domain, category, account_id, password, nickname, referral_code, referral_path, exchange_password, approval_call, notes, status_history)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [context.identity_id, site_name, 'auto', 0, '', '', '', '', '', '', '', '', 0, '자동 생성', '[]']
        );
        context.site_account_id = result.lastID;
      }

      if (context?.identity_id && context?.site_account_id) {
        // attendanceLastRecordedAt이 있으면 해당 날짜 사용, 없으면 null
        const lastRecordedAt = data.attendanceLastRecordedAt || null;
        
        await upsertSiteAttendance({
          accountId,
          identityId: context.identity_id,
          siteAccountId: context.site_account_id,
          attendanceDays: data.attendanceDays || 0,
          lastRecordedAt: lastRecordedAt
        });
      }
    }

    // 3. 페이백 지급 여부는 payback_cleared 테이블에 저장
    if (identity_name && data.paybackCleared && typeof data.paybackCleared === 'object') {
      const paybackCleared = data.paybackCleared || {};
      
      // 기존 페이백 지급 여부 삭제 (해당 사이트, 계정, 명의의 모든 주간 시작일)
      await db.run(
        `DELETE FROM payback_cleared 
         WHERE site_name = ? AND office_id = ? AND account_id = ? AND identity_name = ?`,
        [site_name, officeId, accountId, identity_name]
      );

      // 새로운 페이백 지급 여부 저장
      for (const weekStartDate of Object.keys(paybackCleared)) {
        if (paybackCleared[weekStartDate] === true) {
          const timestamp = getKSTDateTimeString();
          await db.run(
            `INSERT OR REPLACE INTO payback_cleared 
             (site_name, office_id, account_id, identity_name, week_start_date, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [site_name, officeId, accountId, identity_name, weekStartDate, timestamp]
          );
        }
      }
      console.log('[site-notes POST] 페이백 지급 여부 저장 완료:', { 
        site_name, 
        officeId, 
        accountId, 
        identity_name,
        weekCount: Object.keys(paybackCleared).filter(k => paybackCleared[k] === true).length
      });
      
      // ✅ 페이백 지급 여부 변경 시 캐시 무효화 (모든 날짜의 캐시 삭제)
      try {
        await invalidateSummaryForDate(accountId, null); // null = 모든 날짜
        console.log('[site-notes POST] 페이백 지급 여부 변경 - 캐시 무효화 완료');
      } catch (cacheError) {
        console.error('[site-notes POST] 페이백 지급 여부 변경 - 캐시 무효화 실패:', cacheError);
      }
    }

    res.json({ 
      success: true,
      recorded_by: finalRecordedBy
    });
  } catch (error) {
    console.error('site_notes 저장 실패:', error);
    res.status(500).json({ success: false, message: '저장 실패' });
  }
});

// 정착 지급 완료 처리 API (모든 사용자 - 자신의 계정만)
router.post('/settlement-paid', auth, async (req, res) => {
  try {
    // ✅ 공백 제거
    const site_name = (req.body.site_name || '').trim();
    const identity_name = (req.body.identity_name || '').trim();
    const is_paid = req.body.is_paid;
    
    if (!site_name || !identity_name) {
      return res.status(400).json({ 
        success: false, 
        message: '사이트명과 명의명이 필요합니다' 
      });
    }
    
    // 자신의 계정 또는 관리자가 선택한 계정에 대해서만 처리
    const accountId = req.user.filterAccountId || req.user.accountId;
    if (!accountId) {
      return res.status(403).json({ success: false, message: '계정을 선택해주세요.' });
    }
    
    const officeId =
      req.user.filterAccountId && req.user.filterAccountId !== req.user.accountId
        ? (await db.get('SELECT office_id FROM accounts WHERE id = ?', [req.user.filterAccountId]))?.office_id ?? null
        : await getAccountOfficeId(accountId);
    
    const timestamp = getKSTDateTimeString();
    
    // settlement_paid 테이블 생성 (없으면)
    await db.run(`
      CREATE TABLE IF NOT EXISTS settlement_paid (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT NOT NULL,
        office_id INTEGER NULL,
        account_id INTEGER NOT NULL,
        identity_name TEXT NOT NULL,
        paid_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(site_name, office_id, account_id, identity_name)
      )
    `);
    
    if (is_paid === false) {
      // 지급 취소 (체크박스 해제)
      // ✅ office_id와 무관하게 site_name, account_id, identity_name만으로 삭제
      // ✅ 정규화된 값 사용 (공백 제거)
      const normalizedSiteName = site_name.trim();
      const normalizedIdentityName = identity_name.trim();
      
      console.log('[정착 지급 취소] 삭제 시도:', { 
        site_name: normalizedSiteName, 
        identity_name: normalizedIdentityName, 
        accountId, 
        officeId 
      });
      
      const deleteResult = await db.run(
        `DELETE FROM settlement_paid 
         WHERE TRIM(site_name) = ? AND account_id = ? AND TRIM(identity_name) = ?`,
        [normalizedSiteName, accountId, normalizedIdentityName]
      );
      
      console.log('[정착 지급 취소] 삭제 완료:', { 
        site_name: normalizedSiteName, 
        identity_name: normalizedIdentityName, 
        accountId, 
        officeId,
        deletedRows: deleteResult.changes 
      });
      
      // ✅ 캐시 무효화 (모든 날짜의 캐시 삭제)
      try {
        await invalidateSummaryForDate(accountId, null); // null = 모든 날짜
        console.log('[정착 지급 취소] 캐시 무효화 완료');
      } catch (cacheError) {
        console.error('[정착 지급 취소] 캐시 무효화 실패:', cacheError);
      }
      
      res.json({
        success: true,
        message: '정착 지급이 취소되었습니다. 배너에 다시 표시됩니다.'
      });
      return;
    }
    
    // 지급 완료 (체크박스 체크)
    // ✅ office_id와 무관하게 site_name, account_id, identity_name만으로 기존 레코드 삭제
    // (office_id가 NULL이든 값이든 상관없이 하나의 레코드만 유지)
    // ✅ 저장 시 정규화된 값 사용 (공백 제거)
    const normalizedSiteName = site_name.trim();
    const normalizedIdentityName = identity_name.trim();
    
    console.log('[정착 지급 완료] 저장 시도:', { 
      site_name: normalizedSiteName, 
      identity_name: normalizedIdentityName, 
      accountId, 
      officeId 
    });
    
    // 기존 레코드 확인 (정규화된 값으로 조회)
    const existingRows = await db.all(
      `SELECT id, office_id, paid_at, site_name, identity_name FROM settlement_paid 
       WHERE TRIM(site_name) = ? AND account_id = ? AND TRIM(identity_name) = ?`,
      [normalizedSiteName, accountId, normalizedIdentityName]
    );
    console.log('[정착 지급 완료] 기존 레코드:', existingRows);
    
    // 기존 레코드 삭제 (정규화된 값으로 삭제)
    const deleteResult = await db.run(
      `DELETE FROM settlement_paid 
       WHERE TRIM(site_name) = ? AND account_id = ? AND TRIM(identity_name) = ?`,
      [normalizedSiteName, accountId, normalizedIdentityName]
    );
    console.log('[정착 지급 완료] 기존 레코드 삭제:', { deletedRows: deleteResult.changes });
    
    // 새 레코드 저장 (정규화된 값으로 저장)
    const insertResult = await db.run(
      `INSERT INTO settlement_paid 
       (site_name, office_id, account_id, identity_name, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [normalizedSiteName, officeId, accountId, normalizedIdentityName, timestamp, timestamp]
    );
    
    console.log('[정착 지급 완료] 새 레코드 저장 완료:', { 
      site_name, 
      identity_name, 
      accountId, 
      officeId,
      paid_at: timestamp,
      insertedId: insertResult.lastID
    });
    
    // 변경 로그 기록
    await db.run(
      `INSERT INTO access_logs (account_id, action, details, ip_address, user_agent, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.accountId,
        'SETTLEMENT_PAID',
        `정착 지급 완료: ${site_name} / ${identity_name}`,
        req.ip || '',
        req.get('User-Agent') || '',
        timestamp
      ]
    );
    
    console.log('[정착 지급 완료] 처리 완료:', { site_name, identity_name, accountId, officeId });
    
    // ✅ 캐시 무효화 (모든 날짜의 캐시 삭제)
    try {
      await invalidateSummaryForDate(accountId, null); // null = 모든 날짜
      console.log('[정착 지급 완료] 캐시 무효화 완료');
    } catch (cacheError) {
      console.error('[정착 지급 완료] 캐시 무효화 실패:', cacheError);
    }
    
    res.json({
      success: true,
      message: '정착 지급이 완료되었습니다. 더 이상 배너에 표시되지 않습니다.',
      paid_at: timestamp
    });
    
  } catch (error) {
    console.error('정착 지급 완료 처리 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '정착 지급 완료 처리 실패',
      error: error.message 
    });
  }
});

// 페이백 지급 완료/취소 API
router.post('/payback-clear', auth, async (req, res) => {
  try {
    const { siteName, identityName, weekStartDate, cleared } = req.body;
    
    if (!siteName || !identityName || !weekStartDate) {
      return res.status(400).json({ success: false, message: '필수 파라미터가 누락되었습니다' });
    }
    
    const accountId = req.user.filterAccountId || req.user.accountId;
    const officeId = req.user.filterOfficeId || req.user.officeId || 1;
    
    console.log('[페이백 지급 상태 변경]', { siteName, identityName, weekStartDate, cleared, accountId, officeId });
    
    // payback_cleared 테이블 생성 (없으면)
    await db.run(`
      CREATE TABLE IF NOT EXISTS payback_cleared (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT NOT NULL,
        office_id INTEGER NULL,
        account_id INTEGER NOT NULL,
        identity_name TEXT NOT NULL,
        week_start_date TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(site_name, office_id, account_id, identity_name, week_start_date)
      )
    `);
    
    const normalizedSiteName = siteName.trim();
    const normalizedIdentityName = identityName.trim();
    const timestamp = getKSTDateTimeString();
    
    if (cleared) {
      // 지급 완료 처리
      await db.run(
        `INSERT OR REPLACE INTO payback_cleared 
         (site_name, office_id, account_id, identity_name, week_start_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [normalizedSiteName, officeId, accountId, normalizedIdentityName, weekStartDate, timestamp]
      );
      console.log('[페이백] 지급 완료 저장:', { siteName: normalizedSiteName, identityName: normalizedIdentityName, weekStartDate });
    } else {
      // 지급 취소 처리
      await db.run(
        `DELETE FROM payback_cleared 
         WHERE site_name = ? AND account_id = ? AND identity_name = ? AND week_start_date = ?`,
        [normalizedSiteName, accountId, normalizedIdentityName, weekStartDate]
      );
      console.log('[페이백] 지급 취소:', { siteName: normalizedSiteName, identityName: normalizedIdentityName, weekStartDate });
    }
    
    // 캐시 무효화
    try {
      await invalidateSummaryForDate(accountId, null);
      console.log('[페이백] 캐시 무효화 완료');
    } catch (cacheError) {
      console.error('[페이백] 캐시 무효화 실패:', cacheError);
    }
    
    res.json({ success: true, cleared });
    
  } catch (error) {
    console.error('페이백 지급 상태 변경 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '페이백 지급 상태 변경 실패',
      error: error.message 
    });
  }
});

module.exports = router;


