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

type OverviewData = {
  startDate: string;
  endDate: string;
  summary: Summary;
  months: MonthRow[];
  opdStatusRows: OpdStatusRow[];
  ipdLagRows: IpdLagRow[];
  accountRows: AccountRow[];
  missingRuleRows: MissingRuleRow[];
};

const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const count = (value: unknown) => Number(value || 0).toLocaleString('th-TH');

const firstDayOfMonth = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
};

export const InsuranceOverviewPage = () => {
  const [startDate, setStartDate] = useState(firstDayOfMonth());
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [accountCode, setAccountCode] = useState('');
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
    const sent = filteredOpdStatusRows.filter((row) => row.fdh_found === true).length;
    const closed = filteredOpdStatusRows.filter((row) => row.close_completed === true).length;
    const pending = Math.max(0, total - sent);
    const completeRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    const closeRate = total > 0 ? Math.round((closed / total) * 100) : 0;
    return { total, sent, pending, closed, completeRate, closeRate };
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
    const sent = filteredIpdLagRows.filter((row) => row.fdh_found === true).length;
    const repReceived = filteredIpdLagRows.filter((row) => Boolean(row.rep_no)).length;
    const pending = Math.max(0, total - sent);
    const completeRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    return { total, sent, pending, repReceived, completeRate };
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
                  <span>ส่ง FDH แล้ว</span>
                  <strong>{count(opdSubmissionSummary.sent)}</strong>
                  <small>พบรายการใน ClaimDetail FDH</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--warning">
                  <span>ยังไม่ส่ง / ยังไม่พบ</span>
                  <strong>{count(opdSubmissionSummary.pending)}</strong>
                  <small>ต้องตามรอบส่งหรือค้นจาก FDH</small>
                </div>
                <div className="insurance-submission-card insurance-submission-card--teal">
                  <span>ความครบถ้วน</span>
                  <strong>{opdSubmissionSummary.completeRate}%</strong>
                  <small>ปิดสิทธิ์แล้ว {count(opdSubmissionSummary.closed)} ราย ({opdSubmissionSummary.closeRate}%)</small>
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
                  <span>ส่ง FDH แล้ว</span>
                  <strong>{count(ipdSubmissionSummary.sent)}</strong>
                  <small>มีรายการส่ง/สถานะจริง</small>
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
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20 }}>ยังไม่พบ mapping ที่ขาดในช่วงนี้</td></tr>
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
          </section>
        </>
      )}
    </div>
  );
};
