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
    const year = yearRaw.padStart(4, '0');
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
