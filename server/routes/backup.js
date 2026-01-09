const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { auth } = require('../middleware/auth');
const db = require('../database/db');

// 백업 폴더 경로
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

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

// 백업 폴더 생성 (없으면)
const ensureBackupDir = async () => {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  } catch (error) {
    console.error('백업 폴더 생성 실패:', error);
  }
};

// 데이터베이스 백업 생성
router.post('/create', auth, async (req, res) => {
  try {
    // 관리자만 백업 가능
    if (req.user.accountType !== 'super_admin') {
      return res.status(403).json({ error: '관리자만 백업할 수 있습니다.' });
    }

    await ensureBackupDir();

    const dbPath = path.join(__dirname, '..', 'database', 'management_system.db');
    const timestamp = getKSTTimestampString();
    const backupFileName = `backup_${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, backupFileName);

    // 데이터베이스 파일 복사
    await fs.copyFile(dbPath, backupPath);

    // 백업 메타데이터 저장
    const metadata = {
      fileName: backupFileName,
      createdAt: getKSTISOString(),
      createdBy: req.user.username,
      size: (await fs.stat(backupPath)).size,
      description: req.body.description || ''
    };

    const metadataPath = path.join(BACKUP_DIR, `${backupFileName}.json`);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    res.json({
      success: true,
      message: '백업이 성공적으로 생성되었습니다.',
      backup: {
        fileName: backupFileName,
        createdAt: metadata.createdAt,
        size: metadata.size
      }
    });
  } catch (error) {
    console.error('백업 생성 실패:', error);
    res.status(500).json({ error: '백업 생성에 실패했습니다.', details: error.message });
  }
});

// 백업 목록 조회
router.get('/list', auth, async (req, res) => {
  try {
    // 관리자만 조회 가능
    if (req.user.accountType !== 'super_admin') {
      return res.status(403).json({ error: '관리자만 백업 목록을 조회할 수 있습니다.' });
    }

    await ensureBackupDir();

    const files = await fs.readdir(BACKUP_DIR);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.db')) {
        const metadataPath = path.join(BACKUP_DIR, `${file}.json`);
        let metadata = null;

        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf8');
          metadata = JSON.parse(metadataContent);
        } catch (error) {
          // 메타데이터가 없으면 파일 정보로 생성
          const stats = await fs.stat(path.join(BACKUP_DIR, file));
          metadata = {
            fileName: file,
            createdAt: getKSTISOString(stats.birthtime),
            createdBy: 'Unknown',
            size: stats.size,
            description: ''
          };
        }

        backups.push({
          fileName: metadata.fileName,
          createdAt: metadata.createdAt,
          createdBy: metadata.createdBy,
          size: metadata.size,
          description: metadata.description,
          sizeFormatted: formatFileSize(metadata.size)
        });
      }
    }

    // 생성일 기준 내림차순 정렬
    backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, backups });
  } catch (error) {
    console.error('백업 목록 조회 실패:', error);
    res.status(500).json({ error: '백업 목록 조회에 실패했습니다.', details: error.message });
  }
});

// 백업 복원
router.post('/restore', auth, async (req, res) => {
  try {
    // 관리자만 복원 가능
    if (req.user.accountType !== 'super_admin') {
      return res.status(403).json({ error: '관리자만 복원할 수 있습니다.' });
    }

    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: '파일명이 필요합니다.' });
    }

    const backupPath = path.join(BACKUP_DIR, fileName);
    const dbPath = path.join(__dirname, '..', 'database', 'management_system.db');

    // 백업 파일 존재 확인
    try {
      await fs.access(backupPath);
    } catch (error) {
      return res.status(404).json({ error: '백업 파일을 찾을 수 없습니다.' });
    }

    // 복원 전 현재 DB 백업 (안전장치)
    const safetyBackupName = `safety_backup_before_restore_${getKSTTimestampString()}.db`;
    const safetyBackupPath = path.join(BACKUP_DIR, safetyBackupName);
    await fs.copyFile(dbPath, safetyBackupPath);

    // 백업 파일로 복원
    await fs.copyFile(backupPath, dbPath);

    // 복원 로그 저장
    const restoreLog = {
      restoredAt: getKSTISOString(),
      restoredBy: req.user.username,
      backupFileName: fileName,
      safetyBackupFileName: safetyBackupName
    };

    const logPath = path.join(BACKUP_DIR, 'restore_log.json');
    let logs = [];
    try {
      const logContent = await fs.readFile(logPath, 'utf8');
      logs = JSON.parse(logContent);
    } catch (error) {
      // 로그 파일이 없으면 새로 생성
    }
    logs.push(restoreLog);
    await fs.writeFile(logPath, JSON.stringify(logs, null, 2), 'utf8');

    res.json({
      success: true,
      message: '백업이 성공적으로 복원되었습니다.',
      restoreLog
    });
  } catch (error) {
    console.error('백업 복원 실패:', error);
    res.status(500).json({ error: '백업 복원에 실패했습니다.', details: error.message });
  }
});

// 백업 파일 삭제
router.delete('/:fileName', auth, async (req, res) => {
  try {
    // 관리자만 삭제 가능
    if (req.user.accountType !== 'super_admin') {
      return res.status(403).json({ error: '관리자만 백업을 삭제할 수 있습니다.' });
    }

    const { fileName } = req.params;

    if (!fileName || !fileName.endsWith('.db')) {
      return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
    }

    const backupPath = path.join(BACKUP_DIR, fileName);
    const metadataPath = path.join(BACKUP_DIR, `${fileName}.json`);

    try {
      await fs.unlink(backupPath);
      // 메타데이터도 삭제
      try {
        await fs.unlink(metadataPath);
      } catch (error) {
        // 메타데이터가 없어도 무시
      }

      res.json({ success: true, message: '백업 파일이 삭제되었습니다.' });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: '백업 파일을 찾을 수 없습니다.' });
      }
      throw error;
    }
  } catch (error) {
    console.error('백업 삭제 실패:', error);
    res.status(500).json({ error: '백업 삭제에 실패했습니다.', details: error.message });
  }
});

// 파일 크기 포맷팅 함수
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

module.exports = router;

