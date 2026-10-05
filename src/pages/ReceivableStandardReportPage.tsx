import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './ReceivableStandardReportPage.css';

type ReportType = '1' | '2' | '3' | '4' | '5';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const formatThaiDate = (dateStr?: string) => {
  if (!dateStr) return '';
  const parts = dateStr.slice(0, 10).split('-');
  if (parts.length < 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[0], 10) + 543;
  return `${day} ${THAI_MONTHS[monthIdx] || ''} ${year}`;
};

const formatThaiDateTimeNow = () => {
  const now = new Date();
  const d = now.getDate();
  const m = now.getMonth() + 1;
  const y = now.getFullYear() + 543;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
};

const formatNumber = (num: unknown, minFrac = 2) => {
  const n = Number(num ?? 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('th-TH', {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: minFrac,
  });
};

const formatCount = (num: unknown) => {
  const n = Number(num ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('th-TH');
};

const getFiscalYearRange = (yearBE: number) => {
  const yearCE = yearBE - 543;
  return {
    start: `${yearCE - 1}-10-01`,
    end: `${yearCE}-09-30`,
  };
};

export const ReceivableStandardReportPage: React.FC = () => {
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const defaultStartDate = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
  const defaultEndDate = now.toISOString().slice(0, 10);

  const [reportType, setReportType] = useState<ReportType>('1');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [selectedPttype, setSelectedPttype] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState<any>(null);
  const [printTimestamp, setPrintTimestamp] = useState(formatThaiDateTimeNow());

  const loadReport = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        reportType,
        startDate,
        endDate,
      });
      if (selectedPttype && selectedPttype !== 'ALL') {
        params.set('pttype', selectedPttype);
      }

      const res = await fetch(`/api/receivables/reports/print-report?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูลรายงานได้');
      }
      setReportData(json);
      setPrintTimestamp(formatThaiDateTimeNow());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
      setReportData(null);
    } finally {
      setLoading(false);
    }
  }, [reportType, startDate, endDate, selectedPttype]);

  useEffect(() => {
    setPage(1);
    void loadReport();
  }, [loadReport]);

  const handlePrint = () => {
    setPrintTimestamp(formatThaiDateTimeNow());
    window.print();
  };

  const handleExportExcel = () => {
    if (!reportData?.data || !Array.isArray(reportData.data)) return;
    const worksheet = XLSX.utils.json_to_sheet(reportData.data);
    const workbook = XLSX.utils.book_new();
    const tabName = `Report_${reportType}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, tabName);
    XLSX.writeFile(workbook, `receivable_standard_report_${reportType}_${startDate}_${endDate}.xlsx`);
  };

  // Preset Handlers
  const applyPreset = (type: 'today' | 'thisMonth' | 'lastMonth' | 'fy2568' | 'fy2569') => {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (type === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (type === 'thisMonth') {
      const first = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
      setStartDate(first);
      setEndDate(todayStr);
    } else if (type === 'lastMonth') {
      const prevDate = new Date(curYear, curMonth - 1, 0);
      const prevYear = prevDate.getFullYear();
      const prevMonth = prevDate.getMonth() + 1;
      const first = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      const last = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
      setStartDate(first);
      setEndDate(last);
    } else if (type === 'fy2568') {
      const fy = getFiscalYearRange(2568);
      setStartDate(fy.start);
      setEndDate(fy.end);
    } else if (type === 'fy2569') {
      const fy = getFiscalYearRange(2569);
      setStartDate(fy.start);
      setEndDate(fy.end);
    }
  };

  const rawDataList = useMemo<Record<string, any>[]>(() => {
    return Array.isArray(reportData?.data) ? (reportData.data as Record<string, any>[]) : [];
  }, [reportData?.data]);
  const totals: any = reportData?.totals || {};
  const currentHospital = (reportData?.hospital?.hospitalName || '').trim() || 'โรงพยาบาล';

  const insuranceOfficerName = (
    reportData?.signers?.insurance_head?.name || ''
  ).trim();
  const insuranceOfficerPosition = (
    reportData?.signers?.insurance_head?.position || 'หัวหน้างานประกันสุขภาพ'
  ).trim();

  const financeOfficerName = (
    reportData?.signers?.finance?.name || ''
  ).trim();
  const financeOfficerPosition = (
    reportData?.signers?.finance?.position || 'เจ้าหน้าที่การเงิน'
  ).trim();

  // Filtered rows for Search
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return rawDataList;
    const term = searchTerm.toLowerCase();
    return rawDataList.filter((row: Record<string, any>) => {
      const str = JSON.stringify(row).toLowerCase();
      return str.includes(term);
    });
  }, [rawDataList, searchTerm]);

  // Paginated Rows (for screen only; print displays all)
  const paginatedData = useMemo(() => {
    if (pageSize === 0) return filteredData;
    const start = (page - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const totalPages = pageSize === 0 ? 1 : Math.ceil(filteredData.length / pageSize) || 1;

  const navigateTo = (pageName: string) => {
    window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: pageName } }));
  };

  return (
    <div className="rec-std-page">
      {/* Hero Header */}
      <div className="rec-std-hero no-print">
        <div className="rec-std-hero__left">
          <div className="rec-std-hero__badge">
            <span>📑 Standard Accounts Receivable (5 รูปแบบ)</span>
          </div>
          <h1>รายงานบัญชีลูกหนี้สิทธิ์ (5 รูปแบบมาตรฐาน)</h1>
          <p>
            รายงานสรุปรวมสิทธิการรักษา OPD, แยกตามสิทธิ OPD/IPD, และแบบแจกแจงรายละเอียด 12/13 หมวดค่ารักษา
            ตามระเบียบกระทรวงสาธารณสุขและกรมบัญชีกลาง รองรับการพิมพ์ A4 พร้อมกรอบลงนาม 2 ฝ่าย และส่งออก Excel
          </p>
        </div>

        <div className="rec-std-hero__actions">
          <button
            type="button"
            className="rec-std-btn rec-std-btn--back"
            onClick={() => navigateTo('receivable')}
          >
            ← กลับหน้าลูกหนี้สิทธิ์
          </button>
          <button
            type="button"
            className="rec-std-btn rec-std-btn--back"
            onClick={() => navigateTo('officialReceivable')}
            title="ไปที่แบบฟอร์มลูกหนี้ราชการ 4 แบบมาตรฐาน"
          >
            🏛️ แบบลูกหนี้ราชการ 4 แบบ
          </button>
          <a
            href="/manual_accounts_receivable.html"
            target="_blank"
            rel="noopener noreferrer"
            className="rec-std-btn rec-std-btn--back"
            title="เปิดคู่มือพร้อมภาพประกอบ"
          >
            📖 คู่มือ HTML
          </a>
          <button
            type="button"
            className="rec-std-btn rec-std-btn--excel"
            onClick={handleExportExcel}
            disabled={rawDataList.length === 0}
          >
            📊 ส่งออก Excel
          </button>
          <button
            type="button"
            className="rec-std-btn rec-std-btn--print"
            onClick={handlePrint}
            disabled={rawDataList.length === 0}
          >
            🖨️ พิมพ์เอกสาร (Print / PDF)
          </button>
        </div>
      </div>

      {/* 5 Report Tabs */}
      <div className="rec-std-tabs no-print">
        <button
          type="button"
          className={`rec-std-tab ${reportType === '1' ? 'is-active' : ''}`}
          onClick={() => setReportType('1')}
        >
          <span>1. สรุปรวมสิทธิการรักษา (OPD)</span>
        </button>
        <button
          type="button"
          className={`rec-std-tab ${reportType === '2' ? 'is-active' : ''}`}
          onClick={() => setReportType('2')}
        >
          <span>2. แยกตามสิทธิการรักษา (OPD)</span>
        </button>
        <button
          type="button"
          className={`rec-std-tab ${reportType === '3' ? 'is-active' : ''}`}
          onClick={() => setReportType('3')}
        >
          <span>3. แยกตามสิทธิการรักษา (IPD)</span>
        </button>
        <button
          type="button"
          className={`rec-std-tab ${reportType === '4' ? 'is-active' : ''}`}
          onClick={() => setReportType('4')}
        >
          <span>4. แจกแจงรายละเอียด (OPD)</span>
        </button>
        <button
          type="button"
          className={`rec-std-tab ${reportType === '5' ? 'is-active' : ''}`}
          onClick={() => setReportType('5')}
        >
          <span>5. แจกแจงรายละเอียด (IPD)</span>
        </button>
      </div>

      {/* Filter and Criteria Panel */}
      <div className="rec-std-filters no-print">
        <div className="rec-std-filters__row">
          <div className="rec-std-filter-item">
            <label>วันที่เริ่ม:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="rec-std-filter-item">
            <label>ถึงวันที่:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="rec-std-presets">
            <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>ช่วงด่วน:</span>
            <button type="button" className="rec-std-preset-btn" onClick={() => applyPreset('today')}>วันนี้</button>
            <button type="button" className="rec-std-preset-btn" onClick={() => applyPreset('thisMonth')}>เดือนนี้</button>
            <button type="button" className="rec-std-preset-btn" onClick={() => applyPreset('lastMonth')}>เดือนที่แล้ว</button>
            <button type="button" className="rec-std-preset-btn" onClick={() => applyPreset('fy2568')}>ปีงบ 68</button>
            <button type="button" className="rec-std-preset-btn" onClick={() => applyPreset('fy2569')}>ปีงบ 69</button>
          </div>

          {(reportType === '4' || reportType === '5') && (
            <div className="rec-std-filter-item">
              <label>รหัสสิทธิ:</label>
              <input
                type="text"
                placeholder="เช่น 10, 30 หรือเว้นว่างเพื่อดูทั้งหมด"
                value={selectedPttype === 'ALL' ? '' : selectedPttype}
                onChange={(e) => setSelectedPttype(e.target.value.trim() || 'ALL')}
                style={{ width: '160px' }}
              />
            </div>
          )}

          <button
            type="button"
            className="rec-std-btn rec-std-btn--print"
            onClick={loadReport}
            disabled={loading}
            style={{ background: '#2563eb', color: '#ffffff' }}
          >
            {loading ? '⏳ กำลังคำนวณ...' : '↻ คำนวณรายงาน'}
          </button>
        </div>

        <div className="rec-std-filters__row">
          <div className="rec-std-search-box">
            <input
              type="text"
              placeholder="🔍 ค้นหาด่วนในตาราง (HN / VN / AN / CID / ชื่อผู้ป่วย / สิทธิ / โรค / รหัสลูกหนี้)..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>แสดงหน้าละ:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              style={{ padding: '0.35rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            >
              <option value={50}>50 รายการ</option>
              <option value={100}>100 รายการ</option>
              <option value={200}>200 รายการ</option>
              <option value={0}>ทั้งหมด (All)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Printable Sheet */}
      <div className="rec-std-sheet-container">
        {error && (
          <div className="no-print" style={{ color: '#b91c1c', padding: '1rem', textAlign: 'center', background: '#fef2f2', borderRadius: '8px' }}>
            ⚠️ {error}
          </div>
        )}

        {loading && (
          <div className="rec-std-loading no-print">
            ⏳ กำลังประมวลผลข้อมูลรายงานจากฐานข้อมูล...
          </div>
        )}

        {!loading && !error && (
          <div>
            {/* Document Official Header */}
            <div className="rec-std-doc-header">
              <div className="rec-std-doc-logo">
                <img src="/moph_logo.png" alt="กระทรวงสาธารณสุข" />
              </div>
              <div className="rec-std-doc-titles">
                <h2>{reportData?.title || 'รายงานบัญชีลูกหนี้'}</h2>
                <h3>{currentHospital}</h3>
                <div className="rec-std-doc-period">
                  ข้อมูลระหว่างวันที่ {formatThaiDate(startDate)} ถึง {formatThaiDate(endDate)}
                </div>
              </div>
              <div className="rec-std-doc-meta">
                <div>หน้า 1 / 1</div>
                <div>วันเวลาพิมพ์ {printTimestamp}</div>
              </div>
            </div>

            {/* REPORT 1: สรุปรวมสิทธิการรักษา ผู้ป่วยนอก */}
            {reportType === '1' && (
              <table className="rec-std-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>ที่</th>
                    <th style={{ width: '130px' }}>รหัสลูกหนี้</th>
                    <th>สิทธิลูกหนี้</th>
                    <th style={{ width: '130px' }}>การรับรู้</th>
                    <th style={{ width: '90px' }}>ทะเบียนคุม</th>
                    <th style={{ width: '55px' }}>คน</th>
                    <th style={{ width: '55px' }}>Visit</th>
                    <th style={{ width: '55px' }}>ใหม่</th>
                    <th style={{ width: '55px' }}>เก่า</th>
                    <th style={{ width: '55px' }}>ในเขต</th>
                    <th style={{ width: '55px' }}>นอกเขต</th>
                    <th style={{ width: '105px' }}>จำนวนเงิน</th>
                    <th style={{ width: '95px' }}>จ่ายแล้ว</th>
                    <th style={{ width: '105px' }}>คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="rec-std-empty">ไม่พบข้อมูลในช่วงวันที่เลือก</td>
                    </tr>
                  ) : (
                    (pageSize === 0 ? filteredData : paginatedData).map((row: any, i: number) => (
                      <tr key={row.debtorCode || i}>
                        <td style={{ textAlign: 'center' }}>{row.no || i + 1}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{row.debtorCode}</td>
                        <td>{row.debtorName}</td>
                        <td>{row.recognition || ''}</td>
                        <td style={{ textAlign: 'center' }}>{row.controlRegister || ''}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.patientCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.visitCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.newCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.oldCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.inCupCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.outCupCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.totalAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.remainAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center' }}>รวม</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.patientCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.visitCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.newCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.oldCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.inCupCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.outCupCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* REPORT 2: แยกตามสิทธิการรักษา ผู้ป่วยนอก */}
            {reportType === '2' && (
              <table className="rec-std-table">
                <thead>
                  <tr>
                    <th style={{ width: '45px' }}>รหัส</th>
                    <th style={{ width: '45px' }}>สนย.</th>
                    <th style={{ width: '55px' }}>PCODE</th>
                    <th>ชื่อสิทธิ</th>
                    <th style={{ width: '120px' }}>รหัสลูกหนี้</th>
                    <th>สิทธิลูกหนี้</th>
                    <th style={{ width: '50px' }}>คน</th>
                    <th style={{ width: '50px' }}>Visit</th>
                    <th style={{ width: '50px' }}>ใหม่</th>
                    <th style={{ width: '50px' }}>เก่า</th>
                    <th style={{ width: '50px' }}>ในเขต</th>
                    <th style={{ width: '50px' }}>นอกเขต</th>
                    <th style={{ width: '100px' }}>จำนวนเงิน</th>
                    <th style={{ width: '90px' }}>จ่ายแล้ว</th>
                    <th style={{ width: '100px' }}>คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="rec-std-empty">ไม่พบข้อมูลในช่วงวันที่เลือก</td>
                    </tr>
                  ) : (
                    (pageSize === 0 ? filteredData : paginatedData).map((row: any, i: number) => (
                      <tr key={`${row.pttype}-${i}`}>
                        <td style={{ textAlign: 'center' }}>{row.pttype}</td>
                        <td style={{ textAlign: 'center' }}>{row.nhsoCode}</td>
                        <td style={{ textAlign: 'center' }}>{row.pcode}</td>
                        <td>{row.pttypeName}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{row.debtorCode}</td>
                        <td>{row.debtorName}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.patientCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.visitCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.newCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.oldCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.inCupCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.outCupCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.totalAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.remainAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center' }}>รวม</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.patientCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.visitCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.newCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.oldCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.inCupCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.outCupCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* REPORT 3: แยกตามสิทธิการรักษา ผู้ป่วยใน */}
            {reportType === '3' && (
              <table className="rec-std-table">
                <thead>
                  <tr>
                    <th style={{ width: '45px' }}>รหัส</th>
                    <th style={{ width: '45px' }}>สนย.</th>
                    <th style={{ width: '55px' }}>PCODE</th>
                    <th>ชื่อสิทธิ</th>
                    <th style={{ width: '120px' }}>รหัสลูกหนี้</th>
                    <th>สิทธิลูกหนี้</th>
                    <th style={{ width: '45px' }}>คน</th>
                    <th style={{ width: '45px' }}>Visit</th>
                    <th style={{ width: '45px' }}>ใหม่</th>
                    <th style={{ width: '45px' }}>เก่า</th>
                    <th style={{ width: '45px' }}>ในเขต</th>
                    <th style={{ width: '45px' }}>นอกเขต</th>
                    <th style={{ width: '55px' }}>วันนอน</th>
                    <th style={{ width: '95px' }}>จำนวนเงิน</th>
                    <th style={{ width: '85px' }}>จ่ายแล้ว</th>
                    <th style={{ width: '95px' }}>คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="rec-std-empty">ไม่พบข้อมูลผู้ป่วยในในช่วงวันที่เลือก</td>
                    </tr>
                  ) : (
                    (pageSize === 0 ? filteredData : paginatedData).map((row: any, i: number) => (
                      <tr key={`${row.pttype}-${i}`}>
                        <td style={{ textAlign: 'center' }}>{row.pttype}</td>
                        <td style={{ textAlign: 'center' }}>{row.nhsoCode}</td>
                        <td style={{ textAlign: 'center' }}>{row.pcode}</td>
                        <td>{row.pttypeName}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{row.debtorCode}</td>
                        <td>{row.debtorName}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.patientCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.visitCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.newCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.oldCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.inCupCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.outCupCount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(row.losDays)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.totalAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.remainAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center' }}>รวม</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.patientCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.visitCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.newCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.oldCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.inCupCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.outCupCount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(totals.losDays)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* REPORT 4: แบบแจกแจงรายละเอียด ผู้ป่วยนอก (12 หมวด) */}
            {reportType === '4' && (
              <table className="rec-std-table">
                <thead>
                  <tr>
                    <th style={{ width: '28px' }}>ที่</th>
                    <th style={{ width: '65px' }}>วันที่</th>
                    <th style={{ width: '38px' }}>รหัสสิทธิ</th>
                    <th style={{ width: '85px' }}>CID<br />ใบเสร็จ</th>
                    <th>ชื่อ - สกุล<br />HN VN</th>
                    <th style={{ width: '55px' }}>เพศ/อายุ</th>
                    <th style={{ width: '50px' }}>การวินิจฉัย</th>
                    <th style={{ width: '50px' }}>หัตถการ</th>
                    <th className="vertical-header"><div>ค่าอวัยวะเทียมและอุปกรณ์บำบัดโรค</div></th>
                    <th className="vertical-header"><div>ค่ายาและเวชภัณฑ์</div></th>
                    <th className="vertical-header"><div>ค่าตรวจวินิจฉัยทางเทคนิคการแพทย์</div></th>
                    <th className="vertical-header"><div>ค่าตรวจวินิจฉัยทางรังสีวิทยา</div></th>
                    <th className="vertical-header"><div>ค่าตรวจวินิจฉัยโดยวิธีพิเศษอื่น</div></th>
                    <th className="vertical-header"><div>ค่าอุปกรณ์ของใช้และเครื่องมือทางการแพทย์</div></th>
                    <th className="vertical-header"><div>ค่าทำหัตถการและวิสัญญี</div></th>
                    <th className="vertical-header"><div>ค่าบริการทางการพยาบาล</div></th>
                    <th className="vertical-header"><div>ค่าบริการทางทันตกรรม</div></th>
                    <th className="vertical-header"><div>ค่าบริการทางกายภาพ</div></th>
                    <th className="vertical-header"><div>ค่าบริการบำบัดของผู้ประกอบโรคศิลปะอื่น</div></th>
                    <th className="vertical-header"><div>ค่าบริการอื่นๆ</div></th>
                    <th style={{ width: '80px' }}>ยอดเงิน</th>
                    <th style={{ width: '75px' }}>จ่ายแล้ว</th>
                    <th style={{ width: '80px' }}>คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={23} className="rec-std-empty">ไม่พบข้อมูลรายการแจกแจงในช่วงวันที่เลือก</td>
                    </tr>
                  ) : (
                    (pageSize === 0 ? filteredData : paginatedData).map((row: any, i: number) => (
                      <tr key={`${row.vn}-${i}`}>
                        <td style={{ textAlign: 'center' }}>{row.no || i + 1}</td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{row.serviceDate}</td>
                        <td style={{ textAlign: 'center' }}>{row.pttype}</td>
                        <td>
                          <div>{row.cid}</div>
                          {row.receiptNo && <small style={{ color: '#0369a1' }}>'{row.receiptNo}' OPD</small>}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.patientName}</div>
                          <small style={{ color: '#64748b' }}>{row.hn} {row.vn}</small>
                        </td>
                        <td style={{ textAlign: 'center' }}>{row.sexAge}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.diagnosis}</td>
                        <td style={{ textAlign: 'center' }}>{row.procedureCode}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incProsthesis)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incMedicine)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incLab)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incXray)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incSpecialDiag)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incEquipment)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incOperation)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incNursing)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incDental)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incPhysical)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incTraditional)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incOther)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(row.totalAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(row.remainAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center' }}>รวม</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incProsthesis)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incMedicine)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incLab)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incXray)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incSpecialDiag)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incEquipment)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incOperation)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incNursing)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incDental)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incPhysical)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incTraditional)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incOther)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* REPORT 5: แบบแจกแจงรายละเอียด ผู้ป่วยใน (13 หมวด) */}
            {reportType === '5' && (
              <table className="rec-std-table">
                <thead>
                  <tr>
                    <th style={{ width: '28px' }}>ที่</th>
                    <th style={{ width: '70px' }}>วันที่<br />Admit / D/C</th>
                    <th style={{ width: '38px' }}>รหัสสิทธิ</th>
                    <th style={{ width: '90px' }}>เลขที่บัตร(CID)<br />เลขที่ใบเสร็จ</th>
                    <th>ชื่อ - สกุล<br />HN AN</th>
                    <th style={{ width: '55px' }}>เพศ/อายุ</th>
                    <th style={{ width: '50px' }}>การวินิจฉัย</th>
                    <th style={{ width: '50px' }}>หัตถการ</th>
                    <th className="vertical-header"><div>ค่าห้อง/ค่าอาหาร</div></th>
                    <th className="vertical-header"><div>ค่าอวัยวะเทียมและอุปกรณ์บำบัดโรค</div></th>
                    <th className="vertical-header"><div>ค่ายาและเวชภัณฑ์</div></th>
                    <th className="vertical-header"><div>ค่าตรวจวินิจฉัยทางเทคนิคการแพทย์</div></th>
                    <th className="vertical-header"><div>ค่าตรวจวินิจฉัยทางรังสีวิทยา</div></th>
                    <th className="vertical-header"><div>ค่าตรวจวินิจฉัยโดยวิธีพิเศษอื่น</div></th>
                    <th className="vertical-header"><div>ค่าอุปกรณ์ของใช้และเครื่องมือทางการแพทย์</div></th>
                    <th className="vertical-header"><div>ค่าทำหัตถการและวิสัญญี</div></th>
                    <th className="vertical-header"><div>ค่าบริการทางการพยาบาล</div></th>
                    <th className="vertical-header"><div>ค่าบริการทางทันตกรรม</div></th>
                    <th className="vertical-header"><div>ค่าบริการทางกายภาพ</div></th>
                    <th className="vertical-header"><div>ค่าบริการบำบัดของผู้ประกอบโรคศิลปะอื่น</div></th>
                    <th className="vertical-header"><div>ค่าบริการอื่นๆ</div></th>
                    <th style={{ width: '80px' }}>ยอดเงิน</th>
                    <th style={{ width: '75px' }}>จ่ายแล้ว</th>
                    <th style={{ width: '80px' }}>คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={24} className="rec-std-empty">ไม่พบข้อมูลผู้ป่วยในในช่วงวันที่เลือก</td>
                    </tr>
                  ) : (
                    (pageSize === 0 ? filteredData : paginatedData).map((row: any, i: number) => (
                      <tr key={`${row.an}-${i}`}>
                        <td style={{ textAlign: 'center' }}>{row.no || i + 1}</td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div>{row.admitDate}</div>
                          <div style={{ color: '#475569' }}>{row.dchDate}</div>
                        </td>
                        <td style={{ textAlign: 'center' }}>{row.pttype}</td>
                        <td>
                          <div>{row.cid}</div>
                          {row.receiptNo && <small style={{ color: '#0369a1' }}>'{row.receiptNo}'</small>}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.patientName}</div>
                          <small style={{ color: '#64748b' }}>{row.hn} {row.an}</small>
                        </td>
                        <td style={{ textAlign: 'center' }}>{row.sexAge}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.diagnosis}</td>
                        <td style={{ textAlign: 'center' }}>{row.procedureCode}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incRoomBoard)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incProsthesis)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incMedicine)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incLab)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incXray)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incSpecialDiag)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incEquipment)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incOperation)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incNursing)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incDental)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incPhysical)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incTraditional)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.incOther)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(row.totalAmount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(row.remainAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center' }}>รวม</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incRoomBoard)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incProsthesis)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incMedicine)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incLab)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incXray)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incSpecialDiag)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incEquipment)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incOperation)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incNursing)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incDental)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incPhysical)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incTraditional)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.incOther)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* Pagination Controls (screen only) */}
            {filteredData.length > 0 && pageSize > 0 && (
              <div className="rec-std-pagination no-print">
                <div>
                  แสดงรายการที่ <strong>{(page - 1) * pageSize + 1}</strong> -{' '}
                  <strong>{Math.min(page * pageSize, filteredData.length)}</strong> จากทั้งหมด{' '}
                  <strong>{formatCount(filteredData.length)}</strong> รายการ
                </div>
                <div className="rec-std-pagination__controls">
                  <button
                    type="button"
                    className="rec-std-page-btn"
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                  >
                    ◀ ก่อนหน้า
                  </button>
                  <span style={{ margin: '0 0.5rem' }}>
                    หน้า <strong>{page}</strong> / <strong>{totalPages}</strong>
                  </span>
                  <button
                    type="button"
                    className="rec-std-page-btn"
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    disabled={page >= totalPages}
                  >
                    ถัดไป ▶
                  </button>
                </div>
              </div>
            )}

            {/* Signatures Footer */}
            <div className="rec-std-signatures">
              <div className="rec-std-sig-box">
                <div className="rec-std-sig-label">
                  ลงชื่อ ........................................................................ ผู้ส่งข้อมูล
                </div>
                <div className="rec-std-sig-name">
                  ( {insuranceOfficerName || '........................................................................'} )
                </div>
                <div className="rec-std-sig-pos">
                  {insuranceOfficerPosition}
                </div>
              </div>

              <div className="rec-std-sig-box">
                <div className="rec-std-sig-label">
                  ลงชื่อ ........................................................................ ผู้รับข้อมูล
                </div>
                <div className="rec-std-sig-name">
                  ( {financeOfficerName || '........................................................................'} )
                </div>
                <div className="rec-std-sig-pos">
                  {financeOfficerPosition}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReceivableStandardReportPage;
