# 🔧 FDH Export Error Fix

## ❌ ปัญหา
ข้อความ: **"Error connecting to server for export"**

## ✅ สาเหตุและการแก้ไข

### ปัญหา 1: SQL Query Syntax Errors
**บรรทัด 868 - CHT Query**
```typescript
// ❌ BEFORE
JOIN patient pt ON o.hn = pt.hn      WHERE o.vn IN (?)

// ✅ AFTER
JOIN patient pt ON o.hn = pt.hn
WHERE o.vn IN (?)
```

### ปัญหา 2: Missing Newline
**บรรทัด 792 - ODX Query**
```typescript
// ❌ BEFORE
    `, [vns]);// 6. OOP (Procedures)

// ✅ AFTER
    `, [vns]);

    // 6. OOP (Procedures)
```

### ปัญหา 3: Error Logging
เพิ่ม console.error() ใน `/api/fdh/export-zip` เพื่อ debug:
```typescript
if (!data) {
  console.error('❌ getExportData returned null for VNs:', vns);
  return res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลจากฐานข้อมูลได้' });
}
```

## 📝 ไฟล์ที่แก้ไข

1. **d:\react\fdh_rect\server\db.ts**
   - บรรทัด 868: แก้ CHT query spacing
   - บรรทัด 792: เพิ่ม newline หลัง ODX query

2. **d:\react\fdh_rect\server\index.ts**
   - บรรทัด 777: เพิ่ม console.error logging

## 🧪 ทดสอบอีกครั้ง

### 1. รีสตาร์ท Backend Server
```powershell
# ปิด node processes
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# เริ่มใหม่
cd d:\react\fdh_rect
npm run server
```

### 2. ทดสอบ Export
ใน UI: คลิก "📦 ส่งออก 16 แฟ้ม ZIP"

### 3. Monitor Server Log
ดูใน terminal backend ว่ามี error อะไร:
```
📦 Exporting X visits to FDH ZIP format...
✅ Exported ZIP successfully: FDH_Export_...zip
```

## 🔍 ถ้ายังมี Error

ดูใน server console log:
- `❌ getExportData returned null for VNs:` - Database query error
- `Error exporting ZIP:` - ZIP creation error
- Query-specific errors เช่น `Unknown column`

## ✨ Expected Result

1. UI แสดง success message
2. ZIP file download
3. ZIP มี 16 ไฟล์:
   - INS.txt, PAT.txt, OPD.txt, ORF.txt, ODX.txt, OOP.txt
   - IPD.txt, IRF.txt, IDX.txt, IOP.txt, CHT.txt, CHA.txt
   - AER.txt, ADP.txt, LVD.txt, DRU.txt

---

**Status:** ✅ Ready to test again
