export type FsProjectItem = {
  code: string;
  label: string;
  amount: number;
};

// อัตราตามประกาศ สปสช. ที่ใช้กับปีงบประมาณ 2569
// รายการที่ยกเลิกแล้ว (12001/12002) ต้องไม่อยู่ในชุดนี้
export const FS_PROJECT_ITEMS_2569: FsProjectItem[] = [
  { code: '1B004N', label: 'Pap smear ผลปกติ', amount: 250 },
  { code: '1B004P', label: 'Pap smear ผลผิดปกติ', amount: 250 },
  { code: '1B004_0N', label: 'VIA ผลปกติ', amount: 250 },
  { code: '1B004_0P', label: 'VIA ผลผิดปกติ', amount: 250 },
  { code: '1B0046_01', label: 'HPV DNA type 16/18/Other', amount: 280 },
  { code: '1B0046_1', label: 'HPV DNA 14 type fully', amount: 370 },
  { code: '1B005', label: 'Colposcopy', amount: 900 },
  { code: '12003', label: 'คัดกรองเบาหวาน FPG อายุ 35-59 ปี', amount: 50 },
  { code: '12004', label: 'คัดกรองหัวใจและหลอดเลือด Total Cholesterol และ HDL อายุ 45-70 ปี', amount: 160 },
  { code: '13001', label: 'คัดกรองโลหิตจาง', amount: 75 },
  { code: '14001', label: 'เสริมธาตุเหล็ก Ferrofolic', amount: 80 },
  { code: '15001', label: 'ทาฟลูออไรด์', amount: 100 },
  { code: '30008', label: 'ANC ตรวจฟัน (รวมในชุด 30009)', amount: 0 },
  { code: '30009', label: 'ANC ตรวจและขัดทำความสะอาดฟัน', amount: 500 },
  { code: '30010', label: 'ANC Ultrasound', amount: 400 },
  { code: '30011', label: 'ANC Visit', amount: 360 },
  { code: '30012', label: 'ANC Lab 1', amount: 600 },
  { code: '30013', label: 'ANC Lab 2 / ใกล้คลอด', amount: 190 },
  { code: '30014', label: 'ตรวจครรภ์ (UPT)', amount: 75 },
  { code: '30015', label: 'ดูแลหลังคลอด', amount: 150 },
  { code: '30016', label: 'เสริมธาตุเหล็กหลังคลอด', amount: 135 },
  { code: '37550', label: 'ตรวจยีน BRCA1/BRCA2', amount: 10000 },
  { code: '90001', label: 'ให้คำปรึกษา/เก็บตัวอย่าง BRCA', amount: 500 },
  { code: '90002', label: 'ตรวจ BRCA ญาติสายตรง', amount: 2500 },
  { code: '90004', label: 'ตัดชิ้นเนื้อช่องปากส่งพยาธิ', amount: 600 },
  { code: '90005', label: 'คัดกรองมะเร็งลำไส้ใหญ่และไส้ตรง', amount: 60 },
  { code: 'AB001', label: 'บริการยุติการตั้งครรภ์', amount: 3000 },
  { code: 'AB002', label: 'บริการยุติการตั้งครรภ์', amount: 3000 },
  { code: 'AB003', label: 'บริการยุติการตั้งครรภ์', amount: 3000 },
  { code: 'FP001', label: 'วางแผนครอบครัว ห่วงอนามัย', amount: 800 },
  { code: 'FP002_1', label: 'ฝังยาคุมกำเนิด', amount: 2150 },
  { code: 'FP002_2', label: 'ถอดยาฝังคุมกำเนิด', amount: 350 },
  { code: 'FP003_1', label: 'ยาเม็ดคุมกำเนิดชนิดฮอร์โมนรวม', amount: 40 },
  { code: 'FP003_2', label: 'ยาเม็ดคุมกำเนิดชนิดฮอร์โมนเดี่ยว', amount: 80 },
  { code: 'FP003_3', label: 'ยาเม็ดคุมกำเนิดฉุกเฉิน', amount: 50 },
  { code: 'FP003_4', label: 'ยาฉีดคุมกำเนิด', amount: 60 },
];

export const evaluateFsRate = (expectedAmount: number, rawAmount: number) => {
  const expected = Number(expectedAmount || 0);
  const actual = Number(rawAmount || 0);
  const difference = Number((actual - expected).toFixed(2));
  const matches = Math.abs(difference) < 0.01;

  return {
    matches,
    difference,
    status: matches ? 'matched' as const : 'mismatch' as const,
    warning: matches
      ? ''
      : `ราคา HOSxP ${actual.toFixed(2)} บาท ไม่ตรงอัตรา ${expected.toFixed(2)} บาท`,
  };
};
