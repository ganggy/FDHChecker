<div align="center">

# 🏥 FDH Checker

**ตรวจความพร้อมก่อนเคลม · ติดตามการเบิกจ่าย · เชื่อมข้อมูลงานโรงพยาบาล**

[![License: MIT](https://img.shields.io/badge/License-MIT-059669.svg)](./LICENSE)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=white)

[เริ่มใช้งาน](./QUICK_START.md) · [ติดตั้ง Production](./deploy/README.md) · [แผนพัฒนา](./BACKLOG.md) · [MIT License](./LICENSE)

</div>

---

ระบบตรวจสอบความพร้อมการเบิกจ่ายจาก HOSxP และติดตามวงจร FDH, REP, STM และ INV ราย Visit สำหรับงาน OPD/IPD กองทุนเฉพาะ การเงิน และผู้บริหาร

## ✨ ความสามารถหลัก

| งาน | สิ่งที่ระบบช่วยจัดการ |
| :--- | :--- |
| 🔎 ตรวจสอบก่อนเคลม | ตรวจความครบถ้วนของ Visit สำหรับ OPD/IPD และกองทุนเฉพาะ |
| 📂 ติดตามผลเบิกจ่าย | นำเข้าและจับคู่ REP/STM/INV ด้วย VN, AN และ Tran ID |
| 🛠️ แก้ไขรายการติดปัญหา | ติดตาม C/Deny พร้อมคำอธิบายและประวัติการแก้ไข |
| 💰 การเงินและลูกหนี้ | ติดตามลูกหนี้ การกระทบยอด และ UC นอก CUP ตาม HMAIN |
| 🔗 เชื่อมต่อบริการ | รองรับ FDH, NHSO e-Claim และ MOPH Claim |
| 🔐 จัดการสิทธิ์ | กำหนดผู้ใช้ กลุ่ม และสิทธิ์เข้าถึงเมนู |

## 🧭 ภาพรวมการทำงาน

```text
HOSxP → ตรวจความพร้อมราย Visit → ส่งเคลม FDH
                  ↓                    ↓
             แก้ไข C/Deny ← ติดตาม REP / STM / INV
                                       ↓
                            กระทบยอดและติดตามลูกหนี้
```

## 🧩 เทคโนโลยี

| ส่วนประกอบ | เทคโนโลยี |
| :--- | :--- |
| Frontend | React 19 · TypeScript · Vite |
| Backend | Node.js · Express |
| Database | MySQL / MariaDB สำหรับ HOSxP และฐาน REP/STM/INV |
| Production | PM2 · Nginx / HTTPS |

## 🚀 เริ่มพัฒนา

รันคำสั่งจากโฟลเดอร์โปรเจกต์ โดยใช้ Node.js และ npm พร้อมการเชื่อมต่อฐานข้อมูลที่กำหนดใน `.env`

**1. ติดตั้งและเปิด Backend**

```powershell
npm install
Copy-Item .env.example .env
npm run server
```

**2. เปิด Frontend ในอีก terminal**

```powershell
npm run dev
```

**3. เข้าใช้งานและตรวจสถานะ**

| บริการ | URL |
| :--- | :--- |
| Frontend | http://localhost:3507 |
| Backend | http://localhost:3506 |
| Health check | http://localhost:3506/api/health |

ระบบไม่สร้างรหัสผู้ดูแลแบบ hardcode หากฐานข้อมูลยังไม่มี Admin ให้ตั้งค่า `APP_BOOTSTRAP_ADMIN_USERNAME` และ `APP_BOOTSTRAP_ADMIN_PASSWORD` ชั่วคราว รันระบบหนึ่งครั้ง แล้วนำสองค่านี้ออกจาก `.env`

## ✅ ตรวจคุณภาพก่อนส่งขึ้นระบบ

```powershell
npm run check
```

คำสั่งนี้รัน automated tests, ตรวจ TypeScript backend, ESLint และ production build

## 📡 FDH 16 แฟ้ม API

ทุก endpoint ต้องส่ง App access token ใน `Authorization: Bearer ...` และรับ JSON ยกเว้นผลลัพธ์ ZIP

- `POST /api/fdh/preflight` ตรวจ schema, required fields, ความสัมพันธ์ข้ามแฟ้ม และยอด CHT/CHA โดยไม่ส่งออกภายนอก
- `POST /api/fdh/view-data` แสดงข้อมูล 16 แฟ้มพร้อมผล preflight
- `POST /api/fdh/export-zip` ส่งออกไฟล์ `.txt` ทั้ง 16 แฟ้ม (ต้องผ่าน preflight)
- `POST /api/fdh/submit` ขอ FDH token และส่ง `multipart/form-data` ไป FDH จริง (ต้องผ่าน preflight และกำหนด `confirm: true`)
- `GET /api/fdh/submission-logs?limit=50` อ่าน audit log ของการส่ง API

<details>
<summary><strong>ดูตัวอย่าง Request และรายละเอียด Profile</strong></summary>

ตัวอย่าง request body (ข้อมูลสมมติ):

```json
{
  "vns": ["EXAMPLE_VN"],
  "profile": "fwf-migrants",
  "fcodeByHn": { "EXAMPLE_HN": "FCODE_FROM_FDH" },
  "uucByVn": { "EXAMPLE_VN": "1" },
  "confirm": true
}
```

`profile` รองรับ `standard` และ `fwf-migrants` โดย v1 จะส่ง TXT ไม่มี header ส่วน v2 จะส่ง TXT มี header อัตโนมัติตาม URL ที่ตั้งค่าไว้ ระบบไม่ส่งข้อมูลเมื่อมี FCode, invoice, auth code, catalog mapping หรือความสัมพันธ์ระหว่างแฟ้มไม่ครบ

</details>

## ⚙️ การตั้งค่า

ใช้ [.env.example](./.env.example) เป็นแม่แบบ ห้าม commit `.env`, password หรือ token จริงเข้า Git

ตัวแปรสำคัญ:

- `HOSXP_*` การเชื่อมต่อ HOSxP
- `REPSTM_*` ฐานข้อมูล REP/STM/INV
- `CORS_ORIGINS` URL ที่อนุญาตให้เรียก API
- `TRUST_PROXY=1` เมื่อวางหลัง reverse proxy
- `HOSXP_QUERY_MAX_DAYS` เพดานช่วงค้นหา Visit
- `OUTBOUND_HTTP_TIMEOUT_MS` timeout สำหรับ FDH/NHSO/MOPH

## 📦 Production

1. ตั้งค่า `.env` บนเครื่องปลายทางโดยไม่เก็บใน Git
2. รัน `npm ci` และ `npm run check`
3. build frontend และ backend ด้วย `npm run build:all`
4. สำรองฐานข้อมูล แล้วรัน backend ผ่าน PM2 และวาง Nginx/HTTPS ด้านหน้า
5. ตรวจ `/api/live` และ `/api/ready` หลัง deploy
6. เปลี่ยน bootstrap password และ token ที่ใช้ติดตั้งทันที

ตัวอย่าง PM2, Nginx, backup และ rollback อยู่ที่ [deploy/README.md](./deploy/README.md)

## 🗂️ โครงสร้างหลัก

```text
src/                    React application
server/index.ts         Express composition root
server/routes/          API routers แยกตามงาน
server/requestSafety.ts HTTP validation และ error handling
server/httpClient.ts    HTTP client พร้อม timeout
server/db.ts            data-access เดิมที่กำลังทยอยแยกตาม domain
public/                 static assets ที่โหลดตามต้องการ
deploy/                 PM2, Nginx, backup และ runbook สำหรับ production
```

ดูวิธีเปิดระบบแบบย่อที่ [QUICK_START.md](./QUICK_START.md)
ดูงานที่ยังเหลือและลำดับความสำคัญที่ [BACKLOG.md](./BACKLOG.md)

## 📜 License

MIT License — ดูไฟล์ [LICENSE](./LICENSE)

---

<div align="center">

**FDH Checker** · เครื่องมือสำหรับงานตรวจสอบและติดตามการเบิกจ่ายของโรงพยาบาล

</div>
