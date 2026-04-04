# Table Display Fix - ตารางแสดงไม่ครบ

## ปัญหาที่แก้ไข

### ตารางแสดงไม่ครบ (Incomplete Table Display)
**ปัญหา**: 
- คอลัมน์ด้านขวา (Subfunds Tags, Status) ถูกตัดขาด
- ตารางไม่มี scroll ที่เพียงพอ
- ข้อมูลบางส่วนแสดงไม่ครบ

## การแก้ไข

### 1. แก้ไข Card Container
**ก่อน**:
```tsx
<div className="card" style={{ overflow: 'hidden' }}>
```

**หลัง**:
```tsx
<div className="card" style={{ 
    overflow: 'visible',
    display: 'flex',
    flexDirection: 'column' 
}}>
```

**เหตุผล**: 
- `flexDirection: 'column'` ช่วยให้เค้า header และตารางจัดเรียงแนวตั้งอย่างถูกต้อง
- `overflow: 'visible'` ปล่อยให้ content ขยายออกมาแล้ว scroll จะจัดการ

### 2. แก้ไข Overflow Container
**ก่อน**:
```tsx
<div style={{ overflowX: 'auto' }}>
    <table className="data-table">
```

**หลัง**:
```tsx
<div style={{ 
    overflowX: 'auto', 
    overflowY: 'auto', 
    flex: 1, 
    minHeight: 0 
}}>
    <table className="data-table" style={{ 
        width: '100%', 
        minWidth: '1200px' 
    }}>
```

**เหตุผล**:
- `overflowY: 'auto'` อนุญาต vertical scroll
- `flex: 1` ให้ container ขยายเต็มพื้นที่ว่าง
- `minHeight: 0` ป้องกัน flex overflowing
- `minWidth: '1200px'` บังคับให้ตารางมีความกว้างต่ำสุด เพื่อแสดงคอลัมน์ทั้งหมด

### 3. แก้ไข Card Header
**ก่อน**:
```tsx
<div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
```

**หลัง**:
```tsx
<div className="card-header" style={{ 
    display: 'flex', 
    justifyContent: 'space-between',
    flexShrink: 0
}}>
```

**เหตุผล**: `flexShrink: 0` ป้องกันไม่ให้ header ถูกบีบให้เล็กลง

### 4. แก้ไข Data Table Section Wrapper
**ก่อน**:
```tsx
<div>
    {/* Date Filter */}
    <div className="card" style={{ marginBottom: 16 }}>
```

**หลัง**:
```tsx
<div style={{ 
    flex: 1, 
    minHeight: 0, 
    display: 'flex', 
    flexDirection: 'column' 
}}>
    {/* Date Filter */}
    <div className="card" style={{ 
        marginBottom: 16, 
        flexShrink: 0 
    }}>
```

**เหตุผล**:
- `flex: 1` ให้ section ใช้พื้นที่ว่างทั้งหมด
- `minHeight: 0` ป้องกัน flex overflowing
- `flexDirection: 'column'` จัดเรียงใน layout คอลัมน์
- `flexShrink: 0` บน date filter ป้องกัน filter ถูกบีบให้เล็ก

## ผลลัพธ์

✅ **ตารางแสดงครบทุกคอลัมน์**
- Subfunds Tags ⚡ แสดง
- Status ⚡ แสดง
- ทุกคอลัมน์ที่เกี่ยวข้องกับ fund type ⚡ แสดง

✅ **Scroll ทำงานอย่างถูกต้อง**
- Horizontal scroll สำหรับตารางกว้าง
- Vertical scroll สำหรับข้อมูลมาก
- Header คงที่ไม่เลื่อน

✅ **Layout เหมาะสม**
- Date filter ด้านบน (fixed)
- ตารางใช้พื้นที่ว่างทั้งหมด
- Responsive บนขนาดหน้าจอต่างๆ

## Flexbox Structure

```
.page-container
├─ .page-header
├─ main-flex (display: flex)
│  ├─ sidebar (width: 280px, flexShrink: 0)
│  └─ right-content (flex: 1, minWidth: 0)
│     ├─ check-conditions (padding, marginBottom: 24px)
│     └─ data-table-section (flex: 1, minHeight: 0, flexDirection: 'column')
│        ├─ date-filter-card (flexShrink: 0, marginBottom: 16)
│        └─ data-card (flex: 1, flexDirection: 'column')
│           ├─ card-header (flexShrink: 0)
│           └─ overflow-container (flex: 1, minHeight: 0, overflowY: 'auto')
│              └─ table (minWidth: '1200px')
└─ modal
```

## Files Modified

- `src/pages/SpecificFundPage.tsx`
  - Line 523-524: Card container flexbox
  - Line 525: Card header flexShrink
  - Line 530-532: Overflow container with flex & minWidth
  - Line 499-501: Data table section wrapper flexbox

## Testing Status

✅ Development server reloaded successfully
✅ No compilation errors
✅ UI updates applied
✅ Table now fully visible with proper scrolling
