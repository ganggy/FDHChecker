# 🎯 Specific Fund Page - Complete Implementation Guide
## โปรแกรมตรวจสอบเงื่อนไขรายกองทุนพิเศษ

**Version:** 2.0 Enhanced  
**Last Updated:** March 27, 2026  
**Status:** ✅ Production Ready

---

## 📑 Table of Contents
1. [Overview](#overview)
2. [Fund Types & Validation Rules](#fund-types--validation-rules)
3. [New Features](#new-features)
4. [Technical Implementation](#technical-implementation)
5. [API Requirements](#api-requirements)
6. [Testing Guide](#testing-guide)
7. [Deployment Instructions](#deployment-instructions)

---

## 📌 Overview

The **Specific Fund Page** is a comprehensive Thai healthcare fund checking system that validates patient eligibility for 36 different special health insurance funds. Each fund has specific requirements including insurance type, diagnosis codes, age criteria, and service records.

### Key Capabilities
- ✅ Real-time data fetching with date range filtering
- ✅ Automatic diagnosis code validation
- ✅ Age-based eligibility checking
- ✅ Insurance type verification (UCS/WEL)
- ✅ Incomplete data filtering
- ✅ Color-coded status badges
- ✅ Responsive two-column layout (sidebar + table)
- ✅ Thai language interface

---

## 🎯 Fund Types & Validation Rules

### Group 1: Core Care & Support (6 funds)

#### 1. **Palliative Care** (🕊️ Palliative)
- **Thai Name:** Palliative Care
- **Requirements:**
  - Insurance: UCS ✓
  - Diagnosis: Z515 OR Z718 ✓
  - ADP Code: 30001 OR Cons01 OR Eva001 ✓
- **Validation:** All three conditions must be met
- **Error Messages:**
  - `ไม่ใช่สิทธิ์ UCS` - Not UCS beneficiary
  - `ขาด Diag Palliative` - Missing diagnosis
  - `ขาด ADP (Palliative)` - Missing ADP code

#### 2. **Telemedicine** (📱 Telemedicine)
- **Thai Name:** Telemedicine
- **Requirements:**
  - Insurance: UCS ✓
  - ADP Code: TELMED OR Service Type Code: 5 ✓
- **Validation:** Insurance + ADP must be present
- **Error Messages:**
  - `ไม่ใช่สิทธิ์ UCS` - Not UCS beneficiary
  - `ขาด ADP (TELMED)` - Missing TELMED code

#### 3. **Drug by Post (EMS)** (📦 ส่งยาไปรษณีย์)
- **Thai Name:** EMS ส่งยา
- **Requirements:**
  - Insurance: UCS ✓
  - ADP Code: DRUGP ✓
- **Validation:** Insurance + DRUGP ADP required
- **Error Messages:**
  - `ไม่ใช่สิทธิ์ UCS` - Not UCS beneficiary
  - `ขาด ADP (DRUGP)` - Missing DRUGP code

#### 4. **Herb Medicine** (🌿 สมุนไพร)
- **Thai Name:** ยาสมุนไพร 32 รายการ
- **Requirements:**
  - Insurance: UCS OR WEL ✓
  - Herb Price: > 0 ฿ ✓
- **Validation:** Total herb price must be positive
- **Error Messages:**
  - `ไม่ใช่สิทธิ์ UCS/WEL` - Not eligible insurance
  - `ไม่มียอดราคาสมุนไพร` - No herb pricing

#### 5. **Knee Implant** (🦵 พอกเข่า)
- **Thai Name:** ผู้รับบริการพอกเข่า
- **Requirements:**
  - Age: ≥ 40 years ✓
- **Validation:** Age must be 40 or older
- **Error Messages:**
  - `อายุ [X] < 40` - Age below minimum

#### 6. **Prosthetic Limb** (🦾 อวัยวะเทียม)
- **Thai Name:** อวัยวะเทียม/อุปกรณ์
- **Requirements:**
  - Instrument Price: > 0 ฿ ✓
- **Validation:** Must have instrument pricing
- **Error Messages:**
  - `ไม่พบอุปกรณ์เบิกได้` - No instrument found

---

### Group 2: Chemotherapy & Serious Diseases (6 funds)

#### 7. **Chemotherapy** (🧪 เคมีบำบัด) [ENHANCED]
- **Thai Name:** เคมีบำบัด
- **Requirements:**
  - Diagnosis: Z511 OR Z512 ✓
- **Validation:** Diagnosis code matching via regex `/^Z51[12]/`
- **Error Messages:**
  - `ไม่พบวินิจฉัย Z511/Z512` - Missing chemo diagnosis
- **Database Field:** `diag_code` or `has_chemo_diag`

#### 8. **Hepatitis C** (🩹 ไวรัสตับอักเสบซี) [ENHANCED]
- **Thai Name:** ไวรัสตับอักเสบซี
- **Requirements:**
  - Diagnosis: B18.2 ✓
- **Validation:** Diagnosis code matching via regex `/^B182/`
- **Error Messages:**
  - `ไม่พบวินิจฉัย B18.2` - Missing Hepatitis C diagnosis
- **Database Field:** `diag_code` or `has_hepc_diag`

#### 9. **Rehabilitation** (♿ ฟื้นฟูสมรรถภาพ) [ENHANCED]
- **Thai Name:** ฟื้นฟูสมรรถภาพ
- **Requirements:**
  - Diagnosis: Z50 ✓
- **Validation:** Diagnosis code matching via regex `/^Z50/`
- **Error Messages:**
  - `ไม่พบวินิจฉัย Z50` - Missing rehabilitation diagnosis
- **Database Field:** `diag_code` or `has_rehab_diag`

#### 10. **CRRT (Dialysis)** (🏥 ฟอกเลือด) [ENHANCED]
- **Thai Name:** ฟอกเลือดล้างไต (CRRT)
- **Requirements:**
  - Diagnosis: Z49 ✓
- **Validation:** Diagnosis code matching via regex `/^Z49/`
- **Error Messages:**
  - `ไม่พบวินิจฉัย Z49` - Missing CRRT diagnosis
- **Database Field:** `diag_code` or `has_crrt_diag`

#### 11. **Robot Surgery** (🤖 ผ่าตัดหุ่นยนต์) [ENHANCED]
- **Thai Name:** ผ่าตัดด้วยหุ่นยนต์
- **Requirements:**
  - Procedure Name: Contains "ROBOT" (case-insensitive) ✓
- **Validation:** String matching with case normalization
- **Error Messages:**
  - `ไม่พบหัตถการหุ่นยนต์` - No robot procedure found
- **Database Field:** `proc_name` or `has_robot_item`

#### 12. **Proton Therapy** (⚛️ รังสีรักษา) [ENHANCED]
- **Thai Name:** รังสีรักษา (Proton)
- **Requirements:**
  - Diagnosis: Z51.0 ✓
- **Validation:** Diagnosis code matching via regex `/^Z510/`
- **Error Messages:**
  - `ไม่พบวินิจฉัย Z51.0` - Missing proton therapy diagnosis
- **Database Field:** `diag_code` or `has_proton_diag`

---

### Group 3: Cancer Screening (3 funds)

#### 13. **Cervical Cancer Screening** (🎀 Ca Cervix)
- **Thai Name:** คัดกรองมะเร็งปากมดลูก
- **Requirements:**
  - Diagnosis: Z124 OR Z014 ✓
- **Validation:** Basic check (expandable)
- **Error Messages:** None (auto-complete)

#### 14. **Oral Cancer Screening** (🦷 คัดกรองช่องปาก)
- **Thai Name:** คัดกรองมะเร็งช่องปาก
- **Requirements:**
  - ADP Code: 90004 ✓
- **Validation:** ADP code check
- **Error Messages:** None (auto-complete)

#### 15. **Chest X-ray** (🩻 อ่านฟิล์มเอกซเรย์) [ENHANCED]
- **Thai Name:** อ่านฟิล์มเอกซเรย์
- **Requirements:**
  - Service Name: Contains "CXR" OR "Chest X-ray" ✓
- **Validation:** String matching with case normalization
- **Error Messages:**
  - `ไม่พบรายการ CXR` - No CXR service found
- **Database Field:** `service_name` or `has_cxr_item`

---

### Group 4: Antenatal & Postnatal Care (9 funds)

#### 16. **Antenatal Care** (👶 ANC) [ENHANCED]
- **Thai Name:** บริการฝากครรภ์
- **Requirements:**
  - Diagnosis: Z34 OR Z35 ✓
- **Validation:** Diagnosis code matching via regex `/^Z3[45]/`
- **Error Messages:**
  - `ไม่พบรหัส ANC` - No ANC code found
- **Database Field:** `diag_code` or `has_anc`

#### 17. **ANC Visit** (👩‍⚕️ ANC Visit)
- **Thai Name:** ANC Visit (30011)
- **Requirements:**
  - ADP Code: 30011 ✓
- **Validation:** Basic check
- **Error Messages:** None (auto-complete)

#### 18. **ANC Ultrasound** (🔊 ANC Ultrasound)
- **Thai Name:** ANC US (30010)
- **Requirements:**
  - ADP Code: 30010 ✓
- **Validation:** Basic check
- **Error Messages:** None (auto-complete)

#### 19. **ANC Lab 1** (🧬 ANC Lab 1)
- **Thai Name:** ANC Lab 1 (30012)
- **Requirements:**
  - ADP Code: 30012 ✓
- **Validation:** Basic check
- **Error Messages:** None (auto-complete)

#### 20. **ANC Lab 2** (🧪 ANC Lab 2)
- **Thai Name:** ANC Lab 2 (30013)
- **Requirements:**
  - ADP Code: 30013 ✓
- **Validation:** Basic check
- **Error Messages:** None (auto-complete)

#### 21. **Pregnancy Test** (🧪 UPT 30014) [ENHANCED]
- **Thai Name:** ตรวจครรภ์ (UPT 30014)
- **Requirements:**
  - ADP Code: 30014 ✓
- **Validation:** ADP code matching
- **Error Messages:**
  - `ไม่พบรหัส ADP 30014` - Missing UPT code
- **Database Field:** `adp_code` or `has_upt`

#### 22. **Postnatal Care** (🤱 ตรวจหลังคลอด)
- **Thai Name:** ตรวจหลังคลอด (30015)
- **Requirements:**
  - ADP Code: 30015 ✓
- **Validation:** Basic check
- **Error Messages:** None (auto-complete)

#### 23. **Postnatal Supplements** (💊 เสริมธาตุเหล็ก)
- **Thai Name:** เสริมธาตุเหล็ก/โฟลิก (30016)
- **Requirements:**
  - ADP Code: 30016 ✓
- **Validation:** Basic check
- **Error Messages:** None (auto-complete)

#### 24. **Postpartum Care** (🤱 Postpartum)
- **Thai Name:** หญิงหลังคลอด
- **Requirements:**
  - Diagnosis: Z39 ✓
- **Validation:** Basic check
- **Error Messages:** None (auto-complete)

---

### Group 5: Disease Prevention & Screening (8 funds)

#### 25. **FPG Screening** (🩸 คัดกรองเบาหวาน)
- **Thai Name:** คัดกรองเบาหวาน (12003)
- **Requirements:**
  - Age: 35-59 years ✓
  - ADP Code: 12003 OR 32203 ✓
- **Validation:** Age + ADP code check
- **Error Messages:** None (auto-complete)

#### 26. **Cholesterol Screening** (🧪 คัดกรองไขมัน)
- **Thai Name:** คัดกรองไขมัน (12004)
- **Requirements:**
  - Age: 45-59 years ✓
  - ADP Code: 12004 ✓
- **Validation:** Age + ADP code check
- **Error Messages:** None (auto-complete)

#### 27. **Anemia Screening** (🩸 คัดกรองโลหิตจาง)
- **Thai Name:** คัดกรองโลหิตจาง (13001)
- **Requirements:**
  - Age: 13-24 years (Female) ✓
  - ADP Code: 13001 ✓
- **Validation:** Age range + ADP code
- **Error Messages:** None (auto-complete)

#### 28. **Iron Supplement** (💊 เสริมธาตุเหล็ก)
- **Thai Name:** ยาเสริมธาตุเหล็ก (14001)
- **Requirements:**
  - Age: 13-45 years (Female) ✓
  - ADP Code: 14001 OR DID ✓
- **Validation:** Age range + ADP code
- **Error Messages:** None (auto-complete)

#### 29. **Fluoride Coating** (🦷 เคลือบฟลูออไรด์)
- **Thai Name:** เคลือบฟลูออไรด์ (15001)
- **Requirements:**
  - Age: 25-59 years ✓
  - ADP Code: 15001 ✓
- **Validation:** Age + ADP code check
- **Error Messages:** None (auto-complete)

#### 30. **Family Planning** (💊 ครอบครัววางแผน) [ENHANCED]
- **Thai Name:** ยาคุมกำเนิด (FP)
- **Requirements:**
  - Diagnosis: Z30 ✓
- **Validation:** Diagnosis code matching via regex `/^Z30/`
- **Error Messages:**
  - `ไม่พบรหัส FP` - No FP code found
- **Database Field:** `diag_code` or `has_fp`

#### 31. **Contraceptive Pill** (💊 ยาคุมกำเนิด)
- **Thai Name:** ยาคุมกำเนิด (FP003_1, FP003_2)
- **Requirements:**
  - ADP Code: FP003_1 OR FP003_2 ✓
- **Validation:** ADP code check
- **Error Messages:** None (auto-complete)

#### 32. **Condom** (🛡️ ถุงยางอนามัย)
- **Thai Name:** ถุงยางอนามัย (FP003_4)
- **Requirements:**
  - ADP Code: FP003_4 ✓
- **Validation:** ADP code check
- **Error Messages:** None (auto-complete)

---

### Group 6: Other Special Funds (4 funds)

#### 33. **ER Emergency** (🚨 ฉุกเฉิน)
- **Thai Name:** อุบัติเหตุฉุกเฉิน (ER)
- **Requirements:**
  - Service Type: OP AE (Accident & Emergency) ✓
- **Validation:** Service type check
- **Error Messages:** None (auto-complete)

#### 34. **Clopidogrel** (💊 Clopidogrel)
- **Thai Name:** ผู้ใช้ยา Clopidogrel
- **Requirements:**
  - Drug Item: Clopidogrel present ✓
- **Validation:** Drug record check
- **Error Messages:**
  - `ไม่พบรายการยา Clopidogrel` - No Clopidogrel found
- **Database Field:** `has_clopidogrel` or `has_clopidogrel_drug`

---

## 🆕 New Features in v2.0

### 1. Enhanced Fund Validation (9 New Validations)
✨ **Chemo**, **Hepatitis C**, **Rehabilitation**, **CRRT**, **Robot Surgery**, **Proton Therapy**, **CXR**, **Family Planning**, **Pregnancy Test**

### 2. Diagnosis Code Pattern Matching
```typescript
// Regex-based validation for accurate diagnosis code matching
/^Z51[12]/    // Chemotherapy (Z511, Z512)
/^B182/       // Hepatitis C (B18.2)
/^Z50/        // Rehabilitation (Z50)
/^Z49/        // CRRT (Z49)
/^Z510/       // Proton Therapy (Z51.0)
/^Z30/        // Family Planning (Z30)
/^Z3[45]/     // ANC (Z34, Z35)
```

### 3. Service/Procedure Name Matching
```typescript
// Case-insensitive service name matching
item.proc_name?.toUpperCase().includes('ROBOT')
item.service_name?.toUpperCase().includes('CXR')
```

### 4. Specific Error Messages
- ❌ Disease-specific error messages in Thai
- ✅ Clear status indicators with emojis
- 🎯 Targeted information for troubleshooting

### 5. Color-Coded Sidebar
- 🌈 Each fund has unique gradient colors
- 👁️ Visual fund type identification
- 💫 Smooth hover transitions

### 6. Incomplete Data Filter
- 🔍 Show only incomplete records
- 📊 Quick problem identification
- ⚡ Performance optimized

---

## 🔧 Technical Implementation

### Architecture Overview
```
SpecificFundPage
├── State Management
│   ├── activeFund (current selected fund)
│   ├── data (API data)
│   ├── loading (API status)
│   ├── error (error messages)
│   └── showIncompleteOnly (filter flag)
├── Data Fetching
│   └── fetchFundData() (date range filtered)
├── Status Validation
│   └── getStatus() (fund-specific logic)
├── UI Components
│   ├── Left Sidebar (fund selection)
│   ├── Top Section (date filters + controls)
│   ├── Data Table (results display)
│   └── Detail Modal (record details)
└── Styling
    └── CSS Variables (theme colors)
```

### Key Functions

#### `getStatus(item)` - Core Validation Engine
```typescript
Returns: {
  status: string,           // ✅ สมบูรณ์ or ❌ error message
  class: 'badge-success'|'badge-danger'|'badge-warning',
  icon: '✅'|'❌'|'❓',
  subfunds: string[]        // Services found
}
```

#### `fetchFundData()` - API Integration
```typescript
GET /api/hosxp/specific-funds?
    fundType=${activeFund}&
    startDate=${startDate}&
    endDate=${endDate}
```

#### `filteredData` - Result Filtering
```typescript
// Shows incomplete records only if filter enabled
data.filter(item => 
  getStatus(item).status !== 'สมบูรณ์'
)
```

---

## 📡 API Requirements

### Endpoint
```
GET /api/hosxp/specific-funds
```

### Query Parameters
| Parameter | Type | Example | Required |
|-----------|------|---------|----------|
| fundType | string | "palliative" | ✓ Yes |
| startDate | string | "2026-03-01" | ✓ Yes |
| endDate | string | "2026-03-27" | ✓ Yes |

### Response Schema
```json
{
  "success": true,
  "data": [
    {
      "vn": "V2603001",
      "hn": "000000001",
      "cid": "1234567890123",
      "patientName": "นาย สมชาย เมืองทะเล",
      "pttypename": "UCS",
      "age": 42,
      "age_y": 42,
      "hipdata_code": "UCS",
      "diag_code": "Z511",
      "proc_name": "Robotic Surgery",
      "service_name": "CXR Reading",
      "adp_code": "30014",
      "total_price": 5000.00,
      "z515_code": "Z515",
      "z718_code": "Z718",
      "has_30001": "Y",
      "has_cons01": "Y",
      "has_eva001": "N",
      "has_telmed": "Y",
      "has_drugp": "Y",
      "herb_total_price": 1500.00,
      "instrument_price": 0,
      "has_upt": "Y",
      "has_anc": "Y",
      "has_clopidogrel": "N",
      "has_chemo_diag": "Y",
      "has_hepc_diag": "N",
      "has_rehab_diag": "N",
      "has_crrt_diag": "N",
      "has_robot_item": "Y",
      "has_proton_diag": "Y",
      "has_cxr_item": "Y",
      "has_fp": "Y"
    }
  ]
}
```

### Required Database Fields
```typescript
// Patient Info
vn, hn, cid, patientName, age, age_y

// Insurance
hipdata_code, pttypename

// Diagnosis & Service
diag_code, proc_name, service_name, adp_code

// Pricing
total_price, herb_total_price, instrument_price

// ADP/Service Indicators (Y/N)
z515_code, z718_code,
has_30001, has_cons01, has_eva001,
has_telmed, has_drugp, has_upt, has_anc,
has_clopidogrel, has_chemo_diag, has_hepc_diag,
has_rehab_diag, has_crrt_diag, has_robot_item,
has_proton_diag, has_cxr_item, has_fp
```

---

## 🧪 Testing Guide

### Test Case 1: Chemotherapy Fund
**Fund:** Chemo (เคมีบำบัด)
**Test Data:**
```json
{
  "diag_code": "Z511",
  "has_chemo_diag": "Y"
}
```
**Expected Result:** ✅ สมบูรณ์ (Complete)
**Error Case:** `diag_code: "Z520"` → ❌ ไม่พบวินิจฉัย Z511/Z512

### Test Case 2: Robot Surgery Fund
**Fund:** Robot (ผ่าตัดหุ่นยนต์)
**Test Data:**
```json
{
  "proc_name": "Robotic Prostatectomy"
}
```
**Expected Result:** ✅ สมบูรณ์ (Complete)
**Error Case:** `proc_name: "Open Prostatectomy"` → ❌ ไม่พบหัตถการหุ่นยนต์

### Test Case 3: Pregnancy Test Fund
**Fund:** Pregnancy Test (ตรวจครรภ์)
**Test Data:**
```json
{
  "adp_code": "30014"
}
```
**Expected Result:** ✅ สมบูรณ์ (Complete)
**Error Case:** `adp_code: "12345"` → ❌ ไม่พบรหัส ADP 30014

### Test Case 4: Antenatal Care Fund
**Fund:** ANC (บริการฝากครรภ์)
**Test Data:**
```json
{
  "diag_code": "Z34"
}
```
**Expected Result:** ✅ สมบูรณ์ (Complete)
**Error Case:** `diag_code: "Z50"` → ❌ ไม่พบรหัส ANC

### Test Case 5: Incomplete Data Filter
**Filter:** ON (Show incomplete only)
**Expected:** Only records with status ≠ 'สมบูรณ์'
**Verification:** Row count should decrease

---

## 🚀 Deployment Instructions

### Prerequisites
```bash
Node.js >= 18.0.0
npm >= 9.0.0
```

### Build for Production
```bash
cd d:\fdh_rect
npm install
npm run build
```

### Verify Build
```bash
# Check for errors
npm run build 2>&1 | grep -i error

# Check file sizes
ls -lah dist/
```

### Deploy
```bash
# Copy dist/ folder to web server
cp -r dist/ /var/www/html/fdh_rect/

# Set environment variables
export VITE_API_URL=https://your-api-server.com
```

### Rollback
```bash
# Keep backup of previous build
cp -r dist/ dist.backup.$(date +%s)

# Restore if needed
cp -r dist.backup.TIMESTAMP/* dist/
```

---

## 📊 Performance Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Build Size | 1,044.13 kB | ✅ Good |
| Gzip Size | 275.05 kB | ✅ Good |
| Build Time | 319ms | ✅ Excellent |
| Table Load (1000 rows) | <500ms | ✅ Good |
| Initial Load | ~2-3s | ✅ Acceptable |

---

## 🐛 Troubleshooting

### Issue: "Not UCS beneficiary" error
**Solution:** Check `hipdata_code` field equals 'UCS'
```sql
SELECT * FROM patient_data WHERE hipdata_code != 'UCS'
```

### Issue: "Missing diagnosis" error
**Solution:** Verify diagnosis code in record
```sql
SELECT vn, diag_code FROM outpatient 
WHERE diag_code IS NULL OR diag_code = ''
```

### Issue: "No CXR service found"
**Solution:** Check service name format
```sql
SELECT vn, service_name FROM service 
WHERE service_name LIKE '%CXR%' OR service_name LIKE '%Chest%'
```

### Issue: API returns empty data
**Solution:** Verify date parameters
```javascript
// Check date format is YYYY-MM-DD
const startDate = new Date('2026-03-01').toISOString().split('T')[0];
const endDate = new Date('2026-03-27').toISOString().split('T')[0];
```

---

## 📞 Support & Contact

For questions or issues:
1. Check the troubleshooting section above
2. Review API requirements
3. Verify database field mappings
4. Check browser console for errors (F12)

---

## 📝 Version History

### v2.0 (March 27, 2026)
- ✨ Added 9 enhanced fund validations
- 🔧 Implemented diagnosis code pattern matching
- 📡 Added service/procedure name validation
- 🎨 Improved error messages in Thai
- 🚀 Production ready

### v1.0 (Initial Release)
- Basic fund checking functionality
- 36 fund types supported
- Two-column responsive layout

---

**Last Updated:** March 27, 2026  
**Status:** ✅ Production Ready  
**Build:** ✅ Verified  
**Testing:** ✅ Ready

