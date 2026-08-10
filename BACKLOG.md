# FDH Checker Roadmap

อัปเดตล่าสุด: 2026-08-10

เอกสารนี้บันทึกเฉพาะงานที่ยังต้องทำต่อ สถานะความสามารถที่มีแล้วให้ดูใน `README.md` และ automated tests เพื่อไม่ให้ roadmap ขัดกับโค้ดจริง

## มีใช้งานแล้ว

- Pre-submit validation และ export FDH 16 แฟ้ม
- FDH submission/import status และ submission logs
- REP/STM/INV import, history, management และ reconciliation
- Rejected claim tracking, work queue และ receivable workflow
- OPD/IPD pre-audit และกองทุนเฉพาะ
- NHSO Authen/Close/eClaim, MOPH Claim และ Social Security OPD/IPD
- ผู้ใช้ กลุ่ม สิทธิ์เมนู และ bootstrap admin แบบ one-time
- LINE operational reports และ duplicate appointment alert
- Unit tests, TypeScript check, ESLint, production frontend/backend build และ CI workflow
- PM2/Nginx deployment template, liveness/readiness และ graceful shutdown

## P0 — ก่อนเปิดใช้งานวงกว้าง

### Data privacy และ repository hygiene

- ยืนยันว่าไฟล์ตัวอย่างทุกไฟล์เป็นข้อมูลนิรนาม
- นำไฟล์ HN/VN/CID/ชื่อผู้ป่วยออกจาก Git และล้าง history เมื่อเป็นข้อมูลจริง
- เพิ่ม data-retention policy สำหรับ import payload, logs และ backups

### Dependency security

- อัปเดต `adm-zip` และ Express dependency chain
- เปลี่ยนหรือ isolate ตัวอ่าน `xlsx` ที่มี known vulnerabilities
- จำกัดขนาดไฟล์, จำนวน ZIP entries, expanded size และเวลาประมวลผล

### Audit trail

- ทำ append-only audit event กลาง
- ใช้ actor จาก authenticated session เท่านั้น
- ครอบคลุม config, export, external submit, import, delete, user และ permission changes

## P1 — ความเสถียรและดูแลรักษา

### แยก backend ตาม domain

เริ่มแล้วโดยแยก `claimTrackingRoutes`, `sssRoutes` และ `healthRoutes` งานถัดไป:

1. ย้าย Auth/Admin routes และ repository ออกจาก `index.ts`/`db.ts`
2. ย้าย REP/STM/INV และ receivable เป็น domain modules
3. ย้าย FDH/NHSO/MOPH integrations เป็น services + routes
4. ใช้ versioned database migrations แทน runtime DDL

### Permission ระดับ action

- แยก view/import/export/submit/delete/admin ออกจาก menu permission
- เพิ่ม approval step สำหรับการส่งข้อมูลออกภายนอกและการลบข้อมูล

### Tests

- Database integration tests ด้วย schema/fixture ที่นิรนาม
- Browser E2E สำหรับ login, permission และ claim lifecycle
- Golden-file/snapshot tests สำหรับ export ทุก format
- Failure tests สำหรับ timeout, partial import, duplicate และ malformed ZIP/XLSX

### Observability

- Structured JSON logging และ secret/PII redaction
- Metrics สำหรับ latency, error rate, queue/import/submission failures
- Error monitoring และ deployment release tag

## P2 — การขยายระบบ

- Rule catalog ที่มีแหล่งอ้างอิง รุ่น วันเริ่มใช้ ผู้อนุมัติ และประวัติการเปลี่ยนแปลง
- Config template และ validation สำหรับโรงพยาบาลใหม่
- Dashboard SLA/aging ของ work queue และ reject resolution
- Automated restore drill report และ disaster-recovery target (RPO/RTO)

## Definition of done

งาน production ถือว่าเสร็จเมื่อ:

1. มี automated test สำหรับ behavior สำคัญ
2. `npm run check` และ `npm run build:all` ผ่าน
3. ระบุผลกระทบต่อข้อมูล สิทธิ์ และ audit แล้ว
4. มี deployment/rollback note เมื่อเปลี่ยน runtime หรือ schema
5. เอกสาร README/roadmap ถูกอัปเดตใน change เดียวกัน
