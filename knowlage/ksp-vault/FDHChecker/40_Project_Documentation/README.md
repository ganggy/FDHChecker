---
ksp_schema: 1
project: FDHChecker
type: "project-document"
category: "documentation"
source: "README.md"
source_hash: "9ccfff480890b41a051fd9336375d9ed07de9a1de32e53444815d70a2dde3e9f"
managed_by: "sync-ksp-vault"
---
# FDH Checker

ระบบตรวจสอบความพร้อมการเบิกจ่ายจาก HOSxP และติดตามวงจร FDH, REP, STM และ INV ราย Visit สำหรับงาน OPD/IPD กองทุนเฉพาะ การเงิน และผู้บริหาร

## ความสามารถหลัก

- ตรวจความครบถ้วนของ Visit ก่อนส่งเคลม
- นำเข้าและจับคู่ REP/STM/INV โดย VN, AN และ Tran ID
- ติดตาม C/Deny พร้อมคำอธิบายและประวัติการแก้ไข
- ติดตามลูกหนี้ การกระทบยอด และ UC นอก CUP ตาม HMAIN
- เชื่อมต่อ FDH, NHSO e-Claim และ MOPH Claim
- กำหนดผู้ใช้ กลุ่ม และสิทธิ์เมนู

## เทคโนโลยี

- React 19 + TypeScript + Vite
- Node.js + Express
- MySQL/MariaDB สำหรับ HOSxP และฐาน REP/STM/INV
- PM2 สำหรับ production

## เริ่มพัฒนา

```powershell
npm install
Copy-Item .env.example .env
npm run server
```

เปิดอีก terminal:

```powershell
npm run dev
```

- Frontend: `http://localhost:3507`
- Backend: `http://localhost:3506`
- Health check: `http://localhost:3506/api/health`

ระบบไม่สร้างรหัสผู้ดูแลแบบ hardcode หากฐานข้อมูลยังไม่มี Admin ให้ตั้งค่า `APP_BOOTSTRAP_ADMIN_USERNAME` และ `APP_BOOTSTRAP_ADMIN_PASSWORD` ชั่วคราว รันระบบหนึ่งครั้ง แล้วนำสองค่านี้ออกจาก `.env`

## ตรวจคุณภาพก่อนส่งขึ้นระบบ

```powershell
npm run check
```

คำสั่งนี้รัน automated tests, ตรวจ TypeScript backend, ESLint และ production build

## FDH 16 แฟ้ม API

ทุก endpoint ต้องส่ง App access token ใน `Authorization: Bearer ...` และรับ JSON ยกเว้นผลลัพธ์ ZIP

- `POST /api/fdh/preflight` ตรวจ schema, required fields, ความสัมพันธ์ข้ามแฟ้ม และยอด CHT/CHA โดยไม่ส่งออกภายนอก
- `POST /api/fdh/view-data` แสดงข้อมูล 16 แฟ้มพร้อมผล preflight
- `POST /api/fdh/export-zip` ส่งออกไฟล์ `.txt` ทั้ง 16 แฟ้ม (ต้องผ่าน preflight)
- `POST /api/fdh/submit` ขอ FDH token และส่ง `multipart/form-data` ไป FDH จริง (ต้องผ่าน preflight และกำหนด `confirm: true`)
- `GET /api/fdh/submission-logs?limit=50` อ่าน audit log ของการส่ง API

ตัวอย่าง request body:

```json
{
  "vns": ["690720004252"],
  "profile": "fwf-migrants",
  "fcodeByHn": { "000024977": "FCODE_FROM_FDH" },
  "uucByVn": { "690720004252": "1" },
  "confirm": true
}
```

`profile` รองรับ `standard` และ `fwf-migrants` โดย v1 จะส่ง TXT ไม่มี header ส่วน v2 จะส่ง TXT มี header อัตโนมัติตาม URL ที่ตั้งค่าไว้ ระบบไม่ส่งข้อมูลเมื่อมี FCode, invoice, auth code, catalog mapping หรือความสัมพันธ์ระหว่างแฟ้มไม่ครบ

## การตั้งค่า

ใช้ [.env.example](./.env.example) เป็นแม่แบบ ห้าม commit `.env`, password หรือ token จริงเข้า Git

ตัวแปรสำคัญ:

- `HOSXP_*` การเชื่อมต่อ HOSxP
- `REPSTM_*` ฐานข้อมูล REP/STM/INV
- `CORS_ORIGINS` URL ที่อนุญาตให้เรียก API
- `TRUST_PROXY=1` เมื่อวางหลัง reverse proxy
- `HOSXP_QUERY_MAX_DAYS` เพดานช่วงค้นหา Visit
- `OUTBOUND_HTTP_TIMEOUT_MS` timeout สำหรับ FDH/NHSO/MOPH

## Production

1. ตั้งค่า `.env` บนเครื่องปลายทางโดยไม่เก็บใน Git
2. รัน `npm ci` และ `npm run check`
3. build frontend ด้วย `npm run build`
4. รัน backend ผ่าน PM2 และวาง reverse proxy/HTTPS ด้านหน้า
5. เปลี่ยน bootstrap password และ token ที่ใช้ติดตั้งทันที

## โครงสร้างหลัก

```text
src/                    React application
server/index.ts         Express composition root
server/routes/          API routers แยกตามงาน
server/requestSafety.ts HTTP validation และ error handling
server/httpClient.ts    HTTP client พร้อม timeout
server/db.ts            data-access เดิมที่กำลังทยอยแยกตาม domain
public/                 static assets ที่โหลดตามต้องการ
```

ดูวิธีเปิดระบบแบบย่อที่ [QUICK_START.md](./QUICK_START.md)
