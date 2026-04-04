# 🏥 KIDNEY MONITOR SYSTEM - QUICK REFERENCE GUIDE

## ⚡ Quick Start

```bash
# Start Backend
cd d:\react\fdh_rect\server
npm start
# Runs on: http://localhost:3001

# Start Frontend (new terminal)
cd d:\react\fdh_rect
npm run dev
# Runs on: http://localhost:3507 or 3508

# Access Application
# Open browser to: http://localhost:3507 or 3508
```

---

## 📊 What You'll See

### Main Page
- 3 Monitor Category tabs: Kidney, Chronic, Special
- Date range filter (default: 2026-03-20 to 2026-03-21)
- Summary cards showing case counts and totals

### Kidney Monitor Tab (N185)
```
┌─────────────────────────────────────────────────┐
│ Summary Cards (Top Section)                      │
├─────────────────────────────────────────────────┤
│ 💙 UCS+SSS: 5 cases | 💜 OFC+LGO: 3 cases | 🟠 UC-EPO: 2 │
│ Total Profit: ฿9,300                            │
├─────────────────────────────────────────────────┤
│ Cost Breakdown by Category                       │
├─────────────────────────────────────────────────┤
│ 💙 UCS + SSS (5 cases)                          │
│   └─ 💊 ยา: ฿450 revenue | ฿280 cost | ฿170 profit
│   └─ 🔬 แลป: ฿350 revenue | ฿180 cost | ฿170 profit
│   └─ 💉 บริการ: ฿2,000 revenue | ฿1,380 cost | ฿620 profit
│                                                  │
│ 💜 OFC + LGO (3 cases)                          │
│   └─ [Same structure]                            │
│                                                  │
│ 🟠 UC - EPO (2 cases)                           │
│   └─ [Same structure]                            │
├─────────────────────────────────────────────────┤
│ 🏥 ค่าล้างไต (Dialysis Service) Summary        │
├─────────────────────────────────────────────────┤
│ 💙 UCS + SSS - ค่าล้างไต                       │
│   📊 5 cases | 💰 ฿10,000 | 💸 ฿6,900 | 📈 ฿3,100
│                                                  │
│ 💜 OFC + LGO - ค่าล้างไต                       │
│   📊 3 cases | 💰 ฿6,000 | 💸 ฿4,140 | 📈 ฿1,860
│                                                  │
│ 🟠 UC - EPO - ค่าล้างไต                        │
│   📊 2 cases | 💰 ฿360 | 💸 ฿0 | 📈 ฿360      │
├─────────────────────────────────────────────────┤
│ Data Table with Patient Records                  │
│ (Can click to see detailed breakdown modal)      │
└─────────────────────────────────────────────────┘
```

---

## 💰 Pricing Reference

### Dialysis Room Cost
- **Fixed Cost**: ฿1,380 per dialysis case
- **Applied to**: Services with name containing "ล้างไต" or "dialysis"

### Insurance Groups
| Group | Insurance Types | Typical Revenue |
|-------|---|---|
| **UCS+SSS** | UCS, สุขภาพ, บัตรทอง | ฿2,000 per case |
| **OFC+LGO** | OFC, LGO, ข้าราชการ | ฿2,000 per case |
| **UC-EPO** | UC, ประกันตัวเอง | ฿180 per case |

### Cost Calculation
```
Drug Cost: unitcost (from drugitems) × quantity
Lab Cost: unitprice × quantity × 0.4 (40% multiplier)
Service Cost: 
  - ฿1,380 if dialysis room
  - unitprice × quantity × 0.4 otherwise

Profit: Revenue - Cost
```

---

## 🔄 Data Flow

```
Patient Visit (ovst)
    ↓
Diagnosis N185/Z49 (ovstdiag)
    ↓
Receipt Items (opitemrece)
    ├─ Drugs (in drugitems table)
    ├─ Labs (nondrugitems, NOT services)
    └─ Services (nondrugitems WITH ค่า/บริการ/ล้างไต)
    ↓
Calculate Costs & Totals
    ↓
API Response (/api/hosxp/kidney-monitor)
    ↓
Frontend (SpecialMonitorPage.tsx)
    ├─ Group by Insurance
    ├─ Aggregate by Category
    └─ Display Summary Cards + Details
```

---

## 🎯 Key Files

### Frontend
```
src/pages/SpecialMonitorPage.tsx
  ├─ Line 590-750: Dialysis Summary Cards
  ├─ Line 216-263: calculateCategorySummary()
  ├─ Line 300-330: Summary calculation logic
  └─ Line 395+: Category summaries rendering

src/components/DetailCategoryModal.tsx
  └─ Service card display with breakdown

src/mockKidneyData.ts
  └─ Type definitions and mock data
```

### Backend
```
server/db.ts
  ├─ Line 1307-1324: Drug query
  ├─ Line 1330-1348: Lab query (excludes services)
  ├─ Line 1371-1389: Dialysis query (1380 cost)
  ├─ Line 1405-1456: Response mapping
  └─ Line 1370+: getKidneyMonitorDetailed()

server/index.ts
  └─ Line 1285: /api/hosxp/kidney-monitor endpoint
```

---

## 📋 Checklist: Verify Installation

- [ ] Backend starts without errors
- [ ] Database connection successful
- [ ] Frontend loads on http://localhost:3507 (or 3508)
- [ ] Kidney Monitor tab appears
- [ ] Date inputs work
- [ ] Summary cards display
- [ ] Dialysis cards visible with data
- [ ] Colors correct (Blue/Purple/Orange)
- [ ] Numbers formatted with commas (฿1,380)
- [ ] Profit calculations correct
- [ ] Modal opens on patient click
- [ ] Service breakdown shows in modal

---

## 🐛 Debug Checklist

If something's wrong, check these:

### No Data Showing
```typescript
// Check backend logs for:
"✅ Found X kidney cases with ROI analysis"

// Check frontend logs:
console.log('📊 Filtered data:', filteredData.length);
console.log('📊 UCS+SSS Summary:', ucsSssSummary);
```

### Cards Not Visible
- Check date range has data (2026-03-20 to 2026-03-21 has mock data)
- Check browser console for errors
- Verify dialysisFee values > 0

### Numbers Wrong
- Check API response in Network tab
- Verify dialysisCost calculation (should be ~฿1,380 × case count)
- Check profit = revenue - cost

### Styling Broken
- Clear browser cache (Ctrl+Shift+Delete)
- Hard refresh (Ctrl+Shift+R)
- Check if CSS grid is supported in browser

---

## 📊 Example Data Query

To verify data in database:

```sql
-- Find kidney patients
SELECT DISTINCT o.vn, o.hn, pt.fname, pt.lname, ptt.name as insurance
FROM ovst o
JOIN patient pt ON o.hn = pt.hn
LEFT JOIN pttype ptt ON pt.pttype = ptt.pttype
JOIN ovstdiag d ON o.vn = d.vn
WHERE DATE(o.vstdate) BETWEEN '2026-03-20' AND '2026-03-21'
  AND (d.icd10 LIKE 'N185%' OR d.icd10 LIKE 'Z49%')
LIMIT 10;

-- Check receipt items for one patient
SELECT icode, qty, unitprice, SUM(qty * unitprice) as total
FROM opitemrece
WHERE vn = '[patient_vn]'
GROUP BY icode;

-- Check lab names
SELECT DISTINCT 
  o.icode,
  COALESCE(ndi.name, sd.name, o.icode) as item_name,
  COUNT(*) as freq
FROM opitemrece o
LEFT JOIN nondrugitems ndi ON ndi.icode = o.icode
LEFT JOIN s_drugitems sd ON sd.icode = o.icode
WHERE NOT EXISTS (SELECT 1 FROM drugitems WHERE icode = o.icode)
GROUP BY o.icode
LIMIT 20;
```

---

## 🎨 UI Customization

### Colors
```typescript
// UCS+SSS (Blue)
background: '#e3f2fd'
borderLeft: '#2196f3'

// OFC+LGO (Purple)
background: '#f3e5f5'
borderLeft: '#9c27b0'

// UC-EPO (Orange)
background: '#fff3e0'
borderLeft: '#ff9800'

// Profit (Green)
color: '#4caf50'

// Cost (Gray)
color: '#999'
```

### Font Sizes
```typescript
mainLabel: '14px fontWeight 700'
groupHeader: '13px fontWeight 700'
cardLabel: '11px fontWeight 600'
cardValue: '16px fontWeight 800'
description: '10px'
```

### Spacing
```typescript
mainGap: '20px'
groupMargin: '25px'
cardGap: '12px'
padding: '12px'
```

---

## 🚀 Performance Tips

1. **Limit Date Range**: Smaller ranges = faster queries
2. **Cache Results**: Backend caches recent queries
3. **Use Mock Data**: For testing UI without DB
4. **Check Network**: Monitor tab for slow API calls

---

## 📱 Responsive Breakpoints

```
Mobile:   375px - 767px (1 column)
Tablet:   768px - 1023px (2 columns)
Desktop:  1024px+ (3-4 columns auto-fit)

minmax(140px, 1fr) = min 140px wide, max 1 equal fraction
```

---

## ✅ Testing Scenarios

### Test 1: Basic Display
1. Open app
2. Should see Kidney Monitor tab
3. Should see summary cards with data
4. Should see dialysis breakdown

### Test 2: Date Filtering
1. Change start date
2. Cards should update
3. Case counts may change
4. Revenue/profit recalculated

### Test 3: Profit Verification
1. Click a patient record
2. Modal shows breakdown
3. Manually calculate: Revenue - Cost = Profit
4. Verify matches display

### Test 4: Mobile Responsive
1. Resize browser to 375px
2. Cards stack vertically
3. Content readable
4. No horizontal scroll

---

## 📞 Quick Support

| Issue | Solution |
|-------|----------|
| No data | Check date range, expand to 2026-03-01 to 2026-03-21 |
| Wrong cost | Verify ฿1,380 in db.ts line 1387 |
| Lab codes | Check nondrugitems table has names |
| Colors wrong | Clear cache, check CSS rules |
| Slow loading | Check DB connection, reduce date range |
| TypeScript error | Rebuild: `npm run build` |

---

## 📚 Complete Documentation

1. **PROJECT_COMPLETION_FINAL.md** - Full project overview
2. **PHASE_7_DIALYSIS_SUMMARY_COMPLETE.md** - Latest phase details
3. **DIALYSIS_SUMMARY_CARDS_IMPLEMENTATION.md** - Cards implementation
4. **DATABASE_RELATIONSHIPS_KIDNEY_MONITOR.md** - Database schema
5. **README.md** - Getting started guide

---

**Last Updated**: 2026-03-21  
**Status**: ✅ Production Ready  
**Version**: 1.0 Complete

