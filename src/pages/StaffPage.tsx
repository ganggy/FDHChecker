import React, { useState } from 'react';
import type { CheckRecord } from '../mockData';
import { useHOSxPData } from '../hooks/useHOSxPData';
import { CheckTable } from '../components/CheckTable';
import { DetailModal } from '../components/DetailModal';
import { IssuesPanel } from '../components/IssuesPanel';
import { FundSummaryBar } from '../components/FundSummaryBar';
import * as XLSX from 'xlsx';
import { evaluateBillingLogic } from '../utils/billingUtils';
import { formatLocalDateInput, formatLocalDateStamp } from '../utils/dateUtils';
import { consumeDashboardNavigation } from '../utils/navigationState';

export const StaffPage: React.FC = () => {
  const [selectedFund, setSelectedFund] = useState<string>('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'incomplete'>('all');
  const [uucFilter, setUucFilter] = useState<'all' | 'UUC1' | 'UUC2'>('all');
  const [specialFilter, setSpecialFilter] = useState<'all' | 'special_only'>('all');
  const [selectedRecord, setSelectedRecord] = useState<CheckRecord | null>(null);
  const [dashboardContextItems, setDashboardContextItems] = useState<string[]>([]);

  const todayStr = formatLocalDateInput();
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  React.useEffect(() => {
    const incoming = consumeDashboardNavigation('staff');
    if (!incoming) return;

    if (incoming.startDate) setStartDate(incoming.startDate);
    if (incoming.endDate) setEndDate(incoming.endDate);
    if (incoming.staff?.statusFilter) setStatusFilter(incoming.staff.statusFilter);
    if (incoming.staff?.uucFilter) setUucFilter(incoming.staff.uucFilter);
    if (incoming.staff?.specialFilter) setSpecialFilter(incoming.staff.specialFilter);
    if (incoming.staff?.selectedFund !== undefined) setSelectedFund(incoming.staff.selectedFund);
    if (incoming.staff?.search !== undefined) setSearch(incoming.staff.search);

    const noteParts: string[] = [];
    if (incoming.contextLabel) noteParts.push(incoming.contextLabel);
    if (incoming.startDate || incoming.endDate) {
      noteParts.push(`ช่วงวันที่ ${incoming.startDate || todayStr} ถึง ${incoming.endDate || todayStr}`);
    }
    if (incoming.staff?.statusFilter && incoming.staff.statusFilter !== 'all') {
      noteParts.push(`สถานะ ${incoming.staff.statusFilter === 'complete' ? 'พร้อมส่ง' : 'รอแก้ไข'}`);
    }
    if (incoming.staff?.uucFilter && incoming.staff.uucFilter !== 'all') {
      noteParts.push(`กลุ่ม ${incoming.staff.uucFilter}`);
    }
    if (incoming.staff?.specialFilter === 'special_only') {
      noteParts.push('เฉพาะสิทธิ์พิเศษ');
    }
    if (incoming.staff?.selectedFund) {
      noteParts.push(`สิทธิ์ ${incoming.staff.selectedFund}`);
    }
    if (incoming.staff?.search) {
      noteParts.push(`ค้นหา ${incoming.staff.search}`);
    }
    setDashboardContextItems(noteParts);
  }, [todayStr]);

  // ดึงข้อมูลทั้งหมดตามช่วงวันที่ (ไม่กรอง fund ฝั่ง server)
  const { data, totalFromDB, loading, error } = useHOSxPData({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  // สร้าง fund tabs จากข้อมูลจริงที่ดึงมาได้
  const availableFunds = React.useMemo(() => {
    const fundSet = new Set(data.map(item => item.fund).filter(Boolean));
    return Array.from(fundSet).sort();
  }, [data]);

  // กรองข้อมูล client-side
  let filtered = selectedFund ? data.filter(item => item.fund === selectedFund) : data;

  if (search) {
    filtered = filtered.filter(item =>
      item.hn.includes(search) ||
      item.patientName.toLowerCase().includes(search.toLowerCase())
    );
  }

  if (statusFilter === 'complete') {
    filtered = filtered.filter(item => item.status === 'ready');
  } else if (statusFilter === 'incomplete') {
    filtered = filtered.filter(item => item.status === 'pending');
  }

  if (uucFilter !== 'all') {
    filtered = filtered.filter(item => {
      const logic = evaluateBillingLogic(item);
      return uucFilter === 'UUC1' ? logic.isUUC1 : !logic.isUUC1;
    });
  }

  if (specialFilter === 'special_only') {
    filtered = filtered.filter(item => {
      const logic = evaluateBillingLogic(item);
      return logic.incompleteFund || logic.specialFundNotes.length > 0;
    });
  }

  // เปลี่ยนวันที่ → reset fund selection ถ้า fund นั้นไม่มีในวันใหม่
  const handleDateChange = (field: 'start' | 'end', value: string) => {
    if (field === 'start') setStartDate(value);
    else setEndDate(value);
    setSelectedFund(''); // reset fund selection เพื่อแสดงข้อมูลทั้งหมดก่อน
  };

  const completeCount = filtered.filter(r => r.status === 'ready').length;
  const incompleteCount = filtered.filter(r => r.status === 'pending').length;

  const billableValue = filtered.filter(r => (r as any).isBillable).reduce((sum, r) => sum + r.price, 0);
  const nonBillableValue = filtered.filter(r => !(r as any).isBillable).reduce((sum, r) => sum + r.price, 0);
  const totalValue = filtered.reduce((sum, r) => sum + r.price, 0);

  // Export CSV
  const handleExportCSV = () => {
    const headers = '#,VN,HN,ชื่อผู้ป่วย,สิทธิ์,ECLAIM,สถานะ FDH,วันที่รับบริการ,ประเภท,DIAG,สถานะกองทุน,สถานะข้อมูล,ราคา (บาท)';
    const rows = filtered.map((item, index) => {
      const logic = evaluateBillingLogic(item);
      const eclaimCode = String(item.pttype_eclaim_id || '').trim();
      const eclaimName = String(item.pttype_eclaim_name || '').trim();
      const eclaimLabel = eclaimCode
        ? `${eclaimCode}${eclaimName ? `: ${eclaimName}` : ''}`
        : '-';
      const fdhLabel = item.fdh_status_label
        || (item.has_close ? 'ปิดสิทธิแล้ว (EP)' : item.has_authen ? 'มี Authen (PP)' : 'ยังไม่มีสถานะ FDH');
      return [
        index + 1,
        item.vn || '-',
        item.hn,
        item.patientName,
        item.fund || item.hipdata_code,
        eclaimLabel,
        fdhLabel,
        item.serviceDate,
        item.serviceType,
        item.pdx || item.main_diag || '-',
        logic.isUUC1 ? 'UUC1' : 'UUC2',
        '-',
        item.price
      ].join(',')
    });
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fund-check-${formatLocalDateStamp()}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    const dataForExcel = filtered.map((item, index) => {
      const logic = evaluateBillingLogic(item);
      const eclaimCode = String(item.pttype_eclaim_id || '').trim();
      const eclaimName = String(item.pttype_eclaim_name || '').trim();
      const eclaimLabel = eclaimCode
        ? `${eclaimCode}${eclaimName ? `: ${eclaimName}` : ''}`
        : '-';
      const fdhLabel = item.fdh_status_label
        || (item.has_close ? 'ปิดสิทธิแล้ว (EP)' : item.has_authen ? 'มี Authen (PP)' : 'ยังไม่มีสถานะ FDH');
      return {
        '#': index + 1,
        'VN': item.vn || '-',
        'HN': item.hn,
        'ชื่อผู้ป่วย': item.patientName,
        'สิทธิ์': item.fund || item.hipdata_code,
        'ECLAIM': eclaimLabel,
        'สถานะ FDH': fdhLabel,
        'วันที่รับบริการ': item.serviceDate,
        'ประเภท': item.serviceType,
        'DIAG': item.pdx || item.main_diag || '-',
        'สถานะกองทุน': logic.isUUC1 ? 'UUC1' : 'UUC2',
        'สถานะข้อมูล': '-',
        'ราคา (บาท)': item.price
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "FDH Data");

    // Auto-size columns slightly
    const colWidths = [
      { wch: 5 }, { wch: 15 }, { wch: 12 }, { wch: 30 },
      { wch: 12 }, { wch: 24 }, { wch: 15 }, { wch: 15 },
      { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 12 }
    ];
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, `fund-check-${formatLocalDateStamp()}.xlsx`);
  };

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">📋 ตรวจสอบข้อมูลเบิกจ่าย</h1>
        <p className="page-subtitle">ตรวจสอบและแก้ไขข้อมูลการเบิกจ่ายแต่ละรายการ</p>
      </div>

      {dashboardContextItems.length > 0 && (
        <div className="dashboard-context-banner">
          <div className="dashboard-context-icon">📌</div>
          <div className="dashboard-context-content">
            <div className="dashboard-context-kicker">Dashboard Context</div>
            <div className="dashboard-context-title">รายการนี้ถูกเปิดมาจาก Executive Dashboard</div>
            <div className="dashboard-context-chips">
              {dashboardContextItems.map((item) => (
                <span key={item} className="dashboard-context-chip">{item}</span>
              ))}
            </div>
          </div>
          <button className="btn btn-secondary" onClick={() => setDashboardContextItems([])}>
            ซ่อนป้ายนี้
          </button>
        </div>
      )}

      {/* Fund Summary Bar - รายกองทุน (ด้านบน) */}
      {!loading && data.length > 0 && (
        <FundSummaryBar
          data={data}
          selectedFund={selectedFund}
          onSelectFund={setSelectedFund}
        />
      )}

      {/* Date Filter - เลือกช่วงวันก่อน */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div className="form-group">
              <label className="form-label">🔍 ค้นหา HN / ชื่อ</label>
              <input
                type="text"
                placeholder="ค้นหา..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label className="form-label">สถานะข้อมูล</label>
              <select
                className="form-control"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="all">ทั้งหมด</option>
                <option value="complete">🟢 พร้อมส่งเบิก</option>
                <option value="incomplete">🟡 ข้อมูลรอแก้ไข</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">ประเภทกองทุน (UUC)</label>
              <select
                className="form-control"
                value={uucFilter}
                onChange={(e) => setUucFilter(e.target.value as any)}
              >
                <option value="all">ทั้งหมด</option>
                <option value="UUC1">✅ UUC1 (เบิกได้)</option>
                <option value="UUC2">❌ UUC2 (ไม่เบิก)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">สิทธิ์พิเศษ</label>
              <select
                className="form-control"
                value={specialFilter}
                onChange={(e) => setSpecialFilter(e.target.value as any)}
              >
                <option value="all">ทั้งหมด</option>
                <option value="special_only">⚠️ ตรวจสอบสิทธิ์พิเศษ</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">📅 วันที่เริ่ม</label>
              <input
                type="date"
                value={startDate}
                onChange={e => handleDateChange('start', e.target.value)}
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label className="form-label">📅 วันที่สิ้นสุด</label>
              <input
                type="date"
                value={endDate}
                onChange={e => handleDateChange('end', e.target.value)}
                className="form-control"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Fund Tabs — ดึงจากข้อมูลจริง */}
      <div style={{ marginBottom: 16 }}>
        {loading ? (
          <div style={{ height: 44, background: 'var(--surface-2)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>กำลังโหลดข้อมูลกองทุน...</span>
          </div>
        ) : (
          <div className="fund-tabs">            <button
              className={`fund-tab ${selectedFund === '' ? 'active' : ''}`}
              onClick={() => setSelectedFund('')}
            >
              🏥 ทุกสิทธิ์
              <span style={{
                marginLeft: 6, fontSize: 11, fontWeight: 600,
                background: selectedFund === '' ? 'var(--primary)' : 'var(--border)',
                color: selectedFund === '' ? 'white' : 'var(--text-secondary)',
                padding: '1px 6px', borderRadius: 'var(--radius-full)'
              }}>
                {totalFromDB > 0 ? totalFromDB : data.length}
              </span>
            </button>

            {availableFunds.map(fund => {
              const count = data.filter(item => item.fund === fund).length;
              return (
                <button
                  key={fund}
                  className={`fund-tab ${selectedFund === fund ? 'active' : ''}`}
                  onClick={() => setSelectedFund(fund)}
                >
                  {fund}
                  <span style={{
                    marginLeft: 6, fontSize: 11, fontWeight: 600,
                    background: selectedFund === fund ? 'var(--primary)' : 'var(--border)',
                    color: selectedFund === fund ? 'white' : 'var(--text-secondary)',
                    padding: '1px 6px', borderRadius: 'var(--radius-full)'
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="loading-container">
          <div className="spinner" />
          <span>กำลังโหลดข้อมูล...</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {!loading && (
        <>
          {/* Issues Panel */}
          <IssuesPanel items={filtered} />          {/* Summary Stats + Export */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
              <div className="badge badge-primary">
                📋 แสดง {filtered.length} / {data.length} รายการ
                {totalFromDB > data.length && (
                  <span style={{ opacity: 0.7, marginLeft: 4 }}>(ฐานข้อมูล: {totalFromDB})</span>
                )}
                {selectedFund && <span style={{ opacity: 0.7 }}> · สิทธิ์: {selectedFund}</span>}
              </div>
              <div className="badge badge-success">✅ สมบูรณ์ {completeCount}</div>
              <div className="badge badge-danger">⚠️ ไม่สมบูรณ์ {incompleteCount}</div>
              <div className="badge" style={{ background: 'var(--success-light)', color: 'var(--success)', border: '1px solid #bbf7d0' }}>
                💰 ประสงค์เบิก {billableValue.toLocaleString()} บาท
              </div>
              <div className="badge" style={{ background: 'var(--amber-light)', color: 'var(--amber)', border: '1px solid #fde68a' }}>
                🪙 ไม่ประสงค์เบิก {nonBillableValue.toLocaleString()} บาท
              </div>
              <div className="badge" style={{ background: 'var(--teal-light)', color: 'var(--teal)', border: '1px solid #99f6e4' }}>
                🛒 รวม {totalValue.toLocaleString()} บาท
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-success" onClick={handleExportCSV}>
                📥 CSV
              </button>
              <button className="btn btn-warning" onClick={handleExportExcel}>
                📊 Excel
              </button>
            </div>
          </div>          {/* Table */}
          {filtered.length > 0 ? (            <div className="card" style={{ overflow: 'visible' }}>
              <div style={{ overflowX: 'auto' }}>
                <CheckTable items={filtered} onRowClick={setSelectedRecord} />
              </div>
            </div>
          ) : (
            <div style={{
              textAlign: 'center', padding: '48px 24px',
              background: 'var(--surface)', borderRadius: 'var(--radius-xl)',
              border: '2px dashed var(--border)',
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
              <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>ไม่พบรายการ</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {data.length === 0
                  ? 'ไม่มีข้อมูลในช่วงวันที่นี้ ลองเลือกวันที่อื่น'
                  : 'ลองปรับตัวกรองใหม่'
                }
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      <DetailModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
};
