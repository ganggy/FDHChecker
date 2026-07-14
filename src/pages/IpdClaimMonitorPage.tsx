import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { RepStmVisitModal } from '../components/RepStmVisitModal';
import { formatLocalDateInput } from '../utils/dateUtils';

type ImportHealth = {
  data_type?: string;
  row_count?: number;
  last_import_at?: string | null;
};

type IpdOverviewRow = {
  an?: string;
  vn?: string;
  hn?: string;
  patient_name?: string;
  admdate?: string;
  dchdate?: string;
  pttype?: string;
  pttype_name?: string;
  hipdata_code?: string;
  income?: number;
  expected_receivable?: number;
  fdh_found?: boolean;
  fdh_source?: string;
  fdh_claim_code?: string | null;
  fdh_status?: string;
  fdh_followup_note?: string;
  fdh_sent_at?: string | null;
  days_dch_to_fdh?: number | null;
  rep_no?: string | null;
  rep_received_at?: string | null;
  days_dch_to_rep?: number | null;
  rep_amount?: number | null;
  diff_amount?: number | null;
  errorcode?: string | null;
};

type ReconciliationRow = {
  patient_type?: string;
  an?: string;
  vn?: string;
  rep_no?: string | null;
  rep_amount?: number | null;
  rep_imported_at?: string | null;
  rep_errorcode?: string | null;
  rep_verifycode?: string | null;
  has_rep?: boolean;
  stm_amount?: number | null;
  stm_paid_amount?: number | null;
  stm_statement_no?: string | null;
  stm_imported_at?: string | null;
  stm_errorcode?: string | null;
  stm_verifycode?: string | null;
  has_stm?: boolean;
  inv_amount?: number | null;
  inv_statement_no?: string | null;
  inv_imported_at?: string | null;
  has_inv?: boolean;
  diff_rep?: number | null;
  diff_stm_paid?: number | null;
  compare_status?: string;
  issue_status?: string;
  days_to_rep?: number | null;
  days_to_stm?: number | null;
};

type MonitorRow = IpdOverviewRow & ReconciliationRow & {
  stageKey: StageKey;
  stageLabel: string;
  stageNote: string;
};

type StageKey = 'pending_fdh' | 'pending_rep' | 'rep_issue' | 'pending_statement' | 'inv_only' | 'stm_issue' | 'complete';

const STAGES: Array<{ key: StageKey | 'all'; label: string }> = [
  { key: 'all', label: 'ทุกสถานะ' },
  { key: 'pending_fdh', label: 'รอ FDH' },
  { key: 'pending_rep', label: 'รอ REP' },
  { key: 'rep_issue', label: 'REP ติด C/Deny' },
  { key: 'pending_statement', label: 'รอ INV/STM' },
  { key: 'inv_only', label: 'มี INV รอ STM' },
  { key: 'stm_issue', label: 'STM ผิดปกติ' },
  { key: 'complete', label: 'ครบกระบวนการ' },
];

const firstDayOfMonth = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
};

const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const meaningfulCode = (value: unknown) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return !['', '-', '--', '0', 'N/A', 'NA', 'NONE', 'NULL'].includes(normalized);
};

const visitKey = (row: { an?: string; vn?: string }) => {
  const an = String(row.an || '').trim();
  if (an) return `AN:${an}`;
  return `VN:${String(row.vn || '').trim()}`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).replace('T', ' ').slice(0, 16);
  return parsed.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
};

const resolveStage = (row: IpdOverviewRow & ReconciliationRow): Pick<MonitorRow, 'stageKey' | 'stageLabel' | 'stageNote'> => {
  const hasRep = Boolean(row.has_rep || row.rep_no);
  const invAmount = Number(row.inv_amount || 0);
  const invCompleted = Boolean(row.has_inv && Number.isFinite(invAmount) && invAmount > 0);
  const repIssue = meaningfulCode(row.rep_errorcode || row.errorcode) || meaningfulCode(row.rep_verifycode);
  const stmIssue = meaningfulCode(row.stm_errorcode) || meaningfulCode(row.stm_verifycode)
    || (row.has_stm === true && row.stm_paid_amount != null && Math.abs(Number(row.stm_paid_amount)) < 0.01);

  if (invCompleted) return { stageKey: 'complete', stageLabel: 'ครบกระบวนการ (INV)', stageNote: `ได้รับยอดสุทธิ INV ${money(invAmount)} บาท` };
  if (!row.fdh_found) return { stageKey: 'pending_fdh', stageLabel: 'รอ FDH', stageNote: row.fdh_followup_note || 'ยังไม่พบรายการใน FDH' };
  if (!hasRep) return { stageKey: 'pending_rep', stageLabel: 'รอ REP', stageNote: 'พบ FDH แล้ว แต่ยังไม่พบ REP' };
  if (repIssue) return { stageKey: 'rep_issue', stageLabel: 'REP ติด C/Deny', stageNote: [row.rep_errorcode || row.errorcode, row.rep_verifycode].filter(meaningfulCode).join(' / ') };
  if (row.has_stm && stmIssue) return { stageKey: 'stm_issue', stageLabel: 'STM ผิดปกติ', stageNote: [row.stm_errorcode, row.stm_verifycode, Number(row.stm_paid_amount || 0) === 0 ? 'ยอดจ่าย 0' : ''].filter(Boolean).join(' / ') };
  if (row.has_stm) return { stageKey: 'complete', stageLabel: 'ครบกระบวนการ', stageNote: 'FDH, REP และ STM ครบแล้ว' };
  if (row.has_inv) return { stageKey: 'inv_only', stageLabel: 'มี INV รอ STM', stageNote: 'ได้รับ INV แล้ว รอผลจ่าย STM' };
  return { stageKey: 'pending_statement', stageLabel: 'รอ INV/STM', stageNote: 'REP ผ่านแล้ว แต่ยังไม่พบ INV หรือ STM' };
};

const stageTone = (key: StageKey) => {
  if (key === 'complete') return 'success';
  if (key === 'rep_issue' || key === 'stm_issue') return 'danger';
  if (key === 'pending_fdh' || key === 'pending_rep') return 'warning';
  return 'info';
};

export const IpdClaimMonitorPage = () => {
  const [startDate, setStartDate] = useState(firstDayOfMonth());
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [importHealth, setImportHealth] = useState<ImportHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<StageKey | 'all'>('all');
  const [rightFilter, setRightFilter] = useState('all');
  const [detailVisit, setDetailVisit] = useState<MonitorRow | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const overviewParams = new URLSearchParams({ startDate, endDate });
      const reconciliationParams = new URLSearchParams({
        startDate,
        endDate,
        patientType: 'IPD',
        page: '1',
        pageSize: '500',
      });
      const [overviewResponse, reconciliationResponse] = await Promise.all([
        fetch(`/api/insurance/overview?${overviewParams}`),
        fetch(`/api/receivables/reconciliation?${reconciliationParams}`),
      ]);
      const [overviewJson, reconciliationJson] = await Promise.all([
        overviewResponse.json(),
        reconciliationResponse.json(),
      ]);
      if (!overviewResponse.ok || !overviewJson.success) throw new Error(overviewJson.error || 'โหลดสถานะ FDH ไม่สำเร็จ');
      if (!reconciliationResponse.ok || !reconciliationJson.success) throw new Error(reconciliationJson.error || 'โหลดสถานะ REP/STM/INV ไม่สำเร็จ');

      const reconciliationMap = new Map<string, ReconciliationRow>();
      (reconciliationJson.data || []).forEach((item: ReconciliationRow) => reconciliationMap.set(visitKey(item), item));
      const merged = (overviewJson.data?.ipdLagRows || []).map((item: IpdOverviewRow) => {
        const reconciliation = reconciliationMap.get(visitKey(item)) || {};
        const combined = { ...item, ...reconciliation };
        return { ...combined, ...resolveStage(combined) } as MonitorRow;
      });
      setRows(merged);
      setImportHealth(overviewJson.data?.repAnalytics?.import_health || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูล Monitor ไม่สำเร็จ');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rightOptions = useMemo(() => Array.from(new Set(rows.map((row) => String(row.hipdata_code || 'ไม่ระบุ')))).sort(), [rows]);
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (stageFilter !== 'all' && row.stageKey !== stageFilter) return false;
      if (rightFilter !== 'all' && String(row.hipdata_code || 'ไม่ระบุ') !== rightFilter) return false;
      if (!term) return true;
      return [row.an, row.vn, row.hn, row.patient_name, row.pttype_name, row.hipdata_code, row.rep_no, row.stm_statement_no, row.inv_statement_no]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [rightFilter, rows, search, stageFilter]);

  const summary = useMemo(() => {
    const total = rows.length;
    const fdh = rows.filter((row) => row.fdh_found).length;
    const rep = rows.filter((row) => Boolean(row.has_rep || row.rep_no)).length;
    const inv = rows.filter((row) => row.has_inv).length;
    const stm = rows.filter((row) => row.has_stm).length;
    const complete = rows.filter((row) => row.stageKey === 'complete').length;
    const attention = rows.filter((row) => row.stageKey === 'rep_issue' || row.stageKey === 'stm_issue').length;
    const expected = rows.reduce((sum, row) => sum + Number(row.expected_receivable || 0), 0);
    const repAmount = rows.reduce((sum, row) => sum + Number(row.rep_amount || 0), 0);
    const stmPaid = rows.reduce((sum, row) => sum + Number(row.stm_paid_amount || 0), 0);
    return { total, fdh, rep, inv, stm, complete, attention, expected, repAmount, stmPaid };
  }, [rows]);

  const stageCounts = useMemo(() => rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.stageKey] = (acc[row.stageKey] || 0) + 1;
    return acc;
  }, {}), [rows]);

  const exportExcel = () => {
    const exportRows = filteredRows.map((row, index) => ({
      ลำดับ: index + 1,
      AN: row.an || '',
      VN: row.vn || '',
      HN: row.hn || '',
      ชื่อผู้ป่วย: row.patient_name || '',
      วันที่จำหน่าย: row.dchdate || '',
      สิทธิ: row.pttype_name || '',
      HIPDATA: row.hipdata_code || '',
      ยอดคาดรับ: row.expected_receivable || 0,
      สถานะ_FDH: row.fdh_status || '',
      วันที่ส่ง_FDH: row.fdh_sent_at || '',
      REP_No: row.rep_no || '',
      REP_Error: [row.rep_errorcode || row.errorcode, row.rep_verifycode].filter(meaningfulCode).join(' / '),
      ยอด_REP: row.rep_amount || 0,
      INV_No: row.inv_statement_no || '',
      ยอด_INV: row.inv_amount || 0,
      STM_No: row.stm_statement_no || '',
      ยอดจ่าย_STM: row.stm_paid_amount || 0,
      สถานะปัจจุบัน: row.stageLabel,
      หมายเหตุ: row.stageNote,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), 'IPD Claim Monitor');
    XLSX.writeFile(workbook, `ipd_fdh_rep_stm_inv_${startDate}_${endDate}.xlsx`);
  };

  const goToIpd = () => window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'ipd' } }));

  return (
    <div className="workflow-page ipd-claim-monitor">
      <div className="page-header ipd-monitor-hero">
        <div>
          <h1 className="page-title">📡 IPD Claim Monitor</h1>
          <p className="page-subtitle">ติดตามผู้ป่วยในตั้งแต่จำหน่าย ส่ง FDH รับ REP และผล INV/STM พร้อมชี้งานค้างและยอดเงินในหน้าจอเดียว</p>
        </div>
        <div className="ipd-monitor-hero__actions">
          <button className="btn btn-outline" type="button" onClick={goToIpd}>← รายการผู้ป่วยใน</button>
          <button className="btn btn-success" type="button" onClick={exportExcel} disabled={filteredRows.length === 0}>📥 ส่งออก Excel</button>
        </div>
      </div>

      <div className="card ipd-monitor-filter-card">
        <div className="card-body ipd-monitor-filter-grid">
          <div className="form-group"><label className="form-label">วันที่จำหน่ายเริ่มต้น</label><input className="form-control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <div className="form-group"><label className="form-label">ถึงวันที่</label><input className="form-control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
          <div className="form-group ipd-monitor-search"><label className="form-label">ค้นหา AN / HN / ชื่อ / REP</label><input className="form-control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="พิมพ์คำค้น..." /></div>
          <div className="form-group"><label className="form-label">สถานะปัจจุบัน</label><select className="form-control" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as StageKey | 'all')}>{STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></div>
          <div className="form-group"><label className="form-label">สิทธิ HIPDATA</label><select className="form-control" value={rightFilter} onChange={(event) => setRightFilter(event.target.value)}><option value="all">ทุกสิทธิ</option>{rightOptions.map((right) => <option key={right} value={right}>{right}</option>)}</select></div>
          <button className="btn btn-primary" type="button" onClick={loadData} disabled={loading}>{loading ? 'กำลังโหลด...' : '🔄 โหลดข้อมูล'}</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">⚠️ {error}</div>}

      <div className="ipd-monitor-kpi-grid">
        <div className="ipd-monitor-kpi ipd-monitor-kpi--slate"><span>จำหน่ายทั้งหมด</span><strong>{summary.total.toLocaleString('th-TH')}</strong><small>เคสในช่วงวันที่</small></div>
        <div className="ipd-monitor-kpi ipd-monitor-kpi--blue"><span>พบใน FDH</span><strong>{summary.fdh.toLocaleString('th-TH')}</strong><small>{summary.total ? Math.round(summary.fdh / summary.total * 100) : 0}% ของเคส</small></div>
        <div className="ipd-monitor-kpi ipd-monitor-kpi--violet"><span>ได้รับ REP</span><strong>{summary.rep.toLocaleString('th-TH')}</strong><small>{summary.fdh ? Math.round(summary.rep / summary.fdh * 100) : 0}% จาก FDH</small></div>
        <div className="ipd-monitor-kpi ipd-monitor-kpi--cyan"><span>ได้รับ INV</span><strong>{summary.inv.toLocaleString('th-TH')}</strong><small>ใบแจ้งยอด</small></div>
        <div className="ipd-monitor-kpi ipd-monitor-kpi--green"><span>ได้รับ STM</span><strong>{summary.stm.toLocaleString('th-TH')}</strong><small>ผลการจ่าย</small></div>
        <div className="ipd-monitor-kpi ipd-monitor-kpi--emerald"><span>ครบกระบวนการ</span><strong>{summary.complete.toLocaleString('th-TH')}</strong><small>FDH + REP + STM</small></div>
        <div className="ipd-monitor-kpi ipd-monitor-kpi--rose"><span>ต้องตรวจสอบ</span><strong>{summary.attention.toLocaleString('th-TH')}</strong><small>REP/STM ผิดปกติ</small></div>
      </div>

      <div className="ipd-monitor-pipeline card">
        <div className="card-header"><strong>ตำแหน่งงานในกระบวนการ</strong><span>กดการ์ดเพื่อกรองรายการ</span></div>
        <div className="ipd-monitor-stage-grid">
          {STAGES.filter((stage) => stage.key !== 'all').map((stage, index) => (
            <button key={stage.key} type="button" className={`ipd-monitor-stage ${stageFilter === stage.key ? 'is-active' : ''}`} onClick={() => setStageFilter(stageFilter === stage.key ? 'all' : stage.key as StageKey)}>
              <span className="ipd-monitor-stage__number">{index + 1}</span>
              <span>{stage.label}</span>
              <strong>{(stageCounts[stage.key] || 0).toLocaleString('th-TH')}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="ipd-monitor-money-grid">
        <div className="card"><span>ยอดคาดรับ</span><strong>{money(summary.expected)} บาท</strong></div>
        <div className="card"><span>ยอดจาก REP</span><strong>{money(summary.repAmount)} บาท</strong></div>
        <div className="card"><span>ยอดจ่าย STM</span><strong>{money(summary.stmPaid)} บาท</strong></div>
        <div className="card"><span>ส่วนต่าง STM - คาดรับ</span><strong className={summary.stmPaid - summary.expected < 0 ? 'is-negative' : 'is-positive'}>{money(summary.stmPaid - summary.expected)} บาท</strong></div>
      </div>

      <div className="ipd-monitor-import-health">
        {['REP', 'INV', 'STM'].map((type) => {
          const item = importHealth.find((entry) => String(entry.data_type).toUpperCase() === type);
          return <div key={type}><strong>{type}</strong><span>นำเข้าล่าสุด {formatDateTime(item?.last_import_at)}</span><small>{Number(item?.row_count || 0).toLocaleString('th-TH')} แถวสะสมในช่วง</small></div>;
        })}
      </div>

      <div className="card workflow-table-card ipd-monitor-table-card">
        <div className="card-header"><span className="workflow-table-title">รายการติดตามผู้ป่วยใน</span><span className="workflow-table-meta">แสดง {filteredRows.length.toLocaleString('th-TH')} / {rows.length.toLocaleString('th-TH')} เคส</span></div>
        <div className="table-responsive">
          <table className="data-table ipd-monitor-table">
            <thead><tr><th>#</th><th>AN / HN</th><th>ผู้ป่วย / สิทธิ</th><th>D/C</th><th>ยอดคาดรับ</th><th>FDH</th><th>REP</th><th>INV</th><th>STM</th><th>สถานะปัจจุบัน</th><th>รายละเอียด</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={11} className="empty-cell">กำลังโหลดข้อมูล...</td></tr> : filteredRows.length === 0 ? <tr><td colSpan={11} className="empty-cell">ไม่พบรายการตามเงื่อนไข</td></tr> : filteredRows.map((row, index) => (
                <tr key={visitKey(row)}>
                  <td>{index + 1}</td>
                  <td><strong className="ipd-monitor-id">{row.an || '-'}</strong><small>HN {row.hn || '-'}</small></td>
                  <td><strong>{row.patient_name || '-'}</strong><small>{row.hipdata_code || '-'} · {row.pttype_name || '-'}</small></td>
                  <td><span>{row.dchdate || '-'}</span><small>Admit {row.admdate || '-'}</small></td>
                  <td className="ipd-monitor-money">{money(row.expected_receivable)}</td>
                  <td><span className={`insurance-status insurance-status--${row.fdh_found ? 'success' : 'warning'}`}>{row.fdh_found ? 'พบ FDH' : 'ยังไม่พบ'}</span><small>{row.fdh_status || row.fdh_followup_note || '-'}</small><small>{row.days_dch_to_fdh == null ? '' : `${row.days_dch_to_fdh} วันหลัง D/C`}</small></td>
                  <td><span className={`insurance-status insurance-status--${row.has_rep || row.rep_no ? (meaningfulCode(row.rep_errorcode || row.errorcode) || meaningfulCode(row.rep_verifycode) ? 'danger' : 'success') : 'muted'}`}>{row.rep_no || 'รอ REP'}</span><small>{[row.rep_errorcode || row.errorcode, row.rep_verifycode].filter(meaningfulCode).join(' / ') || `${money(row.rep_amount)} บาท`}</small></td>
                  <td><span className={`insurance-status insurance-status--${row.has_inv ? 'success' : 'muted'}`}>{row.has_inv ? 'มี INV' : 'รอ INV'}</span><small>{row.inv_statement_no || (row.has_inv ? `${money(row.inv_amount)} บาท` : '-')}</small></td>
                  <td><span className={`insurance-status insurance-status--${row.has_stm ? (row.stageKey === 'stm_issue' ? 'danger' : 'success') : 'muted'}`}>{row.has_stm ? 'มี STM' : 'รอ STM'}</span><small>{row.stm_statement_no || (row.has_stm ? `จ่าย ${money(row.stm_paid_amount)} บาท` : '-')}</small></td>
                  <td><span className={`insurance-status insurance-status--${stageTone(row.stageKey)}`}>{row.stageLabel}</span><small>{row.stageNote}</small></td>
                  <td><button className="btn btn-outline btn-sm" type="button" onClick={() => setDetailVisit(row)}>ดู REP/STM/INV</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailVisit && <RepStmVisitModal visit={{ ...detailVisit, patientName: detailVisit.patient_name }} onClose={() => setDetailVisit(null)} />}
    </div>
  );
};
