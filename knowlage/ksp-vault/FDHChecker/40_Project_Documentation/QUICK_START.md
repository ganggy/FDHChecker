---
ksp_schema: 1
project: FDHChecker
type: "project-document"
category: "documentation"
source: "QUICK_START.md"
source_hash: "8d94f0cdbae6b2815515abf6797a73da6a79de19e0eee71e15aec0c12838a5c6"
managed_by: "sync-ksp-vault"
---
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
Invoke-WebRequest http://localhost:3506/api/live
Invoke-WebRequest http://localhost:3506/api/ready
npm run check
```

API ยกเว้น health และการเข้าสู่ระบบต้องมี Bearer token จึงจะเรียกใช้งานได้

## อัปเดตบน AlmaLinux 9 + PM2

ข้อมูลเครื่อง Production:

- SSH host: `192.168.2.202`
- SSH user: `war12oc`
- Project path: `/opt/FDHChecker`
- Git branch: `agent/add-local-ai`
- Public frontend: `http://147.50.107.211:3507`
- Public backend: `http://147.50.107.211:3506`
- PM2 applications: `fdh-frontend` และ `fdh-backend`

ไม่บันทึกรหัสผ่านลงเอกสารหรือ Git ให้ใช้ SSH key หรือขอรหัสผ่านจากผู้ดูแลระบบเมื่อจำเป็น

```bash
cd /opt/FDHChecker
git pull --ff-only
npm ci
npm run check
npm run build:all
bash deploy/scripts/backup-databases.sh
pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env
pm2 status
pm2 logs --lines 100
```

เก็บ `.env` ไว้เฉพาะเครื่อง server และสำรองก่อนปรับค่า ห้ามนำ password/token จริงขึ้น Git
รายละเอียดการติดตั้ง Nginx, health checks และ rollback อยู่ที่ [deploy/README.md](./deploy/README.md)
