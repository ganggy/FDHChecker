import React, { useEffect, useMemo, useState } from 'react';
import { FDHPreviewModal } from '../components/FDHPreviewModal';
import { formatLocalDateInput, formatLocalDateStamp } from '../utils/dateUtils';
import { isFailedFdhSubmission, isMissingFdhStatus } from '../utils/fdhClaimProgress';

type AuditStatus = 'clear' | 'review' | 'risk';
type FdhStatusFilter = 'all' | 'not-submitted' | 'failed' | 'submitted';
type ReadinessFilter = 'all' | 'ready' | 'pending';

type IpdExportRow = {
  an: string;
  hn: string;
  vn: string;
  patientName: string;
  ward?: string;
  admDate?: string;
  dchdate?: string;
  los?: number;
  pttype?: string;
  hipdata_code?: string;
  pdx?: string;
  drg?: string;
  rw?: number;
  totalPrice?: number;
  audit_status?: string;
  export_ready?: boolean;
  export_issues?: string[];
  pre_audit?: {
    status: AuditStatus;
    findingCount: number;
    riskCount: number;
    reviewCount: number;
    findings: Array<{ code: string; severity: 'risk' | 'review'; title: string; message: string }>;
  };
  fdh_transaction_uid?: string;
  fdh_status_label?: string;
  fdh_reservation_status?: string;
  fdh_claim_status_message?: string;
  fdh_error_code?: string;
  fdh_updated_at?: string;
  fdh_claim_code?: string;
  fdh_upload_uid?: string;
  fdh_claim_detail_status?: string;
  fdh_claim_detail_sent_at?: string;
};

type ValidationResult = {
  valid: boolean;
  totalRows: number;
  counts?: Record<string, number>;
  errors: Array<{ code: string; file?: string; row?: number; field?: string; message: string }>;
  warnings: Array<{ code: string; file?: string; row?: number; field?: string; message: string }>;
};

const firstDayOfCurrentMonth = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
};

const hasFdhSubmission = (row: IpdExportRow) => Boolean(
  row.fdh_transaction_uid
  || row.fdh_claim_code
  || row.fdh_upload_uid
  || row.fdh_claim_detail_sent_at
  || row.fdh_updated_at
  || !isMissingFdhStatus(
    row.fdh_claim_detail_status
    || row.fdh_reservation_status
    || row.fdh_claim_status_message
    || row.fdh_status_label,
  )
);

const fdhLabel = (row: IpdExportRow) => row.fdh_status_label
  || row.fdh_claim_detail_status
  || row.fdh_reservation_status
  || row.fdh_claim_status_message
  || 'ยังไม่พบข้อมูล FDH';

const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const readJsonError = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  const issues = payload?.validation?.errors?.slice(0, 5).map((issue: { message?: string }) => issue.message).filter(Boolean).join('\n');
  return `${payload?.error || payload?.message || `HTTP ${response.status}`}${issues ? `\n\n${issues}` : ''}`;
};

export const IpdFdhExportPage: React.FC = () => {
  const [rows, setRows] = useState<IpdExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState(firstDayOfCurrentMonth());
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [search, setSearch] = useState('');
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all');
  const [auditFilter, setAuditFilter] = useState<AuditStatus | 'all'>('all');
  const [fdhStatusFilter, setFdhStatusFilter] = useState<FdhStatusFilter>('all');
  const [selectedAns, setSelectedAns] = useState<string[]>([]);
  const [confirmResend, setConfirmResend] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, unknown[]> | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    setError('');
    setSelectedAns([]);
    try {
      const query = new URLSearchParams({ startDate, endDate, statusFilter: 'discharged' });
      const response = await fetch(`/api/hosxp/ipd-list?${query}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'โหลดรายการ IPD ไม่สำเร็จ');
      setRows(Array.isArray(payload.data) ? payload.data : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : 'โหลดรายการ IPD ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSelectable = (row: IpdExportRow) => Boolean(row.export_ready)
    && (isFailedFdhSubmission(row) || confirmResend || !hasFdhSubmission(row));

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (readinessFilter === 'ready' && !row.export_ready) return false;
    if (readinessFilter === 'pending' && row.export_ready) return false;
    if (auditFilter !== 'all' && (row.pre_audit?.status || 'clear') !== auditFilter) return false;
    const submitted = hasFdhSubmission(row);
    if (fdhStatusFilter === 'not-submitted' && submitted) return false;
    if (fdhStatusFilter === 'submitted' && !submitted) return false;
    if (fdhStatusFilter === 'failed' && !isFailedFdhSubmission(row)) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [row.an, row.hn, row.patientName, row.ward, row.pttype, row.hipdata_code, row.pdx, row.drg, fdhLabel(row)]
      .some((value) => String(value || '').toLowerCase().includes(query));
  }), [rows, readinessFilter, auditFilter, fdhStatusFilter, search]);

  const selectableRows = filteredRows.filter(isSelectable);
  const selectedRows = rows.filter((row) => selectedAns.includes(row.an) && isSelectable(row));
  const exportRows = selectedRows.length > 0 ? selectedRows : selectableRows;
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedAns.includes(row.an));

  const toggleAll = (checked: boolean) => {
    if (!checked) return setSelectedAns([]);
    setSelectedAns(selectableRows.map((row) => row.an));
  };

  const toggleRow = (an: string) => setSelectedAns((current) => (
    current.includes(an) ? current.filter((value) => value !== an) : [...current, an]
  ));

  const buildPayload = () => ({
    vns: exportRows.map((row) => row.vn),
    patientType: 'IPD',
    profile: 'standard',
    uucByVn: Object.fromEntries(exportRows.map((row) => [row.vn, '1'])),
  });

  const ensureRows = () => {
    if (exportRows.length > 0) return true;
    alert('ไม่มีรายการ IPD พร้อมส่งในตัวกรองปัจจุบัน');
    return false;
  };

  const preview = async () => {
    if (!ensureRows()) return;
    setPreviewing(true);
    try {
      const response = await fetch('/api/fdh/view-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'สร้างตัวอย่างไม่สำเร็จ');
      setPreviewData(payload.data);
      setValidation(payload.validation || null);
      setPreviewOpen(true);
    } catch (previewError) {
      alert(previewError instanceof Error ? previewError.message : 'สร้างตัวอย่างไม่สำเร็จ');
    } finally {
      setPreviewing(false);
    }
  };

  const downloadZip = async () => {
    if (!ensureRows()) return;
    setExporting(true);
    try {
      const response = await fetch('/api/fdh/export-zip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...buildPayload(), includeHeader: true }),
      });
      if (!response.ok) throw new Error(await readJsonError(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `FDH_IPD_16Files_${formatLocalDateStamp()}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      alert(downloadError instanceof Error ? downloadError.message : 'ส่งออก ZIP ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  const submit = async () => {
    if (!ensureRows()) return;
    const resendCount = exportRows.filter(hasFdhSubmission).length;
    const confirmation = confirmResend
      ? `ยืนยันส่ง IPD ${exportRows.length} AN ไป FDH API?\nมี ${resendCount} AN ที่เคยส่งและจะถูกส่งซ้ำ`
      : `ยืนยันส่ง IPD ${exportRows.length} AN ที่ยังไม่เคยส่ง/ส่งไม่ผ่าน ไป FDH API?`;
    if (!window.confirm(confirmation)) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/fdh/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...buildPayload(), confirm: true }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setValidation(payload.validation || validation);
        throw new Error(payload.error || payload.message || 'FDH API ปฏิเสธข้อมูล');
      }
      alert(`ส่ง IPD ไป FDH สำเร็จ\nBatch: ${payload.batchUid}\n${payload.submittedVisits} admissions / ${payload.submittedFiles?.length || 0} files`);
      setPreviewOpen(false);
      await loadRows();
    } catch (submitError) {
      alert(submitError instanceof Error ? submitError.message : 'ส่ง FDH API ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const readyCount = rows.filter((row) => row.export_ready).length;
  const notSubmittedCount = rows.filter((row) => !hasFdhSubmission(row)).length;
  const failedCount = rows.filter(isFailedFdhSubmission).length;
  const submittedCount = rows.length - notSubmittedCount;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">📤 ส่งออกผู้ป่วยใน (IPD 16 แฟ้ม)</h1>
        <p className="page-subtitle">คัดเลือกด้วย AN ตรวจ Pre-audit/Preflight และส่ง FDH แยกจากรายการ OPD</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div className="form-group"><label className="form-label">ค้นหา AN / HN / ชื่อ</label><input className="form-control" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="form-group"><label className="form-label">วันที่เริ่ม</label><input type="date" className="form-control" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <div className="form-group"><label className="form-label">วันที่สิ้นสุด</label><input type="date" className="form-control" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
          <div className="form-group"><label className="form-label">ความพร้อม</label><select className="form-control" value={readinessFilter} onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)}><option value="all">ทั้งหมด</option><option value="ready">พร้อมส่ง</option><option value="pending">รอแก้ไข</option></select></div>
          <div className="form-group"><label className="form-label">IPD Pre-audit</label><select className="form-control" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as AuditStatus | 'all')}><option value="all">ทุกผลตรวจ</option><option value="risk">พบความเสี่ยง</option><option value="review">ต้องทบทวน</option><option value="clear">ผ่านอัตโนมัติ</option></select></div>
          <div className="form-group"><label className="form-label">สถานะ FDH</label><select className="form-control" value={fdhStatusFilter} onChange={(event) => setFdhStatusFilter(event.target.value as FdhStatusFilter)}><option value="all">ทั้งหมด</option><option value="not-submitted">ยังไม่ส่ง</option><option value="failed">ส่งไม่ผ่าน</option><option value="submitted">เคยส่งแล้ว</option></select></div>
          <button className="btn btn-primary" type="button" onClick={loadRows} disabled={loading}>{loading ? 'กำลังประมวลผล...' : '🔄 ดึงข้อมูลใหม่'}</button>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="badge badge-primary">IPD จำหน่ายแล้ว {rows.length}</span>
        <span className="badge badge-success">พร้อมส่ง {readyCount}</span>
        <span className="badge badge-warning">รอแก้ไข {rows.length - readyCount}</span>
        <span className="badge badge-info">ยังไม่ส่ง {notSubmittedCount}</span>
        <span className="badge badge-danger">ส่งไม่ผ่าน {failedCount}</span>
        <span className="badge">เคยส่งแล้ว {submittedCount}</span>
      </div>

      <div className="card" style={{ marginBottom: 110, overflow: 'hidden' }}>
        {loading ? <div className="loading-container"><div className="spinner" /><span>กำลังโหลดและประมวลผล IPD Pre-audit...</span></div> : (
          <div className="modal-table-wrap">
            <table className="data-table">
              <thead><tr><th style={{ width: 44, textAlign: 'center' }}><input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleAll(event.target.checked)} /></th><th>AN / HN</th><th>ผู้ป่วย</th><th>Admit / D/C</th><th>สิทธิ / Ward</th><th>PDx / DRG</th><th>IPD Pre-audit</th><th>สถานะ FDH</th><th>ความพร้อม</th><th style={{ textAlign: 'right' }}>ค่าใช้จ่าย</th></tr></thead>
              <tbody>
                {filteredRows.map((row) => {
                  const selectable = isSelectable(row);
                  const audit = row.pre_audit;
                  return <tr key={row.an} style={{ opacity: selectable ? 1 : 0.72 }}>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={selectedAns.includes(row.an)} disabled={!selectable} onChange={() => toggleRow(row.an)} /></td>
                    <td><strong style={{ color: 'var(--primary)' }}>{row.an}</strong><br /><small>HN {row.hn}</small></td>
                    <td>{row.patientName}<br /><small>LOS {row.los ?? '-'} วัน</small></td>
                    <td>{row.admDate || '-'}<br /><small>D/C {row.dchdate || '-'}</small></td>
                    <td>{row.pttype || row.hipdata_code || '-'}<br /><small>{row.ward || '-'}</small></td>
                    <td><strong>{row.pdx || '-'}</strong><br /><small>DRG {row.drg || '-'} · RW {row.rw || '-'}</small></td>
                    <td><span className={`badge ${audit?.status === 'risk' ? 'badge-danger' : audit?.status === 'review' ? 'badge-warning' : 'badge-success'}`}>{audit?.status === 'risk' ? `เสี่ยง ${audit.riskCount}` : audit?.status === 'review' ? `ทบทวน ${audit.reviewCount}` : 'ผ่านอัตโนมัติ'}</span>{audit?.findings?.length ? <details style={{ marginTop: 5, maxWidth: 290 }}><summary style={{ cursor: 'pointer', fontSize: 11 }}>{audit.findings.map((finding) => finding.code).join(', ')}</summary>{audit.findings.map((finding, index) => <div key={`${finding.code}-${index}`} style={{ fontSize: 11, marginTop: 4, color: finding.severity === 'risk' ? '#b91c1c' : '#92400e' }}><strong>{finding.code}</strong>: {finding.message}</div>)}</details> : null}</td>
                    <td><span className={`badge ${isFailedFdhSubmission(row) ? 'badge-danger' : hasFdhSubmission(row) ? 'badge-info' : 'badge-warning'}`}>{fdhLabel(row)}</span>{row.fdh_error_code ? <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{row.fdh_error_code}</div> : null}</td>
                    <td>{row.export_ready ? <span className="badge badge-success">พร้อมส่ง</span> : <span className="badge badge-warning">รอแก้ไข</span>}<div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{row.export_issues?.join(' · ')}</div></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(row.totalPrice)}</td>
                  </tr>;
                })}
                {filteredRows.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>ไม่พบรายการตามเงื่อนไข</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ position: 'fixed', left: 24, right: 24, bottom: 18, zIndex: 90, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.96)', border: '1px solid var(--border)', boxShadow: '0 12px 35px rgba(15,23,42,.18)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ marginRight: 'auto' }}>เลือกส่ง {exportRows.length} AN {selectedRows.length === 0 && exportRows.length > 0 ? '(รายการพร้อมส่งที่มองเห็นทั้งหมด)' : ''}</strong>
        <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={confirmResend} onChange={(event) => { setConfirmResend(event.target.checked); setSelectedAns([]); }} /> ยืนยันให้เลือกและส่งรายการที่เคยส่งซ้ำ</label>
        <button className="btn btn-secondary" type="button" onClick={preview} disabled={previewing || exportRows.length === 0}>{previewing ? 'กำลังตรวจ...' : '🔎 Preview / Preflight'}</button>
        <button className="btn btn-warning" type="button" onClick={downloadZip} disabled={exporting || exportRows.length === 0}>{exporting ? 'กำลังสร้าง ZIP...' : '📦 ดาวน์โหลด 16 แฟ้ม'}</button>
        <button className="btn btn-success" type="button" onClick={submit} disabled={submitting || exportRows.length === 0}>{submitting ? 'กำลังส่ง...' : '🚀 ส่ง FDH API'}</button>
      </div>

      <FDHPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} validation={validation} onDownload={downloadZip} isDownloading={exporting} onSubmit={submit} isSubmitting={submitting} />
    </div>
  );
};
