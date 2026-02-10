const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { auth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');

// 테이블명 한글 매핑
const TABLE_NAME_MAP = {
  drbet_records: '메인(DR벳)',
  site_accounts: '사이트',
  identities: '명의',
  settlements: '정산',
  finish_summary: '마무리',
  start_summary: '시작',
  finish_data: '마무리(잔액)',
  start_data: '시작(잔액)',
  accounts: '계정',
  offices: '사무실'
};

// id 컬럼이 없고 복합 키를 사용하는 테이블 정의
// record_id 형식: "date-accountId" 또는 "date-identityName-accountId"
const COMPOSITE_KEY_TABLES = {
  start_summary: {
    parse: (recordId) => {
      // "2026-02-10-494" → date="2026-02-10", account_id=494
      const lastDash = recordId.lastIndexOf('-');
      return { date: recordId.substring(0, lastDash), account_id: parseInt(recordId.substring(lastDash + 1)) };
    },
    where: 'date = ? AND account_id = ?',
    params: (parsed) => [parsed.date, parsed.account_id]
  },
  finish_summary: {
    parse: (recordId) => {
      const lastDash = recordId.lastIndexOf('-');
      return { date: recordId.substring(0, lastDash), account_id: parseInt(recordId.substring(lastDash + 1)) };
    },
    where: 'date = ? AND account_id = ?',
    params: (parsed) => [parsed.date, parsed.account_id]
  },
  start_data: {
    parse: (recordId) => {
      // "2026-02-10-김용준-494" → date, identity_name, account_id
      const parts = recordId.split('-');
      const accountId = parseInt(parts[parts.length - 1]);
      const identityName = parts[parts.length - 2];
      const date = parts.slice(0, parts.length - 2).join('-');
      return { date, identity_name: identityName, account_id: accountId };
    },
    where: 'date = ? AND identity_name = ? AND account_id = ?',
    params: (parsed) => [parsed.date, parsed.identity_name, parsed.account_id]
  },
  finish_data: {
    parse: (recordId) => {
      const parts = recordId.split('-');
      const accountId = parseInt(parts[parts.length - 1]);
      const identityName = parts[parts.length - 2];
      const date = parts.slice(0, parts.length - 2).join('-');
      return { date, identity_name: identityName, account_id: accountId };
    },
    where: 'date = ? AND identity_name = ? AND account_id = ?',
    params: (parsed) => [parsed.date, parsed.identity_name, parsed.account_id]
  }
};

// GET /api/audit-logs - 감사 로그 목록 조회
router.get('/', auth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      tableName,
      accountId,
      startDate,
      endDate,
      keyword
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];

    // 슈퍼관리자: 전체, 사무실 관리자: 사무실 내 전체, 일반 유저: 본인만
    if (req.user.accountType !== 'super_admin') {
      if (req.user.isOfficeManager && req.user.officeId) {
        // 사무실 관리자는 사무실 내 모든 계정의 로그 조회
        conditions.push(`al.account_id IN (SELECT id FROM accounts WHERE office_id = ?)`);
        params.push(req.user.officeId);
      } else {
        // 일반 유저는 본인 로그만
        conditions.push(`al.account_id = ?`);
        params.push(req.user.accountId);
      }
    }

    if (action) {
      conditions.push(`al.action = ?`);
      params.push(action);
    }
    if (tableName) {
      conditions.push(`al.table_name = ?`);
      params.push(tableName);
    }
    if (accountId) {
      conditions.push(`al.account_id = ?`);
      params.push(parseInt(accountId));
    }
    if (startDate) {
      conditions.push(`al.created_at >= ?`);
      params.push(startDate + ' 00:00:00');
    }
    if (endDate) {
      conditions.push(`al.created_at <= ?`);
      params.push(endDate + ' 23:59:59');
    }
    if (keyword) {
      conditions.push(`(al.description LIKE ? OR al.username LIKE ? OR al.display_name LIKE ?)`);
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 총 개수 조회
    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`,
      params
    );

    // 목록 조회 (old_data, new_data 제외 - 상세에서만 조회)
    const logs = await db.all(
      `SELECT al.id, al.account_id, al.username, al.display_name, al.action, 
              al.table_name, al.record_id, al.description, al.ip_address, al.created_at
       FROM audit_logs al
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // 테이블명 한글 변환 추가
    const logsWithLabel = logs.map(log => ({
      ...log,
      table_name_label: TABLE_NAME_MAP[log.table_name] || log.table_name
    }));

    res.json({
      logs: logsWithLabel,
      pagination: {
        total: countResult.total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[감사 로그] 목록 조회 실패:', error);
    res.status(500).json({ error: '감사 로그 조회에 실패했습니다.' });
  }
});

// GET /api/audit-logs/:id - 감사 로그 상세 조회
router.get('/:id', auth, async (req, res) => {
  try {
    const log = await db.get(
      `SELECT * FROM audit_logs WHERE id = ?`,
      [req.params.id]
    );

    if (!log) {
      return res.status(404).json({ error: '로그를 찾을 수 없습니다.' });
    }

    // 권한 확인: 슈퍼관리자는 전체, 사무실 관리자는 사무실 범위, 일반 유저는 본인만
    if (req.user.accountType !== 'super_admin') {
      if (req.user.isOfficeManager && req.user.officeId) {
        const account = await db.get(
          `SELECT office_id FROM accounts WHERE id = ?`,
          [log.account_id]
        );
        if (!account || account.office_id !== req.user.officeId) {
          return res.status(403).json({ error: '접근 권한이 없습니다.' });
        }
      } else if (log.account_id !== req.user.accountId) {
        return res.status(403).json({ error: '접근 권한이 없습니다.' });
      }
    }

    // JSON 파싱
    let oldData = null;
    let newData = null;
    try {
      if (log.old_data) oldData = JSON.parse(log.old_data);
    } catch (e) { oldData = log.old_data; }
    try {
      if (log.new_data) newData = JSON.parse(log.new_data);
    } catch (e) { newData = log.new_data; }

    res.json({
      ...log,
      old_data: oldData,
      new_data: newData,
      table_name_label: TABLE_NAME_MAP[log.table_name] || log.table_name
    });
  } catch (error) {
    console.error('[감사 로그] 상세 조회 실패:', error);
    res.status(500).json({ error: '감사 로그 상세 조회에 실패했습니다.' });
  }
});

// POST /api/audit-logs/:id/restore - 데이터 복구
router.post('/:id/restore', auth, async (req, res) => {
  try {
    const isSuperAdmin = req.user.accountType === 'super_admin';
    const isOfficeManager = req.user.isOfficeManager && req.user.officeId;

    const auditLog = await db.get(
      `SELECT * FROM audit_logs WHERE id = ?`,
      [req.params.id]
    );

    if (!auditLog) {
      return res.status(404).json({ error: '로그를 찾을 수 없습니다.' });
    }

    // 권한 확인: 슈퍼관리자는 전체, 사무실 관리자는 사무실 범위, 일반 유저는 본인 로그만
    if (!isSuperAdmin) {
      if (isOfficeManager) {
        const logAccount = await db.get(
          `SELECT office_id FROM accounts WHERE id = ?`,
          [auditLog.account_id]
        );
        if (!logAccount || logAccount.office_id !== req.user.officeId) {
          return res.status(403).json({ error: '다른 사무실의 데이터는 복구할 수 없습니다.' });
        }
      } else {
        // 일반 유저는 본인 로그만 복구 가능
        if (auditLog.account_id !== req.user.accountId) {
          return res.status(403).json({ error: '본인의 변경 이력만 복구할 수 있습니다.' });
        }
      }
    }

    const { table_name, record_id, action } = auditLog;

    let oldData = null;
    if (auditLog.old_data) {
      try {
        oldData = JSON.parse(auditLog.old_data);
      } catch (e) { /* 파싱 실패 시 null 유지 */ }
    }

    // 복합 키 테이블 여부 확인
    const compositeConfig = COMPOSITE_KEY_TABLES[table_name];

    // CREATE 작업 복구: 생성된 레코드 삭제
    if (action === 'CREATE') {
      if (!record_id) {
        return res.status(400).json({ error: '삭제할 레코드 ID가 없습니다.' });
      }
      if (compositeConfig) {
        const parsed = compositeConfig.parse(record_id);
        await db.run(
          `DELETE FROM ${table_name} WHERE ${compositeConfig.where}`,
          compositeConfig.params(parsed)
        );
      } else {
        await db.run(
          `DELETE FROM ${table_name} WHERE id = ?`,
          [record_id]
        );
      }
    }
    // DELETE 작업 복구: 이전 데이터로 레코드 재생성
    else if (action === 'DELETE') {
      if (!oldData) {
        return res.status(400).json({ error: '복구할 이전 데이터가 없습니다.' });
      }
      const columns = Object.keys(oldData);
      const placeholders = columns.map(() => '?').join(', ');
      const values = columns.map(col => oldData[col]);

      await db.run(
        `INSERT OR REPLACE INTO ${table_name} (${columns.join(', ')}) VALUES (${placeholders})`,
        values
      );
    }
    // UPDATE 작업 복구: 이전 데이터로 레코드 덮어쓰기
    else if (action === 'UPDATE') {
      if (!oldData) {
        return res.status(400).json({ error: '복구할 이전 데이터가 없습니다.' });
      }

      if (compositeConfig) {
        // 복합 키 테이블: oldData 전체를 INSERT OR REPLACE로 복구
        const columns = Object.keys(oldData);
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(col => oldData[col]);
        await db.run(
          `INSERT OR REPLACE INTO ${table_name} (${columns.join(', ')}) VALUES (${placeholders})`,
          values
        );
      } else {
        // id 기반 테이블: UPDATE WHERE id = ?
        const columns = Object.keys(oldData).filter(col => col !== 'id');
        const setClause = columns.map(col => `${col} = ?`).join(', ');
        const values = columns.map(col => oldData[col]);
        await db.run(
          `UPDATE ${table_name} SET ${setClause} WHERE id = ?`,
          [...values, record_id]
        );
      }
    }

    // 복구 작업도 감사 로그에 기록
    await logAudit(req, {
      action: action === 'CREATE' ? 'DELETE' : 'UPDATE',
      tableName: table_name,
      recordId: record_id,
      oldData: action === 'CREATE' ? null : null,
      newData: action === 'DELETE' || action === 'UPDATE' ? oldData : null,
      description: `데이터 복구 (원본 로그 #${auditLog.id}, 원래 작업: ${action === 'CREATE' ? '생성 취소' : action === 'DELETE' ? '삭제 복구' : '수정 복구'})`
    });

    res.json({ 
      success: true, 
      message: '데이터가 성공적으로 복구되었습니다.',
      restoredAction: action,
      tableName: table_name,
      recordId: record_id
    });
  } catch (error) {
    console.error('[감사 로그] 데이터 복구 실패:', error);
    res.status(500).json({ error: '데이터 복구에 실패했습니다.' });
  }
});

module.exports = router;
