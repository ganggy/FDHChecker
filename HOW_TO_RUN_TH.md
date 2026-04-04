# 🚀 วิธีการรัน FDH Rect System - คำแนะนำฉบับสมบูรณ์

**วันที่:** 24 มีนาคม 2026  
**สถานะ:** Backend ✅ กำลังทำงาน | Frontend ⏳ พร้อมสตาร์ท  
**โปรเจกต์:** FDH Checker System (95% เสร็จสิ้น)

---

## ✅ สถานะปัจจุบัน

### Backend Server
```
✅ สถานะ:      กำลังทำงาน
📌 Port:       3001
🌐 URL:        http://localhost:3001/api
✅ Database:   เชื่อมต่อแล้ว (6772 ตาราง, 10231 เรคคอร์ด)
📊 Mode:       REAL DATABASE DATA
```

### Frontend Server
```
⏳ สถานะ:      พร้อมสตาร์ท
📌 Port:       3507
🌐 URL:        http://localhost:3507 (เมื่อสตาร์ท)
⚙️ Build:      ~30-60 วินาที (ครั้งแรก)
```

---

## 🎯 วิธีที่ 1: ใช้ Batch File (ง่ายที่สุด) ⭐

### ขั้นตอน:
1. ไปที่ `d:\react\fdh_rect`
2. **ดับเบิลคลิก** ไฟล์นี้:
   ```
   QUICK_START_FRONTEND.bat
   ```
3. รอจนกว่าจะเห็น "ready in X ms"
4. เปิดเบราว์เซอร์ไปที่ `http://localhost:3507`

---

## 🎯 วิธีที่ 2: ใช้ PowerShell

### ขั้นตอนที่ 1: เปิด PowerShell
- ใช้ Windows PowerShell หรือ PowerShell 7
- ไปที่ `d:\react\fdh_rect`

### ขั้นตอนที่ 2: รันคำสั่ง
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\Start-Frontend.ps1
```

---

## 🎯 วิธีที่ 3: ใช้ Command Prompt (CMD)

### ขั้นตอนที่ 1: เปิด Command Prompt
- กด `Win + R`
- พิมพ์ `cmd` แล้วกด Enter

### ขั้นตอนที่ 2: รันคำสั่ง
```bash
cd d:\react\fdh_rect
npm run dev
```

### ขั้นตอนที่ 3: รอจนเห็น
```
VITE v5.x.x  ready in 45ms

➜  Local:   http://localhost:3507/
```

---

## 🌐 เปิดในเบราว์เซอร์

หลังจากเห็นข้อความ "ready in X ms" ให้:

1. เปิดเบราว์เซอร์ใหม่
2. ไปที่ URL:
   ```
   http://localhost:3507
   ```

### ตรวจสอบว่า:
- ✅ หน้าเพจโหลดโดยไม่มีข้อผิดพลาด
- ✅ เมนูนำทางปรากฎขึ้น
- ✅ ไม่มีข้อความแดง (error)
- ✅ เปิด DevTools (F12) - Console ควรสะอาด

---

## 🧪 ทดสอบพื้นฐาน

เมื่อหน้าเพจโหลดแล้ว:

### 1. ตรวจสอบ Console
- กด `F12` เพื่อเปิด DevTools
- ไปที่ Console tab
- ควรเห็น ✅ เสียง "beep" ไม่มี error

### 2. ทดสอบข้อมูลยา
- ไปที่หน้า OPD หรือ Prescription
- ค้นหา VN: `690323000158` (ไม่มีข้อมูลยา)
- ควรแสดง: `ไม่มีข้อมูลยา` ❌ ไม่มี fake data

### 3. ตรวจสอบ Navigation
- คลิกเมนูต่างๆ
- ควรโหลดหน้าเพจได้สมูท
- ไม่มี loading errors

### 4. ทดสอบ Export (ถ้ามี)
- ไปที่ส่วน FDH Export
- คลิก Export to ZIP
- ตรวจสอบว่า ZIP มี 16 ไฟล์

---

## ⚠️ ปัญหาและวิธีแก้ไข

### ❌ ปัญหา: Port 3507 ถูกใช้งาน

**สาเหตุ:** โปรแกรมอื่นใช้ port 3507

**วิธีแก้:**
```powershell
# ปิดทั้งหมด Node processes
taskkill /IM node.exe /F

# สตาร์ท Frontend ใหม่
npm run dev
```

---

### ❌ ปัญหา: npm ไม่พบ

**สาเหตุ:** Node.js ไม่ได้ติดตั้ง

**วิธีแก้:**
1. ดาวน์โหลด Node.js จาก https://nodejs.org
2. ติดตั้ง (เลือก LTS version)
3. รีสตาร์ท Command Prompt
4. ลองใหม่: `npm run dev`

---

### ❌ ปัญหา: node_modules หรือ dependencies หายไป

**สาเหตุ:** Dependencies ไม่ได้ติดตั้ง

**วิธีแก้:**
```bash
# ติดตั้ง dependencies
npm install

# ลบ cache
npm cache clean --force

# ลองติดตั้งใหม่
npm install

# สตาร์ท
npm run dev
```

---

### ❌ ปัญหา: Build error หรือ Module not found

**วิธีแก้:**
```bash
# ลบ node_modules และ cache
rm -r node_modules package-lock.json
npm cache clean --force

# ติดตั้งใหม่
npm install

# สตาร์ท
npm run dev
```

---

### ❌ ปัญหา: ไม่สามารถเชื่อมต่อ Backend

**สาเหตุ:** Backend ไม่ทำงาน

**ตรวจสอบ:**
```bash
# ตรวจสอบ port 3001
netstat -ano | findstr :3001

# ควรเห็น Node process ใช้ port 3001
```

**วิธีแก้:**
- เช็ค `.env` file ใน `server` folder
- เช็ค database connection
- รีสตาร์ท Backend

---

## 📊 ขั้นตอนการสตาร์ทแบบเต็ม

```
1. Backend ✅ (กำลังทำงาน port 3001)
   ↓
2. สตาร์ท Frontend (Port 3507)
   ↓
3. รอ "ready in X ms"
   ↓
4. เปิดเบราว์เซอร์ http://localhost:3507
   ↓
5. ตรวจสอบหน้าโหลดสมูท
   ↓
6. เปิด DevTools (F12) → Console
   ↓
7. เช็ค ไม่มี Error (สามารถมี Warning ได้)
   ↓
8. ทดสอบเบื้องต้น
   ↓
9. ทดสอบ Export 16 ไฟล์
   ↓
10. ✅ DONE - Ready for full testing
```

---

## 📝 ไฟล์เอกสารที่เกี่ยวข้อง

| ไฟล์ | วัตถุประสงค์ |
|-----|-----------|
| `TESTING_GUIDE_PHASE_1.md` | คำแนะนำการทดสอบ 9 ทดสอบ |
| `BACKUP_COMPLETE.md` | สรุปข้อมูล Backup และสถานะ |
| `MASTER_PROJECT_INDEX_MARCH_23.md` | ดัชนีเอกสารฉบับสมบูรณ์ |
| `RUN_INSTRUCTIONS.md` | คำแนะนำการรันระบบ |

---

## ✅ Checklist - ก่อนสตาร์ท

- [ ] Backend ทำงานที่ port 3001 ✅ (ปรับปรุงแล้ว)
- [ ] Node.js ติดตั้งแล้ว
- [ ] npm ทำงานได้
- [ ] `d:\react\fdh_rect` เข้าถึงได้
- [ ] network ไม่มีปัญหา
- [ ] Port 3507 ว่าง

---

## 🎯 ขั้นตอนสุดท้าย - รันระบบ

### ตัวเลือก A: Batch File (ง่ายที่สุด)
```
👉 ดับเบิลคลิก: d:\react\fdh_rect\QUICK_START_FRONTEND.bat
```

### ตัวเลือก B: PowerShell
```powershell
cd d:\react\fdh_rect
.\Start-Frontend.ps1
```

### ตัวเลือก C: Command Prompt
```bash
cd d:\react\fdh_rect
npm run dev
```

---

## 📞 ติดต่อ/ช่วยเหลือ

ถ้า **ยังไม่สามารถรันได้**:

1. ลองดำเนินการตามขั้นตอน Troubleshooting ข้างบน
2. ตรวจสอบ error message อย่างระมัดระวัง
3. ลองวิธีอื่นจาก 3 ตัวเลือก
4. ตรวจสอบเอกสาร `TESTING_GUIDE_PHASE_1.md`

---

**สร้างเมื่อ:** 24 มีนาคม 2026  
**สถานะ:** ✅ พร้อมสตาร์ท Frontend  
**Backend:** ✅ กำลังทำงาน Port 3001

