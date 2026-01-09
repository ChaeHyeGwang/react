const db = require('../database/db');
const { getSiteAttendance } = require('../utils/siteAttendance');

const getAccountOfficeId = async (accountId) => {
  if (!accountId) return null;
  const account = await db.get(
    'SELECT office_id FROM accounts WHERE id = ?',
    [accountId]
  );
  return Object.prototype.hasOwnProperty.call(account || {}, 'office_id')
    ? account.office_id
    : null;
};

const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
};

const getSiteNoteData = async ({ siteName, identityName = null, accountId, officeId }) => {
  if (!siteName) {
    throw new Error('siteName is required');
  }

  let resolvedOfficeId = typeof officeId === 'undefined' ? null : officeId;
  if (typeof officeId === 'undefined') {
    resolvedOfficeId = await getAccountOfficeId(accountId);
  }

  let sharedRow = null;
  if (resolvedOfficeId !== null && resolvedOfficeId !== undefined) {
    sharedRow = await db.get(
      `SELECT * FROM site_notes WHERE site_name = ? AND office_id = ?`,
      [siteName, resolvedOfficeId]
    );
  }
  if (!sharedRow) {
    sharedRow = await db.get(
      `SELECT * FROM site_notes WHERE site_name = ? AND office_id IS NULL`,
      [siteName]
    );
  }

  const sharedData = parseJson(sharedRow?.data, {});

  let paybackCleared = {};
  if (identityName && accountId && resolvedOfficeId !== null && resolvedOfficeId !== undefined) {
    const paybackRows = await db.all(
      `SELECT week_start_date
       FROM payback_cleared
       WHERE site_name = ? AND office_id = ? AND account_id = ? AND identity_name = ?`,
      [siteName, resolvedOfficeId, accountId, identityName]
    );
    if (paybackRows && paybackRows.length > 0) {
      const clearedMap = {};
      paybackRows.forEach(row => {
        clearedMap[row.week_start_date] = true;
      });
      paybackCleared = clearedMap;
    }
  }

  // settlement_paid 조회
  let settlementPaid = false;
  let settlementPaidAt = null;
  if (identityName && accountId && resolvedOfficeId !== null && resolvedOfficeId !== undefined) {
    const paidRow = await db.get(
      `SELECT paid_at
       FROM settlement_paid
       WHERE site_name = ? AND office_id = ? AND account_id = ? AND identity_name = ?`,
      [siteName, resolvedOfficeId, accountId, identityName]
    );
    if (paidRow) {
      settlementPaid = true;
      settlementPaidAt = paidRow.paid_at;
    }
  }

  const defaultPayback = { type: '수동', days: [], percent: '', sameDayPercent: '' };
  const defaultEvents = [];
  const defaultRules = [];
  const defaultLastUpdated = new Date().toISOString().slice(0, 7);

  const combinedData = {
    tenure: sharedData.tenure || '',
    attendanceType: sharedData.attendanceType || '자동',
    // chargeMin과 chargeMax는 DB에 저장된 값을 그대로 반환 (문자열이면 숫자로 변환, 없으면 undefined)
    chargeMin: sharedData.chargeMin !== undefined && sharedData.chargeMin !== null ? Number(sharedData.chargeMin) : sharedData.chargeMin,
    chargeMax: sharedData.chargeMax !== undefined && sharedData.chargeMax !== null ? Number(sharedData.chargeMax) : sharedData.chargeMax,
    rollover: sharedData.rollover || 'X',
    settlement: sharedData.settlement || '',
    settlementTotal: sharedData.settlementTotal || 0,
    settlementPoint: sharedData.settlementPoint || '',
    settlementDays: sharedData.settlementDays || 0,
    settlementRules: Array.isArray(sharedData.settlementRules) ? sharedData.settlementRules : defaultRules,
    payback: { ...defaultPayback, ...(sharedData.payback || {}) },
    rate: sharedData.rate || '',
    events: Array.isArray(sharedData.events) ? sharedData.events : defaultEvents,
    attendanceDays: 0,
    lastUpdated: sharedData.lastUpdated || defaultLastUpdated,
    paybackCleared,
    settlement_paid: settlementPaid,
    settlement_paid_at: settlementPaidAt
  };

  const recordedBy = sharedRow?.recorded_by_identity || '';

  if (identityName && accountId) {
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
      [siteName, accountId, identityName]
    );

    // site_account_id가 없으면 출석일 정보를 가져올 수 없음 (자동 생성하지 않음)

    if (context?.identity_id && context?.site_account_id) {
      const attendanceRow = await getSiteAttendance({
        accountId,
        identityId: context.identity_id,
        siteAccountId: context.site_account_id
      });
      if (attendanceRow) {
        combinedData.attendanceDays = Number(attendanceRow.attendance_days) || 0;
        combinedData.attendanceLastRecordedAt = attendanceRow.last_recorded_at || null;
      }
    }
  }

  return {
    site_name: siteName,
    recorded_by_identity: recordedBy,
    data: combinedData,
    updated_at: sharedRow?.updated_at || null
  };
};

module.exports = {
  getSiteNoteData,
  getAccountOfficeId
};

