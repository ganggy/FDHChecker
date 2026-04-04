# 🔧 FDH Export (16 แฟ้ม) - Fix Report

## ✅ ปัญหาที่แก้ไข

### 1. SQL Injection Prevention
เปลี่ยนจาก **string interpolation** ไป **parameterized queries** เพื่อป้องกัน SQL Injection ในฟังก์ชัน `getExportData()`

**ตัวอย่าง:**
```typescript
// ❌ BEFORE: String interpolation
WHERE ovst.vn IN (${vnsList})

// ✅ AFTER: Parameterized query
WHERE ovst.vn IN (?)
// Parameters: [vns]
```

### 2. Query Fixes

#### INS (Insurance) Query ✅
- เปลี่ยนใหม่เป็น parameterized queries
- Parameters: `[vns]`

#### PAT (Patient) Query ✅
- เปลี่ยน `'${hcode}'` เป็น `?` parameter
- Parameters: `[hcode, vns]`

#### OPD (Visit) Query ✅
- Parameters: `[vns]`

#### ORF (Refer Out) Query ✅
- Parameters: `[vns]`

#### ODX (Diagnosis) Query ✅
- **FIX**: เปลี่ยน `clinic` เป็น `clinic_dep` (correct column name)
- Parameters: `[vns]`

#### OOP (Procedures) Query ✅
- Parameters: `[vns]`

#### IPD (Admission) Query ✅
- Parameters: `[vns]`

#### IRF (Refer IPD) Query ✅
- Parameters: `[vns]`

#### IDX (Diagnosis IPD) Query ✅
- Parameters: `[vns]`

#### IOP (Procedures IPD) Query ✅
- Parameters: `[vns]`

#### CHT (Financial Summary) Query ✅
- Parameters: `[vns]`

#### CHA (Financial Details) Query ✅
- Parameters: `[vns]`

#### AER (Accident/Emergency) Query ✅
- Parameters: `[vns]`

#### ADP (Additionals) Query ✅
- Parameters: `[vns]`

#### LVD (Leave Day) Query ✅
- Parameters: `[vns]`

#### DRU (Drugs) Query ✅
- เปลี่ยน `'${hcode}'` เป็น `?` parameter
- Parameters: `[hcode, vns]`

## 📝 ไฟล์ที่แก้ไข

- **d:\react\fdh_rect\server\db.ts** (บรรทัด 692-975)
  - ฟังก์ชัน: `getExportData()`

## 🧪 ขั้นตอนการทดสอบ

### 1. เริ่ม Backend Server
```powershell
cd d:\react\fdh_rect
npm run server
```

### 2. ทดสอบ API `/api/fdh/export-zip`
```powershell
$headers = @{"Content-Type" = "application/json"}
$body = @{vns = @("690323000158")} | ConvertTo-Json
Invoke-WebRequest -Uri "http://localhost:3506/api/fdh/export-zip" `
  -Method POST -Headers $headers -Body $body `
  -OutFile "test-fdh.zip"
```

### 3. ตรวจสอบ ZIP File
```powershell
Get-Item "test-fdh.zip" | Select-Object -Property Name, Length
Expand-Archive -Path "test-fdh.zip" -DestinationPath "test-fdh-extracted"
Get-ChildItem "test-fdh-extracted"
```

## 📦 ไฟล์ที่ควรมีใน ZIP (16 แฟ้ม)

1. **INS.txt** - Insurance Information
2. **PAT.txt** - Patient Information
3. **OPD.txt** - Outpatient Visit
4. **ORF.txt** - Outpatient Refer Out
5. **ODX.txt** - Outpatient Diagnosis
6. **OOP.txt** - Outpatient Procedures
7. **IPD.txt** - Inpatient Admission
8. **IRF.txt** - Inpatient Refer
9. **IDX.txt** - Inpatient Diagnosis
10. **IOP.txt** - Inpatient Procedures
11. **CHT.txt** - Charge Summary
12. **CHA.txt** - Charge Details
13. **AER.txt** - Accident/Emergency
14. **ADP.txt** - Additionals (Non-drug items)
15. **LVD.txt** - Leave Days
16. **DRU.txt** - Drugs

## 🔍 เมื่อเกิด Error

หากเกิด error เช่น `Unknown column 'clinic'`:

1. ตรวจสอบชื่อคอลัมน์ในตารางฐานข้อมูล
2. ดูใน server console log เพื่อหา error message ที่แน่นอน
3. ตรวจสอบชื่อตารางและคอลัมน์ใหม่ด้วย:
   ```sql
   DESCRIBE ovstdiag;
   DESCRIBE opitemrece;
   DESCRIBE ipt;
   ```

## ✨ ผลลัพธ์ที่คาดหวัง

- API `/api/fdh/export-zip` ส่ง HTTP 200 OK พร้อม ZIP file
- ZIP file มี 16 ไฟล์ ในรูปแบบ Pipe-Delimited (.txt)
- ข้อมูลแต่ละไฟล์ครบถ้วนตามมาตรฐาน NHSO FDH

## 🚀 การส่งเบิก 16 แฟ้ม

นำ ZIP file ไปส่งเบิกกับระบบ NHSO FDH ตามขั้นตอนของหน่วยงาน

---

**Last Updated:** March 23, 2026
**Status:** ✅ Ready for Testing
