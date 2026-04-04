# 🚀 Quick Start Guide

**ระบบตรวจสอบข้อมูลเบิกจ่ายกองทุน HOSxP**

---

## ⚡ เริ่มต้น 5 นาที

### Step 1: เปิดโปรเจกต์ (1 นาที)
```powershell
cd c:\xampp\htdocs\fdh_rect
npm install
```

### Step 2: รันระบบ (1 นาที)
```powershell
npm run dev
```

### Step 3: เปิดเบราว์เซอร์ (1 นาที)
```
http://localhost:5174
```

### Step 4: สำรวจระบบ (2 นาที)
- ✅ คลิกบน "👤 หน้างานเจ้าหน้าที่"
- ✅ ค้นหา HN หรือชื่อผู้ป่วย
- ✅ คลิกบนแถวเพื่อดูรายละเอียด
- ✅ คลิก "📊 แดชบอร์ดผู้บริหาร" เพื่อดูภาพรวม

---

## 🎯 ฟีเจอร์หลัก

### 👤 หน้างานเจ้าหน้าที่
```
1. ค้นหา
   - กรอก HN หรือชื่อผู้ป่วย
   
2. กรอง
   - เลือกกองทุน (UCS/SSS/OFC/LGO)
   - เลือกสถานะ (สมบูรณ์/ไม่สมบูรณ์)
   - เลือกช่วงวันที่
   
3. ส่วนราคา
   - Export CSV
   - Export Excel
   
4. รายละเอียด
   - คลิกแถวเพื่อดูเพิ่มเติม
```

### 📊 แดชบอร์ดผู้บริหาร
```
- สถิติรวมในแต่ละกล่อง
- แยกสถิติตามกองทุน
- อัตราความสมบูรณ์
- มูลค่ารวมเบิกจ่าย
```

---

## 🔍 ตัวอย่างการใช้งาน

### ค้นหารายการ
1. ไปที่หน้า "👤 หน้างานเจ้าหน้าที่"
2. พิมพ์ HN ลงในช่องค้นหา เช่น "123456"
3. ระบบจะแสดงรายการที่ตรงกัน

### ดูรายละเอียด
1. คลิกบนแถวใดแถวหนึ่ง
2. จะเปิด Modal แสดงข้อมูลเต็ม
3. ตรวจสอบ: HN, ชื่อ, ราคา, ปัญหา
4. คลิก "ปิด" เพื่อกลับ

### ส่งออกข้อมูล
1. เลือกกองทุนที่ต้องการ
2. ตั้งค่ากรอง (ถ้าต้อง)
3. คลิก "📥 Export CSV" หรือ "📊 Export Excel"
4. ไฟล์จะดาวน์โหลด

---

## 📊 ตัวอย่างข้อมูล

| HN | ชื่อ | กองทุน | วันที่ | สถานะ | ปัญหา |
|----|------|--------|--------|--------|--------|
| 123456 | สมชาย ใจดี | UCS | 2026-03-15 | ✅ สมบูรณ์ | - |
| 234567 | สายใจ รักดี | SSS | 2026-03-15 | ❌ ไม่สมบูรณ์ | ขาดรหัสหัตถการ |
| 345678 | ภูผา กล้าหาญ | UCS | 2026-03-14 | ✅ สมบูรณ์ | - |

---

## 🎨 UI Navigation

```
┌─────────────────────────────────────┐
│  🏥 HOSxP Fund Check System         │
│  [👤 Staff] [📊 Admin]              │
└─────────────────────────────────────┘

STAFF PAGE:
├─ เมนูกองทุน
├─ ตัวกรองข้อมูล
│  ├─ ค้นหา
│  ├─ สถานะ
│  ├─ วันที่
├─ ปุ่มส่งออก
│  ├─ Export CSV
│  └─ Export Excel
├─ ตาราง
│  └─ Click → Detail Modal
└─ สถิติด้านล่าง

ADMIN DASHBOARD:
├─ สถิติ 6 กล่อง
│  ├─ จำนวนทั้งหมด
│  ├─ สมบูรณ์
│  ├─ ไม่สมบูรณ์
│  ├─ ตรวจสอบแล้ว
│  ├─ อัตรา
│  └─ มูลค่า
├─ สถิติตามกองทุน
└─ ข้อมูลสำคัญ
```

---

## ⚙️ สคริปต์ที่มีประโยชน์

```bash
# รัน dev server
npm run dev

# Build for production
npm run build

# รัน backend server (ต้องติดตั้งก่อน)
npm run server

# Run lint
npm run lint
```

---

## 🔧 การแก้ปัญหาทั่วไป

### ❌ "Port 5173 is in use"
```bash
npm run dev -- --port 5174
```

### ❌ "Cannot find module"
```bash
npm install
```

### ❌ Browser ไม่อัปเดต
- กด F5 หรือ Ctrl+R
- ลบ cache: Ctrl+Shift+Delete

### ❌ ข้อมูลไม่แสดง
- ตรวจสอบ mockData.ts
- ตรวจสอบ Browser Console (F12)

---

## 📱 Features Checklist

### Functionality
- ✅ หน้า Staff สำหรับเจ้าหน้าที่
- ✅ หน้า Admin สำหรับผู้บริหาร
- ✅ ค้นหาข้อมูล
- ✅ กรองข้อมูล
- ✅ ดูรายละเอียด
- ✅ Export CSV
- ✅ Export Excel
- ✅ Dashboard สถิติ

### UI/UX
- ✅ Navigation Bar
- ✅ Responsive Design
- ✅ Color-coded Status
- ✅ Modal Dialog
- ✅ Data Tables
- ✅ Filter Controls

### Data
- ✅ Mock Data Ready
- ✅ Field Validation
- ✅ API Integration Ready
- ✅ Database Connection Ready

---

## 🌐 API Ready

Backend server พร้อมสำหรับเชื่อมต่อ HOSxP:

| Endpoint | Status |
|----------|--------|
| `/api/hosxp/checks` | ✅ Ready |
| `/api/hosxp/patients/:hn` | ✅ Ready |
| `/api/hosxp/services/:code` | ✅ Ready |
| `/api/hosxp/drugs/:code` | ✅ Ready |
| `/api/rcmdb/:type` | ✅ Ready |
| `/api/fdh/submit` | ✅ Ready |

---

## 📚 เอกสารเพิ่มเติม

| ไฟล์ | เนื้อหา |
|-----|---------|
| README.md | ข้อมูลทั่วไป |
| DEVELOPMENT.md | คู่มือการพัฒนา |
| SERVER_SETUP.md | ตั้งค่า Backend |
| TEST_CASES.md | กรณีทดสอบ |

---

## 💡 Tips & Tricks

1. **ค้นหาเร็ว**: ใช้ HN แทนชื่อ
2. **กรองที่มี**: ใช้สถานะเพื่อหารายการที่ต้องแก้ไข
3. **ส่งออก**: ทำหลังจากกรองแล้ว
4. **Dashboard**: ดูภาพรวมให้เร็ว
5. **Modal**: ดูเพื่อตรวจสอบรายละเอียด

---

## 📞 Need Help?

- 📖 Read: README.md, DEVELOPMENT.md
- 🧪 Test: TEST_CASES.md
- 💬 Check: Browser Console (F12)
- 🔍 Debug: Network Tab (F12)

---

**ยินดีต้อนรับสู่ระบบตรวจสอบเบิกจ่ายกองทุน! 🎉**

วันที่: 15 มีนาคม 2026  
เวอร์ชัน: 1.0.0
