@echo off
TITLE FDH Checker Launcher
COLOR 0B
echo.
echo  ======================================================
echo     🏥 FDH Checker - ระบบตรวจสอบเบิกจ่าย v1.0
echo  ======================================================
echo.

cd /d %~dp0

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js ในเครื่องนี้!
    echo กรุณาติดตั้ง Node.js ก่อนเริ่มใช้งาน
    pause
    exit
)

:: Auto-install if node_modules missing
if not exist node_modules (
    echo  [1/3] กำลังติดตั้ง Dependencies (ครั้งแรก)...
    call npm install
)

echo  [2/3] กำลังเริ่มทำงาน Backend (Port 3506)...
start "FDH-SERVER-3506" cmd /k "npm run server"

timeout /t 2 >nul

echo  [3/3] กำลังเริ่มทำงาน Frontend (Port 3507)...
start "FDH-FRONTEND-3507" cmd /k "npm run dev"

echo.
echo  ✅ ระบบกำลังเริ่มทำงานในเบราว์เซอร์...
echo  🌐 URL: http://localhost:3507
echo.
echo  *หมายเหตุ: กรุณาอย่าปิดหน้าต่าง Command ลำดับที่ 1 และ 2 ขณะใช้งานระบบ*
echo.

timeout /t 5 >nul
start http://localhost:3507
exit
