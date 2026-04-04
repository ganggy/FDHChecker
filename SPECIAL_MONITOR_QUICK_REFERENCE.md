# Special Monitor Page - Quick Reference Guide

## 🚀 START THE APPLICATION

### Open Two Terminals

**Terminal 1 - Frontend Server**:
```powershell
cd d:\react\fdh_rect
npm run dev
```
✅ Wait for: `Local: http://localhost:3510/`

**Terminal 2 - Backend Server**:
```powershell
cd d:\react\fdh_rect\server
npm run start
```
✅ Wait for: `Server running on port 3001`

**Browser**:
Open http://localhost:3510

---

## 📍 NAVIGATE TO SPECIAL MONITOR

1. Look at top navigation bar
2. Find button: **📊 รายการมอนิเตอร์พิเศษ**
3. Click to open Special Monitor Page

---

## 🎯 KEY FEATURES AT A GLANCE

### Summary Cards (Top Section)
```
💙 UCS+SSS    💜 OFC+LGO    🟠 UC-EPO    💚 Total Profit
```

### Cost Breakdown (Middle Section)
```
UCS + SSS:     [บริการ] [ยา] [แลป]
OFC + LGO:     [บริการ] [ยา] [แลป]
UC - EPO:      [ยา EPO] [แลป] [บริการ]
```

### Filter Controls (Filter Section)
```
📅 Start Date  📅 End Date  🏷️ Insurance  📦 Category  🔄 Reload
```

### Patient Table (Data Section)
```
| HN | Name | Right | Total Cost | Payment | Profit |
```

---

## 🔍 HOW TO USE FILTERS

### 1. Filter by Date Range
```
📅 วันเริ่มต้น (Start Date): Select date
📅 วันสิ้นสุด (End Date): Select date
Click 🔄 รีโหลด
```

### 2. Filter by Insurance Type
```
🏷️ สิทธิ์ dropdown:
  ✓ ทั้งหมด (All)
  ✓ UCS + SSS (1,500)
  ✓ OFC + LGO (2,000)
  ✓ UC - EPO จริง (180)
Click 🔄 รีโหลด
```

### 3. Filter by Service Category
```
📦 หมวดบริการ dropdown:
  ✓ ทั้งหมด (All)
  ✓ หน่วยไต (ค่าบริการ)
  ✓ ยา + แลป + บริการ
Click 🔄 รีโหลด
```

---

## 👁️ VIEW PATIENT DETAILS

1. **Find patient in table**
2. **Click on patient row** (anywhere in the row)
3. **Detail modal opens** with:
   - Patient info
   - Service details
   - Receipt items
   - Prescriptions
4. **Click close button** to dismiss

---

## 📊 PROFIT MARGIN BREAKDOWN

### UCS + SSS (Blue)
```
Total Cost:      1,500 ฿
Paid by Fund:    1,380 ฿
Profit/Case:     120 ฿ ✓
```

### OFC + LGO (Purple)
```
Total Cost:      2,000 ฿
Paid by Fund:    1,380 ฿
Profit/Case:     620 ฿ ✓
```

### UC - EPO (Orange)
```
Total Cost:      180 ฿
Breakdown:
  - Drug (EPO):  60 ฿
  - Lab:         50 ฿
  - Service:     70 ฿
Profit/Case:     0 ฿ (no margin)
```

---

## 🛠️ TROUBLESHOOTING

### No Data Showing?
1. Check backend is running: `Server running on port 3001`
2. Check date range has records (try different dates)
3. Press F12, open Console, check for errors
4. Click 🔄 รีโหลด button

### DetailModal Not Opening?
1. Make sure DetailModal.tsx exists in `src/components/`
2. Press F12, check Console for errors
3. Try clicking a different patient row
4. Restart the frontend: `npm run dev`

### Network Error?
1. Check backend running: `npm run start` in server folder
2. Check API: http://localhost:3001/api/health
3. Wait 2-3 seconds for connection to establish
4. Try refreshing page (Ctrl+R)

### Wrong Port?
- Frontend: Change to http://localhost:3510
- Backend API: Check `http://localhost:3001/api`

---

## 📋 QUICK TEST CHECKLIST

- [ ] Frontend server running on 3510
- [ ] Backend server running on 3001
- [ ] Page loads with no errors
- [ ] Summary cards show numbers
- [ ] Cost breakdown bars visible
- [ ] Filters work
- [ ] Table shows patient data
- [ ] Clicking row opens detail modal
- [ ] Modal closes properly
- [ ] No errors in browser console

---

## 🔗 USEFUL LINKS

**Frontend**:
- Main App: http://localhost:3510
- Special Monitor: http://localhost:3510 → Click 📊 Button

**Backend**:
- Health Check: http://localhost:3001/api/health
- Kidney Monitor: http://localhost:3001/api/hosxp/kidney-monitor?startDate=2026-03-21&endDate=2026-03-21

**Code Files**:
- Page Component: `src/pages/SpecialMonitorPage.tsx`
- API Endpoint: `server/index.ts` (line 1285)
- App Router: `src/App.tsx`

---

## 📞 COMMON COMMANDS

**Start Frontend**:
```powershell
cd d:\react\fdh_rect
npm run dev
```

**Start Backend**:
```powershell
cd d:\react\fdh_rect\server
npm run start
```

**Build Frontend**:
```powershell
cd d:\react\fdh_rect
npm run build
```

**Build Backend**:
```powershell
cd d:\react\fdh_rect\server
npm run build
```

**Clear Cache & Restart**:
```powershell
# Frontend cache
rm -r d:\react\fdh_rect\node_modules\.vite

# Full restart
npm install && npm run dev
```

---

## 💡 PRO TIPS

1. **Filter Multiple Times**: Apply different filters to analyze data
2. **Check Profit Margins**: Look for highest profit cases
3. **Date Range Analysis**: Compare different date ranges
4. **Export Data**: Use detail modal for individual records
5. **Monitor Dashboard**: Use summary cards for quick overview

---

## 📝 MONITORING BEST PRACTICES

1. **Daily Review**: Check morning/afternoon for new records
2. **Weekly Analysis**: Review week's profit margins
3. **Trend Tracking**: Monitor insurance type distributions
4. **Anomaly Detection**: Look for unusual cases
5. **Documentation**: Keep notes on significant findings

---

## ⚙️ API ENDPOINT DETAILS

**GET** `/api/hosxp/kidney-monitor`

**Parameters**:
- `startDate`: YYYY-MM-DD (required)
- `endDate`: YYYY-MM-DD (required)

**Example**:
```
http://localhost:3001/api/hosxp/kidney-monitor?startDate=2026-03-21&endDate=2026-03-21
```

**Response** (Success):
```json
{
  "success": true,
  "data": [
    {
      "hn": "123456",
      "ptname": "Patient Name",
      "hipdata_code": "UCS",
      "has_sss": "Y",
      "has_lgo": "N",
      "serviceDate": "2026-03-21",
      "vn": "2601001"
    }
  ]
}
```

**Response** (Error):
```json
{
  "success": false,
  "error": "Error message"
}
```

---

## 🎓 USER TRAINING

### For Administrators
1. Monitor daily kidney dialysis patients
2. Track profit margins by insurance type
3. Identify high-profit cases (OFC+LGO)
4. Monitor case volume trends
5. Generate reports for management

### For Accounting
1. Verify costs match patient records
2. Reconcile payments with insurance codes
3. Track revenue by insurance type
4. Generate billing reports
5. Audit case classifications

### For Clinical Staff
1. View patient service details
2. Check prescription information
3. Monitor case assignments
4. Track patient outcomes
5. Verify documentation

---

## 🚀 FEATURES OVERVIEW

| Feature | Status | Access |
|---------|--------|--------|
| Kidney Monitor | ✅ Active | Click 📊 Button |
| NCD Monitor | 🟡 Coming Soon | Placeholder only |
| Special Rights | 🟡 Coming Soon | Placeholder only |
| Detail Modal | ✅ Active | Click Patient Row |
| Filtering | ✅ Active | Use Filter Section |
| Export | 🟡 Planned | Not yet available |
| Reports | 🟡 Planned | Not yet available |

---

## 📚 DOCUMENTATION

- **Full Implementation**: `SPECIAL_MONITOR_IMPLEMENTATION.md`
- **Complete Guide**: `SPECIAL_MONITOR_COMPLETE.md`
- **Test Guide**: `SPECIAL_MONITOR_TEST_GUIDE.md`
- **This File**: `SPECIAL_MONITOR_QUICK_REFERENCE.md`

---

## ✅ VERIFICATION CHECKLIST

Before going live:
- [ ] Both servers running without errors
- [ ] Page loads and renders correctly
- [ ] All filter options work
- [ ] Patient table shows data
- [ ] Detail modal opens/closes properly
- [ ] Profit calculations are correct
- [ ] No errors in browser console
- [ ] API responds correctly to queries
- [ ] Responsive design works on all devices
- [ ] Error messages display appropriately

---

**Version**: 1.0.0  
**Status**: ✅ Ready to Use  
**Last Updated**: March 21, 2026

---

## 🎉 YOU'RE ALL SET!

The Special Monitor Page is ready to use. Follow the quick start guide above to get started. Refer to detailed documentation for more information or troubleshooting.

**Need Help?**
- Check the troubleshooting section above
- Review the full test guide for detailed procedures
- Check code comments in the source files
- Review implementation documentation

**Happy Monitoring!** 📊
