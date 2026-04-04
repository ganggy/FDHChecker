# Database Table Relationships - Kidney Monitor Fix

## Overview

The Kidney Monitor displays cost analysis for kidney dialysis patients by breaking down items into three categories: **Drugs**, **Labs**, and **Services**.

## Item Classification Logic

```
opitemrece (All Items)
    ├─ If icode EXISTS in drugitems
    │  └─ DRUG (with drugitems.name, drugitems.unitcost)
    │
    └─ If icode NOT EXISTS in drugitems
       └─ LAB/SERVICE (with nondrugitems.name or s_drugitems.name)
```

## Database Tables Used

### 1. opitemrece (Source of all items)
- **Purpose**: Operation item receipt - stores items billed for each visit
- **Key Fields**:
  - `vn`: Visit number (links to ovst, ovstdiag)
  - `icode`: Item code (joins to drugitems, nondrugitems, s_drugitems)
  - `qty`: Quantity used
  - `unitprice`: Selling price per unit
  - `income`: Income code (not used for classification in current implementation)

### 2. drugitems (Drug Master)
- **Purpose**: Master list of all drugs
- **Key Fields**:
  - `icode`: Item code (PRIMARY KEY)
  - `name`: Drug name
  - `unitcost`: Cost per unit (actual cost)
  - **Used for**: Identifying drugs, retrieving drug names and costs

### 3. nondrugitems (Non-drug Items Master)
- **Purpose**: Master list of labs, services, equipment
- **Key Fields**:
  - `icode`: Item code (PRIMARY KEY)
  - `name`: Lab/service name
  - `nhso_adp_type_id`: Type indicator (2 = instruments/equipment)
  - **Used for**: Retrieving lab and service names when icode not in drugitems

### 4. s_drugitems (Drug Mapping Table)
- **Purpose**: Secondary mapping for drugs and services
- **Key Fields**:
  - `icode`: Item code
  - `name`: Item name (fallback)
  - `tmlt_code`: Thai medicine code
  - `nhso_adp_code`: ADP code
  - **Used for**: Fallback name lookup when icode not in drugitems

### 5. ovst (Outpatient Visit)
- **Purpose**: Visit details
- **Key Fields**:
  - `vn`: Visit number (PRIMARY KEY)
  - `hn`: Hospital number (patient ID)
  - `vstdate`: Visit date

### 6. ovstdiag (Visit Diagnosis)
- **Purpose**: Diagnosis codes for visits
- **Key Fields**:
  - `vn`: Visit number (FOREIGN KEY to ovst)
  - `icd10`: ICD-10 diagnosis code
  - **Used for**: Filtering kidney patients (N185%, Z49%)

### 7. patient (Patient Master)
- **Purpose**: Patient demographic information
- **Key Fields**:
  - `hn`: Hospital number (PRIMARY KEY)
  - `pname`: Prefix (Mr., Ms., etc.)
  - `fname`: First name
  - `lname`: Last name
  - `pttype`: Patient type (links to pttype table)

### 8. pttype (Patient Type Master)
- **Purpose**: Patient insurance/funding type
- **Key Fields**:
  - `pttype`: Patient type code (PRIMARY KEY)
  - `name`: Patient type name (UCS, SSS, OFC, LGO, etc.)
  - `hipdata_code`: Health insurance data code

## Query Flow - Kidney Monitor

### Step 1: Find Kidney Patients
```sql
SELECT DISTINCT ovst.hn, ovst.vn
FROM ovst
JOIN ovstdiag d ON ovst.vn = d.vn
WHERE vstdate BETWEEN ? AND ?
  AND (d.icd10 LIKE 'N185%' OR d.icd10 LIKE 'Z49%')
```

### Step 2: Get Drugs for Each Visit
```sql
SELECT oe.icode as drugcode,
       dg.name as drugname,        -- From drugitems
       oe.qty,
       dg.unitcost,                -- From drugitems (actual cost)
       oe.unitprice * oe.qty as total_price
FROM opitemrece oe
INNER JOIN drugitems dg ON dg.icode = oe.icode  -- Only items IN drugitems
WHERE oe.vn = ?
```

### Step 3: Get Labs/Services for Each Visit
```sql
SELECT oe.icode as labcode,
       COALESCE(ndi.name, sd.name, oe.icode) as labname,  -- From nondrugitems or s_drugitems
       oe.qty,
       oe.unitprice * oe.qty as total_price,
       oe.unitprice * oe.qty * 0.4 as total_cost  -- 40% cost fallback for labs
FROM opitemrece oe
LEFT JOIN nondrugitems ndi ON ndi.icode = oe.icode
LEFT JOIN s_drugitems sd ON sd.icode = oe.icode
WHERE oe.vn = ?
  AND NOT EXISTS (SELECT 1 FROM drugitems WHERE icode = oe.icode)  -- Items NOT in drugitems
```

### Step 4: Get Services (Dialysis)
```sql
SELECT oe.icode as servicecode,
       COALESCE(ndi.name, sd.name, oe.icode) as servicename,  -- From nondrugitems or s_drugitems
       oe.qty,
       oe.unitprice * oe.qty as dialysisServicePrice,
       oe.unitprice * oe.qty * 0.6 as total_cost  -- 60% cost fallback for services
FROM opitemrece oe
LEFT JOIN nondrugitems ndi ON ndi.icode = oe.icode
LEFT JOIN s_drugitems sd ON sd.icode = oe.icode
WHERE oe.vn = ?
  AND NOT EXISTS (SELECT 1 FROM drugitems WHERE icode = oe.icode)  -- Items NOT in drugitems
```

## Cost Calculation Logic

### For Drugs
```
total_price = unitprice * qty
total_cost = unitcost * qty (if unitcost exists in drugitems)
           = total_price * 0.5 (50% fallback)
profit = total_price - total_cost
```

### For Labs
```
total_price = unitprice * qty
total_cost = total_price * 0.4 (40% - labs have lower margins)
profit = total_price - total_cost
```

### For Services (Dialysis)
```
total_price = unitprice * qty
total_cost = total_price * 0.6 (60% - services have higher costs)
profit = total_price - total_cost
```

## Data Flow Example

### Patient Record VN: 690321080007

**Items in opitemrece:**
1. icode: 2000001 - IN drugitems → **DRUG**
   - name: "Epoetin Alfa" (from drugitems)
   - unitcost: 500 (from drugitems)

2. icode: 3010036 - NOT IN drugitems → **LAB**
   - name: "ค่าบริการทางการแพทย์นอกเวลาราชการ" (from nondrugitems)
   - cost: 100 * 0.4 = 40 (fallback)

3. icode: 3010979 - NOT IN drugitems → **SERVICE**
   - name: "ค่าล้างไต(Hemodialysis service)" (from nondrugitems)
   - cost: 15000 * 0.6 = 9000 (fallback)

**Result:**
```json
{
  "drugs": {
    "total_sale": 5000,
    "total_cost": 3000
  },
  "labs": {
    "total_sale": 100,
    "total_cost": 40
  },
  "service": {
    "total_sale": 15000,
    "total_cost": 9000
  },
  "total_revenue": 20100,
  "total_cost": 12040,
  "profit": 8060
}
```

## Key Points for Maintenance

1. **Item codes in opitemrece must match exactly** with:
   - drugitems.icode (for drugs)
   - nondrugitems.icode (for labs/services)
   - s_drugitems.icode (for fallback service names)

2. **Classification is priority-based:**
   - First check: Is it in drugitems? → DRUG
   - Else: Is it in nondrugitems or s_drugitems? → LAB/SERVICE

3. **Name resolution order:**
   - Drugs: `drugitems.name`
   - Labs/Services: `COALESCE(nondrugitems.name, s_drugitems.name, icode)`

4. **Cost sources:**
   - Drugs: `drugitems.unitcost` (actual cost) OR fallback 50%
   - Labs: Fallback 40% (assumes 40% cost margin)
   - Services: Fallback 60% (assumes 60% cost margin)

## Performance Considerations

- Lab query uses LEFT JOINs with nondrugitems and s_drugitems for flexibility
- Classification uses NOT EXISTS subquery instead of LEFT JOIN to avoid duplicates
- Recommend indexing on:
  - opitemrece.vn (already exists)
  - opitemrece.icode (for faster joins)
  - drugitems.icode (PRIMARY KEY - optimized)
  - nondrugitems.icode (PRIMARY KEY - optimized)
  - s_drugitems.icode (should be indexed)
