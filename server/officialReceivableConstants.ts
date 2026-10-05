export interface OfficialChartAccount {
  order: number;
  code: string;
  name: string;
  isIpd: boolean;
  category: 'UC' | 'SSS' | 'OFC' | 'LGO' | 'ALIEN' | 'OTHER';
}

export const OFFICIAL_CHART_OF_ACCOUNTS_54: OfficialChartAccount[] = [
  { order: 1, code: '1102050101.102', name: 'ลูกหนี้ค่าสิ่งส่งตรวจหน่วยงานภาครัฐ', isIpd: false, category: 'OTHER' },
  { order: 2, code: '1102050101.103', name: 'ลูกหนี้ค่าตรวจสุขภาพหน่วยงานภาครัฐ', isIpd: false, category: 'OTHER' },
  { order: 3, code: '1102050101.104', name: 'ลูกหนี้ค่าวัสดุ/อุปกรณ์/น้ำยา หน่วยงานภาครัฐ', isIpd: false, category: 'OTHER' },
  { order: 4, code: '1102050101.105', name: 'ลูกหนี้ค่าสินค้า หน่วยงานภาครัฐ', isIpd: false, category: 'OTHER' },
  { order: 5, code: '1102050101.109', name: 'ลูกหนี้ - ระบบปฏิบัติการฉุกเฉิน', isIpd: false, category: 'OTHER' },
  { order: 6, code: '1102050101.201', name: 'ลูกหนี้ค่ารักษา UC- OP ใน CUP', isIpd: false, category: 'UC' },
  { order: 7, code: '1102050101.202', name: 'ลูกหนี้ค่ารักษา UC - IP', isIpd: true, category: 'UC' },
  { order: 8, code: '1102050101.203', name: 'ลูกหนี้ค่ารักษา UC - OP นอก CUP (ในจังหวัดสังกัด สธ.)', isIpd: false, category: 'UC' },
  { order: 9, code: '1102050101.204', name: 'ลูกหนี้ค่ารักษา UC - OP นอก CUP (ต่างจังหวัดสังกัด สธ.)', isIpd: false, category: 'UC' },
  { order: 10, code: '1102050101.209', name: 'ลูกหนี้ค่ารักษาด้านการสร้างเสริมสุขภาพและป้องกันโรค (P&P)', isIpd: false, category: 'UC' },
  { order: 11, code: '1102050101.216', name: 'ลูกหนี้ค่ารักษา UC - OP บริการเฉพาะ (CR)', isIpd: false, category: 'UC' },
  { order: 12, code: '1102050101.217', name: 'ลูกหนี้ค่ารักษา UC - IP บริการเฉพาะ (CR)', isIpd: true, category: 'UC' },
  { order: 13, code: '1102050101.222', name: 'ลูกหนี้ค่ารักษา OP - Refer', isIpd: false, category: 'UC' },
  { order: 14, code: '1102050101.223', name: 'ลูกหนี้ค่าบริการสาธารณสุขสำหรับโรคติดเชื้อไวรัสโคโรนา - OP จาก สปสช.', isIpd: false, category: 'UC' },
  { order: 15, code: '1102050101.224', name: 'ลูกหนี้ค่าบริการสาธารณสุขสำหรับโรคติดเชื้อไวรัสโคโรนา - IP จาก สปสช.', isIpd: true, category: 'UC' },
  { order: 16, code: '1102050101.301', name: 'ลูกหนี้ค่ารักษาประกันสังคม OP -เครือข่าย', isIpd: false, category: 'SSS' },
  { order: 17, code: '1102050101.302', name: 'ลูกหนี้ค่ารักษาประกันสังคม IP - เครือข่าย', isIpd: true, category: 'SSS' },
  { order: 18, code: '1102050101.303', name: 'ลูกหนี้ค่ารักษาประกันสังคม OP - นอกเครือข่าย สังกัด สป.สธ.', isIpd: false, category: 'SSS' },
  { order: 19, code: '1102050101.304', name: 'ลูกหนี้ค่ารักษาประกันสังคม IP - นอกเครือข่าย สังกัด สป.สธ.', isIpd: true, category: 'SSS' },
  { order: 20, code: '1102050101.307', name: 'ลูกหนี้ค่ารักษาประกันสังคม - กองทุนทดแทน', isIpd: false, category: 'SSS' },
  { order: 21, code: '1102050101.308', name: 'ลูกหนี้ค่ารักษาประกันสังคม 72 ชั่วโมงแรก', isIpd: true, category: 'SSS' },
  { order: 22, code: '1102050101.309', name: 'ลูกหนี้ค่ารักษาประกันสังคม - ค่าใช้จ่ายสูง/อุบัติเหตุ/ฉุกเฉิน OP', isIpd: false, category: 'SSS' },
  { order: 23, code: '1102050101.310', name: 'ลูกหนี้ค่ารักษาประกันสังคม - ค่าใช้จ่ายสูง IP', isIpd: true, category: 'SSS' },
  { order: 24, code: '1102050101.401', name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรงกรมบัญชีกลาง OP', isIpd: false, category: 'OFC' },
  { order: 25, code: '1102050101.402', name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรงกรมบัญชีกลาง IP', isIpd: true, category: 'OFC' },
  { order: 26, code: '1102050101.501', name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว OP', isIpd: false, category: 'ALIEN' },
  { order: 27, code: '1102050101.502', name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว IP', isIpd: true, category: 'ALIEN' },
  { order: 28, code: '1102050101.503', name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว OP นอก CUP', isIpd: false, category: 'ALIEN' },
  { order: 29, code: '1102050101.504', name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว IP นอก CUP', isIpd: true, category: 'ALIEN' },
  { order: 30, code: '1102050101.505', name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว เบิกจากส่วนกลาง OP', isIpd: false, category: 'ALIEN' },
  { order: 31, code: '1102050101.506', name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าวเบิกจากส่วนกลาง IP', isIpd: true, category: 'ALIEN' },
  { order: 32, code: '1102050101.701', name: 'ลูกหนี้ค่ารักษา - บุคคลที่มีปัญหาสถานะและสิทธิ OP ใน CUP', isIpd: false, category: 'OTHER' },
  { order: 33, code: '1102050101.702', name: 'ลูกหนี้ค่ารักษา - บุคคลที่มีปัญหาสถานะและสิทธิ OP นอก CUP', isIpd: false, category: 'OTHER' },
  { order: 34, code: '1102050101.703', name: 'ลูกหนี้ค่ารักษาบุคคลที่มีปัญหาสถานะและสิทธิ - เบิกจากส่วนกลาง OP', isIpd: false, category: 'OTHER' },
  { order: 35, code: '1102050101.704', name: 'ลูกหนี้ค่ารักษาบุคคลที่มีปัญหาสถานะและสิทธิ - เบิกจากส่วนกลาง IP', isIpd: true, category: 'OTHER' },
  { order: 36, code: '1102050102.102', name: 'ลูกหนี้ค่าสิ่งส่งตรวจบุคคลภายนอก', isIpd: false, category: 'OTHER' },
  { order: 37, code: '1102050102.103', name: 'ลูกหนี้ค่าตรวจสุขภาพบุคคล ภายนอก', isIpd: false, category: 'OTHER' },
  { order: 38, code: '1102050102.104', name: 'ลูกหนี้ค่าวัสดุ/อุปกรณ์/น้ำยา บุคคลภายนอก', isIpd: false, category: 'OTHER' },
  { order: 39, code: '1102050102.105', name: 'ลูกหนี้ค่าสินค้า บุคคลภายนอก', isIpd: false, category: 'OTHER' },
  { order: 40, code: '1102050102.106', name: 'ลูกหนี้ค่ารักษา - ชำระเงิน OP', isIpd: false, category: 'OTHER' },
  { order: 41, code: '1102050102.107', name: 'ลูกหนี้ค่ารักษา - ชำระเงินIP', isIpd: true, category: 'OTHER' },
  { order: 42, code: '1102050102.108', name: 'ลูกหนี้ค่ารักษา - เบิกต้นสังกัด OP', isIpd: false, category: 'OTHER' },
  { order: 43, code: '1102050102.109', name: 'ลูกหนี้ค่ารักษา - เบิกต้นสังกัด IP', isIpd: true, category: 'OTHER' },
  { order: 44, code: '1102050102.110', name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรงหน่วยงานอื่น OP', isIpd: false, category: 'OTHER' },
  { order: 45, code: '1102050102.111', name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรงหน่วยงานอื่น IP', isIpd: true, category: 'OTHER' },
  { order: 46, code: '1102050102.201', name: 'ลูกหนี้ค่ารักษา UC - OP นอกสังกัด สธ.', isIpd: false, category: 'UC' },
  { order: 47, code: '1102050102.602', name: 'ลูกหนี้ค่ารักษา - พรบ.รถ OP', isIpd: false, category: 'OTHER' },
  { order: 48, code: '1102050102.603', name: 'ลูกหนี้ค่ารักษา - พรบ.รถ IP', isIpd: true, category: 'OTHER' },
  { order: 49, code: '1102050102.801', name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. OP', isIpd: false, category: 'LGO' },
  { order: 50, code: '1102050102.802', name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. IP', isIpd: true, category: 'LGO' },
  { order: 51, code: '1102050102.803', name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท.รูปแบบพิเศษ OP', isIpd: false, category: 'LGO' },
  { order: 52, code: '1102050102.804', name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรงอปท.รูปแบบพิเศษ IP', isIpd: true, category: 'LGO' },
  { order: 53, code: '1102050102.301', name: 'ลูกหนี้ค่ารักษาประกันสังคม OP - นอกเครือข่าย ต่างสังกัด สป.สธ.', isIpd: false, category: 'SSS' },
  { order: 54, code: '1102050102.302', name: 'ลูกหนี้ค่ารักษาประกันสังคม IP - นอกเครือข่าย ต่างสังกัด สป.สธ', isIpd: true, category: 'SSS' },
];

export const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export const normalizeAccountCode = (code: string | number): string => {
  const s = String(code || '').trim();
  if (!s) return '';
  if (s === '1102050101.31') return '1102050101.310';
  if (s === '1102050102.11') return '1102050102.110';
  return s;
};
