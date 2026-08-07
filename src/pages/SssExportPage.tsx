import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatLocalDateInput } from '../utils/dateUtils';

type NetworkType = 'ALL' | 'IN' | 'OUT';
type ValidationStatus = 'ready' | 'warning' | 'error';

interface SssIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

interface SssCandidate {
  vn: string;
  hn: string;
  patient_name: string;
  cid: string;
  service_date: string;
  service_time: string;
  pttype: string;
  pttype_name: string;
  network_type: 'IN' | 'OUT';
  hospmain: string;
  pdx: string;
  invoice_no: string;
  income: number;
  validation_status: ValidationStatus;
  issues: SssIssue[];
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

export const SssExportPage: React.FC = () => {
  const today = formatLocalDateInput();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [networkType, setNetworkType] = useState<NetworkType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ValidationStatus>('ALL');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<SssCandidate[]>([]);
  const [summary, setSummary] = useState<SssSummary>(emptySummary);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadCandidates = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setMessage('');
      const params = new URLSearchParams({ startDate, endDate, networkType });
      const response = await fetch(`/api/sss/candidates?${params.toString()}`);
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
  }, [endDate, networkType, startDate]);

  useEffect(() => { void loadCandidates(); }, [loadCandidates]);

  const filtered = useMemo(() => rows.filter((row) => {
    if (statusFilter !== 'ALL' && row.validation_status !== statusFilter) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [row.vn, row.hn, row.cid, row.patient_name, row.pttype_name].some((value) => String(value || '').toLowerCase().includes(needle));
  }), [rows, search, statusFilter]);
  const selectable = filtered.filter((row) => row.validation_status !== 'error');
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.vn));

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) selectable.forEach((row) => next.delete(row.vn));
      else selectable.forEach((row) => next.add(row.vn));
      return next;
    });
  };

  const exportZip = async () => {
    if (!selected.size) return setError('กรุณาเลือกรายการที่พร้อมส่งอย่างน้อย 1 รายการ');
    try {
      setExporting(true);
      setError('');
      setMessage('');
      const response = await fetch('/api/sss/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, networkType, vns: [...selected] }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || 'ส่งออก SSOP ไม่สำเร็จ');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `SSOPBIL-${endDate}.zip`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage(`ส่งออก SSOP สำเร็จ ${selected.size.toLocaleString()} visit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งออก SSOP ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">🔵 ส่งออกสิทธิ์ประกันสังคม (SSOP)</h1>
        <p className="page-subtitle">คัดกรองผู้ป่วยนอกประกันสังคม แยกในเครือข่ายและนอกเครือข่าย ก่อนสร้าง SSOPBIL</p>
      </div>

      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <span>ℹ️</span><span><strong>โมดูลนี้ไม่ตรวจการปิดสิทธิ์ EP และไม่ใช้ Authen NHSO</strong> สถานะพร้อมส่งพิจารณาจากข้อมูล SSOP เท่านั้น</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <label className="form-group"><span className="form-label">วันที่เริ่ม</span><input className="form-control" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="form-group"><span className="form-label">วันที่สิ้นสุด</span><input className="form-control" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="form-group"><span className="form-label">เครือข่าย</span><select className="form-control" value={networkType} onChange={(e) => setNetworkType(e.target.value as NetworkType)}><option value="ALL">ทั้งหมด</option><option value="IN">ในเครือข่าย</option><option value="OUT">นอกเครือข่าย</option></select></label>
          <label className="form-group"><span className="form-label">ผลตรวจ</span><select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="ALL">ทั้งหมด</option><option value="ready">พร้อมส่ง</option><option value="warning">ควรตรวจ</option><option value="error">ต้องแก้ไข</option></select></label>
          <label className="form-group"><span className="form-label">ค้นหา VN / HN / ชื่อ</span><input className="form-control" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา..." /></label>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /> เลือกทุกรายการที่ส่งได้ในผลลัพธ์ ({selectable.length})</label>
        <button className="btn btn-success" disabled={exporting || selected.size === 0} onClick={() => void exportZip()}>{exporting ? 'กำลังสร้าง ZIP...' : `📦 ส่งออก SSOPBIL (${selected.size})`}</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /><span>กำลังตรวจเงื่อนไข SSOP...</span></div> : (
        <div className="card"><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>
          <th></th><th>#</th><th>VN / HN</th><th>ผู้ป่วย</th><th>วันที่บริการ</th><th>สิทธิ์/เครือข่าย</th><th>PDX</th><th style={{ textAlign: 'right' }}>ยอด</th><th>ผลตรวจ SSOP</th>
        </tr></thead><tbody>{filtered.map((row, index) => <tr key={row.vn} className={row.validation_status === 'error' ? 'row-danger' : ''}>
          <td><input type="checkbox" disabled={row.validation_status === 'error'} checked={selected.has(row.vn)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.vn)) next.delete(row.vn); else next.add(row.vn); return next; })} /></td>
          <td>{index + 1}</td><td><strong>{row.vn}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>HN {row.hn}</div></td>
          <td>{row.patient_name}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>CID {row.cid || '-'}</div></td>
          <td>{row.service_date}<div style={{ fontSize: 11 }}>{row.service_time}</div></td>
          <td><div>{row.pttype}: {row.pttype_name}</div><span className={`badge ${row.network_type === 'IN' ? 'badge-info' : 'badge-warning'}`}>{row.network_type === 'IN' ? 'ในเครือข่าย' : 'นอกเครือข่าย'}</span></td>
          <td>{row.pdx || '-'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(row.income || 0).toLocaleString()}</td>
          <td><span className={`badge ${row.validation_status === 'ready' ? 'badge-success' : row.validation_status === 'warning' ? 'badge-warning' : 'badge-danger'}`}>{statusLabel[row.validation_status]}</span>{row.issues.length > 0 && <details style={{ marginTop: 5, maxWidth: 310 }}><summary style={{ cursor: 'pointer', fontSize: 11 }}>{row.issues.length} จุด</summary>{row.issues.map((issue) => <div key={issue.code} style={{ fontSize: 11, color: issue.severity === 'error' ? '#b91c1c' : '#92400e', marginTop: 3 }}><strong>{issue.code}</strong> {issue.message}</div>)}</details>}</td>
        </tr>)}</tbody></table></div></div>
      )}
    </div>
  );
};
