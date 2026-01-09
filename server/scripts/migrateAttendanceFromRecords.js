/**
 * 출석 로그 마이그레이션 스크립트 (drbet_records 기반)
 * 
 * drbet_records 테이블의 충전금액을 기반으로:
 * 1. 누락된 출석 로그를 site_attendance_log에 추가
 * 2. site_attendance 테이블의 attendance_days를 재계산
 * 
 * 실행 방법:
 *   cd server
 *   node scripts/migrateAttendanceFromRecords.js --dry-run
 *   node scripts/migrateAttendanceFromRecords.js
 * 
 * 옵션:
 *   --dry-run : 실제 변경 없이 시뮬레이션만 수행
 *   --account=ID : 특정 계정만 처리
 *   --from=YYYY-MM-DD : 시작 날짜 (기본: 2026-01-01)
 *   --to=YYYY-MM-DD : 종료 날짜 (기본: 오늘)
 */

const path = require('path');
const serverDir = path.join(__dirname, '..');

const db = require(path.join(serverDir, 'database', 'db'));
const { getAccountOfficeId, getSiteNoteData } = require(path.join(serverDir, 'services', 'siteNotesService'));

// 명령줄 인수 파싱
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const accountArg = args.find(a => a.startsWith('--account='));
const fromArg = args.find(a => a.startsWith('--from='));
const toArg = args.find(a => a.startsWith('--to='));

const SPECIFIC_ACCOUNT = accountArg ? parseInt(accountArg.split('=')[1]) : null;
const FROM_DATE = fromArg ? fromArg.split('=')[1] : '2026-01-01';
const TO_DATE = toArg ? toArg.split('=')[1] : new Date().toISOString().split('T')[0];

console.log('='.repeat(70));
console.log('📅 출석 로그 마이그레이션 스크립트 (drbet_records 기반)');
console.log('='.repeat(70));
console.log(`모드: ${DRY_RUN ? '🔍 DRY RUN (시뮬레이션)' : '⚡ 실제 업데이트'}`);
console.log(`기간: ${FROM_DATE} ~ ${TO_DATE}`);
if (SPECIFIC_ACCOUNT) console.log(`대상 계정: ${SPECIFIC_ACCOUNT}`);
console.log('');

/**
 * 충전금액 파싱 (첫 번째 숫자 추출)
 */
function parseCharge(value) {
  if (!value) return 0;
  const str = String(value).trim();
  const match = str.match(/^(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * 사이트 설정 조회 (출석타입, 이월 설정)
 */
async function getSiteSettings(accountId, siteName, identityName) {
  try {
    const officeId = await getAccountOfficeId(accountId);
    const notes = await getSiteNoteData({ siteName, identityName, accountId, officeId });
    return {
      attendanceType: notes?.data?.attendanceType || '자동',
      rollover: notes?.data?.rollover || 'X'
    };
  } catch (e) {
    return { attendanceType: '자동', rollover: 'X' };
  }
}

/**
 * 출석 로그 존재 여부 확인
 */
async function logExists(accountId, siteName, identityName, date) {
  const row = await db.get(
    `SELECT id FROM site_attendance_log 
     WHERE account_id = ? AND site_name = ? AND identity_name = ? AND attendance_date = ?`,
    [accountId, siteName, identityName, date]
  );
  return !!row;
}

/**
 * 출석 로그 추가
 */
async function addLog(accountId, siteName, identityName, date) {
  try {
    await db.run(
      `INSERT INTO site_attendance_log (account_id, site_name, identity_name, attendance_date, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [accountId, siteName, identityName, date]
    );
    return true;
  } catch (e) {
    if (e.message.includes('UNIQUE constraint')) {
      return false; // 이미 존재
    }
    throw e;
  }
}

/**
 * 연속 출석일 계산
 */
function calcConsecutiveDays(logs, rollover = 'X') {
  if (logs.length === 0) return 0;
  
  const dates = new Set(logs.map(l => l.attendance_date));
  let days = 0;
  let checkDate = logs[0].attendance_date;
  const currentMonth = checkDate.substring(0, 7);
  
  while (dates.has(checkDate)) {
    if (rollover === 'X') {
      const checkMonth = checkDate.substring(0, 7);
      if (checkMonth !== currentMonth) break;
    }
    
    days++;
    const d = new Date(checkDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    checkDate = d.toISOString().split('T')[0];
    if (days > 365) break;
  }
  
  if (rollover === 'O' && days > 30) {
    const remainder = days % 30;
    return remainder === 0 ? 30 : remainder;
  }
  
  return days;
}

/**
 * 메인 마이그레이션 함수
 */
async function migrate() {
  try {
    // 1. drbet_records에서 충전금액이 있는 레코드 조회
    let query = `
      SELECT DISTINCT 
        r.account_id,
        r.record_date,
        r.identity1, r.site_name1, r.charge_withdraw1,
        r.identity2, r.site_name2, r.charge_withdraw2,
        r.identity3, r.site_name3, r.charge_withdraw3,
        r.identity4, r.site_name4, r.charge_withdraw4
      FROM drbet_records r
      WHERE r.record_date >= ? AND r.record_date <= ?
    `;
    const params = [FROM_DATE, TO_DATE];
    
    if (SPECIFIC_ACCOUNT) {
      query += ' AND r.account_id = ?';
      params.push(SPECIFIC_ACCOUNT);
    }
    
    query += ' ORDER BY r.record_date, r.account_id';
    
    const records = await db.all(query, params);
    console.log(`📊 조회된 레코드: ${records.length}개\n`);
    
    if (records.length === 0) {
      console.log('처리할 레코드가 없습니다.');
      return;
    }
    
    // 2. 각 레코드에서 사이트/명의/충전금액 추출
    const missingLogs = []; // 누락된 로그 목록
    let checkedCount = 0;
    let skippedManual = 0;
    let alreadyExists = 0;
    
    for (const record of records) {
      for (let i = 1; i <= 4; i++) {
        const identityName = (record[`identity${i}`] || '').trim();
        const siteName = (record[`site_name${i}`] || '').trim();
        const chargeWithdraw = record[`charge_withdraw${i}`] || '';
        const charge = parseCharge(chargeWithdraw);
        
        if (!identityName || !siteName) continue;
        
        checkedCount++;
        
        // 충전금액이 0이면 스킵
        if (charge <= 0) continue;
        
        // 출석타입 확인 (수동이면 스킵)
        const settings = await getSiteSettings(record.account_id, siteName, identityName);
        if (settings.attendanceType !== '자동') {
          skippedManual++;
          continue;
        }
        
        // 이미 로그가 있는지 확인
        const exists = await logExists(record.account_id, siteName, identityName, record.record_date);
        if (exists) {
          alreadyExists++;
          continue;
        }
        
        // 누락된 로그 추가
        missingLogs.push({
          account_id: record.account_id,
          identity_name: identityName,
          site_name: siteName,
          date: record.record_date,
          charge: charge,
          rollover: settings.rollover
        });
      }
    }
    
    console.log(`📋 분석 결과:`);
    console.log(`  - 확인한 항목: ${checkedCount}개`);
    console.log(`  - 이미 로그 있음: ${alreadyExists}개`);
    console.log(`  - 수동 출석 (스킵): ${skippedManual}개`);
    console.log(`  - 누락된 로그: ${missingLogs.length}개\n`);
    
    if (missingLogs.length === 0) {
      console.log('✅ 누락된 출석 로그가 없습니다!');
      return;
    }
    
    // 3. 누락된 로그 상세 출력
    console.log('📝 누락된 출석 로그:');
    console.log('-'.repeat(80));
    console.log(
      'Account'.padEnd(8) +
      '날짜'.padEnd(12) +
      '명의'.padEnd(15) +
      '사이트'.padEnd(20) +
      '충전'.padEnd(10) +
      '이월'
    );
    console.log('-'.repeat(80));
    
    for (const log of missingLogs) {
      console.log(
        String(log.account_id).padEnd(8) +
        log.date.padEnd(12) +
        log.identity_name.padEnd(15) +
        log.site_name.substring(0, 18).padEnd(20) +
        String(log.charge).padEnd(10) +
        log.rollover
      );
    }
    
    // 4. DRY RUN이 아니면 실제 로그 추가
    let addedLogs = 0;
    let failedLogs = 0;
    
    if (!DRY_RUN) {
      console.log('\n🔄 로그 추가 중...');
      
      for (const log of missingLogs) {
        try {
          const added = await addLog(log.account_id, log.site_name, log.identity_name, log.date);
          if (added) addedLogs++;
        } catch (e) {
          console.error(`  ❌ 오류: ${log.identity_name}/${log.site_name}/${log.date} - ${e.message}`);
          failedLogs++;
        }
      }
      
      console.log(`\n✅ 로그 추가 완료: ${addedLogs}개 (실패: ${failedLogs}개)`);
    }
    
    // 5. 출석일 재계산
    console.log('\n🔄 출석일 재계산 중...');
    
    // 영향받는 조합 추출 (중복 제거)
    const affectedCombos = new Map();
    for (const log of missingLogs) {
      const key = `${log.account_id}||${log.site_name}||${log.identity_name}`;
      if (!affectedCombos.has(key)) {
        affectedCombos.set(key, {
          account_id: log.account_id,
          site_name: log.site_name,
          identity_name: log.identity_name,
          rollover: log.rollover
        });
      }
    }
    
    console.log(`  - 재계산 대상: ${affectedCombos.size}개 조합\n`);
    
    let recalculated = 0;
    const recalcResults = [];
    
    for (const [key, combo] of affectedCombos) {
      try {
        // 출석 로그 조회
        const logs = await db.all(
          `SELECT attendance_date FROM site_attendance_log
           WHERE account_id = ? AND site_name = ? AND identity_name = ?
           ORDER BY attendance_date DESC`,
          [combo.account_id, combo.site_name, combo.identity_name]
        );
        
        const calculatedDays = calcConsecutiveDays(logs, combo.rollover);
        const lastDate = logs.length > 0 ? logs[0].attendance_date : null;
        
        // Identity ID 조회
        const identity = await db.get(
          'SELECT id FROM identities WHERE account_id = ? AND name = ?',
          [combo.account_id, combo.identity_name]
        );
        
        if (!identity) {
          console.log(`  ⚠️ 명의 없음: ${combo.identity_name}`);
          continue;
        }
        
        // Site Account ID 조회
        const siteAccount = await db.get(
          'SELECT id FROM site_accounts WHERE identity_id = ? AND site_name = ?',
          [identity.id, combo.site_name]
        );
        
        if (!siteAccount) {
          console.log(`  ⚠️ 사이트 계정 없음: ${combo.identity_name}/${combo.site_name}`);
          continue;
        }
        
        // 현재 출석 기록 조회
        const currentAttendance = await db.get(
          `SELECT id, attendance_days FROM site_attendance
           WHERE account_id = ? AND identity_id = ? AND site_account_id = ?
           AND period_type = 'total' AND period_value = 'all'`,
          [combo.account_id, identity.id, siteAccount.id]
        );
        
        const currentDays = currentAttendance?.attendance_days || 0;
        
        recalcResults.push({
          identity_name: combo.identity_name,
          site_name: combo.site_name,
          before: currentDays,
          after: calculatedDays,
          logs: logs.length,
          rollover: combo.rollover
        });
        
        // 업데이트
        if (!DRY_RUN && calculatedDays !== currentDays) {
          const timestamp = new Date().toISOString();
          
          if (currentAttendance) {
            await db.run(
              `UPDATE site_attendance
               SET attendance_days = ?, last_recorded_at = ?, updated_at = ?
               WHERE id = ?`,
              [calculatedDays, lastDate, timestamp, currentAttendance.id]
            );
          } else {
            await db.run(
              `INSERT INTO site_attendance 
               (account_id, identity_id, site_account_id, period_type, period_value, 
                attendance_days, last_recorded_at, created_at, updated_at)
               VALUES (?, ?, ?, 'total', 'all', ?, ?, ?, ?)`,
              [combo.account_id, identity.id, siteAccount.id, calculatedDays, 
               lastDate, timestamp, timestamp]
            );
          }
          recalculated++;
        }
        
      } catch (e) {
        console.error(`  ❌ 재계산 오류: ${combo.identity_name}/${combo.site_name} - ${e.message}`);
      }
    }
    
    // 6. 재계산 결과 출력
    console.log('📊 출석일 재계산 결과:');
    console.log('-'.repeat(70));
    console.log(
      '명의'.padEnd(15) +
      '사이트'.padEnd(20) +
      '이전'.padEnd(6) +
      '→'.padEnd(3) +
      '이후'.padEnd(6) +
      '로그수'.padEnd(8) +
      '이월'
    );
    console.log('-'.repeat(70));
    
    for (const r of recalcResults) {
      const changed = r.before !== r.after;
      const marker = changed ? '✅' : '  ';
      console.log(
        marker +
        r.identity_name.padEnd(13) +
        r.site_name.substring(0, 18).padEnd(20) +
        String(r.before).padEnd(6) +
        '→'.padEnd(3) +
        String(r.after).padEnd(6) +
        String(r.logs).padEnd(8) +
        r.rollover
      );
    }
    
    // 7. 요약
    console.log('\n' + '='.repeat(70));
    console.log('📊 마이그레이션 요약');
    console.log('='.repeat(70));
    console.log(`누락된 로그: ${missingLogs.length}개`);
    if (!DRY_RUN) {
      console.log(`추가된 로그: ${addedLogs}개`);
      console.log(`출석일 업데이트: ${recalculated}개`);
    }
    
    const changedCount = recalcResults.filter(r => r.before !== r.after).length;
    console.log(`변경된 출석일: ${changedCount}개`);
    
    if (DRY_RUN) {
      console.log('\n⚠️ DRY RUN 모드입니다. 실제 변경은 적용되지 않았습니다.');
      console.log('실제 마이그레이션을 수행하려면 --dry-run 옵션을 제거하세요.');
    } else {
      console.log('\n✅ 마이그레이션 완료!');
    }
    
  } catch (error) {
    console.error('마이그레이션 실패:', error);
    process.exit(1);
  }
}

// 실행
migrate()
  .then(() => {
    console.log('\n스크립트 종료.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('예상치 못한 오류:', err);
    process.exit(1);
  });

