const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getKSTDateTimeString } = require('../utils/time');

// 기존 sqlite3 연결도 유지 (settlements 테이블용)
// 환경변수 DB_PATH 사용 (프로덕션: management_system_prod.db)
const dbPath = process.env.DB_PATH 
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, '..', 'database', 'management_system.db');
const dbLegacy = new sqlite3.Database(dbPath);

// settlements 테이블 완전 재생성 (관리자용)
router.post('/recreate-table', auth, async (req, res) => {
  try {
    console.log('settlements 테이블 재생성 요청');
    
    await db.recreateSettlements();
    
    res.json({ 
      success: true, 
      message: 'settlements 테이블이 재생성되었습니다. 모든 정산 데이터가 초기화되었습니다.'
    });
  } catch (error) {
    console.error('테이블 재생성 실패:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 해당 월의 실제 일수 계산 함수
function getDaysInMonth(year, month) {
  // month는 1-12 (1월부터 12월)
  return new Date(year, month, 0).getDate();
}

// 월별 데이터 초기화 확인 (빈 데이터 생성하지 않음)
router.post('/init', auth, async (req, res) => {
  try {
    const { year_month } = req.body;
    
    // year_month가 제공되지 않으면 현재 월 사용
    let targetYearMonth;
    if (year_month) {
      targetYearMonth = year_month;
    } else {
      const currentDate = new Date();
      targetYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    }
    
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    console.log(`월별 데이터 확인: ${targetYearMonth} for account ${filterAccountId}`);
    
    // 해당 월 데이터 확인 (현재 사용자의 것만)
    dbLegacy.all('SELECT COUNT(*) as count FROM settlements WHERE year_month = ? AND account_id = ?', [targetYearMonth, filterAccountId], (err, rows) => {
      if (err) {
        console.error('데이터 조회 실패:', err);
        return res.status(500).json({ error: err.message });
      }

      const count = rows[0]?.count || 0;
      console.log(`${targetYearMonth}월 데이터: ${count}개`);
      
      // 빈 데이터를 생성하지 않고, 실제 입력된 데이터만 사용
      res.json({ 
        message: `${targetYearMonth}월 정산 기록 확인 완료`, 
        count: count, 
        year_month: targetYearMonth 
      });
    });
  } catch (error) {
    console.error('정산 기록 초기화 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 월별 정산 기록 조회 (실제 저장된 데이터만 반환)
router.get('/', auth, (req, res) => {
  const { year_month } = req.query;
  
  // year_month가 제공되지 않으면 현재 월 사용
  let targetYearMonth;
  if (year_month) {
    targetYearMonth = year_month;
  } else {
    const currentDate = new Date();
    targetYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  }
  
  console.log(`정산 기록 조회 요청: ${targetYearMonth}월 for account ${req.user.accountId}`);
  
  // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
  const filterAccountId = req.user.filterAccountId || req.user.accountId;
  
  // 사무실 관리자인 경우
  if (req.user.isOfficeManager && req.user.filterOfficeId) {
    // 특정 계정 선택 시: 해당 계정의 정산 데이터만 조회
    if (filterAccountId) {
      const sql = 'SELECT * FROM settlements WHERE year_month = ? AND account_id = ? ORDER BY day_number ASC';
      
      dbLegacy.all(sql, [targetYearMonth, filterAccountId], (err, rows) => {
        if (err) {
          console.error('정산 기록 조회 실패:', err);
          return res.status(500).json({ error: err.message });
        }
        
        // user_data를 JSON으로 파싱
        const records = rows.map(row => ({
          ...row,
          user_data: typeof row.user_data === 'string' ? JSON.parse(row.user_data || '{}') : row.user_data
        }));
        
        res.json(records);
      });
      return;
    }
    
    // 계정 미선택 시: 사무실 전체 정산 데이터 조회
    const sql = `
      SELECT s.* 
      FROM settlements s
      INNER JOIN accounts a ON s.account_id = a.id
      WHERE s.year_month = ? AND a.office_id = ?
      ORDER BY s.day_number ASC
    `;
    
    dbLegacy.all(sql, [targetYearMonth, req.user.filterOfficeId], (err, rows) => {
      if (err) {
        console.error('정산 기록 조회 실패:', err);
        return res.status(500).json({ error: err.message });
      }
      
      // user_data를 JSON으로 파싱
      const records = rows.map(row => ({
        ...row,
        user_data: typeof row.user_data === 'string' ? JSON.parse(row.user_data || '{}') : row.user_data
      }));
      
      res.json(records);
    });
    return;
  }
  
  // 일반 사용자: 자신의 계정 데이터만 조회
  const sql = 'SELECT * FROM settlements WHERE year_month = ? AND account_id = ? ORDER BY day_number ASC';
  
  dbLegacy.all(sql, [targetYearMonth, filterAccountId], (err, rows) => {
    if (err) {
      console.error('정산 기록 조회 실패:', err);
      return res.status(500).json({ error: err.message });
    }
    
    // user_data를 JSON으로 파싱
    const records = rows.map(row => ({
      ...row,
      user_data: typeof row.user_data === 'string' ? JSON.parse(row.user_data || '{}') : row.user_data
    }));
    
    console.log(`${targetYearMonth}월 정산 기록 조회: ${records.length}개 (실제 저장된 데이터)`);
    res.json(records);
  });
});

// 명의 목록 조회 (현재 사용자의 명의만)
router.get('/identities', auth, async (req, res) => {
  try {
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    const identities = await db.all(
      'SELECT id, name FROM identities WHERE account_id = ? ORDER BY id',
      [filterAccountId]
    );
    
    res.json(identities);
  } catch (error) {
    console.error('명의 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 정산 기록 수정 (월별 데이터) - day_number와 year_month로 수정
router.put('/:id', auth, (req, res) => {
  const { id } = req.params;
  const {
    day_number,
    ka_amount,
    seup,
    site_content,
    user_data,
    year_month
  } = req.body;

  // year_month가 제공되지 않으면 현재 월 사용
  let targetYearMonth;
  if (year_month) {
    targetYearMonth = year_month;
  } else {
    const currentDate = new Date();
    targetYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  }

  console.log(`정산 기록 수정 요청: ID=${id}, 월=${targetYearMonth}, 일=${day_number}`);

  // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
  const filterAccountId = req.user.filterAccountId || req.user.accountId;

  // 더 안전한 방법: day_number, year_month, account_id 조합으로 수정
  const sql = `
    UPDATE settlements SET
      ka_amount = ?,
      seup = ?,
      site_content = ?,
      user_data = ?,
      updated_at = ?
    WHERE year_month = ? AND day_number = ? AND account_id = ?
  `;

  const userDataStr = typeof user_data === 'object' ? JSON.stringify(user_data) : user_data;

  const timestamp = getKSTDateTimeString();
  const params = [
    ka_amount || 0,
    seup || 'X',
    site_content || '',
    userDataStr || '{}',
    timestamp,
    targetYearMonth,
    day_number,
    filterAccountId
  ];

  dbLegacy.run(sql, params, function(err) {
    if (err) {
      console.error('정산 기록 수정 실패:', err);
      return res.status(500).json({ error: err.message });
    }
    
    // UPDATE된 행이 없으면 INSERT 시도 (데이터가 없을 때)
    if (this.changes === 0) {
      console.log(`정산 기록이 없어서 새로 생성합니다: 월=${targetYearMonth}, 일=${day_number}`);
      const insertSql = `
        INSERT INTO settlements (year_month, day_number, ka_amount, seup, site_content, user_data, account_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      dbLegacy.run(insertSql, [
        targetYearMonth,
        day_number,
        ka_amount || 0,
        seup || 'X',
        site_content || '',
        userDataStr || '{}',
        filterAccountId,
        timestamp,
        timestamp
      ], function(insertErr) {
        if (insertErr) {
          console.error('정산 기록 생성 실패:', insertErr);
          return res.status(500).json({ error: insertErr.message });
        }
        
        console.log(`정산 기록 생성 완료: ID=${this.lastID}, 월=${targetYearMonth}, 일=${day_number}`);
        res.json({
          message: '정산 기록이 생성되었습니다.',
          id: this.lastID,
          year_month: targetYearMonth,
          day_number: day_number
        });
      });
      return;
    }
    
    // 기존 레코드가 있었던 경우
    console.log(`정산 기록 수정 성공: 월=${targetYearMonth}, 일=${day_number}, 변경된 행=${this.changes}`);
    res.json({
      changes: this.changes,
      message: `${targetYearMonth}월 ${day_number}일 정산 기록이 수정되었습니다.`
    });
  });
});

// 특정 일자 정산 기록 수정 (현재 월 데이터만)
router.put('/day/:dayNumber', auth, (req, res) => {
  const { dayNumber } = req.params;
  const { ka_amount, seup, site_content, user_data } = req.body;

  // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
  const filterAccountId = req.user.filterAccountId || req.user.accountId;

  const currentDate = new Date();
  const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

  console.log(`특정 일자 정산 기록 수정 요청: 월=${currentYearMonth}, 일=${dayNumber}`);

  const sql = `
    UPDATE settlements SET
      ka_amount = ?,
      seup = ?,
      site_content = ?,
      user_data = ?,
      updated_at = ?
    WHERE year_month = ? AND day_number = ? AND account_id = ?
  `;

  const userDataStr = typeof user_data === 'object' ? JSON.stringify(user_data) : user_data;

  const timestamp = getKSTDateTimeString();

  const params = [
    ka_amount || 0,
    seup || 'X',
    site_content || '',
    userDataStr || '{}',
    timestamp,
    currentYearMonth,
    dayNumber,
    filterAccountId
  ];

  dbLegacy.run(sql, params, function(err) {
    if (err) {
      console.error('정산 기록 수정 실패:', err);
      return res.status(500).json({ error: err.message });
    }
    
    if (this.changes === 0) {
      console.warn(`특정 일자 정산 기록 수정 실패: 월=${currentYearMonth}, 일=${dayNumber}에서 레코드를 찾을 수 없음`);
      return res.status(404).json({ error: `${currentYearMonth}월 ${dayNumber}일 정산 기록을 찾을 수 없습니다.` });
    }
    
    console.log(`특정 일자 정산 기록 수정 성공: 월=${currentYearMonth}, 일=${dayNumber}, 변경된 행=${this.changes}`);
    res.json({
      changes: this.changes,
      message: `${currentYearMonth}월 ${dayNumber}일 정산 기록이 수정되었습니다.`
    });
  });
});

module.exports = router;
