# Claim Channel Classification

เป้าหมาย: แยกให้ชัดว่าแต่ละบริการ “เบิก/บันทึกที่ไหน” ก่อนเอาไปตั้ง rule, หัวบัญชี, หรือหน้าตรวจสอบใน FDHChecker

## ช่องทางหลัก

| ช่องทาง | ใช้เมื่อ | ตัวอย่างข้อมูลที่ต้องตรวจ |
|---|---|---|
| FDH/e-Claim | รายการที่ส่งเบิกผ่าน FDH หรือ e-Claim ตามประกาศ สปสช. | สิทธิ, authen/claim code, ADP, ICD, ราคา, visit/AN/VN |
| 43 แฟ้ม | รายการที่ไม่ได้เป็นกองทุนพิเศษแบบ ADP แต่ใช้ความครบของข้อมูลมาตรฐาน 43 แฟ้ม | Dx, procedure, service date, person/visit linkage |
| MOPH Claim | รายการที่ส่ง API MOPH Claim โดยตรง | token, authencode, endpoint, payload, lab/vaccine result |
| KTB | PPFS/บริการที่ประกาศให้บันทึกผ่าน Krungthai Digital Health Platform | eligibility, lab/service result, rate, frequency |
| NTIP/TB Data Hub | รายการวัณโรค/latent TB ตามประกาศ | IGRA, specimen, TB screening/treatment data |
| อื่นๆ | รายการเฉพาะที่มีระบบกลางหรือ approval workflow แยก | approval, registration, special dataset |

## Mapping จากรายการที่ใช้อยู่

| รายการ/หน้า | ช่องทางเบิกหลัก | ระบบ/หมายเหตุ |
|---|---|---|
| ตรวจสอบเบิก FDH | FDH/e-Claim | ใช้สำหรับรายการ claim/export FDH และตรวจสถานะ FDH |
| MOPH DMHT Lab | MOPH Claim | endpoint MOPH Claim `dmht`, ใช้ HbA1C/Potassium/Creatinine |
| MOPH Vaccine EPI/dT/HPV/aP | MOPH Claim | endpoint MOPH Claim `epi`/`dt`, ตรวจ lot/dose/expire/vaccine code |
| พอกเข่า | 43 แฟ้ม | อายุ 40+, Dx `M17`/`U57.53`, procedure พอกเข่า; ไม่ใช่กองทุนพิเศษ |
| Hepatitis C | KTB | เกิดก่อน พ.ศ. 2535, `Z11.5`, Anti-HCV; ตั้งแต่ 1 มิ.ย. 2568 บันทึกผ่าน KTB |
| Hepatitis B | KTB | เกิดก่อน พ.ศ. 2535, `Z11.5`, HBsAg |
| ซิฟิลิสประชาชนทั่วไปเพศชาย | KTB | lab Treponema/Syphilis/RPR/VDRL/TPHA/TPPA; แยกจาก ANC |
| โลหิตจางเด็ก | KTB | Hb/Hct ตามช่วงอายุ 6-12 เดือน และ 3-6 ปี |
| ยาเสริมธาตุเหล็กเด็ก (Ferrokid) | KTB | เฉพาะเด็กอายุ 6-12 เดือน |
| Latent TB | NTIP/TB Data Hub | IGRA, specimen, lab; แยกค่าบริการเจาะเลือด/ส่ง specimen/lab |
| ANC/ANC lab/ANC ultrasound/ANC dental | e-Claim | โรงพยาบาลโคกศรีสุพรรณอยู่เขต 8 จึงใช้ e-Claim ตามเงื่อนไขเขต 1-12 |
| Mental Health Counselling | e-Claim | age 12+, ST-5/9Q, individual counselling frequency limit |
| Gender affirming hormone service | KTB/VMI | บันทึก KTB, ยา/ฮอร์โมนผ่าน VMI |
| Autistic disorder TDAS | KTB | เด็กไทย 12-60 เดือน และบุคลากรผ่านอบรม |
| Osteoporosis screening | KTB | หญิงหลังหมดประจำเดือน อายุ 60+, FRAX/DXA ทุก 5 ปี |

## วิธีใช้ในระบบ

1. ก่อนเพิ่มกองทุนหรือ rule ใหม่ ให้ตั้ง `claimChannel` ก่อนเสมอ
2. ถ้าเป็น `43 แฟ้ม` ให้เน้นข้อมูล Dx/procedure/แฟ้มมาตรฐาน ไม่ควรแสดงว่าเป็นกองทุนพิเศษ ADP
3. ถ้าเป็น `MOPH Claim` ให้แยกหน้า/ปุ่มส่งออกจาก FDH เพราะ payload และ endpoint คนละชุด
4. ถ้าเป็น `KTB` หรือ `NTIP` ให้หน้า FDHChecker ทำหน้าที่ “ตรวจความครบ/เตือน” เป็นหลัก ไม่ใช่ส่งเบิกแทนระบบกลาง
5. ถ้าเอกสารระบุหลายช่องทาง ให้บันทึกตามเขตของหน่วยบริการก่อน เช่น โรงพยาบาลโคกศรีสุพรรณ เขต 8 ให้ใช้ `e-Claim` ในรายการที่เอกสารแยกเขต 1-12/13
