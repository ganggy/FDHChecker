@echo off
REM FDH Rect - Start Both Backend and Frontend Servers
REM ==================================================

setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║         FDH RECT - COMPLETE SYSTEM STARTUP                    ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo This script will start both the backend and frontend servers.
echo.
echo Backend Server:   http://localhost:3506
echo Frontend Server:  http://localhost:3507
echo.
echo ========================================
echo Starting Backend Server...
echo ========================================
cd /d d:\react\fdh_rect\server

REM Start backend in a new window
start "FDH BACKEND - PORT 3506" cmd /k npm run dev

REM Wait a few seconds for backend to start
timeout /t 3 /nobreak

echo.
echo ========================================
echo Starting Frontend Server...
echo ========================================
cd /d d:\react\fdh_rect

REM Start frontend in a new window
start "FDH FRONTEND - PORT 3507" cmd /k npm run dev

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║  ✅ Both servers are starting...                              ║
echo ║                                                                ║
echo ║  📌 Backend:  http://localhost:3506                           ║
echo ║  📌 Frontend: http://localhost:3507                           ║
echo ║                                                                ║
echo ║  Wait for both windows to fully load (2-3 minutes)            ║
echo ║  Then open: http://localhost:3507 in your browser             ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo Servers are running in separate windows.
echo Close these windows to stop the servers.
echo.
pause
