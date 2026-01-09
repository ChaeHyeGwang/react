@echo off
chcp 65001 > nul
echo ========================================
echo   출석관리 시스템 - 운영 서버 중지
echo ========================================
echo.

call pm2 stop attendance-prod
call pm2 delete attendance-prod

echo.
echo 운영 서버가 중지되었습니다.
pause

