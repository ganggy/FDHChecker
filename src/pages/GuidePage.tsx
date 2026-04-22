import React, { useState } from 'react';

interface FundGuide {
    id: string;
    title: string;
    description: string;
    conditions: string[];
    codes: string[];
    payment: string;
    icon: string;
    color: string;
}

const guides: FundGuide[] = [
    {
        id: 'anemia_screening',
        title: 'คัดกรองโลหิตจางจากการขาดธาตุเหล็ก (CBC / Hb-Hct + Z130 + 13001)',
        description: 'กองทุนคัดกรองโลหิตจางจากการขาดธาตุเหล็กตามช่วงอายุ โดยต้องดูว่าช่วงอายุใดต้องคู่กับ CBC หรือ Hb/Hct ให้ตรงกับ visit ที่รับบริการ',
        conditions: [
            'คัดกรองโลหิตจางจากการขาดธาตุเหล็กLab CBC 13-24 ปี Diagnosis Z130 ADP 13001',
            'คัดกรองโลหิตจางจากการขาดธาตุเหล็กLab Hb/Hct 6-12 เดือน Diagnosis Z130 ADP 13001',
            'คัดกรองโลหิตจางจากการขาดธาตุเหล็กLab Hb/Hct 3-6 ปี Diagnosis Z130 ADP 13001'
        ],
        codes: ['ADP 13001', 'Lab CBC', 'Hb/Hct / Hemoglobin / Hematocrit', 'ICD-10: Z130'],
        payment: 'ให้ยึดตามกติกาโครงการคัดกรองโลหิตจางของหน่วยบริการและประกาศ สปสช. ล่าสุด',
        icon: '🩸',
        color: 'var(--danger)'
    },
    {
        id: 'anc_visit',
        title: 'ตรวจครรภ์คุณภาพ (ANC Visit)',
        description: 'คู่มือสำหรับเคสฝากครรภ์และตรวจครรภ์คุณภาพ เพื่อให้ลงรหัสและสิทธิได้ครบในแต่ละ visit',
        conditions: [
            'หญิงตั้งครรภ์ที่มารับบริการฝากครรภ์ตามเกณฑ์',
            'บันทึก ANC ให้ครบตามครั้งที่กำหนดในระบบ',
            'ลงข้อมูลสิทธิ/หัตถการที่เกี่ยวข้องให้ครบก่อนส่งเบิก'
        ],
        codes: ['กลุ่ม ANC / PP&P', 'รหัสโครงการฝากครรภ์และตรวจครรภ์', 'บันทึกใน OPD visit'],
        payment: 'ใช้ตามรายการค่าบริการของ ANC และ Fee Schedule ที่ สปสช. กำหนด',
        icon: '🤰',
        color: 'var(--danger)'
    },
    {
        id: 'anc_labs',
        title: 'ANC Lab 1 / 2',
        description: 'ใช้เป็นแนวทางเช็กงานแล็บที่เกี่ยวกับ ANC ว่ามีครบตามช่วงอายุครรภ์หรือยัง',
        conditions: [
            'มีรายการตรวจห้องปฏิบัติการในช่วงฝากครรภ์',
            'เชื่อมกับ visit ของ ANC ให้ถูกต้อง',
            'ตรวจว่ารายการแล็บอยู่ในชุดที่โครงการรองรับ'
        ],
        codes: ['ANC Lab 1', 'ANC Lab 2', 'รายการแล็บตามชุดโครงการฝากครรภ์'],
        payment: 'อ้างอิงตามเงื่อนไขงานฝากครรภ์คุณภาพของหน่วยบริการ',
        icon: '🧪',
        color: 'var(--info)'
    },
    {
        id: 'postpartum',
        title: 'ดูแลหลังคลอด (Postpartum)',
        description: 'คู่มือสำหรับงานหลังคลอด เพื่อให้ตรวจพบเคสในช่วงเวลาที่รับบริการต่อเนื่องได้ครบ',
        conditions: [
            'หญิงหลังคลอดภายในช่วงเวลาที่โครงการกำหนด',
            'มี visit ติดตามหลังคลอดหรือหัตถการที่เกี่ยวข้อง',
            'บันทึกสิทธิและรายการบริการต่อเนื่องให้ครบ'
        ],
        codes: ['ICD-10: Z39', 'หลังคลอด 42 วัน', 'PP&P'],
        payment: 'เบิกจ่ายตามแนวทางดูแลหลังคลอดของ สปสช.',
        icon: '👶',
        color: 'var(--secondary)'
    },
    {
        id: 'dm_screening',
        title: 'คัดกรองเบาหวาน',
        description: 'แนวทางคัดกรองเบาหวานกลุ่มเสี่ยง โดยระบบจะนับเข้าเงื่อนไขเมื่อมี ADP 12003 พร้อมผลแล็บ FPG และอยู่ในช่วงอายุที่กำหนด',
        conditions: [
            'อายุ 35-59 ปี ตามเกณฑ์คัดกรอง',
            'ต้องมี ADP code 12003 ใน visit นั้น',
            'ต้องมีผลแล็บ FPG / Fasting Plasma Glucose / FBS ใน visit เดียวกัน',
            'เลข 40 บาทเป็นอัตราค่าชดเชย ไม่ใช่เงื่อนไขให้ติดกองทุน',
            'ควรบันทึกผลตรวจและ diagnosis ให้ครบกับ visit ที่เกี่ยวข้อง'
        ],
        codes: ['ADP 12003', 'FPG', 'ICD-10: Z131 / Z133 / Z136'],
        payment: 'อ้างอิงรายการคัดกรองและประกาศ สปสช. ล่าสุด',
        icon: '🧁',
        color: 'var(--success)'
    },
    {
        id: 'lipid_screening',
        title: 'คัดกรองไขมันในเลือด',
        description: 'แนวทางคัดกรองไขมันในเลือดสำหรับกลุ่มเสี่ยงหรือประชาชนที่เข้าเกณฑ์โครงการ',
        conditions: [
            'กลุ่มอายุหรือกลุ่มเสี่ยงตามเกณฑ์คัดกรอง',
            'มีผลตรวจ lipid profile ที่เชื่อมกับ visit ถูกต้อง',
            'ลง diagnosis / code ให้ครบก่อนสรุปกองทุน'
        ],
        codes: ['Lipid profile', 'คัดกรองไขมัน', 'รหัสโครงการตามประกาศ'],
        payment: 'ใช้ตาม Fee Schedule และแนวทางคัดกรองของ สปสช.',
        icon: '🫀',
        color: 'var(--warning)'
    },
    {
        id: 'telemedicine',
        title: 'Telemedicine / Telemed',
        description: 'คู่มือการเช็กงานปรึกษาแพทย์ทางไกลและการลงข้อมูลให้ตรงกับ visit / authen ของระบบ',
        conditions: [
            'มีการให้บริการผ่านช่องทางทางไกลตามโครงการ',
            'บันทึกวันเวลา ผู้ให้บริการ และผู้รับบริการให้ครบ',
            'ลงรหัสหรือ tag ของ telemedicine ให้ถูกต้องในระบบ'
        ],
        codes: ['TELMED / Telemedicine', 'บันทึกช่องทางการให้บริการ', 'เชื่อม visit ให้ถูกต้อง'],
        payment: 'เบิกตามหลักเกณฑ์บริการทางไกลของหน่วยบริการ',
        icon: '📡',
        color: 'var(--primary)'
    },
    {
        id: 'er_qa',
        title: 'บริการผู้ป่วยฉุกเฉินคุณภาพ (ER QA)',
        description: 'ค่าบริการสาธารณสุขสำหรับผู้ป่วยฉุกเฉินที่เข้ารับการรักษาในห้องฉุกเฉิน นอกเวลาทำการ หรือเป็นผู้ป่วยฉุกเฉินวิกฤต/เร่งด่วน',
        conditions: [
            'เป็นผู้ป่วยฉุกเฉินวิกฤต (Triage ระดับ 1-2) หรือ ฉุกเฉินเร่งด่วน (Triage ระดับ 3)',
            'ได้รับการรักษาในแผนกฉุกเฉิน (ER)',
            'อาจมีการสังเกตอาการไม่เกิน 24 ชั่วโมง (Observation) ก่อนกลับบ้าน'
        ],
        codes: ['รหัส ICD-10 กลุ่มอุบัติเหตุ/ฉุกเฉิน (เช่น V, W, X, Y)', 'ต้องระบุ Triage Type ในระบบ HOSxP ให้ถูกต้อง'],
        payment: 'เบิกจ่ายตาม Fee Schedule ของ สปสช. (150 - 300 บาท ตามความรุนแรง)',
        icon: '🚑',
        color: 'var(--danger)'
    },
    {
        id: 'chemo',
        title: 'บริการเคมีบำบัดที่บ้าน (Home Chemo)',
        description: 'สนับสนุนการให้ยาเคมีบำบัดที่บ้าน สำหรับผู้ป่วยมะเร็งลำไส้ใหญ่และมะเร็งปอด เพื่อลดความแออัดในโรงพยาบาล',
        conditions: [
            'ผู้ป่วยมะเร็งลำไส้ใหญ่ หรือ มะเร็งปอด ที่แพทย์ประเมินว่าสามารถรับยาที่บ้านได้',
            'ต้องมีการสั่งจ่ายยาผ่านระบบ HOSxP และจัดส่งยาโดยเภสัชกร/พยาบาล'
        ],
        codes: ['ICD-10: C34 (มะเร็งปอด), C18-C20 (มะเร็งลำไส้ใหญ่)', 'Z51.1 (เคมีบำบัด)'],
        payment: 'ชดเชยค่าบริการส่งยาและการพยาบาล 1,000 - 3,000 บาท/ครั้ง',
        icon: '🏠',
        color: 'var(--primary)'
    },
    {
        id: 'hepc',
        title: 'รักษาโรคไวรัสตับอักเสบซี (HepC)',
        description: 'บริการคัดกรองและให้ยาต้านไวรัสสำหรับผู้ป่วยที่ติดเชื้อไวรัสตับอักเสบซีเรื้อรัง (HCV)',
        conditions: [
            'ผลตรวจ Anti-HCV เป็นบวก หรือ HCV RNA เป็นบวก',
            'อายุ 15 ปีขึ้นไป (และกลุ่มเสี่ยงตามประกาศ)',
            'ได้รับยาสูตรผสม เช่น Sofosbuvir/Velpatasvir'
        ],
        codes: ['ICD-10: B18.2 (Chronic viral hepatitis C)', 'ค่าแล็บ HCV RNA'],
        payment: 'ชดเชยค่ายาต้านไวรัสตามจริง (หลักหมื่นบาท/คอร์ส) และ ค่ายืนยันผล 1,500 บาท',
        icon: '💊',
        color: 'var(--warning)'
    },
    {
        id: 'cxr',
        title: 'คัดกรองวัณโรค (CXR-TB)',
        description: 'บริการถ่ายภาพรังสีทรวงอก (CXR) เพื่อค้นหาผู้ป่วยวัณโรคในกลุ่มเสี่ยง',
        conditions: [
            'เป็นกลุ่มเสี่ยง (ผู้สัมผัสร่วมบ้าน, ผู้ป่วย HIV, ผู้ต้องขัง, ผู้สูงอายุมีโรคร่วม)',
            'มีอาการเข้าข่ายวัณโรคปอด (ไอเรื้อรังเกิน 2 สัปดาห์)'
        ],
        codes: ['รหัสหัตถการ CXR: 87.44, 87.49', 'ICD-10: Z20.1, Z11.1'],
        payment: 'จ่ายตาม Fee Schedule: ค่า X-Ray 100-200 บาท / ค่าตรวจเสมหะ 250 บาท',
        icon: '🩻',
        color: 'var(--info)'
    },
    {
        id: 'rehab',
        title: 'ฟื้นฟูสมรรถภาพ (Rehab ระยะกลาง)',
        description: 'การฟื้นฟูสมรรถภาพทางการแพทย์ระยะกลาง (Intermediate Care - IMC) สำหรับผู้ป่วย Stroke, Traumatic Brain Injury, Spinal Cord Injury',
        conditions: [
            'ผู้ป่วยหลังพ้นวิกฤต (ภายใน 6 เดือน)',
            'Barthel Index < 15 วัน เพื่อเริ่มเข้าสู่กระบวนการฟื้นฟูเข้มข้น'
        ],
        codes: ['ICD-10: I60-I64 (Stroke), S06 (TBI), S14, S24, S34 (SCI)', 'ICD-9 หมวด Physical Therapy'],
        payment: 'เหมาจ่ายตามกลุ่มอาการ (ตั้งแต่ 3,000 - 10,000 บาท)',
        icon: '🦽',
        color: 'var(--teal)'
    },
    {
        id: 'crrt',
        title: 'ล้างไตผ่านช่องท้อง (CRRT/CAPD)',
        description: 'บริการทดแทนไต สำหรับผู้ป่วยไตวายเรื้อรังระยะสุดท้าย (ESRD) แบบต่อเนื่อง',
        conditions: [
            'ผู้ป่วยได้รับการวินิจฉัยเป็น ESRD',
            'เข้ารับการล้างไตผ่านช่องท้อง (CAPD, APD) หรือฟอกเลือดวิกฤต (CRRT)'
        ],
        codes: ['ICD-10: N18.5 (ESRD)', 'Z49.0 - Z49.2 (การเตรียมและให้การบำบัดทดแทนไต)'],
        payment: 'จ่ายค่าน้ำยาล้างไต, ค่าอุปกรณ์ส่งถึงบ้าน, และค่าบริการคลินิก 2,500 บาท/เดือน/ราย',
        icon: '🩸',
        color: 'var(--success)'
    },
    {
        id: 'robot',
        title: 'ผ่าตัดด้วยหุ่นยนต์ (Robotic Surgery)',
        description: 'บริการผ่าตัดมะเร็งต่อมลูกหมาก และมะเร็งอื่นๆ ที่ซับซ้อนด้วยหุ่นยนต์ช่วยผ่าตัด (Da Vinci)',
        conditions: [
            'ผู้ป่วยมะเร็งต่อมลูกหมาก (Prostate Cancer) ระยะที่มีข้อบ่งชี้ผ่าตัด',
            'สถานพยาบาลต้องขึ้นทะเบียนผ่านเกณฑ์ สปสช.'
        ],
        codes: ['ICD-10: C61 (Malignant neoplasm of prostate)', 'ICD-9: 60.5 (Radical prostatectomy) + Robotic Assisted (17.4x)'],
        payment: 'ช่วยค่าใช้จ่ายส่วนเพิ่ม ประมาณ 35,000 - 50,000 บาท/ครั้ง',
        icon: '🤖',
        color: 'var(--secondary)'
    },
    {
        id: 'proton',
        title: 'รังสีรักษาด้วยโปรตอน (Proton Therapy)',
        description: 'เทคนิคการฉายรังสีด้วยอนุภาคโปรตอน สำหรับมะเร็งในเด็กและมะเร็งสมองที่ต้องการความแม่นยำสูง',
        conditions: [
            'ผู้ป่วยมะเร็งสมองเด็ก หรือ มะเร็งที่ติดกับอวัยวะสำคัญที่รังสีปกติอาจทำลายได้',
            'แพทย์เฉพาะทางประเมินและอนุมัติ'
        ],
        codes: ['ICD-10 หมวดมะเร็ง (C00-C97)', 'รหัสหัตถการฉายรังสีโปรตอน'],
        payment: 'เบิกจ่ายตามจริงแต่ไม่เกินเพดานที่ สปสช. กำหนด (ราคาสูงมาก)',
        icon: '☢️',
        color: 'var(--slate)'
    },
    {
        id: 'op_anywhere',
        title: 'บริการปฐมภูมิไปที่ไหนก็ได้ (OP Anywhere)',
        description: 'ผู้มีสิทธิบัตรทองสามารถเข้ารับบริการปฐมภูมิที่หน่วยบริการใดก็ได้ ไม่ต้องใช้ใบส่งตัว',
        conditions: [
            'เข้ารับบริการเป็นผู้ป่วยนอก (OPD)',
            'ไม่ใช่กรณีฉุกเฉินวิกฤต (ถ้าฉุกเฉินจะเป็น UCEP)'
        ],
        codes: ['รหัสโครงการตรวจ OP Anywhere', 'เช็คระบบ Authentication (เช่น เสียบบัตรปชช.)'],
        payment: 'เบิกจ่ายข้ามเขตตาม Fee Schedule ของ สปสช. (ส่วนใหญ่จ่ายเหมาหัวละ 100-150 บาท)',
        icon: '🏥',
        color: 'var(--text-primary)'
    },
    {
        id: 'palliative',
        title: 'ดูแลประคับประคอง (Palliative Care)',
        description: 'การดูแลผู้ป่วยระยะท้ายและครอบครัวแบบประคับประคอง เพื่อลดความทุกข์ทรมานทั้งร่างกาย จิตใจ สังคม และจิตวิญญาณ',
        conditions: [
            'เป็นผู้ป่วยที่ได้รับการวินิจฉัยว่าอยู่ในระยะท้ายของโรค (Life-limiting illness)',
            'มีการลงทะเบียนในระบบ Palliative Care ของหน่วยบริการ'
        ],
        codes: ['ICD-10: Z51.5 (Palliative care)'],
        payment: 'เหมาจ่ายดูแลต่อเนื่องที่บ้าน หรือชดเชยตาม Fee Schedule บริการอุปกรณ์',
        icon: '🕊️',
        color: 'var(--slate)'
    },
    {
        id: 'thalassemia',
        title: 'ผู้ป่วยธาลัสซีเมีย (Thalassemia)',
        description: 'กองทุนเฉพาะสำหรับการดูแลรักษาผู้ป่วยโรคโลหิตจางธาลัสซีเมียชนิดรุนแรง',
        conditions: [
            'มีประวัติและอาการเข้าข่ายโรคธาลัสซีเมียชนิดรุนแรง (Severe Thalassemia)',
            'ต้องได้รับเลือด (Blood transfusion) หรือยาขับเหล็ก (Iron chelator) เป็นประจำ'
        ],
        codes: ['ICD-10: D56 (Thalassaemia)'],
        payment: 'ชดเชยค่ายาขับเหล็กแบบเหมาจ่าย และค่าตรวจทางห้องปฏิบัติการพิเศษ',
        icon: '🧬',
        color: 'var(--primary)'
    },
    {
        id: 'hiv_arv',
        title: 'ผู้ป่วยเอชไอวี/เอดส์ (NAP / ARV)',
        description: 'บริการดูแลรักษาผู้ติดเชื้อเอชไอวีและผู้ป่วยเอดส์ (National AIDS Program)',
        conditions: [
            'ผลตรวจเลือดพบเชื้อ HIV (Anti-HIV Positive)',
            'รับประทานยาต้านไวรัส (ARV) อย่างต่อเนื่องและตรวจ CD4 / Viral Load'
        ],
        codes: ['ICD-10: Z21 (Asymptomatic HIV), B20-B24 (HIV disease)'],
        payment: 'สนับสนุนยา ARV จากองค์การเภสัชกรรม และชดเชยค่าตรวจ CD4/VL ตามเกณฑ์',
        icon: '🎗️',
        color: 'var(--red-500)'
    },
    {
        id: 'tb',
        title: 'วัณโรคปอด (Tuberculosis - DOTS)',
        description: 'บริการควบคุมและรักษาวัณโรคด้วยระบบ Short-course (DOTS)',
        conditions: [
            'ได้รับการวินิจฉัยว่าเป็นวัณโรค และขึ้นทะเบียนการรักษา',
            'ต้องมีผู้พี่เลี้ยง (DOT) กำกับการกินยาตลอดคอร์ส 6 เดือน'
        ],
        codes: ['ICD-10: A15, A16 (Respiratory tuberculosis)'],
        payment: 'เบิกจ่ายค่ารักษาและสนับสนุนยาวัณโรค (TB Drugs) ตลอดคอร์ส',
        icon: '🫁',
        color: 'var(--teal)'
    },
    {
        id: 'psychiatric',
        title: 'ผู้ป่วยจิตเวชเรื้อรัง (Psychiatric Care)',
        description: 'การดูแลระยะยาวสำหรับผู้ป่วยจิตเวช เช่น โรคจิตเภท (Schizophrenia) ในชุมชน',
        conditions: [
            'ได้รับการวินิจฉัยว่าเป็นโรคจิตเภท หรือจิตเวชเรื้อรัง',
            'ต้องมีการติดตามต่อเนื่อง (Continuous care) และรับยาจิตเวชสม่ำเสมอ'
        ],
        codes: ['ICD-10: F20 (Schizophrenia), F20-F29 (Schizophrenia, schizotypal and delusional disorders)'],
        payment: 'รับยาจิตเวชแบบผู้ป่วยนอก และเบิกจ่ายระบบสุขภาพชุมชน (Community Health)',
        icon: '🧠',
        color: 'var(--info)'
    },
    {
        id: 'drug_delivery',
        title: 'ส่งยาไปรษณีย์ / รับยาที่บ้าน',
        description: 'แนวทางสำหรับผู้ป่วยที่รับยาต่อเนื่องและสามารถส่งยาไปให้ที่บ้านได้ เพื่อลดการมารับยาซ้ำ',
        conditions: [
            'ผู้ป่วยอยู่ในกลุ่มที่หน่วยบริการอนุมัติให้ส่งยาได้',
            'มีการบันทึกชื่อผู้รับยา ที่อยู่ และช่องทางรับยาให้ครบ',
            'เชื่อมกับ visit / prescription ให้ถูกต้อง'
        ],
        codes: ['ส่งยาไปรษณีย์', 'รับยาที่บ้าน', 'ติดตามเลขพัสดุหรือช่องทางส่งยา'],
        payment: 'อ้างอิงค่าบริการส่งยาและหลักเกณฑ์ของโครงการ',
        icon: '📦',
        color: 'var(--secondary)'
    },
    {
        id: 'cervical_screening',
        title: 'คัดกรองมะเร็งปากมดลูก',
        description: 'คู่มือช่วยตรวจเคสที่มักลืมลงรหัสคัดกรองมะเร็งปากมดลูก ให้เห็นเงื่อนไขและรายการที่ต้องมีครบก่อนส่ง',
        conditions: [
            'ผู้รับบริการอยู่ในช่วงอายุและเกณฑ์ที่โครงการกำหนด',
            'มีผลตรวจคัดกรองที่เชื่อมกับ visit ถูกต้อง',
            'บันทึกผลและรหัสโครงการให้ครบก่อนสรุปส่งเบิก'
        ],
        codes: ['Pap smear', 'HPV DNA test', 'คัดกรองมะเร็งปากมดลูก'],
        payment: 'อ้างอิงตามประกาศและ Fee Schedule ของ สปสช. ที่หน่วยบริการใช้จริง',
        icon: '🎗️',
        color: 'var(--danger)'
    },
    {
        id: 'family_planning',
        title: 'วางแผนครอบครัว (FP)',
        description: 'แนวทางตรวจเคสคุมกำเนิดและบริการวางแผนครอบครัวให้ครบก่อนส่งเบิก',
        conditions: [
            'เป็นบริการวางแผนครอบครัวตามเกณฑ์ของหน่วยบริการ',
            'มีบันทึกหัตถการและชนิดบริการครบ',
            'เชื่อมกับสิทธิและวันที่รับบริการให้ถูกต้อง'
        ],
        codes: ['FP', 'วางแผนครอบครัว', 'บริการคุมกำเนิด'],
        payment: 'เบิกจ่ายตามโครงการวางแผนครอบครัวของ สปสช.',
        icon: '👨‍👩‍👧',
        color: 'var(--primary)'
    },
    {
        id: 'fp_pills',
        title: 'ยาคุมกำเนิด (FP)',
        description: 'ใช้กับงานจ่ายยาคุมและติดตามผู้ใช้ยาคุมกำเนิดต่อเนื่องในระบบ',
        conditions: [
            'มีคำสั่งยาหรือบันทึกจ่ายยาคุมครบ',
            'บันทึกการให้คำปรึกษา/ติดตามตามรอบบริการ',
            'ข้อมูล visit และรายการยาเชื่อมกันถูกต้อง'
        ],
        codes: ['ยาคุมกำเนิด', 'FP pill', 'บริการต่อเนื่อง'],
        payment: 'ยึดตามแนวทางบริการคุมกำเนิดของหน่วยบริการ',
        icon: '💊',
        color: 'var(--warning)'
    },
    {
        id: 'fluoride',
        title: 'เคลือบฟลูออไรด์',
        description: 'แนวทางตรวจงานเคลือบฟลูออไรด์สำหรับเด็กและกลุ่มเป้าหมายตามเกณฑ์',
        conditions: [
            'ผู้รับบริการอยู่ในกลุ่มอายุที่โครงการกำหนด',
            'มีการบันทึกรหัสหัตถการหรือบริการเคลือบฟลูออไรด์',
            'เชื่อม visit และสิทธิถูกต้องก่อนส่ง'
        ],
        codes: ['Fluoride varnish', 'เคลือบฟลูออไรด์', 'เด็กเล็ก / กลุ่มเป้าหมาย'],
        payment: 'เบิกตามมาตรฐานบริการส่งเสริมป้องกันของ สปสช.',
        icon: '🦷',
        color: 'var(--info)'
    },
    {
        id: 'thai_herb',
        title: 'สมุนไพร / ยาไทย',
        description: 'คู่มือดูรายการสมุนไพรและยาไทยที่ต้องลงให้ครบก่อนส่งเบิก',
        conditions: [
            'รายการยา/สมุนไพรอยู่ในบัญชีที่หน่วยบริการใช้งาน',
            'มีรหัสรายการและคำสั่งใช้ยาถูกต้อง',
            'บันทึกวันจ่ายและผู้รับบริการให้ครบ'
        ],
        codes: ['สมุนไพรไทย', 'ยาแผนไทย', 'รายการเวชภัณฑ์ที่เกี่ยวข้อง'],
        payment: 'ชดเชยตามรายการและเกณฑ์สมุนไพรของหน่วยบริการ',
        icon: '🌿',
        color: 'var(--success)'
    },
    {
        id: 'clopidogrel',
        title: 'Clopidogrel',
        description: 'ใช้ช่วยตรวจเคสยาที่มักต้องผูกกับสิทธิ/โรคเรื้อรัง และดูว่ามีข้อมูลครบก่อนส่งหรือยัง',
        conditions: [
            'มีคำสั่งยาหรือรายการจ่าย Clopidogrel จริง',
            'เชื่อมกับโรคหัวใจ/หลอดเลือดหรือข้อบ่งชี้ที่ระบบรองรับ',
            'บันทึกข้อมูลการจ่ายและวันที่บริการครบ'
        ],
        codes: ['Clopidogrel', 'ยาต้านเกล็ดเลือด', 'โรคหัวใจ/หลอดเลือด'],
        payment: 'ตรวจสอบตามบัญชียาและแนวทางเบิกของโรงพยาบาล',
        icon: '🫀',
        color: 'var(--slate)'
    },
    {
        id: 'ipd_audit',
        title: 'มาตรฐานการตรวจสอบภายใน (IPD Pre-Audit)',
        description: 'เกณฑ์ความเสี่ยงเบื้องต้นสำหรับการตรวจสอบชาร์ตผู้ป่วยใน ก่อนส่งเบิก 16 แฟ้ม เพื่อลดการถูกเรียกเงินคืน (Denial) และเพิ่ม RW',
        conditions: [
            'Principal Diagnosis (PDx): ต้องระบุโรคหลักที่รักษาระหว่าง Admit (ห้ามว่าง)',
            'RW vs LOS: กรณีวันนอนนาน (> 14 วัน) แต่ RW ต่ำ (< 1.0) เสี่ยงต่อการลืมลงภาวะแทรกซ้อน (CC/MCC)',
            'Procedure Audit: กรณีมีการผ่าตัด (OR) แต่ RW ไม่ขึ้น หรือไม่ได้ลงรหัส ICD-9',
            'Complications (CC): ตรวจสอบผล Lab/บันทึกพยาบาล เพื่อหารหัสโรคแทรกซ้อนที่อาจเพิ่มนํ้าหนักสัมพัทธ์ (RW)'
        ],
        codes: ['เกณฑ์ DRG Ver 6.3 / 7.0', 'ระบบ Auto-Flag ในหน้า IPD Monitoring'],
        payment: 'ช่วยป้องกันการติด C (Coding Error) และลดความเสี่ยงจากการสุ่มตรวจของ สปสช.',
        icon: '🛡️',
        color: 'var(--warning)'
    }
];

export const GuidePage: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredGuides = guides.filter(g =>
        g.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.conditions.some(c => c.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="page-container" style={{ padding: '0 16px' }}>
            <div className="page-header" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                    <h1 className="page-title">📚 คู่มือและเงื่อนไขกองทุน (Knowledge Base)</h1>
                    <p className="page-subtitle">อ้างอิงข้อมูลเงื่อนไขการเบิกจ่าย รหัสโรค และมูลค่าชดเชยของแต่ละกองทุน สปสช. (อัปเดต 2569)</p>
                </div>
                <div style={{ maxWidth: 400 }}>
                    <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 12, top: 10, fontSize: 14 }}>🔍</span>
                        <input
                            type="text"
                            className="form-control"
                            placeholder="ค้นหากองทุน, รหัสโรค, อาการ..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{ paddingLeft: 36, width: '100%' }}
                        />
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20 }}>
                {filteredGuides.map(guide => (
                    <div key={guide.id} className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                            <div style={{ fontSize: 32, background: guide.color + '1A', width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
                                {guide.icon}
                            </div>
                            <div>
                                <h3 style={{ margin: '0 0 6px 0', fontSize: 17, color: 'var(--primary)', lineHeight: 1.3 }}>{guide.title}</h3>
                                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                    {guide.description}
                                </p>
                            </div>
                        </div>
                        <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>✓ จุดเน้น / เงื่อนไขเบิก (Conditions)</div>
                                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                    {guide.conditions.map((c, i) => <li key={i}>{c}</li>)}
                                </ul>
                            </div>
                            <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>👩🏻‍⚕️ รหัสโรค/หัตถการที่เกี่ยวข้อง (ICD)</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {guide.codes.map((code, i) => (
                                        <span key={i} style={{ background: '#fff', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4 }}>{code}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div style={{ padding: '12px 20px', background: 'rgba(16, 185, 129, 0.05)', borderTop: '1px solid rgba(16, 185, 129, 0.1)', color: 'var(--success)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <span>💰</span>
                            <span style={{ lineHeight: 1.4 }}>{guide.payment}</span>
                        </div>
                    </div>
                ))}
            </div>

            {filteredGuides.length === 0 && (
                <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>📭</div>
                    <h3>ไม่พบข้อมูลเงื่อนไขกองทุนที่ค้นหา</h3>
                    <p>ลองเปลี่ยนคำค้นหาเป็นชื่อโรค, ตัวย่อ (เช่น CXR, HepC) หรือ รหัส ICD-10 (เช่น C34)</p>
                </div>
            )}
        </div>
    );
};
