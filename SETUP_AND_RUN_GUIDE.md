# 🚀 FDH Checker - Setup & Run Guide

## 📋 สถานะปัจจุบัน

- ✅ Backend Server: รอที่จะรัน (port 3506)
- ✅ Frontend Dev: รอที่จะรัน (port 3507)
- ✅ Database: เชื่อมต่อแล้ว
- ✅ 16 แฟ้ม Export: แก้ไขเรียบร้อย

## 🔧 การเตรียมตัว

### 1. ติดตั้ง Dependencies (ถ้ายังไม่ได้ทำ)
```powershell
cd d:\react\fdh_rect
npm install
```

### 2. ตรวจสอบไฟล์ .env
สร้างไฟล์ `.env` ในโฟลเดอร์ `d:\react\fdh_rect`:

```env
# HOSxP Database Connection
HOSXP_HOST=localhost
HOSXP_USER=root
HOSXP_PASSWORD=your_password
HOSXP_DB=hos
HOSXP_HCODE=11101

# Server Port
SERVER_PORT=3506

# Client Port
CLIENT_PORT=3507
```

## 🎯 การรัน 2 ส่วน

### ขั้นตอนที่ 1: รัน Backend Server (Terminal 1)
```powershell
cd d:\react\fdh_rect
npm run server
```

ควรเห็น:
```
✅ FDH Checker Server running on port 3506
🔗 Listening on all interfaces (0.0.0.0)
🌐 API Endpoint: http://localhost:3506/api
✅ HOSxP Database Connected Successfully
📊 Tables: XXXX, Recent records: XXXX
```

### ขั้นตอนที่ 2: รัน Frontend Dev (Terminal 2 - ใหม่)
```powershell
cd d:\react\fdh_rect
npm run dev
```

ควรเห็น:
```
➜  Local:   http://localhost:3507/
➜  press h to show help
```

### ขั้นตอนที่ 3: เปิด Browser
```
http://localhost:3507
```

## 🧪 ทดสอบ 16 แฟ้ม Export

### วิธีที่ 1: ผ่าน UI
1. เข้า http://localhost:3507
2. ไปยัง "ตรวจสอบเบิก FDH"
3. เลือก VN 
4. คลิก "ส่งออก 16 แฟ้ม ZIP"

### วิธีที่ 2: ผ่าน PowerShell (Direct API Test)

```powershell
# ทดสอบ API export-zip
$headers = @{"Content-Type" = "application/json"}
$body = @{vns = @("690323000158")} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3506/api/fdh/export-zip" `
  -Method POST `
  -Headers $headers `
  -Body $body `
  -OutFile "test-fdh.zip"

# ตรวจสอบผลลัพธ์
Get-Item "test-fdh.zip" | Select-Object Name, Length

# แตกไฟล์ ZIP
Expand-Archive -Path "test-fdh.zip" -DestinationPath "test-fdh-extracted"
Get-ChildItem "test-fdh-extracted"
```

## 📦 ตรวจสอบไฟล์ที่ได้

ควรเห็น 16 ไฟล์:
```
INS.txt  PAT.txt  OPD.txt  ORF.txt  ODX.txt  OOP.txt
IPD.txt  IRF.txt  IDX.txt  IOP.txt  CHT.txt  CHA.txt
AER.txt  ADP.txt  LVD.txt  DRU.txt
```

## ⚠️ Troubleshooting

### Error: "Cannot connect to localhost:3506"
**ตรวจสอบ:**
1. Backend server กำลังรัน?
   ```powershell
   Get-NetTCPConnection -LocalPort 3506 -ErrorAction SilentlyContinue
   ```
2. ถ้าไม่มี ให้รัน: `npm run server`

### Error: "Cannot connect to localhost:3507"
**ตรวจสอบ:**
1. Frontend dev กำลังรัน?
   ```powershell
   Get-NetTCPConnection -LocalPort 3507 -ErrorAction SilentlyContinue
   ```
2. ถ้าไม่มี ให้รัน: `npm run dev`

### Error: Database Connection Failed
**ตรวจสอบ:**
1. MySQL/MariaDB รัน?
2. ค่า .env ถูกต้อง?
3. HOSxP Database เข้าถึงได้?

### Error: "Unknown column 'clinic_dep'"
ดูรายละเอียด: `FDH_EXPORT_FIX_REPORT.md`

## 🎓 File Structure

```
d:\react\fdh_rect\
├── server/
│   ├── index.ts          ← Backend API
│   └── db.ts             ← Database queries (แก้ไขแล้ว)
├── src/
│   ├── pages/
│   │   ├── FDHCheckerPage.tsx
│   │   └── ...
│   └── ...
├── .env                  ← Database config
├── package.json
├── run-server.bat        ← Script รัน backend
├── start-dev-new.bat     ← Script รัน frontend
└── FDH_EXPORT_FIX_REPORT.md
```

## ✅ Checklist

- [ ] npm install (ถ้ายังไม่ได้ทำ)
- [ ] สร้าง/ตรวจสอบ .env
- [ ] Backend server รัน (port 3506)
- [ ] Frontend dev รัน (port 3507)
- [ ] Browser เข้า http://localhost:3507
- [ ] ทดสอบ 16 แฟ้ม export
- [ ] ตรวจสอบ ZIP file มี 16 ไฟล์

## 🚀 Quick Start (Copy-Paste Ready)

**Terminal 1 - Backend:**
```powershell
cd d:\react\fdh_rect; npm run server
```

**Terminal 2 - Frontend:**
```powershell
cd d:\react\fdh_rect; npm run dev
```

**Browser:**
```
http://localhost:3507
```

---

**Last Updated:** March 23, 2026
**All systems ready for deployment** ✅
