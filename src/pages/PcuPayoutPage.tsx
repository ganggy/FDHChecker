import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './PcuPayoutPage.css';

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
  triferdine_reimbursed?: number;
  folic_reimbursed?: number;
  gross_profit: number;
  payable_profit: number;
  margin_percentage: number;
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
}

export interface PcuPayoutRow {
  code: string;
  name: string;
  host: string;
  dispenseCount: number;
  dispensedQty: number;
  actualCost: number;
  grossReimbursed: number;
  herbalReimbursed: number;
  triferdineReimbursed: number;
  folicReimbursed: number;
  deductedCost: number;
  costDeductionLabel: string;
  grossMargin: number;
  adminFeeDeducted: number;
  mismatchAtRisk: number;
  withheldAmount: number;
  netPayable: number;
  effectiveRate: number;
}

/** แปลงตัวเลขเป็นคำอ่านภาษาไทยสำหรับใบสำคัญจ่ายเงิน */
export function thaiBahtText(num: number): string {
  if (isNaN(num) || num === 0) return 'ศูนย์บาทถ้วน';
  if (num < 0) return 'ลบ' + thaiBahtText(Math.abs(num));

  num = Math.round(num * 100) / 100;
  const parts = num.toFixed(2).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  const digits = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  function convertGroup(s: string): string {
    let res = '';
    const len = s.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(s[i], 10);
      const pos = len - i - 1;
      if (digit !== 0) {
        if (pos === 1 && digit === 1) {
          res += 'สิบ';
        } else if (pos === 1 && digit === 2) {
          res += 'ยี่สิบ';
        } else if (pos === 0 && digit === 1 && len > 1 && s[len - 2] !== '0') {
          res += 'เอ็ด';
        } else {
          res += digits[digit] + positions[pos];
        }
      }
    }
    return res;
  }

  function convertInteger(s: string): string {
    if (s === '0' || !s) return '';
    let res = '';
    const milGroups: string[] = [];
    while (s.length > 6) {
      milGroups.unshift(s.slice(-6));
      s = s.slice(0, -6);
    }
    milGroups.unshift(s);

    for (let i = 0; i < milGroups.length; i++) {
      const g = milGroups[i];
      const gText = convertGroup(g);
      if (gText) {
        res += gText;
        if (i < milGroups.length - 1) {
          res += 'ล้าน';
        }
      }
    }
    return res;
  }

  let text = convertInteger(integerPart) + 'บาท';
  if (decimalPart === '00' || !decimalPart) {
    text += 'ถ้วน';
  } else {
    const decGroup = convertGroup(decimalPart);
    text += decGroup + 'สตางค์';
  }
  return text;
}

export const PcuPayoutPage: React.FC = () => {
  // Raw data from server
  const [data, setData] = useState<PcuHerbalResponse | null>(null);
  const [auditBreakdown, setAuditBreakdown] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Estimation Parameters
  const [startDate, setStartDate] = useState<string>('2025-10-01');
  const [endDate, setEndDate] = useState<string>('2026-10-31');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'herbal' | 'iron_folic'>('all');

  // Cost Deduction Policy:
  // 'actual' = หักตามต้นทุนค่ายาจริงใน HOSxP PCU
  // 'percent' = หักต้นทุนแบบเหมาจ่าย % จากยอดชดเชย (เช่น หัก 40%)
  // 'none' = ไม่หักต้นทุนค่ายา (รพ.สต. รับยอดเต็ม)
  const [costDeductionMode, setCostDeductionMode] = useState<'actual' | 'percent' | 'none'>('actual');
  const [customCostPercent, setCustomCostPercent] = useState<number>(40);

  // PCU Profit Share %: (default 100% คือจ่ายกำไรทั้งหมดให้ รพ.สต.)
  const [pcuProfitSharePercent, setPcuProfitSharePercent] = useState<number>(100);

  // Hospital Admin Fee %: (default 0% คือ รพ.แม่ข่าย ไม่หักค่าบริหาร)
  const [hospitalAdminFeePercent, setHospitalAdminFeePercent] = useState<number>(0);

  // Withhold Mismatch Diag Toggle:
  // หักกันเงินสำรองกรณีตรวจพบว่า Diag ผิดเสี่ยงถูก สปสช. ปฏิเสธ
  const [withholdMismatch, setWithholdMismatch] = useState<boolean>(false);

  // Printable Voucher Modal State
  const [voucherModalOpen, setVoucherModalOpen] = useState<boolean>(false);
  const [selectedVoucherPcuCode, setSelectedVoucherPcuCode] = useState<string>('05569');
  const [voucherNotes, setVoucherNotes] = useState<string>('เงินชดเชยค่าบริการทางการแพทย์และเวชภัณฑ์สมุนไพร/ธาตุเหล็ก ประจำปีงบประมาณ 2569');

  // Load summary and audit data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaryParams = new URLSearchParams({
        startDate,
        endDate,
        category: selectedCategory,
      });

      // 1. Fetch summary
      const resSummary = await fetch(`/api/pcu-herbal/summary?${summaryParams.toString()}`);
      const jsonSummary = await resSummary.json();
      if (!resSummary.ok || !jsonSummary.success) {
        throw new Error(jsonSummary.error || 'ไม่สามารถโหลดข้อมูลสรุปจ่ายยาได้');
      }
      setData(jsonSummary.data);

      // 2. Fetch diag audit risk amounts
      try {
        const auditParams = new URLSearchParams({ startDate, endDate, status: 'all', limit: '1' });
        const resAudit = await fetch(`/api/pcu-herbal/diag-audit?${auditParams.toString()}`);
        const jsonAudit = await resAudit.json();
        if (jsonAudit.success && jsonAudit.data?.summary?.pcu_breakdown) {
          const map: Record<string, number> = {};
          for (const b of jsonAudit.data.summary.pcu_breakdown) {
            map[b.pcu_code] = b.at_risk_value_baht || 0;
          }
          setAuditBreakdown(map);
        }
      } catch (err) {
        console.warn('Could not load audit breakdown', err);
      }
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate simulated payout table rows
  const payoutRows: PcuPayoutRow[] = useMemo(() => {
    if (!data?.pcus) return [];

    return data.pcus.map((pcu) => {
      let grossReimbursed = 0;
      const herbalReimbursed = pcu.hsub_hc_drug > 0 ? pcu.hsub_hc_drug : pcu.total_charge_amt;
      const triferdineReimbursed = pcu.triferdine_reimbursed || 0;
      const folicReimbursed = pcu.folic_reimbursed || 0;

      if (selectedCategory === 'herbal') {
        grossReimbursed = herbalReimbursed;
      } else if (selectedCategory === 'iron_folic') {
        grossReimbursed = triferdineReimbursed + folicReimbursed;
      } else {
        grossReimbursed = pcu.hsub_total_paid > 0 ? pcu.hsub_total_paid : (herbalReimbursed + triferdineReimbursed + folicReimbursed);
      }

      // Cost deduction
      let deductedCost = 0;
      let costDeductionLabel = '';
      if (costDeductionMode === 'actual') {
        deductedCost = pcu.total_drug_cost;
        costDeductionLabel = 'ทุนจริง HOSxP';
      } else if (costDeductionMode === 'percent') {
        deductedCost = Math.round(grossReimbursed * (customCostPercent / 100) * 100) / 100;
        costDeductionLabel = `เหมาจ่าย ${customCostPercent}%`;
      } else {
        deductedCost = 0;
        costDeductionLabel = 'ไม่หักทุน (0%)';
      }

      const grossMargin = Math.max(0, Math.round((grossReimbursed - deductedCost) * 100) / 100);

      // Hospital admin fee
      const adminFeeDeducted = Math.round(grossMargin * (hospitalAdminFeePercent / 100) * 100) / 100;

      // Diag mismatch withheld
      const mismatchAtRisk = auditBreakdown[pcu.pcu_code] || 0;
      const withheldAmount = withholdMismatch ? mismatchAtRisk : 0;

      // Net payable
      const basePayable = Math.round(grossMargin * (pcuProfitSharePercent / 100) * 100) / 100;
      const netPayable = Math.max(0, Math.round((basePayable - adminFeeDeducted - withheldAmount) * 100) / 100);
      const effectiveRate = grossReimbursed > 0 ? Math.round((netPayable / grossReimbursed) * 1000) / 10 : 0;

      return {
        code: pcu.pcu_code,
        name: pcu.pcu_name,
        host: pcu.host_ip,
        dispenseCount: pcu.total_dispense_count,
        dispensedQty: pcu.total_dispensed_qty,
        actualCost: pcu.total_drug_cost,
        grossReimbursed,
        herbalReimbursed,
        triferdineReimbursed,
        folicReimbursed,
        deductedCost,
        costDeductionLabel,
        grossMargin,
        adminFeeDeducted,
        mismatchAtRisk,
        withheldAmount,
        netPayable,
        effectiveRate,
      };
    });
  }, [
    data?.pcus,
    selectedCategory,
    costDeductionMode,
    customCostPercent,
    pcuProfitSharePercent,
    hospitalAdminFeePercent,
    withholdMismatch,
    auditBreakdown,
  ]);

  // Grand Totals
  const grandTotals = useMemo(() => {
    return {
      dispenseCount: payoutRows.reduce((a, b) => a + b.dispenseCount, 0),
      dispensedQty: payoutRows.reduce((a, b) => a + b.dispensedQty, 0),
      actualCost: Math.round(payoutRows.reduce((a, b) => a + b.actualCost, 0) * 100) / 100,
      grossReimbursed: Math.round(payoutRows.reduce((a, b) => a + b.grossReimbursed, 0) * 100) / 100,
      deductedCost: Math.round(payoutRows.reduce((a, b) => a + b.deductedCost, 0) * 100) / 100,
      grossMargin: Math.round(payoutRows.reduce((a, b) => a + b.grossMargin, 0) * 100) / 100,
      adminFeeDeducted: Math.round(payoutRows.reduce((a, b) => a + b.adminFeeDeducted, 0) * 100) / 100,
      withheldAmount: Math.round(payoutRows.reduce((a, b) => a + b.withheldAmount, 0) * 100) / 100,
      netPayable: Math.round(payoutRows.reduce((a, b) => a + b.netPayable, 0) * 100) / 100,
    };
  }, [payoutRows]);

  // Export Payout Settlement Table to Excel
  const handleExportExcel = () => {
    const sheetData = payoutRows.map((row, idx) => ({
      'ลำดับ': idx + 1,
      'รหัส รพ.สต.': row.code,
      'ชื่อหน่วยบริการ': row.name,
      'จำนวนครั้งจ่าย': row.dispenseCount,
      'ปริมาณยา (หน่วย)': row.dispensedQty,
      'ยอดชดเชยรวม (บาท)': row.grossReimbursed,
      'เกณฑ์หักต้นทุน': row.costDeductionLabel,
      'ต้นทุนที่หัก (บาท)': row.deductedCost,
      'กำไรส่วนต่าง (บาท)': row.grossMargin,
      'หักค่าบริหาร รพ.แม่ข่าย (บาท)': row.adminFeeDeducted,
      'หักเงินสำรอง Diag ผิด (บาท)': row.withheldAmount,
      'ยอดสุทธิพึงสั่งจ่าย รพ.สต. (บาท)': row.netPayable,
      'อัตราจ่ายสุทธิ (%)': `${row.effectiveRate}%`,
    }));

    // Summary row
    sheetData.push({
      'ลำดับ': '' as any,
      'รหัส รพ.สต.': 'รวมทั้งหมด',
      'ชื่อหน่วยบริการ': '5 รพ.สต.',
      'จำนวนครั้งจ่าย': grandTotals.dispenseCount,
      'ปริมาณยา (หน่วย)': grandTotals.dispensedQty,
      'ยอดชดเชยรวม (บาท)': grandTotals.grossReimbursed,
      'เกณฑ์หักต้นทุน': '-',
      'ต้นทุนที่หัก (บาท)': grandTotals.deductedCost,
      'กำไรส่วนต่าง (บาท)': grandTotals.grossMargin,
      'หักค่าบริหาร รพ.แม่ข่าย (บาท)': grandTotals.adminFeeDeducted,
      'หักเงินสำรอง Diag ผิด (บาท)': grandTotals.withheldAmount,
      'ยอดสุทธิพึงสั่งจ่าย รพ.สต. (บาท)': grandTotals.netPayable,
      'อัตราจ่ายสุทธิ (%)': `${grandTotals.grossReimbursed > 0 ? (Math.round((grandTotals.netPayable / grandTotals.grossReimbursed) * 1000) / 10) : 0}%`,
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'สรุปสั่งจ่ายเงิน รพ.สต.');
    XLSX.writeFile(wb, `PCU_Payout_Settlement_${selectedCategory}_${startDate}_to_${endDate}.xlsx`);
  };

  // Open voucher for specific PCU
  const handleOpenVoucher = (pcuCode: string) => {
    setSelectedVoucherPcuCode(pcuCode);
    setVoucherModalOpen(true);
  };

  // Print voucher window
  const handlePrintVoucher = () => {
    window.print();
  };

  const selectedVoucherRow = useMemo(() => {
    return payoutRows.find((p) => p.code === selectedVoucherPcuCode) || payoutRows[0];
  }, [payoutRows, selectedVoucherPcuCode]);

  return (
    <div className="pcu-payout-page">
      {/* Page Header */}
      <div className="pcu-payout-header">
        <div className="pcu-payout-title-group">
          <h1>
            <span>💳</span> คำนวณยอดจัดสรร & สั่งจ่ายเงิน รพ.สต. (Payout Settlement)
          </h1>
          <p>
            จำลองและกำหนดเกณฑ์หักต้นทุนคราวๆ (% หรือทุนจริง) เพื่อคำนวณยอดเงินสุทธิที่จะโอนจ่ายให้กับ รพ.สต. ทั้ง 5 แห่ง พร้อมพิมพ์ใบสำคัญสั่งจ่ายเงิน (Payment Voucher) ทางการ
          </p>
        </div>
        <div className="pcu-payout-actions">
          <button
            type="button"
            className="btn-payout btn-outline"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'pcuHerbal' } }));
            }}
          >
            🌿 หน้าตรวจสอบการจ่ายยา (HOSxP)
          </button>
          <button
            type="button"
            className="btn-payout btn-primary"
            onClick={handleExportExcel}
            disabled={loading || payoutRows.length === 0}
          >
            📥 ส่งออก Excel ยอดสั่งจ่าย
          </button>
        </div>
      </div>

      {/* Simulator Parameters Panel */}
      <div className="payout-controls-panel">
        <div className="controls-panel-title">
          <span>⚙️</span> กำหนดเงื่อนไขการคำนวณและหักต้นทุนคราวๆ
        </div>

        <div className="controls-grid">
          {/* Period */}
          <div className="control-item">
            <label>📅 ช่วงวันที่รับบริการ</label>
            <div className="date-input-group">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span>ถึง</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Category */}
          <div className="control-item">
            <label>📦 หมวดหมู่ยาที่จ่าย</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as any)}
            >
              <option value="all">📊 รวมทั้งหมด (สมุนไพร 46 รายการ + Triferdine + Folic)</option>
              <option value="herbal">🌿 ยาสมุนไพร 46 รายการอย่างเดียว</option>
              <option value="iron_folic">💊 Triferdine 150 mg & Folic Acid</option>
            </select>
          </div>

          {/* Cost Deduction Policy */}
          <div className="control-item">
            <label>🏷️ เกณฑ์การหักต้นทุนค่ายา</label>
            <select
              value={costDeductionMode}
              onChange={(e) => setCostDeductionMode(e.target.value as any)}
            >
              <option value="actual">หักตามต้นทุนจริงในคลังยา HOSxP PCU</option>
              <option value="percent">หักต้นทุนแบบเหมาจ่าย % (Flat Rate)</option>
              <option value="none">ไม่หักต้นทุนค่ายา (รพ.สต. รับยอดเต็ม)</option>
            </select>
          </div>

          {/* Custom Cost % Slider (if percent mode) */}
          {costDeductionMode === 'percent' && (
            <div className="control-item highlight-box">
              <label>
                สัดส่วนหักต้นทุนค่ายา: <strong>{customCostPercent}%</strong>
              </label>
              <div className="slider-wrapper">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={customCostPercent}
                  onChange={(e) => setCustomCostPercent(Number(e.target.value))}
                />
                <div className="slider-labels">
                  <span>0%</span>
                  <span>30%</span>
                  <span>50%</span>
                  <span>70%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          )}

          {/* PCU Profit Share % */}
          <div className="control-item">
            <label>
              💰 ส่วนแบ่งกำไรให้ รพ.สต.: <strong>{pcuProfitSharePercent}%</strong>
            </label>
            <div className="preset-buttons-group">
              {[100, 80, 70, 50].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={`btn-preset ${pcuProfitSharePercent === pct ? 'active' : ''}`}
                  onClick={() => setPcuProfitSharePercent(pct)}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Hospital Admin Fee % */}
          <div className="control-item">
            <label>
              🏥 ค่าบริหารจัดการ รพ.แม่ข่าย: <strong>{hospitalAdminFeePercent}%</strong>
            </label>
            <div className="preset-buttons-group">
              {[0, 5, 10, 20].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={`btn-preset ${hospitalAdminFeePercent === pct ? 'active' : ''}`}
                  onClick={() => setHospitalAdminFeePercent(pct)}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Withhold Diag Mismatch Toggle */}
          <div className="control-item full-width">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={withholdMismatch}
                onChange={(e) => setWithholdMismatch(e.target.checked)}
              />
              <span className="toggle-text">
                <strong>🛡️ หักกันเงินสำรองเคส Diag ผิด / เสี่ยงไม่ได้รับเงินชดเชยไว้ก่อน</strong>
                <span className="toggle-hint">
                  (ระบบจะคำนวณหักยอดเงินที่ตรวจพบว่า รพ.สต. วินิจฉัยไม่ตรงกลุ่มสรรพคุณยา ไว้จนกว่า รพ.สต. จะแก้ไขรหัสโรคให้ถูกต้อง)
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="payout-error-banner">
          ⚠️ <strong>ข้อผิดพลาด:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="loading-card">
          <div className="spinner" />
          <p>กำลังคำนวณยอดจัดสรรและจำลองการจ่ายเงินให้ 5 รพ.สต. ...</p>
        </div>
      ) : (
        <>
          {/* Grand Totals KPI Cards */}
          <div className="payout-kpi-grid">
            <div className="payout-kpi-card blue">
              <div className="kpi-title">ยอดชดเชยรวม (Gross Inflow)</div>
              <div className="kpi-value">{grandTotals.grossReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</div>
              <div className="kpi-sub">
                จ่ายยาทั้งหมด {grandTotals.dispenseCount.toLocaleString()} ครั้ง ({grandTotals.dispensedQty.toLocaleString()} หน่วย)
              </div>
            </div>

            <div className="payout-kpi-card amber">
              <div className="kpi-title">หัก: ต้นทุนค่ายา ({costDeductionMode === 'actual' ? 'ทุนจริง' : costDeductionMode === 'percent' ? `เหมาจ่าย ${customCostPercent}%` : '0%'})</div>
              <div className="kpi-value text-amber">-{grandTotals.deductedCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</div>
              <div className="kpi-sub">
                {costDeductionMode === 'actual' ? `ต้นทุนมาตรฐาน HOSxP` : `คำนวณหัก ${customCostPercent}% ของยอดชดเชย`}
              </div>
            </div>

            <div className="payout-kpi-card purple">
              <div className="kpi-title">กำไรส่วนต่างรวม (Gross Margin)</div>
              <div className="kpi-value text-purple">{grandTotals.grossMargin.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</div>
              <div className="kpi-sub">
                กำไรขั้นต้นก่อนหักค่าบริหาร
              </div>
            </div>

            {withholdMismatch && (
              <div className="payout-kpi-card rose">
                <div className="kpi-title">หัก: สำรองเคส Diag ผิด (Withheld)</div>
                <div className="kpi-value text-red">-{grandTotals.withheldAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</div>
                <div className="kpi-sub">
                  กันเงินไว้รอ รพ.สต. ปรับปรุงรหัสโรค
                </div>
              </div>
            )}

            <div className="payout-kpi-card emerald highlight">
              <div className="kpi-title">💵 ยอดสุทธิสั่งจ่าย 5 รพ.สต. (Net Payable)</div>
              <div className="kpi-value text-emerald">{grandTotals.netPayable.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</div>
              <div className="kpi-sub">
                {thaiBahtText(grandTotals.netPayable)}
              </div>
            </div>
          </div>

          {/* Main Settlement Table */}
          <div className="payout-table-card">
            <div className="payout-table-card-header">
              <div className="table-title">
                <span>🏢</span> ตารางสรุปยอดจัดสรรและสั่งจ่ายเงินราย รพ.สต.
              </div>
              <div className="table-subtitle">
                คลิกปุ่ม <strong>"🖨️ พิมพ์ใบสำคัญจ่าย"</strong> ของแต่ละแห่ง เพื่อเปิดเอกสารสำหรับผู้บริหารลงนาม
              </div>
            </div>

            <div className="table-responsive">
              <table className="payout-table">
                <thead>
                  <tr>
                    <th>รหัส</th>
                    <th>ชื่อหน่วยบริการ รพ.สต.</th>
                    <th className="text-right">ครั้งที่จ่าย</th>
                    <th className="text-right">ยอดชดเชยรวม (1)</th>
                    <th className="text-right">หัก: ต้นทุนยา (2)</th>
                    <th className="text-right">กำไรส่วนต่าง (3)</th>
                    {hospitalAdminFeePercent > 0 && <th className="text-right">หัก: ค่าบริหาร รพ.</th>}
                    {withholdMismatch && <th className="text-right">หัก: Diag ผิด</th>}
                    <th className="text-right highlight-col">ยอดสุทธิที่ต้องจ่าย (4)</th>
                    <th className="text-center">สัดส่วนจ่าย</th>
                    <th className="text-center">เอกสารสั่งจ่าย</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutRows.map((row) => (
                    <tr key={row.code}>
                      <td>
                        <span className="badge-pcu">{row.code}</span>
                      </td>
                      <td>
                        <strong>{row.name}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          IP: {row.host} | hospcu{row.code}
                        </div>
                      </td>
                      <td className="text-right font-mono">{row.dispenseCount.toLocaleString()}</td>
                      <td className="text-right font-mono font-bold" style={{ color: '#1e40af' }}>
                        {row.grossReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                      </td>
                      <td className="text-right font-mono" style={{ color: '#b45309' }}>
                        -{row.deductedCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{row.costDeductionLabel}</div>
                      </td>
                      <td className="text-right font-mono" style={{ color: '#6b21a8' }}>
                        {row.grossMargin.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                      </td>
                      {hospitalAdminFeePercent > 0 && (
                        <td className="text-right font-mono" style={{ color: '#991b1b' }}>
                          -{row.adminFeeDeducted.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                        </td>
                      )}
                      {withholdMismatch && (
                        <td className="text-right font-mono" style={{ color: '#dc2626' }}>
                          {row.withheldAmount > 0 ? `-${row.withheldAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿` : '-'}
                        </td>
                      )}
                      <td className="text-right font-mono font-bold highlight-col" style={{ color: '#047857', fontSize: '1.05rem' }}>
                        {row.netPayable.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                      </td>
                      <td className="text-center">
                        <span className="badge-rate">{row.effectiveRate}%</span>
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          className="btn-voucher-action"
                          onClick={() => handleOpenVoucher(row.code)}
                          title="เปิดและพิมพ์ใบสำคัญสั่งจ่ายเงินทางการ"
                        >
                          🖨️ พิมพ์ใบสำคัญจ่าย
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="table-total-row">
                    <td colSpan={2}>
                      <strong>รวมยอดสั่งจ่ายทั้ง 5 รพ.สต.</strong>
                    </td>
                    <td className="text-right font-mono">{grandTotals.dispenseCount.toLocaleString()}</td>
                    <td className="text-right font-mono" style={{ color: '#1e40af' }}>
                      {grandTotals.grossReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </td>
                    <td className="text-right font-mono" style={{ color: '#b45309' }}>
                      -{grandTotals.deductedCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </td>
                    <td className="text-right font-mono" style={{ color: '#6b21a8' }}>
                      {grandTotals.grossMargin.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </td>
                    {hospitalAdminFeePercent > 0 && (
                      <td className="text-right font-mono" style={{ color: '#991b1b' }}>
                        -{grandTotals.adminFeeDeducted.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                      </td>
                    )}
                    {withholdMismatch && (
                      <td className="text-right font-mono" style={{ color: '#dc2626' }}>
                        -{grandTotals.withheldAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                      </td>
                    )}
                    <td className="text-right font-mono highlight-col" style={{ color: '#047857', fontSize: '1.15rem' }}>
                      {grandTotals.netPayable.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </td>
                    <td colSpan={2} className="text-center" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {thaiBahtText(grandTotals.netPayable)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Printable Payment Voucher Modal */}
      {voucherModalOpen && selectedVoucherRow && (
        <div className="voucher-modal-overlay" onClick={() => setVoucherModalOpen(false)}>
          <div className="voucher-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="voucher-modal-top-actions no-print">
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>เลือก รพ.สต.:</label>
                <select
                  value={selectedVoucherPcuCode}
                  onChange={(e) => setSelectedVoucherPcuCode(e.target.value)}
                  style={{ padding: '0.35rem 0.6rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                >
                  {payoutRows.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} - {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, margin: '0 1rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}>วัตถุประสงค์:</label>
                <input
                  type="text"
                  value={voucherNotes}
                  onChange={(e) => setVoucherNotes(e.target.value)}
                  placeholder="ระบุวัตถุประสงค์การจ่ายเงิน..."
                  style={{ width: '100%', padding: '0.35rem 0.6rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn-payout btn-primary" onClick={handlePrintVoucher}>
                  🖨️ พิมพ์เอกสารนี้ (Print / PDF)
                </button>
                <button type="button" className="btn-payout btn-outline" onClick={() => setVoucherModalOpen(false)}>
                  ✕ ปิด
                </button>
              </div>
            </div>

            {/* Official Printable Voucher Paper (A4 size format) */}
            <div className="printable-voucher-paper">
              <div className="voucher-header">
                <div className="voucher-gov-symbol">🏛️</div>
                <h2>ใบสำคัญการสั่งจ่ายเงินจัดสรรค่าบริการสาธารณสุขและเวชภัณฑ์</h2>
                <div className="voucher-sub-header">
                  โรงพยาบาลเต่างอย จังหวัดสกลนคร (โรงพยาบาลแม่ข่าย CUP)
                </div>
                <div className="voucher-doc-meta">
                  <span><strong>ประจำงวด:</strong> {startDate} ถึง {endDate}</span>
                  <span><strong>วันที่จัดทำ:</strong> {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              </div>

              <div className="voucher-entity-info">
                <div className="entity-row">
                  <span className="lbl">หน่วยบริการผู้รับเงินจัดสรร:</span>
                  <span className="val"><strong>{selectedVoucherRow.name}</strong></span>
                </div>
                <div className="entity-row">
                  <span className="lbl">รหัสหน่วยบริการ (HCODE):</span>
                  <span className="val"><span className="badge-pcu">{selectedVoucherRow.code}</span> (HOSxP Database: <code>hospcu{selectedVoucherRow.code}</code>)</span>
                </div>
                <div className="entity-row">
                  <span className="lbl">วัตถุประสงค์การจ่าย:</span>
                  <span className="val">{voucherNotes}</span>
                </div>
              </div>

              {/* Breakdown Table in Voucher */}
              <table className="voucher-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }} className="text-center">ลำดับ</th>
                    <th>รายการรายละเอียดค่าบริการ / เวชภัณฑ์</th>
                    <th style={{ width: '90px' }} className="text-right">ครั้งที่จ่าย</th>
                    <th style={{ width: '120px' }} className="text-right">ยอดชดเชย (บาท)</th>
                    <th style={{ width: '120px' }} className="text-right">หักต้นทุน (บาท)</th>
                    <th style={{ width: '130px' }} className="text-right">ยอดสุทธิ (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedCategory === 'all' || selectedCategory === 'herbal') && (
                    <tr>
                      <td className="text-center">1</td>
                      <td>
                        <strong>เวชภัณฑ์ยาสมุนไพร 46 รายการ (สปสช. H-Sub)</strong>
                        <div className="voucher-item-sub">
                          จ่ายจากคลังยา รพ.สต. เพื่อทดแทนยาแผนปัจจุบัน
                        </div>
                      </td>
                      <td className="text-right font-mono">{selectedVoucherRow.dispenseCount.toLocaleString()}</td>
                      <td className="text-right font-mono">{selectedVoucherRow.herbalReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td className="text-right font-mono text-amber">
                        {costDeductionMode === 'actual' ? `-${selectedVoucherRow.actualCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : costDeductionMode === 'percent' ? `-${(Math.round(selectedVoucherRow.herbalReimbursed * (customCostPercent / 100) * 100) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '0.00'}
                      </td>
                      <td className="text-right font-mono font-bold">
                        {costDeductionMode === 'actual' ? Math.max(0, selectedVoucherRow.herbalReimbursed - selectedVoucherRow.actualCost).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : costDeductionMode === 'percent' ? Math.max(0, selectedVoucherRow.herbalReimbursed * (1 - customCostPercent / 100)).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : selectedVoucherRow.herbalReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  )}

                  {(selectedCategory === 'all' || selectedCategory === 'iron_folic') && (
                    <>
                      <tr>
                        <td className="text-center">2</td>
                        <td>
                          <strong>Triferdine 150 mg (ยาเสริมธาตุเหล็กหญิงตั้งครรภ์)</strong>
                          <div className="voucher-item-sub">
                            จัดสรรตามโควตาชดเชย รพ.สต. ประจำปีงบประมาณ 2569
                          </div>
                        </td>
                        <td className="text-right font-mono">-</td>
                        <td className="text-right font-mono">{selectedVoucherRow.triferdineReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                        <td className="text-right font-mono text-amber">-</td>
                        <td className="text-right font-mono font-bold">{selectedVoucherRow.triferdineReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      </tr>
                      <tr>
                        <td className="text-center">3</td>
                        <td>
                          <strong>Folic Acid (กรดโฟลิก 80 บาท/คอร์ส)</strong>
                          <div className="voucher-item-sub">
                            คอร์สละ 52 เม็ด (ต้นทุน 6.24 บาท/คอร์ส)
                          </div>
                        </td>
                        <td className="text-right font-mono">-</td>
                        <td className="text-right font-mono">{selectedVoucherRow.folicReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                        <td className="text-right font-mono text-amber">-</td>
                        <td className="text-right font-mono font-bold">{selectedVoucherRow.folicReimbursed.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    </>
                  )}

                  {selectedVoucherRow.adminFeeDeducted > 0 && (
                    <tr style={{ background: '#fef2f2' }}>
                      <td className="text-center">4</td>
                      <td>
                        <strong>หัก: ค่าบริหารจัดการเครือข่าย รพ.แม่ข่าย ({hospitalAdminFeePercent}%)</strong>
                      </td>
                      <td className="text-right font-mono">-</td>
                      <td className="text-right font-mono">-</td>
                      <td className="text-right font-mono text-red">-{selectedVoucherRow.adminFeeDeducted.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td className="text-right font-mono text-red">-{selectedVoucherRow.adminFeeDeducted.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  )}

                  {selectedVoucherRow.withheldAmount > 0 && (
                    <tr style={{ background: '#fff1f2' }}>
                      <td className="text-center">5</td>
                      <td>
                        <strong>หัก: เงินสำรองกรณีตรวจพบ Diag ไม่ตรงข้อบ่งใช้ยา (รอ รพ.สต. แก้ไข)</strong>
                        <div className="voucher-item-sub" style={{ color: '#be123c' }}>
                          จะโอนจ่ายคืนให้ในงวดถัดไปเมื่อ รพ.สต. ปรับปรุงรหัสโรคใน HOSxP PCU เรียบร้อย
                        </div>
                      </td>
                      <td className="text-right font-mono">-</td>
                      <td className="text-right font-mono">-</td>
                      <td className="text-right font-mono text-red">-{selectedVoucherRow.withheldAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td className="text-right font-mono text-red">-{selectedVoucherRow.withheldAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="voucher-grand-total-row">
                    <td colSpan={5} className="text-right">
                      <strong>รวมยอดเงินสุทธิที่สั่งจ่าย (Net Payable):</strong>
                    </td>
                    <td className="text-right font-mono font-bold text-emerald" style={{ fontSize: '1.15rem' }}>
                      {selectedVoucherRow.netPayable.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="voucher-baht-text-cell">
                      <strong>( ตัวอักษร: {thaiBahtText(selectedVoucherRow.netPayable)} )</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Signatures 3 Columns */}
              <div className="voucher-signatures">
                <div className="sig-col">
                  <div className="sig-line">...........................................................</div>
                  <div className="sig-name">( ........................................................... )</div>
                  <div className="sig-pos">ผู้จัดทำ / เจ้าหน้าที่การเงิน</div>
                  <div className="sig-date">วันที่ ......./......./...........</div>
                </div>

                <div className="sig-col">
                  <div className="sig-line">...........................................................</div>
                  <div className="sig-name">( ........................................................... )</div>
                  <div className="sig-pos">ผู้ตรวจสอบ / หน.กลุ่มงานประกันสุขภาพ</div>
                  <div className="sig-date">วันที่ ......./......./...........</div>
                </div>

                <div className="sig-col">
                  <div className="sig-line">...........................................................</div>
                  <div className="sig-name">( ........................................................... )</div>
                  <div className="sig-pos">ผู้อนุมัติจ่าย / ผู้อำนวยการโรงพยาบาล</div>
                  <div className="sig-date">วันที่ ......./......./...........</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
