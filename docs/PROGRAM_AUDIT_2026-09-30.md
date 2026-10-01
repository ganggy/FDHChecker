# ผลตรวจ FDH Checker — 30 กันยายน 2569

ตรวจจาก commit `63d29a8` โดยอ่านโค้ดเส้นทางหลักและรันชุดตรวจในเครื่อง
ครอบคลุม REP/STM/INV, Data Sheet 0, การจับคู่ HIS, ลูกหนี้, สิทธิ์ API,
งานส่งออก, การอัปเดต, dependencies และความครอบคลุมของ tests
ไม่ได้เชื่อม production ไม่ส่งเคลม ไม่เขียนฐานโรงพยาบาล และไม่ได้ตรวจทุกหน้าจอ
กับข้อมูลจริง เงื่อนไขเบิกทางคลินิกของทุกกองทุนยังต้องยืนยันจากเอกสารที่ใช้จริง
และทดสอบข้อมูลนิรนามรายโรงพยาบาล

## ผลตรวจที่รันจริง

- `npm run check` ผ่าน: ชุดหลัก 247, AI 63, Vault 4, hospital DB 12 รวม 326 tests
  server type check, lint และ frontend build ผ่าน
- ESLint มี warning เดิม 3 จุดใน AnnualHealthCheckupReportPage, DentalAuditPage
  และ ReceivableSettlementPage ไม่มี lint error
- รันเพิ่ม 6 ไฟล์ที่ไม่ได้อยู่ใน `check`: ktbApproveCode, dentalAudit,
  paccountReportMapping, accountingRevenueReport, icd9Service และ
  receivableReportService ผ่านอีก 24 tests
- ไม่รัน `receivableSettlement.test.ts` ส่วน validation: เรียก service จริงโดยไม่มี
  mock connection ขณะที่ service เปิดฐานและเรียก ensure tables ก่อน validate
  ต้องแยก validation หรือ inject ฐานจำลองก่อนนำเข้า CI
- `npm audit --omit=dev --json` พบ packages ที่มีรายงานช่องโหว่ 11 รายการ:
  high 8, moderate 1, low 2, critical 0 เป็นผล audit dependency tree
  ไม่ใช่ข้อยืนยันว่าแต่ละช่องโหว่โจมตีเส้นทาง runtime นี้ได้ทั้งหมด

## ลำดับที่ควรแก้

### 1. สูง — ใช้กติกาจับคู่ Visit เดียวกันทุกเส้นทาง

`server/repositories/receivables.repository.ts:709` ยังรับ VN/AN ที่ส่งเข้ามา
โดยไม่ตรวจ HN/วันบริการ และ fallback HN+วันเลือก `ORDER BY ... DESC LIMIT 1`
หากผู้ป่วยมีหลาย Visit วันเดียวกันอาจเลือกผิดครั้ง ตัวอ่านคอลัมน์ TRAN_ID-as-AN
ที่แก้แล้วไม่แก้ปัญหานี้ทั้งหมด

หน้า STM 0/Data Sheet 0 ตรวจ VN/AN กับ HN แต่เมื่อพบ key ที่ใช้ได้จะไม่ตรวจ
วันเวลาอีกครั้ง (`server/repositories/stmZero.repository.ts:73`) จึงอาจยอมรับ
VN ที่ตัวนำเข้าเดิมเคยเลือกผิดวัน/ครั้งแต่เป็น HN เดียวกัน

ควรใช้ resolver กลาง ยืนยัน key+HN+วันเวลา ตรวจ CID เมื่อไม่มี HN และค้นได้
เพียงหนึ่ง Visit หากกำกวมให้รอตรวจ ไม่เลือก Visit ล่าสุด ต้องมีกรณีหลาย Visit
วันเดียว, เลขธุรกรรม, HN ไม่ตรง และการซ่อม mapping เดิมใน tests

### 2. สูง — ตัดลูกหนี้แบบ transaction และกันบันทึกซ้ำ

`server/receivableSettlementService.ts:338` ใช้ `COUNT(*) + 1` ออกเลขใบสำคัญ
แล้ว insert batch/items หลายคำสั่ง ไม่มี begin/commit/rollback ใน operation
คำขอพร้อมกันอาจชนเลข และข้อผิดพลาดระหว่างเขียนอาจเหลือ batch บางส่วน

ควรออกเลขด้วยวิธีที่ปลอดภัยต่อ concurrent requests ใช้ unique constraint
และ transaction พร้อม idempotency และการตรวจ statement item ที่เคยตัดแล้ว
ต้องทดสอบ concurrent submit, failure กลาง chunk และ retry

### 3. สูง — ตรวจยอดและผู้บันทึกจาก server

`server/routes/receivableSettlementRoutes.ts:48` ส่ง `req.body` เข้า service
service รวมยอดและรับ `created_by` จาก payload ไม่อ่านยอดต้นทางใหม่เพื่อยืนยัน
ก่อนบันทึก (`server/receivableSettlementService.ts:366`)
`/api/hosxp/audit` รับ `updated_by` จาก body และเก็บสถานะล่าสุดทับของเดิม
(`server/index.ts:2112`) ไม่ใช่ append-only audit history

ควรคำนวณและตรวจรายการจากข้อมูลฝั่ง server ใช้ actor จาก authenticated session
ตรวจจำนวนเงิน finite/range และเก็บก่อน/หลังการเปลี่ยนพร้อมเหตุผล
ไม่ให้ชื่อผู้ทำรายการหรือยอดที่ client แก้เป็นหลักฐานการเงินโดยตรง

### 4. สูง — ปรับ dependencies ที่อ่านไฟล์นำเข้า

ผล audit ล่าสุดยังพบ `xlsx`, `adm-zip`, `mysql2` และ dependency chains อื่น
`xlsx` ไม่มี automated npm fix ในผล audit และรุ่นที่โครงการใช้คือ 0.18.5
มี advisory สำหรับการอ่านไฟล์ที่ถูกสร้างเพื่อโจมตี:
[GitHub advisory](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)

ควรอัปเดตเป็นชุดเล็ก ทดสอบ XLS/XLSX/ZIP เดิมและไฟล์ผิดรูป ก่อน deploy
ไม่ใช้ `npm audit fix --force` โดยไม่มี validation ตัวอ่าน ZIP มีขีดจำกัดจำนวน
entry และขนาดแล้ว (`server/repstmArchive.ts:27`) แต่ต้องทดสอบขนาดจริงหลัง
decompress และเวลาใช้ CPU ด้วย CI ปัจจุบัน block เฉพาะ critical จึงยังผ่าน
เมื่อมี high (`.github/workflows/quality.yml`)

### 5. สูง — สิทธิ์หน้าและ API ต้องตรงกัน

หน้า `receivableSettlement` มี permission ของตัวเอง แต่ API
`/api/receivables/settlement/*` ไปเข้า rule ทั่วไปที่อนุญาตเพียง `receivable`
หรือ `ucOutsideCup` (`server/index.ts:913`) ผู้ใช้ที่ได้เฉพาะเมนูตัดลูกหนี้อาจ
เข้าหน้าได้แต่เรียก API ไม่ได้ ขณะที่ผู้มีสิทธิ์หน้าอื่นอาจเรียก write API นี้ได้

ควรเพิ่ม rule เฉพาะก่อน rule ทั่วไป แยก view/execute/delete/export
และทำ integration tests ของ user ที่มีสิทธิ์เมนูเดียว รวมถึง route ใหม่ที่ไม่มี rule
ซึ่งปัจจุบัน middleware อนุญาต authenticated user ต่อ (`server/index.ts:938`)

### 6. สูงสำหรับโรงพยาบาลใหม่ — ตั้ง mapping สิทธิ์/บัญชีตาม site

`server/receivableMapping.ts:19` เป็นตารางรหัส HOSxP ที่เขียนตายตัวจากไฟล์
mapping ของ site เดิม และรายงานใช้ lookup นี้ การตั้ง WALKIN รายโรงพยาบาล
ไม่ได้เปลี่ยน mapping บัญชีทั้งหมด โรงพยาบาลที่ใช้เลข pttype ต่างกันอาจถูกจัด
กลุ่ม/บัญชีไม่ตรง

ควรมี setup mapping ราย site ตรวจ coverage กับ pttype ใน HIS แสดงรหัสที่ยัง
ไม่ถูกตั้งค่า และไม่เดาบัญชีเมื่อหา mapping ไม่พบ ต้องให้ผู้รับผิดชอบบัญชียืนยัน

### 7. กลาง — ทำ profile การติดตั้งและอัปเดตให้ชัด

`deploy/scripts/self-update-runner.sh:138` บังคับใช้ pm2 และ restart ตาม
`FDH_PM2_APPS` ไม่รองรับเครื่องที่รัน systemd เพียงอย่างเดียว
ควรตรวจ runtime/user/path/branch/DNS/health ก่อนเปิดให้อัปเดต พร้อมข้อความ
ที่บอกวิธีแก้ตาม profile และทดสอบ rollback บน staging แบบเดียวกับเครื่องจริง
รอบนี้ไม่ได้ทดสอบ SSH หรือ rollout บน Linux โรงพยาบาล

### 8. กลาง — ลด query ในหน้า audit

`server/index.ts:3664` โหลดและจับคู่ทุกแถวก่อน filter/page รวมถึงการเปิด
sourceId หนึ่งรายการ ส่วน fallback ใน `stmZero.repository.ts:80` query HIS
ตาม HN/วันเวลาแต่ละกลุ่ม แม้มี cache ภายในคำขอ ข้อมูลมากอาจมี query จำนวนมาก
และทุกครั้งที่เปิดรายละเอียดต้องประมวลผลรายการในช่วงวันใหม่

ควร batch matching, กรองตั้งแต่ฐาน, ใช้ snapshot/ผลจับคู่ที่มี version และอ่าน
รายละเอียดเฉพาะ row โดยยังคงตรวจสถานะล่าสุดก่อนเตรียมส่งใหม่ ไม่เพิ่ม cache
ที่ทำให้ข้อมูลจ่ายเงินหรือสิทธิ์ stale

### 9. กลาง — ขยาย CI และปรับคู่มือให้ทันเมนูใหม่

`package.json:30` ไม่รวม 7 test files ที่มีอยู่ (6 ไฟล์รันเพิ่มผ่านแล้ว)
ควรรวมชุด offline ที่ตกหล่น และซ่อม settlement test ให้ใช้ fixture ก่อนรวม
เพิ่ม E2E login/permission/import/match/export และ transaction failure tests

คู่มือเว็บฉบับรวมใน GuidePage/FULL_SYSTEM_MANUAL ยังไม่มีบทเฉพาะเมนู
STM 0 และ REP Data Sheet 0 ใหม่ แม้มีคู่มือแยกแล้ว ควรเพิ่มบทและ regenerate
HTML/PDF ตรวจเมนูและลิงก์ พร้อมแก้ hook warnings โดยทดสอบ reload/filter
ไม่ใส่ dependency แบบสุ่มที่ทำให้ fetch วน

## สถานะรอบนี้

เป็นการตรวจและจัดลำดับงาน ยังไม่ได้แก้ application code, dependency,
schema หรือ deployment จากผล audit ไม่ได้ push รายงานนี้หรืออัปเดต server
ควรเริ่มจาก resolver, transaction/ยอดต้นทาง และ permission ก่อนเพิ่มเมนูใหม่
