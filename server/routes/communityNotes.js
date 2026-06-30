const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const { getAccountOfficeId } = require('../services/siteNotesService');
const { getKSTDateTimeString } = require('../utils/time');
const { emitDataChange } = require('../socket');

const parseCommunityData = (rawData) => {
  let parsed = {};
  try {
    parsed = rawData ? JSON.parse(rawData) : {};
  } catch (e) {
    parsed = {};
  }

  const defaultPayback = { type: '수동', days: [], percent: '', sameDayPercent: '' };
  const defaultEvents = [];
  const defaultRules = [];
  const defaultLastUpdated = new Date().toISOString().slice(0, 7);

  return {
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
    paybackCleared: parsed.paybackCleared || {},
    settlementClearedStart: parsed.settlementClearedStart || null,
    settlement_paid: parsed.settlement_paid || false,
    settlement_paid_at: parsed.settlement_paid_at || null
  };
};

const resolveOfficeId = async (req) => {
  if (req.user.filterOfficeId) {
    return req.user.filterOfficeId;
  }

  const filterAccountId = req.user.filterAccountId || req.user.accountId;
  if (req.user.filterAccountId) {
    const targetAccount = await db.get(
      'SELECT office_id FROM accounts WHERE id = ?',
      [req.user.filterAccountId]
    );
    return targetAccount?.office_id ?? null;
  }

  return (await getAccountOfficeId(filterAccountId)) ?? req.user.officeId ?? null;
};

// 커뮤니티 정보기록 조회 (사무실 + 사이트명 기준 공유)
router.get('/', auth, async (req, res) => {
  try {
    const site_name = (req.query.site_name || '').trim();

    if (!site_name) {
      return res.status(400).json({
        success: false,
        message: 'site_name이 필요합니다'
      });
    }

    const officeId = await resolveOfficeId(req);
    if (officeId === null || officeId === undefined) {
      return res.status(403).json({
        success: false,
        message: '사무실 정보가 없습니다. 먼저 계정을 사무실에 배정하세요.'
      });
    }

    const row = await db.get(
      'SELECT * FROM community_notices WHERE site_name = ? AND office_id = ?',
      [site_name, officeId]
    );

    const combinedData = parseCommunityData(row?.data);

    res.json({
      success: true,
      data: {
        site_name,
        office_id: officeId,
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

// 커뮤니티 정보기록 저장/수정 (사무실 + 사이트명 기준 공유)
router.post('/', auth, async (req, res) => {
  try {
    const site_name = (req.body.site_name || '').trim();
    const data = req.body.data;
    const updateRecordedBy = req.body.updateRecordedBy === true;

    if (!site_name) {
      return res.status(400).json({
        success: false,
        message: 'site_name이 필요합니다'
      });
    }

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

    const officeId = await resolveOfficeId(req);
    if (officeId === null || officeId === undefined) {
      return res.status(403).json({
        success: false,
        message: '사무실 정보가 없습니다. 먼저 계정을 사무실에 배정하세요.'
      });
    }

    const recordedBy = account.display_name || account.username;
    const json = JSON.stringify(data || {});

    const existing = await db.get(
      'SELECT id, recorded_by_identity FROM community_notices WHERE site_name = ? AND office_id = ?',
      [site_name, officeId]
    );

    const now = getKSTDateTimeString();
    let finalRecordedBy = recordedBy;

    if (existing) {
      if (!updateRecordedBy) {
        finalRecordedBy = existing.recorded_by_identity || recordedBy;
      }

      await db.run(
        `UPDATE community_notices
         SET recorded_by_identity = ?, data = ?, updated_at = ?
         WHERE id = ?`,
        [updateRecordedBy ? recordedBy : finalRecordedBy, json, now, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO community_notices
         (site_name, office_id, recorded_by_identity, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [site_name, officeId, recordedBy, json, now, now]
      );
      finalRecordedBy = recordedBy;
    }

    res.json({
      success: true,
      recorded_by: finalRecordedBy
    });

    const room = officeId ? `office:${officeId}` : `account:${filterAccountId}`;
    emitDataChange(
      'communities:changed',
      { action: 'notes_updated', site_name, officeId },
      { room, excludeSocket: req.socketId }
    );
  } catch (error) {
    console.error('community_notices 저장 실패:', error);
    res.status(500).json({ success: false, message: '저장 실패' });
  }
});

module.exports = router;
