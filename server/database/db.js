const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

class DatabaseManager {
  constructor(dbPath = process.env.DB_PATH || path.join(__dirname, 'management_system.db')) {
    this.dbPath = path.resolve(dbPath);
    console.log('📁 사용 중인 DB 파일:', this.dbPath);
    this.db = null;
    this.init();
  }

  init() {
    return new Promise((resolve, reject) => {
      console.log('🔍 실제 DB 연결 시도 경로:', this.dbPath);
      
      // DB 파일 존재 여부 확인 (자동 생성 방지)
      if (!fs.existsSync(this.dbPath)) {
        const error = new Error(`데이터베이스 파일이 없습니다: ${this.dbPath}\n기존 DB 파일을 해당 경로에 배치해주세요.`);
        console.error('❌', error.message);
        reject(error);
        return;
      }
      
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('데이터베이스 연결 실패:', err.message);
          reject(err);
        } else {
          console.log('✅ SQLite 데이터베이스 연결 성공:', this.dbPath);
          // 성능 최적화 설정만 실행 (기존 DB 파일 사용, 자동 생성/마이그레이션 비활성화)
          this.optimizeDatabase()
            .then(() => this.addTelegramColumnsToOffices())
            .then(() => this.addNicknameColumn())
            .then(() => this.addAccountsDisplayOrderColumn())
            .then(() => this.addCommunitiesCategoryColumn())
            .then(() => this.runCommunityNoticesOfficeMigration())
            .then(() => this.ensureAuditLogsTable())
            .then(() => this.ensureIndexes())
            .then(resolve)
            .catch(reject);
        }
      });
    });
  }

  // SQLite 성능 최적화
  optimizeDatabase() {
    return new Promise((resolve, reject) => {
      const optimizations = [
        // WAL 모드 제거 (기존 DB 파일만 사용)
        'PRAGMA synchronous = NORMAL',  // 동기화 모드 (성능과 안정성 균형)
        'PRAGMA cache_size = -64000',  // 64MB 캐시
        'PRAGMA temp_store = MEMORY',  // 임시 데이터를 메모리에 저장
        'PRAGMA mmap_size = 268435456',  // 256MB 메모리 맵
        'PRAGMA busy_timeout = 5000'  // 5초 대기 시간
      ];

      let completed = 0;
      optimizations.forEach((sql) => {
        this.db.run(sql, (err) => {
          if (err) {
            console.warn(`⚠️ SQLite 최적화 경고 (${sql}):`, err.message);
          }
          completed++;
          if (completed === optimizations.length) {
            console.log('✅ SQLite 성능 최적화 완료');
            resolve();
          }
        });
      });
    });
  }

  runMigrationIfNeeded() {
    const fs = require('fs');
    const migrationFile = path.join(__dirname, '.migration_done');
    
    return new Promise((resolve, reject) => {
      // 마이그레이션 파일 확인
      fs.readFile(migrationFile, 'utf8', (err, data) => {
        if (err || data.trim() === 'migration_pending') {
          console.log('🔄 settlements 테이블 마이그레이션 시작...');
          
          this.recreateSettlements()
            .then(() => {
              // 마이그레이션 완료 표시
              fs.writeFile(migrationFile, 'migration_done', (err) => {
                if (err) console.error('마이그레이션 파일 저장 실패:', err);
                console.log('✅ settlements 테이블 마이그레이션 완료!');
                resolve();
              });
            })
            .catch(reject);
        } else {
          // 이미 마이그레이션 완료
          resolve();
        }
      });
    });
  }

  recreateSettlements() {
    return new Promise((resolve, reject) => {
      console.log('🔄 settlements 테이블 재생성 중...');
      
      // 기존 테이블 삭제
      this.db.run('DROP TABLE IF EXISTS settlements', (err) => {
        if (err) {
          console.error('❌ settlements 테이블 삭제 실패:', err.message);
          return reject(err);
        }
        
        console.log('✅ 기존 settlements 테이블 삭제 완료');
        
        // 새 테이블 생성 (UNIQUE 제약조건 포함)
        const createTableSQL = `CREATE TABLE settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          year_month TEXT NOT NULL,
          day_number INTEGER NOT NULL,
          ka_amount REAL DEFAULT 0,
          seup TEXT DEFAULT 'X',
          site_content TEXT DEFAULT '',
          user_data TEXT DEFAULT '{}',
          account_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(year_month, day_number, account_id),
          FOREIGN KEY (account_id) REFERENCES accounts (id)
        )`;
        
        this.db.run(createTableSQL, (err) => {
          if (err) {
            console.error('❌ settlements 테이블 생성 실패:', err.message);
            return reject(err);
          }
          
          console.log('✅ 새 settlements 테이블 생성 완료 (UNIQUE 제약조건 포함)');
          resolve();
        });
      });
    });
  }

  // 출석 컬럼 추가 마이그레이션
  async addAttendanceColumns() {
    return new Promise((resolve, reject) => {
      // 먼저 컬럼이 존재하는지 확인
      this.db.all("PRAGMA table_info(drbet_records)", (err, columns) => {
        if (err) {
          return reject(err);
        }
        
        const hasAttendance1 = columns.some(col => col.name === 'attendance1');
        
        if (hasAttendance1) {
          console.log('✅ 출석 컬럼이 이미 존재합니다');
          return resolve();
        }
        
        console.log('📝 출석 컬럼 추가 시작...');
        
        const alterStatements = [
          'ALTER TABLE drbet_records ADD COLUMN attendance1 INTEGER DEFAULT 0',
          'ALTER TABLE drbet_records ADD COLUMN attendance2 INTEGER DEFAULT 0',
          'ALTER TABLE drbet_records ADD COLUMN attendance3 INTEGER DEFAULT 0',
          'ALTER TABLE drbet_records ADD COLUMN attendance4 INTEGER DEFAULT 0'
        ];
        
        let completed = 0;
        let hasError = false;
        
        alterStatements.forEach((sql) => {
          this.db.run(sql, (err) => {
            if (err && !err.message.includes('duplicate column')) {
              console.error('❌ 컬럼 추가 실패:', err.message);
              hasError = true;
            }
            
            completed++;
            
            if (completed === alterStatements.length) {
              if (hasError) {
                reject(new Error('일부 컬럼 추가 실패'));
              } else {
                console.log('✅ 출석 컬럼 추가 완료');
                resolve();
              }
            }
          });
        });
      });
    });
  }

  // display_order 컬럼 추가 마이그레이션
  async addDisplayOrderColumn() {
    return new Promise((resolve, reject) => {
      // 먼저 컬럼이 존재하는지 확인
      this.db.all("PRAGMA table_info(identities)", (err, columns) => {
        if (err) {
          return reject(err);
        }
        
        const hasDisplayOrder = columns.some(col => col.name === 'display_order');
        
        if (hasDisplayOrder) {
          console.log('✅ display_order 컬럼이 이미 존재합니다');
          return resolve();
        }
        
        console.log('📝 display_order 컬럼 추가 시작...');
        
        this.db.run('ALTER TABLE identities ADD COLUMN display_order INTEGER DEFAULT 0', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('❌ display_order 컬럼 추가 실패:', err.message);
            return reject(err);
          }
          
          console.log('✅ display_order 컬럼 추가 완료');
          resolve();
        });
      });
    });
  }

  // nickname 컬럼 추가 마이그레이션
  async addNicknameColumn() {
    return new Promise((resolve, reject) => {
      // 먼저 컬럼이 존재하는지 확인
      this.db.all("PRAGMA table_info(identities)", (err, columns) => {
        if (err) {
          return reject(err);
        }
        
        const hasNickname = columns.some(col => col.name === 'nickname');
        const hasNicknames = columns.some(col => col.name === 'nicknames');
        
        let promises = [];
        
        if (!hasNickname) {
          console.log('📝 nickname 컬럼 추가 시작...');
          promises.push(new Promise((res, rej) => {
            this.db.run('ALTER TABLE identities ADD COLUMN nickname TEXT DEFAULT ""', (err) => {
              if (err && !err.message.includes('duplicate column')) {
                console.error('❌ nickname 컬럼 추가 실패:', err.message);
                return rej(err);
              }
              console.log('✅ nickname 컬럼 추가 완료');
              res();
            });
          }));
        } else {
          console.log('✅ nickname 컬럼이 이미 존재합니다');
        }
        
        if (!hasNicknames) {
          console.log('📝 nicknames 컬럼 추가 시작...');
          promises.push(new Promise((res, rej) => {
            this.db.run('ALTER TABLE identities ADD COLUMN nicknames TEXT DEFAULT "[]"', (err) => {
              if (err && !err.message.includes('duplicate column')) {
                console.error('❌ nicknames 컬럼 추가 실패:', err.message);
                return rej(err);
              }
              console.log('✅ nicknames 컬럼 추가 완료');
              res();
            });
          }));
        } else {
          console.log('✅ nicknames 컬럼이 이미 존재합니다');
        }
        
        if (promises.length === 0) {
          return resolve();
        }
        
        Promise.all(promises)
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  // site_accounts 테이블에 display_order 컬럼 추가
  async addSitesDisplayOrderColumn() {
    return new Promise((resolve, reject) => {
      // 먼저 테이블이 존재하는지 확인
      this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='site_accounts'", (err, table) => {
        if (err) {
          return reject(err);
        }
        
        // 테이블이 없으면 건너뜀
        if (!table) {
          console.log('⏭️ site_accounts 테이블이 아직 없음, display_order 컬럼 추가 건너뜀');
          return resolve();
        }
        
        this.db.all("PRAGMA table_info(site_accounts)", (err, columns) => {
          if (err) {
            return reject(err);
          }
          
          const hasDisplayOrder = columns.some(col => col.name === 'display_order');
          
          if (hasDisplayOrder) {
            return resolve();
          }
          
          console.log('📝 site_accounts 테이블에 display_order 컬럼 추가 중...');
          
          this.db.run('ALTER TABLE site_accounts ADD COLUMN display_order INTEGER DEFAULT 0', (err) => {
            if (err && !err.message.includes('duplicate column')) {
              console.error('❌ site_accounts display_order 컬럼 추가 실패:', err.message);
              return reject(err);
            }
            
            console.log('✅ site_accounts display_order 컬럼 추가 완료');
            resolve();
          });
        });
      });
    });
  }

  // community_notices: community_id → site_name + office_id 사무실 공유 스키마 마이그레이션
  async runCommunityNoticesOfficeMigration() {
    try {
      const table = await this.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='community_notices'"
      );
      if (!table) {
        return;
      }

      const columns = await this.all('PRAGMA table_info(community_notices)');
      const hasSiteName = columns.some(col => col.name === 'site_name');
      const hasOfficeId = columns.some(col => col.name === 'office_id');
      const hasCommunityId = columns.some(col => col.name === 'community_id');

      if (hasSiteName && hasOfficeId && !hasCommunityId) {
        console.log('✅ community_notices 테이블 스키마가 최신 상태입니다');
        return;
      }

      if (!hasCommunityId && hasSiteName && hasOfficeId) {
        return;
      }

      console.log('🔄 community_notices 테이블 사무실 공유 스키마 마이그레이션 시작...');

      await this.run('DROP TABLE IF EXISTS community_notices_tmp');
      await this.run(`CREATE TABLE community_notices_tmp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT NOT NULL,
        office_id INTEGER NULL,
        recorded_by_identity TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site_name, office_id)
      )`);

      const sharedRowsMap = new Map();

      if (hasCommunityId) {
        const joinedRows = await this.all(`
          SELECT
            cn.recorded_by_identity,
            cn.data,
            cn.created_at,
            cn.updated_at,
            TRIM(c.site_name) AS site_name,
            a.office_id
          FROM community_notices cn
          INNER JOIN communities c ON cn.community_id = c.id
          LEFT JOIN accounts a ON CAST(c.account_id AS INTEGER) = a.id
        `);

        for (const row of joinedRows) {
          const siteName = (row.site_name || '').trim();
          if (!siteName) continue;
          const key = `${siteName}|${row.office_id ?? 'NULL'}`;
          const existing = sharedRowsMap.get(key);
          if (!existing || new Date(row.updated_at || 0) > new Date(existing.updated_at || 0)) {
            sharedRowsMap.set(key, row);
          }
        }
      } else {
        const allRows = await this.all('SELECT * FROM community_notices');
        for (const row of allRows) {
          const siteName = (row.site_name || '').trim();
          if (!siteName) continue;
          const key = `${siteName}|${row.office_id ?? 'NULL'}`;
          const existing = sharedRowsMap.get(key);
          if (!existing || new Date(row.updated_at || 0) > new Date(existing.updated_at || 0)) {
            sharedRowsMap.set(key, row);
          }
        }
      }

      for (const row of sharedRowsMap.values()) {
        await this.run(
          `INSERT INTO community_notices_tmp
           (site_name, office_id, recorded_by_identity, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            row.site_name,
            row.office_id ?? null,
            row.recorded_by_identity || '',
            row.data || '{}',
            row.created_at || new Date().toISOString(),
            row.updated_at || new Date().toISOString()
          ]
        );
      }

      await this.run('DROP TABLE community_notices');
      await this.run('ALTER TABLE community_notices_tmp RENAME TO community_notices');
      console.log('✅ community_notices 테이블 사무실 공유 스키마 마이그레이션 완료!');
    } catch (error) {
      console.error('❌ community_notices 테이블 마이그레이션 실패:', error);
      throw error;
    }
  }

  // accounts 테이블에 display_order 컬럼 추가
  async addAccountsDisplayOrderColumn() {
    return new Promise((resolve, reject) => {
      this.db.all("PRAGMA table_info(accounts)", (err, columns) => {
        if (err) {
          return reject(err);
        }
        
        const hasDisplayOrder = columns.some(col => col.name === 'display_order');
        
        if (hasDisplayOrder) {
          return resolve();
        }
        
        console.log('📝 accounts 테이블에 display_order 컬럼 추가 중...');
        
        this.db.run('ALTER TABLE accounts ADD COLUMN display_order INTEGER DEFAULT 0', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('❌ accounts display_order 컬럼 추가 실패:', err.message);
            return reject(err);
          }
          
          console.log('✅ accounts display_order 컬럼 추가 완료');
          resolve();
        });
      });
    });
  }

  // communities 테이블에 category 컬럼 추가
  async addCommunitiesCategoryColumn() {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='communities'", (err, table) => {
        if (err) return reject(err);
        if (!table) return resolve();

        this.db.all('PRAGMA table_info(communities)', (colErr, columns) => {
          if (colErr) return reject(colErr);

          const hasCategory = columns.some(col => col.name === 'category');
          if (hasCategory) return resolve();

          console.log('📝 communities 테이블에 category 컬럼 추가 중...');
          this.db.run('ALTER TABLE communities ADD COLUMN category TEXT DEFAULT ""', (alterErr) => {
            if (alterErr && !alterErr.message.includes('duplicate column')) {
              console.error('❌ communities category 컬럼 추가 실패:', alterErr.message);
              return reject(alterErr);
            }
            console.log('✅ communities category 컬럼 추가 완료');
            resolve();
          });
        });
      });
    });
  }

  // communities 테이블에 display_order 컬럼 추가
  async addCommunitiesDisplayOrderColumn() {
    return new Promise((resolve, reject) => {
      // 먼저 테이블이 존재하는지 확인
      this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='communities'", (err, table) => {
        if (err) {
          return reject(err);
        }
        
        // 테이블이 없으면 건너뜀
        if (!table) {
          console.log('⏭️ communities 테이블이 아직 없음, display_order 컬럼 추가 건너뜀');
          return resolve();
        }
        
        this.db.all("PRAGMA table_info(communities)", (err, columns) => {
          if (err) {
            return reject(err);
          }
          
          const hasDisplayOrder = columns.some(col => col.name === 'display_order');
          
          if (hasDisplayOrder) {
            return resolve();
          }
          
          console.log('📝 communities 테이블에 display_order 컬럼 추가 중...');
          
          this.db.run('ALTER TABLE communities ADD COLUMN display_order INTEGER DEFAULT 0', (err) => {
            if (err && !err.message.includes('duplicate column')) {
              console.error('❌ communities display_order 컬럼 추가 실패:', err.message);
              return reject(err);
            }
            
            console.log('✅ communities display_order 컬럼 추가 완료');
            resolve();
          });
        });
      });
    });
  }

  // 커뮤니티 테이블 마이그레이션 체크
  runCommunitiesMigration() {
    const fs = require('fs');
    const migrationFile = path.join(__dirname, '.communities_migration_done');
    
    return new Promise((resolve, reject) => {
      // 마이그레이션 파일 확인
      fs.readFile(migrationFile, 'utf8', (err, data) => {
        // 파일이 없거나 'pending' 상태인 경우에만 마이그레이션 실행
        if (err || data.trim() === 'migration_pending') {
          console.log('🔄 communities 테이블 마이그레이션 시작...');
          
          this.recreateCommunities()
            .then(() => {
              // 마이그레이션 완료 표시
              fs.writeFile(migrationFile, 'migration_done', (err) => {
                if (err) console.error('마이그레이션 파일 저장 실패:', err);
                console.log('✅ communities 테이블 마이그레이션 완료!');
                resolve();
              });
            })
            .catch(reject);
        } else {
          // 이미 마이그레이션 완료
          console.log('✅ communities 테이블 마이그레이션 이미 완료됨');
          resolve();
        }
      });
    });
  }

  // 커뮤니티 테이블 재생성
  async recreateCommunities() {
    return new Promise((resolve, reject) => {
      console.log('🔄 communities 테이블 재생성 중...');
      
      // 기존 테이블 삭제
      this.db.run('DROP TABLE IF EXISTS communities', (err) => {
        if (err) {
          console.error('❌ communities 테이블 삭제 실패:', err.message);
          return reject(err);
        }
        
        console.log('✅ 기존 communities 테이블 삭제 완료');
        
        // 새 테이블 생성
        const createTableSQL = `CREATE TABLE communities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          site_name TEXT NOT NULL,
          domain TEXT DEFAULT '',
          referral_path TEXT DEFAULT '',
          approval_call INTEGER DEFAULT 0,
          identity_name TEXT DEFAULT '',
          account_id TEXT DEFAULT '',
          password TEXT DEFAULT '',
          exchange_password TEXT DEFAULT '',
          nickname TEXT DEFAULT '',
          status TEXT DEFAULT '가입전',
          referral_code TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`;
        
        this.db.run(createTableSQL, (err) => {
          if (err) {
            console.error('❌ communities 테이블 생성 실패:', err.message);
            return reject(err);
          }
          
          console.log('✅ 새 communities 테이블 생성 완료');
          resolve();
        });
      });
    });
  }

  // drbet_records 테이블 마이그레이션 (account_id 추가)
  runDrbetRecordsMigration() {
    const fs = require('fs');
    const migrationFile = path.join(__dirname, '.drbet_records_migration_done');
    
    return new Promise((resolve, reject) => {
      // 실제 테이블 구조를 확인하여 account_id 컬럼 존재 여부 확인
      this.db.all("PRAGMA table_info(drbet_records)", (err, columns) => {
        if (err) {
          console.error('❌ drbet_records 테이블 정보 조회 실패:', err);
          return reject(err);
        }
        
        const hasAccountId = columns.some(col => col.name === 'account_id');
        
        // account_id 컬럼이 없으면 마이그레이션 실행
        if (!hasAccountId) {
          console.log('🔄 drbet_records 테이블에 account_id 컬럼이 없어 마이그레이션 시작...');
          
          this.addAccountIdToDrbetRecords()
            .then(() => {
              // 마이그레이션 완료 표시
              fs.writeFile(migrationFile, 'migration_done', (err) => {
                if (err) console.error('마이그레이션 파일 저장 실패:', err);
                console.log('✅ drbet_records 테이블 마이그레이션 완료!');
                resolve();
              });
            })
            .catch(reject);
        } else {
          // 이미 마이그레이션 완료
          console.log('✅ drbet_records 테이블에 account_id 컬럼이 이미 존재합니다');
          resolve();
        }
      });
    });
  }

  // drbet_records 테이블에 account_id 컬럼 추가
  async addAccountIdToDrbetRecords() {
    return new Promise((resolve, reject) => {
      // account_id 컬럼 추가
      this.db.run('ALTER TABLE drbet_records ADD COLUMN account_id INTEGER', (err) => {
        if (err) {
          // 컬럼이 이미 존재하거나 다른 오류
          if (err.message.includes('duplicate column name')) {
            console.log('✅ account_id 컬럼이 이미 존재합니다');
            resolve();
          } else {
            console.error('❌ account_id 컬럼 추가 실패:', err);
            return reject(err);
          }
        } else {
          console.log('✅ account_id 컬럼 추가 완료');
          
          // 기존 데이터의 account_id 업데이트 (명의를 기반으로 추론)
          // 단, 이 작업은 선택적이며, 정확한 매핑이 어려울 수 있음
          // 여기서는 NULL로 남겨두고 향후 데이터 생성 시 account_id를 설정하도록 함
          console.log('⚠️ 기존 데이터의 account_id는 NULL로 남아있습니다. 새로 생성되는 레코드부터 account_id가 설정됩니다.');
          resolve();
        }
      });
    });
  }

  // accounts 테이블에 office_id, is_office_manager 컬럼 추가
  async addOfficeColumnsToAccounts() {
    return new Promise((resolve, reject) => {
      // 먼저 컬럼이 존재하는지 확인
      this.db.all("PRAGMA table_info(accounts)", (err, columns) => {
        if (err) {
          return reject(err);
        }

        const hasOfficeId = columns.some(col => col.name === 'office_id');
        const hasIsOfficeManager = columns.some(col => col.name === 'is_office_manager');

        if (hasOfficeId && hasIsOfficeManager) {
          console.log('✅ accounts 테이블에 office_id, is_office_manager 컬럼이 이미 존재합니다');
          return resolve();
        }

        console.log('📝 accounts 테이블에 office_id, is_office_manager 컬럼 추가 시작...');

        const promises = [];

        if (!hasOfficeId) {
          promises.push(
            new Promise((res, rej) => {
              this.db.run('ALTER TABLE accounts ADD COLUMN office_id INTEGER', (err) => {
                if (err && !err.message.includes('duplicate column')) {
                  console.error('❌ office_id 컬럼 추가 실패:', err.message);
                  return rej(err);
                }
                console.log('✅ office_id 컬럼 추가 완료');
                res();
              });
            })
          );
        }

        if (!hasIsOfficeManager) {
          promises.push(
            new Promise((res, rej) => {
              this.db.run('ALTER TABLE accounts ADD COLUMN is_office_manager INTEGER DEFAULT 0', (err) => {
                if (err && !err.message.includes('duplicate column')) {
                  console.error('❌ is_office_manager 컬럼 추가 실패:', err.message);
                  return rej(err);
                }
                console.log('✅ is_office_manager 컬럼 추가 완료');
                res();
              });
            })
          );
        }

        Promise.all(promises)
          .then(() => {
            // 기존 계정에 기본 office_id 할당 (기본 사무실 생성)
            this.createDefaultOffice()
              .then(() => {
                console.log('✅ accounts 테이블 마이그레이션 완료');
                resolve();
              })
              .catch(reject);
          })
          .catch(reject);
      });
    });
  }

  async addCashOnHandToAccounts() {
    return new Promise((resolve, reject) => {
      // 먼저 컬럼이 존재하는지 확인
      this.db.all("PRAGMA table_info(accounts)", (err, columns) => {
        if (err) {
          return reject(err);
        }

        const hasCashOnHand = columns.some(col => col.name === 'cash_on_hand');

        if (hasCashOnHand) {
          console.log('✅ accounts 테이블에 cash_on_hand 컬럼이 이미 존재합니다');
          return resolve();
        }

        console.log('📝 accounts 테이블에 cash_on_hand 컬럼 추가 시작...');

        this.db.run('ALTER TABLE accounts ADD COLUMN cash_on_hand REAL DEFAULT 0', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('❌ cash_on_hand 컬럼 추가 실패:', err.message);
            return reject(err);
          }
          console.log('✅ cash_on_hand 컬럼 추가 완료');
          resolve();
        });
      });
    });
  }

  // 기본 사무실 생성 및 기존 계정에 할당
  async createDefaultOffice() {
    const self = this; // this 컨텍스트 보존
    return new Promise((resolve, reject) => {
      // 기본 사무실이 있는지 확인
      self.db.get('SELECT id FROM offices WHERE name = ?', ['기본사무실'], (err, office) => {
        if (err) {
          return reject(err);
        }

        if (office) {
          // 기본 사무실이 있으면, office_id가 NULL인 계정에 할당
          self.db.run(
            'UPDATE accounts SET office_id = ? WHERE office_id IS NULL',
            [office.id],
            (updateErr) => {
              if (updateErr) {
                console.error('기존 계정에 office_id 할당 실패:', updateErr);
                return reject(updateErr);
              }
              console.log('✅ 기존 계정에 기본 사무실 할당 완료');
              resolve();
            }
          );
        } else {
          // 기본 사무실 생성
          self.db.run(
            'INSERT INTO offices (name, status, description) VALUES (?, ?, ?)',
            ['기본사무실', 'active', '기본 사무실'],
            function(insertErr) {
              if (insertErr) {
                return reject(insertErr);
              }

              const defaultOfficeId = this.lastID;

              // 기존 계정에 기본 사무실 할당
              self.db.run(
                'UPDATE accounts SET office_id = ? WHERE office_id IS NULL',
                [defaultOfficeId],
                (updateErr) => {
                  if (updateErr) {
                    console.error('기존 계정에 office_id 할당 실패:', updateErr);
                    return reject(updateErr);
                  }
                  console.log('✅ 기본 사무실 생성 및 기존 계정에 할당 완료');
                  resolve();
                }
              );
            }
          );
        }
      });
    });
  }

  // site_notes 테이블 스키마 마이그레이션 (account_id, identity_name 제거 및 settlement_cleared 테이블 생성)
  async runSiteNotesMigration() {
    try {
      const columns = await this.all("PRAGMA table_info(site_notes)");

      // 테이블이 존재하지 않으면 생성만 진행
      if (!columns || columns.length === 0) {
        console.log('ℹ️ site_notes 테이블이 존재하지 않아 초기 스키마를 사용합니다.');
        return;
      }

      const hasAccountId = columns.some(col => col.name === 'account_id');
      const hasIdentityName = columns.some(col => col.name === 'identity_name');
      const hasOfficeId = columns.some(col => col.name === 'office_id');

      // 이미 마이그레이션이 완료된 경우 (account_id, identity_name이 없음)
      if (!hasAccountId && !hasIdentityName && hasOfficeId) {
        console.log('✅ site_notes 테이블 스키마가 최신 상태입니다');
        return;
      }

      console.log('🔄 site_notes 테이블 스키마 마이그레이션 시작...');

      // 기존 데이터 백업
      const allRows = await this.all(`SELECT * FROM site_notes`);

      // site_notes 테이블 재생성 (account_id, identity_name 제거)
      await this.run('DROP TABLE IF EXISTS site_notes_tmp');
      await this.run(`CREATE TABLE site_notes_tmp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT NOT NULL,
        office_id INTEGER NULL,
        recorded_by_identity TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site_name, office_id)
      )`);

      // 3. 공유 데이터만 마이그레이션 (account_id가 NULL인 row만)
      // 같은 사무실의 같은 사이트에 대해 여러 row가 있으면 가장 최근 것을 사용
      const sharedRowsMap = new Map();
      for (const row of allRows) {
        if (!row.account_id) {
          const key = `${row.site_name}|${row.office_id || 'NULL'}`;
          const existing = sharedRowsMap.get(key);
          if (!existing || new Date(row.updated_at || 0) > new Date(existing.updated_at || 0)) {
            // data에서 attendanceDays 제거
            try {
              const data = JSON.parse(row.data || '{}');
              delete data.attendanceDays;
              row.data = JSON.stringify(data);
            } catch (err) {
              console.error(`데이터 파싱 실패 (id: ${row.id}):`, err);
            }
            sharedRowsMap.set(key, row);
          }
        }
      }

      // 공유 데이터 삽입
      for (const row of sharedRowsMap.values()) {
        await this.run(
          `INSERT INTO site_notes_tmp 
           (site_name, office_id, recorded_by_identity, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            row.site_name,
            row.office_id,
            row.recorded_by_identity || '',
            row.data || '{}',
            row.created_at || new Date().toISOString(),
            row.updated_at || new Date().toISOString()
          ]
        );
      }

      await this.run('DROP TABLE site_notes');
      await this.run('ALTER TABLE site_notes_tmp RENAME TO site_notes');

      console.log('✅ site_notes 테이블 스키마 마이그레이션 완료!');
    } catch (error) {
      console.error('❌ site_notes 테이블 스키마 마이그레이션 실패:', error);
      throw error;
    }
  }

  async runSiteAttendanceMigration() {
    const fs = require('fs');
    const fsPromises = fs.promises;
    const migrationFile = path.join(__dirname, '.site_attendance_migration_done');

    let shouldMigrate = true;
    try {
      const marker = await fsPromises.readFile(migrationFile, 'utf8');
      shouldMigrate = marker.trim() !== 'migration_done';
    } catch (err) {
      shouldMigrate = true;
    }

    if (!shouldMigrate) {
      return;
    }

    console.log('🔄 site_attendance 데이터 마이그레이션 시작...');

    try {
      await this.migrateLegacyAttendanceData();
      await fsPromises.writeFile(migrationFile, 'migration_done');
      console.log('✅ site_attendance 데이터 마이그레이션 완료!');
    } catch (err) {
      console.error('❌ site_attendance 데이터 마이그레이션 실패:', err);
      throw err;
    }
  }

  async migrateLegacyAttendanceData() {
    // Helper 함수: site_attendance upsert
    const upsertAttendance = async (accountId, identityId, siteAccountId, attendanceDays, timestamp = null) => {
      if (!accountId || !identityId || !siteAccountId) {
        return;
      }

      const normalizedDays = Number(attendanceDays);
      if (!Number.isFinite(normalizedDays)) {
        return;
      }

      const params = [
        accountId,
        identityId,
        siteAccountId,
        normalizedDays < 0 ? 0 : normalizedDays,
        timestamp || null
      ];

      await this.run(
        `INSERT INTO site_attendance (account_id, identity_id, site_account_id, period_type, period_value, attendance_days, last_recorded_at)
         VALUES (?, ?, ?, 'total', 'all', ?, ?)
         ON CONFLICT(account_id, identity_id, site_account_id, period_type, period_value)
         DO UPDATE SET
           attendance_days = excluded.attendance_days,
           updated_at = CURRENT_TIMESTAMP,
           last_recorded_at = COALESCE(excluded.last_recorded_at, site_attendance.last_recorded_at, CURRENT_TIMESTAMP)`,
        params
      );
    };

    // 1) site_accounts.attendance_days 값 마이그레이션
    const siteAccountsColumns = await this.all("PRAGMA table_info(site_accounts)");
    const hasLegacyAttendanceColumn = siteAccountsColumns.some(col => col.name === 'attendance_days');

    if (hasLegacyAttendanceColumn) {
      const rows = await this.all(
        `SELECT 
           s.id AS site_account_id,
           s.identity_id AS identity_id,
           COALESCE(s.attendance_days, 0) AS attendance_days,
           a.id AS account_id
         FROM site_accounts s
         INNER JOIN identities i ON s.identity_id = i.id
         INNER JOIN users u ON i.user_id = u.id
         INNER JOIN accounts a ON u.account_id = a.id`
      );

      for (const row of rows) {
        await upsertAttendance(row.account_id, row.identity_id, row.site_account_id, row.attendance_days);
      }
    }

    // 2) site_notes 데이터의 attendanceDays 마이그레이션 (계정별 + 명의별)
    const identityNotes = await this.all(
      `SELECT 
         sn.site_name,
         sn.account_id,
         sn.identity_name,
         sn.data,
         sn.updated_at,
         i.id AS identity_id,
         sa.id AS site_account_id
       FROM site_notes sn
       INNER JOIN accounts a ON sn.account_id = a.id
       INNER JOIN users u ON u.account_id = a.id
       INNER JOIN identities i ON i.user_id = u.id AND i.name = sn.identity_name
       LEFT JOIN site_accounts sa ON sa.identity_id = i.id AND sa.site_name = sn.site_name
       WHERE sn.account_id IS NOT NULL
         AND sn.identity_name IS NOT NULL`
    );

    for (const row of identityNotes) {
      if (!row.site_account_id) {
        continue;
      }

      let parsedData = {};
      try {
        parsedData = row.data ? JSON.parse(row.data) : {};
      } catch (err) {
        parsedData = {};
      }

      const attendanceDays = Number(parsedData.attendanceDays);
      if (!Number.isFinite(attendanceDays)) {
        continue;
      }

      await upsertAttendance(
        row.account_id,
        row.identity_id,
        row.site_account_id,
        attendanceDays,
        row.updated_at || null
      );
    }
  }

  createTables() {
    return new Promise((resolve, reject) => {
      const tables = [
      // 사무실 테이블 (순환 참조 방지를 위해 FK는 마이그레이션으로 추가)
      `CREATE TABLE IF NOT EXISTS offices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        manager_account_id INTEGER,
        status TEXT DEFAULT 'active',
        description TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // 계정 테이블
      `CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        account_type TEXT DEFAULT 'user',
        status TEXT DEFAULT 'active',
        created_date TEXT NOT NULL,
        last_login TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        office_id INTEGER,
        is_office_manager INTEGER DEFAULT 0
      )`,

      // 유저 테이블 (deprecated - 마이그레이션 후 제거 예정)
      // identities가 직접 account_id를 참조하도록 변경됨
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        created_date TEXT NOT NULL,
        notes TEXT DEFAULT '',
        account_id INTEGER,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,

      // 명의 테이블
      `CREATE TABLE IF NOT EXISTS identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        birth_date TEXT NOT NULL,
        zodiac TEXT DEFAULT '',
        bank_accounts TEXT DEFAULT '[]',
        phone_numbers TEXT DEFAULT '[]',
        nickname TEXT DEFAULT '',
        nicknames TEXT DEFAULT '[]',
        status TEXT DEFAULT 'active',
        notes TEXT DEFAULT '',
        display_order INTEGER DEFAULT 0,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,

      // 사이트 계정 테이블
      `CREATE TABLE IF NOT EXISTS site_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_id INTEGER NOT NULL,
        site_name TEXT NOT NULL,
        domain TEXT DEFAULT '',
        category TEXT DEFAULT '',
        account_id TEXT NOT NULL,
        password TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        referral_code TEXT DEFAULT '',
        referral_path TEXT DEFAULT '',
        exchange_password TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        status_history TEXT DEFAULT '[]',
        approval_call INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        FOREIGN KEY (identity_id) REFERENCES identities (id)
      )`,

      // 사이트 출석 관리 테이블
      `CREATE TABLE IF NOT EXISTS site_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        identity_id INTEGER NOT NULL,
        site_account_id INTEGER NOT NULL,
        period_type TEXT DEFAULT 'total',
        period_value TEXT DEFAULT 'all',
        attendance_days INTEGER DEFAULT 0,
        last_recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, identity_id, site_account_id, period_type, period_value),
        FOREIGN KEY (account_id) REFERENCES accounts (id),
        FOREIGN KEY (identity_id) REFERENCES identities (id),
        FOREIGN KEY (site_account_id) REFERENCES site_accounts (id)
      )`,

      // 커뮤니티 목록 테이블
      // communities 테이블 (deprecated - 마이그레이션 후 user_id 제거, account_id 추가 예정)
      // 마이그레이션 후: account_id (INTEGER, accounts 참조), account_id_site (TEXT, 사이트 계정 ID)
      `CREATE TABLE IF NOT EXISTS communities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        site_name TEXT NOT NULL,
        domain TEXT DEFAULT '',
        referral_path TEXT DEFAULT '',
        approval_call INTEGER DEFAULT 0,
        identity_name TEXT DEFAULT '',
        account_id TEXT DEFAULT '',
        password TEXT DEFAULT '',
        exchange_password TEXT DEFAULT '',
        nickname TEXT DEFAULT '',
        status TEXT DEFAULT '가입전',
        referral_code TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 사이트 메타데이터(이벤트/요율 등) 기록 테이블
      // 사무실별 사이트당 1개 row만 존재 (정착 정보 포함)
      `CREATE TABLE IF NOT EXISTS site_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT NOT NULL,
        office_id INTEGER NULL,
        recorded_by_identity TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site_name, office_id)
      )`,

      // 커뮤니티 메타데이터(정보기록) 테이블
      // 사무실별 사이트당 1개 row만 존재
      `CREATE TABLE IF NOT EXISTS community_notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT NOT NULL,
        office_id INTEGER NULL,
        recorded_by_identity TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site_name, office_id)
      )`,

      // 정착 지급 여부 테이블 (계정별/명의별 관리)
      // 페이백 지급 여부 테이블 (계정별/명의별 관리)
      `CREATE TABLE IF NOT EXISTS payback_cleared (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT NOT NULL,
        office_id INTEGER NULL,
        account_id INTEGER NOT NULL,
        identity_name TEXT NULL,
        week_start_date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site_name, office_id, account_id, identity_name, week_start_date),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,

      // DR벳 요약 테이블 (일자별 캐시)
      `CREATE TABLE IF NOT EXISTS drbet_daily_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        summary_date TEXT NOT NULL,
        data TEXT NOT NULL,
        is_partial INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, summary_date),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,

      // DR벳 테이블
      `CREATE TABLE IF NOT EXISTS drbet_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_date TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        drbet_amount INTEGER DEFAULT 0,
        private_amount INTEGER DEFAULT 0,
        total_charge INTEGER DEFAULT 0,
        total_amount INTEGER DEFAULT 0,
        margin INTEGER DEFAULT 0,
        rate_amount INTEGER DEFAULT 0,
        site1 TEXT DEFAULT '',
        site2 TEXT DEFAULT '',
        site3 TEXT DEFAULT '',
        site4 TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        identity1 TEXT DEFAULT '',
        site_name1 TEXT DEFAULT '',
        charge_withdraw1 TEXT DEFAULT '',
        attendance1 INTEGER DEFAULT 0,
        identity2 TEXT DEFAULT '',
        site_name2 TEXT DEFAULT '',
        charge_withdraw2 TEXT DEFAULT '',
        attendance2 INTEGER DEFAULT 0,
        identity3 TEXT DEFAULT '',
        site_name3 TEXT DEFAULT '',
        charge_withdraw3 TEXT DEFAULT '',
        attendance3 INTEGER DEFAULT 0,
        identity4 TEXT DEFAULT '',
        site_name4 TEXT DEFAULT '',
        charge_withdraw4 TEXT DEFAULT '',
        attendance4 INTEGER DEFAULT 0,
        cumulative_charge1 INTEGER DEFAULT 0,
        cumulative_withdraw1 INTEGER DEFAULT 0,
        cumulative_charge2 INTEGER DEFAULT 0,
        cumulative_withdraw2 INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      // 세션 테이블
      `CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,

      // 접근 로그 테이블
      `CREATE TABLE IF NOT EXISTS access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        action TEXT NOT NULL,
        details TEXT DEFAULT '',
        ip_address TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        timestamp TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      `CREATE TABLE IF NOT EXISTS settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year_month TEXT NOT NULL,
        day_number INTEGER NOT NULL,
        ka_amount REAL DEFAULT 0,
        seup TEXT DEFAULT 'X',
        site_content TEXT DEFAULT '',
        user_data TEXT DEFAULT '{}',
        account_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(year_month, day_number, account_id),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      `CREATE TABLE IF NOT EXISTS finish_data (
        date TEXT NOT NULL,
        identity_name TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        remaining_amount REAL DEFAULT 0,
        site_content TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (date, identity_name, account_id),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      `CREATE TABLE IF NOT EXISTS finish_summary (
        date TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        cash_on_hand REAL DEFAULT 0,
        yesterday_balance REAL DEFAULT 0,
        coin_wallet REAL DEFAULT 0,
        manual_withdrawals TEXT,
        start_amount_total REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (date, account_id),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      `CREATE TABLE IF NOT EXISTS finish_defaults (
        account_id INTEGER PRIMARY KEY,
        cash_on_hand REAL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      `CREATE TABLE IF NOT EXISTS start_data (
        date TEXT NOT NULL,
        identity_name TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        remaining_amount REAL DEFAULT 0,
        site_content TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (date, identity_name, account_id),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      `CREATE TABLE IF NOT EXISTS start_summary (
        date TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        cash_on_hand REAL DEFAULT 0,
        yesterday_balance REAL DEFAULT 0,
        coin_wallet REAL DEFAULT 0,
        manual_withdrawals TEXT,
        start_amount_total REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (date, account_id),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      `CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        event_date TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        type TEXT DEFAULT 'normal',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,
      
      // 사이트 출석 로그 테이블 (새로운 방식: 날짜별 기록)
      `CREATE TABLE IF NOT EXISTS site_attendance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        site_name TEXT NOT NULL,
        identity_name TEXT NOT NULL,
        attendance_date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, site_name, identity_name, attendance_date),
        FOREIGN KEY (account_id) REFERENCES accounts (id)
      )`,

      // 감사(audit) 로그 테이블
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        username TEXT,
        display_name TEXT,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        record_id TEXT,
        old_data TEXT,
        new_data TEXT,
        description TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

      let completed = 0;
      const total = tables.length;

      tables.forEach((sql, index) => {
        this.db.run(sql, (err) => {
          if (err) {
            console.error(`테이블 생성 실패 (${index + 1}):`, err.message);
            reject(err);
          } else {
            completed++;
            if (completed === total) {
              // 모든 테이블 생성 완료 후 기본 계정 생성
              this.createDefaultAccounts();
              resolve();
            }
          }
        });
      });
    });
  }

  createDefaultAccounts() {
    const bcrypt = require('bcryptjs');
    
    const defaultAccounts = [
      {
        username: 'admin',
        password: 'admin123',
        display_name: '관리자',
        account_type: 'super_admin'
      },
      {
        username: 'maenggu',
        password: 'pass123',
        display_name: '맹구',
        account_type: 'user'
      },
      {
        username: 'jjanggu',
        password: 'pass123',
        display_name: '짱구',
        account_type: 'user'
      },
      {
        username: 'haribo',
        password: 'haribo',
        display_name: '하리보',
        account_type: 'user'
      }
    ];

    defaultAccounts.forEach(account => {
      const hashedPassword = bcrypt.hashSync(account.password, 10);
      const createdDate = new Date().toISOString();

      this.db.run(
        `INSERT OR IGNORE INTO accounts (username, password_hash, display_name, account_type, created_date)
         VALUES (?, ?, ?, ?, ?)`,
        [account.username, hashedPassword, account.display_name, account.account_type, createdDate],
        function(err) {
          if (err) {
            console.error('기본 계정 생성 실패:', err.message);
          } else if (this.changes > 0) {
            console.log(`✅ 기본 계정 생성: ${account.username} (${account.display_name})`);
          }
        }
      );
    });
  }

  // 프로미스 기반 쿼리 실행
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * 트랜잭션 시작
   */
  async beginTransaction() {
    return this.run('BEGIN TRANSACTION');
  }

  /**
   * 트랜잭션 커밋
   */
  async commit() {
    return this.run('COMMIT');
  }

  /**
   * 트랜잭션 롤백
   */
  async rollback() {
    return this.run('ROLLBACK');
  }

  /**
   * 트랜잭션 내에서 작업 실행
   * @param {Function} callback - 트랜잭션 내에서 실행할 비동기 함수
   * @returns {Promise<any>} callback의 반환값
   */
  async transaction(callback) {
    await this.beginTransaction();
    try {
      const result = await callback();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ 데이터베이스 연결 종료');
          resolve();
        }
      });
    });
  }

  // offices 테이블에 텔레그램 컬럼 추가 마이그레이션
  async addTelegramColumnsToOffices() {
    return new Promise((resolve, reject) => {
      // 먼저 컬럼이 존재하는지 확인
      this.db.all("PRAGMA table_info(offices)", (err, columns) => {
        if (err) {
          console.warn('⚠️ offices 테이블 정보 조회 실패:', err.message);
          return resolve(); // 테이블이 없을 수도 있으므로 에러 무시
        }
        
        const hasBotToken = columns.some(col => col.name === 'telegram_bot_token');
        const hasChatId = columns.some(col => col.name === 'telegram_chat_id');
        const hasTelegramId = columns.some(col => col.name === 'telegram_id');
        
        if (hasBotToken && hasChatId && hasTelegramId) {
          console.log('✅ 텔레그램 컬럼이 이미 존재합니다');
          return resolve();
        }
        
        console.log('📝 offices 테이블에 텔레그램 컬럼 추가 시작...');
        
        const alterStatements = [];
        if (!hasBotToken) {
          alterStatements.push('ALTER TABLE offices ADD COLUMN telegram_bot_token TEXT DEFAULT ""');
        }
        if (!hasChatId) {
          alterStatements.push('ALTER TABLE offices ADD COLUMN telegram_chat_id TEXT DEFAULT ""');
        }
        if (!hasTelegramId) {
          alterStatements.push('ALTER TABLE offices ADD COLUMN telegram_id TEXT DEFAULT ""');
        }
        
        if (alterStatements.length === 0) {
          return resolve();
        }
        
        let completed = 0;
        let hasError = false;
        
        alterStatements.forEach((sql) => {
          this.db.run(sql, (err) => {
            if (err && !err.message.includes('duplicate column')) {
              console.error('❌ 텔레그램 컬럼 추가 실패:', err.message);
              hasError = true;
            }
            
            completed++;
            
            if (completed === alterStatements.length) {
              if (hasError) {
                console.warn('⚠️ 일부 텔레그램 컬럼 추가 실패 (계속 진행)');
                resolve(); // 에러가 있어도 계속 진행
              } else {
                console.log('✅ 텔레그램 컬럼 추가 완료');
                resolve();
              }
            }
          });
        });
      });
    });
  }

  // audit_logs 테이블 존재 보장 (기존 DB 마이그레이션용)
  ensureAuditLogsTable() {
    return new Promise((resolve, reject) => {
      this.db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        username TEXT,
        display_name TEXT,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        record_id TEXT,
        old_data TEXT,
        new_data TEXT,
        description TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('❌ audit_logs 테이블 생성 실패:', err.message);
          return reject(err);
        }
        console.log('✅ audit_logs 테이블 확인 완료');
        resolve();
      });
    });
  }

  // 자주 조회되는 컬럼에 인덱스 추가
  ensureIndexes() {
    const indexStatements = [
      // drbet_records
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_account_date ON drbet_records(account_id, record_date)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_date ON drbet_records(record_date)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_identity1 ON drbet_records(identity1)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_identity2 ON drbet_records(identity2)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_identity3 ON drbet_records(identity3)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_identity4 ON drbet_records(identity4)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_site_name1 ON drbet_records(site_name1)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_site_name2 ON drbet_records(site_name2)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_site_name3 ON drbet_records(site_name3)',
      'CREATE INDEX IF NOT EXISTS idx_drbet_records_site_name4 ON drbet_records(site_name4)',
      // settlements
      'CREATE INDEX IF NOT EXISTS idx_settlements_account_month ON settlements(account_id, year_month)',
      // identities / site_accounts / site_notes
      'CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_site_accounts_identity ON site_accounts(identity_id)',
      'CREATE INDEX IF NOT EXISTS idx_site_notes_office_site ON site_notes(office_id, site_name)',
      'CREATE INDEX IF NOT EXISTS idx_payback_cleared_lookup ON payback_cleared(site_name, office_id, account_id, identity_name)',
      // community_notices
      'CREATE INDEX IF NOT EXISTS idx_community_notices_office_site ON community_notices(office_id, site_name)',
      'CREATE INDEX IF NOT EXISTS idx_site_attendance_account_period ON site_attendance(account_id, identity_id, period_type, period_value)',
      'CREATE INDEX IF NOT EXISTS idx_site_attendance_site ON site_attendance(site_account_id)',
      // site_attendance_log
      'CREATE INDEX IF NOT EXISTS idx_attendance_log_lookup ON site_attendance_log(account_id, site_name, identity_name, attendance_date)',
      'CREATE INDEX IF NOT EXISTS idx_attendance_log_date ON site_attendance_log(attendance_date)',
      // summary
      'CREATE INDEX IF NOT EXISTS idx_summary_account_date ON drbet_daily_summary(account_id, summary_date)',
      // audit_logs
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_table_date ON audit_logs(table_name, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_account_date ON audit_logs(account_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)'
    ];

    return new Promise((resolve) => {
      let completed = 0;
      indexStatements.forEach((sql) => {
        this.db.run(sql, (err) => {
          if (err) console.warn('인덱스 생성 경고:', err.message);
          completed++;
          if (completed === indexStatements.length) {
            console.log('✅ 인덱스 점검/생성 완료');
            resolve();
          }
        });
      });
    });
  }
}

// 싱글톤 인스턴스 (lazy initialization)
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    let dbPath;
    if (process.env.DB_PATH) {
      // 환경변수가 있으면 절대 경로로 변환
      dbPath = path.resolve(process.cwd(), process.env.DB_PATH);
    } else {
      // 기본 경로
      dbPath = path.join(__dirname, 'management_system.db');
    }
    console.log('🔧 DB 인스턴스 생성 중');
    console.log('   - 환경변수 DB_PATH:', process.env.DB_PATH);
    console.log('   - 작업 디렉토리:', process.cwd());
    console.log('   - 절대 경로:', dbPath);
    dbInstance = new DatabaseManager(dbPath);
  }
  return dbInstance;
}

// 기존 코드 호환성을 위해 db 객체로 export
module.exports = new Proxy({}, {
  get(target, prop) {
    return getDatabase()[prop];
  }
});
