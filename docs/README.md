# Documentation entry point

## คู่มือทั้งระบบ (22 กันยายน 2569)

- [ฉบับอ่านบนเว็บและพิมพ์](manual_system_overview.html)
- [PDF สำหรับแจกและอบรม](manual_system_overview.pdf)
- [ต้นฉบับ Markdown](FULL_SYSTEM_MANUAL.md)

คู่มือฉบับเต็มมี 32 บท ครอบคลุมการติดตั้ง ตั้งค่ารายโรงพยาบาล งาน OPD/IPD
เคลม กองทุน นำเข้าผล ลูกหนี้ รายงาน AI/LINE บริหารระบบ อัปเดต สำรอง
กู้คืน และแก้ปัญหา พร้อมดัชนีครบ 44 เมนูและ 52 กองทุนตามโค้ดที่ตรวจ
ระบุรายงานที่ยังต้องเชื่อมข้อมูลเพิ่มและข้อจำกัดของสคริปต์ติดตั้งอย่างชัดเจน

สร้างเอกสารซ้ำหลังแก้ต้นฉบับ:

```powershell
uv run --with markdown python scripts/build-system-manual.py
node scripts/render-system-manual.mjs
```

ตัวสร้าง HTML ตรวจเมนูตกหล่นและลิงก์เอกสารก่อนสร้าง ส่วน PDF ใช้ Playwright
กับ Edge บน Windows หรือ Chromium บนระบบอื่น ต้องตรวจภาพหน้า PDF อีกครั้ง
หลังเปลี่ยนเนื้อหาหรือรูปแบบ ตัวสร้างนี้ไม่เชื่อมฐานโรงพยาบาล

Choose documents by task. Current code, configuration, and tests establish
implemented behavior; documentation describes intent and operating procedures.
Resolve discrepancies explicitly rather than treating an old completion report
as the current project state.

| Task | Start here |
| --- | --- |
| Product scope and architecture overview | [Project README](../README.md) |
| Local development | [Quick start](../QUICK_START.md), [package scripts](../package.json) |
| Hospital setup and claim checks | [ตั้งค่ารายโรงพยาบาล](HOSPITAL_SETUP.md) |
| Remaining work | [Backlog](../BACKLOG.md) |
| Production deployment | [Deployment guide](../deploy/README.md) |
| Local AI and Ollama | [Local AI setup](../LOCAL_AI_SETUP_TH.md) |
| User workflows | [Manual by role](USER_MANUAL_BY_ROLE.md) |
| Mobile connectivity | [Mobile connection](MOBILE_CONNECTION.md) |
| Agent development conventions | [AGENTS.md](../AGENTS.md) |

## Historical reports

Root documents named `FINAL_*`, `COMPLETE_*`, `*_SUMMARY*`, and dated fix or
delivery reports are historical context unless their contents establish current
applicability. Read them when investigating that specific change. Their names
do not certify current test results or production readiness. Keep existing files
and links intact; update the relevant primary guide when behavior changes.

## AI changes identified in the September 2026 audit

Before evaluating a different OpenAI model, address the hardcoded reasoning
effort in `server/aiService.ts` and make its JSON option enforce an output schema
for query planning and Vault editing. Preserve the SQL validation boundary.
Compare models on the same synthetic questions, measuring answer correctness,
clarification frequency, latency, and usage. These are pending implementation
items, not completed changes or a requirement to replace Ollama.
