<div align="center">

# 🏥 FDH Checker

**ตรวจความพร้อมก่อนเคลม · ติดตามการเบิกจ่าย · เชื่อมข้อมูลงานโรงพยาบาล**

[![License: MIT](https://img.shields.io/badge/License-MIT-059669.svg)](./LICENSE)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=white)

[เริ่มใช้งาน](./QUICK_START.md) · [คู่มือใช้งานแยกตามหน้าที่](./docs/USER_MANUAL_BY_ROLE.md) · [ติดตั้ง Production](./deploy/README.md) · [แผนพัฒนา](./BACKLOG.md) · [MIT License](./LICENSE)

[เลือกเอกสารตามงาน](./docs/README.md) · [แนวทางสำหรับ Coding Agent](./AGENTS.md)

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

## 🖥️ ความต้องการของระบบ (System Requirements)

### 1. สเปกฮาร์ดแวร์ (Hardware Requirements)
| ทรัพยากร | ขั้นต่ำ (Minimum) | แนะนำ (Recommended) |
| :--- | :--- | :--- |
| **CPU** | 2 Cores | 4 Cores ขึ้นไป (รองรับการประมวลผลเคลมปริมาณมาก) |
| **RAM** | 4 GB | 8 GB ขึ้นไป (แนะนำ 16 GB หากเปิดใช้งานโมเดล Local AI) |
| **Disk Space** | 20 GB | 50 GB+ (SSD / NVMe แนะนำสำหรับเก็บ Log และไฟล์สำรองฐานข้อมูล) |

### 2. ซอฟต์แวร์และ Runtime (Software & Environment)
- **ระบบปฏิบัติการ (OS):** 
  - **Production:** Linux แนะนำ **AlmaLinux 9 / Rocky Linux 9 / RHEL 9** หรือ **Ubuntu 22.04 / 24.04 LTS** / Debian 12
  - **Development / Test:** Windows 10/11, macOS หรือ Linux
- **Node.js:** v22.x LTS (หรือ v20.x ขึ้นไป)
- **Package Manager:** `npm` v10+ (มาพร้อมกับ Node.js)
- **Process Manager:** `pm2` สำหรับจัดการรัน Backend และ Frontend บน Production
- **Web Server / Reverse Proxy:** `Nginx` (พร้อมการตั้งค่า SSL/TLS ผ่าน Let's Encrypt / Certbot)
- **คำสั่งและเครื่องมือพื้นฐาน:** `git`, `curl`, `mysqldump` (MySQL Client tools), GNU `coreutils` (`timeout`)

### 3. ระบบฐานข้อมูล (Database)
- **ฐานข้อมูล HOSxP (HIS):**
  - **MySQL 5.7+ / MariaDB 10.3+ / Percona Server** (ใช้การเชื่อมต่อแบบ UTF-8 / TIS-620 ตามโครงสร้างเดิมของ รพ.)
  - *สิทธิ์ฐานข้อมูล:* แนะนำสิทธิ์ **Read-Only (SELECT)** เพื่อความปลอดภัยสูงสุดของข้อมูลผู้ป่วย (หากต้องการใช้ระบบบันทึกรายการ UC WALKIN หรือ sync ค่าบริการ 0 บาทอัตโนมัติ ต้องเปิดสิทธิ์ INSERT ในตารางที่เกี่ยวข้องตามความยินยอม)
  - รองรับโหมดอ่านผ่าน **PostgreSQL** สำหรับโรงพยาบาลที่ใช้ HIS บน PostgreSQL
- **ฐานข้อมูลจัดการระบบ (REP / STM / INV / Users):**
  - แนะนำแยก Database ต่างหาก เช่น `repstminv` หรือรวมในฐานเดียวกัน
  - ต้องมีสิทธิ์ `CREATE`, `ALTER`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `DROP` สำหรับตารางจัดการสิทธิ์ผู้ใช้ (`app_user`, `app_user_group`), ตารางบันทึกไฟล์ลูกหนี้/สเตทเมนต์ (`repstm_*`), และตารางตั้งค่าระบบ (`app_settings`)

### 4. พอร์ตและการเชื่อมต่อเครือข่าย (Network & Ports)
- **พอร์ตภายในเครื่อง (Internal):**
  - `3506` : Backend Express API
  - `3507` : Frontend Vite Application
- **พอร์ตภายนอก (External / Public):**
  - `80` (HTTP) และ `443` (HTTPS) ผ่าน Nginx Reverse Proxy
- **การเชื่อมต่อออกภายนอก (Outbound Internet):**
  - พอร์ต `443` สำหรับส่งเคลมและดึงสิทธิ์กับ FDH Gateway (`fdh.moph.go.th`), NHSO e-Claim API, MOPH Claim API และดาวน์โหลดอัปเดตจาก GitHub

---

## 🛠️ ขั้นตอนการติดตั้งระบบ (Installation Guide)

### 📌 แนวทางที่ 1: ติดตั้งสำหรับใช้งานจริง (Production บน Linux)

#### ขั้นตอนที่ 1: เตรียมเครื่องและติดตั้งแพ็กเกจที่จำเป็น
**บน AlmaLinux 9 / Rocky Linux 9 / RHEL:**
```bash
# อัปเดตระบบและติดตั้งเครื่องมือพื้นฐาน
sudo dnf update -y
sudo dnf install -y git curl nginx mysql

# ติดตั้ง Node.js 22 LTS ผ่าน NodeSource
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

# ติดตั้ง PM2 globally
sudo npm install -g pm2
```

**บน Ubuntu 22.04 / 24.04 LTS / Debian:**
```bash
# อัปเดตระบบและติดตั้งเครื่องมือพื้นฐาน
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx mysql-client coreutils

# ติดตั้ง Node.js 22 LTS ผ่าน NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# ติดตั้ง PM2 globally
sudo npm install -g pm2
```

#### ขั้นตอนที่ 2: ดาวน์โหลด Source Code
```bash
# Clone repository มายังไดเรกทอรีติดตั้ง (แนะนำ /opt/FDHChecker)
sudo git clone https://github.com/ganggy/FDHChecker.git /opt/FDHChecker
sudo chown -R $USER:$USER /opt/FDHChecker
cd /opt/FDHChecker

# ตรวจสอบว่าอยู่บน branch main
git checkout main
```

#### ขั้นตอนที่ 3: สร้างโฟลเดอร์ Log และกำหนดค่าคอนฟิก (.env)
```bash
# สร้างโฟลเดอร์เก็บ log สำหรับ PM2
sudo install -d -o "$USER" -g "$USER" /var/log/fdh-checker

# คัดลอกไฟล์แม่แบบคอนฟิก
cp .env.example .env
chmod 600 .env

# แก้ไขไฟล์ .env ตามค่าจริงของโรงพยาบาล
nano .env
```
> [!IMPORTANT]
> **ค่าสำคัญที่ต้องระบุใน `.env`:**
> - `HOSXP_HOST`, `HOSXP_PORT`, `HOSXP_DB`, `HOSXP_USER`, `HOSXP_PASS`: การเชื่อมต่อฐานข้อมูล HOSxP
> - `REPSTM_HOST`, `REPSTM_PORT`, `REPSTM_DB`, `REPSTM_USER`, `REPSTM_PASS`: การเชื่อมต่อฐานข้อมูลจัดการลูกหนี้และผู้ใช้
> - `JWT_SECRET`: รหัสลับสำหรับสร้าง Token เข้ารหัส (แนะนำสุ่มสตริงยาว 32+ ตัวอักษร)
> - `CORS_ORIGINS`: โดเมนหรือ IP ที่อนุญาตให้เรียกใช้งาน (เช่น `http://192.168.2.202:3507,https://fdh.yourhospital.go.th`)
> - `FDH_SELF_UPDATE_ENABLED=1`: เปิดให้กดอัปเดตผ่านหน้าเว็บได้
> - `APP_BOOTSTRAP_ADMIN_USERNAME` และ `APP_BOOTSTRAP_ADMIN_PASSWORD`: กำหนดบัญชี Admin แรกเข้าชั่วคราว

#### ขั้นตอนที่ 4: ติดตั้ง Dependencies และ Build ระบบ
```bash
# ติดตั้ง dependencies ตาม package-lock
npm ci --include=dev

# ตรวจสอบความถูกต้องของระบบ
npm run check

# Build ทั้ง Frontend และ Backend สำหรับ Production
npm run build:all
```

#### ขั้นตอนที่ 5: เริ่มต้นระบบครั้งแรก (สร้างตารางและบัญชี Admin)
```bash
# รัน backend ชั่วคราวเพื่อให้ระบบสร้างตารางและบัญชี Admin เริ่มต้น
node server/dist/server/index.js
# เมื่อขึ้นข้อความระบบพร้อมทำงาน ให้กด Ctrl + C เพื่อหยุด
```
> [!TIP]
> หลังจากสร้างบัญชี Admin เรียบร้อยแล้ว ให้เปิดไฟล์ `.env` แล้วลบหรือ Comment ค่า `APP_BOOTSTRAP_ADMIN_USERNAME` และ `APP_BOOTSTRAP_ADMIN_PASSWORD` ออก เพื่อความปลอดภัย

#### ขั้นตอนที่ 6: จัดการ Process ด้วย PM2 และตั้งให้เปิดอัตโนมัติตอนบูตเครื่อง
```bash
# เริ่มต้นบริการ Backend และ Frontend ผ่าน PM2
pm2 start deploy/pm2/ecosystem.config.cjs

# บันทึกสถานะ process
pm2 save

# ตั้งค่าให้ PM2 สตาร์ตอัตโนมัติเมื่อเปิดเครื่อง (ทำตามคำแนะนำที่ระบบแสดงผล)
pm2 startup
```

ตรวจสอบสถานะการทำงาน:
```bash
pm2 status
pm2 logs --lines 50
```

#### ขั้นตอนที่ 7: ตั้งค่า Nginx Reverse Proxy และ HTTPS
คัดลอกไฟล์คอนฟิกตัวอย่างไปยัง Nginx:
```bash
sudo cp deploy/nginx/fdh-checker.conf /etc/nginx/conf.d/fdh-checker.conf

# แก้ไข server_name และเส้นทาง SSL certificate ตามโดเมนจริงของโรงพยาบาล
sudo nano /etc/nginx/conf.d/fdh-checker.conf

# ตรวจสอบความถูกต้องและโหลดการตั้งค่าใหม่
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

#### ขั้นตอนที่ 8: ตรวจสอบความพร้อมของระบบ (Health Check)
```bash
curl -I http://127.0.0.1:3506/api/live
curl -I http://127.0.0.1:3506/api/ready
```
เมื่อผลลัพธ์ตอบกลับเป็น `HTTP/1.1 200 OK` แสดงว่าระบบติดตั้งสมบูรณ์และพร้อมให้บริการ

---

### 💻 แนวทางที่ 2: ติดตั้งสำหรับทดสอบหรือพัฒนา (Development บน Windows / macOS / Linux)

```bash
# 1. Clone repository
git clone https://github.com/ganggy/FDHChecker.git
cd FDHChecker

# 2. ติดตั้ง dependencies
npm install

# 3. สร้างไฟล์ .env จากแม่แบบ
cp .env.example .env     # บน Linux/macOS
# หรือบน Windows PowerShell: Copy-Item .env.example .env

# 4. แก้ไข .env ให้ชี้ไปยังฐานข้อมูลทดสอบ
# 5. เปิด Backend (Terminal 1)
npm run server

# 6. เปิด Frontend (Terminal 2)
npm run dev
```
เข้าใช้งานระบบได้ที่ `http://localhost:3507` (Backend API อยู่ที่ `http://localhost:3506`)

---

## 🔄 การอัปเดตระบบในอนาคต (System Updates)

### วิธีที่ 1: อัปเดตผ่านหน้าเว็บ (แนะนำสำหรับผู้ดูแลระบบ)
1. เข้าสู่ระบบด้วยบัญชี Admin แล้วไปที่เมนู **ตั้งค่าระบบ → อัปเดตระบบ**
2. ระบบจะตรวจสอบ commit ล่าสุดจาก GitHub (`main`) อัตโนมัติ พร้อมแสดงรายการเปลี่ยนแปลง
3. กดยืนยัน **"ดำเนินการอัปเดต"** ระบบจะรัน pipeline (ดึงโค้ด, ตรวจสอบ, build, รีสตาร์ต PM2 และ health check) ให้อัตโนมัติโดยไม่ทำให้ระบบค้าง

### วิธีที่ 2: อัปเดตผ่านสคริปต์บนเซิร์ฟเวอร์
```bash
cd /opt/FDHChecker
bash deploy/scripts/deploy-app.sh
```

---

## ⚙️ การตั้งค่าระบบสำคัญใน `.env`

| ตัวแปร | รายละเอียด | ค่าเริ่มต้น / ตัวอย่าง |
| :--- | :--- | :--- |
| `PORT` | พอร์ต Backend API | `3506` |
| `HOSXP_HOST` | ที่อยู่ Host ของฐานข้อมูล HOSxP | `192.168.2.254` |
| `HOSXP_PORT` | พอร์ต MySQL HOSxP | `3306` |
| `HOSXP_DB` | ชื่อฐานข้อมูล HOSxP | `hos` |
| `REPSTM_HOST` | ที่อยู่ Host ของฐานข้อมูล REP/STM | `192.168.2.254` |
| `REPSTM_DB` | ชื่อฐานข้อมูล REP/STM | `repstminv` |
| `CORS_ORIGINS` | รายการโดเมนที่อนุญาต (คั่นด้วยจุลภาค) | `http://localhost:3507,http://192.168.2.202:3507` |
| `TRUST_PROXY` | เปิดใช้งานเมื่อวางหลัง Nginx / Reverse Proxy | `1` |
| `JWT_SECRET` | คีย์เข้ารหัส JWT สำหรับ Session ผู้ใช้ | สตริงสุ่มความยาว 32+ ตัวอักษร |
| `HOSXP_QUERY_MAX_DAYS` | จำนวนวันสูงสุดที่ค้นหา Visit ต่อครั้ง | `90` |
| `OUTBOUND_HTTP_TIMEOUT_MS` | Timeout สำหรับเชื่อมต่อ API ภายนอก (มิลลิวินาที) | `30000` |
| `FDH_SELF_UPDATE_ENABLED` | เปิดใช้งานเมนูอัปเดตผ่านหน้าเว็บ | `1` |
| `FDH_DEPLOY_BRANCH` | Branch ที่ใช้ในการอัปเดต | `main` |

---

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

## 📦 การสำรองและกู้คืนข้อมูล (Backup & Rollback)

- ดูขั้นตอนการสำรองฐานข้อมูลอัตโนมัติ การ rollback และการกู้คืนระบบเพิ่มเติมได้ที่ [deploy/README.md](./deploy/README.md)

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
