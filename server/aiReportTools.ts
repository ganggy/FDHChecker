import { getUTFConnection } from './db.js';

export type OpdCountIntent = {
  kind: 'opd-count';
  date: string;
};

type OpdCountResult = {
  date: string;
  uniquePatients: number;
  visits: number;
};

const bangkokIsoDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const validIsoDate = (year: number, month: number, day: number) => {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year
    || value.getUTCMonth() + 1 !== month
    || value.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const extractRequestedDate = (question: string, now: Date) => {
  if (/เมื่อวาน/.test(question)) {
    return bangkokIsoDate(new Date(now.getTime() - 24 * 60 * 60_000));
  }

  const iso = question.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = question.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (slash) {
    const suppliedYear = Number(slash[3]);
    const year = suppliedYear >= 2400 ? suppliedYear - 543 : suppliedYear;
    return validIsoDate(year, Number(slash[2]), Number(slash[1]));
  }

  return bangkokIsoDate(now);
};

export const parsePatientReportIntent = (
  question: string,
  now = new Date(),
): OpdCountIntent | null => {
  const normalized = question.trim().toLowerCase();
  const asksAboutOpd = /\bopd\b|ผู้ป่วยนอก|คนไข้นอก/.test(normalized);
  const asksForCount = /กี่คน|จำนวน|ทั้งหมด|ยอดรวม|เท่าไหร่|เท่าไร/.test(normalized);
  if (!asksAboutOpd || !asksForCount) return null;

  const date = extractRequestedDate(normalized, now);
  return date ? { kind: 'opd-count', date } : null;
};

export const getOpdCount = async (date: string): Promise<OpdCountResult> => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         COUNT(DISTINCT NULLIF(TRIM(hn), '')) AS unique_patients,
         COUNT(DISTINCT NULLIF(TRIM(vn), '')) AS visits
       FROM ovst
       WHERE vstdate = ?`,
      [date],
    );
    const row = (rows as Array<Record<string, unknown>>)[0] || {};
    return {
      date,
      uniquePatients: Number(row.unique_patients || 0),
      visits: Number(row.visits || 0),
    };
  } finally {
    connection.release();
  }
};

const thaiDate = (date: string) => new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  dateStyle: 'long',
}).format(new Date(`${date}T12:00:00+07:00`));

export const formatOpdCountAnswer = (result: OpdCountResult) => {
  if (!result.visits) {
    return `วันที่ ${thaiDate(result.date)} ยังไม่พบผู้รับบริการ OPD ใน HOSxP`;
  }
  if (result.uniquePatients === result.visits) {
    return `วันที่ ${thaiDate(result.date)} มีผู้รับบริการ OPD ${result.uniquePatients.toLocaleString('th-TH')} คน (${result.visits.toLocaleString('th-TH')} VN)`;
  }
  return `วันที่ ${thaiDate(result.date)} มีผู้รับบริการ OPD ${result.uniquePatients.toLocaleString('th-TH')} คน รวม ${result.visits.toLocaleString('th-TH')} ครั้งรับบริการ (VN)`;
};

export const answerPatientReportQuestion = async (intent: OpdCountIntent) => {
  if (intent.kind === 'opd-count') return formatOpdCountAnswer(await getOpdCount(intent.date));
  return null;
};
