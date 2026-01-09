const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DB_PATH = path.join(__dirname, '..', 'database', 'management_system.db');

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

// 한국 시간 기준 타임스탬프 문자열 반환 (파일명용)
function getKSTTimestampString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  return kstDate.toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

async function ensureDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

function nowIsoSafe() {
  return getKSTTimestampString();
}

async function createBackup() {
  await ensureDir();
  const fileName = `auto_backup_${nowIsoSafe()}.db`;
  const target = path.join(BACKUP_DIR, fileName);
  await fs.copyFile(DB_PATH, target);
  // minimal metadata
  const metadata = {
    fileName,
    createdAt: getKSTISOString(),
    createdBy: 'scheduler',
    size: (await fs.stat(target)).size,
    description: '자동 백업'
  };
  await fs.writeFile(path.join(BACKUP_DIR, `${fileName}.json`), JSON.stringify(metadata, null, 2), 'utf8');
  return fileName;
}

async function purgeOld(retentionDays = 14) {
  const files = await fs.readdir(BACKUP_DIR);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const file of files) {
    if (!file.endsWith('.db')) continue;
    const full = path.join(BACKUP_DIR, file);
    const stat = await fs.stat(full);
    if (stat.mtimeMs < cutoff) {
      try {
        await fs.unlink(full);
      } catch {}
      try {
        await fs.unlink(path.join(BACKUP_DIR, `${file}.json`));
      } catch {}
    }
  }
}

function startScheduler({ time = '0 3 * * *', retentionDays = 14 } = {}) {
  // Create immediately on first start? No. Only on schedule.
  cron.schedule(time, async () => {
    try {
      console.log(`[backup] 자동 백업 시작: ${getKSTISOString()}`);
      const name = await createBackup();
      await purgeOld(retentionDays);
      console.log(`[backup] 완료: ${name}, 보관 ${retentionDays}일 정책 적용`);
    } catch (e) {
      console.error('[backup] 자동 백업 실패:', e);
    }
  }, { timezone: 'Asia/Seoul' });
  console.log(`[backup] 스케줄러 등록: 매일 03:00, 보관 ${retentionDays}일`);
}

module.exports = { startScheduler, createBackup, purgeOld };
