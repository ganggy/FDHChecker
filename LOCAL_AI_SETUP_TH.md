# FDHChecker Local AI (Ollama)

ระบบตั้งค่าให้ใช้ `qwen3:4b-instruct` ผ่าน Ollama เป็นค่าเริ่มต้น รุ่น Instruct เหมาะกับ chatbot และการสรุปรายงานมากกว่ารุ่น Thinking เพราะไม่ใช้ token กับ reasoning trace ยาว ข้อมูลคำถามและรายงานจึงประมวลผลในเครื่อง ไม่ต้องส่งไป OpenAI API

## เริ่มใช้งาน

```bash
ollama pull qwen3:4b-instruct
ollama ps
npm run server
npm run dev
```

เปิด FDHChecker ที่ `http://localhost:3507` แล้วกดปุ่ม **AI** มุมขวาล่าง

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
OLLAMA_MAX_TOKENS=1000
AI_TIMEOUT_MS=90000
AI_REPORT_MAX_ROWS=50
```

## API สำหรับ Chatbot

`POST /api/ai/chat`

```json
{
  "question": "การเบิกฟอกไตต้องตรวจสอบอะไรบ้าง"
}
```

Backend จะค้นเอกสาร `.md` และ `.txt` ใน Vault ก่อน แล้วส่งเฉพาะข้อความที่เกี่ยวข้องให้โมเดล คำตอบจะคืนรายการแหล่งข้อมูลด้วย

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

ข้อจำกัดด้านความปลอดภัย:

- ส่งได้สูงสุด 50 แถว และ payload ไม่เกิน 80 KB
- API ปฏิเสธฟิลด์ผู้ป่วย เช่น `hn`, `vn`, `an`, `cid`, `patient_name`, วันเกิด ที่อยู่ และโทรศัพท์
- โมเดลไม่ได้รับ credential ของฐานข้อมูลและไม่มีเครื่องมือรัน SQL
- Backend ต้องคำนวณยอดและตรวจสิทธิ์ก่อนส่งข้อมูลสรุปให้โมเดล
- ใช้บัญชีฐานข้อมูลแบบ read-only และ database views สำหรับรายงาน

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
