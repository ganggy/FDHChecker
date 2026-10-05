import React, { useState, useEffect, useCallback } from 'react';
import '../styles/receivableReport.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  hospitalName?: string;
  defaultMonth?: number;
  defaultYearBE?: number;
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const formatMoney = (val: unknown): string => {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n) || n === 0) return '0.00';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatCount = (val: unknown): string => {
  const n = Number(val ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('th-TH') : '0';
};

export const OfficialReceivableFormsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  hospitalName = '',
  defaultMonth,
  defaultYearBE,
}) => {
  const now = new Date();
  const currentMonth = defaultMonth || (now.getMonth() + 1);
  const currentYearBE = defaultYearBE || (now.getFullYear() + (now.getMonth() + 1 >= 10 ? 544 : 543));

  const [activeTab, setActiveTab] = useState<'1' | '2' | '3' | '4'>('1');
  const [month, setMonth] = useState<number>(currentMonth);
  const [yearBE, setYearBE] = useState<number>(currentYearBE);
  const [accountCode, setAccountCode] = useState<string>('ALL');
  const [accountsList, setAccountsList] = useState<Array<{ code: string; order: number; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Report data cache
  const [form1Data, setForm1Data] = useState<any>(null);
  const [form2Data, setForm2Data] = useState<any>(null);
  const [form3Data, setForm3Data] = useState<any>(null);
  const [form4Data, setForm4Data] = useState<any>(null);

  // Load standard 54 accounts list once
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/receivables/reports/official-accounts')
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setAccountsList(res.data);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const loadReportData = useCallback(async (tabToLoad: '1' | '2' | '3' | '4' | 'all' = activeTab) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        formType: tabToLoad,
        month: String(month),
        yearBE: String(yearBE),
      });
      if (accountCode && accountCode !== 'ALL') {
        params.set('accountCode', accountCode);
      }

      const res = await fetch(`/api/receivables/reports/official-forms?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูลรายงานได้');
      }

      const data = json.data;
      if (tabToLoad === '1' || tabToLoad === 'all') setForm1Data(data.form1);
      if (tabToLoad === '2' || tabToLoad === 'all') setForm2Data(data.form2);
      if (tabToLoad === '3' || tabToLoad === 'all') setForm3Data(data.form3);
      if (tabToLoad === '4' || tabToLoad === 'all') setForm4Data(data.form4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [activeTab, month, yearBE, accountCode]);

  useEffect(() => {
    if (isOpen) {
      loadReportData(activeTab);
    }
  }, [isOpen, activeTab, month, yearBE, accountCode, loadReportData]);

  if (!isOpen) return null;

  const currentHospName =
    form1Data?.hospitalName ||
    form2Data?.hospitalName ||
    form3Data?.hospitalName ||
    hospitalName ||
    'โรงพยาบาล';

  const handleDownloadAllExcel = () => {
    const params = new URLSearchParams({
      month: String(month),
      yearBE: String(yearBE),
    });
    if (accountCode && accountCode !== 'ALL') {
      params.set('accountCode', accountCode);
    }
    window.open(`/api/receivables/reports/official-excel?${params.toString()}`, '_blank');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="receivable-modal-backdrop" onClick={onClose}>
      <div
        className="receivable-modal-dialog"
        style={{ maxWidth: '1440px', width: '96vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Controls Header (Hidden on print) */}
        <div className="receivable-modal-controls no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                📋 แบบฟอร์มมาตรฐานทะเบียนคุมและลูกหนี้คงเหลือ (งานประกันและบัญชี รพ.)
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                แบบฟอร์ม 4 ฉบับมาตรฐานกระทรวงสาธารณสุข สำหรับควบคุมงานเรียกเก็บ และกระทบยอด REP/STM ประจำปีงบประมาณ
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#f1f5f9',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                fontSize: '1.2rem',
                cursor: 'pointer',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>

          {/* Form Tabs */}
          <div className="receivable-report-tabs">
            <button
              type="button"
              className={`receivable-tab-btn ${activeTab === '1' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('1')}
            >
              1. สรุปลูกหนี้คงเหลือ แยกตามอายุ (54 ผังบัญชี)
            </button>
            <button
              type="button"
              className={`receivable-tab-btn ${activeTab === '2' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('2')}
            >
              2. ทะเบียนคุมงานเรียกเก็บ (ตัวอย่างจากทะเบียนคุมงานประกัน)
            </button>
            <button
              type="button"
              className={`receivable-tab-btn ${activeTab === '3' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('3')}
            >
              3. ทะเบียนคุมบัญชี OP (ประจำเดือน/ประจำปีงบประมาณ)
            </button>
            <button
              type="button"
              className={`receivable-tab-btn ${activeTab === '4' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('4')}
            >
              4. ทะเบียนคุมบัญชี IP (ประจำเดือน/ประจำปีงบประมาณ)
            </button>
          </div>

          {/* Filter Toolbar */}
          <div className="receivable-report-filters" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>ประจำเดือน:</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  style={{ padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                >
                  {THAI_MONTHS.map((m, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>ปีงบประมาณ:</label>
                <select
                  value={yearBE}
                  onChange={(e) => setYearBE(Number(e.target.value))}
                  style={{ padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                >
                  {[2567, 2568, 2569, 2570].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {activeTab !== '1' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>ผังบัญชี:</label>
                  <select
                    value={accountCode}
                    onChange={(e) => setAccountCode(e.target.value)}
                    style={{
                      maxWidth: '320px',
                      padding: '0.35rem 0.65rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <option value="ALL">-- ทุกประเภทผังบัญชี --</option>
                    {accountsList.map((acc) => (
                      <option key={acc.code} value={acc.code}>
                        {acc.code}: {acc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="text"
                  placeholder="ค้นหาในตาราง..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    width: '160px',
                  }}
                />
              </div>

              <button
                type="button"
                className="btn receivable-btn"
                onClick={() => loadReportData(activeTab)}
                disabled={loading}
                style={{ background: '#0284c7', color: '#fff', padding: '0.35rem 0.75rem', borderRadius: '6px' }}
              >
                {loading ? '⏳ กำลังโหลด...' : '🔄 ค้นหา/รีเฟรช'}
              </button>
            </div>

            {/* Export and Print actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn receivable-btn"
                onClick={handleDownloadAllExcel}
                title="ดาวน์โหลดไฟล์ Excel รวมทั้ง 4 ฟอร์มแยกตาม 4 ชีตตรงตามต้นฉบับ"
                style={{
                  background: '#16a34a',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  padding: '0.4rem 0.85rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                📊 ส่งออก Excel (รวม 4 ชีต)
              </button>

              <button
                type="button"
                className="btn receivable-btn"
                onClick={handlePrint}
                style={{
                  background: '#334155',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  padding: '0.4rem 0.85rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                🖨️ พิมพ์ / พรีวิว
              </button>
            </div>
          </div>
        </div>

        {/* Report Content Body */}
        <div className="receivable-printable-sheet" style={{ maxHeight: 'calc(88vh - 170px)', overflowY: 'auto' }}>
          {error && (
            <div style={{ padding: '1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '8px', marginBottom: '1rem' }}>
              ⚠️ {error}
            </div>
          )}

          {loading && !form1Data && !form2Data && !form3Data && !form4Data && (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              ⏳ กำลังดึงข้อมูลและคำนวณยอดลูกหนี้ตามงวดบัญชี...
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 1: สรุปลูกหนี้คงเหลือ แยกตามอายุ (54 ผังบัญชี) */}
          {/* ============================================================== */}
          {activeTab === '1' && form1Data && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.15rem', fontWeight: 700 }}>
                  รายงานลูกหนี้ค่ารักษาพยาบาลคงเหลือ (แยกตามอายุ) ประจำเดือน {form1Data.period.monthName} {form1Data.period.yearBE} (จากทะเบียนคุมของงานประกัน)
                </h3>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#334155' }}>
                  โรงพยาบาล {currentHospName}
                </h4>
              </div>

              <table className="receivable-official-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '6px', width: '120px' }}>รหัสผังบัญชี</th>
                    <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '6px', width: '45px' }}>ลำดับ</th>
                    <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'left' }}>ชื่อผังบัญชี</th>
                    <th colSpan={2} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>คงเหลือลูกหนี้</th>
                    <th colSpan={2} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>จำแนกตามอายุ (ระบุมูลค่า)</th>
                  </tr>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ border: '1px solid #94a3b8', padding: '5px', width: '80px', textAlign: 'right' }}>จำนวนราย</th>
                    <th style={{ border: '1px solid #94a3b8', padding: '5px', width: '120px', textAlign: 'right' }}>มูลค่าลูกหนี้</th>
                    <th style={{ border: '1px solid #94a3b8', padding: '5px', width: '120px', textAlign: 'right' }}>ไม่เกิน 30 วัน (บาท)</th>
                    <th style={{ border: '1px solid #94a3b8', padding: '5px', width: '120px', textAlign: 'right' }}>เกิน 30 วัน (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {form1Data.items
                    .filter((item: any) => !searchTerm || item.code.includes(searchTerm) || item.name.includes(searchTerm))
                    .map((item: any) => {
                      const hasValue = item.totalValue > 0 || item.caseCount > 0;
                      return (
                        <tr key={item.code} style={{ background: hasValue ? '#f0fdf4' : 'transparent' }}>
                          <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', textAlign: 'center', fontFamily: 'monospace' }}>
                            {item.code}
                          </td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '5px', textAlign: 'center' }}>
                            {item.order}
                          </td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', fontWeight: hasValue ? 600 : 400 }}>
                            {item.name}
                          </td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', textAlign: 'right', fontWeight: hasValue ? 600 : 400 }}>
                            {formatCount(item.caseCount)}
                          </td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', textAlign: 'right', fontWeight: hasValue ? 700 : 400, color: hasValue ? '#15803d' : 'inherit' }}>
                            {formatMoney(item.totalValue)}
                          </td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', textAlign: 'right' }}>
                            {formatMoney(item.le30Days)}
                          </td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', textAlign: 'right', color: item.gt30Days > 0 ? '#b91c1c' : 'inherit' }}>
                            {formatMoney(item.gt30Days)}
                          </td>
                        </tr>
                      );
                    })}
                  {/* Totals Row */}
                  <tr style={{ background: '#e2e8f0', fontWeight: 700 }}>
                    <td colSpan={3} style={{ border: '1px solid #94a3b8', padding: '6px 8px', textAlign: 'center' }}>
                      ยอดรวมเงิน
                    </td>
                    <td style={{ border: '1px solid #94a3b8', padding: '6px 8px', textAlign: 'right' }}>
                      {formatCount(form1Data.totals.caseCount)}
                    </td>
                    <td style={{ border: '1px solid #94a3b8', padding: '6px 8px', textAlign: 'right', color: '#15803d' }}>
                      {formatMoney(form1Data.totals.totalValue)}
                    </td>
                    <td style={{ border: '1px solid #94a3b8', padding: '6px 8px', textAlign: 'right' }}>
                      {formatMoney(form1Data.totals.le30Days)}
                    </td>
                    <td style={{ border: '1px solid #94a3b8', padding: '6px 8px', textAlign: 'right', color: '#b91c1c' }}>
                      {formatMoney(form1Data.totals.gt30Days)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: ทะเบียนคุมงานเรียกเก็บ */}
          {/* ============================================================== */}
          {activeTab === '2' && form2Data && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.15rem', fontWeight: 700 }}>
                  ลูกหนี้ค่ารักษาพยาบาลประเภท {form2Data.accountName} (ตัวอย่างจากทะเบียนคุมงานประกัน)
                </h3>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#334155' }}>
                  โรงพยาบาล {currentHospName} | ประจำเดือน {form2Data.period.monthName} {form2Data.period.yearBE}
                </h4>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="receivable-official-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: '1300px' }}>
                  <thead>
                    <tr style={{ background: '#e2e8f0' }}>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}></th>
                      <th colSpan={9} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>ข้อมูลลูกหนี้ตาม hosXP</th>
                      <th colSpan={5} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดการเรียกเก็บ</th>
                      <th colSpan={3} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดการรับเงิน</th>
                      <th colSpan={3} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>หมายเหตุประกอบ</th>
                    </tr>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>ที่</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>HN</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>VN</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>AN</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>CID</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>ชื่อผู้ป่วย</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่ตรวจ</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่จำหน่าย</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>ชื่อสิทธิ</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ค่าใช้จ่าย (บาท)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>เรียกเก็บ (บาท)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>Rep/STM</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ชดเชย (บาท)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ส่วนต่าง (บาท)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>คงเหลือ (บาท)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่รับเงิน</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>จำนวนเงิน</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>คงเหลือ (บาท)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ไม่เกิน30วัน (มูลค่า)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>เกิน30วัน (มูลค่า)</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>สาเหตุค้างชำระ /สถานะการเรียกเก็บ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form2Data.rows
                      .filter((r: any) => !searchTerm || r.hn.includes(searchTerm) || r.patientName.includes(searchTerm) || r.vn.includes(searchTerm) || r.an.includes(searchTerm))
                      .map((r: any) => (
                        <tr key={`${r.hn}-${r.vn || r.an}-${r.no}`}>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.no}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.hn}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.vn}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.an}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.cid}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', whiteSpace: 'nowrap' }}>{r.patientName}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.serviceDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.dischargeDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{r.pttypeName}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.costAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.claimedAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.repStm}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.compensatedAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.varianceAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balanceAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.paidDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.paidAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>{formatMoney(r.remainderAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.le30DaysAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right', color: r.gt30DaysAmount > 0 ? '#b91c1c' : 'inherit' }}>{formatMoney(r.gt30DaysAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{r.reason}</td>
                        </tr>
                      ))}

                    {/* Summary Row 1: รวมประจำเดือน */}
                    <tr style={{ background: '#e2e8f0', fontWeight: 700 }}>
                      <td colSpan={9} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>รวมประจำเดือน</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.costAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.claimedAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.compensatedAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.varianceAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.balanceAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.paidAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.remainderAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.le30DaysAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.monthTotals.gt30DaysAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                    </tr>

                    {/* Summary Row 2: รวมแต่ต้นปี */}
                    <tr style={{ background: '#cbd5e1', fontWeight: 700 }}>
                      <td colSpan={9} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>รวมแต่ต้นปี</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.costAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.claimedAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.compensatedAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.varianceAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.balanceAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.paidAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.remainderAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.le30DaysAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form2Data.ytdTotals.gt30DaysAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: ทะเบียนคุมบัญชี OP */}
          {/* ============================================================== */}
          {activeTab === '3' && form3Data && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.15rem', fontWeight: 700 }}>
                  ทะเบียนคุมลูกหนี้ค่ารักษาพยาบาล {form3Data.accountName} ประจำปีงบประมาณ {form3Data.period.yearBE}
                </h3>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#334155' }}>
                  ประจำเดือน {form3Data.period.monthName} | โรงพยาบาล {currentHospName}
                </h4>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="receivable-official-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: '1500px' }}>
                  <thead>
                    <tr style={{ background: '#e2e8f0' }}>
                      <th colSpan={6} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดลูกหนี้ค่ารักษาตาม hosXP</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>จำนวนเงินที่เรียกเก็บ</th>
                      <th colSpan={5} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายการปรับปรุงจากการเรียกเก็บ</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th colSpan={7} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดแบบตอบกลับ REP/ STM</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th colSpan={5} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดการรับชำระหนี้</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>พันยอดลูกหนี้</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px' }}>สาเหตุค้างชำระ/ คืนข้อมูลจากเรียกเก็บ</th>
                    </tr>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>HN</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>VN</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>ชื่อ- สกุล</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันเข้ารักษา</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ยอดยกมา</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ระหว่างเดือน</th>
                      {/* รายการปรับปรุง */}
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่ปรับปรุง</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>สิทธิรักษา</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เอกสารลงบัญชี</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>เพิ่ม</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลด</th>
                      {/* STM */}
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่ปรับปรุง</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เอกสารลงบัญชี</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>งวด STM</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เลขที่คำขอเบิก</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>เงินชดเชย</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ผลต่าง</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ส่วนที่เรียกไม่ได้</th>
                      {/* รับชำระ */}
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่โอน</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เอกสารลงบัญชี</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เลขที่ใบเสร็จ</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เลขที่คำขอเบิก</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ตัดลูกหนี้</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form3Data.rows
                      .filter((r: any) => !searchTerm || r.hn.includes(searchTerm) || r.vn.includes(searchTerm) || r.patientName.includes(searchTerm))
                      .map((r: any, idx: number) => (
                        <tr key={`${r.hn}-${r.vn}-${idx}`}>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.hn}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.vn}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', whiteSpace: 'nowrap' }}>{r.patientName}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.serviceDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.broughtForward)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.monthlyAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance1)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.claimedAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.adjDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{r.adjRight}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.adjDoc}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.adjAdd)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.adjSub)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance2)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.stmAdjDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.stmDoc}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.stmRound}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.stmReqNo}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.stmCompensation)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.stmVariance)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.stmUnclaimable)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance3)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.settleDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.settleDoc}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.settleReceiptNo}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.settleReqNo}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.settleDebtCut)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance4)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>{formatMoney(r.carriedForward)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{r.outstandingReason}</td>
                        </tr>
                      ))}

                    {/* รวมประจำเดือน */}
                    <tr style={{ background: '#e2e8f0', fontWeight: 700 }}>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>รวมประจำเดือน</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.broughtForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.monthlyAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.balance1)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.claimedAmount)}</td>
                      <td colSpan={3} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.adjAdd)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.adjSub)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.balance2)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.stmCompensation)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.stmVariance)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.stmUnclaimable)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.balance3)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.settleDebtCut)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.balance4)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.monthTotals.carriedForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                    </tr>

                    {/* รวมแต่ต้นปี */}
                    <tr style={{ background: '#cbd5e1', fontWeight: 700 }}>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>รวมแต่ต้นปี</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.broughtForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.monthlyAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.balance1)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.claimedAmount)}</td>
                      <td colSpan={3} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.adjAdd)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.adjSub)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.balance2)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.stmCompensation)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.stmVariance)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.stmUnclaimable)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.balance3)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.settleDebtCut)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.balance4)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form3Data.ytdTotals.carriedForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: ทะเบียนคุมบัญชี IP */}
          {/* ============================================================== */}
          {activeTab === '4' && form4Data && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.15rem', fontWeight: 700 }}>
                  ทะเบียนคุมลูกหนี้ค่ารักษาพยาบาล {form4Data.accountName} ประจำปีงบประมาณ {form4Data.period.yearBE}
                </h3>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#334155' }}>
                  ประจำเดือน {form4Data.period.monthName} | โรงพยาบาล {currentHospName}
                </h4>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="receivable-official-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: '1550px' }}>
                  <thead>
                    <tr style={{ background: '#e2e8f0' }}>
                      <th colSpan={7} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดลูกหนี้ค่ารักษาตาม hosXP</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>จำนวนเงินที่เรียกเก็บ</th>
                      <th colSpan={5} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายการปรับปรุงจากการเรียกเก็บ</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th colSpan={7} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดแบบตอบกลับ REP/ STM</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th colSpan={6} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'center' }}>รายละเอียดการรับชำระหนี้</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลูกหนี้คงเหลือ</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>พันยอดลูกหนี้</th>
                      <th rowSpan={2} style={{ border: '1px solid #94a3b8', padding: '4px' }}>สาเหตุค้างชำระ/ คืนข้อมูลจากเรียกเก็บ</th>
                    </tr>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>HN</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>AN</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>ชื่อ- สกุล</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันเข้ารักษา</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันจำหน่าย</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ยอดยกมา</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ระหว่างเดือน</th>
                      {/* รายการปรับปรุง */}
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่ปรับปรุง</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>สิทธิรักษา</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เอกสารลงบัญชี</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>เพิ่ม</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ลด</th>
                      {/* STM */}
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่ปรับปรุง</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เอกสารลงบัญชี</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>งวด STM</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เลขที่คำขอเบิก</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>เงินชดเชย</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ส่วนต่างสูงกว่าฯ</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ส่วนต่างต่ำกว่าฯ</th>
                      {/* รับชำระ */}
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>วันที่โอน</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เอกสารลงบัญชี</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เลขที่ใบเสร็จ</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px' }}>เลขที่คำขอเบิก</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>ตัดลูกหนี้</th>
                      <th style={{ border: '1px solid #94a3b8', padding: '4px', textAlign: 'right' }}>รายได้ค้างรับ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form4Data.rows
                      .filter((r: any) => !searchTerm || r.hn.includes(searchTerm) || r.an.includes(searchTerm) || r.patientName.includes(searchTerm))
                      .map((r: any, idx: number) => (
                        <tr key={`${r.hn}-${r.an}-${idx}`}>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.hn}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{r.an}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', whiteSpace: 'nowrap' }}>{r.patientName}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.serviceDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.dischargeDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.broughtForward)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.monthlyAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance1)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.claimedAmount)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.adjDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{r.adjRight}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.adjDoc}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.adjAdd)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.adjSub)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance2)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.stmAdjDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.stmDoc}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.stmRound}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.stmReqNo}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.stmCompensation)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.varianceHigh)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.varianceLow)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance3)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.settleDate}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px', textAlign: 'center' }}>{r.settleDoc}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.settleReceiptNo}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center' }}>{r.settleReqNo}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.settleDebtCut)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.accruedRevenue)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{formatMoney(r.balance4)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>{formatMoney(r.carriedForward)}</td>
                          <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{r.outstandingReason}</td>
                        </tr>
                      ))}

                    {/* รวมประจำเดือน */}
                    <tr style={{ background: '#e2e8f0', fontWeight: 700 }}>
                      <td colSpan={5} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>รวมประจำเดือน</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.broughtForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.monthlyAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.balance1)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.claimedAmount)}</td>
                      <td colSpan={3} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.adjAdd)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.adjSub)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.balance2)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.stmCompensation)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.varianceHigh)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.varianceLow)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.balance3)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.settleDebtCut)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.accruedRevenue)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.balance4)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.monthTotals.carriedForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                    </tr>

                    {/* รวมแต่ต้นปี */}
                    <tr style={{ background: '#cbd5e1', fontWeight: 700 }}>
                      <td colSpan={5} style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'center' }}>รวมแต่ต้นปี</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.broughtForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.monthlyAmount)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.balance1)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.claimedAmount)}</td>
                      <td colSpan={3} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.adjAdd)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.adjSub)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.balance2)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.stmCompensation)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.varianceHigh)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.varianceLow)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.balance3)}</td>
                      <td colSpan={4} style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.settleDebtCut)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.accruedRevenue)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.balance4)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px', textAlign: 'right' }}>{formatMoney(form4Data.ytdTotals.carriedForward)}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '6px' }}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OfficialReceivableFormsModal;
