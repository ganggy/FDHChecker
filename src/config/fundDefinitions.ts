import { getFundRule } from './fundRuleCatalog';

export interface FundDefinition {
    id: string;
    name: string;
    description: string;
    claimChannel?: string;
    recordingSystem?: string;
    claimChannelNote?: string;
    conditions?: string[];
    caution?: string;
}

const anemiaRule = getFundRule('anemia_screening');

export const FUND_DEFINITIONS: FundDefinition[] = [
    {
        id: 'palliative',
        name: 'Palliative Care',
        description: 'ผู้ป่วยระยะประคับประคอง / เยี่ยมบ้าน',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH หรือ e-Claim ตามช่องทางที่หน่วยบริการใช้',
        conditions: ['สิทธิ UCS', 'Diagnosis Z515 หรือ Z718', 'ADP 30001 หรือ Cons01 หรือ Eva001'],
        caution: 'กองทุนนี้เป็นงานเยี่ยมบ้าน ไม่ควรรวมกับกองทุนแล็บ/คัดกรองอื่นใน visit เดียวกัน ยกเว้นรายการยา'
    },
    {
        id: 'telemedicine',
        name: 'Telemedicine',
        description: 'บริการแพทย์ทางไกล / Telemed',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim',
        conditions: ['สิทธิ UCS', 'ADP TELMED หรือ export code 5']
    },
    {
        id: 'drugp',
        name: 'ส่งยาไปรษณีย์',
        description: 'ยา EMS / ส่งยาถึงบ้าน',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim',
        conditions: ['สิทธิ UCS', 'ADP DRUGP']
    },
    {
        id: 'herb',
        name: 'สมุนไพร / ยาไทย',
        description: 'รายการสมุนไพรและยาไทย',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือระบบที่ประกาศกำหนด',
        conditions: ['สิทธิ UCS/WEL', 'มียาสมุนไพรหรือยาไทย', 'มียอดราคามากกว่า 0 บาท']
    },
    {
        id: 'knee',
        name: 'ยาพอกเข่า',
        description: 'บริการพอกเข่าในชุดข้อมูล 43 แฟ้ม',
        claimChannel: '43 แฟ้ม',
        recordingSystem: 'ส่งข้อมูลมาตรฐาน 43 แฟ้ม',
        claimChannelNote: 'ไม่ใช่กองทุนพิเศษแบบ ADP/FDH ให้ตรวจความครบของ Dx/หัตถการเพื่อออก 43 แฟ้ม',
        conditions: [
            'ดึงผู้ป่วยอายุ 40 ปีขึ้นไปและมี Diagnosis M17 หรือ U57.53 ขึ้นมาตรวจ แม้ยังไม่มีหัตถการ',
            'มีหัตถการครบ 4 รายการ: 872-78-11, 873-78-11, 874-78-11, 873-78-35',
            'ไม่เกินวันละ 1 ครั้ง รวมไม่เกิน 5 ครั้งภายใน 2 สัปดาห์'
        ],
        caution: 'รายการนี้เป็นบริการที่ใช้ตรวจความพร้อมสำหรับการส่ง 43 แฟ้ม ไม่จัดเป็นกองทุนพิเศษแบบ ADP'
    },
    {
        id: 'instrument',
        name: 'อวัยวะเทียม',
        description: 'วัสดุ/อุปกรณ์เบิกได้',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim',
        conditions: ['มีอุปกรณ์กลุ่ม ADP Type 2', 'มียอดรายการอุปกรณ์ใน visit']
    },
    {
        id: 'preg_test',
        name: 'ตรวจครรภ์ (UPT)',
        description: 'คัดกรองการตั้งครรภ์',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'e-Claim/FDH ตามพื้นที่และประกาศ',
        conditions: ['ADP 30014', 'Diagnosis Z320 หรือ Z321', 'มีรายการ 31101 / Lab UPT']
    },
    {
        id: 'anc',
        name: 'ANC Visit',
        description: 'ตรวจครรภ์คุณภาพ / ฝากครรภ์',
        claimChannel: 'e-Claim/KTB',
        recordingSystem: 'เขต 1-12 ผ่าน e-Claim, เขต 13 ผ่าน KTB ตามเอกสาร',
        conditions: ['Diagnosis ฝากครรภ์ Z34 หรือ Z35', 'ADP 30011']
    },
    {
        id: 'anc_ultrasound',
        name: 'ANC Ultrasound',
        description: 'อัลตราซาวนด์ระหว่างตั้งครรภ์',
        claimChannel: 'e-Claim/KTB',
        recordingSystem: 'เขต 1-12 ผ่าน e-Claim, เขต 13 ผ่าน KTB ตามเอกสาร',
        conditions: ['Diagnosis ฝากครรภ์ Z34 หรือ Z35', 'ADP 30010', 'มีหัตถการ Ultrasound ตามเกณฑ์ ANC']
    },
    {
        id: 'anc_lab_1',
        name: 'ANC Lab 1',
        description: 'ห้องแล็บชุดที่ 1 ของ ANC',
        claimChannel: 'e-Claim/KTB',
        recordingSystem: 'เขต 1-12 ผ่าน e-Claim, เขต 13 ผ่าน KTB ตามเอกสาร',
        conditions: ['Diagnosis ฝากครรภ์ Z34 หรือ Z35', 'ADP 30012', 'CBC', 'DCIP', 'ABO group cell grouping', 'Rh grouping tube method', 'HBs Ag', 'Treponema Pallidum Antibody', 'HIV-Ab Screening rapid test']
    },
    {
        id: 'anc_lab_2',
        name: 'ANC Lab 2',
        description: 'ห้องแล็บชุดที่ 2 ของ ANC',
        claimChannel: 'e-Claim/KTB',
        recordingSystem: 'เขต 1-12 ผ่าน e-Claim, เขต 13 ผ่าน KTB ตามเอกสาร',
        conditions: ['Diagnosis ฝากครรภ์ Z34 หรือ Z35', 'ADP 30013', 'Anti-HIV ANC 2 (Screening) Rapid', 'Treponema Pallidum Antibody (ANC 2)', 'CBC (Complete blood count without smear)']
    },
    {
        id: 'anc_dental_exam',
        name: 'ANC ตรวจฟัน',
        description: 'ตรวจสุขภาพช่องปากหญิงตั้งครรภ์ (30008)',
        claimChannel: 'e-Claim/KTB',
        recordingSystem: 'เขต 1-12 ผ่าน e-Claim, เขต 13 ผ่าน KTB ตามเอกสาร',
        conditions: ['Diagnosis ฝากครรภ์ Z34 หรือ Z35', 'ADP 30008', 'มีบริการตรวจช่องปากตามเกณฑ์ ANC']
    },
    {
        id: 'anc_dental_clean',
        name: 'ANC ขัดทำความสะอาดฟัน',
        description: 'ขูดหินปูน/ทำความสะอาดฟันหญิงตั้งครรภ์ (30009)',
        claimChannel: 'e-Claim/KTB',
        recordingSystem: 'เขต 1-12 ผ่าน e-Claim, เขต 13 ผ่าน KTB ตามเอกสาร',
        conditions: ['Diagnosis ฝากครรภ์ Z34 หรือ Z35', 'ADP 30009', 'มีบริการขูดหินปูน/ทำความสะอาดฟันตามเกณฑ์ ANC']
    },
    {
        id: 'postnatal_care',
        name: 'ดูแลหลังคลอด',
        description: 'ติดตาม/ตรวจหลังคลอด',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim ตามประกาศ',
        conditions: ['Diagnosis Z390 หรือ Z391 หรือ Z392', 'ADP 30015']
    },
    {
        id: 'postnatal_supplements',
        name: 'เสริมธาตุเหล็กหลังคลอด',
        description: 'ยาเสริมธาตุเหล็กหลังคลอด',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim ตามประกาศ',
        conditions: ['Diagnosis Z391 หรือ Z392', 'ADP 30016', 'มีรายการยาเสริมธาตุเหล็กตามเกณฑ์']
    },
    {
        id: 'fluoride',
        name: 'เคลือบฟลูออไรด์',
        description: 'ทันตกรรมป้องกันฟันผุ',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือระบบที่ประกาศกำหนด',
        conditions: ['ADP 15001', 'อยู่ในช่วงอายุหรือสิทธิที่หน่วยบริการใช้เบิก']
    },
    {
        id: 'fp',
        name: 'วางแผนครอบครัว',
        description: 'บริการคุมกำเนิดและวางแผนครอบครัว',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือ KTB ตามรายการย่อย',
        conditions: ['Diagnosis Z30x', 'กรณี Z308 ให้จับคู่ ICD9/ADP ให้ครบ', 'มี ADP กลุ่ม FP ตามบริการที่ทำจริง']
    },
    {
        id: 'contraceptive_pill',
        name: 'ยาคุมกำเนิด',
        description: 'ยาคุมชนิดเม็ด (Anna / Lynestrenol)',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือ KTB ตามรายการย่อย',
        conditions: ['Diagnosis Z304 (การเฝ้าระวังสถาณะการใช้ยาคุมกำเนิด)', 'ADP FP003_1 (ยา Anna 40.-) หรือ FP003_2 (ยา Lynestrenol 80.-)']
    },
    {
        id: 'condom',
        name: 'ถุงยางอนามัย',
        description: 'บริการถุงยางอนามัย',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือ KTB ตามรายการย่อย',
        conditions: ['Diagnosis Z304 (คุมกำเนิดด้วยยา) หรือ Z30x', 'ADP FP003_4']
    },
    {
        id: 'cacervix',
        name: 'คัดกรองมะเร็งปากมดลูก',
        description: 'Pap smear / Cervix screening',
        claimChannel: 'KTB/FDH',
        recordingSystem: 'KTB หรือช่องทางที่ประกาศกำหนด',
        conditions: ['Diagnosis/บริการคัดกรองมะเร็งปากมดลูก', 'ADP กลุ่ม 1B004 หรือ 1B005']
    },
    {
        id: 'er_emergency',
        name: 'ฉุกเฉิน (ER)',
        description: 'ผู้ป่วยฉุกเฉินและนอกเขต',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim',
        conditions: ['มีโครงการ OP AE หรือสิทธินอกเขต/ฉุกเฉินที่เบิกได้']
    },
    {
        id: 'fpg_screening',
        name: 'คัดกรองเบาหวาน',
        description: 'กลุ่มเสี่ยงอายุ 35-59 ปี ด้วย FPG',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือช่องทาง PPFS ที่ประกาศกำหนด',
        conditions: ['อายุ 35-59 ปี', 'Lab FPG', 'Diagnosis Z131 หรือ Z133 หรือ Z136', 'ADP 12003']
    },
    {
        id: 'cholesterol_screening',
        name: 'คัดกรองไขมัน',
        description: 'คัดกรองไขมันในเลือด',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือช่องทาง PPFS ที่ประกาศกำหนด',
        conditions: ['อายุ 45-59 ปี', 'Lab Cholesterol หรือ HDL', 'Diagnosis Z136', 'ADP 12004']
    },
    {
        id: 'anemia_screening',
        name: 'คัดกรองโลหิตจาง',
        description: anemiaRule?.summary || 'คัดกรองโลหิตจางจากการขาดธาตุเหล็กตามช่วงอายุและชนิดแลปที่กำหนด',
        claimChannel: 'KTB',
        recordingSystem: 'KTB ตามประกาศ PPFS 2569',
        conditions: anemiaRule?.conditions || [
            'อายุ 13-24 ปี ต้องมี Lab CBC + Diagnosis Z130/Z138 + ADP 13001',
            'อายุ 6-12 เดือน ต้องมี Lab Hb/Hct + Diagnosis Z130/Z138 + ADP 13001',
            'อายุ 3-6 ปี ต้องมี Lab Hb/Hct + Diagnosis Z130/Z138 + ADP 13001'
        ],
        caution: anemiaRule?.caution || 'กองทุนนี้ต้องดู “ช่วงอายุ + ชนิดแลป” ให้ตรงกับเกณฑ์ก่อน'
      },
    {
        id: 'syphilis_screening_male',
        name: 'คัดกรองซิฟิลิส (ชาย)',
        description: 'บริการคัดกรองโรคซิฟิลิสในประชาชนทั่วไปเพศชาย',
        claimChannel: 'KTB',
        recordingSystem: 'KTB; รายงาน/เชื่อมข้อมูลบางส่วนผ่าน Seamless/DMIS ตามพื้นที่',
        conditions: [
            'ประชาชนทั่วไปเพศชาย',
            'มี Lab Treponema Pallidum Antibody หรือรายการตรวจซิฟิลิส',
            'รองรับชื่อ Lab/บริการกลุ่ม Treponema, Syphilis, RPR, VDRL, TPHA, TPPA'
        ],
        caution: 'ตรวจสอบความเหมาะสมของกลุ่มเป้าหมายตามประกาศกองทุน และผลตรวจที่ผูกกับ visit ให้ถูกต้อง'
    },
    {
        id: 'iron_supplement',
        name: 'เสริมธาตุเหล็ก',
        description: 'ยาเสริมธาตุเหล็ก',
        claimChannel: 'KTB',
        recordingSystem: 'KTB ตามประกาศ PPFS 2569',
        conditions: ['หญิงอายุ 13-45 ปี', 'Diagnosis Z130', 'ADP 14001']
    },
    {
        id: 'ferrokid_child',
        name: 'เสริมธาตุเหล็กเด็ก (Ferrokid)',
        description: 'กองทุนเด็ก 6-12 เดือน (PP-B FS)',
        claimChannel: 'KTB',
        recordingSystem: 'KTB ตามประกาศ PPFS 2569',
        conditions: ['อายุ 6-12 เดือน', 'Diagnosis Z130', 'มียา Ferrokid']
    },
    {
        id: 'chemo',
        name: 'เคมีบำบัด',
        description: 'ผู้ป่วยเคมีบำบัด',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim',
        conditions: ['Diagnosis Z511 หรือ Z512']
    },
    {
        id: 'hepc',
        name: 'ไวรัสตับอักเสบซี',
        description: 'คัดกรองไวรัสตับอักเสบซี / Anti-HCV',
        claimChannel: 'KTB',
        recordingSystem: 'KTB ตั้งแต่ 1 มิ.ย. 2568 ตามเอกสาร',
        conditions: ['เกิดก่อน พ.ศ. 2535', 'Diagnosis Z11.5', 'Lab Anti-HCV']
    },
    {
        id: 'hepb',
        name: 'ไวรัสตับอักเสบบี',
        description: 'คัดกรองไวรัสตับอักเสบบี / HBsAg',
        claimChannel: 'KTB',
        recordingSystem: 'KTB ตามประกาศ PPFS',
        conditions: ['เกิดก่อน พ.ศ. 2535', 'Diagnosis Z11.5', 'Lab HBsAg']
    },
    {
        id: 'rehab',
        name: 'ฟื้นฟูสมรรถภาพ',
        description: 'งานฟื้นฟู / กายภาพ',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือระบบฟื้นฟูตามประกาศ',
        conditions: ['Diagnosis Z50']
    },
    {
        id: 'crrt',
        name: 'ฟอกเลือด (CRRT)',
        description: 'ผู้ป่วยฟอกเลือด / ไต',
        claimChannel: 'อื่นๆ',
        recordingSystem: 'ระบบ renal/รายการเฉพาะตามประกาศ สปสช.',
        conditions: ['Diagnosis Z49']
    },
    {
        id: 'robot',
        name: 'ผ่าตัดหุ่นยนต์',
        description: 'Robotic surgery',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือ approval เฉพาะรายการ',
        conditions: ['มีรายการหรือหัตถการที่ระบุ Robot']
    },
    {
        id: 'proton',
        name: 'รังสีรักษา (Proton)',
        description: 'ฉายแสงโปรตอน',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือ approval เฉพาะรายการ',
        conditions: ['Diagnosis Z51.0']
    },
    {
        id: 'cxr',
        name: 'อ่านฟิล์ม CXR',
        description: 'อ่านฟิล์มทรวงอก',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือระบบคัดกรองที่ประกาศกำหนด',
        conditions: ['มีรายการอ่านฟิล์มทรวงอก / CXR']
    },
    {
        id: 'clopidogrel',
        name: 'Clopidogrel',
        description: 'ยาต้านเกล็ดเลือด',
        claimChannel: 'FDH/e-Claim',
        recordingSystem: 'FDH/e-Claim หรือระบบยาตามประกาศ',
        conditions: ['มียา Clopidogrel ใน visit']
    },
];
