const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const { logAudit } = require('../utils/auditLog');
const { emitDataChange } = require('../socket');

// 한국 시간 기준 ISO 문자열 반환
function getKSTISOString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  return kstDate.toISOString();
}

// 생년월일에서 띠 계산 (음력 설날 기준)
function calculateZodiac(birthDate) {
  if (!birthDate) return '';
  
  const date = new Date(birthDate);
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();
  
  // 띠 배열: 쥐, 소, 호랑이, 토끼, 용, 뱀, 말, 양, 원숭이, 닭, 개, 돼지
  const zodiacArray = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
  
  // 각 년도의 음력 설날 날짜 (월, 일)
  // 설날 이전이면 전년도 띠를 사용
  const lunarNewYearDates = {
    1990: { month: 1, day: 27 },
    1991: { month: 2, day: 15 },
    1992: { month: 2, day: 4 },
    1993: { month: 1, day: 23 },
    1994: { month: 2, day: 10 },
    1995: { month: 1, day: 31 },
    1996: { month: 2, day: 19 },
    1997: { month: 2, day: 7 },
    1998: { month: 1, day: 28 },
    1999: { month: 2, day: 16 },
    2000: { month: 2, day: 5 },
    2001: { month: 1, day: 24 },
    2002: { month: 2, day: 12 },
    2003: { month: 2, day: 1 },
    2004: { month: 1, day: 22 },
    2005: { month: 2, day: 9 },
    2006: { month: 1, day: 29 },
    2007: { month: 2, day: 18 },
    2008: { month: 2, day: 7 },
    2009: { month: 1, day: 26 },
    2010: { month: 2, day: 14 },
    2011: { month: 2, day: 3 },
    2012: { month: 1, day: 23 },
    2013: { month: 2, day: 10 },
    2014: { month: 1, day: 31 },
    2015: { month: 2, day: 19 },
    2016: { month: 2, day: 8 },
    2017: { month: 1, day: 28 },
    2018: { month: 2, day: 16 },
    2019: { month: 2, day: 5 },
    2020: { month: 1, day: 25 },
    2021: { month: 2, day: 12 },
    2022: { month: 2, day: 1 },
    2023: { month: 1, day: 22 },
    2024: { month: 2, day: 10 },
    2025: { month: 1, day: 29 },
    2026: { month: 2, day: 17 },
    2027: { month: 2, day: 6 },
    2028: { month: 1, day: 26 },
    2029: { month: 2, day: 13 },
    2030: { month: 2, day: 3 }
  };
  
  // 실제 띠를 계산할 연도 결정
  let zodiacYear = year;
  
  // 해당 년도의 설날 날짜 확인
  const newYearDate = lunarNewYearDates[year];
  
  if (newYearDate) {
    // 설날 이전이면 전년도 띠 사용
    if (month < newYearDate.month || (month === newYearDate.month && day < newYearDate.day)) {
      zodiacYear = year - 1;
    }
  } else {
    // 설날 정보가 없으면 대략적으로 2월 5일 기준 사용
    if (month === 1 || (month === 2 && day < 5)) {
      zodiacYear = year - 1;
    }
  }
  
  // 1960년이 쥐띠 (0) - 주기 12년
  const zodiacIndex = (zodiacYear - 1960) % 12;
  
  // 음수 처리 (1960년 이전)
  const finalIndex = zodiacIndex < 0 ? zodiacIndex + 12 : zodiacIndex;
  
  return zodiacArray[finalIndex];
}

// 현재 로그인한 사용자의 명의만 조회
router.get('/', auth, async (req, res) => {
  try {
    // 사무실 관리자인 경우
    if (req.user.isOfficeManager && req.user.filterOfficeId) {
      // 특정 계정 선택 시: 해당 계정의 명의만 조회
      if (req.user.filterAccountId) {
        const filterAccountId = req.user.filterAccountId;
        
        // account_id로 직접 조회
        let query = `
          SELECT i.*, a.username 
          FROM identities i
          LEFT JOIN accounts a ON i.account_id = a.id
          WHERE i.account_id = ?
        `;
        let params = [filterAccountId];
        
        query += ' ORDER BY COALESCE(i.display_order, 999999), i.name';
        
        const identities = await db.all(query, params);
        
        const parsedIdentities = identities.map(identity => {
          let zodiac = identity.zodiac;
          if (!zodiac && identity.birth_date) {
            zodiac = calculateZodiac(identity.birth_date);
          }
          
          return {
            ...identity,
            zodiac: zodiac,
            bank_accounts: JSON.parse(identity.bank_accounts || '[]'),
            phone_numbers: JSON.parse(identity.phone_numbers || '[]')
          };
        });
        
        return res.json({ success: true, identities: parsedIdentities });
      }
      
      // 계정 미선택 시: 사무실 전체 명의 조회
      let query = `
        SELECT i.*, a.username 
        FROM identities i
        LEFT JOIN accounts a ON i.account_id = a.id
        WHERE a.office_id = ?
      `;
      let params = [req.user.filterOfficeId];
      
      query += ' ORDER BY COALESCE(i.display_order, 999999), i.name';
      
      const identities = await db.all(query, params);
      
      const parsedIdentities = identities.map(identity => {
        let zodiac = identity.zodiac;
        if (!zodiac && identity.birth_date) {
          zodiac = calculateZodiac(identity.birth_date);
        }
        
        return {
          ...identity,
          zodiac: zodiac,
          bank_accounts: JSON.parse(identity.bank_accounts || '[]'),
          phone_numbers: JSON.parse(identity.phone_numbers || '[]')
        };
      });
      
      return res.json({ success: true, identities: parsedIdentities });
    }
    
    // 일반 사용자: 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    // account_id로 직접 조회
    let query = `
      SELECT i.*, a.username 
      FROM identities i
      LEFT JOIN accounts a ON i.account_id = a.id
      WHERE i.account_id = ?
    `;
    let params = [filterAccountId];
    
    query += ' ORDER BY COALESCE(i.display_order, 999999), i.name';
    
    const identities = await db.all(query, params);
    
    // JSON 문자열을 객체로 파싱 및 띠 자동 계산
    const parsedIdentities = identities.map(identity => {
      // 만약 zodiac이 없거나 비어있으면 생년월일로 자동 계산
      let zodiac = identity.zodiac;
      if (!zodiac && identity.birth_date) {
        zodiac = calculateZodiac(identity.birth_date);
      }
      
      const nicknames = identity.nickname ? [identity.nickname] : (identity.nicknames ? JSON.parse(identity.nicknames || '[]') : []);
      
      return {
        ...identity,
        zodiac: zodiac,
        bank_accounts: JSON.parse(identity.bank_accounts || '[]'),
        phone_numbers: JSON.parse(identity.phone_numbers || '[]'),
        nicknames: nicknames
      };
    });
    
    res.json({ success: true, identities: parsedIdentities });
  } catch (error) {
    console.error('명의 조회 실패:', error);
    res.status(500).json({ success: false, message: '명의 조회 실패' });
  }
});

// 특정 명의 조회
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const identity = await db.get('SELECT * FROM identities WHERE id = ?', [id]);
    
    if (!identity) {
      return res.status(404).json({ success: false, message: '명의를 찾을 수 없습니다' });
    }
    
    // 만약 zodiac이 없거나 비어있으면 생년월일로 자동 계산
    let zodiac = identity.zodiac;
    if (!zodiac && identity.birth_date) {
      zodiac = calculateZodiac(identity.birth_date);
    }
    
    const parsedIdentity = {
      ...identity,
      zodiac: zodiac,
      bank_accounts: JSON.parse(identity.bank_accounts || '[]'),
      phone_numbers: JSON.parse(identity.phone_numbers || '[]')
    };
    
    res.json({ success: true, identity: parsedIdentity });
  } catch (error) {
    console.error('명의 조회 실패:', error);
    res.status(500).json({ success: false, message: '명의 조회 실패' });
  }
});

// 명의 순서 변경 (일반 사용자 및 사무실 관리자 모두 가능)
// 주의: /:id 라우트보다 먼저 정의해야 함 (라우트 매칭 순서)
router.put('/reorder', auth, async (req, res) => {
  try {
    const { identities } = req.body;
    
    console.log('명의 순서 변경 요청:', {
      userId: req.user.accountId,
      filterAccountId: req.user.filterAccountId,
      isOfficeManager: req.user.isOfficeManager,
      filterOfficeId: req.user.filterOfficeId,
      identitiesCount: identities?.length
    });
    
    if (!Array.isArray(identities)) {
      return res.status(400).json({ 
        success: false, 
        message: '명의 목록이 필요합니다' 
      });
    }

    // 사무실 관리자인 경우: 자신의 사무실에 속한 모든 계정의 명의 순서 변경 가능
    if (req.user.isOfficeManager && req.user.filterOfficeId) {
      // 사무실 내 모든 계정의 account_id 찾기
      const accounts = await db.all(
        `SELECT id 
         FROM accounts
         WHERE office_id = ?`,
        [req.user.filterOfficeId]
      );
      
      const accountIds = accounts.map(a => a.id);
      
      console.log('사무실 관리자 - account_ids:', accountIds);
      
      // 각 명의의 display_order 업데이트
      let updatedCount = 0;
      for (const identityData of identities) {
        const { id, display_order } = identityData;
        
        // 해당 명의가 사무실 내 사용자의 것인지 확인
        if (accountIds.length > 0) {
          const placeholders = accountIds.map(() => '?').join(',');
          const identity = await db.get(
            `SELECT * FROM identities WHERE id = ? AND account_id IN (${placeholders})`,
            [id, ...accountIds]
          );
          
          if (identity) {
            await db.run(
              'UPDATE identities SET display_order = ? WHERE id = ?',
              [display_order, id]
            );
            updatedCount++;
          } else {
            console.log(`명의 ${id}를 찾을 수 없거나 권한이 없습니다`);
          }
        }
      }
      
      console.log(`명의 순서 변경 완료: ${updatedCount}개 업데이트`);
    } else {
      // 일반 사용자: 자신의 계정 ID 사용
      const filterAccountId = req.user.filterAccountId || req.user.accountId;
      
      console.log('일반 사용자 - filterAccountId:', filterAccountId);

      // 각 명의의 display_order 업데이트
      let updatedCount = 0;
      for (const identityData of identities) {
        const { id, display_order } = identityData;
        
        // 해당 명의가 현재 사용자의 것인지 확인
        const identity = await db.get(
          'SELECT * FROM identities WHERE id = ? AND account_id = ?',
          [id, filterAccountId]
        );
        
        if (identity) {
          await db.run(
            'UPDATE identities SET display_order = ? WHERE id = ?',
            [display_order, id]
          );
          updatedCount++;
          console.log(`명의 ${id} 순서 변경: ${display_order}`);
        } else {
          console.log(`명의 ${id}를 찾을 수 없거나 권한이 없습니다 (user_id: ${user.id})`);
        }
      }
      
      console.log(`명의 순서 변경 완료: ${updatedCount}개 업데이트`);
    }

    res.json({ success: true, message: '명의 순서가 변경되었습니다' });
  } catch (error) {
    console.error('명의 순서 변경 실패:', error);
    console.error('에러 스택:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: '명의 순서 변경 실패',
      error: error.message 
    });
  }
});

// 명의 추가
router.post('/', auth, async (req, res) => {
  try {
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;

    const { 
      name, 
      birth_date, 
      bank_accounts = [], 
      phone_numbers = [], 
      nicknames = [],
      status = 'active', 
      notes = '' 
    } = req.body;
    
    // account_id 확인
    const account = await db.get(
      'SELECT id FROM accounts WHERE id = ?',
      [filterAccountId]
    );
    
    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: '계정을 찾을 수 없습니다' 
      });
    }
    
    if (!name || !birth_date) {
      return res.status(400).json({ 
        success: false, 
        message: '필수 정보를 모두 입력해주세요 (이름, 생년월일)' 
      });
    }
    
    const bankAccountsJson = JSON.stringify(bank_accounts);
    const phoneNumbersJson = JSON.stringify(phone_numbers);
    const nicknamesJson = JSON.stringify(nicknames);
    const nickname = nicknames && nicknames.length > 0 ? nicknames[0] : ''; // 하위 호환성을 위해 첫 번째 닉네임 저장
    const zodiac = calculateZodiac(birth_date);
    
    const result = await db.run(
      `INSERT INTO identities 
       (account_id, name, birth_date, zodiac, bank_accounts, phone_numbers, nickname, nicknames, status, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [filterAccountId, name, birth_date, zodiac, bankAccountsJson, phoneNumbersJson, nickname, nicknamesJson, status, notes]
    );
    
    const newIdentityId = result.id ?? result.lastID;
    const newIdentity = await db.get('SELECT * FROM identities WHERE id = ?', [newIdentityId]);
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'identities',
      recordId: newIdentityId,
      oldData: null,
      newData: newIdentity,
      description: `명의 추가 (${name})`
    });

    res.json({ success: true, identityId: newIdentityId, message: '명의가 추가되었습니다' });

    emitDataChange('identities:changed', {
      action: 'create',
      accountId: req.user.filterAccountId,
      user: req.user.displayName || req.user.username
    }, { room: `account:${req.user.filterAccountId || req.user.accountId}`, excludeSocket: req.socketId });
  } catch (error) {
    console.error('명의 추가 실패:', error);
    res.status(500).json({ success: false, message: '명의 추가 실패' });
  }
});

// 명의 수정
router.put('/:id', auth, async (req, res) => {
  try {
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    const { id } = req.params;
    
    // 해당 명의가 현재 사용자의 것인지 확인
    const identity = await db.get('SELECT * FROM identities WHERE id = ?', [id]);
    if (!identity) {
      return res.status(403).json({ success: false, message: '권한이 없습니다' });
    }
    if (!req.user.isSuperAdmin && identity.account_id !== filterAccountId) {
      return res.status(403).json({ 
        success: false, 
        message: '권한이 없습니다' 
      });
    }
    const { 
      name, 
      birth_date, 
      bank_accounts, 
      phone_numbers, 
      nicknames = [],
      status, 
      notes,
      display_order
    } = req.body;
    
    const bankAccountsJson = JSON.stringify(bank_accounts);
    const phoneNumbersJson = JSON.stringify(phone_numbers);
    const nicknamesJson = JSON.stringify(nicknames);
    const nickname = nicknames && nicknames.length > 0 ? nicknames[0] : ''; // 하위 호환성을 위해 첫 번째 닉네임 저장
    const zodiac = calculateZodiac(birth_date);
    
    // display_order가 제공된 경우에만 업데이트
    if (display_order !== undefined) {
      await db.run(
        `UPDATE identities 
         SET name = ?, birth_date = ?, zodiac = ?, bank_accounts = ?, phone_numbers = ?, nickname = ?, nicknames = ?, status = ?, notes = ?, display_order = ?
         WHERE id = ?`,
        [name, birth_date, zodiac, bankAccountsJson, phoneNumbersJson, nickname, nicknamesJson, status, notes, display_order, id]
      );
    } else {
      await db.run(
        `UPDATE identities 
         SET name = ?, birth_date = ?, zodiac = ?, bank_accounts = ?, phone_numbers = ?, nickname = ?, nicknames = ?, status = ?, notes = ?
         WHERE id = ?`,
        [name, birth_date, zodiac, bankAccountsJson, phoneNumbersJson, nickname, nicknamesJson, status, notes, id]
      );
    }
    
    // 감사 로그 기록
    const updatedIdentity = await db.get('SELECT * FROM identities WHERE id = ?', [id]);
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'identities',
      recordId: id,
      oldData: identity,
      newData: updatedIdentity,
      description: `명의 수정 (${name})`
    });

    res.json({ success: true, message: '명의가 수정되었습니다' });

    emitDataChange('identities:changed', {
      action: 'update',
      accountId: req.user.filterAccountId,
      user: req.user.displayName || req.user.username
    }, { room: `account:${req.user.filterAccountId || req.user.accountId}`, excludeSocket: req.socketId });
  } catch (error) {
    console.error('명의 수정 실패:', error);
    res.status(500).json({ success: false, message: '명의 수정 실패' });
  }
});

// 명의 삭제
router.delete('/:id', auth, async (req, res) => {
  try {
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    
    const { id } = req.params;
    
    // 해당 명의가 현재 사용자의 것인지 확인 및 명의 정보 가져오기
    const identity = await db.get('SELECT * FROM identities WHERE id = ?', [id]);
    if (!identity) {
      return res.status(403).json({ success: false, message: '권한이 없습니다' });
    }
    if (!req.user.isSuperAdmin && identity.account_id !== filterAccountId) {
      return res.status(403).json({ 
        success: false, 
        message: '권한이 없습니다' 
      });
    }
    
    // 관련 사이트 계정들 삭제
    await db.run('DELETE FROM site_accounts WHERE identity_id = ?', [id]);
    
    // 관련 커뮤니티 삭제 (identity_name과 account_id로 필터링)
    await db.run('DELETE FROM communities WHERE identity_name = ? AND account_id = ?', [identity.name, filterAccountId]);
    
    // 명의 삭제
    await db.run('DELETE FROM identities WHERE id = ?', [id]);
    
    // 감사 로그 기록
    await logAudit(req, {
      action: 'DELETE',
      tableName: 'identities',
      recordId: id,
      oldData: identity,
      newData: null,
      description: `명의 삭제 (${identity.name})`
    });

    res.json({ success: true, message: '명의가 삭제되었습니다' });

    emitDataChange('identities:changed', {
      action: 'delete',
      accountId: req.user.filterAccountId,
      user: req.user.displayName || req.user.username
    }, { room: `account:${req.user.filterAccountId || req.user.accountId}`, excludeSocket: req.socketId });
  } catch (error) {
    console.error('명의 삭제 실패:', error);
    res.status(500).json({ success: false, message: '명의 삭제 실패' });
  }
});

module.exports = router;
