const db = require('../database/db');
const { getKSTDateTimeString } = require('./time');

const PERIOD_TYPE_TOTAL = 'total';
const PERIOD_VALUE_ALL = 'all';

async function upsertSiteAttendance({
  accountId,
  identityId,
  siteAccountId,
  attendanceDays,
  lastRecordedAt = null
}) {
  if (!accountId || !identityId || !siteAccountId) {
    return null;
  }

  const normalized = Number(attendanceDays);
  if (!Number.isFinite(normalized)) {
    return null;
  }

  const safeDays = normalized < 0 ? 0 : normalized;

  const timestamp = getKSTDateTimeString();
  await db.run(
    `INSERT INTO site_attendance (account_id, identity_id, site_account_id, period_type, period_value, attendance_days, last_recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, identity_id, site_account_id, period_type, period_value)
     DO UPDATE SET
       attendance_days = excluded.attendance_days,
       updated_at = excluded.updated_at,
       last_recorded_at = COALESCE(excluded.last_recorded_at, site_attendance.last_recorded_at, excluded.updated_at)`,
    [
      accountId,
      identityId,
      siteAccountId,
      PERIOD_TYPE_TOTAL,
      PERIOD_VALUE_ALL,
      safeDays,
      lastRecordedAt || null,
      timestamp,
      timestamp
    ]
  );

  return safeDays;
}

async function getSiteAttendance({ accountId, identityId, siteAccountId }) {
  if (!accountId || !identityId || !siteAccountId) {
    return null;
  }

  return db.get(
    `SELECT attendance_days, last_recorded_at
     FROM site_attendance
     WHERE account_id = ?
       AND identity_id = ?
       AND site_account_id = ?
       AND period_type = ?
       AND period_value = ?`,
    [
      accountId,
      identityId,
      siteAccountId,
      PERIOD_TYPE_TOTAL,
      PERIOD_VALUE_ALL
    ]
  );
}

async function deleteSiteAttendanceBySiteAccount(siteAccountId) {
  if (!siteAccountId) {
    return;
  }

  await db.run(
    'DELETE FROM site_attendance WHERE site_account_id = ?',
    [siteAccountId]
  );
}

module.exports = {
  upsertSiteAttendance,
  getSiteAttendance,
  deleteSiteAttendanceBySiteAccount
};

