import { useEffect, useMemo, useState } from 'react';
import { formatLocalDateInput } from '../utils/dateUtils';

type Summary = {
  opdVisits: number;
  opdIncome: number;
  opdExpectedReceivable: number;
  opdClosed: number;
  opdMissingClose: number;
  ipdDischarged: number;
  ipdIncome: number;
  ipdExpectedReceivable: number;
  ipdFdhSubmitted: number;
  ipdRepReceived: number;
  receivableTotal: number;
  nonClaimableTotal: number;
  missingRuleCount: number;
};

type MonthRow = {
  month: string;
  opdVisits: number;
  opdIncome: number;
  opdExpectedReceivable: number;
  opdClosed: number;
  opdMissingClose: number;
  ipdDischarged: number;
  ipdIncome: number;
  ipdExpectedReceivable: number;
  ipdFdhSubmitted: number;
  ipdRepReceived: number;
  receivable: number;
};

type IpdLagRow = {
  an?: string;
  vn?: string;
  hn?: string;
  patient_name?: string;
  dchdate?: string;
  income?: number;
  expected_receivable?: number;
  hipdata_code?: string;
  pttype_name?: string;
  fdh_source?: string;
  fdh_claim_code?: string | null;
  fdh_upload_uid?: string | null;
  fdh_found?: boolean;
  fdh_status?: string;
  fdh_followup_note?: string;
  fdh_sent_at?: string;
  days_dch_to_fdh?: number | null;
  rep_no?: string | null;
  rep_received_at?: string | null;
  days_dch_to_rep?: number | null;
  rep_amount?: number | null;
  diff_amount?: number | null;
  errorcode?: string | null;
};

type OpdStatusRow = {
  vn?: string;
  hn?: string;
  patient_name?: string;
  service_date?: string;
  income?: number;
  pttype?: string;
  pttype_name?: string;
  hipdata_code?: string;
  close_completed?: boolean;
  close_code?: string | null;
  fdh_source?: string | null;
  fdh_claim_code?: string | null;
  fdh_upload_uid?: string | null;
  fdh_found?: boolean;
  fdh_status?: string;
  fdh_sent_at?: string | null;
  fdh_followup_note?: string;
};

type AccountRow = {
  patient_type: string;
  finance_right_code?: string;
  finance_right_name?: string;
  debtor_code: string;
  revenue_code: string;
  item_count: number;
  total_receivable: number;
};

type MissingRuleRow = {
  patient_type?: string;
  vn?: string;
  an?: string;
  hn?: string;
  pttype?: string;
  pttype_name?: string;
  hipdata_code?: string;
  claimable_amount?: number;
};

type ValeRuleSuggestionRow = {
  patient_type?: string;
  pttype?: string;
  pttype_name?: string;
  hipdata_code?: string;
  total?: number;
  claimable_amount?: number;
  missing_finance_count?: number;
  missing_debtor_count?: number;
  missing_revenue_count?: number;
  suggested_action?: string;
};

type FrequentEntryIssueRow = {
  issue_key?: string;
  issue_label?: string;
  total?: number;
  total_amount?: number;
};

type FrequentSystemErrors = {
  rep_error_codes?: Array<{ error_code?: string; total?: number }>;
  fdh_status_errors?: Array<{ status_label?: string; total?: number }>;
};

type RepAnalytics = {
  financial?: {
    ipd_total_cases?: number;
    rep_received_cases?: number;
    rep_missing_cases?: number;
    expected_total?: number;
    rep_amount_total?: number;
    diff_total?: number;
    underpaid_cases?: number;
    underpaid_total?: number;
    overpaid_cases?: number;
    overpaid_total?: number;
    lag_avg_days?: number | null;
    lag_p50_days?: number | null;
    lag_p90_days?: number | null;
  };
  reject_status_summary?: Array<{ resolve_status?: string; total?: number }>;
  reject_top_errors?: Array<{
    errorcode?: string;
    total?: number;
    income_total?: number;
    compensated_total?: number;
    diff_total?: number;
  }>;
  import_health?: Array<{
    data_type?: string;
    batch_count?: number;
    row_count?: number;
    last_import_at?: string | null;
    total_amount?: number | null;
  }>;
  statement_match_summary?: Array<{
    data_type?: string;
    total_rows?: number;
    matched_rows?: number;
    unmatched_rows?: number;
    matched_rate?: number;
    total_amount?: number;
  }>;
  statement_top_errors?: Array<{
    data_type?: string;
    errorcode?: string;
    total?: number;
    amount_total?: number;
  }>;
};

type OverviewData = {
  startDate: string;
  endDate: string;
  summary: Summary;
  months: MonthRow[];
  opdStatusRows: OpdStatusRow[];
  ipdLagRows: IpdLagRow[];
  accountRows: AccountRow[];
  missingRuleRows: MissingRuleRow[];
  valeRuleSuggestions?: ValeRuleSuggestionRow[];
  frequentEntryIssues?: FrequentEntryIssueRow[];
  frequentSystemErrors?: FrequentSystemErrors;
  repAnalytics?: RepAnalytics;
  valeImportStatus?: {
    target_filename?: string;
    status?: string;
    batch_matches?: number;
    rep_data_matches?: number;
    last_import_at?: string | null;
  } | null;
};

const VALE_TARGET_FILENAME = '16แฟ้มFDH.xlsx';

const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const count = (value: unknown) => Number(value || 0).toLocaleString('th-TH');

const formatThaiDateTime = (value?: string | null) => {
  if (!value) return 'ยังไม่พบการนำเข้า';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const firstDayOfMonth = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
};

export const InsuranceOverviewPage = () => {
  const [startDate, setStartDate] = useState(firstDayOfMonth());
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [accountCode, setAccountCode] = useState('');
  const [valeTargetFilename, setValeTargetFilename] = useState(VALE_TARGET_FILENAME);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hipdataFilter, setHipdataFilter] = useState('ALL');
  const [opdHipdataFilter, setOpdHipdataFilter] = useState('ALL');

  const navigateTo = (page: 'staff' | 'ipd') => {
    window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page } }));
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (accountCode.trim()) params.set('accountCode', accountCode.trim());
      params.set('valeTargetFilename', valeTargetFilename.trim() || VALE_TARGET_FILENAME);
      const resp = await fetch(`/api/insurance/overview?${params}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || 'โหลดรายงานไม่สำเร็จ');
      setData(json.data);
      setHipdataFilter('ALL');
      setOpdHipdataFilter('ALL');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data?.summary;
  const valeImportStatus = data?.valeImportStatus;
  const repAnalytics = data?.repAnalytics;
  const repFinancial = repAnalytics?.financial;
  const opdCloseRate = summary && summary.opdVisits > 0 ? Math.round((summary.opdClosed / summary.opdVisits) * 100) : 0;
  const ipdFdhRate = summary && summary.ipdDischarged > 0 ? Math.round((summary.ipdFdhSubmitted / summary.ipdDischarged) * 100) : 0;
  const ipdRepRate = summary && summary.ipdDischarged > 0 ? Math.round((summary.ipdRepReceived / summary.ipdDischarged) * 100) : 0;
  const opdHipdataOptions = useMemo(() => {
    const countsByHipdata = new Map<string, number>();
    (data?.opdStatusRows || []).forEach((row) => {
      const key = String(row.hipdata_code || 'ไม่ระบุ').trim() || 'ไม่ระบุ';
      countsByHipdata.set(key, (countsByHipdata.get(key) || 0) + 1);
    });
    return Array.from(countsByHipdata.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'))
      .map(([code, total]) => ({ code, total }));
  }, [data?.opdStatusRows]);
  const filteredOpdStatusRows = useMemo(() => {
    const rows = data?.opdStatusRows || [];
    if (opdHipdataFilter === 'ALL') return rows;
    return rows.filter((row) => String(row.hipdata_code || 'ไม่ระบุ').trim() === opdHipdataFilter);
  }, [data?.opdStatusRows, opdHipdataFilter]);
  const opdSubmissionSummary = useMemo(() => {
    const total = filteredOpdStatusRows.length;
    const claimDetailImported = filteredOpdStatusRows.filter((row) => row.fdh_source === 'FDH ClaimDetail').length;
    const sent = filteredOpdStatusRows.filter((row) => row.fdh_found === true).length;
    const nonClaim = filteredOpdStatusRows.filter((row) => String(row.fdh_status || '').includes('ไม่ประสงค์')).length;
    const closed = filteredOpdStatusRows.filter((row) => row.close_completed === true).length;
    const pending = Math.max(0, total - sent);
    const claimDetailMissing = Math.max(0, total - claimDetailImported);
    const importedRate = total > 0 ? Math.round((claimDetailImported / total) * 100) : 0;
    const sentRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    const completeRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    const closeRate = total > 0 ? Math.round((closed / total) * 100) : 0;
    return { total, claimDetailImported, claimDetailMissing, sent, nonClaim, closed, pending, importedRate, sentRate, completeRate, closeRate };
  }, [filteredOpdStatusRows]);
  const hipdataOptions = useMemo(() => {
    const countsByHipdata = new Map<string, number>();
    (data?.ipdLagRows || []).forEach((row) => {
      const key = String(row.hipdata_code || 'ไม่ระบุ').trim() || 'ไม่ระบุ';
      countsByHipdata.set(key, (countsByHipdata.get(key) || 0) + 1);
    });
    return Array.from(countsByHipdata.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'))
      .map(([code, total]) => ({ code, total }));
  }, [data?.ipdLagRows]);
  const filteredIpdLagRows = useMemo(() => {
    const rows = data?.ipdLagRows || [];
    if (hipdataFilter === 'ALL') return rows;
    return rows.filter((row) => String(row.hipdata_code || 'ไม่ระบุ').trim() === hipdataFilter);
  }, [data?.ipdLagRows, hipdataFilter]);
  const ipdSubmissionSummary = useMemo(() => {
    const total = filteredIpdLagRows.length;
    const claimDetailImported = filteredIpdLagRows.filter((row) => row.fdh_source === 'FDH ClaimDetail').length;
    const sent = filteredIpdLagRows.filter((row) => row.fdh_found === true).length;
    const repReceived = filteredIpdLagRows.filter((row) => Boolean(row.rep_no)).length;
    const pending = Math.max(0, total - sent);
    const completeRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    return { total, claimDetailImported, sent, pending, repReceived, completeRate };
  }, [filteredIpdLagRows]);
  const missingRuleSummary = useMemo(() => {
    const groups = new Map<string, {
      patient_type: string;
      pttype: string;
      pttype_name: string;
      hipdata_code: string;
      item_count: number;
      claimable_amount: number;
    }>();
    (data?.missingRuleRows || []).forEach((row) => {
      const key = [
        row.patient_type || '-',
        row.pttype || '-',
        row.hipdata_code || '-',
      ].join('|');
      const current = groups.get(key) || {
        patient_type: row.patient_type || '-',
        pttype: row.pttype || '-',
        pttype_name: row.pttype_name || '',
        hipdata_code: row.hipdata_code || '-',
        item_count: 0,
        claimable_amount: 0,
      };
      current.item_count += 1;
      current.claimable_amount += Number(row.claimable_amount || 0);
      groups.set(key, current);
    });
    return Array.from(groups.values()).sort((a, b) => b.item_count - a.item_count || a.pttype.localeCompare(b.pttype, 'th'));
  }, [data?.missingRuleRows]);

  return (
    <div className="workflow-page insurance-page">
      <div className="page-header insurance-hero">
        <h1 className="page-title">งานประกันและบัญชีรายได้</h1>
        <p className="page-subtitle">
          รวมสถานะ OPD/IPD, FDH, REP/STM และลูกหนี้ตามหัวบัญชี เพื่อดูเงินที่คาดว่าจะเกิดรายได้และรายการที่ยังตกค้าง
        </p>
      </div>

      <section className="card workflow-panel">
        <div className="card-body">
          <div className="workflow-filter-grid">
            <div className="form-group">
              <label>เริ่มวันที่</label>
              <input className="form-control" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>สิ้นสุดวันที่</label>
              <input className="form-control" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>ค้นหัวบัญชี / สิทธิการเงิน</label>
              <input
                className="form-control"
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                placeholder="เช่น 1102050101 หรือ UC"
              />
            </div>
            <div className="form-group">
              <label>ชื่อไฟล์ Vale ที่ต้องตรวจ</label>
              <input
                className="form-control"
                value={valeTargetFilename}
                onChange={(e) => setValeTargetFilename(e.target.value)}
                placeholder="เช่น 16แฟ้มFDH.xlsx"
              />
            </div>
            <div className="workflow-filter-actions">
              <button className="btn btn-primary" onClick={loadData} disabled={loading}>
                {loading ? 'กำลังคำนวณ...' : 'ดูรายงาน'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}

      {summary && (
        <>
          <div className="insurance-kpi-grid">
            <div className="insurance-kpi-card insurance-kpi-card--blue">
              <span>OPD ครบปิดสิทธิ์</span>
              <strong>{opdCloseRate}%</strong>
              <small>{count(summary.opdClosed)} / {count(summary.opdVisits)} visit</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--green">
              <span>IPD มีสถานะ FDH</span>
              <strong>{ipdFdhRate}%</strong>
              <small>{count(summary.ipdFdhSubmitted)} / {count(summary.ipdDischarged)} discharge</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--teal">
              <span>IPD ได้ REP/STM แล้ว</span>
              <strong>{ipdRepRate}%</strong>
              <small>{count(summary.ipdRepReceived)} ราย</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--amber">
              <span>ลูกหนี้คาดรับรวม</span>
              <strong>{money(summary.receivableTotal)}</strong>
              <small>OPD {money(summary.opdExpectedReceivable)} / IPD {money(summary.ipdExpectedReceivable)}</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--rose">
              <span>OPD ยังไม่ปิดสิทธิ์</span>
              <strong>{count(summary.opdMissingClose)}</strong>
              <small>ต้องไล่ปิดสิทธิ์ก่อนส่งบัญชี</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--slate">
              <span>Mapping ไม่ครบ</span>
              <strong>{count(summary.missingRuleCount)}</strong>
              <small>ต้องเติม vale/rules หัวบัญชี</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--indigo">
              <span>OPD รายได้รวม</span>
              <strong>{money(summary.opdIncome)}</strong>
              <small>คาดรับลูกหนี้ {money(summary.opdExpectedReceivable)} ({summary.opdIncome > 0 ? Math.round((summary.opdExpectedReceivable / summary.opdIncome) * 100) : 0}%)</small>
            </div>
            <div className={`insurance-kpi-card ${valeImportStatus?.status === 'found' ? 'insurance-kpi-card--green' : 'insurance-kpi-card--rose'}`}>
              <span>สถานะไฟล์ Vale</span>
              <strong>{valeImportStatus?.status === 'found' ? 'พบไฟล์แล้ว' : 'ยังไม่พบไฟล์'}</strong>
              <small>
                {valeImportStatus?.target_filename || VALE_TARGET_FILENAME}
                {' · batch '}{count(valeImportStatus?.batch_matches)}
                {' · rep '}{count(valeImportStatus?.rep_data_matches)}
              </small>
              <small>นำเข้าล่าสุด: {formatThaiDateTime(valeImportStatus?.last_import_at)}</small>
            </div>
          </div>

          <section className="card workflow-table-card">
            <div className="card-header">
              <span className="workflow-table-title">ภาพรวมรายเดือน</span>
              <span className="workflow-table-meta">{data?.startDate} ถึง {data?.endDate}</span>
            </div>
            <div className="modal-table-wrap">
              <table className="data-table workflow-readable-table insurance-month-table">
                <thead>
                  <tr>
                    <th>เดือน</th>
                    <th>OPD Visit</th>
                    <th>OPD ปิดสิทธิ์</th>
                    <th>OPD รายได้</th>
                    <th>OPD คาดรับ</th>
                    <th>IPD D/C</th>
                    <th>IPD มีสถานะ FDH</th>
                    <th>IPD ได้ REP</th>
                    <th>IPD คาดรับ</th>
                    <th>ลูกหนี้รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((row) => (
                    <tr key={row.month}>
                      <td className="workflow-id-cell">{row.month}</td>
                      <td>{count(row.opdVisits)}</td>
                      <td>{count(row.opdClosed)} / ค้าง {count(row.opdMissingClose)}</td>
                      <td className="workflow-money-cell">{money(row.opdIncome)}</td>
                      <td className="workflow-money-cell">{money(row.opdExpectedReceivable)}</td>
                      <td>{count(row.ipdDischarged)}</td>
                      <td>{count(row.ipdFdhSubmitted)}</td>
                      <td>{count(row.ipdRepReceived)}</td>
                      <td className="workflow-money-cell">{money(row.ipdExpectedReceivable)}</td>
                      <td className="workflow-money-cell">{money(row.receivable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card workflow-table-card">
            <div className="card-header">
              <span className="workflow-table-title">วิเคราะห์ REP/STM สำหรับงานประกัน</span>
              <span className="workflow-table-meta">ภาพรวมการชดเชย, reject และสุขภาพการนำเข้าไฟล์</span>
            </div>
            <div className="insurance-submission-panel">
              <div className="insurance-submission-grid">
                <div className="insurance-submission-card">
                  <span>IPD ควรมี REP</span>
                  <strong>{count(repFinancial?.ipd_total_cases)}</strong>
                  <small>ตาม discharge ในช่วงวันที่เลือก</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--success">
                  <span>REP ได้แล้ว</span>
                  <strong>{count(repFinancial?.rep_received_cases)}</strong>
                  <small>ค้าง REP {count(repFinancial?.rep_missing_cases)} เคส</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--teal">
                  <span>ยอดคาดรับ vs REP</span>
                  <strong>{money(repFinancial?.expected_total)} / {money(repFinancial?.rep_amount_total)}</strong>
                  <small>ส่วนต่างรวม {money(repFinancial?.diff_total)}</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--warning">
                  <span>Lag REP (วัน)</span>
                  <strong>{count(repFinancial?.lag_p50_days)} / {count(repFinancial?.lag_p90_days)}</strong>
                  <small>เฉลี่ย {repFinancial?.lag_avg_days ?? '-'} วัน</small>
                </div>
              </div>
            </div>

            <div className="modal-table-wrap insurance-table-gap-top">
              <table className="data-table workflow-readable-table insurance-missing-table">
                <thead>
                  <tr>
                    <th>สถานะ Reject Tracking</th>
                    <th>จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {(repAnalytics?.reject_status_summary || []).length === 0 ? (
                    <tr><td colSpan={2} className="empty-cell">ยังไม่มีข้อมูล reject ในช่วงนี้</td></tr>
                  ) : (repAnalytics?.reject_status_summary || []).map((row, index) => (
                    <tr key={`${row.resolve_status || 'unknown'}-${index}`}>
                      <td>{row.resolve_status || 'open'}</td>
                      <td>{count(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-table-wrap insurance-table-gap-top">
              <table className="data-table workflow-readable-table insurance-missing-table">
                <thead>
                  <tr>
                    <th>Top REP Errorcode</th>
                    <th>จำนวน</th>
                    <th>Income</th>
                    <th>Compensated</th>
                    <th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {(repAnalytics?.reject_top_errors || []).length === 0 ? (
                    <tr><td colSpan={5} className="empty-cell">ยังไม่พบ REP errorcode ในช่วงนี้</td></tr>
                  ) : (repAnalytics?.reject_top_errors || []).map((row, index) => (
                    <tr key={`${row.errorcode || 'unknown'}-${index}`}>
                      <td>{row.errorcode || '-'}</td>
                      <td>{count(row.total)}</td>
                      <td className="workflow-money-cell">{money(row.income_total)}</td>
                      <td className="workflow-money-cell">{money(row.compensated_total)}</td>
                      <td className="workflow-money-cell">{money(row.diff_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-table-wrap insurance-table-gap-top">
              <table className="data-table workflow-readable-table insurance-missing-table">
                <thead>
                  <tr>
                    <th>Import Type</th>
                    <th>Batch</th>
                    <th>Rows</th>
                    <th>Amount</th>
                    <th>Last Import</th>
                  </tr>
                </thead>
                <tbody>
                  {(repAnalytics?.import_health || []).length === 0 ? (
                    <tr><td colSpan={5} className="empty-cell">ยังไม่พบการนำเข้า REP/STM/INV ในช่วงนี้</td></tr>
                  ) : (repAnalytics?.import_health || []).map((row, index) => (
                    <tr key={`${row.data_type || 'unknown'}-${index}`}>
                      <td>{row.data_type || '-'}</td>
                      <td>{count(row.batch_count)}</td>
                      <td>{count(row.row_count)}</td>
                      <td className="workflow-money-cell">{row.total_amount == null ? '-' : money(row.total_amount)}</td>
                      <td>{row.last_import_at || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-table-wrap insurance-table-gap-top">
              <table className="data-table workflow-readable-table insurance-missing-table">
                <thead>
                  <tr>
                    <th>STM/INV Type</th>
                    <th>Rows</th>
                    <th>Matched</th>
                    <th>Unmatched</th>
                    <th>Matched %</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(repAnalytics?.statement_match_summary || []).length === 0 ? (
                    <tr><td colSpan={6} className="empty-cell">ยังไม่พบข้อมูล match ของ STM/INV ในช่วงนี้</td></tr>
                  ) : (repAnalytics?.statement_match_summary || []).map((row, index) => (
                    <tr key={`${row.data_type || 'unknown'}-match-${index}`}>
                      <td>{row.data_type || '-'}</td>
                      <td>{count(row.total_rows)}</td>
                      <td>{count(row.matched_rows)}</td>
                      <td>{count(row.unmatched_rows)}</td>
                      <td>{row.matched_rate ?? 0}%</td>
                      <td className="workflow-money-cell">{money(row.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-table-wrap insurance-table-gap-top">
              <table className="data-table workflow-readable-table insurance-missing-table">
                <thead>
                  <tr>
                    <th>STM/INV Top Error</th>
                    <th>จำนวน</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(repAnalytics?.statement_top_errors || []).length === 0 ? (
                    <tr><td colSpan={3} className="empty-cell">ยังไม่พบ errorcode ของ STM/INV ในช่วงนี้</td></tr>
                  ) : (repAnalytics?.statement_top_errors || []).map((row, index) => (
                    <tr key={`${row.data_type || 'unknown'}-${row.errorcode || 'err'}-${index}`}>
                      <td>{row.data_type || '-'}: {row.errorcode || '-'}</td>
                      <td>{count(row.total)}</td>
                      <td className="workflow-money-cell">{money(row.amount_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card workflow-table-card">
            <div className="card-header">
              <span className="workflow-table-title">OPD สรุปการส่งข้อมูล FDH ตามสิทธิ์</span>
              <span className="workflow-table-meta">ภาพรวมตาม HIPDATA และสถานะปิดสิทธิ์</span>
            </div>
            <div className="insurance-submission-panel">
              <div className="insurance-hipdata-filter">
                <span className="insurance-filter-label">สิทธิ์ผู้ป่วย (HIPDATA)</span>
                <button
                  className={`insurance-filter-chip ${opdHipdataFilter === 'ALL' ? 'is-active' : ''}`}
                  onClick={() => setOpdHipdataFilter('ALL')}
                >
                  ทั้งหมด <strong>{count(data.opdStatusRows.length)}</strong>
                </button>
                {opdHipdataOptions.map((item) => (
                  <button
                    key={item.code}
                    className={`insurance-filter-chip ${opdHipdataFilter === item.code ? 'is-active' : ''}`}
                    onClick={() => setOpdHipdataFilter(item.code)}
                  >
                    {item.code} <strong>{count(item.total)}</strong>
                  </button>
                ))}
              </div>

              <div className="insurance-submission-grid">
                <div className="insurance-submission-card">
                  <span>รวม OPD ที่เลือก</span>
                  <strong>{count(opdSubmissionSummary.total)}</strong>
                  <small>visit</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--success">
                  <span>พบใน ClaimDetail FDH</span>
                  <strong>{count(opdSubmissionSummary.claimDetailImported)}</strong>
                  <small>นำเข้าแล้ว/เทียบ VN ได้ ({opdSubmissionSummary.importedRate}%)</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--warning">
                  <span>ยังไม่พบ ClaimDetail</span>
                  <strong>{count(opdSubmissionSummary.claimDetailMissing)}</strong>
                  <small>ยังไม่มีในไฟล์นำเข้าหรือ VN ไม่ตรง</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--teal">
                  <span>สถานะส่งเบิก</span>
                  <strong>{count(opdSubmissionSummary.sent)}</strong>
                  <small>ไม่ประสงค์เบิก {count(opdSubmissionSummary.nonClaim)} | ปิดสิทธิ์ {count(opdSubmissionSummary.closed)} ({opdSubmissionSummary.closeRate}%)</small>
                </div>
              </div>
            </div>
            <div className="insurance-section-footer">
              <div>
                <strong>รายละเอียดรายตัวแยกไปหน้า OPD</strong>
                <small>ใช้หน้านี้ดูภาพรวมก่อน แล้วค่อยลงรายการผู้ป่วยนอกเฉพาะที่ต้องแก้</small>
              </div>
              <button className="btn btn-secondary" onClick={() => navigateTo('staff')}>เปิดหน้า OPD</button>
            </div>
          </section>

          <section className="card workflow-table-card">
            <div className="card-header">
              <span className="workflow-table-title">IPD ภาพรวมหลัง Discharge ถึง FDH / REP</span>
              <span className="workflow-table-meta">สรุปตาม HIPDATA เพื่อดูงานค้างก่อนลงรายตัว</span>
            </div>
            <div className="insurance-submission-panel">
              <div className="insurance-hipdata-filter">
                <span className="insurance-filter-label">สิทธิ์ผู้ป่วย (HIPDATA)</span>
                <button
                  className={`insurance-filter-chip ${hipdataFilter === 'ALL' ? 'is-active' : ''}`}
                  onClick={() => setHipdataFilter('ALL')}
                >
                  ทั้งหมด <strong>{count(data.ipdLagRows.length)}</strong>
                </button>
                {hipdataOptions.map((item) => (
                  <button
                    key={item.code}
                    className={`insurance-filter-chip ${hipdataFilter === item.code ? 'is-active' : ''}`}
                    onClick={() => setHipdataFilter(item.code)}
                  >
                    {item.code} <strong>{count(item.total)}</strong>
                  </button>
                ))}
              </div>

              <div className="insurance-submission-grid">
                <div className="insurance-submission-card">
                  <span>รวม IPD ที่เลือก</span>
                  <strong>{count(ipdSubmissionSummary.total)}</strong>
                  <small>discharge</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--success">
                  <span>มีสถานะ FDH</span>
                  <strong>{count(ipdSubmissionSummary.sent)}</strong>
                  <small>ClaimDetail {count(ipdSubmissionSummary.claimDetailImported)} / track status {count(Math.max(0, ipdSubmissionSummary.sent - ipdSubmissionSummary.claimDetailImported))}</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--warning">
                  <span>ยังไม่ส่ง / ยังไม่พบ</span>
                  <strong>{count(ipdSubmissionSummary.pending)}</strong>
                  <small>ต้องตาม chart หรือรอบส่ง</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--teal">
                  <span>การส่งครบถ้วน</span>
                  <strong>{ipdSubmissionSummary.completeRate}%</strong>
                  <small>REP แล้ว {count(ipdSubmissionSummary.repReceived)} ราย</small>
                </div>
              </div>
            </div>
            <div className="insurance-section-footer">
              <div>
                <strong>รายละเอียดรายตัวแยกไปหน้า IPD</strong>
                <small>หน้า IPD ใช้ตาม chart, discharge, FDH และ REP/STM เป็นรายคน</small>
              </div>
              <button className="btn btn-secondary" onClick={() => navigateTo('ipd')}>เปิดหน้า IPD</button>
            </div>
          </section>

          <section className="insurance-split-grid">
            <div className="card workflow-table-card">
              <div className="card-header">
                <span className="workflow-table-title">สรุปตามหัวบัญชี</span>
                <span className="workflow-table-meta">{count(data.accountRows.length)} กลุ่ม</span>
              </div>
              <div className="modal-table-wrap">
                <table className="data-table workflow-readable-table insurance-account-table">
                  <thead>
                    <tr>
                      <th>ประเภท</th>
                      <th>สิทธิการเงิน</th>
                      <th>ลูกหนี้</th>
                      <th>รายได้</th>
                      <th>รายการ</th>
                      <th>ยอดลูกหนี้</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accountRows.map((row, index) => (
                      <tr key={`${row.patient_type}-${row.finance_right_code || 'NA'}-${row.debtor_code}-${row.revenue_code}-${index}`}>
                        <td>{row.patient_type}</td>
                        <td>{row.finance_right_code || '-'} {row.finance_right_name || ''}</td>
                        <td className="workflow-code-cell">{row.debtor_code}</td>
                        <td className="workflow-code-cell">{row.revenue_code}</td>
                        <td>{count(row.item_count)}</td>
                        <td className="workflow-money-cell">{money(row.total_receivable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card workflow-table-card">
              <div className="card-header">
                <span className="workflow-table-title">สรุปข้อมูลที่ต้องเติมใน vale/rules</span>
                <span className="workflow-table-meta">รวมตามสิทธิ ไม่แสดงรายตัว</span>
              </div>
              <div className="modal-table-wrap">
                <table className="data-table workflow-readable-table insurance-missing-table">
                  <thead>
                    <tr>
                      <th>ประเภท</th>
                      <th>สิทธิ HOSxP</th>
                      <th>HIPDATA</th>
                      <th>จำนวน</th>
                      <th>ยอด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingRuleSummary.length === 0 ? (
                      <tr><td colSpan={5} className="empty-cell">ยังไม่พบ mapping ที่ขาดในช่วงนี้</td></tr>
                    ) : missingRuleSummary.map((row) => (
                      <tr key={`${row.patient_type}-${row.pttype}-${row.hipdata_code}`}>
                        <td>{row.patient_type || '-'}</td>
                        <td>{row.pttype || '-'} {row.pttype_name || ''}</td>
                        <td>{row.hipdata_code || '-'}</td>
                        <td>{count(row.item_count)}</td>
                        <td className="workflow-money-cell">{money(row.claimable_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card workflow-table-card">
              <div className="card-header">
                <span className="workflow-table-title">ข้อเสนอเติม vale/rules ที่พบบ่อย</span>
                <span className="workflow-table-meta">Top {count(data.valeRuleSuggestions?.length || 0)} กลุ่ม</span>
              </div>
              <div className="modal-table-wrap">
                <table className="data-table workflow-readable-table insurance-missing-table">
                  <thead>
                    <tr>
                      <th>ประเภท</th>
                      <th>สิทธิ HOSxP</th>
                      <th>HIPDATA</th>
                      <th>จำนวน</th>
                      <th>ยอด</th>
                      <th>ต้องเติม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.valeRuleSuggestions || []).length === 0 ? (
                      <tr><td colSpan={6} className="empty-cell">ยังไม่พบข้อมูลที่ต้องเติม vale/rules</td></tr>
                    ) : (data.valeRuleSuggestions || []).map((row, index) => (
                      <tr key={`${row.patient_type}-${row.pttype}-${row.hipdata_code}-${index}`}>
                        <td>{row.patient_type || '-'}</td>
                        <td>{row.pttype || '-'} {row.pttype_name || ''}</td>
                        <td>{row.hipdata_code || '-'}</td>
                        <td>{count(row.total)}</td>
                        <td className="workflow-money-cell">{money(row.claimable_amount)}</td>
                        <td>{row.suggested_action || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card workflow-table-card">
              <div className="card-header">
                <span className="workflow-table-title">Error ที่เกิดขึ้นบ่อย (HOSxP/FDH/REP)</span>
                <span className="workflow-table-meta">รวมสาเหตุที่พบซ้ำในช่วงวันที่ที่เลือก</span>
              </div>
              <div className="modal-table-wrap">
                <table className="data-table workflow-readable-table insurance-missing-table">
                  <thead>
                    <tr>
                      <th>กลุ่มปัญหา</th>
                      <th>จำนวน</th>
                      <th>มูลค่าเกี่ยวข้อง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.frequentEntryIssues || []).length === 0 ? (
                      <tr><td colSpan={3} className="empty-cell">ยังไม่พบ error ที่เกิดซ้ำ</td></tr>
                    ) : (data.frequentEntryIssues || []).map((row) => (
                      <tr key={row.issue_key || row.issue_label}>
                        <td>{row.issue_label || '-'}</td>
                        <td>{count(row.total)}</td>
                        <td className="workflow-money-cell">{money(row.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-table-wrap insurance-table-gap-top">
                <table className="data-table workflow-readable-table insurance-missing-table">
                  <thead>
                    <tr>
                      <th>REP Error Code</th>
                      <th>จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.frequentSystemErrors?.rep_error_codes || []).length === 0 ? (
                      <tr><td colSpan={2} className="empty-cell">ไม่พบ REP error code ในช่วงนี้</td></tr>
                    ) : (data.frequentSystemErrors?.rep_error_codes || []).map((row, index) => (
                      <tr key={`${row.error_code || 'rep'}-${index}`}>
                        <td>{row.error_code || '-'}</td>
                        <td>{count(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-table-wrap insurance-table-gap-top">
                <table className="data-table workflow-readable-table insurance-missing-table">
                  <thead>
                    <tr>
                      <th>FDH Status Error</th>
                      <th>จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.frequentSystemErrors?.fdh_status_errors || []).length === 0 ? (
                      <tr><td colSpan={2} className="empty-cell">ไม่พบสถานะผิดพลาดจาก FDH ในช่วงนี้</td></tr>
                    ) : (data.frequentSystemErrors?.fdh_status_errors || []).map((row, index) => (
                      <tr key={`${row.status_label || 'fdh'}-${index}`}>
                        <td>{row.status_label || '-'}</td>
                        <td>{count(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
