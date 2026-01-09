const express = require('express');
const router = express.Router();
const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');
const { auth } = require('../middleware/auth');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 환경변수 로드 (루트 디렉토리 또는 server 디렉토리에서 .env 파일 찾기)
const dotenv = require('dotenv');
const envPath = path.join(__dirname, '..', '.env');
const serverEnvPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });
dotenv.config({ path: serverEnvPath, override: false }); // server/.env가 있으면 추가로 로드 (덮어쓰지 않음)

// 텔레그램 봇 초기화 (환경변수에서 토큰과 채팅 ID 가져오기)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// 디버깅: 환경변수 로드 확인
if (!BOT_TOKEN || !CHAT_ID) {
  console.warn('[텔레그램] 환경변수 확인:', {
    BOT_TOKEN: BOT_TOKEN ? '설정됨' : '없음',
    CHAT_ID: CHAT_ID ? '설정됨' : '없음',
    envPath,
    serverEnvPath,
    cwd: process.cwd()
  });
}

let bot = null;
if (BOT_TOKEN && CHAT_ID) {
  try {
    bot = new TelegramBot(BOT_TOKEN, { polling: false });
    console.log('텔레그램 봇이 초기화되었습니다.');
  } catch (error) {
    console.error('텔레그램 봇 초기화 실패:', error.message);
  }
} else {
  console.warn('텔레그램 봇 설정이 없습니다. .env 파일에 TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID를 설정하세요.');
}

// 기존 sqlite3 연결 (settlements 테이블용)
const dbPath = path.join(__dirname, '..', 'database', 'management_system.db');
const dbLegacy = new sqlite3.Database(dbPath);

// 정산 요약 전송
router.post('/send-settlement', auth, async (req, res) => {
  try {
    const { date, summary } = req.body;
    
    if (!bot || !CHAT_ID) {
      return res.status(400).json({ 
        error: '텔레그램 봇이 설정되지 않았습니다. .env 파일을 확인하세요.' 
      });
    }

    // 특이사항 메시지 구성
    let specialNotesText = '';
    if (summary.specialNotes && Array.isArray(summary.specialNotes) && summary.specialNotes.length > 0) {
      const notesList = summary.specialNotes.map(item => `  • ${item.content}`).join('\n');
      specialNotesText = `
━━━━━━━━━━━━━━━━━━━━
📝 *특이사항:*
${notesList}
`;
    }

    // 계정 이름 확인 (선택한 계정이 있으면 해당 계정 이름 사용)
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    let accountName = req.user.displayName || req.user.username || `계정 #${filterAccountId}`;

    if (req.user.filterAccountId && req.user.filterAccountId !== req.user.accountId) {
      try {
        const accountRow = await db.get('SELECT display_name, username FROM accounts WHERE id = ?', [filterAccountId]);
        if (accountRow) {
          accountName = accountRow.display_name || accountRow.username || accountName;
        }
      } catch (e) {
        console.warn('계정명 조회 실패:', e.message);
      }
    }

    const escapedAccountName = escapeMarkdown(accountName);
    const isStartSummary = summary.mode === 'start';
    const hasStartAmount = typeof summary.startAmountTotal === 'number';
    const startAmountValue = hasStartAmount
      ? summary.startAmountTotal
      : (summary.yesterdayBalance || 0);
    const startLabel = hasStartAmount ? '오늘 시작금액' : '어제 마무리';

    if (isStartSummary) {
      const startMessage = `
📊 *시작 금액 합산* (${date})
━━━━━━━━━━━━━━━━━━━━
👤 *계정:* *${escapedAccountName}*

💰 *시제:* ${formatNumber(summary.cashOnHand || 0)}원

━━━━━━━━━━━━━━━━━━━━
🧮 *오늘 시작 금액:* ${formatNumber(startAmountValue)}원
✅ 시작 금액이 전송되었습니다.`.trim();

      await bot.sendMessage(CHAT_ID, startMessage, { parse_mode: 'Markdown' });

      return res.json({
        success: true,
        message: '텔레그램으로 시작 금액을 전송했습니다.',
        startSummary: true
      });
    }

    // 정산 요약 메시지 포맷팅
    const message = `
📊 *정산 요약* (${date})
━━━━━━━━━━━━━━━━━━━━

👤 *계정:* *${escapedAccountName}*

💰 *시제:* ${formatNumber(summary.cashOnHand)}원

━━━━━━━━━━━━━━━━━━━━
📅 *${startLabel}:* ${formatNumber(startAmountValue)}원
🏁 *마무리:* ${formatNumber(summary.totalBalance)}원
📈 *오늘의 수익:* ${formatNumber(summary.todayProfit)}원

━━━━━━━━━━━━━━━━━━━━
🎲 *메인:* ${formatNumber(summary.drbetMargin)}원
💵 *금액 차이:* ${formatNumber(summary.finalDifference)}원
${specialNotesText}
━━━━━━━━━━━━━━━━━━━━
✅ 정산이 완료되었습니다.
    `.trim();

    // 텔레그램으로 메시지 전송
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    
    // 정산 관리에 수익 등록 (요청된 날짜의 월 데이터만)
    const dayNumber = parseInt(date.split('-')[2], 10);
    const requestDate = new Date(date);
    const requestYearMonth = `${requestDate.getFullYear()}-${String(requestDate.getMonth() + 1).padStart(2, '0')}`;
    
    // 특이사항 파싱 (specialNotes가 있는 경우)
    let siteContent = '';
    if (summary.specialNotes && Array.isArray(summary.specialNotes) && summary.specialNotes.length > 0) {
      // content 값만 추출하여 / 로 연결
      siteContent = summary.specialNotes.map(item => item.content).join('/');
    }
    
    // 해당 날짜의 정산 데이터 업데이트 (요청된 날짜의 월만)
    // 관리자가 선택한 계정 ID 또는 자신의 계정 ID 사용
    try {
      // 먼저 해당 날짜의 데이터가 있는지 확인
      const existingRecord = await new Promise((resolve, reject) => {
        dbLegacy.get(
          `SELECT id FROM settlements WHERE year_month = ? AND day_number = ? AND account_id = ?`,
          [requestYearMonth, dayNumber, filterAccountId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
      if (existingRecord) {
        // 데이터가 있으면 업데이트
        await new Promise((resolve, reject) => {
          dbLegacy.run(
            `UPDATE settlements SET ka_amount = ?, site_content = ? WHERE year_month = ? AND day_number = ? AND account_id = ?`,
            [summary.todayProfit, siteContent, requestYearMonth, dayNumber, filterAccountId],
            function(err) {
              if (err) reject(err);
              else resolve(this);
            }
          );
        });
        console.log(`정산 관리에 ${requestYearMonth}월 ${dayNumber}일 수익이 업데이트되었습니다. (account_id: ${filterAccountId})`);
      } else {
        // 데이터가 없으면 새로 생성
        await new Promise((resolve, reject) => {
          dbLegacy.run(
            `INSERT INTO settlements (year_month, day_number, ka_amount, site_content, account_id, seup, user_data) 
             VALUES (?, ?, ?, ?, ?, 'X', '{}')`,
            [requestYearMonth, dayNumber, summary.todayProfit, siteContent, filterAccountId],
            function(err) {
              if (err) reject(err);
              else resolve(this);
            }
          );
        });
        console.log(`정산 관리에 ${requestYearMonth}월 ${dayNumber}일 수익이 새로 생성되었습니다. (account_id: ${filterAccountId})`);
      }
      
      if (siteContent) {
        console.log(`특이사항도 저장되었습니다:`, siteContent);
      }
    } catch (error) {
      console.warn(`정산 관리 업데이트 실패:`, error.message);
    }

    res.json({ 
      success: true, 
      message: '텔레그램으로 정산 요약을 전송했습니다.',
      settlementUpdated: true
    });
  } catch (error) {
    console.error('텔레그램 전송 오류:', error);
    res.status(500).json({ error: '텔레그램 전송에 실패했습니다: ' + error.message });
  }
});

// 봇 설정 확인
router.get('/status', (req, res) => {
  res.json({
    configured: !!(bot && CHAT_ID),
    hasToken: !!BOT_TOKEN,
    hasChatId: !!CHAT_ID
  });
});

// 숫자 포맷팅 함수
function formatNumber(num) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(num));
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

module.exports = router;

