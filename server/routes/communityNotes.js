const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const { getKSTDateTimeString } = require('../utils/time');

// 커뮤니티 정보기록 조회
router.get('/', auth, async (req, res) => {
  try {
    const { community_id } = req.query;

    if (!community_id) {
      return res.status(400).json({
        success: false,
        message: 'community_id가 필요합니다'
      });
    }

    const row = await db.get(
      'SELECT * FROM community_notices WHERE community_id = ?',
      [community_id]
    );

    const rawData = row?.data || '{}';
    let parsed = {};
    try {
      parsed = JSON.parse(rawData);
    } catch (e) {
      parsed = {};
    }

    // 사이트 정보기록과 동일한 기본 구조
    const defaultPayback = { type: '수동', days: [], percent: '', sameDayPercent: '' };
    const defaultEvents = [];
    const defaultRules = [];
    const defaultLastUpdated = new Date().toISOString().slice(0, 7);

    const combinedData = {
      tenure: parsed.tenure || '',
      attendanceType: parsed.attendanceType || '자동',
      rollover: parsed.rollover || 'X',
      settlement: parsed.settlement || '',
      settlementTotal: parsed.settlementTotal || 0,
      settlementPoint: parsed.settlementPoint || '',
      settlementDays: parsed.settlementDays || 0,
      settlementRules: Array.isArray(parsed.settlementRules) ? parsed.settlementRules : defaultRules,
      payback: { ...defaultPayback, ...(parsed.payback || {}) },
      rate: parsed.rate || '',
      events: Array.isArray(parsed.events) ? parsed.events : defaultEvents,
      attendanceDays: parsed.attendanceDays || 0,
      lastUpdated: parsed.lastUpdated || defaultLastUpdated,
      paybackCleared: parsed.paybackCleared || {}
    };

    res.json({
      success: true,
      data: {
        community_id: Number(community_id),
        recorded_by_identity: row?.recorded_by_identity || '',
        data: combinedData,
        updated_at: row?.updated_at || null
      }
    });
  } catch (error) {
    console.error('community_notices 조회 실패:', error);
    res.status(500).json({ success: false, message: '조회 실패' });
  }
});

// 커뮤니티 정보기록 저장/수정
router.post('/', auth, async (req, res) => {
  try {
    const { community_id, data } = req.body;

    if (!community_id) {
      return res.status(400).json({
        success: false,
        message: 'community_id가 필요합니다'
      });
    }

    // 기록자 정보
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    const account = await db.get(
      'SELECT username, display_name FROM accounts WHERE id = ?',
      [filterAccountId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다'
      });
    }

    const recordedBy = account.display_name || account.username;
    const json = JSON.stringify(data || {});

    const existing = await db.get(
      'SELECT id FROM community_notices WHERE community_id = ?',
      [community_id]
    );

    const now = getKSTDateTimeString();

    if (existing) {
      await db.run(
        `UPDATE community_notices
         SET recorded_by_identity = ?, data = ?, updated_at = ?
         WHERE id = ?`,
        [recordedBy, json, now, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO community_notices
         (community_id, recorded_by_identity, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [community_id, recordedBy, json, now, now]
      );
    }

    res.json({
      success: true,
      recorded_by: recordedBy
    });
  } catch (error) {
    console.error('community_notices 저장 실패:', error);
    res.status(500).json({ success: false, message: '저장 실패' });
  }
});

module.exports = router;


