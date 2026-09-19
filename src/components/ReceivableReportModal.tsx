import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';

export type ReportType = '1' | '2' | '3' | '4' | '5';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultStartDate?: string;
  defaultEndDate?: string;
  defaultPttype?: string;
  hospitalName?: string;
  signers?: {
    director?: { name?: string; position?: string };
    insurance?: { name?: string; position?: string };
    finance?: { name?: string; position?: string };
  };
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
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

export const ReceivableReportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  defaultStartDate = new Date().toISOString().slice(0, 10),
  defaultEndDate = new Date().toISOString().slice(0, 10),
  defaultPttype = 'ALL',
  hospitalName = '',
  signers,
}) => {
  const [reportType, setReportType] = useState<ReportType>('1');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [selectedPttype, setSelectedPttype] = useState(defaultPttype);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState<any>(null);
  const [printTimestamp, setPrintTimestamp] = useState(formatThaiDateTimeNow());
  const reportRef = useRef<HTMLDivElement>(null);

  // Sync dates when modal opens
  useEffect(() => {
    if (isOpen) {
      setStartDate(defaultStartDate);
      setEndDate(defaultEndDate);
      setPrintTimestamp(formatThaiDateTimeNow());
    }
  }, [isOpen, defaultStartDate, defaultEndDate]);

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
    if (isOpen) {
      loadReport();
    }
  }, [isOpen, loadReport]);

  if (!isOpen) return null;

  const handlePrint = () => {
    setPrintTimestamp(formatThaiDateTimeNow());
    window.print();
  };

  const handleExportExcel = () => {
    if (!reportData?.data || !Array.isArray(reportData.data)) return;
    const worksheet = XLSX.utils.json_to_sheet(reportData.data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Report_${reportType}`);
    XLSX.writeFile(workbook, `receivable_report_${reportType}_${startDate}_${endDate}.xlsx`);
  };

  const dataList: any[] = reportData?.data || [];
  const totals: any = reportData?.totals || {};
  const currentHospital = (reportData?.hospital?.hospitalName || hospitalName || '').trim() || 'โรงพยาบาล';

  const insuranceOfficerName = (
    reportData?.signers?.insurance_head?.name ||
    signers?.insurance?.name ||
    ''
  ).trim();
  const insuranceOfficerPosition = (
    reportData?.signers?.insurance_head?.position ||
    signers?.insurance?.position ||
    'หัวหน้างานประกันสุขภาพ'
  ).trim();

  const financeOfficerName = (
    reportData?.signers?.finance?.name ||
    signers?.finance?.name ||
    ''
  ).trim();
  const financeOfficerPosition = (
    reportData?.signers?.finance?.position ||
    signers?.finance?.position ||
    'เจ้าหน้าที่การเงิน'
  ).trim();

  return (
    <div className="receivable-modal-backdrop" onClick={onClose}>
      <div className="receivable-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Modal Controls Bar (Hidden in Print) */}
        <div className="receivable-modal-controls no-print">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🖨️</span>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                พิมพ์รายงานบัญชีลูกหนี้สิทธิ์ (5 รูปแบบมาตรฐาน)
              </h2>
            </div>
            <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#64748b' }}>
              ✕
            </button>
          </div>

          {/* Report Type Selector Tabs */}
          <div className="receivable-report-tabs">
            <button
              type="button"
              className={`receivable-tab-btn ${reportType === '1' ? 'is-active' : ''}`}
              onClick={() => setReportType('1')}
            >
              1. สรุปรวมสิทธิการรักษา (OPD)
            </button>
            <button
              type="button"
              className={`receivable-tab-btn ${reportType === '2' ? 'is-active' : ''}`}
              onClick={() => setReportType('2')}
            >
              2. แยกตามสิทธิการรักษา (OPD)
            </button>
            <button
              type="button"
              className={`receivable-tab-btn ${reportType === '3' ? 'is-active' : ''}`}
              onClick={() => setReportType('3')}
            >
              3. แยกตามสิทธิการรักษา (IPD)
            </button>
            <button
              type="button"
              className={`receivable-tab-btn ${reportType === '4' ? 'is-active' : ''}`}
              onClick={() => setReportType('4')}
            >
              4. แจกแจงรายละเอียด (OPD)
            </button>
            <button
              type="button"
              className={`receivable-tab-btn ${reportType === '5' ? 'is-active' : ''}`}
              onClick={() => setReportType('5')}
            >
              5. แจกแจงรายละเอียด (IPD)
            </button>
          </div>

          {/* Filter Toolbar */}
          <div className="receivable-report-filters">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>วันที่เริ่ม:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>ถึงวันที่:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            {(reportType === '4' || reportType === '5') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>รหัสสิทธิ:</label>
                <input
                  type="text"
                  placeholder="เช่น 10, 30 (หรือว่างเพื่อดูทั้งหมด)"
                  value={selectedPttype === 'ALL' ? '' : selectedPttype}
                  onChange={(e) => setSelectedPttype(e.target.value.trim() || 'ALL')}
                  style={{ width: '150px', padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>
            )}

            <button
              type="button"
              onClick={loadReport}
              disabled={loading}
              className="btn btn-primary"
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.88rem' }}
            >
              {loading ? '⏳ กำลังคำนวณ...' : '↻ คำนวณรายงาน'}
            </button>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={dataList.length === 0}
                style={{
                  background: '#047857',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.4rem 0.9rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  cursor: 'pointer'
                }}
              >
                📊 ส่งออก Excel
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={dataList.length === 0}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.4rem 1.1rem',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(37,99,235,0.25)'
                }}
              >
                🖨️ พิมพ์หน้านี้ (Print / PDF)
              </button>
            </div>
          </div>
        </div>

        {/* Printable Paper Document Container */}
        <div className="receivable-printable-sheet" ref={reportRef}>
          {error && <div className="no-print" style={{ color: '#b91c1c', padding: '1rem', textAlign: 'center' }}>⚠️ {error}</div>}
          {loading && <div className="no-print" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>⏳ กำลังประมวลผลข้อมูลรายงานจากฐานข้อมูล...</div>}

          {!loading && !error && (
            <div>
              {/* Document Header matching Hospital Screenshots */}
              <div className="receivable-doc-header">
                <div className="receivable-doc-logo">
                  <img src="/moph_logo.png" alt="กระทรวงสาธารณสุข" style={{ height: '76px', width: 'auto' }} />
                </div>
                <div className="receivable-doc-titles">
                  <h2>{reportData?.title || 'รายงานบัญชีลูกหนี้'}</h2>
                  <h3>{currentHospital}</h3>
                  <div className="receivable-doc-period">
                    ข้อมูลระหว่างวันที่ {formatThaiDate(startDate)} ถึง {formatThaiDate(endDate)}
                  </div>
                </div>
                <div className="receivable-doc-meta">
                  <div>หน้า 1 / 1</div>
                  <div>วันเวลาพิมพ์ {printTimestamp}</div>
                </div>
              </div>

              {/* REPORT 1: สรุปรวมสิทธิการรักษา ผู้ป่วยนอก */}
              {reportType === '1' && (
                <table className="receivable-official-table">
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
                    {dataList.length === 0 ? (
                      <tr><td colSpan={14} style={{ textAlign: 'center', padding: '2rem' }}>ไม่พบข้อมูลในช่วงวันที่เลือก</td></tr>
                    ) : (
                      dataList.map((row, i) => (
                        <tr key={row.debtorCode || i}>
                          <td style={{ textAlign: 'center' }}>{row.no || i + 1}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{row.debtorCode}</td>
                          <td>{row.debtorName}</td>
                          <td>{row.recognition || ''}</td>
                          <td style={{ textAlign: 'center' }}>{row.controlRegister || ''}</td>
                          <td style={{ textAlign: 'right' }}>{row.patientCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.visitCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.newCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.oldCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.inCupCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.outCupCount}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.totalAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.remainAmount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={5} style={{ textAlign: 'center' }}>รวม</td>
                      <td style={{ textAlign: 'right' }}>{totals.patientCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.visitCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.newCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.oldCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.inCupCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.outCupCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* REPORT 2: แยกตามสิทธิการรักษา ผู้ป่วยนอก */}
              {reportType === '2' && (
                <table className="receivable-official-table">
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
                    {dataList.length === 0 ? (
                      <tr><td colSpan={15} style={{ textAlign: 'center', padding: '2rem' }}>ไม่พบข้อมูลในช่วงวันที่เลือก</td></tr>
                    ) : (
                      dataList.map((row, i) => (
                        <tr key={`${row.pttype}-${i}`}>
                          <td style={{ textAlign: 'center' }}>{row.pttype}</td>
                          <td style={{ textAlign: 'center' }}>{row.nhsoCode}</td>
                          <td style={{ textAlign: 'center' }}>{row.pcode}</td>
                          <td>{row.pttypeName}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{row.debtorCode}</td>
                          <td>{row.debtorName}</td>
                          <td style={{ textAlign: 'right' }}>{row.patientCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.visitCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.newCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.oldCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.inCupCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.outCupCount}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.totalAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.remainAmount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={6} style={{ textAlign: 'center' }}>รวม</td>
                      <td style={{ textAlign: 'right' }}>{totals.patientCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.visitCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.newCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.oldCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.inCupCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.outCupCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* REPORT 3: แยกตามสิทธิการรักษา ผู้ป่วยใน */}
              {reportType === '3' && (
                <table className="receivable-official-table">
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
                    {dataList.length === 0 ? (
                      <tr><td colSpan={16} style={{ textAlign: 'center', padding: '2rem' }}>ไม่พบข้อมูลผู้ป่วยในในช่วงวันที่เลือก</td></tr>
                    ) : (
                      dataList.map((row, i) => (
                        <tr key={`${row.pttype}-${i}`}>
                          <td style={{ textAlign: 'center' }}>{row.pttype}</td>
                          <td style={{ textAlign: 'center' }}>{row.nhsoCode}</td>
                          <td style={{ textAlign: 'center' }}>{row.pcode}</td>
                          <td>{row.pttypeName}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{row.debtorCode}</td>
                          <td>{row.debtorName}</td>
                          <td style={{ textAlign: 'right' }}>{row.patientCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.visitCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.newCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.oldCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.inCupCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.outCupCount}</td>
                          <td style={{ textAlign: 'right' }}>{row.losDays}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.totalAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.paidAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(row.remainAmount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={6} style={{ textAlign: 'center' }}>รวม</td>
                      <td style={{ textAlign: 'right' }}>{totals.patientCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.visitCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.newCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.oldCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.inCupCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.outCupCount || 0}</td>
                      <td style={{ textAlign: 'right' }}>{totals.losDays || 0}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.totalAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.paidAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(totals.remainAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* REPORT 4: แบบแจกแจงรายละเอียด ผู้ป่วยนอก */}
              {reportType === '4' && (
                <table className="receivable-official-table receivable-detailed-table">
                  <thead>
                    <tr>
                      <th style={{ width: '28px' }}>ที่</th>
                      <th style={{ width: '65px' }}>วันที่</th>
                      <th style={{ width: '38px' }}>รหัสสิทธิ</th>
                      <th style={{ width: '85px' }}>CID<br />ใบเสร็จ</th>
                      <th>ชื่อ - สกุล<br />HN AN</th>
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
                    {dataList.length === 0 ? (
                      <tr><td colSpan={23} style={{ textAlign: 'center', padding: '2rem' }}>ไม่พบข้อมูลรายการแจกแจงในช่วงวันที่เลือก</td></tr>
                    ) : (
                      dataList.map((row, i) => (
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
                    <tr style={{ fontWeight: 'bold' }}>
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

              {/* REPORT 5: แบบแจกแจงรายละเอียด ผู้ป่วยใน */}
              {reportType === '5' && (
                <table className="receivable-official-table receivable-detailed-table">
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
                    {dataList.length === 0 ? (
                      <tr><td colSpan={24} style={{ textAlign: 'center', padding: '2rem' }}>ไม่พบข้อมูลผู้ป่วยในในช่วงวันที่เลือก</td></tr>
                    ) : (
                      dataList.map((row, i) => (
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
                    <tr style={{ fontWeight: 'bold' }}>
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

              {/* Signatures Footer */}
              <div className="receivable-doc-signatures">
                <div className="receivable-sig-box">
                  <div className="receivable-sig-label">
                    ลงชื่อ ........................................................................ ผู้ส่งข้อมูล
                  </div>
                  <div className="receivable-sig-name">
                    ( {insuranceOfficerName || '........................................................................'} )
                  </div>
                  <div className="receivable-sig-pos">
                    {insuranceOfficerPosition}
                  </div>
                </div>

                <div className="receivable-sig-box">
                  <div className="receivable-sig-label">
                    ลงชื่อ ........................................................................ ผู้รับข้อมูล
                  </div>
                  <div className="receivable-sig-name">
                    ( {financeOfficerName || '........................................................................'} )
                  </div>
                  <div className="receivable-sig-pos">
                    {financeOfficerPosition}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReceivableReportModal;
