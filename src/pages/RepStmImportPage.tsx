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

const detectImportType = (fileName: string, headers: string[], rows: Record<string, unknown>[]): ImportType | null => {
  const normalizedName = fileName.toLowerCase();
  const normalizedHeaders = headers.map((header) => normalizeHeaderCell(header).toLowerCase());
  const firstRowKeys = Object.keys(rows[0] || {}).map((key) => normalizeHeaderCell(key).toLowerCase());
  const bag = `${normalizedName} | ${normalizedHeaders.join(' | ')} | ${firstRowKeys.join(' | ')}`;

  if (/\brep\b|rep_|_rep|repdata/.test(normalizedName) || (bag.includes('tran_id') && bag.includes('ชดเชยสุทธิ'))) {
    return 'REP';
  }

  if (/\bstm\b|stm_|_stm/.test(normalizedName) || bag.includes('statement') || bag.includes('stm')) {
    return 'STM';
  }

  if (/\binv\b|inv_|_inv|invoice/.test(normalizedName) || bag.includes('invoice') || bag.includes('เลขที่ใบแจ้งหนี้')) {
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

const isLikelyHeaderRow = (row: unknown[]) => {
  const cells = row.map(normalizeHeaderCell).filter(Boolean);
  if (cells.length < 4) return false;
  const joined = cells.join(' | ').toUpperCase();
  const headerSignals = ['HN', 'AN', 'PID', 'TRAN_ID', 'ชื่อ - สกุล', 'ประเภทผู้ป่วย', 'วันเข้ารักษา', 'ชดเชยสุทธิ'];
  const matchCount = headerSignals.filter((signal) => joined.includes(signal.toUpperCase())).length;
  return matchCount >= 3;
};

const buildHeadersFromRows = (headerRow: unknown[], nextRow?: unknown[]) => {
  return headerRow.map((cell, index) => {
    const primary = normalizeHeaderCell(cell);
    const secondary = normalizeHeaderCell(nextRow?.[index]);
    if (primary && secondary) return `${primary} ${secondary}`.trim();
    return primary || secondary || `column_${index + 1}`;
  });
};

const isLikelyDataRecord = (row: Record<string, unknown>) => {
  const keys = Object.keys(row);
  const normalized = Object.fromEntries(
    keys.map((key) => [key.trim().toLowerCase(), normalizeHeaderCell(row[key])])
  ) as Record<string, string>;

  const hasTranId = !!(normalized['tran_id'] || normalized['tran_id pp\\n(รับจาก สปสช.)']);
  const hasHn = !!normalized['hn'];
  const hasPid = !!normalized['pid'];
  const hasPatientName = !!normalized['ชื่อ - สกุล'];
  const hasPatientType = !!normalized['ประเภทผู้ป่วย'];
  const hasAdmitDate = !!normalized['วันเข้ารักษา'];

  const signalCount = [hasTranId, hasHn, hasPid, hasPatientName, hasPatientType, hasAdmitDate].filter(Boolean).length;
  return signalCount >= 3;
};

const parseWorksheetRows = (worksheet: XLSX.WorkSheet) => {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });

  if (grid.length === 0) {
    return { headers: [] as string[], rows: [] as Record<string, unknown>[] };
  }

  const headerIndex = grid.findIndex((row) => Array.isArray(row) && isLikelyHeaderRow(row));
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
    .filter((row) => isLikelyDataRecord(row));

  return { headers, rows };
};

const readWorkbook = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const parsed = parseWorksheetRows(worksheet);

  return {
    sheetName: firstSheetName,
    rows: parsed.rows,
    headers: parsed.headers,
  };
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

  const resetQueue = () => {
    setQueueItems([]);
    setActivePreviewId(null);
    setError(null);
    setSuccessMessage(null);
  };

  const updateQueueItem = (id: string, updater: (item: ImportQueueItem) => ImportQueueItem) => {
    setQueueItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
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
        const parsed = await readWorkbook(queueItem.file);
        const detectedType = detectImportType(queueItem.fileName, parsed.headers, parsed.rows);
        updateQueueItem(queueItem.id, (item) => ({
          ...item,
          sheetName: parsed.sheetName,
          headers: parsed.headers,
          rows: parsed.rows,
          rowCount: parsed.rows.length,
          detectedType: detectedType || undefined,
          status: parsed.rows.length > 0 && detectedType ? 'ready' : 'error',
          message: parsed.rows.length === 0
            ? 'ไม่พบข้อมูลในไฟล์'
            : detectedType
              ? `ตรวจพบเป็น ${detectedType} พร้อมนำเข้า ${parsed.rows.length.toLocaleString()} แถว`
              : 'ไม่สามารถระบุประเภทไฟล์ได้',
        }));
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
