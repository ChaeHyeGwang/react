const sqlite3 = require('sqlite3').verbose();
const path = require('path');

(async () => {
  const dbPath = path.join(__dirname, '..', 'database', 'management_system.db');
  const db = new sqlite3.Database(dbPath);

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err); else resolve(rows || []);
      });
    });
  }
  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err); else resolve(row || null);
      });
    });
  }
  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err){
        if (err) reject(err); else resolve(this);
      });
    });
  }

  try {
    console.log('=== DRBET account_id 백필 시작 ===');

    // 기본 데이터 적재
    const users = await all('SELECT id, account_id FROM users');
    const identities = await all('SELECT id, name, user_id FROM identities');
    const sites = await all('SELECT identity_id, site_name FROM site_accounts');

    const identityIdToAccountId = new Map(users.map(u => [u.id, u.account_id])); // user.id -> account_id
    const identityNameToIdentityIds = new Map(); // name -> [identity_id]
    identities.forEach(i => {
      if (!identityNameToIdentityIds.has(i.name)) identityNameToIdentityIds.set(i.name, []);
      identityNameToIdentityIds.get(i.name).push(i.id);
    });

    // (identityId) -> account_id
    const identityIdToAcc = new Map();
    identities.forEach(i => {
      const acc = identityIdToAccountId.get(i.user_id);
      if (acc) identityIdToAcc.set(i.id, acc);
    });

    // (identityName, siteName) -> Set(account_id)
    const pairToAccounts = new Map();
    sites.forEach(s => {
      const acc = identityIdToAcc.get(s.identity_id);
      if (!acc) return;
      const ident = identities.find(i => i.id === s.identity_id);
      const key = `${(ident?.name||'').trim()}||${(s.site_name||'').trim()}`;
      if (!pairToAccounts.has(key)) pairToAccounts.set(key, new Set());
      pairToAccounts.get(key).add(acc);
    });

    // 백필 대상 로드
    const targets = await all(`SELECT * FROM drbet_records WHERE account_id IS NULL OR account_id = 0`);
    console.log(`대상 레코드: ${targets.length}개`);

    let updated = 0, skipped = 0;

    for (const r of targets) {
      const candidates = new Map(); // account_id -> score
      for (let i = 1; i <= 4; i++) {
        const idn = (r[`identity${i}`] || '').trim();
        const site = (r[`site_name${i}`] || '').trim();
        if (!idn) continue;

        if (idn && site) {
          const key = `${idn}||${site}`;
          const accs = pairToAccounts.get(key);
          if (accs && accs.size > 0) {
            accs.forEach(acc => {
              candidates.set(acc, (candidates.get(acc) || 0) + 3); // identity+site 일치 가중치 높게
            });
          }
        }

        // identity 이름만으로 후보 추가
        const ids = identityNameToIdentityIds.get(idn) || [];
        ids.forEach(identityId => {
          const acc = identityIdToAcc.get(identityId);
          if (acc) candidates.set(acc, (candidates.get(acc) || 0) + 1);
        });
      }

      // 최다 득표 계정 선택
      let chosen = null, maxScore = -1;
      for (const [acc, score] of candidates.entries()) {
        if (score > maxScore) { maxScore = score; chosen = acc; }
      }

      if (chosen) {
        await run('UPDATE drbet_records SET account_id = ? WHERE id = ?', [chosen, r.id]);
        updated++;
      } else {
        skipped++;
      }
    }

    console.log(`백필 완료: 업데이트 ${updated}건, 보류 ${skipped}건`);
    console.log('=== DRBET account_id 백필 종료 ===');
    db.close();
  } catch (e) {
    console.error('백필 실패:', e);
    db.close();
    process.exit(1);
  }
})();
