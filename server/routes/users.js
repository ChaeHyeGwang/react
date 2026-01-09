const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');

// 모든 유저 조회
router.get('/', auth, async (req, res) => {
  try {
    const users = await db.all(
      'SELECT id, username, created_date, notes FROM users ORDER BY username'
    );
    res.json({ success: true, users });
  } catch (error) {
    console.error('유저 조회 실패:', error);
    res.status(500).json({ success: false, message: '유저 조회 실패' });
  }
});

// 특정 유저 조회
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    
    if (!user) {
      return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('유저 조회 실패:', error);
    res.status(500).json({ success: false, message: '유저 조회 실패' });
  }
});

// 유저 추가
router.post('/', auth, async (req, res) => {
  try {
    const { username, notes = '' } = req.body;
    
    if (!username) {
      return res.status(400).json({ success: false, message: '사용자명을 입력해주세요' });
    }
    
    const createdDate = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO users (username, created_date, notes) VALUES (?, ?, ?)',
      [username, createdDate, notes]
    );
    
    res.json({ success: true, userId: result.lastID, message: '유저가 추가되었습니다' });
  } catch (error) {
    console.error('유저 추가 실패:', error);
    res.status(500).json({ success: false, message: '유저 추가 실패' });
  }
});

// 유저 수정
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, notes } = req.body;
    
    await db.run(
      'UPDATE users SET username = ?, notes = ? WHERE id = ?',
      [username, notes, id]
    );
    
    res.json({ success: true, message: '유저가 수정되었습니다' });
  } catch (error) {
    console.error('유저 수정 실패:', error);
    res.status(500).json({ success: false, message: '유저 수정 실패' });
  }
});

// 유저 삭제
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 먼저 관련 명의들 조회
    const identities = await db.all('SELECT id FROM identities WHERE user_id = ?', [id]);
    
    // 각 명의의 사이트들 삭제
    for (const identity of identities) {
      await db.run('DELETE FROM site_accounts WHERE identity_id = ?', [identity.id]);
    }
    
    // 명의들 삭제
    await db.run('DELETE FROM identities WHERE user_id = ?', [id]);
    
    // 유저 삭제
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    
    res.json({ success: true, message: '유저가 삭제되었습니다' });
  } catch (error) {
    console.error('유저 삭제 실패:', error);
    res.status(500).json({ success: false, message: '유저 삭제 실패' });
  }
});

module.exports = router;
