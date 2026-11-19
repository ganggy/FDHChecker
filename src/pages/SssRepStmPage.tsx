import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { analyzeRepstmArchiveFile } from '../services/hosxpService';

type ImportType = 'REP' | 'STM';
type NetworkType = 'ALL' | 'IN' | 'OUT';

interface ParsedFile {
  id: string;
  file: File;
  type: ImportType;
  rows: Record<string, unknown>[];
  status: 'ready' | 'importing' | 'success' | 'duplicate' | 'error';
  message?: string;
}

interface HistoryRow {
  id: number;
  import_type: ImportType;
  source_filename: string;
  network_type: NetworkType;
  imported_by?: string;
  row_count: number;
  claim_amount: number;
  paid_amount: number;
  error_count: number;
  created_at: string;
}

interface SssErrorCaseRow {
  import_row_id: number;
  batch_id: number;
  source_filename: string;
  imported_at: string;
  status_code: string;
  check_code: string;
  is_warning_only?: boolean;
  error_explanations: string[];
  import_invoice_no: string;
  import_cid: string;
  import_service_datetime: string;
  import_hmain: string;
  import_amount: number;
  import_claim_amount: number;
  vn: string;
  hn: string;
  patient_name: string;
  service_date: string;
  service_time: string;
  clinic: string;
  doctor_license: string;
  hospmain: string;
  pdx: string;
  end_datetime: string;
  invoice_no: string;
  tflag: 'A' | 'E';
  has_override: boolean;
  resolved_flag: boolean;
  last_resubmitted_batch: number | null;
  note: string;
  local_errors?: string[];
  drug_issues?: Array<{ icode: string; name: string; tmt_code: string; unitprice: number; reason: string }>;
}

const splitCsvLine = (line: string) => {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { values.push(current.trim()); current = ''; }
    else current += char;
  }
  values.push(current.trim());
  return values;
};

const parseBilRows = (content: string) => {
  const headers = ['Status', 'Station', 'LineNo', 'HCode', 'HMain', 'AuthCode', 'DTTran', 'InvNo', 'PID', 'BP', 'Amount', 'ClaimAmt'];
  return content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes('*|')).map((line) => {
    const payload = line.slice(line.indexOf('*|') + 2).trim();
    const [data, checkCode = ''] = payload.split('|', 2);
    const cells = splitCsvLine(data);
    return Object.fromEntries([...headers.map((header, index) => [header, cells[index] || '']), ['CheckCode', checkCode.trim()]]);
  }).filter((row) => Object.values(row).some(Boolean));
};

const detectType = (filename: string): ImportType => /stm|statement/i.test(filename) ? 'STM' : 'REP';

const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
  if (/\.(bil|rep|txt)$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    let content = new TextDecoder('utf-8').decode(buffer);
    if (!content.includes('*|')) content = new TextDecoder('windows-874').decode(buffer);
    const bilRows = parseBilRows(content);
    if (bilRows.length) return bilRows;
  }
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
};

export const SssRepStmPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'import' | 'errors'>('import');

  // Import Tab State
  const [importType, setImportType] = useState<ImportType>('REP');
  const [networkType, setNetworkType] = useState<NetworkType>('ALL');
  const [importedBy, setImportedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [queue, setQueue] = useState<ParsedFile[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Error Correction & Resubmit Tab State
  const [errorCases, setErrorCases] = useState<SssErrorCaseRow[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [filterBatchId, setFilterBatchId] = useState<string>('ALL');
  const [onlyUnresolved, setOnlyUnresolved] = useState<boolean>(true);
  const [errorFilterMode, setErrorFilterMode] = useState<'ERROR_ONLY' | 'BLOCKED_ONLY' | 'ALL'>('ERROR_ONLY');
  const [selectedVns, setSelectedVns] = useState<Set<string>>(new Set());
  const [resubmitBatchNo, setResubmitBatchNo] = useState<string>('');
  const [resubmitTflag, setResubmitTflag] = useState<'E' | 'A'>('E');
  const [resubmitting, setResubmitting] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);

  // Edit Override Modal State
  const [editingRow, setEditingRow] = useState<SssErrorCaseRow | null>(null);
  const [editForm, setEditForm] = useState({
    invoice_no: '',
    hospmain: '',
    clinic: '',
    doctor_license: '',
    pdx: '',
    end_datetime: '',
    tflag: 'E' as 'A' | 'E',
    note: '',
  });
  const [savingOverride, setSavingOverride] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/sss/repstm/history?limit=50');
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'โหลดประวัติไม่สำเร็จ');
      setHistory(Array.isArray(json.data) ? json.data : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'โหลดประวัติไม่สำเร็จ'); }
  }, []);

  const loadNextBatchNo = useCallback(async () => {
    try {
      const res = await fetch('/api/sss/export-config');
      const json = await res.json();
      if (json.success && json.ssop?.nextBatchNo) {
        setResubmitBatchNo(String(json.ssop.nextBatchNo));
      }
    } catch {
      // ignore
    }
  }, []);

  const loadErrorCases = useCallback(async (batchIdStr = filterBatchId) => {
    try {
      setLoadingErrors(true);
      setError('');
      const q = batchIdStr !== 'ALL' ? `?batchId=${encodeURIComponent(batchIdStr)}` : '';
      const response = await fetch(`/api/sss/error-cases${q}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'โหลดเคส Error ไม่สำเร็จ');
      setErrorCases(Array.isArray(json.data) ? json.data : []);
      setSelectedVns(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดเคส Error ไม่สำเร็จ');
    } finally {
      setLoadingErrors(false);
    }
  }, [filterBatchId]);

  useEffect(() => {
    void loadHistory();
    void loadNextBatchNo();
    void loadErrorCases('ALL');
  }, [loadHistory, loadNextBatchNo, loadErrorCases]);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setError('');
    setSuccessMsg('');
    const parsed: ParsedFile[] = [];
    for (const [index, file] of Array.from(files).entries()) {
      if (!/\.(xlsx|xls|csv|bil|rep|txt|zip)$/i.test(file.name)) continue;

      if (/\.zip$/i.test(file.name)) {
        try {
          const archive = await analyzeRepstmArchiveFile(file);
          for (const [dIndex, dataset] of archive.datasets.entries()) {
            if (!dataset.rows.length) continue;
            parsed.push({
              id: `${file.name}-${dataset.importerId}-${dIndex}`,
              file,
              type: dataset.detectedType === 'STM' ? 'STM' : 'REP',
              rows: dataset.rows,
              status: 'ready',
              message: dataset.importerLabel,
            });
          }
        } catch (err) {
          parsed.push({
            id: `${file.name}-${file.size}-${index}`,
            file,
            type: detectType(file.name),
            rows: [],
            status: 'error',
            message: err instanceof Error ? err.message : 'อ่านไฟล์ ZIP ไม่สำเร็จ',
          });
        }
        continue;
      }

      try {
        const rows = await parseFile(file);
        if (!rows.length) throw new Error('ไม่พบแถวข้อมูล');
        parsed.push({ id: `${file.name}-${file.size}-${index}`, file, type: detectType(file.name) || importType, rows, status: 'ready' });
      } catch (err) {
        parsed.push({ id: `${file.name}-${file.size}-${index}`, file, type: detectType(file.name), rows: [], status: 'error', message: err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ' });
      }
    }
    setQueue((current) => [...current, ...parsed]);
  };

  const updateItem = (id: string, changes: Partial<ParsedFile>) => setQueue((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));

  const importReady = async () => {
    const targets = queue.filter((item) => item.status === 'ready');
    if (!targets.length) return setError('ไม่มีไฟล์ที่พร้อมนำเข้า');
    setError('');
    setSuccessMsg('');
    let importedErrorCount = 0;
    for (const item of targets) {
      updateItem(item.id, { status: 'importing', message: 'กำลังนำเข้า' });
      try {
        const response = await fetch('/api/sss/repstm/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importType: item.type, sourceFilename: item.file.name, networkType, importedBy, notes, rows: item.rows }),
        });
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'นำเข้าไม่สำเร็จ');
        updateItem(item.id, { status: json.duplicate ? 'duplicate' : 'success', message: json.message });
        importedErrorCount += item.rows.filter((r) => String(r.CheckCode || r.Status || '').includes('C') || Boolean(r.CheckCode)).length;
      } catch (err) { updateItem(item.id, { status: 'error', message: err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ' }); }
    }
    await loadHistory();
    await loadErrorCases(filterBatchId);
    if (importedErrorCount > 0) {
      setSuccessMsg(`นำเข้าสำเร็จและพบรายการติด Error — สามารถสลับไปที่แท็บ "🔧 แก้ไขเคสติด Error" เพื่อแก้ไขและส่งออกซ้ำได้ทันที`);
    }
  };

  const visibleErrorCases = useMemo(() => {
    return errorCases.filter((r) => {
      if (filterBatchId !== 'ALL' && String(r.batch_id) !== filterBatchId) return false;
      if (onlyUnresolved && r.resolved_flag) return false;
      if (errorFilterMode === 'ERROR_ONLY' && r.is_warning_only) return false;
      if (errorFilterMode === 'BLOCKED_ONLY' && !(r.local_errors && r.local_errors.length > 0)) return false;
      return true;
    });
  }, [errorCases, filterBatchId, onlyUnresolved, errorFilterMode]);

  const selectableErrorCases = useMemo(
    () => visibleErrorCases.filter((r) => Boolean(r.vn) && !r.is_warning_only),
    [visibleErrorCases]
  );
  const unresolvedTotal = useMemo(() => errorCases.filter((r) => !r.resolved_flag).length, [errorCases]);

  const handleOpenEdit = (row: SssErrorCaseRow) => {
    setEditingRow(row);
    setEditForm({
      invoice_no: row.invoice_no || row.import_invoice_no || row.vn,
      hospmain: row.hospmain || '',
      clinic: row.clinic || '01',
      doctor_license: row.doctor_license || '',
      pdx: row.pdx || '',
      end_datetime: row.end_datetime || '',
      tflag: row.tflag || 'E',
      note: row.note || '',
    });
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow || !editingRow.vn) return;
    try {
      setSavingOverride(true);
      setError('');
      const res = await fetch('/api/sss/error-cases/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vn: editingRow.vn, ...editForm }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
      setEditingRow(null);
      setSuccessMsg(`บันทึกการแก้ไข VN ${editingRow.vn} (InvNo: ${editForm.invoice_no}) เรียบร้อยแล้ว`);
      await loadErrorCases(filterBatchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingOverride(false);
    }
  };

  const handleAutoFixAll = async () => {
    try {
      setAutoFixing(true);
      setError('');
      setSuccessMsg('');
      const res = await fetch('/api/sss/error-cases/auto-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: filterBatchId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Auto-Fix ไม่สำเร็จ');
      setSuccessMsg(json.message || 'แก้ไข Auto เรียบร้อยแล้ว');
      await loadErrorCases(filterBatchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-Fix ไม่สำเร็จ');
    } finally {
      setAutoFixing(false);
    }
  };

  const handleResubmitSelected = async () => {
    if (!selectedVns.size) return setError('กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการส่งออกซ้ำ');
    try {
      setResubmitting(true);
      setError('');
      setSuccessMsg('');
      const response = await fetch('/api/sss/error-cases/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vns: [...selectedVns],
          batchNo: Number(resubmitBatchNo) || undefined,
          tflag: resubmitTflag,
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || 'ส่งออกไฟล์แก้ไขไม่สำเร็จ');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `SSOPBIL_RESUBMIT.ZIP`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);

      const usedBatch = Number(resubmitBatchNo) || 1;
      setResubmitBatchNo(String(usedBatch + 1));
      setSuccessMsg(`ส่งออกไฟล์แก้ไขเฉพาะเคสที่เลือกสำเร็จ: ${filename} (${selectedVns.size} รายการ, TFlag="${resubmitTflag}") — ระบบบันทึก Log ป้องกันส่งซ้ำแล้ว`);
      await loadErrorCases(filterBatchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งออกซ้ำไม่สำเร็จ');
    } finally {
      setResubmitting(false);
    }
  };

  const readyCount = queue.filter((item) => item.status === 'ready').length;
  const preview = queue.find((item) => item.status !== 'error');
  const previewHeaders = useMemo(() => Object.keys(preview?.rows[0] || {}), [preview]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">📥 REP/STM & แก้ไขเคส Error ประกันสังคม (SSOP)</h1>
        <p className="page-subtitle">นำเข้าผลตอบรับ (SOCDBIL / SIGNREP / STM) พร้อมหน้าจอแก้ไขเคสติด Error และส่งออกซ้ำเฉพาะเคสที่แก้แล้วโดยไม่ส่งรายการเดิมซ้ำ</p>
      </div>

      {/* Mode Tabs */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'import' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            📥 นำเข้าไฟล์ตอบกลับ (REP/STM)
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'errors' ? 'btn-primary' : ''}`}
            onClick={() => { setActiveTab('errors'); void loadErrorCases(filterBatchId); }}
          >
            🔧 แก้ไขเคสติด Error & ส่งออกซ้ำ {unresolvedTotal > 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>{unresolvedTotal}</span>}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {successMsg && <div className="alert alert-success" style={{ marginBottom: 12 }}>{successMsg}</div>}

      {activeTab === 'import' && (
        <>
          <div className="alert alert-info" style={{ marginBottom: 16 }}><span>ℹ️</span><span>ข้อมูลหน้านี้จัดเก็บในชุดประกันสังคมโดยเฉพาะ และ<strong>ไม่มีการตรวจหรือเชื่อมสถานะปิดสิทธิ์ EP</strong></span></div>

          <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
              <label className="form-group"><span className="form-label">ประเภทข้อมูล</span><select className="form-control" value={importType} onChange={(e) => setImportType(e.target.value as ImportType)}><option value="REP">REP ผลตอบรับ</option><option value="STM">STM ยอดชดเชย</option></select></label>
              <label className="form-group"><span className="form-label">เครือข่ายของชุดข้อมูล</span><select className="form-control" value={networkType} onChange={(e) => setNetworkType(e.target.value as NetworkType)}><option value="ALL">ไม่ระบุ/รวม</option><option value="IN">ในเครือข่าย</option><option value="OUT">นอกเครือข่าย</option></select></label>
              <label className="form-group"><span className="form-label">ผู้นำเข้า</span><input className="form-control" value={importedBy} onChange={(e) => setImportedBy(e.target.value)} /></label>
              <label className="form-group"><span className="form-label">หมายเหตุ</span><input className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              <input ref={inputRef} type="file" multiple hidden accept=".xlsx,.xls,.csv,.bil,.rep,.txt,.zip" onChange={(e) => void addFiles(e.target.files)} />
              <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>📂 เลือกไฟล์ REP/STM</button>
              <button className="btn btn-success" disabled={!readyCount} onClick={() => void importReady()}>⬆️ นำเข้า {readyCount} ไฟล์</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>รองรับ .ZIP (SIGNREP, SIGNSTM, SOCDBIL), .BIL, .REP, .TXT, .CSV, .XLS และ .XLSX — ระบบตรวจประเภท REP/STM จากชื่อไฟล์และเนื้อหาอัตโนมัติ</div>
          </div></div>

          {queue.length > 0 && <div className="card" style={{ marginBottom: 16 }}><div className="card-body"><h3 style={{ marginTop: 0 }}>คิวนำเข้า</h3>{queue.map((item) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 110px 100px minmax(180px, 1fr) 40px', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
            <div><strong>{item.file.name}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.rows.length.toLocaleString()} แถว</div></div>
            <select className="form-control" value={item.type} disabled={item.status !== 'ready'} onChange={(e) => updateItem(item.id, { type: e.target.value as ImportType })}><option value="REP">REP</option><option value="STM">STM</option></select>
            <span className={`badge ${item.status === 'success' ? 'badge-success' : item.status === 'error' ? 'badge-danger' : item.status === 'duplicate' ? 'badge-warning' : 'badge-info'}`}>{item.status}</span>
            <span style={{ fontSize: 12 }}>{item.message || 'พร้อมนำเข้า'}</span>
            <button className="btn" onClick={() => setQueue((current) => current.filter((row) => row.id !== item.id))}>✕</button>
          </div>)}</div></div>}

          {preview && preview.rows.length > 0 && <div className="card" style={{ marginBottom: 16 }}><div className="card-body"><h3 style={{ marginTop: 0 }}>ตัวอย่างข้อมูล: {preview.file.name}</h3><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>{previewHeaders.slice(0, 12).map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 8).map((row, index) => <tr key={index}>{previewHeaders.slice(0, 12).map((header) => <td key={header}>{String(row[header] ?? '')}</td>)}</tr>)}</tbody></table></div></div></div>}

          <div className="card"><div className="card-body"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ marginTop: 0 }}>ประวัตินำเข้า SSS</h3><button className="btn" onClick={() => void loadHistory()}>รีเฟรช</button></div><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr><th>Batch</th><th>ประเภท</th><th>ไฟล์</th><th>เครือข่าย</th><th>จำนวนแถว</th><th style={{ textAlign: 'right' }}>ยอดเคลม</th><th style={{ textAlign: 'right' }}>ยอดรับ</th><th>ติดปัญหา</th><th>นำเข้าเมื่อ</th><th>จัดการ</th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td>#{row.id}</td><td><span className="badge badge-info">{row.import_type}</span></td><td>{row.source_filename}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.imported_by || '-'}</div></td><td>{row.network_type === 'IN' ? 'ในเครือข่าย' : row.network_type === 'OUT' ? 'นอกเครือข่าย' : 'รวม/ไม่ระบุ'}</td><td>{Number(row.row_count || 0).toLocaleString()}</td><td style={{ textAlign: 'right' }}>{Number(row.claim_amount || 0).toLocaleString()}</td><td style={{ textAlign: 'right' }}>{Number(row.paid_amount || 0).toLocaleString()}</td><td>{Number(row.error_count || 0) > 0 ? <span className="badge badge-danger">{row.error_count}</span> : 0}</td><td>{new Date(row.created_at).toLocaleString('th-TH')}</td><td>{Number(row.error_count || 0) > 0 && <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { setFilterBatchId(String(row.id)); setActiveTab('errors'); void loadErrorCases(String(row.id)); }}>🔧 แก้ไข Error ({row.error_count})</button>}</td></tr>)}</tbody></table>{history.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>ยังไม่มีประวัตินำเข้า</div>}</div></div></div>
        </>
      )}

      {activeTab === 'errors' && (
        <>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>💡</span>
            <span>
              <strong>แนวทางการแก้ไขและส่งกลับตามมาตรฐาน สปส.:</strong> ใช้ <strong>InvNo (ID เดิม)</strong> จากไฟล์ตอบกลับ <code>SOCDBIL</code> แก้ไขข้อมูลที่ติด Error (เช่น HospMain, Clinic, เลข ว., PDX, เวลาสิ้นสุด) แล้วกด <strong>ส่งออกเฉพาะรายการที่ Error เท่านั้น</strong> เพื่อไม่ส่งรายการที่ผ่านแล้วซ้ำ
            </span>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <label className="form-group">
                  <span className="form-label">กรองตามไฟล์นำเข้า (Batch)</span>
                  <select className="form-control" value={filterBatchId} onChange={(e) => { setFilterBatchId(e.target.value); void loadErrorCases(e.target.value); }}>
                    <option value="ALL">ทุกไฟล์ที่ติด Error</option>
                    {history.filter((h) => Number(h.error_count || 0) > 0).map((h) => (
                      <option key={h.id} value={String(h.id)}>#{h.id} - {h.source_filename} ({h.error_count} Error)</option>
                    ))}
                  </select>
                </label>

                <label className="form-group" style={{ minWidth: 220 }}>
                  <span className="form-label">ตัวกรองสถานะ</span>
                  <select className="form-control" value={errorFilterMode} onChange={(e) => setErrorFilterMode(e.target.value as 'ERROR_ONLY' | 'BLOCKED_ONLY' | 'ALL')}>
                    <option value="ERROR_ONLY">เฉพาะเคสไม่ผ่าน (C/R)</option>
                    <option value="BLOCKED_ONLY">เฉพาะเคสที่ยังติดปัญหาส่งออกไม่ได้</option>
                    <option value="ALL">ทั้งหมด (รวมผ่านแบบมี Warning A)</option>
                  </select>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18, fontWeight: 600 }}>
                  <input type="checkbox" checked={onlyUnresolved} onChange={(e) => setOnlyUnresolved(e.target.checked)} />
                  <span>แสดงเฉพาะเคสที่ยังไม่ส่งแก้ไขซ้ำ</span>
                </label>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <label className="form-group" style={{ width: 110 }}>
                  <span className="form-label">เลขงวดส่งออก</span>
                  <input type="number" min="1" className="form-control" value={resubmitBatchNo} onChange={(e) => setResubmitBatchNo(e.target.value)} />
                </label>
                <label className="form-group" style={{ width: 150 }}>
                  <span className="form-label">TFlag</span>
                  <select className="form-control" value={resubmitTflag} onChange={(e) => setResubmitTflag(e.target.value as 'E' | 'A')}>
                    <option value="E">E (แก้ไขส่งซ้ำ)</option>
                    <option value="A">A (ส่งใหม่)</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: 18 }}
                  onClick={() => window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'drugCatalog' } }))}
                >
                  💊 จัดทำ DrugCatalog
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: 18 }}
                  disabled={autoFixing || selectableErrorCases.length === 0}
                  onClick={() => void handleAutoFixAll()}
                >
                  {autoFixing ? '⏳ กำลัง Auto-Fix...' : `⚡ แก้ไข Auto (${selectableErrorCases.length})`}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 18 }}
                  onClick={() => {
                    if (selectedVns.size === selectableErrorCases.length) setSelectedVns(new Set());
                    else setSelectedVns(new Set(selectableErrorCases.map((r) => r.vn)));
                  }}
                >
                  ☑️ {selectedVns.size === selectableErrorCases.length && selectableErrorCases.length > 0 ? 'ยกเลิกเลือกทั้งหมด' : `เลือกเฉพาะเคส Error (${selectableErrorCases.length})`}
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  style={{ marginTop: 18 }}
                  disabled={resubmitting || selectedVns.size === 0}
                  onClick={() => void handleResubmitSelected()}
                >
                  {resubmitting ? '⏳ กำลังสร้าง ZIP...' : `📦 ส่งออกเฉพาะเคส Error (${selectedVns.size})`}
                </button>
              </div>
            </div>
          </div>

          {loadingErrors ? (
            <div className="loading-container"><div className="spinner" /><span>กำลังโหลดและจับคู่ข้อมูล HOSxP...</span></div>
          ) : (
            <div className="card">
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>ไฟล์ / Batch</th>
                      <th>HN / VN</th>
                      <th>InvNo (ID เดิม)</th>
                      <th>รหัส Error & คำแนะนำแก้ไข</th>
                      <th>ข้อมูลส่งเคลมปัจจุบัน</th>
                      <th style={{ textAlign: 'right' }}>ยอดเคลม</th>
                      <th>สถานะส่งซ้ำ</th>
                      <th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleErrorCases.length === 0 ? (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>ไม่พบรายการติด Error ตามเงื่อนไขที่เลือก</td></tr>
                    ) : (
                      visibleErrorCases.map((row) => (
                        <tr key={row.import_row_id} className={!row.resolved_flag && !row.is_warning_only ? 'row-danger' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              disabled={!row.vn}
                              checked={Boolean(row.vn && selectedVns.has(row.vn))}
                              onChange={() => {
                                if (!row.vn) return;
                                setSelectedVns((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.vn)) next.delete(row.vn);
                                  else next.add(row.vn);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td>
                            <div><strong>#{row.batch_id}</strong></div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.source_filename}</div>
                          </td>
                          <td>
                            <div><strong>HN: {row.hn || '-'}</strong></div>
                            <div style={{ fontSize: 12 }}>{row.patient_name || '-'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>VN: {row.vn || 'ไม่พบ VN ใน HOSxP'}</div>
                          </td>
                          <td>
                            <code>{row.invoice_no || row.import_invoice_no || '-'}</code>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.service_date || row.import_service_datetime}</div>
                          </td>
                          <td style={{ maxWidth: 320 }}>
                            <div>
                              <span className={`badge ${row.is_warning_only ? 'badge-warning' : 'badge-danger'}`}>
                                {row.is_warning_only ? `✓ ผ่าน (A) · Warning: ${row.check_code}` : `✕ ไม่ผ่าน (${row.status_code}) · ${row.check_code || 'Error'}`}
                              </span>
                            </div>
                            {row.local_errors && row.local_errors.length > 0 && (
                              <div style={{ marginTop: 4, padding: '4px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontSize: 11, fontWeight: 700 }}>
                                ⛔ ยังส่งออกไม่ได้: {row.local_errors.join(', ')}
                              </div>
                            )}
                            <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 11, color: row.is_warning_only ? '#92400e' : '#991b1b' }}>
                              {row.error_explanations.map((exp, idx) => <li key={idx}>{exp}</li>)}
                            </ul>
                            {row.drug_issues && row.drug_issues.length > 0 && (
                              <details open style={{ marginTop: 6, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '4px 6px', fontSize: 11 }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#92400e' }}>💊 รายการยาที่ต้องตรวจ DrugCatalog ({row.drug_issues.length})</summary>
                                {row.drug_issues.map((d, i) => (
                                  <div key={i} style={{ marginTop: 3, color: '#78350f' }}>
                                    <code>{d.icode}</code> {d.name} · TMT: <strong>{d.tmt_code}</strong> · {d.unitprice}฿ — <span style={{ color: '#b91c1c' }}>{d.reason}</span>
                                  </div>
                                ))}
                              </details>
                            )}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            <div>HMain: <strong>{row.hospmain || '-'}</strong> | Clinic: <strong>{row.clinic || '-'}</strong></div>
                            <div>PDX: <strong>{row.pdx || '-'}</strong> | ว.: <strong>{row.doctor_license || '-'}</strong></div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>สิ้นสุด: {row.end_datetime || '-'}</div>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(row.import_claim_amount || row.import_amount || 0).toLocaleString()}</td>
                          <td>
                            {row.last_resubmitted_batch ? (
                              <span className="badge badge-success">ส่งซ้ำงวด #{row.last_resubmitted_batch}</span>
                            ) : row.has_override ? (
                              <span className="badge badge-info">✏️ แก้ไขแล้ว (รอส่ง)</span>
                            ) : (
                              <span className="badge badge-warning">รอแก้ไข</span>
                            )}
                          </td>
                          <td>
                            {row.vn && (
                              <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleOpenEdit(row)}>
                                ✏️ แก้ไข
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: Edit Override for Resubmit */}
      {editingRow && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
          onClick={() => setEditingRow(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="card-body">
              <h3 style={{ marginTop: 0 }}>✏️ แก้ไขข้อมูลส่งเคลมประกันสังคม (VN: {editingRow.vn})</h3>
              <div className="alert alert-danger" style={{ marginBottom: 12, fontSize: 12 }}>
                <div><strong>Error ที่พบ ({editingRow.check_code}):</strong></div>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {editingRow.error_explanations.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>

              <form onSubmit={handleSaveOverride} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label className="form-group">
                  <span className="form-label">InvNo (เลขที่ใบแจ้งหนี้ — แนะนำให้คง ID เดิมตาม สปส.)</span>
                  <input className="form-control" required value={editForm.invoice_no} onChange={(e) => setEditForm({ ...editForm, invoice_no: e.target.value })} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="form-group">
                    <span className="form-label">HospMain (รหัส รพ.หลัก 5 หลัก)</span>
                    <input className="form-control" value={editForm.hospmain} onChange={(e) => setEditForm({ ...editForm, hospmain: e.target.value })} />
                  </label>
                  <label className="form-group">
                    <span className="form-label">Clinic (รหัสคลินิก 01-12, 99)</span>
                    <input className="form-control" value={editForm.clinic} onChange={(e) => setEditForm({ ...editForm, clinic: e.target.value })} />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="form-group">
                    <span className="form-label">เลขที่ใบอนุญาตแพทย์ (ว./พว.)</span>
                    <input className="form-control" value={editForm.doctor_license} onChange={(e) => setEditForm({ ...editForm, doctor_license: e.target.value })} />
                  </label>
                  <label className="form-group">
                    <span className="form-label">PDX (รหัสวินิจฉัยหลัก)</span>
                    <input className="form-control" value={editForm.pdx} onChange={(e) => setEditForm({ ...editForm, pdx: e.target.value })} />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="form-group">
                    <span className="form-label">วัน-เวลาสิ้นสุดบริการ (YYYY-MM-DD HH:mm:ss)</span>
                    <input className="form-control" value={editForm.end_datetime} onChange={(e) => setEditForm({ ...editForm, end_datetime: e.target.value })} placeholder="เช่น 2026-10-30 13:30:00" />
                  </label>
                  <label className="form-group">
                    <span className="form-label">TFlag สำหรับส่งออกซ้ำ</span>
                    <select className="form-control" value={editForm.tflag} onChange={(e) => setEditForm({ ...editForm, tflag: e.target.value as 'A' | 'E' })}>
                      <option value="E">E (แก้ไขส่งซ้ำ)</option>
                      <option value="A">A (ส่งใหม่)</option>
                    </select>
                  </label>
                </div>
                <label className="form-group">
                  <span className="form-label">หมายเหตุการแก้ไข</span>
                  <input className="form-control" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} placeholder="บันทึกช่วยจำ..." />
                </label>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn" onClick={() => setEditingRow(null)} disabled={savingOverride}>ยกเลิก</button>
                  <button type="submit" className="btn btn-primary" disabled={savingOverride}>
                    {savingOverride ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไข'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
