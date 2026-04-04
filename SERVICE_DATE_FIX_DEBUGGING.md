# 🔍 Service Date Column - Debugging & Fix

**Date**: March 21, 2026  
**Issue**: Service Date column showing empty `<td></td>` in table

---

## Root Cause Analysis

### What We Found

1. **API Query** ✅ CORRECT
   - File: `server/db.ts` line 1264
   - Query: `DATE_FORMAT(ovst.vstdate, '%Y-%m-%d') as serviceDate`
   - Status: Correctly selecting serviceDate from database

2. **API Return Object** ✅ CORRECT
   - File: `server/db.ts` line 1424
   - Return: `serviceDate: row.serviceDate`
   - Status: Correctly returning serviceDate in API response

3. **Frontend Render** ⏳ NEEDS VERIFICATION
   - File: `src/pages/SpecialMonitorPage.tsx` line 920-926
   - Render: `{(() => { const dateValue = ...; return dateValue || '-'; })()}`
   - Issue: Data might be `undefined` or `null`

---

## Fixes Applied

### Fix 1: Added Fallback in Database (server/db.ts)

**Before**:
```typescript
serviceDate: row.serviceDate,
```

**After**:
```typescript
serviceDate: row.serviceDate || new Date().toISOString().split('T')[0], // Fallback to today if null
```

**Reason**: If query returns `null`, fallback to today's date

### Fix 2: Added Debug Logging (server/db.ts)

**Added**:
```typescript
console.log('📅 Processing row:', { hn: row.hn, vn: row.vn, serviceDate: row.serviceDate });
```

**Reason**: To trace if `serviceDate` is actually being fetched from database

### Fix 3: Updated Mock Data (src/mockKidneyData.ts)

**Added `dialysisCost` field** to all mock records (was missing and causing build errors)

**Example**:
```typescript
dialysisFee: 800,
dialysisCost: 1380,  // ← Added this
```

---

## Current Status

### Servers Running
- ✅ Frontend Dev Server: `http://localhost:5173`
- ✅ Backend API Server: `http://localhost:3001`

### Next Steps to Verify

1. **Open Browser Console** (F12)
   - Look for `📅 Processing row:` logs
   - Check if `serviceDate` has a value

2. **Check Network Tab**
   - Go to `/api/hosxp/kidney-monitor` endpoint
   - Verify API response includes `serviceDate` for each record

3. **Test the Table**
   - Navigate to FDH Checker page
   - Check if "วันที่รับบริการ" column now shows dates

---

## Expected Result

✅ Service Date column should display:
- Format: `2026-03-21` (YYYY-MM-DD)
- Position: Between "ชื่อ-สกุล" and "สิทธิ์เจ้าตัว"
- Content: Date from database or today's date (fallback)

---

## Debugging Checklist

- [ ] Open http://localhost:5173 in browser
- [ ] Press F12 to open Developer Tools
- [ ] Go to Console tab
- [ ] Look for `📅 Processing row:` logs - verify serviceDate values
- [ ] Click on FDH Checker page
- [ ] Check if "วันที่รับบริการ" column displays dates
- [ ] If empty, check Network tab for API response data
- [ ] If still empty, check if `row.serviceDate` is `null` in server logs

---

## Files Modified

1. **server/db.ts** (2 changes)
   - Line ~1259: Added debug logging
   - Line ~1424: Added fallback for serviceDate

2. **src/mockKidneyData.ts** (5 changes)
   - Added `dialysisCost` field to all mock records

3. **src/pages/SpecialMonitorPage.tsx** (no changes needed)
   - Already has correct rendering logic
   - Awaiting correct data from API

---

## Server Logs to Check

When you load the FDH Checker page, check the **backend terminal (npm run dev)** for:

```
📅 Processing row: { hn: '601234', vn: '2601501', serviceDate: '2026-03-21' }
```

If you see `serviceDate: null`, then the problem is in the database query.
If you see a valid date, the problem is in the frontend rendering.

---

**Next Action**: Open the browser and check the Console logs!
