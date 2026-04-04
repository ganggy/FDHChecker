@echo off
REM Kill all Node processes first
taskkill /F /IM node.exe >nul 2>&1

REM Wait a bit
timeout /t 2 /nobreak

REM Change to project directory
cd /d D:\react\fdh_rect

REM Clear npm cache to avoid issues
cls

echo.
echo ========================================
echo FDH Checker - Development Environment
echo ========================================
echo.
echo Starting servers...
echo.

REM Start both servers in one window (Backend in bg, Frontend in fg)
start cmd /k "npm run server"
timeout /t 3 /nobreak
start cmd /k "npm run dev"

echo.
echo ========================================
echo ✅ Servers starting...
echo Backend: http://localhost:3506
echo Frontend: http://localhost:3507
echo ========================================
echo.
pause
