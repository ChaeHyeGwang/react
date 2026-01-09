const bcrypt = require('bcryptjs');
const DatabaseManager = require('../database/db');

// 계정 정보
const account = {
  username: 'haribo',
  password: 'haribo',
  display_name: '하리보',
  account_type: 'user' // 'user' 또는 'super_admin'
};

async function addAccount() {
  const db = new DatabaseManager();
  
  try {
    // 데이터베이스 초기화 대기
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // 비밀번호 해시
    const hashedPassword = bcrypt.hashSync(account.password, 10);
    const createdDate = new Date().toISOString();

    // 계정 추가
    const result = await db.run(
      `INSERT OR IGNORE INTO accounts (username, password_hash, display_name, account_type, created_date, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [account.username, hashedPassword, account.display_name, account.account_type, createdDate, 'active']
    );

    console.log(`✅ 계정 추가 성공: ${account.username} (${account.display_name})`);
    console.log(`   사용자명: ${account.username}`);
    console.log(`   계정명: ${account.display_name}`);
    console.log(`   계정 타입: ${account.account_type}`);
    
    // 데이터베이스 연결 종료
    db.close();
    process.exit(0);
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      console.error(`❌ 계정 추가 실패: 사용자명 '${account.username}'이 이미 존재합니다.`);
    } else {
      console.error(`❌ 계정 추가 실패:`, error.message || error);
    }
    db.close();
    process.exit(1);
  }
}

addAccount();

