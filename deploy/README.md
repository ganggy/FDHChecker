# Production deployment

เป้าหมายของโฟลเดอร์นี้คือให้ production มีขั้นตอน build, health check, restart, rollback และ backup ที่ทำซ้ำได้ โดยตัวอย่างใช้ AlmaLinux 9, Nginx และ PM2

## เตรียมเครื่องครั้งแรก

1. ติดตั้ง Node.js 22 LTS, Nginx, PM2, MySQL client และ `mysqldump`
2. clone repository ไว้ที่ `/opt/FDHChecker` ซึ่งตรงกับ systemd service เดิม
3. สร้าง `/opt/FDHChecker/.env` จาก `.env.example` และจำกัดสิทธิ์เป็น `600`
4. สร้าง log directory: `sudo install -d -o "$USER" -g "$USER" /var/log/fdh-checker`
5. แก้ hostname และ certificate path ใน `deploy/nginx/fdh-checker.conf` ก่อนติดตั้ง

## Deploy

```bash
cd /opt/FDHChecker
bash deploy/scripts/deploy-app.sh
```

จากเครื่อง Windows ใช้สคริปต์นี้เพื่อ deploy Backend ไปยัง production โดย SSH จะถามรหัสผ่านเองและไม่มีรหัสผ่านบันทึกอยู่ในไฟล์:

```powershell
pwsh -File deploy/scripts/deploy-production.ps1
```

ตัวเลือกที่ใช้บ่อย:

```powershell
# สำรองฐานข้อมูลก่อน deploy Backend
pwsh -File deploy/scripts/deploy-production.ps1 -Backup

# Deploy ทั้ง Backend และ Frontend
pwsh -File deploy/scripts/deploy-production.ps1 -Target all
```

สคริปต์จะหยุดทันทีหาก branch ไม่ถูกต้อง, working tree ไม่สะอาด, test/build ไม่ผ่าน,
หา PM2 app ไม่พบ หรือ `/api/live` และ `/api/ready` ไม่พร้อม โดยค่าเริ่มต้นใช้ branch
`agent/add-local-ai` และ PM2 apps `fdh-backend fdh-frontend`

## อัปเดตผ่านหน้าเว็บ

ผู้ดูแลระบบสามารถเปิด **ตั้งค่าระบบ → อัปเดตระบบ** เพื่อตรวจสอบ GitHub และกดยืนยันการอัปเดต ระบบจะแสดงความคืบหน้าของการเชื่อมต่อ ดาวน์โหลด dependency ทดสอบ build รีสตาร์ต และ health check หลัง backend หยุดชั่วคราวหน้าเว็บจะเชื่อมต่อกลับและติดตามงานเดิมจากไฟล์ `.update-state/current.json` โดยอัตโนมัติ

กำหนดค่าที่ `.env` ก่อนใช้งาน:

```bash
FDH_SELF_UPDATE_ENABLED=1
FDH_APP_DIR=/opt/FDHChecker
FDH_DEPLOY_BRANCH=agent/add-local-ai
FDH_PM2_APPS="fdh-backend fdh-frontend"
FDH_HEALTH_BASE_URL=http://127.0.0.1:3506
FDH_DEPLOY_BACKUP=0
```

ปุ่มอัปเดตจะแสดงเฉพาะหน้า admin และ backend จะไม่เริ่มงานเมื่อ branch ไม่ตรง, working tree มีไฟล์ค้าง, ไม่มีรุ่นใหม่ หรือ commit บน GitHub เปลี่ยนหลังหน้าจอยืนยัน Log อยู่ที่ `.update-state/update-<job-id>.log` และถูกกันออกจาก Git แล้ว

ปรับค่าผ่าน environment ได้โดยไม่ต้องแก้สคริปต์:

```bash
FDH_DEPLOY_BRANCH=main FDH_PM2_APPS="fdh-backend fdh-frontend" bash deploy/scripts/deploy-app.sh
```

หากรุ่นนั้นมีการเปลี่ยนแปลงฐานข้อมูล ให้เปิด backup ก่อน deploy:

```bash
FDH_DEPLOY_BACKUP=1 bash deploy/scripts/deploy-app.sh
```

`/api/live` ตรวจเฉพาะ process ส่วน `/api/ready` จะตอบ HTTP 503 เมื่อฐานข้อมูลยังไม่พร้อม จึงควรใช้ `/api/ready` เป็น readiness check ของ reverse proxy หรือ monitor

บน Windows สามารถสำรองด้วย PowerShell โดยไม่ต้องติดตั้ง Bash:

```powershell
pwsh -File deploy/scripts/backup-databases.ps1
```

ทั้งสองสคริปต์จะอ่าน `.env`, ไม่แสดงรหัสผ่าน และไม่ลบ backup เก่า

## Rollback

บันทึก commit ก่อน deploy ทุกครั้ง จากนั้น rollback เฉพาะ application ก่อน:

```bash
cd /opt/FDHChecker
git switch --detach <previous-tested-commit>
npm ci
npm run build:all
pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env
curl --fail http://127.0.0.1:3506/api/ready
```

อย่า restore ฐานข้อมูลโดยอัตโนมัติระหว่าง application rollback เพราะข้อมูลใหม่หลัง deploy อาจสูญหาย การ restore ต้องได้รับอนุมัติ ระบุไฟล์ backup และฐานปลายทางอย่างชัดเจน และทดสอบในฐานชั่วคราวก่อนเสมอ

## Backup และ restore drill

คำสั่ง backup จะสำรองฐาน REP/STM ซึ่งเป็นฐานที่แอปเขียนข้อมูล ลง `backups/<UTC timestamp>/` และตรวจด้วย `gzip -t` โดยไม่ลบ backup เก่าอัตโนมัติ ส่วน HOSxP มักมีขนาดใหญ่และควรอยู่ในนโยบาย backup กลางของโรงพยาบาล หากต้องการ full dump จากสคริปต์นี้ให้ตั้ง `FDH_BACKUP_HOSXP=1` และใช้บัญชี backup โดยเฉพาะ

อย่างน้อยเดือนละครั้ง ให้ restore ลงฐานทดสอบชื่อใหม่ แล้วตรวจ:

- จำนวนตารางและจำนวนแถวของตารางสำคัญ
- login และสิทธิ์ผู้ใช้
- ประวัติ import, submission และ receivable
- reconciliation ตัวอย่างโดยไม่ส่งข้อมูลออกภายนอก

## หลัง deploy

- ตรวจ `pm2 status` และ `pm2 logs fdh-backend fdh-frontend --lines 100`
- เปิดหน้า login และ workflow สำคัญด้วยบัญชีทดสอบ
- ตรวจว่า CORS และ HTTPS ใช้ hostname จริง
- เก็บ artifact และ commit id ของรุ่นที่ deploy
