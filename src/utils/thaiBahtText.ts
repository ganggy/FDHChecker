/**
 * แปลงจำนวนเงินตัวเลขเป็นคำอ่านภาษาไทย (Thai Baht Text)
 * ตัวอย่าง:
 *   1250 -> "หนึ่งพันสองร้อยห้าสิบบาทถ้วน"
 *   1250.50 -> "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์"
 *   0 -> "ศูนย์บาทถ้วน"
 */
export function thaiBahtText(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n) || n === 0) return 'ศูนย์บาทถ้วน';

  const isNegative = n < 0;
  const absNum = Math.abs(n);
  const parts = absNum.toFixed(2).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  const digits = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  function readGroup(groupStr: string): string {
    let result = '';
    const len = groupStr.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(groupStr[i], 10);
      const pos = len - i - 1;
      if (digit === 0) continue;

      if (pos === 1) { // หลักสิบ
        if (digit === 1) {
          result += 'สิบ';
        } else if (digit === 2) {
          result += 'ยี่สิบ';
        } else {
          result += digits[digit] + 'สิบ';
        }
      } else if (pos === 0) { // หลักหน่วย
        if (digit === 1 && len > 1 && parseInt(groupStr[len - 2], 10) > 0) {
          result += 'เอ็ด';
        } else if (digit === 1 && len > 1 && groupStr.length > 1 && parseInt(groupStr.slice(0, -1), 10) > 0) {
          result += 'เอ็ด';
        } else {
          result += digits[digit];
        }
      } else {
        result += digits[digit] + positions[pos];
      }
    }
    return result;
  }

  function readInteger(intStr: string): string {
    if (parseInt(intStr, 10) === 0) return '';
    const groups: string[] = [];
    let remaining = intStr;
    while (remaining.length > 6) {
      groups.unshift(remaining.slice(-6));
      remaining = remaining.slice(0, -6);
    }
    groups.unshift(remaining);

    let res = '';
    for (let i = 0; i < groups.length; i++) {
      const gText = readGroup(groups[i]);
      if (gText) {
        res += gText;
        const millionsPower = groups.length - i - 1;
        if (millionsPower > 0) {
          res += 'ล้าน'.repeat(millionsPower);
        }
      }
    }
    return res;
  }

  let text = '';
  const intText = readInteger(integerPart);
  text += intText ? intText + 'บาท' : '';

  const decVal = parseInt(decimalPart, 10);
  if (decVal === 0) {
    text += 'ถ้วน';
  } else {
    text += readGroup(decimalPart) + 'สตางค์';
  }

  return (isNegative ? 'ลบ' : '') + text;
}
