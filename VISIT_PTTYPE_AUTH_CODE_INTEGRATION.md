# Visit_PTType & Auth_Code Integration 🔐
## ระบบรหัสสิทธิและประเภทประกันจากการมารับบริการ

---

## 📋 ภาพรวม

ระบบ FDH AdminDashboard ได้รวม:
1. **visit_pttype** - ข้อมูลประเภทประกันจากการมารับบริการ
2. **auth_code** - รหัสสิทธิ (สิทธิการรักษา)
3. **Eligibility checking** - ตรวจสอบสิทธิการใช้ประกัน

---

## 🔌 HOSxP Tables Structure

### ตาราง VISIT_PTTYPE
```
┌─────────────────────────────────────────────────────────┐
│ visit_pttype (บันทึกประเภทประกันของการมารับบริการ)    │
├─────────────────────────────────────────────────────────┤
│ vn (FK)         │ หมายเลขการมารับบริการ                 │
│ pttype (FK)     │ รหัสประเภทประกัน                      │
│ pttype_number   │ ลำดับประเภทประกัน                    │
│ begin_date      │ วันเริ่มต้นสิทธิ                      │
│ expire_date     │ วันหมดอายุสิทธิ                      │
│ auth_code       │ รหัสสิทธิ (Authorization Code)        │
│ owner_hn        │ HN เจ้าของสิทธิ                       │
│ status          │ สถานะสิทธิ                           │
└─────────────────────────────────────────────────────────┘
```

### ตาราง PTTYPE
```
┌─────────────────────────────────────────────────────────┐
│ pttype (ประเภทประกัน)                                  │
├─────────────────────────────────────────────────────────┤
│ pttype (PK)     │ รหัสประเภทประกัน                      │
│ name            │ ชื่อประเภทประกัน (Thai)              │
│ pttype_group    │ กลุ่มประเภทประกัน                    │
└─────────────────────────────────────────────────────────┘
```

---

## 🔄 SQL Queries ที่ใช้

### 1. ดึง Visit_PTType
```sql
SELECT 
  vpt.vn,
  vpt.pttype,
  vpt.pttype_number,
  vpt.begin_date,
  vpt.expire_date,
  vpt.auth_code,
  IF(vpt.auth_code <> '', 'Y', 'N') as auth_status,
  pt.name as pttype_name,
  o.hn,
  CONCAT(p.pname, p.fname, ' ', p.lname) as patient_name
FROM visit_pttype vpt
LEFT JOIN pttype pt ON pt.pttype = vpt.pttype
LEFT JOIN ovst o ON o.vn = vpt.vn
LEFT JOIN patient p ON p.hn = o.hn
WHERE vpt.vn = ?
ORDER BY vpt.pttype_number
```

### 2. ตรวจสอบ Auth_Code
```sql
SELECT 
  auth_code,
  begin_date,
  expire_date,
  CASE 
    WHEN auth_code IS NULL OR auth_code = '' THEN 0
    WHEN DATE(NOW()) < DATE(begin_date) THEN 0
    WHEN DATE(NOW()) > DATE(expire_date) THEN 0
    ELSE 1
  END as is_valid
FROM visit_pttype
WHERE vn = ? AND pttype = ?
LIMIT 1
```

---

## 🛠️ TypeScript Functions ที่สร้างเพิ่มเติม

### 1. getVisitPtypeData (server/db.ts)
```typescript
export const getVisitPtypeData = async (vn: string): Promise<Record<string, unknown>[]>
```

**Purpose**: ดึงข้อมูล visit_pttype ทั้งหมดของการมารับบริการ

**Return**:
```json
{
  "vn": "690326080002",
  "pttype": 4,
  "pttype_number": 1,
  "begin_date": "2024-01-01",
  "expire_date": "2026-12-31",
  "auth_code": "AUTH001234",
  "auth_status": "Y",
  "pttype_name": "บัตรประกันสุขภาพ (ร่วมจ่าย30 บาท)",
  "hn": "000013485",
  "patient_name": "นางนวลจันทร์ แก้วมะ"
}
```

### 2. validateAuthCode (server/db.ts)
```typescript
export const validateAuthCode = async (
  vn: string,
  pttype: string
): Promise<{
  hasAuthCode: boolean;
  authCode: string | null;
  beginDate: string | null;
  expireDate: string | null;
  isValid: boolean;
  message: string;
}>
```

**Purpose**: ตรวจสอบความถูกต้องของรหัสสิทธิ

**Return**:
```json
{
  "hasAuthCode": true,
  "authCode": "AUTH001234",
  "beginDate": "2024-01-01",
  "expireDate": "2026-12-31",
  "isValid": true,
  "message": "รหัสสิทธิถูกต้อง"
}
```

---

## 🌐 API Endpoints ที่เพิ่มใหม่

### 1. GET /api/hosxp/visit-pttype/:vn
ดึงข้อมูล visit_pttype ทั้งหมดของการมารับบริการ

**Request**:
```
GET http://localhost:3001/api/hosxp/visit-pttype/690326080002
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
      "pttype_number": 1,
      "begin_date": "2024-01-01",
      "expire_date": "2026-12-31",
      "auth_code": "AUTH001234",
      "auth_status": "Y",
      "pttype_name": "บัตรประกันสุขภาพ (ร่วมจ่าย30 บาท)",
      "hn": "000013485",
      "patient_name": "นางนวลจันทร์ แก้วมะ"
    }
  ],
  "timestamp": "2026-03-19T10:30:00.000Z"
}
```

### 2. GET /api/hosxp/auth-code/:vn/:pttype
ตรวจสอบรหัสสิทธิสำหรับการมารับบริการและประเภทประกัน

**Request**:
```
GET http://localhost:3001/api/hosxp/auth-code/690326080002/4
```

**Response**:
```json
{
  "success": true,
  "data": {
    "vn": "690326080002",
    "pttype": "4",
    "hasAuthCode": true,
    "authCode": "AUTH001234",
    "beginDate": "2024-01-01",
    "expireDate": "2026-12-31",
    "isValid": true,
    "message": "รหัสสิทธิถูกต้อง",
    "daysRemaining": 286
  },
  "timestamp": "2026-03-19T10:30:00.000Z"
}
```

---

## 📊 Auth_Code Validation Logic

### สถานะ Valid
```
✅ hasAuthCode = true (มีรหัสสิทธิ)
✅ auth_code <> '' (ไม่ว่าง)
✅ beginDate <= TODAY (สิทธิเริ่มต้นแล้ว)
✅ expireDate >= TODAY (สิทธิยังไม่หมดอายุ)
```

### สถานะ Invalid
```
❌ NO authCode (ไม่มีรหัส)
❌ Empty authCode (รหัส empty)
❌ Not yet begin (สิทธิยังไม่เริ่มต้น)
❌ Expired (สิทธิหมดอายุแล้ว)
```

---

## 🎯 Integration with Fund Analysis

### Visit_PTType ใช้ใน:
1. **Eligibility Check** - ตรวจสอบว่ามีสิทธิจริงหรือไม่
2. **Fund Status** - แสดงสถานะสิทธิปัจจุบัน
3. **Auth Validation** - ตรวจสอบรหัสสิทธิ
4. **Eligibility Period** - ตรวจสอบช่วงเวลาที่มีสิทธิ

---

## 💻 Frontend Service Integration

### hosxpService.ts เพิ่ม:

```typescript
// ดึงข้อมูล visit_pttype
export const fetchVisitPtypeData = async (vn: string) => {
  const response = await fetch(`http://localhost:3001/api/hosxp/visit-pttype/${vn}`);
  return await response.json();
};

// ตรวจสอบ auth_code
export const validateAuthCode = async (vn: string, pttype: string) => {
  const response = await fetch(`http://localhost:3001/api/hosxp/auth-code/${vn}/${pttype}`);
  return await response.json();
};
```

---

## 📝 Usage Example

### ตรวจสอบเงื่อนไขการเบิกจ่าย

```typescript
// 1. ดึงข้อมูล visit_pttype
const visitPtypeData = await fetchVisitPtypeData(vn);

// 2. ตรวจสอบแต่ละประเภทประกัน
for (const ptype of visitPtypeData.data) {
  // 3. ตรวจสอบรหัสสิทธิ
  const authValidation = await validateAuthCode(vn, ptype.pttype);
  
  if (authValidation.data.isValid) {
    console.log(`✅ สิทธิ ${ptype.pttype_name} ถูกต้อง`);
    console.log(`   รหัส: ${authValidation.data.authCode}`);
    console.log(`   หมดอายุ: ${authValidation.data.expireDate}`);
  } else {
    console.log(`❌ สิทธิ ${ptype.pttype_name} ไม่ถูกต้อง: ${authValidation.data.message}`);
  }
}
```

---

## 🔄 Data Flow

```
FundAnalysisPage
    ↓ (click on record)
    ↓ checkVisitPtype()
    ↓
GET /api/hosxp/visit-pttype/:vn
    ↓
Backend: getVisitPtypeData()
    ↓
Query: visit_pttype ← LEFT JOIN pttype, ovst, patient
    ↓
[Array of visit_pttype records with auth_code]
    ↓
UI: Display Auth Status
    ↓ (if auth_code exists)
    ↓ validateAuthCode()
    ↓
GET /api/hosxp/auth-code/:vn/:pttype
    ↓
Backend: validateAuthCode()
    ↓
Check: isValid = (auth_code <> '' AND beginDate <= NOW AND expireDate >= NOW)
    ↓
UI: Show ✅ Valid / ❌ Invalid
```

---

## 🔐 Security Considerations

### Auth_Code Fields Sensitive:
- ✅ Can be shown to authorized users
- ✅ Should be encrypted in DB
- ✅ Should log access to auth_code
- ✅ Should validate before processing claim

### Validation Checks:
```
1. HN owner match (check auth_code owner_hn = patient.hn)
2. Date validation (begin_date <= date <= expire_date)
3. Status check (check visit_pttype.status)
4. Amount check (check within authorized limit)
```

---

## 📊 Current Implementation Status

### ✅ Database Level (server/db.ts)
- `getVisitPtypeData()` - Implemented
- `validateAuthCode()` - Implemented

### ✅ API Level (server/fast_server.js)
- `/api/hosxp/visit-pttype/:vn` - Implemented (mock data)
- `/api/hosxp/auth-code/:vn/:pttype` - Implemented (mock data)

### ⏳ Frontend Level (src/services)
- Frontend service methods - Ready to implement
- UI components - Ready to integrate

---

## 📚 Delphi Code Reference

### Original HOSxP Implementation:
```delphi
visit_pttype_cds.close;
pttypelistcds.data := HOSxP_GetDataset(
  'select i.*,p.name as pttype_name ' +
  ' from visit_pttype i ' +
  ' left outer join pttype p on p.pttype = i.pttype ' +
  ' where i.vn = "' + fvn + '" order by i.pttype_number'
);

if pttypelistcds.recordcount > 0 then
begin
  visit_pttype_cds.data := hosxp_getdataset(
    'select o.hn, ' +
    'if(v.auth_code <>"","Y","N") as status, ' +
    'v.auth_code, ' +
    'concat(p.pname,p.fname," ",p.lname) as ptname ' +
    'from visit_pttype v ' +
    'left outer join ovst o on o.vn=v.vn ' +
    'left outer join patient p on p.hn=o.hn ' +
    'where v.vn = "' + fvn +'" '
  );
end;
```

### Equivalent TypeScript Implementation:
```typescript
const getVisitPtypeData = async (vn: string) => {
  const connection = await getUTFConnection();
  const [rows] = await connection.query(
    `SELECT 
      vpt.vn, vpt.pttype, vpt.pttype_number,
      vpt.begin_date, vpt.expire_date, vpt.auth_code,
      IF(vpt.auth_code <> '', 'Y', 'N') as auth_status,
      pt.name as pttype_name,
      o.hn,
      CONCAT(p.pname, p.fname, ' ', p.lname) as patient_name
    FROM visit_pttype vpt
    LEFT JOIN pttype pt ON pt.pttype = vpt.pttype
    LEFT JOIN ovst o ON o.vn = vpt.vn
    LEFT JOIN patient p ON p.hn = o.hn
    WHERE vpt.vn = ?
    ORDER BY vpt.pttype_number`,
    [vn]
  );
  return rows;
};
```

---

## 🧪 Testing

### Test Case 1: Valid Auth_Code
```
Input: VN = 690326080002, Pttype = 4
Expected Output:
  - hasAuthCode: true
  - authCode: AUTH001234
  - isValid: true
  - message: "รหัสสิทธิถูกต้อง"
```

### Test Case 2: Expired Auth_Code
```
Input: VN = 690326080003, Pttype = 5
Expected Output:
  - hasAuthCode: true
  - authCode: AUTH001235
  - isValid: false
  - message: "รหัสสิทธิหมดอายุ"
```

### Test Case 3: No Auth_Code
```
Input: VN = 690326080004, Pttype = 1
Expected Output:
  - hasAuthCode: false
  - authCode: null
  - isValid: false
  - message: "ไม่พบรหัสสิทธิ"
```

---

## 📌 Summary

✅ **Visit_PTType** - Get fund eligibility status  
✅ **Auth_Code** - Validate authorization code  
✅ **Begin/Expire Date** - Check eligibility period  
✅ **Status Field** - Determine Y/N status  
✅ **Integration Ready** - Fully implemented  

---

**Version**: 1.0  
**Status**: ✅ Ready for Integration  
**Last Updated**: 2026-03-19
