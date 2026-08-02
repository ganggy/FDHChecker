---
ksp_schema: 1
project: FDHChecker
type: "ai-managed-knowledge"
category: "operations"
title: "นโยบายการจัดการ KSP Vault โดย FDH Local AI"
tags: ["ksp-vault","ai-management","portable-knowledge"]
source: "user-request"
managed_by: "FDH Local AI"
updated_by: "codex-initialization"
updated_at: "2026-08-02T07:54:16.243Z"
---

# นโยบายการจัดการ KSP Vault โดย FDH Local AI

## ขอบเขต

- AI อ่านความรู้จากทุกหมวดเพื่อช่วยตอบคำถามและวางแผน query แบบ read-only
- AI เพิ่มหรือปรับปรุงความรู้ได้เฉพาะในโฟลเดอร์ 70_AI_Managed
- Source snapshot ที่สร้างจากโค้ดและ config เป็นข้อมูลอ้างอิงและห้าม AI เขียนทับ
- ก่อนปรับปรุง note เดิมต้องเก็บ revision และเขียน audit log ทุกครั้ง
- ความรู้ใช้ Markdown + JSON metadata เพื่อย้ายไปใช้กับโปรแกรมอื่นได้
- การจัดการ Vault ไม่ให้สิทธิ์แก้ไขข้อมูลผู้ป่วยใน HOSxP
