const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const {
  upsertSiteAttendance,
  deleteSiteAttendanceBySiteAccount
} = require('../utils/siteAttendance');

// 디버그 모드 (프로덕션에서는 false)
const DEBUG = process.env.NODE_ENV !== 'production';
const log = (...args) => DEBUG && console.log(...args);

const parseSiteRow = (row) => {
  if (!row) return row;

  let statusHistory = [];
  try {
    statusHistory = JSON.parse(row.status_history || '[]');
  } catch (err) {
    statusHistory = [];
  }

  const attendanceValue = Number(row.attendance_days);

  return {
    ...row,
    status_history: statusHistory,
    approval_call: Boolean(row.approval_call),
    attendance_days: Number.isFinite(attendanceValue) ? attendanceValue : 0,
    attendance_last_recorded_at: row.attendance_last_recorded_at || null
  };
};

// 현재 로그인한 사용자의 사이트만 조회
router.get('/', auth, async (req, res) => {
  try {
    // 사무실 관리자인 경우
    if (req.user.isOfficeManager && req.user.filterOfficeId) {
      const { identity_id, all } = req.query;
      
      // all=true면 사무실 전체 사이트 조회 (filterAccountId 무시)
      if (all === 'true') {
        let query = `
          SELECT 
            s.id,
            s.identity_id,
            s.site_name,
            s.domain,
            s.category,
            s.account_id,
            s.password,
            s.nickname,
            s.referral_code,
            s.referral_path,
            s.exchange_password,
            s.status,
            s.status_history,
            s.approval_call,
            s.notes,
            s.display_order,
            i.name AS identity_name,
            a.username,
            COALESCE(att.attendance_days, 0) AS attendance_days,
            att.last_recorded_at AS attendance_last_recorded_at
          FROM site_accounts s
          INNER JOIN identities i ON s.identity_id = i.id
          INNER JOIN accounts a ON i.account_id = a.id
          LEFT JOIN site_attendance att
            ON att.site_account_id = s.id
           AND att.identity_id = s.identity_id
           AND att.account_id = a.id
           AND att.period_type = 'total'
           AND att.period_value = 'all'
          WHERE a.office_id = ? AND s.status != 'auto'
        `;
        let params = [req.user.filterOfficeId];
        
        query += ' ORDER BY COALESCE(s.display_order, 0) ASC, s.id DESC';
        
        const sites = await db.all(query, params);
        const parsedSites = sites.map(parseSiteRow);
        
        return res.json({ success: true, sites: parsedSites });
      }
      
      // 특정 계정 선택 시: 해당 계정의 사이트만 조회
      if (req.user.filterAccountId) {
        const filterAccountId = req.user.filterAccountId;
        
        // account_id로 직접 조회
        let query = `
          SELECT 
            s.id,
            s.identity_id,
            s.site_name,
            s.domain,
            s.category,
            s.account_id,
            s.password,
            s.nickname,
            s.referral_code,
            s.referral_path,
            s.exchange_password,
            s.status,
            s.status_history,
            s.approval_call,
            s.notes,
            s.display_order,
            i.name AS identity_name,
            a.username,
            COALESCE(att.attendance_days, 0) AS attendance_days,
            att.last_recorded_at AS attendance_last_recorded_at
          FROM site_accounts s
          INNER JOIN identities i ON s.identity_id = i.id
          INNER JOIN accounts a ON i.account_id = a.id
          LEFT JOIN site_attendance att
            ON att.site_account_id = s.id
           AND att.identity_id = s.identity_id
           AND att.account_id = a.id
           AND att.period_type = 'total'
           AND att.period_value = 'all'
          WHERE i.account_id = ? AND s.status != 'auto'
        `;
        let params = [filterAccountId];
        
        if (identity_id) {
          query += ' AND s.identity_id = ?';
          params.push(identity_id);
        }
        
        query += ' ORDER BY COALESCE(s.display_order, 0) ASC, s.id DESC';
        
        const sites = await db.all(query, params);
        const parsedSites = sites.map(parseSiteRow);
        
        return res.json({ success: true, sites: parsedSites });
      }
      
      // 계정 미선택 시: 사무실 전체 사이트 조회
      let query = `
        SELECT 
          s.id,
          s.identity_id,
          s.site_name,
          s.domain,
          s.category,
          s.account_id,
          s.password,
          s.nickname,
          s.referral_code,
          s.referral_path,
          s.exchange_password,
          s.status,
          s.status_history,
          s.approval_call,
          s.notes,
          s.display_order,
          i.name AS identity_name,
          u.username,
          COALESCE(att.attendance_days, 0) AS attendance_days,
          att.last_recorded_at AS attendance_last_recorded_at
        FROM site_accounts s
        INNER JOIN identities i ON s.identity_id = i.id
        INNER JOIN accounts a ON i.account_id = a.id
        LEFT JOIN site_attendance att
          ON att.site_account_id = s.id
         AND att.identity_id = s.identity_id
         AND att.account_id = a.id
         AND att.period_type = 'total'
         AND att.period_value = 'all'
        WHERE a.office_id = ? AND s.status != 'auto'
      `;
      let params = [req.user.filterOfficeId];
      
      if (identity_id) {
        query += ' AND s.identity_id = ?';
        params.push(identity_id);
      }
      
      query += ' ORDER BY COALESCE(s.display_order, 0) ASC, s.id DESC';
      
      const sites = await db.all(query, params);
      const parsedSites = sites.map(parseSiteRow);
      
      return res.json({ success: true, sites: parsedSites });
    }
    
    // 일반 사용자: 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    const { identity_id } = req.query;
    
    // account_id로 직접 조회
    let query = `
      SELECT 
        s.id,
        s.identity_id,
        s.site_name,
        s.domain,
        s.category,
        s.account_id,
        s.password,
        s.nickname,
        s.referral_code,
        s.referral_path,
        s.exchange_password,
        s.status,
        s.status_history,
        s.approval_call,
        s.notes,
        s.display_order,
        i.name AS identity_name,
        a.username,
        COALESCE(att.attendance_days, 0) AS attendance_days,
        att.last_recorded_at AS attendance_last_recorded_at
      FROM site_accounts s
      INNER JOIN identities i ON s.identity_id = i.id
      INNER JOIN accounts a ON i.account_id = a.id
      LEFT JOIN site_attendance att
        ON att.site_account_id = s.id
       AND att.identity_id = s.identity_id
       AND att.account_id = a.id
       AND att.period_type = 'total'
       AND att.period_value = 'all'
      WHERE i.account_id = ? AND s.status != 'auto'
    `;
    let params = [filterAccountId];
    
    if (identity_id) {
      query += ' AND s.identity_id = ?';
      params.push(identity_id);
    }
    
    query += ' ORDER BY COALESCE(s.display_order, 0) ASC, s.id DESC';
    
    const sites = await db.all(query, params);
    
    // JSON 문자열을 객체로 파싱
    const parsedSites = sites.map(parseSiteRow);
    
    res.json({ success: true, sites: parsedSites });
  } catch (error) {
    console.error('사이트 조회 실패:', error);
    res.status(500).json({ success: false, message: '사이트 조회 실패' });
  }
});

// ============ 사이트명 자동완성/유사도 관련 API ============
// 주의: 이 라우트들은 반드시 /:id 라우트보다 먼저 정의되어야 함

// 레벤슈타인 거리 계산 (유사도 측정용)
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // 삭제
        matrix[i][j - 1] + 1,      // 삽입
        matrix[i - 1][j - 1] + cost // 치환
      );
    }
  }

  return matrix[len1][len2];
}

// 문자열 유사도 계산 (0~1, 1이 완전 동일)
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1;
  
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

// 모든 고유 사이트명 조회 (자동완성용)
router.get('/all-names', auth, async (req, res) => {
  try {
    log('[all-names] 요청 수신, user:', req.user ? { 
      isSuperAdmin: req.user.isSuperAdmin,
      isOfficeManager: req.user.isOfficeManager,
      filterOfficeId: req.user.filterOfficeId,
      filterAccountId: req.user.filterAccountId,
      accountId: req.user.accountId
    } : 'undefined');
    
    let query;
    const params = [];
    
    if (req.user.isSuperAdmin) {
      // 슈퍼관리자: 모든 사이트명
      query = `SELECT DISTINCT site_name FROM site_accounts WHERE site_name IS NOT NULL AND site_name != '' ORDER BY site_name`;
    } else if (req.user.isOfficeManager) {
      // 사무실 관리자: 해당 사무실 사이트명
      query = `
        SELECT DISTINCT sa.site_name 
        FROM site_accounts sa
        JOIN identities i ON sa.identity_id = i.id
        JOIN accounts a ON i.account_id = a.id
        WHERE a.office_id = ? AND sa.site_name IS NOT NULL AND sa.site_name != ''
        ORDER BY sa.site_name
      `;
      params.push(req.user.filterOfficeId);
    } else {
      // 일반 사용자: 해당 계정 사이트명
      const filterAccountId = req.user.filterAccountId || req.user.accountId;
      query = `
        SELECT DISTINCT sa.site_name 
        FROM site_accounts sa
        JOIN identities i ON sa.identity_id = i.id
        WHERE i.account_id = ? AND sa.site_name IS NOT NULL AND sa.site_name != ''
        ORDER BY sa.site_name
      `;
      params.push(filterAccountId);
    }
    
    const rows = await db.all(query, params);
    const names = rows.map(r => r.site_name);
    
    res.json({ success: true, names });
  } catch (error) {
    console.error('사이트명 목록 조회 실패:', error);
    res.status(500).json({ success: false, message: '사이트명 목록 조회 실패' });
  }
});

// 유사한 사이트명 확인 (저장 전 경고용)
router.post('/check-similar', auth, async (req, res) => {
  try {
    const { siteName, threshold = 0.7 } = req.body;
    
    if (!siteName || siteName.trim() === '') {
      return res.json({ success: true, similar: [] });
    }
    
    const inputName = siteName.trim();
    
    // 기존 사이트명 가져오기
    let query;
    const params = [];
    
    if (req.user.isSuperAdmin) {
      query = `SELECT DISTINCT site_name FROM site_accounts WHERE site_name IS NOT NULL AND site_name != ''`;
    } else if (req.user.isOfficeManager) {
      query = `
        SELECT DISTINCT sa.site_name 
        FROM site_accounts sa
        JOIN identities i ON sa.identity_id = i.id
        JOIN accounts a ON i.account_id = a.id
        WHERE a.office_id = ? AND sa.site_name IS NOT NULL AND sa.site_name != ''
      `;
      params.push(req.user.filterOfficeId);
    } else {
      const filterAccountId = req.user.filterAccountId || req.user.accountId;
      query = `
        SELECT DISTINCT sa.site_name 
        FROM site_accounts sa
        JOIN identities i ON sa.identity_id = i.id
        WHERE i.account_id = ? AND sa.site_name IS NOT NULL AND sa.site_name != ''
      `;
      params.push(filterAccountId);
    }
    
    const rows = await db.all(query, params);
    
    // 유사도 검사
    const similar = [];
    for (const row of rows) {
      const existingName = row.site_name;
      if (existingName.toLowerCase() === inputName.toLowerCase()) {
        // 완전 동일 (대소문자 무시)
        similar.push({ name: existingName, similarity: 1, isExact: true });
      } else {
        const similarity = calculateSimilarity(inputName, existingName);
        if (similarity >= threshold) {
          similar.push({ name: existingName, similarity, isExact: false });
        }
      }
    }
    
    // 유사도 높은 순 정렬
    similar.sort((a, b) => b.similarity - a.similarity);
    
    res.json({ success: true, similar: similar.slice(0, 5) });
  } catch (error) {
    console.error('유사 사이트명 확인 실패:', error);
    res.status(500).json({ success: false, message: '유사 사이트명 확인 실패' });
  }
});

// 사이트명 통합 (관리자용)
router.post('/merge-names', auth, async (req, res) => {
  try {
    const { sourceName, targetName } = req.body;
    
    if (!sourceName || !targetName) {
      return res.status(400).json({ success: false, message: '원본과 대상 사이트명이 필요합니다' });
    }
    
    // 권한 확인 (사무실 관리자 이상)
    if (!req.user.isOfficeManager && !req.user.isSuperAdmin) {
      return res.status(403).json({ success: false, message: '권한이 없습니다' });
    }
    
    const trimmedSource = sourceName.trim();
    const trimmedTarget = targetName.trim();
    
    // 사이트명 업데이트
    let query;
    const params = [trimmedTarget, trimmedSource];
    
    if (req.user.isSuperAdmin) {
      query = `UPDATE site_accounts SET site_name = ? WHERE site_name = ?`;
    } else {
      // 사무실 관리자: 해당 사무실의 계정들의 명의만 통합
      query = `
        UPDATE site_accounts 
        SET site_name = ? 
        WHERE site_name = ? AND identity_id IN (
          SELECT i.id 
          FROM identities i
          INNER JOIN accounts a ON i.account_id = a.id
          WHERE a.office_id = ?
        )
      `;
      params.push(req.user.filterOfficeId);
    }
    
    const result = await db.run(query, params);
    
    // site_notes 테이블도 업데이트 (office_id 컬럼이 있는 경우에만)
    try {
      // site_notes 테이블의 컬럼 확인
      const columns = await db.all("PRAGMA table_info(site_notes)");
      const hasOfficeId = columns && columns.some(col => col.name === 'office_id');
      
      let notesQuery;
      const notesParams = [trimmedTarget, trimmedSource];
      
      if (hasOfficeId) {
        if (req.user.isSuperAdmin) {
          notesQuery = `UPDATE site_notes SET site_name = ? WHERE site_name = ?`;
        } else {
          notesQuery = `UPDATE site_notes SET site_name = ? WHERE site_name = ? AND office_id = ?`;
          notesParams.push(req.user.filterOfficeId);
        }
      } else {
        // office_id 컬럼이 없으면 office_id 조건 없이 업데이트
        notesQuery = `UPDATE site_notes SET site_name = ? WHERE site_name = ?`;
      }
      
      await db.run(notesQuery, notesParams);
    } catch (notesError) {
      // site_notes 업데이트 실패해도 계속 진행 (site_accounts 업데이트는 성공했으므로)
      console.warn('site_notes 업데이트 실패 (무시됨):', notesError);
    }
    
    res.json({ 
      success: true, 
      message: `"${trimmedSource}"를 "${trimmedTarget}"으로 통합했습니다`,
      updatedCount: result.changes
    });
  } catch (error) {
    console.error('사이트명 통합 실패:', error);
    res.status(500).json({ success: false, message: '사이트명 통합 실패' });
  }
});

// 중복/유사 사이트명 목록 조회 (관리자용)
router.get('/duplicates', auth, async (req, res) => {
  try {
    // 권한 확인 (사무실 관리자 이상)
    if (!req.user.isOfficeManager && !req.user.isSuperAdmin) {
      return res.status(403).json({ success: false, message: '권한이 없습니다' });
    }
    
    // 모든 고유 사이트명 조회
    let query;
    const params = [];
    
    if (req.user.isSuperAdmin) {
      query = `
        SELECT site_name, COUNT(*) as count 
        FROM site_accounts 
        WHERE site_name IS NOT NULL AND site_name != ''
        GROUP BY site_name
        ORDER BY site_name
      `;
    } else {
      query = `
        SELECT sa.site_name, COUNT(*) as count 
        FROM site_accounts sa
        JOIN identities i ON sa.identity_id = i.id
        JOIN accounts a ON i.account_id = a.id
        WHERE a.office_id = ? AND sa.site_name IS NOT NULL AND sa.site_name != ''
        GROUP BY sa.site_name
        ORDER BY sa.site_name
      `;
      params.push(req.user.filterOfficeId);
    }
    
    const rows = await db.all(query, params);
    const allNames = rows.map(r => ({ name: r.site_name, count: r.count }));
    
    // 유사한 그룹 찾기
    const groups = [];
    const processed = new Set();
    
    for (let i = 0; i < allNames.length; i++) {
      if (processed.has(allNames[i].name)) continue;
      
      const group = [allNames[i]];
      processed.add(allNames[i].name);
      
      for (let j = i + 1; j < allNames.length; j++) {
        if (processed.has(allNames[j].name)) continue;
        
        const similarity = calculateSimilarity(allNames[i].name, allNames[j].name);
        if (similarity >= 0.6) {
          group.push({ ...allNames[j], similarity });
          processed.add(allNames[j].name);
        }
      }
      
      if (group.length > 1) {
        groups.push(group);
      }
    }
    
    res.json({ success: true, groups });
  } catch (error) {
    console.error('중복 사이트명 조회 실패:', error);
    res.status(500).json({ success: false, message: '중복 사이트명 조회 실패' });
  }
});

// 특정 사이트 조회
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const site = await db.get('SELECT * FROM site_accounts WHERE id = ?', [id]);
    
    if (!site) {
      return res.status(404).json({ success: false, message: '사이트를 찾을 수 없습니다' });
    }
    
    const parsedSite = {
      ...site,
      status_history: JSON.parse(site.status_history || '[]'),
      approval_call: Boolean(site.approval_call)
    };
    
    res.json({ success: true, site: parsedSite });
  } catch (error) {
    console.error('사이트 조회 실패:', error);
    res.status(500).json({ success: false, message: '사이트 조회 실패' });
  }
});

// 사이트 순서 변경
router.put('/reorder', auth, async (req, res) => {
  try {
    const { sites } = req.body;
    
    if (!Array.isArray(sites)) {
      return res.status(400).json({ success: false, message: '잘못된 요청입니다' });
    }
    
    // 트랜잭션으로 순서 업데이트
    for (const site of sites) {
      if (site.id && typeof site.display_order === 'number') {
        await db.run(
          'UPDATE site_accounts SET display_order = ? WHERE id = ?',
          [site.display_order, site.id]
        );
      }
    }
    
    res.json({ success: true, message: '순서가 변경되었습니다' });
  } catch (error) {
    console.error('사이트 순서 변경 실패:', error);
    res.status(500).json({ success: false, message: '순서 변경 실패' });
  }
});

// 사이트 추가
router.post('/', auth, async (req, res) => {
  try {
    const { 
      identity_id,
      site_name,
      domain = '',
      category = '',
      account_id = '',
      password = '',
      nickname = '',
      referral_code = '',
      referral_path = '',
      exchange_password = '',
      status = '대기',
      approval_call = false,
      notes = ''
    } = req.body;

    const attendanceDaysInput = req.body.attendance_days ?? req.body.attendanceDays;
    const parsedAttendanceDays = attendanceDaysInput === undefined ? 0 : Number(attendanceDaysInput);
    
    if (!identity_id || !site_name) {
      return res.status(400).json({ 
        success: false, 
        message: '필수 정보를 모두 입력해주세요 (명의, 사이트명)' 
      });
    }
    
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    // 해당 명의가 현재 사용자의 것인지 확인
    const identity = await db.get('SELECT account_id FROM identities WHERE id = ?', [identity_id]);
    if (!identity || identity.account_id !== filterAccountId) {
      return res.status(403).json({ 
        success: false, 
        message: '권한이 없습니다' 
      });
    }
    
    // 초기 상태 이력 생성
    const currentDate = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '.');
    const initialHistory = JSON.stringify([{ date: currentDate, status }]);
    
    const result = await db.run(
      `INSERT INTO site_accounts 
       (identity_id, site_name, domain, category, account_id, password, nickname, 
        referral_code, referral_path, exchange_password, status, status_history, 
        approval_call, notes, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [identity_id, site_name, domain, category, account_id, password, nickname, 
       referral_code, referral_path, exchange_password, status, initialHistory,
       approval_call ? 1 : 0, notes]
    );

    const newSiteId = result.id ?? result.lastID;

    if (Number.isFinite(parsedAttendanceDays)) {
      await upsertSiteAttendance({
        accountId: filterAccountId,
        identityId: identity_id,
        siteAccountId: newSiteId,
        attendanceDays: parsedAttendanceDays
      });
    }
    
    res.json({ success: true, siteId: newSiteId, message: '사이트가 추가되었습니다' });
  } catch (error) {
    console.error('사이트 추가 실패:', error);
    res.status(500).json({ success: false, message: '사이트 추가 실패' });
  }
});

// 사이트 수정
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 현재 상태 이력 가져오기 (identity_id도 함께)
    const currentSite = await db.get(
      'SELECT status_history, status, identity_id FROM site_accounts WHERE id = ?', 
      [id]
    );
    
    if (!currentSite) {
      return res.status(404).json({ success: false, message: '사이트를 찾을 수 없습니다' });
    }
    
    // 해당 사이트가 현재 사용자의 것인지 확인 (사무실 관리자는 같은 사무실 내 사이트 수정 가능)
    if (currentSite.identity_id) {
      const identity = await db.get('SELECT account_id FROM identities WHERE id = ?', [currentSite.identity_id]);
      if (!identity) {
        return res.status(403).json({ 
          success: false, 
          message: '권한이 없습니다' 
        });
      }
      
      // 사무실 관리자인 경우: 같은 사무실의 사이트인지 확인
      if (req.user.isOfficeManager && req.user.filterOfficeId) {
        const siteOwner = await db.get(
          `SELECT office_id FROM accounts WHERE id = ?`,
          [identity.account_id]
        );
        if (!siteOwner || siteOwner.office_id !== req.user.filterOfficeId) {
          return res.status(403).json({ 
            success: false, 
            message: '권한이 없습니다' 
          });
        }
      } else if (!req.user.isOfficeManager) {
        // 일반 사용자: 본인 것만 수정 가능
        // filterAccountId가 있으면 사용, 없으면 자신의 accountId 사용
        const filterAccountId = req.user.filterAccountId || req.user.accountId;
        
        if (identity.account_id !== filterAccountId) {
          return res.status(403).json({ 
            success: false, 
            message: '권한이 없습니다' 
          });
        }
      }
    }
    
    const { 
      site_name,
      domain,
      category,
      account_id,
      password,
      nickname,
      referral_code,
      referral_path,
      exchange_password,
      status: statusFromBody,
      approval_call,
      notes
    } = req.body;

    const attendanceDaysInput = req.body.attendance_days ?? req.body.attendanceDays;
    const shouldUpdateAttendance = attendanceDaysInput !== undefined;
    const parsedAttendanceDays = shouldUpdateAttendance ? Number(attendanceDaysInput) : null;
    
    let statusHistory = JSON.parse(currentSite.status_history || '[]');
    
    // 상태에서 날짜 제거하여 순수 상태 추출
    const extractPureStatus = (statusStr) => {
      if (!statusStr) return '';
      // 날짜 패턴 제거 (예: "11.08 승인" -> "승인")
      return statusStr.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
    };
    
    // 현재 날짜 계산 (KST)
    const now = new Date();
    const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
    const month = String(kstDate.getMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getDate()).padStart(2, '0');
    const currentDate = `${month}.${day}`;
    
    // 프론트엔드에서 보낸 상태에서 순수 상태 추출
    // 프론트엔드에서 "11.05 대기 / 11.08 승인" 형식으로 보낼 수 있으므로, 마지막 부분만 추출
    let statusToCompare = statusFromBody;
    if (statusFromBody && statusFromBody.includes('/')) {
      // 슬래시로 구분된 경우 마지막 부분만 사용
      const parts = statusFromBody.split('/').map(s => s.trim());
      statusToCompare = parts[parts.length - 1] || statusFromBody;
    }
    
    const pureNewStatus = extractPureStatus(statusToCompare);
    const pureCurrentStatus = extractPureStatus(currentSite.status);
    
    // 최종 상태 변수 (재할당 가능)
    let finalStatus = statusFromBody;
    
    // 상태가 변경되었으면 이력 업데이트 (순수 상태로 비교)
    // pureNewStatus가 비어있지 않고, 순수 상태가 다르면 변경으로 인식
    if (statusFromBody && pureNewStatus && pureNewStatus.trim() !== '' && pureNewStatus !== pureCurrentStatus) {
      // 새 상태가 '대기'나 '가입전'이 아닌 경우, 기존 '대기'와 '가입전' 상태 제거
      if (pureNewStatus !== '대기' && pureNewStatus !== '가입전') {
        statusHistory = statusHistory.filter(item => {
          const itemPureStatus = extractPureStatus(item.status);
          return itemPureStatus !== '대기' && itemPureStatus !== '가입전';
        });
      }
      
      // 상태 이력에 추가 (날짜 포함 형식으로 저장)
      const statusWithDate = `${currentDate} ${pureNewStatus}`;
      statusHistory.push({ date: currentDate, status: statusWithDate });
      
      // 프론트엔드에서 슬래시로 구분된 누적 상태를 보낸 경우
      if (statusFromBody.includes('/')) {
        // 최종 상태가 '가입전'이나 '대기'가 아닌 경우, '가입전'과 '대기' 제거
        if (pureNewStatus !== '가입전' && pureNewStatus !== '대기') {
          const statusParts = statusFromBody.split('/').map(s => s.trim());
          // 각 부분에서 순수 상태 추출하여 '가입전'과 '대기' 제거
          const filteredParts = statusParts.filter(part => {
            const partPureStatus = extractPureStatus(part);
            const shouldKeep = partPureStatus !== '가입전' && partPureStatus !== '대기';
            log('[상태 필터링]', {
              원본부분: part,
              순수상태: partPureStatus,
              유지여부: shouldKeep
            });
            return shouldKeep;
          });
          
          log('[상태 필터링]', {
            원본상태: statusFromBody,
            필터링전: statusParts,
            필터링후: filteredParts,
            최종상태: pureNewStatus
          });
          
          // 필터링된 상태가 있으면 사용, 없으면 새 상태값만 사용
          if (filteredParts.length > 0) {
            finalStatus = filteredParts.join(' / ');
          } else {
            finalStatus = statusWithDate;
          }
        } else {
          // 최종 상태가 '가입전'이나 '대기'면 그대로 사용
          finalStatus = statusFromBody;
        }
      } else {
        // 단일 상태값이면 날짜 포함 형식으로 업데이트
        finalStatus = statusWithDate;
      }
    } else if (statusFromBody) {
      // 상태가 변경되지 않았어도 날짜가 포함된 형식으로 업데이트
      // 프론트엔드에서 날짜를 포함한 상태를 보냈으면 그대로 사용
      if (statusFromBody.match(/^\d{1,2}\.\d{1,2}/)) {
        // 이미 날짜가 포함되어 있으면 그대로 사용
        finalStatus = statusFromBody;
      } else if (pureNewStatus && pureNewStatus.trim() !== '') {
        // 날짜가 없으면 추가
        finalStatus = `${currentDate} ${pureNewStatus}`;
      }
    }
    
    const statusHistoryJson = JSON.stringify(statusHistory);
    
    await db.run(
      `UPDATE site_accounts 
       SET site_name = ?, domain = ?, category = ?, account_id = ?, password = ?, 
           nickname = ?, referral_code = ?, referral_path = ?, exchange_password = ?,
           status = ?, status_history = ?, approval_call = ?, notes = ?
       WHERE id = ?`,
      [site_name, domain, category, account_id, password, nickname, referral_code, 
       referral_path, exchange_password, finalStatus, statusHistoryJson, 
       approval_call ? 1 : 0, notes, id]
    );

    if (shouldUpdateAttendance && Number.isFinite(parsedAttendanceDays)) {
      // 명의의 account_id 직접 사용
      const identity = await db.get('SELECT account_id FROM identities WHERE id = ?', [currentSite.identity_id]);
      if (identity && identity.account_id) {
        await upsertSiteAttendance({
          accountId: identity.account_id,
          identityId: currentSite.identity_id,
          siteAccountId: Number(id),
          attendanceDays: parsedAttendanceDays
        });
      }
    }
    
    res.json({ success: true, message: '사이트가 수정되었습니다' });
  } catch (error) {
    console.error('사이트 수정 실패:', error);
    res.status(500).json({ success: false, message: '사이트 수정 실패' });
  }
});

// 사이트 삭제
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 해당 사이트가 현재 사용자의 것인지 확인
    const site = await db.get(
      'SELECT identity_id FROM site_accounts WHERE id = ?',
      [id]
    );
    if (!site) {
      return res.status(404).json({ 
        success: false, 
        message: '사이트를 찾을 수 없습니다' 
      });
    }
    
    // 권한 확인 (사무실 관리자는 같은 사무실 내 사이트 삭제 가능)
    if (site.identity_id) {
      const identity = await db.get('SELECT account_id FROM identities WHERE id = ?', [site.identity_id]);
      if (!identity) {
        return res.status(403).json({ 
          success: false, 
          message: '권한이 없습니다' 
        });
      }
      
      // 사무실 관리자인 경우: 같은 사무실의 사이트인지 확인
      if (req.user.isOfficeManager && req.user.filterOfficeId) {
        const siteOwner = await db.get(
          `SELECT office_id FROM accounts WHERE id = ?`,
          [identity.account_id]
        );
        if (!siteOwner || siteOwner.office_id !== req.user.filterOfficeId) {
          return res.status(403).json({ 
            success: false, 
            message: '권한이 없습니다' 
          });
        }
      } else if (!req.user.isOfficeManager) {
        // 일반 사용자: 본인 것만 삭제 가능
        const filterAccountId = req.user.filterAccountId || req.user.accountId;
        
        if (identity.account_id !== filterAccountId) {
          return res.status(403).json({ 
            success: false, 
            message: '권한이 없습니다' 
          });
        }
      }
    }
    
    // 출석 데이터 삭제
    await deleteSiteAttendanceBySiteAccount(Number(id));

    // 사이트 삭제
    await db.run('DELETE FROM site_accounts WHERE id = ?', [id]);
    
    res.json({ success: true, message: '사이트가 삭제되었습니다' });
  } catch (error) {
    console.error('사이트 삭제 실패:', error);
    res.status(500).json({ success: false, message: '사이트 삭제 실패' });
  }
});

module.exports = router;
