import React, { useEffect, useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './ExecutiveMonitorPage.css';

export interface MetricItem {
  claimedAmount: number;
  claimedCount: number;
  pendingCAmount: number;
  pendingCCount: number;
  reimbursedAmount: number;
  reimbursedCount: number;
  reimbursementRate: number;
}

export interface ServiceCategorySummary extends MetricItem {
  categoryKey: string;
  categoryName: string;
  categoryIcon: string;
  categoryDescription: string;
  smtAllocatedAmount: number;
  smtNetTransferred: number;
  topCCodes: Array<{
    code: string;
    count: number;
    amount: number;
    description: string;
  }>;
}

export interface RightSchemeSummary extends MetricItem {
  rightKey: string;
  rightName: string;
  rightIcon: string;
  rightDescription: string;
}

export interface SmtBudgetComparison {
  id?: number;
  budgetYear: string;
  fundName: string;
  serviceCategory: string;
  categoryName: string;
  mophId?: string;
  mophDesc?: string;
  allocatedAmount: number;
  netTransferred: number;
  waitAmount: number;
  debtAmount: number;
  stmPaidAmount: number;
  claimedAmount: number;
  pendingCAmount: number;
  status: 'settled' | 'partial' | 'pending';
  runDate?: string;
  refDocNo?: string;
  batchNo?: string;
}

export interface TopCCodeItem {
  code: string;
  count: number;
  amount: number;
  description: string;
  guide: string;
  category: string;
  affectedServices: string[];
}

export interface ExecutiveMonitorResult {
  period: {
    startDate?: string;
    endDate?: string;
    budgetYear: string;
  };
  summary: {
    totalClaimedAmount: number;
    totalClaimedCount: number;
    totalPendingCAmount: number;
    totalPendingCCount: number;
    totalReimbursedAmount: number;
    totalReimbursedCount: number;
    reimbursementRate: number;
    totalSmtAllocatedAmount: number;
    totalSmtNetTransferred: number;
    totalSmtWaitAmount: number;
    totalSmtDebtAmount: number;
    varianceAmount: number;
  };
  byService: Record<string, ServiceCategorySummary>;
  byRight: Record<string, RightSchemeSummary>;
  matrix: Record<string, Record<string, MetricItem>>;
  smtTransfers: SmtBudgetComparison[];
  topCCodes: TopCCodeItem[];
}

const formatCurrency = (val: number | undefined | null) =>
  new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);

const formatNumber = (val: number | undefined | null) =>
  new Intl.NumberFormat('th-TH').format(val || 0);

export const ExecutiveMonitorPage: React.FC = () => {
  const currentYearBE = new Date().getFullYear() + 543;
  const defaultBudgetYear = String(new Date().getMonth() >= 9 ? currentYearBE + 1 : currentYearBE);

  const [budgetYear, setBudgetYear] = useState<string>(defaultBudgetYear);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedService, setSelectedService] = useState<string>('ALL');
  const [selectedRight, setSelectedRight] = useState<string>('ALL');
  const [activePreset, setActivePreset] = useState<string>('fy_current');

  const [activeTab, setActiveTab] = useState<'matrix' | 'services' | 'smt' | 'top_c'>('matrix');
  const [matrixMetricMode, setMatrixMetricMode] = useState<'claimed' | 'c_code' | 'reimbursed' | 'rate'>('claimed');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExecutiveMonitorResult | null>(null);
  const [filterOptions, setFilterOptions] = useState<{
    budgetYears: string[];
    serviceCategories: Array<{ key: string; name: string; icon: string }>;
    rightSchemes: Array<{ key: string; name: string; icon: string }>;
  } | null>(null);

  // Load filter options on mount
  useEffect(() => {
    fetch('/api/executive-monitor/filter-options')
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          setFilterOptions(json.data);
        }
      })
      .catch((err) => console.error('Failed to load filter options:', err));
  }, []);

  // Fetch summary data
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (budgetYear) params.append('budgetYear', budgetYear);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (selectedService && selectedService !== 'ALL') params.append('serviceCategory', selectedService);
      if (selectedRight && selectedRight !== 'ALL') params.append('rightScheme', selectedRight);

      const res = await fetch(`/api/executive-monitor/summary?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูลผู้บริหารได้');
      }
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [budgetYear, startDate, endDate, selectedService, selectedRight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preset Handlers
  const handlePreset = (preset: string) => {
    setActivePreset(preset);
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    if (preset === 'this_month') {
      setStartDate(`${yyyy}-${mm}-01`);
      setEndDate(todayStr);
    } else if (preset === 'this_quarter') {
      const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3 + 1;
      const qMonthStr = String(quarterStartMonth).padStart(2, '0');
      setStartDate(`${yyyy}-${qMonthStr}-01`);
      setEndDate(todayStr);
    } else if (preset === 'fy_2568') {
      setStartDate('2024-10-01');
      setEndDate('2025-09-30');
      setBudgetYear('2568');
    } else if (preset === 'fy_2567') {
      setStartDate('2023-10-01');
      setEndDate('2024-09-30');
      setBudgetYear('2567');
    } else if (preset === 'all_time') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'fy_current') {
      const isPastOct = today.getMonth() >= 9;
      const startYear = isPastOct ? yyyy : yyyy - 1;
      const endYear = isPastOct ? yyyy + 1 : yyyy;
      setStartDate(`${startYear}-10-01`);
      setEndDate(`${endYear}-09-30`);
      setBudgetYear(defaultBudgetYear);
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (!data) return;

    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary KPI
    const summaryRows = [
      { ตัวชี้วัด: 'ปีงบประมาณ e-Budget SMT', ค่า: data.period.budgetYear },
      { ตัวชี้วัด: 'ช่วงวันที่ประมวลผล', ค่า: `${data.period.startDate || 'ทั้งหมด'} ถึง ${data.period.endDate || 'ปัจจุบัน'}` },
      { ตัวชี้วัด: 'ยอดส่งเบิกทั้งหมด (Claimed Amount)', ค่า: data.summary.totalClaimedAmount },
      { ตัวชี้วัด: 'จำนวนเคสที่ส่งเบิก (Claimed Cases)', ค่า: data.summary.totalClaimedCount },
      { ตัวชี้วัด: 'ยอดติด C / Deny (Pending Amount)', ค่า: data.summary.totalPendingCAmount },
      { ตัวชี้วัด: 'จำนวนเคสที่ติด C (C-Code Cases)', ค่า: data.summary.totalPendingCCount },
      { ตัวชี้วัด: 'ยอดได้รับการชดเชยแล้ว (Reimbursed STM)', ค่า: data.summary.totalReimbursedAmount },
      { ตัวชี้วัด: 'จำนวนเคสที่ชดเชยแล้ว (Paid Cases)', ค่า: data.summary.totalReimbursedCount },
      { ตัวชี้วัด: 'อัตราการชดเชยสำเร็จ (Reimbursement %)', ค่า: `${data.summary.reimbursementRate}%` },
      { ตัวชี้วัด: 'ยอดจัดสรรตาม e-Budget SMT', ค่า: data.summary.totalSmtAllocatedAmount },
      { ตัวชี้วัด: 'ยอดเงินโอนสุทธิ SMT', ค่า: data.summary.totalSmtNetTransferred },
      { ตัวชี้วัด: 'ยอดผลต่าง/คงค้าง (Variance)', ค่า: data.summary.varianceAmount },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'KPI สรุปภาพรวม');

    // Sheet 2: By Service Breakdown
    const serviceRows = Object.values(data.byService).map((s) => ({
      หมวดบริการ: s.categoryName,
      ยอดส่งเบิก: s.claimedAmount,
      จำนวนส่งเบิก: s.claimedCount,
      ยอดติด_C: s.pendingCAmount,
      เคสติด_C: s.pendingCCount,
      ชดเชยแล้ว_STM: s.reimbursedAmount,
      เคสชดเชย: s.reimbursedCount,
      อัตราการชดเชย_เปอร์เซ็นต์: s.reimbursementRate,
      งบจัดสรร_SMT: s.smtAllocatedAmount,
      โอนสุทธิ_SMT: s.smtNetTransferred,
    }));
    const wsService = XLSX.utils.json_to_sheet(serviceRows);
    XLSX.utils.book_append_sheet(wb, wsService, 'แยกตามบริการ');

    // Sheet 3: By Right Breakdown
    const rightRows = Object.values(data.byRight).map((r) => ({
      สิทธิการรักษา: r.rightName,
      ยอดส่งเบิก: r.claimedAmount,
      จำนวนส่งเบิก: r.claimedCount,
      ยอดติด_C: r.pendingCAmount,
      เคสติด_C: r.pendingCCount,
      ชดเชยแล้ว_STM: r.reimbursedAmount,
      เคสชดเชย: r.reimbursedCount,
      อัตราการชดเชย_เปอร์เซ็นต์: r.reimbursementRate,
    }));
    const wsRight = XLSX.utils.json_to_sheet(rightRows);
    XLSX.utils.book_append_sheet(wb, wsRight, 'แยกตามสิทธิ');

    // Sheet 4: SMT e-Budget comparison
    if (data.smtTransfers && data.smtTransfers.length > 0) {
      const smtRows = data.smtTransfers.map((t) => ({
        ปีงบ: t.budgetYear,
        กองทุน_SMT: t.fundName,
        หมวดบริการ: t.categoryName,
        รหัสผังบัญชี: t.mophId || '',
        ชื่อบัญชี_สธ: t.mophDesc || '',
        ยอดจัดสรร: t.allocatedAmount,
        โอนสุทธิ: t.netTransferred,
        ยอดส่งเบิก_รพ: t.claimedAmount,
        ชดเชยแล้ว_STM: t.stmPaidAmount,
        ยอดติด_C: t.pendingCAmount,
        สถานะ: t.status,
        วันที่โอน: t.runDate || '',
      }));
      const wsSmt = XLSX.utils.json_to_sheet(smtRows);
      XLSX.utils.book_append_sheet(wb, wsSmt, 'งบประมาณ SMT');
    }

    // Sheet 5: Top C-codes
    if (data.topCCodes && data.topCCodes.length > 0) {
      const cRows = data.topCCodes.map((c) => ({
        รหัสข้อผิดพลาด: c.code,
        จำนวนเคส: c.count,
        ยอดเงินรวม: c.amount,
        บริการที่ได้รับผลกระทบ: c.affectedServices.join(', '),
        คำอธิบาย: c.description,
        แนวทางแก้ไข: c.guide,
      }));
      const wsC = XLSX.utils.json_to_sheet(cRows);
      XLSX.utils.book_append_sheet(wb, wsC, 'วิเคราะห์รหัสติด_C');
    }

    XLSX.writeFile(wb, `Executive_Monitor_FY${data.period.budgetYear}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Helper for matrix rendering
  const serviceKeys = useMemo(() => {
    if (!data?.byService) return [];
    return Object.keys(data.byService);
  }, [data]);

  const rightKeys = useMemo(() => {
    if (!data?.byRight) return [];
    return Object.keys(data.byRight);
  }, [data]);

  return (
    <div className="executive-monitor-page">
      {/* Page Header */}
      <div className="exec-header">
        <div className="exec-title-group">
          <h1>
            <span>🏛️</span> มอนิเตอร์ผู้บริหาร (Executive Claim & Revenue Matrix)
          </h1>
          <p className="exec-subtitle">
            บูรณาการ 3 ฐานข้อมูล (REP ตอบรับเรียกเก็บ, STM สเตทเมนต์ชดเชยจริง, e-Budget/SMT งบจัดสรร สปสช.) แยกสิทธิ x แยกบริการ
          </p>
        </div>
        <div className="exec-actions">
          <button
            className="btn-exec-refresh"
            onClick={() => void fetchData()}
            disabled={loading}
          >
            <span>🔄</span> โหลดข้อมูลใหม่
          </button>
          <button
            className="btn-exec-export"
            onClick={handleExportExcel}
            disabled={loading || !data}
          >
            <span>📥</span> ส่งออก Excel (บูรณาการ)
          </button>
        </div>
      </div>

      {/* Filter Card */}
      <div className="exec-filter-card">
        <div className="filter-preset-row">
          <span className="preset-label">ช่วงเวลาแนะนำ:</span>
          <button
            className={`btn-preset ${activePreset === 'fy_current' ? 'active' : ''}`}
            onClick={() => handlePreset('fy_current')}
          >
            ปีงบประมาณปัจจุบัน ({defaultBudgetYear})
          </button>
          <button
            className={`btn-preset ${activePreset === 'this_month' ? 'active' : ''}`}
            onClick={() => handlePreset('this_month')}
          >
            เดือนนี้
          </button>
          <button
            className={`btn-preset ${activePreset === 'this_quarter' ? 'active' : ''}`}
            onClick={() => handlePreset('this_quarter')}
          >
            ไตรมาสล่าสุด
          </button>
          <button
            className={`btn-preset ${activePreset === 'fy_2568' ? 'active' : ''}`}
            onClick={() => handlePreset('fy_2568')}
          >
            ปีงบ 2568
          </button>
          <button
            className={`btn-preset ${activePreset === 'fy_2567' ? 'active' : ''}`}
            onClick={() => handlePreset('fy_2567')}
          >
            ปีงบ 2567
          </button>
          <button
            className={`btn-preset ${activePreset === 'all_time' ? 'active' : ''}`}
            onClick={() => handlePreset('all_time')}
          >
            ดูทั้งหมด
          </button>
        </div>

        <div className="filter-inputs-grid">
          <div className="filter-field">
            <label>ปีงบประมาณ e-Budget (SMT)</label>
            <select
              value={budgetYear}
              onChange={(e) => {
                setBudgetYear(e.target.value);
                setActivePreset('custom');
              }}
            >
              {filterOptions?.budgetYears ? (
                filterOptions.budgetYears.map((y) => (
                  <option key={y} value={y}>
                    ปี พ.ศ. {y}
                  </option>
                ))
              ) : (
                <>
                  <option value={String(currentYearBE + 1)}>ปี พ.ศ. {currentYearBE + 1}</option>
                  <option value={String(currentYearBE)}>ปี พ.ศ. {currentYearBE}</option>
                  <option value={String(currentYearBE - 1)}>ปี พ.ศ. {currentYearBE - 1}</option>
                </>
              )}
            </select>
          </div>

          <div className="filter-field">
            <label>ตั้งแต่วันที่ (Service Date)</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setActivePreset('custom');
              }}
            />
          </div>

          <div className="filter-field">
            <label>ถึงวันที่</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setActivePreset('custom');
              }}
            />
          </div>

          <div className="filter-field">
            <label>ประเภทบริการ</label>
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
            >
              <option value="ALL">-- ทุกประเภทบริการ (8 บริการ) --</option>
              {filterOptions?.serviceCategories.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.icon} {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-field">
            <label>สิทธิการรักษา</label>
            <select
              value={selectedRight}
              onChange={(e) => setSelectedRight(e.target.value)}
            >
              <option value="ALL">-- ทุกสิทธิการรักษา (8 สิทธิ) --</option>
              {filterOptions?.rightSchemes.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.icon} {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="error-banner">
          <span>⚠️</span>
          <div>
            <strong>เกิดข้อผิดพลาด:</strong> {error}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !data ? (
        <div className="state-container">
          <div className="spinner" />
          <p style={{ color: '#64748b', fontWeight: 500 }}>
            กำลังรวบรวมและวิเคราะห์ข้อมูล REP, STM, และ e-Budget SMT...
          </p>
        </div>
      ) : data ? (
        <>
          {/* Top 4 KPI Cards */}
          <div className="exec-kpi-grid">
            {/* Card 1: Total Claimed */}
            <div className="kpi-card claimed">
              <div className="kpi-header">
                <span className="kpi-title">ยอดส่งเบิกทั้งหมด (Claimed)</span>
                <span className="kpi-icon">📤</span>
              </div>
              <div className="kpi-main-val">
                ฿{formatCurrency(data.summary.totalClaimedAmount)}
              </div>
              <div className="kpi-sub-row">
                <span>จำนวนที่ส่งเบิก:</span>
                <span className="kpi-badge badge-blue">
                  {formatNumber(data.summary.totalClaimedCount)} เคส
                </span>
              </div>
            </div>

            {/* Card 2: Pending C-Code & Denials */}
            <div className="kpi-card pending-c">
              <div className="kpi-header">
                <span className="kpi-title">ติด C / ปฏิเสธจ่าย (C-Code/Deny)</span>
                <span className="kpi-icon">⚠️</span>
              </div>
              <div className="kpi-main-val" style={{ color: '#c2410c' }}>
                ฿{formatCurrency(data.summary.totalPendingCAmount)}
              </div>
              <div className="kpi-sub-row">
                <span>จำนวนเคสที่ติด C:</span>
                <span className="kpi-badge badge-orange">
                  {formatNumber(data.summary.totalPendingCCount)} เคส
                </span>
              </div>
              <div className="kpi-progress">
                <div
                  className="kpi-progress-bar orange"
                  style={{
                    width: `${Math.min(
                      100,
                      data.summary.totalClaimedAmount > 0
                        ? (data.summary.totalPendingCAmount / data.summary.totalClaimedAmount) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Card 3: Reimbursed Amount */}
            <div className="kpi-card reimbursed">
              <div className="kpi-header">
                <span className="kpi-title">ได้รับการชดเชยแล้ว (STM Paid)</span>
                <span className="kpi-icon">💰</span>
              </div>
              <div className="kpi-main-val" style={{ color: '#047857' }}>
                ฿{formatCurrency(data.summary.totalReimbursedAmount)}
              </div>
              <div className="kpi-sub-row">
                <span>อัตราการชดเชยสำเร็จ:</span>
                <span className="kpi-badge badge-green">
                  {data.summary.reimbursementRate}%
                </span>
              </div>
              <div className="kpi-progress">
                <div
                  className="kpi-progress-bar green"
                  style={{ width: `${Math.min(100, data.summary.reimbursementRate)}%` }}
                />
              </div>
            </div>

            {/* Card 4: SMT e-Budget */}
            <div className="kpi-card budget">
              <div className="kpi-header">
                <span className="kpi-title">งบจัดสรร e-Budget SMT (สปสช.)</span>
                <span className="kpi-icon">🏦</span>
              </div>
              <div className="kpi-main-val" style={{ color: '#6d28d9' }}>
                ฿{formatCurrency(data.summary.totalSmtAllocatedAmount)}
              </div>
              <div className="kpi-sub-row">
                <span>โอนสุทธิเข้าบัญชี:</span>
                <span className="kpi-badge badge-purple">
                  ฿{formatCurrency(data.summary.totalSmtNetTransferred)}
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Tabs */}
          <div className="exec-tabs">
            <button
              className={`tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              <span>📊</span> เมทริกซ์ 2 แกน (สิทธิ x บริการ)
            </button>
            <button
              className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`}
              onClick={() => setActiveTab('services')}
            >
              <span>🩺</span> วิเคราะห์แยกตามบริการ (8 หมวด)
            </button>
            <button
              className={`tab-btn ${activeTab === 'smt' ? 'active' : ''}`}
              onClick={() => setActiveTab('smt')}
            >
              <span>🏦</span> บูรณาการ e-Budget SMT กับ Statement
            </button>
            <button
              className={`tab-btn ${activeTab === 'top_c' ? 'active' : ''}`}
              onClick={() => setActiveTab('top_c')}
            >
              <span>🔍</span> วิเคราะห์รหัสติด C สูงสุด (Top 10)
            </button>
          </div>

          {/* Tab 1: Pivot Cross-Tab Matrix */}
          {activeTab === 'matrix' && (
            <div className="matrix-container">
              <div className="matrix-toolbar">
                <h3 className="matrix-toolbar-title">
                  ตารางสรุปเปรียบเทียบไขว้: สิทธิการรักษา x ประเภทบริการ
                </h3>
                <div className="matrix-metric-switch">
                  <button
                    className={`metric-switch-btn ${matrixMetricMode === 'claimed' ? 'active' : ''}`}
                    onClick={() => setMatrixMetricMode('claimed')}
                  >
                    ยอดส่งเบิก (฿)
                  </button>
                  <button
                    className={`metric-switch-btn ${matrixMetricMode === 'c_code' ? 'active' : ''}`}
                    onClick={() => setMatrixMetricMode('c_code')}
                  >
                    ติด C / Deny (฿)
                  </button>
                  <button
                    className={`metric-switch-btn ${matrixMetricMode === 'reimbursed' ? 'active' : ''}`}
                    onClick={() => setMatrixMetricMode('reimbursed')}
                  >
                    ชดเชยแล้ว STM (฿)
                  </button>
                  <button
                    className={`metric-switch-btn ${matrixMetricMode === 'rate' ? 'active' : ''}`}
                    onClick={() => setMatrixMetricMode('rate')}
                  >
                    อัตราการชดเชย (%)
                  </button>
                </div>
              </div>

              <div className="table-responsive">
                <table className="exec-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: '180px' }}>สิทธิการรักษา</th>
                      {serviceKeys.map((sk) => (
                        <th key={sk} className="text-right" style={{ minWidth: '130px' }}>
                          {data.byService[sk]?.categoryIcon} {data.byService[sk]?.categoryName}
                        </th>
                      ))}
                      <th className="text-right" style={{ minWidth: '140px', background: '#f1f5f9' }}>
                        รวมทุกบริการ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rightKeys.map((rk) => {
                      const rightItem = data.byRight[rk];
                      return (
                        <tr key={rk}>
                          <td style={{ fontWeight: 600 }}>
                            {rightItem?.rightIcon} {rightItem?.rightName}
                          </td>
                          {serviceKeys.map((sk) => {
                            const cell = data.matrix[rk]?.[sk];
                            if (!cell) return <td key={sk} className="text-right">-</td>;

                            if (matrixMetricMode === 'claimed') {
                              return (
                                <td key={sk} className="text-right">
                                  {cell.claimedAmount > 0 ? (
                                    <span>฿{formatCurrency(cell.claimedAmount)}</span>
                                  ) : (
                                    <span style={{ color: '#94a3b8' }}>-</span>
                                  )}
                                </td>
                              );
                            } else if (matrixMetricMode === 'c_code') {
                              return (
                                <td
                                  key={sk}
                                  className={`text-right ${cell.pendingCAmount > 0 ? 'highlight-warn' : ''}`}
                                >
                                  {cell.pendingCAmount > 0 ? (
                                    <span>฿{formatCurrency(cell.pendingCAmount)}</span>
                                  ) : (
                                    <span style={{ color: '#94a3b8' }}>-</span>
                                  )}
                                </td>
                              );
                            } else if (matrixMetricMode === 'reimbursed') {
                              return (
                                <td
                                  key={sk}
                                  className={`text-right ${cell.reimbursedAmount > 0 ? 'highlight-good' : ''}`}
                                >
                                  {cell.reimbursedAmount > 0 ? (
                                    <span>฿{formatCurrency(cell.reimbursedAmount)}</span>
                                  ) : (
                                    <span style={{ color: '#94a3b8' }}>-</span>
                                  )}
                                </td>
                              );
                            } else {
                              return (
                                <td key={sk} className="text-right">
                                  {cell.claimedAmount > 0 ? (
                                    <span
                                      className={
                                        cell.reimbursementRate >= 80
                                          ? 'highlight-good'
                                          : cell.reimbursementRate < 50
                                          ? 'highlight-alert'
                                          : 'highlight-warn'
                                      }
                                    >
                                      {cell.reimbursementRate}%
                                    </span>
                                  ) : (
                                    <span style={{ color: '#94a3b8' }}>-</span>
                                  )}
                                </td>
                              );
                            }
                          })}
                          {/* Right Row Total */}
                          <td className="text-right" style={{ fontWeight: 700, background: '#f8fafc' }}>
                            {matrixMetricMode === 'claimed' && `฿${formatCurrency(rightItem?.claimedAmount)}`}
                            {matrixMetricMode === 'c_code' && (
                              <span className={rightItem?.pendingCAmount ? 'highlight-warn' : ''}>
                                ฿{formatCurrency(rightItem?.pendingCAmount)}
                              </span>
                            )}
                            {matrixMetricMode === 'reimbursed' && (
                              <span className="highlight-good">
                                ฿${formatCurrency(rightItem?.reimbursedAmount)}
                              </span>
                            )}
                            {matrixMetricMode === 'rate' && `${rightItem?.reimbursementRate}%`}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Column Totals Row */}
                    <tr className="total-row">
                      <td>รวมทุกสิทธิ</td>
                      {serviceKeys.map((sk) => {
                        const sItem = data.byService[sk];
                        return (
                          <td key={sk} className="text-right">
                            {matrixMetricMode === 'claimed' && `฿${formatCurrency(sItem?.claimedAmount)}`}
                            {matrixMetricMode === 'c_code' && (
                              <span className={sItem?.pendingCAmount ? 'highlight-warn' : ''}>
                                ฿{formatCurrency(sItem?.pendingCAmount)}
                              </span>
                            )}
                            {matrixMetricMode === 'reimbursed' && (
                              <span className="highlight-good">
                                ฿${formatCurrency(sItem?.reimbursedAmount)}
                              </span>
                            )}
                            {matrixMetricMode === 'rate' && `${sItem?.reimbursementRate}%`}
                          </td>
                        );
                      })}
                      <td className="text-right" style={{ background: '#e2e8f0', color: '#0f172a' }}>
                        {matrixMetricMode === 'claimed' && `฿${formatCurrency(data.summary.totalClaimedAmount)}`}
                        {matrixMetricMode === 'c_code' && (
                          <span className="highlight-warn">
                            ฿${formatCurrency(data.summary.totalPendingCAmount)}
                          </span>
                        )}
                        {matrixMetricMode === 'reimbursed' && (
                          <span className="highlight-good">
                            ฿${formatCurrency(data.summary.totalReimbursedAmount)}
                          </span>
                        )}
                        {matrixMetricMode === 'rate' && `${data.summary.reimbursementRate}%`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 2: Service Breakdown Cards */}
          {activeTab === 'services' && (
            <div className="services-grid">
              {serviceKeys.map((sk) => {
                const s = data.byService[sk];
                return (
                  <div key={sk} className="service-card">
                    <div className="service-card-header">
                      <span className="service-icon">{s.categoryIcon}</span>
                      <div>
                        <h4 className="service-title">{s.categoryName}</h4>
                        <p className="service-desc">{s.categoryDescription}</p>
                      </div>
                    </div>

                    <div className="service-metrics-row">
                      <div className="s-metric-item">
                        <div className="s-metric-label">ยอดส่งเบิก</div>
                        <div className="s-metric-val">฿{formatCurrency(s.claimedAmount)}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {formatNumber(s.claimedCount)} เคส
                        </div>
                      </div>

                      <div className="s-metric-item">
                        <div className="s-metric-label">ติด C / Deny</div>
                        <div className="s-metric-val" style={{ color: '#c2410c' }}>
                          ฿{formatCurrency(s.pendingCAmount)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {formatNumber(s.pendingCCount)} เคส
                        </div>
                      </div>

                      <div className="s-metric-item">
                        <div className="s-metric-label">ชดเชยแล้ว</div>
                        <div className="s-metric-val" style={{ color: '#047857' }}>
                          ฿{formatCurrency(s.reimbursedAmount)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 600 }}>
                          {s.reimbursementRate}%
                        </div>
                      </div>
                    </div>

                    {s.smtAllocatedAmount > 0 && (
                      <div
                        style={{
                          background: '#f5f3ff',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          color: '#6d28d9',
                          marginBottom: '0.75rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>งบจัดสรร e-Budget SMT:</span>
                        <strong>฿{formatCurrency(s.smtAllocatedAmount)}</strong>
                      </div>
                    )}

                    {s.topCCodes && s.topCCodes.length > 0 && (
                      <div className="service-c-list">
                        <div className="service-c-title">⚠️ รหัสติด C ที่พบมากในบริการนี้:</div>
                        {s.topCCodes.map((item, idx) => (
                          <div key={idx} className="service-c-item">
                            <span>
                              <strong>{item.code}</strong>: {item.description}
                            </span>
                            <span>
                              {formatNumber(item.count)} เคส (฿{formatCurrency(item.amount)})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 3: SMT e-Budget Reconcile Table */}
          {activeTab === 'smt' && (
            <div className="matrix-container">
              <div className="info-box-blue">
                <span>ℹ️</span>
                <span>
                  ตารางนี้เปรียบเทียบงบประมาณที่สำนักงานหลักประกันสุขภาพแห่งชาติ (สปสช.) จัดสรรผ่านระบบ e-Budget/SMT กับการเรียกเก็บและ Statement จริงของโรงพยาบาล
                </span>
              </div>

              {data.smtTransfers && data.smtTransfers.length > 0 ? (
                <div className="table-responsive">
                  <table className="exec-table">
                    <thead>
                      <tr>
                        <th>งวด / วันที่โอน</th>
                        <th>กองทุน e-Budget (SMT)</th>
                        <th>หมวดบริการ</th>
                        <th>รหัสบัญชี สธ.</th>
                        <th className="text-right">งบจัดสรร</th>
                        <th className="text-right">โอนสุทธิ</th>
                        <th className="text-right">ยอดส่งเบิก (รพ.)</th>
                        <th className="text-right">ชดเชยแล้ว (STM)</th>
                        <th className="text-right">ติด C (฿)</th>
                        <th className="text-center">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.smtTransfers.map((t, idx) => (
                        <tr key={idx}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{t.runDate || '-'}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {t.refDocNo || t.batchNo || ''}
                            </div>
                          </td>
                          <td style={{ fontWeight: 600 }}>{t.fundName}</td>
                          <td>
                            <span className="status-tag pending">{t.categoryName}</span>
                          </td>
                          <td>
                            <div>{t.mophId || '-'}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {t.mophDesc || ''}
                            </div>
                          </td>
                          <td className="text-right">฿{formatCurrency(t.allocatedAmount)}</td>
                          <td className="text-right" style={{ fontWeight: 600 }}>
                            ฿{formatCurrency(t.netTransferred)}
                          </td>
                          <td className="text-right">฿{formatCurrency(t.claimedAmount)}</td>
                          <td className="text-right highlight-good">
                            ฿{formatCurrency(t.stmPaidAmount)}
                          </td>
                          <td className="text-right highlight-warn">
                            {t.pendingCAmount > 0 ? `฿${formatCurrency(t.pendingCAmount)}` : '-'}
                          </td>
                          <td className="text-center">
                            <span className={`status-tag ${t.status}`}>
                              {t.status === 'settled'
                                ? 'ชดเชยครบ'
                                : t.status === 'partial'
                                ? 'ชดเชยบางส่วน'
                                : 'รอ Statement'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="state-container" style={{ padding: '3rem' }}>
                  <p style={{ color: '#64748b' }}>
                    ยังไม่พบข้อมูลงบประมาณ SMT ในปีงบประมาณ {budgetYear} กรุณากดซิงค์ข้อมูลจากหน้า SMT / e-Budget
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Top 10 C-Codes Root Cause */}
          {activeTab === 'top_c' && (
            <div className="matrix-container">
              <div className="info-box-blue">
                <span>🎯</span>
                <span>
                  รหัสติด C และรหัสปฏิเสธจ่ายที่กระทบต่อกระแสเงินสดของโรงพยาบาลสูงสุด 10 อันดับแรก พร้อมแนวทางแก้ไขเพื่อมอบหมายงานให้ทีมเวชระเบียนและพยาบาลตรวจสอบ
                </span>
              </div>

              {data.topCCodes && data.topCCodes.length > 0 ? (
                <div className="table-responsive">
                  <table className="exec-table">
                    <thead>
                      <tr>
                        <th style={{ width: '100px' }}>รหัส C/Deny</th>
                        <th className="text-right" style={{ width: '110px' }}>จำนวนเคส</th>
                        <th className="text-right" style={{ width: '130px' }}>ยอดเงินติดค้าง</th>
                        <th style={{ width: '180px' }}>บริการที่กระทบ</th>
                        <th>คำอธิบายปัญหา</th>
                        <th>คำแนะนำแนวทางแก้ไข (Guide)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topCCodes.map((c, idx) => (
                        <tr key={idx}>
                          <td>
                            <span className="kpi-badge badge-orange" style={{ fontSize: '0.85rem' }}>
                              {c.code}
                            </span>
                          </td>
                          <td className="text-right" style={{ fontWeight: 600 }}>
                            {formatNumber(c.count)}
                          </td>
                          <td className="text-right highlight-warn" style={{ fontWeight: 700 }}>
                            ฿{formatCurrency(c.amount)}
                          </td>
                          <td>
                            {c.affectedServices.map((s, sIdx) => (
                              <span key={sIdx} className="status-tag pending" style={{ marginRight: '4px', marginBottom: '2px' }}>
                                {s}
                              </span>
                            ))}
                          </td>
                          <td style={{ color: '#334155' }}>{c.description}</td>
                          <td style={{ color: '#0369a1', fontSize: '0.825rem' }}>
                            💡 {c.guide}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="state-container" style={{ padding: '3rem' }}>
                  <p style={{ color: '#16a34a', fontWeight: 600 }}>
                    🎉 ยอดเยี่ยม! ไม่พบรายการที่ติด C หรือ Deny ในช่วงเวลาที่เลือก
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default ExecutiveMonitorPage;
