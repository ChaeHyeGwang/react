const db = require('../database/db');

// 중복 감사 로그 방지를 위한 캐시 (key -> timestamp)
const recentLogs = new Map();
const DEDUP_WINDOW_MS = 3000; // 3초 내 동일 로그 무시

// 주기적으로 오래된 캐시 항목 정리
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentLogs) {
    if (now - timestamp > DEDUP_WINDOW_MS * 2) {
      recentLogs.delete(key);
    }
  }
}, 10000);

/**
 * 감사(audit) 로그를 기록하는 유틸리티 함수
 *
 * @param {Object} req - Express 요청 객체 (req.user, req.ip 사용)
 * @param {Object} options
 * @param {string} options.action - 'CREATE' | 'UPDATE' | 'DELETE'
 * @param {string} options.tableName - 변경된 테이블명
 * @param {string|number} options.recordId - 변경된 레코드 ID
 * @param {Object|null} options.oldData - 변경 전 데이터
 * @param {Object|null} options.newData - 변경 후 데이터
 * @param {string} options.description - 변경 설명 (한글)
 */
async function logAudit(req, { action, tableName, recordId, oldData = null, newData = null, description = '' }) {
  try {
    const user = req.user || {};
    const accountId = user.accountId || null;
    const username = user.username || 'system';
    const displayName = user.displayName || 'system';
    const ipAddress = req.ip || req.connection?.remoteAddress || '';

    // 중복 방지: 같은 사용자 + 테이블 + 레코드 + 액션이 짧은 시간 내 반복되면 무시
    const dedupKey = `${accountId}:${action}:${tableName}:${recordId}`;
    const now = Date.now();
    const lastLogged = recentLogs.get(dedupKey);
    if (lastLogged && (now - lastLogged) < DEDUP_WINDOW_MS) {
      return; // 중복 → 무시
    }
    recentLogs.set(dedupKey, now);

    const oldDataStr = oldData ? JSON.stringify(oldData) : null;
    const newDataStr = newData ? JSON.stringify(newData) : null;

    await db.run(
      `INSERT INTO audit_logs (account_id, username, display_name, action, table_name, record_id, old_data, new_data, description, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [accountId, username, displayName, action, tableName, String(recordId || ''), oldDataStr, newDataStr, description, ipAddress]
    );
  } catch (err) {
    // 감사 로그 실패가 메인 로직에 영향을 주면 안 됨
    console.error('[감사 로그] 기록 실패:', err.message);
  }
}

/**
 * 90일 이상 오래된 감사 로그를 자동 삭제
 */
async function cleanupOldAuditLogs() {
  try {
    const result = await db.run(
      `DELETE FROM audit_logs WHERE created_at < datetime('now', '-90 days')`
    );
    if (result && result.changes > 0) {
      console.log(`[감사 로그] ${result.changes}건의 오래된 로그를 정리했습니다.`);
    }
  } catch (err) {
    console.error('[감사 로그] 정리 실패:', err.message);
  }
}

module.exports = { logAudit, cleanupOldAuditLogs };
