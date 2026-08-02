---
ksp_schema: 1
project: FDHChecker
type: "project-document"
category: "documentation"
source: "LOCAL_AI_SETUP_TH.md"
source_hash: "2c8087c82d9a7789ee271ddb5665d98ca958678b3a869782a131072632cd3e08"
managed_by: "sync-ksp-vault"
---
# FDHChecker Local AI (Ollama)

ระบบตั้งค่าให้ใช้ `qwen3:4b-instruct` ผ่าน Ollama เป็นค่าเริ่มต้น รุ่น Instruct เหมาะกับ chatbot และการสรุปรายงานมากกว่ารุ่น Thinking เพราะไม่ใช้ token กับ reasoning trace ยาว ข้อมูลคำถามและรายงานจึงประมวลผลในเครื่อง ไม่ต้องส่งไป OpenAI API

## เริ่มใช้งาน

```bash
ollama pull qwen3:4b-instruct
ollama ps
npm run server
npm run dev
```

ปรับ Ollama สำหรับ Mac RAM 16 GB ให้รองรับสองคำขอพร้อมกัน เปิด Flash Attention ใช้ KV cache แบบ q8 และเก็บโมเดลในหน่วยความจำ 30 นาที:

```bash
npm run ai:tune:mac
```

คำสั่งนี้จะรีสตาร์ตแอป Ollama และควรรันใหม่หลัง logout/reboot หากค่า environment ของ launchd ถูกล้าง

เปิด FDHChecker ที่ `http://localhost:3507` แล้วกดปุ่ม **AI** มุมขวาล่าง

## Session อัตโนมัติสำหรับหลายเครื่อง

สร้าง key ครั้งแรกบนเครื่อง Server คำสั่งจะเก็บ key ใน `.secrets/ai-access-key` ด้วยสิทธิ์อ่านเฉพาะเจ้าของ และคัดลอกค่าไว้ใน Clipboard โดยไม่แสดงค่าใน Terminal:

```bash
npm run ai:key:setup
```

จากเครื่องอื่นในเครือข่าย ให้เปิด FDHChecker ผ่าน IP ของ Mac mini เช่น `http://10.10.20.119:3507` แล้วกดปุ่ม **AI** ระบบจะสร้าง HttpOnly session cookie แยกสำหรับเครื่องนั้นโดยอัตโนมัติ ค่าเริ่มต้นมีอายุ 12 ชั่วโมง ไม่ต้องกรอก Access Key หาก `FDH_AI_TRUSTED_NETWORK_AUTO_LOGIN=true`

เมื่อเพิ่มระบบ Login ผู้ใช้จริงในอนาคต ให้หน้า Login ส่ง event `fdh:login` หลังเข้าสู่ระบบสำเร็จ ตัว AI assistant จะสร้าง session ใหม่ให้อัตโนมัติ

คัดลอก key เดิมกลับเข้า Clipboard:

```bash
npm run ai:key:copy
```

เปลี่ยน key และยกเลิก session เดิมทั้งหมด:

```bash
npm run ai:key:rotate
```

ระบบอื่นที่เรียก Backend โดยตรงส่ง key ผ่าน header โดยไม่ต้องสร้าง browser session:

```http
X-FDH-AI-Key: <access-key>
```

ห้าม commit โฟลเดอร์ `.secrets` และไม่ควรเปิดพอร์ต Ollama `11434` ให้เครื่องอื่นเข้าถึงโดยตรง ให้ทุกเครื่องเรียกผ่าน FDHChecker Backend เท่านั้น หากให้บริการผ่าน HTTPS ให้ตั้ง `FDH_AI_COOKIE_SECURE=true`

ตรวจสถานะ Backend และโมเดล:

```bash
curl http://localhost:3506/api/ai/status
```

หากต้องการกำหนดค่าเอง ให้เพิ่มใน `.env.local`:

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b-instruct
OLLAMA_CONTEXT_LENGTH=8192
OLLAMA_MAX_TOKENS=1200
OLLAMA_KEEP_ALIVE=30m
AI_TIMEOUT_MS=90000
AI_REPORT_MAX_ROWS=50
AI_AGENT_MAX_ROWS=200
AI_AGENT_QUERY_TIMEOUT_MS=15000
AI_CONVERSATION_TTL_MS=7200000
AI_CONVERSATION_MAX_SESSIONS=200
AI_CONVERSATION_MAX_TURNS=12
AI_RESPONSE_CACHE_MS=300000
AI_RESPONSE_CACHE_MAX=100
FDH_AI_SESSION_HOURS=12
FDH_AI_RATE_LIMIT_PER_MINUTE=120
FDH_AI_TRUSTED_NETWORK_AUTO_LOGIN=true
FDH_AI_COOKIE_SECURE=false
```

## API สำหรับ Chatbot

`POST /api/ai/chat`

```json
{
  "question": "การเบิกฟอกไตต้องตรวจสอบอะไรบ้าง"
}
```

Backend จะค้นเอกสาร `.md` และ `.txt` ใน Vault ก่อน แล้วส่งเฉพาะข้อความที่เกี่ยวข้องให้โมเดล คำตอบจะคืนรายการแหล่งข้อมูลด้วย

คำถามมาตรฐานจะใช้ Backend tool ที่กำหนดไว้ล่วงหน้า ส่วนคำถามใหม่ที่ไม่มี tool ตรงตัวจะเข้าสู่ **Read-only Conversational Agent** โมเดลทำหน้าที่วางแผนคำค้นจาก semantic catalog เท่านั้น ก่อนรันจริง Backend จะตรวจตารางและคำสั่งทุกครั้ง บังคับ `SELECT` ภายใน read-only transaction จำกัดเวลาและจำนวนแถว แล้ว rollback เสมอ โมเดลไม่มีสิทธิ์แก้ไขข้อมูลและไม่ได้รับรหัสผ่านฐานข้อมูล

Agent จำบริบทภายใน session เดียวกัน จึงถามต่อ เช่น `แล้วอันดับสองล่ะ` หรือ `ทำ Excel จากผลเมื่อกี้` ได้ หากช่วงเวลา เกณฑ์โรค หรือความหมายยังไม่ชัด ระบบจะถามกลับแทนการเดา ตัวอย่าง:

- `วันนี้คนไข้ OPD กี่คน`
- `ทำ Excel รายชื่อ OPD วันนี้`
- `ดูประวัติ HN 000123456`
- `ขอผลแล็บของ HN 000123456 เป็น Word`
- `ดูยาล่าสุด HN 000123456`
- `HN 000123456 มีนัดเมื่อไร`
- `วินิจฉัยและรายการยาของ VN 690802001234`
- `ค้นคนไข้ชื่อ สมชาย ใจดี`
- `มีคนไข้ HN ซ้ำกันในระบบหรือไม่`
- `ขอ Excel รายชื่อ CID เดียวกันแต่หลาย HN`
- `พรุ่งนี้คนไข้มีนัดซ้ำซ้อนกี่คน`
- `พรุ่งนี้มีนัดคลินิกอะไรบ้าง`
- `เมื่อวานเบิกครบหรือไม่`
- `ข้อมูลไม่สมบูรณ์เมื่อวานแผนกไหนผิดพลาดเยอะสุด`
- `เดือนที่แล้วคลินิกไหนมีผู้ป่วยมากที่สุด`
- `ผู้ป่วยเบาหวานที่ไม่มีผล HbA1c ใน 6 เดือนมีกี่คน`
- `แล้วแยกตามสิทธิให้ด้วย`
- `ทำ Excel จากผลเมื่อกี้`

รูปแบบไฟล์ที่ส่งออกได้คือ `.xlsx`, `.docx`, `.csv` และ `.json` โดยจำกัดจำนวนแถวผ่าน `AI_EXPORT_MAX_ROWS` (ค่าเริ่มต้น 2,000 และสูงสุด 5,000) เพื่อควบคุมหน่วยความจำ

## การเรียนรู้จากผู้ใช้

ใต้คำตอบของ AI มีปุ่ม `ถูกต้อง`, `ไม่ถูกต้อง` และ `จำวิธีนี้` ระบบเก็บ feedback ลงตาราง `ai_feedback` และเก็บรูปแบบคำถามใน `ai_learning_example` ของฐาน FDHChecker โดยไม่แก้ไข HOSxP

- `ถูกต้อง` เพิ่มคะแนน ตัวอย่างจะเปิดใช้เมื่อได้รับการยืนยันอย่างน้อย `AI_LEARNING_MIN_POSITIVE` ครั้ง
- `ไม่ถูกต้อง` ให้ผู้ใช้ระบุคำอธิบายที่ควรแก้ และหยุดใช้ตัวอย่างที่มีคะแนนลบ
- `จำวิธีนี้` เปิดใช้ทันทีเฉพาะกรณีที่มี SQL แบบอ่านอย่างเดียวซึ่งผ่าน validator แล้ว
- ก่อนสร้าง query ใหม่ ระบบค้นตัวอย่างที่คล้ายกันมาแนบให้ planner แต่บังคับให้ปรับวันที่และเงื่อนไขใหม่ ห้ามคัดลอกตัวเลขผลลัพธ์เดิม
- ผู้ดูแลตรวจรายการรออนุมัติได้จาก `GET /api/ai/learning/examples?status=pending` และอนุมัติหรือปฏิเสธด้วย `PATCH /api/ai/learning/examples/:id`

ระบบเรียนรู้วิธีตีความและค้นข้อมูล ไม่จดจำตัวเลขผู้ป่วยเป็นข้อเท็จจริงถาวร ข้อมูลจริงยังอ่านจาก HOSxP ใหม่ทุกครั้ง

## KSP Vault และ Obsidian

FDHChecker ใช้ Vault แบบ portable ที่ `knowlage/ksp-vault/FDHChecker` ประกอบด้วย Markdown, JSON manifest และ JSONL audit จึงนำทั้งโฟลเดอร์ไปใช้กับ Obsidian, chatbot หรือโปรแกรมอื่นได้โดยไม่ต้องแปลงฐานข้อมูลเฉพาะระบบ

สร้าง Vault ใหม่จากเอกสาร config และ source code ทั้งหมด:

```bash
npm run vault:sync
```

ค้นหา Obsidian Vault ชื่อ `ksp-vault` จากการตั้งค่า Obsidian และ sync เข้าไปอัตโนมัติ:

```bash
npm run vault:sync:obsidian
```

AI อ่านเงื่อนไขที่ค้นพบจาก KSP Vault ระหว่างวางแผน query และเพิ่มความรู้ได้เมื่อผู้ใช้สั่งอย่างชัดเจน เช่น `จำไว้ว่า...` หรือ `เพิ่มเงื่อนไขนี้ลง Vault` ความรู้ที่ AI สร้างจะอยู่ใน `70_AI_Managed` เท่านั้น การแก้ไขเดิมถูกเก็บใน `_ksp/ai-revisions` และ audit อยู่ที่ `_ksp/ai-audit.jsonl`

API สำหรับนำไปใช้กับโปรแกรมอื่น:

- `GET /api/ai/vault/search?q=...` ค้นความรู้
- `POST /api/ai/vault/note` เพิ่มหรือปรับปรุง note พร้อม revision
- `POST /api/ai/vault/reindex` สร้างดัชนีใหม่ทันที
- `GET /api/ai/vault/export` ดาวน์โหลด Vault ทั้งชุดเป็น ZIP

API ทั้งหมดต้องผ่าน FDHChecker login และ AI session/key การเขียน Vault ไม่สามารถแก้ไขข้อมูล HOSxP และไม่เขียนทับ source snapshot ที่สร้างจากโค้ด

## API สำหรับสรุปรายงาน

`POST /api/ai/summarize-report`

```json
{
  "title": "ยอดเบิกแยกตามกองทุน",
  "filters": {
    "month": "2026-07",
    "department": "OPD"
  },
  "rows": [
    { "fund": "UCS", "visit_count": 120, "amount": 450000 },
    { "fund": "SSS", "visit_count": 35, "amount": 98000 }
  ],
  "notes": "ตัวเลขคำนวณและตรวจสิทธิ์โดย Backend แล้ว"
}
```

ขอบเขตเพื่อประสิทธิภาพ:

- ส่งได้สูงสุด 50 แถว และ payload ไม่เกิน 80 KB
- Session ที่ผ่านการรับรองสามารถส่งฟิลด์ `hn`, `vn`, `an`, `cid`, ชื่อ และข้อมูลระดับผู้ป่วยได้ ระบบไม่บล็อกฟิลด์เหล่านี้
- Backend บันทึก audit metadata ได้แก่ session hash, route, status, เวลา และระยะเวลาทำงาน แต่ไม่บันทึก request body
- โมเดลไม่ได้รับ credential ของฐานข้อมูล และ SQL ที่โมเดลเสนอจะรันได้ต่อเมื่อผ่าน allowlist และตัวตรวจ read-only ของ Backend
- Agent ปฏิเสธคำขอแก้ไข ลบ เพิ่มข้อมูล, หลาย SQL statement, system schema, SQL variable, file function, lock และตารางนอก allowlist
- Dynamic query จำกัดผลลัพธ์ด้วย `AI_AGENT_MAX_ROWS` (สูงสุด 500) และ timeout ด้วย `AI_AGENT_QUERY_TIMEOUT_MS`
- คำตอบที่เหมือนกันจะ cache ในหน่วยความจำ 5 นาที สูงสุด 100 รายการ
- โมเดลถูกเก็บในหน่วยความจำ 30 นาทีเพื่อลดเวลาโหลดซ้ำ

## เลือกโมเดล

สำหรับ RAM 16 GB ให้เริ่มจาก `qwen3:4b-instruct` หากต้องการทดลอง 8B:

```bash
OLLAMA_MODEL=qwen3:8b npm run server
ollama ps
memory_pressure
```

หาก Memory Pressure เป็นสีเหลือง/แดงหรือเริ่มใช้ swap มาก ให้กลับมาใช้ 4B

## ทดสอบ

```bash
npm run test:ai
npm run build
```

LINE Bot ที่อยู่ในโปรเจกต์ใช้ AI provider เดียวกัน จึงเปลี่ยนมาใช้ Ollama อัตโนมัติเมื่อ `AI_PROVIDER=ollama` หรือละค่า `AI_PROVIDER` ไว้
