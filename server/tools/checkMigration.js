// 마이그레이션 상태 확인 스크립트

const db = require('../database/db');

async function checkMigrationStatus() {
  try {
    console.log('📊 마이그레이션 상태 확인 중...\n');
    
    // 1. migrations 테이블 확인
    try {
      const migrations = await db.all('SELECT * FROM migrations');
      
      if (migrations.length === 0) {
        console.log('ℹ️ 실행된 마이그레이션이 없습니다.');
      } else {
        console.log('✅ 실행된 마이그레이션 목록:');
        migrations.forEach((m, idx) => {
          console.log(`   ${idx + 1}. ${m.name}`);
          console.log(`      실행 시각: ${m.executed_at}\n`);
        });
      }
    } catch (error) {
      console.log('ℹ️ migrations 테이블이 아직 생성되지 않았습니다.');
      console.log('   (마이그레이션이 한 번도 실행되지 않음)\n');
    }
    
    // 2. site_attendance_log 테이블 확인
    try {
      const attendanceCount = await db.get(`
        SELECT COUNT(*) as count 
        FROM site_attendance_log
        WHERE attendance_date >= '2024-12-01' 
          AND attendance_date <= '2024-12-04'
      `);
      
      console.log(`📅 12월 1일~4일 출석 로그: ${attendanceCount.count}개`);
      
      if (attendanceCount.count > 0) {
        // 날짜별 통계
        const dateStats = await db.all(`
          SELECT 
            attendance_date,
            COUNT(*) as count
          FROM site_attendance_log
          WHERE attendance_date >= '2024-12-01' 
            AND attendance_date <= '2024-12-04'
          GROUP BY attendance_date
          ORDER BY attendance_date
        `);
        
        console.log('\n날짜별 출석 로그:');
        dateStats.forEach(stat => {
          console.log(`   ${stat.attendance_date}: ${stat.count}개`);
        });
      }
    } catch (error) {
      console.log('⚠️ site_attendance_log 테이블 조회 실패:', error.message);
    }
    
    // 3. drbet_records 확인
    try {
      const drbetCount = await db.get(`
        SELECT COUNT(*) as count 
        FROM drbet_records
        WHERE record_date >= '2024-12-01' 
          AND record_date <= '2024-12-04'
      `);
      
      console.log(`\n📊 12월 1일~4일 DR벳 레코드: ${drbetCount.count}개`);
    } catch (error) {
      console.log('⚠️ drbet_records 테이블 조회 실패:', error.message);
    }
    
    console.log('\n---');
    console.log('💡 마이그레이션을 다시 실행하려면:');
    console.log('   node server/tools/resetMigration.js');
    console.log('   그 다음 서버 재시작');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 확인 실패:', error);
    process.exit(1);
  }
}

checkMigrationStatus();

