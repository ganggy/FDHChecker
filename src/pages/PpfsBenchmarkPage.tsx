import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import * as XLSX from 'xlsx';
import businessRules from '../config/business_rules.json';
import {
  fetchPpfsNhsoReport,
  type PpfsMetric,
  type PpfsNhsoReport,
  type PpfsPivotRow,
} from '../services/hosxpService';

const metricOptions: Array<{ value: PpfsMetric; label: string; short: string }> = [
  { value: 'SUM_PAID', label: 'จำนวนเงินที่จ่าย (บาท)', short: 'บาท' },
  { value: 'CNT_VISIT', label: 'จำนวนครั้งบริการ', short: 'ครั้ง' },
  { value: 'CNT_PID', label: 'ผู้รับบริการ (คน)', short: 'คน' },
];

const getDefaultHcode = () => {
  const rules = businessRules as { site_settings?: { hospital_code?: string }; hospital?: { hcode?: string } };
  return rules.site_settings?.hospital_code || rules.hospital?.hcode || '11101';
};

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const formatCount = (value: unknown) => toNumber(value).toLocaleString('th-TH');

const formatMoney = (value: unknown) =>
  toNumber(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMetricValue = (value: unknown, metric: PpfsMetric) =>
  metric === 'SUM_PAID' ? formatMoney(value) : formatCount(value);

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 19);
};

const metricField = (metric: PpfsMetric, year: '2567' | '2568' | '2569') => {
  if (metric === 'CNT_PID') return `pid_${year}` as keyof PpfsPivotRow;
  if (metric === 'CNT_VISIT') return `visit_${year}` as keyof PpfsPivotRow;
  return `paid_${year}` as keyof PpfsPivotRow;
};

const Panel = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <section
    style={{
      background: '#fff',
      border: '1px solid rgba(148, 163, 184, 0.28)',
      borderRadius: 12,
      boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </section>
);

const PanelHeader = ({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      padding: '14px 16px',
      borderBottom: '1px solid rgba(226, 232, 240, 0.9)',
      background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(255,255,255,0.96))',
    }}
  >
    <div>
      <div style={{ fontWeight: 850, color: '#0f172a', fontSize: '0.98rem' }}>{title}</div>
      {subtitle && <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 3 }}>{subtitle}</div>}
    </div>
    {right}
  </div>
);

const SummaryCard = ({
  label,
  value,
  sub,
  tone = 'blue',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
}) => {
  const tones = {
    blue: ['#eff6ff', '#1d4ed8'],
    green: ['#ecfdf5', '#047857'],
    amber: ['#fffbeb', '#b45309'],
    red: ['#fef2f2', '#b91c1c'],
    slate: ['#f8fafc', '#334155'],
  } as const;
  return (
    <div style={{ background: tones[tone][0], border: '1px solid rgba(148, 163, 184, 0.22)', borderRadius: 10, padding: 14 }}>
      <div style={{ color: '#64748b', fontWeight: 750, fontSize: '0.76rem' }}>{label}</div>
      <div style={{ color: tones[tone][1], fontWeight: 900, fontSize: '1.35rem', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 4 }}>{sub}</div>}
    </div>
  );
};

const MiniBars = ({ row, metric }: { row: { paid_2567: number; paid_2568: number; paid_2569: number }; metric: PpfsMetric }) => {
  const max = Math.max(1, row.paid_2567, row.paid_2568, row.paid_2569);
  const items = [
    ['2567', row.paid_2567, '#2563eb'],
    ['2568', row.paid_2568, '#f97316'],
    ['2569', row.paid_2569, '#16a34a'],
  ] as const;
  return (
    <div style={{ display: 'grid', gap: 5, minWidth: 210 }}>
      {items.map(([year, value, color]) => (
        <div key={year} style={{ display: 'grid', gridTemplateColumns: '42px 1fr 72px', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>{year}</span>
          <div style={{ height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(2, (value / max) * 100)}%`, height: '100%', background: color }} />
          </div>
          <span style={{ fontSize: '0.74rem', color: '#334155', fontWeight: 800, textAlign: 'right' }}>{formatMetricValue(value, metric)}</span>
        </div>
      ))}
    </div>
  );
};

export const PpfsBenchmarkPage = () => {
  const [hcode, setHcode] = useState(getDefaultHcode());
  const [metric, setMetric] = useState<PpfsMetric>('SUM_PAID');
  const [report, setReport] = useState<PpfsNhsoReport | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchPpfsNhsoReport({ hcode, metric });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูล PPFS ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredPivot = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = report?.pivot_rows || [];
    if (!term) return rows;
    return rows.filter((row) =>
      `${row.group_name} ${row.item_name}`.toLowerCase().includes(term)
    );
  }, [report, search]);

  const topAccess = useMemo(() => (report?.access_share || []).slice(0, 10), [report]);
  const topMonthlySeries = useMemo(() => (report?.monthly_access.series || []).slice(0, 10), [report]);
  const metricShort = metricOptions.find((item) => item.value === metric)?.short || '';

  const handleExport = () => {
    if (!report) return;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.year_summary.map((row) => ({
      ปีงบประมาณ: row.fiscal_year,
      NHSO_คน: row.nhso_people,
      NHSO_ครั้ง: row.nhso_visits,
      NHSO_บาท: row.nhso_paid,
      Local_STM_Cases: row.local_stm_cases,
      Local_STM_Paid: row.local_stm_paid_amount,
      Gap_NHSO_vs_Local_STM: row.paid_gap_vs_local_stm ?? '',
      Local_Import_ล่าสุด: row.latest_local_import_at || '',
    }))), 'Year Summary');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.pgroup_yearly), 'PGROUP');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.pivot_rows), 'Pivot');
    XLSX.writeFile(workbook, `ppfs_benchmark_${report.hcode}_${report.metric}.xlsx`);
  };

  return (
    <div style={{ padding: '20px 16px', maxWidth: 1480, margin: '0 auto' }}>
      <section className="workflow-hero" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title workflow-hero__title">📈 เทียบยอด PPFS NHSO</h1>
          <p className="page-subtitle">
            ดึงรายงาน PP Fee Schedule จาก สปสช. แล้วเทียบกับยอด STM ที่นำเข้าในระบบ เพื่อหา gap ของเงินจ่าย รายการเด่น และกลุ่มที่ควรตามต่อ
          </p>
        </div>
        <div className="workflow-hero__meta">
          <span className="workflow-badge">HCODE {report?.hcode || hcode}</span>
          <span className="workflow-badge">{report?.hospital.hospital_name || 'โรงพยาบาลโคกศรีสุพรรณ'}</span>
          <span className="workflow-badge">ดึงล่าสุด {formatDateTime(report?.fetched_at)}</span>
        </div>
      </section>

      <Panel style={{ marginBottom: 16 }}>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) minmax(180px, 260px) minmax(180px, 1fr) auto auto', gap: 12, alignItems: 'end' }}>
          <div className="form-group">
            <label className="form-label">HCODE</label>
            <input className="form-control" value={hcode} onChange={(event) => setHcode(event.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Metric จาก NHSO</label>
            <select className="form-control" value={metric} onChange={(event) => setMetric(event.target.value as PpfsMetric)}>
              {metricOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">ค้นหาใน pivot</label>
            <input className="form-control" placeholder="เช่น ANC, HCV, ซิฟิลิส, วัคซีน..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => void loadData()} disabled={loading}>
            {loading ? 'กำลังโหลด...' : 'Refresh'}
          </button>
          <button className="btn btn-secondary" onClick={handleExport} disabled={!report}>
            ส่งออก Excel
          </button>
        </div>
        {error && <div className="alert alert-error" style={{ margin: '0 16px 16px' }}>{error}</div>}
        {report?.local_note && (
          <div style={{ margin: '0 16px 16px', padding: '10px 12px', border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: 8, fontSize: '0.82rem' }}>
            {report.local_note}
          </div>
        )}
      </Panel>

      {report && (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
            {report.year_summary.map((row) => (
              <SummaryCard
                key={row.fiscal_year}
                label={`ปี ${row.fiscal_year} จาก NHSO`}
                value={metric === 'SUM_PAID' ? `${formatMoney(row.nhso_paid)} บาท` : formatMetricValue(row.nhso_metric_value, metric)}
                sub={`${formatCount(row.nhso_people)} คน / ${formatCount(row.nhso_visits)} ครั้ง`}
                tone={row.fiscal_year === '2569' ? 'green' : row.fiscal_year === '2568' ? 'amber' : 'blue'}
              />
            ))}
            <SummaryCard
              label="รายการ pivot"
              value={formatCount(report.pivot_rows.length)}
              sub={`${formatCount(filteredPivot.length)} รายการหลังค้นหา`}
              tone="slate"
            />
          </section>

          <Panel style={{ marginBottom: 16 }}>
            <PanelHeader
              title="เทียบรายปี: NHSO PPFS กับ STM ในระบบเรา"
              subtitle="ใช้ดู gap เบื้องต้น ก่อนผูก mapping PPFS ราย PGROUP เข้ากับ visit local"
              right={<span className="badge badge-info">ปีงบประมาณ 2567-2569</span>}
            />
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table long-id-table">
                <thead>
                  <tr>
                    <th>ปีงบประมาณ</th>
                    <th className="text-right">NHSO คน</th>
                    <th className="text-right">NHSO ครั้ง</th>
                    <th className="text-right">NHSO บาท</th>
                    <th className="text-right">ของเรา STM cases</th>
                    <th className="text-right">ของเรา STM รับ</th>
                    <th className="text-right">Gap NHSO - STM รับ</th>
                    <th>นำเข้า STM ล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {report.year_summary.map((row) => (
                    <tr key={row.fiscal_year}>
                      <td><strong>{row.fiscal_year}</strong></td>
                      <td className="text-right">{formatCount(row.nhso_people)}</td>
                      <td className="text-right">{formatCount(row.nhso_visits)}</td>
                      <td className="text-right">{formatMoney(row.nhso_paid)}</td>
                      <td className="text-right">{formatCount(row.local_stm_cases)}</td>
                      <td className="text-right">{formatMoney(row.local_stm_paid_amount)}</td>
                      <td className="text-right" style={{ color: toNumber(row.paid_gap_vs_local_stm) > 0 ? '#b45309' : '#047857', fontWeight: 800 }}>
                        {row.paid_gap_vs_local_stm == null ? '-' : formatMoney(row.paid_gap_vs_local_stm)}
                      </td>
                      <td>{formatDateTime(row.latest_local_import_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(320px, 0.65fr)', gap: 16, marginBottom: 16 }}>
            <Panel>
              <PanelHeader title={`PGROUP รายปี (${metricShort})`} subtitle="กราฟนี้เปลี่ยนตาม metric ที่เลือกจากรายงาน NHSO" />
              <div style={{ padding: 14, display: 'grid', gap: 11 }}>
                {report.pgroup_yearly.map((row) => (
                  <div key={row.pgroup} style={{ display: 'grid', gridTemplateColumns: '110px minmax(220px, 1fr)', gap: 12, alignItems: 'center' }}>
                    <div style={{ fontWeight: 850, color: '#0f172a' }}>{row.pgroup}</div>
                    <MiniBars row={row} metric={metric} />
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="สัดส่วน ACCESS_GROUP" subtitle="Top 10 จาก NHSO" />
              <div style={{ padding: 14, display: 'grid', gap: 10 }}>
                {topAccess.map((row, index) => {
                  const max = Math.max(1, topAccess[0]?.value || 1);
                  return (
                    <div key={row.access_group}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.78rem' }}>
                        <span style={{ fontWeight: 750, color: '#334155' }}>{index + 1}. {row.access_group}</span>
                        <span style={{ fontWeight: 850, color: '#0f172a' }}>{formatMetricValue(row.value, metric)}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 999, background: '#e2e8f0', marginTop: 5 }}>
                        <div style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, height: '100%', borderRadius: 999, background: '#0ea5e9' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
            <Panel>
              <PanelHeader title="รายการที่ได้เงินสูงสุด ปี 2569" subtitle="ช่วยชี้ว่าจะตามรายการไหนก่อน" />
              <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                <table className="data-table long-id-table">
                  <thead>
                    <tr>
                      <th>กลุ่ม</th>
                      <th>รายการ</th>
                      <th className="text-right">คน</th>
                      <th className="text-right">ครั้ง</th>
                      <th className="text-right">บาท</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.top_items_2569.map((row) => (
                      <tr key={`${row.group_name}:${row.item_name}`}>
                        <td>{row.group_name}</td>
                        <td>{row.item_name}</td>
                        <td className="text-right">{formatCount(row.pid_2569)}</td>
                        <td className="text-right">{formatCount(row.visit_2569)}</td>
                        <td className="text-right" style={{ fontWeight: 850 }}>{formatMoney(row.paid_2569)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="แนวโน้มรายเดือนที่ควรตาม" subtitle="Top 10 ACCESS_GROUP ตามยอดรวม" />
              <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                <table className="data-table long-id-table">
                  <thead>
                    <tr>
                      <th>ACCESS_GROUP</th>
                      <th className="text-right">รวม</th>
                      <th className="text-right">เดือนล่าสุด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMonthlySeries.map((row) => (
                      <tr key={row.access_group}>
                        <td>{row.access_group}</td>
                        <td className="text-right">{formatMetricValue(row.total, metric)}</td>
                        <td className="text-right">{formatMetricValue(row.latest_value, metric)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              title="Pivot รายการ PPFS"
              subtitle="ตารางเปรียบเทียบ คน / ครั้ง / บาท ปี 2567-2569 จากรายงาน NHSO"
              right={<span className="badge badge-info">{formatCount(filteredPivot.length)} รายการ</span>}
            />
            <div style={{ overflowX: 'auto', maxHeight: 580 }}>
              <table className="data-table long-id-table">
                <thead>
                  <tr>
                    <th>กลุ่มรายการ</th>
                    <th>รายการ</th>
                    <th className="text-right">คน 67</th>
                    <th className="text-right">ครั้ง 67</th>
                    <th className="text-right">บาท 67</th>
                    <th className="text-right">คน 68</th>
                    <th className="text-right">ครั้ง 68</th>
                    <th className="text-right">บาท 68</th>
                    <th className="text-right">คน 69</th>
                    <th className="text-right">ครั้ง 69</th>
                    <th className="text-right">บาท 69</th>
                    <th className="text-right">Metric 69</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPivot.map((row) => (
                    <tr key={`${row.group_name}:${row.item_name}`}>
                      <td style={{ minWidth: 180 }}>{row.group_name}</td>
                      <td style={{ minWidth: 280 }}>{row.item_name}</td>
                      <td className="text-right">{formatCount(row.pid_2567)}</td>
                      <td className="text-right">{formatCount(row.visit_2567)}</td>
                      <td className="text-right">{formatMoney(row.paid_2567)}</td>
                      <td className="text-right">{formatCount(row.pid_2568)}</td>
                      <td className="text-right">{formatCount(row.visit_2568)}</td>
                      <td className="text-right">{formatMoney(row.paid_2568)}</td>
                      <td className="text-right">{formatCount(row.pid_2569)}</td>
                      <td className="text-right">{formatCount(row.visit_2569)}</td>
                      <td className="text-right" style={{ fontWeight: 850 }}>{formatMoney(row.paid_2569)}</td>
                      <td className="text-right" style={{ color: '#1d4ed8', fontWeight: 850 }}>
                        {formatMetricValue(row[metricField(metric, '2569')], metric)}
                      </td>
                    </tr>
                  ))}
                  {filteredPivot.length === 0 && (
                    <tr><td colSpan={12} className="empty-cell">ไม่พบรายการตามคำค้นหา</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
};

export default PpfsBenchmarkPage;
