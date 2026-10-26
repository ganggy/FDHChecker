import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './SsjRawServReportPage.css';

export interface SsjRawServRow {
  code_serv: string;
  serv_type: 'OPD' | 'IPD';
  item: string;
  rights: string;
  rights_code: string;
  amount: number;
}

export interface SsjReportAudit {
  opd_total_visits: number;
  opd_distinct_hn: number;
  ipd_total_admits: number;
  ipd_distinct_hn: number;
  ipd_sum_adjrw: number;
  ipd_sum_los: number;
  pttype_breakdown: Array<{
    pttype: string;
    name: string;
    hipdata_code: string;
    assigned_right: string;
    opd_visits: number;
    ipd_admits: number;
  }>;
}

export interface SsjReportData {
  startDate: string;
  endDate: string;
  rows: SsjRawServRow[];
  audit: SsjReportAudit;
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export const SsjRawServReportPage: React.FC = () => {
  // Current date defaults
  const now = new Date();
  const currentYearCE = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  const [selectedYearBE, setSelectedYearBE] = useState<number>(currentYearCE + 543);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [isCustomDate, setIsCustomDate] = useState<boolean>(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<SsjReportData | null>(null);

  // Table filter state
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'OPD' | 'IPD'>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showAudit, setShowAudit] = useState<boolean>(false);

  // Sync date range when month/year changes
  useEffect(() => {
    if (!isCustomDate) {
      const yearCE = selectedYearBE - 543;
      const mm = String(selectedMonth).padStart(2, '0');
      const start = `${yearCE}-${mm}-01`;
      // calculate last day of month
      const lastDay = new Date(yearCE, selectedMonth, 0).getDate();
      const end = `${yearCE}-${mm}-${String(lastDay).padStart(2, '0')}`;
      setStartDate(start);
      setEndDate(end);
    }
  }, [selectedYearBE, selectedMonth, isCustomDate]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ssj-rawserv?startDate=${startDate}&endDate=${endDate}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูลรายงานได้');
      }
      setReportData(json.data);
    } catch (err: any) {
      setError(err?.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // Initial load
  useEffect(() => {
    if (startDate && endDate) {
      fetchReport();
    }
  }, [fetchReport]);

  // Handle Export Excel
  const handleExportExcel = async () => {
    if (!startDate || !endDate) return;
    setExporting(true);
    try {
      // Must be exact filename: template_ข้อมูลบริการ.xlsx
      const filename = 'template_ข้อมูลบริการ.xlsx';
      const url = `/api/ssj-rawserv/export-excel?startDate=${startDate}&endDate=${endDate}&filename=${encodeURIComponent(filename)}`;
      
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('ส่งออกไฟล์ Excel ไม่สำเร็จ');
      }
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(err?.message || 'เกิดข้อผิดพลาดในการส่งออกไฟล์ Excel');
    } finally {
      setExporting(false);
    }
  };

  // Filtered rows for display
  const filteredRows = useMemo(() => {
    if (!reportData?.rows) return [];
    return reportData.rows.filter((row) => {
      if (typeFilter !== 'ALL' && row.serv_type !== typeFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          row.code_serv.toLowerCase().includes(q) ||
          row.rights.toLowerCase().includes(q) ||
          row.item.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [reportData, typeFilter, searchTerm]);

  // Helper for right badge styling
  const getRightBadgeClass = (right: string) => {
    switch (right) {
      case 'UC': return 'right-uc';
      case 'SSS': return 'right-sss';
      case 'OFC': return 'right-ofc';
      case 'LGO': return 'right-lgo';
      case 'STP': return 'right-stp';
      case 'FWF': return 'right-fwf';
      case 'ชำระเงินเอง': return 'right-pay';
      case 'รวมทั้งหมดทุกสิทธิ': return 'right-total';
      default: return 'right-other';
    }
  };

  // Helper for KPI lookups
  const getAmountByCode = (code: string) => {
    return reportData?.rows.find((r) => r.code_serv === code)?.amount ?? 0;
  };

  return (
    <div className="ssj-rawserv-page">
      {/* Header */}
      <div className="ssj-header">
        <div className="ssj-title-block">
          <h1>
            <span>📊 รายงานข้อมูลบริการ สสจ. (RawServ)</span>
            <span className="ssj-badge-live">เชื่อมต่อฐาน HOSxP</span>
          </h1>
          <p className="ssj-subtitle">
            ตารางข้อมูลบริการ NewTemp (B1:F56) 54 รายการ รูปแบบตรงตามมาตรฐาน สสจ. สำหรับนำเข้าสู่ระบบ
          </p>
        </div>
        <div className="ssj-actions">
          <button
            className="ssj-btn ssj-btn-success"
            onClick={handleExportExcel}
            disabled={loading || exporting || !reportData}
            title="ดาวน์โหลดไฟล์ template_ข้อมูลบริการ.xlsx พร้อมข้อมูลครบ 54 รายการ"
          >
            {exporting ? '⏳ กำลังส่งออก...' : '📥 ส่งออก template_ข้อมูลบริการ.xlsx'}
          </button>
        </div>
      </div>

      {/* Control Card */}
      <div className="ssj-controls-card">
        <div className="ssj-controls-grid">
          {!isCustomDate ? (
            <>
              <div className="ssj-control-group">
                <label>ประจำเดือน</label>
                <select
                  className="ssj-select"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                >
                  {THAI_MONTHS.map((m, idx) => (
                    <option key={idx} value={idx + 1}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="ssj-control-group">
                <label>ปี พ.ศ.</label>
                <select
                  className="ssj-select"
                  value={selectedYearBE}
                  onChange={(e) => setSelectedYearBE(Number(e.target.value))}
                >
                  {[currentYearCE + 544, currentYearCE + 543, currentYearCE + 542, currentYearCE + 541].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="ssj-control-group">
                <label>ตั้งแต่วันที่</label>
                <input
                  type="date"
                  className="ssj-input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="ssj-control-group">
                <label>ถึงวันที่</label>
                <input
                  type="date"
                  className="ssj-input"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="ssj-control-group">
            <label>&nbsp;</label>
            <button
              className="ssj-btn ssj-btn-primary"
              onClick={fetchReport}
              disabled={loading}
            >
              {loading ? '🔄 กำลังดึงข้อมูล...' : '🔍 ค้นหา / คำนวณ'}
            </button>
          </div>

          <div className="ssj-control-group" style={{ marginLeft: 'auto' }}>
            <label>&nbsp;</label>
            <button
              className="ssj-btn ssj-btn-secondary"
              onClick={() => setIsCustomDate(!isCustomDate)}
            >
              {isCustomDate ? '📅 เลือกตามเดือน/ปี' : '⚙️ กำหนดช่วงวันที่เอง'}
            </button>
          </div>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div style={{ padding: '1rem', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '0.5rem', color: '#b91c1c', marginBottom: '1.5rem' }}>
          ⚠️ <strong>เกิดข้อผิดพลาด:</strong> {error}
        </div>
      )}

      {/* KPI Cards */}
      {reportData && (
        <div className="ssj-kpi-grid">
          <div className="ssj-kpi-card kpi-opd">
            <span className="ssj-kpi-title">OPD Visit (ครั้ง/เดือน)</span>
            <span className="ssj-kpi-value">{getAmountByCode('OPV_09').toLocaleString()}</span>
            <span className="ssj-kpi-sub">
              ผู้ป่วยรวม (OPH): {getAmountByCode('OPH_09').toLocaleString()} คน
            </span>
          </div>

          <div className="ssj-kpi-card kpi-ipd">
            <span className="ssj-kpi-title">IPD Admit / จำหน่าย (ครั้ง/เดือน)</span>
            <span className="ssj-kpi-value">{getAmountByCode('IPA_09').toLocaleString()}</span>
            <span className="ssj-kpi-sub">
              ผู้ป่วยรวม (IPH): {getAmountByCode('IPH_09').toLocaleString()} คน
            </span>
          </div>

          <div className="ssj-kpi-card kpi-rw">
            <span className="ssj-kpi-title">IPD SumAdjRW/เดือน</span>
            <span className="ssj-kpi-value">
              {Number(getAmountByCode('IPS_09')).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
            </span>
            <span className="ssj-kpi-sub">น้ำหนักสัมพัทธ์รวมผู้ป่วยใน</span>
          </div>

          <div className="ssj-kpi-card kpi-los">
            <span className="ssj-kpi-title">IPD วันนอนรวม (วัน/เดือน)</span>
            <span className="ssj-kpi-value">{getAmountByCode('IPL_09').toLocaleString()}</span>
            <span className="ssj-kpi-sub">
              เฉลี่ย {reportData.audit.ipd_total_admits > 0 ? (getAmountByCode('IPL_09') / reportData.audit.ipd_total_admits).toFixed(1) : 0} วัน/เคส
            </span>
          </div>
        </div>
      )}

      {/* Main Data Table */}
      <div className="ssj-table-card">
        <div className="ssj-table-header">
          <div className="ssj-table-tabs">
            <button
              className={`ssj-tab-btn ${typeFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setTypeFilter('ALL')}
            >
              ทั้งหมด (54 รายการ)
            </button>
            <button
              className={`ssj-tab-btn ${typeFilter === 'OPD' ? 'active' : ''}`}
              onClick={() => setTypeFilter('OPD')}
            >
              OPD ผู้ป่วยนอก (18)
            </button>
            <button
              className={`ssj-tab-btn ${typeFilter === 'IPD' ? 'active' : ''}`}
              onClick={() => setTypeFilter('IPD')}
            >
              IPD ผู้ป่วยใน (36)
            </button>
          </div>

          <div>
            <input
              type="text"
              placeholder="🔍 ค้นหารหัส, สิทธิ, บริการ..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ssj-input"
              style={{ width: '240px', height: '32px' }}
            />
          </div>
        </div>

        <div className="ssj-table-wrapper">
          <table className="ssj-table">
            <thead>
              <tr>
                <th style={{ width: '60px', textAlign: 'center' }}>ลำดับ</th>
                <th style={{ width: '120px' }}>Code_SerV</th>
                <th style={{ width: '100px' }}>SerV_Type</th>
                <th>Item (ข้อมูลบริการ)</th>
                <th style={{ width: '180px' }}>Rights (สิทธิการรักษา)</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Amount (ผลลัพธ์)</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length > 0 ? (
                filteredRows.map((row, idx) => {
                  const isTotal = row.rights_code === '09';
                  const isDecimal = row.code_serv.startsWith('IPS');
                  return (
                    <tr key={row.code_serv} className={isTotal ? 'row-total' : ''}>
                      <td style={{ textAlign: 'center', color: '#94a3b8' }}>{idx + 1}</td>
                      <td>
                        <strong style={{ fontFamily: 'monospace', color: '#0284c7' }}>
                          {row.code_serv}
                        </strong>
                      </td>
                      <td>
                        <span className={`ssj-badge-type ${row.serv_type.toLowerCase()}`}>
                          {row.serv_type}
                        </span>
                      </td>
                      <td>{row.item}</td>
                      <td>
                        <span className={`ssj-badge-right ${getRightBadgeClass(row.rights)}`}>
                          {row.rights}
                        </span>
                      </td>
                      <td className="ssj-amount-cell">
                        {isDecimal
                          ? Number(row.amount).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
                          : Number(row.amount).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {loading ? 'กำลังประมวลผลข้อมูลบริการ...' : 'ไม่พบข้อมูลที่ตรงกับเงื่อนไข'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Breakdown Accordion */}
      {reportData && reportData.audit && (
        <div className="ssj-audit-card">
          <div className="ssj-audit-header" onClick={() => setShowAudit(!showAudit)}>
            <h3>
              <span>📋 รายละเอียดการจับคู่สิทธิจาก HOSxP (Audit Mapping Breakdown)</span>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                ({reportData.audit.pttype_breakdown.length} สิทธิการรักษาที่พบในเดือนนี้)
              </span>
            </h3>
            <span style={{ fontSize: '1.2rem', color: '#64748b' }}>
              {showAudit ? '▲' : '▼'}
            </span>
          </div>

          {showAudit && (
            <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
              <table className="ssj-table">
                <thead>
                  <tr>
                    <th>รหัสสิทธิ (pttype)</th>
                    <th>ชื่อสิทธิใน HOSxP</th>
                    <th>hipdata_code</th>
                    <th>จัดเข้ากลุ่ม สสจ.</th>
                    <th style={{ textAlign: 'right' }}>OPD Visits</th>
                    <th style={{ textAlign: 'right' }}>IPD Admits</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.audit.pttype_breakdown.map((item) => (
                    <tr key={item.pttype}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{item.pttype}</td>
                      <td>{item.name}</td>
                      <td><span style={{ fontFamily: 'monospace' }}>{item.hipdata_code || '-'}</span></td>
                      <td>
                        <span className={`ssj-badge-right ${getRightBadgeClass(item.assigned_right)}`}>
                          {item.assigned_right}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{item.opd_visits.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{item.ipd_admits.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SsjRawServReportPage;
