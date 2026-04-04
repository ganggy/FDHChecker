# UI QA Checklist

อัปเดตล่าสุด: 2026-03-31

## Shell หลัก

- [x] Navbar แสดงครบทุกเมนูหลัก
- [x] Navbar ไม่ล้นจอในหน้าจอแคบและสามารถเลื่อนแนวนอนได้
- [x] ปุ่ม `Settings` ยังเข้าถึงได้ทั้ง desktop และ mobile
- [x] พื้นหลังและ spacing ของทุกหน้าใช้ shell เดียวกัน

## วันที่และ Export

- [x] ค่าเริ่มต้นวันที่ของหน้าหลักใช้ local date
- [x] ชื่อไฟล์ export ใช้ local date
- [x] หน้า OPD, IPD, FDH, Specific Fund, Dashboard, Settings ใช้มาตรฐานวันที่เดียวกัน

## Shared Components

- [x] Stat cards ใช้ visual language เดียวกัน
- [x] Modal tabs และ modal table wrappers ใช้ style กลางเดียวกัน
- [x] Summary cards / issue badges / table wrappers ใช้ spacing และ border system เดียวกัน
- [x] ปุ่ม `btn-secondary` และ badge ข้อมูลถูกประกาศใน CSS กลางครบแล้ว

## รายการ OPD

- [x] เปิดหน้าได้ปกติ
- [x] กรองตามวันที่ได้
- [x] Export CSV/Excel ยังทำงานได้
- [x] การ์ดสรุปและตารางไม่ล้น shell หลัก

## รายการ IPD

- [x] เปิดหน้าได้ปกติ
- [x] Modal รายละเอียดชาร์ตยังเปิดได้
- [x] วันที่เริ่มต้นไม่เพี้ยนตาม timezone

## ตรวจสอบเบิก FDH

- [x] โหลดข้อมูลตามช่วงวันที่ได้
- [x] Preview / Export ยังใช้ชื่อไฟล์วันที่ถูกต้อง
- [x] สถานะ Ready / Pending ยังแสดงตาม logic เดิม

## แดชบอร์ดสรุป

- [x] ค่าเริ่มต้นวันที่ถูกต้อง
- [x] Layout การ์ดสรุปและกราฟยังแสดงผลได้

## รายกองทุนพิเศษ

- [x] Sidebar/menu ปรับตัวบนจอเล็กได้ดีขึ้น
- [x] ตารางยังแสดงผลได้และเลื่อนแนวนอนได้
- [x] กองทุน `caoral` ถูกถอดออกแล้ว

## รายการมอนิเตอร์พิเศษ

- [x] วันที่เริ่มต้นใช้ local date
- [x] ตาราง/รายละเอียด record ยังเปิดได้

## ตั้งค่าระบบ

- [x] โหลดค่า config ได้
- [x] Export JSON ใช้ชื่อไฟล์วันที่ถูกต้อง
- [x] DB settings / fallback config ยังแสดงได้

## คู่มือกองทุน

- [x] เปิดหน้าได้ปกติจาก navbar
- [x] ใช้ shell และ spacing เดียวกับหน้าอื่น

## หมายเหตุ

- `npm run build` ผ่าน
- `npm run lint` ผ่าน
- ยังไม่ได้ทำ browser automation test; checklist นี้อ้างอิงจากการตรวจโค้ด, shared layout review, และการ verify build/lint ของระบบ
