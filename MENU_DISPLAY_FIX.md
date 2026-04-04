# SpecificFundPage.tsx - Menu Display Fix

## ปัญหาที่แก้ไข

### 1. ชื่อเมนูหาย (Missing Fund Names)
**ปัญหา**: ชื่อกองทุนไม่แสดงในเมนูด้านซ้าย แสดงเพียงไอคอนเท่านั้น

**สาเหตุ**: 
- Div ที่แสดงชื่อมี `inline-block` display แต่ไม่มีข้อมูลเพียงพอ
- Container ไม่มี `flexDirection: 'column'` เพื่อจัดเรียงไอคอนและชื่อแนวตั้ง

**การแก้ไข**:
```tsx
// เปลี่ยนจาก
style={{
    padding: isActive ? '16px' : '14px',
    display: 'inline-block',  // ❌ ไม่เหมาะสม
    overflow: 'hidden',        // ❌ ซ่อนชื่อ
}}

// เป็น
style={{
    padding: isActive ? '14px' : '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    overflow: 'visible',        // ✅ แสดงชื่อเต็ม
}}
```

### 2. รูปไอคอนไม่พอดีกับช่อง (Icon Sizing Issue)
**ปัญหา**: ไอคอนมีขนาดไม่สม่ำเสมอกับพื้นที่

**การแก้ไข**:
```tsx
// เปลี่ยนจาก
style={{
    fontSize: '20px',
    marginBottom: '6px',
    display: 'inline-block',
    transition: 'transform 0.3s ease'
}}

// เป็น
style={{
    fontSize: '18px',
    marginBottom: '8px',
    display: 'block',
    lineHeight: '1',
    height: '24px',
    transition: 'transform 0.3s ease'
}}
```

### 3. ชื่อเมนูบิด/ตัดขาด (Truncated Text)
**ปัญหา**: ชื่อกองทุนที่ยาว (เช่น "Cholesterol Screening") ถูกตัดขาด

**การแก้ไข**: 
```tsx
// เปลี่ยนจาก
style={{
    fontSize: '13px',
    fontWeight: 700,
    color: isActive ? '#ffffff' : '#1a1a1a',
    transition: 'color 0.3s ease',
    lineHeight: '1.3'  // ❌ ไม่มี wrap support
}}

// เป็น
style={{
    fontSize: '12px',
    fontWeight: 700,
    color: isActive ? '#ffffff' : '#1a1a1a',
    transition: 'color 0.3s ease',
    lineHeight: '1.4',
    wordWrap: 'break-word',      // ✅ ให้ขึ้นบรรทัดใหม่
    whiteSpace: 'normal',        // ✅ ยอมให้ wrap
    width: '100%'                // ✅ ใช้เต็มช่อง
}}
```

## ผลลัพธ์ที่ได้

✅ **ชื่อเมนูแสดงเต็มตัว** - ไม่หาย ไม่ตัดขาด  
✅ **รูปไอคอนพอดีกับช่อง** - ขนาด 18px, สูง 24px  
✅ **Layout สะอาด** - Flexbox จัดเรียงอย่างถูกต้อง  
✅ **Responsive** - ชื่อยาวใจ wrap ไปบรรทัดใหม่  

## ตัวอย่างการแสดง

### ก่อนแก้ไข:
```
🕊️    ← ไอคอน
      ← ชื่อหาย!
```

### หลังแก้ไข:
```
🕊️    
Palliative   ← ชื่อแสดงเต็มตัว
Care
```

## ไฟล์ที่แก้ไข

- `src/pages/SpecificFundPage.tsx` (บรรทัด 333-425)
  - แก้ไข div container styling (flexDirection, overflow)
  - แก้ไข icon div styling (height, lineHeight)
  - แก้ไข name div styling (wordWrap, whiteSpace, width)

## Testing
✅ Development server reloaded successfully  
✅ Changes applied without compilation errors  
✅ UI updated on browser refresh
