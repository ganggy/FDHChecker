---
ksp_schema: 1
project: FDHChecker
type: "project-document"
category: "documentation"
source: "LINE_BOT_SETUP.md"
source_hash: "1ee56c221d7d34b890c534e921ed7ec15260f4bd91007aa832b3724118560dcd"
managed_by: "sync-ksp-vault"
---
# LINE Knowledge Bot Setup

ระบบตอบคำถามจาก Vault ผ่าน LINE Official Account โดยตอบข้อความส่วนตัวทุกข้อความ และตอบในกลุ่มเฉพาะเมื่อผู้ใช้ mention ถึงบอทจริง

## 1. สร้าง LINE Messaging API channel

1. สร้างหรือเลือก LINE Official Account ใน LINE Developers Console
2. เปิดใช้งาน Messaging API
3. เปิด `Allow bot to join group chats` หากต้องการใช้ในกลุ่ม
4. ปิดข้อความตอบกลับอัตโนมัติที่อาจตอบซ้ำกับบอท

## 2. ตั้งค่าตัวแปรลับ

เพิ่มค่าต่อไปนี้ใน `.env.local` (ไฟล์นี้ไม่ถูก commit ขึ้น Git):

```env
LINE_CHANNEL_SECRET=ค่าจาก Basic settings
LINE_CHANNEL_ACCESS_TOKEN=ค่าจาก Messaging API
VAULT_PATH=/absolute/path/to/your/vault
```

`OPENAI_API_KEY` ถูกอ่านจาก `.env.local` เช่นกัน ค่าเริ่มต้นของ `VAULT_PATH` คือโฟลเดอร์โปรเจกต์ และอ่านไฟล์ `.md` กับ `.txt`

## 3. ตั้ง Webhook URL

รัน backend แล้วตั้ง URL ใน LINE Developers Console:

```text
https://your-public-domain.example/api/line/webhook
```

URL ต้องเป็น HTTPS ที่ LINE เข้าถึงได้ จากนั้นเปิด `Use webhook` และกด Verify

## 4. ตรวจสถานะ

```text
GET http://localhost:3506/api/line/status?reindex=true
```

ผลลัพธ์ `configured: true` หมายถึงมี credential ครบ ส่วน `vault.indexedFiles` และ `vault.chunks` แสดงจำนวนความรู้ที่จัดทำดัชนีแล้ว

## 5. ทดลอง

- ห้องส่วนตัว: ส่งคำถามได้โดยตรง
- ห้องกลุ่ม: เลือก mention LINE Official Account แล้วพิมพ์ `@ชื่อบอท คำถาม`

ระบบตรวจ mention จาก webhook (`isSelf: true`) ไม่ได้ตรวจเพียงข้อความที่ขึ้นต้นด้วยเครื่องหมาย `@` จึงไม่ตอบเมื่อผู้ใช้พิมพ์ชื่อเลียนแบบ mention

## ความปลอดภัย

- Webhook ทุกคำขอต้องผ่านการตรวจ `x-line-signature`
- คำตอบถูกสั่งให้ใช้เฉพาะหลักฐานจาก Vault และแสดงชื่อไฟล์อ้างอิง
- ไม่ควรเก็บข้อมูลผู้ป่วย เช่น HN ชื่อ หรือเลขบัตรประชาชนไว้ใน Vault
- ห้าม commit `.env.local` หรือส่งค่า token ผ่าน LINE
