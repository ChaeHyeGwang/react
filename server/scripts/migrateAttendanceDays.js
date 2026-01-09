/**
 * 출석일 마이그레이션 스크립트
 * 
 * site_attendance_log 테이블의 로그를 기반으로 
 * site_attendance 테이블의 attendance_days(연속 출석일)를 재계산합니다.
 * 
 * 실행 방법:
 *   cd server
 *   node scripts/migrateAttendanceDays.js
 * 
 * 옵션:
 *   --dry-run : 실제 업데이트 없이 시뮬레이션만 수행
 *   --account=ID : 특정 계정만 처리
 */

const path = require('path');

// 프로젝트 루트 설정 (server 폴더 기준)
const serverDir = path.join(__dirname, '..');
try {
  process.chdir(serverDir);
} catch (e) {
  console.log('작업 디렉토리 변경 실패, 현재 디렉토리 사용:', process.cwd());
}

const db = require(path.join(serverDir, 'database', 'db'));
const { getAccountOfficeId, getSiteNoteData } = require(path.join(serverDir, 'services', 'siteNotesService'));

// 명령줄 인수 파싱
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const accountArg = args.find(a => a.startsWith('--account='));
const SPECIFIC_ACCOUNT = accountArg ? parseInt(accountArg.split('=')[1]) : null;

console.log('='.repeat(60));
console.log('📅 출석일 마이그레이션 스크립트');
console.log('='.repeat(60));
console.log(`모드: ${DRY_RUN ? '🔍 DRY RUN (시뮬레이션)' : '⚡ 실제 업데이트'}`);
if (SPECIFIC_ACCOUNT) console.log(`대상 계정: ${SPECIFIC_ACCOUNT}`);
console.log('');

/**
 * 사이트 설정 조회 (이월 설정)
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
 * 연속 출석일 계산 (이월 설정 반영)
 */
function calcConsecutiveDays(logs, rollover = 'X') {
  if (logs.length === 0) return 0;
  
  const dates = new Set(logs.map(l => l.attendance_date));
  let days = 0;
  let checkDate = logs[0].attendance_date; // 가장 최근 날짜 (DESC 정렬됨)
  
  // 현재 월 계산 (이월 X일 때 월 경계 체크용)
  const lastLogDate = logs[0].attendance_date;
  const currentMonth = lastLogDate.substring(0, 7); // YYYY-MM
  
  while (dates.has(checkDate)) {
    // 이월 X인 경우: 월이 바뀌면 중단
    if (rollover === 'X') {
      const checkMonth = checkDate.substring(0, 7);
      if (checkMonth !== currentMonth) {
        break;
      }
    }
    
    days++;
    const d = new Date(checkDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    checkDate = d.toISOString().split('T')[0];
    if (days > 365) break;
  }
  
  // 이월 O인 경우: 30일 초과 시 순환 (31일 → 1일, 60일 → 30일, 61일 → 1일)
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
    // 1. 모든 고유한 계정/사이트/명의 조합 조회
    let query = `
      SELECT DISTINCT account_id, site_name, identity_name
      FROM site_attendance_log
    `;
    const params = [];
    
    if (SPECIFIC_ACCOUNT) {
      query += ' WHERE account_id = ?';
      params.push(SPECIFIC_ACCOUNT);
    }
    
    query += ' ORDER BY account_id, identity_name, site_name';
    
    const combinations = await db.all(query, params);
    
    console.log(`📊 발견된 출석 조합: ${combinations.length}개\n`);
    
    if (combinations.length === 0) {
      console.log('처리할 출석 데이터가 없습니다.');
      return;
    }
    
    let updated = 0;
    let created = 0;
    let skipped = 0;
    let errors = 0;
    const results = [];
    
    for (const combo of combinations) {
      const { account_id, site_name, identity_name } = combo;
      
      try {
        // 2. 해당 조합의 출석 로그 조회 (날짜 내림차순)
        const logs = await db.all(
          `SELECT attendance_date FROM site_attendance_log
           WHERE account_id = ? AND site_name = ? AND identity_name = ?
           ORDER BY attendance_date DESC`,
          [account_id, site_name, identity_name]
        );
        
        if (logs.length === 0) {
          skipped++;
          continue;
        }
        
        // 3. 이월 설정 조회
        const settings = await getSiteSettings(account_id, site_name, identity_name);
        
        // 4. 연속 출석일 계산
        const calculatedDays = calcConsecutiveDays(logs, settings.rollover);
        const lastAttendanceDate = logs[0].attendance_date;
        
        // 5. Identity ID 조회
        const identity = await db.get(
          'SELECT id FROM identities WHERE account_id = ? AND name = ?',
          [account_id, identity_name]
        );
        
        if (!identity) {
          console.log(`  ⚠️ 명의 없음: ${identity_name} (account_id=${account_id})`);
          skipped++;
          continue;
        }
        
        // 6. Site Account ID 조회
        const siteAccount = await db.get(
          'SELECT id FROM site_accounts WHERE identity_id = ? AND site_name = ?',
          [identity.id, site_name]
        );
        
        if (!siteAccount) {
          console.log(`  ⚠️ 사이트 계정 없음: ${identity_name}/${site_name}`);
          skipped++;
          continue;
        }
        
        // 7. 현재 출석 기록 조회
        const currentAttendance = await db.get(
          `SELECT id, attendance_days FROM site_attendance
           WHERE account_id = ? AND identity_id = ? AND site_account_id = ?
           AND period_type = 'total' AND period_value = 'all'`,
          [account_id, identity.id, siteAccount.id]
        );
        
        const currentDays = currentAttendance?.attendance_days || 0;
        const needsUpdate = currentDays !== calculatedDays;
        
        results.push({
          account_id,
          identity_name,
          site_name,
          current: currentDays,
          calculated: calculatedDays,
          rollover: settings.rollover,
          logs: logs.length,
          status: needsUpdate ? (currentAttendance ? 'UPDATE' : 'CREATE') : 'OK'
        });
        
        if (!needsUpdate) {
          continue; // 이미 정확함
        }
        
        // 8. 업데이트 또는 생성
        if (!DRY_RUN) {
          const timestamp = new Date().toISOString();
          
          if (currentAttendance) {
            await db.run(
              `UPDATE site_attendance
               SET attendance_days = ?, last_recorded_at = ?, updated_at = ?
               WHERE id = ?`,
              [calculatedDays, lastAttendanceDate, timestamp, currentAttendance.id]
            );
            updated++;
          } else {
            await db.run(
              `INSERT INTO site_attendance 
               (account_id, identity_id, site_account_id, period_type, period_value, 
                attendance_days, last_recorded_at, created_at, updated_at)
               VALUES (?, ?, ?, 'total', 'all', ?, ?, ?, ?)`,
              [account_id, identity.id, siteAccount.id, calculatedDays, 
               lastAttendanceDate, timestamp, timestamp]
            );
            created++;
          }
        } else {
          if (currentAttendance) {
            updated++;
          } else {
            created++;
          }
        }
        
      } catch (err) {
        console.error(`  ❌ 오류: ${identity_name}/${site_name} - ${err.message}`);
        errors++;
      }
    }
    
    // 결과 출력
    console.log('\n📋 상세 결과:');
    console.log('-'.repeat(100));
    console.log(
      'Account'.padEnd(8) + 
      '명의'.padEnd(15) + 
      '사이트'.padEnd(20) + 
      '현재'.padEnd(6) + 
      '→'.padEnd(3) +
      '계산'.padEnd(6) + 
      '이월'.padEnd(5) + 
      '로그수'.padEnd(7) +
      '상태'
    );
    console.log('-'.repeat(100));
    
    // 변경이 필요한 것만 출력
    const changedResults = results.filter(r => r.status !== 'OK');
    
    if (changedResults.length === 0) {
      console.log('모든 출석일이 정확합니다! 변경 필요 없음.');
    } else {
      for (const r of changedResults) {
        console.log(
          String(r.account_id).padEnd(8) +
          r.identity_name.padEnd(15) +
          r.site_name.substring(0, 18).padEnd(20) +
          String(r.current).padEnd(6) +
          '→'.padEnd(3) +
          String(r.calculated).padEnd(6) +
          r.rollover.padEnd(5) +
          String(r.logs).padEnd(7) +
          r.status
        );
      }
    }
    
    // 요약
    console.log('\n' + '='.repeat(60));
    console.log('📊 마이그레이션 요약');
    console.log('='.repeat(60));
    console.log(`총 조합 수: ${combinations.length}`);
    console.log(`정확한 항목: ${results.filter(r => r.status === 'OK').length}`);
    console.log(`업데이트: ${updated}`);
    console.log(`새로 생성: ${created}`);
    console.log(`스킵: ${skipped}`);
    console.log(`오류: ${errors}`);
    
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

