# 📋 NHSO PAYMENT STANDARDS EXTRACTION GUIDE

**Purpose**: Guide for extracting official NHSO payment rates and integrating them into the Kidney Monitor System

---

## QUICK START: ACCESSING NHSO PAYMENT STANDARDS

### Official NHSO Resources

| Resource | URL | Contains |
|----------|-----|----------|
| **NHSO Payment Portal** | https://www.nhso.go.th/th/nhso-payment-medical-services-fees-per-person | Main payment standards |
| **NHSO Official Website** | https://www.nhso.go.th | General information |
| **Healthcare Standards** | Various NHSO documents | Technical specifications |

### Information to Extract

When reviewing NHSO documentation, look for:

1. **Dialysis Services** ✓
   - [ ] Payment per dialysis session
   - [ ] Frequency assumptions (sessions per week)
   - [ ] Breakdown by insurance type (UCS, SSS, OFC, LGO)
   - [ ] Effective dates / version number

2. **Drug Services** ✓
   - [ ] Reimbursement method (% of cost vs. fixed rate)
   - [ ] Generic drug pricing
   - [ ] Brand name drug pricing
   - [ ] Reimbursement formulas

3. **Laboratory Services** ✓
   - [ ] Specific test reimbursement rates
   - [ ] Lab package pricing
   - [ ] Frequency-based adjustments
   - [ ] Equipment/supplies inclusions

4. **Service Categories** ✓
   - [ ] How NHSO defines dialysis services
   - [ ] Service classification codes
   - [ ] Insurance group variations
   - [ ] Temporary vs. permanent rates

---

## COMPARISON: CURRENT SYSTEM vs. NHSO OFFICIAL

### Current Implementation

```
DIALYSIS SERVICES
├─ Cost Calculation: Fixed ฿1,380
├─ Duration: Not specified in current system
├─ Frequency: Multiple times per episode
├─ Insurance Group: Same rate for all groups
└─ Source: Hospital historical cost basis

DRUG SERVICES
├─ Cost Calculation: 40% of retail price
├─ Insurance Group: Same formula for all
└─ Source: Industry standard practice

LAB SERVICES
├─ Cost Calculation: 40% of retail price
├─ Insurance Group: Same formula for all
└─ Source: Industry standard practice
```

### What NHSO Official Should Show

```
DIALYSIS SERVICES
├─ Cost Calculation: [TO BE DETERMINED]
├─ Per Session Rate: [TO BE DETERMINED]
├─ Insurance Variations: [TO BE DETERMINED]
└─ Effective Date: [NHSO_VERSION]

DRUG SERVICES
├─ Cost Calculation: [TO BE DETERMINED]
├─ Generic Rate: [TO BE DETERMINED]
├─ Brand Rate: [TO BE DETERMINED]
└─ Insurance Variations: [TO BE DETERMINED]

LAB SERVICES
├─ Cost Calculation: [TO BE DETERMINED]
├─ Test Fee Schedule: [TO BE DETERMINED]
├─ Package Pricing: [TO BE DETERMINED]
└─ Insurance Variations: [TO BE DETERMINED]
```

---

## EXTRACTION PROCESS

### Step 1: Verify Current ฿1,380 Dialysis Cost

**Question**: Does NHSO official documentation confirm ฿1,380 per dialysis session?

**If YES** ✓
- Update documentation to cite official source
- Add version number and effective date
- Document any insurance group variations

**If NO** ✗
- Identify correct official rate from NHSO
- Determine if rate varies by insurance group
- Plan code update to use new rate

**If UNCLEAR** ❓
- Check NHSO payment formulas
- Look for dialysis cost components:
  - Room rental
  - Staff costs
  - Equipment/supplies
  - Utilities/overhead
- Calculate total and compare to ฿1,380

---

### Step 2: Verify 40% Drug/Lab Cost Calculation

**Question**: Is 40% of retail price the NHSO-approved method?

**Research Points**:
- [ ] NHSO approval of markup percentage
- [ ] Whether formula applies to all drugs
- [ ] Whether formula varies by insurance type
- [ ] Whether specific drugs have different rates
- [ ] Whether generic vs. brand affects calculation

**Finding**:
If NHSO documentation specifies:
- **Fixed markup**: Use official percentage (e.g., 35%, 40%, 50%)
- **Variable markup**: Create lookup table by drug type
- **Per-drug rates**: Use official fee schedule
- **Insurance-based**: Create matrix by group

---

### Step 3: Document Insurance Group Variations

**Insurance Types in System**:
```
1. UCS + SSS
   ├─ UCS = Universal Coverage Scheme
   ├─ SSS = Social Security Scheme
   └─ Usually lower reimbursement rates

2. OFC + LGO
   ├─ OFC = Government Officers
   ├─ LGO = Local Government Officers
   └─ Usually higher reimbursement rates

3. UC - EPO
   ├─ UC = Universal Coverage (unclear)
   ├─ EPO = ? (to be clarified)
   └─ Reimbursement rates TBD
```

**NHSO Documentation Should Show**:
- Official payment rates for each group
- Any differences in coverage rules
- Any differences in payment amounts
- Effective dates for each group

---

## SAMPLE DATA EXTRACTION TEMPLATE

### Template to Fill When Reviewing NHSO Documentation

```markdown
# NHSO Payment Standards - Extraction Report

## Date of Review: [DATE]
## NHSO Document Version: [VERSION]
## Effective Date: [DATE]

### 1. DIALYSIS SERVICES

**Official Rate (per session)**:
- UCS + SSS: ฿[AMOUNT]
- OFC + LGO: ฿[AMOUNT]
- UC - EPO: ฿[AMOUNT]

**Components Included**:
- [ ] Room/facility rental
- [ ] Staff labor
- [ ] Equipment/supplies
- [ ] Utilities
- [ ] Other: _______________

**Frequency Assumptions**:
- Sessions per week: [NUMBER]
- Sessions per month: [NUMBER]
- Annual sessions per patient: [NUMBER]

**Notes/Comments**:
[SPACE FOR NOTES]

---

### 2. DRUG SERVICES

**Reimbursement Method**:
- [ ] Fixed markup percentage: _____%
- [ ] Variable by drug type
- [ ] Per-drug fee schedule
- [ ] Insurance-based variation
- [ ] Other: _______________

**Rates by Type**:
- Generic Drugs: _____%
- Brand Name Drugs: _____%
- Special Drugs: _____%

**Insurance Variations**:
- UCS + SSS: _____%
- OFC + LGO: _____%
- UC - EPO: _____%

**Notes/Comments**:
[SPACE FOR NOTES]

---

### 3. LABORATORY SERVICES

**Reimbursement Method**:
- [ ] Fixed markup percentage: _____%
- [ ] Fee schedule by test type
- [ ] Package pricing
- [ ] Insurance-based variation
- [ ] Other: _______________

**Sample Test Rates**:
- Creatinine: ฿[AMOUNT]
- Potassium: ฿[AMOUNT]
- Phosphate: ฿[AMOUNT]
- Other relevant tests: _______________

**Insurance Variations**:
- UCS + SSS: _____%
- OFC + LGO: _____%
- UC - EPO: _____%

**Notes/Comments**:
[SPACE FOR NOTES]

---

### 4. COMPARISON TO CURRENT SYSTEM

| Item | Current System | NHSO Official | Match? | Action Needed |
|------|----------------|---------------|--------|---------------|
| Dialysis Cost | ฿1,380 | ฿[X] | [ ] | [ ] Update |
| Drug Formula | 40% | [X]% | [ ] | [ ] Update |
| Lab Formula | 40% | [X]% | [ ] | [ ] Update |

---

### 5. CONCLUSION

**Overall Compliance Status**:
- [ ] Compliant (no changes needed)
- [ ] Partially Compliant (minor updates)
- [ ] Non-Compliant (major updates needed)

**Priority Actions**:
1. _______________
2. _______________
3. _______________

**Next Steps**:
[DESCRIBE WHAT COMES NEXT]
```

---

## KEY CONSIDERATIONS FOR NHSO INTEGRATION

### 1. Version Control
```
NHSO_RATES = {
  version: '2026-Q1',
  lastUpdated: '2026-03-15',
  effectiveDate: '2026-01-01',
  source: 'https://www.nhso.go.th/...',
  dialysis: { ... }
}
```

### 2. Rate Change Process
```
When NHSO updates rates:
1. Receive notification from NHSO
2. Extract new rates from official source
3. Document in version history
4. Update configuration file
5. Run regression tests
6. Deploy with version bump
7. Notify audit/compliance team
```

### 3. Insurance Group Mapping
```
Database pttype codes ←→ NHSO Insurance Categories

Current System:
- 'UCS+SSS' ← NHSO UCS + SSS
- 'OFC+LGO' ← NHSO OFC + LGO  
- 'UC-EPO' ← NHSO UC + EPO (verify)

Verify mapping in HOSxP pttype table
and NHSO official documentation
```

### 4. Audit Trail Requirements
```
For compliance purposes, maintain:
- Original NHSO document (PDF/link)
- Extraction date and person
- Verification date and person
- Implementation date
- Test results
- Go-live date
- Change log
```

---

## COMMON FINDINGS & HOW TO HANDLE

### If Dialysis Rate is DIFFERENT from ฿1,380

**Example**: NHSO official rate is ฿1,200

**Actions**:
1. Update backend query:
```typescript
// Change from:
THEN 1380
// To:
THEN 1200  -- NHSO Official Rate v2026-Q1
```

2. Update configuration:
```typescript
dialysisCost: {
  old: 1380,
  new: 1200,
  reason: 'NHSO v2026-Q1 update',
  effectiveDate: '2026-01-01'
}
```

3. Re-run all calculations:
```
Old Profit = Revenue - 1380
New Profit = Revenue - 1200
(Profit margins will increase if rate decreases)
```

4. Update documentation and communicate change

---

### If Drug/Lab Formula is DIFFERENT from 40%

**Example**: NHSO specifies 35% markup

**Actions**:
1. Update backend query
2. Recalculate all drug/lab costs
3. Review profit margins for viability
4. Communicate to management

---

### If Insurance Groups Have DIFFERENT Rates

**Example**: UCS+SSS gets ฿1,200, but OFC+LGO gets ฿1,400

**Actions**:
1. Create rate matrix by insurance type
2. Update backend to use matrix lookup
3. Update documentation
4. Test calculations by insurance group

---

## RED FLAGS & VALIDATION CHECKS

### Red Flags When Reading NHSO Documentation

⚠️ **Warning Signs**:
- [ ] Rates not tied to specific effective dates
- [ ] No mention of insurance group variations
- [ ] Inconsistent terminology (dialysis vs. hemodialysis)
- [ ] Unclear whether rates include all costs
- [ ] No information on how rates are calculated
- [ ] Conflicting information in different sections

✓ **Good Signs**:
- [ ] Clear effective dates
- [ ] Explicit insurance group breakdowns
- [ ] Detailed component breakdown
- [ ] Clear methodology explained
- [ ] Version numbers specified
- [ ] Contact info for questions

---

## DOCUMENTATION AFTER EXTRACTION

### Create NHSO_STANDARDS_COMPLIANCE.md

This file should contain:

```markdown
# NHSO STANDARDS COMPLIANCE DOCUMENTATION

## Source Document
- NHSO Version: 2026-Q1
- Extraction Date: March 21, 2026
- Extracted By: [NAME]
- Verified By: [NAME]

## Dialysis Services
### Current System vs. NHSO Official
[Comparison table]

### Implementation
- Cost per session: ฿1,380
- Source: NHSO v2026-Q1, Section 3.2
- Effective: January 1, 2026
- Insurance variations: None (same rate for all)

### Compliance Status
✓ COMPLIANT

---

## Drug Services
[Similar structure]

---

## Lab Services
[Similar structure]

---

## Overall Compliance
✓ FULLY COMPLIANT with NHSO standards

---

## Audit Trail
- Last verified: March 21, 2026
- Next review: June 21, 2026
- Update source: NHSO official website
```

---

## NEXT STEPS

1. **Access NHSO Website** → Extract official rates
2. **Complete Extraction Template** → Document findings
3. **Compare to Current System** → Identify discrepancies
4. **Plan Updates** → List code changes needed
5. **Implement Changes** → Update backend and frontend
6. **Test Thoroughly** → Verify calculations
7. **Update Documentation** → Create compliance docs
8. **Go Live** → Deploy Phase 8 completion

---

**Guide Created**: March 21, 2026  
**Status**: Ready for Use  
**Last Updated**: March 21, 2026
