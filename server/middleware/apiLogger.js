const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'api-logs');

// 한국 시간 기준 날짜 문자열 반환 (YYYY-MM-DD)
function getKSTDateString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 한국 시간 기준 ISO 문자열 반환
function getKSTISOString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  return kstDate.toISOString();
}

async function ensureLogDir() {
  try {
    await fsp.mkdir(LOG_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return '"[unserializable]"';
  }
}

function truncate(str, max = 10000) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + `... [${str.length - max} bytes more]` : str;
}

function getName(req) {
  // 우선순위: 명시적 이름(req.apiName) -> 헤더 -> 쿼리/바디 -> prefix + 메서드/경로
  const explicit = req.apiName;
  if (explicit) return explicit;
  const headerName = req.headers['x-api-name'] || req.query?.name || req.body?.name;
  if (headerName) return headerName;
  const prefix = req.apiNamePrefix ? `[${req.apiNamePrefix}] ` : '';
  return `${prefix}${req.method} ${req.originalUrl}`;
}

module.exports = async function apiLogger(req, res, next) {
  // 프로덕션 환경에서는 에러만 로깅 (성능 최적화)
  const isProduction = process.env.NODE_ENV === 'production';
  const shouldLog = !isProduction || res.statusCode >= 400;

  if (!shouldLog) {
    return next();
  }

  await ensureLogDir();

  const start = Date.now();
  const name = getName(req);
  const requestInfo = {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip || req.connection?.remoteAddress,
    user: req.user ? { id: req.user.id, username: req.user.username, accountId: req.user.accountId, accountType: req.user.accountType } : null,
    headers: { 'user-agent': req.headers['user-agent'] },
    query: req.query,
    body: req.body
  };

  // 응답 가로채기
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let responseBody;

  res.json = (data) => {
    responseBody = data;
    return originalJson(data);
  };
  res.send = (data) => {
    responseBody = data;
    return originalSend(data);
  };

  res.on('finish', () => {
    // 비동기로 처리하여 이벤트 루프 블로킹 방지
    setImmediate(async () => {
      const durationMs = Date.now() - start;
      
      // 응답 본문 크기 제한 (메모리 및 직렬화 성능 최적화)
      let limitedResponse = responseBody;
      if (responseBody) {
        const responseStr = typeof responseBody === 'string' 
          ? responseBody 
          : JSON.stringify(responseBody);
        if (responseStr.length > 5000) {
          // 큰 응답은 요약만 로깅
          limitedResponse = typeof responseBody === 'string'
            ? responseStr.substring(0, 5000) + '... [truncated]'
            : '[large response - truncated]';
        }
      }
      
      const logObj = {
        time: new Date().toISOString(),
        name,
        status: res.statusCode,
        durationMs,
        request: requestInfo,
        response: limitedResponse
      };

      // JSON 직렬화를 비동기로 처리
      let line;
      try {
        line = truncate(safeJson(logObj)) + '\n';
      } catch (e) {
        // 직렬화 실패 시 최소 정보만 로깅
        line = JSON.stringify({
          time: logObj.time,
          name: logObj.name,
          status: logObj.status,
          durationMs: logObj.durationMs,
          error: 'response too large to serialize'
        }) + '\n';
      }
      
      const file = path.join(LOG_DIR, `${getKSTDateString()}.log`);
      try {
        await fsp.appendFile(file, line, 'utf8');
      } catch (e) {
        // 마지막 시도로 디렉터리 보장 후 재시도
        try {
          await ensureLogDir();
          await fsp.appendFile(file, line, 'utf8');
        } catch (err) {
          console.error('API 로그 기록 실패:', err?.message || err);
        }
      }
    });
  });

  next();
};
