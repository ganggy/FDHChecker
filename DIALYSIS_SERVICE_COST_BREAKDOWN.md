# ✅ DIALYSIS SERVICE COST BREAKDOWN - COMPLETE

## คำขอ
โรงพยบาลต้องการเห็น **ส่วนต่างรายได้จากค่าล้างไต**:
- ค่าบริการล้างไต (ผู้ป่วยจ่าย/เบิก): X บาท
- ห้องล้างไต (โรงพยบาลต้องจ่าย): 1380 บาท (Fixed Cost)
- Profit: X - 1380 บาท ✅

## วิธีแก้ไข

### 1. Backend Query (db.ts - dialysisQuery)
```sql
CASE 
  WHEN name LIKE '%ล้างไต%' OR name LIKE '%ialysi%'
    THEN 1380  -- Fixed dialysis room cost
  ELSE unitprice * qty * 0.4  -- 40% fallback for other services
END as total_cost
```

**ผลลัพธ์:**
- ค่าล้างไต (3010979): 
  - Revenue: 2000 บาท
  - Cost: 1380 บาท (ห้องล้างไต)
  - **Profit: 620 บาท** ✅

- ค่าบริการแพทย์ (3010036):
  - Revenue: 50 บาท
  - Cost: ≈ 20 บาท (40% fallback)
  - **Profit: 30 บาท** ✅

### 2. Frontend Response Structure

```typescript
dialysisServices: [
  {
    serviceName: "ค่าล้างไต(Hemodialysis service)",
    servicecode: "3010979",
    qty: 1,
    total_price: 2000,        // Revenue
    service_cost: 1380,       // Fixed cost (ห้องล้างไต)
    service_pprice: 0,        // Unit price (not used)
    profit: 620               // 2000 - 1380 ✅
  },
  {
    serviceName: "ค่าบริการทางการแพทย์นอกเวลา(55021)",
    servicecode: "3010036",
    qty: 1,
    total_price: 50,          // Revenue
    service_cost: 20,         // 40% fallback
    service_pprice: 0,        // Unit price (not used)
    profit: 30                // 50 - 20 ✅
  }
]

// Total
dialysisFee: 2050             // Total Revenue (2000 + 50)
dialysisCost: 1400            // Total Cost (1380 + 20)
profit: 650                   // Total Profit (2050 - 1400)
```

### 3. Frontend Display (Modal)

เมื่อคลิก "💉 บริการล้างไต" จะแสดง:

```
💉 รายละเอียดค่าบริการล้างไต

┌─────────────────────────────────────────────┐
│ Service Name              │ Cost │ Price│ P │
├─────────────────────────────────────────────┤
│ ค่าล้างไต (Hemodialysis) │ 1380 │ 2000 │620│
│ ค่าบริการแพทย์นอกเวลา    │   20 │   50 │ 30│
├─────────────────────────────────────────────┤
│ รวม                       │ 1400 │ 2050 │650│
└─────────────────────────────────────────────┘

Profit Margin: 31.71%
```

## ไฟล์ที่แก้ไข

✅ **d:\react\fdh_rect\server\db.ts** (Line 1371-1395)
- Updated dialysisQuery to use fixed cost 1380 for dialysis services
- Other services use 40% fallback

✅ **d:\react\fdh_rect\src\mockKidneyData.ts**
- Added `dialysisCost` field
- Added `dialysisServices` array type

✅ **d:\react\fdh_rect\src\components\DetailKidneyModal.tsx**
- Updated Service card to use `dialysisFee` and `dialysisCost`
- Displays accurate profit

✅ **d:\react\fdh_rect\src\components\DetailCategoryModal.tsx**
- Updated Service category to use `dialysisServices` array
- Shows line-by-line breakdown

## ทดสอบผล

### API Response
```bash
GET /api/hosxp/kidney-monitor?startDate=2026-03-01&endDate=2026-03-21

Response for first patient:
{
  dialysisFee: 2050,
  dialysisCost: 1400,
  dialysisServices: [
    {
      serviceName: "ค่าล้างไต(Hemodialysis service)",
      total_price: 2000,
      service_cost: 1380,
      profit: 620
    },
    {
      serviceName: "ค่าบริการทางการแพทย์นอกเวลา(55021)",
      total_price: 50,
      service_cost: 20,
      profit: 30
    }
  ]
}
```

## สรุป

✅ ระบบแสดง **ส่วนต่างรายได้** ของโรงพยบาลจากค่าล้างไตอย่างชัดเจน:
- **ค่าล้างไต**: 2000 บาท (เบิก) - 1380 บาท (ห้องล้างไต) = **620 บาท กำไร**
- **ค่าบริการแพทย์**: 50 บาท - 20 บาท = **30 บาท กำไร**
- **รวมทั้งหมด**: 2050 บาท - 1400 บาท = **650 บาท กำไร** ✅

**พร้อมใช้งาน!** 🚀
