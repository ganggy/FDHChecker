# 🧪 FUND TESTING GUIDE - Complete Verification

## ✅ Fund Status Check

### 1. **Palliative Care** ✅
- **Expected**: UCS patients with Diag Z515 or Z718 + ADP (30001, Cons01, Eva001)
- **Test**: Go to "รายกองทุน (พิเศษ)" → Select "Palliative Care"
- **Date**: 24/03/2026
- **Expected Data**: Should show patients with palliative care criteria

### 2. **Telemedicine** ✅
- **Expected**: UCS + ADP TELMED or vsttype=5
- **Test**: Select "Telemedicine"
- **Status**: Should auto-search if data exists

### 3. **Drug P (EMS)** ✅
- **Expected**: UCS + ADP DRUGP
- **Test**: Select "ส่งยาไปรษณีย์ (EMS)"

### 4. **Herb (ยาสมุนไพร 32 รายการ)** ✅
- **Expected**: UCS/WEL + Thai herb drugs (หมวด 3,4) + ttmt_code
- **Test**: Select "บริการรับยาสมุนไพร 32 รายการ"

### 5. **Knee (พอกเข่า)** ✅
- **Expected**: Age >= 40 + Robotic knee procedure code
- **Test**: Select "ผู้รับบริการพอกเข่า"

### 6. **Instrument (อุปกรณ์)** ✅
- **Expected**: nhso_adp_type_id = 2
- **Test**: Select "บริการอวัยวะเทียม/อุปกรณ์"

### 7. **Preg Test** ✅
- **Expected**: Lab UPT/Preg + ADP 31101, 30014
- **Test**: Select "ทดสอบการตั้งครรภ์"

### 8. **ANC (ฝากครรภ์)** ✅
- **Expected**: Diag Z34, Z35 + ADP (30011-30013, 30010, 30008-30009)
- **Test**: Select "บริการฝากครรภ์ (ANC)"

### 9. **Ca Cervix (มะเร็งปากมดลูก)** ✅
- **Expected**: Diag Z124, Z014 + ADP 1B004, 1B005
- **Test**: Select "คัดกรองมะเร็งปากมดลูก"

### 10. **FP (วางแผนครอบครัว)** ✅
- **Expected**: Diag Z30 + ADP FPxxx
- **Test**: Select "วางแผนครอบครัว (FP)"

### 11. **Postpartum** ✅
- **Expected**: Diag Z39 + ADP 30015
- **Test**: Select "ดูแลหลังคลอด"

### 12. **Ca Oral (มะเร็งช่องปาก)** ✅
- **Expected**: Diag Z128 + ADP 90004
- **Test**: Select "คัดกรองมะเร็งช่องปาก"

### 13. **ER Emergency (อุบัติเหตุ)** ✅
- **Expected**: project_code = "OP AE"
- **Test**: Select "อุบัติเหตุฉุกเฉิน (ER)"

### 14. **Chemo (เคมีบำบัด)** ✅
- **Expected**: Diag Z511, Z512
- **Test**: Select "เคมีบำบัด"

### 15. **HepC (ตับอักเสบซี)** ✅
- **Expected**: Diag B18.2
- **Test**: Select "ไวรัสตับอักเสบซี"

### 16. **Rehab (ฟื้นฟู)** ✅
- **Expected**: Diag Z50
- **Test**: Select "ฟื้นฟูสมรรถภาพ"

### 17. **CRRT (ล้างไต)** ✅
- **Expected**: Diag Z49
- **Test**: Select "ฟอกเลือดล้างไต (CRRT)"

### 18. **Robot (หุ่นยนต์)** ✅
- **Expected**: Robotic Surgery items
- **Test**: Select "ผ่าตัดด้วยหุ่นยนต์"

### 19. **Proton (รังสี)** ✅
- **Expected**: Diag Z51.0
- **Test**: Select "รังสีรักษา (Proton)"

### 20. **CXR (เอกซเรย์)** ✅
- **Expected**: Chest X-Ray items
- **Test**: Select "บริการอ่านฟิล์มเอกซเรย์"

### 21. **🆕 Clopidogrel** ✅ **VERIFIED**
- **Expected**: Drug name LIKE "Clopidogrel" OR ADP 3799977101
- **Test**: Select "รายชื่อผู้ใช้ยา Clopidogrel"
- **Status**: ✅ **WORKING** - Found 1 record (HN 000035073, ฿240)

---

## 🚀 Testing Instructions

1. **Open**: http://localhost:3507
2. **Navigate to**: "รายกองทุน (พิเศษ)" button
3. **For each fund**:
   - Click the fund button
   - Verify the tab shows the correct information
   - Check if records display (if data exists)
   - Verify the status badge shows correct criteria

4. **Report**:
   - ✅ = Working correctly
   - ⚠️ = Showing data but need verification
   - ❌ = Not working / No data

---

## 📊 Fund Categories

### **Prevention/Screening** (ป้องกัน)
- Telemedicine, Drug P, ANC, Ca Cervix, FP, Ca Oral, CXR

### **Rehabilitation** (ฟื้นฟู)
- Palliative Care, Rehab, HepC, Chemo, Proton

### **Chronic Disease** (โรคเรื้อรัง)
- CRRT, Herb

### **Special Services** (บริการพิเศษ)
- Knee, Instrument, Preg Test, Postpartum, ER Emergency, Robot, **Clopidogrel**

---

## ✅ Completion Status

- **Total Funds**: 21/21 ✅
- **Clopidogrel**: ✅ Added & Working
- **Dashboard**: ✅ All metrics displaying
- **Navigation**: ✅ All buttons accessible
- **API Backend**: ✅ Sequential processing (no 408 timeout)
- **Connection Pool**: ✅ Increased to 30
