import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchReceivableFilterOptions,
  fetchUuc1Tracking,
  type ReceivableFilterOptions,
  type Uuc1TrackingRow,
  type Uuc1TrackingSummary,
} from '../services/hosxpService';

const todayIso = () => new Date().toISOString().slice(0, 10);

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const toNumber = (value: unknown) => {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const formatMoney = (value: unknown) => toNumber(value).toLocaleString('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  return String(value).slice(0, 10);
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
};

const optionLabel = (code?: string | null, name?: string | null) => {
  const safeCode = String(code || '').trim();
  const safeName = String(name || '').trim();
  if (safeCode && safeName) return `${safeCode}: ${safeName}`;
  return safeName || safeCode || '-';
};

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'pending_rep', label: 'รอ REP' },
  { value: 'pending_stm', label: 'รอ STM' },
  { value: 'stm_zero', label: 'STM = 0' },
  { value: 'rep_issue', label: 'ติด C/Deny' },
  { value: 'mismatch', label: 'ยอดต่าง' },
  { value: 'paid', label: 'ได้รับ STM' },
];

const PATIENT_RIGHT_OPTIONS = [
  { value: 'ALL', label: 'ทุกสิทธิ' },
  { value: 'UCS', label: 'UC/WEL' },
  { value: 'OFC', label: 'ข้าราชการ/OFC' },
  { value: 'SSS', label: 'ประกันสังคม' },
  { value: 'LGO', label: 'ท้องถิ่น' },
];

const PAGE_SIZE_OPTIONS = [100, 200, 500, 1000];

const statusToneClass = (key: string) => {
  if (key === 'paid') return 'uuc1-status uuc1-status--paid';
  if (key === 'stm_zero' || key === 'rep_issue') return 'uuc1-status uuc1-status--danger';
  if (key === 'mismatch') return 'uuc1-status uuc1-status--warning';
  if (key === 'pending_stm') return 'uuc1-status uuc1-status--purple';
  return 'uuc1-status uuc1-status--muted';
};

const moneyOrDash = (value: unknown) => {
  if (value == null || value === '') return '-';
  return formatMoney(value);
};

const diffClass = (value: unknown) => {
  if (value == null || value === '') return 'uuc1-money uuc1-money--muted';
  return Math.abs(toNumber(value)) < 0.01
    ? 'uuc1-money uuc1-money--ok'
    : 'uuc1-money uuc1-money--bad';
};

const StatCard = ({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'blue' | 'green' | 'amber' | 'red' | 'purple';
}) => (
  <div className={`uuc1-stat uuc1-stat--${tone}`}>
    <div className="uuc1-stat__label">{label}</div>
    <div className="uuc1-stat__value">{value}</div>
    {sub && <div className="uuc1-stat__sub">{sub}</div>}
  </div>
);

export const Uuc1TrackingPage = () => {
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(todayIso());
  const [patientType, setPatientType] = useState('OPD');
  const [patientRight, setPatientRight] = useState('ALL');
  const [hosxpRight, setHosxpRight] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(200);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Uuc1TrackingRow[]>([]);
  const [summary, setSummary] = useState<Uuc1TrackingSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<ReceivableFilterOptions>({ hosxpRights: [], financeRights: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReceivableFilterOptions()
      .then(setFilterOptions)
      .catch(() => setFilterOptions({ hosxpRights: [], financeRights: [] }));
    void loadData(1);
    // Initial load intentionally uses the default filters; later loads are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData(nextPage = 1) {
    try {
      setLoading(true);
      setError('');
      const result = await fetchUuc1Tracking({
        startDate,
        endDate,
        patientType,
        patientRight: patientRight === 'ALL' ? undefined : patientRight,
        hosxpRight: hosxpRight === 'ALL' ? undefined : hosxpRight,
        status: status === 'ALL' ? undefined : status,
        search: search.trim() || undefined,
        page: nextPage,
        pageSize,
      });
      setRows(result.data || []);
      setSummary(result.summary || null);
      setTotal(result.total || 0);
      setPage(result.page || nextPage);
    } catch (err) {
      setRows([]);
      setSummary(null);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลติดตาม UUC1 ได้');
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const exportExcel = () => {
    if (rows.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(rows.map((row, index) => ({
      ลำดับ: ((page - 1) * pageSize) + index + 1,
      ประเภท: row.patient_type,
      วันที่บริการ: formatDate(row.service_date),
      VN: row.vn || '',
      AN: row.an || '',
      HN: row.hn || '',
      CID: row.cid || '',
      ผู้ป่วย: row.patient_name || '',
      สิทธิ์: optionLabel(row.pttype || row.hipdata_code, row.pttype_name),
      ยอดส่ง_UUC1: row.sent_amount,
      เลข_REP: row.rep_no || '',
      วันนำเข้า_REP: formatDateTime(row.rep_imported_at),
      ยอด_REP: row.rep_amount ?? '',
      REP_Error: row.rep_errorcode || '',
      REP_Verify: row.rep_verifycode || '',
      เลข_STM: row.stm_statement_no || '',
      วันนำเข้า_STM: formatDateTime(row.stm_imported_at),
      ยอด_STM: row.stm_amount ?? '',
      ยอดรับ_STM: row.stm_paid_amount ?? '',
      ส่วนต่าง_REP: row.diff_rep ?? '',
      ส่วนต่าง_STM: row.diff_stm ?? '',
      สถานะ: row.followup_status,
      หมายเหตุ: row.followup_note,
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'UUC1 Tracking');
    XLSX.writeFile(workbook, `uuc1_rep_stm_${startDate}_${endDate}.xlsx`);
  };

  return (
    <div className="uuc1-page workflow-page">
      <section className="workflow-hero uuc1-hero">
        <div className="workflow-hero__content">
          <div>
            <h1 className="page-title workflow-hero__title">📌 ติดตาม UUC1 → REP/STM</h1>
            <p className="workflow-hero__description">
              ติดตาม visit ที่ส่งออกแบบ UUC1 เทียบกับ REP และ STM/INV ที่นำเข้าไว้ในฐาน repstminv
              เพื่อเห็นยอดส่ง, วันที่ได้รับ REP, วันที่นำเข้า STM และเคสที่ STM จ่าย 0 ได้ในหน้าเดียว
            </p>
          </div>
          <div className="workflow-hero__meta">
            <span className="workflow-badge workflow-badge--accent">{total.toLocaleString('th-TH')} รายการ</span>
            <span className="workflow-badge">REP ล่าสุด {formatDateTime(summary?.last_rep_import_at)}</span>
            <span className="workflow-badge">STM ล่าสุด {formatDateTime(summary?.last_stm_import_at)}</span>
          </div>
        </div>
      </section>

      <section className="workflow-panel uuc1-filter-panel">
        <div className="card-body">
          <div className="workflow-filter-grid uuc1-filter-grid">
            <div className="form-group">
              <label>วันที่เริ่ม</label>
              <input className="form-control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </div>
            <div className="form-group">
              <label>วันที่สิ้นสุด</label>
              <input className="form-control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </div>
            <div className="form-group">
              <label>ประเภทผู้ป่วย</label>
              <select className="form-control" value={patientType} onChange={(event) => setPatientType(event.target.value)}>
                <option value="OPD">OPD</option>
                <option value="IPD">IPD</option>
                <option value="ALL">ทั้งหมด</option>
              </select>
            </div>
            <div className="form-group">
              <label>กลุ่มสิทธิ</label>
              <select className="form-control" value={patientRight} onChange={(event) => setPatientRight(event.target.value)}>
                {PATIENT_RIGHT_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>สิทธิ์ HOSxP</label>
              <select className="form-control" value={hosxpRight} onChange={(event) => setHosxpRight(event.target.value)}>
                <option value="ALL">ทั้งหมด</option>
                {filterOptions.hosxpRights.map((item) => (
                  <option key={item.code} value={item.code}>{optionLabel(item.code, item.name)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>สถานะติดตาม</label>
              <select className="form-control" value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUS_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>ค้นหา</label>
              <input className="form-control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="VN / HN / CID / ชื่อ / REP" />
            </div>
            <div className="form-group">
              <label>แถวต่อหน้า</label>
              <select className="form-control" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>
            <div className="workflow-filter-actions uuc1-actions">
              <button className="btn btn-primary" onClick={() => loadData(1)} disabled={loading}>
                {loading ? 'กำลังโหลด...' : 'โหลดข้อมูล'}
              </button>
              <button className="btn btn-secondary" onClick={exportExcel} disabled={rows.length === 0}>
                ส่งออก Excel
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="error-message">⚠️ {error}</div>}

      <section className="uuc1-summary-grid">
        <StatCard label="UUC1 ทั้งหมด" value={(summary?.total_visits || 0).toLocaleString('th-TH')} sub={`ยอดส่ง ${formatMoney(summary?.total_sent || 0)} บาท`} tone="blue" />
        <StatCard label="ได้รับ REP" value={(summary?.rep_received || 0).toLocaleString('th-TH')} sub={`ยอด REP ${formatMoney(summary?.total_rep || 0)} บาท`} tone="green" />
        <StatCard label="รอ REP" value={(summary?.pending_rep || 0).toLocaleString('th-TH')} tone="amber" />
        <StatCard label="รอ STM" value={(summary?.pending_stm || 0).toLocaleString('th-TH')} tone="purple" />
        <StatCard label="STM = 0" value={(summary?.stm_zero || 0).toLocaleString('th-TH')} sub={`ยอดรับ STM ${formatMoney(summary?.total_stm_paid || 0)} บาท`} tone="red" />
        <StatCard label="ติด C/Deny / ยอดต่าง" value={`${(summary?.rep_issue || 0).toLocaleString('th-TH')} / ${(summary?.mismatch || 0).toLocaleString('th-TH')}`} tone="amber" />
      </section>

      <section className="card workflow-table-card uuc1-table-card">
        <div className="card-header">
          <div>
            <div className="workflow-table-title">รายการติดตาม UUC1 REP/STM</div>
            <div className="workflow-table-meta">
              แสดง {rows.length === 0 ? 0 : ((page - 1) * pageSize) + 1}-
              {Math.min(page * pageSize, total).toLocaleString('th-TH')} จาก {total.toLocaleString('th-TH')} รายการ
            </div>
          </div>
          <div className="uuc1-pager">
            <button className="btn btn-secondary" onClick={() => loadData(page - 1)} disabled={loading || page <= 1}>ก่อนหน้า</button>
            <span>หน้า {page.toLocaleString('th-TH')} / {totalPages.toLocaleString('th-TH')}</span>
            <button className="btn btn-secondary" onClick={() => loadData(page + 1)} disabled={loading || page >= totalPages}>ถัดไป</button>
          </div>
        </div>
        <div className="modal-table-wrap uuc1-table-wrap">
          <table className="data-table long-id-table uuc1-table">
            <thead>
              <tr>
                <th>สถานะ</th>
                <th>วันที่บริการ</th>
                <th>VN/AN</th>
                <th>HN</th>
                <th>ผู้ป่วย</th>
                <th>สิทธิ์</th>
                <th className="text-right">ยอดส่ง UUC1</th>
                <th>เลข REP</th>
                <th>นำเข้า REP</th>
                <th className="text-right">ยอด REP</th>
                <th>นำเข้า STM</th>
                <th className="text-right">ยอด STM</th>
                <th className="text-right">รับ STM</th>
                <th className="text-right">ต่าง REP</th>
                <th className="text-right">ต่าง STM</th>
                <th>วันรอ</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.visit_key}:${index}`}>
                  <td>
                    <span className={statusToneClass(row.followup_status_key)}>{row.followup_status}</span>
                  </td>
                  <td className="table-cell-nowrap">{formatDate(row.service_date)}</td>
                  <td className="workflow-id-cell">{row.vn || row.an || '-'}</td>
                  <td className="workflow-id-cell">{row.hn || '-'}</td>
                  <td className="workflow-person-cell">{row.patient_name || '-'}</td>
                  <td>
                    <div className="uuc1-right-cell">{row.pttype_name || row.pttype || '-'}</div>
                    <small>{row.hipdata_code || '-'}</small>
                  </td>
                  <td className="uuc1-money">{formatMoney(row.sent_amount)}</td>
                  <td className="uuc1-ref-cell" title={row.rep_filename || ''}>{row.rep_no || '-'}</td>
                  <td>
                    <div>{formatDateTime(row.rep_imported_at)}</div>
                    {row.rep_errorcode && <small className="uuc1-danger-text">{row.rep_errorcode}</small>}
                  </td>
                  <td className="uuc1-money">{moneyOrDash(row.rep_amount)}</td>
                  <td>
                    <div>{formatDateTime(row.stm_imported_at)}</div>
                    {row.stm_statement_no && <small>{row.stm_statement_no}</small>}
                  </td>
                  <td className="uuc1-money">{moneyOrDash(row.stm_amount)}</td>
                  <td className="uuc1-money">{moneyOrDash(row.stm_paid_amount)}</td>
                  <td className={diffClass(row.diff_rep)}>{moneyOrDash(row.diff_rep)}</td>
                  <td className={diffClass(row.diff_stm)}>{moneyOrDash(row.diff_stm)}</td>
                  <td className="uuc1-wait-cell">
                    <span>REP {row.days_to_rep ?? '-'}</span>
                    <span>STM {row.days_to_stm ?? '-'}</span>
                  </td>
                  <td className="uuc1-note-cell">{row.followup_note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <div className="empty-state">
              ไม่พบข้อมูล UUC1 ตามเงื่อนไขที่เลือก
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Uuc1TrackingPage;
