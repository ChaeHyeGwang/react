const express = require('express');
const router = express.Router();
const { auth, requireSuperAdmin } = require('../middleware/auth');
const db = require('../database/db');
const { getKSTDateTimeString } = require('../utils/time');
const { logAudit } = require('../utils/auditLog');

// 사무실 목록 조회 (슈퍼관리자: 전체, 사무실 관리자: 자신의 사무실만)
router.get('/', auth, async (req, res) => {
  try {
    const isSuperAdmin = req.user.accountType === 'super_admin';
    
    if (isSuperAdmin) {
      // 슈퍼관리자: 모든 사무실 조회
      const offices = await db.all('SELECT * FROM offices ORDER BY name');
      res.json({ success: true, offices });
    } else if (req.user.isOfficeManager && req.user.officeId) {
      // 사무실 관리자: 자신의 사무실만 조회
      const office = await db.get('SELECT * FROM offices WHERE id = ?', [req.user.officeId]);
      if (office) {
        res.json({ success: true, offices: [office] });
      } else {
        res.json({ success: true, offices: [] });
      }
    } else {
      return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }
  } catch (error) {
    console.error('사무실 목록 조회 실패:', error);
    res.status(500).json({ success: false, message: '사무실 목록 조회 실패' });
  }
});

// 사무실 상세 조회 (슈퍼관리자: 모든 사무실, 사무실 관리자: 자신의 사무실만)
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const office = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    
    if (!office) {
      return res.status(404).json({ success: false, message: '사무실을 찾을 수 없습니다' });
    }
    
    // 권한 체크: 사무실 관리자는 자신의 사무실만 조회 가능
    const isSuperAdmin = req.user.accountType === 'super_admin';
    const isOfficeManager = req.user.isOfficeManager && office.manager_account_id === req.user.accountId;
    
    // 사무실 관리자가 자신의 officeId로 조회하는 경우도 허용
    const isOwnOffice = req.user.isOfficeManager && parseInt(id) === req.user.officeId;
    
    if (!isSuperAdmin && !isOfficeManager && !isOwnOffice) {
      return res.status(403).json({ success: false, message: '권한이 없습니다. 자신의 사무실만 조회할 수 있습니다.' });
    }
    
    res.json({ success: true, office });
  } catch (error) {
    console.error('사무실 조회 실패:', error);
    res.status(500).json({ success: false, message: '사무실 조회 실패' });
  }
});

// 사무실 생성 (슈퍼관리자만)
router.post('/', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, manager_account_id, status, description, notes, telegram_bot_token, telegram_chat_id, telegram_id } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '사무실명은 필수입니다' });
    }
    
    // 관리자 계정이 지정된 경우 확인
    if (manager_account_id) {
      const managerAccount = await db.get('SELECT * FROM accounts WHERE id = ?', [manager_account_id]);
      if (!managerAccount) {
        return res.status(404).json({ success: false, message: '관리자 계정을 찾을 수 없습니다' });
      }
      
      // 해당 계정을 사무실 관리자로 설정
      await db.run('UPDATE accounts SET is_office_manager = 1 WHERE id = ?', [manager_account_id]);
    }
    
    const result = await db.run(
      `INSERT INTO offices (name, manager_account_id, status, description, notes, telegram_bot_token, telegram_chat_id, telegram_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, manager_account_id || null, status || 'active', description || '', notes || '', String(telegram_bot_token || '').trim(), String(telegram_chat_id || '').trim(), String(telegram_id || '').trim()]
    );
    
    const newOffice = await db.get('SELECT * FROM offices WHERE id = ?', [result.lastID]);
    
    // 감사 로그 기록
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'offices',
      recordId: result.lastID,
      oldData: null,
      newData: newOffice,
      description: `사무실 생성 (${name})`
    });

    res.status(201).json({ success: true, office: newOffice });
  } catch (error) {
    console.error('사무실 생성 실패:', error);
    res.status(500).json({ success: false, message: '사무실 생성 실패', error: error.message });
  }
});

// 사무실 수정 (슈퍼관리자만)
router.put('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, manager_account_id, status, description, notes, telegram_bot_token, telegram_chat_id, telegram_id } = req.body;
    
    const existingOffice = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    if (!existingOffice) {
      return res.status(404).json({ success: false, message: '사무실을 찾을 수 없습니다' });
    }
    
    // 기존 관리자의 is_office_manager 해제
    if (existingOffice.manager_account_id) {
      await db.run('UPDATE accounts SET is_office_manager = 0 WHERE id = ?', [existingOffice.manager_account_id]);
    }
    
    // 새 관리자 계정이 지정된 경우 확인 및 설정
    if (manager_account_id) {
      const managerAccount = await db.get('SELECT * FROM accounts WHERE id = ?', [manager_account_id]);
      if (!managerAccount) {
        return res.status(404).json({ success: false, message: '관리자 계정을 찾을 수 없습니다' });
      }
      
      // 해당 계정을 사무실 관리자로 설정
      await db.run('UPDATE accounts SET is_office_manager = 1 WHERE id = ?', [manager_account_id]);
    }
    
    const timestamp = getKSTDateTimeString();
    await db.run(
      `UPDATE offices 
       SET name = ?, manager_account_id = ?, status = ?, description = ?, 
           notes = ?, telegram_bot_token = ?, telegram_chat_id = ?, telegram_id = ?, updated_at = ?
       WHERE id = ?`,
      [name, manager_account_id || null, status || 'active', description || '', notes || '', String(telegram_bot_token || '').trim(), String(telegram_chat_id || '').trim(), String(telegram_id || '').trim(), timestamp, id]
    );
    
    const updatedOffice = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    
    // 감사 로그 기록
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'offices',
      recordId: id,
      oldData: existingOffice,
      newData: updatedOffice,
      description: `사무실 수정 (${name})`
    });

    res.json({ success: true, office: updatedOffice });
  } catch (error) {
    console.error('사무실 수정 실패:', error);
    res.status(500).json({ success: false, message: '사무실 수정 실패', error: error.message });
  }
});

// 사무실 텔레그램 설정 조회 (사무실 관리자 또는 슈퍼관리자)
router.get('/:id/telegram', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const office = await db.get('SELECT id, name, manager_account_id, telegram_bot_token, telegram_chat_id FROM offices WHERE id = ?', [id]);
    
    if (!office) {
      return res.status(404).json({ success: false, message: '사무실을 찾을 수 없습니다' });
    }
    
    // 권한 체크: 사무실 관리자는 자신의 사무실만 조회 가능
    const isSuperAdmin = req.user.accountType === 'super_admin';
    const isOfficeManagerByAccount = req.user.isOfficeManager && office.manager_account_id === req.user.accountId;
    // 사무실 관리자가 자신의 officeId로 조회하는 경우도 허용
    const isOwnOffice = req.user.isOfficeManager && parseInt(id) === req.user.officeId;
    
    if (!isSuperAdmin && !isOfficeManagerByAccount && !isOwnOffice) {
      return res.status(403).json({ success: false, message: '권한이 없습니다' });
    }
    
    res.json({ 
      success: true, 
      office: {
        id: office.id,
        name: office.name,
        telegram_bot_token: String(office.telegram_bot_token || ''),
        telegram_chat_id: String(office.telegram_chat_id || ''),
        hasToken: !!office.telegram_bot_token,
        hasChatId: !!office.telegram_chat_id
      }
    });
  } catch (error) {
    console.error('텔레그램 설정 조회 실패:', error);
    res.status(500).json({ success: false, message: '텔레그램 설정 조회 실패', error: error.message });
  }
});

// 사무실 텔레그램 설정 수정 (사무실 관리자 또는 슈퍼관리자)
router.put('/:id/telegram', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { telegram_bot_token, telegram_chat_id } = req.body;
    
    // 두 필드 모두 필수
    if (!telegram_bot_token || !telegram_chat_id) {
      return res.status(400).json({ success: false, message: '텔레그램 봇 토큰과 채팅 ID를 모두 입력해주세요.' });
    }
    
    const trimmedToken = String(telegram_bot_token || '').trim();
    const trimmedChatId = String(telegram_chat_id || '').trim();
    
    const office = await db.get('SELECT id, name, manager_account_id, telegram_bot_token, telegram_chat_id FROM offices WHERE id = ?', [id]);
    
    if (!office) {
      return res.status(404).json({ success: false, message: '사무실을 찾을 수 없습니다' });
    }
    
    // 권한 체크: 사무실 관리자는 자신의 사무실만 수정 가능
    const isSuperAdmin = req.user.accountType === 'super_admin';
    const isOfficeManagerByAccount = req.user.isOfficeManager && office.manager_account_id === req.user.accountId;
    // 사무실 관리자가 자신의 officeId로 수정하는 경우도 허용
    const isOwnOffice = req.user.isOfficeManager && parseInt(id) === req.user.officeId;
    
    if (!isSuperAdmin && !isOfficeManagerByAccount && !isOwnOffice) {
      return res.status(403).json({ success: false, message: '권한이 없습니다. 자신의 사무실만 수정할 수 있습니다.' });
    }
    
    const timestamp = getKSTDateTimeString();
    await db.run(
      `UPDATE offices 
       SET telegram_bot_token = ?, telegram_chat_id = ?, updated_at = ?
       WHERE id = ?`,
      [trimmedToken, trimmedChatId, timestamp, id]
    );
    
    const updatedOffice = await db.get('SELECT id, name, telegram_bot_token, telegram_chat_id FROM offices WHERE id = ?', [id]);
    
    res.json({ 
      success: true, 
      office: {
        id: updatedOffice.id,
        name: updatedOffice.name,
        telegram_bot_token: updatedOffice.telegram_bot_token || '',
        telegram_chat_id: updatedOffice.telegram_chat_id || '',
        hasToken: !!updatedOffice.telegram_bot_token,
        hasChatId: !!updatedOffice.telegram_chat_id
      }
    });
  } catch (error) {
    console.error('텔레그램 설정 수정 실패:', error);
    res.status(500).json({ success: false, message: '텔레그램 설정 수정 실패', error: error.message });
  }
});

// 사무실 삭제 (슈퍼관리자만)
router.delete('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const office = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    if (!office) {
      return res.status(404).json({ success: false, message: '사무실을 찾을 수 없습니다' });
    }
    
    // 해당 사무실에 속한 계정이 있는지 확인
    const accountsCount = await db.get('SELECT COUNT(*) as count FROM accounts WHERE office_id = ?', [id]);
    if (accountsCount.count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `해당 사무실에 속한 계정이 ${accountsCount.count}개 있습니다. 먼저 계정을 다른 사무실로 이동하거나 삭제해주세요.` 
      });
    }
    
    // 관리자의 is_office_manager 해제
    if (office.manager_account_id) {
      await db.run('UPDATE accounts SET is_office_manager = 0 WHERE id = ?', [office.manager_account_id]);
    }
    
    await db.run('DELETE FROM offices WHERE id = ?', [id]);
    
    // 감사 로그 기록
    await logAudit(req, {
      action: 'DELETE',
      tableName: 'offices',
      recordId: id,
      oldData: office,
      newData: null,
      description: `사무실 삭제 (${office.name})`
    });

    res.json({ success: true, message: '사무실이 삭제되었습니다' });
  } catch (error) {
    console.error('사무실 삭제 실패:', error);
    res.status(500).json({ success: false, message: '사무실 삭제 실패', error: error.message });
  }
});

module.exports = router;

