@echo off
TITLE FDH Checker Launcher
COLOR 0B
echo.
echo  ======================================================
echo     🏥 FDH Checker - ระบบตรวจสอบเบิกจ่าย v1.0
echo  ======================================================
echo.

cd /d %~dp0
set "PROJECT_DIR=%~dp0"

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js ในเครื่องนี้!
    echo กรุณาติดตั้ง Node.js ก่อนเริ่มใช้งาน
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] พบ Node.js แต่ไม่พบ npm ใน PATH
    echo กรุณาติดตั้ง Node.js LTS ใหม่และเลือก Add to PATH
    pause
    exit /b 1
)

:: Validate real packages. An interrupted install may leave an empty node_modules.
node -e "for (const p of ['react','vite','tsx','express','mysql2']) require.resolve(p)" >nul 2>nul
if %errorlevel% neq 0 (
    echo  [1/3] Dependencies ไม่ครบ กำลังติดตั้งใหม่จาก package-lock.json...
    call npm ci --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] ติดตั้ง Dependencies ไม่สำเร็จ
        pause
        exit /b 1
    )
) else (
    echo  [1/3] Dependencies พร้อมใช้งาน
)

echo  [2/3] กำลังเริ่มทำงาน Backend (Port 3506)...
start "FDH-SERVER-3506" cmd /k "cd /d ""%PROJECT_DIR%"" && npm run server"

timeout /t 2 >nul

echo  [3/3] กำลังเริ่มทำงาน Frontend (Port 3507)...
start "FDH-FRONTEND-3507" cmd /k "cd /d ""%PROJECT_DIR%"" && npm run dev"

echo.
echo  ✅ ระบบกำลังเริ่มทำงานในเบราว์เซอร์...
echo  🌐 URL: http://localhost:3507
echo.
echo  *หมายเหตุ: กรุณาอย่าปิดหน้าต่าง Command ลำดับที่ 1 และ 2 ขณะใช้งานระบบ*
echo.

timeout /t 5 >nul
start http://localhost:3507
exit
