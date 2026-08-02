---
ksp_schema: 1
project: FDHChecker
type: "domain-knowledge"
category: "claims"
source: "knowlage/vault/CARDIOVASCULAR_SCREENING_2568.md"
source_hash: "56d938350b85480acdc2f6c47518d53f604f9fc154d1695fb0ac3487a8de3201"
managed_by: "sync-ksp-vault"
---
# คัดกรองหัวใจและหลอดเลือด ปี 2568

## เงื่อนไขที่ใช้ใน FDH Checker

- ช่วงอายุ: 45-70 ปี
- Diagnosis: `Z136` การตรวจคัดกรองพิเศษสำหรับโรคหัวใจและหลอดเลือด
- ผลตรวจที่ต้องมีครบทั้งสองรายการ:
  - Total Cholesterol
  - HDL (High-density lipoprotein cholesterol)
- ADP: `12004`
- ความถี่ตามหลักเกณฑ์: 1 ครั้งทุก 5 ปี
- ช่องทางเขต 1-12: e-Claim

## กฎการตัดสินสถานะ

รายการจะแสดงว่าสมบูรณ์เมื่อครบทุกข้อ: อายุ 45-70 ปี, Dx `Z136`, มีทั้ง Total Cholesterol และ HDL, และมี ADP `12004`

## ที่มาใน vault

สรุปจากเอกสารที่จัดเก็บใน `knowlage/extracted/1.2.3...txt` ส่วนบริการคัดกรองเบาหวานและไขมันในเลือด ปี 2568
