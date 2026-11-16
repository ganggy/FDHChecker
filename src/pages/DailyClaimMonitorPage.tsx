import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './DailyClaimMonitorPage.css';

export type MonitorClaimStage =
  | 'incomplete'
  | 'pending_close'
  | 'ready'
  | 'sent'
  | 'rep_passed'
  | 'rep_rejected'
  | 'cash_or_other';

export interface DailyClaimMonitorEncounter {
  patientType: 'OPD' | 'IPD';
  vn: string;
  an: string;
  hn: string;
  patientName: string;
  cid: string;
  serviceDate: string;
  serviceTime: string;
  pttype: string;
  pttypeName: string;
  hipdataCode: string;
  fundGroup: 'UCS' | 'OFC' | 'SSS' | 'LGO' | 'OTHER';
  fundLabel: string;
  departmentCode: string;
  departmentName: string;
  income: number;
  paidMoney: number;
  claimableAmount: number;
  diagCount: number;
  mainDiagCount: number;
  chargeCount: number;
  hasCloseCode: boolean;
  closeStatus: string;
  fdhStatus: string;
  fdhMessage: string;
  repStatus: string;
  repPaidAmount: number;
  stage: MonitorClaimStage;
  stageLabel: string;
  issues: string[];
}

export interface DailyClaimFundSummary {
  fundGroup: string;
  fundLabel: string;
  totalCount: number;
  totalIncome: number;
  incompleteCount: number;
  pendingCloseCount: number;
  readyCount: number;
  sentCount: number;
  repPassedCount: number;
  repRejectedCount: number;
  repPaidAmount: number;
}

export interface DailyClaimDepartmentSummary {
  departmentCode: string;
  departmentName: string;
  totalCount: number;
  totalIncome: number;
  incompleteCount: number;
  pendingCloseCount: number;
  readyCount: number;
  sentOrPassedCount: number;
}

export interface DailyClaimTrendRow {
  date: string;
  totalCount: number;
  opdCount: number;
  ipdCount: number;
  totalIncome: number;
  closedCount: number;
  readyCount: number;
  sentOrPassedCount: number;
  incompleteCount: number;
  repPaidAmount: number;
}

export interface DailyClaimMonitorSummary {
  totalCount: number;
  opdCount: number;
  ipdCount: number;
  totalIncome: number;
  totalClaimable: number;
  totalRepPaid: number;
  closedCount: number;
  pendingCloseCount: number;
  incompleteCount: number;
  readyCount: number;
  sentCount: number;
  repPassedCount: number;
  repRejectedCount: number;
  cashOrOtherCount: number;
  closeRatePct: number;
}

export interface DailyClaimMonitorResponse {
  period: { startDate: string; endDate: string };
  generatedAt: string;
  summary: DailyClaimMonitorSummary;
  fundBreakdown: DailyClaimFundSummary[];
  departmentBreakdown: DailyClaimDepartmentSummary[];
  dailyTrend: DailyClaimTrendRow[];
  encounters: DailyClaimMonitorEncounter[];
}

function getLocalTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftIsoDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatCurrency(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '0.00 ฿';
  return val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ฿';
}

function formatNumber(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '0';
  return val.toLocaleString('th-TH');
}

export const DailyClaimMonitorPage: React.FC = () => {
  const todayIso = useMemo(() => getLocalTodayIso(), []);
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [fund, setFund] = useState<string>('ALL');
  const [patientType, setPatientType] = useState<string>('ALL');

  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'encounters' | 'funds' | 'departments' | 'history'>('encounters');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DailyClaimMonitorResponse | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        fund,
        patientType,
      });
      const res = await fetch(`/api/daily-claim-monitor/overview?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `เกิดข้อผิดพลาด (${res.status})`);
      }
      setData(json.data);
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถโหลดข้อมูลมอนิเตอร์งานเคลมได้');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, fund, patientType]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  // Auto refresh every 60s when enabled and viewing today
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void fetchOverview();
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchOverview]);

  const handleQuickPreset = (preset: 'today' | 'yesterday' | 'last7' | 'thisMonth') => {
    const t = getLocalTodayIso();
    if (preset === 'today') {
      setStartDate(t);
      setEndDate(t);
    } else if (preset === 'yesterday') {
      const y = shiftIsoDate(t, -1);
      setStartDate(y);
      setEndDate(y);
    } else if (preset === 'last7') {
      setStartDate(shiftIsoDate(t, -6));
      setEndDate(t);
    } else if (preset === 'thisMonth') {
      const [yy, mm] = t.split('-');
      setStartDate(`${yy}-${mm}-01`);
      setEndDate(t);
    }
  };

  const handleStepDay = (delta: number) => {
    const next = shiftIsoDate(startDate, delta);
    setStartDate(next);
    setEndDate(next);
  };

  const filteredEncounters = useMemo(() => {
    if (!data?.encounters) return [];
    return data.encounters.filter((enc) => {
      if (stageFilter !== 'ALL') {
        if (stageFilter === 'needs_action') {
          if (!['incomplete', 'pending_close', 'rep_rejected'].includes(enc.stage)) return false;
        } else if (enc.stage !== stageFilter) {
          return false;
        }
      }
      if (deptFilter !== 'ALL' && (enc.departmentCode || enc.departmentName) !== deptFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const hit =
          enc.hn.toLowerCase().includes(q) ||
          enc.vn.toLowerCase().includes(q) ||
          enc.an.toLowerCase().includes(q) ||
          enc.patientName.toLowerCase().includes(q) ||
          enc.pttypeName.toLowerCase().includes(q) ||
          enc.issues.some((i) => i.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [data?.encounters, stageFilter, deptFilter, searchTerm]);

  const handleExportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    const summarySheet = [
      ['รายงานมอนิเตอร์งานเคลมรายวัน & ย้อนหลัง'],
      ['ช่วงวันที่', `${data.period.startDate} ถึง ${data.period.endDate}`],
      ['อัปเดตล่าสุด', new Date(data.generatedAt).toLocaleString('th-TH')],
      [''],
      ['รายการสรุป', 'จำนวน (เคส)', 'หมายเหตุ'],
      ['ผู้รับบริการทั้งหมด', data.summary.totalCount, `OPD: ${data.summary.opdCount} / IPD: ${data.summary.ipdCount}`],
      ['ยอดค่ารักษาทั้งหมด (บาท)', data.summary.totalIncome, ''],
      ['ยอดที่เบิกได้ประมาณการ (บาท)', data.summary.totalClaimable, ''],
      ['ยอดชดเชยจาก REP/STM (บาท)', data.summary.totalRepPaid, ''],
      ['อัตราปิดสิทธิ์ NHSO (%)', data.summary.closeRatePct, `ปิดสิทธิ์แล้ว ${data.summary.closedCount} เคส`],
      ['รอปิดสิทธิ์ NHSO', data.summary.pendingCloseCount, ''],
      ['ข้อมูลไม่ครบ / ติด Error', data.summary.incompleteCount, ''],
      ['พร้อมส่งเคลม', data.summary.readyCount, ''],
      ['ส่งเคลมแล้ว (FDH)', data.summary.sentCount, ''],
      ['ผ่าน REP / ชดเชยแล้ว', data.summary.repPassedCount, ''],
      ['ติด C / ปฏิเสธจ่าย', data.summary.repRejectedCount, ''],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summarySheet), 'สรุปภาพรวม');

    const encRows = [
      [
        'ประเภท', 'วันที่รับบริการ', 'เวลา', 'VN', 'AN', 'HN', 'ชื่อ-สกุล',
        'สิทธิ', 'กองทุน', 'จุดบริการ/แผนก', 'ยอดค่ารักษา', 'ชำระเอง', 'ยอดเบิกได้',
        'ปิดสิทธิ์ EP', 'สถานะ FDH', 'สถานะ REP', 'ชดเชย REP', 'สถานะงานเคลม', 'ปัญหาที่ต้องแก้ไข'
      ],
      ...filteredEncounters.map((e) => [
        e.patientType, e.serviceDate, e.serviceTime, e.vn, e.an || '-', e.hn, e.patientName,
        `${e.pttype} - ${e.pttypeName}`, e.fundLabel, e.departmentName, e.income, e.paidMoney, e.claimableAmount,
        e.hasCloseCode ? 'ปิดแล้ว' : 'ยังไม่ปิด', e.fdhStatus || '-', e.repStatus || '-', e.repPaidAmount,
        e.stageLabel, e.issues.join(', ') || '-'
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(encRows), 'รายเคส');

    if (data.dailyTrend.length > 0) {
      const trendRows = [
        ['วันที่', 'เคสทั้งหมด', 'OPD', 'IPD', 'ยอดค่ารักษา', 'ปิดสิทธิ์แล้ว', 'พร้อมส่ง', 'ส่งแล้ว/ผ่าน REP', 'รอแก้ไข/รอปิดสิทธิ์', 'ชดเชย REP'],
        ...data.dailyTrend.map((t) => [
          t.date, t.totalCount, t.opdCount, t.ipdCount, t.totalIncome, t.closedCount,
          t.readyCount, t.sentOrPassedCount, t.incompleteCount, t.repPaidAmount
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trendRows), 'เปรียบเทียบรายวัน');
    }

    XLSX.writeFile(wb, `DailyClaimMonitor_${data.period.startDate}_${data.period.endDate}.xlsx`);
  };

  const isSingleDay = startDate === endDate;

  return (
    <div className="dcm-page">
      {/* Header */}
      <div className="dcm-header">
        <div>
          <h2>📡 มอนิเตอร์งานเคลมรายวัน & ย้อนหลัง</h2>
          <p className="dcm-subtitle">
            ติดตามสถานะงานเคลมทั้งหมด (OPD & IPD) ตั้งแต่ลงตรวจ ปิดสิทธิ์ ความสมบูรณ์ข้อมูล ส่งเคลม FDH จนถึงผลตอบรับ REP/STM แบบเรียลไทม์และย้อนหลัง
          </p>
        </div>
        <div className="dcm-header-actions">
          <label className="dcm-autorefresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>🔄 รีเฟรชอัตโนมัติ (1 นาที)</span>
          </label>
          <button type="button" className="dcm-btn-excel" onClick={handleExportExcel} disabled={!data || loading}>
            📊 ส่งออก Excel
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="dcm-controls-card">
        <div className="dcm-date-nav">
          <button type="button" className="dcm-step-btn" onClick={() => handleStepDay(-1)} title="วันก่อนหน้า">
            ◀ วันก่อนหน้า
          </button>
          <div className="dcm-date-inputs">
            <label>
              <span>ตั้งแต่:</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              <span>ถึง:</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="dcm-step-btn"
            onClick={() => handleStepDay(1)}
            disabled={isSingleDay && startDate >= todayIso}
            title="วันถัดไป"
          >
            วันถัดไป ▶
          </button>

          <div className="dcm-quick-presets">
            <button
              type="button"
              className={startDate === todayIso && endDate === todayIso ? 'active' : ''}
              onClick={() => handleQuickPreset('today')}
            >
              วันนี้
            </button>
            <button
              type="button"
              className={startDate === shiftIsoDate(todayIso, -1) && endDate === shiftIsoDate(todayIso, -1) ? 'active' : ''}
              onClick={() => handleQuickPreset('yesterday')}
            >
              เมื่อวาน
            </button>
            <button type="button" onClick={() => handleQuickPreset('last7')}>
              7 วันล่าสุด
            </button>
            <button type="button" onClick={() => handleQuickPreset('thisMonth')}>
              เดือนนี้
            </button>
          </div>
        </div>

        <div className="dcm-filters-row">
          <div className="dcm-filter-item">
            <label>ประเภทผู้ป่วย:</label>
            <select value={patientType} onChange={(e) => setPatientType(e.target.value)}>
              <option value="ALL">ทั้งหมด (OPD + IPD)</option>
              <option value="OPD">เฉพาะผู้ป่วยนอก (OPD)</option>
              <option value="IPD">เฉพาะผู้ป่วยใน (IPD)</option>
            </select>
          </div>

          <div className="dcm-filter-item">
            <label>กองทุนสิทธิ:</label>
            <select value={fund} onChange={(e) => setFund(e.target.value)}>
              <option value="ALL">ทุกกองทุนสิทธิ</option>
              <option value="UCS">บัตรทอง (UCS)</option>
              <option value="OFC">ข้าราชการ (OFC)</option>
              <option value="SSS">ประกันสังคม (SSS)</option>
              <option value="LGO">อปท. (LGO)</option>
              <option value="OTHER">ชำระเงิน / อื่นๆ</option>
            </select>
          </div>

          <button type="button" className="dcm-btn-refresh" onClick={() => void fetchOverview()} disabled={loading}>
            {loading ? '⏳ กำลังโหลด...' : '🔍 ดึงข้อมูลล่าสุด'}
          </button>

          {data && (
            <span className="dcm-last-updated">
              อัปเดตเมื่อ: {new Date(data.generatedAt).toLocaleTimeString('th-TH')}
            </span>
          )}
        </div>
      </div>

      {error && <div className="dcm-alert-error">{error}</div>}

      {/* KPI Cards */}
      {data && (
        <>
          <div className="dcm-kpi-grid">
            <div className="dcm-kpi-card kpi-total" onClick={() => { setActiveTab('encounters'); setStageFilter('ALL'); }}>
              <div className="kpi-top">
                <span className="kpi-title">ผู้รับบริการทั้งหมด</span>
                <span className="kpi-icon">👥</span>
              </div>
              <div className="kpi-num">{formatNumber(data.summary.totalCount)} <small>เคส</small></div>
              <div className="kpi-sub">
                OPD: <strong>{formatNumber(data.summary.opdCount)}</strong> | IPD: <strong>{formatNumber(data.summary.ipdCount)}</strong>
              </div>
            </div>

            <div className="dcm-kpi-card kpi-close" onClick={() => { setActiveTab('encounters'); setStageFilter('pending_close'); }}>
              <div className="kpi-top">
                <span className="kpi-title">ปิดสิทธิ์ NHSO (EP)</span>
                <span className="kpi-icon">🪪</span>
              </div>
              <div className="kpi-num">{data.summary.closeRatePct.toFixed(1)}%</div>
              <div className="kpi-sub">
                ปิดแล้ว: <strong>{formatNumber(data.summary.closedCount)}</strong> | รอปิด: <strong className="text-warn">{formatNumber(data.summary.pendingCloseCount)}</strong>
              </div>
            </div>

            <div className="dcm-kpi-card kpi-error" onClick={() => { setActiveTab('encounters'); setStageFilter('needs_action'); }}>
              <div className="kpi-top">
                <span className="kpi-title">ติดปัญหา / ต้องแก้ไข</span>
                <span className="kpi-icon">⚠️</span>
              </div>
              <div className="kpi-num text-danger">
                {formatNumber(data.summary.incompleteCount + data.summary.repRejectedCount)} <small>เคส</small>
              </div>
              <div className="kpi-sub">
                ข้อมูลไม่ครบ: <strong>{data.summary.incompleteCount}</strong> | ติด C/Reject: <strong>{data.summary.repRejectedCount}</strong>
              </div>
            </div>

            <div className="dcm-kpi-card kpi-ready" onClick={() => { setActiveTab('encounters'); setStageFilter('ready'); }}>
              <div className="kpi-top">
                <span className="kpi-title">พร้อมส่งเคลม</span>
                <span className="kpi-icon">✅</span>
              </div>
              <div className="kpi-num text-primary">{formatNumber(data.summary.readyCount)} <small>เคส</small></div>
              <div className="kpi-sub">ข้อมูล Diag/Charge/ปิดสิทธิ์ ครบถ้วน</div>
            </div>

            <div className="dcm-kpi-card kpi-sent" onClick={() => { setActiveTab('encounters'); setStageFilter('sent'); }}>
              <div className="kpi-top">
                <span className="kpi-title">ส่งเคลมแล้ว / ผ่าน REP</span>
                <span className="kpi-icon">🚀</span>
              </div>
              <div className="kpi-num text-success">
                {formatNumber(data.summary.sentCount + data.summary.repPassedCount)} <small>เคส</small>
              </div>
              <div className="kpi-sub">
                ส่ง FDH: <strong>{data.summary.sentCount}</strong> | ผ่าน REP: <strong>{data.summary.repPassedCount}</strong>
              </div>
            </div>

            <div className="dcm-kpi-card kpi-money">
              <div className="kpi-top">
                <span className="kpi-title">ยอดค่ารักษา / ชดเชย REP</span>
                <span className="kpi-icon">💰</span>
              </div>
              <div className="kpi-num">{formatCurrency(data.summary.totalIncome)}</div>
              <div className="kpi-sub">
                ชดเชยแล้ว (REP): <strong className="text-success">{formatCurrency(data.summary.totalRepPaid)}</strong>
              </div>
            </div>
          </div>

          {/* Pipeline Progress Bar */}
          {data.summary.totalCount > 0 && (
            <div className="dcm-pipeline-card">
              <div className="dcm-pipeline-header">
                <strong>สัดส่วนความคืบหน้าสายพานงานเคลม ({data.period.startDate === data.period.endDate ? `วันที่ ${data.period.startDate}` : `${data.period.startDate} ถึง ${data.period.endDate}`})</strong>
                <span>คลิกที่แถบสถานะเพื่อกรองดูรายเคส</span>
              </div>
              <div className="dcm-pipeline-bar">
                {[
                  { key: 'rep_passed', label: 'ผ่าน REP', count: data.summary.repPassedCount, color: '#10b981' },
                  { key: 'sent', label: 'ส่ง FDH แล้ว', count: data.summary.sentCount, color: '#3b82f6' },
                  { key: 'ready', label: 'พร้อมส่งเคลม', count: data.summary.readyCount, color: '#06b6d4' },
                  { key: 'pending_close', label: 'รอปิดสิทธิ์', count: data.summary.pendingCloseCount, color: '#f59e0b' },
                  { key: 'incomplete', label: 'ข้อมูลไม่ครบ', count: data.summary.incompleteCount, color: '#ef4444' },
                  { key: 'rep_rejected', label: 'ติด C/Reject', count: data.summary.repRejectedCount, color: '#991b1b' },
                  { key: 'cash_or_other', label: 'ชำระเงิน/อื่นๆ', count: data.summary.cashOrOtherCount, color: '#94a3b8' },
                ].map((seg) => {
                  const pct = (seg.count / data.summary.totalCount) * 100;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={seg.key}
                      className="dcm-pipeline-seg"
                      style={{ width: `${pct}%`, backgroundColor: seg.color }}
                      title={`${seg.label}: ${seg.count} เคส (${pct.toFixed(1)}%)`}
                      onClick={() => { setActiveTab('encounters'); setStageFilter(seg.key); }}
                    >
                      {pct >= 7 ? `${seg.count}` : ''}
                    </div>
                  );
                })}
              </div>
              <div className="dcm-pipeline-legend">
                <span onClick={() => { setActiveTab('encounters'); setStageFilter('rep_passed'); }}><i style={{ background: '#10b981' }} /> ผ่าน REP ({data.summary.repPassedCount})</span>
                <span onClick={() => { setActiveTab('encounters'); setStageFilter('sent'); }}><i style={{ background: '#3b82f6' }} /> ส่ง FDH แล้ว ({data.summary.sentCount})</span>
                <span onClick={() => { setActiveTab('encounters'); setStageFilter('ready'); }}><i style={{ background: '#06b6d4' }} /> พร้อมส่ง ({data.summary.readyCount})</span>
                <span onClick={() => { setActiveTab('encounters'); setStageFilter('pending_close'); }}><i style={{ background: '#f59e0b' }} /> รอปิดสิทธิ์ ({data.summary.pendingCloseCount})</span>
                <span onClick={() => { setActiveTab('encounters'); setStageFilter('incomplete'); }}><i style={{ background: '#ef4444' }} /> ข้อมูลไม่ครบ ({data.summary.incompleteCount})</span>
                <span onClick={() => { setActiveTab('encounters'); setStageFilter('rep_rejected'); }}><i style={{ background: '#991b1b' }} /> ติด C/Reject ({data.summary.repRejectedCount})</span>
                <span onClick={() => { setActiveTab('encounters'); setStageFilter('cash_or_other'); }}><i style={{ background: '#94a3b8' }} /> ชำระเงิน/อื่นๆ ({data.summary.cashOrOtherCount})</span>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="dcm-tabs">
            <button
              type="button"
              className={activeTab === 'encounters' ? 'active' : ''}
              onClick={() => setActiveTab('encounters')}
            >
              📋 รายการเคสทั้งหมด ({filteredEncounters.length})
            </button>
            <button
              type="button"
              className={activeTab === 'funds' ? 'active' : ''}
              onClick={() => setActiveTab('funds')}
            >
              🛡️ แยกตามกองทุนสิทธิ ({data.fundBreakdown.length})
            </button>
            <button
              type="button"
              className={activeTab === 'departments' ? 'active' : ''}
              onClick={() => setActiveTab('departments')}
            >
              🏥 แยกตามจุดบริการ / แผนก ({data.departmentBreakdown.length})
            </button>
            <button
              type="button"
              className={activeTab === 'history' ? 'active' : ''}
              onClick={() => setActiveTab('history')}
            >
              📅 เปรียบเทียบรายวัน ({data.dailyTrend.length} วัน)
            </button>
          </div>

          {/* Tab 1: Encounters */}
          {activeTab === 'encounters' && (
            <div className="dcm-tab-pane">
              <div className="dcm-table-controls">
                <div className="dcm-search-input">
                  <span>🔎</span>
                  <input
                    type="text"
                    placeholder="ค้นหา HN, VN, AN, ชื่อ-สกุล หรือปัญหาที่พบ..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
                  <option value="ALL">ทุกสถานะ ({data.encounters.length})</option>
                  <option value="needs_action">⚠️ เฉพาะเคสที่ต้องจัดการ/แก้ไข ({data.summary.incompleteCount + data.summary.pendingCloseCount + data.summary.repRejectedCount})</option>
                  <option value="incomplete">❌ ข้อมูลไม่ครบ / Error ({data.summary.incompleteCount})</option>
                  <option value="pending_close">🪪 รอปิดสิทธิ์ NHSO ({data.summary.pendingCloseCount})</option>
                  <option value="ready">✅ พร้อมส่งเคลม ({data.summary.readyCount})</option>
                  <option value="sent">🚀 ส่งเคลมแล้ว FDH ({data.summary.sentCount})</option>
                  <option value="rep_passed">💚 ผ่าน REP / ชดเชยแล้ว ({data.summary.repPassedCount})</option>
                  <option value="rep_rejected">🔴 ติด C / ปฏิเสธจ่าย ({data.summary.repRejectedCount})</option>
                  <option value="cash_or_other">💵 ชำระเงิน / อื่นๆ ({data.summary.cashOrOtherCount})</option>
                </select>

                <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                  <option value="ALL">ทุกจุดบริการ/แผนก</option>
                  {data.departmentBreakdown.map((d) => (
                    <option key={d.departmentCode || d.departmentName} value={d.departmentCode || d.departmentName}>
                      {d.departmentName} ({d.totalCount})
                    </option>
                  ))}
                </select>
              </div>

              <div className="dcm-table-wrap">
                <table className="dcm-table">
                  <thead>
                    <tr>
                      <th>ประเภท</th>
                      <th>วัน-เวลา</th>
                      <th>VN / AN</th>
                      <th>HN / ชื่อผู้ป่วย</th>
                      <th>สิทธิ / กองทุน</th>
                      <th>แผนก / วอร์ด</th>
                      <th className="text-right">ยอดค่ารักษา</th>
                      <th className="text-center">ปิดสิทธิ์</th>
                      <th className="text-center">สถานะเคลม</th>
                      <th>รายละเอียด / สิ่งที่ต้องแก้ไข</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEncounters.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="dcm-no-data">ไม่พบรายการที่ตรงกับเงื่อนไข</td>
                      </tr>
                    ) : (
                      filteredEncounters.slice(0, 500).map((enc) => (
                        <tr key={`${enc.patientType}-${enc.an || enc.vn}`} className={`row-stage-${enc.stage}`}>
                          <td>
                            <span className={`type-badge type-${enc.patientType.toLowerCase()}`}>
                              {enc.patientType}
                            </span>
                          </td>
                          <td className="nowrap">
                            <div>{enc.serviceDate}</div>
                            <small className="text-muted">{enc.serviceTime}</small>
                          </td>
                          <td className="nowrap">
                            <code>{enc.an || enc.vn}</code>
                            {enc.an && <div><small className="text-muted">VN: {enc.vn}</small></div>}
                          </td>
                          <td>
                            <div><strong>{enc.hn}</strong></div>
                            <div>{enc.patientName}</div>
                          </td>
                          <td>
                            <div><span className={`fund-badge fund-${enc.fundGroup.toLowerCase()}`}>{enc.fundGroup}</span></div>
                            <small className="text-muted">{enc.pttype} - {enc.pttypeName}</small>
                          </td>
                          <td>{enc.departmentName}</td>
                          <td className="text-right nowrap">
                            <div><strong>{formatCurrency(enc.income)}</strong></div>
                            {enc.repPaidAmount > 0 && (
                              <small className="text-success">ชดเชย: {formatCurrency(enc.repPaidAmount)}</small>
                            )}
                          </td>
                          <td className="text-center">
                            {enc.patientType === 'IPD' || enc.fundGroup === 'SSS' || enc.fundGroup === 'OTHER' ? (
                              <span className="text-muted">-</span>
                            ) : enc.hasCloseCode ? (
                              <span className="badge-ok">✅ ปิดแล้ว</span>
                            ) : (
                              <span className="badge-warn">⏳ รอปิด</span>
                            )}
                          </td>
                          <td className="text-center">
                            <span className={`stage-pill stage-${enc.stage}`}>{enc.stageLabel}</span>
                          </td>
                          <td>
                            {enc.issues.length > 0 ? (
                              <ul className="dcm-issue-list">
                                {enc.issues.map((iss, i) => (
                                  <li key={i}>{iss}</li>
                                ))}
                              </ul>
                            ) : enc.fdhMessage ? (
                              <small className="text-muted">{enc.fdhMessage}</small>
                            ) : (
                              <span className="text-success">ครบถ้วน</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {filteredEncounters.length > 500 && (
                  <div className="dcm-limit-note">
                    แสดงสูงสุด 500 รายการแรกจากทั้งหมด {filteredEncounters.length} รายการ (สามารถใช้ช่องค้นหา หรือส่งออก Excel เพื่อดูทั้งหมดได้)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Fund Breakdown */}
          {activeTab === 'funds' && (
            <div className="dcm-tab-pane">
              <div className="dcm-table-wrap">
                <table className="dcm-table">
                  <thead>
                    <tr>
                      <th>กองทุนสิทธิ</th>
                      <th className="text-right">เคสทั้งหมด</th>
                      <th className="text-right">ยอดค่ารักษา</th>
                      <th className="text-right">ข้อมูลไม่ครบ</th>
                      <th className="text-right">รอปิดสิทธิ์</th>
                      <th className="text-right">พร้อมส่ง</th>
                      <th className="text-right">ส่ง FDH แล้ว</th>
                      <th className="text-right">ผ่าน REP</th>
                      <th className="text-right">ติด C/Reject</th>
                      <th className="text-right">ยอดชดเชย REP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fundBreakdown.map((f) => (
                      <tr key={f.fundGroup}>
                        <td>
                          <span className={`fund-badge fund-${f.fundGroup.toLowerCase()}`}>{f.fundGroup}</span>{' '}
                          <strong>{f.fundLabel}</strong>
                        </td>
                        <td className="text-right font-bold">{formatNumber(f.totalCount)}</td>
                        <td className="text-right">{formatCurrency(f.totalIncome)}</td>
                        <td className="text-right text-danger">{formatNumber(f.incompleteCount)}</td>
                        <td className="text-right text-warn">{formatNumber(f.pendingCloseCount)}</td>
                        <td className="text-right text-primary">{formatNumber(f.readyCount)}</td>
                        <td className="text-right">{formatNumber(f.sentCount)}</td>
                        <td className="text-right text-success font-bold">{formatNumber(f.repPassedCount)}</td>
                        <td className="text-right text-danger font-bold">{formatNumber(f.repRejectedCount)}</td>
                        <td className="text-right text-success font-bold">{formatCurrency(f.repPaidAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: Department Breakdown */}
          {activeTab === 'departments' && (
            <div className="dcm-tab-pane">
              <div className="dcm-table-wrap">
                <table className="dcm-table">
                  <thead>
                    <tr>
                      <th>จุดบริการ / แผนก / วอร์ด</th>
                      <th className="text-right">เคสทั้งหมด</th>
                      <th className="text-right">ยอดค่ารักษา</th>
                      <th className="text-right">ข้อมูลไม่ครบ</th>
                      <th className="text-right">รอปิดสิทธิ์</th>
                      <th className="text-right">พร้อมส่งเคลม</th>
                      <th className="text-right">ส่งแล้ว / ผ่าน REP</th>
                      <th className="text-center">ตรวจสอบรายเคส</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.departmentBreakdown.map((d) => (
                      <tr key={d.departmentCode || d.departmentName}>
                        <td><strong>{d.departmentName}</strong></td>
                        <td className="text-right font-bold">{formatNumber(d.totalCount)}</td>
                        <td className="text-right">{formatCurrency(d.totalIncome)}</td>
                        <td className="text-right text-danger font-bold">{formatNumber(d.incompleteCount)}</td>
                        <td className="text-right text-warn font-bold">{formatNumber(d.pendingCloseCount)}</td>
                        <td className="text-right text-primary">{formatNumber(d.readyCount)}</td>
                        <td className="text-right text-success">{formatNumber(d.sentOrPassedCount)}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="dcm-btn-small"
                            onClick={() => {
                              setDeptFilter(d.departmentCode || d.departmentName);
                              setStageFilter('ALL');
                              setActiveTab('encounters');
                            }}
                          >
                            ดูรายเคส ➔
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 4: Daily History Trend */}
          {activeTab === 'history' && (
            <div className="dcm-tab-pane">
              <div className="dcm-table-wrap">
                <table className="dcm-table">
                  <thead>
                    <tr>
                      <th>วันที่รับบริการ</th>
                      <th className="text-right">เคสทั้งหมด</th>
                      <th className="text-right">OPD</th>
                      <th className="text-right">IPD</th>
                      <th className="text-right">ยอดค่ารักษา</th>
                      <th className="text-right">ปิดสิทธิ์แล้ว</th>
                      <th className="text-right">พร้อมส่ง</th>
                      <th className="text-right">ส่งแล้ว / ผ่าน REP</th>
                      <th className="text-right">ค้างแก้/รอปิด</th>
                      <th className="text-right">ยอดชดเชย REP</th>
                      <th className="text-center">เจาะดูวันนี้</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyTrend.map((row) => (
                      <tr key={row.date}>
                        <td><strong>{row.date}</strong></td>
                        <td className="text-right font-bold">{formatNumber(row.totalCount)}</td>
                        <td className="text-right">{formatNumber(row.opdCount)}</td>
                        <td className="text-right">{formatNumber(row.ipdCount)}</td>
                        <td className="text-right">{formatCurrency(row.totalIncome)}</td>
                        <td className="text-right">{formatNumber(row.closedCount)}</td>
                        <td className="text-right text-primary">{formatNumber(row.readyCount)}</td>
                        <td className="text-right text-success font-bold">{formatNumber(row.sentOrPassedCount)}</td>
                        <td className="text-right text-danger">{formatNumber(row.incompleteCount)}</td>
                        <td className="text-right text-success font-bold">{formatCurrency(row.repPaidAmount)}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="dcm-btn-small"
                            onClick={() => {
                              setStartDate(row.date);
                              setEndDate(row.date);
                              setActiveTab('encounters');
                            }}
                          >
                            เปิดดูวันนี้ ➔
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DailyClaimMonitorPage;
