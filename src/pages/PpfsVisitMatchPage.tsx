import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchPpfsVisitMatch,
  fetchReceivableFilterOptions,
  type ReceivableFilterOptions,
  type ReconciliationResponse,
  type ReconciliationRow,
} from '../services/hosxpService';

const todayIso = () => new Date().toISOString().slice(0, 10);

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const formatCount = (value: unknown) => toNumber(value).toLocaleString('th-TH');

const formatMoney = (value: unknown) =>
  toNumber(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMoneyNull = (value: unknown) => value == null ? '-' : formatMoney(value);

const STATUS_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'ตรงกัน', label: 'ครบ/ตรงกัน' },
  { value: 'ยอดต่าง', label: 'ยอดต่าง' },
  { value: 'รอ REP', label: 'ยังไม่พบ REP' },
  { value: 'รอ STM/INV', label: 'ยังไม่พบ STM/INV' },
  { value: 'ไม่มีข้อมูล', label: 'ไม่มีข้อมูลรับกลับ' },
];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  'ตรงกัน': { bg: '#dcfce7', color: '#15803d' },
  'ยอดต่าง': { bg: '#fee2e2', color: '#b91c1c' },
  'รอ REP': { bg: '#fef3c7', color: '#b45309' },
  'รอ STM/INV': { bg: '#ede9fe', color: '#7c3aed' },
  'ไม่มีข้อมูล': { bg: '#f3f4f6', color: '#4b5563' },
};

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

const StatusBadge = ({ status }: { status: string }) => {
  const tone = STATUS_STYLE[status] || STATUS_STYLE['ไม่มีข้อมูล'];
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      background: tone.bg,
      color: tone.color,
      fontSize: '0.76rem',
      fontWeight: 750,
      whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
};

const SummaryCard = ({
  label,
  value,
  sub,
  tone = '#1e40af',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) => (
  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' }}>
    <div style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 750 }}>{label}</div>
    <div style={{ color: tone, fontSize: '1.25rem', fontWeight: 900, marginTop: 4 }}>{value}</div>
    {sub && <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginTop: 3 }}>{sub}</div>}
  </div>
);

export const PpfsVisitMatchPage = () => {
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(todayIso());
  const [patientType, setPatientType] = useState('OPD');
  const [hosxpRight, setHosxpRight] = useState('ALL');
  const [compareStatus, setCompareStatus] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const [filterOptions, setFilterOptions] = useState<ReceivableFilterOptions>({ hosxpRights: [], financeRights: [] });
  const [result, setResult] = useState<ReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchReceivableFilterOptions()
      .then(setFilterOptions)
      .catch(() => {});
  }, []);

  const rows = useMemo(() => result?.data || [], [result]);
  const total = result?.total || 0;
  const summary = result?.summary || null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => [
      row.vn,
      row.an,
      row.hn,
      row.cid,
      row.patient_name,
      row.pttype_name,
      row.claim_summary,
      row.rep_tran_id,
      row.stm_statement_no,
    ].join(' ').toLowerCase().includes(term));
  }, [rows, search]);

  const handleLoad = async (newPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchPpfsVisitMatch({
        startDate,
        endDate,
        patientType: patientType === 'ALL' ? undefined : patientType,
        hosxpRight: hosxpRight === 'ALL' ? undefined : hosxpRight,
        compareStatus: compareStatus || undefined,
        page: newPage,
        pageSize,
      });
      setResult(data);
      setPage(newPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (filteredRows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(filteredRows.map((row) => ({
      วันที่: row.service_date,
      VN: row.vn || '',
      AN: row.an || '',
      HN: row.hn,
      CID: row.cid || '',
      ชื่อผู้ป่วย: row.patient_name,
      สิทธิ์: row.pttype_name || row.pttype,
      กลุ่มบัญชี: row.account_group || '',
      รายการใน_HOSxP: row.claim_summary || '',
      ยอดตั้ง_PPFS: row.claimable_amount,
      REP: row.rep_amount ?? '',
      STM: row.stm_amount ?? '',
      รับ_STM: row.stm_paid_amount ?? '',
      INV: row.inv_amount ?? '',
      Tran_ID: row.rep_tran_id || '',
      REP_No: row.rep_no || '',
      STM_No: row.stm_statement_no || '',
      สถานะ: row.compare_status,
      ประเด็น: row.issue_status,
      ส่วนต่างรับ_STM: row.diff_stm_paid ?? '',
      REP_Error: [row.rep_errorcode, row.rep_verifycode].filter(Boolean).join(' / '),
      STM_Error: [row.stm_errorcode, row.stm_verifycode].filter(Boolean).join(' / '),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PPFS Match');
    XLSX.writeFile(wb, `ppfs_visit_match_${startDate}_${endDate}.xlsx`);
  };

  return (
    <div style={{ padding: '20px 16px', maxWidth: 1480, margin: '0 auto' }}>
      <section className="workflow-hero" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title workflow-hero__title">Match PPFS กับ HOSxP Visit</h1>
          <p className="page-subtitle">
            ตรวจรายการลูกหนี้กลุ่ม P&P / PPFS ว่าเจอ visit ใน HOSxP, มีข้อมูล REP/STM/INV รับกลับ และยอดรับตรงกับยอดตั้งหรือไม่
          </p>
        </div>
        <div className="workflow-hero__meta">
          <span className="workflow-badge">Source: HOSxP + REP/STM/INV</span>
          <span className="workflow-badge">Payment source PPFS</span>
        </div>
      </section>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div className="form-group">
            <label className="form-label">วันที่เริ่ม</label>
            <input className="form-control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">วันที่สิ้นสุด</label>
            <input className="form-control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">ประเภท</label>
            <select className="form-control" value={patientType} onChange={(event) => setPatientType(event.target.value)}>
              <option value="OPD">OPD</option>
              <option value="IPD">IPD</option>
              <option value="ALL">ทั้งหมด</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">สิทธิ์ HOSxP</label>
            <select className="form-control" value={hosxpRight} onChange={(event) => setHosxpRight(event.target.value)}>
              <option value="ALL">ทั้งหมด</option>
              {filterOptions.hosxpRights.map((right) => (
                <option key={right.code} value={right.code}>{right.code}: {right.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">สถานะ</label>
            <select className="form-control" value={compareStatus} onChange={(event) => setCompareStatus(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">แถว/หน้า</label>
            <select className="form-control" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => void handleLoad(1)} disabled={loading}>
              {loading ? 'กำลังโหลด...' : 'ตรวจสอบ'}
            </button>
            <button className="btn btn-secondary" onClick={handleExport} disabled={filteredRows.length === 0}>
              Excel
            </button>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <input
            className="form-control"
            placeholder="ค้นหา VN, HN, CID, ชื่อ, รายการ, Tran ID..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
          <SummaryCard label="Visit PPFS" value={formatCount(summary.total_visits)} />
          <SummaryCard label="ครบ/ตรงกัน" value={formatCount(summary.matched)} tone="#15803d" />
          <SummaryCard label="ยอดต่าง" value={formatCount(summary.mismatched)} tone="#b91c1c" />
          <SummaryCard label="รอ REP" value={formatCount(summary.pending_rep)} tone="#b45309" />
          <SummaryCard label="รอ STM/INV" value={formatCount(summary.pending_stm)} tone="#7c3aed" />
          <SummaryCard label="ยอดตั้ง PPFS" value={formatMoney(summary.total_claimable)} sub="บาท" />
          <SummaryCard label="ยอดรับ STM" value={formatMoney(summary.total_stm_paid)} sub="บาท" tone="#047857" />
          <SummaryCard label="STM จ่าย 0" value={formatCount(summary.stm_zero)} tone="#b91c1c" />
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ color: '#64748b', fontSize: '0.84rem' }}>
            แสดง {formatCount(filteredRows.length)} รายการในหน้านี้ จากทั้งหมด {formatCount(total)}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={() => void handleLoad(page - 1)} disabled={page <= 1 || loading}>ก่อนหน้า</button>
            <span style={{ color: '#475569', fontWeight: 750 }}>หน้า {page}/{totalPages}</span>
            <button className="btn btn-secondary" onClick={() => void handleLoad(page + 1)} disabled={page >= totalPages || loading}>ถัดไป</button>
          </div>
        </div>
      )}

      {result && (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
          <table className="data-table long-id-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>VN/AN</th>
                <th>HN</th>
                <th>ชื่อผู้ป่วย</th>
                <th>สิทธิ์</th>
                <th>รายการใน HOSxP</th>
                <th className="text-right">ยอดตั้ง</th>
                <th className="text-right">REP</th>
                <th className="text-right">รับ STM</th>
                <th className="text-right">ต่าง STM</th>
                <th>เลขรับกลับ</th>
                <th>ประเด็น</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row: ReconciliationRow) => (
                <tr key={`${row.visit_key}-${row.rep_tran_id || row.stm_statement_no || ''}`}>
                  <td className="table-cell-nowrap">{row.service_date || '-'}</td>
                  <td className="table-cell-nowrap workflow-id-cell">{row.vn || row.an || '-'}</td>
                  <td className="table-cell-nowrap workflow-id-cell">{row.hn || '-'}</td>
                  <td style={{ minWidth: 170 }}>{row.patient_name || '-'}</td>
                  <td style={{ minWidth: 150 }}>{row.pttype_name || row.pttype || '-'}</td>
                  <td style={{ minWidth: 240, maxWidth: 360 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.claim_summary || ''}>
                      {row.claim_summary || row.account_group || '-'}
                    </div>
                  </td>
                  <td className="text-right" style={{ fontWeight: 850 }}>{formatMoney(row.claimable_amount)}</td>
                  <td className="text-right">{formatMoneyNull(row.rep_amount)}</td>
                  <td className="text-right">{formatMoneyNull(row.stm_paid_amount)}</td>
                  <td className="text-right" style={{ color: row.diff_stm_paid == null ? '#64748b' : Math.abs(row.diff_stm_paid) < 0.01 ? '#15803d' : '#b91c1c', fontWeight: 850 }}>
                    {formatMoneyNull(row.diff_stm_paid)}
                  </td>
                  <td style={{ minWidth: 160, color: '#64748b', fontSize: '0.76rem' }}>
                    <div>{row.rep_tran_id || row.rep_no || '-'}</div>
                    <div>{row.stm_statement_no || ''}</div>
                  </td>
                  <td style={{ minWidth: 130, color: row.issue_status === 'ปกติ' ? '#15803d' : '#b91c1c', fontWeight: 750 }}>
                    {row.issue_status || '-'}
                  </td>
                  <td><StatusBadge status={row.compare_status} /></td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr><td colSpan={13} className="empty-cell">ไม่พบข้อมูลตามเงื่อนไข</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!result && !loading && (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '48px 0' }}>
          เลือกช่วงวันที่แล้วกดตรวจสอบ เพื่อ match รายการ PPFS กับ visit ใน HOSxP
        </div>
      )}
    </div>
  );
};

export default PpfsVisitMatchPage;
