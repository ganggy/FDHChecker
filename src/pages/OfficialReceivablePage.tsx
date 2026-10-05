import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAppSettings } from '../services/hosxpService';
import './OfficialReceivablePage.css';

type Signer = {
  name?: string;
  position?: string;
};

type ReceivableSettings = {
  hospital_name?: string;
  hospital_code?: string;
  receivable_signers?: {
    director?: Signer;
    insurance_head?: Signer;
    finance?: Signer;
  };
};

// -------------------------------------------------------------
// Chart of Accounts 54 Constants
// -------------------------------------------------------------
const OFFICIAL_CHART_OF_ACCOUNTS_54 = [
  { code: '1102050101.102', order: 1, name: 'ลูกหนี้ค่าสิ่งส่งตรวจหน่วยงานภาครัฐ' },
  { code: '1102050101.103', order: 2, name: 'ลูกหนี้ค่าตรวจสุขภาพหน่วยงานภาครัฐ' },
  { code: '1102050101.104', order: 3, name: 'ลูกหนี้ค่าวัสดุ/อุปกรณ์/น้ำยา หน่วยงานภาครัฐ' },
  { code: '1102050101.105', order: 4, name: 'ลูกหนี้ค่าสินค้า หน่วยงานภาครัฐ' },
  { code: '1102050101.109', order: 5, name: 'ลูกหนี้ - ระบบปฏิบัติการฉุกเฉิน' },
  { code: '1102050101.201', order: 6, name: 'ลูกหนี้ค่ารักษา UC- OP ใน CUP' },
  { code: '1102050101.202', order: 7, name: 'ลูกหนี้ค่ารักษา UC - IP' },
  { code: '1102050101.203', order: 8, name: 'ลูกหนี้ค่ารักษา UC - OP นอก CUP (ในจังหวัดสังกัด สธ.)' },
  { code: '1102050101.204', order: 9, name: 'ลูกหนี้ค่ารักษา UC - OP นอก CUP (ต่างจังหวัดสังกัด สธ.)' },
  { code: '1102050101.209', order: 10, name: 'ลูกหนี้ค่ารักษาด้านการสร้างเสริมสุขภาพและป้องกันโรค (P&P)' },
  { code: '1102050101.216', order: 11, name: 'ลูกหนี้ค่ารักษา UC - OP บริการเฉพาะ (CR)' },
  { code: '1102050101.217', order: 12, name: 'ลูกหนี้ค่ารักษา UC - IP บริการเฉพาะ (CR)' },
  { code: '1102050101.222', order: 13, name: 'ลูกหนี้ค่ารักษา OP - Refer' },
  { code: '1102050101.223', order: 14, name: 'ลูกหนี้ค่าบริการสาธารณสุขสำหรับโรคติดเชื้อไวรัสโคโรนา - OP จาก สปสช.' },
  { code: '1102050101.224', order: 15, name: 'ลูกหนี้ค่าบริการสาธารณสุขสำหรับโรคติดเชื้อไวรัสโคโรนา - IP จาก สปสช.' },
  { code: '1102050101.301', order: 16, name: 'ลูกหนี้ค่ารักษาประกันสังคม OP -เครือข่าย' },
  { code: '1102050101.302', order: 17, name: 'ลูกหนี้ค่ารักษาประกันสังคม IP - เครือข่าย' },
  { code: '1102050101.303', order: 18, name: 'ลูกหนี้ค่ารักษาประกันสังคม OP - นอกเครือข่าย สังกัด สป.สธ.' },
  { code: '1102050101.304', order: 19, name: 'ลูกหนี้ค่ารักษาประกันสังคม IP - นอกเครือข่าย สังกัด สป.สธ.' },
  { code: '1102050101.307', order: 20, name: 'ลูกหนี้ค่ารักษาประกันสังคม - กองทุนทดแทน' },
  { code: '1102050101.308', order: 21, name: 'ลูกหนี้ค่ารักษาประกันสังคม 72 ชั่วโมงแรก' },
  { code: '1102050101.309', order: 22, name: 'ลูกหนี้ค่ารักษาประกันสังคม - ค่าใช้จ่ายสูง/อุบัติเหตุ/ฉุกเฉิน OP' },
  { code: '1102050101.310', order: 23, name: 'ลูกหนี้ค่ารักษาประกันสังคม - ค่าใช้จ่ายสูง IP' },
  { code: '1102050101.401', order: 24, name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรงกรมบัญชีกลาง OP' },
  { code: '1102050101.402', order: 25, name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรงกรมบัญชีกลาง IP' },
  { code: '1102050101.501', order: 26, name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว OP' },
  { code: '1102050101.502', order: 27, name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว IP' },
  { code: '1102050101.503', order: 28, name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว OP นอก CUP' },
  { code: '1102050101.504', order: 29, name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว IP นอก CUP' },
  { code: '1102050101.505', order: 30, name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าว เบิกจากส่วนกลาง OP' },
  { code: '1102050101.506', order: 31, name: 'ลูกหนี้ค่ารักษา - คนต่างด้าวและแรงงานต่างด้าวเบิกจากส่วนกลาง IP' },
  { code: '1102050101.701', order: 32, name: 'ลูกหนี้ค่ารักษา - บุคคลที่มีปัญหาสถานะและสิทธิ OP ใน CUP' },
  { code: '1102050101.702', order: 33, name: 'ลูกหนี้ค่ารักษา - บุคคลที่มีปัญหาสถานะและสิทธิ OP นอก CUP' },
  { code: '1102050101.703', order: 34, name: 'ลูกหนี้ค่ารักษาบุคคลที่มีปัญหาสถานะและสิทธิ - เบิกจากส่วนกลาง OP' },
  { code: '1102050101.704', order: 35, name: 'ลูกหนี้ค่ารักษาบุคคลที่มีปัญหาสถานะและสิทธิ - เบิกจากส่วนกลาง IP' },
  { code: '1102050102.102', order: 36, name: 'ลูกหนี้ค่าสิ่งส่งตรวจบุคคลภายนอก' },
  { code: '1102050102.103', order: 37, name: 'ลูกหนี้ค่าตรวจสุขภาพบุคคล ภายนอก' },
  { code: '1102050102.104', order: 38, name: 'ลูกหนี้ค่าวัสดุ/อุปกรณ์/น้ำยา บุคคลภายนอก' },
  { code: '1102050102.105', order: 39, name: 'ลูกหนี้ค่าสินค้า บุคคลภายนอก' },
  { code: '1102050102.106', order: 40, name: 'ลูกหนี้ค่ารักษา - ชำระเงิน OP' },
  { code: '1102050102.107', order: 41, name: 'ลูกหนี้ค่ารักษา - ชำระเงินIP' },
  { code: '1102050102.108', order: 42, name: 'ลูกหนี้ค่ารักษา - เบิกต้นสังกัด OP' },
  { code: '1102050102.109', order: 43, name: 'ลูกหนี้ค่ารักษา - เบิกต้นสังกัด IP' },
  { code: '1102050102.110', order: 44, name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรงหน่วยงานอื่น OP' },
  { code: '1102050102.111', order: 45, name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรงหน่วยงานอื่น IP' },
  { code: '1102050102.201', order: 46, name: 'ลูกหนี้ค่ารักษา UC - OP นอกสังกัด สธ.' },
  { code: '1102050102.602', order: 47, name: 'ลูกหนี้ค่ารักษา - พรบ.รถ OP' },
  { code: '1102050102.603', order: 48, name: 'ลูกหนี้ค่ารักษา - พรบ.รถ IP' },
  { code: '1102050102.801', order: 49, name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. OP' },
  { code: '1102050102.802', order: 50, name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. IP' },
  { code: '1102050102.803', order: 51, name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท.รูปแบบพิเศษ OP' },
  { code: '1102050102.804', order: 52, name: 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท.รูปแบบพิเศษ IP' },
  { code: '1102050102.805', order: 53, name: 'ลูกหนี้ค่ารักษา - สิทธิ อปท. ถ่ายโอน รพ.สต. OP' },
  { code: '1102050102.806', order: 54, name: 'ลูกหนี้ค่ารักษา - สิทธิ อปท. ถ่ายโอน รพ.สต. IP' },
];

const THAI_MONTHS = [
  { value: 10, label: 'ตุลาคม (ต.ค.) - เดือน 1 ปีงบประมาณ' },
  { value: 11, label: 'พฤศจิกายน (พ.ย.) - เดือน 2 ปีงบประมาณ' },
  { value: 12, label: 'ธันวาคม (ธ.ค.) - เดือน 3 ปีงบประมาณ' },
  { value: 1, label: 'มกราคม (ม.ค.) - เดือน 4 ปีงบประมาณ' },
  { value: 2, label: 'กุมภาพันธ์ (ก.พ.) - เดือน 5 ปีงบประมาณ' },
  { value: 3, label: 'มีนาคม (มี.ค.) - เดือน 6 ปีงบประมาณ' },
  { value: 4, label: 'เมษายน (เม.ย.) - เดือน 7 ปีงบประมาณ' },
  { value: 5, label: 'พฤษภาคม (พ.ค.) - เดือน 8 ปีงบประมาณ' },
  { value: 6, label: 'มิถุนายน (มิ.ย.) - เดือน 9 ปีงบประมาณ' },
  { value: 7, label: 'กรกฎาคม (ก.ค.) - เดือน 10 ปีงบประมาณ' },
  { value: 8, label: 'สิงหาคม (ส.ค.) - เดือน 11 ปีงบประมาณ' },
  { value: 9, label: 'กันยายน (ก.ย.) - เดือน 12 ปีงบประมาณ' },
];

const formatMoney = (val?: number) => {
  if (val === undefined || val === null || Number.isNaN(val)) return '0.00';
  return Number(val).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatCount = (val?: number) => {
  if (val === undefined || val === null || Number.isNaN(val)) return '0';
  return Number(val).toLocaleString('th-TH');
};

export const OfficialReceivablePage = () => {
  const now = new Date();
  const defaultMonth = now.getMonth() + 1;
  const defaultYearBE = now.getFullYear() + (defaultMonth >= 10 ? 544 : 543);

  const [month, setMonth] = useState<number>(defaultMonth);
  const [yearBE, setYearBE] = useState<number>(defaultYearBE);
  const [accountFilter, setAccountFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'1' | '2' | '3' | '4'>('2');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form1Data, setForm1Data] = useState<any>(null);
  const [form2Data, setForm2Data] = useState<any>(null);
  const [form3Data, setForm3Data] = useState<any>(null);
  const [form4Data, setForm4Data] = useState<any>(null);
  const [settings, setSettings] = useState<ReceivableSettings | null>(null);

  useEffect(() => {
    fetchAppSettings<ReceivableSettings>()
      .then((result) => setSettings(result.data || null))
      .catch(() => setSettings(null));
  }, []);

  const signers = useMemo(() => ({
    finance: {
      name: (settings?.receivable_signers?.finance?.name || '').trim(),
      position: (settings?.receivable_signers?.finance?.position || 'เจ้าหน้าที่การเงิน / งานประกันสุขภาพ (ผู้จัดทำ)').trim(),
    },
    insurance: {
      name: (settings?.receivable_signers?.insurance_head?.name || '').trim(),
      position: (settings?.receivable_signers?.insurance_head?.position || 'หัวหน้ากลุ่มงานประกันสุขภาพ / ผู้ตรวจสอบ').trim(),
    },
    director: {
      name: (settings?.receivable_signers?.director?.name || '').trim(),
      position: (settings?.receivable_signers?.director?.position || 'ผู้อำนวยการโรงพยาบาล').trim(),
    },
  }), [settings]);

  // Load data for specific tab
  const loadActiveData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({
        month: String(month),
        yearBE: String(yearBE),
        accountCode: accountFilter,
      });

      if (activeTab === '1') {
        const res = await fetch(`/api/official-receivable/aging?${q.toString()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'โหลดข้อมูลแบบที่ 1 ไม่สำเร็จ');
        setForm1Data(json.data);
      } else if (activeTab === '2') {
        const res = await fetch(`/api/official-receivable/claim-control?${q.toString()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'โหลดข้อมูลแบบที่ 2 ไม่สำเร็จ');
        setForm2Data(json.data);
      } else if (activeTab === '3') {
        const res = await fetch(`/api/official-receivable/opd-control?${q.toString()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'โหลดข้อมูลแบบที่ 3 ไม่สำเร็จ');
        setForm3Data(json.data);
      } else if (activeTab === '4') {
        const res = await fetch(`/api/official-receivable/ipd-control?${q.toString()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'โหลดข้อมูลแบบที่ 4 ไม่สำเร็จ');
        setForm4Data(json.data);
      }
    } catch (err: any) {
      setError(err?.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [month, yearBE, accountFilter, activeTab]);

  useEffect(() => {
    setPage(1);
    void loadActiveData();
  }, [loadActiveData]);

  // Filtering for Tab 2
  const filteredForm2Rows = useMemo(() => {
    if (!form2Data?.rows) return [];
    if (!searchTerm) return form2Data.rows;
    const s = searchTerm.toLowerCase();
    return form2Data.rows.filter((r: any) =>
      String(r.hn || '').toLowerCase().includes(s) ||
      String(r.patientName || '').toLowerCase().includes(s) ||
      String(r.vn || '').toLowerCase().includes(s) ||
      String(r.an || '').toLowerCase().includes(s) ||
      String(r.cid || '').toLowerCase().includes(s) ||
      String(r.repStm || '').toLowerCase().includes(s) ||
      String(r.reason || '').toLowerCase().includes(s)
    );
  }, [form2Data?.rows, searchTerm]);

  const paginatedForm2Rows = useMemo(() => {
    if (pageSize === 0) return filteredForm2Rows;
    const start = (page - 1) * pageSize;
    return filteredForm2Rows.slice(start, start + pageSize);
  }, [filteredForm2Rows, page, pageSize]);

  // Filtering for Tab 3
  const filteredForm3Rows = useMemo(() => {
    if (!form3Data?.rows) return [];
    if (!searchTerm) return form3Data.rows;
    const s = searchTerm.toLowerCase();
    return form3Data.rows.filter((r: any) =>
      String(r.hn || '').toLowerCase().includes(s) ||
      String(r.patientName || '').toLowerCase().includes(s) ||
      String(r.vn || '').toLowerCase().includes(s) ||
      String(r.stmRound || '').toLowerCase().includes(s) ||
      String(r.outstandingReason || '').toLowerCase().includes(s)
    );
  }, [form3Data?.rows, searchTerm]);

  const paginatedForm3Rows = useMemo(() => {
    if (pageSize === 0) return filteredForm3Rows;
    const start = (page - 1) * pageSize;
    return filteredForm3Rows.slice(start, start + pageSize);
  }, [filteredForm3Rows, page, pageSize]);

  // Filtering for Tab 4
  const filteredForm4Rows = useMemo(() => {
    if (!form4Data?.rows) return [];
    if (!searchTerm) return form4Data.rows;
    const s = searchTerm.toLowerCase();
    return form4Data.rows.filter((r: any) =>
      String(r.hn || '').toLowerCase().includes(s) ||
      String(r.patientName || '').toLowerCase().includes(s) ||
      String(r.an || '').toLowerCase().includes(s) ||
      String(r.stmRound || '').toLowerCase().includes(s) ||
      String(r.outstandingReason || '').toLowerCase().includes(s)
    );
  }, [form4Data?.rows, searchTerm]);

  const paginatedForm4Rows = useMemo(() => {
    if (pageSize === 0) return filteredForm4Rows;
    const start = (page - 1) * pageSize;
    return filteredForm4Rows.slice(start, start + pageSize);
  }, [filteredForm4Rows, page, pageSize]);

  const handleDownloadAllExcel = () => {
    const params = new URLSearchParams({
      month: String(month),
      yearBE: String(yearBE),
      accountCode: accountFilter,
    });
    window.open(`/api/official-receivable/export-all-excel?${params.toString()}`, '_blank');
  };

  const currentHospName =
    form1Data?.hospitalName ||
    form2Data?.hospitalName ||
    form3Data?.hospitalName ||
    form4Data?.hospitalName ||
    settings?.hospital_name ||
    'โรงพยาบาล';

  const periodName = useMemo(() => {
    const m = THAI_MONTHS.find(item => item.value === month);
    return `${m ? m.label.split(' - ')[0] : `เดือน ${month}`} ${yearBE}`;
  }, [month, yearBE]);

  const renderPagination = (totalItems: number) => {
    const totalPages = pageSize === 0 ? 1 : Math.ceil(totalItems / pageSize) || 1;
    return (
      <div className="official-rec-pagination no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span>
            แสดง <strong>{pageSize === 0 ? totalItems : Math.min(page * pageSize, totalItems)}</strong> จากทั้งหมด <strong>{formatCount(totalItems)}</strong> รายการ
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748b' }}>
            แสดงหน้าละ:
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={0}>ทั้งหมด</option>
            </select>
          </label>
        </div>

        {pageSize > 0 && totalPages > 1 && (
          <div className="official-rec-page-controls">
            <button
              type="button"
              className="official-rec-page-btn"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              ◀ ก่อนหน้า
            </button>
            <span style={{ fontWeight: 600, padding: '0 0.5rem' }}>หน้า {page} / {totalPages}</span>
            <button
              type="button"
              className="official-rec-page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              ถัดไป ▶
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="official-rec-page">
      {/* Hero Header */}
      <section className="official-rec-hero">
        <div className="official-rec-hero__left">
          <div className="official-rec-hero__badge">
            <span>🏛️ Official Accounts Receivable & Claims Ledger</span>
          </div>
          <h1>ทะเบียนคุมและพิมพ์เอกสารหลักฐานลูกหนี้ (4 แบบมาตรฐาน)</h1>
          <p>
            แบบฟอร์มลูกหนี้ค่ารักษาพยาบาล สิทธิข้าราชการ/อปท./รัฐวิสาหกิจ ตามมาตรฐานกรมบัญชีกลางและกระทรวงสาธารณสุข
            พร้อมกระทบยอด 3 ชั้น (<strong>HOSxP ➡️ FDH ➡️ REP ➡️ STM</strong>)
          </p>
        </div>

        <div className="official-rec-hero__actions no-print">
          <button
            type="button"
            className="official-rec-btn official-rec-btn--back"
            onClick={() => window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'receivable' } }))}
          >
            ◀ กลับหน้าลูกหนี้สิทธิ์
          </button>
          <button
            type="button"
            className="official-rec-btn official-rec-btn--back"
            onClick={() => window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'receivableStandardReport' } }))}
            title="ไปที่รายงานลูกหนี้ 5 รูปแบบมาตรฐาน"
          >
            📑 รายงานลูกหนี้ 5 รูปแบบ
          </button>
          <button
            type="button"
            className="official-rec-btn official-rec-btn--refresh"
            onClick={loadActiveData}
            disabled={loading}
          >
            {loading ? '⏳ กำลังโหลด...' : '🔄 รีเฟรช'}
          </button>
          <button
            type="button"
            className="official-rec-btn official-rec-btn--excel"
            onClick={handleDownloadAllExcel}
          >
            📥 ดาวน์โหลด Excel (4 Sheets)
          </button>
          <button
            type="button"
            className="official-rec-btn official-rec-btn--print"
            onClick={() => window.print()}
          >
            🖨️ พิมพ์เอกสาร / A4
          </button>
        </div>
      </section>

      {/* Control Card */}
      <section className="official-rec-controls-card no-print">
        <div className="official-rec-filter-grid">
          <div className="official-rec-field">
            <label>📅 ประจำเดือน</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {THAI_MONTHS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="official-rec-field">
            <label>ปีงบประมาณ (พ.ศ.)</label>
            <select value={yearBE} onChange={(e) => setYearBE(Number(e.target.value))}>
              {[defaultYearBE + 1, defaultYearBE, defaultYearBE - 1, defaultYearBE - 2].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="official-rec-field">
            <label>📂 ผังบัญชีลูกหนี้ (54 ผัง)</label>
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
              <option value="ALL">★ ทุกประเภทผังบัญชี (54 ผัง)</option>
              {OFFICIAL_CHART_OF_ACCOUNTS_54.map(acc => (
                <option key={acc.code} value={acc.code}>
                  {acc.code} - {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="official-rec-field">
            <label>🔍 ค้นหาในตาราง</label>
            <input
              type="text"
              placeholder="HN / VN / AN / ชื่อ / Rep / สถานะ"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* KPI Statistic Cards (Based on Form 2 / Claim Ledger) */}
      {form2Data && (
        <section className="official-rec-kpi-grid no-print">
          <div className="official-rec-kpi-card official-rec-kpi-card--primary">
            <div className="official-rec-kpi-title">
              <span>จำนวนเคสทั้งหมด</span>
              <span>📋</span>
            </div>
            <div className="official-rec-kpi-value">{formatCount(form2Data.rows?.length || 0)}</div>
            <div className="official-rec-kpi-sub">เคสในงวดประจำเดือน {periodName}</div>
          </div>

          <div className="official-rec-kpi-card official-rec-kpi-card--neutral">
            <div className="official-rec-kpi-title">
              <span>ค่าใช้จ่ายจริงรวม</span>
              <span>🏥</span>
            </div>
            <div className="official-rec-kpi-value">{formatMoney(form2Data.monthTotals?.costAmount)}</div>
            <div className="official-rec-kpi-sub">บาท (สะสมต้นปี: {formatMoney(form2Data.ytdTotals?.costAmount)})</div>
          </div>

          <div className="official-rec-kpi-card official-rec-kpi-card--warning">
            <div className="official-rec-kpi-title">
              <span>ยอดเรียกเก็บรวม</span>
              <span>📑</span>
            </div>
            <div className="official-rec-kpi-value">{formatMoney(form2Data.monthTotals?.claimedAmount)}</div>
            <div className="official-rec-kpi-sub">บาท (สะสมต้นปี: {formatMoney(form2Data.ytdTotals?.claimedAmount)})</div>
          </div>

          <div className="official-rec-kpi-card official-rec-kpi-card--success">
            <div className="official-rec-kpi-title">
              <span>ชดเชยจาก STM (รับเงินแล้ว)</span>
              <span>💳</span>
            </div>
            <div className="official-rec-kpi-value">{formatMoney(form2Data.monthTotals?.compensatedAmount)}</div>
            <div className="official-rec-kpi-sub">บาท (กระทบยอดเงินโอนจริง)</div>
          </div>

          <div className="official-rec-kpi-card official-rec-kpi-card--danger">
            <div className="official-rec-kpi-title">
              <span>ลูกหนี้ค้างชำระสุทธิ</span>
              <span>⏳</span>
            </div>
            <div className="official-rec-kpi-value">{formatMoney(form2Data.monthTotals?.remainderAmount)}</div>
            <div className="official-rec-kpi-sub">
              ≤30วัน: {formatMoney(form2Data.monthTotals?.le30DaysAmount)} | &gt;30วัน: {formatMoney(form2Data.monthTotals?.gt30DaysAmount)}
            </div>
          </div>
        </section>
      )}

      {/* Main Tab Navigation */}
      <nav className="official-rec-tabs no-print">
        <button
          type="button"
          className={`official-rec-tab-btn ${activeTab === '1' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('1')}
        >
          <span>📊 แบบที่ 1: สรุปลูกหนี้แยกตามอายุ (54 ผัง)</span>
          {form1Data && <span className="official-rec-tab-tag">{form1Data.items?.length || 54} ผัง</span>}
        </button>

        <button
          type="button"
          className={`official-rec-tab-btn ${activeTab === '2' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('2')}
        >
          <span>📑 แบบที่ 2: ทะเบียนคุมงานเรียกเก็บ</span>
          {form2Data && <span className="official-rec-tab-tag">{formatCount(form2Data.rows?.length || 0)} รายการ</span>}
        </button>

        <button
          type="button"
          className={`official-rec-tab-btn ${activeTab === '3' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('3')}
        >
          <span>🩺 แบบที่ 3: ทะเบียนคุมบัญชี OP</span>
          {form3Data && <span className="official-rec-tab-tag">{formatCount(form3Data.rows?.length || 0)} รายการ</span>}
        </button>

        <button
          type="button"
          className={`official-rec-tab-btn ${activeTab === '4' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('4')}
        >
          <span>🛏️ แบบที่ 4: ทะเบียนคุมบัญชี IP</span>
          {form4Data && <span className="official-rec-tab-tag">{formatCount(form4Data.rows?.length || 0)} รายการ</span>}
        </button>
      </nav>

      {/* Content Sheet Body */}
      <main className="official-rec-content-card">
        {error && (
          <div style={{ padding: '1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '8px', marginBottom: '1.25rem' }}>
            ⚠️ {error}
          </div>
        )}

        {loading && (
          <div className="official-rec-loading">
            <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>⏳</div>
            <div>กำลังดึงข้อมูลและกระทบยอดบัญชีลูกหนี้ (HOSxP ➡️ FDH ➡️ REP ➡️ STM)...</div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* TAB 1: สรุปลูกหนี้คงเหลือ แยกตามอายุ (54 ผังบัญชี) */}
        {/* ----------------------------------------------------------------- */}
        {activeTab === '1' && form1Data && !loading && (
          <div>
            <div className="official-rec-sheet-header">
              <h2>รายงานลูกหนี้ค่ารักษาพยาบาลคงเหลือ (แยกตามอายุ) ประจำเดือน {form1Data.period?.monthName} {form1Data.period?.yearBE}</h2>
              <h3>โรงพยาบาล {currentHospName} (จากทะเบียนคุมของงานประกัน)</h3>
            </div>

            <div className="official-rec-table-wrap">
              <table className="official-rec-table">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ width: '130px' }}>รหัสผังบัญชี</th>
                    <th rowSpan={2} style={{ width: '50px' }}>ลำดับ</th>
                    <th rowSpan={2} className="text-left">ชื่อผังบัญชี</th>
                    <th colSpan={2}>คงเหลือลูกหนี้</th>
                    <th colSpan={2}>จำแนกตามอายุ (ระบุมูลค่า)</th>
                  </tr>
                  <tr>
                    <th style={{ width: '90px' }} className="text-right">จำนวนราย</th>
                    <th style={{ width: '140px' }} className="text-right">มูลค่าลูกหนี้ (บาท)</th>
                    <th style={{ width: '140px' }} className="text-right">ไม่เกิน 30 วัน (บาท)</th>
                    <th style={{ width: '140px' }} className="text-right">เกิน 30 วัน (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {form1Data.items
                    ?.filter((item: any) => !searchTerm || item.code.includes(searchTerm) || item.name.includes(searchTerm))
                    .map((item: any) => {
                      const hasVal = item.totalValue > 0 || item.caseCount > 0;
                      return (
                        <tr key={item.code} className={hasVal ? 'is-highlighted' : ''}>
                          <td className="text-center font-mono">{item.code}</td>
                          <td className="text-center">{item.order}</td>
                          <td className="text-left font-bold">{item.name}</td>
                          <td className="text-right font-mono">{formatCount(item.caseCount)}</td>
                          <td className="text-right font-mono font-bold" style={{ color: hasVal ? '#15803d' : 'inherit' }}>
                            {formatMoney(item.totalValue)}
                          </td>
                          <td className="text-right font-mono">{formatMoney(item.le30Days)}</td>
                          <td className="text-right font-mono" style={{ color: item.gt30Days > 0 ? '#b91c1c' : 'inherit' }}>
                            {formatMoney(item.gt30Days)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#e2e8f0', fontWeight: 700 }}>
                    <td colSpan={3} className="text-center">ยอดรวมเงินทั้งสิ้น</td>
                    <td className="text-right font-mono">{formatCount(form1Data.totals?.caseCount)}</td>
                    <td className="text-right font-mono" style={{ color: '#15803d' }}>{formatMoney(form1Data.totals?.totalValue)}</td>
                    <td className="text-right font-mono">{formatMoney(form1Data.totals?.le30Days)}</td>
                    <td className="text-right font-mono" style={{ color: '#b91c1c' }}>{formatMoney(form1Data.totals?.gt30Days)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* TAB 2: ทะเบียนคุมงานเรียกเก็บ */}
        {/* ----------------------------------------------------------------- */}
        {activeTab === '2' && form2Data && !loading && (
          <div>
            <div className="official-rec-sheet-header">
              <h2>ลูกหนี้ค่ารักษาพยาบาลประเภท {form2Data.accountName} (ตัวอย่างจากทะเบียนคุมงานประกัน)</h2>
              <h3>โรงพยาบาล {currentHospName} | ประจำเดือน {form2Data.period?.monthName} {form2Data.period?.yearBE}</h3>
            </div>

            {renderPagination(filteredForm2Rows.length)}

            <div className="official-rec-table-wrap">
              <table className="official-rec-table" style={{ minWidth: '1600px' }}>
                <thead>
                  <tr style={{ background: '#e2e8f0' }}>
                    <th></th>
                    <th colSpan={9}>ข้อมูลลูกหนี้ตาม HOSxP</th>
                    <th colSpan={5}>รายละเอียดการเรียกเก็บ &amp; กระทบยอด</th>
                    <th colSpan={3}>รายละเอียดการรับเงิน</th>
                    <th colSpan={3}>หมายเหตุประกอบ</th>
                  </tr>
                  <tr>
                    <th style={{ width: '40px' }}>ที่</th>
                    <th style={{ width: '75px' }}>HN</th>
                    <th style={{ width: '95px' }}>VN</th>
                    <th style={{ width: '85px' }}>AN</th>
                    <th style={{ width: '115px' }}>CID</th>
                    <th style={{ width: '160px' }} className="text-left">ชื่อผู้ป่วย</th>
                    <th style={{ width: '85px' }}>วันที่ตรวจ</th>
                    <th style={{ width: '85px' }}>วันจำหน่าย</th>
                    <th style={{ width: '130px' }} className="text-left">ชื่อสิทธิ</th>
                    <th style={{ width: '95px' }} className="text-right">ค่าใช้จ่าย (บาท)</th>
                    <th style={{ width: '95px' }} className="text-right">เรียกเก็บ (บาท)</th>
                    <th style={{ width: '160px' }}>Rep/STM/FDH</th>
                    <th style={{ width: '95px' }} className="text-right">ชดเชย (บาท)</th>
                    <th style={{ width: '90px' }} className="text-right">ส่วนต่าง (บาท)</th>
                    <th style={{ width: '95px' }} className="text-right">คงเหลือ (บาท)</th>
                    <th style={{ width: '85px' }}>วันที่รับเงิน</th>
                    <th style={{ width: '90px' }} className="text-right">จำนวนเงิน</th>
                    <th style={{ width: '95px' }} className="text-right">คงเหลือสุทธิ</th>
                    <th style={{ width: '95px' }} className="text-right">≤ 30 วัน</th>
                    <th style={{ width: '95px' }} className="text-right">&gt; 30 วัน</th>
                    <th style={{ minWidth: '220px' }} className="text-left">สาเหตุค้างชำระ / สถานะการเรียกเก็บ</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedForm2Rows.map((r: any) => (
                    <tr key={`${r.hn}-${r.vn || r.an}-${r.no}`}>
                      <td className="text-center">{r.no}</td>
                      <td className="text-center font-mono">{r.hn}</td>
                      <td className="text-center font-mono">{r.vn || '-'}</td>
                      <td className="text-center font-mono">{r.an || '-'}</td>
                      <td className="text-center font-mono">{r.cid}</td>
                      <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{r.patientName}</td>
                      <td className="text-center">{r.serviceDate}</td>
                      <td className="text-center">{r.dischargeDate || '-'}</td>
                      <td className="text-left" style={{ fontSize: '0.78rem' }}>{r.pttypeName}</td>
                      <td className="text-right font-mono">{formatMoney(r.costAmount)}</td>
                      <td className="text-right font-mono font-bold">{formatMoney(r.claimedAmount)}</td>
                      <td className="text-center">
                        {r.repStm ? (
                          <span className="badge-stm-rep">{r.repStm}</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>-</span>
                        )}
                      </td>
                      <td className="text-right font-mono font-bold" style={{ color: r.compensatedAmount > 0 ? '#15803d' : 'inherit' }}>
                        {formatMoney(r.compensatedAmount)}
                      </td>
                      <td className="text-right font-mono">{formatMoney(r.varianceAmount)}</td>
                      <td className="text-right font-mono">{formatMoney(r.balanceAmount)}</td>
                      <td className="text-center">{r.paidDate || '-'}</td>
                      <td className="text-right font-mono">{formatMoney(r.paidAmount)}</td>
                      <td className="text-right font-mono font-bold" style={{ color: r.remainderAmount > 0 ? '#b91c1c' : '#15803d' }}>
                        {formatMoney(r.remainderAmount)}
                      </td>
                      <td className="text-right font-mono">{formatMoney(r.le30DaysAmount)}</td>
                      <td className="text-right font-mono" style={{ color: r.gt30DaysAmount > 0 ? '#b91c1c' : 'inherit' }}>
                        {formatMoney(r.gt30DaysAmount)}
                      </td>
                      <td className="text-left">
                        <span className={`badge-reason ${
                          r.reason.includes('โอนเงิน') || r.reason.includes('ครบถ้วน')
                            ? 'badge-reason--settled'
                            : r.reason.includes('ข้อผิดพลาด') || r.reason.includes('ติด C') || r.reason.includes('ไม่มีรายการ')
                              ? 'badge-reason--error'
                              : 'badge-reason--waiting'
                        }`}>
                          {r.reason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#e2e8f0', fontWeight: 700 }}>
                    <td colSpan={9} className="text-center">รวมประจำเดือน</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.monthTotals?.costAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.monthTotals?.claimedAmount)}</td>
                    <td></td>
                    <td className="text-right font-mono" style={{ color: '#15803d' }}>{formatMoney(form2Data.monthTotals?.compensatedAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.monthTotals?.varianceAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.monthTotals?.balanceAmount)}</td>
                    <td></td>
                    <td className="text-right font-mono">{formatMoney(form2Data.monthTotals?.paidAmount)}</td>
                    <td className="text-right font-mono" style={{ color: '#b91c1c' }}>{formatMoney(form2Data.monthTotals?.remainderAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.monthTotals?.le30DaysAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.monthTotals?.gt30DaysAmount)}</td>
                    <td></td>
                  </tr>
                  <tr style={{ background: '#cbd5e1', fontWeight: 700 }}>
                    <td colSpan={9} className="text-center">รวมสะสมแต่ต้นปีงบประมาณ (YTD)</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.ytdTotals?.costAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.ytdTotals?.claimedAmount)}</td>
                    <td></td>
                    <td className="text-right font-mono" style={{ color: '#15803d' }}>{formatMoney(form2Data.ytdTotals?.compensatedAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.ytdTotals?.varianceAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.ytdTotals?.balanceAmount)}</td>
                    <td></td>
                    <td className="text-right font-mono">{formatMoney(form2Data.ytdTotals?.paidAmount)}</td>
                    <td className="text-right font-mono" style={{ color: '#b91c1c' }}>{formatMoney(form2Data.ytdTotals?.remainderAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.ytdTotals?.le30DaysAmount)}</td>
                    <td className="text-right font-mono">{formatMoney(form2Data.ytdTotals?.gt30DaysAmount)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* TAB 3: ทะเบียนคุมบัญชี OP */}
        {/* ----------------------------------------------------------------- */}
        {activeTab === '3' && form3Data && !loading && (
          <div>
            <div className="official-rec-sheet-header">
              <h2>ทะเบียนคุมลูกหนี้ค่ารักษาพยาบาล {form3Data.accountName} ประจำปีงบประมาณ {form3Data.period?.yearBE}</h2>
              <h3>ประจำเดือน {form3Data.period?.monthName} | โรงพยาบาล {currentHospName}</h3>
            </div>

            {renderPagination(filteredForm3Rows.length)}

            <div className="official-rec-table-wrap">
              <table className="official-rec-table" style={{ minWidth: '1700px' }}>
                <thead>
                  <tr style={{ background: '#e2e8f0' }}>
                    <th colSpan={6}>รายละเอียดลูกหนี้ตาม HOSxP</th>
                    <th colSpan={2}>ยอดเรียกเก็บ</th>
                    <th colSpan={5}>รายการปรับปรุงจากการเรียกเก็บ</th>
                    <th>ลูกหนี้คงเหลือ</th>
                    <th colSpan={7}>รายละเอียดแบบตอบกลับ REP/STM/FDH</th>
                    <th>ลูกหนี้คงเหลือ</th>
                    <th colSpan={5}>รายละเอียดการรับชำระหนี้</th>
                    <th>ลูกหนี้คงเหลือ</th>
                    <th>พันยอดลูกหนี้</th>
                    <th>สาเหตุค้างชำระ</th>
                  </tr>
                  <tr>
                    <th style={{ width: '75px' }}>HN</th>
                    <th style={{ width: '95px' }}>VN</th>
                    <th style={{ width: '150px' }} className="text-left">ชื่อ-สกุล</th>
                    <th style={{ width: '85px' }}>วันตรวจ</th>
                    <th style={{ width: '85px' }} className="text-right">ยอดยกมา</th>
                    <th style={{ width: '85px' }} className="text-right">ระหว่างเดือน</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(1)</th>
                    <th style={{ width: '90px' }} className="text-right">ที่เรียกเก็บ</th>
                    <th style={{ width: '80px' }}>วันที่ปรับปรุง</th>
                    <th style={{ width: '100px' }}>สิทธิรักษา</th>
                    <th style={{ width: '80px' }}>เอกสาร</th>
                    <th style={{ width: '70px' }} className="text-right">เพิ่ม</th>
                    <th style={{ width: '70px' }} className="text-right">ลด</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(2)</th>
                    <th style={{ width: '80px' }}>วันที่ปรับปรุง</th>
                    <th style={{ width: '80px' }}>เอกสาร</th>
                    <th style={{ width: '130px' }}>งวด STM/REP</th>
                    <th style={{ width: '120px' }}>เลขที่คำขอ</th>
                    <th style={{ width: '90px' }} className="text-right">เงินชดเชย</th>
                    <th style={{ width: '85px' }} className="text-right">ผลต่าง</th>
                    <th style={{ width: '85px' }} className="text-right">ส่วนที่เรียกไม่ได้</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(3)</th>
                    <th style={{ width: '80px' }}>วันที่โอน</th>
                    <th style={{ width: '80px' }}>เอกสาร</th>
                    <th style={{ width: '85px' }}>ใบเสร็จ</th>
                    <th style={{ width: '90px' }}>คำขอเบิก</th>
                    <th style={{ width: '85px' }} className="text-right">ตัดลูกหนี้</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(4)</th>
                    <th style={{ width: '85px' }} className="text-right">พันยอด</th>
                    <th style={{ minWidth: '180px' }} className="text-left">สาเหตุค้างชำระ</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedForm3Rows.map((r: any, idx: number) => (
                    <tr key={`${r.hn}-${r.vn}-${idx}`}>
                      <td className="text-center font-mono">{r.hn}</td>
                      <td className="text-center font-mono">{r.vn}</td>
                      <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{r.patientName}</td>
                      <td className="text-center">{r.serviceDate}</td>
                      <td className="text-right font-mono">{formatMoney(r.broughtForward)}</td>
                      <td className="text-right font-mono">{formatMoney(r.monthlyAmount)}</td>
                      <td className="text-right font-mono">{formatMoney(r.balance1)}</td>
                      <td className="text-right font-mono font-bold">{formatMoney(r.claimedAmount)}</td>
                      <td className="text-center">-</td>
                      <td className="text-center" style={{ fontSize: '0.76rem' }}>{r.adjRight}</td>
                      <td className="text-center">-</td>
                      <td className="text-right font-mono">{formatMoney(r.adjAdd)}</td>
                      <td className="text-right font-mono">{formatMoney(r.adjSub)}</td>
                      <td className="text-right font-mono">{formatMoney(r.balance2)}</td>
                      <td className="text-center">-</td>
                      <td className="text-center">-</td>
                      <td className="text-center font-mono">{r.stmRound || '-'}</td>
                      <td className="text-center font-mono">{r.stmReqNo || '-'}</td>
                      <td className="text-right font-mono font-bold" style={{ color: r.stmCompensation > 0 ? '#15803d' : 'inherit' }}>
                        {formatMoney(r.stmCompensation)}
                      </td>
                      <td className="text-right font-mono">{formatMoney(r.stmVariance)}</td>
                      <td className="text-right font-mono">{formatMoney(r.stmUnclaimable)}</td>
                      <td className="text-right font-mono">{formatMoney(r.balance3)}</td>
                      <td className="text-center">-</td>
                      <td className="text-center">-</td>
                      <td className="text-center font-mono">{r.settleReceiptNo || '-'}</td>
                      <td className="text-center">-</td>
                      <td className="text-right font-mono">{formatMoney(r.settleDebtCut)}</td>
                      <td className="text-right font-mono font-bold" style={{ color: r.balance4 > 0 ? '#b91c1c' : '#15803d' }}>
                        {formatMoney(r.balance4)}
                      </td>
                      <td className="text-right font-mono">{formatMoney(r.carriedForward)}</td>
                      <td className="text-left" style={{ fontSize: '0.78rem' }}>{r.outstandingReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* TAB 4: ทะเบียนคุมบัญชี IP */}
        {/* ----------------------------------------------------------------- */}
        {activeTab === '4' && form4Data && !loading && (
          <div>
            <div className="official-rec-sheet-header">
              <h2>ทะเบียนคุมลูกหนี้ค่ารักษาพยาบาล {form4Data.accountName} ประจำปีงบประมาณ {form4Data.period?.yearBE}</h2>
              <h3>ประจำเดือน {form4Data.period?.monthName} | โรงพยาบาล {currentHospName} (ผู้ป่วยใน)</h3>
            </div>

            {renderPagination(filteredForm4Rows.length)}

            <div className="official-rec-table-wrap">
              <table className="official-rec-table" style={{ minWidth: '1700px' }}>
                <thead>
                  <tr style={{ background: '#e2e8f0' }}>
                    <th colSpan={7}>รายละเอียดลูกหนี้ตาม HOSxP</th>
                    <th colSpan={2}>ยอดเรียกเก็บ</th>
                    <th colSpan={5}>รายการปรับปรุงจากการเรียกเก็บ</th>
                    <th>ลูกหนี้คงเหลือ</th>
                    <th colSpan={7}>รายละเอียดแบบตอบกลับ REP/STM/FDH</th>
                    <th>ลูกหนี้คงเหลือ</th>
                    <th colSpan={5}>รายละเอียดการรับชำระหนี้</th>
                    <th>ลูกหนี้คงเหลือ</th>
                    <th>พันยอดลูกหนี้</th>
                    <th>สาเหตุค้างชำระ</th>
                  </tr>
                  <tr>
                    <th style={{ width: '75px' }}>HN</th>
                    <th style={{ width: '85px' }}>AN</th>
                    <th style={{ width: '150px' }} className="text-left">ชื่อ-สกุล</th>
                    <th style={{ width: '80px' }}>วันรับ</th>
                    <th style={{ width: '80px' }}>วันจำหน่าย</th>
                    <th style={{ width: '85px' }} className="text-right">ยอดยกมา</th>
                    <th style={{ width: '85px' }} className="text-right">ระหว่างเดือน</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(1)</th>
                    <th style={{ width: '90px' }} className="text-right">ที่เรียกเก็บ</th>
                    <th style={{ width: '80px' }}>วันที่ปรับปรุง</th>
                    <th style={{ width: '100px' }}>สิทธิรักษา</th>
                    <th style={{ width: '80px' }}>เอกสาร</th>
                    <th style={{ width: '70px' }} className="text-right">เพิ่ม</th>
                    <th style={{ width: '70px' }} className="text-right">ลด</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(2)</th>
                    <th style={{ width: '80px' }}>วันที่ปรับปรุง</th>
                    <th style={{ width: '80px' }}>เอกสาร</th>
                    <th style={{ width: '130px' }}>งวด STM/REP</th>
                    <th style={{ width: '120px' }}>เลขที่คำขอ</th>
                    <th style={{ width: '90px' }} className="text-right">เงินชดเชย</th>
                    <th style={{ width: '85px' }} className="text-right">ส่วนต่างสูงกว่า</th>
                    <th style={{ width: '85px' }} className="text-right">ส่วนต่างต่ำกว่า</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(3)</th>
                    <th style={{ width: '80px' }}>วันที่โอน</th>
                    <th style={{ width: '80px' }}>เอกสาร</th>
                    <th style={{ width: '85px' }}>ใบเสร็จ</th>
                    <th style={{ width: '90px' }}>คำขอเบิก</th>
                    <th style={{ width: '85px' }} className="text-right">ตัดลูกหนี้</th>
                    <th style={{ width: '85px' }} className="text-right">คงเหลือ(4)</th>
                    <th style={{ width: '85px' }} className="text-right">พันยอด</th>
                    <th style={{ minWidth: '180px' }} className="text-left">สาเหตุค้างชำระ</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedForm4Rows.map((r: any, idx: number) => (
                    <tr key={`${r.hn}-${r.an}-${idx}`}>
                      <td className="text-center font-mono">{r.hn}</td>
                      <td className="text-center font-mono">{r.an}</td>
                      <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{r.patientName}</td>
                      <td className="text-center">{r.serviceDate}</td>
                      <td className="text-center">{r.dischargeDate}</td>
                      <td className="text-right font-mono">{formatMoney(r.broughtForward)}</td>
                      <td className="text-right font-mono">{formatMoney(r.monthlyAmount)}</td>
                      <td className="text-right font-mono">{formatMoney(r.balance1)}</td>
                      <td className="text-right font-mono font-bold">{formatMoney(r.claimedAmount)}</td>
                      <td className="text-center">-</td>
                      <td className="text-center" style={{ fontSize: '0.76rem' }}>{r.adjRight}</td>
                      <td className="text-center">-</td>
                      <td className="text-right font-mono">{formatMoney(r.adjAdd)}</td>
                      <td className="text-right font-mono">{formatMoney(r.adjSub)}</td>
                      <td className="text-right font-mono">{formatMoney(r.balance2)}</td>
                      <td className="text-center">-</td>
                      <td className="text-center">-</td>
                      <td className="text-center font-mono">{r.stmRound || '-'}</td>
                      <td className="text-center font-mono">{r.stmReqNo || '-'}</td>
                      <td className="text-right font-mono font-bold" style={{ color: r.stmCompensation > 0 ? '#15803d' : 'inherit' }}>
                        {formatMoney(r.stmCompensation)}
                      </td>
                      <td className="text-right font-mono">{formatMoney(r.varianceHigh)}</td>
                      <td className="text-right font-mono">{formatMoney(r.varianceLow)}</td>
                      <td className="text-right font-mono">{formatMoney(r.balance3)}</td>
                      <td className="text-center">-</td>
                      <td className="text-center">-</td>
                      <td className="text-center font-mono">{r.settleReceiptNo || '-'}</td>
                      <td className="text-center">-</td>
                      <td className="text-right font-mono">{formatMoney(r.settleDebtCut)}</td>
                      <td className="text-right font-mono font-bold" style={{ color: r.balance4 > 0 ? '#b91c1c' : '#15803d' }}>
                        {formatMoney(r.balance4)}
                      </td>
                      <td className="text-right font-mono">{formatMoney(r.carriedForward)}</td>
                      <td className="text-left" style={{ fontSize: '0.78rem' }}>{r.outstandingReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Evidence Signatures Section (Visible in Print & Bottom of Page) */}
        <section className="official-rec-signatures">
          <div className="official-rec-signature-col">
            <div className="official-rec-signature-line"></div>
            <div className="official-rec-signature-name">
              (ลงชื่อ)........................................................... ผู้จัดทำ
            </div>
            <div className="official-rec-signature-printed-name">
              ( {signers.finance.name || '...........................................................'} )
            </div>
            <div className="official-rec-signature-title">{signers.finance.position}</div>
            <div className="official-rec-signature-date">วันที่ ........./........./............</div>
          </div>

          <div className="official-rec-signature-col">
            <div className="official-rec-signature-line"></div>
            <div className="official-rec-signature-name">
              (ลงชื่อ)........................................................... ผู้ตรวจสอบ
            </div>
            <div className="official-rec-signature-printed-name">
              ( {signers.insurance.name || '...........................................................'} )
            </div>
            <div className="official-rec-signature-title">{signers.insurance.position}</div>
            <div className="official-rec-signature-date">วันที่ ........./........./............</div>
          </div>

          <div className="official-rec-signature-col">
            <div className="official-rec-signature-line"></div>
            <div className="official-rec-signature-name">
              (ลงชื่อ)........................................................... ผู้เห็นชอบ
            </div>
            <div className="official-rec-signature-printed-name">
              ( {signers.director.name || '...........................................................'} )
            </div>
            <div className="official-rec-signature-title">{signers.director.position}</div>
            <div className="official-rec-signature-date">วันที่ ........./........./............</div>
          </div>
        </section>
      </main>
    </div>
  );
};
