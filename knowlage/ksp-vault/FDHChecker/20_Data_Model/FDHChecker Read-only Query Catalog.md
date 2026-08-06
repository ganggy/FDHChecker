---
ksp_schema: 1
project: FDHChecker
type: "query-catalog"
category: "data-model"
source: "server/**/*.ts"
source_hash: "987a8cb4aa6b354a5d68a5f9c80d94c147f66285ade1ce90c4f58684d926d03b"
managed_by: "sync-ksp-vault"
---
# FDHChecker Read-only Query Catalog

> รูปแบบ SELECT ที่สกัดจากระบบ FDHChecker อัตโนมัติ ใช้เป็นตัวอย่างวางแผนรายงานเท่านั้น
> ต้องตรวจ allowlist, ใช้ parameter และผ่าน Read-only SQL Validator ก่อนรันทุกครั้ง
> ห้ามนำ Query ในเอกสารนี้ไปใช้แก้ไขข้อมูล และห้ามเติมข้อมูลผู้ป่วยจากการคาดเดา

จำนวนรูปแบบ Query ที่ผ่านการตรวจ: 73

## 1. lookupLatestVnErrors — FDH / สถานะเคลม / ข้อผิดพลาด / ส่งเบิก / lookup Latest Vn Errors

- Source: `server/aiErrorTools.ts:50`
- Tables: `fdh_claim_status`
- Search terms: FDH, สถานะเคลม, ข้อผิดพลาด, ส่งเบิก, lookup Latest Vn Errors
- Query ID: `b429be3914ae`

```sql
SELECT vn, error_code, fdh_reservation_status, fdh_claim_status_message, updated_at
FROM fdh_claim_status
WHERE vn = ?
ORDER BY updated_at DESC, id DESC
LIMIT 1
```

## 2. getAppointmentClinicSummary — นัดหมาย / วันนัด / นัดซ้ำ / คลินิก / แผนก / หน่วยงาน / get Appointment Clinic Summary

- Source: `server/aiOperationalTools.ts:111`
- Tables: `oapp`, `clinic`, `kskdepartment`
- Search terms: นัดหมาย, วันนัด, นัดซ้ำ, คลินิก, แผนก, หน่วยงาน, get Appointment Clinic Summary
- Query ID: `da87a7915895`

```sql
SELECT COALESCE(NULLIF(c.name, ''), NULLIF(k.department, ''), NULLIF(a.clinic, ''), NULLIF(a.depcode, ''), 'ไม่ระบุคลินิก') AS clinic,
COUNT(*) AS appointmentCount,
COUNT(DISTINCT NULLIF(a.hn, '')) AS patientCount,
MIN(COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '')) AS firstTime,
MAX(COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '')) AS lastTime
FROM oapp a
LEFT JOIN clinic c ON c.clinic = a.clinic
LEFT JOIN kskdepartment k ON k.depcode = a.depcode
WHERE a.nextdate = ? AND COALESCE(a.oapp_status_id, 1) <> 4
GROUP BY clinic
ORDER BY appointmentCount DESC, clinic
```

## 3. getClaimCompleteness — FDH / สถานะเคลม / ข้อผิดพลาด / ส่งเบิก / OPD / ผู้ป่วยนอก / visit / รับบริการ

- Source: `server/aiOperationalTools.ts:140`
- Tables: `fdh_claim_status`, `ovst`
- Search terms: FDH, สถานะเคลม, ข้อผิดพลาด, ส่งเบิก, OPD, ผู้ป่วยนอก, visit, รับบริการ, get Claim Completeness
- Query ID: `f7ce716f9651`

```sql
SELECT o.vn,
COALESCE((SELECT s.transaction_uid FROM fdh_claim_status s WHERE s.vn = o.vn ORDER BY s.updated_at DESC LIMIT 1), '') AS transactionUid,
COALESCE((SELECT s.fdh_reservation_status FROM fdh_claim_status s WHERE s.vn = o.vn ORDER BY s.updated_at DESC LIMIT 1), '') AS reservationStatus,
COALESCE((SELECT s.fdh_claim_status_message FROM fdh_claim_status s WHERE s.vn = o.vn ORDER BY s.updated_at DESC LIMIT 1), '') AS statusMessage
FROM ovst o
WHERE o.vstdate = ? AND COALESCE(o.an, '') = '' AND COALESCE(o.vn, '') <> ''
```

## 4. getPatientIdentityDuplicates — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Identity Duplicates

- Source: `server/aiOperationalTools.ts:223`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, get Patient Identity Duplicates
- Query ID: `6c7b6600d023`

```sql
SELECT
(SELECT COUNT(*) FROM (
SELECT hn FROM patient WHERE COALESCE(hn, '') <> '' GROUP BY hn HAVING COUNT(*) > 1
) duplicate_hn) AS duplicateHnGroups,
(SELECT COUNT(*) FROM (
SELECT cid FROM patient
WHERE cid REGEXP '^[0-9]{13}$' AND cid <> '0000000000000' AND COALESCE(hn, '') <> ''
GROUP BY cid HAVING COUNT(DISTINCT hn) > 1
) duplicate_cid) AS duplicateCidGroups
```

## 5. getPatientIdentityDuplicates — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Identity Duplicates

- Source: `server/aiOperationalTools.ts:235`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, get Patient Identity Duplicates
- Query ID: `3b5cf882eb94`

```sql
SELECT 'HN ซ้ำหลาย record' AS duplicateType, p.hn AS duplicateKey,
COUNT(*) AS recordCount, p.hn AS hns,
GROUP_CONCAT(DISTINCT TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) SEPARATOR ' | ') AS patientNames
FROM patient p
WHERE COALESCE(p.hn, '') <> ''
GROUP BY p.hn
HAVING COUNT(*) > 1
UNION ALL
SELECT 'CID เดียวหลาย HN' AS duplicateType, p.cid AS duplicateKey,
COUNT(DISTINCT p.hn) AS recordCount,
GROUP_CONCAT(DISTINCT p.hn ORDER BY p.hn SEPARATOR ', ') AS hns,
GROUP_CONCAT(DISTINCT TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) SEPARATOR ' | ') AS patientNames
FROM patient p
WHERE p.cid REGEXP '^[0-9]{13}$' AND p.cid <> '0000000000000' AND COALESCE(p.hn, '') <> ''
GROUP BY p.cid
HAVING COUNT(DISTINCT p.hn) > 1
ORDER BY recordCount DESC, duplicateKey
LIMIT 500
```

## 6. getOpdCount — OPD / ผู้ป่วยนอก / visit / รับบริการ / get Opd Count

- Source: `server/aiReportTools.ts:235`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, get Opd Count
- Query ID: `1e7e470a9366`

```sql
SELECT
COUNT(DISTINCT NULLIF(TRIM(hn), '')) AS unique_patients,
COUNT(DISTINCT NULLIF(TRIM(vn), '')) AS visits
FROM ovst
WHERE vstdate BETWEEN ? AND ?
```

## 7. getOpdRows — OPD / ผู้ป่วยนอก / visit / รับบริการ / get Opd Rows

- Source: `server/aiReportTools.ts:267`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, get Opd Rows
- Query ID: `608ae1781d08`

```sql
SELECT COUNT(DISTINCT vn) AS total FROM ovst WHERE vstdate BETWEEN ? AND ?
```

## 8. getOpdRows — วินิจฉัย / ICD10 / diagnosis / OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย

- Source: `server/aiReportTools.ts:272`
- Tables: `ovstdiag`, `ovst`, `patient`, `vn_stat`, `pttype`, `clinic`
- Search terms: วินิจฉัย, ICD10, diagnosis, OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, สิทธิ, สิทธิการรักษา, คลินิก, นัดหมาย, get Opd Rows
- Query ID: `7c3a1a85b58d`

```sql
SELECT
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
TIME_FORMAT(o.vsttime, '%H:%i') AS serviceTime,
o.hn,
o.vn,
COALESCE(o.an, '') AS an,
CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
CASE COALESCE(v.sex, p.sex) WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' ELSE '' END AS sex,
COALESCE(v.age_y, TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate)) AS age,
COALESCE(pt.name, '') AS fund,
COALESCE(c.name, '') AS clinic,
COALESCE((SELECT d.icd10 FROM ovstdiag d WHERE d.vn = o.vn AND d.diagtype = '1' LIMIT 1), '') AS mainDiag
FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN pttype pt ON pt.pttype = o.pttype
LEFT JOIN clinic c ON c.clinic = o.main_dep
WHERE o.vstdate BETWEEN ? AND ?
ORDER BY o.vstdate DESC, o.vsttime DESC
LIMIT ?
```

## 9. patientHnFromIdentifier — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / patient Hn From Identifier

- Source: `server/aiReportTools.ts:309`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, patient Hn From Identifier
- Query ID: `97413100bccf`

```sql
SELECT hn FROM patient WHERE cid = ? LIMIT 1
```

## 10. patientHnFromIdentifier — OPD / ผู้ป่วยนอก / visit / รับบริการ / patient Hn From Identifier

- Source: `server/aiReportTools.ts:313`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, patient Hn From Identifier
- Query ID: `143ffd11e2a0`

```sql
SELECT hn FROM ovst WHERE vn = ? LIMIT 1
```

## 11. patientHnFromIdentifier — IPD / ผู้ป่วยใน / admit / AN / patient Hn From Identifier

- Source: `server/aiReportTools.ts:317`
- Tables: `ipt`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, patient Hn From Identifier
- Query ID: `664a4e9945ff`

```sql
SELECT hn FROM ipt WHERE an = ? LIMIT 1
```

## 12. getPatientProfileAndHistory — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Profile And History

- Source: `server/aiReportTools.ts:379`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, get Patient Profile And History
- Query ID: `5395726a13dc`

```sql
SELECT p.hn,
CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
DATE_FORMAT(p.birthday, '%Y-%m-%d') AS birthDate,
TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
CASE p.sex WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' ELSE '' END AS sex,
COALESCE(p.bloodgrp, '') AS bloodGroup,
COALESCE(p.cid, '') AS cid,
COALESCE(p.hometel, '') AS phone,
COALESCE(p.drugallergy, '') AS drugAllergy
FROM patient p
WHERE p.hn = ?
LIMIT 1
```

## 13. getPatientProfileAndHistory — วินิจฉัย / ICD10 / diagnosis / OPD / ผู้ป่วยนอก / visit / รับบริการ / สิทธิ

- Source: `server/aiReportTools.ts:397`
- Tables: `ovstdiag`, `ovst`, `pttype`, `clinic`
- Search terms: วินิจฉัย, ICD10, diagnosis, OPD, ผู้ป่วยนอก, visit, รับบริการ, สิทธิ, สิทธิการรักษา, คลินิก, นัดหมาย, get Patient Profile And History
- Query ID: `7547966fe7a0`

```sql
SELECT DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
TIME_FORMAT(o.vsttime, '%H:%i') AS serviceTime,
o.vn,
COALESCE(o.an, '') AS an,
COALESCE(pt.name, '') AS fund,
COALESCE(c.name, '') AS clinic,
COALESCE((SELECT d.icd10 FROM ovstdiag d WHERE d.vn = o.vn AND d.diagtype = '1' LIMIT 1), '') AS mainDiag
FROM ovst o
LEFT JOIN pttype pt ON pt.pttype = o.pttype
LEFT JOIN clinic c ON c.clinic = o.main_dep
WHERE o.hn = ?
ORDER BY o.vstdate DESC, o.vsttime DESC
LIMIT 20
```

## 14. getPatientProfileAndHistory — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / หอผู้ป่วย / ward

- Source: `server/aiReportTools.ts:413`
- Tables: `ipt`, `an_stat`, `ward`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, หอผู้ป่วย, ward, get Patient Profile And History
- Query ID: `983b20d875de`

```sql
SELECT i.an, DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admitDate,
DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dischargeDate,
COALESCE(w.name, '') AS ward, COALESCE(a.pdx, a.dx0, '') AS primaryDiagnosis
FROM ipt i
LEFT JOIN an_stat a ON a.an = i.an
LEFT JOIN ward w ON w.ward = i.ward
WHERE i.hn = ?
ORDER BY i.regdate DESC
LIMIT 10
```

## 15. getPatientLabs — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / get Patient Labs

- Source: `server/aiReportTools.ts:438`
- Tables: `lab_head`, `lab_order`, `lab_items`
- Search terms: ผลแล็บ, ห้องปฏิบัติการ, รายการตรวจ, ชื่อแล็บ, ค่าปกติ, get Patient Labs
- Query ID: `f2daca580610`

```sql
SELECT DATE_FORMAT(h.order_date, '%Y-%m-%d') AS serviceDate,
h.vn,
i.lab_items_name AS labName,
COALESCE(o.lab_order_result, '') AS result,
COALESCE(i.lab_items_normal_value, '') AS normalValue
FROM lab_head h
JOIN lab_order o ON o.lab_order_number = h.lab_order_number
JOIN lab_items i ON i.lab_items_code = o.lab_items_code
WHERE h.hn = ?
ORDER BY h.order_date DESC, h.lab_order_number DESC
LIMIT 50
```

## 16. getPatientMedications — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / OPD / ผู้ป่วยนอก / visit / รับบริการ

- Source: `server/aiReportTools.ts:461`
- Tables: `opitemrece`, `ovst`, `drugitems`, `s_drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, OPD, ผู้ป่วยนอก, visit, รับบริการ, drug, รหัสเบิก, ADP, get Patient Medications
- Query ID: `865de575a004`

```sql
SELECT DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS serviceDate,
o.vn, o.icode,
COALESCE(NULLIF(sd.name, ''), NULLIF(d.name, ''), o.icode) AS drugName,
COALESCE(o.qty, 0) AS qty,
COALESCE(o.unitprice, 0) AS unitPrice,
COALESCE(o.sum_price, o.qty * o.unitprice, 0) AS price
FROM opitemrece o
JOIN ovst v ON v.vn = o.vn
LEFT JOIN drugitems d ON d.icode = o.icode
LEFT JOIN s_drugitems sd ON sd.icode = o.icode
WHERE v.hn = ?
AND (d.icode IS NOT NULL OR sd.icode IS NOT NULL)
ORDER BY v.vstdate DESC, o.vn DESC
LIMIT 50
```

## 17. getPatientAppointments — นัดหมาย / วันนัด / นัดซ้ำ / คลินิก / แผนก / หน่วยงาน / get Patient Appointments

- Source: `server/aiReportTools.ts:487`
- Tables: `oapp`, `clinic`, `kskdepartment`
- Search terms: นัดหมาย, วันนัด, นัดซ้ำ, คลินิก, แผนก, หน่วยงาน, get Patient Appointments
- Query ID: `8fa811f87f77`

```sql
SELECT DATE_FORMAT(a.nextdate, '%Y-%m-%d') AS appointmentDate,
COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '') AS appointmentTime,
COALESCE(c.name, '') AS clinic,
COALESCE(k.department, '') AS department,
COALESCE(a.app_cause, '') AS appointmentCause
FROM oapp a
LEFT JOIN clinic c ON c.clinic = a.clinic
LEFT JOIN kskdepartment k ON k.depcode = a.depcode
WHERE a.hn = ? AND COALESCE(a.oapp_status_id, 1) <> 4
ORDER BY a.nextdate DESC, a.nexttime DESC
LIMIT 30
```

## 18. getVisitHeader — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/aiReportTools.ts:510`
- Tables: `ovst`, `patient`, `pttype`, `clinic`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, คลินิก, นัดหมาย, get Visit Header
- Query ID: `e7b818a0365c`

```sql
SELECT o.hn, o.vn, COALESCE(o.an, '') AS an,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
TIME_FORMAT(o.vsttime, '%H:%i') AS serviceTime,
CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patientName,
COALESCE(pt.name, '') AS fund, COALESCE(c.name, '') AS clinic
FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN pttype pt ON pt.pttype = o.pttype
LEFT JOIN clinic c ON c.clinic = o.main_dep
WHERE o.vn = ?
LIMIT 1
```

## 19. queryDailyWorkOverview — วินิจฉัย / ICD10 / diagnosis / ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / สปสช.

- Source: `server/dailyWorkOverview.ts:77`
- Tables: `ovstdiag`, `opitemrece`, `nhso_confirm_privilege`, `authenhos`, `visit_pttype`, `ovst`, `pttype`, `kskdepartment`
- Search terms: วินิจฉัย, ICD10, diagnosis, ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, สปสช., ยืนยันสิทธิ, authen, สิทธิ visit, auth code, OPD, ผู้ป่วยนอก, visit, รับบริการ, สิทธิ, สิทธิการรักษา, แผนก, หน่วยงาน, query Daily Work Overview
- Query ID: `33573c9a80f6`

```sql
SELECT
o.vn,
o.hn,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
IFNULL(o.pttype, '') AS pttype,
IFNULL(ptt.hipdata_code, '') AS hipdata_code,
(SELECT COUNT(*) FROM ovstdiag od WHERE od.vn = o.vn) AS diag_count,
(SELECT COUNT(*) FROM ovstdiag od WHERE od.vn = o.vn AND od.diagtype = '1') AS main_diag_count,
(SELECT COUNT(*) FROM opitemrece oi WHERE oi.vn = o.vn) AS charge_count,
(SELECT COALESCE(SUM(COALESCE(oi.sum_price, COALESCE(oi.unitprice, 0) * COALESCE(oi.qty, 0))), 0) FROM opitemrece oi WHERE oi.vn = o.vn) AS total_charge,
CASE WHEN EXISTS (
SELECT 1 FROM nhso_confirm_privilege ncp WHERE ncp.vn = o.vn AND ncp.nhso_status = 'Y' AND ncp.nhso_authen_code REGEXP '^EP'
) OR EXISTS (
SELECT 1 FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP'
) OR EXISTS (
SELECT 1 FROM visit_pttype vp WHERE vp.vn = o.vn AND vp.auth_code REGEXP '^EP'
) THEN 1 ELSE 0 END AS has_close_code,
COALESCE((
SELECT ncp.nhso_status
FROM nhso_confirm_privilege ncp
WHERE ncp.vn = o.vn
ORDER BY ncp.nhso_confirm_privilege_id DESC
LIMIT 1
), '') AS close_status
,COALESCE(o.main_dep, '') AS department_code
,COALESCE(k.department, '') AS department_name
FROM ovst o
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
WHERE o.vstdate = ?
AND IFNULL(o.an, '') = ''
ORDER BY o.vsttime, o.vn
```

## 20. getDoctorCodeByCid — แพทย์ / ผู้ตรวจ / get Doctor Code By Cid

- Source: `server/db.ts:2028`
- Tables: `doctor`
- Search terms: แพทย์, ผู้ตรวจ, get Doctor Code By Cid
- Query ID: `1dc7cf49acd4`

```sql
SELECT code
FROM doctor
WHERE cid = ?
LIMIT 1
```

## 21. getNhsoClosePrivilegeHistory — สปสช. / ยืนยันสิทธิ / get Nhso Close Privilege History

- Source: `server/db.ts:2345`
- Tables: `nhso_confirm_privilege`
- Search terms: สปสช., ยืนยันสิทธิ, get Nhso Close Privilege History
- Query ID: `873f7d63c498`

```sql
SELECT
nhso_confirm_privilege_id,
vn,
nhso_seq,
nhso_authen_code,
nhso_status,
nhso_total_amount,
nhso_privilege_amount,
nhso_cash_amount,
sourceID,
confirm_staff,
nhso_requst_datetime,
nhso_response_datetime,
nhso_reponse_json,
nhso_cancel_response
FROM nhso_confirm_privilege
ORDER BY COALESCE(nhso_response_datetime, nhso_requst_datetime) DESC, nhso_confirm_privilege_id DESC
LIMIT ?
```

## 22. existingRows — สปสช. / ยืนยันสิทธิ / existing Rows

- Source: `server/db.ts:2408`
- Tables: `nhso_confirm_privilege`
- Search terms: สปสช., ยืนยันสิทธิ, existing Rows
- Query ID: `ba43a420045c`

```sql
SELECT nhso_status, nhso_seq
FROM nhso_confirm_privilege
WHERE vn = ?
LIMIT 1
```

## 23. resolveRepVisitCode — IPD / ผู้ป่วยใน / admit / AN / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/db.ts:4292`
- Tables: `ipt`, `patient`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, resolve Rep Visit Code
- Query ID: `d252d4a59313`

```sql
SELECT i.an
FROM ipt i
JOIN patient pt ON pt.hn = i.hn
WHERE i.hn = ?
AND pt.cid = ?
AND (i.regdate = ? OR i.dchdate = ?)
ORDER BY i.an DESC
LIMIT 1
```

## 24. resolveRepVisitCode — IPD / ผู้ป่วยใน / admit / AN / resolve Rep Visit Code

- Source: `server/db.ts:4307`
- Tables: `ipt`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, resolve Rep Visit Code
- Query ID: `a750586c08fa`

```sql
SELECT an
FROM ipt
WHERE hn = ? AND (regdate = ? OR dchdate = ?)
ORDER BY an DESC
LIMIT 1
```

## 25. resolveRepVisitCode — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/db.ts:4323`
- Tables: `ovst`, `patient`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, resolve Rep Visit Code
- Query ID: `2d00e94fc3d6`

```sql
SELECT o.vn
FROM ovst o
JOIN patient pt ON pt.hn = o.hn
WHERE o.hn = ?
AND pt.cid = ?
AND o.vstdate = ?
ORDER BY o.vn DESC
LIMIT 1
```

## 26. resolveRepVisitCode — OPD / ผู้ป่วยนอก / visit / รับบริการ / resolve Rep Visit Code

- Source: `server/db.ts:4338`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, resolve Rep Visit Code
- Query ID: `e1b8826bbfc5`

```sql
SELECT vn
FROM ovst
WHERE hn = ? AND vstdate = ?
ORDER BY vn DESC
LIMIT 1
```

## 27. resolveRepIncome — สถิติ IPD / วินิจฉัยผู้ป่วยใน / resolve Rep Income

- Source: `server/db.ts:4357`
- Tables: `an_stat`
- Search terms: สถิติ IPD, วินิจฉัยผู้ป่วยใน, resolve Rep Income
- Query ID: `5992c59ac725`

```sql
SELECT ROUND(IFNULL(income, 0) - IFNULL(discount_money, 0) - IFNULL(rcpt_money, 0), 2) AS income
FROM an_stat
WHERE an = ?
LIMIT 1
```

## 28. resolveRepIncome — สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / resolve Rep Income

- Source: `server/db.ts:4368`
- Tables: `vn_stat`
- Search terms: สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, resolve Rep Income
- Query ID: `c55a2c4f573c`

```sql
SELECT ROUND(IFNULL(income, 0) - IFNULL(discount_money, 0) - IFNULL(rcpt_money, 0), 2) AS income
FROM vn_stat
WHERE vn = ?
LIMIT 1
```

## 29. getReceivableFilterOptions — สิทธิ / สิทธิการรักษา / get Receivable Filter Options

- Source: `server/db.ts:5422`
- Tables: `pttype`
- Search terms: สิทธิ, สิทธิการรักษา, get Receivable Filter Options
- Query ID: `9cfa59a51803`

```sql
SELECT pttype AS code, name, hipdata_code
FROM pttype
ORDER BY pttype
```

## 30. getRepDailyClaimSummary — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / ผู้ป่วย

- Source: `server/db.ts:6975`
- Tables: `ovst`, `vn_stat`, `patient`, `pttype`, `kskdepartment`, `spclty`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, แผนก, หน่วยงาน, get Rep Daily Claim Summary
- Query ID: `96eecec59b48`

```sql
SELECT
o.vn AS visit_code,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
COALESCE(v.income, 0) AS expected_amount,
o.hn,
pt.cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
thaiage(pt.birthday, o.vstdate) AS age,
o.pttype,
ptt.name AS pttype_name,
k.department AS department,
sp.name AS clinic
FROM ovst o
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN patient pt ON pt.hn = o.hn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
LEFT JOIN spclty sp ON sp.spclty = o.spclty
WHERE o.vstdate BETWEEN ? AND ?
AND COALESCE(v.income, 0) > 0
```

## 31. getRepDailyClaimSummary — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / สิทธิ / สิทธิการรักษา

- Source: `server/db.ts:7020`
- Tables: `ipt`, `an_stat`, `pttype`, `patient`, `ward`, `spclty`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, สิทธิ, สิทธิการรักษา, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, หอผู้ป่วย, ward, get Rep Daily Claim Summary
- Query ID: `3f1fe3be386e`

```sql
SELECT
i.an AS visit_code,
DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%Y-%m-%d') AS service_date,
i.hn,
pt.cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
thaiage(pt.birthday, COALESCE(i.dchdate, i.regdate)) AS age,
i.pttype,
ptt.name AS pttype_name,
w.name AS department,
sp.name AS clinic,
CASE
WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
END AS expected_amount
FROM ipt i
LEFT JOIN an_stat a ON a.an = i.an
LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
LEFT JOIN patient pt ON pt.hn = i.hn
LEFT JOIN ward w ON w.ward = i.ward
LEFT JOIN spclty sp ON sp.spclty = i.spclty
WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
AND (
CASE
WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
END
) > 0
```

## 32. getRepDailyVisitsForDate — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / ผู้ป่วย

- Source: `server/db.ts:7224`
- Tables: `ovst`, `vn_stat`, `patient`, `pttype`, `kskdepartment`, `spclty`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, แผนก, หน่วยงาน, get Rep Daily Visits For Date
- Query ID: `c2de2e8a3030`

```sql
SELECT
o.vn AS visit_code,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
COALESCE(v.income, 0) AS expected_amount,
o.hn,
pt.cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
thaiage(pt.birthday, o.vstdate) AS age,
o.pttype,
ptt.name AS pttype_name,
k.department AS department,
sp.name AS clinic
FROM ovst o
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN patient pt ON pt.hn = o.hn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
LEFT JOIN spclty sp ON sp.spclty = o.spclty
WHERE o.vstdate = ?
AND COALESCE(v.income, 0) > 0
ORDER BY o.vsttime, o.vn
```

## 33. getRepDailyVisitsForDate — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / สิทธิ / สิทธิการรักษา

- Source: `server/db.ts:7270`
- Tables: `ipt`, `an_stat`, `pttype`, `patient`, `ward`, `spclty`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, สิทธิ, สิทธิการรักษา, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, หอผู้ป่วย, ward, get Rep Daily Visits For Date
- Query ID: `135834c28165`

```sql
SELECT
i.an AS visit_code,
DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%Y-%m-%d') AS service_date,
i.hn,
pt.cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
thaiage(pt.birthday, COALESCE(i.dchdate, i.regdate)) AS age,
i.pttype,
ptt.name AS pttype_name,
w.name AS department,
sp.name AS clinic,
CASE
WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
END AS expected_amount
FROM ipt i
LEFT JOIN an_stat a ON a.an = i.an
LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
LEFT JOIN patient pt ON pt.hn = i.hn
LEFT JOIN ward w ON w.ward = i.ward
LEFT JOIN spclty sp ON sp.spclty = i.spclty
WHERE COALESCE(i.dchdate, i.regdate) = ?
AND (
CASE
WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
END
) > 0
ORDER BY COALESCE(i.dchdate, i.regdate), i.an
```

## 34. getRepDailyVisitDetail — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/db.ts:7401`
- Tables: `ovst`, `patient`, `pttype`, `kskdepartment`, `spclty`, `opdscreen`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, แผนก, หน่วยงาน, คัดกรอง, อาการ, ความดัน, น้ำหนัก, get Rep Daily Visit Detail
- Query ID: `8da7cfda4b12`

```sql
SELECT
o.vn, NULL AS an, o.hn, pt.cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
thaiage(pt.birthday, o.vstdate) AS age,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
TIME_FORMAT(o.vsttime, '%H:%i') AS service_time,
o.pttype, ptt.name AS pttype_name,
k.department AS department,
sp.name AS clinic,
os.cc, os.bps, os.bpd, os.bw, os.height, os.temperature, os.pulse
FROM ovst o
LEFT JOIN patient pt ON pt.hn = o.hn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
LEFT JOIN spclty sp ON sp.spclty = o.spclty
LEFT JOIN opdscreen os ON os.vn = o.vn
WHERE o.vn = ?
LIMIT 1
```

## 35. getRepDailyVisitDetail — วินิจฉัย / ICD10 / diagnosis / ชื่อโรค / get Rep Daily Visit Detail

- Source: `server/db.ts:7424`
- Tables: `ovstdiag`, `icd101`
- Search terms: วินิจฉัย, ICD10, diagnosis, ชื่อโรค, get Rep Daily Visit Detail
- Query ID: `831e385fce58`

```sql
SELECT d.diagtype, d.icd10, i.name AS code_name
FROM ovstdiag d
LEFT JOIN icd101 i ON i.code = d.icd10
WHERE d.vn = ?
ORDER BY d.diagtype, d.icd10
```

## 36. getRepDailyVisitDetail — หัตถการ / ICD9 / ชื่อหัตถการ / get Rep Daily Visit Detail

- Source: `server/db.ts:7434`
- Tables: `doctor_operation`, `icd9cm1`, `er_regist_oper`, `er_oper_code`
- Search terms: หัตถการ, ICD9, ชื่อหัตถการ, get Rep Daily Visit Detail
- Query ID: `15798051e398`

```sql
SELECT o.icd9, i.name AS code_name, 'doctor_operation' AS source
FROM doctor_operation o
LEFT JOIN icd9cm1 i ON i.code = o.icd9
WHERE o.vn = ?
UNION ALL
SELECT eo.er_oper_code AS icd9, e.name AS code_name, 'er_regist_oper' AS source
FROM er_regist_oper eo
LEFT JOIN er_oper_code e ON e.er_oper_code = eo.er_oper_code
WHERE eo.vn = ?
```

## 37. getRepDailyVisitDetail — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / get Rep Daily Visit Detail

- Source: `server/db.ts:7448`
- Tables: `lab_head`, `lab_order`, `lab_items`
- Search terms: ผลแล็บ, ห้องปฏิบัติการ, รายการตรวจ, ชื่อแล็บ, ค่าปกติ, get Rep Daily Visit Detail
- Query ID: `62373851de48`

```sql
SELECT h.order_date, li.lab_items_name, lo.lab_order_result, li.lab_items_normal_value
FROM lab_head h
JOIN lab_order lo ON lo.lab_order_number = h.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
WHERE h.vn = ?
AND lo.lab_order_result IS NOT NULL
AND lo.lab_order_result <> ''
ORDER BY h.order_date DESC, li.lab_items_name
LIMIT 200
```

## 38. getRepDailyVisitDetail — IPD / ผู้ป่วยใน / admit / AN / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/db.ts:7462`
- Tables: `ipt`, `patient`, `pttype`, `ward`, `spclty`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, หอผู้ป่วย, ward, get Rep Daily Visit Detail
- Query ID: `6b57b8276052`

```sql
SELECT
i.vn, i.an, i.hn, pt.cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
thaiage(pt.birthday, COALESCE(i.dchdate, i.regdate)) AS age,
DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admit_date,
TIME_FORMAT(i.regtime, '%H:%i') AS admit_time,
DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS discharge_date,
TIME_FORMAT(i.dchtime, '%H:%i') AS discharge_time,
i.pttype, ptt.name AS pttype_name,
w.name AS department,
sp.name AS clinic
FROM ipt i
LEFT JOIN patient pt ON pt.hn = i.hn
LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
LEFT JOIN ward w ON w.ward = i.ward
LEFT JOIN spclty sp ON sp.spclty = i.spclty
WHERE i.an = ?
LIMIT 1
```

## 39. getRepDailyVisitDetail — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / IPD / ผู้ป่วยใน / admit

- Source: `server/db.ts:7505`
- Tables: `lab_head`, `lab_order`, `lab_items`, `ipt`
- Search terms: ผลแล็บ, ห้องปฏิบัติการ, รายการตรวจ, ชื่อแล็บ, ค่าปกติ, IPD, ผู้ป่วยใน, admit, AN, get Rep Daily Visit Detail
- Query ID: `1f5a6032f681`

```sql
SELECT h.order_date, li.lab_items_name, lo.lab_order_result, li.lab_items_normal_value
FROM lab_head h
JOIN lab_order lo ON lo.lab_order_number = h.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
WHERE (h.vn = ? OR h.vn = (SELECT vn FROM ipt WHERE an = ? LIMIT 1))
AND lo.lab_order_result IS NOT NULL
AND lo.lab_order_result <> ''
ORDER BY h.order_date DESC, li.lab_items_name
LIMIT 200
```

## 40. getInsuranceOverview — authen / ยืนยันสิทธิ / OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก

- Source: `server/db.ts:8092`
- Tables: `authenhos`, `ovst`, `vn_stat`, `nhso_confirm_privilege`
- Search terms: authen, ยืนยันสิทธิ, OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, สปสช., get Insurance Overview
- Query ID: `e79a89f42c8c`

```sql
SELECT
DATE_FORMAT(o.vstdate, '%Y-%m') AS month,
COUNT(*) AS visit_count,
ROUND(SUM(COALESCE(v.income, 0)), 2) AS total_income,
SUM(
CASE
WHEN IFNULL(ncp.nhso_status, '') = 'Y'
OR IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
OR IFNULL((SELECT claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1), '') <> ''
THEN 1 ELSE 0
END
) AS closed_count
FROM ovst o
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN nhso_confirm_privilege ncp ON ncp.vn = o.vn
WHERE o.vstdate BETWEEN ? AND ?
GROUP BY DATE_FORMAT(o.vstdate, '%Y-%m')
ORDER BY month
```

## 41. getInsuranceOverview — authen / ยืนยันสิทธิ / OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้

- Source: `server/db.ts:8114`
- Tables: `authenhos`, `ovst`, `patient`, `vn_stat`, `pttype`, `nhso_confirm_privilege`
- Search terms: authen, ยืนยันสิทธิ, OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, สิทธิ, สิทธิการรักษา, สปสช., get Insurance Overview
- Query ID: `8679c3f1dcfb`

```sql
SELECT
o.vn,
o.hn,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
DATE_FORMAT(o.vstdate, '%Y-%m') AS month,
COALESCE(v.income, 0) AS income,
ptt.pttype,
ptt.name AS pttype_name,
ptt.hipdata_code,
CASE
WHEN IFNULL(ncp.nhso_status, '') = 'Y'
OR IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
OR IFNULL((SELECT claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1), '') <> ''
THEN 1 ELSE 0
END AS close_completed,
COALESCE(
NULLIF(ncp.nhso_authen_code, ''),
(SELECT claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1)
) AS close_code
FROM ovst o
LEFT JOIN patient pt ON pt.hn = o.hn
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
LEFT JOIN nhso_confirm_privilege ncp ON ncp.vn = o.vn
WHERE o.vstdate BETWEEN ? AND ?
ORDER BY o.vstdate DESC, o.vn DESC
```

## 42. getInsuranceOverview — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / ผู้ป่วย / คนไข้

- Source: `server/db.ts:8145`
- Tables: `ipt`, `an_stat`, `patient`, `pttype`, `fdh_claim_status`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, FDH, สถานะเคลม, ข้อผิดพลาด, ส่งเบิก, get Insurance Overview
- Query ID: `55005064d56e`

```sql
SELECT
i.an,
i.vn,
i.hn,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admdate,
DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dchdate,
DATE_FORMAT(i.dchdate, '%Y-%m') AS month,
COALESCE(a.income, 0) AS income,
COALESCE(a.rcpt_money, 0) AS rcpt_money,
COALESCE(a.discount_money, 0) AS discount_money,
ptt.pttype,
ptt.name AS pttype_name,
ptt.hipdata_code,
fdh.transaction_uid,
fdh.fdh_reservation_status,
fdh.fdh_reservation_datetime,
fdh.fdh_claim_status_message,
fdh.error_code,
fdh.fdh_stm_period,
fdh.fdh_act_amt,
fdh.fdh_settle_at,
fdh.updated_at AS fdh_updated_at
FROM ipt i
LEFT JOIN an_stat a ON a.an = i.an
LEFT JOIN patient pt ON pt.hn = i.hn
LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
LEFT JOIN (
SELECT s.*
FROM fdh_claim_status s
JOIN (
SELECT vn, MAX(updated_at) AS max_updated_at
FROM fdh_claim_status
WHERE IFNULL(vn, '') <> ''
GROUP BY vn
) latest ON latest.vn = s.vn AND latest.max_updated_at = s.updated_at
) fdh ON fdh.vn = i.vn
WHERE i.dchdate BETWEEN ? AND ?
ORDER BY i.dchdate DESC, i.an DESC
```

## 43. validateCheckCompletenesss — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / validate Check Completenesss

- Source: `server/db.ts:9978`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, validate Check Completenesss
- Query ID: `b010f56c81e0`

```sql
SELECT fname, lname, pttype FROM patient WHERE hn = ?
```

## 44. validateCheckCompletenesss — OPD / ผู้ป่วยนอก / visit / รับบริการ / validate Check Completenesss

- Source: `server/db.ts:9988`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, validate Check Completenesss
- Query ID: `ae320d2586c8`

```sql
SELECT vn, vstdate, ovstost FROM ovst WHERE vn = ? AND hn = ?
```

## 45. validateCheckCompletenesss — วินิจฉัย / ICD10 / diagnosis / validate Check Completenesss

- Source: `server/db.ts:9998`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, validate Check Completenesss
- Query ID: `e6f55619aadc`

```sql
SELECT COUNT(*) as count FROM ovstdiag WHERE vn = ?
```

## 46. validateCheckCompletenesss — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / validate Check Completenesss

- Source: `server/db.ts:10008`
- Tables: `opitemrece`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, validate Check Completenesss
- Query ID: `00184c8f5271`

```sql
SELECT COUNT(*) as count FROM opitemrece WHERE vn = ?
```

## 47. getDrugPrices — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / drug / รหัสเบิก / ADP / get Drug Prices

- Source: `server/db.ts:10039`
- Tables: `opitemrece`, `drugitems`, `s_drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, drug, รหัสเบิก, ADP, get Drug Prices
- Query ID: `54fb5305c926`

```sql
SELECT
opitemrece.icode,
COALESCE(s_drugitems.name, drugitems.name, opitemrece.icode) as drugName,
opitemrece.qty,
opitemrece.unitprice as unitPrice,
(opitemrece.qty * opitemrece.unitprice) as price,
s_drugitems.nhso_adp_code,
s_drugitems.tmlt_code,
s_drugitems.ttmt_code,
CASE
WHEN s_drugitems.nhso_adp_code IS NOT NULL AND s_drugitems.nhso_adp_code != ''
THEN 1
ELSE 0
END as has_adp_mapping
FROM opitemrece
INNER JOIN drugitems ON opitemrece.icode = drugitems.icode
LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
WHERE opitemrece.vn = ?
ORDER BY opitemrece.icode
```

## 48. getVisitChargeItems — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / หมวดค่าใช้จ่าย / รายได้ / drug / รหัสเบิก

- Source: `server/db.ts:10076`
- Tables: `opitemrece`, `income`, `drugitems`, `s_drugitems`, `nondrugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, หมวดค่าใช้จ่าย, รายได้, drug, รหัสเบิก, ADP, หัตถการ, get Visit Charge Items
- Query ID: `b5d55e8f1385`

```sql
SELECT
oo.icode,
COALESCE(NULLIF(sd.name, ''), NULLIF(di.name, ''), NULLIF(ndi.name, ''), oo.icode) AS drugName,
COALESCE(inc.name, '') AS incomeName,
CASE
WHEN di.icode IS NOT NULL OR sd.icode IS NOT NULL THEN 'ยา'
WHEN ndi.icode IS NOT NULL THEN 'เวชภัณฑ์/ค่าบริการ'
ELSE 'รายการอื่น'
END AS itemType,
COALESCE(oo.qty, 0) AS qty,
COALESCE(oo.unitprice, 0) AS unitPrice,
COALESCE(oo.sum_price, oo.qty * oo.unitprice, 0) AS price,
COALESCE(sd.nhso_adp_code, '') AS adp_code,
COALESCE(sd.ttmt_code, di.ttmt_code, '') AS nhso_code,
CASE WHEN COALESCE(sd.nhso_adp_code, '') <> '' THEN 1 ELSE 0 END AS has_adp_mapping
FROM opitemrece oo
LEFT JOIN income inc ON inc.income = oo.income
LEFT JOIN drugitems di ON di.icode = oo.icode
LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
WHERE oo.vn = ?
ORDER BY oo.income, oo.icode
```

## 49. getServiceADPCodes — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / หมวดค่าใช้จ่าย / รายได้ / รหัสเบิก / ADP

- Source: `server/db.ts:10114`
- Tables: `opitemrece`, `income`, `s_drugitems`, `nondrugitems`, `drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, หมวดค่าใช้จ่าย, รายได้, รหัสเบิก, ADP, หัตถการ, drug, get Service ADPCodes
- Query ID: `445c0dc14a83`

```sql
SELECT DISTINCT
opitemrece.icode,
opitemrece.income,
income.name as income_name,
COALESCE(nondrugitems.name, opitemrece.icode) as adp_name,
opitemrece.unitprice as adp_price,
s_drugitems.nhso_adp_code as adp_code,
CASE
WHEN s_drugitems.nhso_adp_code IS NOT NULL AND s_drugitems.nhso_adp_code != ''
THEN 1
ELSE 0
END as can_claim
FROM opitemrece
LEFT JOIN income ON opitemrece.income = income.income
LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
LEFT JOIN nondrugitems ON opitemrece.icode = nondrugitems.icode
WHERE opitemrece.vn = ?
AND opitemrece.income IS NOT NULL
AND opitemrece.icode NOT IN (
SELECT icode FROM drugitems
)
ORDER BY opitemrece.income
```

## 50. getReceiptItems — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / หมวดค่าใช้จ่าย / รายได้ / รหัสเบิก / ADP

- Source: `server/db.ts:10153`
- Tables: `opitemrece`, `income`, `s_drugitems`, `drugitems`, `nondrugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, หมวดค่าใช้จ่าย, รายได้, รหัสเบิก, ADP, drug, หัตถการ, get Receipt Items
- Query ID: `102cd1735946`

```sql
SELECT
opitemrece.vn,
opitemrece.hn,
opitemrece.an,
opitemrece.icode,
opitemrece.qty,
opitemrece.unitprice,
opitemrece.sum_price,
opitemrece.discount,
opitemrece.vstdate,
opitemrece.income,
income.name as income_name,
income.income_group,
-- ชื่อรายการจากตารางต่างๆ
COALESCE(s_drugitems.name, drugitems.name, nondrugitems.name, opitemrece.icode) as item_name,
-- ข้อมูลจาก s_drugitems (รหัสต่างๆ)
s_drugitems.nhso_adp_code,
s_drugitems.tmlt_code,
s_drugitems.ttmt_code,
s_drugitems.name as s_drugname,
s_drugitems.ename as s_drugname_en,
s_drugitems.strength as s_strength,
s_drugitems.units as s_units,
-- จำแนกประเภทรายการ
CASE
WHEN s_drugitems.icode IS NOT NULL THEN 'ยา (s_drugitems)'
WHEN drugitems.icode IS NOT NULL THEN 'ยา (drugitems)'
WHEN nondrugitems.icode IS NOT NULL THEN 'เวชภัณฑ์'
WHEN income.income_group = 'DRUG' THEN 'ยา'
WHEN income.income_group = 'LAB' THEN 'การตรวจวิเคราะห์'
WHEN income.income_group = 'XRAY' THEN 'การตรวจเอกซเรย์'
WHEN income.income_group = 'TREAT' THEN 'การรักษา'
ELSE 'บริการอื่นๆ'
END as item_type,
-- สถานะการเบิก/เคลม
CASE
WHEN s_drugitems.nhso_adp_code IS NOT NULL AND s_drugitems.nhso_adp_code != '' THEN 1
ELSE 0
END as has_nhso_adp,
CASE
WHEN s_drugitems.tmlt_code IS NOT NULL AND s_drugitems.tmlt_code != '' THEN 1
ELSE 0
END as has_tmlt,
CASE
WHEN s_drugitems.ttmt_code IS NOT NULL AND s_drugitems.ttmt_code != '' THEN 1
ELSE 0
END as has_ttmt
FROM opitemrece
LEFT JOIN income ON opitemrece.income = income.income
LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
LEFT JOIN drugitems ON opitemrece.icode = drugitems.icode
LEFT JOIN nondrugitems ON opitemrece.icode = nondrugitems.icode
WHERE opitemrece.vn = ?
ORDER BY opitemrece.income, opitemrece.icode
```

## 51. getPatientData — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Data

- Source: `server/db.ts:10253`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, get Patient Data
- Query ID: `c67b815d518f`

```sql
SELECT
hn,
CONCAT(COALESCE(pname, ''), COALESCE(fname, ''), ' ', COALESCE(lname, '')) as patientName,
birthday as birthDate,
sex as gender,
citizenship as nationality,
cid as cardId
FROM patient
WHERE hn = ?
```

## 52. testDatabaseConnection — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / test Database Connection

- Source: `server/db.ts:10306`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, test Database Connection
- Query ID: `545171404f70`

```sql
SELECT COUNT(*) as count FROM patient LIMIT 1
```

## 53. testDatabaseConnection — OPD / ผู้ป่วยนอก / visit / รับบริการ / test Database Connection

- Source: `server/db.ts:10310`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, test Database Connection
- Query ID: `60ed0786577d`

```sql
SELECT COUNT(*) as count FROM ovst WHERE vstdate >= CURDATE() - INTERVAL 30 DAY
```

## 54. testSDrugitemsStructure — ยา / รหัสเบิก / ADP / test SDrugitems Structure

- Source: `server/db.ts:10402`
- Tables: `s_drugitems`
- Search terms: ยา, รหัสเบิก, ADP, test SDrugitems Structure
- Query ID: `477fa50bb461`

```sql
SELECT * FROM s_drugitems LIMIT 5
```

## 55. testReceiptJoin — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / test Receipt Join

- Source: `server/db.ts:10424`
- Tables: `opitemrece`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, test Receipt Join
- Query ID: `b1968dcbb191`

```sql
SELECT * FROM opitemrece WHERE vn = ? LIMIT 5
```

## 56. testReceiptJoin — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / รหัสเบิก / ADP / test Receipt Join

- Source: `server/db.ts:10437`
- Tables: `opitemrece`, `s_drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, รหัสเบิก, ADP, test Receipt Join
- Query ID: `88a4643366c0`

```sql
SELECT
opitemrece.vn,
opitemrece.icode,
opitemrece.qty,
opitemrece.sum_price,
s_drugitems.icode as s_icode,
s_drugitems.name as s_name
FROM opitemrece
LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
WHERE opitemrece.vn = ?
LIMIT 10
```

## 57. getDiagsAndProcedures — OPD / ผู้ป่วยนอก / visit / รับบริการ / คัดกรอง / อาการ / ความดัน / น้ำหนัก

- Source: `server/db.ts:11518`
- Tables: `ovst`, `opdscreen`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, คัดกรอง, อาการ, ความดัน, น้ำหนัก, get Diags And Procedures
- Query ID: `7d5e985f0be1`

```sql
SELECT
COALESCE(os.cc, '') AS cc,
COALESCE(os.hpi, '') AS hpi
FROM ovst o
LEFT JOIN opdscreen os ON os.vn = o.vn
WHERE o.vn = ?
LIMIT 1
```

## 58. getDiagsAndProcedures — วินิจฉัย / ICD10 / diagnosis / ชื่อโรค / get Diags And Procedures

- Source: `server/db.ts:11528`
- Tables: `ovstdiag`, `icd101`
- Search terms: วินิจฉัย, ICD10, diagnosis, ชื่อโรค, get Diags And Procedures
- Query ID: `c1d01c968e3c`

```sql
SELECT
d.icd10 as code,
i.name as name,
d.diagtype as type,
'Diag' as category
FROM ovstdiag d
LEFT JOIN icd101 i ON d.icd10 = i.code
WHERE d.vn = ?
ORDER BY d.diagtype
```

## 59. getDiagsAndProcedures — หัตถการ / ICD9 / ชื่อหัตถการ / get Diags And Procedures

- Source: `server/db.ts:11540`
- Tables: `doctor_operation`, `icd9cm1`, `er_regist_oper`, `er_oper_code`, `dtmain`, `dttm`
- Search terms: หัตถการ, ICD9, ชื่อหัตถการ, get Diags And Procedures
- Query ID: `969cd502c676`

```sql
SELECT
o.icd9 as code,
i.name as name,
'' as type,
'Procedure' as category
FROM doctor_operation o
LEFT JOIN icd9cm1 i ON o.icd9 = i.code
WHERE o.vn = ?
UNION ALL
SELECT
eo.er_oper_code as code,
e.name as name,
'' as type,
'Procedure' as category
FROM er_regist_oper eo
LEFT JOIN er_oper_code e ON eo.er_oper_code = e.er_oper_code
WHERE eo.vn = ?
UNION ALL
SELECT
COALESCE(
NULLIF(TRIM(tm.icd10tm_operation_code), ''),
NULLIF(TRIM(tm.icd9cm), ''),
NULLIF(TRIM(dm.icd9), ''),
dm.tmcode
) as code,
COALESCE(
NULLIF(TRIM(tm.thai_name), ''),
NULLIF(TRIM(tm.name), ''),
NULLIF(TRIM(dm.ttcode), ''),
'หัตถการทันตกรรม'
) as name,
'Dental' as type,
'Procedure' as category
FROM dtmain dm
LEFT JOIN dttm tm ON tm.code = dm.tmcode
WHERE dm.vn = ?
ORDER BY code
```

## 60. importFdhStatusForDateRange — OPD / ผู้ป่วยนอก / visit / รับบริการ / import Fdh Status For Date Range

- Source: `server/db.ts:11964`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, import Fdh Status For Date Range
- Query ID: `ac942e219c37`

```sql
SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate,'%Y-%m-%d') AS vstdate
FROM ovst o
WHERE o.vstdate BETWEEN ? AND ?
ORDER BY o.vstdate, o.vn
```

## 61. getSpecificFundData — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/db.ts:12173`
- Tables: `ovst`, `patient`, `pttype`, `vn_stat`, `opitemrece`, `drugitems`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, ยา, บริการ, รายการเบิก, drug, get Specific Fund Data
- Query ID: `31e98e93595d`

```sql
SELECT
o.vn, o.hn,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
ptt.name as pttypename, ptt.hipdata_code,
v.pdx,
SUM(oo.qty * oo.unitprice) as herb_total_price,
GROUP_CONCAT(DISTINCT di.name SEPARATOR ', ') as herb_items
FROM ovst o
JOIN patient pt ON o.hn = pt.hn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
LEFT JOIN vn_stat v ON v.vn = o.vn
JOIN opitemrece oo ON oo.vn = o.vn
JOIN drugitems di ON di.icode = oo.icode
WHERE o.vstdate BETWEEN ? AND ?
AND di.ttmt_code IS NOT NULL
AND di.sks_product_category_id IN (3,4)
GROUP BY o.vn
ORDER BY o.vstdate DESC
```

## 62. getSpecificFundData — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/db.ts:12298`
- Tables: `ovst`, `patient`, `pttype`, `opitemrece`, `nondrugitems`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, หัตถการ, ADP, get Specific Fund Data
- Query ID: `52a3f91deb08`

```sql
SELECT
o.vn, o.hn,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
ptt.name as pttypename, ptt.hipdata_code,
SUM(oo.sum_price) as instrument_price,
GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') as instrument_items,
MAX(CASE WHEN d.nhso_adp_code REGEXP '^700[4-5]' THEN 'Y' ELSE 'N' END) as has_oa,
MAX(CASE WHEN d.nhso_adp_code REGEXP '^8612|^8813|^8814' THEN 'Y' ELSE 'N' END) as has_dm
FROM ovst o
JOIN patient pt ON o.hn = pt.hn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
JOIN opitemrece oo ON oo.vn = o.vn
JOIN nondrugitems d ON d.icode = oo.icode
WHERE o.vstdate BETWEEN ? AND ?
AND d.nhso_adp_type_id = 2
GROUP BY o.vn
ORDER BY o.vstdate DESC
```

## 63. getSpecificFundData — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / drug / OPD / ผู้ป่วยนอก / visit

- Source: `server/db.ts:12472`
- Tables: `opitemrece`, `drugitems`, `ovst`, `patient`, `pttype`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, drug, OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, get Specific Fund Data
- Query ID: `edfad7958687`

```sql
SELECT
o.vn, o.hn,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
ppt.name as pttypename, ppt.hipdata_code,
(
SELECT 'Y' FROM opitemrece oo
JOIN drugitems d ON d.icode = oo.icode
WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101')
LIMIT 1
) as has_clopidogrel_drug,
(
SELECT SUM(oo.qty * oo.unitprice)
FROM opitemrece oo
JOIN drugitems d ON d.icode = oo.icode
WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101')
) as clopidogrel_price,
(
SELECT GROUP_CONCAT(DISTINCT CONCAT(d.name, ' (qty: ', oo.qty, ')') SEPARATOR ', ')
FROM opitemrece oo
JOIN drugitems d ON d.icode = oo.icode
WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101')
) as clopidogrel_details
FROM ovst o
JOIN patient pt ON o.hn = pt.hn
LEFT JOIN pttype ppt ON ppt.pttype = o.pttype
WHERE o.vstdate BETWEEN ? AND ?
AND EXISTS (
SELECT 1 FROM opitemrece oo
JOIN drugitems d ON d.icode = oo.icode
WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101')
)
GROUP BY o.vn
ORDER BY o.vstdate DESC
```

## 64. getRevenueOpportunitySourceRows — IPD / ผู้ป่วยใน / admit / AN / ยา / บริการ / ค่าใช้จ่าย / รายการเบิก

- Source: `server/db.ts:13247`
- Tables: `ipt`, `referin`, `referout`, `opitemrece`, `s_drugitems`, `ovstdiag`, `nhso_confirm_privilege`, `authenhos`, `visit_pttype`, `ovst`, `patient`, `pttype`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, รหัสเบิก, ADP, วินิจฉัย, ICD10, diagnosis, สปสช., ยืนยันสิทธิ, authen, สิทธิ visit, auth code, OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, get Revenue Opportunity Source Rows
- Query ID: `655a31592769`

```sql
SELECT
o.vn, o.hn, COALESCE(o.an, '') AS an,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patientName,
ptt.pttype AS pttype_code,
ptt.name AS fund,
ptt.hipdata_code,
CASE WHEN COALESCE(o.an, '') <> '' OR EXISTS(SELECT 1 FROM ipt i WHERE i.vn = o.vn) THEN 1 ELSE 0 END AS is_admitted,
CASE WHEN COALESCE(o.an, '') <> '' OR EXISTS(SELECT 1 FROM ipt i WHERE i.vn = o.vn) THEN 'IP' ELSE 'OP' END AS service_type,
CASE WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn) THEN 1 ELSE 0 END AS has_refer_in,
CASE WHEN EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 1 ELSE 0 END AS has_refer_out,
CASE WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn)
OR EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 1 ELSE 0 END AS has_refer_record,
CASE
WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn)
AND EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 'BOTH'
WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn) THEN 'IN'
WHEN EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 'OUT'
ELSE ''
END AS refer_direction,
COALESCE(
(SELECT CONCAT('IN:', COALESCE(ri.docno, '')) FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
(SELECT CONCAT('OUT:', COALESCE(ro.refer_number, '')) FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
''
) AS refer_no,
COALESCE(
(SELECT ri.docno FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
(SELECT ro.refer_number FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
''
) AS refer_no_raw,
COALESCE(
(SELECT DATE_FORMAT(ri.refer_date, '%Y-%m-%d') FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
(SELECT DATE_FORMAT(ro.refer_date, '%Y-%m-%d') FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
''
) AS refer_date,
COALESCE(
(SELECT ri.refer_hospcode FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
(SELECT ro.refer_hospcode FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
''
) AS refer_hospcode,
COALESCE((SELECT TRIM(ro.refer_hospcode) FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS referout_hospcode,
COALESCE((SELECT ro.refer_in_province FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS refer_in_province,
COALESCE((SELECT ro.with_ambulance FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS with_ambulance,
COALESCE((SELECT ro.car_registration_no FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS ambulance_registration,
CASE WHEN EXISTS(
SELECT 1
FROM opitemrece oi
JOIN s_drugitems sd ON sd.icode = oi.icode
WHERE oi.vn = o.vn
AND UPPER(TRIM(COALESCE(sd.nhso_adp_code, ''))) REGEXP '^S1'
) THEN 1 ELSE 0 END AS has_refer_adp_s,
COALESCE((
SELECT GROUP_CONCAT(DISTINCT UPPER(TRIM(sd.nhso_adp_code)) ORDER BY sd.nhso_adp_code SEPARATOR ', ')
FROM opitemrece oi
JOIN s_drugitems sd ON sd.icode = oi.icode
WHERE oi.vn = o.vn
AND UPPER(TRIM(COALESCE(sd.nhso_adp_code, ''))) REGEXP '^S1'
), '') AS refer_adp_codes,
COALESCE((
SELECT GROUP_CONCAT(
DISTINCT CONCAT(oi.icode, ' ', COALESCE(sd.name, ''), ' [', UPPER(TRIM(sd.nhso_adp_code)), ']')
ORDER BY oi.icode SEPARATOR ' | '
)
FROM opitemrece oi
JOIN s_drugitems sd ON sd.icode = oi.icode
WHERE oi.vn = o.vn
AND UPPER(TRIM(COALESCE(sd.nhso_adp_code, ''))) REGEXP '^S1'
), '') AS refer_adp_items,
(SELECT dx.icd10 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.diagtype = '1' LIMIT 1) AS main_diag,
CASE WHEN EXISTS(SELECT 1 FROM opitemrece oi WHERE oi.vn = o.vn AND COALESCE(oi.sum_price, 0) > 0) THEN 1 ELSE 0 END AS has_receipt,
COALESCE((SELECT SUM(oi.sum_price) FROM opitemrece oi WHERE oi.vn = o.vn), 0) AS total_price,
CASE WHEN COALESCE(
(SELECT ncp.nhso_authen_code FROM nhso_confirm_privilege ncp
WHERE ncp.vn = o.vn AND ncp.nhso_status = 'Y' AND ncp.nhso_authen_code REGEXP '^EP' LIMIT 1),
(SELECT ah.claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1),
(SELECT vp.auth_code FROM visit_pttype vp WHERE vp.vn = o.vn AND vp.auth_code REGEXP '^EP' LIMIT 1)
) IS NOT NULL THEN 1 ELSE 0 END AS has_close,
COALESCE(
(SELECT ncp.nhso_authen_code FROM nhso_confirm_privilege ncp
WHERE ncp.vn = o.vn AND ncp.nhso_status = 'Y' AND ncp.nhso_authen_code REGEXP '^EP' LIMIT 1),
(SELECT ah.claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1),
(SELECT vp.auth_code FROM visit_pttype vp WHERE vp.vn = o.vn AND vp.auth_code REGEXP '^EP' LIMIT 1),
''
) AS close_code,
'OP Refer' AS project_code
FROM ovst o
JOIN patient pt ON pt.hn = o.hn
JOIN pttype ptt ON ptt.pttype = o.pttype
WHERE o.vstdate BETWEEN ? AND ?
AND (
ptt.name LIKE '%OP Refer%' OR ptt.name LIKE '%รับส่งต่อ%' OR ptt.name LIKE '%Refer%'
OR EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn)
OR EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn)
)
ORDER BY o.vstdate DESC, o.vsttime DESC
```

## 65. queryDuplicateAppointments — นัดหมาย / วันนัด / นัดซ้ำ / คลินิก / แผนก / หน่วยงาน / query Duplicate Appointments

- Source: `server/duplicateAppointmentAlert.ts:73`
- Tables: `oapp`, `clinic`, `kskdepartment`
- Search terms: นัดหมาย, วันนัด, นัดซ้ำ, คลินิก, แผนก, หน่วยงาน, query Duplicate Appointments
- Query ID: `1c575aba71ff`

```sql
SELECT
a.oapp_id,
a.hn,
DATE_FORMAT(a.nextdate, '%Y-%m-%d') AS next_date,
COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '') AS next_time,
COALESCE(a.clinic, '') AS clinic_code,
COALESCE(cl.name, '') AS clinic_name,
COALESCE(a.depcode, '') AS department_code,
COALESCE(k.department, '') AS department_name,
COALESCE(a.app_cause, '') AS app_cause
FROM oapp a
LEFT JOIN clinic cl ON cl.clinic = a.clinic
LEFT JOIN kskdepartment k ON k.depcode = a.depcode
JOIN (
SELECT hn
FROM oapp
WHERE nextdate = ?
AND COALESCE(hn, '') <> ''
AND COALESCE(oapp_status_id, 1) <> 4
GROUP BY hn
HAVING COUNT(*) > 1
) duplicate_hn ON duplicate_hn.hn = a.hn
WHERE a.nextdate = ?
AND COALESCE(a.oapp_status_id, 1) <> 4
ORDER BY a.hn, a.nexttime, a.oapp_id
```

## 66. operativeNote — หัตถการ / ICD9 / ชื่อหัตถการ / operative Note

- Source: `server/hospitalReportTools.ts:203`
- Tables: `doctor_operation`, `icd9cm1`
- Search terms: หัตถการ, ICD9, ชื่อหัตถการ, operative Note
- Query ID: `71f7aba4a565`

```sql
SELECT o.vn, o.icd9 AS procedureCode, COALESCE(i.name, '') AS procedureName
FROM doctor_operation o
LEFT JOIN icd9cm1 i ON i.code = o.icd9
WHERE o.vn = ?
ORDER BY o.icd9
```

## 67. bedOccupancy — IPD / ผู้ป่วยใน / admit / AN / หอผู้ป่วย / ward / bed Occupancy

- Source: `server/hospitalReportTools.ts:231`
- Tables: `ipt`, `ward`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, หอผู้ป่วย, ward, bed Occupancy
- Query ID: `da9e3a090d6f`

```sql
SELECT i.ward AS wardCode, COALESCE(w.name, i.ward, 'ไม่ระบุวอร์ด') AS ward,
COUNT(DISTINCT i.an) AS occupiedBeds,
ROUND(AVG(DATEDIFF(CURDATE(), i.regdate)), 1) AS averageStayDays
FROM ipt i
LEFT JOIN ward w ON w.ward = i.ward
WHERE i.dchdate IS NULL
GROUP BY i.ward, w.name
ORDER BY occupiedBeds DESC, ward
```

## 68. costPerDrg — สถิติ IPD / วินิจฉัยผู้ป่วยใน / cost Per Drg

- Source: `server/hospitalReportTools.ts:349`
- Tables: `an_stat`
- Search terms: สถิติ IPD, วินิจฉัยผู้ป่วยใน, cost Per Drg
- Query ID: `46ad8cda5dd3`

```sql
SELECT COALESCE(NULLIF(a.drg, ''), 'ไม่ระบุ DRG') AS drg,
COUNT(DISTINCT a.an) AS cases,
ROUND(AVG(COALESCE(a.rw, 0)), 4) AS averageRw,
ROUND(SUM(COALESCE(a.income, 0)), 2) AS totalCharge,
ROUND(AVG(COALESCE(a.income, 0)), 2) AS averageChargePerCase
FROM an_stat a
WHERE a.dchdate BETWEEN ? AND ?
GROUP BY COALESCE(NULLIF(a.drg, ''), 'ไม่ระบุ DRG')
ORDER BY totalCharge DESC
LIMIT 500
```

## 69. payerMix — OPD / ผู้ป่วยนอก / visit / รับบริการ / สิทธิ / สิทธิการรักษา / payer Mix

- Source: `server/hospitalReportTools.ts:380`
- Tables: `ovst`, `pttype`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สิทธิ, สิทธิการรักษา, payer Mix
- Query ID: `4a9711706916`

```sql
SELECT o.pttype AS payerCode, COALESCE(pt.name, o.pttype, 'ไม่ระบุสิทธิ') AS payer,
COUNT(DISTINCT o.hn) AS patients, COUNT(DISTINCT o.vn) AS visits,
ROUND(COUNT(DISTINCT o.vn) * 100.0 / NULLIF((SELECT COUNT(DISTINCT x.vn) FROM ovst x WHERE x.vstdate BETWEEN ? AND ?), 0), 2) AS visitPercent
FROM ovst o
LEFT JOIN pttype pt ON pt.pttype = o.pttype
WHERE o.vstdate BETWEEN ? AND ?
GROUP BY o.pttype, pt.name
ORDER BY visits DESC
```

## 70. module-query — OPD / ผู้ป่วยนอก / visit / รับบริการ / module-query

- Source: `server/index.ts:2508`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, module-query
- Query ID: `1212b152d2ed`

```sql
SELECT
ovst.ovstost,
COUNT(*) as count,
MIN(ovst.vstdate) as earliest_date,
MAX(ovst.vstdate) as latest_date,
GROUP_CONCAT(DISTINCT ovst.vn ORDER BY ovst.vstdate DESC LIMIT 3) as sample_vns
FROM ovst
WHERE DATE(ovst.vstdate) >= '2026-03-01'
GROUP BY ovst.ovstost
ORDER BY count DESC
LIMIT 20
```

## 71. module-query — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/index.ts:2523`
- Tables: `ovst`, `patient`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, module-query
- Query ID: `c16e4ccfffda`

```sql
SELECT
ovst.vn,
ovst.ovstost,
ovst.vstdate,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patientName
FROM ovst
LEFT JOIN patient pt ON ovst.hn = pt.hn
WHERE DATE(ovst.vstdate) >= '2026-03-01'
ORDER BY ovst.vstdate DESC
LIMIT 10
```

## 72. testKidneyMonitor — OPD / ผู้ป่วยนอก / visit / รับบริการ / test Kidney Monitor

- Source: `server/test_kidney_db.ts:9`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, test Kidney Monitor
- Query ID: `ef2099d60bf2`

```sql
SELECT COUNT(*) as cnt FROM ovst LIMIT 1
```

## 73. testKidneyMonitor — OPD / ผู้ป่วยนอก / visit / รับบริการ / วินิจฉัย / ICD10 / diagnosis / test Kidney Monitor

- Source: `server/test_kidney_db.ts:16`
- Tables: `ovst`, `ovstdiag`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, วินิจฉัย, ICD10, diagnosis, test Kidney Monitor
- Query ID: `f18a67735e37`

```sql
SELECT DISTINCT
o.vn, o.hn, o.vstdate,
d.icd10
FROM ovst o
JOIN ovstdiag d ON o.vn = d.vn
WHERE d.icd10 LIKE 'N185%' OR d.icd10 LIKE 'Z49%'
LIMIT 5
```
