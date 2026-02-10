/**
 * 출석 데이터 마이그레이션 스크립트 (프로덕션 DB 전용)
 * 
 * management_system_prod.db를 직접 연결하여 실행합니다.
 * db.js 모듈에 의존하지 않는 독립 실행형 스크립트입니다.
 * 
 * 사용법:
 *   node tools/migrate-attendance-prod.js --dry-run      (미리보기)
 *   node tools/migrate-attendance-prod.js                (실제 실행)
 *   node tools/migrate-attendance-prod.js --date 2025-11 (특정 년월)
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ─── DB 직접 연결 ──────────────────────────────────
const dbPath = path.join(__dirname, '..', 'database', 'management_system_prod.db');

function openDB() {
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

// ─── 헬퍼 ──────────────────────────────────────────
const KEY_SEP = '|||';

function makeKey(accountId, siteName, identityName) {
  return `${accountId}${KEY_SEP}${siteName}${KEY_SEP}${identityName}`;
}

function parseKey(key) {
  const [accountIdStr, siteName, identityName] = key.split(KEY_SEP);
  return { accountId: parseInt(accountIdStr, 10), siteName, identityName };
}

function parseCharge(value) {
  if (!value) return 0;
  const str = String(value).trim();
  const match = str.match(/^(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function normalizeName(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ');
}

function getPreviousDateKST(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  date.setDate(date.getDate() - 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── 이월 설정 조회 (DB 직접 쿼리) ──────────────────
async function getRollover(db, accountId, siteName) {
  try {
    // 계정의 office_id 조회
    const account = await get(db, 'SELECT office_id FROM accounts WHERE id = ?', [accountId]);
    const officeId = account?.office_id || null;

    // site_notes에서 rollover 설정 조회
    let note = null;
    if (officeId) {
      note = await get(db,
        `SELECT data FROM site_notes WHERE site_name = ? AND office_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [siteName, officeId]
      );
    }
    if (!note) {
      note = await get(db,
        `SELECT data FROM site_notes WHERE site_name = ? AND account_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [siteName, accountId]
      );
    }

    if (note?.data) {
      try {
        const parsed = JSON.parse(note.data);
        if (parsed?.rollover === 'O') return 'O';
      } catch (e) { /* 무시 */ }
    }
  } catch (e) {
    // 기본값 유지
  }
  return 'X';
}

// ─── 메인 ──────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const dateIdx = args.indexOf('--date');
  const dateFilter = dateIdx >= 0 ? args[dateIdx + 1] : null;

  console.log('═══════════════════════════════════════════');
  console.log('  출석 데이터 마이그레이션 (프로덕션 DB)');
  console.log('═══════════════════════════════════════════');
  console.log(`  📁 DB: ${dbPath}`);
  if (isDryRun) console.log('  ⚠️  DRY-RUN 모드 (DB 변경 없음)');
  if (dateFilter) console.log(`  📅 날짜 필터: ${dateFilter}%`);
  console.log('═══════════════════════════════════════════\n');

  const db = openDB();

  try {
    // DB 파일 확인
    const tables = await all(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='drbet_records'`);
    if (tables.length === 0) {
      console.error('❌ drbet_records 테이블이 없습니다. DB 경로를 확인하세요.');
      process.exit(1);
    }

    // ── 1단계: 충전금액이 있는 drbet_records 조회 ──
    let dateCondition = '';
    const params = [];
    if (dateFilter) {
      dateCondition = 'WHERE record_date LIKE ?';
      params.push(`${dateFilter}%`);
    }

    const records = await all(db,
      `SELECT id, account_id, record_date,
              identity1, site_name1, charge_withdraw1,
              identity2, site_name2, charge_withdraw2,
              identity3, site_name3, charge_withdraw3,
              identity4, site_name4, charge_withdraw4
       FROM drbet_records ${dateCondition}
       ORDER BY record_date ASC`,
      params
    );

    console.log(`📋 조회된 drbet_records: ${records.length}건\n`);

    // ── 2단계: 누락된 출석 로그 수집 ──
    let totalSlots = 0;
    let missingLogs = 0;
    let insertedLogs = 0;
    let skippedLogs = 0;
    const affectedSites = new Map();

    for (const record of records) {
      const accountId = record.account_id;
      const date = record.record_date?.split('T')[0]?.split(' ')[0];
      if (!accountId || !date) continue;

      for (let i = 1; i <= 4; i++) {
        const identity = normalizeName(record[`identity${i}`]);
        const siteName = normalizeName(record[`site_name${i}`]);
        const chargeRaw = record[`charge_withdraw${i}`] || '';
        const charge = parseCharge(chargeRaw);

        if (!identity || !siteName || charge <= 0) continue;
        totalSlots++;

        const existing = await get(db,
          `SELECT 1 FROM site_attendance_log 
           WHERE account_id = ? AND site_name = ? AND identity_name = ? AND attendance_date = ?`,
          [accountId, siteName, identity, date]
        );

        if (existing) {
          skippedLogs++;
          continue;
        }

        missingLogs++;
        const key = makeKey(accountId, siteName, identity);
        if (!affectedSites.has(key)) affectedSites.set(key, new Set());
        affectedSites.get(key).add(date);

        if (!isDryRun) {
          await run(db,
            `INSERT OR IGNORE INTO site_attendance_log (account_id, site_name, identity_name, attendance_date, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`,
            [accountId, siteName, identity, date]
          );
          insertedLogs++;
        }
      }
    }

    console.log('── 출석 로그 처리 결과 ──');
    console.log(`  충전 > 0 슬롯:    ${totalSlots}건`);
    console.log(`  이미 존재 (스킵):  ${skippedLogs}건`);
    console.log(`  누락 발견:         ${missingLogs}건`);
    if (!isDryRun) {
      console.log(`  ✅ 추가된 로그:    ${insertedLogs}건`);
    } else {
      console.log(`  📝 추가 예정:      ${missingLogs}건 (dry-run)`);
    }
    console.log(`  영향받는 사이트:   ${affectedSites.size}개\n`);

    // 누락된 로그 상세 출력
    if (missingLogs > 0 && (isDryRun || missingLogs <= 100)) {
      console.log('── 누락된 로그 상세 ──');
      for (const [key, dates] of affectedSites) {
        const { accountId: accId, siteName: site, identityName: identity } = parseKey(key);
        const dateList = Array.from(dates).sort().join(', ');
        console.log(`  계정${accId} | ${identity} / ${site} | 날짜: ${dateList}`);
      }
      console.log('');
    }

    // ── 3단계: 출석일 재계산 ──
    if (!isDryRun && affectedSites.size > 0) {
      console.log('── 출석일 재계산 중... ──');
      let recalculated = 0;
      let skippedNoId = 0;

      for (const [key] of affectedSites) {
        const { accountId, siteName, identityName } = parseKey(key);

        // 이월 설정 조회
        const rollover = await getRollover(db, accountId, siteName);

        // 연속 출석일 계산
        const logs = await all(db,
          `SELECT attendance_date FROM site_attendance_log
           WHERE account_id = ? AND site_name = ? AND identity_name = ?
           ORDER BY attendance_date DESC`,
          [accountId, siteName, identityName]
        );

        const dates = new Set(logs.map(l => l.attendance_date));
        if (dates.size === 0) continue;

        const allDates = Array.from(dates).sort().reverse();
        let checkDate = allDates[0];
        const currentMonth = checkDate.substring(0, 7);

        let days = 0;
        while (dates.has(checkDate)) {
          if (rollover === 'X') {
            const checkMonth = checkDate.substring(0, 7);
            if (checkMonth !== currentMonth) break;
          }
          days++;
          checkDate = getPreviousDateKST(checkDate);
          if (days > 365) break;
        }

        if (rollover === 'O' && days > 30) {
          const remainder = days % 30;
          days = remainder === 0 ? 30 : remainder;
        }

        // identity_id, site_account_id 조회
        const identityRow = await get(db,
          'SELECT id FROM identities WHERE account_id = ? AND name = ?',
          [accountId, identityName]
        );
        if (!identityRow) { skippedNoId++; continue; }

        const siteRow = await get(db,
          'SELECT id FROM site_accounts WHERE identity_id = ? AND site_name = ?',
          [identityRow.id, siteName]
        );
        if (!siteRow) { skippedNoId++; continue; }

        const lastDate = allDates[0];
        await run(db,
          `INSERT OR REPLACE INTO site_attendance 
           (account_id, identity_id, site_account_id, period_type, period_value, attendance_days, last_recorded_at, updated_at)
           VALUES (?, ?, ?, 'total', 'all', ?, ?, datetime('now'))`,
          [accountId, identityRow.id, siteRow.id, days, lastDate]
        );

        recalculated++;
      }

      console.log(`  ✅ 출석일 재계산 완료: ${recalculated}건`);
      if (skippedNoId > 0) {
        console.log(`  ⚠️  명의/사이트 ID 없어서 스킵: ${skippedNoId}건`);
      }
      console.log('');
    }

    // ── 요약 ──
    console.log('═══════════════════════════════════════════');
    if (isDryRun) {
      console.log(`  🔍 DRY-RUN 완료: ${missingLogs}건의 누락 로그 발견`);
      console.log('  실제 적용하려면 --dry-run 없이 실행하세요');
    } else if (insertedLogs > 0) {
      console.log(`  ✅ 마이그레이션 완료: ${insertedLogs}건 로그 추가`);
    } else {
      console.log('  ✅ 누락된 출석 로그가 없습니다');
    }
    console.log('═══════════════════════════════════════════');

  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  } finally {
    db.close();
  }

  process.exit(0);
})();
