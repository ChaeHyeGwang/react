// drbet_records의 실제 데이터 범위 확인

const db = require('../database/db');

async function checkDataRange() {
  try {
    console.log('📊 DR벳 데이터 범위 확인 중...\n');
    
    // 전체 레코드 수
    const totalCount = await db.get('SELECT COUNT(*) as count FROM drbet_records');
    console.log(`📝 전체 DR벳 레코드: ${totalCount.count}개\n`);
    
    if (totalCount.count === 0) {
      console.log('⚠️ DR벳 데이터가 하나도 없습니다!');
      process.exit(0);
      return;
    }
    
    // 가장 오래된 날짜와 최신 날짜
    const dateRange = await db.get(`
      SELECT 
        MIN(record_date) as oldest_date,
        MAX(record_date) as newest_date
      FROM drbet_records
    `);
    
    console.log('📅 데이터 기간:');
    console.log(`   가장 오래된 날짜: ${dateRange.oldest_date}`);
    console.log(`   가장 최신 날짜: ${dateRange.newest_date}\n`);
    
    // 날짜별 레코드 수 (최근 30일)
    const recentData = await db.all(`
      SELECT 
        record_date,
        COUNT(*) as count
      FROM drbet_records
      GROUP BY record_date
      ORDER BY record_date DESC
      LIMIT 30
    `);
    
    console.log('📊 최근 데이터 (최대 30일):');
    recentData.forEach(row => {
      console.log(`   ${row.record_date}: ${row.count}개 레코드`);
    });
    
    // 12월 데이터 확인
    const decemberData = await db.all(`
      SELECT 
        record_date,
        COUNT(*) as count
      FROM drbet_records
      WHERE record_date >= '2024-12-01' AND record_date < '2025-01-01'
      GROUP BY record_date
      ORDER BY record_date
    `);
    
    if (decemberData.length > 0) {
      console.log('\n📅 12월 데이터:');
      decemberData.forEach(row => {
        console.log(`   ${row.record_date}: ${row.count}개 레코드`);
      });
      
      const firstDate = decemberData[0].record_date;
      console.log(`\n💡 마이그레이션 권장 시작 날짜: ${firstDate}`);
    } else {
      console.log('\n⚠️ 12월 데이터가 없습니다.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 확인 실패:', error);
    process.exit(1);
  }
}

checkDataRange();

