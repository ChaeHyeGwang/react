const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'management_system.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('데이터베이스 연결 실패:', err.message);
  } else {
    console.log('✅ SQLite 데이터베이스 연결 성공');
    fixSettlementsData();
  }
});

async function fixSettlementsData() {
  console.log('\n=== 정산 데이터 정리 시작 ===');
  
  try {
    // 1. 기존 데이터 백업
    console.log('1. 기존 데이터 백업 중...');
    const oldData = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM settlements', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    console.log(`✅ 기존 데이터 ${oldData.length}개 백업 완료`);

    // 2. 기존 테이블 삭제
    console.log('2. 기존 settlements 테이블 삭제 중...');
    await new Promise((resolve, reject) => {
      db.run('DROP TABLE IF EXISTS settlements', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('✅ 기존 테이블 삭제 완료');

    // 3. 새로운 스키마로 테이블 생성
    console.log('3. 새로운 스키마로 테이블 생성 중...');
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          year_month TEXT NOT NULL,
          day_number INTEGER NOT NULL,
          ka_amount REAL DEFAULT 0,
          seup TEXT DEFAULT 'X',
          site_content TEXT DEFAULT '',
          user_data TEXT DEFAULT '{}',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(year_month, day_number)
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('✅ 새로운 settlements 테이블 생성 완료');

    // 4. 현재 월(10월) 데이터 초기화
    console.log('4. 현재 월(10월) 데이터 초기화 중...');
    const currentYearMonth = '2025-10';
    const insertPromises = [];
    for (let day = 1; day <= 31; day++) {
      insertPromises.push(
        new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO settlements (year_month, day_number, ka_amount, seup, site_content, user_data) VALUES (?, ?, 0, "X", "", "{}")',
            [currentYearMonth, day],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        })
      );
    }
    await Promise.all(insertPromises);
    console.log(`✅ ${currentYearMonth}월 31일치 데이터 초기화 완료`);

    // 5. 백업된 데이터 복원 (10월 데이터만)
    console.log('5. 백업된 10월 데이터 복원 중...');
    const octoberData = oldData.filter(row => row.year_month === '2025-10');
    const restorePromises = octoberData.map(row => {
      return new Promise((resolve, reject) => {
        db.run(
          `UPDATE settlements SET 
           ka_amount = ?, seup = ?, site_content = ?, user_data = ?, updated_at = ?
           WHERE year_month = ? AND day_number = ?`,
          [
            row.ka_amount,
            row.seup,
            row.site_content,
            row.user_data,
            row.updated_at,
            row.year_month,
            row.day_number
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
    await Promise.all(restorePromises);
    console.log(`✅ ${octoberData.length}개 10월 데이터 복원 완료`);

    console.log('🎉 정산 데이터 정리 완료!');
    console.log('이제 각 월마다 독립적인 데이터를 가집니다.');
    
  } catch (error) {
    console.error('❌ 정산 데이터 정리 실패:', error.message);
  } finally {
    db.close();
  }
}
