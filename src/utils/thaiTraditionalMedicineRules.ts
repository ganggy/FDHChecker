/**
 * เงื่อนไขการนวดและประคบสมุนไพร สิทธิ LGO หรือ OFC
 * ตามหนังสือกรมบัญชีกลาง ด่วนที่สุด ที่ กค 0422.2/ว 447 ลว. 12 พ.ย. 58
 * หมายเหตุ: การเบิกค่ารักษาพยาบาลในรหัส 58101, 58102, 58130, 58131 และ 58201 ใน 1 วัน ให้เบิกได้เพียงรหัสเดียว
 * ใช้ตั้งแต่ระบบ eClaim รวมทั้ง NHSO Digital Platform (สอดคล้องกับข้อผิดพลาด e-Claim / REP รหัส 853)
 */

export const THAI_MED_CIRCULAR_REF = 'หนังสือกรมบัญชีกลาง ด่วนที่สุด ที่ กค 0422.2/ว 447 ลว. 12 พ.ย. 58';
export const THAI_MED_REP_ERROR_CODE = '853';

export const THAI_MED_SAME_DAY_CODES = ['58101', '58102', '58130', '58131', '58201'] as const;
export type ThaiMedSameDayCode = typeof THAI_MED_SAME_DAY_CODES[number];

export interface ThaiMedItemInfo {
  code: ThaiMedSameDayCode;
  name: string;
  rate: number;
  category: 'บำบัดรักษา' | 'ฟื้นฟูสมรรถภาพ';
  hasMassage: boolean;
  hasCompress: boolean;
  description: string;
}

export const THAI_MED_CATALOG: Record<ThaiMedSameDayCode, ThaiMedItemInfo> = {
  '58101': {
    code: '58101',
    name: 'ค่านวดเพื่อการบำบัดรักษาโรค',
    rate: 200.0,
    category: 'บำบัดรักษา',
    hasMassage: true,
    hasCompress: false,
    description: 'ค่านวดเพื่อการบำบัดรักษาโรค (อัตรา 200.00 บาท)',
  },
  '58102': {
    code: '58102',
    name: 'ค่านวดเพื่อการฟื้นฟูสมรรถภาพ',
    rate: 200.0,
    category: 'ฟื้นฟูสมรรถภาพ',
    hasMassage: true,
    hasCompress: false,
    description: 'ค่านวดเพื่อการฟื้นฟูสมรรถภาพ สำหรับผู้ป่วยโรคอัมพฤกษ์ อัมพาต โรคสันนิบาต และการฟื้นฟูมารดาหลังคลอด (อัตรา 200.00 บาท)',
  },
  '58130': {
    code: '58130',
    name: 'ค่านวดและประคบสมุนไพรเพื่อการบำบัดรักษาโรค',
    rate: 250.0,
    category: 'บำบัดรักษา',
    hasMassage: true,
    hasCompress: true,
    description: 'ค่านวดและประคบสมุนไพรเพื่อการบำบัดรักษาโรค (อัตรา 250.00 บาท)',
  },
  '58131': {
    code: '58131',
    name: 'ค่านวดและประคบสมุนไพรเพื่อการฟื้นฟูสมรรถภาพ',
    rate: 250.0,
    category: 'ฟื้นฟูสมรรถภาพ',
    hasMassage: true,
    hasCompress: true,
    description: 'ค่านวดและประคบสมุนไพรเพื่อการฟื้นฟูสมรรถภาพ สำหรับผู้ป่วยโรคอัมพฤกษ์ อัมพาต โรคสันนิบาต และการฟื้นฟูมารดาหลังคลอด (อัตรา 250.00 บาท)',
  },
  '58201': {
    code: '58201',
    name: 'ค่าประคบสมุนไพรเพื่อการฟื้นฟูสมรรถภาพ',
    rate: 150.0,
    category: 'ฟื้นฟูสมรรถภาพ',
    hasMassage: false,
    hasCompress: true,
    description: 'ค่าประคบสมุนไพรเพื่อการฟื้นฟูสมรรถภาพ สำหรับผู้ป่วยโรคอัมพฤกษ์ อัมพาต โรคสันนิบาต และการฟื้นฟูมารดาหลังคลอด (อัตรา 150.00 บาท)',
  },
};

const CODE_SET = new Set<string>(THAI_MED_SAME_DAY_CODES);

export const isThaiMedSameDayCode = (code: unknown): code is ThaiMedSameDayCode =>
  typeof code === 'string' && CODE_SET.has(code.trim());

/**
 * คืนรายการรหัสที่มีการเบิกซ้ำซ้อนในวันเดียวกัน (หากมีมากกว่า 1 รหัส ถือว่าขัดต่อ ว 447)
 */
export const findThaiMedSameDayConflict = (codes: Array<string | null | undefined>): ThaiMedSameDayCode[] => {
  const found = new Set<ThaiMedSameDayCode>();
  for (const c of codes) {
    if (!c) continue;
    const clean = String(c).trim();
    if (isThaiMedSameDayCode(clean)) {
      found.add(clean);
    }
  }
  return Array.from(found);
};

/**
 * เสนอรหัสรวมที่ถูกต้องเมื่อพบการเบิกทั้งนวดและประคบในวันเดียวกัน
 * เช่น เบิกทั้ง 58101 (นวด 200) และ 58201 (ประคบ 150) -> แนะนำเปลี่ยนเป็น 58130 (นวดและประคบ 250)
 */
export const suggestCombinedThaiMedCode = (conflictingCodes: ThaiMedSameDayCode[]): ThaiMedSameDayCode | null => {
  const set = new Set(conflictingCodes);
  const hasRehab = set.has('58102') || set.has('58131') || set.has('58201');
  const hasMassage = set.has('58101') || set.has('58102') || set.has('58130') || set.has('58131');
  const hasCompress = set.has('58130') || set.has('58131') || set.has('58201');

  if (hasMassage && hasCompress) {
    return hasRehab ? '58131' : '58130';
  }
  if (hasMassage) {
    return hasRehab ? '58102' : '58101';
  }
  if (hasCompress) {
    return '58201';
  }
  return null;
};
