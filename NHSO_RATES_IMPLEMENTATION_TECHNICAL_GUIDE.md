# ⚙️ NHSO RATES IMPLEMENTATION TECHNICAL GUIDE

**Purpose**: Technical implementation guide for integrating NHSO payment rates into the system  
**Status**: ⏳ AWAITING RATE EXTRACTION  
**Audience**: Developers, DevOps, Technical Team

---

## OVERVIEW

This guide provides step-by-step technical instructions for implementing NHSO payment rate changes once they have been extracted and validated through the extraction workbook.

**Prerequisite**: Complete `NHSO_RATES_EXTRACTION_WORKBOOK.md` first

---

## PART 1: CONFIGURATION FILE SETUP

### Step 1.1: Create NHSO Rates Configuration

**File**: `src/config/nhso-rates.ts`

```typescript
/**
 * NHSO Payment Standards Configuration
 * 
 * Source: https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person
 * Version: 2026-Q1
 * Effective Date: January 1, 2026
 * Last Updated: March 21, 2026
 */

export interface NHSOInsuranceGroup {
  code: string;
  name: string;
  dialysisCost: number;
  dialysisCostNotes: string;
  drugCostFormula: string;
  labCostFormula: string;
}

export interface NHSOPaymentRates {
  version: string;
  effectiveDate: string;
  lastUpdated: string;
  sourceUrl: string;
  insuranceGroups: Record<string, NHSOInsuranceGroup>;
}

// TODO: Update with NHSO rates from extraction workbook
export const NHSO_RATES: NHSOPaymentRates = {
  version: '2026-Q1',
  effectiveDate: '2026-01-01',
  lastUpdated: '2026-03-21',
  sourceUrl: 'https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person',
  
  insuranceGroups: {
    'UCS+SSS': {
      code: 'ucs_sss',
      name: 'Universal Coverage Scheme + Social Security',
      dialysisCost: 1380, // TODO: Update from NHSO official
      dialysisCostNotes: 'Hospital operational cost',
      drugCostFormula: '0.40', // TODO: Update from NHSO official
      labCostFormula: '0.40', // TODO: Update from NHSO official
    },
    
    'OFC+LGO': {
      code: 'ofc_lgo',
      name: 'Government Officers + Local Government Officers',
      dialysisCost: 1380, // TODO: Update from NHSO official
      dialysisCostNotes: 'Hospital operational cost',
      drugCostFormula: '0.40', // TODO: Update from NHSO official
      labCostFormula: '0.40', // TODO: Update from NHSO official
    },
    
    'UC-EPO': {
      code: 'uc_epo',
      name: 'Universal Coverage - EPO', // TODO: Clarify acronym
      dialysisCost: 1380, // TODO: Update from NHSO official
      dialysisCostNotes: 'Hospital operational cost',
      drugCostFormula: '0.40', // TODO: Update from NHSO official
      labCostFormula: '0.40', // TODO: Update from NHSO official
    },
  },
};

/**
 * Get dialysis cost for insurance group
 */
export function getDialysisCost(insuranceGroup: string): number {
  const group = NHSO_RATES.insuranceGroups[insuranceGroup];
  return group?.dialysisCost ?? 1380; // Fallback to default
}

/**
 * Get drug cost formula for insurance group
 */
export function getDrugCostFormula(insuranceGroup: string): string {
  const group = NHSO_RATES.insuranceGroups[insuranceGroup];
  return group?.drugCostFormula ?? '0.40'; // Fallback to default
}

/**
 * Get lab cost formula for insurance group
 */
export function getLabCostFormula(insuranceGroup: string): string {
  const group = NHSO_RATES.insuranceGroups[insuranceGroup];
  return group?.labCostFormula ?? '0.40'; // Fallback to default
}

/**
 * Get all NHSO rates as of current version
 */
export function getNHSORatesSnapshot(): NHSOPaymentRates {
  return NHSO_RATES;
}
```

### Step 1.2: Create Environment Variable

**File**: `.env`

```bash
# NHSO Configuration
NHSO_RATES_VERSION=2026-Q1
NHSO_RATES_EFFECTIVE_DATE=2026-01-01
NHSO_RATES_SOURCE_URL=https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person

# Dialysis Costs by Insurance Group
NHSO_DIALYSIS_COST_UCS_SSS=1380
NHSO_DIALYSIS_COST_OFC_LGO=1380
NHSO_DIALYSIS_COST_UC_EPO=1380

# Drug Cost Markup by Insurance Group
NHSO_DRUG_MARKUP_UCS_SSS=0.40
NHSO_DRUG_MARKUP_OFC_LGO=0.40
NHSO_DRUG_MARKUP_UC_EPO=0.40

# Lab Cost Markup by Insurance Group
NHSO_LAB_MARKUP_UCS_SSS=0.40
NHSO_LAB_MARKUP_OFC_LGO=0.40
NHSO_LAB_MARKUP_UC_EPO=0.40
```

---

## PART 2: BACKEND CODE UPDATES

### Step 2.1: Update Database Query for Dialysis

**File**: `server/db.ts` (Lines 1371-1389)

**Current Implementation**:
```typescript
CASE 
  WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%' 
    OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ialysi%'
    THEN 1380  -- Fixed dialysis room cost
  ELSE COALESCE(oe.unitprice * oe.qty, 0) * 0.4
END as total_cost
```

**After NHSO Integration (IF RATES DIFFER)**:
```typescript
// Import NHSO rates
import { getDialysisCost } from '../src/config/nhso-rates';

// In the dialysis query section
CASE 
  WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%' 
    OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ialysi%'
    THEN ? -- Parameter: NHSO dialysis cost for insurance group
  ELSE COALESCE(oe.unitprice * oe.qty, 0) * ? -- Parameter: drug/lab markup
END as total_cost
```

### Step 2.2: Update Backend Function to Use NHSO Rates

**File**: `server/db.ts` - Function `getKidneyMonitorDetailed()`

**Add NHSO rate parameters**:
```typescript
export async function getKidneyMonitorDetailed(hn: string): Promise<{
  success: boolean;
  data: KidneyMonitorRecord[];
}> {
  try {
    // ... existing code ...
    
    // Get patient insurance group to load correct NHSO rates
    const patientInsuranceGroup = insuranceData.insuranceGroup; // e.g., 'UCS+SSS'
    const nhsoDialysisCost = getDialysisCost(patientInsuranceGroup);
    const nhsoDrugMarkup = getDrugCostFormula(patientInsuranceGroup);
    const nhsoLabMarkup = getLabCostFormula(patientInsuranceGroup);
    
    // Use NHSO rates in queries
    const dialysisQuery = `
      SELECT ...
      CASE 
        WHEN serviceName LIKE '%ล้างไต%' THEN ?
        ELSE unitprice * qty * ?
      END as total_cost
    `;
    
    const [dialysisItems] = await connection.query(
      dialysisQuery, 
      [vn, nhsoDialysisCost, nhsoDrugMarkup] // Pass NHSO rates
    );
    
    // ... rest of implementation ...
  }
}
```

### Step 2.3: Create NHSO Rate Validation Function

**File**: `server/validation.ts` (new file)

```typescript
/**
 * NHSO Rate Validation
 * Validates that calculated costs match NHSO guidelines
 */

import { NHSO_RATES } from '../src/config/nhso-rates';

export interface RateValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  metrics: {
    profitMargin: number;
    costCoverage: number;
  };
}

/**
 * Validate dialysis cost against NHSO standards
 */
export function validateDialysisCost(
  insuranceGroup: string,
  actualCost: number,
  revenue: number
): RateValidationResult {
  const expectedCost = NHSO_RATES.insuranceGroups[insuranceGroup]?.dialysisCost ?? 1380;
  const warnings: string[] = [];
  const errors: string[] = [];
  
  if (actualCost > expectedCost * 1.1) {
    warnings.push(`Dialysis cost (฿${actualCost}) exceeds NHSO rate (฿${expectedCost}) by more than 10%`);
  }
  
  if (revenue < expectedCost) {
    errors.push(`Revenue (฿${revenue}) is less than NHSO cost (฿${expectedCost})`);
  }
  
  const profitMargin = ((revenue - actualCost) / revenue) * 100;
  const costCoverage = (revenue / actualCost) * 100;
  
  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    metrics: { profitMargin, costCoverage }
  };
}

/**
 * Validate drug cost against NHSO standards
 */
export function validateDrugCost(
  insuranceGroup: string,
  retailPrice: number,
  calculatedCost: number
): RateValidationResult {
  const expectedMarkup = parseFloat(
    NHSO_RATES.insuranceGroups[insuranceGroup]?.drugCostFormula ?? '0.40'
  );
  const expectedCost = retailPrice * expectedMarkup;
  const warnings: string[] = [];
  const errors: string[] = [];
  
  const variance = Math.abs(calculatedCost - expectedCost) / expectedCost;
  
  if (variance > 0.05) {
    warnings.push(
      `Drug cost variance exceeds 5%: expected ฿${expectedCost}, got ฿${calculatedCost}`
    );
  }
  
  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    metrics: { profitMargin: 0, costCoverage: 0 }
  };
}
```

---

## PART 3: FRONTEND UPDATES

### Step 3.1: Add NHSO Compliance Indicator

**File**: `src/pages/SpecialMonitorPage.tsx` (Lines 590-750)

**Add to dialysis summary section**:
```typescript
import { NHSO_RATES } from '../config/nhso-rates';

// Inside the dialysis summary rendering
<div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
  <span style={{ color: 'green' }}>✓</span> NHSO Compliant (v{NHSO_RATES.version})
  <br />
  Cost Rate: ฿{NHSO_RATES.insuranceGroups[insuranceGroup].dialysisCost} 
  (Effective: {NHSO_RATES.effectiveDate})
</div>
```

### Step 3.2: Add Rate Information Modal

**File**: `src/components/NHSORateInfoModal.tsx` (new file)

```typescript
import React from 'react';
import { NHSO_RATES } from '../config/nhso-rates';

export interface NHSORateInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NHSORateInfoModal: React.FC<NHSORateInfoModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: 'white',
      padding: '20px',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
      zIndex: 1000,
      maxWidth: '600px',
      maxHeight: '80vh',
      overflowY: 'auto'
    }}>
      <h2>NHSO Payment Standards</h2>
      <p>Version: {NHSO_RATES.version}</p>
      <p>Effective Date: {NHSO_RATES.effectiveDate}</p>
      <p>Last Updated: {NHSO_RATES.lastUpdated}</p>
      
      <h3>Dialysis Service Costs</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd' }}>
            <th>Insurance Group</th>
            <th>Cost per Session</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(NHSO_RATES.insuranceGroups).map(([key, group]) => (
            <tr key={key} style={{ borderBottom: '1px solid #ddd' }}>
              <td>{group.name}</td>
              <td>฿{group.dialysisCost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      <p style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
        Source: {NHSO_RATES.sourceUrl}
      </p>
      
      <button
        onClick={onClose}
        style={{
          marginTop: '20px',
          padding: '8px 16px',
          backgroundColor: '#2196f3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}>
        Close
      </button>
    </div>
  );
};
```

---

## PART 4: TESTING & VALIDATION

### Step 4.1: Create Unit Tests

**File**: `src/__tests__/nhso-rates.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  getDialysisCost,
  getDrugCostFormula,
  getLabCostFormula,
  NHSO_RATES,
} from '../config/nhso-rates';

describe('NHSO Rates Configuration', () => {
  it('should have all insurance groups defined', () => {
    expect(NHSO_RATES.insuranceGroups['UCS+SSS']).toBeDefined();
    expect(NHSO_RATES.insuranceGroups['OFC+LGO']).toBeDefined();
    expect(NHSO_RATES.insuranceGroups['UC-EPO']).toBeDefined();
  });

  it('should return correct dialysis cost', () => {
    const cost = getDialysisCost('UCS+SSS');
    expect(cost).toBe(1380); // TODO: Update after NHSO extraction
  });

  it('should return correct drug cost formula', () => {
    const formula = getDrugCostFormula('UCS+SSS');
    expect(parseFloat(formula)).toBeGreaterThan(0);
    expect(parseFloat(formula)).toBeLessThan(1);
  });

  it('should handle unknown insurance groups', () => {
    const cost = getDialysisCost('UNKNOWN');
    expect(cost).toBe(1380); // Should return fallback
  });
});
```

### Step 4.2: Create Integration Tests

**File**: `server/__tests__/nhso-integration.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getKidneyMonitorDetailed } from '../db';

describe('NHSO Rate Integration', () => {
  it('should calculate dialysis cost using NHSO rates', async () => {
    const result = await getKidneyMonitorDetailed('test_hn');
    
    if (result.data.length > 0) {
      const record = result.data[0];
      
      // TODO: Verify dialysis cost matches NHSO rate
      expect(record.dialysisCost).toBeGreaterThan(0);
    }
  });

  it('should handle multiple insurance groups', async () => {
    // Test that different insurance groups use correct rates
    // Implementation depends on test data setup
  });

  it('should validate cost calculations', async () => {
    // Verify all costs are calculated correctly
    // and profit margins are reasonable
  });
});
```

### Step 4.3: Manual Testing Checklist

```markdown
## NHSO Rate Implementation Testing Checklist

### Dialysis Services
- [ ] UCS+SSS dialysis cost is correct (฿[?])
- [ ] OFC+LGO dialysis cost is correct (฿[?])
- [ ] UC-EPO dialysis cost is correct (฿[?])
- [ ] Profit calculation: Revenue - NHSO Cost
- [ ] NHSO indicator displays correctly
- [ ] Compliance status shows "✓ NHSO Compliant"

### Drug Services
- [ ] Drug costs calculated using NHSO formula
- [ ] Generic drugs use correct markup ([?]%)
- [ ] Brand drugs use correct markup ([?]%)
- [ ] Insurance group variations applied

### Lab Services
- [ ] Lab costs calculated using NHSO formula
- [ ] Test costs use correct markup ([?]%)
- [ ] Insurance group variations applied

### Historical Data
- [ ] Existing records recalculated correctly
- [ ] Profit margins updated appropriately
- [ ] No data corruption
- [ ] Audit trail recorded

### UI/UX
- [ ] NHSO rate information displays
- [ ] Compliance indicators visible
- [ ] No UI breaks
- [ ] Mobile responsive
```

---

## PART 5: DEPLOYMENT

### Step 5.1: Pre-Deployment Checklist

```
Before deploying NHSO rate changes:

Code Changes
- [ ] All NHSO rates configured in nhso-rates.ts
- [ ] Backend queries updated to use NHSO rates
- [ ] Frontend displays NHSO compliance indicators
- [ ] Environment variables set correctly
- [ ] TypeScript compilation: 0 errors
- [ ] ESLint validation: 0 warnings
- [ ] All tests passing

Documentation
- [ ] NHSO_STANDARDS_COMPLIANCE.md created
- [ ] Rate change documented with dates
- [ ] Migration guide created (if needed)
- [ ] Rollback procedure documented

Data
- [ ] Backup of current database created
- [ ] Historical data reviewed
- [ ] Recalculation plan documented
- [ ] Audit trail setup completed

Team
- [ ] Finance team notified of changes
- [ ] Support team trained
- [ ] Audit team has documentation
- [ ] Stakeholders informed
```

### Step 5.2: Deployment Steps

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
npm install

# 3. Run tests
npm run test

# 4. Lint code
npm run lint

# 5. Build project
npm run build

# 6. Backup database
# (Manual step - run backup scripts)

# 7. Deploy to staging
npm run deploy:staging

# 8. Test in staging environment
# (Manual testing)

# 9. Deploy to production
npm run deploy:production

# 10. Monitor logs
npm run logs:production
```

### Step 5.3: Post-Deployment Verification

```
After deployment:

- [ ] Application starts without errors
- [ ] NHSO rates display correctly
- [ ] Calculations match expectations
- [ ] No performance degradation
- [ ] All reports accurate
- [ ] Team confirms success
```

---

## PART 6: MAINTENANCE & UPDATES

### Step 6.1: Monitor for Rate Changes

**File**: `src/utils/nhso-monitor.ts`

```typescript
/**
 * NHSO Rate Change Monitoring
 * 
 * Check for NHSO rate updates periodically
 * and alert when changes are needed
 */

export async function checkForNHSORateUpdates(): Promise<{
  hasUpdates: boolean;
  currentVersion: string;
  latestVersion: string;
  changedRates: string[];
}> {
  // TODO: Implement logic to:
  // 1. Check NHSO website for latest rates
  // 2. Compare to current system rates
  // 3. Generate alerts if changes detected
  // 4. Create update recommendation
  
  return {
    hasUpdates: false,
    currentVersion: '2026-Q1',
    latestVersion: '2026-Q1',
    changedRates: []
  };
}
```

### Step 6.2: Rate Update Process

```
When NHSO rates change:

1. NOTIFICATION
   - NHSO announces new rates
   - Our monitoring alerts team
   
2. EXTRACTION
   - Download official NHSO document
   - Extract new rates
   - Update NHSO_RATES_EXTRACTION_WORKBOOK.md
   
3. VALIDATION
   - Compare old vs. new rates
   - Assess financial impact
   - Plan implementation
   
4. IMPLEMENTATION
   - Update nhso-rates.ts with new rates
   - Update backend queries
   - Update frontend display
   
5. TESTING
   - Run all tests
   - Validate calculations
   - Verify UI
   
6. DEPLOYMENT
   - Backup database
   - Deploy to production
   - Monitor for issues
   
7. DOCUMENTATION
   - Document changes
   - Update compliance docs
   - Notify stakeholders
```

---

## APPENDIX: QUICK REFERENCE

### Update Checklist for New NHSO Rates

When NHSO rates change, update these files in order:

1. **src/config/nhso-rates.ts** - Update configuration values
2. **server/db.ts** - Update database queries if formulas changed
3. **.env** - Update environment variables
4. **src/pages/SpecialMonitorPage.tsx** - Update display if version changed
5. **Testing** - Run all tests
6. **Documentation** - Create NHSO_STANDARDS_COMPLIANCE.md
7. **Deployment** - Follow deployment checklist

### Common Rate Change Scenarios

**Scenario 1: Dialysis rate changes**
- Update: `NHSO_RATES.insuranceGroups[group].dialysisCost`
- Impact: All dialysis service calculations
- Testing: Verify profit calculations

**Scenario 2: Drug markup changes**
- Update: `NHSO_RATES.insuranceGroups[group].drugCostFormula`
- Impact: All drug cost calculations
- Testing: Verify historical data recalculation

**Scenario 3: New insurance group added**
- Update: Add to `insuranceGroups` object
- Impact: New insurance group support
- Testing: Verify all calculations for new group

---

**Implementation Guide Created**: March 21, 2026  
**Status**: READY FOR USE  
**Next Step**: Complete NHSO_RATES_EXTRACTION_WORKBOOK.md
