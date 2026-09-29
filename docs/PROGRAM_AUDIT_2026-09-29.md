# ผลตรวจ FDH Checker — 29 กันยายน 2569

การตรวจนี้อ้างอิงโค้ดในเครื่องและการทดสอบด้วยข้อมูลจำลอง ไม่ใช่การรับรองว่าทุกเมนูทำงานกับฐาน HOSxP ของทุกโรงพยาบาล หรือการตรวจระบบ production ที่กำลังรันอยู่

## แก้ในรอบนี้

- ตัวอัปเดตผ่านเว็บกลับมารัน `npm run check` ก่อน build และตรวจ `/api/live` กับ `/api/ready` หลัง restart ก่อนแสดงสำเร็จ 100% หากชื่อ PM2 app ที่กำหนดไม่มีอยู่จะล้มเหลวอย่างชัดเจน ไม่ข้ามขั้นตอน
- ใบสำคัญตัดลูกหนี้อ่านชื่อและรหัสโรงพยาบาลจาก `opdconfig`; ลบ fallback ที่เป็นชื่อ/รหัสโรงพยาบาลแห่งเดียว และคืน database connection ของบริการนี้ให้ pool
- หน้าแบบฟอร์มตรวจสุขภาพประจำปีไม่เติมชื่อพื้นที่และชื่อเจ้าหน้าที่ของโรงพยาบาลเดิมเป็นค่าเริ่มต้น
- ตัวอย่าง `.env` ไม่ใส่ IP/บัญชีเดิม และใช้ชื่อตัวแปรฐานข้อมูลกับ CORS ที่โค้ดอ่านจริง สคริปต์ deploy จาก Windows ต้องระบุเครื่องและบัญชี SSH ทุกครั้ง

## ตรวจผ่าน

- `npm run check`: ชุดหลัก 231, AI 63, Vault 4, hospital DB 11 ผ่านทั้งหมด; server type check, ESLint และ frontend build ผ่าน และ `npm run build:all` ผ่าน
- ทดสอบตัวอัปเดตด้วย git/npm/PM2/curl จำลอง รวมกรณี PM2 app หาย, timeout, test fail และ rollback ผ่าน
- `git diff --check` ผ่าน

## ยังไม่ครบและควรทำต่อ

| ลำดับ | เรื่อง | หลักฐาน/ผลกระทบ |
| --- | --- | --- |
| สูง | Dependency security | `npm audit --omit=dev` พบ 11 รายการ: high 8, moderate 1, low 2; `xlsx` ไม่มี automated fix, `adm-zip` ต้องเปลี่ยนรุ่นใหญ่และทดสอบ ZIP import |
| สูง | ตัดลูกหนี้ให้เป็น transaction | `executeSettlement` สร้างเลขจาก `COUNT(*) + 1` และเขียน batch/items หลายคำสั่งโดยไม่มี transaction; คำขอพร้อมกันหรือข้อผิดพลาดกลางทางอาจชนเลขหรือเหลือข้อมูลบางส่วน ต้องออกแบบ unique constraint และ transaction ก่อนแก้ |
| สูง | ติดตั้งต่างรูปแบบ | Web updater ใช้ PM2 ตาม `FDH_PM2_APPS`; เครื่องที่ใช้ systemd อย่างเดียวหรือชื่อ app ต่างไปต้องปรับวิธีรัน/ตั้งค่าก่อนใช้ปุ่มอัปเดต |
| สูง | ความเป็นส่วนตัวและ audit | งาน data-retention, ตรวจข้อมูลจริงใน Git/history, append-only audit และ action-level permission ใน `BACKLOG.md` ยังไม่มีหลักฐานว่าปิดครบ |
| กลาง | ความเข้ากันได้รายโรงพยาบาล | ชุด hospital DB ใช้ schema/ข้อมูลจำลอง; PostgreSQL ยังไม่เทียบเท่า MySQL ทุกเมนูตาม `deploy/HOSPITAL_DATABASE.md`; ต้องทดสอบ OPD/IPD, กองทุน, export และค่าตั้งเฉพาะ site กับข้อมูลนิรนามของแต่ละแห่ง |
| ต่ำ | React hooks | ESLint ยังเตือน 3 จุดเรื่อง dependency ของ `useEffect` ในหน้าตรวจสุขภาพ, Dental Audit และ Receivable Settlement; ควรแก้พร้อมทดสอบพฤติกรรม reload/filter ของแต่ละหน้า |

ยังไม่ได้ deploy หรือเปลี่ยนฐานข้อมูลโรงพยาบาลจากการตรวจนี้ การผ่าน `npm run check` ไม่แทนการทดลอง update และ rollback บน staging Linux ที่ใช้ PM2 แบบเดียวกับ production
