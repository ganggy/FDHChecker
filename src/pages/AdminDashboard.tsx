import React, { useEffect, useMemo, useState } from 'react';
import { formatLocalDateInput } from '../utils/dateUtils';
import { navigateFromDashboard } from '../utils/navigationState';

interface EligibleVisit {
  vn: string;
  hn: string;
  serviceDate: string;
  fund: string;
  total_price: number;
  status: 'ready' | 'pending' | 'rejected';
  missing: string[];
  hipdata_code: string;
  isPotentialClaim?: boolean;
  isBillable?: boolean;
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  accent: string;
  icon: string;
  tone?: 'solid' | 'soft';
  actionLabel?: string;
  onAction?: () => void;
}

interface QueueCardProps {
  title: string;
  count: number;
  value: number;
  color: string;
  note: string;
  actionLabel?: string;
  onAction?: () => void;
}

const cardBase: React.CSSProperties = {
  background: 'white',
  borderRadius: 20,
  border: '1px solid #e2e8f0',
  boxShadow: '0 10px 30px rgba(15,23,42,0.05)',
};

const formatCurrency = (value: number) => `฿${value.toLocaleString()}`;

const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, accent, icon, tone = 'soft', actionLabel, onAction }) => (
  <div
    style={{
      ...cardBase,
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
      background: tone === 'solid' ? `linear-gradient(135deg, ${accent} 0%, #0f172a 160%)` : 'white',
      color: tone === 'solid' ? 'white' : '#0f172a',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: tone === 'solid' ? 'rgba(255,255,255,0.82)' : accent, marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
        <div style={{ marginTop: 10, fontSize: 13, color: tone === 'solid' ? 'rgba(255,255,255,0.76)' : '#64748b' }}>
          {subtitle}
        </div>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            style={{
              marginTop: 14,
              border: 'none',
              borderRadius: 999,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: tone === 'solid' ? 'rgba(255,255,255,0.16)' : `${accent}16`,
              color: tone === 'solid' ? 'white' : accent,
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          background: tone === 'solid' ? 'rgba(255,255,255,0.14)' : `${accent}14`,
          border: tone === 'solid' ? '1px solid rgba(255,255,255,0.14)' : `1px solid ${accent}20`,
        }}
      >
        {icon}
      </div>
    </div>
  </div>
);

const QueueCard: React.FC<QueueCardProps> = ({ title, count, value, color, note, actionLabel, onAction }) => (
  <div style={{ ...cardBase, padding: 18 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{title}</div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          padding: '4px 10px',
          borderRadius: 999,
          background: `${color}15`,
          color,
        }}
      >
        {count.toLocaleString()} เคส
      </span>
    </div>
    <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>{formatCurrency(value)}</div>
    <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>{note}</div>
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        style={{
          marginTop: 12,
          border: 'none',
          borderRadius: 999,
          padding: '8px 12px',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          background: `${color}15`,
          color,
        }}
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const AdminDashboard: React.FC = () => {
  const today = formatLocalDateInput();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<EligibleVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/hosxp/eligible-visits?startDate=${startDate}&endDate=${endDate}`);
        const result = await response.json();
        if (result.success) {
          setData(result.data);
        } else {
          setError(result.error || 'Failed to fetch data');
        }
      } catch {
        setError('Error connecting to server');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [startDate, endDate]);

  const dashboard = useMemo(() => {
    let readyBillableValue = 0;
    let pendingBillableValue = 0;
    let nonBillableValue = 0;
    let potentialClaimValue = 0;
    let readyCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;
    let potentialClaimCount = 0;

    const fundStats: Record<string, { readyValue: number; pendingValue: number; count: number }> = {};
    const issueStats: Record<string, { count: number; value: number }> = {};
    const clinicStats: Record<string, { count: number; ready: number; pending: number; value: number }> = {};
    const trendStats: Record<string, { date: string; ready: number; pending: number; nonBillable: number; total: number }> = {};

    data.forEach(item => {
      const price = Number(item.total_price) || 0;
      const fundKey = item.fund || item.hipdata_code || 'ไม่ระบุ';
      const clinicKey = (item.hipdata_code || 'UNKNOWN').trim() || 'UNKNOWN';
      const date = item.serviceDate || '-';

      if (!fundStats[fundKey]) {
        fundStats[fundKey] = { readyValue: 0, pendingValue: 0, count: 0 };
      }
      fundStats[fundKey].count += 1;

      if (!clinicStats[clinicKey]) {
        clinicStats[clinicKey] = { count: 0, ready: 0, pending: 0, value: 0 };
      }
      clinicStats[clinicKey].count += 1;
      clinicStats[clinicKey].value += price;

      if (!trendStats[date]) {
        trendStats[date] = { date, ready: 0, pending: 0, nonBillable: 0, total: 0 };
      }
      trendStats[date].total += price;

      if (item.isBillable) {
        if (item.status === 'ready') {
          readyBillableValue += price;
          readyCount += 1;
          fundStats[fundKey].readyValue += price;
          clinicStats[clinicKey].ready += 1;
          trendStats[date].ready += price;
        } else {
          pendingBillableValue += price;
          pendingCount += 1;
          fundStats[fundKey].pendingValue += price;
          clinicStats[clinicKey].pending += 1;
          trendStats[date].pending += price;

          item.missing.forEach(issue => {
            if (!issueStats[issue]) {
              issueStats[issue] = { count: 0, value: 0 };
            }
            issueStats[issue].count += 1;
            issueStats[issue].value += price;
          });
        }
      } else {
        nonBillableValue += price;
        rejectedCount += 1;
        trendStats[date].nonBillable += price;
      }

      if (item.isPotentialClaim && item.status !== 'ready') {
        potentialClaimCount += 1;
        potentialClaimValue += price;
      }
    });

    const expectedClaimValue = readyBillableValue + pendingBillableValue;
    const coverageRate = expectedClaimValue > 0 ? Math.round((readyBillableValue / expectedClaimValue) * 100) : 0;
    const leakageValue = pendingBillableValue + potentialClaimValue;
    const rejectionRate = data.length > 0 ? Math.round((rejectedCount / data.length) * 100) : 0;

    const fundRows = Object.entries(fundStats)
      .map(([label, stat]) => ({ label, ...stat, totalValue: stat.readyValue + stat.pendingValue }))
      .sort((a, b) => b.totalValue - a.totalValue);

    const issueRows = Object.entries(issueStats)
      .map(([label, stat]) => ({ label, ...stat }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const clinicRows = Object.entries(clinicStats)
      .map(([label, stat]) => ({
        label,
        ...stat,
        readyRate: stat.count > 0 ? Math.round((stat.ready / stat.count) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const trendRows = Object.values(trendStats).sort((a, b) => a.date.localeCompare(b.date));

    const queueCards = [
      {
        title: 'พร้อมส่ง FDH',
        count: readyCount,
        value: readyBillableValue,
        color: '#059669',
        note: 'เคสที่ข้อมูลพร้อม export ได้ทันที',
        actionLabel: 'เปิดหน้า FDH',
      },
      {
        title: 'รอแก้ข้อมูล',
        count: pendingCount,
        value: pendingBillableValue,
        color: '#d97706',
        note: 'เคสที่ยังเบิกได้ แต่ต้องแก้เวชระเบียน/สิทธิ์/ADP ก่อน',
        actionLabel: 'เปิดหน้า OPD',
      },
      {
        title: 'ไม่เข้าเงื่อนไขเบิก',
        count: rejectedCount,
        value: nonBillableValue,
        color: '#64748b',
        note: 'เคสที่ไม่อยู่ในกลุ่มที่ระบบนี้ตั้งใจเบิก',
        actionLabel: 'เปิดหน้า OPD',
      },
      {
        title: 'โอกาสรายได้เพิ่ม',
        count: potentialClaimCount,
        value: potentialClaimValue,
        color: '#2563eb',
        note: 'เคสกองทุนพิเศษที่ยังไม่สมบูรณ์และน่าตามต่อ',
        actionLabel: 'เปิดหน้า OPD',
      },
    ];

    const reconciliationRows = [
      {
        label: 'คาดว่าควรเบิกได้',
        value: expectedClaimValue,
        note: `${readyCount + pendingCount} รายการในกลุ่มที่ระบบมองว่าเบิกได้`,
        color: '#1d4ed8',
      },
      {
        label: 'พร้อมส่งแล้ว',
        value: readyBillableValue,
        note: `${readyCount} รายการผ่าน validation ปัจจุบัน`,
        color: '#059669',
      },
      {
        label: 'ยังไม่พร้อมส่ง',
        value: pendingBillableValue,
        note: `${pendingCount} รายการยังติดปัญหาข้อมูล`,
        color: '#d97706',
      },
      {
        label: 'ช่องว่างรายได้',
        value: leakageValue,
        note: 'มูลค่าที่ยังเสี่ยงตกหล่นถ้ายังไม่ถูกแก้',
        color: '#7c3aed',
      },
    ];

    const rejectRows = [
      {
        label: 'ไม่เข้าเงื่อนไขเบิก',
        count: rejectedCount,
        value: nonBillableValue,
        note: 'เคสที่ระบบไม่จัดอยู่ในกลุ่มประสงค์เบิก',
      },
      {
        label: 'รอแก้ก่อนส่ง',
        count: pendingCount,
        value: pendingBillableValue,
        note: 'เคสที่มีโอกาสเบิกแต่ยังไม่ผ่าน validation',
      },
    ];

    return {
      readyBillableValue,
      pendingBillableValue,
      nonBillableValue,
      expectedClaimValue,
      potentialClaimValue,
      readyCount,
      pendingCount,
      rejectedCount,
      potentialClaimCount,
      coverageRate,
      leakageValue,
      rejectionRate,
      fundRows,
      issueRows,
      clinicRows,
      trendRows,
      queueCards,
      reconciliationRows,
      rejectRows,
    };
  }, [data]);

  const maxTrendValue = Math.max(...dashboard.trendRows.map(item => item.total), 1);
  const openStaff = (overrides?: {
    statusFilter?: 'all' | 'complete' | 'incomplete';
    uucFilter?: 'all' | 'UUC1' | 'UUC2';
    specialFilter?: 'all' | 'special_only';
    selectedFund?: string;
    contextLabel?: string;
  }) => {
    navigateFromDashboard('staff', {
      source: 'dashboard',
      contextLabel: overrides?.contextLabel || 'เปิดจาก Executive Dashboard',
      startDate,
      endDate,
      staff: {
        statusFilter: overrides?.statusFilter,
        uucFilter: overrides?.uucFilter,
        specialFilter: overrides?.specialFilter,
        selectedFund: overrides?.selectedFund,
      },
    });
  };

  const openFDH = (statusFilter?: 'all' | 'ready' | 'pending') => {
    navigateFromDashboard('fdh', {
      source: 'dashboard',
      contextLabel: statusFilter === 'ready' ? 'ดูรายการพร้อมส่งจาก Executive Dashboard' : statusFilter === 'pending' ? 'ดูรายการรอแก้จาก Executive Dashboard' : 'ดูภาพรวมส่งออก FDH จาก Executive Dashboard',
      startDate,
      endDate,
      fdh: { statusFilter: statusFilter || 'all' },
    });
  };

  const openSpecific = (overrides?: {
    activeFund?: string;
    showIncompleteOnly?: boolean;
    contextLabel?: string;
  }) => {
    navigateFromDashboard('specific', {
      source: 'dashboard',
      contextLabel: overrides?.contextLabel || 'เปิดหน้ารายกองทุนพิเศษจาก Executive Dashboard',
      startDate,
      endDate,
      specific: {
        activeFund: overrides?.activeFund,
        showIncompleteOnly: overrides?.showIncompleteOnly,
      },
    });
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 30 }}>Executive Dashboard</h1>
          <p className="page-subtitle" style={{ marginTop: 6 }}>
            สรุปภาพรวมงานเบิก, รายได้ที่พร้อมส่ง, งานค้างแก้ไข และจุดเสี่ยงที่ทำให้เงินตกหล่น
          </p>
        </div>

        <div style={{ ...cardBase, padding: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="form-group">
            <label className="form-label">จากวันที่</label>
            <input type="date" className="form-control" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">ถึงวันที่</label>
            <input type="date" className="form-control" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-container" style={{ minHeight: 320 }}>
          <div className="spinner" />
          <span>กำลังสรุปข้อมูล dashboard...</span>
        </div>
      ) : error ? (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 18, marginBottom: 24 }}>
            <MetricCard
              title="มูลค่าที่ควรเบิก"
              value={formatCurrency(dashboard.expectedClaimValue)}
              subtitle={`รวมเคสที่พร้อมส่งและยังรอแก้ ${dashboard.readyCount + dashboard.pendingCount} รายการ`}
              accent="#1d4ed8"
              icon="💳"
              tone="solid"
              actionLabel="เปิดหน้า FDH ทั้งหมด"
              onAction={() => openFDH('all')}
            />
            <MetricCard
              title="มูลค่าพร้อมส่งแล้ว"
              value={formatCurrency(dashboard.readyBillableValue)}
              subtitle={`พร้อม export ทันที ${dashboard.readyCount.toLocaleString()} รายการ`}
              accent="#059669"
              icon="✅"
              actionLabel="ดูรายการพร้อมส่ง"
              onAction={() => openFDH('ready')}
            />
            <MetricCard
              title="มูลค่าค้างแก้ไข"
              value={formatCurrency(dashboard.pendingBillableValue)}
              subtitle={`ยังติดปัญหา ${dashboard.pendingCount.toLocaleString()} รายการ`}
              accent="#d97706"
              icon="🛠️"
              actionLabel="ไปหน้า OPD รอแก้"
              onAction={() => openStaff({ statusFilter: 'incomplete', uucFilter: 'UUC1', contextLabel: 'รายการที่ยังติดปัญหาจาก Dashboard' })}
            />
            <MetricCard
              title="รายได้เสี่ยงตกหล่น"
              value={formatCurrency(dashboard.leakageValue)}
              subtitle={`รวมงานค้างแก้และโอกาสพิเศษ ${dashboard.potentialClaimCount.toLocaleString()} รายการ`}
              accent="#7c3aed"
              icon="🚨"
              actionLabel="เปิดกองทุนพิเศษ"
              onAction={() => openSpecific({ showIncompleteOnly: true, contextLabel: 'กองทุนพิเศษที่ยังต้องติดตามจาก Dashboard' })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 24 }}>
            <div style={{ ...cardBase, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>Claim Readiness Snapshot</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                    ใช้แทนมุมมอง reconciliation เบื้องต้นจากข้อมูลในระบบปัจจุบัน
                  </div>
                </div>
                <div style={{ fontSize: 36, fontWeight: 800, color: '#0f172a' }}>{dashboard.coverageRate}%</div>
              </div>

              <div style={{ width: '100%', height: 12, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden', marginBottom: 16 }}>
                <div
                  style={{
                    width: `${dashboard.coverageRate}%`,
                    height: '100%',
                    background: dashboard.coverageRate >= 80 ? '#059669' : dashboard.coverageRate >= 50 ? '#d97706' : '#dc2626',
                    borderRadius: 999,
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div className="info-item">
                  <span className="info-label">พร้อมส่ง</span>
                  <span className="info-value">{formatCurrency(dashboard.readyBillableValue)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">รอแก้ก่อนส่ง</span>
                  <span className="info-value">{formatCurrency(dashboard.pendingBillableValue)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">ไม่เข้าเงื่อนไข</span>
                  <span className="info-value">{formatCurrency(dashboard.nonBillableValue)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">อัตราไม่เข้าเงื่อนไข</span>
                  <span className="info-value">{dashboard.rejectionRate}%</span>
                </div>
              </div>
            </div>

            <div style={{ ...cardBase, padding: 24 }}>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>Work Queue Snapshot</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dashboard.queueCards.map(queue => (
                  <QueueCard
                    key={queue.title}
                    {...queue}
                    onAction={() => {
                      if (queue.title === 'พร้อมส่ง FDH') openFDH('ready');
                      else if (queue.title === 'รอแก้ข้อมูล') openStaff({ statusFilter: 'incomplete', uucFilter: 'UUC1', contextLabel: 'รายการรอแก้ข้อมูลจาก Dashboard' });
                      else if (queue.title === 'ไม่เข้าเงื่อนไขเบิก') openStaff({ uucFilter: 'UUC2', contextLabel: 'รายการไม่เข้าเงื่อนไขเบิกจาก Dashboard' });
                      else openSpecific({ showIncompleteOnly: true, contextLabel: 'โอกาสรายได้เพิ่มจากกองทุนพิเศษ' });
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 24 }}>
            <div style={{ ...cardBase, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>Reconciliation Snapshot</div>
                <button className="btn btn-outline" onClick={() => openFDH('all')}>เปิดหน้า FDH</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {dashboard.reconciliationRows.map(row => (
                  <div key={row.label} style={{ padding: 14, borderRadius: 14, background: `${row.color}10`, border: `1px solid ${row.color}22` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, color: row.color }}>{row.label}</div>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{formatCurrency(row.value)}</div>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{row.note}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...cardBase, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>Reject Snapshot</div>
                <button className="btn btn-outline" onClick={() => openStaff({ uucFilter: 'UUC2' })}>เปิดหน้า OPD</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {dashboard.rejectRows.map(row => (
                  <div key={row.label} style={{ padding: 14, borderRadius: 14, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                      <div style={{ fontWeight: 700 }}>{row.label}</div>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{row.count} เคส</div>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{row.note}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{formatCurrency(row.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ ...cardBase, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>Revenue Trend</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  แนวโน้มรายวันของเคสพร้อมส่ง, งานค้างแก้ และมูลค่าที่ไม่เข้าเงื่อนไข
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#475569' }}>
                <span><span style={{ color: '#059669', fontWeight: 700 }}>พร้อมส่ง</span> เขียว</span>
                <span><span style={{ color: '#d97706', fontWeight: 700 }}>รอแก้</span> ส้ม</span>
                <span><span style={{ color: '#94a3b8', fontWeight: 700 }}>ไม่เข้าเงื่อนไข</span> เทา</span>
              </div>
            </div>

            {dashboard.trendRows.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 230, overflowX: 'auto', paddingBottom: 12 }}>
                {dashboard.trendRows.map(item => {
                  const readyHeight = (item.ready / maxTrendValue) * 160;
                  const pendingHeight = (item.pending / maxTrendValue) * 160;
                  const rejectedHeight = (item.nonBillable / maxTrendValue) * 160;

                  return (
                    <div key={item.date} style={{ minWidth: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{(item.total / 1000).toFixed(0)}k</div>
                      <div style={{ height: 160, width: 48, display: 'flex', flexDirection: 'column-reverse', background: '#f1f5f9', borderRadius: 10, overflow: 'hidden' }}>
                        <div style={{ height: rejectedHeight, background: '#cbd5e1' }} />
                        <div style={{ height: pendingHeight, background: '#f59e0b' }} />
                        <div style={{ height: readyHeight, background: '#10b981' }} />
                      </div>
                      <div style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>{item.date.split('-').slice(1).join('/')}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>ไม่มีข้อมูลในช่วงวันที่เลือก</div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 24 }}>
            <div style={{ ...cardBase, padding: 24 }}>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18 }}>Top จุดคอขวดที่ทำให้เบิกไม่ได้</div>
                {dashboard.issueRows.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {dashboard.issueRows.map(issue => (
                    <div key={issue.label} style={{ padding: 14, borderRadius: 14, background: '#fff7ed', border: '1px solid #fed7aa' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <div style={{ fontWeight: 700, color: '#9a3412' }}>{issue.label}</div>
                        <div style={{ fontWeight: 800, color: '#c2410c' }}>{issue.count} เคส</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#7c2d12' }}>มูลค่าที่ค้างเพราะปัญหานี้ {formatCurrency(issue.value)}</div>
                      <button
                        onClick={() => openStaff({ statusFilter: 'incomplete', uucFilter: 'UUC1', contextLabel: `ติดตามปัญหา ${issue.label} จาก Dashboard` })}
                        style={{
                          marginTop: 10,
                          border: 'none',
                          borderRadius: 999,
                          padding: '6px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          background: '#fed7aa',
                          color: '#9a3412',
                        }}
                      >
                        ดูรายการที่ต้องแก้
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 36, textAlign: 'center', color: '#94a3b8' }}>ไม่มีปัญหาค้างในช่วงนี้</div>
              )}
            </div>

            <div style={{ ...cardBase, padding: 24 }}>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18 }}>มูลค่ารอเบิกแยกตามสิทธิ</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {dashboard.fundRows.map(fund => {
                  const total = fund.totalValue || 1;
                  const readyRate = Math.round((fund.readyValue / total) * 100);
                  return (
                    <div key={fund.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <div style={{ fontWeight: 700 }}>{fund.label}</div>
                        <div style={{ fontWeight: 800 }}>{formatCurrency(fund.totalValue)}</div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                        <span>{fund.count} รายการ</span>
                        <span>พร้อมส่ง {readyRate}%</span>
                      </div>
                      <div style={{ width: '100%', height: 8, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: `${(fund.readyValue / total) * 100}%`, background: '#10b981' }} />
                        <div style={{ width: `${(fund.pendingValue / total) * 100}%`, background: '#f59e0b' }} />
                      </div>
                      <button
                        onClick={() => openStaff({ selectedFund: fund.label, contextLabel: `เจาะสิทธิ์ ${fund.label} จาก Dashboard` })}
                        style={{
                          marginTop: 8,
                          border: 'none',
                          borderRadius: 999,
                          padding: '6px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          background: '#dbeafe',
                          color: '#1d4ed8',
                        }}
                      >
                        เปิดรายการสิทธิ์นี้
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ ...cardBase, padding: 24 }}>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18 }}>กลุ่มสิทธิ์ที่ควรเฝ้าระวัง</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {dashboard.clinicRows.map(row => (
                  <div key={row.label} style={{ padding: 14, borderRadius: 14, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{row.label}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{row.count} รายการ</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800 }}>{formatCurrency(row.value)}</div>
                        <div style={{ fontSize: 12, color: row.readyRate >= 80 ? '#059669' : row.readyRate >= 50 ? '#d97706' : '#dc2626' }}>
                          พร้อมส่ง {row.readyRate}%
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      พร้อมส่ง {row.ready} เคส, รอแก้ {row.pending} เคส
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
