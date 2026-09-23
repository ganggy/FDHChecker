import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { navigateFromDashboard } from '../utils/navigationState';

export type DentalCategory =
  | 'ALL'
  | 'SCALING'
  | 'FILLING'
  | 'EXTRACTION'
  | 'EXAM'
  | 'PREVENTION'
  | 'ANC'
  | 'PROSTHODONTIC'
  | 'OTHER';

export type DentalScheme = 'ALL' | 'UC' | 'SSS' | 'OFC' | 'LGO' | 'CASH';

export type DentalAuditIssue = {
  code: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  recommendation: string;
  category: 'dental' | 'clinical' | 'billing';
  autoFixable?: boolean;
  fixAction?: string;
};

export type DentalAuditVisit = {
  vn: string;
  hn: string;
  patient_name: string;
  sex: string;
  age_y: number;
  service_date: string;
  service_time: string;
  pttype: string;
  pttype_name: string;
  pttype_group: 'UC' | 'SSS' | 'OFC' | 'LGO' | 'CASH' | 'OTHER';
  department: string;
  diagnoses: Array<{
    code: string;
    name?: string;
    diagtype: string;
  }>;
  procedures: Array<{
    code: string;
    name?: string;
    type?: string;
    tooth?: string;
    tmcode?: string;
    icd10tm?: string;
  }>;
  chargeItems: Array<{
    icode: string;
    name?: string;
    qty?: number;
    unitprice?: number;
    sum_price?: number;
    income?: string;
  }>;
  total_charge: number;
  categories: DentalCategory[];
  issues: DentalAuditIssue[];
  audit_status: 'critical' | 'warning' | 'valid';
  can_auto_fix: boolean;
  auto_fix_actions: string[];
};

export type DentalAuditSummary = {
  total_visits: number;
  valid_count: number;
  critical_count: number;
  warning_count: number;
  auto_fixable_count: number;
  total_amount: number;
  by_category: Record<DentalCategory, number>;
  by_scheme: {
    uc: number;
    sss: number;
    ofc: number;
    lgo: number;
    cash: number;
    other: number;
  };
};

const CATEGORY_TABS: Array<{ id: DentalCategory; label: string; icon: string }> = [
  { id: 'ALL', label: 'ทั้งหมด', icon: '📑' },
  { id: 'SCALING', label: 'ขูดหินปูน / ปริทันต์', icon: '🪥' },
  { id: 'FILLING', label: 'อุดฟัน / ฟันผุ', icon: '🦷' },
  { id: 'EXTRACTION', label: 'ถอน / ผ่าฟันคุด', icon: '🗜️' },
  { id: 'EXAM', label: 'ตรวจสุขภาพช่องปาก', icon: '🩺' },
  { id: 'PREVENTION', label: 'ทันตกรรมป้องกัน', icon: '🛡️' },
  { id: 'ANC', label: 'ทันตกรรม ANC', icon: '🤰' },
  { id: 'PROSTHODONTIC', label: 'ฟันเทียม / ประดิษฐ์', icon: '🦿' },
  { id: 'OTHER', label: 'อื่นๆ / จ่ายยา', icon: '💊' },
];

const SCHEME_OPTIONS: Array<{ id: DentalScheme; label: string; color: string }> = [
  { id: 'ALL', label: 'ทุกสิทธิการรักษา', color: '#4b5563' },
  { id: 'UC', label: 'บัตรทอง (UC)', color: '#059669' },
  { id: 'SSS', label: 'ประกันสังคม (SSS)', color: '#2563eb' },
  { id: 'OFC', label: 'ข้าราชการ (OFC)', color: '#7c3aed' },
  { id: 'LGO', label: 'อปท. (LGO)', color: '#d97706' },
  { id: 'CASH', label: 'ชำระเงินเอง (Cash)', color: '#4b5563' },
];

export function DentalAuditPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentMonthStart = useMemo(() => today.slice(0, 8) + '01', [today]);

  const [startDate, setStartDate] = useState(currentMonthStart);
  const [endDate, setEndDate] = useState(today);
  const [scheme, setScheme] = useState<DentalScheme>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<DentalCategory>('ALL');
  const [auditStatus, setAuditStatus] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'VALID' | 'CAN_FIX'>('ALL');
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<DentalAuditSummary | null>(null);
  const [visits, setVisits] = useState<DentalAuditVisit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  // Modals state
  const [singleFixTarget, setSingleFixTarget] = useState<DentalAuditVisit | null>(null);
  const [singleFixSubmitting, setSingleFixSubmitting] = useState(false);
  const [singleFixResult, setSingleFixResult] = useState<{ actions: string[]; error?: string } | null>(null);

  const [batchFixOpen, setBatchFixOpen] = useState(false);
  const [batchFixSubmitting, setBatchFixSubmitting] = useState(false);
  const [batchFixResult, setBatchFixResult] = useState<{
    fixedCount: number;
    failedCount: number;
    results: Array<{ vn: string; success: boolean; actionsApplied: string[]; error?: string }>;
  } | null>(null);

  const [detailModalVisit, setDetailModalVisit] = useState<DentalAuditVisit | null>(null);
  const [fixedVns, setFixedVns] = useState<Set<string>>(new Set());
  const [selectedRowVns, setSelectedRowVns] = useState<Set<string>>(new Set());

  const fetchVisits = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        scheme,
        category: selectedCategory,
        auditStatus,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/dental-audit/visits?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'โหลดข้อมูลเวชระเบียนทันตกรรมไม่สำเร็จ');
      }

      setSummary(json.data.summary);
      setVisits(json.data.data);
      setTotal(json.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchVisits();
  }, [startDate, endDate, scheme, selectedCategory, auditStatus, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    void fetchVisits();
  };

  const handleQuickPreset = (preset: 'today' | 'this_month' | 'last_month' | 'fy2568') => {
    const now = new Date();
    if (preset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'this_month') {
      setStartDate(currentMonthStart);
      setEndDate(today);
    } else if (preset === 'last_month') {
      const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      const prevMonthFirstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      setStartDate(prevMonthFirstDay.toISOString().slice(0, 10));
      setEndDate(prevMonthLastDay.toISOString().slice(0, 10));
    } else if (preset === 'fy2568') {
      setStartDate('2024-10-01');
      setEndDate(today);
    }
    setPage(1);
  };

  const handleSingleFix = async () => {
    if (!singleFixTarget) return;
    setSingleFixSubmitting(true);
    setSingleFixResult(null);
    try {
      const res = await fetch('/api/dental-audit/fix-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vn: singleFixTarget.vn }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'แก้ไขข้อมูลทางคลินิกไม่สำเร็จ');
      }
      setSingleFixResult({ actions: json.data.actionsApplied });
      setFixedVns((prev) => new Set(prev).add(singleFixTarget.vn));
      void fetchVisits();
    } catch (err) {
      setSingleFixResult({
        actions: [],
        error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแก้ไข',
      });
    } finally {
      setSingleFixSubmitting(false);
    }
  };

  const autoFixableVisits = useMemo(() => visits.filter((v) => v.can_auto_fix), [visits]);

  const handleBatchFix = async () => {
    if (autoFixableVisits.length === 0) return;
    setBatchFixSubmitting(true);
    setBatchFixResult(null);
    try {
      const vns = autoFixableVisits.map((v) => v.vn);
      const res = await fetch('/api/dental-audit/fix-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vns }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'แก้ไขข้อมูลแบบกลุ่มไม่สำเร็จ');
      }
      setBatchFixResult({
        fixedCount: json.data.fixedCount,
        failedCount: json.data.failedCount,
        results: json.data.results,
      });
      const newlyFixed = new Set(fixedVns);
      (json.data.results || []).forEach((r: { vn: string; success: boolean }) => {
        if (r.success) newlyFixed.add(r.vn);
      });
      setFixedVns(newlyFixed);
      void fetchVisits();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแก้ไขแบบกลุ่ม');
    } finally {
      setBatchFixSubmitting(false);
    }
  };

  const handleSendToFdh = (vnsToSend: string[]) => {
    if (vnsToSend.length === 0) {
      alert('กรุณาเลือกรายการที่ต้องการส่งออก FDH');
      return;
    }
    navigateFromDashboard('fdh', {
      source: 'dashboard',
      startDate,
      endDate,
      contextLabel: `ส่งออกจากงานทันตกรรม: ${vnsToSend.length} รายการ`,
      fdh: {
        targetVns: vnsToSend,
        statusFilter: 'all',
      },
    });
  };

  const handleCopyVns = (vns: string[]) => {
    if (vns.length === 0) return;
    void navigator.clipboard.writeText(vns.join(', '));
    alert(`คัดลอก ${vns.length} VN เรียบร้อยแล้ว (สามารถนำไปวางค้นหาในหน้าส่งออก FDH ได้ทันที)`);
  };

  const handleExportExcel = () => {
    if (visits.length === 0) {
      alert('ไม่มีข้อมูลสำหรับส่งออก');
      return;
    }
    const rows = visits.map((v, idx) => ({
      ลำดับ: idx + 1,
      วันที่: v.service_date,
      เวลา: v.service_time,
      VN: v.vn,
      HN: v.hn,
      ชื่อผู้ป่วย: v.patient_name,
      เพศ: v.sex === '1' ? 'ชาย' : v.sex === '2' ? 'หญิง' : v.sex,
      อายุ: v.age_y,
      สิทธิ: v.pttype_name,
      กลุ่มสิทธิ: v.pttype_group,
      หมวดบริการ: v.categories.join(', '),
      โรคหลัก_PDX: v.diagnoses.find((d) => d.diagtype === '1')?.code || '',
      ชื่อโรคหลัก: v.diagnoses.find((d) => d.diagtype === '1')?.name || '',
      โรครอง_SDX: v.diagnoses.filter((d) => d.diagtype !== '1').map((d) => d.code).join(', '),
      หัตถการ: v.procedures.map((p) => `${p.code} (${p.name || ''})`).join(' | '),
      ค่าบริการ: v.total_charge,
      สถานะAudit: v.audit_status === 'valid' ? 'ถูกต้อง' : v.audit_status === 'critical' ? 'ต้องแก้ไข' : 'ข้อควรระวัง',
      ข้อผิดพลาด: v.issues.map((i) => `[${i.code}] ${i.title}`).join(' \n '),
      แนวทางแก้ไข: v.issues.map((i) => i.recommendation).join(' \n '),
      AutoFixได้: v.can_auto_fix ? 'ใช่' : 'ไม่ใช่',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dental_Audit');
    XLSX.writeFile(wb, `Dental_Audit_${startDate}_to_${endDate}.xlsx`);
  };

  const getSchemeBadge = (group: string) => {
    switch (group) {
      case 'UC':
        return <span style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>บัตรทอง UC</span>;
      case 'SSS':
        return <span style={{ background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>ประกันสังคม SSS</span>;
      case 'OFC':
        return <span style={{ background: '#f5f3ff', color: '#5b21b6', border: '1px solid #ddd6fe', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>ข้าราชการ OFC</span>;
      case 'LGO':
        return <span style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>อปท. LGO</span>;
      default:
        return <span style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{group}</span>;
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '32px' }}>🦷</span>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#1e293b' }}>
                ตรวจสอบงานห้องฟันและเวชระเบียนทันตกรรม (Dental Service Audit)
              </h1>
              <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '14px' }}>
                ตรวจสอบความสมบูรณ์และถูกต้องของรหัสวินิจฉัย (ICD-10) สัมพันธ์กับหัตถการ (`dtmain`/ICD-9) แยกตามหมวดบริการและสิทธิการรักษา
              </p>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleExportExcel}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fff', border: '1px solid #cbd5e1', padding: '8px 14px', borderRadius: '8px', color: '#334155', fontWeight: 500, cursor: 'pointer' }}
          >
            📥 ส่งออก Excel
          </button>
          {selectedRowVns.size > 0 && (
            <button
              type="button"
              onClick={() => handleSendToFdh(Array.from(selectedRowVns))}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#059669', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 4px rgba(5,150,105,0.3)' }}
            >
              🚀 ส่งออก FDH ที่เลือก ({selectedRowVns.size} เคส)
            </button>
          )}
          {fixedVns.size > 0 && (
            <>
              <button
                type="button"
                onClick={() => handleSendToFdh(Array.from(fixedVns))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 4px rgba(16,185,129,0.3)' }}
              >
                🚀 ส่งออก FDH เคสที่เพิ่งแก้ ({fixedVns.size} เคส)
              </button>
              <button
                type="button"
                onClick={() => handleCopyVns(Array.from(fixedVns))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fff', border: '1px solid #10b981', color: '#047857', padding: '8px 12px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
              >
                📋 คัดลอก VN ({fixedVns.size})
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => { setBatchFixResult(null); setBatchFixOpen(true); }}
            disabled={autoFixableVisits.length === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: autoFixableVisits.length > 0 ? 'linear-gradient(135deg, #0284c7, #0369a1)' : '#94a3b8',
              border: 'none',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: autoFixableVisits.length > 0 ? 'pointer' : 'not-allowed',
              boxShadow: autoFixableVisits.length > 0 ? '0 2px 4px rgba(2, 132, 199, 0.3)' : 'none',
            }}
          >
            ⚡ แก้ไขอัตโนมัติทั้งหมด ({autoFixableVisits.length} เคส)
          </button>
          <button
            type="button"
            onClick={fetchVisits}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#0f172a', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '8px', fontWeight: 500, cursor: 'pointer' }}
          >
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      {/* Filter Card */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', border: '1px solid #e2e8f0', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Date Picker & Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>ช่วงวันที่:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
            />
            <span style={{ color: '#94a3b8' }}>ถึง</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
            />
            <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
              <button type="button" onClick={() => handleQuickPreset('today')} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: '#f1f5f9', border: '1px solid #e2e8f0', cursor: 'pointer' }}>วันนี้</button>
              <button type="button" onClick={() => handleQuickPreset('this_month')} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: '#f1f5f9', border: '1px solid #e2e8f0', cursor: 'pointer' }}>เดือนนี้</button>
              <button type="button" onClick={() => handleQuickPreset('last_month')} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: '#f1f5f9', border: '1px solid #e2e8f0', cursor: 'pointer' }}>เดือนที่แล้ว</button>
              <button type="button" onClick={() => handleQuickPreset('fy2568')} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: '#f1f5f9', border: '1px solid #e2e8f0', cursor: 'pointer' }}>ปีงบ 68</button>
            </div>
          </div>

          {/* Scheme Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>สิทธิการรักษา:</span>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {SCHEME_OPTIONS.map((item) => {
                const active = scheme === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setScheme(item.id); setPage(1); }}
                    style={{
                      fontSize: '12px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: active ? `2px solid ${item.color}` : '1px solid #cbd5e1',
                      background: active ? item.color : '#fff',
                      color: active ? '#fff' : '#334155',
                      fontWeight: active ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '14px 0' }} />

        {/* Second row: Status filter & Search box */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>สถานะผลตรวจ:</span>
            <select
              value={auditStatus}
              onChange={(e) => { setAuditStatus(e.target.value as any); setPage(1); }}
              style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', background: '#fff', color: '#1e293b' }}
            >
              <option value="ALL">ทั้งหมดทุกสถานะ</option>
              <option value="CRITICAL">🔴 มีข้อผิดพลาดเร่งด่วน (Critical)</option>
              <option value="WARNING">🟡 ข้อควรระวัง (Warning)</option>
              <option value="VALID">🟢 ถูกต้องสมบูรณ์ (Valid)</option>
              <option value="CAN_FIX">⚡ เฉพาะเคสที่ Auto-Fix ได้</option>
            </select>
          </div>

          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              placeholder="ค้นหา HN, VN, ชื่อผู้ป่วย..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '220px' }}
            />
            <button
              type="submit"
              style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}
            >
              ค้นหา
            </button>
          </form>
        </div>
      </div>

      {/* KPI Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>วิสิตทันตกรรมทั้งหมด</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#0f172a', margin: '4px 0' }}>{summary.total_visits.toLocaleString()}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>ยอดเงินรวม {summary.total_amount.toLocaleString()} บาท</div>
          </div>
          <div style={{ background: '#ecfdf5', padding: '16px', borderRadius: '10px', border: '1px solid #a7f3d0' }}>
            <div style={{ fontSize: '12px', color: '#065f46', fontWeight: 600 }}>🟢 ผ่านเกณฑ์ถูกต้อง (Valid)</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#047857', margin: '4px 0' }}>{summary.valid_count.toLocaleString()}</div>
            <div style={{ fontSize: '11px', color: '#059669' }}>
              {summary.total_visits ? ((summary.valid_count / summary.total_visits) * 100).toFixed(1) : 0}% ของทั้งหมด
            </div>
          </div>
          <div style={{ background: '#fef2f2', padding: '16px', borderRadius: '10px', border: '1px solid #fecaca' }}>
            <div style={{ fontSize: '12px', color: '#991b1b', fontWeight: 600 }}>🔴 ติดขัด / ต้องแก้ไข (Critical)</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#dc2626', margin: '4px 0' }}>{summary.critical_count.toLocaleString()}</div>
            <div style={{ fontSize: '11px', color: '#b91c1c' }}>เสี่ยงติด C Error หรือปฏิเสธจ่าย</div>
          </div>
          <div style={{ background: '#fffbeb', padding: '16px', borderRadius: '10px', border: '1px solid #fde68a' }}>
            <div style={{ fontSize: '12px', color: '#92400e', fontWeight: 600 }}>🟡 ข้อควรระวัง (Warning)</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#d97706', margin: '4px 0' }}>{summary.warning_count.toLocaleString()}</div>
            <div style={{ fontSize: '11px', color: '#b45309' }}>เช่น ค่าบริการ 0 บาท, เกิน 900</div>
          </div>
          <div style={{ background: '#f0f9ff', padding: '16px', borderRadius: '10px', border: '1px solid #bae6fd' }}>
            <div style={{ fontSize: '12px', color: '#0369a1', fontWeight: 600 }}>⚡ พร้อมแก้ไขอัตโนมัติ (Auto-Fix)</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#0284c7', margin: '4px 0' }}>{summary.auto_fixable_count.toLocaleString()}</div>
            <div style={{ fontSize: '11px', color: '#0284c7' }}>แก้รหัสโรค, ย้ายรหัสตกค้าง, เพิ่ม PDX</div>
          </div>
        </div>
      )}

      {/* Service Category Tabs */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
        {CATEGORY_TABS.map((tab) => {
          const active = selectedCategory === tab.id;
          const count = summary?.by_category?.[tab.id] ?? 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setSelectedCategory(tab.id); setPage(1); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: active ? 600 : 500,
                border: active ? '2px solid #0284c7' : '1px solid #e2e8f0',
                background: active ? '#f0f9ff' : '#fff',
                color: active ? '#0284c7' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              <span
                style={{
                  background: active ? '#0284c7' : '#f1f5f9',
                  color: active ? '#fff' : '#64748b',
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  marginLeft: '4px',
                  fontWeight: 600,
                }}
              >
                {count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Table Card */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '24px', marginBottom: '10px' }}>⏳</div>
            <div>กำลังตรวจสอบเวชระเบียนและวิเคราะห์ข้อมูลทันตกรรม...</div>
          </div>
        ) : error ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>
            <div>⚠️ {error}</div>
            <button
              type="button"
              onClick={fetchVisits}
              style={{ marginTop: '12px', background: '#fee2e2', border: '1px solid #fca5a5', padding: '6px 14px', borderRadius: '6px', color: '#b91c1c', cursor: 'pointer' }}
            >
              ลองใหม่อีกครั้ง
            </button>
          </div>
        ) : visits.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>🦷</div>
            <div style={{ fontWeight: 600 }}>ไม่พบข้อมูลวิสิตทันตกรรมตามเงื่อนไขที่เลือก</div>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>ลองเปลี่ยนช่วงวันที่ หรือเลือกหมวดบริการ/สิทธิการรักษาอื่น</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
                  <th style={{ padding: '12px 10px', width: '38px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={visits.length > 0 && visits.every((v) => selectedRowVns.has(v.vn))}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedRowVns(new Set(visits.map((v) => v.vn)));
                        else setSelectedRowVns(new Set());
                      }}
                      title="เลือกทั้งหมด"
                    />
                  </th>
                  <th style={{ padding: '12px 14px', width: '45px' }}>#</th>
                  <th style={{ padding: '12px 14px', width: '110px' }}>วันที่-เวลา</th>
                  <th style={{ padding: '12px 14px', width: '120px' }}>สิทธิการรักษา</th>
                  <th style={{ padding: '12px 14px', width: '180px' }}>ข้อมูลผู้ป่วย</th>
                  <th style={{ padding: '12px 14px', width: '180px' }}>การวินิจฉัยโรค (ICD-10)</th>
                  <th style={{ padding: '12px 14px', width: '220px' }}>หัตถการทันตกรรม (`dtmain`)</th>
                  <th style={{ padding: '12px 14px', width: '90px', textAlign: 'right' }}>ค่าบริการ</th>
                  <th style={{ padding: '12px 14px', minWidth: '240px' }}>ผลการตรวจ Audit & ข้อผิดพลาด</th>
                  <th style={{ padding: '12px 14px', width: '140px', textAlign: 'center' }}>การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v, idx) => {
                  const rowNumber = (page - 1) * pageSize + idx + 1;
                  const isCritical = v.audit_status === 'critical';
                  const isWarning = v.audit_status === 'warning';
                  const isRowSelected = selectedRowVns.has(v.vn);

                  return (
                    <tr
                      key={v.vn}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isRowSelected ? '#f0fdf4' : isCritical ? '#fffafb' : isWarning ? '#fffdfa' : '#fff',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isRowSelected}
                          onChange={() => {
                            const next = new Set(selectedRowVns);
                            if (next.has(v.vn)) next.delete(v.vn);
                            else next.add(v.vn);
                            setSelectedRowVns(next);
                          }}
                        />
                      </td>
                      <td style={{ padding: '12px 14px', color: '#94a3b8' }}>{rowNumber}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{v.service_date}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{v.service_time}</div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div>{getSchemeBadge(v.pttype_group)}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.pttype_name}>
                          {v.pttype_name}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{v.patient_name || 'ไม่ระบุชื่อ'}</span>
                          {fixedVns.has(v.vn) && (
                            <span style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', padding: '1px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                              ✨ เพิ่งแก้ไขเสร็จ
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          HN: <span style={{ fontFamily: 'monospace' }}>{v.hn}</span> | VN: <span style={{ fontFamily: 'monospace' }}>{v.vn}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {v.sex === '1' ? 'ชาย' : v.sex === '2' ? 'หญิง' : v.sex} อายุ {v.age_y} ปี
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {v.diagnoses.length === 0 ? (
                          <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '12px', background: '#fee2e2', padding: '2px 6px', borderRadius: '4px' }}>
                            ❌ ไม่มีรหัสโรค
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {v.diagnoses.map((d, dIdx) => (
                              <div key={dIdx} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span
                                  style={{
                                    fontFamily: 'monospace',
                                    fontWeight: 700,
                                    color: d.diagtype === '1' ? '#0369a1' : '#475569',
                                    background: d.diagtype === '1' ? '#e0f2fe' : '#f1f5f9',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                  }}
                                >
                                  {d.code}
                                </span>
                                <span style={{ fontSize: '10px', color: d.diagtype === '1' ? '#0284c7' : '#94a3b8' }}>
                                  ({d.diagtype === '1' ? 'PDX' : 'SDX'})
                                </span>
                                <span style={{ color: '#475569', fontSize: '11px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>
                                  {d.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {v.procedures.length === 0 ? (
                          <span style={{ color: '#94a3b8', fontSize: '12px', fontStyle: 'italic' }}>
                            ไม่มีหัตถการ
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {v.procedures.map((p, pIdx) => (
                              <div key={pIdx} style={{ fontSize: '12px' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: '3px' }}>
                                  {p.code}
                                </span>
                                {p.tooth && (
                                  <span style={{ marginLeft: '4px', fontSize: '11px', color: '#0284c7', background: '#e0f2fe', padding: '1px 4px', borderRadius: '3px' }}>
                                    ซี่ {p.tooth}
                                  </span>
                                )}
                                <span style={{ color: '#475569', marginLeft: '4px', fontSize: '11px' }}>
                                  {p.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#1e293b' }}>
                        {v.total_charge > 0 ? `${v.total_charge.toLocaleString()} ฿` : <span style={{ color: '#94a3b8' }}>0 ฿</span>}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {v.issues.length === 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#059669', background: '#ecfdf5', padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                            ✓ ผ่านการตรวจสอบ
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {v.issues.map((issue, iIdx) => (
                              <div
                                key={iIdx}
                                style={{
                                  background: issue.level === 'critical' ? '#fef2f2' : '#fffbeb',
                                  border: `1px solid ${issue.level === 'critical' ? '#fecaca' : '#fde68a'}`,
                                  borderRadius: '6px',
                                  padding: '4px 8px',
                                  fontSize: '11px',
                                }}
                              >
                                <div style={{ fontWeight: 600, color: issue.level === 'critical' ? '#b91c1c' : '#b45309' }}>
                                  {issue.title}
                                </div>
                                <div style={{ color: '#64748b', fontSize: '10px', marginTop: '1px' }}>
                                  💡 {issue.recommendation}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                          {v.can_auto_fix && (
                            <button
                              type="button"
                              onClick={() => {
                                setSingleFixTarget(v);
                                setSingleFixResult(null);
                              }}
                              style={{
                                background: '#0284c7',
                                color: '#fff',
                                border: 'none',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                width: '100%',
                              }}
                            >
                              ⚡ แก้ไขอัตโนมัติ
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDetailModalVisit(v)}
                            style={{
                              background: '#f1f5f9',
                              color: '#475569',
                              border: '1px solid #cbd5e1',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              width: '100%',
                            }}
                          >
                            🔍 ดูรายละเอียด
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendToFdh([v.vn])}
                            title="ส่งเฉพาะวิสิตนี้ไปยังหน้าส่งออก FDH โดยตรง"
                            style={{
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              width: '100%',
                            }}
                          >
                            🚀 ส่ง FDH เคสนี้
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {total > pageSize && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              แสดง {(page - 1) * pageSize + 1} ถึง {Math.min(page * pageSize, total)} จากทั้งหมด {total.toLocaleString()} รายการ
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
              >
                ◀ ก่อนหน้า
              </button>
              <span style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 600 }}>หน้า {page}</span>
              <button
                type="button"
                disabled={page * pageSize >= total}
                onClick={() => setPage((p) => p + 1)}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: page * pageSize >= total ? 'not-allowed' : 'pointer' }}
              >
                ถัดไป ▶
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Single Fix Modal */}
      {singleFixTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '520px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>⚡ ยืนยันการแก้ไขข้อมูลทันตกรรมอัตโนมัติ</h3>
              <button type="button" onClick={() => setSingleFixTarget(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ background: '#f1f5f9', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
                <div><strong>ผู้ป่วย:</strong> {singleFixTarget.patient_name} (HN: {singleFixTarget.hn} / VN: {singleFixTarget.vn})</div>
                <div><strong>วันที่รับบริการ:</strong> {singleFixTarget.service_date} ({singleFixTarget.pttype_name})</div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>รายการที่จะได้รับการแก้ไข:</div>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#475569', lineHeight: '1.6' }}>
                  {singleFixTarget.auto_fix_actions.map((act, aIdx) => (
                    <li key={aIdx}>
                      <strong>{act}:</strong>{' '}
                      {act === 'ADD_K051' && 'เพิ่มรหัสโรคเหงือกอักเสบ K05.1 (diagtype=2) สำหรับหัตถการขูดหินปูน'}
                      {act === 'ADD_K021' && 'เพิ่มรหัสโรคฟันผุ K02.1 (diagtype=2) สำหรับหัตถการอุดฟัน'}
                      {act === 'ADD_K011' && 'เพิ่มรหัสฟันคุด K01.1 (diagtype=2) สำหรับหัตถการผ่าฟันคุด'}
                      {act === 'SWAP_Z012' && 'สลับรหัสโรคที่รักษาเป็นโรคหลัก (PDX) และเปลี่ยน Z01.2 เป็นโรครอง'}
                      {act === 'ADD_DENTAL_PDX' && 'เพิ่มรหัสวินิจฉัยโรคหลักทันตกรรมที่เหมาะสมใน ovstdiag และ vn_stat'}
                      {act === 'SYNC_DENTAL_PROC' && 'ย้ายรหัสหัตถการตัวเลขจาก ovstdiag เข้าสู่ dtmain'}
                      {act === 'REMOVE_NUMERIC_DX' && 'ลบรหัสตัวเลขตกค้างออกจาก ovstdiag'}
                      {act === 'ADD_DENTAL_EXAM' && 'เพิ่มหัตถการ Oral exam (2330010) ลง dtmain'}
                      {act === 'REMOVE_ANC_PROC' && 'ลบหัตถการส่งเสริมป้องกัน ANC ที่ลงปะปนในเคสรักษาปกติ'}
                      {act === 'REMOVE_DUP_DX' && 'ลบรหัสโรคที่ซ้ำกับโรคหลักออกจาก ovstdiag'}
                    </li>
                  ))}
                </ul>
              </div>

              {singleFixResult && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: singleFixResult.error ? '#fef2f2' : '#ecfdf5',
                    border: `1px solid ${singleFixResult.error ? '#fecaca' : '#a7f3d0'}`,
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: singleFixResult.error ? '#b91c1c' : '#047857',
                  }}
                >
                  {singleFixResult.error ? (
                    <div>❌ {singleFixResult.error}</div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600 }}>✓ แก้ไขข้อมูลสำเร็จ:</div>
                      {singleFixResult.actions.map((act, idx) => (
                        <div key={idx}>• {act}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setSingleFixTarget(null)}
                  style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                >
                  {singleFixResult && !singleFixResult.error ? 'ปิดหน้าต่าง' : 'ยกเลิก'}
                </button>
                {(!singleFixResult || singleFixResult.error) && (
                  <button
                    type="button"
                    onClick={handleSingleFix}
                    disabled={singleFixSubmitting}
                    style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: singleFixSubmitting ? 'not-allowed' : 'pointer' }}
                  >
                    {singleFixSubmitting ? 'กำลังบันทึก...' : 'ยืนยันการแก้ไข'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Fix Modal */}
      {batchFixOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '600px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>⚡ แก้ไขข้อมูลทันตกรรมอัตโนมัติแบบกลุ่ม (Batch Auto-Fix)</h3>
              <button type="button" onClick={() => setBatchFixOpen(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ background: '#f0f9ff', padding: '14px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #bae6fd', fontSize: '13px', color: '#0369a1' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                  พบรายการที่สามารถแก้ไขได้จำนวน {autoFixableVisits.length} วิสิต
                </div>
                <div>ระบบจะทำการอัปเดตเวชระเบียนทันตกรรมให้ตรงตามเกณฑ์ e-Claim สปสช. และประกันสังคมโดยอัตโนมัติ</div>
              </div>

              {batchFixResult && (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '8px',
                    background: batchFixResult.failedCount > 0 ? '#fef2f2' : '#ecfdf5',
                    border: `1px solid ${batchFixResult.failedCount > 0 ? '#fecaca' : '#a7f3d0'}`,
                    marginBottom: '16px',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ fontWeight: 600, color: batchFixResult.failedCount > 0 ? '#b91c1c' : '#047857' }}>
                    ผลการดำเนินการ: แก้ไขสำเร็จ {batchFixResult.fixedCount} รายการ, ไม่สำเร็จ {batchFixResult.failedCount} รายการ
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setBatchFixOpen(false)}
                  style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                >
                  {batchFixResult ? 'ปิดหน้าต่าง' : 'ยกเลิก'}
                </button>
                {!batchFixResult && (
                  <button
                    type="button"
                    onClick={handleBatchFix}
                    disabled={batchFixSubmitting}
                    style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: batchFixSubmitting ? 'not-allowed' : 'pointer' }}
                  >
                    {batchFixSubmitting ? 'กำลังดำเนินการแก้ไข...' : `ยืนยันการแก้ไข ${autoFixableVisits.length} รายการ`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Patient Detail Modal */}
      {detailModalVisit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>📋 รายละเอียดเวชระเบียนทันตกรรมรายบุคคล</h3>
              <button type="button" onClick={() => setDetailModalVisit(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}>✕</button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', background: '#f8fafc', padding: '14px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
                <div><strong>ผู้ป่วย:</strong> {detailModalVisit.patient_name}</div>
                <div><strong>เพศ/อายุ:</strong> {detailModalVisit.sex === '1' ? 'ชาย' : 'หญิง'} {detailModalVisit.age_y} ปี</div>
                <div><strong>HN:</strong> {detailModalVisit.hn} | <strong>VN:</strong> {detailModalVisit.vn}</div>
                <div><strong>วันที่รับบริการ:</strong> {detailModalVisit.service_date} ({detailModalVisit.service_time})</div>
                <div><strong>สิทธิการรักษา:</strong> {detailModalVisit.pttype_name} ({detailModalVisit.pttype_group})</div>
                <div><strong>แผนก:</strong> {detailModalVisit.department}</div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#1e293b' }}>รายการวินิจฉัยโรค (ovstdiag)</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>รหัส ICD-10</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>ประเภท</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>ชื่อโรค</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailModalVisit.diagnoses.map((d, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>{d.code}</td>
                        <td style={{ padding: '6px 8px' }}>{d.diagtype === '1' ? 'โรคหลัก (PDX)' : `โรครอง (${d.diagtype})`}</td>
                        <td style={{ padding: '6px 8px' }}>{d.name || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#1e293b' }}>หัตถการทันตกรรม (dtmain / doctor_operation)</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>รหัสหัตถการ</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>ซี่ฟัน</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>ชื่อหัตถการ</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>ประเภท</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailModalVisit.procedures.map((p, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>{p.code}</td>
                        <td style={{ padding: '6px 8px' }}>{p.tooth || '-'}</td>
                        <td style={{ padding: '6px 8px' }}>{p.name || '-'}</td>
                        <td style={{ padding: '6px 8px' }}>{p.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#1e293b' }}>รายการค่าบริการและยา (opitemrece)</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>รหัส</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>รายการ</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>จำนวน</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>รวมเงิน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailModalVisit.chargeItems.map((c, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{c.icode}</td>
                        <td style={{ padding: '6px 8px' }}>{c.name}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.qty}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.sum_price?.toLocaleString()} ฿</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setDetailModalVisit(null)}
                style={{ background: '#0f172a', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default DentalAuditPage;
