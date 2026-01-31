const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// JWT 시크릿 키
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// 로그인
router.post('/login', [
  body('username').notEmpty().withMessage('사용자명을 입력하세요'),
  body('password').notEmpty().withMessage('비밀번호를 입력하세요')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    // 계정 조회
    const account = await db.get(
      'SELECT * FROM accounts WHERE username = ? AND status = "active"',
      [username]
    );

    if (!account) {
      await logAccess(null, 'LOGIN_FAILED', `존재하지 않는 사용자: ${username}`, req);
      return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
    }

    // 비밀번호 검증
    const isValidPassword = await bcrypt.compare(password, account.password_hash);
    if (!isValidPassword) {
      await logAccess(account.id, 'LOGIN_FAILED', `잘못된 비밀번호: ${username}`, req);
      return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
    }

    if (account.office_id) {
      const office = await db.get(
        'SELECT status FROM offices WHERE id = ?',
        [account.office_id]
      );
      if (office && office.status !== 'active') {
        await logAccess(account.id, 'LOGIN_FAILED', `비활성 사무실 로그인 시도: ${username}`, req);
        return res.status(403).json({ error: '해당 사무실이 비활성 상태입니다. 관리자에게 문의하세요.' });
      }
    }

    // JWT 토큰 생성
    const token = jwt.sign(
      { 
        accountId: account.id, 
        username: account.username,
        accountType: account.account_type 
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // 마지막 로그인 시간 업데이트
    await db.run(
      'UPDATE accounts SET last_login = ? WHERE id = ?',
      [new Date().toISOString(), account.id]
    );

    // 세션 저장
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8시간 후
    await db.run(
      `INSERT INTO sessions (account_id, token, created_at, expires_at, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [account.id, token, new Date().toISOString(), expiresAt.toISOString()]
    );

    await logAccess(account.id, 'LOGIN_SUCCESS', `로그인 성공: ${username}`, req);

    res.json({
      token,
      user: {
        id: account.id,
        username: account.username,
        displayName: account.display_name,
        accountType: account.account_type,
        officeId: account.office_id || null,
        isOfficeManager: account.is_office_manager === 1
      }
    });

  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 로그아웃
router.post('/logout', auth, async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      // 세션 비활성화
      await db.run(
        'UPDATE sessions SET is_active = 0 WHERE token = ?',
        [token]
      );
    }

    await logAccess(req.user.accountId, 'LOGOUT', '로그아웃', req);
    
    res.json({ message: '로그아웃되었습니다.' });
  } catch (error) {
    console.error('로그아웃 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 현재 사용자 정보 조회
router.get('/me', auth, async (req, res) => {
  try {
    const account = await db.get(
      'SELECT id, username, display_name, account_type, status, created_date, last_login FROM accounts WHERE id = ?',
      [req.user.accountId]
    );

    if (!account) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    res.json({
      id: account.id,
      username: account.username,
      displayName: account.display_name,
      accountType: account.account_type,
      status: account.status,
      createdDate: account.created_date,
      lastLogin: account.last_login
    });
  } catch (error) {
    console.error('사용자 정보 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 토큰 검증
router.get('/verify', auth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// 관리자/사무실 관리자용 계정 목록 조회
router.get('/accounts', auth, async (req, res) => {
  try {
    let accounts = [];

    if (req.user.accountType === 'super_admin') {
      // 슈퍼관리자는 사무실 관리자만 조회
      accounts = await db.all(
        `SELECT id, username, display_name, account_type, status, created_date, last_login, office_id, is_office_manager, display_order 
         FROM accounts 
         WHERE is_office_manager = 1 AND status = 'active'
         ORDER BY display_order ASC, display_name ASC`
      );
    } else if (req.user.isOfficeManager && req.user.officeId) {
      accounts = await db.all(
        `SELECT id, username, display_name, account_type, status, created_date, last_login, office_id, is_office_manager, display_order 
         FROM accounts 
         WHERE office_id = ? AND status = 'active'
         ORDER BY display_order ASC, display_name ASC`,
        [req.user.officeId]
      );
    } else {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }
    
    const formatted = accounts.map(acc => {
      const { is_office_manager, display_order, ...rest } = acc;
      return {
        ...rest,
        display_order: display_order || 0,
        isOfficeManager: is_office_manager === 1
      };
    });
    
    res.json({ success: true, accounts: formatted });
  } catch (error) {
    console.error('계정 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 계정 생성 (슈퍼관리자 또는 사무실 관리자)
router.post('/accounts', auth, async (req, res) => {
  try {
    const { username, password, display_name, account_type, office_id, is_office_manager, notes = '' } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: '사용자명은 3자 이상이어야 합니다.' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const existingAccount = await db.get(
      'SELECT id FROM accounts WHERE username = ?',
      [username.trim()]
    );

    if (existingAccount) {
      return res.status(409).json({ error: '이미 존재하는 사용자명입니다.' });
    }

    let targetOfficeId = null;
    let targetAccountType = 'user';
    let targetIsOfficeManager = 0;

    if (req.user.accountType === 'super_admin') {
      targetOfficeId = office_id || null;
      if (account_type && ['user', 'office_manager', 'admin'].includes(account_type)) {
        targetAccountType = account_type === 'office_manager' ? 'user' : account_type;
        targetIsOfficeManager = account_type === 'office_manager' ? 1 : 0;
      } else if (account_type) {
        targetAccountType = account_type;
      }

      if (is_office_manager === true || is_office_manager === 1) {
        targetIsOfficeManager = 1;
      }
    } else if (req.user.isOfficeManager && req.user.officeId) {
      targetOfficeId = req.user.officeId;
      targetAccountType = 'user';
      targetIsOfficeManager = 0;
    } else {
      return res.status(403).json({ error: '계정을 생성할 권한이 없습니다.' });
    }

    // 유효한 account_type 보장
    const allowedTypes = new Set(['user', 'super_admin']);
    if (!allowedTypes.has(targetAccountType)) {
      targetAccountType = 'user';
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdDate = new Date().toISOString();
    const displayName = (display_name || username).trim();

    const insertResult = await db.run(
      `INSERT INTO accounts (username, password_hash, display_name, account_type, created_date, status, office_id, is_office_manager)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        username.trim(),
        hashedPassword,
        displayName,
        targetAccountType,
        createdDate,
        targetOfficeId,
        targetIsOfficeManager
      ]
    );

    const newAccountId = insertResult.id;

    if (!newAccountId) {
      return res.status(500).json({ error: '계정 생성에 실패했습니다. 계정 ID를 가져올 수 없습니다.' });
    }

    // users 테이블은 더 이상 사용하지 않음 (identities가 직접 account_id 참조)

    const newAccount = await db.get(
      `SELECT id, username, display_name, account_type, status, created_date, last_login, office_id, is_office_manager 
       FROM accounts WHERE id = ?`,
      [newAccountId]
    );

    if (!newAccount) {
      return res.status(500).json({ error: '계정 생성 후 조회에 실패했습니다.' });
    }

    res.status(201).json({
      success: true,
      account: {
        ...newAccount,
        isOfficeManager: newAccount.is_office_manager === 1
      }
    });
  } catch (error) {
    console.error('계정 생성 오류:', error);
    res.status(500).json({ error: '계정 생성 중 오류가 발생했습니다.' });
  }
});

// 계정 삭제 (슈퍼관리자 또는 사무실 관리자)
router.delete('/accounts/:id', auth, async (req, res) => {
  try {
    const accountIdToDelete = parseInt(req.params.id);
    
    if (!accountIdToDelete || isNaN(accountIdToDelete)) {
      return res.status(400).json({ error: '유효하지 않은 계정 ID입니다.' });
    }

    // 자기 자신은 삭제 불가
    if (accountIdToDelete === req.user.accountId) {
      return res.status(403).json({ error: '자기 자신의 계정은 삭제할 수 없습니다.' });
    }

    // 삭제할 계정 정보 조회
    const accountToDelete = await db.get(
      'SELECT id, username, display_name, office_id, is_office_manager FROM accounts WHERE id = ?',
      [accountIdToDelete]
    );

    if (!accountToDelete) {
      return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
    }

    // 권한 체크
    if (req.user.accountType === 'super_admin') {
      // 슈퍼관리자는 모든 계정 삭제 가능
    } else if (req.user.isOfficeManager && req.user.officeId) {
      // 사무실 관리자는 자신의 사무실 계정만 삭제 가능
      if (accountToDelete.office_id !== req.user.officeId) {
        return res.status(403).json({ error: '다른 사무실의 계정은 삭제할 수 없습니다.' });
      }
      // 사무실 관리자는 다른 사무실 관리자 계정 삭제 불가
      if (accountToDelete.is_office_manager === 1) {
        return res.status(403).json({ error: '사무실 관리자 계정은 삭제할 수 없습니다.' });
      }
    } else {
      return res.status(403).json({ error: '계정을 삭제할 권한이 없습니다.' });
    }

    // 관련 데이터 삭제
    // 1. DR벳 기록 삭제
    await db.run('DELETE FROM drbet_records WHERE account_id = ?', [accountIdToDelete]);
    
    // 2. 정산 데이터 삭제
    await db.run('DELETE FROM settlements WHERE account_id = ?', [accountIdToDelete]);
    
    // 3. 출석 관련 데이터 삭제
    await db.run('DELETE FROM site_attendance WHERE account_id = ?', [accountIdToDelete]);
    await db.run('DELETE FROM site_attendance_log WHERE account_id = ?', [accountIdToDelete]);
    
    // 4. 관련 명의들 조회 및 삭제
    const identities = await db.all('SELECT id FROM identities WHERE account_id = ?', [accountIdToDelete]);
    
    // 각 명의의 사이트들 삭제
    for (const identity of identities) {
      await db.run('DELETE FROM site_accounts WHERE identity_id = ?', [identity.id]);
    }
    
    // 명의들 삭제
    await db.run('DELETE FROM identities WHERE account_id = ?', [accountIdToDelete]);
    
    // 커뮤니티 삭제
    await db.run('DELETE FROM communities WHERE account_id = ?', [accountIdToDelete]);

    // 5. 세션 삭제
    await db.run('DELETE FROM sessions WHERE account_id = ?', [accountIdToDelete]);
    
    // 접근 로그는 유지 (감사 목적)
    
    // 6. 계정 삭제 (status를 'deleted'로 변경하거나 완전 삭제)
    await db.run('DELETE FROM accounts WHERE id = ?', [accountIdToDelete]);

    await logAccess(req.user.accountId, 'ACCOUNT_DELETE', `계정 삭제: ${accountToDelete.username} (${accountToDelete.display_name})`, req);

    res.json({ 
      success: true, 
      message: '계정이 삭제되었습니다.' 
    });
  } catch (error) {
    console.error('계정 삭제 오류:', error);
    res.status(500).json({ error: '계정 삭제 중 오류가 발생했습니다.' });
  }
});

// 계정 순서 변경 - 슈퍼관리자 또는 사무실 관리자
// 주의: 이 라우트는 /accounts/:id 보다 먼저 정의되어야 함
router.put('/accounts/reorder', auth, async (req, res) => {
  try {
    const { accountOrders } = req.body;
    
    console.log('계정 순서 변경 요청 받음:', JSON.stringify(req.body, null, 2));
    
    if (!Array.isArray(accountOrders) || accountOrders.length === 0) {
      console.log('순서 정보 오류: accountOrders =', accountOrders, 'req.body =', req.body);
      return res.status(400).json({ error: '순서 정보가 필요합니다.' });
    }

    // 권한 체크
    if (req.user.accountType !== 'super_admin' && !req.user.isOfficeManager) {
      return res.status(403).json({ error: '계정 순서를 변경할 권한이 없습니다.' });
    }

    // 각 계정의 순서 업데이트
    for (const item of accountOrders) {
      const { id, display_order } = item;
      
      if (!id || display_order === undefined) continue;

      // 사무실 관리자인 경우 자신의 사무실 계정만 변경 가능
      if (req.user.isOfficeManager && req.user.officeId && req.user.accountType !== 'super_admin') {
        const account = await db.get('SELECT office_id FROM accounts WHERE id = ?', [id]);
        if (!account || account.office_id !== req.user.officeId) {
          continue; // 권한 없는 계정은 건너뜀
        }
      }

      await db.run(
        'UPDATE accounts SET display_order = ? WHERE id = ?',
        [display_order, id]
      );
    }

    res.json({ success: true, message: '계정 순서가 변경되었습니다.' });
  } catch (error) {
    console.error('계정 순서 변경 오류:', error);
    res.status(500).json({ error: '계정 순서 변경 중 오류가 발생했습니다.' });
  }
});

// 계정 수정 (이름 변경) - 슈퍼관리자 또는 사무실 관리자
router.put('/accounts/:id', auth, async (req, res) => {
  try {
    const accountIdToUpdate = parseInt(req.params.id);
    const { display_name } = req.body;
    
    if (!accountIdToUpdate || isNaN(accountIdToUpdate)) {
      return res.status(400).json({ error: '유효하지 않은 계정 ID입니다.' });
    }

    if (!display_name || typeof display_name !== 'string' || display_name.trim().length === 0) {
      return res.status(400).json({ error: '표시 이름을 입력해주세요.' });
    }

    // 수정할 계정 정보 조회
    const accountToUpdate = await db.get(
      'SELECT id, username, display_name, office_id, is_office_manager FROM accounts WHERE id = ?',
      [accountIdToUpdate]
    );

    if (!accountToUpdate) {
      return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
    }

    // 권한 체크
    if (req.user.accountType === 'super_admin') {
      // 슈퍼관리자는 모든 계정 수정 가능
    } else if (req.user.isOfficeManager && req.user.officeId) {
      // 사무실 관리자는 자신의 사무실 계정만 수정 가능
      if (accountToUpdate.office_id !== req.user.officeId) {
        return res.status(403).json({ error: '다른 사무실의 계정은 수정할 수 없습니다.' });
      }
    } else {
      return res.status(403).json({ error: '계정을 수정할 권한이 없습니다.' });
    }

    // 계정 이름 수정
    await db.run(
      'UPDATE accounts SET display_name = ? WHERE id = ?',
      [display_name.trim(), accountIdToUpdate]
    );

    const updatedAccount = await db.get(
      'SELECT id, username, display_name, account_type, status, created_date, last_login, office_id, is_office_manager, display_order FROM accounts WHERE id = ?',
      [accountIdToUpdate]
    );

    await logAccess(req.user.accountId, 'ACCOUNT_UPDATE', `계정 수정: ${accountToUpdate.display_name} → ${display_name.trim()}`, req);

    res.json({ 
      success: true, 
      account: {
        ...updatedAccount,
        isOfficeManager: updatedAccount.is_office_manager === 1
      }
    });
  } catch (error) {
    console.error('계정 수정 오류:', error);
    res.status(500).json({ error: '계정 수정 중 오류가 발생했습니다.' });
  }
});

// 접근 로그 기록 함수
async function logAccess(accountId, action, details, req) {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress || '';
    const userAgent = req.get('User-Agent') || '';
    
    await db.run(
      `INSERT INTO access_logs (account_id, action, details, ip_address, user_agent, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [accountId, action, details, ipAddress, userAgent, new Date().toISOString()]
    );
  } catch (error) {
    console.error('접근 로그 기록 실패:', error);
  }
}

module.exports = router;
