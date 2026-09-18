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
`main` และ PM2 apps `fdh-backend fdh-frontend`

## อัปเดตผ่านหน้าเว็บ

ผู้ดูแลระบบสามารถเปิด **ตั้งค่าระบบ → อัปเดตระบบ** เพื่อตรวจสอบ GitHub และกดยืนยันการอัปเดต ระบบจะแสดงความคืบหน้าของการเชื่อมต่อ ดาวน์โหลด dependency ทดสอบ build รีสตาร์ต และ health check หลัง backend หยุดชั่วคราวหน้าเว็บจะเชื่อมต่อกลับและติดตามงานเดิมจากไฟล์ `.update-state/current.json` โดยอัตโนมัติ

กำหนดค่าที่ `.env` ก่อนใช้งาน:

```bash
FDH_SELF_UPDATE_ENABLED=1
FDH_APP_DIR=/opt/FDHChecker
FDH_DEPLOY_BRANCH=main
FDH_PM2_APPS="fdh-backend fdh-frontend"
FDH_HEALTH_BASE_URL=http://127.0.0.1:3506
FDH_DEPLOY_BACKUP=0
```

ปุ่มอัปเดตจะแสดงเฉพาะหน้า admin และ backend จะไม่เริ่มงานเมื่อ branch ไม่ตรง, working tree มีไฟล์ค้าง, ไม่มีรุ่นใหม่ หรือ commit บน GitHub เปลี่ยนหลังหน้าจอยืนยัน Log อยู่ที่ `.update-state/update-<job-id>.log` และถูกกันออกจาก Git แล้ว

## อัปเดตผ่านหน้าเว็บ

ผู้ดูแลระบบสามารถเปิด **ตั้งค่าระบบ → อัปเดตระบบ** เพื่อตรวจสอบ GitHub และกดยืนยันการอัปเดต หน้านี้จะแสดงหัวข้อ รายละเอียด วันที่ และผู้เขียนของแต่ละ commit เพื่อให้ทราบผลที่จะได้รับก่อนติดตั้ง ระบบจะแสดงความคืบหน้าของการเชื่อมต่อ ดาวน์โหลด dependency ทดสอบ build รีสตาร์ต และ health check หลัง backend หยุดชั่วคราวหน้าเว็บจะเชื่อมต่อกลับและติดตามงานเดิมจากไฟล์ `.update-state/current.json` โดยอัตโนมัติ

ส่วน **ย้อนเวอร์ชัน** แสดงรุ่นก่อนหน้าใน branch เดียวกัน ผู้ดูแลต้องเลือกรุ่นและยืนยันก่อนดำเนินการ ระบบสร้าง Git restore ref ก่อนเปลี่ยน Source code ทดสอบและ build รุ่นที่เลือกใหม่ แล้วบันทึกผู้ดำเนินการ เวลา รุ่นต้นทาง รุ่นปลายทาง และรายการเปลี่ยนแปลงไว้ใน `.update-state/history-*.json` หากขั้นตอนหลังเปลี่ยน Source code ล้มเหลว ระบบจะพยายามกู้รุ่นต้นทางและรีสตาร์ตบริการโดยอัตโนมัติ การย้อนเวอร์ชันโปรแกรมไม่ย้อนข้อมูลในฐานข้อมูล จึงต้องตรวจความเข้ากันได้ของ schema เมื่อรุ่นนั้นมีการเปลี่ยนโครงสร้างฐานข้อมูล

กำหนดค่าที่ `.env` ก่อนใช้งาน:

```bash
FDH_SELF_UPDATE_ENABLED=1
FDH_APP_DIR=/opt/FDHChecker
FDH_DEPLOY_BRANCH=main
FDH_PM2_APPS="fdh-backend fdh-frontend"
FDH_HEALTH_BASE_URL=http://127.0.0.1:3506
FDH_DEPLOY_BACKUP=0
```

ปุ่มอัปเดตจะแสดงเฉพาะหน้า admin และ backend จะไม่เริ่มงานเมื่อ branch ไม่ตรง, working tree มีไฟล์ค้าง, ไม่มีรุ่นใหม่ หรือ commit บน GitHub เปลี่ยนหลังหน้าจอยืนยัน Log อยู่ที่ `.update-state/update-<job-id>.log` และถูกกันออกจาก Git แล้ว

### การป้องกันสถานะค้างระหว่างรีสตาร์ต

ตัวอัปเดตและตัวย้อนเวอร์ชันเปิดผ่าน PM2 daemon เป็น process แยกชื่อ
`fdh-update-<job-id>` โดยปิด autorestart และ watch จึงไม่อยู่ใน process tree
ของ backend ที่กำลังรีสตาร์ต ใช้ผู้ใช้และ `PM2_HOME` เดียวกับบริการ FDH
และต้องมี GNU `timeout` (หรือ `gtimeout` บน macOS จาก coreutils)

- คำสั่ง PM2 แต่ละครั้งจำกัดเวลา 120 วินาที ปรับได้ด้วย
  `FDH_PM2_TIMEOUT_SECONDS` และ log จะมี BEGIN/END พร้อม exit code
  (124 หมายถึง timeout)
- รีสตาร์ตเฉพาะชื่อใน `FDH_PM2_APPS` ทีละบริการ ไม่ใช้ `restart all`,
  `pm2 update` หรือ `pm2 save` ซึ่งกระทบ process list ของระบบอื่น
- ถ้า restart ล้มเหลวหรือเกินเวลา จะบันทึก failed และให้ผู้ดูแลตรวจสอบ
  ไม่ rollback แข่งกับคำสั่งที่ PM2 daemon อาจยังดำเนินการอยู่
- หลังสถานะไม่เปลี่ยนเกิน 90 วินาที backend จะตรวจ process ตัวรันผ่าน PM2
  ถ้าหายหรือหยุดจะแสดง interrupted; ถ้าอ่าน PM2 ไม่ได้จะแจ้งให้ตรวจสอบ
  และยังกันการเริ่มงานซ้อน ไม่ถือว่า health check ผ่านแปลว่าอัปเดตสำเร็จ
- งานรุ่นเก่าที่ไม่มี `runnerName` ใช้เกณฑ์เดิม 2 ชั่วโมง
- `launcher-<job-id>.log` ใช้ตรวจการเปิด process; `update-<job-id>.log`
  ใช้ตรวจขั้นตอนติดตั้ง เก็บ `started-<job-id>` ไว้เพื่อป้องกันรันงานเดิมซ้ำ
  หากมีการ save/resurrect PM2 ภายหลัง งานจบจะคงเป็น stopped ใน PM2;
  ลบเฉพาะ process ชื่องานนั้นได้หลังตรวจว่าเสร็จแล้ว โดยเก็บประวัติใน `.update-state`

### ติดตั้งแพตช์นี้ครั้งแรกจากรุ่นที่ค้าง 89%

หลังนำแพตช์ขึ้น GitHub แล้ว ให้ติดตั้งผ่าน SSH ในช่วงที่รีสตาร์ต FDH ได้
เพราะปุ่มหน้าเว็บรุ่นเก่าคัดลอก runner ก่อนดึงโค้ดใหม่ จึงยังใช้ runner เก่า
ในการอัปเดตรอบแรก ตรวจว่างานเดิมจบแล้วและ `git status --short` ไม่มีไฟล์ค้าง
จากนั้นรันทีละคำสั่งและหยุดหากคำสั่งใดไม่สำเร็จ:

```bash
cd /opt/FDHChecker
git pull --ff-only
npm ci --include=dev
npm run check
npm run build:all
pm2 restart fdh-backend
pm2 restart fdh-frontend
curl --fail --max-time 10 http://127.0.0.1:3506/api/live
curl --fail --max-time 10 http://127.0.0.1:3506/api/ready
```

ตรวจว่า upstream ของ branch ตรงกับ `FDH_DEPLOY_BRANCH` ก่อน pull และใช้
health URL ที่ตั้งไว้หากเปลี่ยนจากค่าเริ่มต้น การทดสอบ runner ใน
`server/systemUpdate.test.ts` ใช้ git/npm/PM2/curl จำลองและโฟลเดอร์ชั่วคราว
ไม่เรียกบริการโรงพยาบาลจริง แต่ยังต้องตรวจการอัปเดตจริงบน staging Linux
ที่ใช้ PM2 แบบเดียวกับ production ก่อนถือว่าทดสอบ deployment ครบ

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
npm ci --include=dev
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

### เครื่องมือ build หายบน production

หาก log ขึ้น `tsc: command not found` หรือชุดทดสอบหา dependency ไม่พบ ให้ตรวจว่าการติดตั้งข้าม devDependencies หรือไม่ การอัปเดตและกู้คืนต้องใช้ `npm ci --include=dev` เพราะมีทั้งการทดสอบและ build บนเซิร์ฟเวอร์ แม้ process จะมี `NODE_ENV=production` หรือ `npm_config_omit=dev` อยู่ก็ตาม

ถ้า shell ของ root แจ้ง `pm2: command not found` แต่ API ยังตอบ ให้ตรวจเจ้าของ process และเส้นทางโปรแกรมที่รันอยู่ก่อน ใช้บัญชีและ PM2 instance เดิมในการ deploy อย่าติดตั้ง PM2 อีก instance เพื่อแก้เฉพาะข้อความนี้ รุ่นที่ยังใช้ runner เก่าต้องติดตั้งแพตช์ครั้งแรกผ่าน SSH ตามขั้นตอนด้านบน เนื่องจาก runner ถูกคัดลอกก่อน pull โค้ดใหม่
