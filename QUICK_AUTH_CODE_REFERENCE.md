# 🔐 Auth_Code & Visit_PTType - Quick Reference

## ตาราง 3 ตาราง ที่เชื่อมกัน

```
┌─────────────────────────┐
│   VISIT_PTTYPE          │
├─────────────────────────┤
│ vn (FK)                 │
│ pttype (FK)             │────────┐
│ begin_date              │        │
│ expire_date             │        │
│ auth_code ⭐            │        │
│ pttype_number           │        │
└─────────────────────────┘        │
         ↓                         │
    ┌─────────────────────────┐    │
    │   OVST                  │    │
    ├─────────────────────────┤    │
    │ vn (PK)                 │    │
    │ hn (FK) ─────────────┐  │    │
    │ vstdate             │  │    │
    │ ovstost             │  │    │
    └─────────────────────┼──┘    │
                          │       │
    ┌─────────────────────┼───┐   │
    │   PATIENT           │   │   │
    ├─────────────────────┼───┤   │
    │ hn (PK)             │   │   │
    │ pname               │   │   │
    │ fname               │   │   │
    │ lname               │   │   │
    └─────────────────────┘   │   │
                              │   │
                    ┌─────────┘   │
                    │             │
                    ▼             ▼
            ┌──────────────────────────────┐
            │   PTTYPE                     │
            ├──────────────────────────────┤
            │ pttype (PK)                  │
            │ name (Fund Name - Thai)      │
            └──────────────────────────────┘
```

---

## ข้อมูลที่ดึงมา

### visit_pttype เก็บข้อมูลอะไร?

| ฟิลด์ | ข้อมูล | ตัวอย่าง |
|------|-------|---------|
| vn | หมายเลขการมารับบริการ | 690326080002 |
| pttype | รหัสประเภทประกัน | 4 |
| pttype_number | ลำดับ | 1 |
| begin_date | วันเริ่มต้น | 2024-01-01 |
| expire_date | วันหมดอายุ | 2026-12-31 |
| **auth_code** ⭐ | รหัสสิทธิ | AUTH001234 |

---

## API Endpoints

### 1. ดึง Visit_PTType ทั้งหมด
```
GET /api/hosxp/visit-pttype/:vn
```

**Response**:
```json
{
  "success": true,
  "vn": "690326080002",
  "data": [
    {
      "vn": "690326080002",
      "pttype": 4,
      "pttype_name": "บัตรประกันสุขภาพ",
      "auth_code": "AUTH001234",
      "auth_status": "Y",
      "begin_date": "2024-01-01",
      "expire_date": "2026-12-31",
      "hn": "000013485",
      "patient_name": "นางนวลจันทร์ แก้วมะ"
    }
  ]
}
```

### 2. ตรวจสอบ Auth_Code
```
GET /api/hosxp/auth-code/:vn/:pttype
```

**Response**:
```json
{
  "success": true,
  "data": {
    "hasAuthCode": true,
    "authCode": "AUTH001234",
    "beginDate": "2024-01-01",
    "expireDate": "2026-12-31",
    "isValid": true,
    "message": "รหัสสิทธิถูกต้อง",
    "daysRemaining": 286
  }
}
```

---

## Eligibility Check Logic

### ✅ Valid (มีสิทธิ)
```
✅ auth_code <> '' (มีรหัส)
✅ begin_date <= TODAY (เริ่มต้นแล้ว)
✅ expire_date >= TODAY (ยังไม่หมดอายุ)
```

### ❌ Invalid (ไม่มีสิทธิ)
```
❌ auth_code = '' (ไม่มีรหัส)
❌ TODAY < begin_date (ยังไม่เริ่มต้น)
❌ TODAY > expire_date (หมดอายุแล้ว)
```

---

## SQL Queries

### ดึง visit_pttype
```sql
SELECT 
  vpt.vn, vpt.pttype, vpt.auth_code,
  vpt.begin_date, vpt.expire_date,
  pt.name as pttype_name
FROM visit_pttype vpt
LEFT JOIN pttype pt ON pt.pttype = vpt.pttype
WHERE vpt.vn = ?
ORDER BY vpt.pttype_number
```

### ตรวจสอบ auth_code validity
```sql
SELECT 
  auth_code,
  CASE 
    WHEN auth_code = '' THEN 'NO_CODE'
    WHEN DATE(?) < DATE(begin_date) THEN 'NOT_YET'
    WHEN DATE(?) > DATE(expire_date) THEN 'EXPIRED'
    ELSE 'VALID'
  END as status
FROM visit_pttype
WHERE vn = ? AND pttype = ?
```

---

## ใช้งาน (Usage)

### Frontend Call:
```typescript
// 1. ดึงข้อมูล visit_pttype
const visitData = await fetch('/api/hosxp/visit-pttype/690326080002').then(r => r.json());

// 2. สำหรับแต่ละ pttype
for (const ptype of visitData.data) {
  // 3. ตรวจสอบรหัสสิทธิ
  const authResult = await fetch(`/api/hosxp/auth-code/690326080002/${ptype.pttype}`).then(r => r.json());
  
  if (authResult.data.isValid) {
    console.log(`✅ ${ptype.pttype_name} ใช้ได้`);
  } else {
    console.log(`❌ ${ptype.pttype_name} ใช้ไม่ได้`);
  }
}
```

---

## Status Mapping

| auth_code | Status | ความหมาย |
|-----------|--------|---------|
| EMPTY | N | ไม่มีสิทธิ |
| "AUTH001" | Y | มีสิทธิ |

---

## Integration Points

### Fund Analysis Page:
- ✅ แสดง auth_code status (Y/N)
- ✅ ตรวจสอบ begin_date & expire_date
- ✅ แสดง "เข้าเงื่อนไข" หรือ "ไม่เข้า"

### Eligibility Validation:
- ✅ ตรวจสอบรหัสสิทธิ
- ✅ ตรวจสอบช่วงวันที่
- ✅ Update UI status

---

## Code Reference (Delphi → TypeScript)

### Delphi:
```delphi
if(v.auth_code <>"","Y","N") as status
```

### TypeScript:
```typescript
IF(vpt.auth_code <> '', 'Y', 'N') as auth_status
```

---

## ✅ Implementation Status

| Item | Status | Details |
|------|--------|---------|
| SQL Queries | ✅ | Written & tested |
| DB Functions | ✅ | getVisitPtypeData, validateAuthCode |
| API Endpoints | ✅ | /visit-pttype/:vn, /auth-code/:vn/:pttype |
| Frontend Integration | ⏳ | Ready to integrate |
| UI Display | ⏳ | Ready to add to Fund Analysis |

---

## Next Steps

1. ✅ Add to Fund Analysis Page
2. ✅ Display auth_code status
3. ✅ Show eligibility period
4. ✅ Update validation logic
5. ✅ Test with real data

---

**Version**: 1.0  
**Last Updated**: 2026-03-19  
**Status**: ✅ Ready for Integration
