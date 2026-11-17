import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatLocalDateInput } from '../utils/dateUtils';

type NetworkType = 'ALL' | 'IN' | 'OUT';
type ValidationStatus = 'ready' | 'warning' | 'error';
type ClaimMode = 'OPD' | 'IPD';

interface SssIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

interface SssCandidate {
  an?: string;
  vn: string;
  hn: string;
  patient_name: string;
  cid: string;
  service_date: string;
  service_time: string;
  admit_date?: string;
  discharge_date?: string;
  pttype: string;
  pttype_name: string;
  network_type: 'IN' | 'OUT';
  hospmain: string;
  clinic?: string;
  doctor_license?: string;
  end_datetime?: string;
  rx_datetime?: string;
  has_override?: boolean;
  pdx: string;
  invoice_no: string;
  income: number;
  validation_status: ValidationStatus;
  issues: SssIssue[];
  export_status?: 'UNSENT' | 'SENT' | 'PASSED' | 'ERROR';
  last_batch_no?: number | null;
  last_error_code?: string;
}

interface SssSummary {
  total: number;
  inNetwork: number;
  outNetwork: number;
  ready: number;
  warning: number;
  error: number;
  amount: number;
}

const emptySummary: SssSummary = { total: 0, inNetwork: 0, outNetwork: 0, ready: 0, warning: 0, error: 0, amount: 0 };

const statusLabel: Record<ValidationStatus, string> = {
  ready: 'พร้อมส่ง',
  warning: 'ส่งได้ แต่ควรตรวจ',
  error: 'ต้องแก้ไข',
};

const candidateId = (row: SssCandidate) => row.an || row.vn;

export const SssExportPage: React.FC = () => {
  const today = formatLocalDateInput();
  const [claimMode, setClaimMode] = useState<ClaimMode>('OPD');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [networkType, setNetworkType] = useState<NetworkType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ValidationStatus>('ALL');
  const [exportStatusFilter, setExportStatusFilter] = useState<'ALL' | 'UNSENT' | 'SENT' | 'PASSED' | 'ERROR'>('UNSENT');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<SssCandidate[]>([]);
  const [summary, setSummary] = useState<SssSummary>(emptySummary);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);
  const [editingRow, setEditingRow] = useState<SssCandidate | null>(null);
  const [editForm, setEditForm] = useState({
    invoice_no: '',
    clinic: '01',
    doctor_license: '',
    hospmain: '',
    pdx: '',
    end_datetime: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [batchNo, setBatchNo] = useState<string>('');
  const [hcode, setHcode] = useState<string>('11101');
  const [lastBatchNo, setLastBatchNo] = useState<number | null>(null);

  const loadBatchConfig = useCallback(async (mode: ClaimMode) => {
    try {
      const response = await fetch('/api/sss/export-config');
      const json = await response.json();
      if (json.success) {
        if (json.hcode) setHcode(json.hcode);
        if (mode === 'OPD') {
          setBatchNo(String(json.ssop?.nextBatchNo ?? 1245));
          setLastBatchNo(json.ssop?.lastBatchNo ?? 1244);
        } else {
          setBatchNo(String(json.aipn?.nextBatchNo ?? 10252));
          setLastBatchNo(json.aipn?.lastBatchNo ?? 10251);
        }
      }
    } catch (err) {
      console.warn('โหลดค่าเลขงวดส่งออกไม่สำเร็จ:', err);
    }
  }, []);

  useEffect(() => {
    void loadBatchConfig(claimMode);
  }, [claimMode, loadBatchConfig]);

  const loadCandidates = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setMessage('');
      const params = new URLSearchParams({ startDate, endDate, networkType });
      const response = await fetch(`${claimMode === 'IPD' ? '/api/sss/ipd/candidates' : '/api/sss/candidates'}?${params.toString()}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'โหลดข้อมูลไม่สำเร็จ');
      setRows(Array.isArray(json.data) ? json.data : []);
      setSummary(json.summary || emptySummary);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [claimMode, endDate, networkType, startDate]);

  useEffect(() => { void loadCandidates(); }, [loadCandidates]);

  const previewFilename = useMemo(() => {
    const num = Number(batchNo) || 1;
    if (claimMode === 'IPD') {
      const padded = String(num).padStart(5, '0');
      return `${hcode}AIPN${padded}.ZIP`;
    }
    const padded = String(num).padStart(4, '0');
    return `${hcode}_SSOPBIL_${padded}_01_YYYYMMDD-HHmmss.ZIP`;
  }, [batchNo, claimMode, hcode]);

  const filtered = useMemo(() => rows.filter((row) => {
    if (statusFilter !== 'ALL' && row.validation_status !== statusFilter) return false;
    if (claimMode === 'OPD' && exportStatusFilter !== 'ALL') {
      const expStat = row.export_status || 'UNSENT';
      if (expStat !== exportStatusFilter) return false;
    }
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [row.an, row.vn, row.hn, row.cid, row.patient_name, row.pttype_name].some((value) => String(value || '').toLowerCase().includes(needle));
  }), [rows, search, statusFilter, exportStatusFilter, claimMode]);
  const selectable = filtered.filter((row) => row.validation_status !== 'error');
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(candidateId(row)));

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) selectable.forEach((row) => next.delete(candidateId(row)));
      else selectable.forEach((row) => next.add(candidateId(row)));
      return next;
    });
  };

  const exportZip = async () => {
    if (!selected.size) return setError('กรุณาเลือกรายการที่พร้อมส่งอย่างน้อย 1 รายการ');
    try {
      setExporting(true);
      setError('');
      setMessage('');
      const response = await fetch(claimMode === 'IPD' ? '/api/sss/ipd/export' : '/api/sss/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          networkType,
          batchNo: Number(batchNo) || undefined,
          [claimMode === 'IPD' ? 'ans' : 'vns']: [...selected],
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || `ส่งออก ${claimMode === 'IPD' ? 'AIPN' : 'SSOP'} ไม่สำเร็จ`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `${claimMode === 'IPD' ? 'AIPN' : 'SSOPBIL'}-${endDate}.zip`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      const usedBatch = Number(batchNo) || 1;
      setLastBatchNo(usedBatch);
      setBatchNo(String(usedBatch + 1));
      await loadCandidates();
      setMessage(`ส่งออก ${claimMode === 'IPD' ? 'AIPN' : 'SSOP'} สำเร็จ: ${filename} (จำนวน ${selected.size.toLocaleString()} ${claimMode === 'IPD' ? 'AN' : 'visit'})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `ส่งออก ${claimMode === 'IPD' ? 'AIPN' : 'SSOP'} ไม่สำเร็จ`);
    } finally {
      setExporting(false);
    }
  };

  const handleAutoFixBeforeExport = async () => {
    try {
      setAutoFixing(true);
      setError('');
      setMessage('');
      const response = await fetch('/api/sss/candidates/auto-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, networkType }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Auto-Fix ก่อนส่งไม่สำเร็จ');
      await loadCandidates();
      setMessage(json.message || 'Auto-Fix ก่อนส่งสำเร็จ');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-Fix ก่อนส่งไม่สำเร็จ');
    } finally {
      setAutoFixing(false);
    }
  };

  const computePlus30FromRxOrStart = (row: SssCandidate): string => {
    const baseStr = (row.rx_datetime || `${row.service_date} ${row.service_time || '08:00:00'}`).trim().replace(' ', 'T');
    const baseMs = new Date(baseStr).getTime();
    if (!Number.isFinite(baseMs)) return '';
    const d = new Date(baseMs + 30 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const openEditModal = (row: SssCandidate) => {
    setEditingRow(row);
    setEditForm({
      invoice_no: row.invoice_no || row.vn,
      clinic: row.clinic || '01',
      doctor_license: row.doctor_license || '',
      hospmain: row.hospmain || '',
      pdx: row.pdx || '',
      end_datetime: row.end_datetime || computePlus30FromRxOrStart(row),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingRow) return;
    try {
      setSavingEdit(true);
      setError('');
      const response = await fetch('/api/sss/error-cases/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vn: editingRow.vn,
          ...editForm,
          tflag: editingRow.export_status === 'ERROR' ? 'E' : 'A',
          note: 'แก้ไขข้อมูลก่อนส่งออก SSOP',
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'บันทึกการแก้ไขไม่สำเร็จ');
      setEditingRow(null);
      await loadCandidates();
      setMessage(`บันทึกการแก้ไข VN ${editingRow.vn} เรียบร้อยแล้ว`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกการแก้ไขไม่สำเร็จ');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">🔵 ส่งออกสิทธิ์ประกันสังคม ({claimMode === 'IPD' ? 'AIPN' : 'SSOP'})</h1>
        <p className="page-subtitle">{claimMode === 'IPD' ? 'คัดกรองผู้ป่วยในที่จำหน่ายแล้ว ก่อนสร้าง AIPN 2.1 XML ZIP' : 'คัดกรองผู้ป่วยนอกประกันสังคม แยกในเครือข่ายและนอกเครือข่าย ก่อนสร้าง SSOPBIL'}</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}><div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className={`btn ${claimMode === 'OPD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setClaimMode('OPD')}>🩺 ผู้ป่วยนอก — SSOP</button>
        <button className={`btn ${claimMode === 'IPD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setClaimMode('IPD')}>🛏️ ผู้ป่วยใน — AIPN</button>
      </div></div>

      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <span>ℹ️</span><span><strong>โมดูลนี้ไม่ตรวจการปิดสิทธิ์ EP และไม่บังคับ Authen NHSO</strong> สถานะพร้อมส่งพิจารณาจากข้อมูล {claimMode === 'IPD' ? 'AIPN ผู้ป่วยใน' : 'SSOP ผู้ป่วยนอก'} เท่านั้น</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <label className="form-group"><span className="form-label">{claimMode === 'IPD' ? 'วันที่จำหน่ายเริ่ม' : 'วันที่เริ่ม'}</span><input className="form-control" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="form-group"><span className="form-label">{claimMode === 'IPD' ? 'วันที่จำหน่ายสิ้นสุด' : 'วันที่สิ้นสุด'}</span><input className="form-control" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="form-group"><span className="form-label">เครือข่าย</span><select className="form-control" value={networkType} onChange={(e) => setNetworkType(e.target.value as NetworkType)}><option value="ALL">ทั้งหมด</option><option value="IN">ในเครือข่าย</option><option value="OUT">นอกเครือข่าย</option></select></label>
          <label className="form-group"><span className="form-label">ผลตรวจ</span><select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="ALL">ทั้งหมด</option><option value="ready">พร้อมส่ง</option><option value="warning">ควรตรวจ</option><option value="error">ต้องแก้ไข</option></select></label>
          {claimMode === 'OPD' && (
            <label className="form-group"><span className="form-label">สถานะส่งออก</span><select className="form-control" value={exportStatusFilter} onChange={(e) => setExportStatusFilter(e.target.value as typeof exportStatusFilter)}><option value="UNSENT">ยังไม่เคยส่ง (ป้องกันส่งซ้ำ)</option><option value="ERROR">ติด Error จาก สปส.</option><option value="SENT">ส่งแล้วรอผล</option><option value="PASSED">ผ่านแล้ว (A)</option><option value="ALL">แสดงทั้งหมด</option></select></label>
          )}
          <label className="form-group"><span className="form-label">ค้นหา {claimMode === 'IPD' ? 'AN / HN' : 'VN / HN'} / ชื่อ</span><input className="form-control" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา..." /></label>
          <button className="btn btn-primary" onClick={() => void loadCandidates()} disabled={loading}>{loading ? 'กำลังตรวจ...' : '🔄 ตรวจสอบข้อมูล'}</button>
        </div>
      </div></div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className="badge badge-primary">ทั้งหมด {summary.total}</span>
        <span className="badge badge-info">ในเครือข่าย {summary.inNetwork}</span>
        <span className="badge" style={{ background: '#f3e8ff', color: '#7e22ce' }}>นอกเครือข่าย {summary.outNetwork}</span>
        <span className="badge badge-success">พร้อมส่ง {summary.ready}</span>
        <span className="badge badge-warning">ควรตรวจ {summary.warning}</span>
        <span className="badge badge-danger">ต้องแก้ {summary.error}</span>
        <span className="badge" style={{ background: '#ecfeff', color: '#0f766e' }}>ยอดรวม {Number(summary.amount || 0).toLocaleString()} บาท</span>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="alert alert-success" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <span>🔢 เลขงวดส่งออก (Batch No.):</span>
              <input
                type="number"
                min="1"
                className="form-control"
                style={{ width: 130, fontWeight: 700, fontSize: 16, textAlign: 'center' }}
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                placeholder="ระบุเลขงวด"
              />
            </label>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              (งวดล่าสุด: <strong>{lastBatchNo ?? '-'}</strong> · แก้ไขเลขรันได้ตามต้องการ)
            </span>
          </div>
          <div style={{ fontSize: 13, background: 'var(--bg-subtle, #f1f5f9)', padding: '6px 12px', borderRadius: 6 }}>
            <span>🏷️ ตัวอย่างชื่อไฟล์: </span>
            <code style={{ fontWeight: 700, color: '#0369a1' }}>{previewFilename}</code>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /> เลือกทุกรายการที่ส่งได้ในผลลัพธ์ ({selectable.length})</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {claimMode === 'OPD' && (
            <button
              className="btn btn-warning"
              disabled={autoFixing || loading || (summary.error + summary.warning) === 0}
              onClick={() => void handleAutoFixBeforeExport()}
            >
              {autoFixing ? 'กำลัง Auto-Fix...' : `⚡ Auto-Fix ก่อนส่ง (${summary.error + summary.warning})`}
            </button>
          )}
          <button className="btn btn-success" disabled={exporting || selected.size === 0} onClick={() => void exportZip()}>{exporting ? 'กำลังสร้าง ZIP...' : `📦 ส่งออก ${claimMode === 'IPD' ? 'AIPN' : 'SSOPBIL'} (${selected.size})`}</button>
        </div>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /><span>กำลังตรวจเงื่อนไข {claimMode === 'IPD' ? 'AIPN' : 'SSOP'}...</span></div> : (
        <div className="card"><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>
          <th></th><th>#</th><th>{claimMode === 'IPD' ? 'AN / HN' : 'VN / HN'}</th><th>ผู้ป่วย</th><th>{claimMode === 'IPD' ? 'วันที่ Admit / D/C' : 'วันที่บริการ'}</th><th>สิทธิ์/เครือข่าย</th><th>PDX</th><th style={{ textAlign: 'right' }}>ยอด</th><th>ผลตรวจ {claimMode === 'IPD' ? 'AIPN' : 'SSOP'}</th>{claimMode === 'OPD' && <th>จัดการ</th>}
        </tr></thead><tbody>{filtered.map((row, index) => <tr key={candidateId(row)} className={row.validation_status === 'error' ? 'row-danger' : ''}>
          <td><input type="checkbox" disabled={row.validation_status === 'error'} checked={selected.has(candidateId(row))} onChange={() => setSelected((current) => { const next = new Set(current); const id = candidateId(row); if (next.has(id)) next.delete(id); else next.add(id); return next; })} /></td>
          <td>{index + 1}</td><td><strong>{claimMode === 'IPD' ? row.an : row.vn}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>HN {row.hn}</div></td>
          <td>{row.patient_name}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>CID {row.cid || '-'}</div></td>
          <td>{claimMode === 'IPD' ? <><div>Admit {row.admit_date || '-'}</div><div style={{ fontSize: 11 }}>D/C {row.discharge_date || '-'}</div></> : <>{row.service_date}<div style={{ fontSize: 11 }}>เริ่ม {row.service_time}</div>{row.end_datetime && <div style={{ fontSize: 11, color: '#0f766e' }}>สิ้นสุด {row.end_datetime.slice(11, 19) || row.end_datetime}</div>}</>}</td>
          <td><div>{row.pttype}: {row.pttype_name}</div><span className={`badge ${row.network_type === 'IN' ? 'badge-info' : 'badge-warning'}`}>{row.network_type === 'IN' ? 'ในเครือข่าย' : 'นอกเครือข่าย'}</span></td>
          <td>{row.pdx || '-'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(row.income || 0).toLocaleString()}</td>
          <td>
            <span className={`badge ${row.validation_status === 'ready' ? 'badge-success' : row.validation_status === 'warning' ? 'badge-warning' : 'badge-danger'}`}>{statusLabel[row.validation_status]}</span>
            {claimMode === 'OPD' && (
              <div style={{ marginTop: 4 }}>
                {row.export_status === 'PASSED' && <span className="badge badge-success">✓ ผ่าน สปส. (A)</span>}
                {row.export_status === 'ERROR' && <span className="badge badge-danger">✕ ติด Error: {row.last_error_code || 'C'}</span>}
                {row.export_status === 'SENT' && <span className="badge badge-info">📤 ส่งแล้วงวด #{row.last_batch_no || '-'}</span>}
                {(!row.export_status || row.export_status === 'UNSENT') && <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>ยังไม่ส่ง</span>}
              </div>
            )}
            {row.issues.length > 0 && <details style={{ marginTop: 5, maxWidth: 310 }}><summary style={{ cursor: 'pointer', fontSize: 11 }}>{row.issues.length} จุด</summary>{row.issues.map((issue) => <div key={issue.code} style={{ fontSize: 11, color: issue.severity === 'error' ? '#b91c1c' : '#92400e', marginTop: 3 }}><strong>{issue.code}</strong> {issue.message}</div>)}</details>}
          </td>
          {claimMode === 'OPD' && (
            <td>
              <button
                className={`btn btn-sm ${row.validation_status !== 'ready' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => openEditModal(row)}
              >
                ✏️ แก้ไข
              </button>
            </td>
          )}
        </tr>)}</tbody></table></div></div>
      )}

      {editingRow && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>✏️ แก้ไขข้อมูลก่อนส่งออก (VN: {editingRow.vn})</h3>
                <button className="btn btn-sm btn-secondary" onClick={() => setEditingRow(null)}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                {editingRow.patient_name} · HN {editingRow.hn} · เริ่มบริการ {editingRow.service_date} {editingRow.service_time}
                {editingRow.rx_datetime && <> · สั่งยา {editingRow.rx_datetime}</>}
              </div>
              {editingRow.issues.length > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 12, display: 'block' }}>
                  <strong style={{ display: 'block', marginBottom: 4 }}>จุดที่ตรวจพบ:</strong>
                  {editingRow.issues.map((iss) => (
                    <div key={iss.code} style={{ fontSize: 12 }}>• <strong>{iss.code}</strong>: {iss.message}</div>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="form-group">
                  <span className="form-label">เลขที่ใบแจ้งหนี้ (Invoice No.)</span>
                  <input className="form-control" value={editForm.invoice_no} onChange={(e) => setEditForm((f) => ({ ...f, invoice_no: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label">รหัสคลินิก (01-12, 99)</span>
                  <input className="form-control" value={editForm.clinic} onChange={(e) => setEditForm((f) => ({ ...f, clinic: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label">เลข ว. แพทย์ (เช่น ว12345)</span>
                  <input className="form-control" value={editForm.doctor_license} onChange={(e) => setEditForm((f) => ({ ...f, doctor_license: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label">HospMain (5 หลัก)</span>
                  <input className="form-control" value={editForm.hospmain} onChange={(e) => setEditForm((f) => ({ ...f, hospmain: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label">รหัสโรคหลัก (PDX)</span>
                  <input className="form-control" value={editForm.pdx} onChange={(e) => setEditForm((f) => ({ ...f, pdx: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label">วัน-เวลาสิ้นสุดบริการ</span>
                  <input className="form-control" value={editForm.end_datetime} onChange={(e) => setEditForm((f) => ({ ...f, end_datetime: e.target.value }))} placeholder="YYYY-MM-DD HH:mm:ss" />
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setEditForm((f) => ({ ...f, end_datetime: computePlus30FromRxOrStart(editingRow) }))}
                >
                  ⏱️ เติมเวลาสิ้นสุด (+30 นาทีจาก{editingRow.rx_datetime ? 'เวลาสั่งยา' : 'เวลาเริ่มบริการ'})
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingRow(null)}>ยกเลิก</button>
                  <button type="button" className="btn btn-primary" disabled={savingEdit} onClick={() => void handleSaveEdit()}>
                    {savingEdit ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไข'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
