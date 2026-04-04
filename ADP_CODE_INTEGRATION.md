# 🏥 ADP Code Integration Guide

## 📊 **ตารางฐานข้อมูลที่เกี่ยวข้อง**

### **หลักการ Mapping ข้อมูลยา**
```
opitemrece → s_drugitems → nhso_adp_code
    ↓           ↓              ↓
  icode  →    icode    →   adp_code
  qty          adp_code      code
  price        name          name
```

### **ตารางที่ใช้**
1. **`opitemrece`** - รายการยาที่จ่าย
   - `icode` - รหัสยา
   - `qty` - จำนวน
   - `unitprice` - ราคาต่อหน่วย
   - `vn` - หมายเลข visit

2. **`s_drugitems`** - ยาหลักของโรงพยาบาล  
   - `icode` - รหัสยาในระบบ
   - `name` - ชื่อยา
   - `adp_code` - รหัส ADP สำหรับเบิกจาก สปสช.

3. **`nhso_adp_code`** - รหัส ADP มาตรฐานของ สปสช.
   - `code` - รหัส ADP
   - `name` - ชื่อยามาตรฐาน สปสช.

## 🎯 **การทำงานของระบบ**

### **Query ที่ปรับปรุงแล้ว**
```sql
SELECT 
  opitemrece.icode,
  COALESCE(s_drugitems.name, drugitems.name, opitemrece.icode) as drugName,
  opitemrece.qty,
  opitemrece.unitprice as unitPrice,
  (opitemrece.qty * opitemrece.unitprice) as price,
  s_drugitems.adp_code,
  nhso_adp_code.code as nhso_code,
  nhso_adp_code.name as nhso_name,
  CASE 
    WHEN s_drugitems.adp_code IS NOT NULL AND nhso_adp_code.code IS NOT NULL 
    THEN 1 
    ELSE 0 
  END as has_adp_mapping
FROM opitemrece
LEFT JOIN drugitems ON opitemrece.icode = drugitems.icode
LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
LEFT JOIN nhso_adp_code ON s_drugitems.adp_code = nhso_adp_code.code
WHERE opitemrece.vn = ?
ORDER BY opitemrece.icode
```

## 🌈 **การแสดงผลแบบ Highlight**

### **สีแสดงสถานะ**
- 🟢 **เขียว (#e8f5e9)**: ยาที่มี ADP Code - เบิกได้
- 🔴 **แดง (#ffebee)**: ยาที่ไม่มี ADP Code - ไม่สามารถเบิกได้

### **Badge สถานะ**
- ✅ **เบิกได้**: `background: #4caf50; color: white`
- ⚠️ **ไม่เบิก**: `background: #f44336; color: white`

## 📋 **ข้อมูลที่แสดงในตาราง**

| คอลัมน์ | ข้อมูล | แหล่งที่มา |
|---------|--------|------------|
| รหัสยา | icode | opitemrece.icode |
| ชื่อยา | drugName | s_drugitems.name หรือ drugitems.name |
| จำนวน | qty | opitemrece.qty |
| ราคา/หน่วย | unitPrice | opitemrece.unitprice |
| ราคารวม | price | qty × unitprice |
| **ADP Code** | adp_code | s_drugitems.adp_code |
| **สถานะเบิก** | has_adp_mapping | 1 = เบิกได้, 0 = ไม่เบิก |

## 🔍 **การตรวจสอบสถานะเบิก**

### **เงื่อนไขสำหรับการเบิกได้**
```javascript
const hasAdpCode = item.has_adp_mapping === 1 || item.adp_code;
```

### **สถิติการเบิก**
```javascript
const claimableCount = prescriptions.filter(p => 
  p.has_adp_mapping === 1 || p.adp_code
).length;

// แสดงเป็น "เบิกได้: 2/3" 
```

## ⚡ **ข้อดีของการปรับปรุง**

1. **📊 ข้อมูลครบถ้วน**: ใช้ `s_drugitems` แทน `drugitems` เก่า
2. **🎯 ความแม่นยำ**: Map กับ `nhso_adp_code` สำหรับการเบิก
3. **👁️ แสดงผลชัดเจน**: Highlight ยาที่เบิกได้/ไม่ได้
4. **📈 สถิติ**: นับจำนวนยาที่สามารถเบิกได้
5. **⚠️ แจ้งเตือน**: แสดงเตือนยาที่ไม่สามารถเบิกได้

## 🧪 **การทดสอบ**

### **ข้อมูล Mock สำหรับทดสอบ**
- ยา Paracetamol: มี ADP Code `A001` - เบิกได้
- ยา Amoxicillin: ไม่มี ADP Code - ไม่เบิก
- แสดงทั้งสองกรณีในตาราง

### **URL ทดสอบ**
- Staff Page: `http://localhost:5175/staff`
- API Test: `http://localhost:5175/prescription-test.html`
- API Direct: `http://localhost:3001/api/hosxp/prescriptions/2601234`

---

## 🎉 **ผลลัพธ์**

ระบบจะแสดงข้อมูลยาครบถ้วน พร้อม Highlight ยาที่มี ADP Code เพื่อความสำคัญในการเบิกจาก สปสช. อย่างชัดเจน!
