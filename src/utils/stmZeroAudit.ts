export type ZeroAction = 'review' | 'approval' | 'appeal' | 'deferred' | 'correction' | 'paid';
export interface StmZeroRow {
  id: string; batch_id: number; source_filename: string; sheet_name: string;
  row_no: number | null; statement_no: string; tran_id: string;
  hn: string; vn: string; an: string; patient_name: string; service_date: string;
  encounter_type?: 'OP' | 'IP' | 'UNKNOWN';
  maininscl: string; errorcode: string; verifycode: string;
  amount: number | null; paid_amount: number | null; raw_data: Record<string, unknown>;
  matched: boolean; has_payment: boolean; payment_uncertain?: boolean; action: ZeroAction; reason: string;
  fdh_sent_today?: boolean;
  last_fdh_sent_at?: string | null;
  fdh_status_message?: string | null;
  fdh_transaction_uid?: string | null;
}
export const ZERO_ACTION_LABELS: Record<ZeroAction, string> = {
  review: 'ตรวจเหตุผลก่อน', approval: 'ตรวจการอนุมัติ SMCS', appeal: 'ตรวจสิทธิทักท้วง OSR',
  deferred: 'ตรวจรอบจ่ายกองทุน', correction: 'ตรวจการเปิดแก้ไขส่งใหม่', paid: 'พบยอดจ่ายใน Visit เดียวกัน',
};
export const isExplicitZero = (value: unknown): boolean => value != null && String(value).trim() !== ''
  && Number.isFinite(Number(value)) && Number(value) === 0;
export const parseOriginalRow = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') { try { return parseOriginalRow(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
};
export const originalPaidAmount = (raw: Record<string, unknown>): number | null => {
  const keys = ['paid', 'paid_amount', 'net_paid', 'net_amount', 'ยอดชำระ', 'ยอดรับสุทธิ', 'ยอดเงินสุทธิ',
    'ชดเชยสุทธิ', 'จ่ายชดเชย', 'จ่ายชดเชยสุทธิ', 'ยอดชดเชยสุทธิ', 'ยอดชดเชยทั้งสิ้น', 'ยอดชดเชยหลังหักเงินเดือน',
    'จ่ายชดเชยหลังหัก พรบ.และเงินเดือน', 'พึงรับ', 'พึงรับทั้งหมด', 'เงินที่จ่าย', 'จำนวนเงินที่จ่าย'];
  for (const key of keys) {
    const entry = Object.entries(raw).find(([name]) => name.trim().toLowerCase() === key);
    if (entry && entry[1] != null && String(entry[1]).trim() !== '') {
      const value = Number(String(entry[1]).replace(/,/g, ''));
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
};
export const resolveUniqueRepVisit = (hn: string, tranId: string, records: Array<Record<string, unknown>>): { vn: string; an: string } | null => {
  if (!hn || !tranId) return null;
  const keys = [...new Set(records.filter(p => String(p.tran_id ?? '') === tranId && String(p.hn ?? '').trim() === hn)
    .map(p => String(p.an ?? '').trim() && String(p.an).trim() !== tranId ? `an:${String(p.an).trim()}` : String(p.vn ?? '').trim() && String(p.vn).trim() !== tranId ? `vn:${String(p.vn).trim()}` : '').filter(Boolean))];
  if (keys.length !== 1) return null;
  return keys[0].startsWith('an:') ? { an: keys[0].slice(3), vn: '' } : { vn: keys[0].slice(3), an: '' };
};
// Guidance only: the official system and current fund rules determine permission to resend.
export const classifyZeroAction = (row: Pick<StmZeroRow, 'has_payment' | 'errorcode' | 'verifycode' | 'maininscl' | 'raw_data'>): ZeroAction => {
  if (row.has_payment) return 'paid';
  const codes = `${row.errorcode} ${row.verifycode} ${Object.values(row.raw_data).filter(v => typeof v === 'string').join(' ')}`.toUpperCase();
  if (/\b[WD]305\b/.test(codes)) return 'approval';
  if (/\bD0(?:01|10|12|13)\b/.test(codes)) return 'appeal';
  if (/\bD011\b/.test(codes)) return 'correction';
  if (/\bHERB_GB\b/.test(`${row.maininscl} ${codes}`)) return 'deferred';
  return 'review';
};
export const canPrepareZeroResend = (row: StmZeroRow): boolean => row.matched && !row.has_payment && !row.payment_uncertain
  && isExplicitZero(row.paid_amount) && (row.action === 'review' || row.action === 'correction');

export const canPrepareRepSheetZeroResend = (row: StmZeroRow): boolean =>
  row.matched && Boolean(row.vn || row.an);
