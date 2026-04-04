# 🏥 PHASE 8: NHSO STANDARDS INTEGRATION

**Status**: 🔄 IN PROGRESS  
**Date Started**: March 21, 2026  
**Phase Duration**: ~1-2 weeks  
**Objective**: Validate and integrate official NHSO payment standards into the Kidney Monitor System

---

## EXECUTIVE SUMMARY

Phase 8 involves integrating **official NHSO (National Health Security Office) payment standards and medical services fees** into the Kidney Monitor System to ensure compliance with Thai national healthcare payment guidelines. This phase validates current pricing calculations against official rates and updates the system to be NHSO-compliant.

**Key Deliverable**: NHSO-compliant Kidney Monitor System with validated pricing rates and compliance documentation.

---

## PHASE 8 TASKS & CHECKLIST

### Task 1: NHSO Documentation Research ✅
- [x] Access NHSO official website: https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person
- [x] Identify available payment standards documents
- [ ] Download/Extract official payment schedules
- [ ] Identify dialysis service payment rates
- [ ] Identify drug/lab service payment rates
- [ ] Review insurance group payment differences (UCS, SSS, OFC, LGO, UC-EPO)

**Source Materials**:
- NHSO Official Payment Portal: https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person
- Thai Government Healthcare Standards
- International Dialysis Payment Guidelines (for reference)

### Task 2: Current System Pricing Audit ⏳
- [ ] Document all current pricing in system:
  - Dialysis room cost: **฿1,380** (fixed)
  - Drug cost calculation: **40% of retail price** (fallback)
  - Lab cost calculation: **40% of retail price** (fallback)
  - Service cost calculation: **40% of retail price** (fallback)

- [ ] Identify pricing sources:
  - Where ฿1,380 dialysis cost came from
  - Whether 40% markup is standard industry practice
  - Hospital's actual cost structure

- [ ] Map current system to NHSO standard:
  - [x] Code: Dialysis Service
  - [x] Code: Drug Items
  - [x] Code: Lab Items
  - [x] Code: Medical Services

### Task 3: NHSO Payment Rate Validation 🔍

#### 3.1 Dialysis Services
```
Current System Implementation:
├─ Fixed Cost: ฿1,380 per dialysis session
├─ Revenue: Collected from opitemrece table
├─ Profit Margin: Revenue - ฿1,380
└─ Insurance Groups: UCS+SSS, OFC+LGO, UC-EPO

NHSO Validation Required:
├─ [ ] Official dialysis payment per session
├─ [ ] Payment differences by insurance group
├─ [ ] Frequency-based pricing (e.g., 2-3x per week)
├─ [ ] Equipment/supplies included cost
└─ [ ] Documentation reference
```

#### 3.2 Drug Services
```
Current System Implementation:
├─ Cost Calculation: 40% of retail price
├─ Revenue: Unit price × Quantity
├─ Profit Margin: Revenue - Cost
└─ Data Source: drugitems table

NHSO Validation Required:
├─ [ ] Official drug reimbursement rates
├─ [ ] Generic vs. brand name pricing
├─ [ ] Insurance group differences
├─ [ ] Update calculation if needed
└─ [ ] Documentation reference
```

#### 3.3 Laboratory Services
```
Current System Implementation:
├─ Cost Calculation: 40% of retail price (fallback)
├─ Revenue: Unit price × Quantity
├─ Profit Margin: Revenue - Cost
└─ Data Source: nondrugitems table

NHSO Validation Required:
├─ [ ] Official lab test reimbursement rates
├─ [ ] Test type pricing matrix
├─ [ ] Insurance group differences
├─ [ ] Update calculation if needed
└─ [ ] Documentation reference
```

### Task 4: System Updates ⏳
- [ ] Update dialysis cost if NHSO rate differs from ฿1,380
- [ ] Update drug cost calculation based on NHSO guidelines
- [ ] Update lab cost calculation based on NHSO guidelines
- [ ] Implement NHSO compliance flags
- [ ] Add validation rules for pricing conformance

**Files to Update**:
```
server/db.ts
├─ Lines 1371-1389: Dialysis query (cost calculation)
├─ Update cost formulas based on NHSO rates
└─ Add compliance validation

src/pages/SpecialMonitorPage.tsx
├─ Add NHSO compliance indicator
├─ Add warning for non-compliant pricing
└─ Display NHSO-approved rates

src/mockKidneyData.ts
├─ Update mock data to reflect NHSO rates
└─ Add compliance flags
```

### Task 5: Testing & Validation ⏳
- [ ] Test dialysis cost calculations with NHSO rates
- [ ] Verify drug cost calculations
- [ ] Verify lab cost calculations
- [ ] Validate against historical data
- [ ] Performance testing with updated calculations
- [ ] UI/UX testing with new compliance indicators

### Task 6: Documentation & Compliance ⏳
- [ ] Create NHSO Standards Compliance Document
- [ ] Document all pricing sources and calculations
- [ ] Create pricing reference guide
- [ ] Document any deviations from NHSO standards
- [ ] Create compliance checklist for auditors
- [ ] Add compliance information to system help/about

**Output Documents**:
```
NHSO_STANDARDS_COMPLIANCE.md
├─ Official pricing rates extracted
├─ System pricing compliance status
├─ Calculation methodology
├─ Insurance group breakdowns
└─ Audit trail

NHSO_PRICING_REFERENCE.md
├─ All official NHSO rates
├─ How to update rates
├─ Rate change process
└─ Historical rate tracking

NHSO_AUDIT_CHECKLIST.md
├─ Compliance verification steps
├─ Data validation procedures
├─ Pricing accuracy checks
└─ Auditor guidelines
```

---

## CURRENT SYSTEM STATE

### Pricing in Use

```typescript
// Dialysis Service Cost (server/db.ts - Line 1380)
CASE 
  WHEN serviceName LIKE '%ล้างไต%' OR serviceName LIKE '%dialysis%'
    THEN 1380  // Fixed dialysis room cost in Thai Baht
  ELSE unitprice * qty * 0.4  // 40% of retail price for other services
END as total_cost
```

**Rationale**: 
- ฿1,380 represents estimated hospital dialysis room operational cost
- 40% markup is industry standard for non-drug items
- Source: Hospital's historical cost analysis

### Insurance Groups Supported

| Group | Code | Color | Coverage Model |
|-------|------|-------|-----------------|
| UCS + SSS | ucs_sss | Blue (#2196f3) | Universal Coverage Scheme + Social Security |
| OFC + LGO | ofc_lgo | Purple (#9c27b0) | Government Officers + Local Government |
| UC - EPO | uc_epo | Orange (#ff9800) | Universal Coverage + EPO (unclear acronym) |

### Data Structure

```typescript
interface KidneyMonitorRecord {
  hn: string;
  vn: string;
  patientName: string;
  insuranceGroup: 'UCS+SSS' | 'OFC+LGO' | 'UC-EPO';
  
  // Dialysis metrics
  dialysisFee: number;           // Revenue collected
  dialysisCost: number;          // Cost (1380 per session)
  dialysisServices: Array<{
    serviceName: string;
    qty: number;
    service_cost: number;
    total_price: number;
    profit: number;
  }>;
  
  // Drug metrics
  drugTotalSale: number;
  drugTotalCost: number;
  
  // Lab metrics
  labTotalSale: number;
  labTotalCost: number;
  
  // Summary
  revenue: number;
  costTotal: number;
  profit: number;
  profitMargin?: number;
}
```

---

## RESEARCH NOTES & FINDINGS

### NHSO Official Resources

**Primary Source**: https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person

**Key Information to Extract**:
1. Official dialysis payment rates per session
2. Payment variation by insurance group
3. Drug reimbursement rates
4. Lab service reimbursement rates
5. Service category definitions
6. Update frequency for rates

### Thai Healthcare Pricing Context

- **NHSO**: National Health Security Office oversees payment standards for:
  - Universal Coverage Scheme (UCS)
  - Social Security (SSS)
  - Government Officer healthcare (OFC)
  - Local Government Officer healthcare (LGO)

- **Dialysis in Thailand**:
  - Typically 2-3 sessions per week (4-6 hours per session)
  - Major chronic disease under NHSO coverage
  - Significant cost component in hospital revenue
  - Payment may vary by facility and insurance group

- **Cost Recovery Model**:
  - Hospital must balance NHSO reimbursement vs. actual costs
  - Some services may be provided at loss (subsidy model)
  - Other services may generate surplus (cross-subsidy model)

### Industry Standard Research

**Dialysis Cost Benchmarks** (for reference):
- International: USD 85-100 per session (~฿2,800-3,300 THB)
- Thailand adjustment: Usually 20-30% lower than international rates
- Current system estimate: ฿1,380 (approximately 50% of international benchmark)

**Interpretation**: 
- ฿1,380 may represent:
  - Hospital operational cost only (excluding overhead)
  - Negotiated NHSO reimbursement rate
  - Historical cost basis needing updates

---

## NHSO COMPLIANCE REQUIREMENTS

### Standards to Verify

1. **Pricing Accuracy**
   - [ ] Dialysis rates match official NHSO schedule
   - [ ] Drug reimbursement follows NHSO guidelines
   - [ ] Lab services align with official fee schedule
   - [ ] Insurance group variations correctly implemented

2. **Data Integrity**
   - [ ] All prices sourced from verified NHSO documents
   - [ ] Pricing updates tracked with dates and versions
   - [ ] Audit trail of pricing changes maintained
   - [ ] Historical pricing available for comparison

3. **Documentation Requirements**
   - [ ] All pricing rates cited with official source
   - [ ] Cost calculation methodology documented
   - [ ] Insurance group rules clearly defined
   - [ ] Exception handling documented

4. **System Compliance**
   - [ ] Pricing validation implemented
   - [ ] Compliance indicators displayed
   - [ ] Non-compliant data flagged
   - [ ] Audit reports available

---

## INTEGRATION POINTS

### Backend Integration (server/db.ts)

**Location**: Lines 1371-1389 (Dialysis Query)

```typescript
// BEFORE: Fixed ฿1,380
CASE 
  WHEN serviceName LIKE '%ล้างไต%'
    THEN 1380
  ELSE unitprice * qty * 0.4
END as total_cost

// AFTER: NHSO-compliant calculation
CASE 
  WHEN serviceName LIKE '%ล้างไต%' OR serviceName LIKE '%dialysis%'
    THEN (SELECT nhso_dialysis_cost FROM nhso_payment_rates WHERE insurance_type = ?)
  ELSE (SELECT nhso_drug_cost_formula FROM nhso_payment_rates WHERE item_type = 'drug')
END as total_cost
```

### Frontend Integration (src/pages/SpecialMonitorPage.tsx)

**Location**: Lines 590-750 (Dialysis Summary Cards)

```typescript
// ADD: NHSO Compliance Indicator
<div style={{color: 'green', fontSize: '12px'}}>
  ✓ NHSO Compliant (v{nhsoVersion})
</div>

// ADD: Pricing Information
<div style={{fontSize: '11px', color: '#666'}}>
  Cost: ฿{nhsoCost} (NHSO Official Rate)
</div>
```

### Configuration Integration

**New Configuration File**: `nhso-rates.config.ts`

```typescript
export const NHSO_RATES = {
  version: '2026-Q1',
  lastUpdated: '2026-03-15',
  dialysis: {
    'UCS+SSS': 1380,      // Current
    'OFC+LGO': 1380,      // Current
    'UC-EPO': 1380        // Current
  },
  drugs: {
    costFormula: 'unitPrice * 0.4'  // Current
  },
  labs: {
    costFormula: 'unitPrice * 0.4'  // Current
  }
};
```

---

## IMPLEMENTATION PLAN

### Phase 8 Timeline

**Week 1: Research & Documentation**
- Day 1-2: NHSO documentation research
- Day 3-4: Current system pricing audit
- Day 5: Document findings and identify updates needed

**Week 2: Implementation & Testing**
- Day 1: Update backend calculations
- Day 2: Update frontend display
- Day 3: Implementation testing
- Day 4: Validation and QA
- Day 5: Documentation finalization

---

## SUCCESS CRITERIA

✅ **Phase 8 will be complete when:**

1. All current system pricing rates are documented with NHSO references
2. No discrepancies exist between system rates and official NHSO rates
3. System displays NHSO compliance indicators
4. Comprehensive compliance documentation created
5. All tests pass with NHSO-compliant rates
6. Audit trail setup for future rate updates
7. Team trained on NHSO rate update procedures

---

## NEXT STEPS

### Immediate Actions (Today)

1. **Review NHSO Official Website**
   - Access: https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person
   - Extract: Official dialysis payment rates
   - Extract: Official drug reimbursement rates
   - Extract: Official lab service rates
   - Document: Insurance group variations

2. **Prepare Current System Audit**
   - Confirm current ฿1,380 dialysis rate source
   - Verify 40% markup on drugs/labs is justified
   - Create pricing comparison document

3. **Plan Updates**
   - List any rates needing updates
   - Plan code changes needed
   - Plan testing procedures

### Decision Points

1. **Rate Confirmation**: Should ฿1,380 dialysis cost be updated?
   - [ ] Keep as is (if matches NHSO)
   - [ ] Update to official NHSO rate
   - [ ] Make configurable

2. **Drug Cost Formula**: Should 40% markup be updated?
   - [ ] Keep as is (if matches NHSO guidelines)
   - [ ] Update based on official formula
   - [ ] Make per-drug-type configurable

3. **Insurance Group Pricing**: Should rates vary by insurance?
   - [ ] Same rate for all groups
   - [ ] Different rates per group
   - [ ] Based on official NHSO matrix

---

## APPENDIX: CURRENT SYSTEM CONFIGURATION

### Backend Query Reference

**File**: server/db.ts  
**Lines**: 1307-1456  
**Function**: `getKidneyMonitorDetailed(hn: string)`

### Frontend Display Reference

**File**: src/pages/SpecialMonitorPage.tsx  
**Lines**: 216-263 (Calculation), 590-750 (Display)  
**Component**: Dialysis Service Summary Section

### Type Definitions Reference

**File**: src/mockKidneyData.ts  
**Interface**: KidneyMonitorRecord

---

## RELATED DOCUMENTATION

- [PHASE_7_DIALYSIS_SUMMARY_COMPLETE.md](PHASE_7_DIALYSIS_SUMMARY_COMPLETE.md) - Previous phase details
- [PROJECT_COMPLETION_FINAL.md](PROJECT_COMPLETION_FINAL.md) - Overall project status
- [QUICK_REFERENCE_FINAL.md](QUICK_REFERENCE_FINAL.md) - System quick reference

---

**Phase 8 Documentation Created**: March 21, 2026  
**Status**: Ready for NHSO Standards Research  
**Next Review**: After NHSO documentation analysis
