const express = require('express');
const router = express.Router();
const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');
const { auth } = require('../middleware/auth');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 환경변수 DB_PATH 사용 (프로덕션: management_system_prod.db)
const dbPath = process.env.DB_PATH 
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, '..', 'database', 'management_system.db');
const dbLegacy = new sqlite3.Database(dbPath);

// 텔레그램 봇 인스턴스 생성 함수 (동적 생성)
function createTelegramBot(botToken) {
  if (!botToken) return null;
  try {
    return new TelegramBot(botToken, { polling: false });
  } catch (error) {
    console.error('텔레그램 봇 생성 실패:', error.message);
    return null;
  }
}

// 정산 요약 전송
router.post('/send-settlement', auth, async (req, res) => {
  try {
    const { date, summary } = req.body;
    
    // 계정의 office_id 조회
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    let officeId = null;
    
    try {
      const accountRow = await db.get('SELECT office_id FROM accounts WHERE id = ?', [filterAccountId]);
      if (accountRow && accountRow.office_id) {
        officeId = accountRow.office_id;
      }
    } catch (e) {
      console.warn('계정의 office_id 조회 실패:', e.message);
    }
    
    // 사무실이 없으면 에러 반환
    if (!officeId) {
      return res.status(400).json({ 
        error: '사무실이 설정되지 않은 계정입니다. 사무실 관리자에게 문의하세요.' 
      });
    }
    
    // 사무실의 텔레그램 설정 조회
    let telegramBotToken = null;
    let telegramChatId = null;
    
    try {
      const officeRow = await db.get(
        'SELECT telegram_bot_token, telegram_chat_id FROM offices WHERE id = ?',
        [officeId]
      );
      
      if (officeRow) {
        telegramBotToken = officeRow.telegram_bot_token || null;
        telegramChatId = officeRow.telegram_chat_id || null;
      }
    } catch (e) {
      console.warn('사무실 텔레그램 설정 조회 실패:', e.message);
    }
    
    // 텔레그램 설정이 없으면 에러 반환
    if (!telegramBotToken || !telegramChatId) {
      return res.status(400).json({ 
        error: '텔레그램 설정이 필요합니다. 사무실 관리자에게 문의하세요.' 
      });
    }
    
    // 동적으로 봇 인스턴스 생성
    const bot = createTelegramBot(telegramBotToken);
    if (!bot) {
      return res.status(400).json({ 
        error: '텔레그램 봇 생성에 실패했습니다. 토큰을 확인하세요.' 
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
    // filterAccountId는 이미 위에서 선언됨
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

      await bot.sendMessage(telegramChatId, startMessage, { parse_mode: 'Markdown' });

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
    await bot.sendMessage(telegramChatId, message, { parse_mode: 'Markdown' });
    
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

// 봇 설정 확인 (사용자의 사무실 텔레그램 설정 확인)
router.get('/status', auth, async (req, res) => {
  try {
    const filterAccountId = req.user.filterAccountId || req.user.accountId;
    let officeId = null;
    
    try {
      const accountRow = await db.get('SELECT office_id FROM accounts WHERE id = ?', [filterAccountId]);
      if (accountRow && accountRow.office_id) {
        officeId = accountRow.office_id;
      }
    } catch (e) {
      console.warn('계정의 office_id 조회 실패:', e.message);
    }
    
    if (!officeId) {
      return res.json({
        configured: false,
        hasToken: false,
        hasChatId: false,
        message: '사무실이 설정되지 않았습니다'
      });
    }
    
    let telegramBotToken = null;
    let telegramChatId = null;
    
    try {
      const officeRow = await db.get(
        'SELECT telegram_bot_token, telegram_chat_id FROM offices WHERE id = ?',
        [officeId]
      );
      
      if (officeRow) {
        telegramBotToken = officeRow.telegram_bot_token || null;
        telegramChatId = officeRow.telegram_chat_id || null;
      }
    } catch (e) {
      console.warn('사무실 텔레그램 설정 조회 실패:', e.message);
    }
    
    res.json({
      configured: !!(telegramBotToken && telegramChatId),
      hasToken: !!telegramBotToken,
      hasChatId: !!telegramChatId,
      officeId: officeId
    });
  } catch (error) {
    console.error('텔레그램 설정 확인 오류:', error);
    res.status(500).json({ error: '텔레그램 설정 확인에 실패했습니다: ' + error.message });
  }
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

