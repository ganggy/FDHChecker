export const AI_ALLOWED_HOSXP_TABLES = new Set([
  'patient', 'ovst', 'vn_stat', 'ipt', 'an_stat', 'ovstdiag', 'opdscreen',
  'opitemrece', 'drugitems', 's_drugitems', 'nondrugitems', 'income',
  'lab_head', 'lab_order', 'lab_items', 'oapp', 'clinic', 'kskdepartment',
  'pttype', 'ward', 'doctor', 'doctor_operation', 'icd101', 'icd9cm1',
  'dtmain', 'dttm', 'er_regist_oper', 'er_oper_code', 'referin', 'referout',
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
- an_stat a: an, hn, vn, regdate, dchdate, ward, pdx, dx0, dx1, dx2, dx3, dx4, dx5, income
ความสัมพันธ์: patient.hn=ovst.hn, ovst.vn=vn_stat.vn, ipt.an=an_stat.an

วินิจฉัยและอาการ
- ovstdiag d: vn, icd10, diagtype (diagtype='1' คือวินิจฉัยหลัก)
- opdscreen os: vn, cc, hpi, bw, height, bps, bpd, pulse, temperature
- icd101: code, name
- doctor_operation: vn, icd9; icd9cm1: code, name

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
- OPD ใช้ ovst.vstdate; IPD ใช้ ipt.regdate หรือ dchdateตามคำถาม
- นัดที่ยังใช้งาน: COALESCE(oapp_status_id,1) <> 4
- ชื่อเต็ม: CONCAT(COALESCE(pname,''),COALESCE(fname,''),' ',COALESCE(lname,''))
- ระบุช่วงวันที่เสมอเมื่อคำถามเกี่ยวข้องกับเวลา และใช้ parameter เป็นค่าวันที่ literal รูปแบบ YYYY-MM-DD
- ผลลัพธ์ต้องไม่เกิน 200 แถว
`.trim();
