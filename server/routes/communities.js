const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { auth } = require('../middleware/auth');
const { getKSTDateTimeString } = require('../utils/time');

// 커뮤니티 목록 조회 (현재 사용자 것만, 명의별 필터링 지원)
router.get('/', auth, async (req, res) => {
  try {
    // 사무실 관리자인 경우: 자신의 사무실에 속한 모든 계정의 커뮤니티 조회
    if (req.user.isOfficeManager && req.user.filterOfficeId) {
      const { identity_name } = req.query;
      
      let query = `
        SELECT c.* 
        FROM communities c
        INNER JOIN accounts a ON c.account_id = a.id
        WHERE a.office_id = ?
      `;
      let params = [req.user.filterOfficeId];
      
      if (identity_name) {
        query += ' AND c.identity_name = ?';
        params.push(identity_name);
      }
      
      query += ' ORDER BY COALESCE(c.display_order, 0) ASC, c.id DESC';
      
      const communities = await db.all(query, params);
      return res.json(communities);
    }
    
    // 일반 사용자: 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    // 명의 이름으로 필터링 (선택 사항)
    const { identity_name } = req.query;
    
    let query = 'SELECT * FROM communities WHERE account_id = ?';
    let params = [filterAccountId];
    
    if (identity_name) {
      query += ' AND identity_name = ?';
      params.push(identity_name);
    }
    
    query += ' ORDER BY COALESCE(display_order, 0) ASC, id DESC';
    
    const communities = await db.all(query, params);
    res.json(communities);
  } catch (error) {
    console.error('커뮤니티 조회 실패:', error);
    res.status(500).json({ error: '커뮤니티 조회에 실패했습니다' });
  }
});

// 커뮤니티 순서 변경
router.put('/reorder', auth, async (req, res) => {
  try {
    const { communities } = req.body;
    
    if (!Array.isArray(communities)) {
      return res.status(400).json({ success: false, message: '잘못된 요청입니다' });
    }
    
    // 트랜잭션으로 순서 업데이트
    for (const community of communities) {
      if (community.id && typeof community.display_order === 'number') {
        await db.run(
          'UPDATE communities SET display_order = ? WHERE id = ?',
          [community.display_order, community.id]
        );
      }
    }
    
    res.json({ success: true, message: '순서가 변경되었습니다' });
  } catch (error) {
    console.error('커뮤니티 순서 변경 실패:', error);
    res.status(500).json({ success: false, message: '순서 변경 실패' });
  }
});

// 커뮤니티 추가
router.post('/', auth, async (req, res) => {
  try {
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    // account_id 확인
    const account = await db.get(
      'SELECT id FROM accounts WHERE id = ?',
      [filterAccountId]
    );
    
    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: '계정을 찾을 수 없습니다' 
      });
    }
    
    const { 
      site_name, 
      domain, 
      referral_path, 
      approval_call, 
      identity_name, 
      account_id, 
      password, 
      exchange_password, 
      nickname, 
      status, 
      referral_code, 
      notes 
    } = req.body;

    // 실제 테이블 구조 확인 완료:
    // - account_id (INTEGER): 계정 ID
    // - account_id_site (TEXT): 사이트 계정 ID
    // - user_id 컬럼 없음
    
    // 사이트 계정 ID (TEXT) - req.body의 account_id 필드
    const siteAccountId = account_id || ''; // 사이트 계정 ID (TEXT)
    
    const result = await db.run(
      `INSERT INTO communities (
        account_id, site_name, domain, referral_path, approval_call, identity_name, 
        account_id_site, password, exchange_password, nickname, status, referral_code, notes, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        filterAccountId, // 계정 ID (INTEGER)
        site_name, 
        domain || '', 
        referral_path || '', 
        approval_call ? 1 : 0, 
        identity_name || '', 
        siteAccountId, // 사이트 계정 ID (TEXT)
        password || '', 
        exchange_password || '', 
        nickname || '', 
        status || '가입전', 
        referral_code || '', 
        notes || ''
      ]
    );
    
    // result.id 또는 result.lastID 사용
    const recordId = result?.id || result?.lastID;
    
    if (!recordId) {
      console.error('⚠️ [커뮤니티] INSERT 후 lastID가 없음:', result);
      return res.status(500).json({ error: '커뮤니티 ID를 가져올 수 없습니다' });
    }

    const newCommunity = await db.get(
      'SELECT * FROM communities WHERE id = ?',
      [recordId]
    );

    res.json(newCommunity);
  } catch (error) {
    console.error('커뮤니티 추가 실패:', error);
    res.status(500).json({ error: '커뮤니티 추가에 실패했습니다' });
  }
});

// 커뮤니티 수정
router.put('/:id', auth, async (req, res) => {
  try {
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    const { id } = req.params;
    const { 
      site_name, 
      domain, 
      referral_path, 
      approval_call, 
      identity_name, 
      account_id, 
      password, 
      exchange_password, 
      nickname, 
      status, 
      referral_code, 
      notes 
    } = req.body;

    // 해당 커뮤니티가 현재 사용자의 것인지 확인
    const existing = await db.get(
      'SELECT * FROM communities WHERE id = ? AND account_id = ?',
      [id, filterAccountId]
    );

    if (!existing) {
      return res.status(404).json({ error: '커뮤니티를 찾을 수 없습니다' });
    }

    // 상태에서 날짜 제거하여 순수 상태 추출
    const extractPureStatus = (statusStr) => {
      if (!statusStr) return '';
      // 날짜 패턴 제거 (예: "11.08 승인" -> "승인")
      return statusStr.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
    };
    
    const pureNewStatus = extractPureStatus(status);
    const pureCurrentStatus = extractPureStatus(existing.status);
    
    // 상태가 변경되었으면 날짜 추가
    let finalStatus = status || '가입전';
    if (status && pureNewStatus !== pureCurrentStatus) {
      const now = new Date();
      const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
      const month = String(kstDate.getMonth() + 1).padStart(2, '0');
      const day = String(kstDate.getDate()).padStart(2, '0');
      const currentDate = `${month}.${day}`;
      
      // 상태에 날짜가 없으면 추가
      if (!status.match(/^\d{1,2}\.\d{1,2}/)) {
        finalStatus = `${currentDate} ${pureNewStatus}`;
      } else {
        // 날짜가 이미 있으면 그대로 사용
        finalStatus = status;
      }
    } else if (status && status.match(/^\d{1,2}\.\d{1,2}/)) {
      // 날짜가 이미 있으면 그대로 사용
      finalStatus = status;
    }

    const timestamp = getKSTDateTimeString();
    await db.run(
      `UPDATE communities 
       SET site_name = ?, domain = ?, referral_path = ?, approval_call = ?, identity_name = ?, 
           account_id = ?, password = ?, exchange_password = ?, nickname = ?, status = ?, 
           referral_code = ?, notes = ?, updated_at = ?
       WHERE id = ? AND account_id = ?`,
      [
        site_name, 
        domain || '', 
        referral_path || '', 
        approval_call ? 1 : 0, 
        identity_name || '', 
        account_id || '', 
        password || '', 
        exchange_password || '', 
        nickname || '', 
        finalStatus, 
        referral_code || '', 
        notes || '', 
        timestamp,
        id, 
        filterAccountId
      ]
    );

    const updated = await db.get(
      'SELECT * FROM communities WHERE id = ?',
      [id]
    );

    res.json(updated);
  } catch (error) {
    console.error('커뮤니티 수정 실패:', error);
    res.status(500).json({ error: '커뮤니티 수정에 실패했습니다' });
  }
});

// 커뮤니티 삭제
router.delete('/:id', auth, async (req, res) => {
  try {
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    const { id } = req.params;

    // 해당 커뮤니티가 현재 사용자의 것인지 확인
    const existing = await db.get(
      'SELECT * FROM communities WHERE id = ? AND account_id = ?',
      [id, filterAccountId]
    );

    if (!existing) {
      return res.status(404).json({ error: '커뮤니티를 찾을 수 없습니다' });
    }

    await db.run(
      'DELETE FROM communities WHERE id = ? AND account_id = ?',
      [id, filterAccountId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('커뮤니티 삭제 실패:', error);
    res.status(500).json({ error: '커뮤니티 삭제에 실패했습니다' });
  }
});

module.exports = router;

