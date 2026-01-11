const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { auth } = require('../middleware/auth');
const { getDailySummary, invalidateSummaryForDate } = require('../services/drbetSummary');
const { getAccountOfficeId, getSiteNoteData } = require('../services/siteNotesService');
const { getKSTDateTimeString } = require('../utils/time');
// attendanceLog 함수들은 autoAttendance.js에서 사용
const { handleNewRecord, handleUpdateRecord, handleDeleteRecord } = require('../services/autoAttendance');

// 🎯 자동 출석 처리는 autoAttendance.js 모듈에서 담당합니다.

// 일자별 요약 조회
router.get('/summary/:date', auth, async (req, res) => {
  try {
    const { date } = req.params;
    const accountId = req.user.filterAccountId || req.user.accountId;
    
    if (!accountId) {
      return res.status(403).json({ success: false, message: '계정을 선택해주세요.' });
    }
    // ✅ 저장 시와 동일한 officeId 계산 로직 사용
    const officeId =
      req.user.filterAccountId && req.user.filterAccountId !== req.user.accountId
        ? (await db.get('SELECT office_id FROM accounts WHERE id = ?', [req.user.filterAccountId]))?.office_id ?? null
        : await getAccountOfficeId(accountId);
    
    const summary = await getDailySummary({ accountId, officeId, date });
    
    res.json({ success: true, ...summary });
  } catch (error) {
    console.error('DR벳 요약 조회 실패:', error);
    res.status(500).json({ success: false, message: 'DR벳 요약 조회 실패' });
  }
});

// 현재 로그인한 사용자의 DR벳 기록만 조회
router.get('/', auth, async (req, res) => {
  try {
    // 사무실 관리자인 경우: 자신의 사무실에 속한 모든 계정의 DR벳 기록 조회
    // filterAccountId가 null이면 사무실 전체, 있으면 특정 계정만
    if (req.user.isOfficeManager && req.user.filterOfficeId) {
      let records;
      if (req.user.filterAccountId) {
        // 특정 계정 선택 시
        records = await db.all(
          `SELECT dr.* 
           FROM drbet_records dr
           INNER JOIN accounts a ON dr.account_id = a.id
           WHERE a.office_id = ? AND dr.account_id = ?
           ORDER BY dr.record_date DESC, dr.display_order ASC`,
          [req.user.filterOfficeId, req.user.filterAccountId]
        );
      } else {
        // 계정 미선택 시 사무실 전체
        records = await db.all(
          `SELECT dr.* 
           FROM drbet_records dr
           INNER JOIN accounts a ON dr.account_id = a.id
           WHERE a.office_id = ?
           ORDER BY dr.record_date DESC, dr.display_order ASC`,
          [req.user.filterOfficeId]
        );
      }
      return res.json(records);
    }
    
    // filterAccountId가 null인 경우
    if (!req.user.filterAccountId) {
      return res.status(403).json({ message: '계정을 선택해주세요.' });
    }
    
    // 일반 사용자: 자신의 계정으로 필터링
    const records = await db.all(
      `SELECT * FROM drbet_records 
       WHERE account_id = ?
       ORDER BY record_date DESC, display_order ASC`,
      [req.user.filterAccountId]
    );
    res.json(records);
  } catch (error) {
    console.error('DR벳 기록 조회 실패:', error);
    res.status(500).json({ message: 'DR벳 기록 조회 실패' });
  }
});

// 순서 업데이트
router.put('/reorder', auth, async (req, res) => {
  try {
    const { records } = req.body; // [{ id, display_order }, ...]
    
      for (const record of records) {
        // account_id로 필터링하여 다른 계정의 레코드를 수정하지 못하도록 함
        await db.run(
          `UPDATE drbet_records SET display_order = ? WHERE id = ? AND account_id = ?`,
          [record.display_order, record.id, req.user.filterAccountId]
        );
      }
    
    res.json({ message: '순서가 업데이트되었습니다' });
  } catch (error) {
    console.error('순서 업데이트 실패:', error);
    res.status(500).json({ message: '순서 업데이트 실패' });
  }
});

// 특정 날짜의 DR벳 기록 조회
router.get('/:date', auth, async (req, res) => {
  try {
    const { date } = req.params;
    
    // 사무실 관리자인 경우: 자신의 사무실에 속한 모든 계정의 레코드 조회
    if (req.user.isOfficeManager && req.user.filterOfficeId) {
      const record = await db.get(
        `SELECT dr.* 
         FROM drbet_records dr
         INNER JOIN accounts a ON dr.account_id = a.id
         WHERE dr.record_date = ? AND a.office_id = ?`,
        [date, req.user.filterOfficeId]
      );
      
      if (!record) {
        return res.status(404).json({ message: '해당 날짜의 기록이 없습니다' });
      }
      
      return res.json(record);
    }
    
    // 일반 사용자: 자신의 계정 레코드만 조회
    const record = await db.get(
      `SELECT * FROM drbet_records WHERE record_date = ? AND account_id = ?`,
      [date, req.user.filterAccountId]
    );
    
    if (!record) {
      return res.status(404).json({ message: '해당 날짜의 기록이 없습니다' });
    }
    
    res.json(record);
  } catch (error) {
    console.error('DR벳 기록 조회 실패:', error);
    res.status(500).json({ message: 'DR벳 기록 조회 실패' });
  }
});

// 새로운 DR벳 기록 생성
router.post('/', auth, async (req, res) => {
  try {
    const {
      record_date,
      display_order,
      drbet_amount,
      total_amount,
      rate_amount,
      site1,
      site2,
      site3,
      site4,
      notes,
      identity1, identity2, identity3, identity4,
      site_name1, site_name2, site_name3, site_name4,
      charge_withdraw1, charge_withdraw2, charge_withdraw3, charge_withdraw4,
      attendance1, attendance2, attendance3, attendance4,
      cumulative_charge1,
      cumulative_withdraw1,
      cumulative_charge2,
      cumulative_withdraw2
    } = req.body;

    // 입력 파싱 함수
    const parseSiteData = (input) => {
      if (!input) return { charge: 0, withdraw: 0 };
      const match = input.match(/(\d+)\s*(\d+)?/);
      if (match) {
        return {
          charge: parseInt(match[1]) * 10000,
          withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
        };
      }
      return { charge: 0, withdraw: 0 };
    };

    const parseNotes = (input) => {
      if (!input) return { charge: 0, withdraw: 0 };
      let totalCharge = 0;
      let totalWithdraw = 0;
      
      const chargeMatches = input.match(/(\d+)충/g);
      const withdrawMatches = input.match(/(\d+)환/g);
      
      if (chargeMatches) {
        chargeMatches.forEach(m => {
          totalCharge += parseInt(m.replace('충', '')) * 10000;
        });
      }
      
      if (withdrawMatches) {
        withdrawMatches.forEach(m => {
          totalWithdraw += parseInt(m.replace('환', '')) * 10000;
        });
      }
      
      return { charge: totalCharge, withdraw: totalWithdraw };
    };

    // 충환전 필드 파싱 함수
    const parseChargeWithdraw = (input) => {
      if (!input) return { charge: 0, withdraw: 0 };
      
      // 숫자만 있는 경우 (예: "10" = 10만원 충전)
      if (/^\d+$/.test(input.trim())) {
        return { charge: parseInt(input.trim()) * 10000, withdraw: 0 };
      }
      
      // 환전 표시가 있는 경우 (예: "10 20" = 10만원 충전, 20만원 환전)
      const match = input.match(/(\d+)\s*(\d+)?/);
      if (match) {
        return {
          charge: parseInt(match[1]) * 10000,
          withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
        };
      }
      
      return { charge: 0, withdraw: 0 };
    };

    // 새로운 구조(charge_withdraw) 우선 사용, 없으면 site 필드 사용
    const charge1Data = charge_withdraw1 ? parseChargeWithdraw(charge_withdraw1) : parseSiteData(site1);
    const charge2Data = charge_withdraw2 ? parseChargeWithdraw(charge_withdraw2) : parseSiteData(site2);
    const charge3Data = charge_withdraw3 ? parseChargeWithdraw(charge_withdraw3) : parseSiteData(site3);
    const charge4Data = charge_withdraw4 ? parseChargeWithdraw(charge_withdraw4) : parseSiteData(site4);
    
    const private_amount = 
      charge1Data.charge + 
      charge2Data.charge + 
      charge3Data.charge + 
      charge4Data.charge;

    // 문자열을 숫자로 변환 (drbet_amount, total_amount가 문자열일 경우를 대비)
    const drbetAmountNum = typeof drbet_amount === 'string' ? parseInt(drbet_amount) || 0 : drbet_amount || 0;
    const totalAmountNum = typeof total_amount === 'string' ? parseInt(total_amount) || 0 : total_amount || 0;

    // 토탈충전 계산 (C열)
    const total_charge = drbetAmountNum + private_amount;

    // 마진 계산 (E열) - 토탈금액이 없거나 0이면 마진을 0으로 계산
    const margin = (!totalAmountNum || totalAmountNum === 0) ? 0 : (totalAmountNum - total_charge);

    // 데이터베이스에 삽입 (컬럼 순서: DB 스키마와 일치)
    let result;
    try {
      result = await db.run(
        `INSERT INTO drbet_records (
          record_date, display_order, drbet_amount, private_amount, total_charge, 
          total_amount, margin, rate_amount, site1, site2, site3, site4, 
          notes,
          identity1, site_name1, charge_withdraw1, attendance1,
          identity2, site_name2, charge_withdraw2, attendance2,
          identity3, site_name3, charge_withdraw3, attendance3,
          identity4, site_name4, charge_withdraw4, attendance4,
          cumulative_charge1, cumulative_withdraw1,
          cumulative_charge2, cumulative_withdraw2,
          account_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record_date,
          display_order || 0,
          drbet_amount || 0,
          private_amount,
          total_charge,
          total_amount || 0,
          margin,
          rate_amount || 0,
          site1 || '',
          site2 || '',
          site3 || '',
          site4 || '',
          notes || '',
          identity1 || '',
          site_name1 || '',
          charge_withdraw1 || '',
          attendance1 || 0,
          identity2 || '',
          site_name2 || '',
          charge_withdraw2 || '',
          attendance2 || 0,
          identity3 || '',
          site_name3 || '',
          charge_withdraw3 || '',
          attendance3 || 0,
          identity4 || '',
          site_name4 || '',
          charge_withdraw4 || '',
          attendance4 || 0,
          cumulative_charge1 || 0,
          cumulative_withdraw1 || 0,
          cumulative_charge2 || 0,
          cumulative_withdraw2 || 0,
          req.user.filterAccountId
        ]
      );
    } catch (insertError) {
      console.error('❌ [DR벳] 레코드 INSERT 실패:', insertError);
      return res.status(500).json({ message: '레코드 저장 실패', error: insertError.message });
    }

    // result.id 또는 result.lastID 사용 (db.run이 반환하는 형식에 따라)
    const recordId = result?.id || result?.lastID;
    
    if (!recordId) {
      console.error('⚠️ [DR벳] INSERT 후 lastID가 없음:', result);
      return res.status(500).json({ message: '레코드 ID를 가져올 수 없습니다' });
    }

    // 생성된 기록 조회
    let newRecord = await db.get(
      `SELECT * FROM drbet_records WHERE id = ?`,
      [recordId]
    );

    if (!newRecord) {
      console.error('⚠️ [DR벳] 생성된 레코드를 찾을 수 없음:', recordId);
      return res.status(500).json({ message: '생성된 레코드를 찾을 수 없습니다' });
    }

    await invalidateSummaryForDate(req.user.filterAccountId, record_date);

    // 🎯 자동 출석 처리 (새 모듈 사용)
    const attendanceDaysMap = await handleNewRecord(req.user.filterAccountId, newRecord, record_date);

    // 자동 출석 처리 후 레코드 다시 조회
    newRecord = await db.get(
      `SELECT * FROM drbet_records WHERE id = ?`,
      [recordId]
    );

    // 응답에 출석일 정보 추가
    res.status(201).json({
      ...newRecord,
      _attendanceDays: attendanceDaysMap
    });
  } catch (error) {
    console.error('DR벳 기록 생성 실패:', error);
    res.status(500).json({ message: 'DR벳 기록 생성 실패', error: error.message });
  }
});

// DR벳 기록 수정
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      record_date,
      drbet_amount,
      total_amount,
      rate_amount,
      site1,
      site2,
      site3,
      site4,
      notes,
      identity1, identity2, identity3, identity4,
      site_name1, site_name2, site_name3, site_name4,
      charge_withdraw1, charge_withdraw2, charge_withdraw3, charge_withdraw4,
      attendance1, attendance2, attendance3, attendance4,
      cumulative_charge1,
      cumulative_withdraw1,
      cumulative_charge2,
      cumulative_withdraw2,
      _expectedUpdatedAt  // 동시성 처리용: 클라이언트가 마지막으로 받은 updated_at
    } = req.body;

    // 입력 파싱 함수
    const parseSiteData = (input) => {
      if (!input) return { charge: 0, withdraw: 0 };
      const match = input.match(/(\d+)\s*(\d+)?/);
      if (match) {
        return {
          charge: parseInt(match[1]) * 10000,
          withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
        };
      }
      return { charge: 0, withdraw: 0 };
    };

    // 충환전 필드 파싱 함수
    const parseChargeWithdraw = (input) => {
      if (!input) return { charge: 0, withdraw: 0 };
      
      // 숫자만 있는 경우 (예: "10" = 10만원 충전)
      if (/^\d+$/.test(input.trim())) {
        return { charge: parseInt(input.trim()) * 10000, withdraw: 0 };
      }
      
      // 환전 표시가 있는 경우 (예: "10 20" = 10만원 충전, 20만원 환전)
      const match = input.match(/(\d+)\s*(\d+)?/);
      if (match) {
        return {
          charge: parseInt(match[1]) * 10000,
          withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
        };
      }
      
      return { charge: 0, withdraw: 0 };
    };

    // 새로운 구조(charge_withdraw) 우선 사용, 없으면 site 필드 사용
    const charge1Data = charge_withdraw1 ? parseChargeWithdraw(charge_withdraw1) : parseSiteData(site1);
    const charge2Data = charge_withdraw2 ? parseChargeWithdraw(charge_withdraw2) : parseSiteData(site2);
    const charge3Data = charge_withdraw3 ? parseChargeWithdraw(charge_withdraw3) : parseSiteData(site3);
    const charge4Data = charge_withdraw4 ? parseChargeWithdraw(charge_withdraw4) : parseSiteData(site4);
    
    const private_amount = 
      charge1Data.charge + 
      charge2Data.charge + 
      charge3Data.charge + 
      charge4Data.charge;

    // 문자열을 숫자로 변환 (drbet_amount, total_amount가 문자열일 경우를 대비)
    const drbetAmountNum = typeof drbet_amount === 'string' ? parseInt(drbet_amount) || 0 : drbet_amount || 0;
    const totalAmountNum = typeof total_amount === 'string' ? parseInt(total_amount) || 0 : total_amount || 0;

    // 토탈충전 계산
    const total_charge = drbetAmountNum + private_amount;

    // 마진 계산 - 토탈금액이 없거나 0이면 마진을 0으로 계산
    const margin = (!totalAmountNum || totalAmountNum === 0) ? 0 : (totalAmountNum - total_charge);

    // 먼저 해당 레코드가 현재 사용자의 계정에 속하는지 확인
    let existingRecord;
    
    if (req.user.isOfficeManager && req.user.filterOfficeId) {
      // 사무실 관리자: 자신의 사무실에 속한 계정의 레코드만 수정 가능
      if (req.user.filterAccountId) {
        // 특정 계정 선택 시: 해당 계정의 레코드만 수정 가능
        existingRecord = await db.get(
          `SELECT dr.* 
           FROM drbet_records dr
           INNER JOIN accounts a ON dr.account_id = a.id
           WHERE dr.id = ? AND dr.account_id = ? AND a.office_id = ?`,
          [id, req.user.filterAccountId, req.user.filterOfficeId]
        );
      } else {
        // 계정 미선택 시: 사무실 내 모든 계정의 레코드 수정 가능
        existingRecord = await db.get(
          `SELECT dr.* 
           FROM drbet_records dr
           INNER JOIN accounts a ON dr.account_id = a.id
           WHERE dr.id = ? AND a.office_id = ?`,
          [id, req.user.filterOfficeId]
        );
      }
    } else {
      // 일반 사용자: 자신의 계정 레코드만 수정 가능
      if (!req.user.filterAccountId) {
        return res.status(403).json({ message: '계정을 선택해주세요.' });
      }
      existingRecord = await db.get(
        `SELECT * FROM drbet_records WHERE id = ? AND account_id = ?`,
        [id, req.user.filterAccountId]
      );
    }

    if (!existingRecord) {
      return res.status(403).json({ message: '이 레코드에 대한 접근 권한이 없습니다.' });
    }

    // 🔒 동시성 처리 (Optimistic Locking)
    // 클라이언트가 마지막으로 받은 updated_at과 현재 DB의 updated_at 비교
    if (_expectedUpdatedAt && existingRecord.updated_at) {
      const expectedTime = new Date(_expectedUpdatedAt).getTime();
      const actualTime = new Date(existingRecord.updated_at).getTime();
      
      // 1초 이상 차이나면 다른 사용자가 수정한 것으로 간주
      if (Math.abs(expectedTime - actualTime) > 1000) {
        return res.status(409).json({ 
          message: '다른 사용자가 이 레코드를 수정했습니다. 새로고침 후 다시 시도해주세요.',
          code: 'CONFLICT',
          serverUpdatedAt: existingRecord.updated_at,
          clientUpdatedAt: _expectedUpdatedAt
        });
      }
    }

    // 업데이트
    const timestamp = getKSTDateTimeString();
    await db.run(
      `UPDATE drbet_records SET
        record_date = ?,
        drbet_amount = ?,
        private_amount = ?,
        total_charge = ?,
        total_amount = ?,
        margin = ?,
        rate_amount = ?,
        site1 = ?,
        site2 = ?,
        site3 = ?,
        site4 = ?,
        notes = ?,
        identity1 = ?,
        identity2 = ?,
        identity3 = ?,
        identity4 = ?,
        site_name1 = ?,
        site_name2 = ?,
        site_name3 = ?,
        site_name4 = ?,
        charge_withdraw1 = ?,
        charge_withdraw2 = ?,
        charge_withdraw3 = ?,
        charge_withdraw4 = ?,
        attendance1 = ?,
        attendance2 = ?,
        attendance3 = ?,
        attendance4 = ?,
        cumulative_charge1 = ?,
        cumulative_withdraw1 = ?,
        cumulative_charge2 = ?,
        cumulative_withdraw2 = ?,
        updated_at = ?
      WHERE id = ? AND account_id = ?`,
      [
        record_date,
        drbet_amount || 0,
        private_amount,
        total_charge,
        total_amount || 0,
        margin,
        rate_amount || 0,
        site1 || '',
        site2 || '',
        site3 || '',
        site4 || '',
        notes || '',
        identity1 || '',
        identity2 || '',
        identity3 || '',
        identity4 || '',
        site_name1 || '',
        site_name2 || '',
        site_name3 || '',
        site_name4 || '',
        charge_withdraw1 || '',
        charge_withdraw2 || '',
        charge_withdraw3 || '',
        charge_withdraw4 || '',
        attendance1 || 0,
        attendance2 || 0,
        attendance3 || 0,
        attendance4 || 0,
        cumulative_charge1 || 0,
        cumulative_withdraw1 || 0,
        cumulative_charge2 || 0,
        cumulative_withdraw2 || 0,
        timestamp,
        id,
        existingRecord.account_id
      ]
    );

    // 업데이트된 기록 조회
    let updatedRecord = await db.get(
      `SELECT * FROM drbet_records WHERE id = ? AND account_id = ?`,
      [id, existingRecord.account_id]
    );

    if (!updatedRecord) {
      console.error('⚠️ [DR벳] 업데이트된 레코드를 찾을 수 없음:', id);
      return res.status(500).json({ message: '업데이트된 레코드를 찾을 수 없습니다' });
    }

    await invalidateSummaryForDate(existingRecord.account_id, existingRecord.record_date);
    if (record_date && record_date !== existingRecord.record_date) {
      await invalidateSummaryForDate(existingRecord.account_id, record_date);
    }

    // 🎯 자동 출석 처리 (새 모듈 사용)
    // 날짜 변경 시 이전 날짜 로그도 정리하도록 oldRecordDate 전달
    const attendanceDaysMap = await handleUpdateRecord(
      existingRecord.account_id, 
      existingRecord, 
      updatedRecord, 
      record_date,
      existingRecord.record_date  // 이전 날짜 (날짜 변경 감지용)
    );

    // 자동 출석 처리 후 레코드 다시 조회 (attendance1~4 필드 업데이트 반영)
    updatedRecord = await db.get(
      `SELECT * FROM drbet_records WHERE id = ? AND account_id = ?`,
      [id, req.user.filterAccountId]
    );

    // 응답에 출석일 정보 추가
    res.json({
      ...updatedRecord,
      _attendanceDays: attendanceDaysMap // { "명의||사이트": 출석일 }
    });
  } catch (error) {
    console.error('DR벳 기록 수정 실패:', error);
    res.status(500).json({ message: 'DR벳 기록 수정 실패', error: error.message });
  }
});

// DR벳 기록 삭제
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user.filterAccountId;
    
    // 먼저 해당 레코드가 현재 사용자의 계정에 속하는지 확인
    const existingRecord = await db.get(
      `SELECT * FROM drbet_records WHERE id = ? AND account_id = ?`,
      [id, accountId]
    );

    if (!existingRecord) {
      return res.status(403).json({ message: '이 레코드에 대한 접근 권한이 없습니다.' });
    }
    
    // 🎯 자동 출석 처리 (삭제 - 새 모듈 사용)
    await handleDeleteRecord(accountId, existingRecord, existingRecord.record_date);
    
    await db.run(`DELETE FROM drbet_records WHERE id = ? AND account_id = ?`, [id, accountId]);
    await invalidateSummaryForDate(accountId, existingRecord.record_date);
    
    res.json({ message: 'DR벳 기록이 삭제되었습니다' });
  } catch (error) {
    console.error('DR벳 기록 삭제 실패:', error);
    res.status(500).json({ message: 'DR벳 기록 삭제 실패' });
  }
});

// 다음 날 이월 금액 계산 (자동 계산 로직)
router.post('/calculate-next', auth, async (req, res) => {
  try {
    const {
      total_amount,
      site1,
      site2,
      site3,
      site4,
      rate_amount,
      notes
    } = req.body;

    const parseSiteData = (input) => {
      if (!input) return { charge: 0, withdraw: 0 };
      const match = input.match(/(\d+)\s*(\d+)?/);
      if (match) {
        return {
          charge: parseInt(match[1]) * 10000,
          withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
        };
      }
      return { charge: 0, withdraw: 0 };
    };

    const parseNotes = (input) => {
      if (!input) return { charge: 0, withdraw: 0 };
      let totalCharge = 0;
      let totalWithdraw = 0;
      
      const chargeMatches = input.match(/(\d+)충/g);
      const withdrawMatches = input.match(/(\d+)환/g);
      
      if (chargeMatches) {
        chargeMatches.forEach(m => {
          totalCharge += parseInt(m.replace('충', '')) * 10000;
        });
      }
      
      if (withdrawMatches) {
        withdrawMatches.forEach(m => {
          totalWithdraw += parseInt(m.replace('환', '')) * 10000;
        });
      }
      
      return { charge: totalCharge, withdraw: totalWithdraw };
    };

    const site1Data = parseSiteData(site1);
    const site2Data = parseSiteData(site2);
    const site3Data = parseSiteData(site3);
    const site4Data = parseSiteData(site4);
    const notesData = parseNotes(notes);

    // 다음 날 DR벳 금액 계산
    const nextDrBet = 
      (total_amount || 0)
      - site1Data.withdraw
      - site2Data.withdraw
      - site3Data.withdraw
      - site4Data.withdraw
      + (rate_amount || 0)
      + notesData.charge
      - notesData.withdraw;

    res.json({ nextDrBet });
  } catch (error) {
    console.error('이월 금액 계산 실패:', error);
    res.status(500).json({ message: '이월 금액 계산 실패', error: error.message });
  }
});

module.exports = router;


