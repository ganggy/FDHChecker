import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import './VisitReconciliationPage.css';
import {
  fetchReceivableReconciliation,
  fetchReceivableFilterOptions,
  type ReconciliationRow,
  type ReconciliationSummary,
  type ReceivableFilterOptions,
} from '../services/hosxpService';
import { consumeDashboardNavigation } from '../utils/navigationState';

const todayIso = () => new Date().toISOString().slice(0, 10);

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (value: unknown) =>
  toNumber(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COMPARE_STATUS_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'เสร็จสิ้น (INV)', label: 'เสร็จสิ้น (มีเงิน INV)' },
  { value: 'ตรงกัน', label: 'ตรงกัน' },
  { value: 'ยอดต่าง', label: 'ยอดต่าง' },
  { value: 'รอ REP', label: 'รอ REP' },
  { value: 'รอ STM/INV', label: 'รอ STM/INV' },
  { value: 'ไม่มีข้อมูล', label: 'ไม่มีข้อมูล' },
];

const STATUS_COLOR: Record<string, string> = {
  'เสร็จสิ้น (INV)': '#047857',
  'ตรงกัน': '#15803d',
  'ยอดต่าง': '#b91c1c',
  'รอ REP': '#b45309',
  'รอ STM/INV': '#7c3aed',
  'ไม่มีข้อมูล': '#6b7280',
};

const STATUS_BG: Record<string, string> = {
  'เสร็จสิ้น (INV)': '#d1fae5',
  'ตรงกัน': '#dcfce7',
  'ยอดต่าง': '#fee2e2',
  'รอ REP': '#fef3c7',
  'รอ STM/INV': '#ede9fe',
  'ไม่มีข้อมูล': '#f3f4f6',
};

const StatusBadge = ({ status }: { status: string }) => (
  <span style={{
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: '0.78rem',
    fontWeight: 600,
    backgroundColor: STATUS_BG[status] || '#f3f4f6',
    color: STATUS_COLOR[status] || '#374151',
    whiteSpace: 'nowrap',
  }}>
    {status}
  </span>
);

const SummaryCard = ({
  label, value, sub, accent = 'blue',
}: { label: string; value: string | number; sub?: string; accent?: string }) => (
  <div className={`summary-metric-card accent-${accent}`}>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    {sub && <div className="metric-subtext">{sub}</div>}
  </div>
);

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

export const VisitReconciliationPage = () => {
  const [dashboardNavigation] = useState(() => consumeDashboardNavigation('reconciliation'));
  const [startDate, setStartDate] = useState(dashboardNavigation?.startDate || firstOfMonth());
  const [endDate, setEndDate] = useState(dashboardNavigation?.endDate || todayIso());
  const [patientType, setPatientType] = useState('ALL');
  const [hosxpRight, setHosxpRight] = useState('ALL');
  const [compareStatus, setCompareStatus] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);

  const [filterOptions, setFilterOptions] = useState<ReceivableFilterOptions>({ hosxpRights: [], financeRights: [] });
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sort state
  const [sortCol, setSortCol] = useState<keyof ReconciliationRow>('service_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    fetchReceivableFilterOptions()
      .then(setFilterOptions)
      .catch(() => {});
  }, []);

  const handleLoad = async (newPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchReceivableReconciliation({
        startDate,
        endDate,
        patientType: patientType === 'ALL' ? undefined : patientType,
        hosxpRight: hosxpRight === 'ALL' ? undefined : hosxpRight,
        compareStatus: compareStatus || undefined,
        page: newPage,
        pageSize,
      });
      setRows(result.data || []);
      setTotal(result.total || 0);
      setSummary(result.summary || null);
      setPage(newPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (col: keyof ReconciliationRow) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    const av = a[sortCol];
    const bv = b[sortCol];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const aStr = String(av);
    const bStr = String(bv);
    const cmp = aStr.localeCompare(bStr, 'th');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleExport = () => {
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'ประเภทผู้ป่วย': r.patient_type,
      'VN': r.vn || '',
      'AN': r.an || '',
      'HN': r.hn,
      'ชื่อผู้ป่วย': r.patient_name,
      'สิทธิ์': r.pttype_name || r.pttype,
      'รหัส NHSO': r.hipdata_code,
      'วันที่รับบริการ': r.service_date,
      'ยอดตั้งลูกหนี้': r.claimable_amount,
      'ยอด REP': r.rep_amount ?? '',
      'เลขที่ REP': r.rep_no || '',
      'Tran ID': r.rep_tran_id || '',
      'REP SendDate': r.rep_senddate || '',
      'REP Imported': r.rep_imported_at || '',
      'REP Error': [r.rep_errorcode, r.rep_verifycode].filter(Boolean).join(' / '),
      'ยอด STM': r.stm_amount ?? '',
      'ชำระ STM': r.stm_paid_amount ?? '',
      'เลขที่ STM': r.stm_statement_no || '',
      'STM Imported': r.stm_imported_at || '',
      'STM Error': [r.stm_errorcode, r.stm_verifycode].filter(Boolean).join(' / '),
      'ยอดรับสุทธิ INV': r.inv_amount ?? '',
      'เบิก INV': r.inv_invoice_amount ?? '',
      'ส่วนต่าง REP': r.diff_rep ?? '',
      'ส่วนต่าง STM': r.diff_stm ?? '',
      'ส่วนต่างยอดรับ STM': r.diff_stm_paid ?? '',
      'ส่วนต่าง INV': r.diff_inv ?? '',
      'สถานะ': r.compare_status,
      'ประเด็น': r.issue_status,
      'วันถึง REP': r.days_to_rep ?? '',
      'วันถึง STM': r.days_to_stm ?? '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
    XLSX.writeFile(wb, `reconciliation_${startDate}_${endDate}.xlsx`);
  };

  const SortIcon = ({ col }: { col: keyof ReconciliationRow }) => {
    if (sortCol !== col) return <span style={{ opacity: 0.3 }}> ↕</span>;
    return <span>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>;
  };

  const th = (label: string, col: keyof ReconciliationRow, align: 'left' | 'right' = 'left') => (
    <th
      onClick={() => handleSort(col)}
      style={{
        padding: '8px 10px',
        background: '#f1f5f9',
        borderBottom: '2px solid #e2e8f0',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        textAlign: align,
        fontSize: '0.8rem',
        fontWeight: 600,
        color: '#374151',
      }}
    >
      {label}<SortIcon col={col} />
    </th>
  );

  return (
    <div className="reconciliation-page">
      {/* Hero Section */}
      <section className="reconciliation-hero">
        <div className="reconciliation-hero-content">
          <div className="reconciliation-badge">
            <span>Audit & Reconciliation</span>
          </div>
          <h1>
            <span>🔄</span>
            <span>กระทบยอด REP / STM / INV Visit</span>
          </h1>
          <p>
            เปรียบเทียบยอดตั้งลูกหนี้กับข้อมูลผลตอบรับ REP, สลิปโอนเงิน STM และใบแจ้งหนี้ INV ราย Visit เพื่อความถูกต้องทางการเงิน
          </p>
        </div>
        <div className="reconciliation-hero-info">
          <div className="reconciliation-hero-info-row">
            <span className="reconciliation-hero-info-label">ช่วงวันที่ตรวจสอบ</span>
            <span className="reconciliation-hero-info-val">{startDate} ถึง {endDate}</span>
          </div>
          <div className="reconciliation-hero-info-row">
            <span className="reconciliation-hero-info-label">ประเภทผู้ป่วย</span>
            <span className="reconciliation-hero-info-val">{patientType === 'ALL' ? 'ทั้งหมด (OPD + IPD)' : patientType}</span>
          </div>
          {summary && (
            <div className="reconciliation-hero-info-row">
              <span className="reconciliation-hero-info-label">อัตราตรงกัน/เสร็จสิ้น</span>
              <span className="reconciliation-hero-info-val" style={{ color: '#059669' }}>
                {summary.total_visits > 0
                  ? `${Math.round(((summary.completed_inv + summary.matched) / summary.total_visits) * 100)}%`
                  : '0%'}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Filter Card */}
      <section className="reconciliation-filter-card">
        <div className="reconciliation-filter-grid">
          <div className="reconciliation-form-group">
            <label>📅 วันที่เริ่ม</label>
            <input
              type="date"
              className="reconciliation-input"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div className="reconciliation-form-group">
            <label>📅 วันที่สิ้นสุด</label>
            <input
              type="date"
              className="reconciliation-input"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
          <div className="reconciliation-form-group">
            <label>🏥 ประเภทผู้ป่วย</label>
            <select
              className="reconciliation-select"
              value={patientType}
              onChange={e => setPatientType(e.target.value)}
            >
              <option value="ALL">ทั้งหมด (OPD/IPD)</option>
              <option value="OPD">OPD (ผู้ป่วยนอก)</option>
              <option value="IPD">IPD (ผู้ป่วยใน)</option>
            </select>
          </div>
          <div className="reconciliation-form-group">
            <label>🏷️ สิทธิ์ (HOSxP)</label>
            <select
              className="reconciliation-select"
              value={hosxpRight}
              onChange={e => setHosxpRight(e.target.value)}
            >
              <option value="ALL">ทั้งหมดทุกสิทธิ์</option>
              {filterOptions.hosxpRights.map(r => (
                <option key={r.code} value={r.code}>{r.code}: {r.name}</option>
              ))}
            </select>
          </div>
          <div className="reconciliation-form-group">
            <label>📊 สถานะกระทบยอด</label>
            <select
              className="reconciliation-select"
              value={compareStatus}
              onChange={e => setCompareStatus(e.target.value)}
            >
              {COMPARE_STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="reconciliation-form-group">
            <label>📄 แสดงต่อหน้า</label>
            <select
              className="reconciliation-select"
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s} แถว</option>)}
            </select>
          </div>
          <div className="reconciliation-filter-actions">
            <button
              className="rec-btn rec-btn-primary"
              onClick={() => handleLoad(1)}
              disabled={loading}
            >
              {loading ? '⏳ กำลังโหลด...' : '🔍 โหลดข้อมูล'}
            </button>
            {rows.length > 0 && (
              <button
                className="rec-btn rec-btn-success"
                onClick={handleExport}
              >
                📥 ส่งออก Excel ({rows.length.toLocaleString('th-TH')})
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Error Message */}
      {error && (
        <div style={{ padding: '12px 18px', background: '#fee2e2', color: '#991b1b', borderRadius: 14, marginBottom: 16, fontSize: '0.9rem', fontWeight: 600 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Summary Dashboard */}
      {summary && (
        <section className="reconciliation-summary-dashboard">
          <div>
            <div className="summary-group-title">
              <span>👥 สรุปสถานะการจับคู่ Visit</span>
            </div>
            <div className="summary-cards-row">
              <SummaryCard label="Visit ทั้งหมด" value={summary.total_visits.toLocaleString('th-TH')} accent="blue" />
              <SummaryCard label="เสร็จสิ้นจาก INV" value={(summary.completed_inv || 0).toLocaleString('th-TH')} sub="มีเงิน INV เข้าแล้ว" accent="emerald" />
              <SummaryCard label="ตรงกัน 100%" value={summary.matched.toLocaleString('th-TH')} sub="ยอดลูกหนี้ = REP/STM" accent="emerald" />
              <SummaryCard label="ยอดต่าง" value={summary.mismatched.toLocaleString('th-TH')} sub="ยอดไม่ตรงกัน" accent="rose" />
              <SummaryCard label="รอ REP" value={summary.pending_rep.toLocaleString('th-TH')} sub="ยังไม่พบผลตอบรับ" accent="amber" />
              <SummaryCard label="รอ STM / INV" value={summary.pending_stm.toLocaleString('th-TH')} sub="รอรับชำระเงิน" accent="purple" />
              <SummaryCard label="ไม่มีข้อมูล" value={summary.no_data.toLocaleString('th-TH')} sub="ยังไม่ส่งตรวจ" accent="gray" />
            </div>
          </div>

          <div>
            <div className="summary-group-title">
              <span>💰 เปรียบเทียบยอดเงินทางบัญชี</span>
            </div>
            <div className="summary-cards-row">
              <SummaryCard label="ยอดตั้งลูกหนี้รวม" value={`฿${formatMoney(summary.total_claimable)}`} sub="ยอดเรียกเก็บตามสิทธิ์" accent="blue" />
              <SummaryCard label="ยอด REP รวม" value={`฿${formatMoney(summary.total_rep)}`} sub="ตอบรับจากกองทุน" accent="teal" />
              <SummaryCard label="ยอด STM รวม" value={`฿${formatMoney(summary.total_stm)}`} sub="ยอดแจ้งโอน" accent="purple" />
              <SummaryCard label="ยอดรับจริง (STM Paid)" value={`฿${formatMoney(summary.total_stm_paid)}`} sub="เงินโอนเข้าบัญชีจริง" accent="emerald" />
              <SummaryCard label="ยอดรับสุทธิ INV" value={`฿${formatMoney(summary.total_inv)}`} sub="เงินตามใบเสร็จ INV" accent="teal" />
            </div>
          </div>

          <div>
            <div className="summary-group-title">
              <span>⚠️ รายการที่ต้องติดตาม / ตรวจสอบ</span>
            </div>
            <div className="summary-cards-row">
              <SummaryCard label="REP C / Deny" value={summary.rep_issue.toLocaleString('th-TH')} sub="ติดปัญหา C หรือปฏิเสธ" accent="rose" />
              <SummaryCard label="STM = 0 บาท" value={summary.stm_zero.toLocaleString('th-TH')} sub="ชดเชย 0 บาท" accent="rose" />
              <SummaryCard label="รับขาด / รับเกิน" value={`${summary.underpaid.toLocaleString('th-TH')} / ${summary.overpaid.toLocaleString('th-TH')}`} sub="รายการขาด / เกิน" accent="amber" />
            </div>
          </div>
        </section>
      )}

      {/* Table Section */}
      {rows.length > 0 && (
        <section className="reconciliation-table-card">
          <div className="reconciliation-table-header">
            <div className="rec-count-badge">
              <span>📋 แสดง {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} จาก {total.toLocaleString('th-TH')} รายการ</span>
            </div>
            <div className="rec-pagination">
              <button
                className="rec-page-btn"
                onClick={() => handleLoad(1)}
                disabled={page === 1 || loading}
                title="หน้าแรก"
              >«</button>
              <button
                className="rec-page-btn"
                onClick={() => handleLoad(page - 1)}
                disabled={page === 1 || loading}
                title="ก่อนหน้า"
              >‹ ก่อนหน้า</button>
              <span className="rec-page-indicator">หน้า {page} / {totalPages}</span>
              <button
                className="rec-page-btn"
                onClick={() => handleLoad(page + 1)}
                disabled={page >= totalPages || loading}
                title="ถัดไป"
              >ถัดไป ›</button>
              <button
                className="rec-page-btn"
                onClick={() => handleLoad(totalPages)}
                disabled={page >= totalPages || loading}
                title="หน้าสุดท้าย"
              >»</button>
            </div>
          </div>

          <div className="reconciliation-table-wrap">
            <table className="rec-table">
              <thead>
                <tr>
                  {th('ประเภท', 'patient_type')}
                  {th('วันที่', 'service_date')}
                  {th('HN', 'hn')}
                  {th('ชื่อผู้ป่วย', 'patient_name')}
                  {th('สิทธิ์', 'pttype_name')}
                  {th('VN/AN', 'vn')}
                  {th('ยอดตั้งลูกหนี้', 'claimable_amount', 'right')}
                  {th('ยอด REP', 'rep_amount', 'right')}
                  {th('ยอด STM', 'stm_amount', 'right')}
                  {th('รับ STM', 'stm_paid_amount', 'right')}
                  {th('รับสุทธิ INV', 'inv_amount', 'right')}
                  {th('ส่วนต่าง REP', 'diff_rep', 'right')}
                  {th('ต่างรับ STM', 'diff_stm_paid', 'right')}
                  {th('เลขที่ REP', 'rep_no')}
                  {th('เลขที่ STM', 'stm_statement_no')}
                  {th('ประเด็น', 'issue_status')}
                  {th('สถานะ', 'compare_status')}
                  {th('วัน REP/STM', 'days_to_rep')}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => {
                  return (
                    <tr key={`${row.visit_key}:${idx}`}>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 700,
                          background: row.patient_type === 'IPD' ? '#dbeafe' : '#dcfce7',
                          color: row.patient_type === 'IPD' ? '#1d4ed8' : '#15803d',
                        }}>
                          {row.patient_type}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{row.service_date || '-'}</td>
                      <td className="rec-td-mono">{row.hn}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {row.patient_name}
                      </td>
                      <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.pttype_name || row.pttype}
                      </td>
                      <td className="rec-td-mono" style={{ fontSize: '0.78rem' }}>
                        {row.vn || row.an || '-'}
                      </td>
                      <td className="rec-td-num" style={{ color: '#1e40af' }}>
                        {formatMoney(row.claimable_amount)}
                      </td>
                      <td className="rec-td-num" style={{ color: row.has_rep ? '#166534' : '#94a3b8' }}>
                        {row.has_rep ? formatMoney(row.rep_amount) : '-'}
                      </td>
                      <td className="rec-td-num" style={{ color: row.has_stm ? '#166534' : '#94a3b8' }}>
                        {row.has_stm ? formatMoney(row.stm_amount) : '-'}
                      </td>
                      <td className="rec-td-num" style={{ color: row.has_stm ? '#166534' : '#94a3b8', fontWeight: 700 }}>
                        {row.has_stm ? formatMoney(row.stm_paid_amount) : '-'}
                      </td>
                      <td className="rec-td-num" style={{ color: row.has_inv ? '#166534' : '#94a3b8' }}>
                        {row.has_inv ? formatMoney(row.inv_amount) : '-'}
                      </td>
                      <td className="rec-td-num">
                        {row.diff_rep == null ? '-' : Math.abs(toNumber(row.diff_rep)) < 0.01 ? (
                          <span className="rec-diff-zero">{formatMoney(row.diff_rep)}</span>
                        ) : (
                          <span className="rec-diff-nonzero">{formatMoney(row.diff_rep)}</span>
                        )}
                      </td>
                      <td className="rec-td-num">
                        {row.diff_stm_paid == null ? '-' : Math.abs(toNumber(row.diff_stm_paid)) < 0.01 ? (
                          <span className="rec-diff-zero">{formatMoney(row.diff_stm_paid)}</span>
                        ) : (
                          <span className="rec-diff-nonzero">{formatMoney(row.diff_stm_paid)}</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.76rem', color: '#64748b', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div>{row.rep_no || '-'}</div>
                        {row.rep_senddate && <small>{row.rep_senddate}</small>}
                      </td>
                      <td style={{ fontSize: '0.76rem', color: '#64748b', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div>{row.stm_statement_no || '-'}</div>
                        {row.stm_imported_at && <small>{row.stm_imported_at}</small>}
                      </td>
                      <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: row.issue_status === 'ปกติ' ? '#166534' : '#b91c1c', fontWeight: 700 }}>
                        {row.issue_status || '-'}
                      </td>
                      <td>
                        <StatusBadge status={row.compare_status} />
                      </td>
                      <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>
                        {row.days_to_rep ?? '-'} / {row.days_to_stm ?? '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Empty State when searched but nothing found */}
      {!loading && rows.length === 0 && summary && (
        <div className="reconciliation-empty-container">
          <div className="rec-empty-icon">🔍</div>
          <div className="rec-empty-title">ไม่พบรายการที่ตรงกับเงื่อนไข</div>
          <div className="rec-empty-desc">
            ไม่พบข้อมูลการกระทบยอดในช่วงวันที่ <strong>{startDate}</strong> ถึง <strong>{endDate}</strong> สำหรับเงื่อนไขที่เลือก กรุณาลองปรับช่วงวันที่หรือตัวกรองสถานะ
          </div>
        </div>
      )}

      {/* Empty State before search */}
      {!loading && !summary && (
        <div className="reconciliation-empty-container">
          <div className="rec-empty-icon">🗂️</div>
          <div className="rec-empty-title">เริ่มต้นตรวจสอบการกระทบยอด REP / STM / INV</div>
          <div className="rec-empty-desc">
            เลือกช่วงวันที่และสิทธิ์ที่ต้องการตรวจสอบ แล้วกดปุ่ม <strong>โหลดข้อมูล</strong> ระบบจะดึงยอดตั้งลูกหนี้สิทธิ์มาเปรียบเทียบกับผลตอบรับ REP, สลิปโอนเงิน STM และใบเสร็จ INV เพื่อตรวจหายอดต่างและรายการค้างชดเชย
          </div>
          <button className="rec-btn rec-btn-primary" onClick={() => handleLoad(1)} disabled={loading}>
            {loading ? 'กำลังโหลด...' : '🔍 โหลดข้อมูลทันที'}
          </button>
        </div>
      )}
    </div>
  );
};

export default VisitReconciliationPage;
