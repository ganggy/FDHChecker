import { normalizeImportCellValue } from './dataNormalization.js';

export const normalizeImportHeader = (name: string) => name.normalize('NFKC').toLowerCase()
  .replace(/\s+/g, '').replace(/[._\-\\/()[\]{}:%]/g, '');
const identifierKeys = new Set(['an', 'vn', 'hn', 'pid', 'cid', 'seq', 'seqno', 'tranid', 'transactionuid', 'claimcode', 'uploaduid', 'hcode', 'hospcode']);

export function pickImportColumn(row: Record<string, unknown>, candidates: string[], exactOnly = false): string {
  const entries = Object.entries(row).map(([key, value]) => ({ key: normalizeImportHeader(key), value: normalizeImportCellValue(value) }));
  for (const candidate of candidates) {
    const match = entries.find(e => e.key === normalizeImportHeader(candidate));
    if (match?.value) return match.value;
  }
  if (!exactOnly) for (const candidate of candidates) {
    const key = normalizeImportHeader(candidate);
    // Short headers and identifiers must never match inside TRAN_ID, MAININSCL, etc.
    if (key.length <= 3 || identifierKeys.has(key)) continue;
    const match = entries.find(e => e.key.includes(key));
    if (match?.value) return match.value;
  }
  return '';
}
