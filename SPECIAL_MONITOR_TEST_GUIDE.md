# Special Monitor Page - Testing Guide

## Test Environment Setup

### Prerequisites
- Node.js 18+
- React 18+
- Backend database connection to HOSxP
- Ports 3510 (frontend) and 3001 (backend) available

### Start the Application

**Terminal 1 - Frontend**:
```powershell
cd d:\react\fdh_rect
npm run dev
```
Expected output: `Local: http://localhost:3510/`

**Terminal 2 - Backend**:
```powershell
cd d:\react\fdh_rect\server
npm run start
```
Expected output: `Server running on port 3001`

---

## Test Cases

### Test 1: Page Navigation
**Objective**: Verify the Special Monitor page is accessible from navigation

**Steps**:
1. Open http://localhost:3510 in browser
2. Look for navigation bar with buttons
3. Find and click the "📊 รายการมอนิเตอร์พิเศษ" button

**Expected Results**:
- ✓ Page loads without errors
- ✓ Header displays "📊 รายการมอนิเตอร์พิเศษ"
- ✓ Description shows "ตรวจสอบการเบิกจ่ายสำหรับกลุ่มผู้ป่วยพิเศษ"

**Pass/Fail**: _______________

---

### Test 2: Monitor Category Selection
**Objective**: Verify monitor category menu works correctly

**Steps**:
1. On Special Monitor page, view the three category cards:
   - 🏥 หน่วยไต (N185)
   - 🩺 โรคเรื้อรัง (NCD)
   - ⭐ สิทธิพิเศษ

2. Verify Kidney (หน่วยไต) is selected by default
3. Click on "โรคเรื้อรัง (NCD)" card
4. Click on "สิทธิพิเศษ" card
5. Click back on "หน่วยไต (N185)" card

**Expected Results**:
- ✓ Kidney category is selected by default (blue border)
- ✓ Clicking NCD shows "🚧 โรคเรื้อรัง (NCD) - ยังไม่พร้อมใช้งาน (Coming Soon)"
- ✓ Clicking Special Rights shows "🚧 สิทธิพิเศษ - ยังไม่พร้อมใช้งาน (Coming Soon)"
- ✓ Clicking back to Kidney shows the full interface
- ✓ Active category has blue highlight and shadow

**Pass/Fail**: _______________

---

### Test 3: Summary Cards Display
**Objective**: Verify summary statistics cards display correctly

**Steps**:
1. Ensure Kidney monitor is selected
2. Scroll to see the summary cards section
3. Observe the four summary cards

**Expected Results**:
- ✓ Card 1: "เคส UCS + SSS" (Blue background #e3f2fd)
  - Shows count of UCS+SSS cases
  - Text: "เบิก 1,380 บาท"
- ✓ Card 2: "เคส OFC + LGO" (Purple background #f3e5f5)
  - Shows count of OFC+LGO cases
  - Text: "เบิก 1,380 บาท"
- ✓ Card 3: "UC - EPO จริง" (Orange background #fff3e0)
  - Shows count of UC-EPO cases
  - Text: "เบิก 180 บาท"
- ✓ Card 4: "รวมกำไรทั้งหมด" (Green background #e8f5e9)
  - Shows total profit in Baht
  - Text shows "บาท" label

**Pass/Fail**: _______________

---

### Test 4: Cost Breakdown Visualization
**Objective**: Verify cost breakdown bars display correctly with proper colors

**Steps**:
1. Scroll to "📊 รายละเอียดค่าใช้ (ต่อเคส)" section
2. Examine each breakdown bar

**Expected Results**:

**UCS + SSS Section**:
- ✓ Header: "💙 UCS + SSS (รวม 1,500 บาท → เบิก 1,380 บาท)"
- ✓ Bar shows three sections:
  - Purple section: "บริการ 525฿" (35%)
  - Cyan section: "ยา 525฿" (35%)
  - Pink section: "แลป 450฿" (30%)
- ✓ Info text: "เบิก: ค่าบริการ 1,380฿ | ผลประโยชน์: 120฿"

**OFC + LGO Section**:
- ✓ Header: "💜 OFC + LGO (รวม 2,000 บาท → เบิก 1,380 บาท)"
- ✓ Bar shows three sections:
  - Amber section: "บริการ 700฿"
  - Purple section: "ยา 650฿"
  - Teal section: "แลป 650฿"
- ✓ Info text: "เบิก: ค่าบริการ 1,380฿ | ผลประโยชน์: 620฿"

**UC - EPO Section**:
- ✓ Header: "🟠 UC - EPO จริง (รวม 180 บาท)"
- ✓ Bar shows three sections:
  - Red section: "ยา EPO 60฿"
  - Orange section: "แลป 50฿"
  - Yellow section: "บริการ 70฿"
- ✓ Info text: "เบิก: EPO 60 + แลป 50 + บริการ 70 = 180฿ (ไม่มีกำไร)"

**Pass/Fail**: _______________

---

### Test 5: Filter Controls Display
**Objective**: Verify filter control section is present and accessible

**Steps**:
1. Scroll to filter section below cost breakdown
2. Observe the filter controls

**Expected Results**:
- ✓ Four input/select controls visible
- ✓ Label 1: "📅 วันเริ่มต้น:" with date input (default: today's date)
- ✓ Label 2: "📅 วันสิ้นสุด:" with date input (default: today's date)
- ✓ Label 3: "🏷️ สิทธิ์:" with select dropdown
  - Options: ทั้งหมด, UCS + SSS (1,500), OFC + LGO (2,000), UC - EPO จริง (180)
- ✓ Label 4: "📦 หมวดบริการ:" with select dropdown
  - Options: ทั้งหมด, หน่วยไต (ค่าบริการ), ยา + แลป + บริการ
- ✓ "🔄 รีโหลด" button at the bottom

**Pass/Fail**: _______________

---

### Test 6: Data Loading
**Objective**: Verify data loads from backend API

**Steps**:
1. Click "🔄 รีโหลด" button
2. Wait for 2-3 seconds
3. Check if data appears in table below filters

**Expected Results**:
- ✓ Loading state shows "⏳ กำลังโหลดข้อมูล..."
- ✓ Loading state disappears after data loads
- ✓ One of the following appears:
  - Data table with patient records (if data exists)
  - "📭 ไม่มีข้อมูลตรงตามเงื่อนไขที่คัดกรอง" message (if no data)
  - Error message if connection fails

**Browser Console Check**:
- ✓ No TypeScript errors
- ✓ No network errors in Network tab

**Pass/Fail**: _______________

---

### Test 7: Data Table Display (if data exists)
**Objective**: Verify patient data table displays correctly

**Prerequisites**: At least one kidney dialysis patient record exists

**Steps**:
1. Verify table appears with data
2. Check table structure
3. Examine row styling

**Expected Results**:
- ✓ Table header row with background color #1976d2 (dark blue)
- ✓ Header columns:
  - HN (ห้องพยาบาล Number)
  - ชื่อ-สกุล (Patient Name)
  - สิทธิ์ (Insurance Type)
  - รวมค่าใช้ (Total Cost)
  - เบิกหน่วยไต (Kidney Payment)
  - กำไร (Profit)
- ✓ Data rows show alternating colors (white, #f9f9f9)
- ✓ Row hover effect shows light gray background

**Pass/Fail**: _______________

---

### Test 8: Table Data Content
**Objective**: Verify table data is correct and properly formatted

**Prerequisites**: At least one kidney dialysis patient record exists

**Steps**:
1. Look at first data row
2. Verify each column content
3. Check formatting

**Expected Results**:
- ✓ HN column: Shows patient ID (e.g., "123456")
- ✓ Name column: Shows patient name (e.g., "นายสมชาย ใจดี")
- ✓ Right column: Shows badge with insurance type
  - UCS+SSS: Blue badge
  - OFC+LGO: Purple badge
  - UC-EPO: Orange badge
- ✓ Total Cost: Formatted with thousand separators (e.g., "1,500")
- ✓ Kidney Payment: Green text, formatted with separators (e.g., "1,380")
- ✓ Profit: Green text if profit > 0, gray "-" if no profit

**Pass/Fail**: _______________

---

### Test 9: Row Click - Detail Modal
**Objective**: Verify clicking patient row opens detail modal

**Prerequisites**: At least one kidney dialysis patient record exists

**Steps**:
1. Click on any patient row in the table
2. Observe the modal that appears

**Expected Results**:
- ✓ DetailModal opens/is displayed
- ✓ Modal shows patient information including:
  - Patient HN, VN, Name
  - Service Date
  - Insurance/Fund information
- ✓ Modal has close button (X or "Close")
- ✓ Modal closes when close button is clicked
- ✓ Page returns to normal view after closing

**Pass/Fail**: _______________

---

### Test 10: Filtering by Insurance Type
**Objective**: Verify insurance type filter works correctly

**Prerequisites**: Multiple insurance types in data (UCS+SSS, OFC+LGO, UC-EPO)

**Steps**:
1. Select "UCS + SSS (1,500)" from "สิทธิ์" dropdown
2. Click "🔄 รีโหลด"
3. Verify only UCS+SSS records appear
4. Select "OFC + LGO (2,000)" from dropdown
5. Click "🔄 รีโหลด"
6. Verify only OFC+LGO records appear
7. Select "ทั้งหมด" to reset

**Expected Results**:
- ✓ Table updates to show only selected insurance type
- ✓ Filtered data counts update in summary cards
- ✓ "ทั้งหมด" shows all records again

**Pass/Fail**: _______________

---

### Test 11: Filtering by Date Range
**Objective**: Verify date range filter works correctly

**Steps**:
1. Change "วันเริ่มต้น" to March 15, 2026
2. Change "วันสิ้นสุด" to March 20, 2026
3. Click "🔄 รีโหลด"
4. Observe table updates

**Expected Results**:
- ✓ Data loads for the selected date range
- ✓ If no data: "📭 ไม่มีข้อมูล..." message appears
- ✓ If data exists: Table shows only records within date range
- ✓ Summary cards update accordingly

**Pass/Fail**: _______________

---

### Test 12: Error Handling
**Objective**: Verify error states are handled properly

**Steps**:
1. Stop the backend server (Terminal 2)
2. Try to load data by clicking "🔄 รีโหลด"
3. Observe error handling
4. Restart backend server

**Expected Results**:
- ✓ Error message displayed: "เกิดข้อผิดพลาดในการเชื่อมต่อ" OR "ไม่สามารถดึงข้อมูลได้"
- ✓ Error appears in red box
- ✓ Page doesn't crash
- ✓ After restarting server, data loads successfully

**Pass/Fail**: _______________

---

### Test 13: Responsive Design
**Objective**: Verify page is responsive on different screen sizes

**Steps**:
1. Open page on full desktop (1920px width)
2. Resize browser to tablet size (768px width)
3. Resize browser to mobile size (375px width)
4. Check layout adaptation

**Expected Results**:
- ✓ Desktop: All elements display in proper grid layout
- ✓ Tablet: Grid columns adjust, content remains readable
- ✓ Mobile: Single column layout, elements stack vertically
- ✓ No horizontal scrolling needed on mobile
- ✓ Buttons and inputs remain clickable/usable on all sizes
- ✓ Table becomes scrollable on small screens

**Pass/Fail**: _______________

---

### Test 14: Browser Console Verification
**Objective**: Verify no errors in browser console

**Steps**:
1. Open page
2. Press F12 to open Developer Tools
3. Go to Console tab
4. Perform all tests above
5. Check for any errors

**Expected Results**:
- ✓ No TypeScript/JavaScript errors in console
- ✓ No network errors (404, 500, etc.)
- ✓ Console shows data loading messages (if implemented)
- ✓ No warnings about missing dependencies

**Pass/Fail**: _______________

---

### Test 15: API Endpoint Verification
**Objective**: Verify backend API returns correct data

**Steps**:
1. Open browser and go to:
   `http://localhost:3001/api/hosxp/kidney-monitor?startDate=2026-03-21&endDate=2026-03-21`
2. Observe API response

**Expected Results**:
- ✓ Response contains JSON with `success: true`
- ✓ Data array contains kidney patient records
- ✓ Each record has:
  - hn (patient ID)
  - ptname (patient name)
  - hipdata_code (insurance type)
  - has_sss, has_lgo (insurance flags)
  - serviceDate (date)
  - vn (visit number)
- ✓ Response time < 2 seconds

**Pass/Fail**: _______________

---

## Summary Test Results

| Test # | Name | Result |
|--------|------|--------|
| 1 | Page Navigation | _____ |
| 2 | Monitor Category Selection | _____ |
| 3 | Summary Cards Display | _____ |
| 4 | Cost Breakdown Visualization | _____ |
| 5 | Filter Controls Display | _____ |
| 6 | Data Loading | _____ |
| 7 | Data Table Display | _____ |
| 8 | Table Data Content | _____ |
| 9 | Row Click - Detail Modal | _____ |
| 10 | Filtering by Insurance Type | _____ |
| 11 | Filtering by Date Range | _____ |
| 12 | Error Handling | _____ |
| 13 | Responsive Design | _____ |
| 14 | Browser Console | _____ |
| 15 | API Endpoint | _____ |

**Overall Result**: _____ PASS / _____ FAIL

---

## Known Limitations & Notes

1. **Chronic Disease & Special Rights**: Currently show "Coming Soon" placeholders
2. **Export Functionality**: Not yet implemented
3. **Data Range**: Limited to available HOSxP database records
4. **Real-time Updates**: Data updates on manual refresh (no auto-refresh)

---

## Troubleshooting

### Issue: No data appears in table
**Solutions**:
- Check backend is running: `http://localhost:3001/api/health`
- Check date range has valid records
- Check browser console for errors
- Verify database connection in backend

### Issue: DetailModal doesn't open
**Solutions**:
- Check DetailModal.tsx exists in src/components/
- Check browser console for React errors
- Verify CheckRecord object is created correctly on row click

### Issue: Styles look wrong
**Solutions**:
- Clear browser cache: Ctrl+Shift+Delete
- Hard refresh: Ctrl+Shift+R
- Check CSS is loading correctly in Network tab

---

**Created**: March 21, 2026  
**Version**: 1.0.0
