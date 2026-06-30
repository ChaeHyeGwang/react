const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { auth } = require('../middleware/auth');
const { getKSTDateTimeString } = require('../utils/time');
const { emitDataChange } = require('../socket');

const normalizeSiteAccountId = (body) => {
  const raw = body.account_id ?? body.user_id ?? '';
  return raw === null || raw === undefined ? '' : String(raw).trim();
};

async function getCommunityById(id) {
  return db.get(
    `SELECT c.* FROM communities c WHERE c.id = ?`,
    [id]
  );
}

async function getAccountOfficeId(accountId) {
  if (!accountId) return null;
  const row = await db.get('SELECT office_id FROM accounts WHERE id = ?', [accountId]);
  return row?.office_id ?? null;
}

async function canAccessCommunity(req, community) {
  if (!community) return false;

  if (req.user.isSuperAdmin) return true;

  const filterAccountId = req.user.filterAccountId || req.user.accountId;

  if (community.account_id === filterAccountId) return true;

  if (req.user.isOfficeManager && req.user.filterOfficeId) {
    const ownerOfficeId = await getAccountOfficeId(community.account_id);
    return ownerOfficeId === req.user.filterOfficeId;
  }

  if (req.user.filterOfficeId) {
    const ownerOfficeId = await getAccountOfficeId(community.account_id);
    return ownerOfficeId === req.user.filterOfficeId;
  }

  return false;
}

async function emitCommunitiesChanged(req, payload = {}) {
  const accountId = payload.accountId || req.user.filterAccountId || req.user.accountId;
  const officeId =
    payload.officeId ||
    req.user.filterOfficeId ||
    req.user.officeId ||
    (await getAccountOfficeId(accountId));

  const room = officeId ? `office:${officeId}` : `account:${accountId}`;
  emitDataChange(
    'communities:changed',
    {
      ...payload,
      accountId,
      officeId,
      user: req.user.displayName || req.user.username
    },
    { room, excludeSocket: req.socketId }
  );
}

// 커뮤니티 목록 조회 (명의별 필터링 지원)
router.get('/', auth, async (req, res) => {
  try {
    const { identity_name } = req.query;

    // 사무실 관리자 또는 사무실 단위로 보는 슈퍼관리자
    if ((req.user.isOfficeManager || req.user.isSuperAdmin) && req.user.filterOfficeId) {
      let query = `
        SELECT c.*
        FROM communities c
        INNER JOIN accounts a ON c.account_id = a.id
        WHERE a.office_id = ?
      `;
      const params = [req.user.filterOfficeId];

      if (identity_name) {
        query += ' AND c.identity_name = ?';
        params.push(identity_name);
      }

      query += ' ORDER BY COALESCE(c.display_order, 0) ASC, c.id DESC';

      const communities = await db.all(query, params);
      return res.json(communities);
    }

    const filterAccountId = req.user.filterAccountId || req.user.accountId;

    let query = 'SELECT * FROM communities WHERE account_id = ?';
    const params = [filterAccountId];

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

    for (const community of communities) {
      if (!community.id || typeof community.display_order !== 'number') continue;

      const existing = await getCommunityById(community.id);
      if (!(await canAccessCommunity(req, existing))) {
        return res.status(403).json({ success: false, message: '순서 변경 권한이 없습니다' });
      }

      await db.run(
        'UPDATE communities SET display_order = ? WHERE id = ?',
        [community.display_order, community.id]
      );
    }

    res.json({ success: true, message: '순서가 변경되었습니다' });

    await emitCommunitiesChanged(req, { action: 'reorder' });
  } catch (error) {
    console.error('커뮤니티 순서 변경 실패:', error);
    res.status(500).json({ success: false, message: '순서 변경 실패' });
  }
});

// 커뮤니티 추가
router.post('/', auth, async (req, res) => {
  try {
    const filterAccountId = req.user.filterAccountId || req.user.accountId;

    const account = await db.get(
      'SELECT id, office_id FROM accounts WHERE id = ?',
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
      referral_code,
      approval_call,
      identity_name,
      password,
      exchange_password,
      nickname,
      status,
      notes,
      category
    } = req.body;

    const siteAccountId = normalizeSiteAccountId(req.body);
    const pathValue = (referral_path ?? req.body.path ?? '').toString();
    const categoryValue = (category ?? '').toString();

    const result = await db.run(
      `INSERT INTO communities (
        account_id, site_name, domain, referral_path, approval_call, identity_name,
        account_id_site, password, exchange_password, nickname, status, referral_code, notes, category, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        filterAccountId,
        site_name,
        domain || '',
        pathValue,
        approval_call ? 1 : 0,
        identity_name || '',
        siteAccountId,
        password || '',
        exchange_password || '',
        nickname || '',
        status || '가입전',
        referral_code || '',
        notes || '',
        categoryValue
      ]
    );

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

    await emitCommunitiesChanged(req, {
      action: 'create',
      communityId: recordId,
      accountId: filterAccountId,
      officeId: account.office_id
    });
  } catch (error) {
    console.error('커뮤니티 추가 실패:', error);
    res.status(500).json({ error: '커뮤니티 추가에 실패했습니다' });
  }
});

// 커뮤니티 수정
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await getCommunityById(id);

    if (!(await canAccessCommunity(req, existing))) {
      return res.status(404).json({ error: '커뮤니티를 찾을 수 없습니다' });
    }

    const {
      site_name,
      domain,
      approval_call,
      identity_name,
      password,
      exchange_password,
      nickname,
      status,
      referral_code,
      notes,
      category
    } = req.body;

    const referral_path =
      req.body.referral_path !== undefined
        ? req.body.referral_path
        : (req.body.path !== undefined ? req.body.path : existing.referral_path);

    const account_id_site =
      req.body.account_id !== undefined
        ? normalizeSiteAccountId(req.body)
        : (req.body.user_id !== undefined ? String(req.body.user_id).trim() : existing.account_id_site);

    const categoryValue =
      category !== undefined ? category : (existing.category || '');

    const extractPureStatus = (statusStr) => {
      if (!statusStr) return '';
      return statusStr.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
    };

    const pureNewStatus = extractPureStatus(status);
    const pureCurrentStatus = extractPureStatus(existing.status);

    let finalStatus = status || existing.status || '가입전';
    if (status && pureNewStatus !== pureCurrentStatus) {
      const now = new Date();
      const kstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const month = String(kstDate.getMonth() + 1).padStart(2, '0');
      const day = String(kstDate.getDate()).padStart(2, '0');
      const currentDate = `${month}.${day}`;

      if (!status.match(/^\d{1,2}\.\d{1,2}/)) {
        finalStatus = `${currentDate} ${pureNewStatus}`;
      } else {
        finalStatus = status;
      }
    } else if (status && status.match(/^\d{1,2}\.\d{1,2}/)) {
      finalStatus = status;
    }

    const timestamp = getKSTDateTimeString();
    await db.run(
      `UPDATE communities
       SET site_name = ?, domain = ?, referral_path = ?, approval_call = ?, identity_name = ?,
           account_id_site = ?, password = ?, exchange_password = ?, nickname = ?, status = ?,
           referral_code = ?, notes = ?, category = ?, updated_at = ?
       WHERE id = ?`,
      [
        site_name ?? existing.site_name,
        domain ?? existing.domain ?? '',
        referral_path ?? '',
        approval_call !== undefined ? (approval_call ? 1 : 0) : existing.approval_call,
        identity_name ?? existing.identity_name ?? '',
        account_id_site ?? '',
        password ?? existing.password ?? '',
        exchange_password ?? existing.exchange_password ?? '',
        nickname ?? existing.nickname ?? '',
        finalStatus,
        referral_code ?? existing.referral_code ?? '',
        notes ?? existing.notes ?? '',
        categoryValue,
        timestamp,
        id
      ]
    );

    const updated = await db.get(
      'SELECT * FROM communities WHERE id = ?',
      [id]
    );

    res.json(updated);

    await emitCommunitiesChanged(req, {
      action: 'update',
      communityId: Number(id),
      accountId: existing.account_id
    });
  } catch (error) {
    console.error('커뮤니티 수정 실패:', error);
    res.status(500).json({ error: '커뮤니티 수정에 실패했습니다' });
  }
});

// 커뮤니티 삭제
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await getCommunityById(id);

    if (!(await canAccessCommunity(req, existing))) {
      return res.status(404).json({ error: '커뮤니티를 찾을 수 없습니다' });
    }

    await db.run('DELETE FROM communities WHERE id = ?', [id]);

    res.json({ success: true });

    await emitCommunitiesChanged(req, {
      action: 'delete',
      communityId: Number(id),
      accountId: existing.account_id
    });
  } catch (error) {
    console.error('커뮤니티 삭제 실패:', error);
    res.status(500).json({ error: '커뮤니티 삭제에 실패했습니다' });
  }
});

module.exports = router;
