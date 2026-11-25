import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import './MisHosComparePage.css';

interface MisMenuGroup {
  id: string;
  label: string;
  order: number;
}

interface MisPageDefinition {
  key: string;
  groupId: string;
  label: string;
  misRoute: string;
  kind: 'overview' | 'simplestudio';
  stId?: string;
  supportsThreeWay?: boolean;
}

interface MisHospitalProfile {
  hcode: string;
  hname: string;
  provinceId: string;
  provinceName: string;
  nhsoZone: string;
}

interface ThreeWayBudgetRow {
  code: string;
  fundName: string;
  misAmount: number;
  misPrevAmount: number;
  smtAmount: number;
  smtNetAmount: number;
  smtRecordCount: number;
  stmAmount: number;
  stmCount: number;
  diffMisSmt: number;
  diffMisStm: number;
  coverageSmtPct: number | null;
  coverageStmPct: number | null;
  note?: string;
}

interface MonthlyCompareRow {
  mm: string;
  label: string;
  ym: string;
  withinCutoff: boolean;
  misAmount: number;
  misOpAmount: number;
  misIpAmount: number;
  misPrevAmount: number;
  smtAmount: number;
  smtNetAmount: number;
  stmAmount: number;
  stmOpAmount: number;
  stmIpAmount: number;
  stmCount: number;
  misCases: number;
  misAdjRw: number;
  stmCases: number;
  stmAdjRw: number;
  diffMisSmt: number;
  diffMisStm: number;
}

interface SubfundCompareRow {
  code: string;
  fundGroup: string;
  name: string;
  misVisits: number;
  misAmount: number;
  misStmAmount: number;
  misPrevAmount: number;
  stmVisits: number;
  stmAmount: number;
  diffMisStm: number;
  coveragePct: number | null;
  status: string;
}

interface StmFileSummary {
  filename: string;
  statementNo: string;
  department: string;
  maininscl: string;
  rowsCount: number;
  sumAmount: number;
  sumPaid: number;
  minDate: string;
  maxDate: string;
}

interface OverviewPayload {
  profile: MisHospitalProfile;
  budgetYear: string;
  lastMonth: string;
  matchCutoff: boolean;
  dateRange: { startDate: string; endDate: string; cutoffYm: string };
  cache: { fetchedAt: string; fromCache: boolean; stale: boolean; warning?: string };
  kpis: {
    budget: {
      misAmount: number;
      smtAmount: number;
      smtNetAmount: number;
      stmAmount: number;
      diffMisSmt: number;
      diffMisStm: number;
      coverageSmtPct: number | null;
      coverageStmPct: number | null;
    };
    claim: {
      misAmount: number;
      misVisits: number;
      stmUcAmount: number;
      stmAllAmount: number;
      diffMisStmUc: number;
      coveragePct: number | null;
    };
    ip: {
      misCases: number;
      misAdjRw: number;
      misCmi: number;
      stmCases: number;
      stmAdjRw: number;
      stmCmi: number;
    };
    dmis: {
      misAmount: number;
      misVisits: number;
      stmAmount: number;
      diffMisStm: number;
      coveragePct: number | null;
    };
    instrument: {
      misAmount: number;
      misQty: number;
      stmAmount: number;
      diffMisStm: number;
      coveragePct: number | null;
    };
  };
  budgetThreeWay: ThreeWayBudgetRow[];
  outsideNhsoStm: { ofcAmount: number; ofcCount: number; sssAmount: number; sssCount: number };
  budgetMonthly: MonthlyCompareRow[];
  claimMonthly: MonthlyCompareRow[];
  ipMonthly: MonthlyCompareRow[];
  subfundComparison: SubfundCompareRow[];
  dmisComparison: SubfundCompareRow[];
  moph: { total: Record<string, unknown>; items: Array<Record<string, unknown>> };
  ktp: { total: Record<string, unknown>; items: Array<Record<string, unknown>> };
  instrument: { topItems: Array<Record<string, unknown>>; totalMis: number; totalStm: number };
  stmFiles: StmFileSummary[];
}

interface SimpleStudioCard {
  ssid: string;
  reportName: string;
  chartType: string;
  remark?: string;
  columns: string[];
  rows: Record<string, unknown>[];
  compareMode: 'monthly' | 'subfund' | 'summary' | 'none';
  compareRows: Array<{
    rowKey: string;
    label: string;
    misAmount: number;
    fdhAmount: number;
    smtAmount?: number;
    diff: number;
    coveragePct: number | null;
    status: string;
    raw: Record<string, unknown>;
  }>;
  misTotal: number;
}

interface SubpagePayload {
  kind: 'simplestudio';
  profile: MisHospitalProfile;
  page: MisPageDefinition;
  templateName: string;
  budgetYear: string;
  dateRange: { startDate: string; endDate: string; cutoffYm: string };
  cache: { fetchedAt: string; fromCache: boolean; stale: boolean; warning?: string };
  summary: {
    misAmount: number;
    smtAmount: number | null;
    stmAmount: number;
    stmCount: number;
    stmAdjRw: number;
    diffMisStm: number;
    coveragePct: number | null;
    sliceNote: string;
    allStmAmount: number;
  };
  cards: SimpleStudioCard[];
  stmBreakdown: Array<{ code: string; fundGroup: string; name: string; visits: number; amount: number }>;
  stmFiles: StmFileSummary[];
}

const fmtMoney = (n: unknown) => {
  const num = Number(n ?? 0);
  return Number.isFinite(num)
    ? num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
};

const fmtInt = (n: unknown) => {
  const num = Number(n ?? 0);
  return Number.isFinite(num) ? Math.round(num).toLocaleString('th-TH') : '0';
};

const fmtCell = (val: unknown) => {
  if (val == null || val === '') return '-';
  const s = String(val).trim();
  if (/^-?\d+(\.\d+)?$/.test(s) && s.length <= 15 && !/^0\d+$/.test(s)) {
    const n = Number(s);
    if (s.includes('.')) return n.toLocaleString('th-TH', { maximumFractionDigits: 4 });
    return n.toLocaleString('th-TH');
  }
  return s;
};

const statusPillClass = (status: string) => {
  if (status === 'ตรงกัน') return 'mis-status-pill mis-status-ok';
  if (status === 'ยังไม่มี STM') return 'mis-status-pill mis-status-miss';
  if (status === 'พบเฉพาะใน STM') return 'mis-status-pill mis-status-info';
  return 'mis-status-pill mis-status-warn';
};

export const MisHosComparePage: React.FC = () => {
  const [profile, setProfile] = useState<MisHospitalProfile | null>(null);
  const [years, setYears] = useState<string[]>(['2570', '2569', '2568', '2567']);
  const [groups, setGroups] = useState<MisMenuGroup[]>([]);
  const [pages, setPages] = useState<MisPageDefinition[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    overview: true,
    budget: true,
    eclaim: true,
    op: false,
    ip: false,
    outside: false,
    central: false,
    pp: false,
    policy: false,
    dmis: true,
    other: false,
  });

  const [activePageKey, setActivePageKey] = useState<string>('overview');
  const [budgetYear, setBudgetYear] = useState<string>('2569');
  const [matchCutoff, setMatchCutoff] = useState<boolean>(true);
  const [sidebarSearch, setSidebarSearch] = useState<string>('');
  const [subfundSearch, setSubfundSearch] = useState<string>('');
  const [subfundStatusFilter, setSubfundStatusFilter] = useState<string>('all');
  const [rawCardView, setRawCardView] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [overviewData, setOverviewData] = useState<OverviewPayload | null>(null);
  const [subpageData, setSubpageData] = useState<SubpagePayload | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/mis-compare/catalog')
      .then((r) => r.json())
      .then((json) => {
        if (!alive || !json?.success) return;
        const d = json.data;
        if (d.profile) setProfile(d.profile);
        if (Array.isArray(d.years) && d.years.length > 0) {
          setYears(d.years);
          setBudgetYear(d.years.includes('2569') ? '2569' : d.years[0]);
        }
        if (Array.isArray(d.groups)) setGroups(d.groups);
        if (Array.isArray(d.pages)) setPages(d.pages);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const fetchActiveData = useCallback(
    async (pageKey: string, year: string, cutoff: boolean, forceRefresh = false) => {
      if (forceRefresh) setSyncing(true);
      else setLoading(true);
      setError('');
      try {
        const qs = `budgetYear=${encodeURIComponent(year)}&matchCutoff=${cutoff ? '1' : '0'}&refresh=${forceRefresh ? '1' : '0'}`;
        const url =
          pageKey === 'overview'
            ? `/api/mis-compare/overview?${qs}`
            : `/api/mis-compare/page/${encodeURIComponent(pageKey)}?${qs}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'ไม่สามารถโหลดข้อมูลเปรียบเทียบได้');
        }
        if (pageKey === 'overview') {
          setOverviewData(json.data);
          setSubpageData(null);
        } else if (json.data?.kind === 'overview') {
          setOverviewData(json.data.overview);
          setSubpageData(null);
        } else {
          setSubpageData(json.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchActiveData(activePageKey, budgetYear, matchCutoff, false);
  }, [activePageKey, budgetYear, matchCutoff, fetchActiveData]);

  const handleSelectPage = (page: MisPageDefinition) => {
    setActivePageKey(page.key);
    setExpandedGroups((prev) => ({ ...prev, [page.groupId]: true }));
  };

  const filteredSubfunds = useMemo(() => {
    const list = overviewData?.subfundComparison || [];
    const q = subfundSearch.trim().toLowerCase();
    return list.filter((row) => {
      if (subfundStatusFilter !== 'all' && row.status !== subfundStatusFilter) return false;
      if (!q) return true;
      return `${row.code} ${row.fundGroup} ${row.name}`.toLowerCase().includes(q);
    });
  }, [overviewData, subfundSearch, subfundStatusFilter]);

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    if (activePageKey === 'overview' && overviewData) {
      const wsBudget = XLSX.utils.json_to_sheet(
        overviewData.budgetThreeWay.map((r) => ({
          รหัสกองทุน: r.code,
          กองทุนหลัก: r.fundName,
          'ยอด MIS HOS (บาท)': r.misAmount,
          'ยอด SMT โอนตั้ง (บาท)': r.smtAmount,
          'ยอด SMT โอนสุทธิ (บาท)': r.smtNetAmount,
          'ยอด STM ในระบบ (บาท)': r.stmAmount,
          'ส่วนต่าง MIS-SMT': r.diffMisSmt,
          'ส่วนต่าง MIS-STM': r.diffMisStm,
          'ครอบคลุม SMT (%)': r.coverageSmtPct ?? '',
          'ครอบคลุม STM (%)': r.coverageStmPct ?? '',
          หมายเหตุ: r.note || '',
        }))
      );
      XLSX.utils.book_append_sheet(wb, wsBudget, 'เงินโอน_3ฝั่ง');

      const wsSub = XLSX.utils.json_to_sheet(
        filteredSubfunds.map((s) => ({
          รหัส: s.code,
          กลุ่ม: s.fundGroup,
          รายการกองทุนย่อย: s.name,
          'ครั้ง MIS': s.misVisits,
          'ยอด MIS (บาท)': s.misAmount,
          'ครั้ง STM': s.stmVisits,
          'ยอด STM ในระบบ (บาท)': s.stmAmount,
          'ส่วนต่าง MIS-STM': s.diffMisStm,
          'ครอบคลุม (%)': s.coveragePct ?? '',
          สถานะ: s.status,
        }))
      );
      XLSX.utils.book_append_sheet(wb, wsSub, 'กองทุนย่อย');

      const wsFiles = XLSX.utils.json_to_sheet(overviewData.stmFiles);
      XLSX.utils.book_append_sheet(wb, wsFiles, 'ไฟล์_STM');
      XLSX.writeFile(wb, `MIS_Compare_Overview_${overviewData.profile.hcode}_${overviewData.budgetYear}.xlsx`);
      return;
    }

    if (subpageData) {
      subpageData.cards.forEach((c, idx) => {
        const sheetRows =
          c.compareRows.length > 0
            ? c.compareRows.map((cr) => ({
                รายการ: cr.label,
                'ยอด MIS (บาท)': cr.misAmount,
                ...(cr.smtAmount != null ? { 'ยอด SMT (บาท)': cr.smtAmount } : {}),
                'ยอด STM ในระบบ (บาท)': cr.fdhAmount,
                ส่วนต่าง: cr.diff,
                'ครอบคลุม (%)': cr.coveragePct ?? '',
                สถานะ: cr.status,
              }))
            : c.rows;
        if (sheetRows.length > 0) {
          const ws = XLSX.utils.json_to_sheet(sheetRows);
          XLSX.utils.book_append_sheet(wb, ws, `Card_${idx + 1}_${c.ssid}`.slice(0, 31));
        }
      });
      if (subpageData.stmBreakdown.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(subpageData.stmBreakdown), 'STM_Breakdown');
      }
      XLSX.writeFile(wb, `MIS_Compare_${subpageData.page.key}_${subpageData.budgetYear}.xlsx`);
    }
  };

  const activeCache = activePageKey === 'overview' ? overviewData?.cache : subpageData?.cache;
  const activeProfile = overviewData?.profile || subpageData?.profile || profile;

  return (
    <div className="mis-compare-shell">
      <div className="mis-topbar">
        <div>
          <span className="mis-badge-pill">
            📊 เทียบ MIS HOS (สปสช.) vs STM / SMT ใน FDHChecker
          </span>
          <h1 className="mis-title">
            เปรียบเทียบข้อมูลรับเงิน-ชดเชยทุกหมวดตามรูปแบบ MIS HOS
            {activeProfile && (
              <span style={{ fontSize: '0.95rem', fontWeight: 500, color: '#475569', marginLeft: 8 }}>
                ({activeProfile.hcode} {activeProfile.hname}
                {activeProfile.provinceName ? ` · จ.${activeProfile.provinceName}` : ''}
                {activeProfile.nhsoZone ? ` · เขต ${activeProfile.nhsoZone}` : ''})
              </span>
            )}
          </h1>
          <p className="mis-subtitle">
            ดึงโครงสร้างและตัวเลขจริงจาก <strong>mishos.nhso.go.th</strong> เปรียบเทียบกับข้อมูล Statement (STM) และเงินโอน SMT ที่นำเข้าในระบบ FDHChecker ครบทั้งหน้าภาพรวมและทุกหมวดเมนูย่อย
          </p>
        </div>

        <div className="mis-controls">
          <select
            className="mis-select"
            value={budgetYear}
            onChange={(e) => setBudgetYear(e.target.value)}
            aria-label="ปีงบประมาณ"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                ปีงบประมาณ {y}
              </option>
            ))}
          </select>

          <label className="mis-cutoff-toggle" title="จำกัดช่วง STM/SMT ให้ตรงกับเดือนล่าสุดของข้อมูลใน MIS HOS">
            <input
              type="checkbox"
              checked={matchCutoff}
              onChange={(e) => setMatchCutoff(e.target.checked)}
            />
            <span>ตัดรอบเดือนล่าสุด MIS</span>
          </label>

          <button
            type="button"
            className="mis-btn mis-btn-primary"
            disabled={loading || syncing}
            onClick={() => void fetchActiveData(activePageKey, budgetYear, matchCutoff, true)}
          >
            {syncing ? '⏳ กำลังซิงก์...' : '🔄 ซิงก์จาก MIS HOS'}
          </button>

          <button
            type="button"
            className="mis-btn mis-btn-emerald"
            disabled={!overviewData && !subpageData}
            onClick={handleExportExcel}
          >
            📥 ส่งออก Excel
          </button>
        </div>
      </div>

      <div className="mis-layout">
        {/* Sidebar mimicking all 10 MIS HOS categories */}
        <aside className="mis-sidebar" aria-label="เมนู MIS HOS">
          <input
            type="text"
            className="mis-sidebar-search"
            placeholder="🔍 ค้นหาหมวด/รายงาน MIS..."
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
          />

          {groups
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((grp) => {
              const q = sidebarSearch.trim().toLowerCase();
              const grpPages = pages.filter(
                (p) =>
                  p.groupId === grp.id &&
                  (!q || p.label.toLowerCase().includes(q) || grp.label.toLowerCase().includes(q))
              );
              if (grpPages.length === 0) return null;

              if (grp.id === 'overview') {
                const ov = grpPages[0];
                return (
                  <div key={grp.id} className="mis-sidebar-group">
                    <button
                      type="button"
                      className={`mis-page-btn ${activePageKey === ov.key ? 'active' : ''}`}
                      onClick={() => handleSelectPage(ov)}
                    >
                      🏠 {ov.label}
                    </button>
                  </div>
                );
              }

              const isOpen = q ? true : Boolean(expandedGroups[grp.id]);
              return (
                <div key={grp.id} className="mis-sidebar-group">
                  <button
                    type="button"
                    className="mis-group-btn"
                    onClick={() =>
                      setExpandedGroups((prev) => ({ ...prev, [grp.id]: !isOpen }))
                    }
                  >
                    <span>{grp.label}</span>
                    <span>{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && (
                    <div className="mis-page-list">
                      {grpPages.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className={`mis-page-btn ${activePageKey === p.key ? 'active' : ''}`}
                          onClick={() => handleSelectPage(p)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </aside>

        {/* Main Content */}
        <main className="mis-main">
          {activeCache?.warning && (
            <div className="mis-alert mis-alert-warn">⚠️ {activeCache.warning}</div>
          )}
          {error && <div className="mis-alert mis-alert-err">❌ {error}</div>}
          {activeCache && (
            <div className="mis-alert mis-alert-info" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span>
                ช่วงเทียบข้อมูล: <strong>{(overviewData || subpageData)?.dateRange.startDate}</strong> ถึง{' '}
                <strong>{(overviewData || subpageData)?.dateRange.endDate}</strong>
                {overviewData?.lastMonth ? ` (MIS ข้อมูลถึงงวด ${overviewData.lastMonth})` : ''}
              </span>
              <span>
                ซิงก์ MIS: <strong>{activeCache.fetchedAt || '-'}</strong> ({activeCache.fromCache ? 'จากแคช' : 'ดึงสด'})
              </span>
            </div>
          )}

          {loading && !overviewData && !subpageData && (
            <div className="mis-card" style={{ textAlign: 'center', padding: '2.5rem' }}>
              ⏳ กำลังดึงข้อมูลจาก MIS HOS และประมวลผล STM/SMT ในระบบ...
            </div>
          )}

          {/* ================= OVERVIEW VIEW ================= */}
          {activePageKey === 'overview' && overviewData && (
            <>
              {/* 5 Top KPI Cards matching MIS Overview */}
              <section className="mis-kpi-grid">
                <div className="mis-kpi-card">
                  <div className="mis-kpi-label">
                    <span>💰 เงินโอนสะสม (3 ฝั่ง)</span>
                    <span className="mis-status-pill mis-status-info">
                      STM {overviewData.kpis.budget.coverageStmPct ?? 0}%
                    </span>
                  </div>
                  <div className="mis-kpi-value">{fmtMoney(overviewData.kpis.budget.misAmount)} ฿</div>
                  <div className="mis-kpi-sub">
                    <span>SMT โอนตั้ง: {fmtMoney(overviewData.kpis.budget.smtAmount)}</span>
                    <span className={overviewData.kpis.budget.diffMisSmt > 1 ? 'mis-neg' : 'mis-pos'}>
                      ต่าง {fmtMoney(overviewData.kpis.budget.diffMisSmt)}
                    </span>
                  </div>
                  <div className="mis-kpi-sub">
                    <span>STM นำเข้าทั้งหมด: {fmtMoney(overviewData.kpis.budget.stmAmount)}</span>
                    <span>SMT โอนเข้า: {overviewData.kpis.budget.coverageSmtPct ?? 0}%</span>
                  </div>
                </div>

                <div className="mis-kpi-card">
                  <div className="mis-kpi-label">
                    <span>📋 ชดเชยบริการ (กองทุนย่อย UC)</span>
                    <span className="mis-status-pill mis-status-info">
                      {overviewData.kpis.claim.coveragePct ?? 0}%
                    </span>
                  </div>
                  <div className="mis-kpi-value">{fmtMoney(overviewData.kpis.claim.misAmount)} ฿</div>
                  <div className="mis-kpi-sub">
                    <span>STM สิทธิ UC: {fmtMoney(overviewData.kpis.claim.stmUcAmount)}</span>
                    <span className={overviewData.kpis.claim.diffMisStmUc > 1 ? 'mis-neg' : 'mis-pos'}>
                      ต่าง {fmtMoney(overviewData.kpis.claim.diffMisStmUc)}
                    </span>
                  </div>
                  <div className="mis-kpi-sub">
                    <span>MIS {fmtInt(overviewData.kpis.claim.misVisits)} ครั้ง</span>
                    <span>STM รวมทุกสิทธิ: {fmtMoney(overviewData.kpis.claim.stmAllAmount)}</span>
                  </div>
                </div>

                <div className="mis-kpi-card">
                  <div className="mis-kpi-label">
                    <span>🏥 ผู้ป่วยใน (IP จำหน่าย)</span>
                    <span className="mis-status-pill mis-status-ok">
                      CMI MIS {overviewData.kpis.ip.misCmi}
                    </span>
                  </div>
                  <div className="mis-kpi-value">{fmtInt(overviewData.kpis.ip.misCases)} ราย</div>
                  <div className="mis-kpi-sub">
                    <span>AdjRW MIS: {overviewData.kpis.ip.misAdjRw.toLocaleString('th-TH')}</span>
                    <span>STM IP: {fmtInt(overviewData.kpis.ip.stmCases)} ราย</span>
                  </div>
                  <div className="mis-kpi-sub">
                    <span>AdjRW STM: {overviewData.kpis.ip.stmAdjRw.toLocaleString('th-TH')}</span>
                    <span>CMI STM: {overviewData.kpis.ip.stmCmi}</span>
                  </div>
                </div>

                <div className="mis-kpi-card">
                  <div className="mis-kpi-label">
                    <span>🩺 เบิกชดเชย DMIS</span>
                    <span className="mis-status-pill mis-status-info">
                      {overviewData.kpis.dmis.coveragePct ?? 0}%
                    </span>
                  </div>
                  <div className="mis-kpi-value">{fmtMoney(overviewData.kpis.dmis.misAmount)} ฿</div>
                  <div className="mis-kpi-sub">
                    <span>STM DMIS/DCKD: {fmtMoney(overviewData.kpis.dmis.stmAmount)}</span>
                    <span className={overviewData.kpis.dmis.diffMisStm > 1 ? 'mis-neg' : 'mis-pos'}>
                      ต่าง {fmtMoney(overviewData.kpis.dmis.diffMisStm)}
                    </span>
                  </div>
                  <div className="mis-kpi-sub">
                    <span>MIS {fmtInt(overviewData.kpis.dmis.misVisits)} ครั้ง</span>
                    <span>MOPH + KTP + CKD</span>
                  </div>
                </div>

                <div className="mis-kpi-card">
                  <div className="mis-kpi-label">
                    <span>🦾 อุปกรณ์/อวัยวะเทียม</span>
                    <span className="mis-status-pill mis-status-info">
                      {overviewData.kpis.instrument.coveragePct ?? 0}%
                    </span>
                  </div>
                  <div className="mis-kpi-value">{fmtMoney(overviewData.kpis.instrument.misAmount)} ฿</div>
                  <div className="mis-kpi-sub">
                    <span>STM INST: {fmtMoney(overviewData.kpis.instrument.stmAmount)}</span>
                    <span className={overviewData.kpis.instrument.diffMisStm > 1 ? 'mis-neg' : 'mis-pos'}>
                      ต่าง {fmtMoney(overviewData.kpis.instrument.diffMisStm)}
                    </span>
                  </div>
                  <div className="mis-kpi-sub">
                    <span>MIS {fmtInt(overviewData.kpis.instrument.misQty)} ชิ้น</span>
                    <button
                      type="button"
                      className="mis-btn mis-btn-sm"
                      onClick={() => setActivePageKey('hc_instrument')}
                    >
                      ดูหน้า 4.4 →
                    </button>
                  </div>
                </div>
              </section>

              {/* Section 1: 3-Way Budget Comparison + Monthly Budget */}
              <section className="mis-card">
                <div className="mis-card-head">
                  <div>
                    <h2 className="mis-card-title">1. เปรียบเทียบเงินโอน 3 ฝั่ง แยกกองทุนหลัก (MIS HOS vs SMT vs STM)</h2>
                    <div className="mis-card-meta">
                      STM สิทธินอกระบบเงินโอน สปสช. ในระบบ: OFC (COCDSTM) {fmtMoney(overviewData.outsideNhsoStm.ofcAmount)} ฿ ({fmtInt(overviewData.outsideNhsoStm.ofcCount)} รายการ) · SSS (SIGNSTM) {fmtMoney(overviewData.outsideNhsoStm.sssAmount)} ฿ ({fmtInt(overviewData.outsideNhsoStm.sssCount)} รายการ)
                    </div>
                  </div>
                  <button type="button" className="mis-btn mis-btn-sm" onClick={() => setActivePageKey('budget_transfer')}>
                    เปิดหน้า 0.1 รายการรับเงิน →
                  </button>
                </div>

                <div className="mis-table-wrap">
                  <table className="mis-table">
                    <thead>
                      <tr>
                        <th>รหัส</th>
                        <th>กองทุนหลัก</th>
                        <th className="mis-num">MIS HOS (฿)</th>
                        <th className="mis-num">SMT โอนตั้ง (฿)</th>
                        <th className="mis-num">SMT สุทธิ (฿)</th>
                        <th className="mis-num">STM ในระบบ (฿)</th>
                        <th className="mis-num">ต่าง MIS−SMT</th>
                        <th className="mis-num">ต่าง MIS−STM</th>
                        <th className="mis-num">% SMT / STM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewData.budgetThreeWay.map((row) => (
                        <tr key={`${row.code}-${row.fundName}`}>
                          <td>{row.code || '-'}</td>
                          <td>
                            <div>{row.fundName}</div>
                            {row.note && <small style={{ color: '#64748b' }}>{row.note}</small>}
                          </td>
                          <td className="mis-num"><strong>{fmtMoney(row.misAmount)}</strong></td>
                          <td className="mis-num">{fmtMoney(row.smtAmount)}</td>
                          <td className="mis-num">{fmtMoney(row.smtNetAmount)}</td>
                          <td className="mis-num">{fmtMoney(row.stmAmount)}</td>
                          <td className={`mis-num ${row.diffMisSmt > 1 ? 'mis-neg' : row.diffMisSmt < -1 ? 'mis-warn-text' : 'mis-pos'}`}>
                            {fmtMoney(row.diffMisSmt)}
                          </td>
                          <td className={`mis-num ${row.diffMisStm > 1 ? 'mis-neg' : row.diffMisStm < -1 ? 'mis-warn-text' : 'mis-pos'}`}>
                            {fmtMoney(row.diffMisStm)}
                          </td>
                          <td className="mis-num">
                            {row.coverageSmtPct != null ? `${row.coverageSmtPct}%` : '-'} /{' '}
                            {row.coverageStmPct != null ? `${row.coverageStmPct}%` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Section 2: Monthly Budget vs Claim OP/IP */}
              <div className="mis-grid-2">
                <section className="mis-card">
                  <div className="mis-card-head">
                    <h2 className="mis-card-title">2. เงินโอนรายเดือน (MIS vs SMT vs STM)</h2>
                  </div>
                  <div className="mis-table-wrap">
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>เดือน</th>
                          <th className="mis-num">MIS โอน (฿)</th>
                          <th className="mis-num">SMT (฿)</th>
                          <th className="mis-num">STM รวม (฿)</th>
                          <th className="mis-num">ต่าง MIS−SMT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewData.budgetMonthly.map((m) => (
                          <tr key={m.mm} style={{ opacity: m.withinCutoff ? 1 : 0.45 }}>
                            <td>{m.label}</td>
                            <td className="mis-num">{fmtMoney(m.misAmount)}</td>
                            <td className="mis-num">{fmtMoney(m.smtAmount)}</td>
                            <td className="mis-num">{fmtMoney(m.stmAmount)}</td>
                            <td className={`mis-num ${m.diffMisSmt > 1 ? 'mis-neg' : 'mis-pos'}`}>
                              {fmtMoney(m.diffMisSmt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mis-card">
                  <div className="mis-card-head">
                    <h2 className="mis-card-title">3. ชดเชยบริการรายเดือน แยก OP / IP (MIS vs STM UC)</h2>
                  </div>
                  <div className="mis-table-wrap">
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>เดือน</th>
                          <th className="mis-num">MIS OP (฿)</th>
                          <th className="mis-num">MIS IP (฿)</th>
                          <th className="mis-num">MIS รวม (฿)</th>
                          <th className="mis-num">STM UC (฿)</th>
                          <th className="mis-num">ต่าง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewData.claimMonthly.map((m) => (
                          <tr key={m.mm} style={{ opacity: m.withinCutoff ? 1 : 0.45 }}>
                            <td>{m.label}</td>
                            <td className="mis-num">{fmtMoney(m.misOpAmount)}</td>
                            <td className="mis-num">{fmtMoney(m.misIpAmount)}</td>
                            <td className="mis-num"><strong>{fmtMoney(m.misAmount)}</strong></td>
                            <td className="mis-num">{fmtMoney(m.stmAmount)}</td>
                            <td className={`mis-num ${m.diffMisStm > 1 ? 'mis-neg' : 'mis-pos'}`}>
                              {fmtMoney(m.diffMisStm)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              {/* Section 3: Full Eclaim Subfunds Comparison */}
              <section className="mis-card">
                <div className="mis-card-head">
                  <div>
                    <h2 className="mis-card-title">4. เปรียบเทียบกองทุนย่อยทั้งหมด (Statement-UC vs STM ในระบบ)</h2>
                    <div className="mis-card-meta">แสดง {filteredSubfunds.length} จาก {overviewData.subfundComparison.length} กองทุนย่อย</div>
                  </div>
                  <div className="mis-controls">
                    <input
                      type="text"
                      className="mis-input"
                      placeholder="ค้นหารหัส/ชื่อกองทุน..."
                      value={subfundSearch}
                      onChange={(e) => setSubfundSearch(e.target.value)}
                    />
                    <div className="mis-filter-tabs">
                      {[
                        ['all', 'ทั้งหมด'],
                        ['ตรงกัน', 'ตรงกัน'],
                        ['STM น้อยกว่า MIS', 'STM น้อยกว่า MIS'],
                        ['ยังไม่มี STM', 'ยังไม่มี STM'],
                        ['พบเฉพาะใน STM', 'พบเฉพาะใน STM'],
                      ].map(([val, lbl]) => (
                        <button
                          key={val}
                          type="button"
                          className={`mis-tab-pill ${subfundStatusFilter === val ? 'active' : ''}`}
                          onClick={() => setSubfundStatusFilter(val)}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mis-table-wrap" style={{ maxHeight: 460 }}>
                  <table className="mis-table">
                    <thead>
                      <tr>
                        <th>รหัส</th>
                        <th>กลุ่ม</th>
                        <th>ชื่อกองทุนย่อย</th>
                        <th className="mis-num">ครั้ง MIS</th>
                        <th className="mis-num">ยอด MIS (฿)</th>
                        <th className="mis-num">ยอด STM ใน MIS (฿)</th>
                        <th className="mis-num">ยอด STM ในระบบ (฿)</th>
                        <th className="mis-num">ต่าง MIS−ระบบ</th>
                        <th className="mis-num">%</th>
                        <th>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSubfunds.slice(0, 150).map((s, idx) => (
                        <tr key={`${s.code}-${idx}`}>
                          <td><strong>{s.code}</strong></td>
                          <td>{s.fundGroup || '-'}</td>
                          <td>{s.name}</td>
                          <td className="mis-num">{fmtInt(s.misVisits)}</td>
                          <td className="mis-num">{fmtMoney(s.misAmount)}</td>
                          <td className="mis-num">{s.misStmAmount > 0 ? fmtMoney(s.misStmAmount) : '-'}</td>
                          <td className="mis-num"><strong>{fmtMoney(s.stmAmount)}</strong></td>
                          <td className={`mis-num ${s.diffMisStm > 1 ? 'mis-neg' : s.diffMisStm < -1 ? 'mis-warn-text' : 'mis-pos'}`}>
                            {fmtMoney(s.diffMisStm)}
                          </td>
                          <td className="mis-num">{s.coveragePct != null ? `${s.coveragePct}%` : '-'}</td>
                          <td><span className={statusPillClass(s.status)}>{s.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Section 4: IP Monthly + DMIS + MOPH + KTP + Instruments */}
              <div className="mis-grid-2">
                <section className="mis-card">
                  <div className="mis-card-head">
                    <h2 className="mis-card-title">5. ผู้ป่วยใน (IP) รายเดือน (MIS จำหน่าย vs STM IP)</h2>
                    <button type="button" className="mis-btn mis-btn-sm" onClick={() => setActivePageKey('ip_service')}>
                      เปิดหน้า 2.1 ผู้ป่วยใน →
                    </button>
                  </div>
                  <div className="mis-table-wrap">
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>เดือน</th>
                          <th className="mis-num">ราย (MIS)</th>
                          <th className="mis-num">AdjRW (MIS)</th>
                          <th className="mis-num">ราย (STM IP)</th>
                          <th className="mis-num">ยอด STM IP (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewData.ipMonthly.map((m) => (
                          <tr key={m.mm}>
                            <td>{m.label}</td>
                            <td className="mis-num">{fmtInt(m.misCases)}</td>
                            <td className="mis-num">{m.misAdjRw.toLocaleString('th-TH')}</td>
                            <td className="mis-num">{fmtInt(m.stmCases)}</td>
                            <td className="mis-num">{fmtMoney(m.stmAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mis-card">
                  <div className="mis-card-head">
                    <h2 className="mis-card-title">6. บริการเฉพาะ DMIS / ไตวาย / MOPH / KTP (10 อันดับ)</h2>
                    <button type="button" className="mis-btn mis-btn-sm" onClick={() => setActivePageKey('dmis_ckd')}>
                      เปิดหน้า 8.1 CKD →
                    </button>
                  </div>
                  <div className="mis-table-wrap">
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>รหัส</th>
                          <th>รายการ DMIS</th>
                          <th className="mis-num">MIS (฿)</th>
                          <th className="mis-num">STM ในระบบ (฿)</th>
                          <th>สถานะ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewData.dmisComparison.slice(0, 12).map((d, i) => (
                          <tr key={`${d.code}-${i}`}>
                            <td><strong>{d.code}</strong></td>
                            <td>{d.name}</td>
                            <td className="mis-num">{fmtMoney(d.misAmount)}</td>
                            <td className="mis-num">{fmtMoney(d.stmAmount)}</td>
                            <td><span className={statusPillClass(d.status)}>{d.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="mis-grid-2">
                <section className="mis-card">
                  <div className="mis-card-head">
                    <h2 className="mis-card-title">7. MOPH-Claim & Krungthai Platform (KTP)</h2>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="mis-btn mis-btn-sm" onClick={() => setActivePageKey('dmis_moph')}>8.2 MOPH</button>
                      <button type="button" className="mis-btn mis-btn-sm" onClick={() => setActivePageKey('dmis_ktp')}>8.3 KTP</button>
                    </div>
                  </div>
                  <div className="mis-table-wrap">
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>ระบบ</th>
                          <th>รายการ</th>
                          <th className="mis-num">ครั้ง</th>
                          <th className="mis-num">ยอดชดเชย MIS (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewData.moph.items.map((item: any, idx) => (
                          <tr key={`m-${idx}`}>
                            <td><span className="mis-status-pill mis-status-ok">MOPH</span></td>
                            <td>{item.name}</td>
                            <td className="mis-num">{fmtInt(item.misVisits)}</td>
                            <td className="mis-num">{fmtMoney(item.misAmount)}</td>
                          </tr>
                        ))}
                        {overviewData.ktp.items.map((item: any, idx) => (
                          <tr key={`k-${idx}`}>
                            <td><span className="mis-status-pill mis-status-info">KTP</span></td>
                            <td>{item.name}</td>
                            <td className="mis-num">{fmtInt(item.misVisits)}</td>
                            <td className="mis-num">{fmtMoney(item.misAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mis-card">
                  <div className="mis-card-head">
                    <h2 className="mis-card-title">8. อุปกรณ์/อวัยวะเทียม สูงสุด 10 รายการ</h2>
                    <button type="button" className="mis-btn mis-btn-sm" onClick={() => setActivePageKey('hc_instrument')}>
                      เปิดหน้า 4.4 →
                    </button>
                  </div>
                  <div className="mis-table-wrap">
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>รายการอุปกรณ์</th>
                          <th className="mis-num">ชิ้น</th>
                          <th className="mis-num">จำนวนเงิน MIS (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewData.instrument.topItems.map((it: any, idx) => (
                          <tr key={idx}>
                            <td>{String(it.CODE || '-')}</td>
                            <td className="mis-num">{fmtInt(it.CUR_QTY)}</td>
                            <td className="mis-num">{fmtMoney(it.CUR_AMT)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          )}

          {/* ================= SUBPAGE VIEW (ALL MIS PAGES) ================= */}
          {activePageKey !== 'overview' && subpageData && (
            <>
              <section className="mis-card">
                <div className="mis-card-head">
                  <div>
                    <h2 className="mis-card-title">
                      {subpageData.page.label} — {subpageData.templateName}
                    </h2>
                    <div className="mis-card-meta">
                      เส้นทาง MIS: <code>{subpageData.page.misRoute}</code> (Template ID: {subpageData.page.stId}) · เกณฑ์จับคู่ STM: <strong>{subpageData.summary.sliceNote}</strong>
                    </div>
                  </div>
                  <a
                    className="mis-btn mis-btn-sm"
                    href={`https://mishos.nhso.go.th/mis_hos/${subpageData.page.misRoute}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    ↗ เปิดหน้าจริงใน MIS HOS
                  </a>
                </div>

                <div className="mis-kpi-grid">
                  <div className="mis-kpi-card">
                    <div className="mis-kpi-label"><span>ยอด MIS HOS (หน้านี้)</span></div>
                    <div className="mis-kpi-value">{fmtMoney(subpageData.summary.misAmount)} ฿</div>
                    <div className="mis-kpi-sub"><span>จำนวนการ์ดรายงาน</span><span>{subpageData.cards.length} ตาราง</span></div>
                  </div>

                  {subpageData.summary.smtAmount != null && (
                    <div className="mis-kpi-card">
                      <div className="mis-kpi-label"><span>ยอดโอน SMT (FDHChecker)</span></div>
                      <div className="mis-kpi-value">{fmtMoney(subpageData.summary.smtAmount)} ฿</div>
                      <div className="mis-kpi-sub"><span>เทียบโอน 3 ฝั่ง</span><span>ปีงบ {subpageData.budgetYear}</span></div>
                    </div>
                  )}

                  <div className="mis-kpi-card">
                    <div className="mis-kpi-label">
                      <span>ยอด STM ที่ตรงหมวดในระบบ</span>
                      <span className="mis-status-pill mis-status-info">
                        {subpageData.summary.coveragePct != null ? `${subpageData.summary.coveragePct}%` : '-'}
                      </span>
                    </div>
                    <div className="mis-kpi-value">{fmtMoney(subpageData.summary.stmAmount)} ฿</div>
                    <div className="mis-kpi-sub">
                      <span>{fmtInt(subpageData.summary.stmCount)} รายการ</span>
                      {subpageData.summary.stmAdjRw > 0 && (
                        <span>AdjRW: {subpageData.summary.stmAdjRw.toLocaleString('th-TH')}</span>
                      )}
                    </div>
                  </div>

                  <div className="mis-kpi-card">
                    <div className="mis-kpi-label"><span>ส่วนต่าง (MIS − STM หมวดนี้)</span></div>
                    <div className={`mis-kpi-value ${subpageData.summary.diffMisStm > 1 ? 'mis-neg' : 'mis-pos'}`}>
                      {fmtMoney(subpageData.summary.diffMisStm)} ฿
                    </div>
                    <div className="mis-kpi-sub">
                      <span>STM รวมทั้งหมดทั้งปี</span>
                      <span>{fmtMoney(subpageData.summary.allStmAmount)} ฿</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Render every card in SimpleStudio template */}
              {subpageData.cards.map((card) => {
                const showRaw = Boolean(rawCardView[card.ssid]) || card.compareRows.length === 0;
                return (
                  <section key={card.ssid} className="mis-card">
                    <div className="mis-card-head">
                      <div>
                        <h3 className="mis-card-title">
                          {card.reportName} <small style={{ fontWeight: 400, color: '#64748b' }}>({card.rows.length} แถว · SSID {card.ssid})</small>
                        </h3>
                        {card.remark && <div className="mis-card-meta">{card.remark}</div>}
                      </div>
                      {card.compareRows.length > 0 && (
                        <button
                          type="button"
                          className="mis-btn mis-btn-sm"
                          onClick={() =>
                            setRawCardView((prev) => ({ ...prev, [card.ssid]: !showRaw }))
                          }
                        >
                          {showRaw ? '📊 ดูมุมมองเทียบ MIS vs STM' : '📄 ดูคอลัมน์ดิบจาก MIS'}
                        </button>
                      )}
                    </div>

                    {card.rows.length === 0 ? (
                      <div style={{ color: '#64748b', fontSize: '0.86rem', padding: '0.5rem 0' }}>
                        ไม่มีข้อมูลใน MIS HOS สำหรับปีงบประมาณ {subpageData.budgetYear}
                      </div>
                    ) : !showRaw ? (
                      <div className="mis-table-wrap" style={{ maxHeight: 420 }}>
                        <table className="mis-table">
                          <thead>
                            <tr>
                              <th>รายการ / เดือน</th>
                              <th className="mis-num">ยอด MIS HOS (฿)</th>
                              {subpageData.page.supportsThreeWay && <th className="mis-num">ยอด SMT (฿)</th>}
                              <th className="mis-num">ยอด STM ในระบบ (฿)</th>
                              <th className="mis-num">ส่วนต่าง</th>
                              <th className="mis-num">% ครอบคลุม</th>
                              <th>สถานะ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {card.compareRows.map((cr) => (
                              <tr key={cr.rowKey}>
                                <td>{cr.label}</td>
                                <td className="mis-num"><strong>{fmtMoney(cr.misAmount)}</strong></td>
                                {subpageData.page.supportsThreeWay && (
                                  <td className="mis-num">{fmtMoney(cr.smtAmount ?? 0)}</td>
                                )}
                                <td className="mis-num">{fmtMoney(cr.fdhAmount)}</td>
                                <td className={`mis-num ${cr.diff > 1 ? 'mis-neg' : cr.diff < -1 ? 'mis-warn-text' : 'mis-pos'}`}>
                                  {fmtMoney(cr.diff)}
                                </td>
                                <td className="mis-num">{cr.coveragePct != null ? `${cr.coveragePct}%` : '-'}</td>
                                <td><span className={statusPillClass(cr.status)}>{cr.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="mis-table-wrap" style={{ maxHeight: 420 }}>
                        <table className="mis-table">
                          <thead>
                            <tr>
                              {card.columns.map((col) => (
                                <th key={col}>{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {card.rows.map((r, rIdx) => (
                              <tr key={rIdx}>
                                {card.columns.map((col) => (
                                  <td key={col}>{fmtCell(r[col])}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                );
              })}

              {/* Bottom STM Breakdown & Files Audit for Subpage */}
              <div className="mis-grid-2">
                <section className="mis-card">
                  <div className="mis-card-head">
                    <h3 className="mis-card-title">รายละเอียด STM ใน FDHChecker ที่จับคู่ได้ ({subpageData.stmBreakdown.length} กลุ่มย่อย)</h3>
                  </div>
                  <div className="mis-table-wrap" style={{ maxHeight: 340 }}>
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>รหัส</th>
                          <th>กลุ่ม</th>
                          <th>ชื่อรายการ</th>
                          <th className="mis-num">รายการ</th>
                          <th className="mis-num">ยอดชดเชย (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subpageData.stmBreakdown.slice(0, 60).map((sb, idx) => (
                          <tr key={`${sb.code}-${idx}`}>
                            <td><strong>{sb.code}</strong></td>
                            <td>{sb.fundGroup}</td>
                            <td>{sb.name}</td>
                            <td className="mis-num">{fmtInt(sb.visits)}</td>
                            <td className="mis-num">{fmtMoney(sb.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mis-card">
                  <div className="mis-card-head">
                    <h3 className="mis-card-title">ไฟล์ Statement (STM) ที่นำเข้าในช่วงนี้ ({subpageData.stmFiles.length} ไฟล์)</h3>
                  </div>
                  <div className="mis-table-wrap" style={{ maxHeight: 340 }}>
                    <table className="mis-table">
                      <thead>
                        <tr>
                          <th>ชื่อไฟล์ / Statement No.</th>
                          <th>แผนก/สิทธิ</th>
                          <th className="mis-num">แถว</th>
                          <th className="mis-num">ยอดจ่าย STM (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subpageData.stmFiles.slice(0, 60).map((f, idx) => (
                          <tr key={`${f.filename}-${idx}`}>
                            <td>
                              <div>{f.filename}</div>
                              <small style={{ color: '#64748b' }}>
                                {f.statementNo || '-'} · {f.minDate} ถึง {f.maxDate}
                              </small>
                            </td>
                            <td>{f.department || '-'} / {f.maininscl || '-'}</td>
                            <td className="mis-num">{fmtInt(f.rowsCount)}</td>
                            <td className="mis-num"><strong>{fmtMoney(f.sumPaid)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default MisHosComparePage;
