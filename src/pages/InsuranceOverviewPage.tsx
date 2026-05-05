import { useEffect, useState } from 'react';
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
  fdh_status?: string;
  fdh_sent_at?: string;
  days_dch_to_fdh?: number | null;
  rep_no?: string | null;
  rep_received_at?: string | null;
  days_dch_to_rep?: number | null;
  rep_amount?: number | null;
  diff_amount?: number | null;
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

const statusClass = (status?: string) => {
  const text = String(status || '');
  if (!text || text.includes('ยังไม่')) return 'insurance-status insurance-status--muted';
  if (text.includes('error') || text.includes('Error') || text.includes('reject') || text.includes('ปฏิเสธ')) {
    return 'insurance-status insurance-status--danger';
  }
  if (text.includes('ยังไม่พบเคลม') || text.includes('unclaimed') || text.includes('รอ') || text.includes('pending')) return 'insurance-status insurance-status--warning';
  return 'insurance-status insurance-status--success';
};

export const InsuranceOverviewPage = () => {
  const [startDate, setStartDate] = useState(firstDayOfMonth());
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [accountCode, setAccountCode] = useState('');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
              <span className="workflow-table-title">IPD ระยะเวลาหลัง Discharge ถึง FDH / REP</span>
              <span className="workflow-table-meta">ใช้ติดตามรอบส่งข้อมูลและรับ REP/STM</span>
            </div>
            <div className="modal-table-wrap">
              <table className="data-table workflow-readable-table insurance-ipd-lag-table">
                <thead>
                  <tr>
                    <th>AN / HN</th>
                    <th>ผู้ป่วย</th>
                    <th>D/C</th>
                    <th>สถานะ FDH</th>
                    <th>วันถึง FDH</th>
                    <th>REP/STM</th>
                    <th>วันถึง REP</th>
                    <th>คาดรับ</th>
                    <th>REP จ่าย</th>
                    <th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ipdLagRows.map((row) => (
                    <tr key={row.an || row.vn}>
                      <td>
                        <div className="workflow-id-cell">{row.an || '-'}</div>
                        <small>HN {row.hn || '-'}</small>
                      </td>
                      <td className="workflow-person-cell">{row.patient_name || '-'}</td>
                      <td className="table-cell-nowrap">{row.dchdate || '-'}</td>
                      <td><span className={statusClass(row.fdh_status)}>{row.fdh_status || 'ยังไม่พบสถานะ FDH'}</span></td>
                      <td>{row.days_dch_to_fdh == null ? '-' : `${row.days_dch_to_fdh} วัน`}</td>
                      <td>{row.rep_no || '-'}</td>
                      <td>{row.days_dch_to_rep == null ? '-' : `${row.days_dch_to_rep} วัน`}</td>
                      <td className="workflow-money-cell">{money(row.expected_receivable)}</td>
                      <td className="workflow-money-cell">{row.rep_amount == null ? '-' : money(row.rep_amount)}</td>
                      <td className="workflow-money-cell">{row.diff_amount == null ? '-' : money(row.diff_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                <span className="workflow-table-title">ข้อมูลที่ต้องเติมใน vale/rules</span>
                <span className="workflow-table-meta">สิทธิที่ไม่มีหัวบัญชีครบ</span>
              </div>
              <div className="modal-table-wrap">
                <table className="data-table workflow-readable-table insurance-missing-table">
                  <thead>
                    <tr>
                      <th>ประเภท</th>
                      <th>VN/AN</th>
                      <th>HN</th>
                      <th>สิทธิ HOSxP</th>
                      <th>HIPDATA</th>
                      <th>ยอด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.missingRuleRows.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20 }}>ยังไม่พบ mapping ที่ขาดในช่วงนี้</td></tr>
                    ) : data.missingRuleRows.map((row, index) => (
                      <tr key={`${row.vn || row.an}-${index}`}>
                        <td>{row.patient_type || '-'}</td>
                        <td className="workflow-id-cell">{row.vn || row.an || '-'}</td>
                        <td>{row.hn || '-'}</td>
                        <td>{row.pttype || '-'} {row.pttype_name || ''}</td>
                        <td>{row.hipdata_code || '-'}</td>
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
