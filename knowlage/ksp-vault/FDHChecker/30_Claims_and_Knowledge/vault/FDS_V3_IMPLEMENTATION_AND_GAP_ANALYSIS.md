---
ksp_schema: 1
project: FDHChecker
type: "domain-knowledge"
category: "claims"
source: "knowlage/vault/FDS_V3_IMPLEMENTATION_AND_GAP_ANALYSIS.md"
source_hash: "b0bd17d2cb7541161c0a5b102ef78d745c15bfe9ec8d87f99c1d088379fe9bd8"
managed_by: "sync-ksp-vault"
---
# วิเคราะห์ช่องว่างและการปรับปรุงระบบ FDH Checker สู่มาตรฐาน FDS v3.0.0 (Gap Analysis & Implementation Roadmap)

> **สรุปจาก:** การวิเคราะห์เปรียบเทียบระหว่างสถาปัตยกรรม FDH Checker ปัจจุบัน กับข้อกำหนด Financial Data Set (FDS v3.0.0.59 ปรับปรุงครั้งที่ 2 ปีงบ 2569)

---

## 1. การเปลี่ยนแปลงสำคัญเชิงโครงสร้าง (Architectural Paradigm Shift)

ระบบการเบิกจ่ายของกระทรวงสาธารณสุขกำลังก้าวจากการส่งออกแยกรูปแบบ (16 แฟ้ม DBF/TXT, CSOP/SSOP XML, AIPN/CIPN Zip) เข้าสู่ **Unified Financial Data Set (FDS API v3.0.0 JSON)** ซึ่งทำหน้าที่เป็น Single Payload ส่งตรงเข้า MOPH FDH Clearing House เพื่อแยกส่งต่อไปยังกองทุนสิทธิประโยชน์ต่าง ๆ โดยอัตโนมัติ

### ตารางเปรียบเทียบสถานะปัจจุบัน vs ข้อกำหนด FDS v3
| องค์ประกอบ | ระบบปัจจุบัน (Legacy / 16 แฟ้ม) | มาตรฐานใหม่ (FDS API v3.0.0.59) | การปรับปรุงที่ต้องทำใน FDH Checker |
| :--- | :--- | :--- | :--- |
| **รูปแบบ Payload** | แฟ้ม Text 16 แฟ้มคั่นด้วย `\|` หรือ XML | โครงสร้าง JSON ลำดับชั้น (Hierarchical JSON) | พัฒนา Export Engine สร้าง `FDS v3 JSON Payload` |
| **ช่องทางการส่ง** | FDH Web Portal หรือ FDH Upload API | Direct REST API `POST /fdh_api/v1/dataset/import` | เพิ่มช่องทางส่งตรงผ่าน FDS API (Bearer Token) |
| **การระบุตัวตนระบบ** | Session Cookie / User Login FDH | `hisSecret` (Token NewAuthenCode) + `hisSourceKey` (NHSO DP) + `hcode` | เพิ่มหน้าตั้งค่า API Credentials สำหรับ FDS ใน Settings |
| **การจัดการวันลา IPD** | บันทึกในแฟ้ม LVD (16 แฟ้ม) | ออบเจ็กต์ `encounter.ipd.leaveDay[]` พร้อมสรุป `totalLeaveDay` | ดึงข้อมูลจากตาราง `ipt_leave_day` ใน HOSxP เข้าโมเดล |
| **เคส Outlier IPD** | ไม่มีการ Flag ระดับ Encounter | ระบุ `orsFlag`, `orsType` (COST/LOS/BOTH), `outlierLosDays` | เพิ่มการคำนวณหรือดึง Flag Outlier จากระบบเวชระเบียน |
| **กองทุนเฉพาะทาง** | ส่งแยกช่องทาง (DMIS, NTIP, NAPS) | รวมใน Visit เดียวกันผ่าน `pren`, `cmhs`, `disa`, `dmis`, `ntip`, `napsAdvise` | พัฒนาโมดูลดึงข้อมูลเฉพาะทาง (Special Funds Pre-audit & Extractor) |
| **รหัสค่าใช้จ่ายย่อย** | CHA / CHD แบบ 16 แฟ้ม | `cha.items[]` ผูก `localCode`, `stdCode`, `codeSys` (TMT 24 หลัก, TMLT) | ทำ Standard Catalog Mapping (TMT/TMLT Validator) |

---

## 2. สิ่งที่ระบบ FDH Checker ต้องปรับปรุง (Actionable Checklist)

### 2.1 ส่วนของการตั้งค่าระบบ (Configuration & Credentials)
- [ ] **เพิ่มฟิลด์ตั้งค่า FDS v3 ในระบบ Config / Settings**:
  - `hisSecret`: Token หน่วยบริการจากระบบ NewAuthenCode สปสช. (client_secret)
  - `hisSourceKey`: Key จากการขึ้นทะเบียนระบบ NHSO Digital Platform (x-sourceid-key)
  - `hcode`: รหัสสถานพยาบาล 5 หลัก
  - `fdsApiUrl`: เลือกสลับระหว่าง UAT (`https://uat-fdh.inet.co.th`) และ Production
  - `fdsToken`: Provider Access Token สำหรับเรียกใช้งาน API

### 2.2 ส่วนของฐานข้อมูลและการสกัดข้อมูลจาก HOSxP (Query Extraction)
- [ ] **Encounter & Leave Day**:
  - ดึงข้อมูลการลากลับบ้านระหว่าง Admit จาก `ipt_leave_day` เพื่อสร้าง `encounter.ipd.leaveDay[]`
  - คำนวณ `totalLeaveDay` = ผลรวมของ `qtyDay`
  - ตรวจสอบ `encounter.clinical.bodyWeight` ให้มีค่าเสมอสำหรับเคส IPD
- [ ] **Special Funds Extractors**:
  - **ฝากครรภ์/คลอด (`pren`)**: ดึงจากตาราง `anc`, `ipt_pregnancy`, `baby` เพื่อระบุ `edc`, `gravida`, `lmp`, `pregnantWomenCid`, และ `nb[]`
  - **สุขภาพจิตชุมชน (`cmhs`)**: ดึงจากตารางคลินิกจิตเวช / คลินิกยาเสพติด / งานสุขภาพจิตชุมชน (SMI-V)
  - **คนพิการและฟื้นฟูฯ (`disa`)**: ดึงจากตาราง `person_deformed`, งานกายภาพบำบัด, งาน Intermediate Care (IMC)
  - **ไตเทียม (`dmis`)**: ดึงจากคลินิกฟอกไต / ตารางไตเทียมใน HOSxP
  - **วัณโรค (`ntip`)**: ดึงจากคลินิกวัณโรค (TB Clinic) รวมการจ่ายยา TB 19 หลัก
  - **HIV / เอดส์ (`napsAdvise`)**: ดึงจากคลินิกให้คำปรึกษาและยาต้านไวรัส (VCT/ARV Clinic)

### 2.3 ส่วนของ Pre-flight Error Guard (Zero-Error Export)
เพิ่มชุดกฎตรวจสอบความถูกต้องก่อนการส่งออกตามข้อกำหนด FDS v3:
1. **Rule FDS-001 (Metadata Integrity):**
   - ตรวจสอบ `hcode`, `hisSecret`, `hisSourceKey` ต้องไม่ว่างเปล่า
   - ตรวจสอบ `transactionId` ต้องถูกต้องตามรูปแบบ `hcode(5)-YYYYMMDDHHMMSS(14)-NNNNNN(6)` (รวม 27 หลัก)
   - ตรวจสอบ `totalVisits.total` ต้องเท่ากับจำนวน Record ใน `data[]` พอดี
2. **Rule FDS-002 (Identity & Demographics):**
   - ตรวจสอบ `idType` และเลขประจำตัว `id` (หาก `idType=1` ต้องตรวจ Mod 11 ของบัตรประชาชน 13 หลัก)
   - ตรวจสอบ `patient.maritalStatus` ต้องอยู่ในช่วง `1`-`6` หรือ `9`
   - ตรวจสอบ `patient.address.city` และ `district` ต้องเป็นรหัสมาตรฐาน 2 หลัก
3. **Rule FDS-003 (IPD Mandatory by Fund):**
   - หาก `inscl` เป็น `OFC` หรือ `SSS` ในเคส IPD: ฟิลด์ `dept`, `admType`, `admSource`, `wardDsc` ต้องไม่เป็นค่าว่าง
   - หาก `inscl` เป็น `UCS` ในเคส IPD: ฟิลด์ `svcType` ต้องระบุ (`I` หรือ `A`)
   - เคส IPD ทุกเคสต้องมี `bodyWeight` แรกรับ
4. **Rule FDS-004 (Charge Items & Coding System):**
   - ตรวจสอบ `chrgItem` ต้องเป็นหมวดมาตรฐาน 2 หลัก (`11`-`K1`)
   - ตรวจสอบรายการยา (`codeSys='TMT'`): `stdCode` ต้องเป็นรหัส TMT 24 หลัก
   - ตรวจสอบรายการ Lab (`codeSys='TMLT'`): `stdCode` ต้องเป็นรหัส TMLT ที่ถูกต้อง
5. **Rule FDS-005 (Special Modules Completeness):**
   - หากมีการส่งออบเจ็กต์ `pren`, `cmhs`, `disa`, `dmis`, `ntip`, `napsAdvise`: ทุกฟิลด์ที่เป็น `Req = Y` ภายในโมดูลนั้นต้องมีข้อมูลครบถ้วน ห้ามเป็น `null` หรือค่าว่าง

### 2.4 ส่วนของระบบกระทบยอด (Reconciliation & API Response Processing)
- [ ] **Clearing House Response Parser**:
  - รองรับการประมวลผลผลลัพธ์ตอบกลับจาก API FDS v3 (`Successful POST` 200/201 หรือ Error Details)
  - จัดเก็บสถานะการรับเข้าของ FDS Clearing House และผลการกระจายเคสไปยังกองทุนปลายทาง
  - แสดงผลในหน้าจอ Reconciliation Dashboard เพื่อเปรียบเทียบยอดเบิกและยอดรับชดเชยรอบ FDS v3

---

## 3. แผนการทดสอบและการดำเนินการ (Rollout Strategy)

1. **Phase 1 (Sandbox & Test Payload Generator):**
   - ใช้ชุดข้อมูลตัวอย่างจากโรงพยาบาลนำร่อง 15 แห่ง (อ้างอิง รพ.พหลพลพยุหเสนา, รพ.ราชบุรี) สร้าง Unit Test ตรวจสอบ JSON Schema
   - ทดสอบจำลองการส่งข้อมูลเข้า **UAT Environment** (`https://uat-fdh.inet.co.th/fdh_api/v1/dataset/import`)
2. **Phase 2 (Special Funds Extractor Validation):**
   - ตรวจสอบการดึงข้อมูล `pren`, `cmhs`, `disa` ร่วมกับทีมสารสนเทศและเวชระเบียน
3. **Phase 3 (Zero-Error Pre-flight Guard UI):**
   - อัปเดตหน้าต่างส่งออก FDH Checker ให้แสดงผลการตรวจเช็กทั้งแบบ 16 แฟ้ม และแบบ FDS v3 พร้อมปุ่ม Export JSON Payload
