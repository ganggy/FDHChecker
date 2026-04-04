# ฟีเจอร์ที่เพิ่มเติม - การตรวจสอบข้อมูลขั้นสูง

## 📋 API Endpoint ใหม่

### 1. `/api/hosxp/funds` (GET)
**จุดประสงค์**: ดึงรายการกองทุนทั้งหมดจากฐานข้อมูล

**Response**: 
```json
[
  { "id": "fund_0", "name": "UCS" },
  { "id": "fund_1", "name": "ทหารผ่านศึก" },
  ...
]
```

**ตัวอย่างการใช้**:
```javascript
fetch('/api/hosxp/funds')
  .then(res => res.json())
  .then(funds => console.log(funds))
```

---

### 2. `/api/hosxp/validate` (POST)
**จุดประสงค์**: ตรวจสอบความถูกต้องพื้นฐาน (6 ฟิลด์)

**Request**:
```json
{
  "records": [
    {
      "hn": "123456",
      "patientName": "นายทดสอบ",
      "fund": "UCS",
      "serviceDate": "2026-03-15",
      "serviceType": "OPD",
      "price": 100
    }
  ]
}
```

**Response**:
```json
[
  {
    "hn": "123456",
    "patientName": "นายทดสอบ",
    "fund": "UCS",
    "serviceDate": "2026-03-15",
    "serviceType": "OPD",
    "price": 100,
    "status": "สมบูรณ์",
    "issues": []
  }
]
```

**ตรวจสอบ**:
- ❌ HN (เลขประจำตัวผู้ป่วย)
- ❌ ชื่อผู้ป่วย
- ❌ กองทุน
- ❌ ราคา
- ❌ วันที่บริการ
- ❌ ประเภทบริการ

---

### 3. `/api/hosxp/validate-detailed` (POST) ⭐ **ใหม่**
**จุดประสงค์**: ตรวจสอบแบบเชิงลึก + รหัสยา/หัตถการ/สิทธิ์

**Request**:
```json
{
  "records": [
    {
      "hn": "123456",
      "patientName": "นายทดสอบ",
      "fund": "UCS",
      "serviceDate": "2026-03-15",
      "serviceType": "OPD",
      "price": 100,
      "drugCode": "D001",
      "procedureCode": "P001",
      "rightCode": "R001"
    }
  ],
  "validationMode": "detailed"
}
```

**Response**:
```json
[
  {
    "hn": "123456",
    "patientName": "นายทดสอบ",
    "status": "สมบูรณ์",
    "issues": [],
    "details": {
      "hn_status": "✓",
      "name_status": "✓",
      "fund_status": "✓",
      "fund_type": "main-fund",
      "price_status": "✓",
      "price_value": 100,
      "date_status": "✓",
      "service_type_detail": "ผู้ป่วยนอก",
      "serviceType_status": "✓",
      "drug_code": "D001",
      "procedure_code": "P001",
      "right_code": "R001"
    }
  }
]
```

**ตรวจสอบเพิ่มเติม** (เมื่อ `validationMode: "detailed"`):
- ⚠️ รหัสยา (Drug Code)
- ⚠️ รหัสหัตถการ (Procedure Code)
- ⚠️ รหัสสิทธิ์ (Right Code)

**หมายเหตุ**: 
- ❌ = ต้องแก้ (ไม่สมบูรณ์)
- ⚠️ = ควรตรวจสอบ (incomplete)

---

## 🔍 การเปรียบเทียบ

| ฟีลด์ | Basic Validate | Detailed Validate |
|-----|-----------------|-------------------|
| HN | ✓ | ✓ |
| ชื่อผู้ป่วย | ✓ | ✓ |
| กองทุน | ✓ | ✓ + ตรวจสอบประเภท |
| ราคา | ✓ | ✓ |
| วันที่บริการ | ✓ | ✓ |
| ประเภทบริการ | ✓ | ✓ + รายละเอียด |
| รหัสยา | ✗ | ⚠️ |
| รหัสหัตถการ | ✗ | ⚠️ |
| รหัสสิทธิ์ | ✗ | ⚠️ |

---

## 📊 สถานะการตรวจสอบ

### Basic Mode
```
✓ สมบูรณ์ = ไม่มี ❌
✗ ไม่สมบูรณ์ = มี ❌ อย่างน้อย 1 ข้อ
```

### Detailed Mode
```
✓ สมบูรณ์ = ไม่มี ❌
✗ ไม่สมบูรณ์ = มี ❌ อย่างน้อย 1 ข้อ
⚠️ ประเมิน = มี ⚠️ แต่ไม่มี ❌
```

---

## 🎯 ใช้งาน

### ตรวจสอบพื้นฐาน (เร็ว)
```javascript
const response = await fetch('/api/hosxp/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ records: data })
});
```

### ตรวจสอบเชิงลึก (ละเอียด)
```javascript
const response = await fetch('/api/hosxp/validate-detailed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    records: data,
    validationMode: 'detailed'
  })
});
```

---

## 🔧 การรองรับกองทุนย่อย (Sub-fund)

ระบบตรวจสอบว่ากองทุนเป็นกองทุนย่อยหรือไม่:

```json
{
  "fund": "บัตรทองนอกเขตฉุกเฉินในจังหวัด (ยกเว้นค่าธรรมเนียม ท.)AE",
  "fund_type": "sub-fund",
  "note": "เป็นกองทุนย่อย"
}
```

**ลักษณะกองทุนย่อย**:
- มี `AE` ต่อท้าย
- มีข้อความ "ร่วมจ่าย"
- มีวงเล็บ `(...)` ที่อธิบายรายละเอียด

---

## 📈 ผลลัพธ์การทดสอบ

### Test 1: ข้อมูลสมบูรณ์
```
Input:  { hn: "123456", patientName: "นายทดสอบ", ... }
Output: status: "สมบูรณ์", issues: []
```

### Test 2: ขาด HN
```
Input:  { hn: "", patientName: "นายทดสอบ", ... }
Output: status: "ไม่สมบูรณ์", issues: ["❌ ขาดเลขประจำตัวผู้ป่วย (HN)"]
```

### Test 3: ขาดรหัสยา (Detailed)
```
Input:  { ..., drugCode: "" }
Output: status: "สมบูรณ์", issues: ["⚠️ ไม่มีรหัสยา (Drug Code)"]
```

---

## 🚀 เส้นทางการพัฒนาต่อไป

- [ ] เพิ่มการตรวจสอบ ราคากับมาตรฐาน
- [ ] เพิ่มการตรวจสอบ ICD-10 codes
- [ ] เพิ่มการตรวจสอบ สิทธิ์การเบิกจ่าย
- [ ] บันทึก log การตรวจสอบ
- [ ] ส่งออก Report พร้อมสีไฮไลท์
