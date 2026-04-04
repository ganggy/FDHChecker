# Backend Server สำหรับเชื่อมต่อ HOSxP

## สิ่งที่จำเป็น

1. **Node.js + Express** - สำหรับ API Server
2. **MySQL/MariaDB** - สำหรับเชื่อมต่อฐานข้อมูล HOSxP
3. **Environment Variables** - สำหรับการตั้งค่าการเชื่อมต่อ

## ขั้นตอนการติดตั้ง

### 1. ติดตั้ง Dependencies

```bash
npm install express mysql2 cors dotenv typescript ts-node
npm install -D @types/express @types/node
```

### 2. สร้างไฟล์ `.env`

```env
# HOSxP Database
HOSXP_HOST=192.168.2.254
HOSXP_USER=opd
HOSXP_PASSWORD=opd
HOSXP_DB=hos

# rcmdb Database
RCMDB_HOST=localhost
RCMDB_USER=root
RCMDB_PASSWORD=
RCMDB_DB=rcmdb

# Server
PORT=3001
NODE_ENV=development
```

### 3. รันเซิร์ฟเวอร์

```bash
ts-node server/index.ts
```

หรือ

```bash
npm run server
```

## API Endpoints

### ดึงข้อมูลตรวจสอบ
```
GET /api/hosxp/checks?fund=UCS&startDate=2026-03-01&endDate=2026-03-31
```

### ดึงข้อมูลผู้ป่วย
```
GET /api/hosxp/patients/:hn
```

### ดึงข้อมูลบริการ
```
GET /api/hosxp/services/:serviceCode
```

### ดึงข้อมูลยา
```
GET /api/hosxp/drugs/:drugCode
```

### ดึงข้อมูล rcmdb
```
GET /api/rcmdb/REP
GET /api/rcmdb/STM
GET /api/rcmdb/INV
```

### ส่งข้อมูลไปยัง FDH
```
POST /api/fdh/submit
```

## โครงสร้าง Database ตัวอย่าง

### Table: ovst (การรักษา)
```sql
CREATE TABLE ovst (
  vn INT PRIMARY KEY,
  hn VARCHAR(20),
  vstdate DATETIME,
  fund VARCHAR(10),
  ispd INT,
  total_price DECIMAL(10,2)
);
```

### Table: patient (ผู้ป่วย)
```sql
CREATE TABLE patient (
  hn VARCHAR(20) PRIMARY KEY,
  pt_name VARCHAR(255),
  pt_birthdate DATE,
  pt_sex VARCHAR(1),
  pt_nation VARCHAR(50)
);
```

### Table: service_list (รายการบริการ)
```sql
CREATE TABLE service_list (
  code VARCHAR(20) PRIMARY KEY,
  name VARCHAR(255),
  price DECIMAL(10,2),
  fund VARCHAR(10)
);
```

### Table: drug_list (รายการยา)
```sql
CREATE TABLE drug_list (
  code VARCHAR(20) PRIMARY KEY,
  name VARCHAR(255),
  price DECIMAL(10,2),
  unit VARCHAR(50)
);
```

### Table: fdh_submissions (การส่งข้อมูลไปยัง FDH)
```sql
CREATE TABLE fdh_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submitted_data JSON,
  submitted_at DATETIME,
  record_count INT,
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
