const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getKSTDateTimeString } = require('../utils/time');
const { logAudit } = require('../utils/auditLog');
const { emitDataChange } = require('../socket');

// 디버그 모드 (프로덕션에서는 false)
const DEBUG = process.env.NODE_ENV !== 'production';
const log = (...args) => DEBUG && console.log(...args);

// 기존 sqlite3 연결도 유지 (finish 테이블용)
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'management_system.db');
const dbLegacy = new sqlite3.Database(dbPath);

// 한국 시간 기준 날짜 문자열 반환 (YYYY-MM-DD)
function getKSTDateString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MODE_TABLES = {
  finish: {
    data: 'finish_data',
    summary: 'finish_summary'
  },
  start: {
    data: 'start_data',
    summary: 'start_summary'
  }
};

const getMode = (req) => ((req.query.mode || req.body?.mode) === 'start' ? 'start' : 'finish');
const getTables = (mode) => MODE_TABLES[mode] || MODE_TABLES.finish;

const { parseNotesForFinish } = require('../utils/notesParser');

/** 사무실 관리자(계정 미선택) 또는 슈퍼관리자가 사무실 관리자 계정을 선택한 경우 — identities API와 동일하게 사무실 단위 */
function usesOfficeWideFinishScope(req) {
  if (req.user.isOfficeManager && req.user.filterOfficeId && req.user.filterAccountId == null) {
    return true;
  }
  if (req.user.isSuperAdmin && req.user.filterOfficeId && req.user.filterAccountId == null && req.user.selectedAccountId) {
    return true;
  }
  return false;
}

/**
 * 시작/마무리 명의별 금액 저장 시 사용할 account_id (명의가 실제 속한 계정)
 */
async function resolveFinishIdentityAccountId(req, identityName) {
  if (usesOfficeWideFinishScope(req)) {
    const row = await db.get(
      `SELECT i.account_id FROM identities i
       INNER JOIN accounts a ON i.account_id = a.id
       WHERE i.name = ? AND a.office_id = ? AND a.status = 'active'
       ORDER BY i.id ASC LIMIT 1`,
      [identityName, req.user.filterOfficeId]
    );
    return row?.account_id ?? null;
  }
  const selectedAcc = req.user.filterAccountId;
  if (req.user.isSuperAdmin) {
    if (selectedAcc != null) {
      const row = await db.get(
        'SELECT account_id FROM identities WHERE name = ? AND account_id = ?',
        [identityName, selectedAcc]
      );
      return row?.account_id ?? null;
    }
    const row = await db.get(
      'SELECT account_id FROM identities WHERE name = ? ORDER BY id ASC LIMIT 1',
      [identityName]
    );
    return row?.account_id ?? null;
  }
  const acc = selectedAcc != null ? selectedAcc : req.user.accountId;
  const row = await db.get(
    'SELECT account_id FROM identities WHERE name = ? AND account_id = ?',
    [identityName, acc]
  );
  return row?.account_id ?? null;
}

/** GET /finish 용: 조회할 계정 ID 목록 + 명의 이름 목록 */
async function getFinishQueryScope(req) {
  if (usesOfficeWideFinishScope(req)) {
    const accounts = await db.all(
      `SELECT id FROM accounts WHERE office_id = ? AND status = 'active' ORDER BY id`,
      [req.user.filterOfficeId]
    );
    const accountIds = accounts.map((a) => a.id);
    const nameRows = await db.all(
      `SELECT DISTINCT i.name FROM identities i
       INNER JOIN accounts a ON i.account_id = a.id
       WHERE a.office_id = ? AND a.status = 'active'`,
      [req.user.filterOfficeId]
    );
    const identityNames = nameRows.map((r) => r.name).filter(Boolean);
    return { accountIds, identityNames };
  }
  const filterAccountId = req.user.filterAccountId != null ? req.user.filterAccountId : req.user.accountId;
  const identities = await db.all('SELECT name FROM identities WHERE account_id = ?', [filterAccountId]);
  const identityNames = identities.map((i) => i.name);
  return { accountIds: [filterAccountId], identityNames };
}

// 마무리 데이터 조회 (날짜별, 현재 사용자의 명의만)
router.get('/', auth, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || getKSTDateString();
    const mode = getMode(req);
    const { data: dataTable, summary: summaryTable } = getTables(mode);
    
    const { accountIds, identityNames } = await getFinishQueryScope(req);
    if (!accountIds.length) {
      return res.json([]);
    }
    const accountPlaceholders = accountIds.map(() => '?').join(',');
    
    if (mode === 'start') {
      // 시작 모드에서는 start_data 테이블에서 명의별 데이터 가져오기
      const allIdentityNames = ['받치기', ...identityNames];
      const namePlaceholders = allIdentityNames.map(() => '?').join(',');
      
      const sql = `SELECT * FROM ${dataTable} WHERE date = ? AND account_id IN (${accountPlaceholders}) AND identity_name IN (${namePlaceholders}) ORDER BY identity_name, account_id`;
      
      dbLegacy.all(sql, [targetDate, ...accountIds, ...allIdentityNames], (err, rows) => {
        if (err) {
          console.error('시작 데이터 조회 실패:', err);
          return res.status(500).json({ error: err.message });
        }
        log(`📥 [시작 모드] 조회된 데이터 수:`, rows?.length || 0, rows);
        
        // 드뱃 데이터에서 특이사항 파싱 (현재 사용자의 데이터만)
        const drbetPlaceholders = identityNames.map(() => '?').join(',');
        const drbetSql = `
          SELECT notes FROM drbet_records 
          WHERE record_date = ? 
          AND account_id IN (${accountPlaceholders})
          AND (identity1 IN (${drbetPlaceholders}) 
            OR identity2 IN (${drbetPlaceholders}) 
            OR identity3 IN (${drbetPlaceholders}) 
            OR identity4 IN (${drbetPlaceholders}))
        `;
        
        dbLegacy.all(drbetSql, [targetDate, ...accountIds, ...identityNames, ...identityNames, ...identityNames, ...identityNames], (err, drbetRows) => {
          if (err) {
            console.error('드뱃 데이터 조회 실패:', err);
            // 에러가 나도 start_data는 반환
            return res.json(rows || []);
          }
          
          // 각 start_data 행에 site/content 정보 추가
          for (const startRow of rows) {
            const notesList = [];
            
            // 드뱃 데이터에서 특이사항 추출
            for (const drbetRow of drbetRows) {
              const parsedNotes = parseNotesForFinish(drbetRow.notes);
              notesList.push(...parsedNotes);
            }
            
            // JSON 문자열로 저장
            startRow.site_content = notesList.length > 0 ? JSON.stringify(notesList) : '';
          }
          
          res.json(rows || []);
        });
      });
      return;
    }
    // "받치기"도 포함
    const allIdentityNames = ['받치기', ...identityNames];
    const namePlaceholders = allIdentityNames.map(() => '?').join(',');
    
    const sql = `SELECT * FROM ${dataTable} WHERE date = ? AND account_id IN (${accountPlaceholders}) AND identity_name IN (${namePlaceholders}) ORDER BY identity_name, account_id`;
    log(`📥 [마무리 모드] 데이터 조회 SQL:`, { sql, targetDate, accountIds, allIdentityNames });
    
    // 디버깅: 테이블에 어떤 account_id가 있는지 확인
    dbLegacy.all(`SELECT DISTINCT account_id, date, identity_name FROM ${dataTable} WHERE date = ? LIMIT 10`, [targetDate], (debugErr, debugRows) => {
      if (!debugErr && debugRows) {
        log(`📥 [마무리 모드] 테이블에 존재하는 데이터:`, debugRows);
      }
    });
    
    dbLegacy.all(sql, [targetDate, ...accountIds, ...allIdentityNames], (err, rows) => {
      if (err) {
        console.error('마무리 데이터 조회 실패:', err);
        return res.status(500).json({ error: err.message });
      }
      log(`📥 [마무리 모드] 조회된 데이터 수:`, rows?.length || 0, rows);
      
      // 드뱃 데이터에서 특이사항 파싱 (현재 사용자의 데이터만)
      const drbetPlaceholders = identityNames.map(() => '?').join(',');
      const drbetSql = `
        SELECT notes FROM drbet_records 
        WHERE record_date = ? 
        AND account_id IN (${accountPlaceholders})
        AND (identity1 IN (${drbetPlaceholders}) 
          OR identity2 IN (${drbetPlaceholders}) 
          OR identity3 IN (${drbetPlaceholders}) 
          OR identity4 IN (${drbetPlaceholders}))
      `;
      
      dbLegacy.all(drbetSql, [targetDate, ...accountIds, ...identityNames, ...identityNames, ...identityNames, ...identityNames], (err, drbetRows) => {
        if (err) {
          console.error('드뱃 데이터 조회 실패:', err);
          // 에러가 나도 데이터는 반환
          return res.json(rows);
        }
        
        // 각 행에 site/content 정보 추가
        for (const finishRow of rows) {
          const notesList = [];
          
          // 드뱃 데이터에서 특이사항 추출
          for (const drbetRow of drbetRows) {
            const parsedNotes = parseNotesForFinish(drbetRow.notes);
            notesList.push(...parsedNotes);
          }
          
          // JSON 문자열로 저장
          finishRow.site_content = notesList.length > 0 ? JSON.stringify(notesList) : '';
        }
        
        res.json(rows);
      });
    });
  } catch (error) {
    console.error('마무리 데이터 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 마무리 요약 정보 조회 (현재 사용자의 데이터만)
router.get('/summary', auth, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || getKSTDateString();
    const mode = getMode(req);
    const { data: dataTable, summary: summaryTable } = getTables(mode);
    const startSummaryTable = MODE_TABLES.start.summary;
    
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    // 현재 사용자의 명의 이름 목록 가져오기
    const identities = await db.all(
      'SELECT name FROM identities WHERE account_id = ?',
      [filterAccountId]
    );
    
    if (identities.length === 0) {
      return res.json({
        date: targetDate,
        cash_on_hand: 0,
        yesterday_balance: 0,
        coin_wallet: 0,
        start_amount_total: 0
      });
    }
    
    const identityNames = identities.map(i => i.name);
    
    const sql = `SELECT * FROM ${summaryTable} WHERE date = ? AND account_id = ?`;
    log(`📥 [${mode} 모드] SQL 조회:`, { sql, targetDate, filterAccountId, summaryTable });
    
    // 디버깅: 테이블에 어떤 account_id가 있는지 확인
    dbLegacy.all(`SELECT DISTINCT account_id, date FROM ${summaryTable} WHERE date = ? LIMIT 10`, [targetDate], (debugErr, debugRows) => {
      if (!debugErr && debugRows) {
        log(`📥 [${mode} 모드] 테이블에 존재하는 account_id 목록:`, debugRows);
      }
    });
    
    const getStartAmountValue = () => new Promise((resolve) => {
      dbLegacy.get(
        `SELECT start_amount_total FROM ${startSummaryTable} WHERE date = ? AND account_id = ?`,
        [targetDate, filterAccountId],
        (err, startRow) => {
          if (err) {
            console.error('시작 요약 조회 실패:', err);
            return resolve(0);
          }
          if (startRow && startRow.start_amount_total !== undefined && startRow.start_amount_total !== null) {
            return resolve(startRow.start_amount_total);
          }
          resolve(0);
        }
      );
    });

    const getCashOnHandFromAccount = async () => {
      try {
        const row = await db.get(
          'SELECT cash_on_hand FROM accounts WHERE id = ?',
          [filterAccountId]
        );
        return typeof row?.cash_on_hand === 'number' ? row.cash_on_hand : 0;
      } catch (err) {
        console.error('계정 시제 조회 실패:', err);
        return 0;
      }
    };
    
    const respondWithStartAmount = async (payload) => {
      try {
        const [startAmountValue, accountCash] = await Promise.all([
          getStartAmountValue(),
          getCashOnHandFromAccount()
        ]);
        payload.start_amount_total = startAmountValue;
        // 항상 accounts 테이블의 cash_on_hand 값을 사용
        payload.cash_on_hand = accountCash;
        res.json(payload);
      } catch (error) {
        console.error('요약 응답 구성 실패:', error);
        res.status(500).json({ error: '요약 데이터를 불러오지 못했습니다.' });
      }
    };

    dbLegacy.get(sql, [targetDate, filterAccountId], async (err, row) => {
      if (err) {
        console.error(`❌ [${mode} 모드] 요약 조회 실패:`, err);
        return res.status(500).json({ error: err.message });
      }
      
      log(`📥 [${mode} 모드] SQL 조회 결과:`, { 
        hasRow: !!row, 
        rowKeys: row ? Object.keys(row) : null,
        row: row,
        manual_withdrawals: row?.manual_withdrawals,
        manual_withdrawals_type: typeof row?.manual_withdrawals,
        coin_wallet: row?.coin_wallet,
        yesterday_balance: row?.yesterday_balance
      });
      
      // 시작 모드일 때는 마무리 모드와 동일하게 처리
      if (mode === 'start') {
        log('📥 [시작 모드] 요약 데이터 조회:', { targetDate, filterAccountId, hasRow: !!row });
        if (!row) {
          log('📥 [시작 모드] row 없음, 기본값 반환');
          return respondWithStartAmount({
            date: targetDate,
            yesterday_balance: 0,
            coin_wallet: 0,
            manual_withdrawals: null,
            start_amount_total: 0
          });
        }
        log('📥 [시작 모드] row 있음:', { 
          manual_withdrawals: row.manual_withdrawals,
          manual_withdrawals_type: typeof row.manual_withdrawals,
          manual_withdrawals_length: row.manual_withdrawals?.length,
          start_amount_total: row.start_amount_total 
        });
        // 마무리 모드와 동일하게 처리
        return respondWithStartAmount({
          ...row,
          yesterday_balance: 0,
          manual_withdrawals: row.manual_withdrawals || null,
          start_amount_total: row.start_amount_total !== undefined && row.start_amount_total !== null
            ? row.start_amount_total
            : 0
        });
      }
      
      // 마무리 모드: finish_summary 데이터 반환 (start_summary에서 start_amount_total 가져오기)
      // cash_on_hand는 항상 accounts 테이블에서 가져오므로 respondWithStartAmount에서 처리
      if (!row) {
        return respondWithStartAmount({
          date: targetDate,
          yesterday_balance: 0,
          coin_wallet: 0,
          manual_withdrawals: null,
          start_amount_total: null
        });
      }
      
      respondWithStartAmount({
        ...row,
        yesterday_balance: 0,
        manual_withdrawals: row.manual_withdrawals || null,
        start_amount_total: row.start_amount_total !== undefined && row.start_amount_total !== null
          ? row.start_amount_total
          : null
      });
    });
  } catch (error) {
    console.error('마무리 요약 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 마무리 요약 정보 수정
router.put('/summary', auth, async (req, res) => {
  const mode = getMode(req);
  const { summary: summaryTable } = getTables(mode);
  log(`📥 PUT /finish/summary 요청 수신 [mode=${mode}]:`, {
    date: req.body.date,
    cash_on_hand: req.body.cash_on_hand,
    yesterday_balance: req.body.yesterday_balance,
    coin_wallet: req.body.coin_wallet,
    manual_withdrawals: req.body.manual_withdrawals ? '있음' : '없음',
    start_amount_total: req.body.start_amount_total
  });
  
  const { date, cash_on_hand, yesterday_balance, coin_wallet, manual_withdrawals, start_amount_total } = req.body;
  log('📦 요청 payload:', req.body);
  const targetDate = date || getKSTDateString();
  
  // 사용자의 account_id 가져오기
  const filterAccountId = req.user.filterAccountId || req.user.accountId;
  
  log('🔍 컬럼 존재 여부 확인 시작...');
  
  // 컬럼 존재 여부 확인 후 SQL 결정
  dbLegacy.all(`PRAGMA table_info(${summaryTable})`, (infoErr, rows) => {
    if (infoErr) {
      console.error('❌ PRAGMA table_info 오류:', infoErr);
      return res.status(500).json({ error: infoErr.message });
    }
    
    log('✅ PRAGMA 결과:', rows);
    
    const rowArray = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    const columns = rowArray.map(r => (r ? r.name : null)).filter(Boolean);
    const hasManualWithdrawals = columns.includes('manual_withdrawals');
    const hasStartAmount = columns.includes('start_amount_total');
    
    const ensureStartColumn = () => {
      if (hasStartAmount) {
        log('✅ start_amount_total 컬럼 이미 존재');
        return executeUpdate();
      }
      log('➕ start_amount_total 컬럼 추가 중...');
      dbLegacy.run(`ALTER TABLE ${summaryTable} ADD COLUMN start_amount_total REAL DEFAULT 0`, (alterErr) => {
        if (alterErr && !alterErr.message.includes('duplicate column')) {
          console.error('❌ start_amount_total 컬럼 추가 실패:', alterErr);
          return res.status(500).json({ error: '컬럼 추가 실패: ' + alterErr.message });
        }
        log('✅ start_amount_total 컬럼 추가 완료');
        executeUpdate();
      });
    };
    
    if (!hasManualWithdrawals) {
      log('➕ manual_withdrawals 컬럼 추가 중...');
      dbLegacy.run(`ALTER TABLE ${summaryTable} ADD COLUMN manual_withdrawals TEXT`, (alterErr) => {
        if (alterErr && !alterErr.message.includes('duplicate column')) {
          console.error('❌ 컬럼 추가 실패:', alterErr);
          return res.status(500).json({ error: '컬럼 추가 실패: ' + alterErr.message });
        }
        log('✅ manual_withdrawals 컬럼 추가 완료');
        ensureStartColumn();
      });
    } else {
      ensureStartColumn();
    }
    
    function executeUpdate() {
      log('💾 SQL 실행 시작...');
      
      const normalizeNumber = (value) => {
        if (typeof value === 'number' && !Number.isNaN(value)) return value;
        const parsed = parseFloat(value);
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      const normalizedCash = normalizeNumber(cash_on_hand);
      const normalizedYesterday = normalizeNumber(yesterday_balance);
      // coin_wallet이 null이면 COALESCE로 기존 값 유지해야 하므로 null 유지
      const normalizedCoinWallet = (coin_wallet === null || coin_wallet === undefined) ? null : normalizeNumber(coin_wallet);

      const nowKST = getKSTDateTimeString();
      
      // cash_on_hand는 accounts 테이블에만 저장 (summary 테이블에는 저장하지 않음)
      // 컬럼 존재 여부 확인 후 SQL 결정
      dbLegacy.all(`PRAGMA table_info(${summaryTable})`, async (summaryInfoErr, summaryInfoRows) => {
        if (summaryInfoErr) {
          console.error('❌ PRAGMA table_info 오류:', summaryInfoErr);
          return res.status(500).json({ error: summaryInfoErr.message });
        }
        
        const summaryInfoArray = Array.isArray(summaryInfoRows) ? summaryInfoRows : (summaryInfoRows ? [summaryInfoRows] : []);
        const summaryColumns = summaryInfoArray.map(r => (r ? r.name : null)).filter(Boolean);
        const hasCashOnHandInSummary = summaryColumns.includes('cash_on_hand');
        
        // summary 테이블에 cash_on_hand 컬럼이 있으면 제외하고 저장
        const summaryFields = ['date', 'account_id', 'yesterday_balance', 'coin_wallet', 'manual_withdrawals', 'start_amount_total', 'updated_at'];
        const summaryValues = [targetDate, filterAccountId, normalizedYesterday, normalizedCoinWallet, manual_withdrawals || null, (start_amount_total === null || start_amount_total === undefined) ? null : start_amount_total, nowKST];
        
        // COALESCE를 사용하여 null로 전달된 필드는 기존 값을 유지
        // - manual_withdrawals: 수동 취침 저장 시에만 명시적 값 전달, 다른 저장에서는 null → 기존 값 유지
        // - coin_wallet: 코인지갑 저장 시에만 명시적 값 전달, 다른 저장에서는 null → 기존 값 유지
        // 이렇게 하면 동시 저장 시 레이스 컨디션으로 인한 데이터 덮어쓰기 방지
        const sql = `
            INSERT INTO ${summaryTable} (date, account_id, yesterday_balance, coin_wallet, manual_withdrawals, start_amount_total, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, account_id) DO UPDATE SET
              yesterday_balance = excluded.yesterday_balance,
              coin_wallet = COALESCE(excluded.coin_wallet, ${summaryTable}.coin_wallet),
              manual_withdrawals = COALESCE(excluded.manual_withdrawals, ${summaryTable}.manual_withdrawals),
              start_amount_total = COALESCE(excluded.start_amount_total, ${summaryTable}.start_amount_total),
              updated_at = excluded.updated_at
          `;
        
        log('📝 SQL 파라미터:', summaryValues);
        log('💰 시제 업데이트 예정:', { normalizedCash, filterAccountId });
        
        // accounts 테이블의 cash_on_hand 업데이트
        const updateAccountCash = async () => {
          try {
            log('🔄 accounts 테이블 cash_on_hand 업데이트 시작...');
            const result = await db.run(
              'UPDATE accounts SET cash_on_hand = ? WHERE id = ?',
              [normalizedCash, filterAccountId]
            );
            log('✅ accounts 테이블 cash_on_hand 업데이트 완료:', { normalizedCash, filterAccountId, changes: result.changes });
          } catch (err) {
            console.error('❌ 계정 시제 업데이트 실패:', err);
            throw err;
          }
        };
        
        // 기존 데이터 조회 (변경 비교용)
        dbLegacy.get(
          `SELECT * FROM ${summaryTable} WHERE date = ? AND account_id = ?`,
          [targetDate, filterAccountId],
          (getErr, oldRecord) => {
            dbLegacy.run(sql, summaryValues, async function(runErr) {
              if (runErr) {
                console.error('❌ SQL 실행 오류:', runErr);
                return res.status(500).json({ error: runErr.message });
              }
              
              log('✅ SQL 실행 성공, lastID:', this.lastID);
              log(`💾 [${mode} 모드] 저장된 manual_withdrawals:`, manual_withdrawals);
              log(`💾 [${mode} 모드] 저장된 테이블:`, summaryTable);
              
              try {
                await updateAccountCash();
              } catch (accountErr) {
                console.warn('계정 시제 업데이트 경고:', accountErr.message);
              }
              
              const responseData = {
                message: '요약이 수정되었습니다.',
                date: targetDate,
                cash_on_hand: normalizedCash,
                yesterday_balance: normalizedYesterday,
                coin_wallet: normalizedCoinWallet,
                manual_withdrawals: manual_withdrawals || null,
                start_amount_total: start_amount_total !== undefined && start_amount_total !== null ? start_amount_total : 0
              };

              // 실제 변경이 있을 때만 감사 로그 기록
              // null로 전송된 필드(COALESCE로 기존값 유지)는 비교에서 제외
              const hasRealChange = !oldRecord || 
                (cash_on_hand !== undefined && cash_on_hand !== null && Number(oldRecord.cash_on_hand || 0) !== normalizedCash) ||
                (yesterday_balance !== undefined && yesterday_balance !== null && Number(oldRecord.yesterday_balance || 0) !== normalizedYesterday) ||
                (coin_wallet !== undefined && coin_wallet !== null && Number(oldRecord.coin_wallet || 0) !== normalizedCoinWallet) ||
                (manual_withdrawals !== undefined && manual_withdrawals !== null && oldRecord.manual_withdrawals !== manual_withdrawals) ||
                (start_amount_total !== undefined && start_amount_total !== null && Number(oldRecord.start_amount_total || 0) !== Number(start_amount_total));

              if (hasRealChange) {
                // 변경된 필드만 설명에 포함
                const changedFields = [];
                if (cash_on_hand !== undefined && cash_on_hand !== null && (!oldRecord || Number(oldRecord.cash_on_hand || 0) !== normalizedCash)) changedFields.push('시제');
                if (yesterday_balance !== undefined && yesterday_balance !== null && (!oldRecord || Number(oldRecord.yesterday_balance || 0) !== normalizedYesterday)) changedFields.push('전잔');
                if (coin_wallet !== undefined && coin_wallet !== null && (!oldRecord || Number(oldRecord.coin_wallet || 0) !== normalizedCoinWallet)) changedFields.push('코인');
                if (manual_withdrawals !== undefined && manual_withdrawals !== null && (!oldRecord || oldRecord.manual_withdrawals !== manual_withdrawals)) changedFields.push('수동환전');
                if (start_amount_total !== undefined && start_amount_total !== null && (!oldRecord || Number(oldRecord.start_amount_total || 0) !== Number(start_amount_total))) changedFields.push('시작금액');

                logAudit(req, {
                  action: oldRecord ? 'UPDATE' : 'CREATE',
                  tableName: summaryTable,
                  recordId: `${targetDate}-${filterAccountId}`,
                  oldData: oldRecord || null,
                  newData: responseData,
                  description: `${mode === 'start' ? '시작' : '마무리'} 요약 수정 (${targetDate}, ${changedFields.join('/')})`
                });
              }

              log(`📤 [${mode} 모드] 응답 전송:`, responseData);
              res.json(responseData);

              // 실시간 동기화 (같은 계정을 보고 있는 사용자에게만 알림)
              emitDataChange('finish:changed', {
                action: 'update',
                date: targetDate,
                mode,
                accountId: filterAccountId,
                user: req.user.displayName || req.user.username
              }, { room: `account:${filterAccountId}`, excludeSocket: req.socketId });
            });
          }
        );
      });
    }
  });
});

// 명의별 잔액 수정 (날짜별)
router.put('/:identityName', auth, async (req, res) => {
  try {
    const { identityName } = req.params;
    const { remaining_amount, date } = req.body;
    const targetDate = date || getKSTDateString();
    const mode = getMode(req);
    const { data: dataTable } = getTables(mode);
    
    // "받치기"는 특별 케이스로 처리 (identities 테이블 확인 없이 바로 저장)
    if (identityName === '받치기') {
        const batchiAccountId = usesOfficeWideFinishScope(req)
          ? req.user.accountId
          : (req.user.filterAccountId != null ? req.user.filterAccountId : req.user.accountId);
        const timestamp = getKSTDateTimeString();
        const sql = `
          INSERT INTO ${dataTable} (date, identity_name, account_id, remaining_amount, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(date, identity_name, account_id) DO UPDATE SET
            remaining_amount = excluded.remaining_amount,
            updated_at = excluded.updated_at
        `;
      
      dbLegacy.run(sql, [targetDate, identityName, batchiAccountId, remaining_amount, timestamp], function(err) {
        if (err) {
          console.error('받치기 잔액 수정 실패:', err);
          return res.status(500).json({ error: err.message });
        }
        
        res.json({
          message: '받치기 잔액이 수정되었습니다.',
          identity_name: identityName,
          date: targetDate
        });

        // 실시간 동기화 (같은 계정을 보고 있는 사용자에게만 알림)
        emitDataChange('finish:changed', {
          action: 'update',
          date: targetDate,
          mode: mode,
          accountId: batchiAccountId,
          user: req.user.displayName || req.user.username
        }, { room: `account:${batchiAccountId}`, excludeSocket: req.socketId });
      });
      return;
    }
    
    const dataAccountId = await resolveFinishIdentityAccountId(req, identityName);
    if (!dataAccountId) {
      return res.status(403).json({ error: '권한이 없습니다' });
    }
    
    const timestamp = getKSTDateTimeString();
    const sql = `
      INSERT INTO ${dataTable} (date, identity_name, account_id, remaining_amount, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(date, identity_name, account_id) DO UPDATE SET
        remaining_amount = excluded.remaining_amount,
        updated_at = excluded.updated_at
    `;
    
    // 기존 데이터 조회 (변경 비교용)
    dbLegacy.get(
      `SELECT * FROM ${dataTable} WHERE date = ? AND identity_name = ? AND account_id = ?`,
      [targetDate, identityName, dataAccountId],
      (getErr, oldRecord) => {
        dbLegacy.run(sql, [targetDate, identityName, dataAccountId, remaining_amount, timestamp], function(err) {
          if (err) {
            console.error('명의 잔액 수정 실패:', err);
            return res.status(500).json({ error: err.message });
          }

          // 실제 변경이 있을 때만 감사 로그
          const oldAmount = oldRecord ? Number(oldRecord.remaining_amount || 0) : null;
          if (oldAmount === null || oldAmount !== Number(remaining_amount)) {
            logAudit(req, {
              action: oldRecord ? 'UPDATE' : 'CREATE',
              tableName: dataTable,
              recordId: `${targetDate}-${identityName}-${dataAccountId}`,
              oldData: oldRecord || null,
              newData: { date: targetDate, identity_name: identityName, remaining_amount },
              description: `명의 잔액 수정 (${identityName}, ${targetDate})`
            });
          }

          res.json({
            message: '명의 잔액이 수정되었습니다.',
            identity_name: identityName,
            date: targetDate
          });

          // 실시간 동기화 (같은 계정을 보고 있는 사용자에게만 알림)
          emitDataChange('finish:changed', {
            action: 'update',
            date: targetDate,
            mode: mode,
            accountId: dataAccountId,
            user: req.user.displayName || req.user.username
          }, { room: `account:${dataAccountId}`, excludeSocket: req.socketId });
        });
      }
    );
  } catch (error) {
    console.error('명의 잔액 수정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 초기 데이터 생성 (날짜별, 현재 사용자의 명의만)
router.post('/init', auth, async (req, res) => {
  try {
    const { date } = req.body;
    const targetDate = date || getKSTDateString();
    const mode = getMode(req);
    const { data: dataTable } = getTables(mode);
    
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    // 현재 사용자의 명의 목록 가져오기
    const identities = await db.all(
      'SELECT id, name FROM identities WHERE account_id = ? ORDER BY id',
      [filterAccountId]
    );
    
    if (identities.length === 0) {
      return res.json({ message: '명의가 없습니다.', date: targetDate });
    }
    
    // 각 명의별 기본 데이터 생성 (날짜별)
    const promises = identities.map(identity => {
      return new Promise((resolve, reject) => {
        const sql = `
          INSERT OR IGNORE INTO ${dataTable} (date, identity_name, account_id, remaining_amount)
          VALUES (?, ?, ?, 0)
        `;
        dbLegacy.run(sql, [targetDate, identity.name, filterAccountId], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    });
    
    // "받치기"도 초기화
    promises.push(
      new Promise((resolve, reject) => {
        const sql = `
          INSERT OR IGNORE INTO ${dataTable} (date, identity_name, account_id, remaining_amount)
          VALUES (?, ?, ?, 0)
        `;
        dbLegacy.run(sql, [targetDate, '받치기', filterAccountId], function(err) {
          if (err) reject(err);
          else resolve();
        });
      })
    );
    
    await Promise.all(promises);
    res.json({ message: '마무리 데이터가 초기화되었습니다.', date: targetDate });
  } catch (error) {
    console.error('초기화 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

