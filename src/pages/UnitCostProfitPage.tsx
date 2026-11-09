import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './UnitCostProfitPage.css';

export interface UnitCostItem {
  icode: string;
  name: string;
  category: 'herb_drug' | 'ttm_procedure' | 'pt_procedure' | 'dental_procedure' | 'general_drug' | 'other';
  categoryLabel: string;
  units: string;
  unitCost: number;
  unitPrice: number;
  qty: number;
  totalCost: number;
  totalRevenue: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
  isCostOverridden: boolean;
  status: 'high_profit' | 'moderate_profit' | 'low_profit' | 'zero_cost' | 'loss';
}

export interface UnitCostSummary {
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  totalVisits: number;
  totalQty: number;
  itemCount: number;
  profitItemCount: number;
  lossItemCount: number;
  zeroCostItemCount: number;
}

export interface UnitCostFundGroup {
  fund: string;
  fundLabel: string;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
}

export interface UnitCostMonthlyTrend {
  month: string;
  monthLabel: string;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
}

export interface UnitCostFacilityGroup {
  hospcode: string;
  name: string;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
  itemCount: number;
}

export interface UnitCostReportResponse {
  department: string;
  departmentLabel: string;
  facility: string;
  facilityLabel: string;
  period: { startDate: string; endDate: string };
  summary: UnitCostSummary;
  items: UnitCostItem[];
  fundBreakdown: UnitCostFundGroup[];
  facilityBreakdown: UnitCostFacilityGroup[];
  monthlyTrend: UnitCostMonthlyTrend[];
}

export interface UnitCostDrillDownRow {
  vstdate: string;
  vn: string;
  hn: string;
  patient_name: string;
  pttype: string;
  pttype_name: string;
  fund: string;
  icode: string;
  item_name: string;
  qty: number;
  unit_cost: number;
  unit_price: number;
  sum_price: number;
  total_cost: number;
  net_profit: number;
}

function formatCurrency(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '0.00 ฿';
  return val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ฿';
}

function formatNumber(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '0';
  return val.toLocaleString('th-TH');
}

function formatPercent(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '0.0%';
  return `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`;
}

export const UnitCostProfitPage: React.FC = () => {
  // Default to Fiscal Year 2569
  const [department, setDepartment] = useState<string>('ttm');
  const [facility, setFacility] = useState<string>('11101');
  const [category, setCategory] = useState<string>('all');
  const [fund, setFund] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('2025-10-01');
  const [endDate, setEndDate] = useState<string>('2026-09-30');

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'items' | 'funds' | 'facilities' | 'monthly'>('items');
  const [sortBy, setSortBy] = useState<keyof UnitCostItem>('netProfit');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<UnitCostReportResponse | null>(null);

  // Cost Override Modal state
  const [editModalItem, setEditModalItem] = useState<UnitCostItem | null>(null);
  const [overrideCostInput, setOverrideCostInput] = useState<string>('');
  const [overrideNoteInput, setOverrideNoteInput] = useState<string>('');
  const [overrideSaving, setOverrideSaving] = useState<boolean>(false);
  const [overrideSuccessMsg, setOverrideSuccessMsg] = useState<string | null>(null);

  // Drilldown Modal state
  const [drillModalItem, setDrillModalItem] = useState<UnitCostItem | null>(null);
  const [drillLoading, setDrillLoading] = useState<boolean>(false);
  const [drillRows, setDrillRows] = useState<UnitCostDrillDownRow[]>([]);
  const [drillError, setDrillError] = useState<string | null>(null);

  // Date Quick Selector helper
  const setQuickDateRange = (preset: 'thisMonth' | 'lastMonth' | 'fy2569' | 'fy2568') => {
    const today = new Date();
    if (preset === 'thisMonth') {
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(year, today.getMonth() + 1, 0).getDate();
      setStartDate(`${year}-${month}-01`);
      setEndDate(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    } else if (preset === 'lastMonth') {
      const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const year = prevMonthDate.getFullYear();
      const month = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(year, prevMonthDate.getMonth() + 1, 0).getDate();
      setStartDate(`${year}-${month}-01`);
      setEndDate(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    } else if (preset === 'fy2569') {
      setStartDate('2025-10-01');
      setEndDate('2026-09-30');
    } else if (preset === 'fy2568') {
      setStartDate('2024-10-01');
      setEndDate('2025-09-30');
    }
  };

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        department,
        facility,
        category,
        fund,
        startDate,
        endDate,
      });

      const res = await fetch(`/api/unit-cost/report?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `เซิร์ฟเวอร์ตอบกลับรหัส ${res.status}`);
      }
      setReport(json.data);
    } catch (err: any) {
      console.error('Fetch unit cost report failed:', err);
      setError(err.message || 'ไม่สามารถโหลดข้อมูลรายงานต้นทุนได้');
    } finally {
      setLoading(false);
    }
  }, [department, facility, category, fund, startDate, endDate]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  // Open Cost Override Modal
  const handleOpenEditCost = (item: UnitCostItem) => {
    setEditModalItem(item);
    setOverrideCostInput(String(item.unitCost || ''));
    setOverrideNoteInput('');
    setOverrideSuccessMsg(null);
  };

  // Submit Cost Override
  const handleSaveCostOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalItem) return;
    const costNum = parseFloat(overrideCostInput);
    if (isNaN(costNum) || costNum < 0) {
      alert('กรุณาระบุราคาต้นทุนที่ถูกต้อง (ตัวเลขมากกว่าหรือเท่ากับ 0)');
      return;
    }

    setOverrideSaving(true);
    try {
      const res = await fetch('/api/unit-cost/cost-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          icode: editModalItem.icode,
          unitCost: costNum,
          note: overrideNoteInput,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'บันทึกต้นทุนไม่สำเร็จ');
      }

      setOverrideSuccessMsg(`บันทึกต้นทุน ${costNum.toFixed(2)} บาท เรียบร้อยแล้ว`);
      setTimeout(() => {
        setEditModalItem(null);
        void fetchReport();
      }, 800);
    } catch (err: any) {
      alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setOverrideSaving(false);
    }
  };

  // Open Drilldown Modal
  const handleOpenDrilldown = async (item: UnitCostItem) => {
    setDrillModalItem(item);
    setDrillLoading(true);
    setDrillError(null);
    setDrillRows([]);

    try {
      const params = new URLSearchParams({
        department,
        facility,
        icode: item.icode,
        startDate,
        endDate,
        limit: '150',
      });
      const res = await fetch(`/api/unit-cost/drilldown?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถดึงข้อมูลรายเคสได้');
      }
      setDrillRows(json.data || []);
    } catch (err: any) {
      setDrillError(err.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูลเคส');
    } finally {
      setDrillLoading(false);
    }
  };

  // Filtered & Sorted items
  const filteredItems = useMemo(() => {
    if (!report?.items) return [];
    let list = [...report.items];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (it) => it.icode.toLowerCase().includes(term) || it.name.toLowerCase().includes(term)
      );
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'profit') {
        list = list.filter((it) => it.netProfit > 0);
      } else if (statusFilter === 'loss') {
        list = list.filter((it) => it.netProfit < 0);
      } else if (statusFilter === 'zero_cost') {
        list = list.filter((it) => it.unitCost === 0);
      } else if (statusFilter === 'high_margin') {
        list = list.filter((it) => it.marginPct >= 50);
      }
    }

    list.sort((a, b) => {
      let valA: any = a[sortBy];
      let valB: any = b[sortBy];
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB || '').toLowerCase();
      }
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [report?.items, searchTerm, statusFilter, sortBy, sortOrder]);

  const handleSort = (field: keyof UnitCostItem) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (!report) return;

    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary & Items
    const summaryData = [
      ['รายงานวิเคราะห์ต้นทุน & กำไรขาดทุนรายหน่วย'],
      ['หน่วยงาน/แผนก', report.departmentLabel],
      ['หน่วยบริการ', report.facilityLabel],
      ['ช่วงวันที่', `${report.period.startDate} ถึง ${report.period.endDate}`],
      [''],
      ['สรุปภาพรวม (KPI Summary)'],
      ['รายรับรวม (บาท)', report.summary.totalRevenue],
      ['ต้นทุนรวม (บาท)', report.summary.totalCost],
      ['กำไรขั้นต้นสุทธิ (บาท)', report.summary.netProfit],
      ['อัตรากำไร (Margin %)', report.summary.marginPct],
      ['จำนวนผู้รับบริการ (ครั้ง)', report.summary.totalVisits],
      ['จำนวนรวมจ่าย/บริการ (หน่วย)', report.summary.totalQty],
      ['จำนวนรายการทั้งหมด', report.summary.itemCount],
      ['รายการที่มีกำไร', report.summary.profitItemCount],
      ['รายการที่ขาดทุน', report.summary.lossItemCount],
      ['รายการที่ต้นทุน 0', report.summary.zeroCostItemCount],
      [''],
      [
        'รหัส (icode)',
        'ชื่อรายการ',
        'หมวดหมู่',
        'หน่วยนับ',
        'ต้นทุน/หน่วย (บาท)',
        'ราคาขาย/หน่วย (บาท)',
        'ปริมาณรวม (หน่วย)',
        'จำนวนครั้ง (Visit)',
        'ต้นทุนรวม (บาท)',
        'รายรับรวม (บาท)',
        'กำไรขั้นต้นสุทธิ (บาท)',
        'อัตรากำไร (%)',
        'สถานะกำไร',
        'ต้นทุนปรับแก้เอง (Override)',
      ],
      ...report.items.map((it) => [
        it.icode,
        it.name,
        it.categoryLabel,
        it.units,
        it.unitCost,
        it.unitPrice,
        it.qty,
        it.visitCount,
        it.totalCost,
        it.totalRevenue,
        it.netProfit,
        it.marginPct,
        it.status === 'high_profit'
          ? 'กำไรสูง (>50%)'
          : it.status === 'moderate_profit'
          ? 'กำไรปานกลาง'
          : it.status === 'loss'
          ? 'ขาดทุน'
          : it.status === 'zero_cost'
          ? 'ต้นทุน 0'
          : 'กำไรต่ำ/เท่าทุน',
        it.isCostOverridden ? 'ใช่' : 'ไม่ใช่',
      ]),
    ];
    const wsItems = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsItems, 'รายการยาและบริการ');

    // Sheet 2: Fund Breakdown
    if (report.fundBreakdown && report.fundBreakdown.length > 0) {
      const fundData = [
        ['สรุปต้นทุนและรายรับแยกตามกองทุนสิทธิการรักษา'],
        [''],
        ['สิทธิการรักษา', 'รายรับรวม (บาท)', 'ต้นทุนรวม (บาท)', 'กำไรสุทธิ (บาท)', 'อัตรากำไร (%)', 'จำนวนครั้ง (Visit)'],
        ...report.fundBreakdown.map((f) => [
          f.fundLabel,
          f.totalRevenue,
          f.totalCost,
          f.netProfit,
          f.marginPct,
          f.visitCount,
        ]),
      ];
      const wsFund = XLSX.utils.aoa_to_sheet(fundData);
      XLSX.utils.book_append_sheet(wb, wsFund, 'แยกตามสิทธิ (Fund)');
    }

    // Sheet 3: Facility Breakdown
    if (report.facilityBreakdown && report.facilityBreakdown.length > 0) {
      const facData = [
        ['สรุปต้นทุนและรายรับแยกตามหน่วยบริการในเครือข่าย'],
        [''],
        ['รหัสหน่วยบริการ', 'ชื่อสถานพยาบาล', 'รายรับรวม (บาท)', 'ต้นทุนรวม (บาท)', 'กำไรสุทธิ (บาท)', 'อัตรากำไร (%)', 'จำนวนรายการ', 'จำนวนครั้ง (Visit)'],
        ...report.facilityBreakdown.map((fc) => [
          fc.hospcode,
          fc.name,
          fc.totalRevenue,
          fc.totalCost,
          fc.netProfit,
          fc.marginPct,
          fc.itemCount,
          fc.visitCount,
        ]),
      ];
      const wsFac = XLSX.utils.aoa_to_sheet(facData);
      XLSX.utils.book_append_sheet(wb, wsFac, 'แยกตามหน่วยบริการ');
    }

    // Sheet 4: Monthly Trend
    if (report.monthlyTrend && report.monthlyTrend.length > 0) {
      const monthData = [
        ['แนวโน้มต้นทุนและรายรับรายเดือน'],
        [''],
        ['เดือน', 'รายรับรวม (บาท)', 'ต้นทุนรวม (บาท)', 'กำไรสุทธิ (บาท)', 'อัตรากำไร (%)', 'จำนวนครั้ง (Visit)'],
        ...report.monthlyTrend.map((m) => [
          m.monthLabel,
          m.totalRevenue,
          m.totalCost,
          m.netProfit,
          m.marginPct,
          m.visitCount,
        ]),
      ];
      const wsMonth = XLSX.utils.aoa_to_sheet(monthData);
      XLSX.utils.book_append_sheet(wb, wsMonth, 'แนวโน้มรายเดือน');
    }

    const safeDept = report.department;
    const filename = `UnitCost_Profit_${safeDept}_${report.period.startDate}_${report.period.endDate}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="unit-cost-page">
      {/* Header Banner */}
      <div className="unit-cost-header">
        <div className="header-left">
          <h2>⚖️ คำนวณต้นทุน & วิเคราะห์กำไรขาดทุนรายหน่วย</h2>
          <p className="subtitle">
            วิเคราะห์ต้นทุนซื้อ รายรับเรียกเก็บ กำไรขั้นต้น (Gross Profit) และ Margin %
            ครอบคลุมแผนกแพทย์แผนไทย & ยาสมุนไพร กายภาพบำบัด ทันตกรรม และคลังยา ทั้งโรงพยาบาลและ รพ.สต.
          </p>
        </div>
        <div className="header-right">
          <button
            type="button"
            className="btn-excel"
            onClick={handleExportExcel}
            disabled={!report || loading}
          >
            📊 ส่งออก Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Filter Card */}
      <div className="filter-card">
        <div className="filter-row">
          <div className="filter-group">
            <label>หน่วยงาน / แผนก:</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="ttm">🌿 แผนไทย & ยาสมุนไพร (TTM)</option>
              <option value="pt">🤸 กายภาพบำบัด (PT)</option>
              <option value="dental">🦷 ทันตกรรม (Dental)</option>
              <option value="pharmacy">💊 คลังยาทั้งหมด (Pharmacy)</option>
              <option value="opd_all">🏥 บริการผู้ป่วยนอกทั้งหมด (OPD All)</option>
            </select>
          </div>

          <div className="filter-group">
            <label>หน่วยบริการ (Facility):</label>
            <select value={facility} onChange={(e) => setFacility(e.target.value)}>
              <option value="11101">11101 - รพ.โคกศรีสุพรรณ (แม่ข่าย)</option>
              <option value="cup_all">🌐 ทั้งเครือข่าย CUP (รพ. + 5 รพ.สต.)</option>
              <option value="05569">05569 - รพ.สต.ด่านม่วงคำ</option>
              <option value="05570">05570 - รพ.สต.บ้านนามน</option>
              <option value="05571">05571 - รพ.สต.บ้านหนองบัว</option>
              <option value="05572">05572 - รพ.สต.บ้านโคกศรี</option>
              <option value="05573">05573 - รพ.สต.บ้านแมดคูณ</option>
            </select>
          </div>

          <div className="filter-group">
            <label>หมวดรายการ:</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">ทั้งหมด (ยาสมุนไพร + หัตถการ)</option>
              <option value="herbal">ยาสมุนไพร / ยา</option>
              <option value="procedure">ค่าบริการ / หัตถการ</option>
            </select>
          </div>

          <div className="filter-group">
            <label>กองทุนสิทธิการรักษา:</label>
            <select value={fund} onChange={(e) => setFund(e.target.value)}>
              <option value="ALL">ทุกสิทธิการรักษา (All Funds)</option>
              <option value="UCS">บัตรทอง (UCS)</option>
              <option value="SSS">ประกันสังคม (SSS)</option>
              <option value="OFC">ข้าราชการ/เบิกตรง (OFC)</option>
              <option value="LGO">องค์กรปกครองส่วนท้องถิ่น (LGO)</option>
              <option value="CASH">ชำระเงินเอง / พรบ. (Cash/Other)</option>
            </select>
          </div>
        </div>

        <div className="filter-row filter-date-row">
          <div className="filter-group date-input-group">
            <label>ตั้งแต่วันที่:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="filter-group date-input-group">
            <label>ถึงวันที่:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="quick-date-buttons">
            <button type="button" onClick={() => setQuickDateRange('thisMonth')}>
              เดือนนี้
            </button>
            <button type="button" onClick={() => setQuickDateRange('lastMonth')}>
              เดือนที่แล้ว
            </button>
            <button
              type="button"
              className={startDate === '2025-10-01' && endDate === '2026-09-30' ? 'active-quick' : ''}
              onClick={() => setQuickDateRange('fy2569')}
            >
              ปีงบ 2569
            </button>
            <button
              type="button"
              className={startDate === '2024-10-01' && endDate === '2025-09-30' ? 'active-quick' : ''}
              onClick={() => setQuickDateRange('fy2568')}
            >
              ปีงบ 2568
            </button>
          </div>

          <button
            type="button"
            className="btn-fetch"
            onClick={() => void fetchReport()}
            disabled={loading}
          >
            {loading ? '⏳ กำลังประมวลผล...' : '🔍 ค้นหา / คำนวณ'}
          </button>
        </div>
      </div>

      {error && <div className="alert-box alert-error">{error}</div>}

      {/* KPI Summary Cards */}
      {report && (
        <div className="kpi-grid">
          <div className="kpi-card kpi-revenue">
            <div className="kpi-icon">💰</div>
            <div className="kpi-content">
              <span className="kpi-label">รายรับรวมที่เรียกเก็บ</span>
              <span className="kpi-value">{formatCurrency(report.summary.totalRevenue)}</span>
              <span className="kpi-hint">จากยอด opitemrece/sum_price</span>
            </div>
          </div>

          <div className="kpi-card kpi-cost">
            <div className="kpi-icon">📦</div>
            <div className="kpi-content">
              <span className="kpi-label">ต้นทุนรวม (Cost)</span>
              <span className="kpi-value">{formatCurrency(report.summary.totalCost)}</span>
              <span className="kpi-hint">คำนวณจาก unitcost มาตรฐาน / Override</span>
            </div>
          </div>

          <div
            className={`kpi-card ${
              report.summary.netProfit >= 0 ? 'kpi-profit' : 'kpi-loss'
            }`}
          >
            <div className="kpi-icon">{report.summary.netProfit >= 0 ? '📈' : '📉'}</div>
            <div className="kpi-content">
              <span className="kpi-label">กำไรขั้นต้นสุทธิ (Gross Profit)</span>
              <span className="kpi-value">
                {formatCurrency(report.summary.netProfit)}
              </span>
              <span className="kpi-hint">
                อัตรากำไร (Margin): <strong>{formatPercent(report.summary.marginPct)}</strong>
              </span>
            </div>
          </div>

          <div className="kpi-card kpi-volume">
            <div className="kpi-icon">👥</div>
            <div className="kpi-content">
              <span className="kpi-label">ปริมาณการให้บริการ</span>
              <span className="kpi-value">
                {formatNumber(report.summary.totalVisits)}{' '}
                <small style={{ fontSize: '14px', fontWeight: 'normal' }}>ครั้ง</small>
              </span>
              <span className="kpi-hint">
                จ่ายยารวม: <strong>{formatNumber(report.summary.totalQty)}</strong> หน่วย
              </span>
            </div>
          </div>

          <div className="kpi-card kpi-stat">
            <div className="kpi-icon">📊</div>
            <div className="kpi-content">
              <span className="kpi-label">สัดส่วนรายการ</span>
              <div className="kpi-mini-stats">
                <span className="tag-profit">กำไร: {report.summary.profitItemCount} รายการ</span>
                <span className="tag-loss">ขาดทุน: {report.summary.lossItemCount} รายการ</span>
                {report.summary.zeroCostItemCount > 0 && (
                  <span className="tag-zero">ต้นทุน 0: {report.summary.zeroCostItemCount} รายการ</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Tabs Navigation */}
      {report && (
        <div className="unit-cost-tabs">
          <button
            type="button"
            className={activeTab === 'items' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveTab('items')}
          >
            📋 รายการยาและบริการ ({report.items.length})
          </button>
          <button
            type="button"
            className={activeTab === 'funds' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveTab('funds')}
          >
            🛡️ แยกตามสิทธิการรักษา ({report.fundBreakdown.length})
          </button>
          <button
            type="button"
            className={activeTab === 'facilities' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveTab('facilities')}
          >
            🏥 แยกตามหน่วยบริการ ({report.facilityBreakdown.length})
          </button>
          <button
            type="button"
            className={activeTab === 'monthly' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveTab('monthly')}
          >
            📅 แนวโน้มรายเดือน ({report.monthlyTrend.length})
          </button>
        </div>
      )}

      {/* Tab 1: Items List */}
      {report && activeTab === 'items' && (
        <div className="tab-pane">
          <div className="table-controls">
            <div className="search-box">
              <span>🔎</span>
              <input
                type="text"
                placeholder="ค้นหารหัส icode หรือชื่อรายการ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="status-filter-group">
              <label>กรองสถานะ:</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">แสดงทั้งหมด ({report.items.length})</option>
                <option value="profit">เฉพาะรายการที่มีกำไร</option>
                <option value="loss">เฉพาะรายการที่ขาดทุน</option>
                <option value="high_margin">กำไรสูง (&gt;=50%)</option>
                <option value="zero_cost">ต้นทุนยังเป็น 0 (ต้องตั้งค่า)</option>
              </select>
            </div>

            <div className="item-count-badge">
              แสดง {filteredItems.length} จาก {report.items.length} รายการ
            </div>
          </div>

          <div className="table-wrapper">
            <table className="unit-cost-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('icode')} className="sortable">
                    รหัส icode {sortBy === 'icode' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSort('name')} className="sortable">
                    ชื่อรายการ {sortBy === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th>หมวดหมู่</th>
                  <th>หน่วย</th>
                  <th onClick={() => handleSort('unitCost')} className="sortable text-right">
                    ต้นทุน/หน่วย {sortBy === 'unitCost' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSort('unitPrice')} className="sortable text-right">
                    ราคาขาย/หน่วย {sortBy === 'unitPrice' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSort('qty')} className="sortable text-right">
                    ปริมาณรวม {sortBy === 'qty' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSort('totalCost')} className="sortable text-right">
                    ต้นทุนรวม {sortBy === 'totalCost' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSort('totalRevenue')} className="sortable text-right">
                    รายรับรวม {sortBy === 'totalRevenue' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSort('netProfit')} className="sortable text-right">
                    กำไรสุทธิ {sortBy === 'netProfit' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSort('marginPct')} className="sortable text-right">
                    % Margin {sortBy === 'marginPct' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="text-center">สถานะ</th>
                  <th className="text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-center no-data">
                      ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr
                      key={item.icode}
                      className={item.netProfit < 0 ? 'row-loss' : item.unitCost === 0 ? 'row-zero' : ''}
                    >
                      <td className="code-cell">{item.icode}</td>
                      <td className="name-cell">
                        <strong>{item.name}</strong>
                      </td>
                      <td>
                        <span className="cat-badge">{item.categoryLabel}</span>
                      </td>
                      <td>{item.units || '-'}</td>
                      <td className="text-right">
                        {formatCurrency(item.unitCost)}
                        {item.isCostOverridden && (
                          <span className="override-badge" title="ปรับแก้ต้นทุนเอง">
                            ✏️ ตั้งเอง
                          </span>
                        )}
                      </td>
                      <td className="text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="text-right">{formatNumber(item.qty)}</td>
                      <td className="text-right">{formatCurrency(item.totalCost)}</td>
                      <td className="text-right">{formatCurrency(item.totalRevenue)}</td>
                      <td
                        className={`text-right font-bold ${
                          item.netProfit >= 0 ? 'text-profit' : 'text-loss'
                        }`}
                      >
                        {formatCurrency(item.netProfit)}
                      </td>
                      <td
                        className={`text-right font-bold ${
                          item.marginPct >= 0 ? 'text-profit' : 'text-loss'
                        }`}
                      >
                        {formatPercent(item.marginPct)}
                      </td>
                      <td className="text-center">
                        {item.status === 'high_profit' && (
                          <span className="status-pill status-high">กำไรสูง</span>
                        )}
                        {item.status === 'moderate_profit' && (
                          <span className="status-pill status-med">กำไรปานกลาง</span>
                        )}
                        {item.status === 'low_profit' && (
                          <span className="status-pill status-low">เท่าทุน/กำไรต่ำ</span>
                        )}
                        {item.status === 'loss' && (
                          <span className="status-pill status-loss">ขาดทุน</span>
                        )}
                        {item.status === 'zero_cost' && (
                          <span className="status-pill status-zero">ต้นทุน 0</span>
                        )}
                      </td>
                      <td className="text-center action-buttons">
                        <button
                          type="button"
                          className="btn-action btn-edit-cost"
                          title="ตั้งค่าต้นทุน/หน่วยสำหรับรายการนี้"
                          onClick={() => handleOpenEditCost(item)}
                        >
                          ✏️ ต้นทุน
                        </button>
                        <button
                          type="button"
                          className="btn-action btn-drilldown"
                          title="ดูรายชื่อคนไข้และประวัติการให้เคสนี้"
                          onClick={() => void handleOpenDrilldown(item)}
                        >
                          👥 เคส ({item.visitCount})
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Fund Breakdown */}
      {report && activeTab === 'funds' && (
        <div className="tab-pane">
          <div className="sub-header">
            <h3>🛡️ วิเคราะห์กำไรขาดทุนจำแนกตามกองทุนสิทธิการรักษา</h3>
            <p>เปรียบเทียบต้นทุน รายได้ และ Margin แต่ละสิทธิ (UCS, SSS, OFC, LGO, ชำระเงิน)</p>
          </div>

          <div className="fund-grid">
            {report.fundBreakdown.map((f) => (
              <div key={f.fund} className="fund-card">
                <div className="fund-card-header">
                  <span className="fund-tag">{f.fund}</span>
                  <h4>{f.fundLabel}</h4>
                </div>
                <div className="fund-card-body">
                  <div className="fund-stat-row">
                    <span>รายรับรวม:</span>
                    <strong>{formatCurrency(f.totalRevenue)}</strong>
                  </div>
                  <div className="fund-stat-row">
                    <span>ต้นทุนรวม:</span>
                    <span>{formatCurrency(f.totalCost)}</span>
                  </div>
                  <div className="fund-stat-row">
                    <span>กำไรสุทธิ:</span>
                    <strong className={f.netProfit >= 0 ? 'text-profit' : 'text-loss'}>
                      {formatCurrency(f.netProfit)}
                    </strong>
                  </div>
                  <div className="fund-stat-row">
                    <span>Margin %:</span>
                    <strong className={f.marginPct >= 0 ? 'text-profit' : 'text-loss'}>
                      {formatPercent(f.marginPct)}
                    </strong>
                  </div>
                  <div className="fund-stat-row">
                    <span>จำนวนเคส (Visit):</span>
                    <span>{formatNumber(f.visitCount)} ครั้ง</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="table-wrapper" style={{ marginTop: '20px' }}>
            <table className="unit-cost-table">
              <thead>
                <tr>
                  <th>รหัสสิทธิ</th>
                  <th>ชื่อสิทธิการรักษา</th>
                  <th className="text-right">จำนวนครั้ง (Visit)</th>
                  <th className="text-right">ต้นทุนรวม</th>
                  <th className="text-right">รายรับรวม</th>
                  <th className="text-right">กำไรขั้นต้นสุทธิ</th>
                  <th className="text-right">อัตรากำไร (Margin)</th>
                </tr>
              </thead>
              <tbody>
                {report.fundBreakdown.map((f) => (
                  <tr key={f.fund}>
                    <td><strong>{f.fund}</strong></td>
                    <td>{f.fundLabel}</td>
                    <td className="text-right">{formatNumber(f.visitCount)}</td>
                    <td className="text-right">{formatCurrency(f.totalCost)}</td>
                    <td className="text-right">{formatCurrency(f.totalRevenue)}</td>
                    <td className={`text-right font-bold ${f.netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatCurrency(f.netProfit)}
                    </td>
                    <td className={`text-right font-bold ${f.marginPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatPercent(f.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Facility Breakdown */}
      {report && activeTab === 'facilities' && (
        <div className="tab-pane">
          <div className="sub-header">
            <h3>🏥 เปรียบเทียบผลประกอบการรายหน่วยบริการในเครือข่าย CUP</h3>
            <p>โรงพยาบาลโคกศรีสุพรรณ (11101) และ รพ.สต. ในเครือข่าย 5 แห่ง</p>
          </div>

          <div className="table-wrapper">
            <table className="unit-cost-table">
              <thead>
                <tr>
                  <th>รหัสหน่วยบริการ</th>
                  <th>ชื่อสถานพยาบาล</th>
                  <th className="text-right">จำนวนรายการ</th>
                  <th className="text-right">จำนวนครั้ง (Visit)</th>
                  <th className="text-right">ต้นทุนรวม</th>
                  <th className="text-right">รายรับรวม</th>
                  <th className="text-right">กำไรสุทธิ</th>
                  <th className="text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {report.facilityBreakdown.map((fac) => (
                  <tr key={fac.hospcode}>
                    <td><code>{fac.hospcode}</code></td>
                    <td><strong>{fac.name}</strong></td>
                    <td className="text-right">{formatNumber(fac.itemCount)}</td>
                    <td className="text-right">{formatNumber(fac.visitCount)}</td>
                    <td className="text-right">{formatCurrency(fac.totalCost)}</td>
                    <td className="text-right">{formatCurrency(fac.totalRevenue)}</td>
                    <td className={`text-right font-bold ${fac.netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatCurrency(fac.netProfit)}
                    </td>
                    <td className={`text-right font-bold ${fac.marginPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatPercent(fac.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Monthly Trend */}
      {report && activeTab === 'monthly' && (
        <div className="tab-pane">
          <div className="sub-header">
            <h3>📅 แนวโน้มต้นทุน รายรับ และกำไรสุทธิรายเดือน</h3>
            <p>ติดตามความเคลื่อนไหวทางเศรษฐกิจและปริมาณบริการในแต่ละเดือน</p>
          </div>

          <div className="table-wrapper">
            <table className="unit-cost-table">
              <thead>
                <tr>
                  <th>เดือน / ปี</th>
                  <th className="text-right">จำนวนครั้ง (Visit)</th>
                  <th className="text-right">ต้นทุนรวม</th>
                  <th className="text-right">รายรับรวม</th>
                  <th className="text-right">กำไรสุทธิ</th>
                  <th className="text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {report.monthlyTrend.map((m) => (
                  <tr key={m.month}>
                    <td><strong>{m.monthLabel}</strong></td>
                    <td className="text-right">{formatNumber(m.visitCount)}</td>
                    <td className="text-right">{formatCurrency(m.totalCost)}</td>
                    <td className="text-right">{formatCurrency(m.totalRevenue)}</td>
                    <td className={`text-right font-bold ${m.netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatCurrency(m.netProfit)}
                    </td>
                    <td className={`text-right font-bold ${m.marginPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatPercent(m.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Cost Override */}
      {editModalItem && (
        <div className="modal-backdrop" onClick={() => setEditModalItem(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚙️ ตั้งค่าราคาต้นทุน/หน่วย (Cost Override)</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEditModalItem(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCostOverride} className="modal-body">
              <div className="modal-info-box">
                <p>
                  <strong>รหัส:</strong> <code>{editModalItem.icode}</code>
                </p>
                <p>
                  <strong>ชื่อรายการ:</strong> {editModalItem.name}
                </p>
                <p>
                  <strong>หมวดหมู่:</strong> {editModalItem.categoryLabel}
                </p>
                <p>
                  <strong>ราคาขายในระบบ (Unit Price):</strong> {formatCurrency(editModalItem.unitPrice)}
                </p>
                <p>
                  <strong>ต้นทุนเดิมใน HIS:</strong> {formatCurrency(editModalItem.unitCost)}
                </p>
              </div>

              {overrideSuccessMsg && (
                <div className="alert-box alert-success">{overrideSuccessMsg}</div>
              )}

              <div className="form-group">
                <label>
                  ราคาต้นทุนต่อหน่วยใหม่ (บาท) <span style={{ color: 'red' }}>*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={overrideCostInput}
                  onChange={(e) => setOverrideCostInput(e.target.value)}
                  placeholder="เช่น 15.00 หรือ 50.00"
                />
                <small className="help-text">
                  สำหรับรายการหัตถการหรือบริการที่ใน HOSxP ยังไม่มีการใส่ unitcost (เป็น 0)
                  สามารถกำหนดต้นทุนที่แท้จริงได้ที่นี่ ระบบจะนำไปคำนวณกำไรขาดทุนให้ทันที
                </small>
              </div>

              <div className="form-group">
                <label>หมายเหตุ / แหล่งที่มาของต้นทุน (บันทึกช่วยจำ):</label>
                <input
                  type="text"
                  value={overrideNoteInput}
                  onChange={(e) => setOverrideNoteInput(e.target.value)}
                  placeholder="เช่น ต้นทุนเฉลี่ยตามเกณฑ์ วปส. หรือต้นทุนสมุนไพรอบแห้ง"
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setEditModalItem(null)}
                  disabled={overrideSaving}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="btn-save"
                  disabled={overrideSaving}
                >
                  {overrideSaving ? 'กำลังบันทึก...' : '💾 บันทึกต้นทุน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Encounter Drilldown */}
      {drillModalItem && (
        <div className="modal-backdrop" onClick={() => setDrillModalItem(null)}>
          <div className="modal-box modal-drilldown" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                👥 ประวัติเคสที่ได้รับบริการ: {drillModalItem.name} ({drillModalItem.icode})
              </h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDrillModalItem(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {drillLoading ? (
                <div className="loading-spinner">⏳ กำลังโหลดข้อมูลเคส...</div>
              ) : drillError ? (
                <div className="alert-box alert-error">{drillError}</div>
              ) : drillRows.length === 0 ? (
                <div className="no-data">ไม่พบข้อมูลประวัติเคสในช่วงเวลาที่เลือก</div>
              ) : (
                <div className="drill-table-wrapper">
                  <p className="drill-note">
                    แสดงรายการล่าสุดสูงสุด {drillRows.length} รายการ (ช่วงวันที่ {startDate} ถึง {endDate})
                  </p>
                  <table className="unit-cost-table drill-table">
                    <thead>
                      <tr>
                        <th>วันที่</th>
                        <th>VN</th>
                        <th>HN</th>
                        <th>ชื่อผู้ป่วย</th>
                        <th>สิทธิการรักษา</th>
                        <th>กองทุน</th>
                        <th className="text-right">จำนวน</th>
                        <th className="text-right">ต้นทุน/หน่วย</th>
                        <th className="text-right">ราคาขาย/หน่วย</th>
                        <th className="text-right">ยอดรวม</th>
                        <th className="text-right">กำไรสุทธิ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillRows.map((r, idx) => (
                        <tr key={`${r.vn}-${idx}`}>
                          <td>{r.vstdate}</td>
                          <td><code>{r.vn}</code></td>
                          <td>{r.hn}</td>
                          <td>{r.patient_name}</td>
                          <td>{r.pttype_name} ({r.pttype})</td>
                          <td><span className="fund-tag">{r.fund}</span></td>
                          <td className="text-right">{r.qty}</td>
                          <td className="text-right">{formatCurrency(r.unit_cost)}</td>
                          <td className="text-right">{formatCurrency(r.unit_price)}</td>
                          <td className="text-right">{formatCurrency(r.sum_price)}</td>
                          <td className={`text-right font-bold ${r.net_profit >= 0 ? 'text-profit' : 'text-loss'}`}>
                            {formatCurrency(r.net_profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setDrillModalItem(null)}
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnitCostProfitPage;
