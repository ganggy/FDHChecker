
# 🚀 PHASE 8 IMPLEMENTATION QUICK REFERENCE

**For**: Development Team  
**Date**: March 21, 2026  
**Start Date**: March 28, 2026  
**Deadline**: April 8, 2026

---

## THE 3 REQUIRED CHANGES

### 1️⃣ DIALYSIS RATES BY INSURANCE GROUP

**Current State** (Wrong):
```typescript
// server/db.ts line 1380
dialysisRate = 1380  // All insurance groups get ฿1,380
```

**Target State** (Correct):
```typescript
// New rate lookup
const dialysisRate = {
  'UCS+SSS': 1380,
  'OFC+LGO': 1500,   // +120 per session!
  'UC-EPO': 1380
}
```

**Why**: OFC/LGO patients are government employees entitled to ฿1,500/session, not ฿1,380. Current system loses ฿374,400/year.

**Effort**: 2-3 hours

---

### 2️⃣ DIALYSIS DRUG SPECIAL CATEGORY

**Current State** (Wrong):
```typescript
// All drugs use 40%
drugCost = unitPrice * qty * 0.40
```

**Target State** (Correct):
```typescript
// Dialysis drugs get 50-60%
const dialysisDrugs = ['EPO', 'iron', 'vitamin d', 'phosphate binder'];
if (drugName.includes(dialysisDrugs)) {
  drugCost = unitPrice * qty * 0.55;  // 55% average
} else {
  drugCost = unitPrice * qty * 0.40;  // Standard 40%
}
```

**Why**: EPO, iron supplements, vitamin D, and binders are dialysis-specific and get 50-60% reimbursement per NHSO. Current system loses ฿3,750-5,000/year.

**Effort**: 3-4 hours

---

### 3️⃣ DISPLAY INSURANCE GROUP + RATES IN UI

**Current State** (No info):
```
Dialysis Summary
Cases: 5
Revenue: ฿6,900
Cost: ฿6,900
Profit: ฿0
```

**Target State** (With info):
```
Dialysis Summary
Insurance: UCS+SSS (Baseline)  ← NEW
Cases: 5
Revenue: ฿6,900
Cost: ฿6,900
Profit: ฿0
Rate: ฿1,380/session       ← NEW
```

**Why**: Shows patients which insurance group they're in and what rate applies. Required for audit trail.

**Effort**: 2-3 hours

---

## FILES TO CREATE

### File 1: `src/config/nhso-rates.ts`

```typescript
// src/config/nhso-rates.ts
// NHSO payment rates as of March 2026

export const NHSO_DIALYSIS_RATES = {
  'UCS+SSS': 1380,
  'OFC+LGO': 1500,
  'UC-EPO': 1380,
} as const;

export const NHSO_DRUG_CATEGORIES = {
  GENERIC: 0.40,
  BRAND: 0.40,
  DIALYSIS_SPECIAL: 0.55,
} as const;

export const DIALYSIS_SPECIAL_DRUG_KEYWORDS = [
  'epo',
  'erythropoietin',
  'iron',
  'ferrous',
  'vitamin d',
  'calcitriol',
  'phosphate',
  'binder',
  'sevelamer',
  'renagel',
] as const;

export const NHSO_LAB_RATE = 0.40; // No change

export const NHSO_RATES_VERSION = 'v2.1-March2026';
export const NHSO_RATES_EFFECTIVE_DATE = '2026-01-01';
```

**Estimated Size**: 30-40 lines

---

### File 2: `src/utils/nhso-rate-helpers.ts`

```typescript
// src/utils/nhso-rate-helpers.ts
// Helper functions for NHSO rate lookups

import { NHSO_DIALYSIS_RATES, DIALYSIS_SPECIAL_DRUG_KEYWORDS, NHSO_DRUG_CATEGORIES } from '../config/nhso-rates';

export function getDialysisRate(insuranceGroup: string): number {
  const normalized = insuranceGroup.toUpperCase().replace(/ /g, '+');
  return NHSO_DIALYSIS_RATES[normalized as keyof typeof NHSO_DIALYSIS_RATES] || 1380;
}

export function isDdialysisSpecialDrug(drugName: string): boolean {
  const lower = drugName.toLowerCase();
  return DIALYSIS_SPECIAL_DRUG_KEYWORDS.some(keyword => lower.includes(keyword));
}

export function getDrugReimbursementRate(drugName: string): number {
  if (isDDialysisSpecialDrug(drugName)) {
    return NHSO_DRUG_CATEGORIES.DIALYSIS_SPECIAL;
  }
  return NHSO_DRUG_CATEGORIES.GENERIC;
}
```

**Estimated Size**: 25-30 lines

---

## FILES TO MODIFY

### Modification 1: `server/db.ts` (Dialysis Query)

**Current Location**: Lines 1371-1395

**Current Code**:
```typescript
const dialysisQuery = `
  CASE 
    WHEN serviceName LIKE '%ล้างไต%'
      THEN 1380
    ELSE unitprice * qty * 0.4
  END as total_cost
`
```

**Change To**:
```typescript
const dialysisQuery = `
  CASE 
    WHEN serviceName LIKE '%ล้างไต%'
      THEN CASE 
        WHEN insuranceGroup = 'OFC+LGO' THEN 1500
        ELSE 1380
      END
    ELSE unitprice * qty * 0.4
  END as total_cost
`
```

**Time**: 30 minutes

---

### Modification 2: `server/db.ts` (Drug Query)

**Current Location**: Lines 1307-1324

**Current Code**:
```typescript
const drugQuery = `
  SELECT unitprice * qty * 0.40 as drug_cost
  FROM drugs
`
```

**Change To**:
```typescript
const drugQuery = `
  SELECT 
    CASE 
      WHEN drugName IN ('EPO', 'iron', 'vitamin d', 'phosphate')
        THEN unitprice * qty * 0.55
      ELSE unitprice * qty * 0.40
    END as drug_cost
  FROM drugs
`
```

**Time**: 30 minutes

---

### Modification 3: `src/pages/SpecialMonitorPage.tsx`

**Current Location**: Lines 590-750 (Dialysis Summary Cards)

**Add Display**:
```typescript
// In dialysis summary card rendering
<div>
  <span>Insurance: {insuranceGroup}</span>
  <span>Rate: ฿{dialysisRate}/session</span>
  <span>NHSO Compliant ✓</span>
</div>
```

**Time**: 1-2 hours

---

## TESTING CHECKLIST

### Unit Tests (20 minutes)
- [ ] `getDialysisRate('UCS+SSS')` returns 1380
- [ ] `getDialysisRate('OFC+LGO')` returns 1500
- [ ] `getDialysisRate('UC-EPO')` returns 1380
- [ ] `isDDialysisSpecialDrug('EPO')` returns true
- [ ] `isDDialysisSpecialDrug('aspirin')` returns false
- [ ] `getDrugReimbursementRate('EPO')` returns 0.55
- [ ] `getDrugReimbursementRate('aspirin')` returns 0.40

### Integration Tests (1 hour)
- [ ] Database returns correct dialysis rate for each insurance group
- [ ] Database marks dialysis drugs with 55% rate
- [ ] Database returns generic drugs with 40% rate
- [ ] Profit calculations are correct for each group

### Manual Tests (1 hour)
- [ ] UI displays insurance group correctly
- [ ] UI displays rate per session
- [ ] Summary cards show NHSO compliant badge
- [ ] Historical data displays correctly (no retroactive changes)

---

## DATABASE CHANGES NEEDED (IF ANY)

**Likely**: NO DATABASE SCHEMA CHANGES

Why? Rates are configurable in code, not stored in database. If later needed:

```sql
-- Optional: Add rate version tracking (future enhancement)
ALTER TABLE dialysis_records ADD COLUMN nhso_rate_version VARCHAR(20);
ALTER TABLE dialysis_records ADD COLUMN nhso_effective_date DATE;
```

---

## ENVIRONMENT VARIABLES TO ADD

Add to `.env`:

```
NHSO_RATES_VERSION=v2.1-March2026
NHSO_RATES_EFFECTIVE_DATE=2026-01-01
NHSO_DIALYSIS_RATE_BASE=1380
NHSO_DIALYSIS_RATE_PREMIUM=1500
NHSO_DRUG_RATE_STANDARD=0.40
NHSO_DRUG_RATE_DIALYSIS=0.55
```

---

## TIMELINE (Week of March 28)

| Day | Task | Owner | Hours |
|-----|------|-------|-------|
| **Mon** | Create config file + helpers | Dev 1 | 3 |
| **Tue** | Update dialysis query in DB | Dev 1 | 1 |
| **Tue** | Update drug query in DB | Dev 2 | 1 |
| **Wed** | Update UI components | Dev 2 | 2 |
| **Wed** | Code review + fixes | Both | 1 |
| **Thu** | Unit testing | QA | 2 |
| **Fri** | Integration testing | QA | 2 |
| **Total** | -- | -- | **12 hours (~1.5 dev days)** |

---

## COMMON MISTAKES TO AVOID

❌ **Mistake 1**: Applying new rates retroactively
- ✅ Solution: Apply only to new records (forward-looking)

❌ **Mistake 2**: Hard-coding rates in multiple places
- ✅ Solution: Use config file as single source of truth

❌ **Mistake 3**: Forgetting to handle unknown insurance groups
- ✅ Solution: Default to 1380 for unknown groups

❌ **Mistake 4**: Not testing edge cases
- ✅ Solution: Test uppercase/lowercase drug names, partial matches

---

## SUCCESS METRICS

| Metric | Target | Status |
|--------|--------|--------|
| Dialysis rate lookup accuracy | 100% | ? |
| Drug category detection accuracy | 95%+ | ? |
| UI display correctness | 100% | ? |
| Compliance score | 99% | ? |
| Code review approval | 100% | ? |
| Test coverage | 90%+ | ? |
| Deployment success | 100% | ? |

---

## QUESTION? CHECK HERE

**Q: Will this break existing data?**  
A: No. New rates apply only to new records. Old records use rates in effect when created.

**Q: What if a drug name doesn't match our keywords?**  
A: It gets default 40% rate. We can add more keywords as needed.

**Q: Should we retroactively update all records?**  
A: No. Apply new rates forward only. Creates cleaner audit trail.

**Q: What if NHSO changes rates mid-year?**  
A: Update the config file + environment variables. Very simple.

**Q: How many developers do we need?**  
A: 2 developers × 3 days = 6 developer-days total effort.

**Q: What's the risk level?**  
A: Low. We're just changing configuration values and adding conditional logic. No database schema changes.

---

## KEY DOCUMENTS TO READ

1. **PHASE_8_NHSO_RESEARCH_FINDINGS.md** - Detailed findings
2. **NHSO_RATES_EXTRACTION_WORKBOOK.md** - All extracted rates
3. **NHSO_RATES_IMPLEMENTATION_TECHNICAL_GUIDE.md** - Full technical details

---

## SIGN OFF

- [ ] Developer 1 confirms understanding
- [ ] Developer 2 confirms understanding
- [ ] QA confirms test plan
- [ ] PM confirms timeline
- [ ] Ready to start March 28? **YES / NO**

---

**Questions?** Check the detailed guides linked above.  
**Ready to code?** Start with creating `src/config/nhso-rates.ts`

Let's get started! 🚀

