import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { fetchRcmdbData, fetchRepstmBatches, importRepstmData } from '../services/hosxpService';
import { navigateFromDashboard } from '../utils/navigationState';

type ImportType = 'REP' | 'STM' | 'INV';

interface ImportBatch {
  id: number;
  data_type: ImportType;
  source_filename: string;
  sheet_name?: string;
  imported_by?: string;
  row_count: number;
  notes?: string;
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
  relativePath?: string;
  detectedType?: ImportType;
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  status: QueueStatus;
  message?: string;
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

const detectImportType = (fileName: string, headers: string[], rows: Record<string, unknown>[]): ImportType | null => {
  const normalizedName = fileName.toLowerCase();
  const normalizedHeaders = headers.map((header) => normalizeHeaderCell(header).toLowerCase());
  const firstRowKeys = Object.keys(rows[0] || {}).map((key) => normalizeHeaderCell(key).toLowerCase());
  const bag = `${normalizedName} | ${normalizedHeaders.join(' | ')} | ${firstRowKeys.join(' | ')}`;

  if (/\brep\b|rep_|_rep|repdata/.test(normalizedName) || (bag.includes('tran_id') && bag.includes('ชดเชยสุทธิ'))) {
    return 'REP';
  }

  if (/\bstm\b|stm_|_stm/.test(normalizedName) || bag.includes('statement') || bag.includes('stm') || bag.includes('stmt_period') || bag.includes('hospcode')) {
    return 'STM';
  }

  if (/\binv\b|inv_|_inv|invoice/.test(normalizedName) || bag.includes('invoice') || bag.includes('เลขที่ใบแจ้งหนี้') || bag.includes('invoiceno')) {
    return 'INV';
  }

  if (bag.includes('tran_id') && bag.includes('hn') && bag.includes('an')) return 'REP';
  return null;
};

const statusLabelMap: Record<QueueStatus, string> = {
  parsing: 'กำลังอ่านไฟล์',
  ready: 'พร้อมนำเข้า',
  importing: 'กำลังนำเข้า',
  success: 'สำเร็จ',
  duplicate: 'เข้าแล้ว',
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
    const hasInvoice = !!(normalized['invoiceno'] || normalized['invoice'] || normalized['เลขที่ใบแจ้งหนี้']);
    const hasPeriod = Object.values(normalized).some((v) => /^\d{6}$/.test(v));
    const filledCount = Object.values(normalized).filter(Boolean).length;
    return (hasInvoice || hasPeriod) && filledCount >= 3;
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
  const mergedHeaders = buildHeadersFromRows(headerRow, nextRow);
  const activeColumnIndexes = mergedHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      if (!header || header.startsWith('column_')) return false;
      return grid.slice(resolvedHeaderIndex + 2).some((row) => Array.isArray(row) && normalizeHeaderCell(row[index]));
    });

  const headers = activeColumnIndexes.map(({ header }) => header);

  const dataStartIndex = resolvedHeaderIndex + 2;
  const rows = grid
    .slice(dataStartIndex)
    .filter((row) => Array.isArray(row) && row.some((cell) => normalizeHeaderCell(cell)))
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
}

/** Scans all sheets in a workbook; returns one ParsedSheet per sheet that has data.
 *  Priority sheet names (from Auto4Rep.EXE) are checked first. */
const readWorkbook = async (file: File): Promise<ParsedSheet[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const priorityNames = ['statement', 'eclaim', 'invoice', 'individual', 'detail', 'repdata', 'repeclaim'];
  const ordered = [
    ...workbook.SheetNames.filter((s) => priorityNames.some((p) => s.toLowerCase().replace(/[^a-z]/g, '') === p || s.toLowerCase().replace(/[^a-z]/g, '').startsWith(p))),
    ...workbook.SheetNames.filter((s) => !priorityNames.some((p) => s.toLowerCase().replace(/[^a-z]/g, '') === p || s.toLowerCase().replace(/[^a-z]/g, '').startsWith(p))),
  ];

  const results: ParsedSheet[] = [];
  for (const sheetName of ordered) {
    const hintType = detectTypeFromSheetName(sheetName);
    const parsed = parseWorksheetRows(workbook.Sheets[sheetName], hintType);
    if (parsed.rows.length > 0) {
      results.push({ sheetName, rows: parsed.rows, headers: parsed.headers, hintType });
    }
  }

  // Fallback: try first sheet without a hint if nothing matched
  if (results.length === 0 && workbook.SheetNames.length > 0) {
    const firstSheet = workbook.SheetNames[0];
    const parsed = parseWorksheetRows(workbook.Sheets[firstSheet], null);
    if (parsed.rows.length > 0) {
      results.push({ sheetName: firstSheet, rows: parsed.rows, headers: parsed.headers, hintType: null });
    }
  }

  return results;
};

export const RepStmImportPage: React.FC = () => {
  const [dataType, setDataType] = useState<ImportType>('REP');
  const [importedBy, setImportedBy] = useState('เปรมศักดิ์ เทพวงสา');
  const [notes, setNotes] = useState('');
  const [queueItems, setQueueItems] = useState<ImportQueueItem[]>([]);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // NHSO eclaim download state
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const [eclaimOpen, setEclaimOpen] = useState(false);
  const [eclaimUser, setEclaimUser] = useState('');
  const [eclaimPass, setEclaimPass] = useState('');
  const [eclaimStartDate, setEclaimStartDate] = useState(firstOfMonth);
  const [eclaimEndDate, setEclaimEndDate] = useState(todayStr);
  const [eclaimFileType, setEclaimFileType] = useState<'REP' | 'STM' | 'INV' | 'ALL'>('ALL');
  const [eclaimToken, setEclaimToken] = useState('');
  const [eclaimTokenMode, setEclaimTokenMode] = useState(true); // default: token mode
  const [eclaimManualToken, setEclaimManualToken] = useState('');
  const [eclaimSessionCookie, setEclaimSessionCookie] = useState(''); // Java session cookie from old system
  const [eclaimBrowserLoading, setEclaimBrowserLoading] = useState(false);
  const [eclaimLoading, setEclaimLoading] = useState(false);
  const [eclaimError, setEclaimError] = useState<string | null>(null);
  const [eclaimFiles, setEclaimFiles] = useState<Record<string, unknown>[]>([]);
  const [eclaimSelected, setEclaimSelected] = useState<Set<string>>(new Set());
  const [eclaimDownloading, setEclaimDownloading] = useState(false);
  const [eclaimDebugLog, setEclaimDebugLog] = useState<{ url: string; status: number; body: unknown }[]>([]);
  const [eclaimDiscoveredApis, setEclaimDiscoveredApis] = useState<{ url: string; method: string; hasAuth: boolean; hasCookie?: boolean }[]>([]);
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
    const total = queueItems.reduce((sum, item) => sum + statusPercentMap[item.status], 0);
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

  // Preload saved NHSO eclaim credentials
  useEffect(() => {
    fetch('/api/config/nhso-eclaim-settings')
      .then((r) => r.json())
      .then((json: unknown) => {
        const data = (json as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        if (data) {
          if (data.username) setEclaimUser(String(data.username));
        }
      })
      .catch(() => {/* ignore */});
  }, []);

  const resetQueue = () => {
    setQueueItems([]);
    setActivePreviewId(null);
    setError(null);
    setSuccessMessage(null);
  };

  const updateQueueItem = (id: string, updater: (item: ImportQueueItem) => ImportQueueItem) => {
    setQueueItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  };

  const handleBrowserLogin = async () => {
    setEclaimError(null);
    setEclaimBrowserLoading(true);
    try {
      const res = await fetch('/api/nhso-eclaim/browser-login', { method: 'POST' });
      const json = await res.json() as {
        success: boolean; token?: string; sessionCookie?: string; error?: string;
        discoveredApiCalls?: { url: string; method: string; hasAuth: boolean; hasCookie: boolean }[];
      };
      if (!json.success) throw new Error(json.error || 'ไม่ได้รับ session');
      if (json.token) {
        setEclaimManualToken(json.token);
        setEclaimToken(json.token);
      }
      if (json.sessionCookie) {
        setEclaimSessionCookie(json.sessionCookie);
      }
      if (!json.token && !json.sessionCookie) throw new Error('ไม่พบ token หรือ session cookie');
      if (json.discoveredApiCalls?.length) {
        setEclaimDiscoveredApis(json.discoveredApiCalls);
      }
    } catch (err) {
      setEclaimError((err as Error).message);
    } finally {
      setEclaimBrowserLoading(false);
    }
  };

  const handleEclaimSearch = async () => {
    setEclaimError(null);
    setEclaimFiles([]);
    setEclaimSelected(new Set());

    if (eclaimPeriods.length === 0) {
      setEclaimError('ช่วงวันที่ไม่ถูกต้อง');
      return;
    }

    try {
      setEclaimLoading(true);
      let token = '';
      let sessionCookie = '';

      if (eclaimTokenMode) {
        // Use session from browser-login (cookie or Bearer token)
        token = eclaimManualToken.trim().replace(/^Bearer\s+/i, '');
        sessionCookie = eclaimSessionCookie.trim();
        if (!token && !sessionCookie) {
          setEclaimError('กรุณากด "เปิด Edge ให้ Login" ก่อน');
          return;
        }
        if (token) setEclaimToken(token);
      } else {
        if (!eclaimUser.trim() || !eclaimPass.trim()) {
          setEclaimError('กรุณากรอก username / password NHSO eclaim');
          return;
        }
        const authRes = await fetch('/api/nhso-eclaim/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: eclaimUser, password: eclaimPass }),
        });
        const authJson = await authRes.json() as { success: boolean; token?: string; error?: string };
        if (!authJson.success || !authJson.token) throw new Error(authJson.error || 'ขอ token ไม่สำเร็จ');
        token = authJson.token;
        setEclaimToken(token);
        await fetch('/api/config/nhso-eclaim-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: eclaimUser, password: eclaimPass }),
        });
      }

      // File list — fetch all periods, pass token or sessionCookie
      const allFiles: Record<string, unknown>[] = [];
      const seenKeys = new Set<string>();
      const allDebugLog: { url: string; status: number; body: unknown }[] = [];
      for (const period of eclaimPeriods) {
        const params = new URLSearchParams({ period, fileType: eclaimFileType });
        if (token) params.set('token', token);
        if (sessionCookie) params.set('sessionCookie', sessionCookie);
        const listRes = await fetch(`/api/nhso-eclaim/file-list?${params.toString()}`);
        const listJson = await listRes.json() as {
          success: boolean; data?: unknown[]; error?: string;
          debug?: { url: string; status: number; body: unknown }[];
        };
        if (listJson.debug) allDebugLog.push(...listJson.debug);
        if (!listJson.success) continue;
        for (const f of (listJson.data || []) as Record<string, unknown>[]) {
          const key = String(f.filename || f.fileName || f.name || JSON.stringify(f));
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allFiles.push({ ...f, _period: period });
          }
        }
      }
      setEclaimDebugLog(allDebugLog);
      setEclaimFiles(allFiles);
      if (allFiles.length === 0) {
        setEclaimError(`ไม่พบไฟล์สำหรับงวด ${eclaimPeriods.join(', ')} ประเภท ${eclaimFileType}`);
        setEclaimShowDebug(true);
      }
    } catch (err) {
      setEclaimError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setEclaimLoading(false);
    }
  };

  const handleEclaimDownload = async () => {
    if (eclaimSelected.size === 0 || !eclaimToken) return;
    setEclaimDownloading(true);
    setEclaimError(null);
    const filesToDownload = eclaimFiles.filter((f) => {
      const key = String(f.filename || f.fileName || f.name || '');
      return eclaimSelected.has(key);
    });

    const dataTransfer = new DataTransfer();
    for (const fileObj of filesToDownload) {
      const filename = String(fileObj.filename || fileObj.fileName || fileObj.name || 'download.xlsx');
      try {
        const dlRes = await fetch('/api/nhso-eclaim/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: eclaimToken,
            filename,
            period: String(fileObj._period || eclaimPeriods[0] || ''),
            downloadPayload: fileObj,
          }),
        });
        const dlJson = await dlRes.json() as { success: boolean; base64?: string; contentType?: string; error?: string };
        if (!dlJson.success || !dlJson.base64) throw new Error(dlJson.error || `ดาวน์โหลด ${filename} ไม่สำเร็จ`);
        const binaryStr = atob(dlJson.base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: dlJson.contentType || 'application/vnd.ms-excel' });
        const dlFile = new File([blob], filename, { type: dlJson.contentType || 'application/vnd.ms-excel' });
        dataTransfer.items.add(dlFile);
      } catch (err) {
        setEclaimError(err instanceof Error ? err.message : `ดาวน์โหลด ${filename} ไม่สำเร็จ`);
      }
    }
    if (dataTransfer.files.length > 0) {
      await handleFileChange(dataTransfer.files, true);
    }
    setEclaimDownloading(false);
  };

  const handleFileChange = async (files: FileList | null, append = false) => {
    if (!append) {
      resetQueue();
    } else {
      setError(null);
      setSuccessMessage(null);
    }

    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
    const initialQueue = selectedFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      fileName: file.name,
      relativePath: 'webkitRelativePath' in file ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : '',
      sheetName: '',
      headers: [],
      rows: [],
      rowCount: 0,
      status: 'parsing' as QueueStatus,
      message: 'กำลังอ่านไฟล์',
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

    for (const queueItem of initialQueue) {
      try {
        const parsedSheets = await readWorkbook(queueItem.file);

        if (parsedSheets.length === 0) {
          updateQueueItem(queueItem.id, (item) => ({
            ...item,
            status: 'error',
            message: 'ไม่พบข้อมูลในไฟล์',
          }));
          continue;
        }

        if (parsedSheets.length === 1) {
          const { sheetName, rows, headers, hintType } = parsedSheets[0];
          const detectedType = hintType || detectImportType(queueItem.fileName, headers, rows);
          updateQueueItem(queueItem.id, (item) => ({
            ...item,
            sheetName,
            headers,
            rows,
            rowCount: rows.length,
            detectedType: detectedType || undefined,
            status: rows.length > 0 && detectedType ? 'ready' : 'error',
            message: rows.length === 0
              ? 'ไม่พบข้อมูลในไฟล์'
              : detectedType
                ? `ตรวจพบเป็น ${detectedType} (Sheet: ${sheetName}) พร้อมนำเข้า ${rows.length.toLocaleString()} แถว`
                : 'ไม่สามารถระบุประเภทไฟล์ได้',
          }));
        } else {
          // Multiple relevant sheets – expand one file into multiple queue items
          const expandedItems: ImportQueueItem[] = parsedSheets.map(({ sheetName, rows, headers, hintType }, i) => {
            const detectedType = hintType || detectImportType(queueItem.fileName, headers, rows);
            return {
              id: `${queueItem.id}-sh${i}`,
              file: queueItem.file,
              fileName: `${queueItem.fileName} [${sheetName}]`,
              relativePath: queueItem.relativePath,
              sheetName,
              headers,
              rows,
              rowCount: rows.length,
              detectedType: detectedType || undefined,
              status: (rows.length > 0 && detectedType ? 'ready' : 'error') as QueueStatus,
              message: rows.length === 0
                ? `Sheet "${sheetName}": ไม่พบข้อมูล`
                : detectedType
                  ? `ตรวจพบเป็น ${detectedType} พร้อมนำเข้า ${rows.length.toLocaleString()} แถว`
                  : `Sheet "${sheetName}": ไม่สามารถระบุประเภท`,
            };
          });
          setQueueItems((current) => {
            const without = current.filter((item) => item.id !== queueItem.id);
            return [...without, ...expandedItems];
          });
        }
      } catch (err) {
        updateQueueItem(queueItem.id, (item) => ({
          ...item,
          status: 'error',
          message: err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ',
        }));
      }
    }
  };

  const handleImport = async () => {
    if (readyItems.length === 0) {
      setError('ยังไม่มีไฟล์ที่พร้อมนำเข้า');
      return;
    }

    try {
      setImporting(true);
      setError(null);
      setSuccessMessage(null);

      let importedCount = 0;
      let importedRows = 0;
      let duplicateCount = 0;
      let failedCount = 0;

      for (const item of readyItems) {
        if (!item.detectedType) {
          updateQueueItem(item.id, (current) => ({
            ...current,
            status: 'error',
            message: 'ไม่สามารถระบุประเภทไฟล์ได้',
          }));
          failedCount += 1;
          continue;
        }

        updateQueueItem(item.id, (current) => ({
          ...current,
          status: 'importing',
          message: 'กำลังนำเข้า',
        }));

        try {
          const result = await importRepstmData({
            dataType: item.detectedType,
            sourceFilename: item.fileName,
            sheetName: item.sheetName,
            importedBy: importedBy.trim() || undefined,
            notes: notes.trim() || undefined,
            rows: item.rows,
          });

          if (result.duplicate) {
            duplicateCount += 1;
            updateQueueItem(item.id, (current) => ({
              ...current,
              status: 'duplicate',
              message: result.message || `ไฟล์ ${item.detectedType} นี้ถูกนำเข้าแล้ว`,
            }));
          } else {
            importedCount += 1;
            importedRows += Number(result.rowCount || 0);
            updateQueueItem(item.id, (current) => ({
              ...current,
              status: 'success',
              message: `นำเข้า ${item.detectedType} สำเร็จ ${Number(result.rowCount || 0).toLocaleString()} แถว`,
            }));
          }
        } catch (err) {
          failedCount += 1;
          updateQueueItem(item.id, (current) => ({
            ...current,
            status: 'error',
            message: err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ',
          }));
        }
      }

      setSuccessMessage(`นำเข้าสำเร็จ ${importedCount.toLocaleString()} ไฟล์ รวม ${importedRows.toLocaleString()} แถว${duplicateCount > 0 ? `, เข้าแล้ว ${duplicateCount.toLocaleString()} ไฟล์` : ''}${failedCount > 0 ? `, ผิดพลาด ${failedCount.toLocaleString()} ไฟล์` : ''}`);
      await loadData(dataType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'นำเข้า REP/STM/INV ไม่สำเร็จ');
    } finally {
      setImporting(false);
    }
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
              รองรับการนำเข้าไฟล์ตาราง <code>.xlsx</code>, <code>.xls</code> และ <code>.csv</code> โดยตัดหัวรายงานออกก่อน และสำหรับ <code>REP</code> จะ map ลงตารางมาตรฐานในฐาน <code>repstminv</code> เพิ่มให้อัตโนมัติ
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
              accept=".xlsx,.xls,.csv"
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
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                void handleFileChange(e.target.files);
                if (e.target) e.target.value = '';
              }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              ระบบจะพยายามตรวจชนิดไฟล์ให้เองจากชื่อไฟล์และหัวตาราง รองรับการเลือกทีละหลายไฟล์ และการเลือกทั้งโฟลเดอร์ เช่น <code>C:\TEMP\REP</code>
            </div>
          </div>

          <div className="repstm-toolbar">
            <button className="btn btn-primary" onClick={handleImport} disabled={importing || readyItems.length === 0}>
              {importing ? 'กำลังนำเข้าหลายไฟล์...' : `นำเข้า ${dataType} ทั้งหมด`}
            </button>
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
          <div className="card-title">🌐 ดาวน์โหลด REP/STM/INV จาก NHSO eclaim โดยตรง</div>
          <span style={{ fontSize: 18 }}>{eclaimOpen ? '▲' : '▼'}</span>
        </div>
        {eclaimOpen && (
          <div className="card-body">
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <span>ℹ️</span>
              <span>
                ดาวน์โหลดไฟล์ REP/STM/INV จาก <strong>eclaim.nhso.go.th</strong> โดยตรง (คล้าย Auto4Rep.EXE)
                แล้วเพิ่มเข้าคิวนำเข้าอัตโนมัติ
              </span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={eclaimTokenMode}
                  onChange={(e) => { setEclaimTokenMode(e.target.checked); setEclaimError(null); }}
                />
                <span>🔑 ใช้ Token จาก Browser (แนะนำ) — ไม่ต้องพิมพ์ username/password</span>
              </label>
            </div>

            {eclaimTokenMode ? (
              <div style={{ marginBottom: 12 }}>
                {/* Step-by-step guide card */}
                <div style={{ background: 'var(--bg-secondary,#f0f4ff)', border: '1px solid var(--border-color,#c7d2fe)', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>📋 วิธี Login (ทำ 1 ครั้ง)</div>

                  <div style={{ background:'#dcfce7', border:'1px solid #16a34a', borderRadius:6, padding:'6px 10px', marginBottom:8, color:'#166534' }}>
                    ✅ ใช้ระบบเก่า <strong>eclaim.nhso.go.th/webComponent/main/MainWebAction.do</strong><br/>
                    (เข้าสู่ระบบด้วย username/password เหมือนใช้งานปกติ)
                  </div>

                  <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                    <li>
                      กดปุ่ม <strong>🌐 เปิด Edge ให้ Login</strong> — ระบบจะเปิด Edge ไปที่ eclaim.nhso.go.th ให้อัตโนมัติ
                    </li>
                    <li>Login ด้วย username/password ปกติ (ภายใน 5 นาที)</li>
                    <li>หลัง login สำเร็จ ให้คลิก <strong>"ข้อมูลผลการตรวจสอบ REP"</strong> ในเมนูซ้าย เพื่อให้ระบบจดจำ URL</li>
                    <li>รอ ~60 วินาที แล้ว Browser จะปิดตัวเองอัตโนมัติ</li>
                  </ol>

                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleBrowserLogin}
                      disabled={eclaimBrowserLoading}
                      style={{ width: '100%' }}
                    >
                      {eclaimBrowserLoading
                        ? '⏳ รอ Login... (Browser เปิดอยู่ — Login แล้วคลิก REP ในเมนู)'
                        : '🌐 เปิด Edge ให้ Login (eclaim.nhso.go.th)'}
                    </button>
                    {(eclaimSessionCookie || eclaimManualToken) && !eclaimBrowserLoading && (
                      <div style={{ marginTop: 6, color:'#16a34a', fontSize: 12 }}>
                        ✅ {eclaimSessionCookie ? 'ได้รับ Session Cookie แล้ว' : 'ได้รับ Token แล้ว'} — กดปุ่ม "ค้นหาไฟล์" ได้เลย
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 8, color:'var(--text-muted)', fontSize: 11 }}>
                    (ระบบจะดักจับ session cookie อัตโนมัติหลัง login)
                  </div>
                </div>

                {eclaimSessionCookie && (
                  <div style={{ marginBottom: 8 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Session Cookie (ดักจับอัตโนมัติ)</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      style={{ fontFamily: 'monospace', fontSize: 10, resize: 'vertical', color: '#16a34a' }}
                      value={eclaimSessionCookie}
                      onChange={(e) => setEclaimSessionCookie(e.target.value)}
                      placeholder="JSESSIONID=..."
                    />
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Username (NHSO eclaim)</label>
                  <input className="form-control" value={eclaimUser} onChange={(e) => setEclaimUser(e.target.value)} placeholder="nhso_username" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Password</label>
                  <input type="password" className="form-control" value={eclaimPass} onChange={(e) => setEclaimPass(e.target.value)} placeholder="••••••••" />
                </div>
              </div>
            )}

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
                  <option value="REP">REP</option>
                  <option value="STM">STM</option>
                  <option value="INV">INV</option>
                </select>
              </div>
            </div>

            {eclaimPeriods.length > 0 && (
              <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                งวดที่จะค้นหา ({eclaimPeriods.length} งวด):{' '}
                {eclaimPeriods.map((p) => (
                  <span key={p} className="badge badge-info" style={{ marginRight: 4 }}>{p}</span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={handleEclaimSearch} disabled={eclaimLoading}>
                {eclaimLoading ? '⟳ กำลังค้นหา...' : '🔍 ค้นหาไฟล์จาก NHSO eclaim'}
              </button>
              {eclaimFiles.length > 0 && (
                <button
                  className="btn btn-success"
                  onClick={handleEclaimDownload}
                  disabled={eclaimDownloading || eclaimSelected.size === 0}
                >
                  {eclaimDownloading ? '⟳ กำลังดาวน์โหลด...' : `⬇️ ดาวน์โหลดและเพิ่มในคิว (${eclaimSelected.size} ไฟล์)`}
                </button>
              )}
            </div>

            {eclaimError && (
              <div className="alert alert-danger" style={{ marginBottom: 12 }}>
                <span>⚠️</span><span>{eclaimError}</span>
              </div>
            )}

            {/* Debug panel — auto-shows when no files found */}
            {(eclaimDebugLog.length > 0 || eclaimDiscoveredApis.length > 0) && (
              <div style={{ marginBottom: 12 }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '2px 10px' }}
                  onClick={() => setEclaimShowDebug((v) => !v)}
                >
                  🔧 {eclaimShowDebug ? 'ซ่อน' : 'แสดง'} Debug Info
                </button>
                {eclaimShowDebug && (
                  <div style={{ marginTop: 8, background: '#1e1e2e', color: '#cdd6f4', borderRadius: 8, padding: 12, fontSize: 11, fontFamily: 'monospace', maxHeight: 320, overflowY: 'auto' }}>
                    {eclaimDiscoveredApis.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ color: '#a6e3a1', fontWeight: 600, marginBottom: 4 }}>🔍 API calls intercepted from browser:</div>
                        {eclaimDiscoveredApis.map((a, i) => (
                          <div key={i} style={{ marginBottom: 2 }}>
                            <span style={{ color: '#89b4fa' }}>{a.method}</span>{' '}
                            <span style={{ color: (a.hasAuth || a.hasCookie) ? '#a6e3a1' : '#f38ba8' }}>{a.url}</span>
                            {a.hasAuth && <span style={{ color: '#fab387' }}> [Bearer ✓]</span>}
                            {a.hasCookie && <span style={{ color: '#fab387' }}> [Cookie ✓]</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {eclaimDebugLog.length > 0 && (
                      <div>
                        <div style={{ color: '#a6e3a1', fontWeight: 600, marginBottom: 4 }}>📡 File-list API attempts:</div>
                        {eclaimDebugLog.map((d, i) => (
                          <div key={i} style={{ marginBottom: 8, borderLeft: '2px solid #45475a', paddingLeft: 8 }}>
                            <div><span style={{ color: d.status >= 200 && d.status < 300 ? '#a6e3a1' : '#f38ba8' }}>HTTP {d.status}</span>{' '}<span style={{ color: '#89b4fa' }}>{d.url}</span></div>
                            <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 100, overflowY: 'auto', fontSize: 10, color: '#cdd6f4' }}>
                              {JSON.stringify(d.body, null, 2).slice(0, 800)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {eclaimFiles.length > 0 && (
              <div className="modal-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={eclaimSelected.size === eclaimFiles.length && eclaimFiles.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEclaimSelected(new Set(eclaimFiles.map((f) => String(f.filename || f.fileName || f.name || ''))));
                            } else {
                              setEclaimSelected(new Set());
                            }
                          }}
                        />
                      </th>
                      <th>ชื่อไฟล์</th>
                      <th>ประเภท</th>
                      <th>งวด</th>
                      <th>ขนาด</th>
                      <th>วันที่</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eclaimFiles.map((file, idx) => {
                      const key = String(file.filename || file.fileName || file.name || idx);
                      const checked = eclaimSelected.has(key);
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
                          <td className="table-cell-nowrap">{key}</td>
                          <td className="table-cell-nowrap">{String(file.type || file.fileType || '-')}</td>
                          <td className="table-cell-nowrap">{String(file.period || file._period || '-')}</td>
                          <td className="table-cell-nowrap">{String(file.fileSize || file.size || '-')}</td>
                          <td className="table-cell-nowrap">{String(file.uploadDate || file.date || file.createdAt || '-')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {eclaimFiles.length === 0 && !eclaimLoading && eclaimToken && (
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
                    <th>ประเภท</th>
                    <th>Sheet</th>
                    <th>แถวข้อมูล</th>
                    <th>สถานะ</th>
                    <th>Progress</th>
                    <th>ข้อความ</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setActivePreviewId(item.id)}
                      className={item.id === activePreview?.id ? 'repstm-row-active' : 'repstm-row'}
                    >
                      <td>
                        <div className="repstm-file-name" title={item.fileName}>{item.fileName}</div>
                        <div className="repstm-file-subpath" title={item.relativePath || '-'}>{item.relativePath || '-'}</div>
                      </td>
                      <td className="table-cell-nowrap">{item.detectedType || '-'}</td>
                      <td className="table-cell-nowrap">{item.sheetName || '-'}</td>
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
                              width: `${statusPercentMap[item.status]}%`,
                              background: statusColorMap[item.status],
                            }} />
                          </div>
                          <span className="repstm-progress-percent">
                            {statusPercentMap[item.status]}%
                          </span>
                        </div>
                      </td>
                      <td className="repstm-message-cell">{item.message || '-'}</td>
                    </tr>
                  ))}
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
          <span className="badge badge-primary">{previewRows.length.toLocaleString()} แถว</span>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(420px, 1.5fr)', gap: 16 }}>
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
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          <div className="repstm-file-name" title={batch.source_filename}>{batch.source_filename}</div>
                          <div className="repstm-file-subpath" title={batch.sheet_name || '-'}>
                            Sheet: {batch.sheet_name || '-'}
                          </div>
                        </td>
                        <td className="table-cell-nowrap">{batch.imported_by || '-'}</td>
                        <td className="table-cell-nowrap">{Number(batch.row_count || 0).toLocaleString()}</td>
                        <td className="repstm-message-cell">{batch.notes || '-'}</td>
                        <td className="table-cell-nowrap">{String(batch.created_at || '-')}</td>
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
              <div className="modal-table-wrap">
                <table className="data-table">
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
                            <td className="table-cell-nowrap">{row.tran_id || '-'}</td>
                            <td className="table-cell-nowrap">{row.rep_no || '-'}</td>
                            <td className="table-cell-nowrap">{row.hn || '-'}</td>
                            <td className="table-cell-nowrap">{row.vn || row.an || '-'}</td>
                            <td>{row.patient_name || String(raw['ชื่อ-สกุล'] ?? '-')}</td>
                            <td className="table-cell-nowrap">{row.department || '-'}</td>
                            <td className="table-cell-nowrap">{row.compensated != null ? Number(row.compensated).toLocaleString() : '-'}</td>
                            <td className="table-cell-nowrap">{row.income != null ? Number(row.income).toLocaleString() : '-'}</td>
                            <td className="table-cell-nowrap">{row.diff != null ? Number(row.diff).toLocaleString() : '-'}</td>
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
    </div>
  );
};
