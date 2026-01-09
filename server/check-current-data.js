const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'management_system.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('데이터베이스 연결 실패:', err.message);
  } else {
    console.log('✅ SQLite 데이터베이스 연결 성공');
    checkAllData();
  }
});

function checkAllData() {
  console.log('\n=== 전체 정산 데이터 확인 ===');
  db.all('SELECT id, year_month, day_number, ka_amount FROM settlements ORDER BY year_month, day_number', (err, rows) => {
    if (err) {
      console.error('데이터 조회 실패:', err.message);
    } else {
      console.log('전체 데이터:');
      rows.forEach(row => {
        console.log(`  ID=${row.id}, 월=${row.year_month}, 일=${row.day_number}, 금액=${row.ka_amount}`);
      });
      
      console.log('\n=== 1일 데이터만 확인 ===');
      const day1Data = rows.filter(row => row.day_number === 1);
      day1Data.forEach(row => {
        console.log(`  ID=${row.id}, 월=${row.year_month}, 일=${row.day_number}, 금액=${row.ka_amount}`);
      });
      
      console.log('\n=== 3일 데이터만 확인 ===');
      const day3Data = rows.filter(row => row.day_number === 3);
      day3Data.forEach(row => {
        console.log(`  ID=${row.id}, 월=${row.year_month}, 일=${row.day_number}, 금액=${row.ka_amount}`);
      });
    }
    
    db.close();
  });
}
