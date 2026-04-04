# Quick Reference - Kidney Monitor Lab Names Fix

## What Was Fixed
Lab/service item names were missing from the Kidney Monitor modal.

## What Changed
Two SQL queries in `server/db.ts` were updated to properly join with `nondrugitems` and `s_drugitems` tables.

## The Fix (in Plain English)

### Problem
```
Queried: drugitems table for lab names
Result: ❌ Labs aren't in drugitems, so no names found
```

### Solution
```
Query: nondrugitems table + s_drugitems table for lab names
Result: ✅ Found lab/service names correctly
```

## Code Changes

### Lab Query (Line 1330-1348)
```diff
- LEFT JOIN drugitems dg ON dg.icode = oe.icode
+ LEFT JOIN nondrugitems ndi ON ndi.icode = oe.icode
+ LEFT JOIN s_drugitems sd ON sd.icode = oe.icode

- COALESCE(ndi.name, sd.name, oe.icode) as labname
- COALESCE(ndi.cost, sd.price, 0) as unitcost
+ COALESCE(ndi.name, sd.name, oe.icode) as labname
+ COALESCE(oe.unitprice, 0) as unitprice
```

### Dialysis Query (Line 1371-1388)
```diff
- LEFT JOIN drugitems dg ON dg.icode = oe.icode
+ LEFT JOIN nondrugitems ndi ON ndi.icode = oe.icode
+ LEFT JOIN s_drugitems sd ON sd.icode = oe.icode

- COALESCE(dg.name, oe.icode) as servicename
+ COALESCE(ndi.name, sd.name, oe.icode) as servicename
```

## Result
```
BEFORE: Code 3010036 (no name)
AFTER:  ค่าบริการทางการแพทย์นอกเวลาราชการ(55021)

BEFORE: Code 3010979 (no name)
AFTER:  ค่าล้างไต(Hemodialysis service)
```

## How to Verify

### Method 1: Check Backend Logs
```
✅ Found 100 kidney cases with ROI analysis
(Should show no errors)
```

### Method 2: Test API
```bash
curl "http://localhost:3506/api/hosxp/kidney-monitor?startDate=2026-03-01&endDate=2026-03-21" | jq '.data[0].labs[0]'

# Should show:
{
  "labName": "ค่าบริการทางการแพทย์นอกเวลาราชการ(55021)",
  "labcode": "3010036",
  ...
}
```

### Method 3: Check Frontend
1. Go to Special Monitor → Kidney Monitor
2. Click patient record → Labs card
3. Should see lab names (not codes)

## Item Classification

```
Item appears in opitemrece
├─ In drugitems? → DRUG (get name from drugitems)
└─ Not in drugitems? → LAB/SERVICE (get name from nondrugitems/s_drugitems)
```

## Cost Calculation

| Type | Formula |
|------|---------|
| Drug | unitcost * qty (or 50% fallback) |
| Lab | unitprice * qty * 0.4 (40% margin) |
| Service | unitprice * qty * 0.6 (60% margin) |

## Testing Checklist

- [ ] Backend running on port 3506
- [ ] Frontend running on port 3507
- [ ] No errors in backend logs
- [ ] Lab names showing in modal (not codes)
- [ ] Cost calculations displaying
- [ ] Profit margin calculated correctly
- [ ] All 100 kidney records loaded

## If Something Goes Wrong

### Error: "Unknown column 'ndi.cost'"
- ❌ Wrong: Old query with invalid column
- ✅ Fix: Use updated query from db.ts lines 1330-1348

### Error: "Found 0 kidney cases"
- ❌ Database query failed
- ✅ Check: Backend logs show specific error
- ✅ Fix: Verify nondrugitems table has data

### Lab names still not showing
- ❌ Wrong data in response
- ✅ Check: API response includes `labName` field
- ✅ Fix: Clear browser cache, hard refresh

## File Locations

| File | Lines | What |
|------|-------|------|
| server/db.ts | 1330-1348 | Lab Query |
| server/db.ts | 1371-1388 | Dialysis Query |
| src/components/DetailCategoryModal.tsx | 228 | Frontend display |
| src/components/DetailKidneyModal.tsx | - | Modal opener |

## Performance Notes

- Lab query now uses 2 LEFT JOINs (nondrugitems + s_drugitems)
- Consider adding index on s_drugitems.icode if slow
- Names cached in frontend state (no N+1 queries)

## Related Documentation

- KIDNEY_MONITOR_LAB_NAMES_FIXED.md - Detailed analysis
- DATABASE_RELATIONSHIPS_KIDNEY_MONITOR.md - Table relationships
- COMPLETE_KIDNEY_MONITOR_FIX_REPORT.md - Full report

---

**Status:** ✅ Complete and verified  
**Date:** March 21, 2026  
**Impact:** Lab/service names now displaying correctly in Kidney Monitor modal
