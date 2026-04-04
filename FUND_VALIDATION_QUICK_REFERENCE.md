# ⚡ Quick Reference - Fund Validation Rules

## 🎯 Fund Type Lookup Table

| ID | Icon | Fund Name (EN) | Fund Name (TH) | Status Validation | Database Check |
|----|------|----------------|----------------|------------------|-----------------|
| 1 | 🕊️ | Palliative Care | Palliative Care | UCS + Z515/Z718 + ADP | hipdata_code, diag_code, has_30001 |
| 2 | 📱 | Telemedicine | Telemedicine | UCS + TELMED | hipdata_code, has_telmed |
| 3 | 📦 | Drug by Post | ส่งยาไปรษณีย์ | UCS + DRUGP | hipdata_code, has_drugp |
| 4 | 🌿 | Herb Medicine | สมุนไพร | UCS/WEL + Price > 0 | hipdata_code, herb_total_price |
| 5 | 🦵 | Knee Implant | พอกเข่า | Age >= 40 | age_y |
| 6 | 🦾 | Prosthetic | อวัยวะเทียม | Price > 0 | instrument_price |
| 7 | 🧪 | Chemotherapy | เคมีบำบัด | Diag: Z511/Z512 | diag_code |
| 8 | 🩹 | Hepatitis C | ไวรัสตับอักเสบซี | Diag: B18.2 | diag_code |
| 9 | ♿ | Rehabilitation | ฟื้นฟูสมรรถภาพ | Diag: Z50 | diag_code |
| 10 | 🏥 | CRRT | ฟอกเลือด | Diag: Z49 | diag_code |
| 11 | 🤖 | Robot Surgery | ผ่าตัดหุ่นยนต์ | Proc contains "ROBOT" | proc_name |
| 12 | ⚛️ | Proton Therapy | รังสีรักษา | Diag: Z51.0 | diag_code |
| 13 | 🎀 | Ca Cervix | คัดกรองปากมดลูก | Diag: Z124/Z014 | diag_code |
| 14 | 🦷 | Oral Cancer | คัดกรองช่องปาก | ADP: 90004 | adp_code |
| 15 | 🩻 | Chest X-ray | อ่านฟิล์ม CXR | Service contains "CXR" | service_name |
| 16 | 👶 | Antenatal Care | บริการฝากครรภ์ | Diag: Z34/Z35 | diag_code |
| 17 | 👩‍⚕️ | ANC Visit | ANC Visit (30011) | ADP: 30011 | adp_code |
| 18 | 🔊 | ANC Ultrasound | ANC US (30010) | ADP: 30010 | adp_code |
| 19 | 🧬 | ANC Lab 1 | ANC Lab 1 (30012) | ADP: 30012 | adp_code |
| 20 | 🧪 | ANC Lab 2 | ANC Lab 2 (30013) | ADP: 30013 | adp_code |
| 21 | 🧪 | Pregnancy Test | ตรวจครรภ์ (30014) | ADP: 30014 | adp_code |
| 22 | 🤱 | Postnatal Care | ตรวจหลังคลอด | ADP: 30015 | adp_code |
| 23 | 💊 | Postnatal Supp | เสริมธาตุเหล็ก | ADP: 30016 | adp_code |
| 24 | 🤱 | Postpartum | หญิงหลังคลอด | Diag: Z39 | diag_code |
| 25 | 🩸 | FPG Screening | คัดกรองเบาหวาน | Age 35-59 + ADP:12003 | age_y, adp_code |
| 26 | 🧪 | Cholesterol | คัดกรองไขมัน | Age 45-59 + ADP:12004 | age_y, adp_code |
| 27 | 🩸 | Anemia Screen | คัดกรองโลหิตจาง | Age 13-24 + ADP:13001 | age_y, adp_code |
| 28 | 💊 | Iron Suppl | เสริมธาตุเหล็ก | Age 13-45 + ADP:14001 | age_y, adp_code |
| 29 | 🦷 | Fluoride | เคลือบฟลูออไรด์ | Age 25-59 + ADP:15001 | age_y, adp_code |
| 30 | 💊 | Family Plan | ครอบครัววางแผน | Diag: Z30 | diag_code |
| 31 | 💊 | Contraceptive | ยาคุมกำเนิด | ADP: FP003_1/2 | adp_code |
| 32 | 🛡️ | Condom | ถุงยางอนามัย | ADP: FP003_4 | adp_code |
| 33 | 🚨 | ER Emergency | ฉุกเฉิน | Service: OP AE | service_type |
| 34 | 💊 | Clopidogrel | ยา Clopidogrel | Drug present | has_clopidogrel |

---

## 🔍 Diagnosis Code Patterns

```javascript
// Regex patterns for diagnosis validation
Z511/Z512:    /^Z51[12]/    // Chemotherapy
B18.2:        /^B182/       // Hepatitis C
Z50:          /^Z50/        // Rehabilitation
Z49:          /^Z49/        // CRRT/Dialysis
Z51.0:        /^Z510/       // Proton Therapy
Z30:          /^Z30/        // Family Planning
Z34-Z35:      /^Z3[45]/     // Antenatal
Z39:          /^Z39/        // Postpartum
Z124/Z014:    /^Z(124|014)/ // Ca Cervix
Z128:         /^Z128/       // Oral Cancer
```

---

## ✅ Status Flow Diagram

```
┌─────────────────────────────────┐
│   Fetch Patient Data            │
│   by Fund & Date Range          │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   For Each Patient Record       │
│   Call getStatus(item)          │
└──────────────┬──────────────────┘
               │
               ▼
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────────────┐  ┌──────────────────┐
│ All Conditions  │  │ Missing Required │
│ Met?            │  │ Condition?       │
│                 │  │                  │
│ YES ✅          │  │ YES ❌           │
└────────┬────────┘  └────────┬─────────┘
         │                    │
         ▼                    ▼
    ✅ สมบูรณ์         ❌ [Error Message]
    badge-success      badge-danger
```

---

## 📋 SQL Query Templates

### Check UCS Beneficiaries
```sql
SELECT vn, hn, patientName, hipdata_code 
FROM patient_data 
WHERE hipdata_code = 'UCS'
ORDER BY vn DESC
```

### Check Diagnosis Codes
```sql
SELECT vn, hn, diag_code 
FROM outpatient 
WHERE diag_code REGEXP '^Z51[12]'  -- Chemotherapy
   OR diag_code REGEXP '^B182'      -- Hepatitis C
   OR diag_code REGEXP '^Z50'       -- Rehabilitation
ORDER BY vn DESC
```

### Check ADP Codes
```sql
SELECT vn, adp_code, COUNT(*) as count
FROM service_adp
WHERE adp_code IN ('30014', '30011', '30010', '12003', '12004')
GROUP BY vn, adp_code
ORDER BY vn DESC
```

### Check Procedure Names
```sql
SELECT vn, proc_name
FROM operation
WHERE proc_name LIKE '%ROBOT%'
   OR proc_name LIKE '%robotic%'
ORDER BY vn DESC
```

### Check Service Names
```sql
SELECT vn, service_name
FROM service
WHERE service_name LIKE '%CXR%'
   OR service_name LIKE '%Chest X-ray%'
ORDER BY vn DESC
```

---

## 🔑 Key API Response Fields

### Insurance Fields
- `hipdata_code` - Insurance code (UCS, SSS, etc.)
- `pttypename` - Patient type name

### Patient Info
- `vn` - Visit number (ลำดับการตรวจ)
- `hn` - Hospital number (เลขประจำตัวผู้รับบริการ)
- `cid` - Citizen ID (เลขบัตรประชาชน)
- `patientName` - Full name
- `age`, `age_y` - Age in years

### Clinical Data
- `diag_code` - ICD-10 diagnosis code
- `proc_name` - Procedure/Operation name
- `service_name` - Service description
- `adp_code` - ADP service code

### Financial Data
- `total_price` - Total service cost
- `herb_total_price` - Herbal medicine cost
- `instrument_price` - Prosthetic/instrument cost

### Service Indicators (Y/N Flags)
- `has_telmed` - Telemedicine service
- `has_drugp` - Drug by post service
- `has_upt` - Pregnancy test
- `has_anc` - Antenatal care
- `has_clopidogrel` - Clopidogrel drug
- `has_chemo_diag` - Chemo diagnosis
- `has_hepc_diag` - Hepatitis C diagnosis
- `has_rehab_diag` - Rehabilitation diagnosis
- `has_crrt_diag` - CRRT diagnosis
- `has_robot_item` - Robot surgery procedure
- `has_proton_diag` - Proton therapy diagnosis
- `has_cxr_item` - CXR service
- `has_fp` - Family planning

---

## 🎨 Status Badge Colors

```css
badge-success  /* ✅ สมบูรณ์ - Green #16a34a */
badge-danger   /* ❌ Missing - Red #dc2626 */
badge-warning  /* ❓ Unknown - Orange #d97706 */
badge-primary  /* ℹ️ Info - Blue #2563eb */
```

---

## 🔄 Fund Validation Flow (TypeScript)

```typescript
// Example: Check Chemotherapy
if (activeFund === 'chemo') {
  // Check 1: Has diagnosis Z511 or Z512?
  const hasChemoDiag = 
    item.has_chemo_diag === 'Y' || 
    item.diag_code?.match(/^Z51[12]/);
  
  if (hasChemoDiag) {
    // Success: Add to subfunds and return complete
    subfunds.push('🧪 เคมีบำบัด');
    return { 
      status: 'สมบูรณ์', 
      class: 'badge-success', 
      icon: '✅', 
      subfunds 
    };
  }
  
  // Failure: Return specific error
  return { 
    status: 'ไม่พบวินิจฉัย Z511/Z512', 
    class: 'badge-danger', 
    icon: '❌', 
    subfunds: [] 
  };
}
```

---

## 📱 UI Component Layout

```
┌─────────────────────────────────────────────┐
│              NAVBAR                         │
├──────────┬──────────────────────────────────┤
│          │                                  │
│  SIDEBAR │   CONTENT AREA                   │
│  (240px) │  ┌──────────────────────────┐   │
│          │  │ Date Filters & Controls  │   │
│ Palliative   │ ├─ Start Date          │   │
│ Telemedicine │ ├─ End Date            │   │
│ Drug...      │ ├─ Fetch Button        │   │
│ Herb         │ └─ Filter Toggle       │   │
│ Knee         └──────────────────────────┘   │
│ ...          ┌──────────────────────────┐   │
│              │  DATA TABLE              │   │
│              │ ├─ # | VN | Name | Age  │   │
│              │ ├─────────────────────   │   │
│              │ │ 1 │ 001│ สมชาย│ 45   │   │
│              │ │ 2 │ 002│ ธีรา │ 38   │   │
│              │ │...│...│......│ ..   │   │
│              └──────────────────────────┘   │
└──────────────────────────────────────────────┘
```

---

## 🚀 Developer Checklist

- [ ] API endpoint working and returning data
- [ ] Database fields mapped correctly
- [ ] Diagnosis codes in correct format (Z511 not Z51-1)
- [ ] Age fields populated (age_y)
- [ ] Insurance codes present (hipdata_code)
- [ ] ADP codes in adp_code field
- [ ] Procedure names capitalized (ROBOT not robot)
- [ ] Service names match expected format (CXR or Chest X-ray)
- [ ] Testing with incomplete records
- [ ] Testing with complete records
- [ ] Verify UI displays correctly
- [ ] Check browser console for errors
- [ ] Test date range filtering
- [ ] Test incomplete data filter toggle

---

## 📞 Common Integration Issues

| Issue | Solution |
|-------|----------|
| Data not loading | Check API endpoint and date format (YYYY-MM-DD) |
| Wrong status showing | Verify diagnosis code format matches regex |
| Missing records | Check date range and fund type mapping |
| UI not updating | Check browser console for React errors |
| Slow loading | Consider pagination for large datasets |

---

**Last Updated:** March 27, 2026  
**Compatibility:** React 18+, TypeScript 5+  
**Node Version:** 18.0.0+

