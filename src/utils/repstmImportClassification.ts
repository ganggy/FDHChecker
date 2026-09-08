export type RepstmImportType = 'REP' | 'STM' | 'INV';

const normalizeHeader = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const SHEET_TYPE_MAP: Record<string, RepstmImportType> = {
  statement: 'STM', stm: 'STM',
  eclaim: 'REP', repdata: 'REP', repeclaim: 'REP', individual: 'REP', detail: 'REP', rep: 'REP',
  invoice: 'INV', inv: 'INV',
};

export const detectTypeFromSheetName = (sheetName: string): RepstmImportType | null => {
  const normalized = sheetName.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, type] of Object.entries(SHEET_TYPE_MAP)) {
    if (normalized === key || normalized.startsWith(key)) return type;
  }
  return null;
};

export const detectTypeFromFileName = (fileName: string): RepstmImportType | null => {
  const name = fileName.trim().toLowerCase().split(' [')[0];
  // NHSO/BMS names the visit-level response eclaim_*. It is REP even when the
  // workbook also contains an empty Invoice column.
  if (/^(?:rep[_-])?eclaim[_-]/.test(name)) return 'REP';
  if (/(^|[_\s.-])inv(?=[_\s.-]|$)|invoice/.test(name)) return 'INV';
  if (/cocdstm|(^|[_\s.-])stm(?=[_\s.-]|$)|statement/.test(name)) return 'STM';
  if (/(^|[_\s.-])rep(?=[_\s.-]|$)|repdata/.test(name)) return 'REP';
  return null;
};

const hasPopulatedInvoice = (rows: Record<string, unknown>[]) => rows.slice(0, 25).some((row) => (
  Object.entries(row).some(([key, value]) => {
    const normalizedKey = normalizeHeader(key).replace(/[\s_.-]/g, '');
    const isInvoiceField = normalizedKey.includes('invoice') || normalizedKey.includes('เลขที่ใบแจ้งหนี้');
    return isInvoiceField && String(value ?? '').trim() !== '';
  })
));

export const detectRepstmImportType = (
  fileName: string,
  headers: string[],
  rows: Record<string, unknown>[],
): RepstmImportType | null => {
  const filenameType = detectTypeFromFileName(fileName);

  // These source names are authoritative. In particular, eclaim_* is a REP
  // response and must not become INV merely because it carries an Invoice field.
  if (filenameType) return filenameType;

  const normalizedHeaders = headers.map(normalizeHeader);
  const firstRowKeys = Object.keys(rows[0] || {}).map(normalizeHeader);
  const bag = `${normalizedHeaders.join(' | ')} | ${firstRowKeys.join(' | ')}`;

  const repSignalCount = ['tran_id', 'hn', 'an', 'pid', 'ชื่อ - สกุล', 'วันเข้ารักษา', 'ชดเชยสุทธิ', 'พึงรับ']
    .filter((signal) => bag.includes(signal)).length;
  if (repSignalCount >= 3) return 'REP';

  if (bag.includes('statement') || bag.includes('stmt_period') || bag.includes('stm_period') || bag.includes('hospcode')) {
    return 'STM';
  }

  const hasInvoiceHeader = bag.includes('invoice') || bag.includes('เลขที่ใบแจ้งหนี้') || bag.includes('invoiceno');
  if (hasInvoiceHeader && hasPopulatedInvoice(rows)) return 'INV';

  return null;
};
