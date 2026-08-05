export type AiCapabilityTopic = 'all' | 'word' | 'excel' | 'csv' | 'json';

const capabilityQuestion = /(?:ทำอะไรได้(?:บ้าง)?|ช่วยอะไรได้(?:บ้าง)?|ความสามารถ|ใช้ทำอะไร|สร้างอะไรได้(?:บ้าง)?)/i;

export const parseAiCapabilityQuestion = (question: string): AiCapabilityTopic | null => {
  const normalized = question.trim().toLowerCase();
  if (!capabilityQuestion.test(normalized)) return null;
  if (/(?:\bword\b|\bdocx\b|เวิร์ด)/i.test(normalized)) return 'word';
  if (/(?:\bexcel\b|\bxlsx\b|เอ็กเซล)/i.test(normalized)) return 'excel';
  if (/\bcsv\b/i.test(normalized)) return 'csv';
  if (/\bjson\b/i.test(normalized)) return 'json';
  if (/(?:\bai\b|fdh|local ai|ผู้ช่วย|ระบบ)/i.test(normalized)) return 'all';
  return null;
};

const reportExamples = [
  'รายชื่อและสรุปผู้ป่วย OPD ตามวันหรือช่วงเวลา',
  'ประวัติผู้ป่วยที่ค้นด้วย HN, VN, AN, CID หรือชื่อ',
  'รายละเอียด visit เช่น การวินิจฉัย รายการยา ผลแล็บ และวันนัด',
  'รายงานนัดซ้ำ คลินิกที่มีนัด ความครบถ้วนการส่งเบิก และข้อมูลผิดพลาดแยกตามแผนก',
  'รายงานตรวจบุคคลที่มี CID เดียวกันแต่หลาย HN',
  'ผลค้นหาหรือรายงานจากคำถามก่อนหน้า',
];

const formatLabel: Record<Exclude<AiCapabilityTopic, 'all'>, string> = {
  word: 'Word (.docx)',
  excel: 'Excel (.xlsx)',
  csv: 'CSV (.csv)',
  json: 'JSON (.json)',
};

export const answerAiCapabilityQuestion = (topic: AiCapabilityTopic) => {
  const heading = topic === 'all'
    ? 'AI ในระบบ FDH ช่วยค้นข้อมูล สรุปผล และสร้างรายงานได้'
    : `AI ในระบบ FDH สร้างไฟล์ ${formatLabel[topic]} ให้ดาวน์โหลดได้ เช่น`;
  const formats = topic === 'all'
    ? '\n\nรูปแบบที่ส่งออกได้: Word (.docx), Excel (.xlsx), CSV และ JSON'
    : '\n\nหากต้องการข้อมูลแบบตาราง ยังส่งออกเป็น Excel, CSV หรือ JSON ได้';
  return [
    heading,
    '',
    ...reportExamples.map((item) => `- ${item}`),
    formats,
    '\nตัวอย่างคำสั่ง: “ขอ Word รายชื่อ OPD วันนี้” หรือ “ทำผลเมื่อกี้เป็น Word”',
    '\nระบบอ่านข้อมูล HOSxP แบบ read-only และจะไม่แก้ไขหรือลบข้อมูลผู้ป่วย',
  ].join('\n');
};
