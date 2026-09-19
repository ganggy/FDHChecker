/**
 * ICD-9-CM Procedures and Operations Service
 * รองรับการค้นหารหัสหัตถการ จัดกลุ่มตาม Chapter และเชื่อมโยงกองทุน สปสช./FDH
 */

export interface Icd9Item {
  code: string;
  name: string;
  category: string;
  fundTags: string[];
  descriptionTh?: string;
}

export interface Icd9Chapter {
  range: [number, number];
  chapter: string;
  titleTh: string;
  titleEn: string;
}

export const ICD9_CHAPTERS: Icd9Chapter[] = [
  { range: [1, 5], chapter: '01-05', titleTh: 'ระบบประสาท (Nervous System)', titleEn: 'Operations on the Nervous System' },
  { range: [6, 7], chapter: '06-07', titleTh: 'ระบบต่อมไร้ท่อ (Endocrine System)', titleEn: 'Operations on the Endocrine System' },
  { range: [8, 16], chapter: '08-16', titleTh: 'ระบบตาและดวงตา (The Eye / Cataract)', titleEn: 'Operations on the Eye' },
  { range: [18, 20], chapter: '18-20', titleTh: 'ระบบหูและปุ่มกกหู (The Ear)', titleEn: 'Operations on the Ear' },
  { range: [21, 29], chapter: '21-29', titleTh: 'จมูก ช่องปาก และคอหอย / ทันตกรรม (Nose, Mouth, Pharynx & Dental)', titleEn: 'Operations on the Nose, Mouth, and Pharynx' },
  { range: [30, 34], chapter: '30-34', titleTh: 'ระบบทางเดินหายใจ (Respiratory System)', titleEn: 'Operations on the Respiratory System' },
  { range: [35, 39], chapter: '35-39', titleTh: 'ระบบหัวใจและหลอดเลือด (Cardiovascular System)', titleEn: 'Operations on the Cardiovascular System' },
  { range: [40, 41], chapter: '40-41', titleTh: 'ระบบเลือดและน้ำเหลือง (Hemic & Lymphatic)', titleEn: 'Operations on the Hemic and Lymphatic System' },
  { range: [42, 54], chapter: '42-54', titleTh: 'ระบบทางเดินอาหาร / ส่องกล้อง (Digestive System & Endoscopy)', titleEn: 'Operations on the Digestive System' },
  { range: [55, 59], chapter: '55-59', titleTh: 'ระบบทางเดินปัสสาวะ (Urinary System)', titleEn: 'Operations on the Urinary System' },
  { range: [60, 64], chapter: '60-64', titleTh: 'ระบบสืบพันธุ์เพศชาย (Male Genital)', titleEn: 'Operations on the Male Genital Organs' },
  { range: [65, 71], chapter: '65-71', titleTh: 'ระบบสืบพันธุ์เพศหญิง (Female Genital / FP)', titleEn: 'Operations on the Female Genital Organs' },
  { range: [72, 75], chapter: '72-75', titleTh: 'สูติกรรม / คลอด (Obstetrical Procedures)', titleEn: 'Obstetrical Procedures' },
  { range: [76, 84], chapter: '76-84', titleTh: 'ระบบกล้ามเนื้อและกระดูก (Musculoskeletal System)', titleEn: 'Operations on the Musculoskeletal System' },
  { range: [85, 86], chapter: '85-86', titleTh: 'เต้านมและผิวหนัง (Integumentary System)', titleEn: 'Operations on the Integumentary System' },
  { range: [87, 99], chapter: '87-99', titleTh: 'การตรวจวินิจฉัยและบำบัดรักษา (Diagnostic & Therapeutic)', titleEn: 'Miscellaneous Diagnostic and Therapeutic Procedures' },
];

export const getIcd9Chapter = (code: string): string => {
  const clean = code.replace(/[^0-9]/g, '');
  if (!clean) return 'อื่นๆ (Other)';
  const num = parseInt(clean.substring(0, 2), 10);
  if (isNaN(num)) return 'อื่นๆ (Other)';
  const found = ICD9_CHAPTERS.find(ch => num >= ch.range[0] && num <= ch.range[1]);
  return found ? `${found.chapter} ${found.titleTh}` : 'อื่นๆ (Other)';
};

export const getIcd9FundTags = (code: string, name = ''): string[] => {
  const clean = code.replace(/[^0-9]/g, '');
  const tags: string[] = [];
  const upperName = name.toUpperCase();

  // ต้อกระจก (Cataract)
  if (clean.startsWith('13') || upperName.includes('CATARACT') || upperName.includes('LENS')) {
    tags.push('ผ่าตัดต้อกระจก');
  }

  // ส่องกล้องทางเดินอาหาร (Endoscopy / Colonoscopy / Gastroscopy)
  if (
    clean === '4523' || clean === '4542' || clean === '4543' || clean === '4524' ||
    clean === '4413' || clean === '4414' || clean === '4422' || clean === '4443' ||
    upperName.includes('COLONOSCOP') || upperName.includes('GASTROSCOP') || upperName.includes('ENDOSCOP')
  ) {
    tags.push('ส่องกล้องระบบทางเดินอาหาร');
  }

  // ทันตกรรม (Dental / ANC Dental)
  if (clean === '8931' || clean === '9654' || clean.startsWith('23') || upperName.includes('TOOTH') || upperName.includes('DENTAL')) {
    tags.push('ทันตกรรม');
    if (clean === '8931' || clean === '9654') {
      tags.push('ทันตกรรมหญิงตั้งครรภ์ (ANC)');
    }
  }

  // วางแผนครอบครัว (Family Planning)
  if (
    clean === '9923' || clean === '8605' || clean === '6629' || clean === '6639' || clean === '6373' || clean === '697' ||
    upperName.includes('CONTRACEPT') || upperName.includes('STERILIZATION') || upperName.includes('VASECTOMY')
  ) {
    tags.push('วางแผนครอบครัว (FP)');
  }

  // ผ่าตัดข้อเข่า (Knee)
  if (clean.startsWith('8154') || clean.startsWith('8155') || clean.startsWith('80') || upperName.includes('KNEE')) {
    tags.push('ผ่าตัดข้อเข่า');
  }

  // ฟอกเลือด / ล้างไต (Hemodialysis / CAPD)
  if (clean === '3995' || clean === '3893' || clean === '3895' || upperName.includes('HEMODIALYSIS') || upperName.includes('DIALYSIS')) {
    tags.push('ฟอกเลือด/ไตวาย');
  }

  // ผ่าตัดวันเดียวกลับ (ODS / MIS)
  if (
    clean === '4701' || clean === '4709' || clean === '5123' || clean === '5300' || clean === '5301' ||
    clean === '5302' || clean === '5305' || clean === '282' || clean === '283'
  ) {
    tags.push('ผ่าตัดวันเดียวกลับ (ODS/MIS)');
  }

  return tags;
};

export const COMMON_ICD9_PRESETS = [
  {
    category: 'ผ่าตัดต้อกระจก (Cataract)',
    items: [
      { code: '13.41', name: 'Phacoemulsification and aspiration of cataract', tag: 'สลายต้อกระจกด้วยอัลตราซาวนด์' },
      { code: '13.71', name: 'Insertion of intraocular lens prosthesis with cataract extraction', tag: 'ใส่เลนส์เทียมพร้อมผ่าต้อกระจก' },
      { code: '13.59', name: 'Other extracapsular extraction of lens', tag: 'ผ่าตัดต้อกระจกแบบเปิดแผลใหญ่ (ECCE)' },
      { code: '13.19', name: 'Other intracapsular extraction of lens', tag: 'ผ่าตัดต้อกระจกแบบในถุง (ICCE)' },
      { code: '13.69', name: 'Other cataract extraction', tag: 'การผ่าตัดต้อกระจกวิธีอื่น' },
    ]
  },
  {
    category: 'ส่องกล้องระบบทางเดินอาหาร (GI Endoscopy)',
    items: [
      { code: '45.23', name: 'Flexible fiberoptic colonoscopy', tag: 'ส่องกล้องตรวจลำไส้ใหญ่' },
      { code: '45.42', name: 'Endoscopic polypectomy of large intestine', tag: 'ตัดติ่งเนื้อลำไส้ใหญ่ผ่านกล้อง' },
      { code: '45.43', name: 'Endoscopic destruction of other lesion of large intestine', tag: 'จี้ทำลายรอยโรคในลำไส้ใหญ่ผ่านกล้อง' },
      { code: '44.13', name: 'Other gastroscopy', tag: 'ส่องกล้องตรวจกระเพาะอาหาร (EGD)' },
      { code: '45.13', name: 'Other endoscopy of small intestine', tag: 'ส่องกล้องตรวจลำไส้เล็ก' },
    ]
  },
  {
    category: 'ทันตกรรม (Dental Procedures)',
    items: [
      { code: '89.31', name: 'Dental examination', tag: 'ตรวจสุขภาพช่องปากและฟัน (ANC Dental)' },
      { code: '96.54', name: 'Dental prophylaxis', tag: 'ขูดหินปูนและขัดฟัน (ANC Dental Cleaning)' },
      { code: '23.09', name: 'Extraction of other tooth', tag: 'ถอนฟันทั่วไป' },
      { code: '23.19', name: 'Other surgical extraction of tooth', tag: 'ผ่าฟันคุด / ผ่าตัดถอนฟัน' },
      { code: '23.2', name: 'Restoration of tooth by filling', tag: 'อุดฟัน' },
    ]
  },
  {
    category: 'วางแผนครอบครัว (Family Planning)',
    items: [
      { code: '99.23', name: 'Injection of steroid', tag: 'ฉีดยาคุมกำเนิด (DMPA)' },
      { code: '86.05', name: 'Incision with removal of foreign body / implant', tag: 'ฝังยาคุม / ถอดเข็มยาคุมกำเนิด' },
      { code: '66.29', name: 'Other bilateral endoscopic destruction or occlusion of fallopian tubes', tag: 'ทำหมันหญิงผ่านกล้อง' },
      { code: '66.39', name: 'Other bilateral destruction or occlusion of fallopian tubes', tag: 'ทำหมันหญิงแบบเปิดหน้าท้อง (TR/Pomeroy)' },
      { code: '63.73', name: 'Vasectomy', tag: 'ทำหมันชาย (ตัด/ผูกท่อนำอสุจิ)' },
      { code: '69.7', name: 'Insertion of intrauterine contraceptive device', tag: 'ใส่ห่วงอนามัยคุมกำเนิด (IUD)' },
    ]
  },
  {
    category: 'ศัลยกรรมและการผ่าตัดวันเดียวกลับ (ODS / General Surgery)',
    items: [
      { code: '47.01', name: 'Laparoscopic appendectomy', tag: 'ผ่าตัดไส้ติ่งผ่านกล้อง (ODS/MIS)' },
      { code: '47.09', name: 'Other appendectomy', tag: 'ผ่าตัดไส้ติ่งแบบเปิด' },
      { code: '53.05', name: 'Repair of other unilateral inguinal hernia', tag: 'ผ่าตัดไส้เลื่อนขาหนีบ (Hernia Repair)' },
      { code: '51.23', name: 'Laparoscopic cholecystectomy', tag: 'ผ่าตัดถุงน้ำดีผ่านกล้อง (LC)' },
      { code: '86.22', name: 'Excisional debridement of wound, infection, or burn', tag: 'ตัดแต่งบาดแผลและเนื้อตาย (Debridement)' },
      { code: '86.3', name: 'Other local excision or destruction of lesion or tissue of skin', tag: 'ผ่าตัดตัดชิ้นเนื้อ/ก้อนผิวหนัง' },
    ]
  }
];
