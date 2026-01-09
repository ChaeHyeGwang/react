const express = require('express');
const router = express.Router();
const { auth, requireSuperAdmin } = require('../middleware/auth');
const db = require('../database/db');
const { getKSTDateTimeString } = require('../utils/time');

// 사무실 목록 조회 (슈퍼관리자만)
router.get('/', auth, requireSuperAdmin, async (req, res) => {
  try {
    const offices = await db.all('SELECT * FROM offices ORDER BY name');
    res.json({ success: true, offices });
  } catch (error) {
    console.error('사무실 목록 조회 실패:', error);
    res.status(500).json({ success: false, message: '사무실 목록 조회 실패' });
  }
});

// 사무실 상세 조회 (슈퍼관리자만)
router.get('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const office = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    
    if (!office) {
      return res.status(404).json({ success: false, message: '사무실을 찾을 수 없습니다' });
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
    const { name, manager_account_id, status, description, address, phone, notes } = req.body;
    
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
      `INSERT INTO offices (name, manager_account_id, status, description, address, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, manager_account_id || null, status || 'active', description || '', address || '', phone || '', notes || '']
    );
    
    const newOffice = await db.get('SELECT * FROM offices WHERE id = ?', [result.lastID]);
    
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
    const { name, manager_account_id, status, description, address, phone, notes } = req.body;
    
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
           address = ?, phone = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [name, manager_account_id || null, status || 'active', description || '', address || '', phone || '', notes || '', timestamp, id]
    );
    
    const updatedOffice = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    
    res.json({ success: true, office: updatedOffice });
  } catch (error) {
    console.error('사무실 수정 실패:', error);
    res.status(500).json({ success: false, message: '사무실 수정 실패', error: error.message });
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
    
    res.json({ success: true, message: '사무실이 삭제되었습니다' });
  } catch (error) {
    console.error('사무실 삭제 실패:', error);
    res.status(500).json({ success: false, message: '사무실 삭제 실패', error: error.message });
  }
});

module.exports = router;

