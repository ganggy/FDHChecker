import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  analyzeRepstmArchiveFile,
  fetchRcmdbData,
  fetchRepstmBatchDetail,
  fetchRepstmBatches,
  importRepstmData,
  preflightRepstmFiles,
} from '../services/hosxpService';
import { navigateFromDashboard } from '../utils/navigationState';
import { RepStmImportDetail } from '../components/RepStmImportDetail';

type ImportType = 'REP' | 'STM' | 'INV';

interface ImportBatch {
  id: number;
  data_type: ImportType;
  source_filename: string;
  sheet_name?: string;
  is_subfile?: number | boolean;
  imported_by?: string;
  row_count: number;
  notes?: string;
  replaces_batch_id?: number | null;
  completeness_score?: number;
  distinct_record_count?: number;
  created_at: string;
}

interface ImportedRow {
  id: number;
  batch_id: number;
  rep_no?: string;
  seq_no?: number;
  tran_id?: string;
  hcode?: string;
  row_no: number;
  ref_key?: string;
  hn?: string;
  vn?: string;
  an?: string;
  pid?: string;
  patient_name?: string;
  department?: string;
  amount?: number;
  income?: number;
  compensated?: number;
  diff?: number;
  service_date?: string;
  source_filename?: string;
  raw_data: Record<string, unknown> | string;
  created_at: string;
}

type QueueStatus = 'parsing' | 'ready' | 'importing' | 'success' | 'duplicate' | 'error';

interface ImportQueueItem {
  id: string;
  file: File;
  fileName: string;
  fileHash?: string;
  fileSize?: number;
  relativePath?: string;
  detectedType?: ImportType;
  sheetName: string;
  isSubfile?: boolean;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  status: QueueStatus;
  progress?: number;
  message?: string;
  importerId?: string;
  importerLabel?: string;
  summary?: Record<string, unknown>;
  archiveSummaries?: Record<string, unknown>[];
  archiveEntries?: Array<{ name: string; size: number; kind: string }>;
  sourceEntryName?: string;
}

interface DetailViewState {
  title: string;
  subtitle?: string;
  importerType?: ImportType;
  importerLabel?: string;
  headers: string[];
  rows: Record<string, unknown>[];
  summaries?: Record<string, unknown>[];
  archiveEntries?: Array<{ name: string; size: number; kind: string }>;
}

type EclaimPipelineStatus = 'downloading' | 'downloaded' | 'importing' | 'success' | 'duplicate' | 'error';

interface EclaimPipelineState {
  status: EclaimPipelineStatus;
  message: string;
}

/** Sheet-name → ImportType map (from Auto4Rep.EXE analysis) */
const SHEET_TYPE_MAP: Record<string, ImportType> = {
  statement: 'STM', stm: 'STM',
  eclaim: 'REP', repdata: 'REP', repeclaim: 'REP', individual: 'REP', detail: 'REP', rep: 'REP',
  invoice: 'INV', inv: 'INV',
};

const detectTypeFromSheetName = (sheetName: string): ImportType | null => {
  const normalized = sheetName.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, type] of Object.entries(SHEET_TYPE_MAP)) {
    if (normalized === key || normalized.startsWith(key)) return type;
  }
  return null;
};

const detectTypeFromFileName = (fileName: string): ImportType | null => {
  const name = fileName.trim().toLowerCase();
  // ไฟล์ผลตอบกลับจาก BMS/NHSO ใช้ชื่อ eclaim_* แต่มีข้อมูลระดับ visit แบบ REP
  if (/^eclaim[_-]/.test(name)) return 'REP';
  if (/(^|[_\s.-])inv(?=[_\s.-]|$)|invoice/.test(name)) return 'INV';
  if (/cocdstm|(^|[_\s.-])stm(?=[_\s.-]|$)|statement/.test(name)) return 'STM';
  if (/(^|[_\s.-])rep(?=[_\s.-]|$)|repdata/.test(name)) return 'REP';
  return null;
};

const getEclaimFileKey = (file: Record<string, unknown>, index = 0) => [
  String(file.period || file._period || ''),
  String(file.filename || file.fileName || file.name || ''),
  String(file.downloadHref || ''),
  String(file.downloadOnclick || ''),
  String(index),
].join('|');

const detectImportType = (fileName: string, headers: string[], rows: Record<string, unknown>[]): ImportType | null => {
  const normalizedHeaders = headers.map((header) => normalizeHeaderCell(header).toLowerCase());
  const firstRowKeys = Object.keys(rows[0] || {}).map((key) => normalizeHeaderCell(key).toLowerCase());
  const bag = `${normalizedHeaders.join(' | ')} | ${firstRowKeys.join(' | ')}`;

  // ใช้โครงสร้างข้อมูลภายในไฟล์ก่อนชื่อไฟล์ เพื่อไม่ให้ REP/INV ปะปนกัน
  if (bag.includes('invoice') || bag.includes('เลขที่ใบแจ้งหนี้') || bag.includes('invoiceno')) {
    return 'INV';
  }

  const repSignalCount = ['tran_id', 'hn', 'an', 'pid', 'ชื่อ - สกุล', 'วันเข้ารักษา', 'ชดเชยสุทธิ', 'พึงรับ']
    .filter((signal) => bag.includes(signal)).length;
  if (repSignalCount >= 3) return 'REP';

  if (bag.includes('statement') || bag.includes('stmt_period') || bag.includes('stm_period') || bag.includes('hospcode')) {
    return 'STM';
  }

  // ชื่อไฟล์เป็น fallback เมื่อหัวตารางไม่มีสัญญาณเฉพาะเพียงพอ
  return detectTypeFromFileName(fileName);
};

const yieldToBrowser = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const statusLabelMap: Record<QueueStatus, string> = {
  parsing: 'กำลังอ่านไฟล์',
  ready: 'พร้อมนำเข้า',
  importing: 'กำลังนำเข้า',
  success: 'สำเร็จ',
  duplicate: 'ข้าม/เข้าแล้ว',
  error: 'ผิดพลาด',
};

const statusPercentMap: Record<QueueStatus, number> = {
  parsing: 20,
  ready: 40,
  importing: 75,
  success: 100,
  duplicate: 100,
  error: 100,
};

const statusColorMap: Record<QueueStatus, string> = {
  parsing: 'linear-gradient(90deg, #60a5fa, #38bdf8)',
  ready: 'linear-gradient(90deg, #34d399, #22c55e)',
  importing: 'linear-gradient(90deg, #f59e0b, #fb7185)',
  success: 'linear-gradient(90deg, #16a34a, #22c55e)',
  duplicate: 'linear-gradient(90deg, #64748b, #94a3b8)',
  error: 'linear-gradient(90deg, #ef4444, #f97316)',
};

const normalizeHeaderCell = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

const collectRowHeaders = (rows: Record<string, unknown>[], preferred: string[] = []) => {
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

const parseWorksheetRows = (worksheet: XLSX.WorkSheet, hintType?: ImportType | null) => {
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

  const rows = dataRows
    .map((row) => {
      const values = Array.isArray(row) ? row : [];
      return Object.fromEntries(activeColumnIndexes.map(({ header, index }) => [header, values[index] ?? '']));
    })
    .filter((row) => isLikelyDataRecord(row, hintType));

  return { headers, rows };
};

interface ParsedSheet {
  sheetName: string;
  rows: Record<string, unknown>[];
  headers: string[];
  hintType: ImportType | null;
  isSubfile: boolean;
  importerId?: string;
  importerLabel?: string;
  summary?: Record<string, unknown>;
  archiveSummaries?: Record<string, unknown>[];
  archiveEntries?: Array<{ name: string; size: number; kind: string }>;
  sourceEntryName?: string;
}

/** Scans all sheets in a workbook; returns one ParsedSheet per sheet that has data.
 *  Priority sheet names (from Auto4Rep.EXE) are checked first. */
const readWorkbook = async (
  file: File,
  includeSubfiles = false,
  sourceBuffer?: ArrayBuffer,
  onProgress?: (progress: number, message: string) => void,
): Promise<ParsedSheet[]> => {
  const buffer = sourceBuffer ?? await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  onProgress?.(44, `เปิดไฟล์แล้ว พบ ${workbook.SheetNames.length.toLocaleString()} Sheet`);
  await yieldToBrowser();
  const fileHint = detectTypeFromFileName(file.name);

  const priorityNames = ['statement', 'eclaim', 'invoice', 'individual', 'detail', 'repdata', 'repeclaim'];
  const ordered = [
    ...workbook.SheetNames.filter((s) => priorityNames.some((p) => s.toLowerCase().replace(/[^a-z]/g, '') === p || s.toLowerCase().replace(/[^a-z]/g, '').startsWith(p))),
    ...workbook.SheetNames.filter((s) => !priorityNames.some((p) => s.toLowerCase().replace(/[^a-z]/g, '') === p || s.toLowerCase().replace(/[^a-z]/g, '').startsWith(p))),
  ];

  const results: ParsedSheet[] = [];
  for (let sheetIndex = 0; sheetIndex < ordered.length; sheetIndex += 1) {
    const sheetName = ordered[sheetIndex];
    const progress = 45 + Math.round(((sheetIndex + 1) / Math.max(ordered.length, 1)) * 12);
    onProgress?.(progress, `กำลังอ่าน Sheet ${sheetIndex + 1}/${ordered.length}: ${sheetName}`);
    await yieldToBrowser();
    // ใช้ชนิดจากชื่อไฟล์เป็น hint สำหรับหา header เท่านั้น แล้วตรวจชนิดจริงจาก header อีกครั้ง
    const hintType = fileHint || detectTypeFromSheetName(sheetName);
    const parsed = parseWorksheetRows(workbook.Sheets[sheetName], hintType);
    if (parsed.rows.length > 0) {
      results.push({ sheetName, rows: parsed.rows, headers: parsed.headers, hintType, isSubfile: false });
    }
  }

  const isSupplementarySheet = (sheetName: string, hintType: ImportType | null) => {
    const compact = sheetName.toLowerCase().replace(/\s+/g, ' ').trim();
    if (/^data\b/.test(compact)) return true;
    if (hintType === 'STM' && (compact.includes('อุทธรณ์') || compact.includes('ผู้พิการ d1'))) return true;
    return false;
  };
  const classifiedResults = results.map((item) => ({
    ...item,
    isSubfile: isSupplementarySheet(item.sheetName, item.hintType),
  }));
  const primaryResults = classifiedResults.filter(({ sheetName, hintType, isSubfile }) => {
    if (isSubfile) return false;
    const compact = sheetName.toLowerCase().replace(/\s+/g, ' ').trim();
    if (hintType === 'REP') return /^(detail|individual|eclaim|repdata|repeclaim)$/.test(compact) || compact.includes('รายละเอียด');
    if (hintType === 'STM') return compact.includes('รายละเอียด') || compact === 'พึงรับ' || compact === 'statement';
    if (hintType === 'INV') return /^(detail|individual|eclaim|inv|invoice)$/.test(compact) || compact.includes('รายละเอียด');
    return false;
  });
  if (primaryResults.length > 0) {
    return includeSubfiles
      ? [...primaryResults, ...classifiedResults.filter((item) => item.isSubfile)]
      : primaryResults;
  }

  // Fallback: try first sheet without a hint if nothing matched
  if (results.length === 0 && workbook.SheetNames.length > 0) {
    const firstSheet = workbook.SheetNames[0];
    const parsed = parseWorksheetRows(workbook.Sheets[firstSheet], null);
    if (parsed.rows.length > 0) {
      results.push({ sheetName: firstSheet, rows: parsed.rows, headers: parsed.headers, hintType: null, isSubfile: false });
    }
  }

  return results;
};

const readImportSource = async (
  file: File,
  includeSubfiles = false,
  sourceBuffer?: ArrayBuffer,
  onProgress?: (progress: number, message: string) => void,
): Promise<ParsedSheet[]> => {
  if (!/\.zip$/i.test(file.name)) return readWorkbook(file, includeSubfiles, sourceBuffer, onProgress);
  onProgress?.(42, 'กำลังส่ง ZIP ไปวิเคราะห์โครงสร้างและข้อมูล');
  await yieldToBrowser();
  const archive = await analyzeRepstmArchiveFile(file);
  return archive.datasets.map((dataset) => ({
    sheetName: dataset.sheetName,
    rows: dataset.rows,
    headers: dataset.headers,
    hintType: dataset.detectedType,
    isSubfile: false,
    importerId: dataset.importerId,
    importerLabel: dataset.importerLabel,
    summary: dataset.summary,
    archiveSummaries: archive.summaries,
    archiveEntries: archive.entries,
    sourceEntryName: dataset.entryName,
  }));
};

export const RepStmImportPage: React.FC = () => {
  const [dataType, setDataType] = useState<ImportType>('REP');
  const [importedBy, setImportedBy] = useState('เปรมศักดิ์ เทพวงสา');
  const [notes, setNotes] = useState('');
  const [includeSubfiles, setIncludeSubfiles] = useState(false);
  const [queueItems, setQueueItems] = useState<ImportQueueItem[]>([]);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [detailView, setDetailView] = useState<DetailViewState | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // NHSO eclaim download state
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const [eclaimOpen, setEclaimOpen] = useState(false);
  const [eclaimStartDate, setEclaimStartDate] = useState(firstOfMonth);
  const [eclaimEndDate, setEclaimEndDate] = useState(todayStr);
  const [eclaimFileType, setEclaimFileType] = useState<'STM' | 'INV' | 'ALL'>('ALL');
  const [eclaimBrowserLoading, setEclaimBrowserLoading] = useState(false);
  const [eclaimBrowserReady, setEclaimBrowserReady] = useState(false);
  const [eclaimBrowserAlive, setEclaimBrowserAlive] = useState(false);
  const [eclaimBrowserPhase, setEclaimBrowserPhase] = useState('closed');
  const [eclaimBrowserMessage, setEclaimBrowserMessage] = useState('ยังไม่ได้เริ่ม Login ThaID');
  const [eclaimScreenshotVersion, setEclaimScreenshotVersion] = useState(0);
  const [eclaimLoading, setEclaimLoading] = useState(false);
  const [eclaimError, setEclaimError] = useState<string | null>(null);
  const [eclaimFiles, setEclaimFiles] = useState<Record<string, unknown>[]>([]);
  const [eclaimSelected, setEclaimSelected] = useState<Set<string>>(new Set());
  const [eclaimDownloading, setEclaimDownloading] = useState(false);
  const [eclaimAutoDownload, setEclaimAutoDownload] = useState(true);
  const [eclaimAutoImport, setEclaimAutoImport] = useState(true);
  const [eclaimPipeline, setEclaimPipeline] = useState<Record<string, EclaimPipelineState>>({});
  const [eclaimDebugLog, setEclaimDebugLog] = useState<{ period: string; url: string; title: string; rowCount: number; htmlSnippet: string }[]>([]);
  const [eclaimShowDebug, setEclaimShowDebug] = useState(false);

  /** Returns all YYYYMM periods between two ISO date strings (inclusive) */
  const getPeriodsInRange = (startDate: string, endDate: string): string[] => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
    const periods: string[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= last) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      periods.push(`${y}${m}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return periods;
  };

  const eclaimPeriods = useMemo(
    () => getPeriodsInRange(eclaimStartDate, eclaimEndDate),
    [eclaimStartDate, eclaimEndDate]
  );

  const activePreview = useMemo(
    () => queueItems.find((item) => item.id === activePreviewId) || queueItems.find((item) => item.status !== 'error') || null,
    [activePreviewId, queueItems]
  );
  const previewRows = useMemo(() => activePreview?.rows || [], [activePreview]);
  const previewHeaders = useMemo(
    () => (activePreview?.headers?.length ? activePreview.headers : Object.keys(previewRows[0] || {})),
    [activePreview, previewRows]
  );
  const latestHeaders = useMemo(() => {
    const raw = rows[0]?.raw_data;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.keys(raw);
  }, [rows]);

  const isRepType = dataType === 'REP';
  const readyItems = queueItems.filter((item) => item.status === 'ready');
  const successItems = queueItems.filter((item) => item.status === 'success');
  const duplicateItems = queueItems.filter((item) => item.status === 'duplicate');
  const errorItems = queueItems.filter((item) => item.status === 'error');
  const importingItems = queueItems.filter((item) => item.status === 'importing');
  const overallProgress = useMemo(() => {
    if (queueItems.length === 0) return 0;
    const total = queueItems.reduce(
      (sum, item) => sum + (item.progress ?? statusPercentMap[item.status]),
      0,
    );
    return Math.round(total / queueItems.length);
  }, [queueItems]);
  const typeSummary = useMemo(() => {
    return queueItems.reduce<Record<ImportType, number>>((acc, item) => {
      if (item.detectedType) acc[item.detectedType] += 1;
      return acc;
    }, { REP: 0, STM: 0, INV: 0 });
  }, [queueItems]);

  const loadData = async (type: ImportType) => {
    try {
      setLoadingRows(true);
      setLoadingBatches(true);
      const [batchData, rowData] = await Promise.all([
        fetchRepstmBatches(type, 10),
        fetchRcmdbData(type),
      ]);
      setBatches(batchData || []);
      setRows((rowData?.data || rowData || []) as ImportedRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล REP/STM/INV');
    } finally {
      setLoadingRows(false);
      setLoadingBatches(false);
    }
  };

  useEffect(() => {
    void loadData(dataType);
  }, [dataType]);

  // Probe saved settings once so the backend connection is warmed up for browser-based login.
  useEffect(() => {
    fetch('/api/config/nhso-eclaim-settings')
      .then((r) => r.json())
      .then(() => undefined)
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    if (!eclaimOpen) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await fetch('/api/nhso-eclaim/browser-status', { cache: 'no-store' });
        const status = await response.json() as {
          alive?: boolean; ready?: boolean; phase?: string; message?: string; error?: string | null;
        };
        if (!active) return;
        setEclaimBrowserAlive(Boolean(status.alive));
        setEclaimBrowserReady(Boolean(status.ready));
        setEclaimBrowserPhase(String(status.phase || 'closed'));
        setEclaimBrowserMessage(String(status.message || ''));
        if (status.error) setEclaimError(status.error);
        if (status.ready || ['closed', 'expired', 'error'].includes(String(status.phase || ''))) {
          setEclaimBrowserLoading(false);
        }
        if (status.alive && !status.ready) setEclaimScreenshotVersion(Date.now());
      } catch { /* backend may be restarting */ }
    };
    void pollStatus();
    const timer = window.setInterval(() => void pollStatus(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [eclaimOpen]);

  const resetQueue = () => {
    setQueueItems([]);
    setActivePreviewId(null);
    setError(null);
    setSuccessMessage(null);
  };

  const updateQueueItem = (id: string, updater: (item: ImportQueueItem) => ImportQueueItem) => {
    setQueueItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  };

  const changeQueueImporter = (id: string, importerType: ImportType) => {
    updateQueueItem(id, (item) => ({
      ...item,
      detectedType: importerType,
      status: item.rows.length > 0 && item.status !== 'importing' && item.status !== 'success' ? 'ready' : item.status,
      message: item.rows.length > 0
        ? `เลือกตัวนำเข้า ${importerType} โดยผู้ใช้ · ${item.rows.length.toLocaleString()} แถวพร้อมนำเข้า`
        : item.message,
    }));
  };

  const openQueueDetail = (item: ImportQueueItem) => {
    setDetailLoading(false);
    setDetailError(null);
    setDetailView({
      title: item.fileName,
      subtitle: [item.relativePath, item.sheetName].filter(Boolean).join(' · '),
      importerType: item.detectedType,
      importerLabel: item.importerLabel,
      headers: collectRowHeaders(item.rows, item.headers),
      rows: item.rows,
      summaries: item.archiveSummaries || (item.summary ? [item.summary] : []),
      archiveEntries: item.archiveEntries,
    });
  };

  const openBatchDetail = async (batch: ImportBatch) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetailView({
      title: batch.source_filename,
      subtitle: `Batch #${batch.id} · ${batch.sheet_name || 'ข้อมูลนำเข้า'}`,
      importerType: batch.data_type,
      headers: [],
      rows: [],
    });
    try {
      const detail = await fetchRepstmBatchDetail(batch.id);
      const detailRows = detail.rows.map((row) => ({
        'ลำดับ': row.row_no,
        ...(row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {}),
      }));
      setDetailView({
        title: String(detail.batch.source_filename || batch.source_filename),
        subtitle: `Batch #${batch.id} · ${String(detail.batch.sheet_name || batch.sheet_name || 'ข้อมูลนำเข้า')} · นำเข้าโดย ${String(detail.batch.imported_by || batch.imported_by || '-')}`,
        importerType: String(detail.batch.data_type || batch.data_type) as ImportType,
        headers: collectRowHeaders(detailRows),
        rows: detailRows,
      });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'อ่านรายละเอียด batch ไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleBrowserLogin = async () => {
    setEclaimError(null);
    setEclaimBrowserReady(false);
    setEclaimBrowserLoading(true);
    try {
      const res = await fetch('/api/nhso-eclaim/browser-login', { method: 'POST' });
      const json = await res.json() as { success: boolean; ready?: boolean; phase?: string; message?: string; error?: string };
      if (!json.success) throw new Error(json.error || 'Login ไม่สำเร็จ');
      setEclaimBrowserAlive(true);
      setEclaimBrowserPhase(String(json.phase || 'waiting_thaid'));
      setEclaimBrowserMessage(String(json.message || 'สแกน QR ด้วยแอป ThaID'));
      setEclaimScreenshotVersion(Date.now());
    } catch (err) {
      setEclaimError((err as Error).message);
      setEclaimBrowserLoading(false);
    }
  };

  const handleThaIdSelect = async () => {
    setEclaimError(null);
    try {
      const response = await fetch('/api/nhso-eclaim/browser-thaid', { method: 'POST' });
      const json = await response.json() as { success?: boolean; message?: string; error?: string };
      setEclaimBrowserMessage(String(json.message || 'กรุณาสแกน QR ด้วยแอป ThaID'));
      if (!response.ok) throw new Error(json.error || 'เปิดหน้า ThaID ไม่สำเร็จ');
      setEclaimScreenshotVersion(Date.now());
    } catch (err) {
      setEclaimError(err instanceof Error ? err.message : 'เปิดหน้า ThaID ไม่สำเร็จ');
    }
  };

  const handleBrowserClose = async () => {
    await fetch('/api/nhso-eclaim/browser-close', { method: 'POST' }).catch(() => {/* ignore */});
    setEclaimBrowserReady(false);
    setEclaimBrowserAlive(false);
    setEclaimBrowserPhase('closed');
    setEclaimBrowserMessage('ปิด Browser แล้ว');
    setEclaimBrowserLoading(false);
  };

  const handleEclaimSearch = async () => {
    setEclaimError(null);
    setEclaimFiles([]);
    setEclaimSelected(new Set());
    setEclaimPipeline({});
    setEclaimDebugLog([]);

    if (eclaimPeriods.length === 0) {
      setEclaimError('ช่วงวันที่ไม่ถูกต้อง');
      return;
    }
    if (!eclaimBrowserReady) {
      setEclaimError('กรุณา Login และยืนยันตัวตนด้วย ThaID ก่อน');
      return;
    }

    try {
      setEclaimLoading(true);
      const res = await fetch('/api/nhso-eclaim/browser-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periods: eclaimPeriods, fileType: eclaimFileType }),
      });
      const json = await res.json() as {
        success: boolean; data?: Record<string, unknown>[]; debug?: typeof eclaimDebugLog; error?: string;
      };
      if (!json.success) throw new Error(json.error || 'ค้นหาไม่สำเร็จ');
      if (json.debug) setEclaimDebugLog(json.debug);
      const files = json.data || [];
      setEclaimFiles(files);
      if (files.length === 0) {
        setEclaimError(`ไม่พบไฟล์สำหรับงวด ${eclaimPeriods.join(', ')} ประเภท ${eclaimFileType}`);
        setEclaimShowDebug(true);
      } else if (eclaimAutoDownload) {
        // Auto-select all and download
        const allKeys = new Set(files.map((file, index) => getEclaimFileKey(file, index)));
        setEclaimSelected(allKeys);
        await handleEclaimDownloadFiles(files, allKeys);
      }
    } catch (err) {
      setEclaimError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setEclaimLoading(false);
    }
  };

  /** Core download logic — accepts files + selected set directly so it can be called from auto-download */
  const handleEclaimDownloadFiles = async (filesToProcess: Record<string, unknown>[], selectedKeys: Set<string>) => {
    if (selectedKeys.size === 0 || !eclaimBrowserReady) return;
    setEclaimDownloading(true);
    setEclaimError(null);
    const filesToDownload = filesToProcess
      .map((file, index) => ({ file, key: getEclaimFileKey(file, index) }))
      .filter(({ key }) => selectedKeys.has(key));
    setEclaimPipeline((current) => {
      const next = { ...current };
      filesToDownload.forEach(({ key }) => { next[key] = { status: 'downloading', message: 'กำลังดาวน์โหลด Excel' }; });
      return next;
    });

    const dataTransfer = new DataTransfer();
    const downloadedKeysByName = new Map<string, string[]>();
    const downloadErrors: string[] = [];
    for (const { file: fileObj, key } of filesToDownload) {
      const filename = String(fileObj.filename || fileObj.fileName || fileObj.name || 'download.xlsx');
      try {
        const dlRes = await fetch('/api/nhso-eclaim/browser-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            downloadHref: String(fileObj.downloadHref || ''),
            downloadOnclick: String(fileObj.downloadOnclick || ''),
            downloadLabel: String(fileObj.downloadLabel || ''),
            sourcePage: String(fileObj.sourcePage || ''),
            filename,
          }),
        });
        const dlJson = await dlRes.json() as { success: boolean; base64?: string; filename?: string; contentType?: string; error?: string };
        if (!dlJson.success || !dlJson.base64) throw new Error(dlJson.error || `ดาวน์โหลด ${filename} ไม่สำเร็จ`);
        const binaryStr = atob(dlJson.base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: dlJson.contentType || 'application/octet-stream' });
        const downloadedFilename = dlJson.filename || filename;
        const dlFile = new File([blob], downloadedFilename, { type: dlJson.contentType || 'application/octet-stream' });
        dataTransfer.items.add(dlFile);
        downloadedKeysByName.set(downloadedFilename, [...(downloadedKeysByName.get(downloadedFilename) || []), key]);
        setEclaimPipeline((current) => ({
          ...current,
          [key]: { status: 'downloaded', message: 'ดาวน์โหลด Excel แล้ว รอตรวจและนำเข้า' },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : `ดาวน์โหลด ${filename} ไม่สำเร็จ`;
        downloadErrors.push(message);
        setEclaimPipeline((current) => ({ ...current, [key]: { status: 'error', message } }));
      }
    }
    if (dataTransfer.files.length > 0) {
      const parsedItems = await handleFileChange(dataTransfer.files, true);
      const readyForImport = parsedItems.filter((item) => item.status === 'ready' && item.detectedType);
      const parseFailures = parsedItems.filter((item) => item.status === 'error');

      parseFailures.forEach((item) => {
        (downloadedKeysByName.get(item.file.name) || []).forEach((key) => {
          setEclaimPipeline((current) => ({
            ...current,
            [key]: { status: 'error', message: item.message || 'อ่านไฟล์ไม่สำเร็จ' },
          }));
        });
      });

      if (eclaimAutoImport && readyForImport.length > 0) {
        readyForImport.forEach((item) => {
          (downloadedKeysByName.get(item.file.name) || []).forEach((key) => {
            setEclaimPipeline((current) => ({
              ...current,
              [key]: { status: 'importing', message: `กำลังนำเข้า ${item.detectedType}` },
            }));
          });
        });
        const outcomes = await importQueueItems(readyForImport, false, false);
        Object.entries(outcomes).forEach(([downloadedFilename, outcome]) => {
          (downloadedKeysByName.get(downloadedFilename) || []).forEach((key) => {
            setEclaimPipeline((current) => ({ ...current, [key]: outcome }));
          });
        });
      }
    }
    if (downloadErrors.length > 0) setEclaimError(downloadErrors.join(' | '));
    setEclaimDownloading(false);
  };

  const handleEclaimDownload = async () => {
    await handleEclaimDownloadFiles(eclaimFiles, eclaimSelected);
  };

  const handleFileChange = async (files: FileList | null, append = false, bypassPreflight = false): Promise<ImportQueueItem[]> => {
    if (!append) {
      resetQueue();
    } else {
      setError(null);
      setSuccessMessage(null);
    }

    if (!files || files.length === 0) return [];

    const selectedFiles = Array.from(files).filter((file) => /\.(xlsx|xls|csv|zip)$/i.test(file.name));
    if (selectedFiles.length === 0) {
      const receivedNames = Array.from(files).map((file) => file.name).filter(Boolean).join(', ');
      setError(`รูปแบบไฟล์ยังไม่รองรับ ต้องเป็น Excel, CSV หรือ ZIP ที่มี BIL+DBF/XML จากระบบจ่ายเงิน${receivedNames ? ` (${receivedNames})` : ''}`);
      return [];
    }
    const initialQueue: ImportQueueItem[] = selectedFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      fileName: file.name,
      fileSize: file.size,
      relativePath: 'webkitRelativePath' in file ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : '',
      sheetName: '',
      headers: [],
      rows: [],
      rowCount: 0,
      status: 'parsing' as QueueStatus,
      progress: 5,
      message: 'เตรียมอ่านไฟล์',
    }));

    setQueueItems((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const merged = append
        ? [...current, ...initialQueue.filter((item) => !existingIds.has(item.id))]
        : initialQueue;
      return merged;
    });
    if (!append) {
      setActivePreviewId(initialQueue[0]?.id || null);
    } else if (!activePreviewId && initialQueue[0]) {
      setActivePreviewId(initialQueue[0].id);
    }

    const bufferById = new Map<string, ArrayBuffer>();
    let nextReadIndex = 0;
    const readNext = async () => {
      while (nextReadIndex < initialQueue.length) {
        const queueItem = initialQueue[nextReadIndex++];
        updateQueueItem(queueItem.id, (item) => ({
          ...item,
          progress: 10,
          message: 'กำลังอ่านไฟล์จากเครื่อง',
        }));
        const buffer = await queueItem.file.arrayBuffer();
        bufferById.set(queueItem.id, buffer);
        updateQueueItem(queueItem.id, (item) => ({
          ...item,
          progress: 28,
          message: 'กำลังตรวจว่าเคยนำเข้าไฟล์นี้หรือไม่',
        }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, initialQueue.length) }, () => readNext()));

    const preflightByName = new Map<string, Awaited<ReturnType<typeof preflightRepstmFiles>>[number]>();
    if (!bypassPreflight && !includeSubfiles) {
      try {
        const preflight = await preflightRepstmFiles(initialQueue.map((item) => ({
          filename: item.file.name,
          size: item.file.size,
          // ไม่บังคับ SHA-256 ฝั่ง browser เพราะ Web Crypto บางเครื่องค้างนาน
          // หลังเปิดไฟล์ server จะตรวจข้อมูลซ้ำจาก contentBatchHash อีกครั้งก่อนบันทึก
          hash: '',
        })));
        preflight.forEach((result) => preflightByName.set(result.filename.toLowerCase(), result));
      } catch (preflightError) {
        console.warn('REP/STM preflight unavailable; continuing with full validation', preflightError);
      }
    }

    const parsedItems: ImportQueueItem[] = [];
    const parseQueue: ImportQueueItem[] = [];
    for (const queueItem of initialQueue) {
      const preflight = preflightByName.get(queueItem.file.name.toLowerCase());
      const expectedType = detectTypeFromFileName(queueItem.file.name);
      const preflightTypeMatches = !expectedType || !preflight?.dataType || preflight.dataType === expectedType;
      if (preflight && preflightTypeMatches && ['exact', 'name_match', 'content_match'].includes(preflight.status)) {
        const reason = preflight.status === 'name_match'
          ? 'พบชื่อไฟล์นี้ในประวัติเดิม'
          : preflight.status === 'content_match'
            ? `เนื้อหาไฟล์ตรงกับ ${preflight.importedFilename || 'ไฟล์ที่เคยนำเข้า'}`
            : 'ชื่อและเนื้อหาไฟล์ตรงกับรายการเดิม';
        const skippedItem: ImportQueueItem = {
          ...queueItem,
          detectedType: preflight.dataType || undefined,
          rowCount: Number(preflight.rowCount || 0),
          status: 'duplicate',
          progress: 100,
          message: `${reason} · ข้ามก่อนเปิด Excel`,
        };
        parsedItems.push(skippedItem);
        updateQueueItem(queueItem.id, () => skippedItem);
      } else {
        if (preflight?.status === 'changed') {
          updateQueueItem(queueItem.id, (item) => ({
            ...item,
            progress: 35,
            message: 'ชื่อเดิมแต่เนื้อหาเปลี่ยน กำลังเปิดไฟล์แก้ไข',
          }));
        } else {
          updateQueueItem(queueItem.id, (item) => ({
            ...item,
            progress: 35,
            message: 'ตรวจประวัติแล้ว กำลังเปิดไฟล์',
          }));
        }
        parseQueue.push(queueItem);
      }
    }

    let nextParseIndex = 0;
    const parseNext = async () => {
      while (nextParseIndex < parseQueue.length) {
        const queueItem = parseQueue[nextParseIndex++];
      try {
        await yieldToBrowser();
        const parsedSheets = await readImportSource(
          queueItem.file,
          includeSubfiles,
          bufferById.get(queueItem.id),
          (progress, message) => updateQueueItem(queueItem.id, (item) => ({
            ...item,
            progress,
            message,
          })),
        );

        if (parsedSheets.length === 0) {
          const failedItem: ImportQueueItem = {
            ...queueItem,
            status: 'error',
            progress: 100,
            message: 'ไม่พบข้อมูลในไฟล์',
          };
          parsedItems.push(failedItem);
          updateQueueItem(queueItem.id, (item) => ({
            ...item,
            ...failedItem,
          }));
          continue;
        }

        if (parsedSheets.length === 1) {
          const { sheetName, rows, headers, hintType, isSubfile, importerId, importerLabel, summary, archiveSummaries, archiveEntries, sourceEntryName } = parsedSheets[0];
          const detectedType = isSubfile
            ? hintType || detectImportType(queueItem.fileName, headers, rows)
            : detectImportType(queueItem.fileName, headers, rows) || hintType;
          const parsedItem: ImportQueueItem = {
            ...queueItem,
            sheetName,
            isSubfile,
            headers,
            rows,
            rowCount: rows.length,
            detectedType: detectedType || undefined,
            importerId,
            importerLabel,
            summary,
            archiveSummaries,
            archiveEntries,
            relativePath: sourceEntryName || queueItem.relativePath,
            status: rows.length > 0 && detectedType ? 'ready' : 'error',
            progress: rows.length > 0 && detectedType ? 60 : 100,
            message: rows.length === 0
              ? 'ไม่พบข้อมูลในไฟล์'
              : detectedType
                ? `ตรวจพบเป็น ${detectedType} (Sheet: ${sheetName}) พร้อมนำเข้า ${rows.length.toLocaleString()} แถว`
                : 'ไม่สามารถระบุประเภทไฟล์ได้',
          };
          parsedItems.push(parsedItem);
          updateQueueItem(queueItem.id, (item) => ({
            ...item,
            ...parsedItem,
          }));
        } else {
          // Multiple relevant sheets – expand one file into multiple queue items
          const expandedItems: ImportQueueItem[] = parsedSheets.map(({ sheetName, rows, headers, hintType, isSubfile, importerId, importerLabel, summary, archiveSummaries, archiveEntries, sourceEntryName }, i) => {
            const detectedType = isSubfile
              ? hintType || detectImportType(queueItem.fileName, headers, rows)
              : detectImportType(queueItem.fileName, headers, rows) || hintType;
            return {
              id: `${queueItem.id}-sh${i}`,
              file: queueItem.file,
              fileName: queueItem.fileName,
              relativePath: sourceEntryName || queueItem.relativePath,
              sheetName,
              isSubfile,
              headers,
              rows,
              rowCount: rows.length,
              detectedType: detectedType || undefined,
              importerId,
              importerLabel,
              summary,
              archiveSummaries,
              archiveEntries,
              status: (rows.length > 0 && detectedType ? 'ready' : 'error') as QueueStatus,
              progress: rows.length > 0 && detectedType ? 60 : 100,
              message: rows.length === 0
                ? `Sheet "${sheetName}": ไม่พบข้อมูล`
                : detectedType
                  ? `${isSubfile ? 'Sub file ข้อมูลประกอบ' : `ตรวจพบเป็น ${detectedType}`} พร้อมนำเข้า ${rows.length.toLocaleString()} แถว`
                  : `Sheet "${sheetName}": ไม่สามารถระบุประเภท`,
            };
          });
          parsedItems.push(...expandedItems);
          setQueueItems((current) => {
            const without = current.filter((item) => item.id !== queueItem.id);
            return [...without, ...expandedItems];
          });
        }
      } catch (err) {
        const failedItem: ImportQueueItem = {
          ...queueItem,
          status: 'error',
          progress: 100,
          message: err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ',
        };
        parsedItems.push(failedItem);
        updateQueueItem(queueItem.id, (item) => ({
          ...item,
          ...failedItem,
        }));
      }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, parseQueue.length) }, () => parseNext()));
    return parsedItems;
  };

  const importQueueItems = async (
    targetItems: ImportQueueItem[],
    forceReimport = false,
    requireConfirmation = false,
  ): Promise<Record<string, EclaimPipelineState>> => {
    if (targetItems.length === 0) {
      setError(forceReimport ? 'ไม่มีไฟล์ที่ถูกข้ามให้ทำรายการนำเข้าซ้ำ' : 'ยังไม่มีไฟล์ที่พร้อมนำเข้า');
      return {};
    }
    if (forceReimport && requireConfirmation && !window.confirm(`ยืนยันนำเข้าซ้ำ ${targetItems.length.toLocaleString()} ไฟล์ และแทนข้อมูล batch เดิม?`)) return {};

    const outcomes: Record<string, EclaimPipelineState> = {};
    try {
      setImporting(true);
      setError(null);
      setSuccessMessage(null);

      let importedCount = 0;
      let importedRows = 0;
      let duplicateCount = 0;
      let replacedCount = 0;
      let failedCount = 0;

      for (const item of targetItems) {
        if (!item.detectedType) {
          updateQueueItem(item.id, (current) => ({
            ...current,
            status: 'error',
            message: 'ไม่สามารถระบุประเภทไฟล์ได้',
          }));
          failedCount += 1;
          outcomes[item.file.name] = { status: 'error', message: 'ระบุประเภทไฟล์ไม่ได้' };
          continue;
        }

        updateQueueItem(item.id, (current) => ({
          ...current,
          status: 'importing',
          progress: 75,
          message: 'กำลังนำเข้า',
        }));

        try {
          const result = await importRepstmData({
            dataType: item.detectedType,
            sourceFilename: item.archiveEntries?.length
              ? `${item.fileName} [${item.relativePath || item.sheetName}]`
              : item.fileName,
            fileSize: item.fileSize ?? item.file.size,
            fileHash: item.fileHash,
            sheetName: item.sheetName,
            isSubfile: Boolean(item.isSubfile),
            importedBy: importedBy.trim() || undefined,
            notes: [item.importerLabel ? `Importer: ${item.importerLabel}` : '', notes.trim()].filter(Boolean).join(' · ') || undefined,
            rows: item.rows,
            forceReimport,
          });

          if (result.duplicate || result.skipped) {
            duplicateCount += 1;
            outcomes[item.file.name] = { status: 'duplicate', message: result.message || 'มีข้อมูลชุดนี้แล้ว' };
            updateQueueItem(item.id, (current) => ({
              ...current,
              status: 'duplicate',
              message: result.message || `ไฟล์ ${item.detectedType} นี้ถูกนำเข้าแล้ว`,
            }));
          } else {
            importedCount += 1;
            importedRows += Number(result.rowCount || 0);
            if (result.replaced) replacedCount += 1;
            outcomes[item.file.name] = { status: 'success', message: result.message || `นำเข้า ${item.detectedType} แล้ว` };
            updateQueueItem(item.id, (current) => ({
              ...current,
              status: 'success',
              message: result.message || `นำเข้า ${item.detectedType} สำเร็จ ${Number(result.rowCount || 0).toLocaleString()} แถว`,
            }));
          }
        } catch (err) {
          failedCount += 1;
          outcomes[item.file.name] = { status: 'error', message: err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ' };
          updateQueueItem(item.id, (current) => ({
            ...current,
            status: 'error',
            message: err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ',
          }));
        }
      }

      setSuccessMessage(`${forceReimport ? 'นำเข้าซ้ำ' : 'นำเข้า'}สำเร็จ ${importedCount.toLocaleString()} ไฟล์ รวม ${importedRows.toLocaleString()} แถว${replacedCount > 0 ? `, แทนชุดเดิม ${replacedCount.toLocaleString()} ไฟล์` : ''}${duplicateCount > 0 ? `, ข้าม/เข้าแล้ว ${duplicateCount.toLocaleString()} ไฟล์` : ''}${failedCount > 0 ? `, ผิดพลาด ${failedCount.toLocaleString()} ไฟล์` : ''}`);
      await loadData(dataType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'นำเข้า REP/STM/INV ไม่สำเร็จ');
    } finally {
      setImporting(false);
    }
    return outcomes;
  };

  const handleImport = async (forceReimport = false) => {
    if (forceReimport && duplicateItems.some((item) => item.rows.length === 0)) {
      const transfer = new DataTransfer();
      const seen = new Set<string>();
      duplicateItems.forEach((item) => {
        const key = `${item.file.name}|${item.file.size}|${item.file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          transfer.items.add(item.file);
        }
      });
      const reparsed = await handleFileChange(transfer.files, false, true);
      const reparsedReady = reparsed.filter((item) => item.status === 'ready');
      await importQueueItems(reparsedReady, true, true);
      return;
    }
    const targetItems = forceReimport ? duplicateItems : readyItems;
    await importQueueItems(targetItems, forceReimport, true);
  };

  return (
    <div className="page-container">
      <div className="page-header repstm-hero">
        <h1 className="page-title">📥 นำเข้า REP / STM / INV</h1>
        <p className="page-subtitle">
          อัปโหลดหลายไฟล์หรือทั้งโฟลเดอร์จาก NHSO แล้วให้ระบบตรวจชนิดไฟล์ <code>REP / STM / INV</code> อัตโนมัติ พร้อมเก็บลงฐาน <code>repstminv</code> เพื่อใช้ตรวจสอบและต่อยอดงาน reconciliation
        </p>
      </div>

      <div className="card repstm-control-card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="alert alert-info repstm-alert" style={{ marginBottom: 16 }}>
            <span>ℹ️</span>
            <span>
              รองรับ <code>UCS / LGO / OFC (CSMBS)</code> จาก Excel/CSV, <code>REP ไต CHI</code> จาก ZIP ที่มี BIL+DBF และ ZIP/XML เช่น <code>COCDSTM</code> ระบบจะตรวจชื่อ ขนาด และเนื้อหา แนะนำตัวนำเข้าให้ และให้ผู้ใช้เปลี่ยนเป็น REP/STM/INV ก่อนยืนยันได้
            </span>
          </div>

          <div className="repstm-form-grid">
            <div className="form-group">
              <label className="form-label">มุมมองข้อมูลล่าสุด</label>
              <select className="form-control" value={dataType} onChange={(e) => setDataType(e.target.value as ImportType)}>
                <option value="REP">REP</option>
                <option value="STM">STM</option>
                <option value="INV">INV</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">ผู้นำเข้า</label>
              <input className="form-control" value={importedBy} onChange={(e) => setImportedBy(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">หมายเหตุ</label>
              <input className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="เช่น งวดมีนาคม 2569" />
            </div>
          </div>

          <div className="form-group repstm-picker-group">
            <label className="form-label">เลือกไฟล์หรือโฟลเดอร์</label>
            <div className="repstm-picker-actions">
              <button className="btn btn-primary" type="button" onClick={() => fileInputRef.current?.click()}>
                เลือกหลายไฟล์
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => folderInputRef.current?.click()}>
                เลือกทั้งโฟลเดอร์
              </button>
            </div>
            <input
              ref={fileInputRef}
              style={{ display: 'none' }}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.zip,application/zip"
              onChange={(e) => {
                void handleFileChange(e.target.files);
                if (e.target) e.target.value = '';
              }}
            />
            <input
              ref={folderInputRef}
              style={{ display: 'none' }}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
              accept=".xlsx,.xls,.csv,.zip,application/zip"
              onChange={(e) => {
                void handleFileChange(e.target.files);
                if (e.target) e.target.value = '';
              }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              ระบบจะตรวจชนิดจากชื่อไฟล์ หัวตาราง หรือโครงสร้าง BIL+DBF/XML ภายใน ZIP รองรับหลายไฟล์และทั้งโฟลเดอร์ เช่น <code>C:\TEMP\FDH_STAT</code>
            </div>
            <label className="repstm-subfile-option">
              <input
                type="checkbox"
                checked={includeSubfiles}
                onChange={(event) => {
                  setIncludeSubfiles(event.target.checked);
                  resetQueue();
                }}
              />
              <span>
                <strong>รวม Sub file / ชีตข้อมูลประกอบ</strong>
                <small>เช่น Data Drug, Data Instrument, Data sheet 0, ข้อมูลอุทธรณ์ และผู้พิการ D1 — เก็บเพื่อตรวจสอบ แต่ไม่นำยอดไปบวกซ้ำกับไฟล์หลัก</small>
              </span>
            </label>
          </div>

          <div className="repstm-toolbar">
            <button className="btn btn-primary" onClick={() => void handleImport(false)} disabled={importing || readyItems.length === 0}>
              {importing ? 'กำลังนำเข้าหลายไฟล์...' : `นำเข้ารายการที่พร้อม (${readyItems.length.toLocaleString()})`}
            </button>
            {duplicateItems.length > 0 && (
              <button className="btn btn-warning" onClick={() => void handleImport(true)} disabled={importing}>
                นำเข้าซ้ำ ({duplicateItems.length.toLocaleString()} ไฟล์)
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              เพิ่มไฟล์เข้าคิว
            </button>
            <button
              className="btn btn-secondary"
              onClick={resetQueue}
              disabled={importing}
            >
              ล้างคิว
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => navigateFromDashboard('repDeny', { source: 'dashboard', contextLabel: 'จากหน้ารับ REP/STM' })}
              disabled={importing}
            >
              เปิดหน้าตรวจ C/Deny
            </button>
          </div>
        </div>
      </div>

      {/* NHSO eclaim direct download */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setEclaimOpen((v) => !v)}>
          <div className="card-title">🌐 ดาวน์โหลด STM/INV จาก NHSO eclaim โดยตรง</div>
          <span style={{ fontSize: 18 }}>{eclaimOpen ? '▲' : '▼'}</span>
        </div>
        {eclaimOpen && (
          <div className="card-body">
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <span>ℹ️</span>
              <span>
                ดาวน์โหลดไฟล์ STM/INV จาก <strong>eclaim.nhso.go.th</strong> โดยตรง (คล้าย Auto4Rep.EXE)
                แล้วเพิ่มเข้าคิวนำเข้าอัตโนมัติ
              </span>
            </div>

            {/* Step 1: ThaID Login */}
            <div style={{ background: 'var(--bg-secondary,#f0f4ff)', border: '1px solid var(--border-color,#c7d2fe)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>📋 ขั้นตอนที่ 1 — Login ด้วย ThaID</div>
              <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                <li>กด <strong>เริ่ม Login ThaID</strong> เพื่อเปิด Browser บน Server</li>
                <li>สแกน QR ที่แสดงด้านล่างและยืนยันในแอป ThaID</li>
                <li>เมื่อสถานะเป็น “พร้อมแล้ว” สามารถดาวน์โหลดได้ตลอดจนกว่า session จะหมดอายุ</li>
              </ol>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleBrowserLogin}
                  disabled={eclaimBrowserLoading}
                  style={{ flexShrink: 0 }}
                >
                  {eclaimBrowserLoading
                    ? '⏳ กำลังรอการยืนยัน ThaID...'
                    : '🔐 เริ่ม Login ThaID'}
                </button>
                {eclaimBrowserAlive && !eclaimBrowserReady && (
                  <button className="btn btn-secondary" onClick={() => void handleThaIdSelect()}>
                    เลือก ThaID / แสดง QR
                  </button>
                )}
                {eclaimBrowserReady && !eclaimBrowserLoading && (
                  <>
                    <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 13 }}>✅ ThaID พร้อมแล้ว — ดาวน์โหลดไฟล์ได้เลย</span>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={handleBrowserClose}>
                      ❌ ปิด Browser
                    </button>
                  </>
                )}
              </div>
              <div style={{ marginTop: 8, color: eclaimBrowserReady ? '#15803d' : '#92400e', fontWeight: 600 }}>
                สถานะ: {eclaimBrowserMessage} <span style={{ opacity: 0.65 }}>({eclaimBrowserPhase})</span>
              </div>
              {eclaimBrowserAlive && !eclaimBrowserReady && (
                <div style={{ marginTop: 10, maxWidth: 900 }}>
                  <img
                    src={`/api/nhso-eclaim/browser-screenshot?t=${eclaimScreenshotVersion}`}
                    alt="หน้าจอ Login ThaID จาก eClaim"
                    style={{ display: 'block', width: '100%', maxHeight: 620, objectFit: 'contain', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8 }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">วันที่เริ่มต้น</label>
                <input type="date" className="form-control" value={eclaimStartDate} onChange={(e) => setEclaimStartDate(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">วันที่สิ้นสุด</label>
                <input type="date" className="form-control" value={eclaimEndDate} onChange={(e) => setEclaimEndDate(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">ประเภทไฟล์</label>
                <select className="form-control" value={eclaimFileType} onChange={(e) => setEclaimFileType(e.target.value as typeof eclaimFileType)}>
                  <option value="ALL">ทุกประเภท</option>
                  <option value="STM">STM</option>
                  <option value="INV">INV</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                {eclaimPeriods.length > 0 && (
                  <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    งวดที่จะค้นหา ({eclaimPeriods.length} งวด):{' '}
                    {eclaimPeriods.slice(0, 12).map((p) => (
                      <span key={p} className="badge badge-info" style={{ marginRight: 4 }}>{p}</span>
                    ))}
                    {eclaimPeriods.length > 12 && <span style={{ fontSize: 11 }}>+{eclaimPeriods.length - 12} งวด</span>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={handleEclaimSearch} disabled={eclaimLoading || eclaimDownloading || !eclaimBrowserReady}>
                    {eclaimLoading ? '⟳ กำลังค้นหา...' : '🔍 ดาวน์โหลดไฟล์ใหม่จาก NHSO eClaim'}
                  </button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={eclaimAutoDownload}
                      onChange={(e) => setEclaimAutoDownload(e.target.checked)}
                    />
                    ดาวน์โหลดทุกไฟล์ที่พบอัตโนมัติ
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={eclaimAutoImport}
                      onChange={(e) => setEclaimAutoImport(e.target.checked)}
                    />
                    ตรวจซ้ำและนำเข้า STM/INV ทันที
                  </label>
                  {eclaimFiles.length > 0 && (
                    <button
                      className="btn btn-success"
                      onClick={handleEclaimDownload}
                      disabled={eclaimDownloading || eclaimSelected.size === 0 || !eclaimBrowserReady}
                    >
                      {eclaimDownloading
                        ? (importing ? '⟳ กำลังนำเข้าข้อมูล...' : '⟳ กำลังดาวน์โหลด/ตรวจไฟล์...')
                        : `⬇️ ดาวน์โหลด${eclaimAutoImport ? 'และนำเข้า' : 'เข้าคิว'} (${eclaimSelected.size} ไฟล์)`}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {eclaimError && (
              <div className="alert alert-danger" style={{ marginBottom: 12 }}>
                <span>⚠️</span><span>{eclaimError}</span>
              </div>
            )}

            {/* Debug panel */}
            {eclaimDebugLog.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '2px 10px' }}
                  onClick={() => setEclaimShowDebug((v) => !v)}
                >
                  🔧 {eclaimShowDebug ? 'ซ่อน' : 'แสดง'} Debug Info ({eclaimDebugLog.length} งวด)
                </button>
                {eclaimShowDebug && (
                  <div style={{ marginTop: 8, background: '#1e1e2e', color: '#cdd6f4', borderRadius: 8, padding: 12, fontSize: 11, fontFamily: 'monospace', maxHeight: 400, overflowY: 'auto' }}>
                    {eclaimDebugLog.map((d, i) => (
                      <div key={i} style={{ marginBottom: 12, borderLeft: '2px solid #45475a', paddingLeft: 8 }}>
                        <div>
                          <span style={{ color: '#fab387' }}>งวด {d.period}</span>{' '}
                          <span style={{ color: '#cba6f7' }}>rows={d.rowCount}</span>{' '}
                          <span style={{ color: '#89b4fa' }}>{d.url}</span>
                        </div>
                        {d.title && <div style={{ color: '#f38ba8', fontSize: 10 }}>title: {d.title}</div>}
                        {d.htmlSnippet && (
                          <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto', fontSize: 10, color: '#cdd6f4' }}>
                            {d.htmlSnippet.slice(0, 1200)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {eclaimFiles.length > 0 && (
              <div className="modal-table-wrap">
                <table className="data-table long-id-table long-id-table--repstm-latest">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={eclaimSelected.size === eclaimFiles.length && eclaimFiles.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEclaimSelected(new Set(eclaimFiles.map((file, index) => getEclaimFileKey(file, index))));
                            } else {
                              setEclaimSelected(new Set());
                            }
                          }}
                        />
                      </th>
                      <th>ชื่อไฟล์</th>
                      <th>งวด</th>
                      <th>สิทธิ/แหล่งข้อมูล</th>
                      <th>ข้อมูลเพิ่มเติม</th>
                      <th>สถานะ Pipeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eclaimFiles.map((file, idx) => {
                      const key = getEclaimFileKey(file, idx);
                      const displayName = String(file.filename || file.fileName || file.name || idx);
                      const checked = eclaimSelected.has(key);
                      const cells = Array.isArray(file.cells) ? (file.cells as string[]) : [];
                      const href = String(file.downloadHref || '');
                      const hasOnclick = Boolean(file.downloadOnclick);
                      const pipeline = eclaimPipeline[key];
                      return (
                        <tr key={key} onClick={() => setEclaimSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        })} style={{ cursor: 'pointer', background: checked ? 'rgba(37,99,235,0.07)' : undefined }}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={checked} onChange={() => setEclaimSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key); else next.add(key);
                              return next;
                            })} />
                          </td>
                          <td className="table-cell-nowrap" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayName}>{displayName}</td>
                          <td className="table-cell-nowrap">{String(file.period || file._period || '-')}</td>
                          <td className="table-cell-nowrap">{String(file.fund || file.detectedType || '-')}</td>
                          <td className="table-cell-nowrap" style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cells.filter(Boolean).slice(0, 4).join(' | ') || '-'}
                          </td>
                          <td className="table-cell-nowrap">
                            {pipeline ? (
                              <span
                                title={pipeline.message}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: pipeline.status === 'success' ? '#15803d'
                                    : pipeline.status === 'duplicate' ? '#0369a1'
                                      : pipeline.status === 'error' ? '#b91c1c'
                                        : pipeline.status === 'importing' ? '#7c3aed'
                                          : '#d97706',
                                }}
                              >
                                {pipeline.status === 'success' && '✅ นำเข้าแล้ว'}
                                {pipeline.status === 'duplicate' && '☑️ มีข้อมูลแล้ว'}
                                {pipeline.status === 'error' && '❌ ผิดพลาด'}
                                {pipeline.status === 'importing' && '⟳ กำลังนำเข้า'}
                                {pipeline.status === 'downloading' && '⬇️ กำลังดาวน์โหลด'}
                                {pipeline.status === 'downloaded' && '📥 ดาวน์โหลดแล้ว'}
                              </span>
                            ) : (
                              <>
                                {href && <span style={{ fontSize: 10, color: '#2563eb' }}>🔗 พร้อมดาวน์โหลด</span>}
                                {!href && hasOnclick && <span style={{ fontSize: 10, color: '#d97706' }}>⚡ พร้อมดาวน์โหลด</span>}
                                {!href && !hasOnclick && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>?</span>}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {eclaimFiles.length === 0 && !eclaimLoading && eclaimBrowserReady && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                ไม่พบไฟล์สำหรับงวด {eclaimPeriods.join(', ')} ประเภท {eclaimFileType}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card repstm-status-card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">สถานะการนำเข้าข้อมูล</div>
          <div className="repstm-chip-row">
            <span className="badge badge-info">ทั้งหมด {queueItems.length.toLocaleString()} ไฟล์</span>
            <span className="badge badge-primary">พร้อมนำเข้า {readyItems.length.toLocaleString()}</span>
            <span className="badge badge-success">สำเร็จ {successItems.length.toLocaleString()}</span>
            <span className="badge badge-info">เข้าแล้ว {duplicateItems.length.toLocaleString()}</span>
            <span className="badge badge-warning">กำลังนำเข้า {importingItems.length.toLocaleString()}</span>
            <span className="badge badge-danger">ผิดพลาด {errorItems.length.toLocaleString()}</span>
          </div>
        </div>
        <div className="card-body" style={{ padding: 16 }}>
          <div className="repstm-progress-hero">
            <div className="repstm-progress-top">
              <div>
                <div className="repstm-progress-label">ความคืบหน้ารวม</div>
                <div className="repstm-progress-value">{overallProgress}%</div>
              </div>
              <div className="repstm-chip-row">
                <span className="badge badge-primary">REP {typeSummary.REP}</span>
                <span className="badge badge-info">STM {typeSummary.STM}</span>
                <span className="badge badge-warning">INV {typeSummary.INV}</span>
              </div>
            </div>
            <div className="repstm-progress-track">
              <div style={{
                width: `${overallProgress}%`,
                background: 'linear-gradient(90deg, #2563eb, #22c55e, #f59e0b)',
              }} />
            </div>
          </div>

          {queueItems.length > 0 ? (
            <div className="modal-table-wrap repstm-table-shell">
              <table className="data-table repstm-queue-table">
                <thead>
                  <tr>
                    <th>ไฟล์</th>
                    <th>ตัวนำเข้า</th>
                    <th>Sheet</th>
                    <th>บทบาท</th>
                    <th>แถวข้อมูล</th>
                    <th>สถานะ</th>
                    <th>Progress</th>
                    <th>ข้อความ</th>
                    <th>รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.map((item) => {
                    const itemProgress = item.progress ?? statusPercentMap[item.status];
                    return (
                    <tr
                      key={item.id}
                      onClick={() => setActivePreviewId(item.id)}
                      className={item.id === activePreview?.id ? 'repstm-row-active' : 'repstm-row'}
                    >
                      <td>
                        <div className="repstm-file-name" title={item.fileName}>{item.fileName}</div>
                        <div className="repstm-file-subpath" title={item.relativePath || '-'}>{item.relativePath || '-'}</div>
                      </td>
                      <td className="table-cell-nowrap" onClick={(event) => event.stopPropagation()}>
                        <select
                          className="form-control repstm-importer-select"
                          value={item.detectedType || ''}
                          disabled={item.status === 'importing' || item.status === 'success'}
                          onChange={(event) => changeQueueImporter(item.id, event.target.value as ImportType)}
                          aria-label={`เลือกตัวนำเข้าสำหรับ ${item.fileName}`}
                        >
                          <option value="" disabled>เลือกตัวนำเข้า</option>
                          <option value="REP">REP</option>
                          <option value="STM">STM</option>
                          <option value="INV">INV</option>
                        </select>
                        {item.importerLabel ? <div className="repstm-importer-hint">แนะนำ: {item.importerLabel}</div> : null}
                      </td>
                      <td className="table-cell-nowrap">{item.sheetName || '-'}</td>
                      <td className="table-cell-nowrap"><span className={`badge ${item.isSubfile ? 'badge-warning' : 'badge-primary'}`}>{item.isSubfile ? 'Sub file' : 'ไฟล์หลัก'}</span></td>
                      <td className="table-cell-nowrap">{item.rowCount.toLocaleString()}</td>
                      <td className="table-cell-nowrap">
                        <span className={`badge ${item.status === 'success' ? 'badge-success' : item.status === 'duplicate' ? 'badge-info' : item.status === 'error' ? 'badge-danger' : item.status === 'importing' ? 'badge-warning' : 'badge-primary'}`}>
                          {statusLabelMap[item.status]}
                        </span>
                      </td>
                      <td className="repstm-progress-cell">
                        <div className="repstm-row-progress">
                          <div className="repstm-row-progress-track">
                            <div style={{
                              width: `${itemProgress}%`,
                              background: statusColorMap[item.status],
                            }} />
                          </div>
                          <span className="repstm-progress-percent">
                            {itemProgress}%
                          </span>
                        </div>
                      </td>
                      <td className="repstm-message-cell">{item.message || '-'}</td>
                      <td className="table-cell-nowrap" onClick={(event) => event.stopPropagation()}>
                        <button className="btn btn-secondary repstm-detail-button" type="button" disabled={item.rows.length === 0} onClick={() => openQueueDetail(item)}>
                          ดูข้อมูล
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
              ยังไม่มีไฟล์ในคิวการนำเข้า
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>✅</span>
          <span>{successMessage}</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">ตัวอย่างข้อมูลก่อนนำเข้า</div>
            <div className="repstm-preview-actions">
              <span className="badge badge-primary">{previewRows.length.toLocaleString()} แถว</span>
              {activePreview && activePreview.rows.length > 0 ? (
                <button className="btn btn-secondary repstm-detail-button" type="button" onClick={() => openQueueDetail(activePreview)}>ดูข้อมูลทั้งหมด</button>
              ) : null}
            </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {previewRows.length > 0 ? (
            <div className="modal-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {previewHeaders.slice(0, 10).map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 10).map((row, index) => (
                    <tr key={`preview-${index}`}>
                      {previewHeaders.slice(0, 10).map((header) => (
                        <td key={`${header}-${index}`}>{String(row[header] ?? '-')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="repstm-preview-meta">
                ไฟล์: <strong>{activePreview?.fileName || '-'}</strong> | ประเภทที่ตรวจพบ: <strong>{activePreview?.detectedType || '-'}</strong> | Sheet: <strong>{activePreview?.sheetName || '-'}</strong> | แสดงตัวอย่าง 10 แถวแรก
              </div>
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
              ยังไม่มีไฟล์ที่พร้อมนำเข้า
            </div>
          )}
        </div>
      </div>

      <div className="repstm-data-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title">ประวัติการนำเข้า</div>
            <span className="badge badge-info">{loadingBatches ? 'กำลังโหลด...' : `${batches.length} รายการ`}</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {batches.length > 0 ? (
              <div className="modal-table-wrap repstm-table-shell">
                <table className="data-table repstm-history-table">
                  <thead>
                    <tr>
                      <th>ไฟล์</th>
                      <th>ผู้นำเข้า</th>
                      <th>แถว</th>
                      <th>หมายเหตุ</th>
                      <th>เวลา</th>
                      <th>รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          <div className="repstm-file-name" title={batch.source_filename}>{batch.source_filename}</div>
                          <div className="repstm-file-subpath" title={batch.sheet_name || '-'}>
                            Sheet: {batch.sheet_name || '-'} {batch.is_subfile ? <span className="badge badge-warning">Sub file</span> : null}
                          </div>
                          {batch.replaces_batch_id ? (
                            <div className="repstm-file-subpath">
                              แทน batch #{batch.replaces_batch_id}
                            </div>
                          ) : null}
                        </td>
                        <td className="table-cell-nowrap">{batch.imported_by || '-'}</td>
                        <td className="table-cell-nowrap">{Number(batch.row_count || 0).toLocaleString()}</td>
                        <td className="repstm-message-cell">{batch.notes || '-'}</td>
                        <td className="table-cell-nowrap">{String(batch.created_at || '-')}</td>
                        <td className="table-cell-nowrap">
                          <button className="btn btn-secondary repstm-detail-button" type="button" onClick={() => void openBatchDetail(batch)}>ดูข้อมูล</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                ยังไม่มีประวัติการนำเข้า {dataType}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">ข้อมูลล่าสุดในฐาน {dataType}</div>
            <span className="badge badge-info">{loadingRows ? 'กำลังโหลด...' : `${rows.length} แถว`}</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {rows.length > 0 ? (
              <div className="modal-table-wrap repstm-table-shell">
                <table className="data-table long-id-table long-id-table--repstm-latest repstm-latest-data-table">
                  <thead>
                    {isRepType ? (
                      <tr>
                        <th>TRAN_ID</th>
                        <th>REP</th>
                        <th>HN</th>
                        <th>VN / AN</th>
                        <th>ชื่อ-สกุล</th>
                        <th>ประเภท</th>
                        <th>ชดเชย</th>
                        <th>Income</th>
                        <th>Diff</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Ref</th>
                        <th>HN</th>
                        <th>VN/AN</th>
                        <th>Amount</th>
                        {latestHeaders.slice(0, 4).map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((row) => {
                      const raw = row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
                        ? row.raw_data as Record<string, unknown>
                        : {};
                      if (isRepType) {
                        return (
                          <tr key={row.id}>
                            <td className="table-cell-nowrap workflow-id-cell">{row.tran_id || '-'}</td>
                            <td className="table-cell-nowrap workflow-id-cell">{row.rep_no || '-'}</td>
                            <td className="table-cell-nowrap workflow-id-cell">{row.hn || '-'}</td>
                            <td className="table-cell-nowrap workflow-id-cell">{row.vn || row.an || '-'}</td>
                            <td className="workflow-person-cell">{row.patient_name || String(raw['ชื่อ-สกุล'] ?? '-')}</td>
                            <td className="table-cell-nowrap">{row.department || '-'}</td>
                            <td className="table-cell-nowrap workflow-money-cell">{row.compensated != null ? Number(row.compensated).toLocaleString() : '-'}</td>
                            <td className="table-cell-nowrap workflow-money-cell">{row.income != null ? Number(row.income).toLocaleString() : '-'}</td>
                            <td className="table-cell-nowrap workflow-money-cell">{row.diff != null ? Number(row.diff).toLocaleString() : '-'}</td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={row.id}>
                          <td>{row.ref_key || '-'}</td>
                          <td>{row.hn || '-'}</td>
                          <td>{row.vn || row.an || '-'}</td>
                          <td>{row.amount != null ? Number(row.amount).toLocaleString() : '-'}</td>
                          {latestHeaders.slice(0, 4).map((header) => (
                            <td key={`${row.id}-${header}`}>{String(raw[header] ?? '-')}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                ยังไม่มีข้อมูล {dataType} ในฐาน repstminv
              </div>
            )}
          </div>
        </div>
      </div>
      {detailView ? (
          <RepStmImportDetail
            title={detailView.title}
            subtitle={detailView.subtitle}
            importerType={detailView.importerType}
            importerLabel={detailView.importerLabel}
            headers={detailView.headers}
            rows={detailView.rows}
            summaries={detailView.summaries}
            archiveEntries={detailView.archiveEntries}
            loading={detailLoading}
            error={detailError}
            onClose={() => { setDetailView(null); setDetailError(null); }}
          />
      ) : null}
    </div>
  );
};
