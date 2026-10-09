export const normalizeImportCellValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return JSON.stringify(value);
};

export const parseFlexibleDateTime = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoMatch) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  const dmyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw = '00', minute = '00', second = '00'] = dmyMatch;
    const day = dayRaw.padStart(2, '0');
    const month = monthRaw.padStart(2, '0');
    const yearNumber = Number(yearRaw);
    const year = String(yearNumber > 2400 ? yearNumber - 543 : yearNumber).padStart(4, '0');
    const hour = hourRaw.padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  const dmyDashMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyDashMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw = '00', minute = '00', second = '00'] = dmyDashMatch;
    const day = dayRaw.padStart(2, '0');
    const month = monthRaw.padStart(2, '0');
    const yearNumber = Number(yearRaw);
    const year = String(yearNumber > 2400 ? yearNumber - 543 : yearNumber).padStart(4, '0');
    const hour = hourRaw.padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  const thaiBuddhaMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ]+(\d{1,2}):(\d{2}))?$/);
  if (thaiBuddhaMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw = '00', minute = '00'] = thaiBuddhaMatch;
    const yearNumber = Number(yearRaw);
    const year = String(yearNumber > 2400 ? yearNumber - 543 : yearNumber).padStart(4, '0');
    return `${year}-${monthRaw.padStart(2, '0')}-${dayRaw.padStart(2, '0')} ${hourRaw.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
  }

  const thaiMonths: Record<string, string> = {
    'มกราคม': '01', 'กุมภาพันธ์': '02', 'มีนาคม': '03', 'เมษายน': '04',
    'พฤษภาคม': '05', 'มิถุนายน': '06', 'กรกฎาคม': '07', 'สิงหาคม': '08',
    'กันยายน': '09', 'ตุลาคม': '10', 'พฤศจิกายน': '11', 'ธันวาคม': '12',
    'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04',
    'พ.ค.': '05', 'มิ.ย.': '06', 'ก.ค.': '07', 'ส.ค.': '08',
    'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12',
  };
  const thaiTextMatch = text.match(/(?:วันที่\s*)?(\d{1,2})\s+([^\s\d]+)\s+(\d{4})(?:\s+(?:เวลา\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*น\.?)?)?/);
  if (thaiTextMatch) {
    const [, d, mName, yStr, h = '00', min = '00', s = '00'] = thaiTextMatch;
    const m = thaiMonths[mName];
    if (m) {
      let year = Number(yStr);
      if (year > 2400) year -= 543;
      return `${String(year).padStart(4, '0')}-${m}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${min.padStart(2, '0')}:${s.padStart(2, '0')}`;
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
  }

  return null;
};

export const formatTrackingDateTime = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!text || text === 'Invalid Date') return null;
  return text.replace('T', ' ').slice(0, 19);
};

export const latestTrackingDateTime = (...values: Array<unknown>): string | null => {
  const dates = values
    .map(formatTrackingDateTime)
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
};
