# 🧪 FDH Rect - TESTING PHASE GUIDE

**Date:** March 24, 2026  
**Status:** Backend ✅ Running on Port 3001  
**Database:** ✅ Connected (6772 tables, 10231 records)  
**Project:** FDH Checker System (95% Complete)

---

## 📊 CURRENT SYSTEM STATUS

### Backend Server ✅
```
Status:        RUNNING
Port:          3001
Endpoint:      http://localhost:3001/api
Database:      CONNECTED
Database Type: HOSxP (MySQL/Oracle)
Tables Found:  6772
Recent Data:   10231 records
Mode:          REAL DATABASE DATA
```

### Frontend Server ⏳
```
Status:        PENDING
Port:          3507 (configured)
Type:          React + Vite
Build Time:    ~30-60 seconds (first time)
```

---

## 🚀 STEP 1: START FRONTEND SERVER

Open a **new terminal** and run:

```bash
cd d:\react\fdh_rect
npm run dev
```

**Expected output:**
```
VITE v5.x.x  ready in 45ms

➜  Local:   http://localhost:3507/
➜  press h + enter to show help
```

**Wait for:** "ready in X ms" message

---

## 🌐 STEP 2: OPEN IN BROWSER

Once Frontend shows "ready in X ms", open your browser:

```
👉 http://localhost:3507
```

### Expected to See:
- ✅ Page loads without errors
- ✅ Navigation menu visible
- ✅ No red error messages
- ✅ Browser console clean (F12)

---

## 🧪 STEP 3: CORE FEATURES TESTING

### Test 1: Check Drug Data Display
**Purpose:** Verify no mock data shown when DB has no records

**Steps:**
1. Navigate to OPD section or prescription page
2. Look for patient with no drugs (VN: 690323000158)
3. Should show: "ไม่มีข้อมูลยา" (No drug data)
4. Should NOT show: Fake/mock data

**Expected:** ✅ Correct message displayed

**Actual:** [ ] Pass / [ ] Fail / [ ] Pending

---

### Test 2: Summary Cards Position
**Purpose:** Verify summary cards appear in correct location

**Steps:**
1. Go to "รายการมอนิเตอร์พิเศษ" (Special Monitor page)
2. Check summary cards location
3. Should be AFTER Header, BEFORE Monitor Category Menu
4. Cards should display: Summary data

**Expected:** ✅ Cards in correct position

**Actual:** [ ] Pass / [ ] Fail / [ ] Pending

---

### Test 3: Navigation & UI
**Purpose:** Verify overall UI renders correctly

**Steps:**
1. Check all navigation menu items
2. Try clicking different sections
3. Verify pages load without errors
4. Check responsive design

**Expected:** ✅ Smooth navigation, no errors

**Actual:** [ ] Pass / [ ] Fail / [ ] Pending

---

### Test 4: Browser Console Check
**Purpose:** Verify no JavaScript errors

**Steps:**
1. Press `F12` to open DevTools
2. Check Console tab
3. Should be CLEAN (no red error messages)
4. May have some warnings (OK)

**Expected:** ✅ No errors in console

**Actual:** [ ] Pass / [ ] Fail / [ ] Pending

---

## 📤 STEP 4: 16-FILE EXPORT TESTING

### Test 5: Export Function
**Purpose:** Test 16-file FDH export system

**Steps:**
1. Find FDH Export section in application
2. Click "Export to ZIP" button
3. Select patient(s) to export
4. Wait for ZIP generation
5. Check if file downloads

**Expected:** ✅ ZIP file downloaded

**Actual:** [ ] Pass / [ ] Fail / [ ] Pending

---

### Test 6: Verify All 16 Files
**Purpose:** Ensure all export files are included

**Steps:**
1. Extract downloaded ZIP file
2. Count files inside
3. Should have exactly **16 files**:
   - INS (Insurance)
   - PAT (Patient)
   - OPD (OPD Visit)
   - ORF (OPD Referral)
   - ODX (OPD Diagnosis)
   - OOP (OPD Operations)
   - IPD (IPD Visit)
   - IRF (IPD Referral)
   - IDX (IPD Diagnosis)
   - IOP (IPD Operations)
   - CHT (Chart)
   - CHA (Chart Admission)
   - AER (Emergency)
   - ADP (Admit/Discharge)
   - LVD (Lab Values)
   - DRU (Drug/Prescription)

**Expected:** ✅ All 16 files present

**Actual:** [ ] Files: ___ / 16

---

### Test 7: File Data Accuracy
**Purpose:** Verify data in export files is correct

**Steps:**
1. Open one of the exported files
2. Check data format (should be CSV/TXT)
3. Verify data matches patient info
4. Check for corruption or errors

**Expected:** ✅ Data is valid and correct

**Actual:** [ ] Pass / [ ] Fail / [ ] Pending

---

## 📊 API ENDPOINT TESTING

### Test 8: Backend API - Drug Data
**Purpose:** Verify API returns correct drug data

**Command:**
```bash
# Test with VN that HAS drugs
curl http://localhost:3001/api/hosxp/prescriptions/690323000001

# Test with VN that HAS NO drugs
curl http://localhost:3001/api/hosxp/prescriptions/690323000158
```

**Expected Response:**
- With data: Array of drug objects
- No data: Empty array `[]`
- NO mock/fake data

**Actual Response:** [ ] Correct / [ ] Error / [ ] Pending

---

### Test 9: Backend API - Export Endpoint
**Purpose:** Test export ZIP generation API

**Command:**
```bash
curl http://localhost:3001/api/fdh/export-zip \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"vns": ["690323000001", "690323000158"]}'
```

**Expected:** ZIP file with 16 files

**Actual:** [ ] Success / [ ] Error / [ ] Pending

---

## 🎯 NEXT ACTIONS

### Immediate (Now - 60 minutes)
- [ ] Start Frontend server
- [ ] Run all tests
- [ ] Document results
- [ ] Fix issues if any

### Time Estimate
- Frontend startup: 1-2 minutes
- Core tests: 15 minutes
- Export tests: 15 minutes
- API tests: 10 minutes
- **Total: ~45-60 minutes**

---

**Status:** Ready for Testing  
**Backend:** ✅ Running on 3001  
**Next:** Start Frontend and begin testing