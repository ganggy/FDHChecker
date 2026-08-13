import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

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
  const headers = ['Status','Station','LineNo','HCode','HMain','AuthCode','DTTran','InvNo','PID','BP','Amount','ClaimAmt'];
  return content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes('*|')).map((line) => {
    const payload = line.slice(line.indexOf('*|') + 2).trim();
    const [data, checkCode = ''] = payload.split('|', 2);
    const cells = splitCsvLine(data);
    return Object.fromEntries([...headers.map((header, index) => [header, cells[index] || '']), ['CheckCode', checkCode.trim()]]);
  }).filter((row) => Object.values(row).some(Boolean));
};

const detectType = (filename: string): ImportType => /stm|statement/i.test(filename) ? 'STM' : 'REP';

const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
  if (/\.(bil|txt)$/i.test(file.name)) {
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
  const [importType, setImportType] = useState<ImportType>('REP');
  const [networkType, setNetworkType] = useState<NetworkType>('ALL');
  const [importedBy, setImportedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [queue, setQueue] = useState<ParsedFile[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/sss/repstm/history?limit=50');
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'โหลดประวัติไม่สำเร็จ');
      setHistory(Array.isArray(json.data) ? json.data : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'โหลดประวัติไม่สำเร็จ'); }
  };
  useEffect(() => { void loadHistory(); }, []);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setError('');
    const parsed: ParsedFile[] = [];
    for (const [index, file] of Array.from(files).entries()) {
      if (!/\.(xlsx|xls|csv|bil|txt)$/i.test(file.name)) continue;
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
      } catch (err) { updateItem(item.id, { status: 'error', message: err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ' }); }
    }
    await loadHistory();
  };

  const readyCount = queue.filter((item) => item.status === 'ready').length;
  const preview = queue.find((item) => item.status !== 'error');
  const previewHeaders = useMemo(() => Object.keys(preview?.rows[0] || {}), [preview]);

  return <div className="page-container">
    <div className="page-header"><h1 className="page-title">📥 REP/STM ประกันสังคม</h1><p className="page-subtitle">นำเข้าผลตอบรับและยอดชดเชย SSOP แยกจาก REP/STM ของ สปสช.</p></div>
    <div className="alert alert-info" style={{ marginBottom: 16 }}><span>ℹ️</span><span>ข้อมูลหน้านี้จัดเก็บในชุดประกันสังคมโดยเฉพาะ และ<strong>ไม่มีการตรวจหรือเชื่อมสถานะปิดสิทธิ์ EP</strong></span></div>

    <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
        <label className="form-group"><span className="form-label">ประเภทข้อมูล</span><select className="form-control" value={importType} onChange={(e) => setImportType(e.target.value as ImportType)}><option value="REP">REP ผลตอบรับ</option><option value="STM">STM ยอดชดเชย</option></select></label>
        <label className="form-group"><span className="form-label">เครือข่ายของชุดข้อมูล</span><select className="form-control" value={networkType} onChange={(e) => setNetworkType(e.target.value as NetworkType)}><option value="ALL">ไม่ระบุ/รวม</option><option value="IN">ในเครือข่าย</option><option value="OUT">นอกเครือข่าย</option></select></label>
        <label className="form-group"><span className="form-label">ผู้นำเข้า</span><input className="form-control" value={importedBy} onChange={(e) => setImportedBy(e.target.value)} /></label>
        <label className="form-group"><span className="form-label">หมายเหตุ</span><input className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <input ref={inputRef} type="file" multiple hidden accept=".xlsx,.xls,.csv,.bil,.txt" onChange={(e) => void addFiles(e.target.files)} />
        <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>📂 เลือกไฟล์ REP/STM</button>
        <button className="btn btn-success" disabled={!readyCount} onClick={() => void importReady()}>⬆️ นำเข้า {readyCount} ไฟล์</button>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>รองรับ .BIL, .TXT, .CSV, .XLS และ .XLSX — ระบบตรวจประเภท REP/STM จากชื่อไฟล์และสามารถแก้ประเภทก่อนนำเข้าได้</div>
    </div></div>
    {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}

    {queue.length > 0 && <div className="card" style={{ marginBottom: 16 }}><div className="card-body"><h3 style={{ marginTop: 0 }}>คิวนำเข้า</h3>{queue.map((item) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 110px 100px minmax(180px, 1fr) 40px', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div><strong>{item.file.name}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.rows.length.toLocaleString()} แถว</div></div>
      <select className="form-control" value={item.type} disabled={item.status !== 'ready'} onChange={(e) => updateItem(item.id, { type: e.target.value as ImportType })}><option value="REP">REP</option><option value="STM">STM</option></select>
      <span className={`badge ${item.status === 'success' ? 'badge-success' : item.status === 'error' ? 'badge-danger' : item.status === 'duplicate' ? 'badge-warning' : 'badge-info'}`}>{item.status}</span>
      <span style={{ fontSize: 12 }}>{item.message || 'พร้อมนำเข้า'}</span>
      <button className="btn" onClick={() => setQueue((current) => current.filter((row) => row.id !== item.id))}>✕</button>
    </div>)}</div></div>}

    {preview && preview.rows.length > 0 && <div className="card" style={{ marginBottom: 16 }}><div className="card-body"><h3 style={{ marginTop: 0 }}>ตัวอย่างข้อมูล: {preview.file.name}</h3><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>{previewHeaders.slice(0, 12).map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 8).map((row, index) => <tr key={index}>{previewHeaders.slice(0, 12).map((header) => <td key={header}>{String(row[header] ?? '')}</td>)}</tr>)}</tbody></table></div></div></div>}

    <div className="card"><div className="card-body"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ marginTop: 0 }}>ประวัตินำเข้า SSS</h3><button className="btn" onClick={() => void loadHistory()}>รีเฟรช</button></div><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr><th>Batch</th><th>ประเภท</th><th>ไฟล์</th><th>เครือข่าย</th><th>จำนวนแถว</th><th style={{ textAlign: 'right' }}>ยอดเคลม</th><th style={{ textAlign: 'right' }}>ยอดรับ</th><th>ติดปัญหา</th><th>นำเข้าเมื่อ</th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td>#{row.id}</td><td><span className="badge badge-info">{row.import_type}</span></td><td>{row.source_filename}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.imported_by || '-'}</div></td><td>{row.network_type === 'IN' ? 'ในเครือข่าย' : row.network_type === 'OUT' ? 'นอกเครือข่าย' : 'รวม/ไม่ระบุ'}</td><td>{Number(row.row_count || 0).toLocaleString()}</td><td style={{ textAlign: 'right' }}>{Number(row.claim_amount || 0).toLocaleString()}</td><td style={{ textAlign: 'right' }}>{Number(row.paid_amount || 0).toLocaleString()}</td><td>{Number(row.error_count || 0)}</td><td>{new Date(row.created_at).toLocaleString('th-TH')}</td></tr>)}</tbody></table>{history.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>ยังไม่มีประวัตินำเข้า</div>}</div></div></div>
  </div>;
};
