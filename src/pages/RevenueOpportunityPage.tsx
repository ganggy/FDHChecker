import { useEffect, useMemo, useRef, useState } from 'react';

type MonitorStatus = 'data_error' | 'ready' | 'submitted' | 'paid';
type CategoryKey = 'palliative' | 'instrument' | 'op_refer' | 'ipd_cscd';

interface MonitorItem {
  id: string;
  category: CategoryKey;
  categoryLabel: string;
  serviceDate: string;
  visitCode: string;
  hn: string;
  patientName: string;
  fund: string;
  evidence: string[];
  missing: string[];
  instruction: string;
  status: MonitorStatus;
  statusLabel: string;
  chargeAmount: number | null;
  claimAmount: number | null;
  paidAmount: number | null;
}

interface MonitorData {
  generatedAt: string;
  startDate: string;
  endDate: string;
  conclusion: {
    verdict: 'insufficient_evidence' | 'risk_detected' | 'no_risk_detected';
    label: string;
    explanation: string;
    limitations: string[];
  };
  summary: {
    totalCandidates: number;
    dataErrors: number;
    awaitingClaim: number;
    submitted: number;
    paid: number;
    knownCharges: number;
    knownClaims: number;
    knownPaid: number;
  };
  categories: Array<{
    key: CategoryKey;
    label: string;
    description: string;
    total: number;
    dataErrors: number;
    ready: number;
    submitted: number;
    paid: number;
    knownCharges: number;
    knownClaims: number;
    knownPaid: number;
  }>;
  alerts: Array<{ severity: 'danger' | 'warning' | 'info'; title: string; message: string; count: number }>;
  items: MonitorItem[];
}

const dateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const previousMonthRange = () => {
  const now = new Date();
  return {
    start: dateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: dateInput(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
};

const money = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ฿`;

const STATUS_META: Record<MonitorStatus, { icon: string; label: string }> = {
  data_error: { icon: '🔴', label: 'ต้องแก้ข้อมูล' },
  ready: { icon: '🟠', label: 'พร้อมส่ง/ยังไม่พบผล' },
  submitted: { icon: '🔵', label: 'ส่งแล้วรอผล' },
  paid: { icon: '🟢', label: 'พบยอดรับ' },
};

export const RevenueOpportunityPage = () => {
  const initialRange = useMemo(previousMonthRange, []);
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | CategoryKey>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | MonitorStatus>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`/api/hosxp/revenue-opportunity-monitor?${params.toString()}`);
      const payload = await response.json() as { success?: boolean; data?: MonitorData; error?: string };
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || 'โหลดข้อมูลไม่สำเร็จ');
      setData(payload.data);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'โหลดข้อมูลไม่สำเร็จ');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadData();
    // Initial load intentionally follows the default previous-month range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.items || []).filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!query) return true;
      return [item.visitCode, item.hn, item.patientName, item.fund, ...item.evidence, ...item.missing]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [categoryFilter, data?.items, search, statusFilter]);

  return (
    <div className="revenue-monitor-page">
      <section className="revenue-monitor-hero">
        <div>
          <div className="revenue-monitor-kicker">Evidence-based revenue assurance</div>
          <h1>มอนิเตอร์โอกาสรายได้และคุณภาพข้อมูล</h1>
          <p>พิสูจน์จากหลักฐานราย Visit: บริการ → ข้อมูลครบ → ส่งเคลม → ผลตอบกลับ → เงินรับจริง</p>
        </div>
        <div className="revenue-monitor-datebar">
          <label>ตั้งแต่<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>ถึง<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <button className="btn btn-primary" onClick={() => void loadData()} disabled={loading || !startDate || !endDate}>
            {loading ? 'กำลังวิเคราะห์…' : 'วิเคราะห์ข้อมูล'}
          </button>
        </div>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}

      {data && (
        <>
          <section className={`revenue-verdict revenue-verdict--${data.conclusion.verdict}`}>
            <div className="revenue-verdict-icon">{data.conclusion.verdict === 'risk_detected' ? '⚠️' : '🔎'}</div>
            <div>
              <div className="revenue-verdict-label">ผลวิเคราะห์ข้อความจากภาพ</div>
              <h2>{data.conclusion.label}</h2>
              <p>{data.conclusion.explanation}</p>
              <details>
                <summary>เหตุผลที่ยังใช้ยอดรวมตัดสินไม่ได้</summary>
                <ul>{data.conclusion.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
              </details>
            </div>
          </section>

          <section className="revenue-summary-grid" aria-label="สรุปสถานะ">
            <article><span>ผู้รับบริการเข้าข่าย</span><strong>{data.summary.totalCandidates.toLocaleString('th-TH')}</strong><small>Visit/Admission ที่พบสัญญาณ</small></article>
            <article className="is-danger"><span>ต้องตรวจและแก้ข้อมูล</span><strong>{data.summary.dataErrors.toLocaleString('th-TH')}</strong><small>ยังไม่ควรส่งจนตรวจหลักฐาน</small></article>
            <article className="is-warning"><span>พร้อมส่ง/ยังไม่พบผล</span><strong>{data.summary.awaitingClaim.toLocaleString('th-TH')}</strong><small>คิวงานที่ต้องมีเจ้าของ</small></article>
            <article className="is-info"><span>ส่งแล้วรอผล</span><strong>{data.summary.submitted.toLocaleString('th-TH')}</strong><small>ติดตาม REP/STM/INV</small></article>
            <article className="is-success"><span>พบยอดรับ</span><strong>{data.summary.paid.toLocaleString('th-TH')}</strong><small>{money(data.summary.knownPaid)}</small></article>
          </section>

          <section className="revenue-money-strip">
            <div><span>ยอดค่าบริการที่ทราบ</span><strong>{money(data.summary.knownCharges)}</strong></div>
            <div><span>ยอดเคลม/ชดเชยที่ทราบ</span><strong>{money(data.summary.knownClaims)}</strong></div>
            <div><span>ยอดรับจริงที่ทราบ</span><strong>{money(data.summary.knownPaid)}</strong></div>
            <p>ยอด 3 ช่องนี้ห้ามนำมาแทนกัน ช่อง “—” หมายถึงยังไม่มีหลักฐาน ไม่ใช่ศูนย์บาท</p>
          </section>

          {data.alerts.length > 0 && (
            <section className="revenue-alert-grid">
              {data.alerts.map((alert) => (
                <button
                  type="button"
                  className={`revenue-alert revenue-alert--${alert.severity}`}
                  key={alert.title}
                  onClick={() => setStatusFilter(alert.severity === 'danger' ? 'data_error' : alert.severity === 'warning' ? 'ready' : 'submitted')}
                >
                  <strong>{alert.title}<b>{alert.count}</b></strong>
                  <span>{alert.message}</span>
                </button>
              ))}
            </section>
          )}

          <section>
            <div className="revenue-section-heading">
              <div><span>เจาะตามประเด็นในข้อความ</span><h2>กลุ่มบริการที่ต้องพิสูจน์</h2></div>
              <small>กดการ์ดเพื่อกรองรายการด้านล่าง</small>
            </div>
            <div className="revenue-category-grid">
              {data.categories.map((category) => (
                <button
                  type="button"
                  key={category.key}
                  className={`revenue-category-card ${categoryFilter === category.key ? 'is-active' : ''}`}
                  onClick={() => setCategoryFilter(categoryFilter === category.key ? 'all' : category.key)}
                >
                  <div className="revenue-category-title"><strong>{category.label}</strong><b>{category.total}</b></div>
                  <p>{category.description}</p>
                  <div className="revenue-category-statuses">
                    <span className="danger">แก้ {category.dataErrors}</span>
                    <span className="warning">พร้อม {category.ready}</span>
                    <span className="info">รอผล {category.submitted}</span>
                    <span className="success">รับแล้ว {category.paid}</span>
                  </div>
                  <div className="revenue-category-amount">ยอดรับที่พบ <strong>{money(category.knownPaid)}</strong></div>
                </button>
              ))}
            </div>
          </section>

          <section className="revenue-worklist">
            <div className="revenue-section-heading">
              <div><span>Actionable worklist</span><h2>รายการตรวจสอบและวิธีแก้</h2></div>
              <small>{visibleItems.length.toLocaleString('th-TH')} รายการ</small>
            </div>
            <div className="revenue-filters">
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'all' | CategoryKey)}>
                <option value="all">ทุกกลุ่ม</option>
                {data.categories.map((category) => <option value={category.key} key={category.key}>{category.label}</option>)}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | MonitorStatus)}>
                <option value="all">ทุกสถานะ</option>
                {Object.entries(STATUS_META).map(([key, meta]) => <option value={key} key={key}>{meta.label}</option>)}
              </select>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา VN/AN, HN, ชื่อ, สิทธิ หรือปัญหา" />
              {(categoryFilter !== 'all' || statusFilter !== 'all' || search) && (
                <button className="btn btn-outline" onClick={() => { setCategoryFilter('all'); setStatusFilter('all'); setSearch(''); }}>ล้างตัวกรอง</button>
              )}
            </div>

            <div className="revenue-table-wrap">
              <table className="revenue-table">
                <thead><tr><th>สถานะ</th><th>วันที่ / VN-AN</th><th>ผู้รับบริการ / สิทธิ</th><th>หลักฐานที่พบ</th><th>สิ่งที่ขาด</th><th>ค่าใช้จ่าย / เคลม / รับ</th><th>สอนวิธีแก้</th></tr></thead>
                <tbody>
                  {visibleItems.map((item) => {
                    const status = STATUS_META[item.status];
                    const expanded = expandedId === item.id;
                    return (
                      <tr key={item.id} className={`revenue-row--${item.status}`}>
                        <td><span className={`revenue-status revenue-status--${item.status}`}>{status.icon} {status.label}</span><small>{item.categoryLabel}</small></td>
                        <td><strong>{item.serviceDate || '—'}</strong><span>{item.visitCode || '—'}</span><small>HN {item.hn || '—'}</small></td>
                        <td><strong>{item.patientName || '—'}</strong><span>{item.fund || 'ไม่พบสิทธิ'}</span></td>
                        <td>{item.evidence.length ? item.evidence.map((evidence) => <span className="revenue-evidence" key={evidence}>{evidence}</span>) : <span className="revenue-muted">ยังไม่พบ</span>}</td>
                        <td>{item.missing.length ? <ul>{item.missing.map((missing) => <li key={missing}>{missing}</li>)}</ul> : <span className="revenue-complete">✓ กฎพื้นฐานครบ</span>}</td>
                        <td className="revenue-amount-cell">
                          <span>Charge <b>{money(item.chargeAmount)}</b></span>
                          <span>Claim <b>{money(item.claimAmount)}</b></span>
                          <span>Paid <b>{money(item.paidAmount)}</b></span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-outline" onClick={() => setExpandedId(expanded ? null : item.id)}>{expanded ? 'ซ่อน' : 'ดูวิธีทำ'}</button>
                          {expanded && <div className="revenue-instruction"><strong>ทำอย่างไรให้ถูกต้อง</strong><p>{item.instruction}</p><em>ยืนยันกับเวชระเบียนและเกณฑ์กองทุนฉบับที่ใช้อยู่ก่อนบันทึกทุกครั้ง</em></div>}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleItems.length === 0 && <tr><td colSpan={7} className="revenue-empty">ไม่พบรายการตามตัวกรองนี้</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="revenue-next-step">
            <div><span>ขั้นต่อยอดแจ้งเตือน</span><h2>แจ้งเตือนตามเหตุการณ์ ไม่แจ้งจากยอดต่ำเพียงอย่างเดียว</h2></div>
            <ol>
              <li><strong>ทันที:</strong> ข้อมูลจำเป็นขาดหรือยอดเป็นศูนย์ → แจ้งผู้บันทึกต้นทาง</li>
              <li><strong>ก่อนตัดรอบ:</strong> ข้อมูลครบแต่ยังไม่ส่ง → แจ้งทีมเรียกเก็บ</li>
              <li><strong>หลังส่ง:</strong> REP มี C/Deny หรือเกิน SLA แล้วยังไม่มี STM → แจ้งผู้รับผิดชอบกองทุน</li>
              <li><strong>ปิดวงจร:</strong> เทียบ Charge / Claim / Paid และเก็บสาเหตุเพื่อสอนจากข้อผิดพลาดจริง</li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
};
