const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { getKSTDateTimeString } = require('../utils/time');
const { auth } = require('../middleware/auth');

// 모든 이벤트 조회 (계정별)
router.get('/', auth, async (req, res) => {
  try {
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    if (!accountId) {
      return res.status(403).json({ success: false, error: '계정을 선택해주세요' });
    }

    const events = await db.all(
        `SELECT * FROM calendar_events WHERE account_id = ? ORDER BY event_date ASC, created_at ASC`,
        [accountId]
      );

    res.json({ success: true, data: events });
  } catch (error) {
    console.error('이벤트 조회 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 특정 날짜 범위의 이벤트 조회
router.get('/range', auth, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    if (!accountId || !start_date || !end_date) {
      return res.status(400).json({ success: false, error: 'start_date, end_date가 필요합니다' });
    }

    const events = await db.all(
        `SELECT * FROM calendar_events 
         WHERE account_id = ? AND event_date >= ? AND event_date <= ? 
         ORDER BY event_date ASC, created_at ASC`,
        [accountId, start_date, end_date]
      );

    res.json({ success: true, data: events });
  } catch (error) {
    console.error('이벤트 조회 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 이벤트 생성
router.post('/', auth, async (req, res) => {
  try {
    const { event_date, title, description, type } = req.body;
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    if (!accountId || !event_date || !title) {
      return res.status(400).json({ success: false, error: 'event_date, title이 필요합니다' });
    }

    const timestamp = getKSTDateTimeString();
    
    const result = await db.run(
        `INSERT INTO calendar_events (account_id, event_date, title, description, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [accountId, event_date, title, description || '', type || 'normal', timestamp, timestamp]
      );

    // 생성된 이벤트 조회
    const event = await db.get(
        `SELECT * FROM calendar_events WHERE id = ?`,
        [result.lastID]
      );

    res.json({ success: true, data: event });
  } catch (error) {
    console.error('이벤트 생성 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 이벤트 수정
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { event_date, title, description, type } = req.body;
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    if (!accountId) {
      return res.status(403).json({ success: false, error: '계정을 선택해주세요' });
    }
    
    if (!event_date || !title) {
      return res.status(400).json({ success: false, error: 'event_date, title이 필요합니다' });
    }

    // 먼저 이벤트가 존재하고 본인 계정의 이벤트인지 확인
    const existingEvent = await db.get(
        `SELECT * FROM calendar_events WHERE id = ? AND account_id = ?`,
        [id, accountId]
      );

    if (!existingEvent) {
      return res.status(404).json({ success: false, error: '이벤트를 찾을 수 없습니다' });
    }

    const timestamp = getKSTDateTimeString();
    
    const result = await db.run(
        `UPDATE calendar_events 
         SET event_date = ?, title = ?, description = ?, type = ?, updated_at = ?
         WHERE id = ? AND account_id = ?`,
        [event_date, title, description || '', type || 'normal', timestamp, id, accountId]
      );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '이벤트를 찾을 수 없습니다' });
    }

    // 수정된 이벤트 조회
    const event = await db.get(
        `SELECT * FROM calendar_events WHERE id = ?`,
        [id]
      );

    res.json({ success: true, data: event });
  } catch (error) {
    console.error('이벤트 수정 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 이벤트 삭제
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    if (!accountId) {
      return res.status(403).json({ success: false, error: '계정을 선택해주세요' });
    }

    const result = await db.run(
        `DELETE FROM calendar_events WHERE id = ? AND account_id = ?`,
        [id, accountId]
      );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '이벤트를 찾을 수 없습니다' });
    }

    res.json({ success: true, message: '이벤트가 삭제되었습니다' });
  } catch (error) {
    console.error('이벤트 삭제 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

