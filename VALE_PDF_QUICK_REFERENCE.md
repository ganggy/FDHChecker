# Vale PDF Quick Reference

เอกสารนี้สรุปเฉพาะข้อมูลสำคัญจาก PDF ที่เพิ่งเพิ่มเข้า Vale knowledge เพื่อใช้งานเร็วในงาน mapping/rules และ workflow การส่งเคลม

## Sources
- tmp_nhso_eclaim_api.pdf
- temp_ipd_form.pdf

## A) NHSO e-Claim API (จาก tmp_nhso_eclaim_api.pdf)

### 1) Authentication
| Item | Value |
|---|---|
| Method | POST |
| URL | https://nhsoapi.nhso.go.th/FMU/ecimp/v1/auth |
| Body | username, password |
| Success (200) | token |
| Error (4xx/5xx) | status, message |

### 2) Submit claim file set
| Item | Value |
|---|---|
| Method | POST |
| URL | https://nhsoapi.nhso.go.th/FMU/ecimp/v1/send |
| Header | Authorization: Bearer <token> |
| Header | User-Agent: <platform>/<version> <hcode> |

### 3) Required payload fields (core)
| Field | Type | Example | Note |
|---|---|---|---|
| fileType | string | txt | รองรับ dbf/txt |
| maininscl | string | UCS | สิทธิหลัก: UCS/OFC/LGO/SSS |
| dataTypes | array | ["IP","OP"] | ประเภทผู้ป่วย |
| opRefer | bool | false | OP Refer |
| importDup | bool | false | นำเข้าซ้ำเมื่อยังไม่ส่งเบิก |
| assignToMe | bool | false | ให้ข้อมูลแสดงเฉพาะผู้นำเข้า |

### 4) File object structure (ตัวอย่าง)
| Field | Required | Type | Example |
|---|---|---|---|
| blobName | Yes | string | INS.txt |
| blobType | Yes | string | text/plain |
| blob | Yes | string(base64) | SE58SU5T |
| size | Yes | int | 32 |
| encoding | Yes | string | UTF-8 |

หมายเหตุ: โครงสร้างนี้ใช้กับแฟ้มในกลุ่ม ins/pat และแฟ้มบริการที่เกี่ยวข้อง โดยบางแฟ้มในเอกสารเป็น Optional ตามชนิดข้อมูล

## B) IPD Audit / Coding Reference (จาก temp_ipd_form.pdf)

### 1) จุดเน้นสำหรับทีมงาน claim
| Topic | Key point |
|---|---|
| Medical Record Audit Form | มีทั้ง OPD/ER และ IPD |
| Discharge Summary | ต้องครบทั้ง Diagnosis/Operation และ Others |
| Treatment/Investigation | ต้องมีการบันทึกการรักษา/การตรวจอย่างเหมาะสม |
| Consultation/Operative report | เป็นเอกสารสำคัญที่ audit อ้างอิง |
| ICD coding | อ้างอิง ICD-10 และ ICD-9-CM |

### 2) Checklist ย่อก่อนส่งเคลม IPD
| Check | Why |
|---|---|
| มี Discharge Summary ครบ | ลดความเสี่ยงเอกสารถูกตีกลับ |
| ระบุ Dx/Procedure ตาม ICD มาตรฐาน | สอดคล้องเกณฑ์ audit และการเบิก |
| มีหลักฐาน Investigation สำคัญ | รองรับการพิจารณาทางคลินิก |
| มี Consultation/Operative report (ถ้ามี) | ลดช่องว่างเอกสารในเคสซับซ้อน |

## C) นำไปใช้กับงาน Vale/rules อย่างไรทันที
| งาน | ใช้ข้อมูลจาก PDF |
|---|---|
| Validation ก่อนส่งไฟล์เคลม | ใช้ API field requirements และ file object schema |
| แยก workflow IP/OP | ใช้ dataTypes, maininscl จากเอกสาร API |
| กำหนด pre-submit checks | ใช้ checklist Discharge Summary/ICD/Investigation |
| ลด reject จากเอกสารไม่ครบ | ใช้ audit reference เป็นเกณฑ์ตรวจภายใน |

## D) Scope note
- PDF ทั้งสองไฟล์นี้ไม่ได้มี mapping ลูกหนี้/รายได้แบบ debtor/revenue code โดยตรง
- จึงเหมาะกับการทำ validation + workflow + audit pre-check มากกว่าการเติม table mapping ทางบัญชีโดยตรง
