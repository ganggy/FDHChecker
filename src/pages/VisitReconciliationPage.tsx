import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchReceivableReconciliation,
  fetchReceivableFilterOptions,
  type ReconciliationRow,
  type ReconciliationSummary,
  type ReceivableFilterOptions,
} from '../services/hosxpService';

const todayIso = () => new Date().toISOString().slice(0, 10);

const firstOfYear = () => {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
};

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (value: unknown) =>
  toNumber(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMoneyNull = (value: unknown) => {
  if (value == null) return '-';
  return formatMoney(value);
};

const COMPARE_STATUS_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'ตรงกัน', label: 'ตรงกัน' },
  { value: 'ยอดต่าง', label: 'ยอดต่าง' },
  { value: 'รอ REP', label: 'รอ REP' },
  { value: 'รอ STM/INV', label: 'รอ STM/INV' },
  { value: 'ไม่มีข้อมูล', label: 'ไม่มีข้อมูล' },
];

const STATUS_COLOR: Record<string, string> = {
  'ตรงกัน': '#15803d',
  'ยอดต่าง': '#b91c1c',
  'รอ REP': '#b45309',
  'รอ STM/INV': '#7c3aed',
  'ไม่มีข้อมูล': '#6b7280',
};

const STATUS_BG: Record<string, string> = {
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
  label, value, sub, color,
}: { label: string; value: string | number; sub?: string; color?: string }) => (
  <div style={{
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '12px 16px',
    minWidth: 130,
    flex: '1 1 130px',
  }}>
    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: color || '#111827' }}>{value}</div>
    {sub && <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
  </div>
);

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

export const VisitReconciliationPage = () => {
  const [startDate, setStartDate] = useState(firstOfYear());
  const [endDate, setEndDate] = useState(todayIso());
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
      'ยอด STM': r.stm_amount ?? '',
      'ชำระ STM': r.stm_paid_amount ?? '',
      'ยอด INV': r.inv_amount ?? '',
      'เบิก INV': r.inv_invoice_amount ?? '',
      'ส่วนต่าง REP': r.diff_rep ?? '',
      'ส่วนต่าง STM': r.diff_stm ?? '',
      'ส่วนต่าง INV': r.diff_inv ?? '',
      'สถานะ': r.compare_status,
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
    <div style={{ padding: '20px 16px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>
          🔄 กระทบยอด REP / STM / INV visit
        </h2>
        <p style={{ color: '#6b7280', fontSize: '0.88rem', margin: 0 }}>
          เปรียบเทียบยอดตั้งลูกหนี้กับข้อมูล REP, STM, INV visit เพื่อตรวจสอบความสอดคล้อง
        </p>
      </div>

      {/* Filter Panel */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '16px 20px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end',
      }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            วันที่เริ่ม
          </label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            วันที่สิ้นสุด
          </label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            ประเภทผู้ป่วย
          </label>
          <select
            value={patientType}
            onChange={e => setPatientType(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="OPD">OPD</option>
            <option value="IPD">IPD</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            สิทธิ์ (HOSxP)
          </label>
          <select
            value={hosxpRight}
            onChange={e => setHosxpRight(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', maxWidth: 200 }}
          >
            <option value="ALL">ทั้งหมด</option>
            {filterOptions.hosxpRights.map(r => (
              <option key={r.code} value={r.code}>{r.code}: {r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            สถานะกระทบยอด
          </label>
          <select
            value={compareStatus}
            onChange={e => setCompareStatus(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}
          >
            {COMPARE_STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            แถวต่อหน้า
          </label>
          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}
          >
            {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button
          onClick={() => handleLoad(1)}
          disabled={loading}
          style={{
            padding: '8px 18px', background: loading ? '#9ca3af' : '#2563eb',
            color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600,
            fontSize: '0.9rem', cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'กำลังโหลด...' : '🔍 โหลดข้อมูล'}
        </button>
        {rows.length > 0 && (
          <button
            onClick={handleExport}
            style={{
              padding: '8px 16px', background: '#16a34a', color: '#fff',
              border: 'none', borderRadius: 7, fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
            }}
          >
            📥 Export Excel
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12, fontSize: '0.88rem' }}>
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <SummaryCard label="วิสิตทั้งหมด" value={summary.total_visits.toLocaleString('th-TH')} />
          <SummaryCard label="ตรงกัน" value={summary.matched.toLocaleString('th-TH')} color="#15803d" />
          <SummaryCard label="ยอดต่าง" value={summary.mismatched.toLocaleString('th-TH')} color="#b91c1c" />
          <SummaryCard label="รอ REP" value={summary.pending_rep.toLocaleString('th-TH')} color="#b45309" />
          <SummaryCard label="รอ STM/INV" value={summary.pending_stm.toLocaleString('th-TH')} color="#7c3aed" />
          <SummaryCard label="ไม่มีข้อมูล" value={summary.no_data.toLocaleString('th-TH')} color="#6b7280" />
          <SummaryCard label="ยอดตั้งลูกหนี้รวม" value={`฿${formatMoney(summary.total_claimable)}`} color="#1e40af" />
          <SummaryCard label="ยอด REP รวม" value={`฿${formatMoney(summary.total_rep)}`} />
          <SummaryCard label="ยอด STM รวม" value={`฿${formatMoney(summary.total_stm)}`} />
          <SummaryCard label="ยอด INV รวม" value={`฿${formatMoney(summary.total_inv)}`} />
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: '0.85rem', color: '#374151' }}>
              แสดง {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} จาก {total.toLocaleString('th-TH')} รายการ
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={() => handleLoad(1)}
                disabled={page === 1 || loading}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: page === 1 ? '#f9fafb' : '#fff', cursor: page === 1 ? 'default' : 'pointer', fontSize: '0.82rem' }}
              >«</button>
              <button
                onClick={() => handleLoad(page - 1)}
                disabled={page === 1 || loading}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: page === 1 ? '#f9fafb' : '#fff', cursor: page === 1 ? 'default' : 'pointer', fontSize: '0.82rem' }}
              >‹ ก่อนหน้า</button>
              <span style={{ fontSize: '0.82rem', color: '#374151', padding: '4px 8px' }}>หน้า {page}/{totalPages}</span>
              <button
                onClick={() => handleLoad(page + 1)}
                disabled={page >= totalPages || loading}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: page >= totalPages ? '#f9fafb' : '#fff', cursor: page >= totalPages ? 'default' : 'pointer', fontSize: '0.82rem' }}
              >ถัดไป ›</button>
              <button
                onClick={() => handleLoad(totalPages)}
                disabled={page >= totalPages || loading}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: page >= totalPages ? '#f9fafb' : '#fff', cursor: page >= totalPages ? 'default' : 'pointer', fontSize: '0.82rem' }}
              >»</button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
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
                  {th('ยอด INV', 'inv_amount', 'right')}
                  {th('ส่วนต่าง REP', 'diff_rep', 'right')}
                  {th('ส่วนต่าง STM', 'diff_stm', 'right')}
                  {th('เลขที่ REP', 'rep_no')}
                  {th('สถานะ', 'compare_status')}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => {
                  const isOdd = idx % 2 === 1;
                  return (
                    <tr key={`${row.visit_key}:${idx}`} style={{ background: isOdd ? '#f9fafb' : '#fff' }}>
                      <td style={{ padding: '7px 10px', color: '#374151' }}>
                        <span style={{
                          padding: '1px 7px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
                          background: row.patient_type === 'IPD' ? '#dbeafe' : '#e0fdf4',
                          color: row.patient_type === 'IPD' ? '#1d4ed8' : '#065f46',
                        }}>
                          {row.patient_type}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{row.service_date || '-'}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{row.hn}</td>
                      <td style={{ padding: '7px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.patient_name}
                      </td>
                      <td style={{ padding: '7px 10px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.pttype_name || row.pttype}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {row.vn || row.an || '-'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#1e40af' }}>
                        {formatMoney(row.claimable_amount)}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: row.has_rep ? '#166534' : '#9ca3af' }}>
                        {row.has_rep ? formatMoney(row.rep_amount) : '-'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: row.has_stm ? '#166534' : '#9ca3af' }}>
                        {row.has_stm ? formatMoney(row.stm_amount) : '-'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: row.has_inv ? '#166534' : '#9ca3af' }}>
                        {row.has_inv ? formatMoney(row.inv_amount) : '-'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: row.diff_rep == null ? '#9ca3af' : Math.abs(toNumber(row.diff_rep)) < 0.01 ? '#166534' : '#b91c1c', fontWeight: row.diff_rep != null ? 600 : undefined }}>
                        {formatMoneyNull(row.diff_rep)}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: row.diff_stm == null ? '#9ca3af' : Math.abs(toNumber(row.diff_stm)) < 0.01 ? '#166534' : '#b91c1c', fontWeight: row.diff_stm != null ? 600 : undefined }}>
                        {formatMoneyNull(row.diff_stm)}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.76rem', color: '#6b7280', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.rep_no || '-'}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <StatusBadge status={row.compare_status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && rows.length === 0 && summary && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280', fontSize: '0.95rem' }}>
          ไม่พบข้อมูลในช่วงวันที่และเงื่อนไขที่เลือก
        </div>
      )}

      {!loading && !summary && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af', fontSize: '1rem' }}>
          เลือกช่วงวันที่แล้วกด <strong>โหลดข้อมูล</strong> เพื่อเปรียบเทียบยอด REP / STM / INV
        </div>
      )}
    </div>
  );
};

export default VisitReconciliationPage;
