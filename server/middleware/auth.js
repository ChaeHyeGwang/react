const jwt = require('jsonwebtoken');
const db = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// 인증 미들웨어
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: '액세스 토큰이 필요합니다.' });
    }

    // JWT 토큰 검증
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 세션 확인
    const session = await db.get(
      'SELECT * FROM sessions WHERE token = ? AND is_active = 1 AND expires_at > ?',
      [token, new Date().toISOString()]
    );

    if (!session) {
      return res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
    }

    // 계정 정보 확인 (office_id 포함)
    const account = await db.get(
      'SELECT * FROM accounts WHERE id = ? AND status = "active"',
      [decoded.accountId]
    );

    if (!account) {
      return res.status(401).json({ error: '계정을 찾을 수 없거나 비활성화되었습니다.' });
    }

    // 사무실 정보 확인
    let office = null;
    if (account.office_id) {
      office = await db.get('SELECT * FROM offices WHERE id = ? AND status = "active"', [account.office_id]);
    }

    // 요청 객체에 사용자 정보 추가
    req.user = {
      accountId: account.id,
      username: account.username,
      displayName: account.display_name,
      accountType: account.account_type,
      officeId: account.office_id || null,
      isOfficeManager: account.is_office_manager === 1 || account.is_office_manager === true,
      isSuperAdmin: account.account_type === 'super_admin'
    };

    // 관리자가 선택한 계정 ID가 헤더에 있으면 추가
    const selectedAccountIdHeader = req.headers['x-selected-account-id'];
    const parsedSelectedAccountId = selectedAccountIdHeader ? parseInt(selectedAccountIdHeader, 10) : null;

    if (selectedAccountIdHeader && Number.isNaN(parsedSelectedAccountId)) {
      return res.status(400).json({ error: '잘못된 계정 선택 값입니다.' });
    }

    if (parsedSelectedAccountId && account.account_type === 'super_admin') {
      // 슈퍼관리자가 사무실 관리자를 선택한 경우, 그 사무실 관리자의 사무실 데이터로 필터링
      const selectedAccount = await db.get(
        'SELECT office_id FROM accounts WHERE id = ? AND is_office_manager = 1 AND status = "active"',
        [parsedSelectedAccountId]
      );
      
      if (!selectedAccount) {
        return res.status(403).json({ error: '선택한 계정이 유효한 사무실 관리자가 아닙니다.' });
      }
      
      req.user.selectedAccountId = parsedSelectedAccountId;
      req.user.filterAccountId = null; // 계정 필터 없음 (사무실 전체)
      req.user.filterOfficeId = selectedAccount.office_id; // 선택한 사무실 관리자의 사무실로 필터링
    } else if (req.user.isOfficeManager && account.office_id) {
      // 사무실 관리자는 자신의 사무실에 속한 모든 계정의 데이터 접근 가능
      req.user.filterOfficeId = account.office_id; // 자신의 사무실만

      if (parsedSelectedAccountId) {
        const targetAccount = await db.get(
          `SELECT id FROM accounts 
           WHERE id = ? AND office_id = ? AND status = 'active'`,
          [parsedSelectedAccountId, account.office_id]
        );

        if (!targetAccount) {
          return res.status(403).json({ error: '해당 계정에 접근 권한이 없습니다.' });
        }

        req.user.selectedAccountId = parsedSelectedAccountId;
        req.user.filterAccountId = parsedSelectedAccountId;
      } else {
        req.user.filterAccountId = null; // 계정 필터 없음 (사무실 내 전체)
      }
    } else {
      // 일반 사용자는 자신의 계정 데이터만 접근 가능
      req.user.filterAccountId = account.id;
      req.user.filterOfficeId = account.office_id || null;
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '토큰이 만료되었습니다.' });
    }
    
    console.error('인증 미들웨어 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};

// 슈퍼관리자 권한 확인 미들웨어
const requireSuperAdmin = (req, res, next) => {
  if (req.user.accountType !== 'super_admin') {
    return res.status(403).json({ error: '슈퍼관리자 권한이 필요합니다.' });
  }
  next();
};

// 본인 또는 슈퍼관리자만 접근 가능한 리소스 확인
const requireOwnerOrSuperAdmin = (resourceOwnerIdField = 'userId') => {
  return (req, res, next) => {
    const resourceOwnerId = req.params[resourceOwnerIdField] || req.body[resourceOwnerIdField];
    
    if (req.user.accountType === 'super_admin' || req.user.accountId == resourceOwnerId) {
      next();
    } else {
      res.status(403).json({ error: '접근 권한이 없습니다.' });
    }
  };
};

module.exports = {
  auth,
  requireSuperAdmin,
  requireOwnerOrSuperAdmin
};
