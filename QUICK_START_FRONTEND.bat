@echo off
REM FDH Rect - Start Frontend Development Server
REM ============================================

setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║       FDH RECT - FRONTEND DEVELOPMENT SERVER STARTUP          ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM Check if Node is installed
where npm >nul 2>nul
if errorlevel 1 (
    echo ❌ npm is not installed or not in PATH
    echo Please install Node.js first
    pause
    exit /b 1
)

REM Check if in correct directory
if not exist "package.json" (
    echo ❌ package.json not found
    echo Please run this file from d:\react\fdh_rect
    pause
    exit /b 1
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ❌ npm install failed
        pause
        exit /b 1
    )
)

echo.
echo ✅ Starting Vite Development Server...
echo.
echo 📌 Backend: http://localhost:3001 (Already running)
echo 📌 Frontend: http://localhost:3507 (Starting...)
echo.
echo Waiting for build to complete (30-60 seconds)...
echo.

REM Start the development server
call npm run dev

echo.
echo ❌ Development server stopped
pause
