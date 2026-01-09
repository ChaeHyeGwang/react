/**
 * 마진 계산 공통 유틸리티
 * DRBet.js와 Finish.js에서 공통으로 사용되는 계산 함수들
 */

/**
 * 사이트 데이터 파싱 (구형 방식)
 * @param {string} input - "10 20" 형식의 문자열
 * @returns {{ charge: number, withdraw: number }}
 */
export function parseSiteData(input) {
  if (!input) return { charge: 0, withdraw: 0 };
  const match = input.match(/(\d+)\s*(\d+)?/);
  if (match) {
    return {
      charge: parseInt(match[1]) * 10000,
      withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
    };
  }
  return { charge: 0, withdraw: 0 };
}

/**
 * 충전/환전 데이터 파싱 (신형 방식)
 * @param {string} input - "10 20" 형식의 문자열
 * @returns {{ charge: number, withdraw: number }}
 */
export function parseChargeWithdraw(input) {
  if (!input) return { charge: 0, withdraw: 0 };
  const match = input.match(/(\d+)\s*(\d+)?/);
  if (match) {
    return {
      charge: parseInt(match[1]) * 10000,
      withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
    };
  }
  return { charge: 0, withdraw: 0 };
}

/**
 * 특이사항에서 충전/환전 금액 파싱
 * @param {string} input - "10충/5환" 형식의 문자열
 * @returns {{ charge: number, withdraw: number }}
 */
export function parseNotes(input) {
  if (!input) return { charge: 0, withdraw: 0 };
  let totalCharge = 0;
  let totalWithdraw = 0;
  
  const chargeMatches = input.match(/(\d{1,3})충/g);
  const withdrawMatches = input.match(/(\d{1,3})환/g);
  
  if (chargeMatches) {
    chargeMatches.forEach(m => {
      const amount = parseInt(m.replace('충', ''));
      totalCharge += amount * 10000;
    });
  }
  
  if (withdrawMatches) {
    withdrawMatches.forEach(m => {
      const amount = parseInt(m.replace('환', ''));
      totalWithdraw += amount * 10000;
    });
  }
  
  return { charge: totalCharge, withdraw: totalWithdraw };
}

/**
 * 개인 충전 금액 계산
 * @param {Object} record - DRBet 레코드
 * @returns {number} 개인 충전 금액 합계
 */
export function calculatePrivateAmount(record) {
  const chargeWithdraw1 = parseChargeWithdraw(record.charge_withdraw1);
  const chargeWithdraw2 = parseChargeWithdraw(record.charge_withdraw2);
  const chargeWithdraw3 = parseChargeWithdraw(record.charge_withdraw3);
  const chargeWithdraw4 = parseChargeWithdraw(record.charge_withdraw4);
  
  const newWayTotal = chargeWithdraw1.charge + chargeWithdraw2.charge + chargeWithdraw3.charge + chargeWithdraw4.charge;
  
  if (newWayTotal > 0) {
    return newWayTotal;
  }
  
  // 기존 site1~4 방식으로 계산 (하위 호환성)
  const site1Data = parseSiteData(record.site1);
  const site2Data = parseSiteData(record.site2);
  const site3Data = parseSiteData(record.site3);
  const site4Data = parseSiteData(record.site4);
  
  return site1Data.charge + site2Data.charge + site3Data.charge + site4Data.charge;
}

/**
 * 받치기(DRBet) 금액 계산
 * @param {Object} record - 현재 레코드
 * @param {Object|null} previousRecord - 이전 레코드
 * @returns {number} 받치기 금액
 */
export function calculateDRBet(record, previousRecord) {
  if (!previousRecord) {
    const notesData = parseNotes(record.notes);
    return (record.drbet_amount || 0) + notesData.charge - notesData.withdraw;
  }
  
  // 이전 행의 환전 금액 추출 (새로운 구조: charge_withdraw)
  const prevChargeWithdraw1 = parseChargeWithdraw(previousRecord.charge_withdraw1);
  const prevChargeWithdraw2 = parseChargeWithdraw(previousRecord.charge_withdraw2);
  const prevChargeWithdraw3 = parseChargeWithdraw(previousRecord.charge_withdraw3);
  const prevChargeWithdraw4 = parseChargeWithdraw(previousRecord.charge_withdraw4);
  
  const newWayWithdraw = prevChargeWithdraw1.withdraw + prevChargeWithdraw2.withdraw + prevChargeWithdraw3.withdraw + prevChargeWithdraw4.withdraw;
  
  // 현재 행의 특이사항 충전/환전 금액 추출
  const currentNotesData = parseNotes(record.notes);
  
  // 새로운 방식에 값이 있으면 사용
  if (newWayWithdraw > 0) {
    const baseDrbetAmount = (previousRecord.total_amount || 0) - newWayWithdraw + (previousRecord.rate_amount || 0);
    return baseDrbetAmount + currentNotesData.charge - currentNotesData.withdraw;
  }
  
  // 기존 site1~4 방식으로 계산 (하위 호환성)
  const prevSite1Data = parseSiteData(previousRecord.site1);
  const prevSite2Data = parseSiteData(previousRecord.site2);
  const prevSite3Data = parseSiteData(previousRecord.site3);
  const prevSite4Data = parseSiteData(previousRecord.site4);
  
  const prevTotalWithdraw = prevSite1Data.withdraw + prevSite2Data.withdraw + prevSite3Data.withdraw + prevSite4Data.withdraw;
  
  const baseDrbetAmount = (previousRecord.total_amount || 0) - prevTotalWithdraw + (previousRecord.rate_amount || 0);
  return baseDrbetAmount + currentNotesData.charge - currentNotesData.withdraw;
}

/**
 * 마진 계산
 * @param {Object} record - 레코드
 * @param {number} totalCharge - 총 충전 금액 (DRBet + PrivateAmount)
 * @returns {number} 마진
 */
export function calculateMargin(record, totalCharge) {
  if (!record.total_amount || record.total_amount === 0) {
    return 0;
  }
  return record.total_amount - totalCharge;
}

/**
 * 레코드 목록에서 마진 합계 계산
 * @param {Array} records - 정렬된 레코드 목록
 * @returns {number} 마진 + 요율 합계
 */
export function calculateMarginSum(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }
  
  let marginSum = 0;
  
  records.forEach((record, index) => {
    const previousRecord = index > 0 ? records[index - 1] : null;
    const calculatedDRBet = index === 0 ? (record.drbet_amount || 0) : calculateDRBet(record, previousRecord);
    const privateAmount = calculatePrivateAmount(record);
    const totalCharge = calculatedDRBet + privateAmount;
    const margin = calculateMargin(record, totalCharge);
    const rateAmount = record.rate_amount || 0;
    
    marginSum += (isNaN(margin) ? 0 : margin) + (isNaN(rateAmount) ? 0 : rateAmount);
  });
  
  return marginSum;
}

