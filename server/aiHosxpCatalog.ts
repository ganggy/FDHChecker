export const AI_ALLOWED_HOSXP_TABLES = new Set([
  'patient', 'ovst', 'vn_stat', 'ipt', 'an_stat', 'ovstdiag', 'iptdiag', 'opdscreen',
  'opitemrece', 'drugitems', 's_drugitems', 'nondrugitems', 'income',
  'lab_head', 'lab_order', 'lab_items', 'oapp', 'clinic', 'kskdepartment',
  'pttype', 'pttype_group', 'ward', 'doctor', 'doctor_operation', 'iptoprt', 'icd101', 'icd9cm1',
  'dtmain', 'dttm', 'er_regist', 'er_regist_oper', 'er_oper_code',
  'referin', 'referout', 'hospcode', 'refer_cause', 'rfrcs',
  'person_anc', 'person_anc_service', 'ovst_seq',
  'authenhos', 'visit_pttype', 'nhso_confirm_privilege', 'fdh_claim_status',
  'ovstist', 'spclty',
]);

export const HOSXP_SEMANTIC_CATALOG = `
ฐานข้อมูล HOSxP ที่อนุญาตให้อ่าน (ใช้ชื่อคอลัมน์ตามนี้เท่านั้น)

ผู้ป่วยและ Visit
- patient p: hn, pname, fname, lname, cid, birthday, sex, bloodgrp, hometel, drugallergy
- ovst o: vn, hn, an, vstdate, vsttime, pttype, main_dep, hospmain, hosp_sub, doctor, ovstist
- vn_stat v: vn, hn, vstdate, age_y, sex, income, pdx, pttype
- ipt i: an, hn, vn, regdate, regtime, dchdate, dchtime, ward, pttype
- an_stat a: an, hn, vn, regdate, dchdate, ward, pdx, dx0, dx1, dx2, dx3, dx4, dx5, income, drg, rw, adjrw
ความสัมพันธ์: patient.hn=ovst.hn, ovst.vn=vn_stat.vn, ipt.an=an_stat.an

วินิจฉัยและอาการ
- ovstdiag d: vn, icd10, diagtype (diagtype='1' คือวินิจฉัยหลัก)
- iptdiag id: an, icd10, diagtype (วินิจฉัยผู้ป่วยใน)
- opdscreen os: vn, cc, hpi, bw, height, bps, bpd, pulse, temperature
- icd101: code, name
- doctor_operation: vn, icd9; iptoprt io: an, icd9, opdate, optime, doctor; icd9cm1: code, name

การส่งต่อ (Refer) และโรงพยาบาล
- referout r: vn, hn, refer_date, refer_time, refer_hospcode, hospcode, refer_number, refer_cause, pre_diagnosis, pdx, doctor, department, pttype
- referin ri: vn, hn, refer_date, refer_hospcode, hospcode, refer_number, icd10, refer_point
- hospcode h: hospcode, name, hosptype, chwpart, amppart (ชื่อ รพ.ปลายทาง/ต้นทาง เช่น h.name LIKE '%ศิริราช%')
ความสัมพันธ์: COALESCE(NULLIF(r.refer_hospcode,''), r.hospcode) = h.hospcode (หรือ r.refer_hospcode = h.hospcode), r.hn = patient.hn

ฉุกเฉิน ฝากครรภ์ (ANC) และกลุ่มสิทธิ
- er_regist er: vn, vstdate, er_pt_type, er_emergency_type, er_dch_type
- person_anc pa: person_anc_id, person_id, preg_no, lmp, edc
- person_anc_service pas: person_anc_id, vn, anc_service_date
- pttype_group pg: pttype_group, name

ยา บริการ และค่าใช้จ่าย
- opitemrece oi: vn, an, hn, icode, qty, unitprice, sum_price, income
- drugitems / s_drugitems: icode, name, ttmt_code; s_drugitems มี nhso_adp_code
- nondrugitems: icode, name, nhso_adp_type_id
- income: income, name

ผลตรวจ
- lab_head lh: lab_order_number, vn, hn, order_date, order_time
- lab_order lo: lab_order_number, lab_items_code, lab_order_result
- lab_items li: lab_items_code, lab_items_name, lab_items_normal_value
ความสัมพันธ์: lab_head.lab_order_number=lab_order.lab_order_number และ lab_order.lab_items_code=lab_items.lab_items_code

นัดหมายและหน่วยบริการ
- oapp ap: oapp_id, hn, vn, nextdate, nexttime, clinic, depcode, app_cause, oapp_status_id
- clinic c: clinic, name
- kskdepartment k: depcode, department
- ward w: ward, name
- pttype pt: pttype, name, hipdata_code

สิทธิและ FDH
- authenhos: vn, claim_code
- visit_pttype: vn, auth_code
- nhso_confirm_privilege: vn, nhso_status, nhso_authen_code
- fdh_claim_status: vn, transaction_uid, fdh_reservation_status, fdh_claim_status_message, error_code, updated_at

หลักการนับ
- จำนวนคน: COUNT(DISTINCT hn)
- จำนวนครั้ง OPD: COUNT(DISTINCT vn)
- จำนวนครั้ง IPD: COUNT(DISTINCT an)
- OPD หมายถึงข้อมูลในตาราง ovst และใช้ ovst.vstdate; ห้ามใช้เงื่อนไข pttype='OPD' เพราะ pttype คือรหัสสิทธิ ไม่ใช่ประเภทผู้ป่วย
- IPD หมายถึงข้อมูลในตาราง ipt และใช้ ipt.regdate หรือ dchdate ตามคำถาม
- แผนก OPD: ovst.main_dep=kskdepartment.depcode; ชื่อแผนกคือ kskdepartment.department
- เดือนที่แล้วหมายถึงเดือนปฏิทินก่อนหน้า ตั้งแต่วันแรกของเดือนก่อนจนถึงก่อนวันแรกของเดือนปัจจุบัน
- นัดที่ยังใช้งาน: COALESCE(oapp_status_id,1) <> 4
- ชื่อเต็ม: CONCAT(COALESCE(pname,''),COALESCE(fname,''),' ',COALESCE(lname,''))
- ระบุช่วงวันที่เสมอเมื่อคำถามเกี่ยวข้องกับเวลา และใช้ parameter เป็นค่าวันที่ literal รูปแบบ YYYY-MM-DD
- ปีงบประมาณไทย XXXX คือ 1 ตุลาคมของปีคริสต์ศักราช (XXXX-544) ถึง 30 กันยายนของปีคริสต์ศักราช (XXXX-543); เช่น ปีงบประมาณ 2569 คือ 2025-10-01 ถึง 2026-09-30 และ 2570 คือ 2026-10-01 ถึง 2027-09-30
- ผลลัพธ์ต้องไม่เกิน 200 แถว

ตัวอย่าง SQL อ้างอิง (Few-Shot)
1) ค้นหา HN/รายชื่อคนไข้ที่ Refer ไป รพ.ปลายทาง:
SELECT DISTINCT r.hn, CONCAT(COALESCE(p.pname,''),COALESCE(p.fname,''),' ',COALESCE(p.lname,'')) AS patient_name, r.refer_date, r.pdx, h.name AS hosp_name
FROM referout r
JOIN patient p ON p.hn = r.hn
JOIN hospcode h ON h.hospcode = COALESCE(NULLIF(r.refer_hospcode,''), r.hospcode)
WHERE h.name LIKE '%ศิริราช%' AND r.refer_date BETWEEN '2026-10-01' AND '2026-11-23'
ORDER BY r.refer_date DESC LIMIT 200

2) สรุปจำนวนครั้ง/ยอดค่าใช้จ่าย/การเบิกจ่ายแยกตามสิทธิ:
SELECT pt.name AS pttype_name, COUNT(DISTINCT o.vn) AS visits, SUM(COALESCE(v.income, 0)) AS total_income
FROM ovst o
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN pttype pt ON pt.pttype = o.pttype
WHERE o.vstdate BETWEEN '2026-10-01' AND '2026-10-31'
GROUP BY pt.name ORDER BY visits DESC LIMIT 50
`.trim();
