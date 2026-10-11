---
ksp_schema: 1
project: FDHChecker
type: "query-catalog"
category: "data-model"
source: "server/**/*.ts"
source_hash: "446fc5e9bee488b918d57e1a9459115d61d8e3a72dfbbad25ebb6d7d9bb39971"
managed_by: "sync-ksp-vault"
---
# FDHChecker Read-only Query Catalog

> รูปแบบ SELECT ที่สกัดจากระบบ FDHChecker อัตโนมัติ ใช้เป็นตัวอย่างวางแผนรายงานเท่านั้น
> ต้องตรวจ allowlist, ใช้ parameter และผ่าน Read-only SQL Validator ก่อนรันทุกครั้ง
> ห้ามนำ Query ในเอกสารนี้ไปใช้แก้ไขข้อมูล และห้ามเติมข้อมูลผู้ป่วยจากการคาดเดา

จำนวนรูปแบบ Query ที่ผ่านการตรวจ: 124

## 1. getAccountingRevenueReport — IPD / ผู้ป่วยใน / admit / AN / get Accounting Revenue Report

- Source: `server/accountingRevenueReport.ts:67`
- Tables: `ipt`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, get Accounting Revenue Report
- Query ID: `ecac34f059c3`

```sql
SELECT * FROM ipt LIMIT 0
```

## 2. getAccountingRevenueReport — สถิติ IPD / วินิจฉัยผู้ป่วยใน / get Accounting Revenue Report

- Source: `server/accountingRevenueReport.ts:68`
- Tables: `an_stat`
- Search terms: สถิติ IPD, วินิจฉัยผู้ป่วยใน, get Accounting Revenue Report
- Query ID: `629c98a1fa07`

```sql
SELECT * FROM an_stat LIMIT 0
```

## 3. getAccountingRevenueReport — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / สิทธิ

- Source: `server/accountingRevenueReport.ts:76`
- Tables: `ovst`, `vn_stat`, `pttype`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, สิทธิ, สิทธิการรักษา, get Accounting Revenue Report
- Query ID: `8a3232abdec0`

```sql
SELECT o.pttype AS pttype, COALESCE(pt.name, '') AS pttype_name, COALESCE(pt.hipdata_code, '') AS hipdata_code,
COUNT(DISTINCT o.vn) AS service_count, 0 AS adjrw, COALESCE(SUM(COALESCE(v.income, 0)), 0) AS actual_charge
FROM ovst o LEFT JOIN vn_stat v ON v.vn = o.vn LEFT JOIN pttype pt ON pt.pttype = o.pttype
WHERE o.vstdate BETWEEN ? AND ? GROUP BY o.pttype, pt.name, pt.hipdata_code ORDER BY o.pttype
```

## 4. lookupLatestVnErrors — FDH / สถานะเคลม / ข้อผิดพลาด / ส่งเบิก / lookup Latest Vn Errors

- Source: `server/aiErrorTools.ts:55`
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

## 5. getAppointmentClinicSummary — นัดหมาย / วันนัด / นัดซ้ำ / คลินิก / แผนก / หน่วยงาน / get Appointment Clinic Summary

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

## 6. getClaimCompleteness — FDH / สถานะเคลม / ข้อผิดพลาด / ส่งเบิก / OPD / ผู้ป่วยนอก / visit / รับบริการ

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

## 7. getPatientIdentityDuplicates — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Identity Duplicates

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

## 8. getPatientIdentityDuplicates — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Identity Duplicates

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

## 9. getOpdCount — OPD / ผู้ป่วยนอก / visit / รับบริการ / get Opd Count

- Source: `server/aiReportTools.ts:240`
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

## 10. getOpdRows — OPD / ผู้ป่วยนอก / visit / รับบริการ / get Opd Rows

- Source: `server/aiReportTools.ts:272`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, get Opd Rows
- Query ID: `608ae1781d08`

```sql
SELECT COUNT(DISTINCT vn) AS total FROM ovst WHERE vstdate BETWEEN ? AND ?
```

## 11. getOpdRows — วินิจฉัย / ICD10 / diagnosis / OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย

- Source: `server/aiReportTools.ts:277`
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

## 12. patientHnFromIdentifier — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / patient Hn From Identifier

- Source: `server/aiReportTools.ts:314`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, patient Hn From Identifier
- Query ID: `97413100bccf`

```sql
SELECT hn FROM patient WHERE cid = ? LIMIT 1
```

## 13. patientHnFromIdentifier — OPD / ผู้ป่วยนอก / visit / รับบริการ / patient Hn From Identifier

- Source: `server/aiReportTools.ts:318`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, patient Hn From Identifier
- Query ID: `143ffd11e2a0`

```sql
SELECT hn FROM ovst WHERE vn = ? LIMIT 1
```

## 14. patientHnFromIdentifier — IPD / ผู้ป่วยใน / admit / AN / patient Hn From Identifier

- Source: `server/aiReportTools.ts:322`
- Tables: `ipt`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, patient Hn From Identifier
- Query ID: `664a4e9945ff`

```sql
SELECT hn FROM ipt WHERE an = ? LIMIT 1
```

## 15. getPatientProfileAndHistory — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Profile And History

- Source: `server/aiReportTools.ts:384`
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

## 16. getPatientProfileAndHistory — วินิจฉัย / ICD10 / diagnosis / OPD / ผู้ป่วยนอก / visit / รับบริการ / สิทธิ

- Source: `server/aiReportTools.ts:402`
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

## 17. getPatientProfileAndHistory — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / หอผู้ป่วย / ward

- Source: `server/aiReportTools.ts:418`
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

## 18. getPatientLabs — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / get Patient Labs

- Source: `server/aiReportTools.ts:443`
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

## 19. getPatientMedications — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / OPD / ผู้ป่วยนอก / visit / รับบริการ

- Source: `server/aiReportTools.ts:466`
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

## 20. getPatientAppointments — นัดหมาย / วันนัด / นัดซ้ำ / คลินิก / แผนก / หน่วยงาน / get Patient Appointments

- Source: `server/aiReportTools.ts:492`
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

## 21. getVisitHeader — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/aiReportTools.ts:515`
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

## 22. loadSnapshot — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / รหัสเบิก / ADP / load Snapshot

- Source: `server/ancDentalCompletion.ts:147`
- Tables: `opitemrece`, `s_drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, รหัสเบิก, ADP, load Snapshot
- Query ID: `f514cd9a411e`

```sql
SELECT sd.icode, COALESCE(NULLIF(TRIM(sd.name), ''), sd.icode) AS item_name,
COALESCE((
SELECT recent.unitprice
FROM opitemrece recent
WHERE recent.icode = sd.icode
ORDER BY recent.vstdate DESC, recent.vsttime DESC, recent.item_no DESC
LIMIT 1
), 0) AS unitprice,
COALESCE((
SELECT NULLIF(recent.income, '')
FROM opitemrece recent
WHERE recent.icode = sd.icode
ORDER BY recent.vstdate DESC, recent.vsttime DESC, recent.item_no DESC
LIMIT 1
), '00') AS income,
(
SELECT COUNT(*)
FROM opitemrece recent
WHERE recent.icode = sd.icode
AND recent.vstdate >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
) AS usage_count
FROM s_drugitems sd
WHERE TRIM(sd.nhso_adp_code) = ?
ORDER BY usage_count DESC, sd.icode
LIMIT 10
```

## 23. module-query — สิทธิ / สิทธิการรักษา / module-query

- Source: `server/annualHealthCheckup.ts:99`
- Tables: `pttype`
- Search terms: สิทธิ, สิทธิการรักษา, module-query
- Query ID: `71b8503bcb38`

```sql
SELECT pttype, name, pcode, hipdata_code
FROM pttype
ORDER BY
CASE
WHEN hipdata_code IN ('OFC', 'LGO') OR pcode IN ('A1', 'A2') THEN 1
ELSE 2
END,
pcode ASC, pttype ASC
```

## 24. queryDailyWorkOverview — วินิจฉัย / ICD10 / diagnosis / ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / สปสช.

- Source: `server/dailyWorkOverview.ts:78`
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

## 25. ensureFdhClaimStatusSchema — FDH / สถานะเคลม / ข้อผิดพลาด / ส่งเบิก / ensure Fdh Claim Status Schema

- Source: `server/db/schema.ts:642`
- Tables: `fdh_claim_status`
- Search terms: FDH, สถานะเคลม, ข้อผิดพลาด, ส่งเบิก, ensure Fdh Claim Status Schema
- Query ID: `4da379e030f0`

```sql
SELECT vn, transaction_uid FROM fdh_claim_status LIMIT 0
```

## 26. fixDentalClinicalVisit — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/dentalAudit.ts:961`
- Tables: `ovst`, `patient`, `pttype`, `kskdepartment`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, แผนก, หน่วยงาน, fix Dental Clinical Visit
- Query ID: `7f507f554157`

```sql
SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
COALESCE(pt.name, o.pttype) AS pttype_name, pt.pcode, pt.hipdata_code,
COALESCE(CONCAT(p.pname, p.fname, ' ', p.lname), '') AS patient_name,
COALESCE(p.sex, '') AS sex,
COALESCE(TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate), 0) AS age_y,
COALESCE(k.department, o.main_dep, '') AS department
FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN pttype pt ON pt.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
WHERE o.vn = ? LIMIT 1
```

## 27. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / ชื่อโรค / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:983`
- Tables: `ovstdiag`, `icd101`
- Search terms: วินิจฉัย, ICD10, diagnosis, ชื่อโรค, fix Dental Clinical Visit
- Query ID: `8b6a8230e6be`

```sql
SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name, d.ovst_diag_id
FROM ovstdiag d
LEFT JOIN icd101 i ON i.code = d.icd10
WHERE d.vn = ? ORDER BY d.diagtype
```

## 28. fixDentalClinicalVisit — OPD / ผู้ป่วยนอก / visit / รับบริการ / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1082`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, fix Dental Clinical Visit
- Query ID: `c4c8bde4602a`

```sql
SELECT hn, vstdate, vsttime, doctor, staff FROM ovst WHERE vn = ? LIMIT 1
```

## 29. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1097`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Dental Clinical Visit
- Query ID: `866d15233100`

```sql
SELECT 1 FROM ovstdiag WHERE vn = ? AND icd10 = 'K051' LIMIT 1
```

## 30. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1111`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Dental Clinical Visit
- Query ID: `c6ed0ff46025`

```sql
SELECT 1 FROM ovstdiag WHERE vn = ? AND icd10 = 'K021' LIMIT 1
```

## 31. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1125`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Dental Clinical Visit
- Query ID: `4e255a2e298d`

```sql
SELECT 1 FROM ovstdiag WHERE vn = ? AND icd10 = 'K011' LIMIT 1
```

## 32. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1152`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Dental Clinical Visit
- Query ID: `55eee02d0037`

```sql
SELECT ovst_diag_id FROM ovstdiag WHERE vn = ? AND icd10 = ? LIMIT 1
```

## 33. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1183`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Dental Clinical Visit
- Query ID: `3c59f275eca2`

```sql
SELECT ovst_diag_id, icd10 FROM ovstdiag WHERE vn = ? AND diagtype = '1' LIMIT 1
```

## 34. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1207`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Dental Clinical Visit
- Query ID: `c59788e77b62`

```sql
SELECT ovst_diag_id, icd10, diagtype, doctor FROM ovstdiag WHERE vn = ? AND icd10 REGEXP '^[0-9]'
```

## 35. fixDentalClinicalVisit — วินิจฉัย / ICD10 / diagnosis / ชื่อโรค / fix Dental Clinical Visit

- Source: `server/dentalAudit.ts:1399`
- Tables: `ovstdiag`, `icd101`
- Search terms: วินิจฉัย, ICD10, diagnosis, ชื่อโรค, fix Dental Clinical Visit
- Query ID: `3e53c3317c21`

```sql
SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name
FROM ovstdiag d
LEFT JOIN icd101 i ON i.code = d.icd10
WHERE d.vn = ? ORDER BY d.diagtype
```

## 36. queryDuplicateAppointments — นัดหมาย / วันนัด / นัดซ้ำ / คลินิก / แผนก / หน่วยงาน / query Duplicate Appointments

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

## 37. loadSnapshot — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / drug / load Snapshot

- Source: `server/herbalDiagnosisCompletion.ts:76`
- Tables: `opitemrece`, `drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, drug, load Snapshot
- Query ID: `db6ccc4e2de7`

```sql
SELECT DISTINCT di.name
FROM opitemrece oo
JOIN drugitems di ON di.icode = oo.icode
WHERE oo.vn = ?
AND COALESCE(oo.qty, 0) > 0
AND di.ttmt_code IS NOT NULL
AND di.sks_product_category_id IN (3, 4)
ORDER BY di.name
```

## 38. operativeNote — หัตถการ / ICD9 / ชื่อหัตถการ / operative Note

- Source: `server/hospitalReportTools.ts:244`
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

## 39. bedOccupancy — IPD / ผู้ป่วยใน / admit / AN / หอผู้ป่วย / ward / bed Occupancy

- Source: `server/hospitalReportTools.ts:272`
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

## 40. dailyServiceSummary — OPD / ผู้ป่วยนอก / visit / รับบริการ / IPD / ผู้ป่วยใน / admit / AN

- Source: `server/hospitalReportTools.ts:393`
- Tables: `ovst`, `ipt`, `vn_stat`, `an_stat`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, IPD, ผู้ป่วยใน, admit, AN, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, สถิติ IPD, วินิจฉัยผู้ป่วยใน, daily Service Summary
- Query ID: `54c87052fad5`

```sql
SELECT d.serviceDate,
COALESCE(opd.opdVisits, 0) AS opdVisits,
COALESCE(opd.opdPatients, 0) AS opdPatients,
COALESCE(opd.opdCharge, 0) AS opdCharge,
COALESCE(ipd.admissions, 0) AS ipdAdmissions,
COALESCE(dch.discharges, 0) AS ipdDischarges,
COALESCE(dch.ipdCharge, 0) AS ipdDischargeCharge
FROM (
SELECT vstdate AS serviceDate FROM ovst WHERE vstdate BETWEEN ? AND ?
UNION SELECT regdate FROM ipt WHERE regdate BETWEEN ? AND ?
UNION SELECT dchdate FROM ipt WHERE dchdate BETWEEN ? AND ?
) d
LEFT JOIN (
SELECT o.vstdate, COUNT(DISTINCT o.vn) AS opdVisits, COUNT(DISTINCT o.hn) AS opdPatients,
ROUND(SUM(COALESCE(v.income, 0)), 2) AS opdCharge
FROM ovst o LEFT JOIN vn_stat v ON v.vn = o.vn
WHERE o.vstdate BETWEEN ? AND ? GROUP BY o.vstdate
) opd ON opd.vstdate = d.serviceDate
LEFT JOIN (
SELECT regdate, COUNT(DISTINCT an) AS admissions FROM ipt
WHERE regdate BETWEEN ? AND ? GROUP BY regdate
) ipd ON ipd.regdate = d.serviceDate
LEFT JOIN (
SELECT i.dchdate, COUNT(DISTINCT i.an) AS discharges, ROUND(SUM(COALESCE(a.income, 0)), 2) AS ipdCharge
FROM ipt i LEFT JOIN an_stat a ON a.an = i.an
WHERE i.dchdate BETWEEN ? AND ? GROUP BY i.dchdate
) dch ON dch.dchdate = d.serviceDate
ORDER BY d.serviceDate
```

## 41. opdDepartmentWorkload — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / แผนก

- Source: `server/hospitalReportTools.ts:442`
- Tables: `ovst`, `vn_stat`, `kskdepartment`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, แผนก, หน่วยงาน, opd Department Workload
- Query ID: `9b8614bedef7`

```sql
SELECT COALESCE(NULLIF(o.main_dep, ''), 'ไม่ระบุ') AS departmentCode,
COALESCE(NULLIF(k.department, ''), NULLIF(o.main_dep, ''), 'ไม่ระบุแผนก') AS department,
COUNT(DISTINCT o.vn) AS visits, COUNT(DISTINCT o.hn) AS patients,
ROUND(COUNT(DISTINCT o.vn) / NULLIF(COUNT(DISTINCT o.vstdate), 0), 1) AS averageVisitsPerServiceDay,
ROUND(SUM(COALESCE(v.income, 0)), 2) AS totalCharge,
ROUND(AVG(COALESCE(v.income, 0)), 2) AS averageChargePerVisit
FROM ovst o
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
WHERE o.vstdate BETWEEN ? AND ?
GROUP BY o.main_dep, k.department ORDER BY visits DESC
```

## 42. opdDiagnosisRanking — สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / ICD10 / ชื่อโรค / opd Diagnosis Ranking

- Source: `server/hospitalReportTools.ts:474`
- Tables: `vn_stat`, `icd101`
- Search terms: สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, ICD10, ชื่อโรค, opd Diagnosis Ranking
- Query ID: `d1c21b512aa5`

```sql
SELECT COALESCE(NULLIF(v.pdx, ''), 'ไม่ระบุ') AS diagnosisCode,
COALESCE(NULLIF(i.tname, ''), NULLIF(i.name, ''), 'ไม่ระบุชื่อโรค') AS diagnosis,
COUNT(DISTINCT v.vn) AS visits, COUNT(DISTINCT v.hn) AS patients,
ROUND(COUNT(DISTINCT v.vn) * 100.0 / NULLIF((SELECT COUNT(DISTINCT x.vn) FROM vn_stat x WHERE x.vstdate BETWEEN ? AND ?), 0), 2) AS visitPercent,
ROUND(SUM(COALESCE(v.income, 0)), 2) AS totalCharge
FROM vn_stat v LEFT JOIN icd101 i ON i.code = v.pdx
WHERE v.vstdate BETWEEN ? AND ?
GROUP BY v.pdx, i.tname, i.name ORDER BY visits DESC LIMIT 500
```

## 43. ipdAdmissionDischarge — IPD / ผู้ป่วยใน / admit / AN / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/hospitalReportTools.ts:502`
- Tables: `ipt`, `patient`, `an_stat`, `ward`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สถิติ IPD, วินิจฉัยผู้ป่วยใน, หอผู้ป่วย, ward, ipd Admission Discharge
- Query ID: `d4e1518703b4`

```sql
SELECT i.an, i.hn,
TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admitDate, DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dischargeDate,
COALESCE(NULLIF(w.name, ''), i.ward, 'ไม่ระบุวอร์ด') AS ward,
COALESCE(NULLIF(a.pdx, ''), '') AS primaryDiagnosis,
COALESCE(NULLIF(a.drg, ''), '') AS drg, COALESCE(a.rw, 0) AS rw,
CASE WHEN i.dchdate IS NULL THEN DATEDIFF(CURDATE(), i.regdate) ELSE DATEDIFF(i.dchdate, i.regdate) END AS stayDays,
ROUND(COALESCE(a.income, 0), 2) AS totalCharge,
CASE WHEN i.dchdate IS NULL THEN 'กำลังรักษา' ELSE 'จำหน่ายแล้ว' END AS status
FROM ipt i JOIN patient p ON p.hn = i.hn
LEFT JOIN an_stat a ON a.an = i.an LEFT JOIN ward w ON w.ward = i.ward
WHERE i.regdate BETWEEN ? AND ? OR i.dchdate BETWEEN ? AND ?
ORDER BY i.regdate, i.an LIMIT 20000
```

## 44. ipdWardPerformance — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / หอผู้ป่วย / ward

- Source: `server/hospitalReportTools.ts:537`
- Tables: `ipt`, `an_stat`, `ward`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, หอผู้ป่วย, ward, ipd Ward Performance
- Query ID: `2ed6f529f7e6`

```sql
SELECT COALESCE(NULLIF(w.name, ''), i.ward, 'ไม่ระบุวอร์ด') AS ward,
COUNT(DISTINCT i.an) AS dischargedCases,
ROUND(AVG(GREATEST(DATEDIFF(i.dchdate, i.regdate), 1)), 1) AS averageStayDays,
SUM(GREATEST(DATEDIFF(i.dchdate, i.regdate), 1)) AS patientDays,
ROUND(AVG(COALESCE(a.rw, 0)), 4) AS averageRw,
ROUND(SUM(COALESCE(a.rw, 0)), 4) AS totalRw,
ROUND(SUM(COALESCE(a.income, 0)), 2) AS totalCharge,
ROUND(AVG(COALESCE(a.income, 0)), 2) AS averageChargePerCase
FROM ipt i LEFT JOIN an_stat a ON a.an = i.an LEFT JOIN ward w ON w.ward = i.ward
WHERE i.dchdate BETWEEN ? AND ?
GROUP BY i.ward, w.name ORDER BY dischargedCases DESC
```

## 45. drugUtilization — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / รหัสเบิก / ADP / drug Utilization

- Source: `server/hospitalReportTools.ts:600`
- Tables: `opitemrece`, `s_drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, รหัสเบิก, ADP, drug Utilization
- Query ID: `f7f27dadbe86`

```sql
SELECT oi.icode AS itemCode, COALESCE(NULLIF(d.name, ''), oi.icode) AS itemName,
COALESCE(NULLIF(d.units, ''), '') AS unit,
COUNT(DISTINCT oi.vn) AS visits, COUNT(DISTINCT oi.hn) AS patients,
ROUND(SUM(COALESCE(oi.qty, 0)), 2) AS totalQuantity,
ROUND(SUM(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0)), 2) AS totalCharge
FROM opitemrece oi JOIN s_drugitems d ON d.icode = oi.icode
WHERE oi.vstdate BETWEEN ? AND ? AND COALESCE(d.is_medication, 'N') = 'Y'
GROUP BY oi.icode, d.name, d.units ORDER BY totalQuantity DESC LIMIT 1000
```

## 46. labWorkload — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / lab Workload

- Source: `server/hospitalReportTools.ts:628`
- Tables: `lab_head`, `lab_order`, `lab_items`
- Search terms: ผลแล็บ, ห้องปฏิบัติการ, รายการตรวจ, ชื่อแล็บ, ค่าปกติ, lab Workload
- Query ID: `36fdf3b21bbf`

```sql
SELECT lo.lab_items_code AS labCode,
COALESCE(NULLIF(li.lab_items_name, ''), NULLIF(lo.lab_items_name_ref, ''), lo.lab_items_code) AS labName,
COUNT(*) AS orderedTests,
SUM(CASE WHEN NULLIF(lo.lab_order_result, '') IS NOT NULL THEN 1 ELSE 0 END) AS resultedTests,
SUM(CASE WHEN lo.abnormal_result = 'Y' THEN 1 ELSE 0 END) AS abnormalResults,
COUNT(DISTINCT lh.vn) AS visits,
ROUND(SUM(CASE WHEN lo.abnormal_result = 'Y' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS abnormalPercent
FROM lab_head lh JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
LEFT JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
WHERE lh.order_date BETWEEN ? AND ?
GROUP BY lo.lab_items_code, li.lab_items_name, lo.lab_items_name_ref
ORDER BY orderedTests DESC LIMIT 1000
```

## 47. claimDataCompleteness — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/hospitalReportTools.ts:661`
- Tables: `ovst`, `patient`, `vn_stat`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, claim Data Completeness
- Query ID: `c26359d5819f`

```sql
SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
TRIM(CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, ''))) AS patientName,
COALESCE(p.cid, '') AS cid, COALESCE(o.pttype, '') AS payerCode,
COALESCE(v.pdx, '') AS primaryDiagnosis, ROUND(COALESCE(v.income, 0), 2) AS totalCharge,
CONCAT_WS(', ',
CASE WHEN NULLIF(p.cid, '') IS NULL THEN 'ไม่มี CID' END,
CASE WHEN NULLIF(o.pttype, '') IS NULL THEN 'ไม่มีสิทธิ' END,
CASE WHEN NULLIF(v.pdx, '') IS NULL THEN 'ไม่มีวินิจฉัยหลัก' END,
CASE WHEN COALESCE(v.income, 0) <= 0 THEN 'ไม่มียอดค่าใช้จ่าย' END
) AS missingData
FROM ovst o JOIN patient p ON p.hn = o.hn LEFT JOIN vn_stat v ON v.vn = o.vn
WHERE o.vstdate BETWEEN ? AND ?
AND (NULLIF(p.cid, '') IS NULL OR NULLIF(o.pttype, '') IS NULL OR NULLIF(v.pdx, '') IS NULL OR COALESCE(v.income, 0) <= 0)
ORDER BY o.vstdate, o.vn LIMIT 20000
```

## 48. revenueByCategory — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / หมวดค่าใช้จ่าย / รายได้ / revenue By Category

- Source: `server/hospitalReportTools.ts:696`
- Tables: `opitemrece`, `income`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, หมวดค่าใช้จ่าย, รายได้, revenue By Category
- Query ID: `7deac503b39d`

```sql
SELECT COALESCE(NULLIF(oi.income, ''), 'ไม่ระบุ') AS incomeCode,
COALESCE(NULLIF(i.name, ''), NULLIF(oi.income, ''), 'ไม่ระบุหมวด') AS incomeCategory,
COUNT(*) AS itemCount, COUNT(DISTINCT oi.vn) AS visits, COUNT(DISTINCT oi.hn) AS patients,
ROUND(SUM(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0)), 2) AS totalCharge,
ROUND(AVG(COALESCE(oi.sum_price, oi.qty * oi.unitprice, 0)), 2) AS averagePerItem
FROM opitemrece oi LEFT JOIN income i ON i.income = oi.income
WHERE oi.vstdate BETWEEN ? AND ?
GROUP BY oi.income, i.name ORDER BY totalCharge DESC
```

## 49. costPerDrg — สถิติ IPD / วินิจฉัยผู้ป่วยใน / cost Per Drg

- Source: `server/hospitalReportTools.ts:725`
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

## 50. payerMix — OPD / ผู้ป่วยนอก / visit / รับบริการ / สิทธิ / สิทธิการรักษา / payer Mix

- Source: `server/hospitalReportTools.ts:756`
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

## 51. module-query — OPD / ผู้ป่วยนอก / visit / รับบริการ / module-query

- Source: `server/index.ts:3537`
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

## 52. module-query — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/index.ts:3552`
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

## 53. module-query — สิทธิ / สิทธิการรักษา / module-query

- Source: `server/index.ts:5287`
- Tables: `pttype`
- Search terms: สิทธิ, สิทธิการรักษา, module-query
- Query ID: `fa670d0a2bc0`

```sql
SELECT pttype, name FROM pttype ORDER BY pttype
```

## 54. appendIpdAudit — IPD / ผู้ป่วยใน / admit / AN / append Ipd Audit

- Source: `server/ipdAuditService.ts:19`
- Tables: `ipt`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, append Ipd Audit
- Query ID: `c37399945c63`

```sql
SELECT an FROM ipt WHERE an = ? LIMIT 1
```

## 55. ipdMonthlyAccounting — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / สิทธิ / สิทธิการรักษา

- Source: `server/ipdMonthlyAccounting.ts:9`
- Tables: `ipt`, `an_stat`, `pttype`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, สิทธิ, สิทธิการรักษา, ipd Monthly Accounting
- Query ID: `ccc76cf5178f`

```sql
SELECT DATE_FORMAT(i.dchdate, '%Y-%m') AS month,
COALESCE(pt.hipdata_code,'') AS payer, COUNT(*) AS discharged,
SUM(COALESCE(a.admdate,0)) AS days, SUM(COALESCE(i.adjrw,0)) AS weight,
SUM(COALESCE(a.income,0)) AS charge,
SUM(CASE WHEN i.adjrw IS NULL THEN 1 ELSE 0 END) AS missing_weight
FROM ipt i LEFT JOIN an_stat a ON a.an=i.an LEFT JOIN pttype pt ON pt.pttype=i.pttype
WHERE i.dchdate >= ? AND i.dchdate < ?
GROUP BY DATE_FORMAT(i.dchdate, '%Y-%m'), pt.hipdata_code
```

## 56. ipdMonthlyAccounting — IPD / ผู้ป่วยใน / admit / AN / ipd Monthly Accounting

- Source: `server/ipdMonthlyAccounting.ts:17`
- Tables: `ipt`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, ipd Monthly Accounting
- Query ID: `a347b5356f57`

```sql
SELECT DATE_FORMAT(regdate, '%Y-%m') AS month, COUNT(*) AS admitted
FROM ipt WHERE regdate >= ? AND regdate < ? GROUP BY DATE_FORMAT(regdate, '%Y-%m')
```

## 57. matchKtbRowsWithHosxp — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / OPD / ผู้ป่วยนอก / visit / รับบริการ

- Source: `server/ktbApproveCode.ts:239`
- Tables: `opitemrece`, `ovst`, `patient`, `pttype`, `visit_pttype`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, สิทธิ visit, auth code, match Ktb Rows With Hosxp
- Query ID: `02249c63f5a4`

```sql
SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') as vstdate, o.vsttime, o.an, o.pttype,
pttype.name as pttype_name,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patient_name,
vp.auth_code,
DATE_FORMAT(vp.Auth_DateTime, '%Y-%m-%d %H:%i:%s') as auth_datetime,
COALESCE((SELECT SUM(sum_price) FROM opitemrece WHERE vn = o.vn), 0) as total_price
FROM ovst o
JOIN patient pt ON o.hn = pt.hn
LEFT JOIN pttype ON o.pttype = pttype.pttype
LEFT JOIN visit_pttype vp ON o.vn = vp.vn
WHERE pt.cid = ? AND o.vstdate = ?
ORDER BY o.vsttime DESC
```

## 58. applyKtbApproveCodes — สิทธิ visit / auth code / apply Ktb Approve Codes

- Source: `server/ktbApproveCode.ts:386`
- Tables: `visit_pttype`
- Search terms: สิทธิ visit, auth code, apply Ktb Approve Codes
- Query ID: `927a1fd02f9a`

```sql
SELECT auth_code FROM visit_pttype WHERE vn = ? LIMIT 1
```

## 59. fetchReconciliationMaps — FDH / สถานะเคลม / ข้อผิดพลาด / ส่งเบิก / fetch Reconciliation Maps

- Source: `server/officialReceivableReportService.ts:117`
- Tables: `fdh_claim_status`
- Search terms: FDH, สถานะเคลม, ข้อผิดพลาด, ส่งเบิก, fetch Reconciliation Maps
- Query ID: `dd10e7cb8840`

```sql
SELECT
vn,
COALESCE(transaction_uid, '') AS tx_id,
COALESCE(fdh_claim_status_message, '') AS status_msg,
COALESCE(fdh_stm_period, '') AS stm_period,
DATE_FORMAT(fdh_claim_status_datetime, '%d/%m/%Y %H:%i') AS send_date
FROM fdh_claim_status
WHERE vn IN (?)
```

## 60. getOfficialReceivableAgingReport — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / get Official Receivable Aging Report

- Source: `server/officialReceivableReportService.ts:383`
- Tables: `ovst`, `vn_stat`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, get Official Receivable Aging Report
- Query ID: `507b16dd808a`

```sql
SELECT
o.pttype,
o.vstdate,
o.vn,
DATEDIFF(?, o.vstdate) AS age_days,
COALESCE(v.income, 0) AS total_income,
COALESCE(v.rcpt_money, 0) AS paid_money
FROM ovst o
JOIN vn_stat v ON v.vn = o.vn
WHERE o.vstdate BETWEEN ? AND ?
AND COALESCE(v.income, 0) > 0
```

## 61. getOfficialReceivableAgingReport — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / get Official Receivable Aging Report

- Source: `server/officialReceivableReportService.ts:399`
- Tables: `ipt`, `an_stat`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, get Official Receivable Aging Report
- Query ID: `ab8b6e4c1742`

```sql
SELECT
i.pttype,
i.an,
COALESCE(i.vn, '') AS vn,
COALESCE(i.dchdate, i.regdate) AS discharge_date,
DATEDIFF(?, COALESCE(i.dchdate, i.regdate)) AS age_days,
COALESCE(a.income, 0) AS total_income,
COALESCE(a.rcpt_money, 0) AS paid_money
FROM ipt i
JOIN an_stat a ON a.an = i.an
WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
AND COALESCE(a.income, 0) > 0
```

## 62. getOfficialClaimControlLedger — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / ผู้ป่วย

- Source: `server/officialReceivableReportService.ts:642`
- Tables: `ovst`, `vn_stat`, `patient`, `pttype`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, get Official Claim Control Ledger
- Query ID: `b975ceffbe80`

```sql
SELECT
o.hn,
o.vn,
'' AS an,
COALESCE(pt.cid, '') AS cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
DATE_FORMAT(o.vstdate, '%d/%m/%Y') AS service_date_fmt,
o.vstdate AS service_date_raw,
'' AS discharge_date_fmt,
COALESCE(ptt.name, o.pttype) AS pttype_name,
o.pttype,
COALESCE(v.income, 0) AS cost_amount,
'' AS claim_code,
COALESCE(v.rcpt_money, 0) AS paid_money,
CASE WHEN COALESCE(v.rcpt_money, 0) > 0 THEN DATE_FORMAT(o.vstdate, '%d/%m/%Y') ELSE '' END AS paid_date_fmt
FROM ovst o
JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN patient pt ON pt.hn = o.hn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
WHERE o.vstdate BETWEEN ? AND ?
AND COALESCE(v.income, 0) > 0
ORDER BY o.vstdate, o.vn
```

## 63. getOfficialClaimControlLedger — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / ผู้ป่วย / คนไข้

- Source: `server/officialReceivableReportService.ts:668`
- Tables: `ipt`, `an_stat`, `patient`, `pttype`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, get Official Claim Control Ledger
- Query ID: `e8900bbf6799`

```sql
SELECT
i.hn,
COALESCE(i.vn, '') AS vn,
i.an,
COALESCE(pt.cid, '') AS cid,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
DATE_FORMAT(i.regdate, '%d/%m/%Y') AS service_date_fmt,
COALESCE(i.dchdate, i.regdate) AS service_date_raw,
DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%d/%m/%Y') AS discharge_date_fmt,
COALESCE(ptt.name, i.pttype) AS pttype_name,
i.pttype,
COALESCE(a.income, 0) AS cost_amount,
'' AS claim_code,
COALESCE(a.rcpt_money, 0) AS paid_money,
'' AS paid_date_fmt
FROM ipt i
JOIN an_stat a ON a.an = i.an
LEFT JOIN patient pt ON pt.hn = i.hn
LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
AND COALESCE(a.income, 0) > 0
ORDER BY COALESCE(i.dchdate, i.regdate), i.an
```

## 64. getOfficialOpdControlRegister — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / ผู้ป่วย

- Source: `server/officialReceivableReportService.ts:908`
- Tables: `ovst`, `vn_stat`, `patient`, `pttype`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, get Official Opd Control Register
- Query ID: `a64bf2bebc86`

```sql
SELECT
o.hn,
o.vn,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
DATE_FORMAT(o.vstdate, '%d/%m/%Y') AS service_date_fmt,
o.vstdate AS service_date_raw,
COALESCE(ptt.name, o.pttype) AS pttype_name,
o.pttype,
COALESCE(v.income, 0) AS monthly_income,
COALESCE(v.rcpt_money, 0) AS paid_money,
COALESCE(v.rcp_no, '') AS rcp_no
FROM ovst o
JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN patient pt ON pt.hn = o.hn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
WHERE o.vstdate BETWEEN ? AND ?
AND COALESCE(v.income, 0) > 0
ORDER BY o.vstdate, o.vn
```

## 65. getOfficialIpdControlRegister — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / ผู้ป่วย / คนไข้

- Source: `server/officialReceivableReportService.ts:1129`
- Tables: `ipt`, `an_stat`, `patient`, `pttype`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, get Official Ipd Control Register
- Query ID: `efa364f64fca`

```sql
SELECT
i.hn,
i.an,
COALESCE(i.vn, '') AS vn,
CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
DATE_FORMAT(i.regdate, '%d/%m/%Y') AS admit_date_fmt,
DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%d/%m/%Y') AS dch_date_fmt,
COALESCE(i.dchdate, i.regdate) AS dch_date_raw,
COALESCE(ptt.name, i.pttype) AS pttype_name,
i.pttype,
COALESCE(a.income, 0) AS monthly_income,
COALESCE(a.rcpt_money, 0) AS paid_money,
COALESCE(a.rcpno_list, '') AS rcp_no
FROM ipt i
JOIN an_stat a ON a.an = i.an
LEFT JOIN patient pt ON pt.hn = i.hn
LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
AND COALESCE(a.income, 0) > 0
ORDER BY COALESCE(i.dchdate, i.regdate), i.an
```

## 66. getDoctorCodeByCid — แพทย์ / ผู้ตรวจ / get Doctor Code By Cid

- Source: `server/repositories/claims.repository.ts:302`
- Tables: `doctor`
- Search terms: แพทย์, ผู้ตรวจ, get Doctor Code By Cid
- Query ID: `1dc7cf49acd4`

```sql
SELECT code
FROM doctor
WHERE cid = ?
LIMIT 1
```

## 67. getNhsoClosePrivilegeHistory — สปสช. / ยืนยันสิทธิ / get Nhso Close Privilege History

- Source: `server/repositories/claims.repository.ts:622`
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

## 68. validateCheckCompletenesss — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / validate Check Completenesss

- Source: `server/repositories/claims.repository.ts:2601`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, validate Check Completenesss
- Query ID: `b010f56c81e0`

```sql
SELECT fname, lname, pttype FROM patient WHERE hn = ?
```

## 69. validateCheckCompletenesss — OPD / ผู้ป่วยนอก / visit / รับบริการ / validate Check Completenesss

- Source: `server/repositories/claims.repository.ts:2611`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, validate Check Completenesss
- Query ID: `ae320d2586c8`

```sql
SELECT vn, vstdate, ovstost FROM ovst WHERE vn = ? AND hn = ?
```

## 70. validateCheckCompletenesss — วินิจฉัย / ICD10 / diagnosis / validate Check Completenesss

- Source: `server/repositories/claims.repository.ts:2621`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, validate Check Completenesss
- Query ID: `e6f55619aadc`

```sql
SELECT COUNT(*) as count FROM ovstdiag WHERE vn = ?
```

## 71. validateCheckCompletenesss — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / validate Check Completenesss

- Source: `server/repositories/claims.repository.ts:2631`
- Tables: `opitemrece`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, validate Check Completenesss
- Query ID: `00184c8f5271`

```sql
SELECT COUNT(*) as count FROM opitemrece WHERE vn = ?
```

## 72. importFdhStatusForDateRange — OPD / ผู้ป่วยนอก / visit / รับบริการ / import Fdh Status For Date Range

- Source: `server/repositories/claims.repository.ts:4017`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, import Fdh Status For Date Range
- Query ID: `ac942e219c37`

```sql
SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate,'%Y-%m-%d') AS vstdate
FROM ovst o
WHERE o.vstdate BETWEEN ? AND ?
ORDER BY o.vstdate, o.vn
```

## 73. getPatientData — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / get Patient Data

- Source: `server/repositories/clinical.repository.ts:117`
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

## 74. getSpecificFundData — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/repositories/clinical.repository.ts:1237`
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

## 75. getSpecificFundData — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / drug / OPD / ผู้ป่วยนอก / visit

- Source: `server/repositories/clinical.repository.ts:1418`
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

## 76. getSpecificFundData — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / authen / ยืนยันสิทธิ / OPD

- Source: `server/repositories/clinical.repository.ts:2538`
- Tables: `lab_head`, `lab_order`, `lab_items`, `authenhos`, `ovst`, `patient`, `opdscreen`, `pttype`, `vn_stat`, `ovstdiag`
- Search terms: ผลแล็บ, ห้องปฏิบัติการ, รายการตรวจ, ชื่อแล็บ, ค่าปกติ, authen, ยืนยันสิทธิ, OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, คัดกรอง, อาการ, ความดัน, น้ำหนัก, สิทธิ, สิทธิการรักษา, สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, วินิจฉัย, ICD10, diagnosis, get Specific Fund Data
- Query ID: `5b5d2a7a5a31`

```sql
SELECT
o.vn, o.hn,
DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
ptt.name as pttypename, ptt.hipdata_code,
COALESCE(v.sex, pt.sex) as sex,
v.age_y as age,
CASE WHEN v.age_y >= 35 THEN 'Y' ELSE 'N' END as age_eligible,
os.bps, os.bpd,
os.bw as weight, os.height, os.bmi,
CASE WHEN os.bps > 0 AND os.bpd > 0 THEN 'Y' ELSE 'N' END as has_bp,
CASE WHEN os.bmi > 0 OR (os.bw > 0 AND os.height > 0) THEN 'Y' ELSE 'N' END as has_bmi,
(
SELECT lo.lab_order_result
FROM lab_head lh
JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
WHERE lh.vn = o.vn AND UPPER(li.lab_items_name) REGEXP 'GLUCOSE|FBS|FPG|DTX'
LIMIT 1
) as fbs,
CASE WHEN EXISTS (
SELECT 1 FROM lab_head lh
JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
WHERE lh.vn = o.vn AND UPPER(li.lab_items_name) REGEXP 'GLUCOSE|FBS|FPG|DTX'
) THEN 'Y' ELSE 'N' END as has_fbs,
(SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
FROM ovst o
JOIN patient pt ON o.hn = pt.hn
LEFT JOIN opdscreen os ON os.vn = o.vn
LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
LEFT JOIN vn_stat v ON v.vn = o.vn
WHERE o.vstdate BETWEEN ? AND ?
AND v.age_y >= 35
AND (
EXISTS (
SELECT 1 FROM lab_head lh
JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
WHERE lh.vn = o.vn AND UPPER(li.lab_items_name) REGEXP 'GLUCOSE|FBS|FPG|DTX'
)
OR EXISTS (
SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 = 'Z131'
)
)
GROUP BY o.vn
ORDER BY o.vstdate DESC
```

## 77. getRevenueOpportunitySourceRows — IPD / ผู้ป่วยใน / admit / AN / ยา / บริการ / ค่าใช้จ่าย / รายการเบิก

- Source: `server/repositories/clinical.repository.ts:2811`
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

## 78. resolveRepIncome — สถิติ IPD / วินิจฉัยผู้ป่วยใน / resolve Rep Income

- Source: `server/repositories/receivables.repository.ts:721`
- Tables: `an_stat`
- Search terms: สถิติ IPD, วินิจฉัยผู้ป่วยใน, resolve Rep Income
- Query ID: `5992c59ac725`

```sql
SELECT ROUND(IFNULL(income, 0) - IFNULL(discount_money, 0) - IFNULL(rcpt_money, 0), 2) AS income
FROM an_stat
WHERE an = ?
LIMIT 1
```

## 79. resolveRepIncome — สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / resolve Rep Income

- Source: `server/repositories/receivables.repository.ts:732`
- Tables: `vn_stat`
- Search terms: สถิติ OPD, วินิจฉัยหลัก, ค่าใช้จ่าย, resolve Rep Income
- Query ID: `c55a2c4f573c`

```sql
SELECT ROUND(IFNULL(income, 0) - IFNULL(discount_money, 0) - IFNULL(rcpt_money, 0), 2) AS income
FROM vn_stat
WHERE vn = ?
LIMIT 1
```

## 80. getReceivableFilterOptions — สิทธิ / สิทธิการรักษา / get Receivable Filter Options

- Source: `server/repositories/receivables.repository.ts:1809`
- Tables: `pttype`
- Search terms: สิทธิ, สิทธิการรักษา, get Receivable Filter Options
- Query ID: `9cfa59a51803`

```sql
SELECT pttype AS code, name, hipdata_code
FROM pttype
ORDER BY pttype
```

## 81. getRepDailyClaimSummary — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / ผู้ป่วย

- Source: `server/repositories/receivables.repository.ts:3417`
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

## 82. getRepDailyClaimSummary — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / สิทธิ / สิทธิการรักษา

- Source: `server/repositories/receivables.repository.ts:3462`
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

## 83. getRepDailyVisitsForDate — OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก / ค่าใช้จ่าย / ผู้ป่วย

- Source: `server/repositories/receivables.repository.ts:3666`
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

## 84. getRepDailyVisitsForDate — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / สิทธิ / สิทธิการรักษา

- Source: `server/repositories/receivables.repository.ts:3712`
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

## 85. getRepDailyVisitDetail — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/repositories/receivables.repository.ts:3843`
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

## 86. getRepDailyVisitDetail — วินิจฉัย / ICD10 / diagnosis / ชื่อโรค / get Rep Daily Visit Detail

- Source: `server/repositories/receivables.repository.ts:3866`
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

## 87. getRepDailyVisitDetail — หัตถการ / ICD9 / ชื่อหัตถการ / get Rep Daily Visit Detail

- Source: `server/repositories/receivables.repository.ts:3876`
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

## 88. getRepDailyVisitDetail — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / get Rep Daily Visit Detail

- Source: `server/repositories/receivables.repository.ts:3890`
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

## 89. getRepDailyVisitDetail — IPD / ผู้ป่วยใน / admit / AN / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/repositories/receivables.repository.ts:3904`
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

## 90. getRepDailyVisitDetail — ผลแล็บ / ห้องปฏิบัติการ / รายการตรวจ / ชื่อแล็บ / ค่าปกติ / IPD / ผู้ป่วยใน / admit

- Source: `server/repositories/receivables.repository.ts:3947`
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

## 91. getInsuranceOverview — authen / ยืนยันสิทธิ / OPD / ผู้ป่วยนอก / visit / รับบริการ / สถิติ OPD / วินิจฉัยหลัก

- Source: `server/repositories/receivables.repository.ts:4534`
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

## 92. getInsuranceOverview — authen / ยืนยันสิทธิ / OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้

- Source: `server/repositories/receivables.repository.ts:4556`
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

## 93. getInsuranceOverview — IPD / ผู้ป่วยใน / admit / AN / สถิติ IPD / วินิจฉัยผู้ป่วยใน / ผู้ป่วย / คนไข้

- Source: `server/repositories/receivables.repository.ts:4587`
- Tables: `ipt`, `an_stat`, `patient`, `pttype`, `ward`, `fdh_claim_status`
- Search terms: IPD, ผู้ป่วยใน, admit, AN, สถิติ IPD, วินิจฉัยผู้ป่วยใน, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, สิทธิ, สิทธิการรักษา, หอผู้ป่วย, ward, FDH, สถานะเคลม, ข้อผิดพลาด, ส่งเบิก, get Insurance Overview
- Query ID: `860d33d6388a`

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
COALESCE(w.name, i.ward, '') AS ward,
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
LEFT JOIN ward w ON w.ward = i.ward
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

## 94. testDatabaseConnection — ผู้ป่วย / คนไข้ / HN / CID / ข้อมูลประชากร / test Database Connection

- Source: `server/repositories/system.repository.ts:717`
- Tables: `patient`
- Search terms: ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, test Database Connection
- Query ID: `545171404f70`

```sql
SELECT COUNT(*) as count FROM patient LIMIT 1
```

## 95. testDatabaseConnection — OPD / ผู้ป่วยนอก / visit / รับบริการ / test Database Connection

- Source: `server/repositories/system.repository.ts:720`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, test Database Connection
- Query ID: `60ed0786577d`

```sql
SELECT COUNT(*) as count FROM ovst WHERE vstdate >= CURDATE() - INTERVAL 30 DAY
```

## 96. testSDrugitemsStructure — ยา / รหัสเบิก / ADP / test SDrugitems Structure

- Source: `server/repositories/system.repository.ts:809`
- Tables: `s_drugitems`
- Search terms: ยา, รหัสเบิก, ADP, test SDrugitems Structure
- Query ID: `477fa50bb461`

```sql
SELECT * FROM s_drugitems LIMIT 5
```

## 97. testReceiptJoin — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / test Receipt Join

- Source: `server/repositories/system.repository.ts:831`
- Tables: `opitemrece`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, test Receipt Join
- Query ID: `b1968dcbb191`

```sql
SELECT * FROM opitemrece WHERE vn = ? LIMIT 5
```

## 98. testReceiptJoin — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / รหัสเบิก / ADP / test Receipt Join

- Source: `server/repositories/system.repository.ts:844`
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

## 99. detectRepSheetZeroFix — สิทธิ visit / auth code / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:78`
- Tables: `visit_pttype`
- Search terms: สิทธิ visit, auth code, detect Rep Sheet Zero Fix
- Query ID: `2370046d7ab5`

```sql
SELECT auth_code FROM visit_pttype WHERE vn = ? AND TRIM(IFNULL(auth_code, '')) <> '' LIMIT 1
```

## 100. detectRepSheetZeroFix — authen / ยืนยันสิทธิ / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:87`
- Tables: `authenhos`
- Search terms: authen, ยืนยันสิทธิ, detect Rep Sheet Zero Fix
- Query ID: `6cb86f40ad6a`

```sql
SELECT claim_code FROM authenhos
WHERE (vn = ? OR (? <> '' AND pid = ? AND created_date = ?))
AND TRIM(IFNULL(claim_code, '')) <> ''
ORDER BY created_date DESC, created_time DESC LIMIT 1
```

## 101. detectRepSheetZeroFix — วินิจฉัย / ICD10 / diagnosis / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:108`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, detect Rep Sheet Zero Fix
- Query ID: `f0229d23a7d2`

```sql
SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND icd10 REGEXP '^[0-9]'
```

## 102. detectRepSheetZeroFix — วินิจฉัย / ICD10 / diagnosis / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:131`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, detect Rep Sheet Zero Fix
- Query ID: `5b0eb43beba6`

```sql
SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND (icd10 LIKE 'K0%' OR icd10 LIKE 'Z012%')
```

## 103. detectRepSheetZeroFix — วินิจฉัย / ICD10 / diagnosis / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:149`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, detect Rep Sheet Zero Fix
- Query ID: `5cdc3c8459d0`

```sql
SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND diagtype = '1'
```

## 104. detectRepSheetZeroFix — วินิจฉัย / ICD10 / diagnosis / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:155`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, detect Rep Sheet Zero Fix
- Query ID: `246eae0cdc00`

```sql
SELECT ovst_diag_id, icd10 FROM ovstdiag WHERE vn = ? ORDER BY ovst_diag_id ASC LIMIT 1
```

## 105. detectRepSheetZeroFix — วินิจฉัย / ICD10 / diagnosis / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:184`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, detect Rep Sheet Zero Fix
- Query ID: `c1311f3356d8`

```sql
SELECT icd10 FROM ovstdiag WHERE vn = ?
```

## 106. detectRepSheetZeroFix — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / drug / detect Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:213`
- Tables: `opitemrece`, `drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, drug, detect Rep Sheet Zero Fix
- Query ID: `fee2dfd8ef0d`

```sql
SELECT DISTINCT di.name
FROM opitemrece oo
JOIN drugitems di ON di.icode = oo.icode
WHERE oo.vn = ?
AND (di.name LIKE '%morphine%' OR di.generic_name LIKE '%morphine%' OR di.name LIKE '%มอร์ฟีน%' OR di.name LIKE '%mst%' OR di.name LIKE '%kapanol%')
AND COALESCE(oo.qty, 0) > 0
```

## 107. applyRepSheetZeroFix — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/repSheetZeroAutoFix.ts:308`
- Tables: `ovst`, `patient`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, apply Rep Sheet Zero Fix
- Query ID: `9707e81ccb87`

```sql
SELECT o.hn, o.vstdate, o.vsttime, o.doctor, pt.cid
FROM ovst o
LEFT JOIN patient pt ON o.hn = pt.hn
WHERE o.vn = ? LIMIT 1
```

## 108. applyRepSheetZeroFix — วินิจฉัย / ICD10 / diagnosis / apply Rep Sheet Zero Fix

- Source: `server/repSheetZeroAutoFix.ts:420`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, apply Rep Sheet Zero Fix
- Query ID: `4972a742967a`

```sql
SELECT icd10 FROM ovstdiag WHERE vn = ? AND diagtype = '1' LIMIT 1
```

## 109. testKidneyMonitor — OPD / ผู้ป่วยนอก / visit / รับบริการ / test Kidney Monitor

- Source: `server/test_kidney_db.ts:9`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, test Kidney Monitor
- Query ID: `ef2099d60bf2`

```sql
SELECT COUNT(*) as cnt FROM ovst LIMIT 1
```

## 110. testKidneyMonitor — OPD / ผู้ป่วยนอก / visit / รับบริการ / วินิจฉัย / ICD10 / diagnosis / test Kidney Monitor

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

## 111. getUcOutsideCupWalkinAudit — ยา / รหัสเบิก / ADP / get Uc Outside Cup Walkin Audit

- Source: `server/ucOutsideCupWalkin.ts:70`
- Tables: `s_drugitems`
- Search terms: ยา, รหัสเบิก, ADP, get Uc Outside Cup Walkin Audit
- Query ID: `944c76d9d04f`

```sql
SELECT icode FROM s_drugitems WHERE icode = ? LIMIT 1
```

## 112. getNextOvstDiagId — วินิจฉัย / ICD10 / diagnosis / get Next Ovst Diag Id

- Source: `server/ucOutsideCupWalkin.ts:1105`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, get Next Ovst Diag Id
- Query ID: `5c4e709efa34`

```sql
SELECT COALESCE(MAX(ovst_diag_id), 0) + 1 AS id FROM ovstdiag
```

## 113. fixWalkinClinicalVisit — OPD / ผู้ป่วยนอก / visit / รับบริการ / ผู้ป่วย / คนไข้ / HN / CID

- Source: `server/ucOutsideCupWalkin.ts:1119`
- Tables: `ovst`, `patient`, `kskdepartment`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, ผู้ป่วย, คนไข้, HN, CID, ข้อมูลประชากร, แผนก, หน่วยงาน, fix Walkin Clinical Visit
- Query ID: `e6dd30c9e4d2`

```sql
SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
COALESCE(o.hospmain, '') AS hospmain,
COALESCE(CONCAT(p.pname, p.fname, ' ', p.lname), '') AS patient_name,
COALESCE(p.sex, '') AS sex,
COALESCE(TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate), 0) AS age_y,
COALESCE(k.department, o.main_dep, '') AS department
FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
WHERE o.vn = ?
LIMIT 1
```

## 114. fixWalkinClinicalVisit — วินิจฉัย / ICD10 / diagnosis / ชื่อโรค / fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1141`
- Tables: `ovstdiag`, `icd101`
- Search terms: วินิจฉัย, ICD10, diagnosis, ชื่อโรค, fix Walkin Clinical Visit
- Query ID: `75ed28da28b9`

```sql
SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name
FROM ovstdiag d
LEFT JOIN icd101 i ON i.code = d.icd10
WHERE d.vn = ?
ORDER BY d.diagtype
```

## 115. fixWalkinClinicalVisit — fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1158`
- Tables: `dtmain`, `dttm`
- Search terms: fix Walkin Clinical Visit
- Query ID: `b7dcef3053e7`

```sql
SELECT dm.vn,
COALESCE(NULLIF(dm.icd9, ''), NULLIF(tm.icd10tm_operation_code, ''), NULLIF(tm.icd9cm, ''), dm.tmcode, '') AS code,
COALESCE(tm.name, 'หัตถการทันตกรรม') AS name,
'Dental' AS type,
COALESCE(dm.tmcode, '') AS tmcode,
COALESCE(tm.icd10tm_operation_code, '') AS icd10tm
FROM dtmain dm
LEFT JOIN dttm tm ON tm.code = dm.tmcode
WHERE dm.vn = ?
```

## 116. fixWalkinClinicalVisit — ยา / บริการ / ค่าใช้จ่าย / รายการเบิก / รหัสเบิก / ADP / fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1173`
- Tables: `opitemrece`, `s_drugitems`
- Search terms: ยา, บริการ, ค่าใช้จ่าย, รายการเบิก, รหัสเบิก, ADP, fix Walkin Clinical Visit
- Query ID: `c3234c406200`

```sql
SELECT opi.vn, opi.icode, opi.qty, opi.unitprice, opi.sum_price, opi.income,
COALESCE(sd.name, '') AS name
FROM opitemrece opi
LEFT JOIN s_drugitems sd ON sd.icode = opi.icode
WHERE opi.vn = ?
```

## 117. fixWalkinClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1310`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Walkin Clinical Visit
- Query ID: `7f59bc46e4fd`

```sql
SELECT icd10 FROM ovstdiag
WHERE vn = ? AND (icd10 LIKE 'K0%' OR icd10 LIKE 'K1%') AND diagtype <> '1'
ORDER BY (icd10 LIKE 'K05%') DESC, (icd10 LIKE 'K02%') DESC
LIMIT 1
```

## 118. fixWalkinClinicalVisit — fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1380`
- Tables: `dtmain`, `dttm`
- Search terms: fix Walkin Clinical Visit
- Query ID: `bddd8d5b0173`

```sql
SELECT dm.tmcode, COALESCE(tm.name, '') AS name
FROM dtmain dm
LEFT JOIN dttm tm ON tm.code = dm.tmcode
WHERE dm.vn = ?
AND (
COALESCE(tm.icd10tm_operation_code, '') IN ('2330011', '2387010')
OR dm.tmcode IN ('2330011', '2387010')
OR COALESCE(dm.icd9, '') IN ('2330011', '2387010')
OR COALESCE(tm.name, '') LIKE '%หญิงมีครรภ์%'
OR COALESCE(tm.name, '') LIKE '%หญิงตั้งครรภ์%'
OR COALESCE(tm.name, '') LIKE '%ANC%'
)
```

## 119. fixWalkinClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1439`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Walkin Clinical Visit
- Query ID: `c5f02f57e19a`

```sql
SELECT ovst_diag_id, icd10, diagtype, doctor
FROM ovstdiag
WHERE vn = ? AND icd10 REGEXP '^[0-9]'
```

## 120. fixWalkinClinicalVisit — OPD / ผู้ป่วยนอก / visit / รับบริการ / fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1447`
- Tables: `ovst`
- Search terms: OPD, ผู้ป่วยนอก, visit, รับบริการ, fix Walkin Clinical Visit
- Query ID: `4d0dcdb1bf4a`

```sql
SELECT hn, vstdate, vsttime, doctor FROM ovst WHERE vn = ? LIMIT 1
```

## 121. fixWalkinClinicalVisit — fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1457`
- Tables: `dtmain`
- Search terms: fix Walkin Clinical Visit
- Query ID: `c15179e4b298`

```sql
SELECT COALESCE(MAX(tm_no), 0) AS max_no FROM dtmain WHERE vn = ?
```

## 122. fixWalkinClinicalVisit — fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1539`
- Tables: `dtmain`
- Search terms: fix Walkin Clinical Visit
- Query ID: `1bf614b89166`

```sql
SELECT COUNT(*) AS cnt FROM dtmain WHERE vn = ?
```

## 123. fixWalkinClinicalVisit — fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1564`
- Tables: `dttm`
- Search terms: fix Walkin Clinical Visit
- Query ID: `f99de5c2e8f4`

```sql
SELECT code, icd9cm, icd10tm_operation_code FROM dttm WHERE code = '3002' LIMIT 1
```

## 124. fixWalkinClinicalVisit — วินิจฉัย / ICD10 / diagnosis / fix Walkin Clinical Visit

- Source: `server/ucOutsideCupWalkin.ts:1651`
- Tables: `ovstdiag`
- Search terms: วินิจฉัย, ICD10, diagnosis, fix Walkin Clinical Visit
- Query ID: `11ef0230fb30`

```sql
SELECT ovst_diag_id, diagtype FROM ovstdiag WHERE vn = ? AND icd10 = ? LIMIT 1
```
