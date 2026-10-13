import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './PcuCaseCostReportPage.css';

export interface HerbalMasterItem {
  id: number;
  name: string;
  size: string;
  cost: number;
  unitCost: number;
  keywords: string[];
  category?: 'herbal' | 'iron_folic';
  monthlyRateNote?: string;
}

export interface PcuHerbalSummary {
  pcu_code: string;
  pcu_name: string;
  host_ip: string;
  is_online: boolean;
  total_dispense_count: number;
  total_dispensed_qty: number;
  total_drug_cost: number;
  total_charge_amt: number;
  hsub_claim_amt: number;
  hsub_hc_drug: number;
  hsub_total_paid: number;
  item_breakdown: Array<{
    herbal_id: number;
    herbal_name: string;
    size: string;
    cost_price: number;
    dispense_count: number;
    dispensed_qty: number;
    total_cost: number;
    total_charge: number;
    category?: string;
  }>;
}

export interface PcuHerbalResponse {
  period: { startDate: string; endDate: string };
  grand_total: {
    total_dispense_count: number;
    total_dispensed_qty: number;
    total_drug_cost: number;
    total_charge_amt: number;
    hsub_claim_amt: number;
    hsub_hc_drug: number;
    hsub_total_paid: number;
    gross_profit: number;
    payable_profit: number;
  };
  pcus: PcuHerbalSummary[];
  master_items: HerbalMasterItem[];
}

export interface DrillDownItem {
  vn: string;
  hn: string;
  vstdate: string;
  patient_name: string;
  icode: string;
  drug_name: string;
  units: string;
  qty: number;
  unit_price: number;
  sum_price: number;
  herbal_master_name: string;
  herbal_size: string;
  category?: string;
  unit_cost: number;
  total_cost: number;
  margin: number;
}

export const PcuCaseCostReportPage: React.FC = () => {
  const [data, setData] = useState<PcuHerbalResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedHcode, setSelectedHcode] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'herbal' | 'iron_folic'>('all');
  const [startDate, setStartDate] = useState<string>('2025-10-01');
  const [endDate, setEndDate] = useState<string>('2026-10-31');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // View Mode: 'matrix' (ตารางเปรียบเทียบ 5 รพ.สต.) | 'pcu_detail' (ตารางแยกตาม รพ.สต.)
  const [viewMode, setViewMode] = useState<'matrix' | 'pcu_detail'>('matrix');

  // Drill Down Modal
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalTitle, setModalTitle] = useState<string>('');
  const [modalHcode, setModalHcode] = useState<string>('05570');
  const [modalHerbalId, setModalHerbalId] = useState<number | undefined>(undefined);
  const [modalSearch, setModalSearch] = useState<string>('');
  const [modalPage, setModalPage] = useState<number>(1);
  const [modalLoading, setModalLoading] = useState<boolean>(false);
  const [modalData, setModalData] = useState<{ total: number; totalPages: number; items: DrillDownItem[] } | null>(null);

  // Load Data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        category: selectedCategory,
      });
      if (selectedHcode !== 'all') {
        params.append('hcode', selectedHcode);
      }
      const res = await fetch(`/api/pcu-herbal/summary?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูลจำนวนเคสและราคาทุนได้');
      }
      setData(json.data);
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedHcode, selectedCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load Drill Down Modal Data
  const loadDrillDown = useCallback(async () => {
    if (!modalOpen) return;
    setModalLoading(true);
    try {
      const params = new URLSearchParams({
        hcode: modalHcode,
        startDate,
        endDate,
        category: selectedCategory,
        page: String(modalPage),
        limit: '50',
        search: modalSearch,
      });
      if (modalHerbalId) {
        params.append('herbalId', String(modalHerbalId));
      }
      const res = await fetch(`/api/pcu-herbal/drill-down?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setModalData(json.data);
      }
    } catch (err) {
      console.error('Error fetching drill down:', err);
    } finally {
      setModalLoading(false);
    }
  }, [modalOpen, modalHcode, modalHerbalId, modalSearch, modalPage, startDate, endDate, selectedCategory]);

  useEffect(() => {
    if (modalOpen) {
      loadDrillDown();
    }
  }, [modalOpen, loadDrillDown]);

  const openDrillDownModal = (hcode: string, herbalId?: number, title?: string) => {
    setModalHcode(hcode);
    setModalHerbalId(herbalId);
    setModalTitle(title || `รพ.สต. ${hcode}`);
    setModalPage(1);
    setModalSearch('');
    setModalOpen(true);
  };

  // Filter master items based on search term and category
  const filteredMasterItems = useMemo(() => {
    if (!data?.master_items) return [];
    return data.master_items.filter((item) => {
      const matchCat =
        selectedCategory === 'all' ||
        (selectedCategory === 'iron_folic' && item.category === 'iron_folic') ||
        (selectedCategory === 'herbal' && item.category !== 'iron_folic');
      const matchSearch =
        !searchTerm.trim() ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.keywords.some((k) => k.toLowerCase().includes(searchTerm.toLowerCase().trim()));
      return matchCat && matchSearch;
    });
  }, [data?.master_items, selectedCategory, searchTerm]);

  // Build matrix map for each herbal item across PCUs
  // Map: herbal_id -> Map: pcu_code -> { dispense_count, dispensed_qty, total_cost }
  const matrixData = useMemo(() => {
    if (!data?.pcus) return new Map();
    const itemPcuMap = new Map<number, Map<string, { count: number; qty: number; cost: number }>>();

    for (const pcu of data.pcus) {
      for (const item of pcu.item_breakdown) {
        if (!itemPcuMap.has(item.herbal_id)) {
          itemPcuMap.set(item.herbal_id, new Map());
        }
        const pcuMap = itemPcuMap.get(item.herbal_id)!;
        pcuMap.set(pcu.pcu_code, {
          count: item.dispense_count,
          qty: item.dispensed_qty,
          cost: item.total_cost,
        });
      }
    }
    return itemPcuMap;
  }, [data?.pcus]);

  // Total summary across 5 PCUs
  const grandTotals = useMemo(() => {
    if (!data?.pcus) return { count: 0, qty: 0, cost: 0, avgCost: 0 };
    const count = data.pcus.reduce((a, b) => a + b.total_dispense_count, 0);
    const qty = data.pcus.reduce((a, b) => a + b.total_dispensed_qty, 0);
    const cost = Math.round(data.pcus.reduce((a, b) => a + b.total_drug_cost, 0) * 100) / 100;
    const avgCost = count > 0 ? Math.round((cost / count) * 100) / 100 : 0;
    return { count, qty, cost, avgCost };
  }, [data?.pcus]);

  // Export to Excel
  const handleExportExcel = () => {
    if (!data) return;

    // Sheet 1: Matrix View (รายการยา x 5 รพ.สต.)
    const matrixRows = filteredMasterItems.map((m) => {
      const pcuMap = matrixData.get(m.id) || new Map();
      let totalItemCases = 0;
      let totalItemQty = 0;
      let totalItemCost = 0;

      const row: Record<string, any> = {
        'ลำดับ': m.id,
        'หมวดหมู่': m.category === 'iron_folic' ? 'Triferdine & Folic' : 'ยาสมุนไพร 46 รายการ',
        'รายการยา': m.name,
        'ขนาดบรรจุ': m.size,
        'ราคาทุนต่อหน่วย (บาท)': m.unitCost,
      };

      for (const pcu of data.pcus) {
        const stats = pcuMap.get(pcu.pcu_code) || { count: 0, qty: 0, cost: 0 };
        totalItemCases += stats.count;
        totalItemQty += stats.qty;
        totalItemCost += stats.cost;

        row[`${pcu.pcu_code} (${pcu.pcu_name}) - จำนวน Case`] = stats.count;
        row[`${pcu.pcu_code} (${pcu.pcu_name}) - ปริมาณ (หน่วย)`] = stats.qty;
        row[`${pcu.pcu_code} (${pcu.pcu_name}) - รวมราคาทุน (บาท)`] = Math.round(stats.cost * 100) / 100;
      }

      row['รวมทั้งสิ้น - จำนวน Case'] = totalItemCases;
      row['รวมทั้งสิ้น - ปริมาณ (หน่วย)'] = totalItemQty;
      row['รวมทั้งสิ้น - ราคาทุน (บาท)'] = Math.round(totalItemCost * 100) / 100;

      return row;
    });

    // Sheet 2: สรุปภาพรวม 5 รพ.สต.
    const pcuSummaryRows = data.pcus.map((p) => ({
      'รหัส รพ.สต.': p.pcu_code,
      'ชื่อหน่วยบริการ': p.pcu_name,
      'IP Host': p.host_ip,
      'สถานะการเชื่อมต่อ': p.is_online ? 'ออนไลน์' : 'ออฟไลน์',
      'จำนวน Case ที่จ่ายยา (ครั้ง)': p.total_dispense_count,
      'ปริมาณยาที่จ่ายรวม (หน่วย)': p.total_dispensed_qty,
      'รวมราคาทุนค่ายา (บาท)': p.total_drug_cost,
      'เฉลี่ยราคาทุนต่อ Case (บาท/ครั้ง)': p.total_dispense_count > 0 ? (Math.round((p.total_drug_cost / p.total_dispense_count) * 100) / 100) : 0,
      'สัดส่วน % ของทุนรวม': grandTotals.cost > 0 ? `${(Math.round((p.total_drug_cost / grandTotals.cost) * 1000) / 10)}%` : '0%',
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(matrixRows);
    const ws2 = XLSX.utils.json_to_sheet(pcuSummaryRows);
    XLSX.utils.book_append_sheet(wb, ws1, 'ตารางเปรียบเทียบตัวยา 5 รพสต');
    XLSX.utils.book_append_sheet(wb, ws2, 'สรุปจำนวนCaseและทุนรายรพสต');

    XLSX.writeFile(wb, `PCU_Case_and_Cost_Report_${selectedCategory}_${startDate}_to_${endDate}.xlsx`);
  };

  return (
    <div className="pcu-case-cost-page">
      {/* Header */}
      <div className="case-cost-header">
        <div className="case-cost-title-group">
          <h1>
            <span>📦</span> รายงานจำนวน Case และราคาทุนการจ่ายยา ตาม รพ.สต.
          </h1>
          <p>
            ตรวจสอบจำนวนครั้งที่จ่าย (Case) ปริมาณยา และราคาทุนรวมของเวชภัณฑ์สมุนไพร 46 รายการ และ Triferdine/Folic Acid แยกตาม รพ.สต. ทั้ง 5 แห่ง พร้อมเจาะลึกรายตัวยาและรายบุคคล
          </p>
        </div>
        <div className="case-cost-actions">
          <button
            type="button"
            className="btn-case-cost btn-outline"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'pcuHerbal' } }));
            }}
          >
            🌿 จ่ายยาสมุนไพร & จัดสรรกำไร
          </button>
          <button
            type="button"
            className="btn-case-cost btn-purple"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'pcuPayout' } }));
            }}
          >
            💳 คำนวณสั่งจ่ายเงิน รพ.สต.
          </button>
          <button
            type="button"
            className="btn-case-cost btn-primary"
            onClick={handleExportExcel}
            disabled={loading || !data}
          >
            📥 ส่งออก Excel
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="case-cost-filter-card">
        <div className="filter-item">
          <label>หน่วยบริการ:</label>
          <select value={selectedHcode} onChange={(e) => setSelectedHcode(e.target.value)}>
            <option value="all">🏥 ทั้งหมด 5 รพ.สต.</option>
            {data?.pcus.map((p) => (
              <option key={p.pcu_code} value={p.pcu_code}>
                {p.pcu_code} - {p.pcu_name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-item">
          <label>หมวดหมู่ยา:</label>
          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value as any)}>
            <option value="all">📊 รวมทั้งหมด (สมุนไพร + Triferdine + Folic)</option>
            <option value="herbal">🌿 ยาสมุนไพร 46 รายการ</option>
            <option value="iron_folic">💊 Triferdine 150 mg & Folic Acid</option>
          </select>
        </div>

        <div className="filter-item">
          <label>วันที่เริ่มต้น:</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>

        <div className="filter-item">
          <label>วันที่สิ้นสุด:</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div className="filter-item search-filter">
          <label>ค้นหารายการยา:</label>
          <input
            type="text"
            placeholder="🔎 พิมพ์ชื่อยา เช่น ขมิ้นชัน, ไพล..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-item view-switcher">
          <label>มุมมองตาราง:</label>
          <div className="btn-toggle-group">
            <button
              type="button"
              className={`btn-toggle ${viewMode === 'matrix' ? 'active' : ''}`}
              onClick={() => setViewMode('matrix')}
            >
              📊 ตารางเปรียบเทียบ 5 รพ.สต. (Matrix)
            </button>
            <button
              type="button"
              className={`btn-toggle ${viewMode === 'pcu_detail' ? 'active' : ''}`}
              onClick={() => setViewMode('pcu_detail')}
            >
              🏢 ตารางแยกราย รพ.สต.
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="case-cost-error-banner">
          ⚠️ <strong>ข้อผิดพลาด:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="loading-card">
          <div className="spinner" />
          <p>กำลังเชื่อมต่อฐานข้อมูล HOSxP PCU ทั้ง 5 แห่ง และรวบรวมจำนวน Case / ราคาทุน ...</p>
        </div>
      ) : data ? (
        <>
          {/* Top KPI Summary Cards */}
          <div className="case-cost-kpi-grid">
            <div className="kpi-card blue">
              <div className="kpi-title">จำนวน Case ทั้งหมด (Visits)</div>
              <div className="kpi-value">{grandTotals.count.toLocaleString()} ครั้ง</div>
              <div className="kpi-sub">จำนวนครั้งที่มีการสั่งจ่ายยาให้ผู้ป่วย</div>
            </div>

            <div className="kpi-card teal">
              <div className="kpi-title">ปริมาณยาที่จ่ายรวม (Units)</div>
              <div className="kpi-value">{grandTotals.qty.toLocaleString()} หน่วย</div>
              <div className="kpi-sub">รวมเม็ด / แคปซูล / ซอง / ขวด / หลอด</div>
            </div>

            <div className="kpi-card amber">
              <div className="kpi-title">ราคาทุนรวมทั้งหมด (Total Cost)</div>
              <div className="kpi-value text-amber">{grandTotals.cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</div>
              <div className="kpi-sub">มูลค่าต้นทุนค่ายาตามเกณฑ์มาตรฐาน</div>
            </div>

            <div className="kpi-card purple">
              <div className="kpi-title">เฉลี่ยต้นทุนต่อ Case (Avg / Visit)</div>
              <div className="kpi-value text-purple">{grandTotals.avgCost.toFixed(2)} ฿</div>
              <div className="kpi-sub">ต้นทุนเฉลี่ยต่อ 1 ครั้งการมารับบริการ</div>
            </div>
          </div>

          {/* 5 PCU Comparative Breakdown Cards */}
          <div className="pcu-summary-cards-section">
            <div className="section-title">
              <span>🏢</span> สรุปจำนวน Case และราคาทุนแยกราย รพ.สต. (คลิกที่การ์ดเพื่อกรอง)
            </div>
            <div className="pcu-cards-grid">
              {data.pcus.map((pcu) => {
                const isSelected = selectedHcode === pcu.pcu_code;
                const costShare = grandTotals.cost > 0 ? (pcu.total_drug_cost / grandTotals.cost) * 100 : 0;
                const avgPcuCost = pcu.total_dispense_count > 0 ? pcu.total_drug_cost / pcu.total_dispense_count : 0;

                return (
                  <div
                    key={pcu.pcu_code}
                    className={`pcu-card-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedHcode(isSelected ? 'all' : pcu.pcu_code)}
                  >
                    <div className="pcu-card-header">
                      <span className="badge-pcu">{pcu.pcu_code}</span>
                      <span className={`status-pill ${pcu.is_online ? 'online' : 'offline'}`}>
                        {pcu.is_online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <div className="pcu-card-name">{pcu.pcu_name}</div>
                    <div className="pcu-card-metrics">
                      <div className="metric-row">
                        <span className="lbl">จำนวน Case:</span>
                        <strong className="font-mono">{pcu.total_dispense_count.toLocaleString()} ครั้ง</strong>
                      </div>
                      <div className="metric-row">
                        <span className="lbl">ปริมาณยา:</span>
                        <span className="font-mono">{pcu.total_dispensed_qty.toLocaleString()} หน่วย</span>
                      </div>
                      <div className="metric-row highlight">
                        <span className="lbl">ราคาทุนรวม:</span>
                        <strong className="font-mono text-amber">
                          {pcu.total_drug_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                        </strong>
                      </div>
                      <div className="metric-row">
                        <span className="lbl">เฉลี่ยต่อเคส:</span>
                        <span className="font-mono">{avgPcuCost.toFixed(2)} ฿/ครั้ง</span>
                      </div>
                    </div>
                    <div className="pcu-card-progress">
                      <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${Math.min(100, costShare)}%` }} />
                      </div>
                      <span className="progress-label">สัดส่วนทุน: {costShare.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* VIEW MODE 1: MATRIX CROSS-TABULATION (ตารางเปรียบเทียบ 5 รพ.สต.) */}
          {viewMode === 'matrix' && (
            <div className="matrix-table-card">
              <div className="matrix-card-header">
                <div>
                  <h3><span>📊</span> ตารางเปรียบเทียบจำนวน Case และราคาทุนแยกตามตัวยา x 5 รพ.สต.</h3>
                  <p>แสดงจำนวนครั้งที่จ่าย (Case) และราคาทุนรวม (บาท) ของยาแต่ละรายการข้ามทั้ง 5 หน่วยบริการ</p>
                </div>
                <div className="header-meta">
                  แสดง {filteredMasterItems.length} รายการยา
                </div>
              </div>

              <div className="matrix-responsive">
                <table className="matrix-table">
                  <thead>
                    <tr>
                      <th rowSpan={2} style={{ width: '45px' }} className="text-center">#</th>
                      <th rowSpan={2} style={{ minWidth: '180px' }}>รายการยา</th>
                      <th rowSpan={2} style={{ width: '80px' }} className="text-center">ขนาด</th>
                      <th rowSpan={2} style={{ width: '90px' }} className="text-right">ราคาทุน/หน่วย</th>
                      {data.pcus.map((p) => (
                        <th key={p.pcu_code} colSpan={2} className="text-center pcu-col-header">
                          <span className="badge-pcu-th">{p.pcu_code}</span>
                          <div>{p.pcu_name.replace('รพ.สต.บ้าน', '').replace('รพ.สต.', '')}</div>
                        </th>
                      ))}
                      <th colSpan={2} className="text-center total-col-header">รวมทั้ง 5 รพ.สต.</th>
                      <th rowSpan={2} style={{ width: '70px' }} className="text-center">เจาะลึก</th>
                    </tr>
                    <tr>
                      {data.pcus.map((p) => (
                        <React.Fragment key={`${p.pcu_code}-sub`}>
                          <th className="text-right sub-th">Case</th>
                          <th className="text-right sub-th">ราคาทุน (฿)</th>
                        </React.Fragment>
                      ))}
                      <th className="text-right sub-th total-sub">รวม Case</th>
                      <th className="text-right sub-th total-sub">รวมทุน (฿)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMasterItems.map((item) => {
                      const pcuMap = matrixData.get(item.id) || new Map();
                      let totalItemCases = 0;
                      let totalItemCost = 0;

                      return (
                        <tr key={item.id}>
                          <td className="text-center text-muted font-mono">{item.id}</td>
                          <td>
                            <strong>{item.name}</strong>
                            {item.category === 'iron_folic' && (
                              <span className="badge-cat-tag">Triferdine/Folic</span>
                            )}
                          </td>
                          <td className="text-center text-muted">{item.size}</td>
                          <td className="text-right font-mono font-bold" style={{ color: '#047857' }}>
                            {item.unitCost.toFixed(item.unitCost < 1 ? 4 : 2)} ฿
                          </td>

                          {data.pcus.map((p) => {
                            const stats = pcuMap.get(p.pcu_code) || { count: 0, qty: 0, cost: 0 };
                            totalItemCases += stats.count;
                            totalItemCost += stats.cost;

                            return (
                              <React.Fragment key={`${item.id}-${p.pcu_code}`}>
                                <td className="text-right font-mono">
                                  {stats.count > 0 ? (
                                    <span
                                      className="case-clickable"
                                      onClick={() => openDrillDownModal(p.pcu_code, item.id, `${item.name} - ${p.pcu_name}`)}
                                      title="คลิกเพื่อดูรายละเอียดเคสคนไข้"
                                    >
                                      {stats.count.toLocaleString()}
                                    </span>
                                  ) : (
                                    <span className="text-zero">-</span>
                                  )}
                                </td>
                                <td className="text-right font-mono text-cost">
                                  {stats.cost > 0 ? (
                                    stats.cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })
                                  ) : (
                                    <span className="text-zero">-</span>
                                  )}
                                </td>
                              </React.Fragment>
                            );
                          })}

                          <td className="text-right font-mono font-bold total-col">
                            {totalItemCases.toLocaleString()}
                          </td>
                          <td className="text-right font-mono font-bold total-col text-amber">
                            {totalItemCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                          <td className="text-center">
                            <button
                              type="button"
                              className="btn-drill-icon"
                              onClick={() => openDrillDownModal(selectedHcode === 'all' ? '05570' : selectedHcode, item.id, item.name)}
                              title="ดูรายละเอียดเคสคนไข้"
                            >
                              🔎
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="matrix-grand-total-row">
                      <td colSpan={4} className="text-right">
                        <strong>รวมทุกรายการ ({filteredMasterItems.length} ตัวยา):</strong>
                      </td>
                      {data.pcus.map((p) => (
                        <React.Fragment key={`${p.pcu_code}-tot`}>
                          <td className="text-right font-mono font-bold">
                            {p.total_dispense_count.toLocaleString()}
                          </td>
                          <td className="text-right font-mono font-bold text-amber">
                            {p.total_drug_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                        </React.Fragment>
                      ))}
                      <td className="text-right font-mono font-bold total-col" style={{ fontSize: '1rem' }}>
                        {grandTotals.count.toLocaleString()}
                      </td>
                      <td className="text-right font-mono font-bold total-col text-amber" style={{ fontSize: '1.05rem' }}>
                        {grandTotals.cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* VIEW MODE 2: DETAILED BY PCU */}
          {viewMode === 'pcu_detail' && (
            <div className="pcu-detail-container">
              {data.pcus
                .filter((p) => selectedHcode === 'all' || p.pcu_code === selectedHcode)
                .map((pcu) => (
                  <div key={pcu.pcu_code} className="pcu-detail-card">
                    <div className="pcu-detail-header">
                      <div>
                        <h3>
                          <span className="badge-pcu">{pcu.pcu_code}</span> {pcu.pcu_name}
                        </h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                          IP: {pcu.host_ip} | Database: <code>hospcu{pcu.pcu_code}</code>
                        </p>
                      </div>
                      <div className="pcu-detail-totals">
                        <div>
                          <span className="lbl">จำนวน Case รวม:</span>
                          <strong className="font-mono">{pcu.total_dispense_count.toLocaleString()} ครั้ง</strong>
                        </div>
                        <div>
                          <span className="lbl">ราคาทุนรวม:</span>
                          <strong className="font-mono text-amber" style={{ fontSize: '1.1rem' }}>
                            {pcu.total_drug_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="btn-case-cost btn-outline"
                          onClick={() => openDrillDownModal(pcu.pcu_code, undefined, `เคสคนไข้ทั้งหมด - ${pcu.pcu_name}`)}
                        >
                          🔎 เจาะลึกราย Case คนไข้
                        </button>
                      </div>
                    </div>

                    <div className="matrix-responsive">
                      <table className="matrix-table">
                        <thead>
                          <tr>
                            <th style={{ width: '45px' }} className="text-center">#</th>
                            <th>รายการยา</th>
                            <th style={{ width: '90px' }} className="text-center">ขนาด</th>
                            <th style={{ width: '100px' }} className="text-right">ราคาทุน/หน่วย</th>
                            <th style={{ width: '120px' }} className="text-right">จำนวน Case (ครั้ง)</th>
                            <th style={{ width: '130px' }} className="text-right">ปริมาณยา (หน่วย)</th>
                            <th style={{ width: '140px' }} className="text-right">รวมราคาทุน (บาท)</th>
                            <th style={{ width: '110px' }} className="text-center">สัดส่วนทุน %</th>
                            <th style={{ width: '70px' }} className="text-center">เคส</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pcu.item_breakdown.map((item, idx) => {
                            const costPct = pcu.total_drug_cost > 0 ? (item.total_cost / pcu.total_drug_cost) * 100 : 0;
                            return (
                              <tr key={`${pcu.pcu_code}-${item.herbal_id}`}>
                                <td className="text-center text-muted font-mono">{idx + 1}</td>
                                <td><strong>{item.herbal_name}</strong></td>
                                <td className="text-center text-muted">{item.size}</td>
                                <td className="text-right font-mono" style={{ color: '#047857' }}>
                                  {item.cost_price.toFixed(item.cost_price < 1 ? 4 : 2)} ฿
                                </td>
                                <td className="text-right font-mono font-bold">
                                  {item.dispense_count.toLocaleString()}
                                </td>
                                <td className="text-right font-mono">
                                  {item.dispensed_qty.toLocaleString()}
                                </td>
                                <td className="text-right font-mono font-bold text-amber">
                                  {item.total_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                                </td>
                                <td className="text-center">
                                  <div className="pct-mini-bar">
                                    <div className="pct-fill" style={{ width: `${Math.min(100, costPct)}%` }} />
                                    <span>{costPct.toFixed(1)}%</span>
                                  </div>
                                </td>
                                <td className="text-center">
                                  <button
                                    type="button"
                                    className="btn-drill-icon"
                                    onClick={() => openDrillDownModal(pcu.pcu_code, item.herbal_id, `${item.herbal_name} - ${pcu.pcu_name}`)}
                                    title="ดูเคสคนไข้ที่ได้ยานี้"
                                  >
                                    🔎
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="matrix-grand-total-row">
                            <td colSpan={4} className="text-right"><strong>รวมทั้งสิ้น ({pcu.pcu_name}):</strong></td>
                            <td className="text-right font-mono font-bold">{pcu.total_dispense_count.toLocaleString()}</td>
                            <td className="text-right font-mono font-bold">{pcu.total_dispensed_qty.toLocaleString()}</td>
                            <td className="text-right font-mono font-bold text-amber" style={{ fontSize: '1.05rem' }}>
                              {pcu.total_drug_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      ) : null}

      {/* Drill Down Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔎 รายละเอียด Case ผู้ป่วยที่ได้รับยา: {modalTitle}</h3>
              <button type="button" className="modal-close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="🔎 ค้นหา ชื่อผู้ป่วย, HN, หรือ VN..."
                  value={modalSearch}
                  onChange={(e) => {
                    setModalSearch(e.target.value);
                    setModalPage(1);
                  }}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.85rem',
                    borderRadius: '0.375rem',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.875rem',
                  }}
                />
                <button
                  type="button"
                  className="btn-case-cost btn-outline"
                  onClick={loadDrillDown}
                  disabled={modalLoading}
                >
                  {modalLoading ? 'กำลังค้นหา...' : '🔄 ค้นหา'}
                </button>
              </div>

              {modalLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <div className="spinner" />
                  <p style={{ marginTop: '1rem', color: '#64748b' }}>กำลังดึงรายการ Case ผู้ป่วยจาก HOSxP PCU...</p>
                </div>
              ) : modalData && modalData.items.length > 0 ? (
                <>
                  <div className="matrix-responsive">
                    <table className="matrix-table" style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr>
                          <th>ว/ด/ป</th>
                          <th>VN</th>
                          <th>HN</th>
                          <th>ชื่อ-สกุล ผู้ป่วย</th>
                          <th>รายการยา</th>
                          <th className="text-right">จำนวน</th>
                          <th className="text-right">ราคาทุน/หน่วย</th>
                          <th className="text-right">รวมราคาทุน (฿)</th>
                          <th className="text-right">ยอดเรียกเก็บ (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalData.items.map((row, idx) => (
                          <tr key={`${row.vn}-${idx}`}>
                            <td>{row.vstdate}</td>
                            <td className="font-mono">{row.vn}</td>
                            <td className="font-mono">{row.hn}</td>
                            <td><strong>{row.patient_name}</strong></td>
                            <td>
                              {row.drug_name}
                              {row.herbal_master_name && row.drug_name !== row.herbal_master_name && (
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                  ({row.herbal_master_name})
                                </div>
                              )}
                            </td>
                            <td className="text-right font-mono">{row.qty} {row.units}</td>
                            <td className="text-right font-mono" style={{ color: '#047857' }}>
                              {row.unit_cost.toFixed(2)} ฿
                            </td>
                            <td className="text-right font-mono font-bold text-amber">
                              {row.total_cost.toFixed(2)} ฿
                            </td>
                            <td className="text-right font-mono font-bold" style={{ color: '#2563eb' }}>
                              {row.sum_price.toFixed(2)} ฿
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', fontSize: '0.875rem' }}>
                    <span style={{ color: '#64748b' }}>
                      พบทั้งหมด <strong>{modalData.total.toLocaleString()}</strong> รายการ (หน้า {modalPage} / {modalData.totalPages})
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn-case-cost btn-outline"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        disabled={modalPage <= 1}
                        onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                      >
                        ‹ ก่อนหน้า
                      </button>
                      <button
                        type="button"
                        className="btn-case-cost btn-outline"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        disabled={modalPage >= modalData.totalPages}
                        onClick={() => setModalPage((p) => Math.min(modalData.totalPages, p + 1))}
                      >
                        ถัดไป ›
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                  ไม่พบรายการ Case ผู้ป่วยตามเงื่อนไขที่ระบุ
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
