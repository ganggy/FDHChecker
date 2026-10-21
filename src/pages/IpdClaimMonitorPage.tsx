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
  ward?: string;
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
  pre_audit?: {
    status: 'clear' | 'review' | 'risk';
    findingCount: number;
    riskCount: number;
    reviewCount: number;
    findings: Array<{
      code: string;
      severity: 'risk' | 'review';
      title: string;
      message: string;
      evidence: string[];
    }>;
  };
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

type KpiSummary = {
  total: number;
  fdh: number;
  rep: number;
  inv: number;
  stm: number;
  complete: number;
  attention: number;
  preAuditRisk: number;
  preAuditReview: number;
  expected: number;
  repAmount: number;
  stmPaid: number;
};

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

const calculateKpis = (rowsToSummarize: MonitorRow[]): KpiSummary => {
  const total = rowsToSummarize.length;
  const fdh = rowsToSummarize.filter((row) => row.fdh_found).length;
  const rep = rowsToSummarize.filter((row) => Boolean(row.has_rep || row.rep_no)).length;
  const inv = rowsToSummarize.filter((row) => row.has_inv).length;
  const stm = rowsToSummarize.filter((row) => row.has_stm).length;
  const complete = rowsToSummarize.filter((row) => row.stageKey === 'complete').length;
  const attention = rowsToSummarize.filter((row) => row.stageKey === 'rep_issue' || row.stageKey === 'stm_issue').length;
  const preAuditRisk = rowsToSummarize.filter((row) => row.pre_audit?.status === 'risk').length;
  const preAuditReview = rowsToSummarize.filter((row) => row.pre_audit?.status === 'review').length;
  const expected = rowsToSummarize.reduce((sum, row) => sum + Number(row.expected_receivable || 0), 0);
  const repAmount = rowsToSummarize.reduce((sum, row) => sum + Number(row.rep_amount || 0), 0);
  const stmPaid = rowsToSummarize.reduce((sum, row) => sum + Number(row.stm_paid_amount || 0), 0);
  return { total, fdh, rep, inv, stm, complete, attention, preAuditRisk, preAuditReview, expected, repAmount, stmPaid };
};

const IpdKpiGrid = ({
  kpi,
  auditFilter,
  onAuditFilterChange,
  onStageFilterChange,
}: {
  kpi: KpiSummary;
  auditFilter?: 'all' | 'clear' | 'review' | 'risk';
  onAuditFilterChange?: (filter: 'risk' | 'review') => void;
  onStageFilterChange?: (stage: StageKey | 'all') => void;
}) => (
  <div className="ipd-monitor-kpi-grid">
    <div
      className={`ipd-monitor-kpi ipd-monitor-kpi--slate ${onStageFilterChange ? 'is-clickable' : ''}`}
      onClick={() => onStageFilterChange?.('all')}
      title={onStageFilterChange ? 'คลิกเพื่อดูทุกเคส' : undefined}
    >
      <span>จำหน่ายทั้งหมด</span>
      <strong>{kpi.total.toLocaleString('th-TH')}</strong>
      <small>เคสในช่วงวันที่</small>
    </div>
    <div
      className={`ipd-monitor-kpi ipd-monitor-kpi--blue ${onStageFilterChange ? 'is-clickable' : ''}`}
      onClick={() => onStageFilterChange?.('all')}
      title={onStageFilterChange ? 'คลิกเพื่อดูรายการ' : undefined}
    >
      <span>พบใน FDH</span>
      <strong>{kpi.fdh.toLocaleString('th-TH')}</strong>
      <small>{kpi.total ? Math.round((kpi.fdh / kpi.total) * 100) : 0}% ของเคส</small>
    </div>
    <div
      className={`ipd-monitor-kpi ipd-monitor-kpi--violet ${onStageFilterChange ? 'is-clickable' : ''}`}
      onClick={() => onStageFilterChange?.('all')}
      title={onStageFilterChange ? 'คลิกเพื่อดูรายการ' : undefined}
    >
      <span>ได้รับ REP</span>
      <strong>{kpi.rep.toLocaleString('th-TH')}</strong>
      <small>{kpi.fdh ? Math.round((kpi.rep / kpi.fdh) * 100) : 0}% จาก FDH</small>
    </div>
    <div
      className={`ipd-monitor-kpi ipd-monitor-kpi--cyan ${onStageFilterChange ? 'is-clickable' : ''}`}
      onClick={() => onStageFilterChange?.('inv_only')}
      title={onStageFilterChange ? 'คลิกเพื่อกรองเฉพาะรายการ INV' : undefined}
    >
      <span>ได้รับ INV</span>
      <strong>{kpi.inv.toLocaleString('th-TH')}</strong>
      <small>ใบแจ้งยอด</small>
    </div>
    <div
      className={`ipd-monitor-kpi ipd-monitor-kpi--green ${onStageFilterChange ? 'is-clickable' : ''}`}
      onClick={() => onStageFilterChange?.('complete')}
      title={onStageFilterChange ? 'คลิกเพื่อกรองเคสที่มีผลจ่าย STM' : undefined}
    >
      <span>ได้รับ STM</span>
      <strong>{kpi.stm.toLocaleString('th-TH')}</strong>
      <small>ผลการจ่าย</small>
    </div>
    <div
      className={`ipd-monitor-kpi ipd-monitor-kpi--emerald ${onStageFilterChange ? 'is-clickable' : ''}`}
      onClick={() => onStageFilterChange?.('complete')}
      title={onStageFilterChange ? 'คลิกเพื่อกรองเคสครบกระบวนการ' : undefined}
    >
      <span>ครบกระบวนการ</span>
      <strong>{kpi.complete.toLocaleString('th-TH')}</strong>
      <small>FDH + REP + STM</small>
    </div>
    <div
      className={`ipd-monitor-kpi ipd-monitor-kpi--rose ${onStageFilterChange ? 'is-clickable' : ''}`}
      onClick={() => onStageFilterChange?.('rep_issue')}
      title={onStageFilterChange ? 'คลิกเพื่อกรองเคสที่ต้องตรวจสอบ' : undefined}
    >
      <span>ต้องตรวจสอบ</span>
      <strong>{kpi.attention.toLocaleString('th-TH')}</strong>
      <small>REP/STM ผิดปกติ</small>
    </div>
    <button
      className={`ipd-monitor-kpi ipd-monitor-kpi--rose ${auditFilter === 'risk' ? 'is-active' : ''}`}
      type="button"
      onClick={() => onAuditFilterChange?.('risk')}
      title="คลิกเพื่อกรองเฉพาะ Pre-audit เสี่ยง"
    >
      <span>Pre-audit เสี่ยง</span>
      <strong>{kpi.preAuditRisk.toLocaleString('th-TH')}</strong>
      <small>ข้อมูล/รหัสอาจไม่ผ่านเกณฑ์</small>
    </button>
    <button
      className={`ipd-monitor-kpi ipd-monitor-kpi--cyan ${auditFilter === 'review' ? 'is-active' : ''}`}
      type="button"
      onClick={() => onAuditFilterChange?.('review')}
      title="คลิกเพื่อกรองเฉพาะทบทวน Chart"
    >
      <span>ทบทวน Chart</span>
      <strong>{kpi.preAuditReview.toLocaleString('th-TH')}</strong>
      <small>หลักฐานทั่วไปหรือกฎ S1</small>
    </button>
  </div>
);

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
  const [wardFilter, setWardFilter] = useState('all');
  const [auditFilter, setAuditFilter] = useState<'all' | 'clear' | 'review' | 'risk'>('all');
  const [detailVisit, setDetailVisit] = useState<MonitorRow | null>(null);

  const [wardViewMode, setWardViewMode] = useState<'tabs' | 'all'>('tabs');
  const [activeWardTab, setActiveWardTab] = useState<string>('all');

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
  const wardOptions = useMemo(() => Array.from(new Set(
    rows.map((row) => String(row.ward || '').trim()).filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, 'th')), [rows]);

  // Base rows filtered by search, rights, and pre_audit (independent of wardFilter for ward breakdown)
  const baseWardRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (rightFilter !== 'all' && String(row.hipdata_code || 'ไม่ระบุ') !== rightFilter) return false;
      if (auditFilter !== 'all' && (row.pre_audit?.status || 'clear') !== auditFilter) return false;
      if (!term) return true;
      return [row.an, row.vn, row.hn, row.patient_name, row.ward, row.pttype_name, row.hipdata_code, row.rep_no, row.stm_statement_no, row.inv_statement_no]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [auditFilter, rightFilter, rows, search]);

  // Scoped rows also apply wardFilter for the data table, money cards, and pipeline
  const scopedRows = useMemo(() => {
    if (wardFilter === 'all') return baseWardRows;
    return baseWardRows.filter((row) => String(row.ward || '').trim() === wardFilter);
  }, [baseWardRows, wardFilter]);

  const filteredRows = useMemo(() => (
    stageFilter === 'all' ? scopedRows : scopedRows.filter((row) => row.stageKey === stageFilter)
  ), [scopedRows, stageFilter]);

  // Summary for overall hospital (combined)
  const overallSummary = useMemo(() => calculateKpis(baseWardRows), [baseWardRows]);
  // Summary for current filtered rows (updates whenever wardFilter, search, or filters change!)
  const summary = useMemo(() => calculateKpis(scopedRows), [scopedRows]);

  // Ward breakdown summaries
  const wardSummaries = useMemo<Array<KpiSummary & { ward: string }>>(() => {
    const map = new Map<string, MonitorRow[]>();
    baseWardRows.forEach((row) => {
      const wardName = String(row.ward || '').trim() || 'ไม่ระบุตึก';
      const list = map.get(wardName) || [];
      list.push(row);
      map.set(wardName, list);
    });

    const results: Array<KpiSummary & { ward: string }> = [];
    map.forEach((wardRows, wardName) => {
      results.push({
        ward: wardName,
        ...calculateKpis(wardRows),
      });
    });

    return results.sort((a, b) => b.total - a.total || a.ward.localeCompare(b.ward, 'th'));
  }, [baseWardRows]);

  const selectedWardSummary = useMemo(() => {
    if (activeWardTab === 'all') return null;
    return wardSummaries.find((w) => w.ward === activeWardTab) || wardSummaries[0] || null;
  }, [activeWardTab, wardSummaries]);

  // When a user selects a ward, synchronize both activeWardTab and wardFilter
  const selectWard = (wardName: string) => {
    setActiveWardTab(wardName);
    setWardFilter(wardName);
  };

  const stageCounts = useMemo(() => scopedRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.stageKey] = (acc[row.stageKey] || 0) + 1;
    return acc;
  }, {}), [scopedRows]);

  const exportExcel = () => {
    const exportRows = filteredRows.map((row, index) => ({
      ลำดับ: index + 1,
      AN: row.an || '',
      VN: row.vn || '',
      HN: row.hn || '',
      ชื่อผู้ป่วย: row.patient_name || '',
      ตึกผู้ป่วย: row.ward || '',
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
      ผล_Pre_Audit: row.pre_audit?.status === 'risk' ? 'พบความเสี่ยง' : row.pre_audit?.status === 'review' ? 'ทบทวนเวชระเบียน' : 'ผ่านกฎอัตโนมัติ',
      รหัส_Pre_Audit: row.pre_audit?.findings.map((finding) => finding.code).join(', ') || '',
      รายละเอียด_Pre_Audit: row.pre_audit?.findings.map((finding) => finding.message).join(' | ') || '',
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
          <p className="page-subtitle">ติดตามผู้ป่วยในตั้งแต่ตรวจความพร้อมเวชระเบียนและกฎ S1 ส่ง FDH รับ REP และผล INV/STM พร้อมชี้งานค้างในหน้าจอเดียว</p>
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
          <div className="form-group">
            <label className="form-label">ตึกผู้ป่วย (Ward)</label>
            <select
              className="form-control"
              value={wardFilter}
              onChange={(event) => selectWard(event.target.value)}
            >
              <option value="all">ทุกตึก (รวม)</option>
              {wardOptions.map((ward) => (
                <option key={ward} value={ward}>
                  {ward}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group"><label className="form-label">IPD Pre-audit</label><select className="form-control" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as typeof auditFilter)}><option value="all">ทุกผลตรวจ</option><option value="risk">พบความเสี่ยง</option><option value="review">ต้องทบทวนเวชระเบียน</option><option value="clear">ผ่านกฎอัตโนมัติ</option></select></div>
          <button className="btn btn-primary" type="button" onClick={loadData} disabled={loading}>{loading ? 'กำลังโหลด...' : '🔄 โหลดข้อมูล'}</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">⚠️ {error}</div>}

      <details className="card ipd-audit-guide">
        <summary>📋 หลักฐาน IPD ที่ต้องพร้อมตามแนวทางตรวจร่วม 3 กองทุน ปี 2569</summary>
        <div className="ipd-audit-guide__grid">
          <section><strong>เอกสารหลักทุก admission</strong><span>OPD card / Patient profile</span><span>Discharge summary พร้อม PDx และแพทย์รับรอง</span><span>Admission note ระบุเหตุผลรับไว้</span><span>Progress note และ Doctor’s order</span><span>Nurses’ note, Graphic sheet และ Medication sheet</span><span>ผล Lab / รังสี / พยาธิที่เกี่ยวข้อง</span></section>
          <section><strong>เอกสารตามบริการ</strong><span>Informed consent และ Consultation record</span><span>Operative/Procedure note พร้อม finding และขั้นตอน</span><span>Anesthetic, Labour หรือ Rehabilitation record</span><span>Sticker/serial number อุปกรณ์ พร้อมหลักฐานการเงิน</span><span>ข้อมูลจาก platform อื่นที่ใช้ดูแลผู้ป่วย</span></section>
          <section><strong>ระบบตรวจอัตโนมัติ</strong><span>PDx และวันเวลา Admit/Discharge</span><span>Short stay ที่ต้องยืนยันเหตุผลรับไว้</span><span>Split admission ภายใน 24 ชั่วโมงในช่วงข้อมูลที่เลือก</span><span>ICD-9 ที่ต้องมีหลักฐานหัตถการ</span><span>มะเร็ง active และกฎ S1/CR ทั้ง 10 กลุ่ม</span><small>ลายมือชื่อ เนื้อหา note และเอกสาร PDF ยังต้องให้ผู้ตรวจทบทวนจากเวชระเบียนจริง</small></section>
        </div>
      </details>

      {/* 1. สรุปภาพรวมผู้ป่วยในทั้งโรงพยาบาล (รวมทุกหอผู้ป่วย) - คงไว้เหมือนเดิม */}
      <section className="ipd-monitor-section">
        <div className="ipd-monitor-section-header">
          <div className="ipd-monitor-section-title">
            <h3>🏥 ภาพรวมเคลมผู้ป่วยใน (รวมทุกหอผู้ป่วย)</h3>
            <span className="ipd-section-badge">{overallSummary.total.toLocaleString('th-TH')} เคส</span>
            {wardFilter !== 'all' && (
              <span className="ipd-section-filter-tag">
                กำลังเลือกดูตึก: <strong>{wardFilter}</strong>
              </span>
            )}
          </div>
          <div className="ipd-monitor-section-meta">
            <span>คาดรับรวม: <strong>{money(overallSummary.expected)} บาท</strong></span>
            <span>· ยอด REP รวม: <strong>{money(overallSummary.repAmount)} บาท</strong></span>
            <span>· ยอดจ่าย STM รวม: <strong>{money(overallSummary.stmPaid)} บาท</strong></span>
          </div>
        </div>

        <IpdKpiGrid
          kpi={overallSummary}
          auditFilter={wardFilter === 'all' ? auditFilter : 'all'}
          onAuditFilterChange={(filter) => {
            selectWard('all');
            setAuditFilter(auditFilter === filter ? 'all' : filter);
          }}
          onStageFilterChange={(stage) => {
            selectWard('all');
            setStageFilter(stageFilter === stage ? 'all' : stage);
          }}
        />
      </section>

      {/* 2. การ์ดสรุปแยกตามหอผู้ป่วย (Ward Claims Breakdown) */}
      {wardSummaries.length > 0 && (
        <section className="card ipd-ward-breakdown-card">
          <div className="card-header ipd-ward-breakdown-header">
            <div>
              <strong className="ipd-ward-title">🏢 สรุปสถานะเคลมแยกตามหอผู้ป่วย (Ward Claims Monitor)</strong>
              <span className="ipd-ward-subtitle">
                พบ {wardSummaries.length} หอผู้ป่วย · คลิกที่แท็บหรือการ์ดเพื่อสลับดูยอดเงินและรายการของตึกนั้นทันที
              </span>
            </div>
            <div className="ipd-ward-view-controls">
              <button
                type="button"
                className={`btn btn-sm ${wardViewMode === 'tabs' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setWardViewMode('tabs')}
              >
                📑 ดูทีละหอ
              </button>
              <button
                type="button"
                className={`btn btn-sm ${wardViewMode === 'all' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setWardViewMode('all')}
              >
                🗂️ แสดงทุกหอพร้อมกัน
              </button>
            </div>
          </div>

          {wardViewMode === 'tabs' ? (
            <div className="card-body ipd-ward-tab-view">
              <div className="ipd-ward-tabs">
                <button
                  type="button"
                  className={`ipd-ward-tab-btn ${wardFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => selectWard('all')}
                >
                  <span className="ipd-ward-tab-name">🏥 รวมทุกหอผู้ป่วย</span>
                  <span className="ipd-ward-tab-count">{overallSummary.total.toLocaleString('th-TH')}</span>
                  {overallSummary.attention > 0 && (
                    <span className="ipd-ward-tab-alert" title={`มี ${overallSummary.attention} เคสต้องตรวจสอบ`}>
                      ⚠️ {overallSummary.attention}
                    </span>
                  )}
                </button>
                {wardSummaries.map((w) => {
                  const isSelected = wardFilter === w.ward;
                  return (
                    <button
                      key={w.ward}
                      type="button"
                      className={`ipd-ward-tab-btn ${isSelected ? 'is-active' : ''}`}
                      onClick={() => selectWard(w.ward)}
                    >
                      <span className="ipd-ward-tab-name">🏥 {w.ward}</span>
                      <span className="ipd-ward-tab-count">{w.total.toLocaleString('th-TH')}</span>
                      {w.attention > 0 && (
                        <span className="ipd-ward-tab-alert" title={`มี ${w.attention} เคสต้องตรวจสอบ`}>
                          ⚠️ {w.attention}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedWardSummary ? (
                <div className="ipd-ward-selected-container">
                  <div className="ipd-ward-selected-bar">
                    <div className="ipd-ward-selected-info">
                      <h4>🏥 {selectedWardSummary.ward}</h4>
                      <div className="ipd-ward-selected-stats">
                        <span>จำหน่าย: <strong>{selectedWardSummary.total.toLocaleString('th-TH')} เคส</strong></span>
                        <span>· คาดรับ: <strong>{money(selectedWardSummary.expected)} บาท</strong></span>
                        <span>· REP: <strong>{money(selectedWardSummary.repAmount)} บาท</strong></span>
                        <span>· จ่าย STM: <strong>{money(selectedWardSummary.stmPaid)} บาท</strong></span>
                        <span>· ส่วนต่าง STM: <strong className={selectedWardSummary.stmPaid - selectedWardSummary.expected < 0 ? 'is-negative' : 'is-positive'}>{money(selectedWardSummary.stmPaid - selectedWardSummary.expected)} บาท</strong></span>
                      </div>
                    </div>
                    <div className="ipd-ward-selected-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => selectWard('all')}
                      >
                        ✕ กลับไปดูรวมทุกหอ
                      </button>
                    </div>
                  </div>

                  <IpdKpiGrid
                    kpi={selectedWardSummary}
                    auditFilter={auditFilter}
                    onAuditFilterChange={(filter) => setAuditFilter(auditFilter === filter ? 'all' : filter)}
                    onStageFilterChange={(stage) => setStageFilter(stage)}
                  />
                </div>
              ) : (
                <div className="ipd-ward-selected-container">
                  <div className="ipd-ward-selected-bar">
                    <div className="ipd-ward-selected-info">
                      <h4>🏥 แสดงรวมทุกหอผู้ป่วย ({wardSummaries.length} หอ)</h4>
                      <div className="ipd-ward-selected-stats">
                        <span>จำหน่ายทั้งหมด: <strong>{overallSummary.total.toLocaleString('th-TH')} เคส</strong></span>
                        <span>· คาดรับรวม: <strong>{money(overallSummary.expected)} บาท</strong></span>
                        <span>· REP รวม: <strong>{money(overallSummary.repAmount)} บาท</strong></span>
                        <span>· จ่าย STM รวม: <strong>{money(overallSummary.stmPaid)} บาท</strong></span>
                      </div>
                    </div>
                    <div className="ipd-ward-selected-actions">
                      <span className="ipd-section-badge">คลิกแท็บหอด้านบนเพื่อดูเฉพาะตึก</span>
                    </div>
                  </div>

                  <IpdKpiGrid
                    kpi={overallSummary}
                    auditFilter={auditFilter}
                    onAuditFilterChange={(filter) => setAuditFilter(auditFilter === filter ? 'all' : filter)}
                    onStageFilterChange={(stage) => setStageFilter(stage)}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="card-body ipd-ward-all-view">
              <div className="ipd-ward-boxes-grid">
                {wardSummaries.map((w) => {
                  const isFiltered = wardFilter === w.ward;
                  return (
                    <div key={w.ward} className={`ipd-ward-box ${isFiltered ? 'is-filtered' : ''}`}>
                      <div className="ipd-ward-box-header">
                        <div className="ipd-ward-box-title">
                          <h4>🏥 {w.ward}</h4>
                          <span className="ipd-ward-box-badge">{w.total.toLocaleString('th-TH')} เคส</span>
                          {w.attention > 0 && (
                            <span className="ipd-ward-tab-alert">
                              ⚠️ {w.attention} ต้องตรวจ
                            </span>
                          )}
                        </div>
                        <div className="ipd-ward-box-meta">
                          <span>คาดรับ: <strong>{money(w.expected)} บ.</strong></span>
                          <span>· REP: <strong>{money(w.repAmount)} บ.</strong></span>
                          <span>· STM: <strong>{money(w.stmPaid)} บ.</strong></span>
                          <button
                            type="button"
                            className={`btn btn-sm ${isFiltered ? 'btn-warning' : 'btn-outline'}`}
                            onClick={() => selectWard(isFiltered ? 'all' : w.ward)}
                          >
                            {isFiltered ? '✕ ยกเลิกกรอง' : '🔍 กรองดูตึกนี้'}
                          </button>
                        </div>
                      </div>

                      <IpdKpiGrid
                        kpi={w}
                        auditFilter={wardFilter === w.ward ? auditFilter : 'all'}
                        onAuditFilterChange={(filter) => {
                          selectWard(w.ward);
                          setAuditFilter(auditFilter === filter ? 'all' : filter);
                        }}
                        onStageFilterChange={(stage) => {
                          selectWard(w.ward);
                          setStageFilter(stage);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. ตำแหน่งงานในกระบวนการ (อัปเดตตามหอผู้ป่วยที่เลือกทันที) */}
      <div className="ipd-monitor-pipeline card">
        <div className="card-header">
          <div>
            <strong>ตำแหน่งงานในกระบวนการ {wardFilter !== 'all' ? `(${wardFilter})` : '(รวมทุกหอ)'}</strong>
            {wardFilter !== 'all' && (
              <span className="ipd-section-badge" style={{ marginLeft: 8 }}>
                {summary.total.toLocaleString('th-TH')} เคส
              </span>
            )}
          </div>
          <span>กดการ์ดเพื่อกรองรายการ</span>
        </div>
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

      {/* 4. สรุปยอดเงิน 4 ใบ (อัปเดตตามหอผู้ป่วยที่เลือกทันที) */}
      <div className="ipd-monitor-money-grid">
        <div className="card">
          <span>ยอดคาดรับ {wardFilter !== 'all' ? `(${wardFilter})` : '(รวมทุกหอ)'}</span>
          <strong>{money(summary.expected)} บาท</strong>
        </div>
        <div className="card">
          <span>ยอดจาก REP {wardFilter !== 'all' ? `(${wardFilter})` : '(รวมทุกหอ)'}</span>
          <strong>{money(summary.repAmount)} บาท</strong>
        </div>
        <div className="card">
          <span>ยอดจ่าย STM {wardFilter !== 'all' ? `(${wardFilter})` : '(รวมทุกหอ)'}</span>
          <strong>{money(summary.stmPaid)} บาท</strong>
        </div>
        <div className="card">
          <span>ส่วนต่าง STM - คาดรับ {wardFilter !== 'all' ? `(${wardFilter})` : '(รวมทุกหอ)'}</span>
          <strong className={summary.stmPaid - summary.expected < 0 ? 'is-negative' : 'is-positive'}>
            {money(summary.stmPaid - summary.expected)} บาท
          </strong>
        </div>
      </div>

      <div className="ipd-monitor-import-health">
        {['REP', 'INV', 'STM'].map((type) => {
          const item = importHealth.find((entry) => String(entry.data_type).toUpperCase() === type);
          return <div key={type}><strong>{type}</strong><span>นำเข้าล่าสุด {formatDateTime(item?.last_import_at)}</span><small>{Number(item?.row_count || 0).toLocaleString('th-TH')} แถวสะสมในช่วง</small></div>;
        })}
      </div>

      {/* 5. ตารางรายการเคส (อัปเดตตามหอผู้ป่วยที่เลือกทันที) */}
      <div className="card workflow-table-card ipd-monitor-table-card">
        <div className="card-header">
          <span className="workflow-table-title">
            รายการติดตามผู้ป่วยใน {wardFilter !== 'all' ? `(หอผู้ป่วย: ${wardFilter})` : '(รวมทุกหอ)'}
          </span>
          <span className="workflow-table-meta">แสดง {filteredRows.length.toLocaleString('th-TH')} / {rows.length.toLocaleString('th-TH')} เคส</span>
        </div>
        <div className="table-responsive">
          <table className="data-table ipd-monitor-table">
            <thead><tr><th>#</th><th>AN / HN</th><th>ผู้ป่วย / สิทธิ</th><th>ตึกผู้ป่วย</th><th>D/C</th><th>ยอดคาดรับ</th><th>IPD Pre-audit</th><th>FDH</th><th>REP</th><th>INV</th><th>STM</th><th>สถานะปัจจุบัน</th><th>รายละเอียด</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={13} className="empty-cell">กำลังตรวจข้อมูลและกฎ S1...</td></tr> : filteredRows.length === 0 ? <tr><td colSpan={13} className="empty-cell">ไม่พบรายการตามเงื่อนไข</td></tr> : filteredRows.map((row, index) => (
                <tr key={visitKey(row)}>
                  <td>{index + 1}</td>
                  <td><strong className="ipd-monitor-id">{row.an || '-'}</strong><small>HN {row.hn || '-'}</small></td>
                  <td><strong>{row.patient_name || '-'}</strong><small>{row.hipdata_code || '-'} · {row.pttype_name || '-'}</small></td>
                  <td><span>{row.ward || '-'}</span></td>
                  <td><span>{row.dchdate || '-'}</span><small>Admit {row.admdate || '-'}</small></td>
                  <td className="ipd-monitor-money">{money(row.expected_receivable)}</td>
                  <td>
                    <span className={`insurance-status insurance-status--${row.pre_audit?.status === 'risk' ? 'danger' : row.pre_audit?.status === 'review' ? 'warning' : 'success'}`}>
                      {row.pre_audit?.status === 'risk' ? 'พบความเสี่ยง' : row.pre_audit?.status === 'review' ? 'ทบทวน Chart' : 'ผ่านอัตโนมัติ'}
                    </span>
                    {row.pre_audit && row.pre_audit.findingCount > 0 && <details className="ipd-preaudit-details"><summary>{row.pre_audit.findings.map((finding) => finding.code).join(', ')}</summary>{row.pre_audit.findings.map((finding, findingIndex) => <div key={`${finding.code}-${findingIndex}`} className={`ipd-preaudit-finding ipd-preaudit-finding--${finding.severity}`}><strong>{finding.code} · {finding.title}</strong><span>{finding.message}</span>{finding.evidence.length > 0 && <small>รหัสที่พบ: {finding.evidence.join(', ')}</small>}</div>)}</details>}
                  </td>
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
