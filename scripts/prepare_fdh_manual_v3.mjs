import fs from 'node:fs';
import path from 'node:path';

const rawPath = path.resolve('tmp_fdh_manual_2.txt');
const rawText = fs.readFileSync(rawPath, 'utf8');

const lines = rawText.replace(/\r\n/g, '\n').split('\n');

const out = [];

// Header
out.push('# คู่มือการใช้งานระบบศูนย์กลางข้อมูลด้านการเงิน (MOPH Financial Data Hub: FDH) Update Version 3.0\n');
out.push('> **หน่วยงานรับผิดชอบ:** กลุ่มงานบริหารจัดการศูนย์กลางข้อมูลด้านการเงิน (Financial Data Hub) กองเศรษฐกิจสุขภาพและหลักประกันสุขภาพ สำนักงานปลัดกระทรวงสาธารณสุข  ');
out.push('> **อ้างอิงระเบียบ:** ระเบียบสำนักงานปลัดกระทรวงสาธารณสุข เรื่อง ระบบศูนย์กลางข้อมูลด้านการเงิน (Financial Data Hub) กระทรวงสาธารณสุข พ.ศ. 2567 (19 มิถุนายน 2567)  ');
out.push('> **เวอร์ชันเอกสาร:** Update Version 3.0\n');
out.push('---\n');

let inCurl = false;
let inJson = false;
let jsonBraceDepth = 0;

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];

  // Headings detection
  const trimmed = line.trim();

  // Handle Level 1 headings
  if (/^ส่วนที่ \d+/.test(trimmed) || trimmed === 'คำนำ' || trimmed === 'สารบัญ' || trimmed === 'ภาคผนวก' || trimmed === 'ที่ปรึกษา' || trimmed === 'คณะผู้จัดทำ') {
    if (inCurl) { out.push('```\n'); inCurl = false; }
    if (inJson) { out.push('```\n'); inJson = false; }
    out.push(`\n# ${trimmed}\n`);
    continue;
  }

  // Handle Level 2 headings
  if (
    /^(ความเป็นมาและความสำคัญ|วัตถุประสงค์|ขั้นตอนและกระบวนการ|การสมัครขอเข้าใช้งาน|การนำข้อมูล 16 แฟ้ม|วิธีที่ \d+|การนำข้อมูล Minimal Data Set|การนำข้อมูล Total Visit|การส่งข้อมูลบริการสาธารณสุข|แนวทางการเพิ่มประสิทธิภาพ)/.test(trimmed) ||
    /^\d+\.\s*(Dashboard|สถิติการส่งเคลม|วิธีการเพิ่ม Project code|ตรวจสอบรายงานผล|FDH Smart Check|ลงทะเบียน BIO ID|แบบคำขอ|ลงทะเบียนหมอพร้อม|ตัวอย่างหนังสือ|การขอใช้ข้อมูล|คู่มือการขอข้อมูล|ชุดข้อมูลด้านการเงิน|ระเบียบสำนักงานปลัด|คำสั่งกระทรวง|คำสั่งคณะกรรมการ)/.test(trimmed)
  ) {
    if (inCurl) { out.push('```\n'); inCurl = false; }
    if (inJson) { out.push('```\n'); inJson = false; }
    out.push(`\n## ${trimmed}\n`);
    continue;
  }

  // Handle Level 3 sub-headings
  if (/^(\d+\.\d+|\d+\.)\s+/.test(trimmed) && trimmed.length < 90 && !trimmed.endsWith(' บาท') && !trimmed.endsWith(' รายการ')) {
    if (inCurl) { out.push('```\n'); inCurl = false; }
    if (inJson) { out.push('```\n'); inJson = false; }
    out.push(`\n### ${trimmed}\n`);
    continue;
  }

  // Handle Code / Curl blocks
  if (/^curl --location/i.test(trimmed)) {
    if (!inCurl) {
      out.push('\n```bash');
      inCurl = true;
    }
  }

  if (inCurl && (trimmed === '{' || trimmed.startsWith('Example response'))) {
    out.push('```\n');
    inCurl = false;
  }

  if (/^Example (request|response)/i.test(trimmed)) {
    if (inCurl) { out.push('```\n'); inCurl = false; }
    if (inJson) { out.push('```\n'); inJson = false; }
    out.push(`\n**${trimmed}**\n`);
    continue;
  }

  if (!inJson && !inCurl && trimmed === '{') {
    out.push('\n```json');
    inJson = true;
    jsonBraceDepth = 1;
    out.push(line);
    continue;
  }

  if (inJson) {
    out.push(line);
    for (const ch of line) {
      if (ch === '{') jsonBraceDepth++;
      else if (ch === '}') jsonBraceDepth--;
    }
    if (jsonBraceDepth <= 0) {
      out.push('```\n');
      inJson = false;
      jsonBraceDepth = 0;
    }
    continue;
  }

  // Regular lines
  out.push(line);
}

if (inCurl) out.push('```\n');
if (inJson) out.push('```\n');

// Clean up excessive blank lines
const joined = out.join('\n').replace(/\n{4,}/g, '\n\n\n');

const vaultDest = path.resolve('knowlage/vault/MOPH_FDH_MANUAL_V3.md');
fs.mkdirSync(path.dirname(vaultDest), { recursive: true });
fs.writeFileSync(vaultDest, joined, 'utf8');

console.log(`Generated MOPH_FDH_MANUAL_V3.md: ${joined.length} bytes, ${joined.split('\n').length} lines`);
