import React, { useState, useEffect } from 'react';
import { FundEligibilityRules } from '../components/FundEligibilityRules';
import * as XLSX from 'xlsx';
import { evaluateBillingLogic } from '../utils/billingUtils';
import { FDHPreviewModal } from '../components/FDHPreviewModal';
import { formatLocalDateInput, formatLocalDateStamp } from '../utils/dateUtils';
import { consumeDashboardNavigation } from '../utils/navigationState';

interface EligibleVisit {
    vn: string;
    hn: string;
    serviceDate: string;
    patientName: string;
    cid: string;
    fund: string;
    has_cid: number;
    has_diagnosis: number;
    has_receipt: number;
    has_authen: number;
    has_close?: number;
    authen_code?: string;
    close_code?: string;
    main_diag: string | null;
    total_price: number;
    project_code: string;
    status: 'ready' | 'pending' | 'rejected';
    missing: string[];
    _dataSource: string;
    hipdata_code: string;
    has_telmed: number;
    has_drugp: number;
    has_anc_diag: number;
    has_anc_adp: number;
    has_cx_diag: number;
    has_cx_adp: number;
    has_fp_diag: number;
    has_fp_adp: number;
    has_pp_diag: number;
    has_pp_adp: number;
    has_preg_lab: number;
    has_preg_item: number;
    has_instrument: number;
    has_herb: number;
    has_knee_oper: number;
    has_pal_diag: number;
    has_pal_adp: number;
    age_y: number;
}

export const FDHCheckerPage: React.FC = () => {
    const [data, setData] = useState<EligibleVisit[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'pending'>('all');
    const [dashboardContextItems, setDashboardContextItems] = useState<string[]>([]);
    const [selectedVns, setSelectedVns] = useState<string[]>([]);
    const [exporting, setExporting] = useState(false);
    const [previewData, setPreviewData] = useState<any>(null);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);

    const todayStr = formatLocalDateInput();
    const [startDate, setStartDate] = useState(todayStr);
    const [endDate, setEndDate] = useState(todayStr);

    const fetchEligibleData = async (dateRange?: { startDate?: string; endDate?: string }) => {
        const rangeStart = dateRange?.startDate ?? startDate;
        const rangeEnd = dateRange?.endDate ?? endDate;
        setLoading(true);
        setError(null);
        setSelectedVns([]); // Clear selection on refresh
        try {
            const response = await fetch(`/api/hosxp/eligible-visits?startDate=${rangeStart}&endDate=${rangeEnd}`);
            const result = await response.json();
            if (result.success) {
                setData(result.data);
            } else {
                setError(result.error || 'Failed to fetch data');
            }
        } catch (err) {
            setError('Error connecting to server');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const incoming = consumeDashboardNavigation('fdh');
        if (incoming?.startDate) setStartDate(incoming.startDate);
        if (incoming?.endDate) setEndDate(incoming.endDate);
        if (incoming?.fdh?.statusFilter) setStatusFilter(incoming.fdh.statusFilter);

        if (incoming) {
            const noteParts: string[] = [];
            if (incoming.contextLabel) noteParts.push(incoming.contextLabel);
            noteParts.push(`ช่วงวันที่ ${incoming?.startDate ?? todayStr} ถึง ${incoming?.endDate ?? todayStr}`);
            if (incoming?.fdh?.statusFilter && incoming.fdh.statusFilter !== 'all') {
                noteParts.push(`สถานะ ${incoming.fdh.statusFilter === 'ready' ? 'พร้อมส่ง' : 'รอแก้ไข'}`);
            }
            setDashboardContextItems(noteParts);
        }

        fetchEligibleData({
            startDate: incoming?.startDate ?? todayStr,
            endDate: incoming?.endDate ?? todayStr,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const filtered = data.filter(item => {
        if (statusFilter === 'ready') return item.status === 'ready';
        if (statusFilter === 'pending') return item.status === 'pending';
        return true;
    });

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            // Select only those that are ready
            const readyVns = filtered.filter(i => i.status === 'ready').map(i => i.vn);
            setSelectedVns(readyVns);
        } else {
            setSelectedVns([]);
        }
    };

    const handleSelect = (vn: string) => {
        setSelectedVns(prev =>
            prev.includes(vn) ? prev.filter(v => v !== vn) : [...prev, vn]
        );
    };

    const handlePreviewData = async () => {
        const vnsToPreview = selectedVns.length > 0
            ? selectedVns
            : filtered.filter(i => i.status === 'ready').map(i => i.vn).filter(Boolean);

        if (vnsToPreview.length === 0) return alert('ไม่มีรายการพร้อมส่ง (Ready) สำหรับดูข้อมูล');

        setIsLoadingPreview(true);
        try {
            const response = await fetch('/api/fdh/view-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vns: vnsToPreview })
            });

            const result = await response.json();
            if (result.success) {
                setPreviewData(result.data);
                setIsPreviewOpen(true);
            } else {
                alert(`Error: ${result.error || 'Failed to fetch preview data'}`);
            }
        } catch (err) {
            alert('Error connecting to server for preview');
        } finally {
            setIsLoadingPreview(false);
        }
    };

    const handleExportCSV = () => {
        const headers = '#,VN,HN,ชื่อผู้ป่วย,สิทธิ์,วันที่รับบริการ,ประเภท,DIAG,สถานะกองทุน,สถานะข้อมูล,ราคา (บาท)';
        const rows = filtered.map((item, index) => {
            const logic = evaluateBillingLogic(item);
            return [
                index + 1,
                item.vn,
                item.hn,
                item.patientName,
                item.fund || item.hipdata_code,
                item.serviceDate,
                'ผู้ป่วยนอก', // FDH Checker logic usually targets OPD for now or use item._dataSource
                item.main_diag || '-',
                logic.isUUC1 ? 'UUC1' : 'UUC2',
                item.status === 'ready' ? 'พร้อมส่ง (ปิดสิทธิแล้ว)' : 'รอแก้ไข/รอปิดสิทธิ',
                item.total_price
            ].join(',')
        });
        const csv = [headers, ...rows].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `fdh-check-${formatLocalDateStamp()}.csv`;
        link.click();
    };

    const handleExportExcel = () => {
        const dataForExcel = filtered.map((item, index) => {
            const logic = evaluateBillingLogic(item);
            return {
                '#': index + 1,
                'VN': item.vn,
                'HN': item.hn,
                'ชื่อผู้ป่วย': item.patientName,
                'สิทธิ์': item.fund || item.hipdata_code,
                'วันที่รับบริการ': item.serviceDate,
                'ประเภท': 'ผู้ป่วยนอก',
                'DIAG': item.main_diag || '-',
                'สถานะกองทุน': logic.isUUC1 ? 'UUC1' : 'UUC2',
                'สถานะข้อมูล': item.status === 'ready' ? 'พร้อมส่ง (ปิดสิทธิแล้ว)' : 'รอแก้ไข/รอปิดสิทธิ',
                'ราคา (บาท)': item.total_price
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "FDH Data");

        const colWidths = [
            { wch: 5 }, { wch: 15 }, { wch: 12 }, { wch: 30 },
            { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 10 },
            { wch: 15 }, { wch: 12 }, { wch: 12 }
        ];
        worksheet['!cols'] = colWidths;

        XLSX.writeFile(workbook, `fdh-check-${formatLocalDateStamp()}.xlsx`);
    };

    const handleExportZip = async () => {
        // If no rows selected, export all ready records in current filtered view
        const vnsToExport = selectedVns.length > 0
            ? selectedVns
            : filtered.filter(i => i.status === 'ready').map(i => i.vn).filter(Boolean);

        if (vnsToExport.length === 0) return alert('ไม่มีรายการพร้อมส่ง (Ready) สำหรับส่งออก');

        setExporting(true);
        try {
            const response = await fetch('/api/fdh/export-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vns: vnsToExport })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `FDH_16Folder_Export_${formatLocalDateStamp()}.zip`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            } else {
                const result = await response.json();
                alert(`Error: ${result.error || 'Export failed'}`);
            }
        } catch (err) {
            alert('Error connecting to server for export');
        } finally {
            setExporting(false);
        }
    };

    const readyCount = data.filter(i => i.status === 'ready').length;
    const pendingCount = data.filter(i => i.status === 'pending').length;



    return (
        <div className="page-container">
            <div className="page-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 className="page-title">🔍 ตรวจสอบสิทธิเบิก FDH</h1>
                        <p className="page-subtitle">เช็คความพร้อมของ Visit ว่ามีข้อมูลครบถ้วนสำหรับส่งเบิก 16 แฟ้ม หรือไม่</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-success" onClick={handleExportCSV}>📥 CSV</button>
                        <button className="btn btn-warning" onClick={handleExportExcel}>📊 Excel</button>
                        <button
                            className="btn btn-info"
                            onClick={handlePreviewData}
                            disabled={isLoadingPreview || data.length === 0}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                background: '#0ea5e9',
                                color: 'white',
                                fontWeight: 600
                            }}
                        >
                            {isLoadingPreview ? '⏳ กำลังโหลด...' : '🔍 ตรวจสอบข้อมูล 16 แฟ้ม'}
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleExportZip}
                            disabled={exporting || data.length === 0}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '10px 20px',
                                fontSize: 15,
                                fontWeight: 700,
                                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)'
                            }}
                        >
                            {exporting
                                ? '⏳ กำลังสร้าง ZIP...'
                                : selectedVns.length > 0
                                    ? `📦 ส่งออก 16 แฟ้ม ZIP (${selectedVns.length} รายการ)`
                                    : `📦 ส่งออก 16 แฟ้ม ZIP (พร้อมส่งทั้งหมด)`}
                        </button>
                    </div>
                </div>
            </div>

            {dashboardContextItems.length > 0 && (
                <div className="dashboard-context-banner">
                    <div className="dashboard-context-icon">📌</div>
                    <div className="dashboard-context-content">
                        <div className="dashboard-context-kicker">Dashboard Context</div>
                        <div className="dashboard-context-title">ชุดข้อมูลนี้ถูกเปิดมาจาก Executive Dashboard</div>
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

            <FundEligibilityRules />

            <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-body" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
                        <div className="form-group">
                            <label className="form-label">🔍 สถานะความพร้อม</label>
                            <select
                                className="form-control"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                            >
                                <option value="all">ทั้งหมด ({data.length})</option>
                                <option value="ready">🟢 ข้อมูลพร้อมส่ง ({readyCount})</option>
                                <option value="pending">🟡 ข้อมูลรอแก้ไข ({pendingCount})</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">📅 วันที่เริ่ม</label>
                            <input
                                type="date"
                                className="form-control"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">📅 วันที่สิ้นสุด</label>
                            <input
                                type="date"
                                className="form-control"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>

                        <button
                            className="btn btn-primary"
                            onClick={() => fetchEligibleData()}
                            disabled={loading || exporting}
                            style={{ height: 'fit-content' }}
                        >
                            🔄 ดึงข้อมูลใหม่
                        </button>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="loading-container">
                    <div className="spinner" />
                    <span>กำลังตรวจสอบสถานะการเบิกจ่าย...</span>
                </div>
            )}

            {error && (
                <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                    <span>⚠️</span> <span>{error}</span>
                </div>
            )}

            {!loading && !error && (
                <div className="card overflow-hidden">
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table">                            <thead>
                            <tr>
                                <th style={{ width: 40, textAlign: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedVns.length > 0 && selectedVns.length === filtered.filter(i => i.status === 'ready').length}
                                        onChange={handleSelectAll}
                                        disabled={filtered.filter(i => i.status === 'ready').length === 0}
                                    />
                                </th>
                                <th style={{ width: 40 }}>#</th>
                                <th>VN / HN</th>
                                <th>ชื่อผู้ป่วย</th>
                                <th style={{ minWidth: 100 }}>📅 วันที่รับบริการ</th>
                                <th>สิทธิ์</th>
                                <th style={{ textAlign: 'center' }}>CID</th>
                                <th style={{ textAlign: 'center' }}>Diagnosis</th>
                                <th style={{ textAlign: 'center' }}>Invoice</th>
                                <th style={{ textAlign: 'center' }}>ปิดสิทธิ (EP)</th>
                                <th style={{ minWidth: 200 }}>สถานะกองทุน (สปสช.)</th>
                                <th>สถานะส่งออก / ข้อมูล</th>
                            </tr>
                        </thead>
                            <tbody>
                                {filtered.length > 0 ? (
                                    filtered.map((item, index) => {
                                        const logic = evaluateBillingLogic(item);
                                        const specialFundNotes = logic.specialFundNotes.filter((note) => !note.includes('ปิดสิทธิ'));
                                        const epNotes = logic.specialFundNotes.filter((note) => note.includes('ปิดสิทธิ'));
                                        const hasSpecialFundBlock = specialFundNotes.length > 0;
                                        const specialSummary = logic.matchedFund
                                            ? 'เข้าเงื่อนไขกองทุนพิเศษ'
                                            : logic.incompleteFund
                                                ? 'ใกล้เข้าเงื่อนไขกองทุนพิเศษ'
                                                : '';
                                        return (
                                            <tr key={item.vn} style={{
                                                opacity: logic.opacity,
                                                backgroundColor: selectedVns.includes(item.vn) ? 'rgba(16, 185, 129, 0.1)' : logic.bgStyle,
                                                borderLeft: `4px solid ${item.status === 'ready' ? 'var(--success)' :
                                                    item.status === 'pending' ? 'var(--warning)' :
                                                        'var(--danger)'
                                                    }`
                                            }}>                                                <td style={{ textAlign: 'center' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedVns.includes(item.vn)}
                                                        onChange={() => handleSelect(item.vn)}
                                                        disabled={item.status !== 'ready'}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center', opacity: 0.6, fontSize: 13 }}>{index + 1}</td>
                                                <td>
                                                    <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 13 }}>{item.vn}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>HN: {item.hn}</div>
                                                </td>
                                                <td>
                                                    <div style={{ fontSize: 14, fontWeight: 600 }}>{item.patientName}</div>
                                                </td>
                                                <td style={{ textAlign: 'center', fontSize: 13, color: '#1565c0', fontWeight: 600, backgroundColor: '#f0f7ff', borderRadius: 4 }}>
                                                    {item.serviceDate || '-'}
                                                </td>
                                                <td>
                                                    <span className="badge badge-primary">{item.fund}</span>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.has_cid ? <span style={{ color: 'var(--success)' }}>✓</span> : <span style={{ color: 'var(--danger)' }}>✗</span>}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.has_diagnosis ? (
                                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{item.main_diag}</div>
                                                    ) : (
                                                        <span style={{ color: 'var(--danger)' }}>✗</span>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.has_receipt ? (
                                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>
                                                            {Number(item.total_price).toLocaleString()}
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: 'var(--danger)' }}>✗</span>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.has_close ? <span style={{ color: 'var(--success)' }}>✓</span> : <span style={{ color: 'var(--danger)' }}>✗</span>}
                                                </td>
                                                <td>
                                                    <div className="fund-status-block">
                                                        <div className="fund-status-title">{logic.billingStatusLabel}</div>
                                                        {hasSpecialFundBlock && (
                                                            <>
                                                                <div className={`fund-status-summary ${logic.matchedFund ? 'fund-status-summary--success' : 'fund-status-summary--warning'}`}>
                                                                    <span>{specialSummary}</span>
                                                                </div>
                                                                <div className="fund-status-kicker">กองทุนพิเศษ</div>
                                                                <div className="fund-status-badges">
                                                                    {specialFundNotes.map((note, idx) => {
                                                                const badgeStyle: React.CSSProperties = { fontSize: 10, padding: '2px 6px' };
                                                                
                                                                if (note.includes('ขาด') || note.includes('ไม่ผ่าน') || note.includes('ไม่ถึงเกณฑ์') || note.includes('เบิกไม่ได้')) {
                                                                    return <span key={idx} className="badge badge-danger" style={badgeStyle}>{note}</span>;
                                                                }
                                                                
                                                                if (note.match(/ANC|ตรวจครรภ์/)) {
                                                                    return <span key={idx} className="badge" style={{...badgeStyle, background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd'}}>{note}</span>;
                                                                }
                                                                if (note.match(/ตรวจหลังคลอด/)) {
                                                                    return <span key={idx} className="badge" style={{...badgeStyle, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a'}}>{note}</span>;
                                                                }
                                                                if (note.match(/คัดกรอง|ตรวจมะเร็ง/)) {
                                                                    return <span key={idx} className="badge" style={{...badgeStyle, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0'}}>{note}</span>;
                                                                }
                                                                if (note.match(/Telemedicine|EMS/)) {
                                                                    return <span key={idx} className="badge" style={{...badgeStyle, background: '#faf5ff', color: '#6b21a8', border: '1px solid #e9d5ff'}}>{note}</span>;
                                                                }
                                                                if (note.match(/คุมกำเนิด|ถุงยาง/)) {
                                                                    return <span key={idx} className="badge" style={{...badgeStyle, background: '#fff1f2', color: '#9f1239', border: '1px solid #fecdd3'}}>{note}</span>;
                                                                }
                                                                if (note.match(/ล้างไต/)) {
                                                                    return <span key={idx} className="badge badge-info" style={badgeStyle}>{note}</span>;
                                                                }

                                                                return (
                                                                    <span key={idx} className="badge badge-success" style={badgeStyle}>
                                                                        {note}
                                                                    </span>
                                                                );
                                                                    })}
                                                                </div>
                                                            </>
                                                        )}
                                                        {epNotes.length > 0 && (
                                                            <div className="fund-status-badges fund-status-badges--ep">
                                                                {epNotes.map((note, idx) => (
                                                                    <span
                                                                        key={idx}
                                                                        className={`badge ${item.has_close ? 'badge-success' : 'badge-warning'}`}
                                                                        style={{ fontSize: 10 }}
                                                                    >
                                                                        {note}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    {item.status === 'ready' ? (
                                                        <span className="badge badge-success">🟢 พร้อมส่ง</span>
                                                    ) : item.status === 'pending' ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            <span className="badge badge-warning">🟡 รอแก้ไข / รอปิดสิทธิ</span>
                                                            <div style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 600 }}>ต้องแก้: {item.missing.join(', ')}</div>
                                                        </div>
                                                    ) : (
                                                        <span className="badge badge-danger">🔴 UUC2 ไม่ประสงค์เบิก</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={12} style={{ textAlign: 'center', padding: '40px 0', opacity: 0.6 }}>
                                            ไม่พบข้อมูล Visit ในช่วงวันที่เลือก
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            <FDHPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                data={previewData}
                onDownload={handleExportZip}
                isDownloading={exporting}
            />
        </div>
    );
};
