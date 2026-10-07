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

export interface SubSchemeDetail {
  name: string;
  claimedAmount: number;
  claimedCount: number;
  reimbursedAmount: number;
  reimbursedCount: number;
  pendingCAmount: number;
  pendingCCount: number;
}

export interface RightSchemeSummary extends MetricItem {
  rightKey: string;
  rightName: string;
  rightIcon: string;
  rightDescription: string;
  subSchemes?: SubSchemeDetail[];
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
  claimedCount: number;
  reimbursedAmount: number;
  reimbursedCount: number;
  pendingCAmount: number;
  pendingCCount: number;
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

export interface ExecutivePipelineMetrics {
  totalHospitalVisits: number;
  hospitalOpdVisits: number;
  hospitalIpdVisits: number;
  totalClaimedCount: number;
  totalClaimedAmount: number;
  submissionRate: number;
  unclaimedCount: number;
  unclaimedRate: number;
  totalReimbursedCount: number;
  totalReimbursedAmount: number;
  reimbursementVisitRate: number;
  reimbursementAmountRate: number;
  totalDeniedCount: number;
  totalDeniedAmount: number;
  denialVisitRate: number;
  denialAmountRate: number;
  pendingTransferAmount: number;
  pendingTransferCount: number;
  pendingTransferRate: number;
  transferredAmount: number;
  transferredCount: number;
  transferredRate: number;
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
  pipeline?: ExecutivePipelineMetrics;
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
  const [matrixDisplayMode, setMatrixDisplayMode] = useState<'amount' | 'visits' | 'both'>('both');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExecutiveMonitorResult | null>(null);
  const [selectedSubSchemeRight, setSelectedSubSchemeRight] = useState<RightSchemeSummary | null>(null);
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
    const visitRecoveryRate = data.summary.totalClaimedCount > 0
      ? Math.round((data.summary.totalReimbursedCount / data.summary.totalClaimedCount) * 10000) / 100
      : 0;
    const visitCRate = data.summary.totalClaimedCount > 0
      ? Math.round((data.summary.totalPendingCCount / data.summary.totalClaimedCount) * 10000) / 100
      : 0;

    const summaryRows = [
      { ตัวชี้วัด: 'ปีงบประมาณ e-Budget SMT', ค่า: data.period.budgetYear },
      { ตัวชี้วัด: 'ช่วงวันที่ประมวลผล', ค่า: `${data.period.startDate || 'ทั้งหมด'} ถึง ${data.period.endDate || 'ปัจจุบัน'}` },
      { ตัวชี้วัด: '--- กระบวนการเบิกจ่ายและชดเชยครบวงจร (6 ขั้นตอน) ---', ค่า: '' },
      { ตัวชี้วัด: '1. Visit ทั้งหมดในโรงพยาบาล (HOSxP)', ค่า: data.pipeline?.totalHospitalVisits || 0 },
      { ตัวชี้วัด: '   - ผู้ป่วยนอก (OPD Visits)', ค่า: data.pipeline?.hospitalOpdVisits || 0 },
      { ตัวชี้วัด: '   - ผู้ป่วยใน (IPD Admissions)', ค่า: data.pipeline?.hospitalIpdVisits || 0 },
      { ตัวชี้วัด: '2. ส่งเบิกทั้งหมด (Claimed Amount ฿)', ค่า: data.pipeline?.totalClaimedAmount || data.summary.totalClaimedAmount },
      { ตัวชี้วัด: '   - จำนวน Visit ส่งเบิก (Claimed Visits)', ค่า: data.pipeline?.totalClaimedCount || data.summary.totalClaimedCount },
      { ตัวชี้วัด: '   - อัตราการส่งข้อมูลครบ (Submission Completeness %)', ค่า: `${data.pipeline?.submissionRate || 0}%` },
      { ตัวชี้วัด: '   - จำนวน Visit ยังไม่ส่งเบิก (Unclaimed)', ค่า: data.pipeline?.unclaimedCount || 0 },
      { ตัวชี้วัด: '3. ได้รับการชดเชยแล้ว (Reimbursed STM ฿)', ค่า: data.pipeline?.totalReimbursedAmount || data.summary.totalReimbursedAmount },
      { ตัวชี้วัด: '   - จำนวน Visit ชดเชย (Paid Visits)', ค่า: data.pipeline?.totalReimbursedCount || data.summary.totalReimbursedCount },
      { ตัวชี้วัด: '   - อัตราการชดเชยตามยอดเงิน (Amount Recovery %)', ค่า: `${data.pipeline?.reimbursementAmountRate || data.summary.reimbursementRate}%` },
      { ตัวชี้วัด: '   - อัตราการชดเชยตามจำนวน Visit (Visit Recovery %)', ค่า: `${data.pipeline?.reimbursementVisitRate || visitRecoveryRate}%` },
      { ตัวชี้วัด: '4. ปฏิเสธการจ่ายทั้งหมด / ติด C (Denied Amount ฿)', ค่า: data.pipeline?.totalDeniedAmount || data.summary.totalPendingCAmount },
      { ตัวชี้วัด: '   - จำนวน Visit ติด C / ปฏิเสธจ่าย', ค่า: data.pipeline?.totalDeniedCount || data.summary.totalPendingCCount },
      { ตัวชี้วัด: '   - อัตราการติด C / ปฏิเสธตามจำนวน Visit (%)', ค่า: `${data.pipeline?.denialVisitRate || visitCRate}%` },
      { ตัวชี้วัด: '   - อัตราการติด C / ปฏิเสธตามยอดเงิน (%)', ค่า: `${data.pipeline?.denialAmountRate || 0}%` },
      { ตัวชี้วัด: '5. รอเงินโอน (Pending Wire Transfer ฿)', ค่า: data.pipeline?.pendingTransferAmount || data.summary.totalSmtWaitAmount },
      { ตัวชี้วัด: '   - สัดส่วนรอเงินโอน (%)', ค่า: `${data.pipeline?.pendingTransferRate || 0}%` },
      { ตัวชี้วัด: '6. รับเงินแล้ว / โอนเข้าบัญชีแล้ว (Transferred ฿)', ค่า: data.pipeline?.transferredAmount || data.summary.totalSmtNetTransferred },
      { ตัวชี้วัด: '   - อัตราการรับเงินโอนเข้าบัญชี (%)', ค่า: `${data.pipeline?.transferredRate || 0}%` },
      { ตัวชี้วัด: '--- งบประมาณและการเงินภาพรวม ---', ค่า: '' },
      { ตัวชี้วัด: 'ยอดจัดสรรตาม e-Budget SMT', ค่า: data.summary.totalSmtAllocatedAmount },
      { ตัวชี้วัด: 'ยอดเงินโอนสุทธิ SMT', ค่า: data.summary.totalSmtNetTransferred },
      { ตัวชี้วัด: 'ยอดผลต่าง/คงค้าง (Variance ฿)', ค่า: data.summary.varianceAmount },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'KPI สรุปภาพรวม');

    // Sheet 2: By Service Breakdown
    const serviceRows = Object.values(data.byService).map((s) => ({
      หมวดบริการ: s.categoryName,
      ยอดส่งเบิก_บาท: s.claimedAmount,
      จำนวน_Visit_ส่งเบิก: s.claimedCount,
      ยอดติด_C_บาท: s.pendingCAmount,
      จำนวน_Visit_ติด_C: s.pendingCCount,
      ชดเชยแล้ว_STM_บาท: s.reimbursedAmount,
      จำนวน_Visit_ชดเชย: s.reimbursedCount,
      อัตราการชดเชย_ยอดเงิน_เปอร์เซ็นต์: s.reimbursementRate,
      อัตราการชดเชย_Visit_เปอร์เซ็นต์: s.claimedCount > 0 ? Math.round((s.reimbursedCount / s.claimedCount) * 10000) / 100 : 0,
      งบจัดสรร_SMT: s.smtAllocatedAmount,
      โอนสุทธิ_SMT: s.smtNetTransferred,
    }));
    const wsService = XLSX.utils.json_to_sheet(serviceRows);
    XLSX.utils.book_append_sheet(wb, wsService, 'แยกตามบริการ');

    // Sheet 3: By Right Breakdown
    const rightRows = Object.values(data.byRight).map((r) => ({
      สิทธิการรักษา: r.rightName,
      ยอดส่งเบิก_บาท: r.claimedAmount,
      จำนวน_Visit_ส่งเบิก: r.claimedCount,
      ยอดติด_C_บาท: r.pendingCAmount,
      จำนวน_Visit_ติด_C: r.pendingCCount,
      ชดเชยแล้ว_STM_บาท: r.reimbursedAmount,
      จำนวน_Visit_ชดเชย: r.reimbursedCount,
      อัตราการชดเชย_ยอดเงิน_เปอร์เซ็นต์: r.reimbursementRate,
      อัตราการชดเชย_Visit_เปอร์เซ็นต์: r.claimedCount > 0 ? Math.round((r.reimbursedCount / r.claimedCount) * 10000) / 100 : 0,
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
        ยอดจัดสรร_บาท: t.allocatedAmount,
        โอนสุทธิ_บาท: t.netTransferred,
        ยอดส่งเบิก_รพ_บาท: t.claimedAmount,
        จำนวน_Visit_ส่งเบิก: t.claimedCount || 0,
        ชดเชยแล้ว_STM_บาท: t.stmPaidAmount,
        จำนวน_Visit_ชดเชย: t.reimbursedCount || 0,
        ยอดติด_C_บาท: t.pendingCAmount,
        จำนวน_Visit_ติด_C: t.pendingCCount || 0,
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
        จำนวน_Visit_ติด_C: c.count,
        ยอดเงินรวม_บาท: c.amount,
        บริการที่ได้รับผลกระทบ: c.affectedServices.join(', '),
        คำอธิบาย: c.description,
        แนวทางแก้ไข: c.guide,
      }));
      const wsC = XLSX.utils.json_to_sheet(cRows);
      XLSX.utils.book_append_sheet(wb, wsC, 'วิเคราะห์รหัสติด_C');
    }

    // Sheet 6: Sub-schemes Breakdown
    const subSchemeRows: Array<{
      สิทธิหลัก: string;
      สิทธิย่อย: string;
      ยอดส่งเบิก_บาท: number;
      จำนวน_Visit_ส่งเบิก: number;
      ยอดติด_C_บาท: number;
      จำนวน_Visit_ติด_C: number;
      ชดเชยแล้ว_STM_บาท: number;
      จำนวน_Visit_ชดเชย: number;
      อัตราการชดเชย_เปอร์เซ็นต์: number;
    }> = [];

    for (const rk of Object.keys(data.byRight)) {
      const right = data.byRight[rk];
      if (right.subSchemes && right.subSchemes.length > 0) {
        for (const sub of right.subSchemes) {
          const rate = sub.claimedAmount > 0
            ? Math.round((sub.reimbursedAmount / sub.claimedAmount) * 10000) / 100
            : 0;
          subSchemeRows.push({
            สิทธิหลัก: right.rightName,
            สิทธิย่อย: sub.name,
            ยอดส่งเบิก_บาท: sub.claimedAmount,
            จำนวน_Visit_ส่งเบิก: sub.claimedCount,
            ยอดติด_C_บาท: sub.pendingCAmount,
            จำนวน_Visit_ติด_C: sub.pendingCCount,
            ชดเชยแล้ว_STM_บาท: sub.reimbursedAmount,
            จำนวน_Visit_ชดเชย: sub.reimbursedCount,
            อัตราการชดเชย_เปอร์เซ็นต์: rate,
          });
        }
      }
    }

    if (subSchemeRows.length > 0) {
      const wsSub = XLSX.utils.json_to_sheet(subSchemeRows);
      XLSX.utils.book_append_sheet(wb, wsSub, 'สิทธิย่อยและกองทุน');
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

  // Visit summary percentages
  const totalClaimedCount = data?.summary.totalClaimedCount || 0;
  const totalPendingCCount = data?.summary.totalPendingCCount || 0;
  const totalReimbursedCount = data?.summary.totalReimbursedCount || 0;
  const visitCRate = totalClaimedCount > 0 ? ((totalPendingCCount / totalClaimedCount) * 100).toFixed(1) : '0.0';
  const visitReimburseRate = totalClaimedCount > 0 ? ((totalReimbursedCount / totalClaimedCount) * 100).toFixed(1) : '0.0';

  return (
    <div className="executive-monitor-page">
      {/* Page Header */}
      <div className="exec-header">
        <div className="exec-title-group">
          <h1>
            <span>🏛️</span> มอนิเตอร์ผู้บริหาร (Executive Claim & Revenue Matrix)
          </h1>
          <p className="exec-subtitle">
            บูรณาการ 3 ฐานข้อมูล (REP ตอบรับเรียกเก็บ, STM สเตทเมนต์ชดเชยจริง, e-Budget/SMT งบจัดสรร สปสช.) พร้อมติดตามยอดเงินและจำนวน Visit ครบถ้วน
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
                <span>จำนวน Visit ส่งเบิก:</span>
                <span className="kpi-badge badge-blue">
                  {formatNumber(data.summary.totalClaimedCount)} visits
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
                <span>จำนวน Visit ติด C:</span>
                <span className="kpi-badge badge-orange">
                  {formatNumber(data.summary.totalPendingCCount)} visits ({visitCRate}%)
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
                <span>จำนวน Visit ชดเชย:</span>
                <span className="kpi-badge badge-green">
                  {formatNumber(data.summary.totalReimbursedCount)} visits ({visitReimburseRate}%)
                </span>
              </div>
              <div className="kpi-sub-row" style={{ borderTop: 'none', paddingTop: 0 }}>
                <span>อัตราการชดเชยยอดเงิน:</span>
                <strong style={{ color: '#047857' }}>{data.summary.reimbursementRate}%</strong>
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

          {/* End-to-End Claim & Revenue Cycle Funnel (6 Stages) */}
          <div className="exec-pipeline-section">
            <div className="exec-pipeline-header">
              <div className="exec-pipeline-title-group">
                <h2>
                  <span>🔄</span> ท่อกระบวนการเบิกจ่ายและชดเชยครบวงจร (Revenue Cycle & Claim Completeness Funnel)
                </h2>
                <p className="exec-subtitle">
                  ติดตามอัตราการไหลเวียนของข้อมูลครบทุกมิติ: ตั้งแต่ผู้ป่วยมารับบริการ จนถึงการรับเงินโอนเข้าบัญชีโรงพยาบาลจริง
                </p>
              </div>
              <div className="exec-pipeline-kpi-pills">
                <div className="pipeline-pill pill-blue">
                  <span>📤 อัตราส่งข้อมูลครบ:</span>
                  <strong>{data.pipeline?.submissionRate ?? 0}%</strong>
                </div>
                <div className="pipeline-pill pill-green">
                  <span>💰 อัตราชดเชยสำเร็จ:</span>
                  <strong>{data.pipeline?.reimbursementAmountRate ?? 0}%</strong>
                </div>
                <div className="pipeline-pill pill-purple">
                  <span>🏦 อัตราเงินเข้าบัญชี:</span>
                  <strong>{data.pipeline?.transferredRate ?? 0}%</strong>
                </div>
              </div>
            </div>

            <div className="exec-pipeline-flow">
              {/* Step 1: Visit ทั้งหมด */}
              <div className="pipeline-step-card step-1">
                <div className="step-card-num">ขั้นตอนที่ 1 • ต้นทาง รพ.</div>
                <div className="step-card-title">
                  <span>🏥</span> Visit ทั้งหมด
                </div>
                <div className="step-card-main-val">
                  {formatNumber(data.pipeline?.totalHospitalVisits ?? 0)}
                  <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#64748b', marginLeft: '4px' }}>visits</span>
                </div>
                <div className="step-card-sub">
                  OPD: {formatNumber(data.pipeline?.hospitalOpdVisits ?? 0)} • IPD: {formatNumber(data.pipeline?.hospitalIpdVisits ?? 0)}
                </div>
                <span className="step-card-badge" style={{ background: '#f1f5f9', color: '#475569' }}>
                  ฐานบริการ รพ. (HOSxP)
                </span>
              </div>

              {/* Step 2: ส่งเบิกทั้งหมด */}
              <div className="pipeline-step-card step-2">
                <div className="step-card-num">ขั้นตอนที่ 2 • ส่งเบิก</div>
                <div className="step-card-title">
                  <span>📤</span> ส่งเบิกทั้งหมด
                </div>
                <div className="step-card-main-val" style={{ color: '#2563eb' }}>
                  ฿{formatCurrency(data.pipeline?.totalClaimedAmount ?? data.summary.totalClaimedAmount)}
                </div>
                <div className="step-card-sub">
                  {formatNumber(data.pipeline?.totalClaimedCount ?? data.summary.totalClaimedCount)} visits • ยังไม่ส่ง {formatNumber(data.pipeline?.unclaimedCount ?? 0)} ({data.pipeline?.unclaimedRate ?? 0}%)
                </div>
                <span className="step-card-badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                  ส่งข้อมูลครบ {data.pipeline?.submissionRate ?? 0}%
                </span>
              </div>

              {/* Step 3: ได้รับชดเชยทั้งหมด */}
              <div className="pipeline-step-card step-3">
                <div className="step-card-num">ขั้นตอนที่ 3 • ชดเชย</div>
                <div className="step-card-title">
                  <span>💰</span> ได้รับชดเชยทั้งหมด
                </div>
                <div className="step-card-main-val" style={{ color: '#059669' }}>
                  ฿{formatCurrency(data.pipeline?.totalReimbursedAmount ?? data.summary.totalReimbursedAmount)}
                </div>
                <div className="step-card-sub">
                  {formatNumber(data.pipeline?.totalReimbursedCount ?? data.summary.totalReimbursedCount)} visits • อัตรา visit {data.pipeline?.reimbursementVisitRate ?? 0}%
                </div>
                <span className="step-card-badge" style={{ background: '#ecfdf5', color: '#047857' }}>
                  ชดเชยแล้ว {data.pipeline?.reimbursementAmountRate ?? data.summary.reimbursementRate}%
                </span>
              </div>

              {/* Step 4: ปฏิเสธการจ่ายทั้งหมด / ติด C */}
              <div className="pipeline-step-card step-4">
                <div className="step-card-num">ขั้นตอนที่ 4 • ติด C / ปฏิเสธ</div>
                <div className="step-card-title">
                  <span>⚠️</span> ปฏิเสธจ่าย / ติด C
                </div>
                <div className="step-card-main-val" style={{ color: '#dc2626' }}>
                  ฿{formatCurrency(data.pipeline?.totalDeniedAmount ?? data.summary.totalPendingCAmount)}
                </div>
                <div className="step-card-sub">
                  {formatNumber(data.pipeline?.totalDeniedCount ?? data.summary.totalPendingCCount)} visits • อัตราเงิน {data.pipeline?.denialAmountRate ?? 0}%
                </div>
                <span className="step-card-badge" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                  ติด C / Deny {data.pipeline?.denialVisitRate ?? 0}%
                </span>
              </div>

              {/* Step 5: รอเงินโอน */}
              <div className="pipeline-step-card step-5">
                <div className="step-card-num">ขั้นตอนที่ 5 • รอรอบโอน</div>
                <div className="step-card-title">
                  <span>⏳</span> รอเงินโอน
                </div>
                <div className="step-card-main-val" style={{ color: '#d97706' }}>
                  ฿{formatCurrency(data.pipeline?.pendingTransferAmount ?? data.summary.totalSmtWaitAmount)}
                </div>
                <div className="step-card-sub">
                  {formatNumber(data.pipeline?.pendingTransferCount ?? 0)} รายการรอโอน • สัดส่วน {data.pipeline?.pendingTransferRate ?? 0}%
                </div>
                <span className="step-card-badge" style={{ background: '#fffbeb', color: '#b45309' }}>
                  อนุมัติแล้วรอรอบโอน
                </span>
              </div>

              {/* Step 6: รับเงินแล้ว */}
              <div className="pipeline-step-card step-6">
                <div className="step-card-num">ขั้นตอนที่ 6 • เข้าบัญชี</div>
                <div className="step-card-title">
                  <span>🏦</span> รับเงินแล้ว
                </div>
                <div className="step-card-main-val" style={{ color: '#7c3aed' }}>
                  ฿{formatCurrency(data.pipeline?.transferredAmount ?? data.summary.totalSmtNetTransferred)}
                </div>
                <div className="step-card-sub">
                  {formatNumber(data.pipeline?.transferredCount ?? 0)} รายการโอนสำเร็จ • สัดส่วน {data.pipeline?.transferredRate ?? 0}%
                </div>
                <span className="step-card-badge" style={{ background: '#f5f3ff', color: '#6d28d9' }}>
                  โอนสุทธิเข้าบัญชี รพ.
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
                <div className="matrix-controls-group">
                  {/* Metric Switch */}
                  <div className="matrix-metric-switch">
                    <button
                      className={`metric-switch-btn ${matrixMetricMode === 'claimed' ? 'active' : ''}`}
                      onClick={() => setMatrixMetricMode('claimed')}
                    >
                      ส่งเบิก (Claimed)
                    </button>
                    <button
                      className={`metric-switch-btn ${matrixMetricMode === 'c_code' ? 'active' : ''}`}
                      onClick={() => setMatrixMetricMode('c_code')}
                    >
                      ติด C / Deny
                    </button>
                    <button
                      className={`metric-switch-btn ${matrixMetricMode === 'reimbursed' ? 'active' : ''}`}
                      onClick={() => setMatrixMetricMode('reimbursed')}
                    >
                      ชดเชยแล้ว (STM)
                    </button>
                    <button
                      className={`metric-switch-btn ${matrixMetricMode === 'rate' ? 'active' : ''}`}
                      onClick={() => setMatrixMetricMode('rate')}
                    >
                      อัตราชดเชย (%)
                    </button>
                  </div>

                  {/* Display Unit Switch */}
                  <div className="matrix-display-mode-switch">
                    <button
                      className={`display-switch-btn ${matrixDisplayMode === 'amount' ? 'active' : ''}`}
                      onClick={() => setMatrixDisplayMode('amount')}
                      title="แสดงเฉพาะยอดเงินบาท"
                    >
                      💵 ยอดเงิน (฿)
                    </button>
                    <button
                      className={`display-switch-btn ${matrixDisplayMode === 'visits' ? 'active' : ''}`}
                      onClick={() => setMatrixDisplayMode('visits')}
                      title="แสดงเฉพาะจำนวน Visit"
                    >
                      👥 จำนวน Visit
                    </button>
                    <button
                      className={`display-switch-btn ${matrixDisplayMode === 'both' ? 'active' : ''}`}
                      onClick={() => setMatrixDisplayMode('both')}
                      title="แสดงทั้งยอดเงินและจำนวน Visit"
                    >
                      📑 แสดงคู่ (฿ + Visit)
                    </button>
                  </div>
                </div>
              </div>

              <div className="table-responsive">
                <table className="exec-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: '180px' }}>สิทธิการรักษา</th>
                      {serviceKeys.map((sk) => (
                        <th key={sk} className="text-right" style={{ minWidth: '135px' }}>
                          {data.byService[sk]?.categoryIcon} {data.byService[sk]?.categoryName}
                        </th>
                      ))}
                      <th className="text-right" style={{ minWidth: '150px', background: '#f1f5f9' }}>
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
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                              <span>
                                {rightItem?.rightIcon} {rightItem?.rightName}
                              </span>
                              {rightItem?.subSchemes && rightItem.subSchemes.length > 0 && (
                                <button
                                  type="button"
                                  className="subscheme-btn"
                                  onClick={() => setSelectedSubSchemeRight(rightItem)}
                                  title={`คลิกเพื่อดูสิทธิย่อย/กองทุน (${rightItem.subSchemes.length} กลุ่ม)`}
                                >
                                  🔍 {rightItem.subSchemes.length} ย่อย
                                </button>
                              )}
                            </div>
                          </td>
                          {serviceKeys.map((sk) => {
                            const cell = data.matrix[rk]?.[sk];
                            if (!cell) return <td key={sk} className="text-right">-</td>;

                            if (matrixMetricMode === 'claimed') {
                              if (matrixDisplayMode === 'visits') {
                                return (
                                  <td key={sk} className="text-right">
                                    {cell.claimedCount > 0 ? (
                                      <strong>{formatNumber(cell.claimedCount)} visit</strong>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>-</span>
                                    )}
                                  </td>
                                );
                              }
                              if (matrixDisplayMode === 'both') {
                                return (
                                  <td key={sk} className="text-right">
                                    {cell.claimedAmount > 0 ? (
                                      <div>
                                        <div>฿{formatCurrency(cell.claimedAmount)}</div>
                                        <div className="matrix-cell-sub">
                                          {formatNumber(cell.claimedCount)} visit
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>-</span>
                                    )}
                                  </td>
                                );
                              }
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
                              if (matrixDisplayMode === 'visits') {
                                return (
                                  <td
                                    key={sk}
                                    className={`text-right ${cell.pendingCCount > 0 ? 'highlight-warn' : ''}`}
                                  >
                                    {cell.pendingCCount > 0 ? (
                                      <strong>{formatNumber(cell.pendingCCount)} visit</strong>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>-</span>
                                    )}
                                  </td>
                                );
                              }
                              if (matrixDisplayMode === 'both') {
                                return (
                                  <td
                                    key={sk}
                                    className={`text-right ${cell.pendingCAmount > 0 ? 'highlight-warn' : ''}`}
                                  >
                                    {cell.pendingCAmount > 0 ? (
                                      <div>
                                        <div>฿{formatCurrency(cell.pendingCAmount)}</div>
                                        <div className="matrix-cell-sub warn">
                                          {formatNumber(cell.pendingCCount)} visit
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>-</span>
                                    )}
                                  </td>
                                );
                              }
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
                              if (matrixDisplayMode === 'visits') {
                                return (
                                  <td
                                    key={sk}
                                    className={`text-right ${cell.reimbursedCount > 0 ? 'highlight-good' : ''}`}
                                  >
                                    {cell.reimbursedCount > 0 ? (
                                      <strong>{formatNumber(cell.reimbursedCount)} visit</strong>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>-</span>
                                    )}
                                  </td>
                                );
                              }
                              if (matrixDisplayMode === 'both') {
                                return (
                                  <td
                                    key={sk}
                                    className={`text-right ${cell.reimbursedAmount > 0 ? 'highlight-good' : ''}`}
                                  >
                                    {cell.reimbursedAmount > 0 ? (
                                      <div>
                                        <div>฿{formatCurrency(cell.reimbursedAmount)}</div>
                                        <div className="matrix-cell-sub good">
                                          {formatNumber(cell.reimbursedCount)} visit
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>-</span>
                                    )}
                                  </td>
                                );
                              }
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
                              // Rate mode
                              const cellVisitRate = cell.claimedCount > 0
                                ? Math.round((cell.reimbursedCount / cell.claimedCount) * 10000) / 100
                                : 0;
                              return (
                                <td key={sk} className="text-right">
                                  {cell.claimedAmount > 0 ? (
                                    <div>
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
                                      {matrixDisplayMode !== 'amount' && (
                                        <div className="matrix-cell-sub">
                                          {cellVisitRate}% visit ({cell.reimbursedCount}/{cell.claimedCount})
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ color: '#94a3b8' }}>-</span>
                                  )}
                                </td>
                              );
                            }
                          })}

                          {/* Right Row Total */}
                          <td className="text-right" style={{ fontWeight: 700, background: '#f8fafc' }}>
                            {matrixMetricMode === 'claimed' && (
                              matrixDisplayMode === 'visits' ? (
                                `${formatNumber(rightItem?.claimedCount)} visit`
                              ) : matrixDisplayMode === 'both' ? (
                                <div>
                                  <div>฿{formatCurrency(rightItem?.claimedAmount)}</div>
                                  <div className="matrix-cell-sub">
                                    {formatNumber(rightItem?.claimedCount)} visit
                                  </div>
                                </div>
                              ) : (
                                `฿${formatCurrency(rightItem?.claimedAmount)}`
                              )
                            )}
                            {matrixMetricMode === 'c_code' && (
                              matrixDisplayMode === 'visits' ? (
                                <span className={rightItem?.pendingCCount ? 'highlight-warn' : ''}>
                                  {formatNumber(rightItem?.pendingCCount)} visit
                                </span>
                              ) : matrixDisplayMode === 'both' ? (
                                <div>
                                  <div className={rightItem?.pendingCAmount ? 'highlight-warn' : ''}>
                                    ฿{formatCurrency(rightItem?.pendingCAmount)}
                                  </div>
                                  <div className="matrix-cell-sub warn">
                                    {formatNumber(rightItem?.pendingCCount)} visit
                                  </div>
                                </div>
                              ) : (
                                <span className={rightItem?.pendingCAmount ? 'highlight-warn' : ''}>
                                  ฿{formatCurrency(rightItem?.pendingCAmount)}
                                </span>
                              )
                            )}
                            {matrixMetricMode === 'reimbursed' && (
                              matrixDisplayMode === 'visits' ? (
                                <span className="highlight-good">
                                  {formatNumber(rightItem?.reimbursedCount)} visit
                                </span>
                              ) : matrixDisplayMode === 'both' ? (
                                <div>
                                  <div className="highlight-good">
                                    ฿{formatCurrency(rightItem?.reimbursedAmount)}
                                  </div>
                                  <div className="matrix-cell-sub good">
                                    {formatNumber(rightItem?.reimbursedCount)} visit
                                  </div>
                                </div>
                              ) : (
                                <span className="highlight-good">
                                  ฿{formatCurrency(rightItem?.reimbursedAmount)}
                                </span>
                              )
                            )}
                            {matrixMetricMode === 'rate' && (
                              <div>
                                <span>{rightItem?.reimbursementRate}%</span>
                                {matrixDisplayMode !== 'amount' && (
                                  <div className="matrix-cell-sub">
                                    {rightItem?.claimedCount
                                      ? `${((rightItem.reimbursedCount / rightItem.claimedCount) * 100).toFixed(1)}% visit`
                                      : '-'}
                                  </div>
                                )}
                              </div>
                            )}
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
                            {matrixMetricMode === 'claimed' && (
                              matrixDisplayMode === 'visits' ? (
                                `${formatNumber(sItem?.claimedCount)} visit`
                              ) : matrixDisplayMode === 'both' ? (
                                <div>
                                  <div>฿{formatCurrency(sItem?.claimedAmount)}</div>
                                  <div className="matrix-cell-sub">
                                    {formatNumber(sItem?.claimedCount)} visit
                                  </div>
                                </div>
                              ) : (
                                `฿${formatCurrency(sItem?.claimedAmount)}`
                              )
                            )}
                            {matrixMetricMode === 'c_code' && (
                              matrixDisplayMode === 'visits' ? (
                                <span className={sItem?.pendingCCount ? 'highlight-warn' : ''}>
                                  {formatNumber(sItem?.pendingCCount)} visit
                                </span>
                              ) : matrixDisplayMode === 'both' ? (
                                <div>
                                  <div className={sItem?.pendingCAmount ? 'highlight-warn' : ''}>
                                    ฿{formatCurrency(sItem?.pendingCAmount)}
                                  </div>
                                  <div className="matrix-cell-sub warn">
                                    {formatNumber(sItem?.pendingCCount)} visit
                                  </div>
                                </div>
                              ) : (
                                <span className={sItem?.pendingCAmount ? 'highlight-warn' : ''}>
                                  ฿{formatCurrency(sItem?.pendingCAmount)}
                                </span>
                              )
                            )}
                            {matrixMetricMode === 'reimbursed' && (
                              matrixDisplayMode === 'visits' ? (
                                <span className="highlight-good">
                                  {formatNumber(sItem?.reimbursedCount)} visit
                                </span>
                              ) : matrixDisplayMode === 'both' ? (
                                <div>
                                  <div className="highlight-good">
                                    ฿{formatCurrency(sItem?.reimbursedAmount)}
                                  </div>
                                  <div className="matrix-cell-sub good">
                                    {formatNumber(sItem?.reimbursedCount)} visit
                                  </div>
                                </div>
                              ) : (
                                <span className="highlight-good">
                                  ฿{formatCurrency(sItem?.reimbursedAmount)}
                                </span>
                              )
                            )}
                            {matrixMetricMode === 'rate' && (
                              <div>
                                <span>{sItem?.reimbursementRate}%</span>
                                {matrixDisplayMode !== 'amount' && (
                                  <div className="matrix-cell-sub">
                                    {sItem?.claimedCount
                                      ? `${((sItem.reimbursedCount / sItem.claimedCount) * 100).toFixed(1)}% visit`
                                      : '-'}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-right" style={{ background: '#e2e8f0', color: '#0f172a' }}>
                        {matrixMetricMode === 'claimed' && (
                          matrixDisplayMode === 'visits' ? (
                            `${formatNumber(data.summary.totalClaimedCount)} visits`
                          ) : matrixDisplayMode === 'both' ? (
                            <div>
                              <div>฿{formatCurrency(data.summary.totalClaimedAmount)}</div>
                              <div className="matrix-cell-sub">
                                {formatNumber(data.summary.totalClaimedCount)} visits
                              </div>
                            </div>
                          ) : (
                            `฿${formatCurrency(data.summary.totalClaimedAmount)}`
                          )
                        )}
                        {matrixMetricMode === 'c_code' && (
                          matrixDisplayMode === 'visits' ? (
                            <span className="highlight-warn">
                              {formatNumber(data.summary.totalPendingCCount)} visits
                            </span>
                          ) : matrixDisplayMode === 'both' ? (
                            <div>
                              <div className="highlight-warn">
                                ฿{formatCurrency(data.summary.totalPendingCAmount)}
                              </div>
                              <div className="matrix-cell-sub warn">
                                {formatNumber(data.summary.totalPendingCCount)} visits
                              </div>
                            </div>
                          ) : (
                            <span className="highlight-warn">
                              ฿{formatCurrency(data.summary.totalPendingCAmount)}
                            </span>
                          )
                        )}
                        {matrixMetricMode === 'reimbursed' && (
                          matrixDisplayMode === 'visits' ? (
                            <span className="highlight-good">
                              {formatNumber(data.summary.totalReimbursedCount)} visits
                            </span>
                          ) : matrixDisplayMode === 'both' ? (
                            <div>
                              <div className="highlight-good">
                                ฿{formatCurrency(data.summary.totalReimbursedAmount)}
                              </div>
                              <div className="matrix-cell-sub good">
                                {formatNumber(data.summary.totalReimbursedCount)} visits
                              </div>
                            </div>
                          ) : (
                            <span className="highlight-good">
                              ฿{formatCurrency(data.summary.totalReimbursedAmount)}
                            </span>
                          )
                        )}
                        {matrixMetricMode === 'rate' && (
                          <div>
                            <span>{data.summary.reimbursementRate}%</span>
                            {matrixDisplayMode !== 'amount' && (
                              <div className="matrix-cell-sub">
                                {visitReimburseRate}% visit
                              </div>
                            )}
                          </div>
                        )}
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
                const sVisitRate = s.claimedCount > 0
                  ? ((s.reimbursedCount / s.claimedCount) * 100).toFixed(1)
                  : '0.0';
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
                        <div style={{ fontSize: '0.8rem', color: '#1e293b', fontWeight: 600, marginTop: '2px' }}>
                          👥 {formatNumber(s.claimedCount)} visits
                        </div>
                      </div>

                      <div className="s-metric-item">
                        <div className="s-metric-label">ติด C / Deny</div>
                        <div className="s-metric-val" style={{ color: '#c2410c' }}>
                          ฿{formatCurrency(s.pendingCAmount)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#c2410c', fontWeight: 600, marginTop: '2px' }}>
                          ⚠️ {formatNumber(s.pendingCCount)} visits
                        </div>
                      </div>

                      <div className="s-metric-item">
                        <div className="s-metric-label">ชดเชยแล้ว</div>
                        <div className="s-metric-val" style={{ color: '#047857' }}>
                          ฿{formatCurrency(s.reimbursedAmount)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#047857', fontWeight: 600, marginTop: '2px' }}>
                          ✅ {formatNumber(s.reimbursedCount)} visits
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', color: '#475569', marginBottom: '0.75rem', padding: '0.35rem 0.5rem', background: '#f8fafc', borderRadius: '6px' }}>
                      <span>อัตราชดเชยยอดเงิน: <strong>{s.reimbursementRate}%</strong></span>
                      <span>อัตราชดเชย Visit: <strong style={{ color: '#047857' }}>{sVisitRate}%</strong></span>
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
                              {formatNumber(item.count)} visits (฿{formatCurrency(item.amount)})
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
                  ตารางนี้เปรียบเทียบงบประมาณที่สำนักงานหลักประกันสุขภาพแห่งชาติ (สปสช.) จัดสรรผ่านระบบ e-Budget/SMT กับการเรียกเก็บ, Statement จริง, และจำนวน Visit ที่ส่งเบิก/ชดเชย/ติด C
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
                        <th className="text-right">งบจัดสรร (฿)</th>
                        <th className="text-right">โอนสุทธิ (฿)</th>
                        <th className="text-right">ส่งเบิก รพ. (฿ & Visit)</th>
                        <th className="text-right">ชดเชย STM (฿ & Visit)</th>
                        <th className="text-right">ติด C (฿ & Visit)</th>
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
                          <td className="text-right">
                            <div>฿{formatCurrency(t.claimedAmount)}</div>
                            <div className="matrix-cell-sub">
                              {formatNumber(t.claimedCount)} visits
                            </div>
                          </td>
                          <td className="text-right highlight-good">
                            <div>฿{formatCurrency(t.stmPaidAmount)}</div>
                            <div className="matrix-cell-sub good">
                              {formatNumber(t.reimbursedCount)} visits
                            </div>
                          </td>
                          <td className="text-right highlight-warn">
                            {t.pendingCAmount > 0 ? (
                              <div>
                                <div>฿{formatCurrency(t.pendingCAmount)}</div>
                                <div className="matrix-cell-sub warn">
                                  {formatNumber(t.pendingCCount)} visits
                                </div>
                              </div>
                            ) : (
                              '-'
                            )}
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
                  รหัสติด C และรหัสปฏิเสธจ่ายที่กระทบต่อกระแสเงินสดของโรงพยาบาลสูงสุด 10 อันดับแรก เรียงตามจำนวน Visit ที่ติดปัญหาและมูลค่าเงิน พร้อมแนวทางแก้ไขเพื่อส่งต่อให้ทีมเวชระเบียนและพยาบาลตรวจสอบ
                </span>
              </div>

              {data.topCCodes && data.topCCodes.length > 0 ? (
                <div className="table-responsive">
                  <table className="exec-table">
                    <thead>
                      <tr>
                        <th style={{ width: '100px' }}>รหัส C/Deny</th>
                        <th className="text-right" style={{ width: '130px' }}>จำนวน Visit ที่ติด C</th>
                        <th className="text-right" style={{ width: '140px' }}>ยอดเงินติดค้าง</th>
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
                            {formatNumber(c.count)} visits
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

          {/* Sub-schemes Modal */}
          {selectedSubSchemeRight && (
            <div className="subscheme-modal-backdrop" onClick={() => setSelectedSubSchemeRight(null)}>
              <div className="subscheme-modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="subscheme-modal-header">
                  <div>
                    <h3>
                      {selectedSubSchemeRight.rightIcon} รายละเอียดสิทธิย่อย: {selectedSubSchemeRight.rightName}
                    </h3>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                      {selectedSubSchemeRight.rightDescription}
                    </p>
                  </div>
                  <button
                    className="modal-close-btn"
                    onClick={() => setSelectedSubSchemeRight(null)}
                    title="ปิดหน้าต่าง"
                  >
                    ✕
                  </button>
                </div>

                <div className="table-responsive" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  <table className="exec-table">
                    <thead>
                      <tr>
                        <th>ชื่อสิทธิย่อย / กองทุน</th>
                        <th className="text-right">ส่งเบิก (฿)</th>
                        <th className="text-right">จำนวน Visit</th>
                        <th className="text-right">ติด C (฿)</th>
                        <th className="text-right">Visit ติด C</th>
                        <th className="text-right">ชดเชยแล้ว (฿)</th>
                        <th className="text-right">Visit ชดเชย</th>
                        <th className="text-right">อัตราชดเชย (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSubSchemeRight.subSchemes && selectedSubSchemeRight.subSchemes.length > 0 ? (
                        selectedSubSchemeRight.subSchemes.map((sub, idx) => {
                          const rate = sub.claimedAmount > 0
                            ? Math.round((sub.reimbursedAmount / sub.claimedAmount) * 10000) / 100
                            : 0;
                          return (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{sub.name}</td>
                              <td className="text-right">฿{formatCurrency(sub.claimedAmount)}</td>
                              <td className="text-right">{formatNumber(sub.claimedCount)}</td>
                              <td className={`text-right ${sub.pendingCAmount > 0 ? 'highlight-warn' : ''}`}>
                                ฿{formatCurrency(sub.pendingCAmount)}
                              </td>
                              <td className="text-right">{formatNumber(sub.pendingCCount)}</td>
                              <td className={`text-right ${sub.reimbursedAmount > 0 ? 'highlight-good' : ''}`}>
                                ฿{formatCurrency(sub.reimbursedAmount)}
                              </td>
                              <td className="text-right">{formatNumber(sub.reimbursedCount)}</td>
                              <td className="text-right">
                                <span className={rate >= 80 ? 'highlight-good' : rate < 50 ? 'highlight-alert' : ''}>
                                  {rate}%
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={8} className="text-center" style={{ color: '#64748b', padding: '2rem' }}>
                            ไม่พบข้อมูลสิทธิย่อย
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button
                    className="btn-filter reset"
                    onClick={() => setSelectedSubSchemeRight(null)}
                  >
                    ปิดหน้าต่าง
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default ExecutiveMonitorPage;
