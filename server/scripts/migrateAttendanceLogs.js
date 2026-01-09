// DR벳 과거 데이터 → site_attendance_log 마이그레이션 스크립트
// 사용법: 프로젝트 루트에서
//   DB_PATH=server/database/management_system_dev.db node server/scripts/migrateAttendanceLogs.js
//
// ⚠️ 실행 전 반드시 "해당 DB" 백업 권장

const db = require('../database/db');

// -------------------------------
// 계정 추론용 헬퍼 (drbet_records.account_id 사용 + 필요 시 추론)
// -------------------------------

let identityIdToAccountId = null;      // identity_id -> account_id
let identityNameToIdentityIds = null;  // identity_name -> [identity_id]
let pairToAccounts = null;             // (identity_name, site_name) -> Set(account_id)

async function prepareAccountGuessHelpers() {
  if (identityIdToAccountId && identityNameToIdentityIds && pairToAccounts) return;

  console.log('🔍 계정 추론용 기본 데이터 로딩 중...');

  const users = await db.all('SELECT id, account_id FROM users');
  const identities = await db.all('SELECT id, name, user_id FROM identities');
  const sites = await db.all('SELECT identity_id, site_name FROM site_accounts');

  const userIdToAccountId = new Map(users.map(u => [u.id, u.account_id])); // user.id -> account_id
  identityIdToAccountId = new Map();       // identity_id -> account_id
  identityNameToIdentityIds = new Map();   // name -> [identity_id]

  identities.forEach(i => {
    // identity_id -> account_id
    const acc = userIdToAccountId.get(i.user_id);
    if (acc) identityIdToAccountId.set(i.id, acc);

    // identity_name -> [identity_id]
    const name = (i.name || '').trim();
    if (!identityNameToIdentityIds.has(name)) {
      identityNameToIdentityIds.set(name, []);
    }
    identityNameToIdentityIds.get(name).push(i.id);
  });

  // (identityName, siteName) -> Set(account_id)
  pairToAccounts = new Map();
  sites.forEach(s => {
    const acc = identityIdToAccountId.get(s.identity_id);
    if (!acc) return;
    const ident = identities.find(i => i.id === s.identity_id);
    const key = `${(ident?.name || '').trim()}||${(s.site_name || '').trim()}`;
    if (!pairToAccounts.has(key)) pairToAccounts.set(key, new Set());
    pairToAccounts.get(key).add(acc);
  });

  console.log('✅ 계정 추론용 기본 데이터 로딩 완료');
}

function guessAccountIdForRecord(record) {
  // 1순위: 이미 drbet_records.account_id 가 있으면 그대로 사용
  if (record.account_id && Number(record.account_id) > 0) {
    return record.account_id;
  }

  // 2순위: identity / site 조합으로 추론 (backfill-drbet-account-id.js 와 동일한 방식)
  const candidates = new Map(); // account_id -> score

  for (let i = 1; i <= 4; i++) {
    const idn = (record[`identity${i}`] || '').trim();
    const site = (record[`site_name${i}`] || '').trim();
    if (!idn) continue;

    if (idn && site) {
      const key = `${idn}||${site}`;
      const accs = pairToAccounts.get(key);
      if (accs && accs.size > 0) {
        accs.forEach(acc => {
          candidates.set(acc, (candidates.get(acc) || 0) + 3); // identity+site 일치 가중치
        });
      }
    }

    // identity 이름만으로 후보 추가
    const ids = identityNameToIdentityIds.get(idn) || [];
    ids.forEach(identityId => {
      const acc = identityIdToAccountId.get(identityId);
      if (acc) candidates.set(acc, (candidates.get(acc) || 0) + 1);
    });
  }

  // 최다 득표 계정 선택
  let chosen = null;
  let maxScore = -1;
  for (const [acc, score] of candidates.entries()) {
    if (score > maxScore) {
      maxScore = score;
      chosen = acc;
    }
  }

  return chosen; // null 이면 추론 실패
}

// charge_withdraw 문자열에서 "충전" 금액만 추출 (프론트 로직과 동일한 방식)
function parseCharge(str) {
  if (!str || typeof str !== 'string') return 0;
  const trimmed = str.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const num = parseFloat(first);
  return Number.isFinite(num) ? num : 0;
}

async function loadAttendanceTypes() {
  // site_notes.data.attendanceType 을 사이트별로 읽어온다 (사무실별 공유 데이터)
  const rows = await db.all('SELECT site_name, data FROM site_notes');
  const map = {};
  for (const row of rows) {
    try {
      const data = row.data ? JSON.parse(row.data) : {};
      const type = data.attendanceType || '자동';
      map[row.site_name] = type;
    } catch (e) {
      console.warn('[migrateAttendanceLogs] site_notes JSON 파싱 실패:', row.site_name, e.message);
    }
  }
  return map; // { [site_name]: '자동' | '수동' }
}

async function migrate() {
  console.log('✅ 마이그레이션 시작');

  // 계정 추론용 데이터 준비
  await prepareAccountGuessHelpers();

  const attendanceTypeMap = await loadAttendanceTypes();

  // 모든 DR벳 레코드 조회
  const records = await db.all(
    'SELECT * FROM drbet_records ORDER BY record_date ASC, id ASC'
  );

  console.log('📦 대상 DR벳 레코드 수:', records.length);

  let inserted = 0;
  let skipped = 0;
  let skippedNoAccount = 0;

  for (const record of records) {
    const recordDate = record.record_date;
    if (!recordDate) {
      skipped++;
      continue;
    }

    for (let i = 1; i <= 4; i++) {
      const identityName = record[`identity${i}`];
      const siteName = record[`site_name${i}`];
      const attendanceFlag = record[`attendance${i}`]; // 0/1
      const chargeWithdraw = record[`charge_withdraw${i}`] || '';

      if (!identityName || !siteName) continue;

       // 이 레코드에 대한 account_id 추론
      const accountId = guessAccountIdForRecord(record);
      if (!accountId) {
        skippedNoAccount++;
        continue;
      }

      const attendanceType = attendanceTypeMap[siteName] || '자동';
      const charge = parseCharge(chargeWithdraw);

      // 과거 출석 인정 기준:
      // 1) attendanceX = 1 이면 무조건 출석으로 인정 (수동/자동 관계없이)
      // 2) attendanceX = 0 이고 attendanceType = '자동' 이며 charge > 0 이면 출석으로 인정
      let isAttended = false;
      if (attendanceFlag === 1) {
        isAttended = true;
      } else if (attendanceType === '자동' && charge > 0) {
        isAttended = true;
      }

      if (!isAttended) {
        continue;
      }

      try {
        await db.run(
          `INSERT OR IGNORE INTO site_attendance_log 
             (account_id, site_name, identity_name, attendance_date, created_at)
           VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
          [
            accountId,
            siteName,
            identityName,
            recordDate,
            record.created_at || null,
          ]
        );
        inserted++;
      } catch (e) {
        console.error('[migrateAttendanceLogs] 로그 삽입 실패:', {
          recordId: record.id,
          siteName,
          identityName,
          recordDate,
          error: e.message,
        });
      }
    }
  }

  console.log('✅ 마이그레이션 완료');
  console.log('  - 추가된 출석 로그 수:', inserted);
  console.log('  - 날짜 누락 등으로 건너뛴 레코드 수:', skipped);
  console.log('  - account_id 를 추론할 수 없어 건너뛴 레코드 수:', skippedNoAccount);
}

migrate()
  .then(() => {
    console.log('🎉 모든 작업이 완료되었습니다.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ 마이그레이션 중 오류 발생:', err);
    process.exit(1);
  });


