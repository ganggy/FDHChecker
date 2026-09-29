import * as XLSX from 'xlsx';
import type { RepstmImportType } from './repstmImportClassification';

type ImportType = RepstmImportType;

const normalizeHeaderCell = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const collectRowHeaders = (rows: Record<string, unknown>[], preferred: string[] = []) => {
  const seen = new Set<string>();
  const headers: string[] = [];
  [...preferred, ...rows.slice(0, 100).flatMap((row) => Object.keys(row))].forEach((header) => {
    const normalized = String(header || '').trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      headers.push(normalized);
    }
  });
  return headers;
};

const isLikelyHeaderRow = (row: unknown[], hintType?: ImportType | null) => {
  const cells = row.map(normalizeHeaderCell).filter(Boolean);
  if (cells.length < 3) return false;
  const joined = cells.join(' | ').toUpperCase();

  // REP header signals
  const repSignals = ['HN', 'AN', 'PID', 'TRAN_ID', 'ชื่อ - สกุล', 'ประเภทผู้ป่วย', 'วันเข้ารักษา', 'ชดเชยสุทธิ'];
  if (repSignals.filter((s) => joined.includes(s.toUpperCase())).length >= 3) return true;

  // STM header signals (STMT_PERIOD / PERIOD / HOSPCODE from Auto4Rep.EXE)
  if (hintType !== 'INV') {
    const stmSignals = ['PERIOD', 'STMT_PERIOD', 'HOSPCODE', 'HCODE', 'INCOME', 'MONEY', 'CLAIMTYPE', 'PAIDTYPE', 'REP_INCOME', 'REP_MONEY', 'ECLAIM_MONEY'];
    if (stmSignals.filter((s) => joined.includes(s)).length >= 3) return true;
    const kidneySignals = ['งวด', 'HN', 'เลขบัตรประชาชน', 'วันที่ฟอกเลือด', 'จ่ายชดเชยสุทธิ'];
    if (kidneySignals.filter((s) => joined.includes(s.toUpperCase())).length >= 3) return true;
  }

  // INV header signals
  if (hintType !== 'STM') {
    const invSignals = ['INVOICE', 'INVOICENO', 'PERIOD', 'INCOME', 'MONEY', 'HOSPCODE', 'ECLAIM_MONEY'];
    if (invSignals.filter((s) => joined.includes(s)).length >= 3) return true;
  }

  return false;
};

const buildHeadersFromRows = (headerRow: unknown[], nextRow?: unknown[]) => {
  return headerRow.map((cell, index) => {
    const primary = normalizeHeaderCell(cell);
    const secondary = normalizeHeaderCell(nextRow?.[index]);
    if (primary && secondary) return `${primary} ${secondary}`.trim();
    return primary || secondary || `column_${index + 1}`;
  });
};

const isLikelyDataRecord = (row: Record<string, unknown>, hintType?: ImportType | null) => {
  const keys = Object.keys(row);
  const normalized = Object.fromEntries(
    keys.map((key) => [key.trim().toLowerCase(), normalizeHeaderCell(row[key])])
  ) as Record<string, string>;

  if (hintType === 'STM') {
    // STM rows: must have a 6-digit period (YYYYMM) or numeric income/money values
    const hasPeriod = Object.values(normalized).some((v) => /^\d{6}$/.test(v));
    const hasNumericField = Object.values(normalized).some((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0);
    const filledCount = Object.values(normalized).filter(Boolean).length;
    return (hasPeriod || hasNumericField) && filledCount >= 2;
  }

  if (hintType === 'INV') {
    // INV rows: invoice number or period, plus a few filled cells
    const hasInvoice = !!(normalized['invoiceno'] || normalized['invoice_no'] || normalized['invoice no'] || normalized['invoice'] || normalized['เลขที่ใบแจ้งหนี้']);
    const hasPeriod = Object.values(normalized).some((v) => /^\d{6}$/.test(v));
    const filledCount = Object.values(normalized).filter(Boolean).length;
    const patientSignals = [normalized['tran_id'], normalized['hn'], normalized['an'], normalized['pid'], normalized['ชื่อ - สกุล'], normalized['วันเข้ารักษา']]
      .filter(Boolean).length;
    const hasNetAmount = Object.entries(normalized).some(([field, value]) =>
      /ชดเชยสุทธิ|ยอดรับสุทธิ|ยอดเงิน|paid|amount/i.test(field)
      && Number(value.replace(/,/g, '')) !== 0
      && Number.isFinite(Number(value.replace(/,/g, '')))
    );
    return (hasInvoice || hasPeriod || patientSignals >= 3 || hasNetAmount) && filledCount >= 3;
  }

  // REP - original logic
  const hasTranId = !!(normalized['tran_id'] || normalized['tran_id pp\\n(รับจาก สปสช.)']);
  const hasHn = !!normalized['hn'];
  const hasPid = !!normalized['pid'];
  const hasPatientName = !!normalized['ชื่อ - สกุล'];
  const hasPatientType = !!normalized['ประเภทผู้ป่วย'];
  const hasAdmitDate = !!normalized['วันเข้ารักษา'];

  const signalCount = [hasTranId, hasHn, hasPid, hasPatientName, hasPatientType, hasAdmitDate].filter(Boolean).length;
  return signalCount >= 3;
};

export const parseWorksheetRows = (worksheet: XLSX.WorkSheet, hintType?: ImportType | null) => {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });

  if (grid.length === 0) {
    return { headers: [] as string[], rows: [] as Record<string, unknown>[] };
  }

  const headerIndex = grid.findIndex((row) => Array.isArray(row) && isLikelyHeaderRow(row, hintType));
  const resolvedHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
  const headerRow = Array.isArray(grid[resolvedHeaderIndex]) ? grid[resolvedHeaderIndex] : [];
  const nextRow = Array.isArray(grid[resolvedHeaderIndex + 1]) ? grid[resolvedHeaderIndex + 1] : [];
  const singleHeaders = buildHeadersFromRows(headerRow);
  const singleRecord = Object.fromEntries(singleHeaders.map((header, index) => [header, nextRow[index] ?? '']));
  const nextRowIsData = isLikelyDataRecord(singleRecord, hintType);
  const headersWithIndexes = nextRowIsData
    ? singleHeaders
    : buildHeadersFromRows(headerRow, nextRow);
  const dataStartIndex = resolvedHeaderIndex + (nextRowIsData ? 1 : 2);
  const dataRows = grid
    .slice(dataStartIndex)
    .filter((row) => Array.isArray(row) && row.some((cell) => normalizeHeaderCell(cell)));
  const kidneyReport = hintType === 'STM' && headersWithIndexes.some((header) =>
    /วันที่ฟอกเลือดด้วยเครื่องไตเทียม|item_code\(\s*subfund\s*\)/i.test(header)
  );
  const hospitalMetadata = grid.slice(0, resolvedHeaderIndex).find((row) =>
    Array.isArray(row) && row.some((cell) => normalizeHeaderCell(cell).includes('รหัสหน่วยบริการ'))
  );
  const sourceHospitalCode = kidneyReport && Array.isArray(hospitalMetadata)
    ? hospitalMetadata.map(normalizeHeaderCell).find((cell) => /^\d{5}$/.test(cell)) || ''
    : '';
  const populatedColumns = new Array(headersWithIndexes.length).fill(false);
  for (const row of dataRows) {
    if (!Array.isArray(row)) continue;
    const width = Math.min(row.length, headersWithIndexes.length);
    for (let index = 0; index < width; index += 1) {
      if (!populatedColumns[index] && normalizeHeaderCell(row[index])) {
        populatedColumns[index] = true;
      }
    }
  }
  const activeColumnIndexes = headersWithIndexes
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => header && !header.startsWith('column_') && populatedColumns[index]);

  const headers = activeColumnIndexes.map(({ header }) => header);
  if (sourceHospitalCode && !headers.some((header) => /^hcode$/i.test(header))) {
    headers.push('HCode');
  }

  const rows = dataRows
    .map((row) => {
      const values = Array.isArray(row) ? row : [];
      const rowData = Object.fromEntries(activeColumnIndexes.map(({ header, index }) => [header, values[index] ?? '']));
      if (sourceHospitalCode && !Object.keys(rowData).some((key) => /^hcode$/i.test(key))) {
        rowData.HCode = sourceHospitalCode;
      }
      return rowData;
    })
    .filter((row) => isLikelyDataRecord(row, hintType));

  return { headers, rows };
};
