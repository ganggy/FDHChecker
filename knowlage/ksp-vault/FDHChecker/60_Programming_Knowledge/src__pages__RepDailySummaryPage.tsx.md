---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/pages/RepDailySummaryPage.tsx"
source_hash: "cb43706d8b986d70ae71400eba27fb262d0cfd9360146eb50e1f307642c6ea97"
managed_by: "sync-ksp-vault"
---
# RepDailySummaryPage.tsx

> Source: `src/pages/RepDailySummaryPage.tsx`
> SHA-256: `cb43706d8b986d70ae71400eba27fb262d0cfd9360146eb50e1f307642c6ea97`

````tsx
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchRepDailyVisitDetail,
  fetchRepDailyVisits,
  fetchRepDailySummary,
  type RepDailyRecommendedReport,
  type RepDailySummary,
  type RepDailySummaryRow,
  type RepDailyVisitDetail,
  type RepDailyVisitRow,
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

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 19);
};

const textValue = (value: unknown) => {
  if (value == null || value === '') return '-';
  return String(value);
};

const moneyOrDash = (value: unknown) => (value == null ? '-' : formatMoney(value));

const uucRate = (summary: RepDailySummary | null) => {
  const total = toNumber(summary?.total_visits);
  if (total === 0) return 0;
  return Math.round((toNumber(summary?.uuc1_visits) / total) * 100);
};

const StatCard = ({
  label,
  value,
  sub,
  tone = 'blue',
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
}) => (
  <div className={`uuc1-stat uuc1-stat--${tone}`}>
    <div className="uuc1-stat__label">{label}</div>
    <div className="uuc1-stat__value">{value}</div>
    {sub && <div className="uuc1-stat__sub">{sub}</div>}
  </div>
);

const ReportCard = ({ report }: { report: RepDailyRecommendedReport }) => (
  <div className="card" style={{ minHeight: 112 }}>
    <div className="card-body">
      <div style={{ fontWeight: 800, color: '#1d4ed8', marginBottom: 6 }}>{report.title}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.86rem', lineHeight: 1.55 }}>{report.description}</div>
    </div>
  </div>
);

const DetailTable = ({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Record<string, unknown>[];
  columns: Array<[string, string]>;
}) => (
  <section className="card" style={{ overflow: 'hidden' }}>
    <div className="card-header">
      <div className="workflow-table-title">{title}</div>
      <span className="badge badge-info">{rows.length.toLocaleString('th-TH')}</span>
    </div>
    <div className="modal-table-wrap" style={{ maxHeight: 260 }}>
      <table className="data-table long-id-table">
        <thead>
          <tr>
            {columns.map(([, label]) => <th key={label}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${title}:${index}`}>
              {columns.map(([key]) => (
                <td key={key}>{textValue(row[key])}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="empty-cell">ไม่มีข้อมูล</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
);

export const RepDailySummaryPage = () => {
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(todayIso());
  const [patientType, setPatientType] = useState('ALL');
  const [claimStatus, setClaimStatus] = useState('ALL');
  const [rows, setRows] = useState<RepDailySummaryRow[]>([]);
  const [summary, setSummary] = useState<RepDailySummary | null>(null);
  const [reports, setReports] = useState<RepDailyRecommendedReport[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [dailyVisits, setDailyVisits] = useState<RepDailyVisitRow[]>([]);
  const [dailyVisitSummary, setDailyVisitSummary] = useState<Record<string, number> | null>(null);
  const [visitLoading, setVisitLoading] = useState(false);
  const [visitError, setVisitError] = useState('');
  const [detail, setDetail] = useState<RepDailyVisitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchRepDailySummary({
        startDate,
        endDate,
        patientType: patientType === 'ALL' ? undefined : patientType,
        claimStatus: claimStatus === 'ALL' ? undefined : claimStatus,
      });
      setRows(result.data || []);
      setSummary(result.summary || null);
      setReports(result.recommended_reports || []);
      setSelectedDate('');
      setDailyVisits([]);
      setDailyVisitSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDate = async (claimDate: string) => {
    setSelectedDate(claimDate);
    setVisitLoading(true);
    setVisitError('');
    setDailyVisits([]);
    setDailyVisitSummary(null);
    try {
      const result = await fetchRepDailyVisits({
        claimDate,
        patientType: patientType === 'ALL' ? undefined : patientType,
        claimStatus: claimStatus === 'ALL' ? undefined : claimStatus,
      });
      setDailyVisits(result.data || []);
      setDailyVisitSummary(result.summary || null);
    } catch (err) {
      setVisitError(err instanceof Error ? err.message : 'โหลดรายการ visit ไม่สำเร็จ');
    } finally {
      setVisitLoading(false);
    }
  };

  const openVisitDetail = async (visit: RepDailyVisitRow) => {
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const result = await fetchRepDailyVisitDetail({
        patientType: visit.patient_type,
        visitCode: visit.visit_code,
      });
      setDetail(result);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'โหลดรายละเอียด visit ไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExport = () => {
    if (rows.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
      วันที่: row.claim_date,
      Visit_ทั้งหมด: row.total_visits,
      OPD: row.opd_visits,
      IPD: row.ipd_visits,
      UUC1_พบ_REP: row.uuc1_visits,
      UUC2_ยังไม่พบ_REP: row.uuc2_visits,
      OPD_UUC1: row.opd_uuc1,
      OPD_UUC2: row.opd_uuc2,
      IPD_UUC1: row.ipd_uuc1,
      IPD_UUC2: row.ipd_uuc2,
      REP_Records: row.rep_records,
      REP_ปกติ: row.rep_clean_cases,
      REP_C_Deny: row.rep_error_cases,
      ยอด_REP: row.rep_amount,
      พบ_STM: row.stm_visits,
      รอ_STM: row.pending_stm_visits,
      STM_จ่าย_0: row.stm_zero_cases,
      STM_Records: row.stm_records,
      ยอดตั้ง_STM: row.stm_amount,
      ยอดรับ_STM: row.stm_paid_amount,
      เลข_STM_ล่าสุด: row.latest_stm_statement_no || '',
      นำเข้า_STM_ล่าสุด: row.latest_stm_import_at || '',
      REP_Senddate_ล่าสุด: row.latest_rep_senddate || '',
      นำเข้า_REP_ล่าสุด: row.latest_rep_import_at || '',
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'REP Daily');
    XLSX.writeFile(workbook, `rep_daily_summary_${startDate}_${endDate}.xlsx`);
  };

  return (
    <div className="workflow-page">
      <section className="workflow-hero uuc1-hero">
        <div>
          <h1 className="page-title workflow-hero__title">📊 สรุป REP/STM รายวัน</h1>
          <p className="page-subtitle">
            สรุปยอด visit รายวันโดยใช้ข้อมูล REP ที่นำเข้าแล้วเป็นตัวบอกว่า visit ไหนพบ REP แล้ว
            และต่อยอดด้วย STM เพื่อดู visit ที่ได้รับ statement, ยอดรับจริง และเคส STM จ่าย 0
          </p>
        </div>
        <div className="workflow-hero__meta">
          <span className="workflow-badge">REP ล่าสุด {formatDateTime(summary?.latest_rep_import_at)}</span>
          <span className="workflow-badge">STM ล่าสุด {formatDateTime(summary?.latest_stm_import_at)}</span>
          <span className="workflow-badge">พบ REP {uucRate(summary)}%</span>
        </div>
      </section>

      <section className="workflow-panel uuc1-filter-panel">
        <div className="workflow-filter-grid uuc1-filter-grid">
          <div className="form-group">
            <label className="form-label">วันที่เริ่มต้น</label>
            <input className="form-control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">วันที่สิ้นสุด</label>
            <input className="form-control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">ประเภทผู้ป่วย</label>
            <select className="form-control" value={patientType} onChange={(event) => setPatientType(event.target.value)}>
              <option value="ALL">ทั้งหมด</option>
              <option value="OPD">ผู้ป่วยนอก</option>
              <option value="IPD">ผู้ป่วยใน</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">สถานะ REP</label>
            <select className="form-control" value={claimStatus} onChange={(event) => setClaimStatus(event.target.value)}>
              <option value="ALL">ทั้งหมด</option>
              <option value="UUC1">เฉพาะ UUC1 / พบ REP</option>
              <option value="UUC2">เฉพาะ UUC2 / ยังไม่พบ REP</option>
            </select>
          </div>
          <div className="workflow-filter-actions uuc1-actions">
            <button className="btn btn-primary" onClick={() => void loadData()} disabled={loading}>
              {loading ? 'กำลังโหลด...' : 'โหลดข้อมูล'}
            </button>
            <button className="btn btn-secondary" onClick={handleExport} disabled={rows.length === 0}>
              ส่งออก Excel
            </button>
          </div>
        </div>
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      <section className="uuc1-summary-grid">
        <StatCard label="Visit ทั้งหมด" value={formatCount(summary?.total_visits)} sub={`${formatCount(summary?.opd_visits)} OPD / ${formatCount(summary?.ipd_visits)} IPD`} tone="blue" />
        <StatCard label="UUC1 พบ REP" value={formatCount(summary?.uuc1_visits)} sub={`คิดเป็น ${uucRate(summary)}% ของ visit`} tone="green" />
        <StatCard label="UUC2/ยังไม่พบ REP" value={formatCount(summary?.uuc2_visits)} sub={`${formatCount(summary?.opd_uuc2)} OPD / ${formatCount(summary?.ipd_uuc2)} IPD`} tone="amber" />
        <StatCard label="C/Deny จาก REP" value={formatCount(summary?.rep_error_cases)} sub={`${formatCount(summary?.rep_clean_cases)} เคสปกติ`} tone="red" />
        <StatCard label="ยอด REP รวม" value={formatMoney(summary?.total_rep_amount)} sub={`${formatCount(summary?.rep_records)} records`} tone="purple" />
        <StatCard label="พบ STM" value={formatCount(summary?.stm_visits)} sub={`รอ STM ${formatCount(summary?.pending_stm_visits)} visit`} tone="green" />
        <StatCard label="STM จ่าย 0" value={formatCount(summary?.stm_zero_cases)} sub={`ยอดรับ ${formatMoney(summary?.stm_paid_amount)} บาท`} tone="red" />
      </section>

      {reports.length > 0 && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
          {reports.map((report) => <ReportCard key={report.key} report={report} />)}
        </section>
      )}

      <section className="card workflow-table-card uuc1-table-card">
        <div className="card-header">
          <div>
            <div className="workflow-table-title">ยอดส่งเบิกรายวันจาก REP/STM</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              อิงวันที่รับบริการ/จำหน่ายจาก HOSxP แล้วตรวจว่ามี REP/STM ตรง VN/AN หรือ transaction จาก REP หรือไม่
            </div>
          </div>
          <span className="badge badge-info">{loading ? 'กำลังโหลด...' : `${rows.length.toLocaleString('th-TH')} วัน`}</span>
        </div>
        <div className="modal-table-wrap uuc1-table-wrap">
          <table className="data-table long-id-table uuc1-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th className="text-right">ทั้งหมด</th>
                <th className="text-right">OPD</th>
                <th className="text-right">IPD</th>
                <th className="text-right">UUC1 พบ REP</th>
                <th className="text-right">UUC2/ยังไม่พบ REP</th>
                <th className="text-right">OPD UUC1/UUC2</th>
                <th className="text-right">IPD UUC1/UUC2</th>
                <th className="text-right">REP Record</th>
                <th className="text-right">C/Deny</th>
                <th className="text-right">ยอด REP</th>
                <th className="text-right">STM พบ/รอ</th>
                <th className="text-right">STM จ่าย 0</th>
                <th className="text-right">ยอดรับ STM</th>
                <th>STM ล่าสุด</th>
                <th>REP ล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.claim_date}>
                  <td className="table-cell-nowrap">
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => void openDate(row.claim_date)}
                      style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                    >
                      {row.claim_date}
                    </button>
                  </td>
                  <td className="text-right">{formatCount(row.total_visits)}</td>
                  <td className="text-right">{formatCount(row.opd_visits)}</td>
                  <td className="text-right">{formatCount(row.ipd_visits)}</td>
                  <td className="text-right uuc1-money uuc1-money--ok">{formatCount(row.uuc1_visits)}</td>
                  <td className="text-right uuc1-money uuc1-money--bad">{formatCount(row.uuc2_visits)}</td>
                  <td className="text-right">{formatCount(row.opd_uuc1)} / {formatCount(row.opd_uuc2)}</td>
                  <td className="text-right">{formatCount(row.ipd_uuc1)} / {formatCount(row.ipd_uuc2)}</td>
                  <td className="text-right">{formatCount(row.rep_records)}</td>
                  <td className="text-right">{formatCount(row.rep_error_cases)}</td>
                  <td className="text-right uuc1-money">{formatMoney(row.rep_amount)}</td>
                  <td className="text-right">{formatCount(row.stm_visits)} / {formatCount(row.pending_stm_visits)}</td>
                  <td className="text-right uuc1-money uuc1-money--bad">{formatCount(row.stm_zero_cases)}</td>
                  <td className="text-right uuc1-money">{formatMoney(row.stm_paid_amount)}</td>
                  <td>
                    <div>{row.latest_stm_statement_no || '-'}</div>
                    <small>นำเข้า {formatDateTime(row.latest_stm_import_at)}</small>
                  </td>
                  <td>
                    <div>{formatDateTime(row.latest_rep_senddate)}</div>
                    <small>นำเข้า {formatDateTime(row.latest_rep_import_at)}</small>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={16} className="empty-cell">ไม่พบข้อมูลตามช่วงวันที่ที่เลือก</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDate && (
        <section className="card workflow-table-card uuc1-table-card" style={{ marginTop: 18 }}>
          <div className="card-header">
            <div>
              <div className="workflow-table-title">Visit วันที่ {selectedDate}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                คลิก VN/AN เพื่อดูรายละเอียดใบสั่งยา, diagnosis, ICD9/ICD10, CC, lab, REP และ STM
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {dailyVisitSummary && (
                <>
                  <span className="badge badge-info">{formatCount(dailyVisitSummary.total)} visit</span>
                  <span className="badge badge-success">REP {formatCount(dailyVisitSummary.rep)}</span>
                  <span className="badge badge-success">STM {formatCount(dailyVisitSummary.stm)}</span>
                  <span className="badge badge-warning">รอ STM {formatCount(dailyVisitSummary.pending_stm)}</span>
                </>
              )}
              <button className="btn btn-secondary" onClick={() => {
                setSelectedDate('');
                setDailyVisits([]);
                setDailyVisitSummary(null);
              }}>
                ปิดรายการ
              </button>
            </div>
          </div>
          {visitError && <div className="alert alert-error" style={{ margin: 12 }}>{visitError}</div>}
          <div className="modal-table-wrap uuc1-table-wrap">
            <table className="data-table long-id-table uuc1-table">
              <thead>
                <tr>
                  <th>ประเภท</th>
                  <th>VN/AN</th>
                  <th>HN</th>
                  <th>ผู้ป่วย</th>
                  <th>สิทธิ์</th>
                  <th>แผนก/คลินิก</th>
                  <th className="text-right">ยอดตั้ง</th>
                  <th className="text-right">REP</th>
                  <th className="text-right">STM รับ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {dailyVisits.map((visit) => (
                  <tr key={`${visit.patient_type}:${visit.visit_code}`}>
                    <td>
                      <span className={`badge ${visit.patient_type === 'IPD' ? 'badge-info' : 'badge-success'}`}>
                        {visit.patient_type}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => void openVisitDetail(visit)}
                        style={{ padding: '4px 10px', fontFamily: 'monospace' }}
                      >
                        {visit.visit_code}
                      </button>
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>{visit.hn || '-'}</td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{visit.patient_name || '-'}</div>
                      <small>{visit.cid || '-'} · {visit.age || '-'}</small>
                    </td>
                    <td>
                      <div>{visit.pttype_name || '-'}</div>
                      <small>{visit.pttype || '-'}</small>
                    </td>
                    <td>
                      <div>{visit.department || '-'}</div>
                      <small>{visit.clinic || '-'}</small>
                    </td>
                    <td className="text-right uuc1-money">{formatMoney(visit.claimable_amount)}</td>
                    <td className="text-right">{moneyOrDash(visit.rep_amount)}</td>
                    <td className="text-right">{moneyOrDash(visit.stm_paid_amount)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span className={`badge ${visit.has_rep ? 'badge-success' : 'badge-warning'}`}>{visit.has_rep ? 'พบ REP' : 'ยังไม่พบ REP'}</span>
                        <span className={`badge ${visit.has_stm ? 'badge-success' : 'badge-warning'}`}>{visit.has_stm ? 'พบ STM' : 'รอ STM'}</span>
                        {visit.rep_issue && <span className="badge badge-danger">C/Deny</span>}
                        {visit.stm_zero && <span className="badge badge-danger">STM 0</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {dailyVisits.length === 0 && !visitLoading && (
                  <tr><td colSpan={10} className="empty-cell">ไม่พบ visit ในวันที่เลือก</td></tr>
                )}
                {visitLoading && (
                  <tr><td colSpan={10} className="empty-cell">กำลังโหลดรายการ visit...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(detailLoading || detailError || detail) && (
        <div className="modal-backdrop" onClick={() => {
          if (!detailLoading) {
            setDetail(null);
            setDetailError('');
          }
        }}>
          <div className="modal-content" style={{ maxWidth: 1180, width: '94vw', maxHeight: '88vh', overflow: 'auto' }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>รายละเอียด visit</h3>
                <small>{detail?.patient_type || ''} {detail?.visit_code || ''}</small>
              </div>
              <button className="btn btn-secondary" onClick={() => {
                setDetail(null);
                setDetailError('');
              }} disabled={detailLoading}>
                ปิด
              </button>
            </div>

            {detailLoading && <div className="empty-cell">กำลังโหลดรายละเอียด...</div>}
            {detailError && <div className="alert alert-error">{detailError}</div>}
            {detail && !detailLoading && (
              <div style={{ display: 'grid', gap: 14 }}>
                <section className="workflow-panel" style={{ padding: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    <div><strong>ผู้ป่วย</strong><br />{textValue(detail.patient?.patient_name)}</div>
                    <div><strong>HN/CID</strong><br />{textValue(detail.patient?.hn)} / {textValue(detail.patient?.cid)}</div>
                    <div><strong>สิทธิ์</strong><br />{textValue(detail.patient?.pttype_name)}</div>
                    <div><strong>แผนก</strong><br />{textValue(detail.patient?.department)}</div>
                    <div><strong>คลินิก</strong><br />{textValue(detail.patient?.clinic)}</div>
                    <div><strong>CC</strong><br />{textValue(detail.patient?.cc)}</div>
                  </div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
                  <DetailTable title="Diagnosis ICD10" rows={detail.diagnoses} columns={[
                    ['diagtype', 'Type'],
                    ['icd10', 'ICD10'],
                    ['code_name', 'ชื่อโรค'],
                  ]} />
                  <DetailTable title="Procedure ICD9" rows={detail.procedures} columns={[
                    ['icd9', 'ICD9'],
                    ['code_name', 'ชื่อหัตถการ'],
                    ['source', 'แหล่ง'],
                  ]} />
                  <DetailTable title="Lab" rows={detail.labs} columns={[
                    ['order_date', 'วันที่'],
                    ['lab_items_name', 'รายการ'],
                    ['lab_order_result', 'ผล'],
                    ['lab_items_normal_value', 'ค่าปกติ'],
                  ]} />
                  <DetailTable title="REP" rows={detail.rep} columns={[
                    ['rep_no', 'REP'],
                    ['tran_id', 'Tran ID'],
                    ['compensated', 'ชดเชย'],
                    ['errorcode', 'Error'],
                    ['verifycode', 'Verify'],
                  ]} />
                  <DetailTable title="STM/INV" rows={detail.stm} columns={[
                    ['data_type', 'ชนิด'],
                    ['statement_no', 'STM'],
                    ['paid_amount', 'ยอดรับ'],
                    ['errorcode', 'Error'],
                    ['verifycode', 'Verify'],
                  ]} />
                </div>

                <DetailTable title="ใบสั่งยา / ค่าใช้จ่าย / ADP" rows={detail.receipts} columns={[
                  ['icode', 'รหัส'],
                  ['item_name', 'รายการ'],
                  ['income_name', 'หมวด'],
                  ['qty', 'จำนวน'],
                  ['unitprice', 'ราคา'],
                  ['sum_price', 'รวม'],
                  ['nhso_adp_code', 'ADP'],
                  ['ttmt_code', 'TTMT'],
                  ['tmlt_code', 'TMLT'],
                ]} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RepDailySummaryPage;

````
