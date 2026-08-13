@echo off
REM Kill all Node processes first
taskkill /F /IM node.exe >nul 2>&1

REM Wait a bit
timeout /t 2 /nobreak

REM Change to project directory
cd /d "%~dp0"

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
start "FDH-SERVER-3506" cmd /k "cd /d ""%~dp0"" && npm run server"
timeout /t 3 /nobreak
start "FDH-FRONTEND-3507" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo.
echo ========================================
echo ✅ Servers starting...
echo Backend: http://localhost:3506
echo Frontend: http://localhost:3507
echo ========================================
echo.
pause
