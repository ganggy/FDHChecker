# Production deployment

เป้าหมายของโฟลเดอร์นี้คือให้ production มีขั้นตอน build, health check, restart, rollback และ backup ที่ทำซ้ำได้ โดยตัวอย่างใช้ AlmaLinux 9, Nginx และ PM2

## เตรียมเครื่องครั้งแรก

1. ติดตั้ง Node.js 22 LTS, Nginx, PM2, MySQL client และ `mysqldump`
2. clone repository ไว้ที่ `/opt/fdh_migrade`
3. สร้าง `/opt/fdh_migrade/.env` จาก `.env.example` และจำกัดสิทธิ์เป็น `600`
4. สร้าง log directory: `sudo install -d -o "$USER" -g "$USER" /var/log/fdh-checker`
5. แก้ hostname และ certificate path ใน `deploy/nginx/fdh-checker.conf` ก่อนติดตั้ง

## Deploy

```bash
cd /opt/fdh_migrade
git fetch --all --prune
git pull --ff-only
npm ci
npm run check
npm run build:all
bash deploy/scripts/backup-databases.sh
pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env
curl --fail http://127.0.0.1:3506/api/live
curl --fail http://127.0.0.1:3506/api/ready
pm2 save
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
cd /opt/fdh_migrade
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

- ตรวจ `pm2 status` และ `pm2 logs fdh-checker-api --lines 100`
- เปิดหน้า login และ workflow สำคัญด้วยบัญชีทดสอบ
- ตรวจว่า CORS และ HTTPS ใช้ hostname จริง
- เก็บ artifact และ commit id ของรุ่นที่ deploy
