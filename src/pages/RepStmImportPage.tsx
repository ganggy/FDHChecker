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
import {
  detectRepstmImportType,
  detectTypeFromFileName,
  detectTypeFromSheetName,
  isDataSheetZero,
  includeAuditSupplement,
  type RepstmImportType,
} from '../utils/repstmImportClassification';
import { RepStmImportDetail } from '../components/RepStmImportDetail';
import { collectRowHeaders, parseWorksheetRows } from '../utils/repstmWorksheetParsing';
import { fetchMe } from '../services/authService';
import { CsopSyncPanel } from '../components/CsopSyncPanel';

const extractFiveDigitCodeFromText = (value: unknown): string => {
  if (value == null) return '';
  const raw = String(value).trim();
  if (/^\d{5}$/.test(raw)) return raw;
  const match = raw.match(/(?:^|[^0-9])(\d{5})(?:$|[^0-9])/);
  return match ? match[1] : '';
};

const HCODE_COLUMN_KEYS = ['hospcode', 'hcode', 'hospital_code', 'รหัสหน่วยบริการ', 'หน่วยบริการ'];

const verifyImportRowsHcode = (
  rows: Record<string, unknown>[],
  fileName: string,
  expectedHcode: string | null,
): { valid: boolean; detectedHcode: string; error?: string } => {
  const found = new Set<string>();
  const sampleLimit = Math.min(rows.length, 300);
  for (let i = 0; i < sampleLimit; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      const normKey = k.trim().toLowerCase().replace(/[\s_-]+/g, '');
      if (HCODE_COLUMN_KEYS.some((cand) => normKey === cand.replace(/[\s_-]+/g, ''))) {
        const code = extractFiveDigitCodeFromText(v);
        if (code) found.add(code);
      }
    }
  }
  const fileHcodeMatch = fileName ? fileName.match(/(?:^|[_-])(\d{5})(?:[_.-]|$)/) : null;
  if (found.size === 0 && fileHcodeMatch) {
    found.add(fileHcodeMatch[1]);
  }
  if (expectedHcode && (found.has(expectedHcode) || fileHcodeMatch?.[1] === expectedHcode)) {
    return { valid: true, detectedHcode: expectedHcode };
  }
  const codes = [...found];
  if (codes.length > 1) {
    return {
      valid: false,
      detectedHcode: codes.join(', '),
      error: `พบหลายรหัสหน่วยบริการปะปนกันในไฟล์เดียว (${codes.join(', ')}) กรุณาแยกไฟล์ตามหน่วยบริการ`,
    };
  }
  const detectedHcode = codes[0] || '';
  if (expectedHcode && detectedHcode && detectedHcode !== expectedHcode) {
    return {
      valid: false,
      detectedHcode,
      error: `รหัสหน่วยบริการในไฟล์ (${detectedHcode}) ไม่ตรงกับหน่วยบริการของคุณ (${expectedHcode}) — ป้องกันข้อมูล REP/STM ปะปนกัน`,
    };
  }
  return { valid: true, detectedHcode };
};

type ImportType = RepstmImportType;

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

const getEclaimFileKey = (file: Record<string, unknown>, index = 0) => [
  String(file.period || file._period || ''),
  String(file.filename || file.fileName || file.name || ''),
  String(file.downloadHref || ''),
  String(file.downloadOnclick || ''),
  String(index),
].join('|');

const detectImportType = detectRepstmImportType;

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
    if (isDataSheetZero(sheetName)) return true;
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
    return [...primaryResults, ...classifiedResults.filter(item => item.isSubfile && includeAuditSupplement(item.sheetName, item.hintType, includeSubfiles))];
  }

  // Fallback: try first sheet without a hint if nothing matched
  if (results.length === 0 && workbook.SheetNames.length > 0) {
    const firstSheet = workbook.SheetNames[0];
    const parsed = parseWorksheetRows(workbook.Sheets[firstSheet], null);
    if (parsed.rows.length > 0) {
      results.push({ sheetName: firstSheet, rows: parsed.rows, headers: parsed.headers, hintType: null, isSubfile: false });
    }
  }

  return classifiedResults.length ? classifiedResults : results;
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
  const [expectedHcode, setExpectedHcode] = useState<string | null>(null);
  const [facilityGroupLabel, setFacilityGroupLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // NHSO eclaim All-in-One Auto Download state
  const today = new Date();
  const currentFiscalStartYearCE = today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1;
  const prevFiscalStartYearCE = currentFiscalStartYearCE - 1;
  const currentFiscalStart = `${currentFiscalStartYearCE}-10-01`;
  const prevFiscalStart = `${prevFiscalStartYearCE}-10-01`;
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const [eclaimOpen, setEclaimOpen] = useState(false);
  const [eclaimShowSettings, setEclaimShowSettings] = useState(false);
  const [eclaimShowArchive, setEclaimShowArchive] = useState(false);
  const [eclaimUsername, setEclaimUsername] = useState('');
  const [eclaimPassword, setEclaimPassword] = useState('');
  const [eclaimHasPassword, setEclaimHasPassword] = useState(false);
  const [eclaimLoginMode, setEclaimLoginMode] = useState<'auto' | 'password' | 'thaid'>('auto');
  const [eclaimSaveLocalArchive, setEclaimSaveLocalArchive] = useState(true);
  const [eclaimSkipExisting, setEclaimSkipExisting] = useState(true);
  const [eclaimSyncSmtBudget, setEclaimSyncSmtBudget] = useState(true);
  const [eclaimAutoSyncInterval, setEclaimAutoSyncInterval] = useState(0);
  const [eclaimSavingSettings, setEclaimSavingSettings] = useState(false);
  const [eclaimSettingsMsg, setEclaimSettingsMsg] = useState<string | null>(null);
  const [eclaimFunds, setEclaimFunds] = useState<string[]>(['UCS', 'OFC', 'LGO', 'BKK', 'SSS']);
  const [eclaimStartDate, setEclaimStartDate] = useState(prevFiscalStart);
  const [eclaimEndDate, setEclaimEndDate] = useState(todayStr);
  const [eclaimFileType, setEclaimFileType] = useState<'REP' | 'STM' | 'INV' | 'ALL'>('ALL');
  const [eclaimBrowserLoading, setEclaimBrowserLoading] = useState(false);
  const [eclaimBrowserReady, setEclaimBrowserReady] = useState(false);
  const [eclaimBrowserAlive, setEclaimBrowserAlive] = useState(false);
  const [eclaimBrowserPhase, setEclaimBrowserPhase] = useState('closed');
  const [eclaimBrowserMessage, setEclaimBrowserMessage] = useState('ยังไม่ได้เริ่มเชื่อมต่อ NHSO e-Claim');
  const [eclaimScreenshotDataUrl, setEclaimScreenshotDataUrl] = useState<string | null>(null);
  const [eclaimQrCodeDataUrl, setEclaimQrCodeDataUrl] = useState<string | null>(null);
  const [eclaimQrTimerText, setEclaimQrTimerText] = useState<string | null>(null);
  const [eclaimQrRefCode, setEclaimQrRefCode] = useState<string | null>(null);
  const [eclaimQrModalOpen, setEclaimQrModalOpen] = useState(false);
  const [eclaimLoading, setEclaimLoading] = useState(false);
  const [eclaimSearchProgress, setEclaimSearchProgress] = useState<string | null>(null);
  const eclaimStopSearchRef = useRef(false);
  const [eclaimError, setEclaimError] = useState<string | null>(null);
  const [eclaimFiles, setEclaimFiles] = useState<Record<string, unknown>[]>([]);
  const [eclaimSelected, setEclaimSelected] = useState<Set<string>>(new Set());
  const [eclaimDownloading, setEclaimDownloading] = useState(false);
  const [eclaimAutoDownload, setEclaimAutoDownload] = useState(true);
  const [eclaimAutoImport, setEclaimAutoImport] = useState(true);
  const [eclaimPipeline, setEclaimPipeline] = useState<Record<string, EclaimPipelineState>>({});
  const [eclaimDebugLog, setEclaimDebugLog] = useState<{ period: string; url: string; title: string; rowCount: number; htmlSnippet: string }[]>([]);
  const [eclaimShowDebug, setEclaimShowDebug] = useState(false);
  const [eclaimSmtSyncMessage, setEclaimSmtSyncMessage] = useState<string | null>(null);
  const [eclaimArchiveDir, setEclaimArchiveDir] = useState('');
  const [eclaimArchiveFiles, setEclaimArchiveFiles] = useState<Array<{ relativePath: string; filename: string; size: number; modifiedAt: string }>>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importModalTab, setImportModalTab] = useState<'all' | 'active' | 'success' | 'error' | 'duplicate'>('all');
  const [eclaimTableFilter, setEclaimTableFilter] = useState<'all' | 'new' | 'success' | 'error' | 'duplicate'>('new');
  const [queueTableFilter, setQueueTableFilter] = useState<'all' | 'ready' | 'success' | 'error' | 'duplicate'>('all');
  const [currentActiveFileLabel, setCurrentActiveFileLabel] = useState<string | null>(null);
  const [currentActiveFileType, setCurrentActiveFileType] = useState<string | null>(null);
  const [currentActiveFileFund, setCurrentActiveFileFund] = useState<string | null>(null);
  const [currentActiveStepLabel, setCurrentActiveStepLabel] = useState<string | null>(null);
  const [eclaimPeriodProgress, setEclaimPeriodProgress] = useState<{ current: number; total: number; period: string } | null>(null);

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

  const liveDashboardStats = useMemo(() => {
    const isWorking = eclaimLoading || eclaimDownloading || importing || queueItems.some((item) => item.status === 'parsing' || item.status === 'importing');
    const byType: Record<'REP' | 'STM' | 'INV', { total: number; newCount: number; active: number; success: number; duplicate: number; error: number; rows: number }> = {
      REP: { total: 0, newCount: 0, active: 0, success: 0, duplicate: 0, error: 0, rows: 0 },
      STM: { total: 0, newCount: 0, active: 0, success: 0, duplicate: 0, error: 0, rows: 0 },
      INV: { total: 0, newCount: 0, active: 0, success: 0, duplicate: 0, error: 0, rows: 0 },
    };

    type UnifiedItem = {
      id: string;
      filename: string;
      type: 'REP' | 'STM' | 'INV' | 'OTHER';
      fund: string;
      period: string;
      category: 'active' | 'ready' | 'success' | 'duplicate' | 'error';
      badgeLabel: string;
      detail: string;
      rowCount: number;
    };
    const unifiedItems: UnifiedItem[] = [];

    let totalFiles = 0;
    let newFilesCount = 0;
    let downloadingCount = 0;
    let importingCount = 0;
    let activeCount = 0;
    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const totalImportedRows = queueItems
      .filter((q) => q.status === 'success')
      .reduce((sum, q) => sum + Number(q.rowCount || 0), 0);

    // Map queue items by stem for row count enrichment
    const queueRowsByStem = new Map<string, number>();
    for (const q of queueItems) {
      const stem = q.fileName.replace(/\.(xlsx?|csv|zip)$/i, '').toLowerCase();
      queueRowsByStem.set(stem, (queueRowsByStem.get(stem) || 0) + Number(q.rowCount || 0));
      if (q.detectedType && byType[q.detectedType] && q.status === 'success') {
        byType[q.detectedType].rows += Number(q.rowCount || 0);
      }
    }

    if (eclaimFiles.length > 0 || eclaimLoading || eclaimDownloading) {
      totalFiles = eclaimFiles.length;
      eclaimFiles.forEach((file, idx) => {
        const key = getEclaimFileKey(file, idx);
        const fname = String(file.filename || file.fileName || file.name || `file_${idx + 1}`);
        const rawType = String(file.detectedType || '').toUpperCase();
        const fType: 'REP' | 'STM' | 'INV' | 'OTHER' = rawType === 'REP' || rawType === 'STM' || rawType === 'INV' ? rawType : 'OTHER';
        const fund = String(file.fund || '-');
        const period = String(file.period || file._period || '-');
        const alreadyImported = Boolean(file.alreadyImported);
        const pipe = eclaimPipeline[key];
        const stem = fname.replace(/\.(xlsx?|csv|zip)$/i, '').toLowerCase();
        const matchedRows = queueRowsByStem.get(stem) || 0;

        if (!alreadyImported) newFilesCount += 1;
        if (fType !== 'OTHER') {
          byType[fType].total += 1;
          if (!alreadyImported) byType[fType].newCount += 1;
        }

        let category: UnifiedItem['category'] = 'ready';
        let badgeLabel = alreadyImported ? '☑️ มีในระบบแล้ว' : '🆕 รอดำเนินการ';
        const detail = pipe?.message || (alreadyImported ? `มีในระบบแล้ว #${String(file.importedBatchId || '-')}` : 'พร้อมดาวน์โหลด');

        if (pipe) {
          if (pipe.status === 'downloading' || pipe.status === 'downloaded') {
            category = 'active';
            downloadingCount += 1;
            activeCount += 1;
            badgeLabel = pipe.status === 'downloading' ? '⬇️ กำลังโหลด' : '📥 โหลดแล้ว/รอตรวจ';
            if (fType !== 'OTHER') byType[fType].active += 1;
          } else if (pipe.status === 'importing') {
            category = 'active';
            importingCount += 1;
            activeCount += 1;
            badgeLabel = '⟳ กำลังนำเข้า';
            if (fType !== 'OTHER') byType[fType].active += 1;
          } else if (pipe.status === 'success') {
            category = 'success';
            successCount += 1;
            badgeLabel = '✅ นำเข้าสำเร็จ';
            if (fType !== 'OTHER') byType[fType].success += 1;
          } else if (pipe.status === 'duplicate') {
            category = 'duplicate';
            duplicateCount += 1;
            badgeLabel = '☑️ มีข้อมูลแล้ว';
            if (fType !== 'OTHER') byType[fType].duplicate += 1;
          } else if (pipe.status === 'error') {
            category = 'error';
            errorCount += 1;
            badgeLabel = '❌ ผิดพลาด';
            if (fType !== 'OTHER') byType[fType].error += 1;
          }
        } else if (alreadyImported) {
          category = 'duplicate';
          duplicateCount += 1;
          if (fType !== 'OTHER') byType[fType].duplicate += 1;
        }

        unifiedItems.push({
          id: key,
          filename: fname,
          type: fType,
          fund,
          period,
          category,
          badgeLabel,
          detail,
          rowCount: matchedRows,
        });
      });
    } else {
      totalFiles = queueItems.length;
      newFilesCount = queueItems.length;
      queueItems.forEach((item) => {
        const fType: 'REP' | 'STM' | 'INV' | 'OTHER' = item.detectedType || 'OTHER';
        if (fType !== 'OTHER') {
          byType[fType].total += 1;
          byType[fType].newCount += 1;
        }
        let category: UnifiedItem['category'] = 'ready';
        let badgeLabel = statusLabelMap[item.status] || item.status;
        if (item.status === 'parsing' || item.status === 'importing') {
          category = 'active';
          activeCount += 1;
          if (item.status === 'parsing') downloadingCount += 1;
          else importingCount += 1;
          badgeLabel = item.status === 'parsing' ? '🔍 กำลังอ่านไฟล์' : '⟳ กำลังนำเข้า';
          if (fType !== 'OTHER') byType[fType].active += 1;
        } else if (item.status === 'success') {
          category = 'success';
          successCount += 1;
          badgeLabel = '✅ นำเข้าสำเร็จ';
          if (fType !== 'OTHER') byType[fType].success += 1;
        } else if (item.status === 'duplicate') {
          category = 'duplicate';
          duplicateCount += 1;
          badgeLabel = '☑️ มีข้อมูลแล้ว';
          if (fType !== 'OTHER') byType[fType].duplicate += 1;
        } else if (item.status === 'error') {
          category = 'error';
          errorCount += 1;
          badgeLabel = '❌ ผิดพลาด';
          if (fType !== 'OTHER') byType[fType].error += 1;
        }

        unifiedItems.push({
          id: item.id,
          filename: item.fileName,
          type: fType,
          fund: item.importerLabel || '-',
          period: item.sheetName || '-',
          category,
          badgeLabel,
          detail: item.message || '-',
          rowCount: item.rowCount,
        });
      });
    }

    // Calculate smooth overall progress percentage
    let progressPercent = overallProgress;
    if (eclaimFiles.length > 0 || eclaimLoading || eclaimDownloading) {
      const targetWorkCount = Math.max(newFilesCount, successCount + errorCount + activeCount, 1);
      const finishedWorkCount = successCount + errorCount;
      const fileRatio = Math.min(1, (finishedWorkCount + activeCount * 0.45) / targetWorkCount);
      if (eclaimLoading && eclaimPeriodProgress && eclaimPeriodProgress.total > 0) {
        const periodRatio = eclaimPeriodProgress.current / eclaimPeriodProgress.total;
        progressPercent = Math.min(98, Math.max(5, Math.round((periodRatio * 0.55 + fileRatio * 0.45) * 100)));
      } else if (eclaimDownloading || importing) {
        progressPercent = Math.min(98, Math.max(10, Math.round(fileRatio * 100)));
      } else if (finishedWorkCount > 0 || duplicateCount > 0) {
        progressPercent = 100;
      } else {
        progressPercent = 0;
      }
    }

    // Sort unifiedItems so active -> error -> success -> ready -> duplicate appear in the most helpful order
    const orderWeight: Record<UnifiedItem['category'], number> = {
      active: 1,
      error: 2,
      success: 3,
      ready: 4,
      duplicate: 5,
    };
    const sortedUnified = [...unifiedItems].sort((a, b) => orderWeight[a.category] - orderWeight[b.category]);

    return {
      isWorking,
      byType,
      totalFiles,
      newFilesCount,
      downloadingCount,
      importingCount,
      activeCount,
      successCount,
      duplicateCount,
      errorCount,
      totalImportedRows,
      progressPercent,
      unifiedItems: sortedUnified,
    };
  }, [eclaimFiles, eclaimPipeline, eclaimLoading, eclaimDownloading, importing, queueItems, overallProgress, eclaimPeriodProgress]);

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

  // Load current user's facility HCODE or active site hospital_code for REP/STM isolation check
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await fetchMe().catch(() => null);
        if (!active) return;
        if (session?.user?.display_name || session?.user?.username) {
          setImportedBy(session.user.display_name || session.user.username);
        }
        if (session?.user?.group_name) {
          setFacilityGroupLabel(session.user.group_name);
        }
        if (session?.user?.hcode && /^\d{5}$/.test(session.user.hcode)) {
          setExpectedHcode(session.user.hcode);
          return;
        }
        const res = await fetch('/api/config/app-settings').catch(() => null);
        const json = await res?.json().catch(() => null);
        const code = String(json?.data?.hospital_code || json?.hospital_code || '').trim();
        if (active && /^\d{5}$/.test(code)) {
          setExpectedHcode(code);
        }
      } catch {
        // ignore
      }
    })();
    return () => { active = false; };
  }, []);

  const loadEclaimArchiveFiles = async () => {
    try {
      const res = await fetch('/api/nhso-eclaim/archive-files');
      const json = await res.json() as {
        success?: boolean;
        archiveDir?: string;
        files?: Array<{ relativePath: string; filename: string; size: number; modifiedAt: string }>;
      };
      if (json.success) {
        setEclaimArchiveDir(String(json.archiveDir || ''));
        setEclaimArchiveFiles(Array.isArray(json.files) ? json.files : []);
      }
    } catch {
      // ignore
    }
  };

  // Load saved NHSO All-in-One settings on mount
  useEffect(() => {
    fetch('/api/config/nhso-eclaim-settings')
      .then((r) => r.json())
      .then((json: {
        success?: boolean;
        data?: {
          username?: string;
          hasPassword?: boolean;
          loginMode?: 'auto' | 'password' | 'thaid';
          saveLocalArchive?: boolean;
          skipExistingFiles?: boolean;
          syncSmtBudgetOnRun?: boolean;
          autoSyncIntervalMinutes?: number;
        };
      }) => {
        if (!json?.success || !json.data) return;
        const d = json.data;
        if (d.username !== undefined) setEclaimUsername(String(d.username || ''));
        setEclaimHasPassword(Boolean(d.hasPassword));
        if (d.loginMode && ['auto', 'password', 'thaid'].includes(d.loginMode)) {
          setEclaimLoginMode(d.loginMode);
        }
        if (d.saveLocalArchive !== undefined) setEclaimSaveLocalArchive(Boolean(d.saveLocalArchive));
        if (d.skipExistingFiles !== undefined) setEclaimSkipExisting(Boolean(d.skipExistingFiles));
        if (d.syncSmtBudgetOnRun !== undefined) setEclaimSyncSmtBudget(Boolean(d.syncSmtBudgetOnRun));
        if (d.autoSyncIntervalMinutes !== undefined) setEclaimAutoSyncInterval(Number(d.autoSyncIntervalMinutes) || 0);
      })
      .catch(() => {/* ignore */});
    void loadEclaimArchiveFiles();
  }, []);

  const handleSaveEclaimSettings = async () => {
    setEclaimSavingSettings(true);
    setEclaimSettingsMsg(null);
    setEclaimError(null);
    try {
      const res = await fetch('/api/config/nhso-eclaim-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: eclaimUsername.trim(),
          password: eclaimPassword ? eclaimPassword : '********',
          loginMode: eclaimLoginMode,
          saveLocalArchive: eclaimSaveLocalArchive,
          skipExistingFiles: eclaimSkipExisting,
          syncSmtBudgetOnRun: eclaimSyncSmtBudget,
          autoSyncIntervalMinutes: eclaimAutoSyncInterval,
        }),
      });
      const json = await res.json() as { success?: boolean; message?: string; error?: string; data?: { hasPassword?: boolean } };
      if (!json.success) throw new Error(json.error || 'บันทึกการตั้งค่าไม่สำเร็จ');
      if (json.data?.hasPassword !== undefined) setEclaimHasPassword(Boolean(json.data.hasPassword));
      setEclaimPassword('');
      setEclaimSettingsMsg(json.message || 'บันทึกการตั้งค่า NHSO All-in-One สำเร็จ');
    } catch (err) {
      setEclaimError(err instanceof Error ? err.message : 'บันทึกการตั้งค่าไม่สำเร็จ');
    } finally {
      setEclaimSavingSettings(false);
    }
  };

  const eclaimLoginInFlightRef = useRef(false);

  useEffect(() => {
    if (!eclaimOpen) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await fetch('/api/nhso-eclaim/browser-status', { cache: 'no-store' });
        const status = await response.json() as {
          alive?: boolean;
          launching?: boolean;
          ready?: boolean;
          phase?: string;
          message?: string;
          error?: string | null;
          screenshotDataUrl?: string | null;
          qrCodeDataUrl?: string | null;
          qrTimerText?: string | null;
          qrRefCode?: string | null;
        };
        if (!active) return;
        const phase = String(status.phase || 'closed');
        // Do not overwrite loading state if browser-login request just started and server status hasn't flipped yet
        if (eclaimLoginInFlightRef.current && phase === 'closed' && !status.launching && !status.error) {
          return;
        }
        setEclaimBrowserAlive(Boolean(status.alive));
        setEclaimBrowserReady(Boolean(status.ready));
        setEclaimBrowserPhase(phase);
        if (status.message) setEclaimBrowserMessage(String(status.message));
        if (status.error) setEclaimError(status.error);
        if (status.screenshotDataUrl) {
          setEclaimScreenshotDataUrl(status.screenshotDataUrl);
        } else if (status.ready || !status.alive) {
          setEclaimScreenshotDataUrl(null);
        }
        setEclaimQrCodeDataUrl(status.qrCodeDataUrl || null);
        setEclaimQrTimerText(status.qrTimerText || null);
        setEclaimQrRefCode(status.qrRefCode || null);
        if (status.ready) {
          setEclaimQrModalOpen(false);
        }
        if (status.launching) {
          setEclaimBrowserLoading(true);
        } else if (!eclaimLoginInFlightRef.current && (status.ready || status.alive || ['closed', 'expired', 'error'].includes(phase))) {
          setEclaimBrowserLoading(false);
        }
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
    updateQueueItem(id, (item) => {
      const hcodeCheck = verifyImportRowsHcode(item.rows, item.fileName, expectedHcode);
      if (!hcodeCheck.valid) {
        return {
          ...item,
          detectedType: importerType,
          status: 'error',
          message: `⛔ ${hcodeCheck.error}`,
        };
      }
      return {
        ...item,
        detectedType: importerType,
        status: item.rows.length > 0 && item.status !== 'importing' && item.status !== 'success' ? 'ready' : item.status,
        message: item.rows.length > 0
          ? `เลือกตัวนำเข้า ${importerType} โดยผู้ใช้ · ${item.rows.length.toLocaleString()} แถวพร้อมนำเข้า`
          : item.message,
      };
    });
  };

  const changeAllQueueImporters = (importerType: ImportType) => {
    setQueueItems((current) =>
      current.map((item) => {
        if (item.status === 'importing' || item.status === 'success') return item;
        const hcodeCheck = verifyImportRowsHcode(item.rows, item.fileName, expectedHcode);
        if (!hcodeCheck.valid) {
          return {
            ...item,
            detectedType: importerType,
            status: 'error',
            message: `⛔ ${hcodeCheck.error}`,
          };
        }
        return {
          ...item,
          detectedType: importerType,
          status: item.rows.length > 0 ? 'ready' : item.status,
          message: item.rows.length > 0
            ? `เลือกตัวนำเข้า ${importerType} โดยผู้ใช้ · ${item.rows.length.toLocaleString()} แถวพร้อมนำเข้า`
            : item.message,
        };
      })
    );
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
    eclaimLoginInFlightRef.current = true;
    setEclaimError(null);
    setEclaimBrowserReady(false);
    setEclaimBrowserLoading(true);
    setEclaimBrowserPhase('opening');
    setEclaimBrowserMessage('กำลังเตรียม Browser และเปิดหน้า Login NHSO e-Claim...');
    try {
      const res = await fetch('/api/nhso-eclaim/browser-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginMode: eclaimLoginMode,
          username: eclaimUsername.trim() || undefined,
          password: eclaimPassword || undefined,
        }),
      });
      const json = await res.json() as {
        success: boolean;
        ready?: boolean;
        phase?: string;
        message?: string;
        screenshotDataUrl?: string | null;
        qrCodeDataUrl?: string | null;
        qrTimerText?: string | null;
        qrRefCode?: string | null;
        error?: string;
      };
      if (!json.success) throw new Error(json.error || 'Login ไม่สำเร็จ');
      setEclaimBrowserAlive(true);
      setEclaimBrowserReady(Boolean(json.ready));
      setEclaimBrowserPhase(String(json.phase || 'waiting_thaid'));
      setEclaimBrowserMessage(String(json.message || 'กำลังเชื่อมต่อ NHSO e-Claim'));
      setEclaimBrowserLoading(false);
      if (json.screenshotDataUrl) {
        setEclaimScreenshotDataUrl(json.screenshotDataUrl);
      }
      setEclaimQrCodeDataUrl(json.qrCodeDataUrl || null);
      setEclaimQrTimerText(json.qrTimerText || null);
      setEclaimQrRefCode(json.qrRefCode || null);
      if (json.ready) {
        setEclaimQrModalOpen(false);
      } else {
        setEclaimQrModalOpen(true);
      }
    } catch (err) {
      setEclaimError((err as Error).message);
      setEclaimBrowserLoading(false);
    } finally {
      eclaimLoginInFlightRef.current = false;
    }
  };

  const handleThaIdSelect = async () => {
    setEclaimError(null);
    try {
      const response = await fetch('/api/nhso-eclaim/browser-thaid', { method: 'POST' });
      const json = await response.json() as {
        success?: boolean;
        message?: string;
        screenshotDataUrl?: string | null;
        qrCodeDataUrl?: string | null;
        qrTimerText?: string | null;
        qrRefCode?: string | null;
        error?: string;
      };
      setEclaimBrowserMessage(String(json.message || 'กรุณาสแกน QR ด้วยแอป ThaID'));
      if (!response.ok) throw new Error(json.error || 'เปิดหน้า ThaID ไม่สำเร็จ');
      if (json.screenshotDataUrl) {
        setEclaimScreenshotDataUrl(json.screenshotDataUrl);
      }
      setEclaimQrCodeDataUrl(json.qrCodeDataUrl || null);
      setEclaimQrTimerText(json.qrTimerText || null);
      setEclaimQrRefCode(json.qrRefCode || null);
      setEclaimQrModalOpen(true);
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
    setEclaimScreenshotDataUrl(null);
    setEclaimQrCodeDataUrl(null);
    setEclaimQrTimerText(null);
    setEclaimQrRefCode(null);
    setEclaimQrModalOpen(false);
  };

  const triggerSmtBudgetSync = async (periodsToCover: string[] = eclaimPeriods) => {
    if (!eclaimSyncSmtBudget) return;
    try {
      const fiscalYearsSet = new Set<string>();
      for (const p of periodsToCover) {
        if (/^\d{6}$/.test(p)) {
          const yCE = Number(p.slice(0, 4));
          const mNum = Number(p.slice(4, 6));
          const fyBE = yCE + 543 + (mNum >= 10 ? 1 : 0);
          fiscalYearsSet.add(String(fyBE));
        }
      }
      const fiscalYears = fiscalYearsSet.size > 0
        ? Array.from(fiscalYearsSet).sort((a, b) => Number(b) - Number(a))
        : [String(currentFiscalStartYearCE + 544), String(prevFiscalStartYearCE + 544)];

      let totalSynced = 0;
      const syncedYears: string[] = [];
      for (const budgetYear of fiscalYears) {
        setEclaimSmtSyncMessage(`⟳ กำลังซิงค์ข้อมูลงบโอนเงิน สปสช. (SMT Budget) ปีงบประมาณ ${budgetYear}...`);
        const res = await fetch('/api/smt-budget/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budgetYear }),
        });
        const json = await res.json() as {
          success?: boolean;
          data?: { syncedRecords?: number; total_fetched?: number; inserted_or_updated?: number; budgetYear?: string };
          error?: string;
        };
        if (json.success) {
          const count = Number(json.data?.inserted_or_updated ?? json.data?.total_fetched ?? json.data?.syncedRecords ?? 0);
          totalSynced += count;
          syncedYears.push(budgetYear);
        }
      }
      if (syncedYears.length > 0) {
        setEclaimSmtSyncMessage(
          `✅ ซิงค์งบโอนเงิน สปสช. (SMT Budget ปีงบ ${syncedYears.join(', ')}) สำเร็จ (${totalSynced.toLocaleString()} รายการ)`
        );
      } else {
        setEclaimSmtSyncMessage('⚠️ ซิงค์ SMT Budget ไม่สำเร็จ: ไม่สามารถเชื่อมต่อ SMT ได้');
      }
    } catch (err) {
      setEclaimSmtSyncMessage(`⚠️ ซิงค์ SMT Budget ไม่สำเร็จ: ${err instanceof Error ? err.message : 'เกิดข้อผิดพลาด'}`);
    }
  };

  const handleEclaimSearch = async () => {
    setEclaimError(null);
    setEclaimSmtSyncMessage(null);
    setEclaimFiles([]);
    setEclaimSelected(new Set());
    setEclaimPipeline({});
    setEclaimDebugLog([]);
    eclaimStopSearchRef.current = false;

    if (eclaimPeriods.length === 0) {
      setEclaimError('ช่วงวันที่ไม่ถูกต้อง');
      return;
    }
    if (!eclaimBrowserReady) {
      setEclaimError('กรุณาเชื่อมต่อ / Login เข้าสู่ระบบ NHSO e-Claim ก่อน');
      return;
    }

    try {
      setEclaimLoading(true);
      setImportModalOpen(true);
      setImportModalTab('all');
      if (eclaimSyncSmtBudget) {
        void triggerSmtBudgetSync(eclaimPeriods);
      }

      // Walk backwards from newest month first (e.g. 202610 -> 202609 -> ... -> previous fiscal year)
      const orderedPeriods = [...eclaimPeriods].reverse();
      const accumulatedFiles: Record<string, unknown>[] = [];
      const seenDownloads = new Set<string>();
      const allowedPeriodsSet = new Set(eclaimPeriods);
      let repSupportsPeriodFilter = true;

      for (let idx = 0; idx < orderedPeriods.length; idx++) {
        if (eclaimStopSearchRef.current) break;
        const period = orderedPeriods[idx];
        setEclaimPeriodProgress({ current: idx + 1, total: orderedPeriods.length, period });
        setCurrentActiveStepLabel(`กำลังค้นหาไฟล์จาก สปสช. งวด ${period} (เดือนที่ ${idx + 1}/${orderedPeriods.length})`);
        setEclaimSearchProgress(
          `งวด ${period} (${idx + 1}/${orderedPeriods.length}): กำลังค้นหาไฟล์${accumulatedFiles.length > 0 ? ` (พบสะสม ${accumulatedFiles.length} ไฟล์)` : ''}...`
        );

        const res = await fetch('/api/nhso-eclaim/browser-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            periods: [period],
            fileType: eclaimFileType,
            funds: eclaimFunds,
            // If ValidationMainAction.do has no month/year filter, scrape it deeply on the first pass (idx === 0) and skip on idx > 0
            skipRep: idx > 0 && !repSupportsPeriodFilter,
            maxPagesPerSource: 25,
          }),
        });
        const json = await res.json() as {
          success: boolean;
          data?: Record<string, unknown>[];
          newCount?: number;
          existingCount?: number;
          repHasPeriodFilter?: boolean;
          needRelogin?: boolean;
          debug?: typeof eclaimDebugLog;
          error?: string;
        };
        if (!json.success) {
          if (json.needRelogin) {
            setEclaimBrowserReady(false);
            setEclaimBrowserAlive(true);
            setEclaimBrowserPhase('waiting_thaid');
            setEclaimBrowserMessage('สแกน QR Code ด้านล่างด้วยแอป ThaID บนมือถือเพื่อยืนยันตัวตน');
            setEclaimQrModalOpen(true);
          }
          throw new Error(json.error || `ค้นหางวด ${period} ไม่สำเร็จ`);
        }
        if (idx === 0 && json.repHasPeriodFilter !== undefined) {
          repSupportsPeriodFilter = Boolean(json.repHasPeriodFilter);
        }
        if (json.debug && json.debug.length > 0) {
          setEclaimDebugLog((prev) => [...prev, ...(json.debug || [])]);
        }

        const periodFiles = json.data || [];
        const prevLen = accumulatedFiles.length;
        for (const f of periodFiles) {
          const fPeriod = String(f.period || '');
          if (orderedPeriods.length > 1 && fPeriod && /^\d{6}$/.test(fPeriod) && !allowedPeriodsSet.has(fPeriod)) {
            continue;
          }
          const dedupKey = `${String(f.filename || '')}__${String(f.downloadHref || '')}__${String(f.downloadOnclick || '')}`;
          if (seenDownloads.has(dedupKey)) continue;
          seenDownloads.add(dedupKey);
          accumulatedFiles.push(f);
        }

        const addedCount = accumulatedFiles.length - prevLen;
        if (addedCount > 0 || idx === 0) {
          const snapshot = [...accumulatedFiles];
          setEclaimFiles(snapshot);

          const stepDuplicatePipeline: Record<string, EclaimPipelineState> = {};
          const stepNewKeys = new Set<string>();

          for (let fileIdx = prevLen; fileIdx < snapshot.length; fileIdx++) {
            const file = snapshot[fileIdx];
            const key = getEclaimFileKey(file, fileIdx);
            if (file.alreadyImported) {
              stepDuplicatePipeline[key] = {
                status: 'duplicate',
                message: `มีในระบบแล้ว (Batch #${String(file.importedBatchId || '-')}${file.importedAt ? ` · ${String(file.importedAt)}` : ''})`,
              };
            }
            if (!eclaimSkipExisting || !file.alreadyImported) {
              stepNewKeys.add(key);
            }
          }

          if (Object.keys(stepDuplicatePipeline).length > 0) {
            setEclaimPipeline((current) => ({ ...stepDuplicatePipeline, ...current }));
          }

          if (stepNewKeys.size > 0) {
            setEclaimSelected((current) => {
              const next = new Set(current);
              stepNewKeys.forEach((k) => next.add(k));
              return next;
            });
          }

          // Immediately download & import new files found in this period before stepping back to the older month!
          if (eclaimAutoDownload && stepNewKeys.size > 0 && !eclaimStopSearchRef.current) {
            setEclaimSearchProgress(
              `งวด ${period} (${idx + 1}/${orderedPeriods.length}): กำลังดาวน์โหลดและนำเข้า ${stepNewKeys.size} ไฟล์ใหม่...`
            );
            await handleEclaimDownloadFiles(snapshot, stepNewKeys);
            setEclaimSelected((current) => {
              const next = new Set(current);
              stepNewKeys.forEach((k) => next.delete(k));
              return next;
            });
          }
        }
      }

      setEclaimSearchProgress(null);

      if (accumulatedFiles.length === 0) {
        setEclaimError(`ไม่พบไฟล์สำหรับงวด ${eclaimPeriods.join(', ')} ประเภท ${eclaimFileType}`);
        setEclaimShowDebug(true);
      }
    } catch (err) {
      setEclaimError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setEclaimLoading(false);
      setEclaimSearchProgress(null);
      setCurrentActiveFileLabel(null);
      setCurrentActiveStepLabel(null);
    }
  };

  /** Core download logic — accepts files + selected set directly so it can be called from auto-download */
  const handleEclaimDownloadFiles = async (filesToProcess: Record<string, unknown>[], selectedKeys: Set<string>) => {
    if (selectedKeys.size === 0 || !eclaimBrowserReady) return;
    setEclaimDownloading(true);
    setImportModalOpen(true);
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
    const usedFilenames = new Set<string>();
    const downloadErrors: string[] = [];
    for (let rowIdx = 0; rowIdx < filesToDownload.length; rowIdx += 1) {
      const { file: fileObj, key } = filesToDownload[rowIdx];
      const filename = String(fileObj.filename || fileObj.fileName || fileObj.name || `download_${rowIdx + 1}.xlsx`);
      setCurrentActiveFileLabel(filename);
      setCurrentActiveFileType(String(fileObj.detectedType || ''));
      setCurrentActiveFileFund(String(fileObj.fund || ''));
      setCurrentActiveStepLabel(`กำลังดาวน์โหลดไฟล์จาก สปสช. (${rowIdx + 1}/${filesToDownload.length})`);
      try {
        const dlRes = await fetch('/api/nhso-eclaim/browser-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            downloadHref: String(fileObj.downloadHref || ''),
            downloadOnclick: String(fileObj.downloadOnclick || ''),
            downloadLabel: String(fileObj.downloadLabel || ''),
            downloadCandidates: Array.isArray(fileObj.downloadCandidates) ? fileObj.downloadCandidates : undefined,
            cells: Array.isArray(fileObj.cells) ? fileObj.cells : undefined,
            sourcePage: String(fileObj.sourcePage || ''),
            period: String(fileObj.period || fileObj._period || ''),
            detectedType: String(fileObj.detectedType || ''),
            filename,
          }),
        });
        const dlJson = await dlRes.json() as {
          success: boolean;
          base64?: string;
          filename?: string;
          contentType?: string;
          savedArchivePath?: string | null;
          error?: string;
        };
        if (!dlJson.success || !dlJson.base64) throw new Error(dlJson.error || `ดาวน์โหลด ${filename} ไม่สำเร็จ`);
        const binaryStr = atob(dlJson.base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: dlJson.contentType || 'application/octet-stream' });
        let downloadedFilename = dlJson.filename || filename;
        if (!/\.(xlsx|xls|csv|zip)$/i.test(downloadedFilename)) {
          downloadedFilename = `${downloadedFilename}.xls`;
        }
        if (usedFilenames.has(downloadedFilename.toLowerCase())) {
          const extMatch = downloadedFilename.match(/(\.[a-z0-9]+)$/i);
          const ext = extMatch ? extMatch[1] : '.xls';
          const stem = extMatch ? downloadedFilename.slice(0, -ext.length) : downloadedFilename;
          downloadedFilename = `${stem}_${rowIdx + 1}${ext}`;
        }
        usedFilenames.add(downloadedFilename.toLowerCase());
        const dlFile = new File([blob], downloadedFilename, { type: dlJson.contentType || 'application/octet-stream' });
        dataTransfer.items.add(dlFile);
        downloadedKeysByName.set(downloadedFilename, [...(downloadedKeysByName.get(downloadedFilename) || []), key]);
        setEclaimPipeline((current) => ({
          ...current,
          [key]: {
            status: 'downloaded',
            message: dlJson.savedArchivePath
              ? `ดาวน์โหลดและสำรองไฟล์แล้ว (${dlJson.savedArchivePath})`
              : 'ดาวน์โหลดไฟล์แล้ว รอตรวจและนำเข้า',
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : `ดาวน์โหลด ${filename} ไม่สำเร็จ`;
        downloadErrors.push(message);
        setEclaimPipeline((current) => ({ ...current, [key]: { status: 'error', message } }));
      }
    }
    if (dataTransfer.files.length > 0) {
      setCurrentActiveStepLabel(`กำลังตรวจสอบและอ่านโครงสร้างไฟล์ (${dataTransfer.files.length} ไฟล์)...`);
      const parsedItems = await handleFileChange(dataTransfer.files, true);
      const readyForImport = parsedItems.filter((item) => item.status === 'ready' && item.detectedType);
      const parseFailures = parsedItems.filter((item) => item.status === 'error');
      const preflightDuplicates = parsedItems.filter((item) => item.status === 'duplicate');

      preflightDuplicates.forEach((item) => {
        (downloadedKeysByName.get(item.file.name) || []).forEach((key) => {
          setEclaimPipeline((current) => ({
            ...current,
            [key]: { status: 'duplicate', message: item.message || 'มีข้อมูลชุดนี้แล้ว' },
          }));
        });
      });

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
      void loadEclaimArchiveFiles();
    }
    if (downloadErrors.length > 0) setEclaimError(downloadErrors.join(' | '));
    setEclaimDownloading(false);
    if (!eclaimLoading) {
      setCurrentActiveFileLabel(null);
      setCurrentActiveStepLabel(null);
    }
  };

  const handleEclaimDownload = async () => {
    await handleEclaimDownloadFiles(eclaimFiles, eclaimSelected);
  };

  // Optional periodic auto-sync timer while session is ready
  useEffect(() => {
    if (!eclaimBrowserReady || eclaimAutoSyncInterval <= 0) return;
    const intervalMs = eclaimAutoSyncInterval * 60_000;
    const timer = window.setInterval(() => {
      if (!eclaimLoading && !eclaimDownloading) {
        void handleEclaimSearch();
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [eclaimBrowserReady, eclaimAutoSyncInterval, eclaimLoading, eclaimDownloading, eclaimStartDate, eclaimEndDate, eclaimFileType, eclaimFunds]);

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
      setImportModalOpen(true);
      setImportModalTab('all');
    } else if (!activePreviewId && initialQueue[0]) {
      setActivePreviewId(initialQueue[0].id);
    }

    const bufferById = new Map<string, ArrayBuffer>();
    let nextReadIndex = 0;
    const readNext = async () => {
      while (nextReadIndex < initialQueue.length) {
        const queueItem = initialQueue[nextReadIndex++];
        setCurrentActiveFileLabel(queueItem.fileName);
        setCurrentActiveStepLabel('กำลังอ่านไฟล์และตรวจสอบประวัติ...');
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
      // Read REP workbooks even when the primary sheet exists: an older import may lack Data Sheet 0.
      if (expectedType !== 'REP' && preflight && preflightTypeMatches && ['exact', 'name_match', 'content_match'].includes(preflight.status)) {
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
        setCurrentActiveFileLabel(queueItem.fileName);
        setCurrentActiveStepLabel('กำลังวิเคราะห์โครงสร้าง Sheet / ตารางข้อมูล...');
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
          // Server-side archive importers know the source schema exactly. Keep their
          // declared type authoritative; generic column detection sees invoice fields
          // inside STM and would otherwise misclassify CHI STM ZIPs as INV.
          const detectedType = importerId && hintType
            ? hintType
            : isSubfile
              ? hintType || detectImportType(queueItem.relativePath || queueItem.fileName, headers, rows)
              : detectImportType(queueItem.relativePath || queueItem.fileName, headers, rows) || hintType;
          const hcodeCheck = verifyImportRowsHcode(rows, queueItem.fileName, expectedHcode);
          const isReady = rows.length > 0 && Boolean(detectedType) && hcodeCheck.valid;
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
            status: isReady ? 'ready' : 'error',
            progress: isReady ? 60 : 100,
            message: !hcodeCheck.valid
              ? `⛔ ${hcodeCheck.error}`
              : rows.length === 0
                ? 'ไม่พบข้อมูลในไฟล์'
                : detectedType
                  ? `ตรวจพบเป็น ${detectedType}${hcodeCheck.detectedHcode ? ` [หน่วยบริการ: ${hcodeCheck.detectedHcode}]` : ''} (Sheet: ${sheetName}) พร้อมนำเข้า ${rows.length.toLocaleString()} แถว`
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
            const detectedType = importerId && hintType
              ? hintType
              : isSubfile
                ? hintType || detectImportType(queueItem.relativePath || queueItem.fileName, headers, rows)
                : detectImportType(queueItem.relativePath || queueItem.fileName, headers, rows) || hintType;
            const hcodeCheck = verifyImportRowsHcode(rows, queueItem.fileName, expectedHcode);
            const isReady = rows.length > 0 && Boolean(detectedType) && hcodeCheck.valid;
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
              status: (isReady ? 'ready' : 'error') as QueueStatus,
              progress: isReady ? 60 : 100,
              message: !hcodeCheck.valid
                ? `⛔ ${hcodeCheck.error}`
                : rows.length === 0
                  ? `Sheet "${sheetName}": ไม่พบข้อมูล`
                  : detectedType
                    ? `${isSubfile ? 'Sub file ข้อมูลประกอบ' : `ตรวจพบเป็น ${detectedType}`}${hcodeCheck.detectedHcode ? ` [หน่วยบริการ: ${hcodeCheck.detectedHcode}]` : ''} พร้อมนำเข้า ${rows.length.toLocaleString()} แถว`
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
    if (!eclaimLoading && !eclaimDownloading) {
      setCurrentActiveFileLabel(null);
      setCurrentActiveStepLabel(null);
    }
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
      setImportModalOpen(true);
      setError(null);
      setSuccessMessage(null);

      let importedCount = 0;
      let importedRows = 0;
      let duplicateCount = 0;
      let replacedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < targetItems.length; i += 1) {
        const item = targetItems[i];
        if (!item.detectedType) {
          updateQueueItem(item.id, (current) => ({
            ...current,
            status: 'error',
            progress: 100,
            message: 'ไม่สามารถระบุประเภทไฟล์ได้',
          }));
          failedCount += 1;
          outcomes[item.file.name] = { status: 'error', message: 'ระบุประเภทไฟล์ไม่ได้' };
          continue;
        }

        setCurrentActiveFileLabel(item.fileName);
        setCurrentActiveFileType(item.detectedType);
        setCurrentActiveFileFund(item.importerLabel || '');
        setCurrentActiveStepLabel(`กำลังนำเข้า ${item.detectedType} เข้าฐานข้อมูล (${i + 1}/${targetItems.length} · ${item.rowCount.toLocaleString()} แถว)`);

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
              progress: 100,
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
              progress: 100,
              message: result.message || `นำเข้า ${item.detectedType} สำเร็จ ${Number(result.rowCount || 0).toLocaleString()} แถว`,
            }));
          }
        } catch (err) {
          failedCount += 1;
          outcomes[item.file.name] = { status: 'error', message: err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ' };
          updateQueueItem(item.id, (current) => ({
            ...current,
            status: 'error',
            progress: 100,
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
      if (!eclaimLoading && !eclaimDownloading) {
        setCurrentActiveFileLabel(null);
        setCurrentActiveStepLabel(null);
      }
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="page-title">📥 นำเข้า REP / STM / INV</h1>
            <p className="page-subtitle">
              อัปโหลดหลายไฟล์หรือทั้งโฟลเดอร์จาก NHSO แล้วให้ระบบตรวจชนิดไฟล์ <code>REP / STM / INV</code> อัตโนมัติ พร้อมเก็บลงฐาน <code>repstminv</code> เพื่อใช้ตรวจสอบและต่อยอดงาน reconciliation
            </p>
          </div>
          {expectedHcode && (
            <div
              style={{
                background: '#f0fdf4',
                border: '1px solid #86efac',
                color: '#166534',
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <span>🛡️ ตรวจสอบรหัสหน่วยบริการ (ป้องกันข้อมูลปะปน): <code>{expectedHcode}</code></span>
              <span style={{ fontSize: 11, fontWeight: 400, color: '#15803d' }}>
                {facilityGroupLabel ? `กลุ่มสิทธิ์: ${facilityGroupLabel} · ` : ''}รับเฉพาะไฟล์ของหน่วยบริการ {expectedHcode} เท่านั้น
              </span>
            </div>
          )}
        </div>
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
                <small>เช่น Data Drug, Data Instrument, ข้อมูลอุทธรณ์ และผู้พิการ D1 — Data Sheet 0 ใน REP จะเก็บอัตโนมัติ แม้ไม่เลือกช่องนี้ และไม่บวกยอดซ้ำกับไฟล์หลัก</small>
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
            <button
              className="btn btn-secondary"
              onClick={() => navigateFromDashboard('reconciliation', { source: 'dashboard', contextLabel: 'จากหน้ารับ REP/STM' })}
              disabled={importing}
            >
              เปิดหน้ากระทบยอด visit
            </button>
            <button className="btn btn-secondary" onClick={() => navigateFromDashboard('stmZeroAudit', {})} disabled={importing}>
              🔎 ตรวจ STM 0
            </button>
            <button className="btn btn-secondary" onClick={() => navigateFromDashboard('repSheetZeroAudit', {})} disabled={importing}>📄 ตรวจ REP Data Sheet 0</button>
          </div>
        </div>
      </div>

      {/* NHSO All-in-One Auto Download (REP / STM / INV / SMT) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setEclaimOpen((v) => !v)}>
          <div className="card-title">
            🚀 NHSO All-in-One Auto Download (ดึงไฟล์ REP / STM / INV + ซิงค์งบโอนเงินอัตโนมัติในเว็บ)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {eclaimBrowserReady && (
              <span className="badge badge-success" style={{ fontSize: 11 }}>
                ✅ เชื่อมต่อ e-Claim พร้อมใช้งาน
              </span>
            )}
            {eclaimAutoSyncInterval > 0 && eclaimBrowserReady && (
              <span className="badge badge-info" style={{ fontSize: 11 }}>
                ⏱️ Auto-Sync ทุก {eclaimAutoSyncInterval} นาที
              </span>
            )}
            <span style={{ fontSize: 18 }}>{eclaimOpen ? '▲' : '▼'}</span>
          </div>
        </div>
        {eclaimOpen && (
          <div className="card-body">
            <div className="alert alert-info" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span>ℹ️ </span>
                <span>
                  ระบบ <strong>NHSO All-in-One Auto Download</strong> ในตัวเว็บ FDH Checker:
                  รองรับล็อกอินอัตโนมัติ (Username/Password หรือ ThaID QR), กวาดไฟล์ครบทุกกองทุน (<strong>UCS, OFC, LGO, BKK, SSS</strong>) ข้ามหลายหน้าอัตโนมัติ,
                  เช็คไฟล์ที่มีในฐานข้อมูลแล้วเพื่อดึงเฉพาะไฟล์ใหม่, สำรองไฟล์เก็บไว้บน Server และนำเข้าฐานข้อมูลพร้อมซิงค์งบโอนเงิน (SMT) จบในคลิกเดียว
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setEclaimShowSettings((v) => !v)}
                >
                  ⚙️ {eclaimShowSettings ? 'ซ่อนตั้งค่า Auto-Login' : 'ตั้งค่าบัญชี / Auto-Download'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => {
                    setEclaimShowArchive((v) => !v);
                    void loadEclaimArchiveFiles();
                  }}
                >
                  📁 ไฟล์สำรองบน Server ({eclaimArchiveFiles.length})
                </button>
              </div>
            </div>

            {/* Collapsible Settings Drawer */}
            {eclaimShowSettings && (
              <div style={{ background: 'var(--bg-secondary,#f8fafc)', border: '1px solid var(--border-color,#cbd5e1)', borderRadius: 8, padding: 14, marginBottom: 14, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>
                  ⚙️ ตั้งค่าระบบ NHSO All-in-One Auto Download
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">โหมดการเข้าสู่ระบบ (Login Mode)</label>
                    <select
                      className="form-control"
                      value={eclaimLoginMode}
                      onChange={(e) => setEclaimLoginMode(e.target.value as 'auto' | 'password' | 'thaid')}
                    >
                      <option value="auto">อัตโนมัติ (ใช้รหัสผ่านก่อน ถ้าติดให้ใช้ ThaID)</option>
                      <option value="password">ใช้ Username / Password ของ e-Claim</option>
                      <option value="thaid">สแกน QR แอป ThaID เท่านั้น</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Username (NHSO e-Claim)</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="ระบุ Username สำหรับ Auto-Login"
                      value={eclaimUsername}
                      onChange={(e) => setEclaimUsername(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">
                      Password {eclaimHasPassword ? <span style={{ color: '#16a34a', fontWeight: 600 }}>(บันทึกไว้แล้ว)</span> : null}
                    </label>
                    <input
                      type="password"
                      className="form-control"
                      placeholder={eclaimHasPassword ? '•••••••• (เว้นว่างหากไม่เปลี่ยน)' : 'ระบุรหัสผ่าน e-Claim'}
                      value={eclaimPassword}
                      onChange={(e) => setEclaimPassword(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">ตั้งเวลาดึงอัตโนมัติ (ขณะเปิด Session)</label>
                    <select
                      className="form-control"
                      value={eclaimAutoSyncInterval}
                      onChange={(e) => setEclaimAutoSyncInterval(Number(e.target.value) || 0)}
                    >
                      <option value={0}>ปิด (กดดึงด้วยตนเอง)</option>
                      <option value={30}>ทุก 30 นาที</option>
                      <option value={60}>ทุก 1 ชั่วโมง</option>
                      <option value={120}>ทุก 2 ชั่วโมง</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={eclaimSkipExisting}
                      onChange={(e) => setEclaimSkipExisting(e.target.checked)}
                    />
                    <span>ข้ามไฟล์ที่มีในระบบแล้วอัตโนมัติ (ดึงเฉพาะไฟล์ใหม่)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={eclaimSaveLocalArchive}
                      onChange={(e) => setEclaimSaveLocalArchive(e.target.checked)}
                    />
                    <span>สำรองไฟล์ต้นฉบับเก็บไว้บน Server (<code>downloads/nhso-repstm/</code>)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={eclaimSyncSmtBudget}
                      onChange={(e) => setEclaimSyncSmtBudget(e.target.checked)}
                    />
                    <span>ซิงค์ข้อมูลงบโอนเงิน สปสช. (SMT Budget) พร้อมกันอัตโนมัติ</span>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleSaveEclaimSettings()}
                    disabled={eclaimSavingSettings}
                  >
                    {eclaimSavingSettings ? '⟳ กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
                  </button>
                  {eclaimSettingsMsg && (
                    <span style={{ color: '#15803d', fontWeight: 600 }}>{eclaimSettingsMsg}</span>
                  )}
                </div>
              </div>
            )}

            {/* Collapsible Local Archive Drawer */}
            {eclaimShowArchive && (
              <div style={{ background: 'var(--bg-secondary,#f8fafc)', border: '1px solid var(--border-color,#cbd5e1)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>
                    📁 ไฟล์สำรองที่ดาวน์โหลดเก็บไว้บน Server ({eclaimArchiveFiles.length} ไฟล์ล่าสุด)
                    {eclaimArchiveDir && <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-muted)' }}>({eclaimArchiveDir})</span>}
                  </div>
                  <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void loadEclaimArchiveFiles()}>
                    🔄 รีเฟรช
                  </button>
                </div>
                {eclaimArchiveFiles.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', padding: '6px 0' }}>ยังไม่มีไฟล์ในโฟลเดอร์สำรองบน Server</div>
                ) : (
                  <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                    <table className="data-table" style={{ fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th>Path ย่อย (งวด/ประเภท/ชื่อไฟล์)</th>
                          <th>ขนาดไฟล์</th>
                          <th>เวลาที่บันทึก</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eclaimArchiveFiles.map((f) => (
                          <tr key={f.relativePath}>
                            <td><code>{f.relativePath}</code></td>
                            <td>{(f.size / 1024).toFixed(1)} KB</td>
                            <td>{new Date(f.modifiedAt).toLocaleString('th-TH')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Step 1: Login Session (Auto Password or ThaID QR) */}
            <div style={{ background: 'var(--bg-secondary,#f0f4ff)', border: '1px solid var(--border-color,#c7d2fe)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                📋 ขั้นตอนที่ 1 — เชื่อมต่อ NHSO e-Claim ({eclaimLoginMode === 'password' ? 'โหมดรหัสผ่านอัตโนมัติ' : eclaimLoginMode === 'thaid' ? 'โหมดสแกน QR ThaID' : 'โหมดอัตโนมัติ: รหัสผ่าน / ThaID'})
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleBrowserLogin}
                  disabled={eclaimBrowserLoading}
                  style={{ flexShrink: 0 }}
                >
                  {eclaimBrowserLoading
                    ? '⏳ กำลังเตรียมหน้าจอ Login...'
                    : eclaimBrowserAlive && !eclaimBrowserReady
                      ? '🔄 เปิดหน้า Login / ขอ QR ใหม่'
                      : eclaimLoginMode !== 'thaid' && (eclaimUsername || eclaimHasPassword)
                        ? '🔐 เชื่อมต่อ / Auto-Login e-Claim'
                        : '🔐 เริ่ม Login NHSO e-Claim (ThaID)'}
                </button>
                {eclaimBrowserAlive && !eclaimBrowserReady && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ background: '#2563eb', color: '#fff', border: 'none' }}
                      onClick={() => setEclaimQrModalOpen(true)}
                    >
                      🔍 เปิด Popup สแกน QR ThaID
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void handleThaIdSelect()}>
                      📱 สลับไปแสดง QR ThaID
                    </button>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={handleBrowserClose}>
                      ❌ ยกเลิก / ปิด Browser
                    </button>
                  </>
                )}
                {eclaimBrowserReady && !eclaimBrowserLoading && (
                  <>
                    <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 13 }}>
                      ✅ เชื่อมต่อ NHSO e-Claim พร้อมแล้ว — กดปุ่ม All-in-One Auto Sync ด้านล่างได้เลย
                    </span>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={handleBrowserClose}>
                      ❌ ปิด Session Browser
                    </button>
                  </>
                )}
              </div>
              <div style={{ marginTop: 8, color: eclaimBrowserReady ? '#15803d' : '#92400e', fontWeight: 600 }}>
                สถานะ: {eclaimBrowserMessage} <span style={{ opacity: 0.65 }}>({eclaimBrowserPhase})</span>
              </div>
              {eclaimBrowserAlive && !eclaimBrowserReady && eclaimScreenshotDataUrl && (
                <div style={{ marginTop: 10, maxWidth: 860 }}>
                  <img
                    src={eclaimScreenshotDataUrl}
                    alt="หน้าจอสแกน QR ThaID NHSO e-Claim"
                    style={{ display: 'block', width: '100%', maxHeight: 580, objectFit: 'contain', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' }}
                    onClick={() => setEclaimQrModalOpen(true)}
                  />
                </div>
              )}
            </div>

            {/* Centered Popup Modal for scanning ThaID QR Code */}
            {eclaimQrModalOpen && eclaimBrowserAlive && !eclaimBrowserReady && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 9999,
                  background: 'rgba(15, 23, 42, 0.72)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 16,
                }}
                onClick={() => setEclaimQrModalOpen(false)}
              >
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: 14,
                    maxWidth: 880,
                    width: '100%',
                    maxHeight: '92vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.45)',
                    overflow: 'hidden',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    style={{
                      padding: '14px 18px',
                      background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>
                        📱 สแกน QR Code แอป ThaID เพื่อเข้าสู่ระบบ NHSO e-Claim
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                        {eclaimBrowserMessage} ({eclaimBrowserPhase}) — เมื่อสแกนสำเร็จ หน้าต่างนี้จะปิดและพร้อมดึงข้อมูลอัตโนมัติทันที
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px', background: '#fff', color: '#1e3a8a', border: 'none', fontWeight: 600 }}
                        onClick={() => void handleThaIdSelect()}
                      >
                        🔄 สลับ/รีเฟรชหน้า QR ThaID
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px', background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none' }}
                        onClick={() => setEclaimQrModalOpen(false)}
                      >
                        ย่อหน้าต่าง ✕
                      </button>
                    </div>
                  </div>
                  <div style={{ padding: 20, overflowY: 'auto', background: '#f8fafc', textAlign: 'center' }}>
                    {eclaimQrCodeDataUrl ? (
                      <div
                        style={{
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          background: 'linear-gradient(145deg, #2563eb, #1e40af)',
                          color: '#fff',
                          padding: '20px 28px',
                          borderRadius: 16,
                          boxShadow: '0 10px 25px rgba(30, 64, 175, 0.3)',
                          maxWidth: 420,
                          width: '100%',
                        }}
                      >
                        <div style={{ fontSize: 18, fontWeight: 700 }}>เข้าสู่ระบบด้วยแอป ThaID</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>ระบบยืนยันตัวตนแบบรวมศูนย์ (DOPA / สปสช.)</div>
                        {eclaimQrTimerText && (
                          <div
                            style={{
                              marginTop: 8,
                              background: 'rgba(255,255,255,0.18)',
                              padding: '4px 14px',
                              borderRadius: 999,
                              fontWeight: 700,
                              fontSize: 14,
                            }}
                          >
                            ⏱️ หมดเวลาใน : {eclaimQrTimerText} (รีเฟรชอัตโนมัติเมื่อครบเวลา)
                          </div>
                        )}
                        <div
                          style={{
                            marginTop: 14,
                            background: '#ffffff',
                            padding: 12,
                            borderRadius: 12,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          }}
                        >
                          <img
                            src={eclaimQrCodeDataUrl}
                            alt="ThaID QR Code"
                            style={{ display: 'block', width: 280, height: 280, objectFit: 'contain' }}
                          />
                        </div>
                        {eclaimQrRefCode && (
                          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>
                            หมายเลขอ้างอิง : <span style={{ letterSpacing: 1, background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: 6 }}>{eclaimQrRefCode}</span>
                          </div>
                        )}
                        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.85 }}>
                          เปิดแอป ThaID บนมือถือ → กดสแกน QR Code ด้านบน
                        </div>
                      </div>
                    ) : eclaimScreenshotDataUrl ? (
                      <img
                        src={eclaimScreenshotDataUrl}
                        alt="QR Code ThaID NHSO e-Claim"
                        style={{
                          display: 'inline-block',
                          maxWidth: '100%',
                          maxHeight: '72vh',
                          objectFit: 'contain',
                          background: '#fff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 10,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                        }}
                      />
                    ) : (
                      <div style={{ padding: '48px 20px', color: '#475569', fontSize: 14 }}>
                        ⏳ กำลังโหลดภาพหน้าจอ QR Code ของแอป ThaID...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Date range, File type, and Fund filters */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 10 }}>
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
                  <option value="ALL">ทุกประเภท (REP + STM + INV)</option>
                  <option value="REP">REP (ผลการตรวจข้อมูล)</option>
                  <option value="STM">STM (Statement โอนเงิน)</option>
                  <option value="INV">INV (รายงานการเงิน)</option>
                </select>
              </div>
            </div>

            {/* Fund filter checkboxes */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>กองทุนที่ต้องการดึง:</span>
              {[
                { code: 'UCS', label: 'UCS (บัตรทอง)' },
                { code: 'OFC', label: 'OFC (ข้าราชการ)' },
                { code: 'LGO', label: 'LGO (อปท.)' },
                { code: 'BKK', label: 'BKK (กทม.)' },
                { code: 'SSS', label: 'SSS (ประกันสังคม)' },
              ].map((fundItem) => {
                const checked = eclaimFunds.includes(fundItem.code);
                return (
                  <label key={fundItem.code} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEclaimFunds((prev) => Array.from(new Set([...prev, fundItem.code])));
                        } else {
                          setEclaimFunds((prev) => prev.filter((f) => f !== fundItem.code));
                        }
                      }}
                    />
                    <span>{fundItem.label}</span>
                  </label>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                {eclaimPeriods.length > 0 && (
                  <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>งวดที่จะดึง ({eclaimPeriods.length} งวด · ดึงและนำเข้าจากเดือนล่าสุดย้อนหลังไปทีละเดือน):</span>
                    {[...eclaimPeriods].reverse().slice(0, 14).map((p) => (
                      <span key={p} className="badge badge-info" style={{ marginRight: 2 }}>{p}</span>
                    ))}
                    {eclaimPeriods.length > 14 && <span style={{ fontSize: 11 }}>+{eclaimPeriods.length - 14} งวด</span>}
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => {
                          setEclaimStartDate(prevFiscalStart);
                          setEclaimEndDate(todayStr);
                        }}
                      >
                        ปีงบนี้ + ปีงบก่อนหน้า (ค่าเริ่มต้น)
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => {
                          setEclaimStartDate(currentFiscalStart);
                          setEclaimEndDate(todayStr);
                        }}
                      >
                        ปีงบนี้
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => {
                          setEclaimStartDate(firstOfMonth);
                          setEclaimEndDate(todayStr);
                        }}
                      >
                        เฉพาะเดือนนี้
                      </button>
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleEclaimSearch}
                    disabled={eclaimLoading || eclaimDownloading || !eclaimBrowserReady}
                  >
                    {eclaimLoading
                      ? `⟳ ${eclaimSearchProgress || 'กำลังกวาดค้นหาไฟล์ทุกหน้า...'}`
                      : eclaimAutoDownload && eclaimAutoImport
                        ? '🚀 All-in-One Auto Sync (ดึงไฟล์ใหม่ + นำเข้า REP/STM + ซิงค์ SMT)'
                        : '🔍 ค้นหาไฟล์จาก NHSO e-Claim'}
                  </button>
                  {eclaimLoading && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ background: '#f59e0b', color: '#fff', border: 'none' }}
                      onClick={() => {
                        eclaimStopSearchRef.current = true;
                        setEclaimSearchProgress('กำลังหยุดค้นหางวดถัดไป และดึงไฟล์ที่พบแล้ว...');
                      }}
                    >
                      ⏹️ หยุดค้นหางวดถัดไป (ดึงไฟล์ที่พบแล้ว {eclaimFiles.length} ไฟล์ทันที)
                    </button>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={eclaimSkipExisting}
                      onChange={(e) => setEclaimSkipExisting(e.target.checked)}
                    />
                    ดึงเฉพาะไฟล์ใหม่ที่ยังไม่มีในระบบ
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={eclaimAutoDownload}
                      onChange={(e) => setEclaimAutoDownload(e.target.checked)}
                    />
                    ดาวน์โหลดอัตโนมัติทันทีที่พบ
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={eclaimAutoImport}
                      onChange={(e) => setEclaimAutoImport(e.target.checked)}
                    />
                    นำเข้า REP/STM/INV เข้าฐานข้อมูลทันที
                  </label>
                  {eclaimFiles.length > 0 && (
                    <button
                      className="btn btn-success"
                      onClick={handleEclaimDownload}
                      disabled={eclaimDownloading || eclaimSelected.size === 0 || !eclaimBrowserReady}
                    >
                      {eclaimDownloading
                        ? (importing ? '⟳ กำลังนำเข้าข้อมูล...' : '⟳ กำลังดาวน์โหลด/ตรวจไฟล์...')
                        : `⬇️ ดาวน์โหลดไฟล์ที่เลือก${eclaimAutoImport ? 'และนำเข้า' : 'เข้าคิว'} (${eclaimSelected.size} ไฟล์)`}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {eclaimSmtSyncMessage && (
              <div className="alert alert-info" style={{ marginBottom: 12, padding: '8px 12px', fontSize: 12 }}>
                <span>{eclaimSmtSyncMessage}</span>
              </div>
            )}

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

            {eclaimFiles.length > 0 && (() => {
              const filteredEclaimRows = eclaimFiles
                .map((file, idx) => ({ file, idx, key: getEclaimFileKey(file, idx) }))
                .filter(({ file, key }) => {
                  const pipe = eclaimPipeline[key];
                  const already = Boolean(file.alreadyImported);
                  if (eclaimTableFilter === 'new') return !already || (pipe && pipe.status !== 'duplicate');
                  if (eclaimTableFilter === 'success') return pipe?.status === 'success';
                  if (eclaimTableFilter === 'error') return pipe?.status === 'error';
                  if (eclaimTableFilter === 'duplicate') return already || pipe?.status === 'duplicate';
                  return true;
                });
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10, fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {(
                        [
                          { id: 'new', label: `🆕 ไฟล์ใหม่ (${eclaimFiles.filter((f) => !f.alreadyImported).length})` },
                          { id: 'success', label: `✅ นำเข้าแล้ว (${liveDashboardStats.successCount})` },
                          { id: 'error', label: `❌ ผิดพลาด (${liveDashboardStats.errorCount})` },
                          { id: 'duplicate', label: `☑️ มีในระบบแล้ว (${liveDashboardStats.duplicateCount})` },
                          { id: 'all', label: `📋 ทั้งหมด (${eclaimFiles.length})` },
                        ] as const
                      ).map((tab) => {
                        const active = eclaimTableFilter === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setEclaimTableFilter(tab.id)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: active ? 700 : 500,
                              border: active ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                              background: active ? '#eff6ff' : '#fff',
                              color: active ? '#1d4ed8' : '#475569',
                              cursor: 'pointer',
                            }}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: '4px 12px', background: 'linear-gradient(135deg, #2563eb, #0891b2)', border: 'none' }}
                        onClick={() => setImportModalOpen(true)}
                      >
                        📊 เปิด Popup สถานะการนำเข้า ({liveDashboardStats.progressPercent}%)
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => {
                          setEclaimSelected(
                            new Set(
                              eclaimFiles
                                .map((f, idx) => ({ f, key: getEclaimFileKey(f, idx) }))
                                .filter(({ f }) => !f.alreadyImported)
                                .map(({ key }) => key)
                            )
                          );
                        }}
                      >
                        เลือกเฉพาะไฟล์ใหม่
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => setEclaimSelected(new Set(eclaimFiles.map((f, idx) => getEclaimFileKey(f, idx))))}
                      >
                        เลือกทั้งหมด
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => setEclaimSelected(new Set())}
                      >
                        ยกเลิกทั้งหมด
                      </button>
                    </div>
                  </div>
                  <div className="modal-table-wrap" style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                    <table className="data-table long-id-table long-id-table--repstm-latest" style={{ margin: 0 }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
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
                          <th>ประเภท</th>
                          <th>กองทุน</th>
                          <th>งวด</th>
                          <th>สถานะในระบบ</th>
                          <th>ข้อมูลเพิ่มเติม</th>
                          <th>สถานะ Pipeline</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEclaimRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                              ไม่มีรายการในหมวดที่เลือก (กดแท็บ &quot;📋 ทั้งหมด&quot; เพื่อดูทุกรายการ)
                            </td>
                          </tr>
                        ) : filteredEclaimRows.map(({ file, idx, key }) => {
                          const displayName = String(file.filename || file.fileName || file.name || idx);
                          const checked = eclaimSelected.has(key);
                          const cells = Array.isArray(file.cells) ? (file.cells as string[]) : [];
                          const href = String(file.downloadHref || '');
                          const hasOnclick = Boolean(file.downloadOnclick);
                          const alreadyImported = Boolean(file.alreadyImported);
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
                              <td className="table-cell-nowrap" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayName}>{displayName}</td>
                              <td className="table-cell-nowrap">
                                <span className="badge badge-primary" style={{ fontSize: 10 }}>
                                  {String(file.detectedType || '-')}
                                </span>
                              </td>
                              <td className="table-cell-nowrap">
                                <span className="badge badge-info" style={{ fontSize: 10 }}>
                                  {String(file.fund || '-')}
                                </span>
                              </td>
                              <td className="table-cell-nowrap">{String(file.period || file._period || '-')}</td>
                              <td className="table-cell-nowrap">
                                {alreadyImported ? (
                                  <span
                                    className="badge badge-secondary"
                                    style={{ fontSize: 10 }}
                                    title={`Batch #${String(file.importedBatchId || '-')} (${String(file.importedAt || '')})`}
                                  >
                                    ☑️ มีในระบบแล้ว #{String(file.importedBatchId || '-')}
                                  </span>
                                ) : (
                                  <span className="badge badge-success" style={{ fontSize: 10 }}>
                                    🆕 ไฟล์ใหม่
                                  </span>
                                )}
                              </td>
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
                                    {pipeline.status === 'error' && `❌ ผิดพลาด${pipeline.message ? `: ${pipeline.message}` : ''}`}
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
                </div>
              );
            })()}

            {eclaimFiles.length === 0 && !eclaimLoading && eclaimBrowserReady && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                กดปุ่ม <strong>🚀 All-in-One Auto Sync</strong> เพื่อกวาดค้นหาและดึงไฟล์สำหรับงวด {eclaimPeriods.join(', ')} ({eclaimFileType})
              </div>
            )}
          </div>
        )}
      </div>

      <CsopSyncPanel onImportTriggered={() => void loadData(dataType)} />

      <div className="card repstm-status-card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="card-title">สถานะการนำเข้าข้อมูล</div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '4px 12px', background: 'linear-gradient(135deg, #2563eb, #0891b2)', border: 'none' }}
              onClick={() => setImportModalOpen(true)}
            >
              📊 ดูสถานะแบบ Popup ({liveDashboardStats.progressPercent}%)
            </button>
          </div>
          <div className="repstm-chip-row">
            {(
              [
                { id: 'all', label: `ทั้งหมด ${queueItems.length.toLocaleString()}`, cls: 'badge-info' },
                { id: 'ready', label: `พร้อมนำเข้า ${readyItems.length.toLocaleString()}`, cls: 'badge-primary' },
                { id: 'success', label: `สำเร็จ ${successItems.length.toLocaleString()}`, cls: 'badge-success' },
                { id: 'duplicate', label: `เข้าแล้ว ${duplicateItems.length.toLocaleString()}`, cls: 'badge-info' },
                { id: 'error', label: `ผิดพลาด ${errorItems.length.toLocaleString()}`, cls: 'badge-danger' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                className={`badge ${pill.cls}`}
                onClick={() => setQueueTableFilter(pill.id)}
                style={{
                  cursor: 'pointer',
                  border: queueTableFilter === pill.id ? '2px solid #1e293b' : '1px solid transparent',
                  opacity: queueTableFilter === pill.id ? 1 : 0.8,
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body" style={{ padding: 16 }}>
          <div className="repstm-progress-hero">
            <div className="repstm-progress-top" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="repstm-progress-label">ความคืบหน้ารวม</div>
                <div className="repstm-progress-value">{overallProgress}%</div>
              </div>
              <div className="repstm-chip-row" style={{ alignItems: 'center', gap: 8 }}>
                <span className="badge badge-primary">REP {typeSummary.REP}</span>
                <span className="badge badge-info">STM {typeSummary.STM}</span>
                <span className="badge badge-warning">INV {typeSummary.INV}</span>
              </div>
              {queueItems.length > 0 && (
                <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>ปรับทั้งคิวเป็น:</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: '3px 10px', background: '#0284c7', color: '#fff', borderColor: '#0284c7' }}
                    onClick={() => changeAllQueueImporters('STM')}
                    disabled={importing}
                    title="เปลี่ยนตัวนำเข้าของทุกไฟล์ในคิวเป็น STM"
                  >
                    ⚡ เป็น STM ทั้งหมด
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: '3px 10px', background: '#2563eb', color: '#fff', borderColor: '#2563eb' }}
                    onClick={() => changeAllQueueImporters('REP')}
                    disabled={importing}
                    title="เปลี่ยนตัวนำเข้าของทุกไฟล์ในคิวเป็น REP"
                  >
                    ⚡ เป็น REP ทั้งหมด
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: '3px 10px', background: '#d97706', color: '#fff', borderColor: '#d97706' }}
                    onClick={() => changeAllQueueImporters('INV')}
                    disabled={importing}
                    title="เปลี่ยนตัวนำเข้าของทุกไฟล์ในคิวเป็น INV"
                  >
                    ⚡ เป็น INV ทั้งหมด
                  </button>
                </div>
              )}
            </div>
            <div className="repstm-progress-track">
              <div style={{
                width: `${overallProgress}%`,
                background: 'linear-gradient(90deg, #2563eb, #22c55e, #f59e0b)',
              }} />
            </div>
          </div>

          {queueItems.length > 0 ? (
            <div className="modal-table-wrap repstm-table-shell" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <table className="data-table repstm-queue-table" style={{ margin: 0 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
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
                  {queueItems
                    .filter((item) => {
                      if (queueTableFilter === 'ready') return item.status === 'ready' || item.status === 'parsing' || item.status === 'importing';
                      if (queueTableFilter === 'success') return item.status === 'success';
                      if (queueTableFilter === 'duplicate') return item.status === 'duplicate';
                      if (queueTableFilter === 'error') return item.status === 'error';
                      return true;
                    })
                    .map((item) => {
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
      {/* Floating pill when popup is minimized while active or has results */}
      {!importModalOpen && (liveDashboardStats.isWorking || liveDashboardStats.totalFiles > 0) && (
        <button
          type="button"
          onClick={() => setImportModalOpen(true)}
          style={{
            position: 'fixed',
            bottom: 24,
            left: 24,
            zIndex: 9900,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 18px',
            borderRadius: 999,
            border: 'none',
            background: liveDashboardStats.isWorking
              ? 'linear-gradient(135deg, #1d4ed8, #0891b2)'
              : 'linear-gradient(135deg, #0f172a, #1e293b)',
            color: '#fff',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.35)',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          <span>{liveDashboardStats.isWorking ? '⟳' : '📊'}</span>
          <span>
            {liveDashboardStats.isWorking
              ? `กำลังนำเข้า ${liveDashboardStats.progressPercent}% (สำเร็จ ${liveDashboardStats.successCount})`
              : `สรุปนำเข้า: สำเร็จ ${liveDashboardStats.successCount} · REP ${liveDashboardStats.byType.REP.total} · STM ${liveDashboardStats.byType.STM.total}`}
          </span>
        </button>
      )}

      {/* Live Import & Auto-Sync Progress Popup Modal */}
      {importModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            background: 'rgba(15, 23, 42, 0.68)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => {
            if (!liveDashboardStats.isWorking) setImportModalOpen(false);
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 20,
              width: '100%',
              maxWidth: 880,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 60px rgba(15, 23, 42, 0.4)',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '18px 24px',
                background: liveDashboardStats.isWorking
                  ? 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 55%, #0e7490 100%)'
                  : 'linear-gradient(135deg, #0f172a 0%, #065f46 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.16)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  {liveDashboardStats.isWorking ? '🚀' : '✅'}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>
                    {liveDashboardStats.isWorking
                      ? 'กำลังดึงและนำเข้าข้อมูล REP / STM อัตโนมัติ'
                      : 'สรุปผลการดึงและนำเข้าข้อมูล REP / STM'}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                    {currentActiveStepLabel
                      || eclaimSearchProgress
                      || (liveDashboardStats.isWorking
                        ? 'กำลังประมวลผลไฟล์และบันทึกเข้าฐานข้อมูล...'
                        : `ประมวลผลเสร็จสิ้น · พบทั้งหมด ${liveDashboardStats.totalFiles.toLocaleString()} ไฟล์ (ไฟล์ใหม่ ${liveDashboardStats.newFilesCount.toLocaleString()} ไฟล์)`)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {eclaimLoading && (
                  <button
                    type="button"
                    onClick={() => {
                      eclaimStopSearchRef.current = true;
                      setEclaimSearchProgress('กำลังหยุดค้นหางวดถัดไป...');
                    }}
                    style={{
                      background: '#f59e0b',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ⏹️ หยุดค้นหางวดถัดไป
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  style={{
                    background: 'rgba(255,255,255,0.16)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.28)',
                    borderRadius: 8,
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {liveDashboardStats.isWorking ? '🗕 ย่อหน้าต่าง (ทำงานต่อเบื้องหลัง)' : '✕ ปิดหน้าต่าง'}
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 1. Hero Progress Bar + Active File Banner */}
              <div
                style={{
                  background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
                  border: '1px solid #cbd5e1',
                  borderRadius: 14,
                  padding: '16px 18px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                      แถบสถานะความคืบหน้าการนำเข้า (Overall Progress)
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      พบทั้งหมด <strong>{liveDashboardStats.totalFiles.toLocaleString()}</strong> ไฟล์ · ไฟล์ใหม่ <strong>{liveDashboardStats.newFilesCount.toLocaleString()}</strong> ไฟล์
                      {eclaimPeriodProgress ? ` · สแกนงวดเดือน ${eclaimPeriodProgress.current}/${eclaimPeriodProgress.total} (งวด ${eclaimPeriodProgress.period})` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 28,
                        fontWeight: 800,
                        background: 'linear-gradient(135deg, #1d4ed8, #059669)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        lineHeight: 1,
                      }}
                    >
                      {liveDashboardStats.progressPercent}%
                    </span>
                  </div>
                </div>

                {/* Main Progress Bar Track */}
                <div
                  style={{
                    height: 14,
                    borderRadius: 999,
                    background: '#e2e8f0',
                    overflow: 'hidden',
                    boxShadow: 'inset 0 1px 3px rgba(15,23,42,0.12)',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(liveDashboardStats.isWorking ? 6 : 0, liveDashboardStats.progressPercent)}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: liveDashboardStats.errorCount > 0 && liveDashboardStats.successCount === 0 && !liveDashboardStats.isWorking
                        ? 'linear-gradient(90deg, #ef4444, #f97316)'
                        : 'linear-gradient(90deg, #2563eb 0%, #06b6d4 50%, #10b981 100%)',
                      transition: 'width 0.35s ease',
                      boxShadow: '0 0 12px rgba(6, 182, 212, 0.45)',
                    }}
                  />
                </div>

                {/* Current Active File Callout */}
                {(currentActiveFileLabel || liveDashboardStats.isWorking) && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 16 }}>⚡</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 600 }}>
                          {currentActiveStepLabel || eclaimSearchProgress || 'กำลังดำเนินการ...'}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={currentActiveFileLabel || ''}
                        >
                          {currentActiveFileLabel || 'กำลังกวาดรายการไฟล์จากหน้าเว็บ สปสช...'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {currentActiveFileType && (
                        <span className="badge badge-primary" style={{ fontSize: 11 }}>
                          {currentActiveFileType}
                        </span>
                      )}
                      {currentActiveFileFund && (
                        <span className="badge badge-info" style={{ fontSize: 11 }}>
                          {currentActiveFileFund}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {eclaimSmtSyncMessage && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#0369a1', fontWeight: 600 }}>
                    {eclaimSmtSyncMessage}
                  </div>
                )}
              </div>

              {/* 2. 4 Main Status KPI Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                  gap: 10,
                }}
              >
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 700 }}>⏳ กำลังโหลด / กำลังนำเข้า</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#1e3a8a', marginTop: 2 }}>
                    {liveDashboardStats.activeCount.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600 }}>ไฟล์</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2 }}>
                    กำลังโหลด {liveDashboardStats.downloadingCount} · กำลังนำเข้า {liveDashboardStats.importingCount}
                  </div>
                </div>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>✅ นำเข้าสำเร็จ</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#14532d', marginTop: 2 }}>
                    {liveDashboardStats.successCount.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600 }}>ไฟล์</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>
                    รวม {liveDashboardStats.totalImportedRows.toLocaleString()} แถวข้อมูล
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>☑️ มีในระบบแล้ว (ข้าม)</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', marginTop: 2 }}>
                    {liveDashboardStats.duplicateCount.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600 }}>ไฟล์</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    ข้อมูลเคยนำเข้าแล้ว ไม่ซ้ำซ้อน
                  </div>
                </div>

                <div style={{ background: liveDashboardStats.errorCount > 0 ? '#fef2f2' : '#f8fafc', border: `1px solid ${liveDashboardStats.errorCount > 0 ? '#fecaca' : '#cbd5e1'}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, color: liveDashboardStats.errorCount > 0 ? '#b91c1c' : '#64748b', fontWeight: 700 }}>❌ ผิดพลาด</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: liveDashboardStats.errorCount > 0 ? '#7f1d1d' : '#334155', marginTop: 2 }}>
                    {liveDashboardStats.errorCount.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600 }}>ไฟล์</span>
                  </div>
                  <div style={{ fontSize: 11, color: liveDashboardStats.errorCount > 0 ? '#dc2626' : '#94a3b8', marginTop: 2 }}>
                    {liveDashboardStats.errorCount > 0 ? 'กดแท็บ "❌ ผิดพลาด" ด้านล่างเพื่อดูสาเหตุ' : 'ไม่มีรายการผิดพลาด'}
                  </div>
                </div>
              </div>

              {/* 3. Breakdown by File Type: REP vs STM vs INV */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                  gap: 10,
                }}
              >
                {(
                  [
                    { key: 'REP', title: '📘 ไฟล์ REP (ใบตอบรับ)', accent: '#2563eb', bg: '#f8fafc' },
                    { key: 'STM', title: '📗 ไฟล์ STM (Statement)', accent: '#0891b2', bg: '#f8fafc' },
                    { key: 'INV', title: '📙 ไฟล์ INV (Invoice)', accent: '#d97706', bg: '#f8fafc' },
                  ] as const
                ).map(({ key, title, accent, bg }) => {
                  const stat = liveDashboardStats.byType[key];
                  const done = stat.success + stat.duplicate + stat.error;
                  const pct = stat.total > 0 ? Math.round((done / stat.total) * 100) : 0;
                  return (
                    <div
                      key={key}
                      style={{
                        background: bg,
                        border: '1px solid #e2e8f0',
                        borderLeft: `4px solid ${accent}`,
                        borderRadius: 10,
                        padding: '10px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{title}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: accent }}>
                          {stat.total.toLocaleString()} ไฟล์
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: '#475569', marginTop: 6 }}>
                        <span style={{ color: '#15803d', fontWeight: 600 }}>✅ สำเร็จ {stat.success}</span>
                        <span>·</span>
                        <span style={{ color: '#1d4ed8', fontWeight: 600 }}>⏳ กำลังทำ {stat.active}</span>
                        <span>·</span>
                        <span style={{ color: '#475569' }}>☑️ มีแล้ว {stat.duplicate}</span>
                        {stat.error > 0 && (
                          <>
                            <span>·</span>
                            <span style={{ color: '#b91c1c', fontWeight: 700 }}>❌ พลาด {stat.error}</span>
                          </>
                        )}
                      </div>
                      <div style={{ height: 5, borderRadius: 999, background: '#e2e8f0', marginTop: 8, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: accent, transition: 'width 0.3s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 4. Compact Filterable Live File List inside Popup */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                <div
                  style={{
                    background: '#f8fafc',
                    padding: '8px 12px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(
                      [
                        { id: 'all', label: `ทั้งหมด (${liveDashboardStats.unifiedItems.length})` },
                        { id: 'active', label: `⏳ กำลังทำ (${liveDashboardStats.activeCount})` },
                        { id: 'success', label: `✅ สำเร็จ (${liveDashboardStats.successCount})` },
                        { id: 'error', label: `❌ ผิดพลาด (${liveDashboardStats.errorCount})` },
                        { id: 'duplicate', label: `☑️ มีแล้ว (${liveDashboardStats.duplicateCount})` },
                      ] as const
                    ).map((t) => {
                      const active = importModalTab === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setImportModalTab(t.id)}
                          style={{
                            padding: '3px 10px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: active ? 700 : 500,
                            border: active ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                            background: active ? '#eff6ff' : '#fff',
                            color: active ? '#1d4ed8' : '#475569',
                            cursor: 'pointer',
                          }}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    แสดงรายการล่าสุด (เลื่อนดูได้ในกรอบนี้)
                  </span>
                </div>

                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  <table className="data-table" style={{ margin: 0, fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc' }}>
                      <tr>
                        <th>ชื่อไฟล์</th>
                        <th>ประเภท</th>
                        <th>กองทุน / Sheet</th>
                        <th>งวด</th>
                        <th>สถานะ</th>
                        <th>รายละเอียด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const rowsToShow = liveDashboardStats.unifiedItems
                          .filter((item) => {
                            if (importModalTab === 'active') return item.category === 'active' || item.category === 'ready';
                            if (importModalTab === 'success') return item.category === 'success';
                            if (importModalTab === 'error') return item.category === 'error';
                            if (importModalTab === 'duplicate') return item.category === 'duplicate';
                            return true;
                          })
                          .slice(0, 150);
                        if (rowsToShow.length === 0) {
                          return (
                            <tr>
                              <td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                                {liveDashboardStats.isWorking ? 'กำลังค้นหาและดึงรายการไฟล์...' : 'ไม่มีรายการในหมวดนี้'}
                              </td>
                            </tr>
                          );
                        }
                        return rowsToShow.map((item) => (
                          <tr key={item.id}>
                            <td className="table-cell-nowrap" style={{ maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={item.filename}>
                              {item.filename}
                            </td>
                            <td className="table-cell-nowrap">
                              <span
                                className="badge"
                                style={{
                                  fontSize: 10,
                                  background: item.type === 'REP' ? '#dbeafe' : item.type === 'STM' ? '#cffafe' : '#fef3c7',
                                  color: item.type === 'REP' ? '#1d4ed8' : item.type === 'STM' ? '#0e7490' : '#b45309',
                                }}
                              >
                                {item.type}
                              </span>
                            </td>
                            <td className="table-cell-nowrap" style={{ fontSize: 11 }}>{item.fund}</td>
                            <td className="table-cell-nowrap" style={{ fontSize: 11 }}>{item.period}</td>
                            <td className="table-cell-nowrap">
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: item.category === 'success' ? '#15803d'
                                    : item.category === 'error' ? '#b91c1c'
                                      : item.category === 'active' ? '#1d4ed8'
                                        : '#475569',
                                }}
                              >
                                {item.badgeLabel}
                              </span>
                            </td>
                            <td className="table-cell-nowrap" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11, color: '#64748b' }} title={item.detail}>
                              {item.rowCount > 0 ? `${item.rowCount.toLocaleString()} แถว · ` : ''}{item.detail}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
