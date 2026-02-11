/**
 * 특정 계정 데이터 복원 스크립트
 * 
 * 백업 DB에서 특정 계정(display_name 또는 username)과 관련된 모든 데이터를
 * 현재 프로덕션 DB로 복원합니다.
 * 
 * 사용법:
 *   node tools/restore-account.js --name "강승진" --backup backups/auto_backup_2026-02-09.db --dry-run
 *   node tools/restore-account.js --name "강승진" --backup backups/auto_backup_2026-02-09.db
 * 
 * 프로덕션 DB:
 *   node tools/restore-account.js --name "강승진" --backup backups/auto_backup_2026-02-09.db --prod
 *   (--prod 플래그: management_system_prod.db 사용)
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// ─── DB 헬퍼 ──────────────────────────────────────
function openDB(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ DB 파일을 찾을 수 없습니다: ${dbPath}`);
    process.exit(1);
  }
  return new sqlite3.Database(dbPath);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows || []);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row || null);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

// ─── 메인 ──────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isProd = args.includes('--prod');

  const nameIdx = args.indexOf('--name');
  const backupIdx = args.indexOf('--backup');

  if (nameIdx < 0 || backupIdx < 0) {
    console.log('사용법: node tools/restore-account.js --name "이름" --backup 백업파일경로 [--prod] [--dry-run]');
    console.log('');
    console.log('옵션:');
    console.log('  --name     복원할 계정의 display_name 또는 username');
    console.log('  --backup   백업 DB 파일 경로 (예: backups/auto_backup_2026-02-09.db)');
    console.log('  --prod     management_system_prod.db 사용 (기본: management_system.db)');
    console.log('  --dry-run  미리보기만 (DB 변경 없음)');
    console.log('');
    console.log('백업 파일 목록 확인:');
    console.log('  ls -la server/backups/');
    process.exit(0);
  }

  const targetName = args[nameIdx + 1];
  const backupFile = args[backupIdx + 1];

  const dbFileName = isProd ? 'management_system_prod.db' : 'management_system.db';
  const currentDbPath = path.join(__dirname, '..', 'database', dbFileName);
  const backupDbPath = path.resolve(backupFile);

  console.log('═══════════════════════════════════════════');
  console.log('  계정 데이터 복원 스크립트');
  console.log('═══════════════════════════════════════════');
  console.log(`  🎯 복원 대상: "${targetName}"`);
  console.log(`  📂 백업 DB:   ${backupDbPath}`);
  console.log(`  📂 현재 DB:   ${currentDbPath}`);
  if (isDryRun) console.log('  ⚠️  DRY-RUN 모드 (DB 변경 없음)');
  console.log('═══════════════════════════════════════════\n');

  const backupDb = openDB(backupDbPath);
  const currentDb = openDB(currentDbPath);

  try {
    // ── 1단계: 백업 DB에서 계정 찾기 ──
    const account = await get(backupDb,
      `SELECT * FROM accounts WHERE display_name = ? OR username = ?`,
      [targetName, targetName]
    );

    if (!account) {
      console.error(`❌ 백업 DB에서 "${targetName}" 계정을 찾을 수 없습니다.`);
      const allAccounts = await all(backupDb, `SELECT id, username, display_name FROM accounts`);
      console.log('\n📋 백업 DB에 있는 계정 목록:');
      allAccounts.forEach(a => console.log(`  ID:${a.id} | ${a.username} | ${a.display_name}`));
      process.exit(1);
    }

    const accountId = account.id;
    console.log(`✅ 백업 DB에서 계정 발견:`);
    console.log(`   ID: ${accountId}`);
    console.log(`   username: ${account.username}`);
    console.log(`   display_name: ${account.display_name}`);
    console.log(`   account_type: ${account.account_type}`);
    console.log(`   office_id: ${account.office_id || '없음'}\n`);

    // ── 2단계: 현재 DB에 해당 계정이 있는지 확인 ──
    const existingAccount = await get(currentDb,
      `SELECT id FROM accounts WHERE id = ?`, [accountId]
    );

    const results = {};

    // ── 3단계: accounts 테이블 복원 ──
    if (!existingAccount) {
      console.log('📌 accounts: 계정 레코드 복원');
      const cols = Object.keys(account);
      const placeholders = cols.map(() => '?').join(', ');
      const vals = cols.map(c => account[c]);
      if (!isDryRun) {
        await run(currentDb,
          `INSERT OR REPLACE INTO accounts (${cols.join(', ')}) VALUES (${placeholders})`, vals
        );
      }
      results.accounts = 1;
    } else {
      console.log('📌 accounts: 이미 존재 (스킵)');
      results.accounts = 0;
    }

    // ── 4단계: 관련 테이블 데이터 복원 ──
    // account_id로 연결된 테이블 목록
    const accountIdTables = [
      { name: 'identities', label: '명의' },
      { name: 'drbet_records', label: 'DR벳 기록' },
      { name: 'settlements', label: '정산' },
      { name: 'site_attendance_log', label: '출석 로그' },
      { name: 'site_attendance', label: '출석 현황' },
      { name: 'finish_data', label: '마무리 데이터' },
      { name: 'finish_summary', label: '마무리 요약' },
      { name: 'start_data', label: '시작 데이터' },
      { name: 'start_summary', label: '시작 요약' },
      { name: 'calendar_events', label: '캘린더' },
      { name: 'sessions', label: '세션' },
    ];

    for (const table of accountIdTables) {
      try {
        // 백업 DB에 테이블이 있는지 확인
        const tableExists = await get(backupDb,
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table.name]
        );
        if (!tableExists) {
          console.log(`⏭️  ${table.label} (${table.name}): 테이블 없음 - 스킵`);
          continue;
        }

        // 백업 DB에서 해당 계정의 데이터 조회
        const rows = await all(backupDb,
          `SELECT * FROM ${table.name} WHERE account_id = ?`, [accountId]
        );

        if (rows.length === 0) {
          console.log(`⏭️  ${table.label} (${table.name}): 0건 - 스킵`);
          results[table.name] = 0;
          continue;
        }

        if (!isDryRun) {
          let inserted = 0;
          for (const row of rows) {
            const cols = Object.keys(row);
            const placeholders = cols.map(() => '?').join(', ');
            const vals = cols.map(c => row[c]);
            try {
              await run(currentDb,
                `INSERT OR REPLACE INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})`, vals
              );
              inserted++;
            } catch (e) {
              // 개별 행 실패 시 로그만 남기고 계속
              console.warn(`   ⚠️ ${table.name} 행 삽입 실패:`, e.message);
            }
          }
          console.log(`✅ ${table.label} (${table.name}): ${inserted}/${rows.length}건 복원`);
          results[table.name] = inserted;
        } else {
          console.log(`📝 ${table.label} (${table.name}): ${rows.length}건 복원 예정`);
          results[table.name] = rows.length;
        }
      } catch (e) {
        console.warn(`⚠️ ${table.label} (${table.name}): 오류 - ${e.message}`);
        results[table.name] = 0;
      }
    }

    // ── 5단계: identities 기반 site_accounts 복원 ──
    try {
      const identities = await all(backupDb,
        `SELECT id FROM identities WHERE account_id = ?`, [accountId]
      );

      if (identities.length > 0) {
        const identityIds = identities.map(i => i.id);
        const placeholders = identityIds.map(() => '?').join(', ');

        const siteAccounts = await all(backupDb,
          `SELECT * FROM site_accounts WHERE identity_id IN (${placeholders})`, identityIds
        );

        if (siteAccounts.length > 0) {
          if (!isDryRun) {
            let inserted = 0;
            for (const row of siteAccounts) {
              const cols = Object.keys(row);
              const ph = cols.map(() => '?').join(', ');
              const vals = cols.map(c => row[c]);
              try {
                await run(currentDb,
                  `INSERT OR REPLACE INTO site_accounts (${cols.join(', ')}) VALUES (${ph})`, vals
                );
                inserted++;
              } catch (e) {
                console.warn(`   ⚠️ site_accounts 행 삽입 실패:`, e.message);
              }
            }
            console.log(`✅ 사이트 계정 (site_accounts): ${inserted}/${siteAccounts.length}건 복원`);
            results.site_accounts = inserted;
          } else {
            console.log(`📝 사이트 계정 (site_accounts): ${siteAccounts.length}건 복원 예정`);
            results.site_accounts = siteAccounts.length;
          }
        } else {
          console.log(`⏭️  사이트 계정 (site_accounts): 0건 - 스킵`);
          results.site_accounts = 0;
        }

        // communities 복원 (identity_name 기반)
        const identityNames = await all(backupDb,
          `SELECT name FROM identities WHERE account_id = ?`, [accountId]
        );
        if (identityNames.length > 0) {
          const names = identityNames.map(i => i.name);
          const namePh = names.map(() => '?').join(', ');
          const communities = await all(backupDb,
            `SELECT * FROM communities WHERE account_id = ? OR identity_name IN (${namePh})`,
            [accountId, ...names]
          );

          if (communities.length > 0) {
            if (!isDryRun) {
              let inserted = 0;
              for (const row of communities) {
                const cols = Object.keys(row);
                const ph = cols.map(() => '?').join(', ');
                const vals = cols.map(c => row[c]);
                try {
                  await run(currentDb,
                    `INSERT OR REPLACE INTO communities (${cols.join(', ')}) VALUES (${ph})`, vals
                  );
                  inserted++;
                } catch (e) {
                  console.warn(`   ⚠️ communities 행 삽입 실패:`, e.message);
                }
              }
              console.log(`✅ 커뮤니티 (communities): ${inserted}/${communities.length}건 복원`);
            } else {
              console.log(`📝 커뮤니티 (communities): ${communities.length}건 복원 예정`);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ site_accounts/communities 복원 오류:`, e.message);
    }

    // ── 요약 ──
    console.log('\n═══════════════════════════════════════════');
    if (isDryRun) {
      const totalItems = Object.values(results).reduce((a, b) => a + b, 0);
      console.log(`  🔍 DRY-RUN 완료: 총 ${totalItems}건 복원 예정`);
      console.log('  실제 적용하려면 --dry-run 없이 실행하세요');
    } else {
      console.log(`  ✅ "${targetName}" 계정 데이터 복원 완료`);
      for (const [key, count] of Object.entries(results)) {
        if (count > 0) console.log(`     ${key}: ${count}건`);
      }
    }
    console.log('═══════════════════════════════════════════');

  } catch (error) {
    console.error('❌ 복원 실패:', error);
    process.exit(1);
  } finally {
    backupDb.close();
    currentDb.close();
  }

  process.exit(0);
})();
