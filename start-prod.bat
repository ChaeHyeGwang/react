@echo off
chcp 65001 > nul
echo ========================================
echo   출석관리 시스템 - 운영 서버 시작
echo ========================================
echo.

cd /d %~dp0

REM 운영용 빌드가 없으면 빌드 실행
if not exist "client\build\index.html" (
    echo [1/3] React 프로덕션 빌드 중...
    cd client
    call npm run build
    cd ..
    echo.
)

REM PM2 설치 확인
where pm2 > nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [!] PM2가 설치되어 있지 않습니다. 설치 중...
    call npm install -g pm2
    echo.
)

REM 운영 서버 시작
echo [2/3] 운영 서버 시작 (포트 5001)...
cd server
call pm2 start ecosystem.config.js --only attendance-prod
cd ..

echo.
echo [3/3] 서버 상태 확인...
call pm2 status

echo.
echo ========================================
echo   운영 서버가 시작되었습니다!
echo   URL: http://localhost:5001
echo ========================================
echo.
echo PM2 명령어:
echo   pm2 status         - 상태 확인
echo   pm2 logs           - 로그 보기
echo   pm2 restart all    - 재시작
echo   pm2 stop all       - 중지
echo.
pause

