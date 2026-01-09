const db = require('../database/db');
const { getSiteNoteData, getAccountOfficeId } = require('./siteNotesService');
const { getKSTDateTimeString } = require('../utils/time');

// 디버그 로그 제어 (필요시 true로 변경)
const DEBUG = false;
const log = (...args) => DEBUG && console.log(...args);

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const toKSTDate = (date) => new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

const getKSTDateString = (inputDate = new Date()) => {
  const date = toKSTDate(new Date(inputDate));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeDateInput = (value) => {
  if (!value) return getKSTDateString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return getKSTDateString(new Date(value));
};

const addDays = (dateStr, days) => {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return getKSTDateString(date);
};

const getWeekRange = (dateStr) => {
  // 페이백 날짜 기준으로 전날까지의 7일 계산
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  
  // 종료일: 페이백 날짜 전날
  const endDate = new Date(date);
  endDate.setDate(date.getDate() - 1);
  
  // 시작일: 종료일로부터 6일 전 (총 7일간)
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);
  
  return {
    start: getKSTDateString(startDate),
    end: getKSTDateString(endDate)
  };
};

const parseChargeWithdraw = (value) => {
  if (!value || !value.trim()) return { deposit: 0, withdraw: 0 };
  const clean = value.trim();
  const pattern = clean.match(/(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?/);
  if (pattern) {
    return {
      deposit: parseFloat(pattern[1]) || 0,
      withdraw: pattern[2] ? parseFloat(pattern[2]) || 0 : 0
    };
  }
  return { deposit: 0, withdraw: 0 };
};

const buildIdentitySiteMap = (records) => {
  const map = {};
  records.forEach(record => {
    const recordDate = record.record_date;
    if (!recordDate) return;
    for (let i = 1; i <= 4; i++) {
      const identityName = record[`identity${i}`];
      const siteName = record[`site_name${i}`];
      const chargeWithdraw = record[`charge_withdraw${i}`];
      if (!identityName || !siteName || !chargeWithdraw || !chargeWithdraw.trim()) continue;
      const key = `${identityName}||${siteName}`;
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push({
        date: recordDate,
        ...parseChargeWithdraw(chargeWithdraw)
      });
    }
  });
  Object.values(map).forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)));
  return map;
};

const sumDepositsBetween = (entries = [], start, end) => {
  if (!start || !end) return 0;
  return entries
    .filter(entry => entry.date >= start && entry.date <= end)
    .reduce((sum, entry) => sum + (entry.deposit || 0), 0);
};

const findSettlementStartDate = (entries = []) => {
  if (!entries || entries.length === 0) return null;
  return entries[0].date || null;
};

const computePaybackData = async ({ allRecords, date, accountId, officeId }) => {
  if (!allRecords || allRecords.length === 0) {
    return [];
  }

  const weekRange = getWeekRange(date);
  const normalizedSelectedDate = (date || '').trim();
  
  // 주간 레코드 필터링: weekRange에 해당하는 레코드
  const weekRecords = allRecords.filter(record =>
    record.record_date &&
    record.record_date >= weekRange.start && record.record_date <= weekRange.end
  );
  
  // 당일 레코드 필터링: 선택된 날짜의 레코드만
  const todayRecords = allRecords.filter(record =>
    record.record_date && (record.record_date || '').trim() === normalizedSelectedDate
  );

  if (weekRecords.length === 0 && todayRecords.length === 0) {
    return [];
  }

  const stats = {};
  
  // 주간 레코드 집계 (주간 페이백용)
  weekRecords.forEach(record => {
    for (let i = 1; i <= 4; i++) {
      const identityName = record[`identity${i}`];
      const siteName = record[`site_name${i}`];
      const chargeWithdraw = record[`charge_withdraw${i}`];
      if (!identityName || !siteName) continue;
      const { deposit, withdraw } = parseChargeWithdraw(chargeWithdraw);
      const key = `${identityName}||${siteName}`;
      if (!stats[key]) {
        stats[key] = {
          identityName,
          siteName,
          weeklyDeposit: 0,
          weeklyWithdraw: 0,
          todayDeposit: 0,
          todayWithdraw: 0,
          hasTodayCompleteRecord: false // 당일 완전한 레코드 존재 여부
        };
      }
      if (deposit) stats[key].weeklyDeposit += deposit;
      if (withdraw) stats[key].weeklyWithdraw += withdraw;
    }
  });
  
  // 당일 레코드 집계 (당일 페이백용) - 완전한 레코드만 (재충X, 충전금액O, 토탈금액O)
  todayRecords.forEach(record => {
    const totalAmount = record.total_amount || 0;
    
    for (let i = 1; i <= 4; i++) {
      const identityName = record[`identity${i}`];
      const siteName = record[`site_name${i}`];
      const chargeWithdraw = record[`charge_withdraw${i}`];
      const isRecharge = record[`is_recharge${i}`] === 1 || record[`is_recharge${i}`] === true;
      
      if (!identityName || !siteName) continue;
      
      const { deposit, withdraw } = parseChargeWithdraw(chargeWithdraw);
      
      // 완전한 레코드 조건: 재충이 아니고, 충전금액이 있고, 토탈금액이 있어야 함
      const isComplete = !isRecharge && deposit > 0 && totalAmount > 0;
      if (!isComplete) continue;
      
      const key = `${identityName}||${siteName}`;
      if (!stats[key]) {
        stats[key] = {
          identityName,
          siteName,
          weeklyDeposit: 0,
          weeklyWithdraw: 0,
          todayDeposit: 0,
          todayWithdraw: 0,
          hasTodayCompleteRecord: false
        };
      }
      
      // 당일 완전한 레코드 표시
      stats[key].hasTodayCompleteRecord = true;
      stats[key].todayDeposit += (deposit || 0);
      stats[key].todayWithdraw += (withdraw || 0);
    }
  });

  const combos = Object.keys(stats);
  if (combos.length === 0) return [];

  // 캐시 제거: site_notes 업데이트 시 최신 데이터를 반영하기 위해 항상 DB에서 가져옴
  const getNote = async (identityName, siteName) => {
    return await getSiteNoteData({
      siteName,
      identityName,
      accountId,
      officeId
    });
  };
  
  // site_accounts에서 status 조회 (승인 상태 확인용)
  const getSiteAccountStatus = async (identityName, siteName) => {
    try {
      const row = await db.get(
        `SELECT sa.status 
         FROM site_accounts sa
         JOIN identities i ON sa.identity_id = i.id
         WHERE i.name = ? AND sa.site_name = ? AND i.account_id = ?`,
        [identityName, siteName, accountId]
      );
      return row?.status || '';
    } catch (e) {
      return '';
    }
  };
  
  // 마지막 상태가 "승인"인지 확인 (예: "12.02 승인 / 12.27 이벤짤" → 마지막은 "이벤짤")
  const isApprovedStatus = (status) => {
    if (!status) return false;
    const statusParts = status.split('/').map(s => s.trim());
    // 마지막 상태만 확인
    const lastPart = statusParts[statusParts.length - 1];
    const pureStatus = lastPart.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
    return pureStatus === '승인';
  };

  const currentDayName = DAY_NAMES[new Date(`${date}T00:00:00+09:00`).getDay()];
  const paybackResults = [];

  for (const combo of combos) {
    const stat = stats[combo];
    
    // 주간 데이터도 없고 당일 완전한 레코드도 없으면 스킵
    const hasWeeklyData = stat.weeklyDeposit > 0 || stat.weeklyWithdraw > 0;
    if (!hasWeeklyData && !stat.hasTodayCompleteRecord) {
      continue;
    }
    
    const siteNote = await getNote(stat.identityName, stat.siteName);
    const paybackConfig = siteNote?.data?.payback || {};
    const days = Array.isArray(paybackConfig.days) ? paybackConfig.days : [];
    const percent = parseFloat(paybackConfig.percent) || 0;
    const sameDayPercent = parseFloat(paybackConfig.sameDayPercent) || 0;

    if (days.length === 0 || (percent === 0 && sameDayPercent === 0)) {
      continue;
    }

    // 충전 금액이 없는 사이트는 스킵 (토탈충전이 0이면 제외)
    if (stat.weeklyDeposit === 0 && stat.todayDeposit === 0) {
      continue;
    }
    
    // 주간 페이백을 위해 승인 상태 확인
    const siteStatus = await getSiteAccountStatus(stat.identityName, stat.siteName);
    const hasApproval = isApprovedStatus(siteStatus);

    const weeklyNet = stat.weeklyDeposit - stat.weeklyWithdraw;
    const todayNet = stat.todayDeposit - stat.todayWithdraw;
    
    // 손실이 없으면 스킵 (충전 - 환전 <= 0이면 페이백 없음)
    if (weeklyNet <= 0 && todayNet <= 0) {
      continue;
    }

    // 사이트별 디버깅 로그 (필요 최소 정보) - DEBUG 모드일 때만
    log('[페이백][사이트]', {
      identityName: stat.identityName,
      siteName: stat.siteName,
      days,
      percent,
      sameDayPercent,
      weeklyDeposit: stat.weeklyDeposit,
      weeklyWithdraw: stat.weeklyWithdraw,
      weeklyNet,
      todayDeposit: stat.todayDeposit,
      todayWithdraw: stat.todayWithdraw,
      todayNet,
    });

    const paybackAmounts = {};
    const sameDayAmounts = {};
    const dateObj = new Date(date);
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dateNum = String(dateObj.getDate()).padStart(2, '0');
    const dateLabel = `${month}-${dateNum}`;

    days.forEach((dayLabel) => {
      if (dayLabel === '당일') {
        // 당일 페이백 계산: 완전한 레코드(토탈금액O)가 있고, sameDayPercent > 0이고 당일손실(todayNet) > 0이면 계산
        // 충전 - 환전 > 0 일 때만 페이백 지급
        if (stat.hasTodayCompleteRecord && sameDayPercent > 0 && todayNet > 0) {
          const rawWon = todayNet * 10000 * (sameDayPercent / 100);
          const roundedWon = Math.floor(rawWon / 100) * 100;
          const amount = roundedWon / 10000;
          sameDayAmounts[`당일(${dateLabel}) 페이백`] = amount;
        }
      } else if (currentDayName === dayLabel && percent > 0 && weeklyNet > 0 && hasApproval) {
        // 주간 페이백: weeklyNet > 0 (주간 충전 - 환전 > 0), 승인 상태인 경우에만
        const rawWon = weeklyNet * 10000 * (percent / 100);
        const roundedWon = Math.floor(rawWon / 100) * 100;
        const amount = roundedWon / 10000;
        paybackAmounts[dayLabel] = amount;
      }
    });

    Object.assign(paybackAmounts, sameDayAmounts);

    if (Object.keys(paybackAmounts).length === 0) continue;

    // 최종 계산된 페이백 금액 디버깅
    console.log('[페이백][계산 완료]', {
      identityName: stat.identityName,
      siteName: stat.siteName,
      paybackAmounts,
      weeklyNet,
      todayNet,
      percent,
      sameDayPercent,
    });

    const weekStartDate = weekRange.start;
    const paybackClearedMap = siteNote?.data?.paybackCleared || {};
    const isCleared = !!paybackClearedMap[weekStartDate];
    const attendanceType = siteNote?.data?.attendanceType || '자동';
    const paybackType = paybackConfig.type || '수동';

    paybackResults.push({
      identityName: stat.identityName,
      siteName: stat.siteName,
      attendanceType,
      paybackType,
      paybackAmounts,
      weeklyNet,
      todayNet,
      todayDeposit: stat.todayDeposit,  // 당일 충전액 추가
      todayWithdraw: stat.todayWithdraw,  // 당일 환전액 추가
      percent,
      sameDayPercent,
      weekStartDate,
      cleared: isCleared
    });
  }

  return paybackResults;
};

const computeSettlementBanners = async ({ allRecords, date, accountId, officeId }) => {
  console.log(`\n[정착배너] 계산 시작: date=${date}, accountId=${accountId}, officeId=${officeId}`);
  
  const dayRecords = allRecords.filter(record => record.record_date === date);
  console.log(`[정착배너] 해당 날짜 레코드 수: ${dayRecords.length}`);
  
  if (dayRecords.length === 0) {
    console.log(`[정착배너] 해당 날짜 레코드 없음 - 종료`);
    return [];
  }

  const identitySitePairs = new Set();
  dayRecords.forEach(record => {
    for (let i = 1; i <= 4; i++) {
      const identityName = record[`identity${i}`];
      const siteName = record[`site_name${i}`];
      if (identityName && siteName) {
        identitySitePairs.add(`${identityName}||${siteName}`);
      }
    }
  });

  console.log(`[정착배너] 명의+사이트 조합 수: ${identitySitePairs.size}`);
  console.log(`[정착배너] 조합 목록:`, Array.from(identitySitePairs));

  if (identitySitePairs.size === 0) {
    console.log(`[정착배너] 명의+사이트 조합 없음 - 종료`);
    return [];
  }

  const identitySiteMap = buildIdentitySiteMap(allRecords);
  const siteConfigCache = {};
  const identityNoteCache = {};

  const getSiteConfig = async (siteName) => {
    if (!siteConfigCache[siteName]) {
      siteConfigCache[siteName] = await getSiteNoteData({
        siteName,
        accountId,
        officeId
      });
    }
    return siteConfigCache[siteName];
  };

  const getIdentityNote = async (identityName, siteName) => {
    const cacheKey = `${identityName}||${siteName}`;
    if (!identityNoteCache[cacheKey]) {
      identityNoteCache[cacheKey] = await getSiteNoteData({
        siteName,
        identityName,
        accountId,
        officeId
      });
    }
    return identityNoteCache[cacheKey];
  };

  const banners = [];

  for (const pair of identitySitePairs) {
    const [identityName, siteName] = pair.split('||');
    console.log(`\n[정착배너] 처리 중: ${siteName} - ${identityName}`);
    
    const siteConfig = await getSiteConfig(siteName);
    const cfgData = siteConfig?.data || {};
    const settlementFlag = cfgData.settlement || '-';
    const days = parseInt(cfgData.settlementDays, 10) || 0;
    
    console.log(`[정착배너] ${siteName} - ${identityName}: settlementFlag=${settlementFlag}, days=${days}`);
    
    if (settlementFlag !== 'O' || !days) {
      console.log(`[정착배너] ${siteName} - ${identityName}: 정착 조건 없음 - 스킵`);
      continue;
    }

    const notesForId = await getIdentityNote(identityName, siteName);
    
    // ✅ 지급 완료된 경우 배너에 표시 안 함 (영구 숨김)
    // settlement_paid 테이블에서 직접 조회하여 확실하게 체크
    // site_name, account_id, identity_name만으로 조회 (office_id는 무시)
    // 같은 사이트/계정/명의면 지급 완료로 간주
    if (identityName && accountId) {
      // 값 정규화 (공백 제거)
      const normalizedSiteName = (siteName || '').trim();
      const normalizedIdentityName = (identityName || '').trim();
      const normalizedAccountId = accountId;
      
      console.log(`[정착배너] ${siteName} - ${identityName}: settlement_paid 조회 시도 (accountId=${normalizedAccountId})`);
      console.log(`[정착배너] 정규화된 값: siteName="${normalizedSiteName}", identityName="${normalizedIdentityName}"`);
      
      // ✅ 모든 레코드를 가져와서 JavaScript에서 직접 비교 (TRIM() 함수 문제 회피)
      const allPaidRecords = await db.all(
        `SELECT paid_at, office_id, site_name, account_id, identity_name 
         FROM settlement_paid
         WHERE account_id = ?`,
        [normalizedAccountId]
      );
      
      console.log(`[정착배너] ${siteName} - ${identityName}: 해당 accountId(${normalizedAccountId})의 모든 지급 완료 기록:`, allPaidRecords);
      
      // JavaScript에서 정규화된 값으로 직접 비교
      const settlementPaidRow = allPaidRecords.find(record => {
        const recordSiteName = (record.site_name || '').trim();
        const recordIdentityName = (record.identity_name || '').trim();
        return recordSiteName === normalizedSiteName && 
               recordIdentityName === normalizedIdentityName &&
               record.account_id === normalizedAccountId;
      });
      
      console.log(`[정착배너] ${siteName} - ${identityName}: settlement_paid 조회 결과:`, settlementPaidRow);
      
      if (settlementPaidRow) {
        console.log(`[정착배너] ✅ ${siteName} - ${identityName}: 지급 완료로 배너 숨김 (paid_at=${settlementPaidRow.paid_at})`);
        console.log(`[정착배너] 조회된 레코드 상세:`, {
          site_name: settlementPaidRow.site_name,
          identity_name: settlementPaidRow.identity_name,
          account_id: settlementPaidRow.account_id,
          office_id: settlementPaidRow.office_id
        });
        continue; // 지급 완료된 경우 배너 표시 안 함
      } else {
        console.log(`[정착배너] ${siteName} - ${identityName}: 지급 완료 기록 없음 - 배너 표시 진행`);
        console.log(`[정착배너] 조회 조건: siteName="${normalizedSiteName}", identityName="${normalizedIdentityName}", accountId=${normalizedAccountId}`);
        console.log(`[정착배너] 매칭 시도한 레코드들:`, allPaidRecords.map(r => ({
          site_name: `"${(r.site_name || '').trim()}"`,
          identity_name: `"${(r.identity_name || '').trim()}"`,
          account_id: r.account_id
        })));
      }
    } else {
      console.log(`[정착배너] ${siteName} - ${identityName}: identityName 또는 accountId 없음 - settlement_paid 조회 스킵`);
      console.log(`[정착배너] identityName=${identityName}, accountId=${accountId}`);
    }
    
    const key = `${identityName}||${siteName}`;
    const entries = identitySiteMap[key] || [];
    let startDate = notesForId?.startDate || findSettlementStartDate(entries) || '';
    const startStr = startDate || '';
    const endStr = startStr ? addDays(startStr, Math.max(days - 1, 0)) : '';
    
    console.log(`[정착배너] ${siteName} - ${identityName}: 기간 계산 - startStr=${startStr}, endStr=${endStr}, entries=${entries.length}개`);
    
    if (!startStr || !endStr) {
      console.log(`[정착배너] ${siteName} - ${identityName}: 시작일/종료일 없음 - 스킵`);
      continue;
    }

    const totalChargeMan = sumDepositsBetween(entries, startStr, endStr);
    const totalChargeWonRounded = Math.floor((totalChargeMan * 10000) / 100) * 100;
    const totalChargeManRounded = totalChargeWonRounded / 10000;
    
    console.log(`[정착배너] ${siteName} - ${identityName}: 충전금액 - ${totalChargeManRounded}만원 (${totalChargeWonRounded}원)`);

    const rules = Array.isArray(cfgData.settlementRules) ? cfgData.settlementRules : [];
    const targetSingle = parseFloat(cfgData.settlementTotal) || 0;
    
    console.log(`[정착배너] ${siteName} - ${identityName}: 규칙 수=${rules.length}, 단일 목표=${targetSingle}만원`);
    
    // 규칙도 없고 단일 조건도 없는 경우
    if (rules.length === 0 && !targetSingle) {
      console.log(`[정착배너] ❌ ${siteName} - ${identityName}: 정착 규칙 없음 (다중 규칙=0개, 단일 목표=0만원) - 배너 추가 안 함`);
      continue;
    }

    // ✅ 조건들을 분류: 달성한 조건 vs 아직 달성 못한 조건
    const achievedRules = []; // 이미 달성한 조건들
    const pendingRules = []; // 아직 달성 못한 조건들
    
    if (rules.length > 0) {
      rules.forEach((rule, idx) => {
        const ruleTarget = parseFloat(rule.total) || 0;
        if (!ruleTarget) return;
        const ruleTargetWon = ruleTarget * 10000;
        
        
        const pointRaw = rule.point || '';
        const pointNum = /^\d+(\.\d+)?$/.test(String(pointRaw)) ? parseFloat(pointRaw) : null;
        const pointDisplay = pointNum !== null ? `${pointNum}만` : (String(pointRaw) || '-');
        
        const ruleData = {
          identity: identityName,
          site: siteName,
          startDate: startStr,
          totalTarget: ruleTarget,
          totalCharge: totalChargeManRounded,
          pointDisplay,
          days,
          ruleIndex: idx
        };
        
        if (totalChargeWonRounded >= ruleTargetWon) {
          achievedRules.push(ruleData);
        } else {
          pendingRules.push(ruleData);
        }
      });
      
      console.log(`[정착배너] ${siteName} - ${identityName}: 달성 규칙=${achievedRules.length}개, 대기 규칙=${pendingRules.length}개`);
      
      // ✅ 가장 가까운 조건만 선택
      let selectedRule = null;
      
      if (pendingRules.length > 0) {
        // 아직 달성 못한 조건 중 가장 작은 목표 (가장 가까운 다음 목표)
        pendingRules.sort((a, b) => a.totalTarget - b.totalTarget);
        selectedRule = pendingRules[0];
        console.log(`[정착배너] ${siteName} - ${identityName}: 다음 목표 선택 - ${selectedRule.totalTarget}만원 (현재: ${selectedRule.totalCharge}만원)`);
      } else if (achievedRules.length > 0) {
        // 모든 조건 달성 시 가장 큰 조건 (최종 목표)
        achievedRules.sort((a, b) => b.totalTarget - a.totalTarget);
        selectedRule = achievedRules[0];
        console.log(`[정착배너] ${siteName} - ${identityName}: 최종 목표 선택 - ${selectedRule.totalTarget}만원 (현재: ${selectedRule.totalCharge}만원)`);
      }
      
      if (selectedRule) {
        console.log(`[정착배너] ✅ 배너 추가: ${siteName} - ${identityName} (목표: ${selectedRule.totalTarget}만원, 현재: ${selectedRule.totalCharge}만원, accountId: ${accountId}, officeId: ${officeId})`);
        banners.push(selectedRule);
      } else {
        console.log(`[정착배너] ❌ ${siteName} - ${identityName}: 선택된 규칙 없음 - 배너 추가 안 함`);
        console.log(`[정착배너] 상세: 달성 규칙=${achievedRules.length}개, 대기 규칙=${pendingRules.length}개, 전체 규칙=${rules.length}개`);
      }
    } else {
      // 단일 조건인 경우 (기존 로직 유지)
      // targetSingle은 이미 위에서 계산됨
      const targetSingleWon = targetSingle * 10000;
      
      console.log(`[정착배너] ${siteName} - ${identityName}: 단일 조건 - 목표=${targetSingle}만원, 현재=${totalChargeManRounded}만원, legacyCleared=${legacyCleared}`);
      
      if (!legacyCleared && !!targetSingle && totalChargeWonRounded >= targetSingleWon) {
        const pointRaw = cfgData.settlementPoint || '';
        const pointNum = /^\d+(\.\d+)?$/.test(String(pointRaw)) ? parseFloat(pointRaw) : null;
        const pointDisplay = pointNum !== null ? `${pointNum}만` : (String(pointRaw) || '-');
        console.log(`[정착배너] ✅ 단일 조건 배너 추가: ${siteName} - ${identityName} (목표: ${targetSingle}만원, 현재: ${totalChargeManRounded}만원, accountId: ${accountId}, officeId: ${officeId})`);
        banners.push({
          identity: identityName,
          site: siteName,
          startDate: startStr,
          totalTarget: targetSingle,
          totalCharge: totalChargeManRounded,
          pointDisplay,
          days
        });
      } else {
        console.log(`[정착배너] ❌ ${siteName} - ${identityName}: 단일 조건 미달성 또는 이미 지급됨 - 배너 추가 안 함`);
        if (legacyCleared) {
          console.log(`[정착배너] 이유: legacyCleared=true (이미 지급 완료)`);
        } else if (!targetSingle) {
          console.log(`[정착배너] 이유: targetSingle=0 (목표 금액 없음)`);
        } else if (totalChargeWonRounded < targetSingleWon) {
          console.log(`[정착배너] 이유: 충전금액(${totalChargeWonRounded}원) < 목표(${targetSingleWon}원) - 미달성`);
        }
      }
    }
  }

  banners.sort((a, b) => (b.totalCharge - a.totalCharge));
  console.log(`\n[정착배너] 계산 완료: 총 ${banners.length}개 배너 생성`);
  banners.forEach((banner, idx) => {
    console.log(`[정착배너] 배너 ${idx + 1}: ${banner.site} - ${banner.identity} (목표: ${banner.totalTarget}만원, 현재: ${banner.totalCharge}만원)`);
  });
  
  return banners;
};

const computeDailySummary = async ({ accountId, officeId, date }) => {
  log(`\n[일일요약] computeDailySummary 시작: date=${date}, accountId=${accountId}, officeId=${officeId}`);
  
  const allRecords = await db.all(
    `SELECT * FROM drbet_records WHERE account_id = ?`,
    [accountId]
  );
  
  log(`[일일요약] 전체 레코드 수: ${allRecords?.length || 0}`);

  if (!allRecords || allRecords.length === 0) {
    log(`[일일요약] 레코드 없음 - 빈 결과 반환`);
    return {
      paybackData: [],
      settlementBanners: []
    };
  }

  log(`[일일요약] 페이백 데이터 계산 시작...`);
  const paybackData = await computePaybackData({
    allRecords,
    date,
    accountId,
    officeId
  });
  log(`[일일요약] 페이백 데이터 계산 완료: ${paybackData.length}개`);

  log(`[일일요약] 정착 배너 계산 시작...`);
  const settlementBanners = await computeSettlementBanners({
    allRecords,
    date,
    accountId,
    officeId
  });
  log(`[일일요약] 정착 배너 계산 완료: ${settlementBanners.length}개`);

  return {
    paybackData,
    settlementBanners
  };
};

const getDailySummary = async ({ accountId, officeId, date }) => {
  log(`\n[일일요약] getDailySummary 호출: date=${date}, accountId=${accountId}, officeId=${officeId}`);
  
  if (!accountId) {
    throw new Error('accountId is required');
  }
  const normalizedDate = normalizeDateInput(date);
  const today = getKSTDateString();
  
  log(`[일일요약] 정규화된 날짜: ${normalizedDate}, 오늘: ${today}`);

  if (normalizedDate < today) {
    log(`[일일요약] 과거 날짜 - 캐시 확인 중...`);
    const cached = await db.get(
      `SELECT data, is_partial FROM drbet_daily_summary 
       WHERE account_id = ? AND summary_date = ?`,
      [accountId, normalizedDate]
    );
    if (cached?.data) {
      log(`[일일요약] ✅ 캐시에서 데이터 가져옴 (settlement_paid 필터링 적용)`);
      const parsed = parseJsonSafe(cached.data, { paybackData: [], settlementBanners: [] });
      
      // ✅ settlement_paid 정보는 실시간으로 변경될 수 있으므로, 캐시된 배너에서 지급 완료된 것 제거
      log(`[일일요약] 캐시된 정착 배너 수: ${parsed.settlementBanners?.length || 0}개`);
      
      // settlement_paid 테이블에서 모든 지급 완료 기록 조회 (배너가 없어도 조회)
      const allPaidRecords = await db.all(
        `SELECT site_name, account_id, identity_name, paid_at 
         FROM settlement_paid 
         WHERE account_id = ?`,
        [accountId]
      );
      
      log(`[일일요약] 지급 완료 기록 수: ${allPaidRecords.length}개`);
      if (allPaidRecords.length > 0) {
        log(`[일일요약] 지급 완료 기록 목록:`, allPaidRecords.map(r => ({
          site: `"${(r.site_name || '').trim()}"`,
          identity: `"${(r.identity_name || '').trim()}"`,
          account_id: r.account_id
        })));
      }
      
      if (parsed.settlementBanners && parsed.settlementBanners.length > 0) {
        // 지급 완료된 배너 제거
        const filteredBanners = parsed.settlementBanners.filter(banner => {
          const normalizedSiteName = (banner.site || '').trim();
          const normalizedIdentityName = (banner.identity || '').trim();
          
          log(`[일일요약] 배너 체크: ${normalizedSiteName} - ${normalizedIdentityName}`);
          
          const isPaid = allPaidRecords.some(record => {
            const recordSiteName = (record.site_name || '').trim();
            const recordIdentityName = (record.identity_name || '').trim();
            const match = recordSiteName === normalizedSiteName && 
                         recordIdentityName === normalizedIdentityName &&
                         record.account_id === accountId;
            
            if (match) {
              log(`[일일요약] ✅ 매칭됨: ${recordSiteName} - ${recordIdentityName} (paid_at: ${record.paid_at})`);
            }
            
            return match;
          });
          
          if (isPaid) {
            log(`[일일요약] ❌ 캐시된 배너에서 지급 완료 제거: ${banner.site} - ${banner.identity}`);
            return false; // 지급 완료됨 - 제거
          } else {
            log(`[일일요약] ✅ 배너 유지: ${banner.site} - ${banner.identity} (지급 완료 아님)`);
            return true; // 지급 완료 안 됨 - 유지
          }
        });
        
        log(`[일일요약] 필터링 전: ${parsed.settlementBanners.length}개 → 필터링 후: ${filteredBanners.length}개`);
        parsed.settlementBanners = filteredBanners;
      } else {
        log(`[일일요약] 캐시된 배너 없음 - settlement_paid 필터링 스킵`);
      }
      
      return {
        ...parsed,
        summaryDate: normalizedDate,
        fromCache: true,
        isPartial: !!cached.is_partial
      };
    } else {
      log(`[일일요약] 캐시 없음 - 새로 계산`);
    }
  } else {
    log(`[일일요약] 오늘 또는 미래 날짜 - 새로 계산`);
  }

  const resolvedOfficeId =
    typeof officeId === 'undefined' ? await getAccountOfficeId(accountId) : officeId;
  
  log(`[일일요약] resolvedOfficeId: ${resolvedOfficeId}`);

  const summary = await computeDailySummary({
    accountId,
    officeId: resolvedOfficeId,
    date: normalizedDate
  });

  if (normalizedDate < today) {
    const timestamp = getKSTDateTimeString();
    log(`[일일요약] 캐시 저장: 정착 배너 ${summary.settlementBanners?.length || 0}개`);
    await db.run(
      `INSERT OR REPLACE INTO drbet_daily_summary
         (account_id, summary_date, data, is_partial, updated_at)
       VALUES (?, ?, ?, 0, ?)`,
      [accountId, normalizedDate, JSON.stringify(summary), timestamp]
    );
    log(`[일일요약] 캐시 저장 완료`);
  }

  return {
    ...summary,
    summaryDate: normalizedDate,
    fromCache: false,
    isPartial: normalizedDate >= today
  };
};

const parseJsonSafe = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const invalidateSummaryForDate = async (accountId, date) => {
  if (!accountId) return;
  
  // date가 null이면 모든 날짜의 캐시 삭제
  if (!date) {
    await db.run(
      `DELETE FROM drbet_daily_summary 
       WHERE account_id = ?`,
      [accountId]
    );
    log(`[일일요약] 모든 날짜 캐시 무효화 완료: accountId=${accountId}`);
    return;
  }
  
  const normalizedDate = normalizeDateInput(date);
  const weekRange = getWeekRange(normalizedDate);
  const monthPrefix = normalizedDate.substring(0, 7);
  await db.run(
    `DELETE FROM drbet_daily_summary 
     WHERE account_id = ? AND summary_date BETWEEN ? AND ?`,
    [accountId, weekRange.start, weekRange.end]
  );
  await db.run(
    `DELETE FROM drbet_daily_summary 
     WHERE account_id = ? AND summary_date LIKE ?`,
    [accountId, `${monthPrefix}-%`]
  );
  log(`[일일요약] 특정 날짜/주/월 캐시 무효화 완료: accountId=${accountId}, date=${normalizedDate}`);
};

module.exports = {
  getDailySummary,
  invalidateSummaryForDate,
  getWeekRange,
  getKSTDateString
};

