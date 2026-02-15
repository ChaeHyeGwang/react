const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../database/db');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB_PATH 환경변수 사용 (settlements.js와 동일하게)
const dbPath = process.env.DB_PATH 
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, '..', 'database', 'management_system.db');
const dbLegacy = new sqlite3.Database(dbPath);

// 대시보드 요약 정보 조회 (정산관리 수익 기반)
router.get('/summary', auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || (currentDate.getMonth() + 1);
    // 계정/사무실 필터 결정: auth 미들웨어에서 설정된 filterAccountId 또는 filterOfficeId 사용
    const filterAccountId = req.user.filterAccountId || null;
    const filterOfficeId = req.user.filterOfficeId || null;
    
    // 이번 달 수익 합계
    const yearMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    let monthlyProfitSql = 'SELECT SUM(s.ka_amount) as total FROM settlements s';
    let monthlyProfitParams = [yearMonth];
    if (filterAccountId) {
      monthlyProfitSql += ' WHERE s.year_month = ? AND s.account_id = ?';
      monthlyProfitParams.push(filterAccountId);
    } else if (filterOfficeId) {
      monthlyProfitSql += ' INNER JOIN accounts a ON s.account_id = a.id WHERE s.year_month = ? AND a.office_id = ?';
      monthlyProfitParams.push(filterOfficeId);
    } else {
      monthlyProfitSql += ' WHERE s.year_month = ?';
    }
    const monthlyProfit = await db.get(monthlyProfitSql, monthlyProfitParams);
    
    // 이번 주 수익 (월요일부터 오늘까지)
    // 현재 월을 조회 중일 때만 의미 있는 값, 과거 월이면 0
    const today = new Date();
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    let weeklyProfit = 0;
    if (yearMonth === currentYearMonth) {
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      
      // 월 경계를 넘는 주를 처리: 날짜를 하루씩 순회
      const dates = [];
      const current = new Date(monday);
      while (current <= today) {
        const ym = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        const dayNum = current.getDate();
        dates.push({ yearMonth: ym, day: dayNum });
        current.setDate(current.getDate() + 1);
      }
      
      for (const { yearMonth: ym, day } of dates) {
        let dayProfitSql = 'SELECT SUM(s.ka_amount) as total FROM settlements s';
        let dayProfitParams = [ym, day];
        if (filterAccountId) {
          dayProfitSql += ' WHERE s.year_month = ? AND s.day_number = ? AND s.account_id = ?';
          dayProfitParams.push(filterAccountId);
        } else if (filterOfficeId) {
          dayProfitSql += ' INNER JOIN accounts a ON s.account_id = a.id WHERE s.year_month = ? AND s.day_number = ? AND a.office_id = ?';
          dayProfitParams.push(filterOfficeId);
        } else {
          dayProfitSql += ' WHERE s.year_month = ? AND s.day_number = ?';
        }
        const dayProfit = await db.get(dayProfitSql, dayProfitParams);
        weeklyProfit += dayProfit?.total || 0;
      }
    }
    
    // 전체 누적 수익
    let totalProfitSql = 'SELECT SUM(s.ka_amount) as total FROM settlements s';
    let totalProfitParams = [];
    if (filterAccountId) {
      totalProfitSql += ' WHERE s.account_id = ?';
      totalProfitParams.push(filterAccountId);
    } else if (filterOfficeId) {
      totalProfitSql += ' INNER JOIN accounts a ON s.account_id = a.id WHERE a.office_id = ?';
      totalProfitParams.push(filterOfficeId);
    }
    const totalProfit = await db.get(totalProfitSql, totalProfitParams);
    
    // 사이트 통계
    let allSitesList = [];
    if (filterAccountId) {
      const identities = await db.all('SELECT id FROM identities WHERE account_id = ?', [filterAccountId]);
      if (identities.length > 0) {
        const identityIds = identities.map(i => i.id);
        if (identityIds.length > 0) {
          const placeholders = identityIds.map(() => '?').join(',');
          allSitesList = await db.all(
            `SELECT site_name, status FROM site_accounts WHERE identity_id IN (${placeholders})`,
            identityIds
          );
        }
      }
    } else if (filterOfficeId) {
      // 사무실별 사이트 조회
      allSitesList = await db.all(
        `SELECT DISTINCT sa.site_name, sa.status 
         FROM site_accounts sa
         INNER JOIN identities i ON sa.identity_id = i.id
         INNER JOIN accounts a ON i.account_id = a.id
         WHERE a.office_id = ?`,
        [filterOfficeId]
      );
    } else {
      allSitesList = await db.all(`SELECT site_name, status FROM site_accounts`, []);
    }
    
    // 마지막 상태 기준으로 다시 계산
    let totalCount = 0;
    let approvedCount = 0;
    const approvedSitesLog = [];
    const siteDetails = [];

    const getExclusionReason = (lastStatus) => {
      if (lastStatus.includes('졸업')) return '졸업 제외';
      if (lastStatus.includes('팅')) return '팅 제외';
      if (lastStatus.includes('가입전')) return '가입전 제외';
      if (lastStatus.includes('대기')) return '대기 제외';
      return '';
    };
    
    console.log(`[승인 사이트] 집계 시작: 총 ${allSitesList.length}개 사이트`);
    allSitesList.forEach((site, idx) => {
      const parts = site.status.split('/');
      const lastStatus = parts[parts.length - 1].trim();
      const beforeTotal = totalCount;
      const beforeApproved = approvedCount;
      
      // 원래 로직(+요청 반영): '졸업/팅/가입전/대기'는 전체에서 제외
      const includeTotal = !lastStatus.includes('졸업') && !lastStatus.includes('팅') && !lastStatus.includes('가입전') && !lastStatus.includes('대기');
      if (includeTotal) {
        totalCount++;
      }
      
      // 원래 로직: '승인'을 포함하면 승인 카운트
      const includeApproved = lastStatus.includes('승인');
      if (includeApproved) {
        approvedCount++;
        approvedSitesLog.push({
          site: site.site_name,
          lastStatus,
          statusRaw: site.status
        });
      }

      siteDetails.push({
        siteName: site.site_name,
        lastStatus,
        statusRaw: site.status,
        includedInTotal: includeTotal,
        includedInApproved: includeApproved,
        exclusionReason: includeTotal ? '' : getExclusionReason(lastStatus)
      });
      
      if (idx < 20) {
        console.log(`[승인 사이트][${idx+1}] site=${site.site_name} statusRaw="${site.status}" last="${lastStatus}" total+${includeTotal ? 1:0}(${beforeTotal}->${totalCount}) approved+${includeApproved ? 1:0}(${beforeApproved}->${approvedCount})`);
      }
    });
    
    // 승인 사이트 전체 목록 로그 (정렬하여 비교 용이)
    if (approvedSitesLog.length > 0) {
      const sortedApproved = approvedSitesLog
        .sort((a, b) => a.site.localeCompare(b.site, 'ko'))
        .map((entry, index) => `[${index + 1}] ${entry.site} (last="${entry.lastStatus}" raw="${entry.statusRaw}")`);
      console.log('[승인 사이트] 전체 목록:\n' + sortedApproved.join('\n'));
    } else {
      console.log('[승인 사이트] 승인된 사이트 없음');
    }
    console.log(`[승인 사이트] 최종 집계: 승인=${approvedCount} / 전체=${totalCount}`);
    
    res.json({
      totalMargin: totalProfit?.total || 0,
      monthlyMargin: monthlyProfit?.total || 0,
      weeklyMargin: Math.round(weeklyProfit),
      totalSites: totalCount,
      activeSites: approvedCount,
      siteDetails
    });
    
  } catch (error) {
    console.error('통계 요약 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 월별 수익 추이 (최근 6개월)
router.get('/monthly-trend', auth, async (req, res) => {
  try {
    // 계정/사무실 필터 결정
    const filterAccountId = req.user.filterAccountId || null;
    const filterOfficeId = req.user.filterOfficeId || null;
    
    // 최근 6개월 데이터
    const months = [];
    const currentDate = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      months.push({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        label: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
      });
    }
    
    const results = [];
    
    for (const monthData of months) {
      const yearMonth = `${monthData.year}-${String(monthData.month).padStart(2, '0')}`;
      
      let profitSql = 'SELECT SUM(s.ka_amount) as total FROM settlements s';
      let profitParams = [yearMonth];
      if (filterAccountId) {
        profitSql += ' WHERE s.year_month = ? AND s.account_id = ?';
        profitParams.push(filterAccountId);
      } else if (filterOfficeId) {
        profitSql += ' INNER JOIN accounts a ON s.account_id = a.id WHERE s.year_month = ? AND a.office_id = ?';
        profitParams.push(filterOfficeId);
      } else {
        profitSql += ' WHERE s.year_month = ?';
      }
      const profit = await db.get(profitSql, profitParams);
      
      results.push({
        month: monthData.label,
        margin: profit?.total || 0
      });
    }
    
    res.json(results);
    
  } catch (error) {
    console.error('월별 추이 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 사이트별 포인트 순위
router.get('/by-site', auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || (currentDate.getMonth() + 1);
    const yearMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    
    // 계정/사무실 필터 결정
    const filterAccountId = req.user.filterAccountId || null;
    const filterOfficeId = req.user.filterOfficeId || null;
    let identityNames = [];
    let allowedSiteNames = [];
    
    if (filterAccountId) {
      const identities = await db.all('SELECT id, name FROM identities WHERE account_id = ?', [filterAccountId]);
      if (identities.length > 0) {
        identityNames = identities.map(i => i.name);
        const identityIds = identities.map(i => i.id);
        if (identityIds.length > 0) {
          const placeholders = identityIds.map(() => '?').join(',');
          const siteRows = await db.all(`SELECT site_name FROM site_accounts WHERE identity_id IN (${placeholders})`, identityIds);
          allowedSiteNames = siteRows.map(r => (r.site_name || '').trim()).filter(Boolean);
        }
      }
      if (identityNames.length === 0 && allowedSiteNames.length === 0) {
        return res.json([]);
      }
    } else if (filterOfficeId) {
      // 사무실별 명의 및 사이트 조회
      const identities = await db.all(
        `SELECT DISTINCT i.id, i.name 
         FROM identities i
         INNER JOIN accounts a ON i.account_id = a.id
         WHERE a.office_id = ?`,
        [filterOfficeId]
      );
      identityNames = identities.map(i => i.name);
      const identityIds = identities.map(i => i.id);
      if (identityIds.length > 0) {
        const placeholders = identityIds.map(() => '?').join(',');
        const siteRows = await db.all(`SELECT site_name FROM site_accounts WHERE identity_id IN (${placeholders})`, identityIds);
        allowedSiteNames = siteRows.map(r => (r.site_name || '').trim()).filter(Boolean);
      }
    }
    
    console.log(`[사이트별 포인트] 조회 시작: ${yearMonth} ${filterAccountId ? `(계정: ${filterAccountId})` : filterOfficeId ? `(사무실: ${filterOfficeId})` : '(전체 데이터)'}`);
    
    // 이번 달 DRBet 레코드 가져오기
    let sql = `SELECT dr.* FROM drbet_records dr`;
    let params = [`${yearMonth}%`];
    
    if (filterAccountId) {
      sql += ` WHERE dr.record_date LIKE ? AND dr.account_id = ?`;
      params.push(filterAccountId);
    } else if (filterOfficeId) {
      sql += ` INNER JOIN accounts a ON dr.account_id = a.id WHERE dr.record_date LIKE ? AND a.office_id = ?`;
      params.push(filterOfficeId);
    } else {
      sql += ` WHERE dr.record_date LIKE ?`;
    }
    
    if (filterAccountId || filterOfficeId) {
      const idPlaceholders = identityNames.length > 0 ? identityNames.map(() => '?').join(',') : '';
      const sitePlaceholders = allowedSiteNames.length > 0 ? allowedSiteNames.map(() => '?').join(',') : '';
      if (idPlaceholders) {
        sql += ` AND (dr.identity1 IN (${idPlaceholders}) OR dr.identity2 IN (${idPlaceholders}) OR dr.identity3 IN (${idPlaceholders}) OR dr.identity4 IN (${idPlaceholders}))`;
        params.push(...identityNames, ...identityNames, ...identityNames, ...identityNames);
      }
      if (sitePlaceholders) {
        sql += ` AND (dr.site_name1 IN (${sitePlaceholders}) OR dr.site_name2 IN (${sitePlaceholders}) OR dr.site_name3 IN (${sitePlaceholders}) OR dr.site_name4 IN (${sitePlaceholders}))`;
        params.push(...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames);
      }
    }
    
    const records = await new Promise((resolve, reject) => {
      dbLegacy.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    console.log(`[사이트별 포인트] DRBet 레코드 수: ${records.length}`);
    
    // 사이트별로 포인트 집계
    const siteStats = {};
    let totalParsed = 0;
    
    records.forEach((record, idx) => {
      const notes = record.notes || '';
      
      if (idx < 3) {
        console.log(`[사이트별 포인트] 레코드 ${idx + 1} notes:`, notes);
        console.log(`[사이트별 포인트] 레코드 ${idx + 1} sites:`, 
          record.site_name1, record.site_name2, record.site_name3, record.site_name4);
      }
      
      // notes에서 포인트 파싱: "김구50/원탑10"
      const parts = notes.split('/').map(p => p.trim()).filter(p => p);
      
      // 레코드의 실제 사이트명 목록 추출
      const recordSiteNames = [];
      for (let i = 1; i <= 4; i++) {
        const sn = record[`site_name${i}`];
        if (sn && sn.trim()) {
          recordSiteNames.push(sn.trim());
        }
      }
      
      parts.forEach(part => {
        let siteName = null;
        let pointsValue = 0;
        
        // 디버깅: 원본 part 출력
        if (idx < 3) {
          console.log(`[사이트별 포인트] 원본 part: "${part}"`);
          console.log(`[사이트별 포인트] 레코드의 사이트명 목록:`, recordSiteNames);
        }
        
        // 실제 사이트명 목록을 기반으로 매칭
        let matched = false;
        
        // 1. 포인트 종류 포함 패턴 확인 (예: "샷벳출석10", "샷벳페이백20")
        for (const actualSiteName of recordSiteNames) {
          const pointTypePattern = new RegExp(`^${actualSiteName}(출석|페이백|정착|요율|지추|첫충|매충|입플)(\\d+(?:\\.\\d+)?)`);
          const pointTypeMatch = part.match(pointTypePattern);
          
          if (pointTypeMatch) {
            siteName = actualSiteName;
            pointsValue = parseFloat(pointTypeMatch[2]) || 0;
            matched = true;
            if (idx < 3) {
              console.log(`[사이트별 포인트] 포인트 종류 패턴 매칭: ${part} -> 사이트=${siteName}, 종류=${pointTypeMatch[1]}, 포인트=${pointsValue}`);
            }
            break;
          }
        }
        
        // 2. 일반 패턴 확인 (예: "샷벳10")
        if (!matched) {
          for (const actualSiteName of recordSiteNames) {
            const simplePattern = new RegExp(`^${actualSiteName}(\\d+(?:\\.\\d+)?)`);
            const simpleMatch = part.match(simplePattern);
            
            if (simpleMatch) {
              siteName = actualSiteName;
              pointsValue = parseFloat(simpleMatch[1]) || 0;
              matched = true;
              if (idx < 3) {
                console.log(`[사이트별 포인트] 일반 패턴 매칭: ${part} -> 사이트=${siteName}, 포인트=${pointsValue}`);
              }
              break;
            }
          }
        }
        
        if (!matched && idx < 3) {
          console.log(`[사이트별 포인트] 패턴 매칭 실패: ${part}`);
        }
        
        if (siteName && pointsValue > 0) {
          const pointsInWon = Math.round(pointsValue * 10000); // 1p = 10,000원
          
          if (idx < 3) {
            console.log(`[사이트별 포인트] 파싱 완료: ${part} -> 사이트=${siteName}, 포인트=${pointsValue}p (${pointsInWon}원)`);
          }
          
          // 사이트명이 이미 레코드에 있고, 허용된(계정 소속) 사이트일 때만 집계
          const isAllowedSite = (allowedSiteNames.length === 0) || allowedSiteNames.includes(siteName);
          if (recordSiteNames.includes(siteName) && isAllowedSite) {
            totalParsed++;
            
            if (!siteStats[siteName]) {
              siteStats[siteName] = {
                siteName,
                totalPoints: 0,
                recordCount: 0,
                identities: new Set()
              };
            }
            
            siteStats[siteName].totalPoints += pointsInWon;
            siteStats[siteName].recordCount++;
            
            // 해당 사이트의 명의 찾기
            for (let i = 1; i <= 4; i++) {
              if (record[`site_name${i}`] === siteName && record[`identity${i}`]) {
                siteStats[siteName].identities.add(record[`identity${i}`]);
              }
            }
          }
        }
      });
    });
    
    console.log(`[사이트별 포인트] 총 파싱된 포인트 수: ${totalParsed}`);
    console.log(`[사이트별 포인트] 집계 결과:`, Object.keys(siteStats).map(k => `${k}: ${siteStats[k].totalPoints}원`));
    
    // 배열로 변환
    const results = Object.values(siteStats).map(stat => ({
      siteName: stat.siteName,
      totalPoints: stat.totalPoints,
      recordCount: stat.recordCount,
      identityCount: stat.identities.size,
      avgPoints: stat.recordCount > 0 ? Math.round(stat.totalPoints / stat.recordCount) : 0
    }));
    
    // 포인트 순으로 정렬
    results.sort((a, b) => b.totalPoints - a.totalPoints);
    
    console.log(`[사이트별 포인트] 최종 결과 수: ${results.length}`);
    
    res.json(results);
    
  } catch (error) {
    console.error('사이트별 통계 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 명의별 포인트 분석 (기존 로직 유지)
router.get('/by-identity', auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || (currentDate.getMonth() + 1);
    const yearMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    
    console.log(`[명의별 포인트] 조회 시작: ${yearMonth}`);
    
    // 계정/사무실 필터 결정
    const filterAccountId = req.user.filterAccountId || null;
    const filterOfficeId = req.user.filterOfficeId || null;
    
    let identities = [];
    if (filterAccountId) {
      identities = await db.all('SELECT id, name FROM identities WHERE account_id = ?', [filterAccountId]);
      if (identities.length === 0) return res.json([]);
    } else if (filterOfficeId) {
      // 사무실별 명의 조회
      identities = await db.all(
        `SELECT DISTINCT i.id, i.name 
         FROM identities i
         INNER JOIN accounts a ON i.account_id = a.id
         WHERE a.office_id = ?`,
        [filterOfficeId]
      );
    } else {
      identities = await db.all('SELECT id, name FROM identities', []);
    }
    const identityNames = identities.map(i => i.name);
    
    console.log(`[명의별 포인트] 명의 목록:`, identityNames);
    
    if (identities.length === 0) {
      return res.json([]);
    }
    
    // 허용 사이트(계정/사무실 소속) - 전체 조회 시에는 필터 없음
    let allowedSiteNames = [];
    if (filterAccountId || filterOfficeId) {
      const identityIds = identities.map(i => i.id);
      if (identityIds.length > 0) {
        const placeholdersSites = identityIds.map(() => '?').join(',');
        const siteRows = await db.all(`SELECT site_name FROM site_accounts WHERE identity_id IN (${placeholdersSites})`, identityIds);
        allowedSiteNames = siteRows.map(r => (r.site_name || '').trim()).filter(Boolean);
      }
    }
    
    const placeholders = identityNames.map(() => '?').join(',');
    
    // 이번 달 모든 DRBet 레코드 가져오기
    let sql = '';
    let sqlParams = [];
    
    if (filterAccountId) {
      const accountFilterSql = ' AND dr.account_id = ?';
      const siteFilterSql = (allowedSiteNames.length > 0)
        ? ` AND (dr.site_name1 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR dr.site_name2 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR dr.site_name3 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR dr.site_name4 IN (${allowedSiteNames.map(()=>'?').join(',')}))`
        : '';
      sql = `
        SELECT dr.* FROM drbet_records dr
        WHERE dr.record_date LIKE ? 
        AND (dr.identity1 IN (${placeholders}) OR dr.identity2 IN (${placeholders}) OR dr.identity3 IN (${placeholders}) OR dr.identity4 IN (${placeholders}))
        ${siteFilterSql}
        ${accountFilterSql}
      `;
      sqlParams = [`${yearMonth}%`, ...identityNames, ...identityNames, ...identityNames, ...identityNames];
      if (allowedSiteNames.length > 0) {
        sqlParams.push(...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames);
      }
      sqlParams.push(filterAccountId);
    } else if (filterOfficeId) {
      const siteFilterSql = (allowedSiteNames.length > 0)
        ? ` AND (dr.site_name1 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR dr.site_name2 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR dr.site_name3 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR dr.site_name4 IN (${allowedSiteNames.map(()=>'?').join(',')}))`
        : '';
      sql = `
        SELECT dr.* FROM drbet_records dr
        INNER JOIN accounts a ON dr.account_id = a.id
        WHERE dr.record_date LIKE ? 
        AND a.office_id = ?
        AND (dr.identity1 IN (${placeholders}) OR dr.identity2 IN (${placeholders}) OR dr.identity3 IN (${placeholders}) OR dr.identity4 IN (${placeholders}))
        ${siteFilterSql}
      `;
      sqlParams = [`${yearMonth}%`, filterOfficeId, ...identityNames, ...identityNames, ...identityNames, ...identityNames];
      if (allowedSiteNames.length > 0) {
        sqlParams.push(...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames);
      }
    } else {
      const siteFilterSql = (allowedSiteNames.length > 0)
        ? ` AND (site_name1 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR site_name2 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR site_name3 IN (${allowedSiteNames.map(()=>'?').join(',')}) OR site_name4 IN (${allowedSiteNames.map(()=>'?').join(',')}))`
        : '';
      sql = `
        SELECT * FROM drbet_records 
        WHERE record_date LIKE ? 
        AND (identity1 IN (${placeholders}) OR identity2 IN (${placeholders}) OR identity3 IN (${placeholders}) OR identity4 IN (${placeholders}))
        ${siteFilterSql}
      `;
      sqlParams = [`${yearMonth}%`, ...identityNames, ...identityNames, ...identityNames, ...identityNames];
      if (allowedSiteNames.length > 0) {
        sqlParams.push(...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames, ...allowedSiteNames);
      }
    }
    
    const records = await new Promise((resolve, reject) => {
      dbLegacy.all(sql, sqlParams, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    console.log(`[명의별 포인트] DRBet 레코드 수: ${records.length}`);
    
    // 명의별로 포인트 집계
    const identityStats = {};
    
    // 해당 계정 데이터에서 명의별 통계 생성
    identityNames.forEach(identityName => {
      identityStats[identityName] = {
        totalPoints: 0,
        recordCount: 0,
        sites: new Set()
      };
    });
    
    records.forEach(record => {
      const notes = record.notes || '';
      
      // notes에서 포인트 파싱: "김구50/원탑10"
      const parts = notes.split('/').map(p => p.trim()).filter(p => p);
      
      const sitePoints = {}; // 이 레코드의 사이트별 포인트
      
      // 레코드의 실제 사이트명 목록 추출
      const recordSiteNames = [];
      for (let i = 1; i <= 4; i++) {
        const sn = record[`site_name${i}`];
        if (sn && sn.trim()) {
          recordSiteNames.push(sn.trim());
        }
      }
      
      parts.forEach(part => {
        let siteName = null;
        let pointsValue = 0;
        
        // 실제 사이트명 목록을 기반으로 매칭
        let matched = false;
        
        // 1. 포인트 종류 포함 패턴 확인
        for (const actualSiteName of recordSiteNames) {
          const pointTypePattern = new RegExp(`^${actualSiteName}(출석|페이백|정착|요율|지추|첫충|매충|입플)(\\d+(?:\\.\\d+)?)`);
          const pointTypeMatch = part.match(pointTypePattern);
          
          if (pointTypeMatch) {
            siteName = actualSiteName;
            pointsValue = parseFloat(pointTypeMatch[2]) || 0;
            matched = true;
            break;
          }
        }
        
        // 2. 일반 패턴 확인
        if (!matched) {
          for (const actualSiteName of recordSiteNames) {
            const simplePattern = new RegExp(`^${actualSiteName}(\\d+(?:\\.\\d+)?)`);
            const simpleMatch = part.match(simplePattern);
            
            if (simpleMatch) {
              siteName = actualSiteName;
              pointsValue = parseFloat(simpleMatch[1]) || 0;
              matched = true;
              break;
            }
          }
        }
        
        if (siteName && pointsValue > 0) {
          const pointsInWon = Math.round(pointsValue * 10000);
          
          // 계정 소속 사이트만 집계
          const isAllowedSite = (allowedSiteNames.length === 0) || allowedSiteNames.includes(siteName);
          if (recordSiteNames.includes(siteName) && isAllowedSite) {
            // 같은 사이트의 포인트를 누적 (사이트별 포인트와 동일한 방식)
            sitePoints[siteName] = (sitePoints[siteName] || 0) + pointsInWon;
          }
        }
      });
      
      // 각 명의별로 해당 명의의 사이트 포인트 집계
      for (let i = 1; i <= 4; i++) {
        const identityName = record[`identity${i}`];
        const siteName = record[`site_name${i}`];
        
        if (identityName && identityStats[identityName] && siteName && sitePoints[siteName]) {
          identityStats[identityName].totalPoints += sitePoints[siteName];
          identityStats[identityName].recordCount++;
          identityStats[identityName].sites.add(siteName);
        }
      }
    });
    
    // 각 명의의 사이트 수 조회 (해당 계정의 명의에 한정)
    const results = [];
    
    // 현재 계정의 identities만 사용
    for (const identityName of identityNames) {
      const stats = identityStats[identityName];
      if (!stats) continue;
      
      // 해당 명의 찾기
      const identity = identities.find(i => i.name === identityName);
      if (!identity) continue;
      
      // 해당 명의의 모든 사이트 가져오기
      const sites = await db.all(
        'SELECT status FROM site_accounts WHERE identity_id = ?',
        [identity.id]
      );
      
      // 마지막 상태 기준으로 계산
      let totalSites = 0;
      let approvedSites = 0;
      
      sites.forEach(site => {
        const parts = site.status.split('/');
        const lastStatus = parts[parts.length - 1].trim();
        
        // 졸업, 팅, 가입전, 대기가 아니면 전체에 포함 (summary와 동일 기준)
        if (!lastStatus.includes('졸업') && !lastStatus.includes('팅') && !lastStatus.includes('가입전') && !lastStatus.includes('대기')) {
          totalSites++;
        }
        
        // 승인이면 승인 카운트
        if (lastStatus.includes('승인')) {
          approvedSites++;
        }
      });
      
      const efficiency = totalSites > 0 ? Math.round(stats.totalPoints / totalSites) : 0;
      
      console.log(`[명의별 포인트] ${identity.name}: 포인트=${stats.totalPoints}원, 사이트=${totalSites}개(승인:${approvedSites}개), 효율성=${efficiency}원/개`);
      
      results.push({
        identityName: identity.name,
        totalPoints: stats.totalPoints,
        siteCount: totalSites,
        activeSiteCount: approvedSites,
        usedSiteCount: stats.sites.size,
        efficiency: efficiency,
        recordCount: stats.recordCount
      });
    }
    
    // 포인트 순으로 정렬
    results.sort((a, b) => b.totalPoints - a.totalPoints);
    
    console.log(`[명의별 포인트] 최종 결과:`, results.map(r => `${r.identityName}: ${r.totalPoints}원`));
    
    res.json(results);
    
  } catch (error) {
    console.error('명의별 통계 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 일별 수익 추이 (이번 달)
router.get('/daily-trend', auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || (currentDate.getMonth() + 1);
    const yearMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    
    // 계정/사무실 필터 결정
    const filterAccountId = req.user.filterAccountId || null;
    const filterOfficeId = req.user.filterOfficeId || null;
    
    let settlementsSql = 'SELECT s.day_number, SUM(s.ka_amount) as total FROM settlements s';
    let settlementsParams = [yearMonth];
    if (filterAccountId) {
      settlementsSql += ' WHERE s.year_month = ? AND s.account_id = ?';
      settlementsParams.push(filterAccountId);
    } else if (filterOfficeId) {
      settlementsSql += ' INNER JOIN accounts a ON s.account_id = a.id WHERE s.year_month = ? AND a.office_id = ?';
      settlementsParams.push(filterOfficeId);
    } else {
      settlementsSql += ' WHERE s.year_month = ?';
    }
    settlementsSql += ' GROUP BY s.day_number ORDER BY s.day_number';
    
    const settlements = await db.all(settlementsSql, settlementsParams);
    
    // 해당 월의 모든 날짜 생성
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const settlementMap = new Map();
    settlements.forEach(row => {
      settlementMap.set(row.day_number, row.total || 0);
    });
    
    const results = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const margin = settlementMap.has(day) ? settlementMap.get(day) : null;
      results.push({
        date: String(day), // 일만 표시
        fullDate: `${yearMonth}-${String(day).padStart(2, '0')}`,
        margin: margin
      });
    }
    
    res.json(results);
    
  } catch (error) {
    console.error('일별 추이 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

