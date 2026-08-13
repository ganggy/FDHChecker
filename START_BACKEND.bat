@echo off
REM FDH Rect - Start Backend Server
REM ================================

echo.
echo ========================================
echo  FDH RECT - BACKEND SERVER STARTUP
echo ========================================
echo.
echo Starting backend server on port 3506...
echo.

cd /d "%~dp0"
npm run server

pause
