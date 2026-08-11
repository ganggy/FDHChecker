---
ksp_schema: 1
project: FDHChecker
type: "domain-knowledge"
category: "claims"
source: "knowlage/ai-reports/PCU_DEATH_REPORT.md"
source_hash: "e507bc8ee6ba2a7080b673375690f2303dcc73f245718323dd2f6329d97f63f7"
managed_by: "sync-ksp-vault"
---
# FDH AI Report Template: ผู้เสียชีวิตในเขต PCU โรงพยาบาล

## สถานะและข้อกำกับ

- Verified template: query แบบ read-only และยืนยัน schema กับ HOSxP ที่ใช้งานจริงเมื่อ 5 สิงหาคม 2569
- ข้อมูลระดับบุคคล ใช้ได้เฉพาะผู้มีสิทธิ์เมนู FDH AI Report
- ห้าม AI เติมโรคหรือสาเหตุการตายเมื่อ HOSxP ไม่มีข้อมูล
- ห้ามบันทึก prompt ที่มีชื่อ HN หรือ CID ลงคลังความรู้โดยอัตโนมัติ

## ขอบเขตพื้นที่จากภาพยืนยัน

- ตำบลตองโขบ อำเภอโคกศรีสุพรรณ จังหวัดสกลนคร
- PCU โรงพยาบาล: หมู่ 1, 2, 4, 5, 7, 8, 9, 10, 13, 14, 15, 16
- HOSxP `village.address_id = 471501`
- ไม่รวมหมู่ 3, 6, 11, 12, 17, 18 ซึ่งอยู่ในความรับผิดชอบ รพ.สต.ห้วยหีบตามภาพ

## คอลัมน์มาตรฐาน

ปีงบประมาณ, HN, ชื่อ-สกุล, CID, วันเดือนปีเกิด, ที่อยู่, วันที่เสียชีวิต, รหัส/ชื่อโรคหลัก และรหัส/ข้อความสาเหตุการตาย

## Source mapping

- บุคคล: `person`, `patient`
- การเสียชีวิต: `person_death`
- ที่อยู่: `house`, `village`
- ชื่อโรคและสาเหตุ: `icd101`
- วันที่เสียชีวิตเลือกตามลำดับ `person_death.death_date`, `person.death_date`, `patient.deathday`
- ปีงบประมาณเริ่ม 1 ตุลาคม และสิ้นสุด 30 กันยายน

## วิธีเพิ่มรายงานใหม่

ผู้ใช้กด “จำเป็นต้นแบบรายงาน” เพื่อส่ง feedback เข้าคิวตรวจสอบ ก่อนเปลี่ยนเป็น verified ต้องมี source mapping, query read-only, ขอบเขตสิทธิ์, test และ revision ทุกครั้ง
