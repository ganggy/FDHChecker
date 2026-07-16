# Quick Start

## เครื่องพัฒนา Windows

```powershell
cd D:\fdh_migrade
npm install
Copy-Item .env.example .env
```

กรอกค่าฐานข้อมูลจริงใน `.env` แล้วเปิด backend:

```powershell
npm run server
```

เปิดอีก terminal สำหรับ frontend:

```powershell
npm run dev
```

เข้าใช้งานที่ `http://localhost:3507`

## ตรวจระบบ

```powershell
Invoke-WebRequest http://localhost:3506/api/health
npm run check
```

API ยกเว้น health และการเข้าสู่ระบบต้องมี Bearer token จึงจะเรียกใช้งานได้

## อัปเดตบน AlmaLinux 9 + PM2

```bash
cd /opt/fdh_migrade
git pull --ff-only
npm ci
npm run check
npm run build
pm2 restart all --update-env
pm2 status
pm2 logs --lines 100
```

เก็บ `.env` ไว้เฉพาะเครื่อง server และสำรองก่อนปรับค่า ห้ามนำ password/token จริงขึ้น Git
