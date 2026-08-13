@echo off
echo Starting FDH Checker - Backend Server (port 3506)
cd /d "%~dp0"
echo.
npm run server
pause
