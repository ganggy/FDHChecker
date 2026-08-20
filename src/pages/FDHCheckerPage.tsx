import React, { useState, useEffect, useRef } from 'react';
import { FundEligibilityRules } from '../components/FundEligibilityRules';
import * as XLSX from 'xlsx';
import { evaluateBillingLogic } from '../utils/billingUtils';
import { FDHPreviewModal } from '../components/FDHPreviewModal';
import { formatLocalDateInput, formatLocalDateStamp } from '../utils/dateUtils';
import { consumeDashboardNavigation } from '../utils/navigationState';
import { isFailedFdhSubmission, isMissingFdhStatus } from '../utils/fdhClaimProgress';

interface EligibleVisit {
    vn: string;
    an?: string;
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
    palliative_authen_ready?: number;
    authen_code?: string;
    close_code?: string;
    main_diag: string | null;
    total_price: number;
    project_code: string;
    status: 'ready' | 'pending' | 'rejected';
    missing: string[];
    _dataSource: string;
    pttype_code?: string;
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
    fdh_status_label?: string | null;
    fdh_claim_detail_status?: string | null;
    fdh_claim_code?: string | null;
    fdh_upload_uid?: string | null;
    fdh_sent_at?: string | null;
    fdh_reservation_status?: string | null;
    fdh_claim_status_message?: string | null;
    fdh_error_code?: string | null;
    fdh_updated_at?: string | null;
    fdh_has_submission?: boolean;
}

type FdhExportProfile = 'standard' | 'fwf-migrants';
type FdhStatusFilter = 'all' | 'not-submitted' | 'failed' | 'submitted';
const ALL_SPECIAL_FUNDS = '__all_special_funds__';

interface FdhValidationIssue {
    code: string;
    file?: string;
    row?: number;
    field?: string;
    message: string;
}

interface FdhValidationResult {
    valid: boolean;
    errors: FdhValidationIssue[];
    warnings: FdhValidationIssue[];
    counts: Record<string, number>;
    totalRows: number;
}

export const FDHCheckerPage: React.FC = () => {
    const [data, setData] = useState<EligibleVisit[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'pending'>('all');
    const [fdhStatusFilter, setFdhStatusFilter] = useState<FdhStatusFilter>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [dashboardContextItems, setDashboardContextItems] = useState<string[]>([]);
    const [selectedVns, setSelectedVns] = useState<string[]>([]);
    const [exporting, setExporting] = useState(false);
    const [previewData, setPreviewData] = useState<any>(null);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [exportWithHeader, setExportWithHeader] = useState(true);
    const [exportProfile, setExportProfile] = useState<FdhExportProfile>('standard');
    const [exportFund, setExportFund] = useState(ALL_SPECIAL_FUNDS);
    const [fcodeByHn, setFcodeByHn] = useState<Record<string, string>>({});
    const [previewValidation, setPreviewValidation] = useState<FdhValidationResult | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [confirmResend, setConfirmResend] = useState(false);
    const [ipdAuthenSyncing, setIpdAuthenSyncing] = useState(false);
    const [ipdAuthenNotice, setIpdAuthenNotice] = useState<{ type: 'success' | 'warning'; text: string } | null>(null);
    const lastIpdAuthenSyncKey = useRef('');
    const visitTableScrollRef = useRef<HTMLDivElement>(null);

    const todayStr = formatLocalDateInput();
    const [startDate, setStartDate] = useState(todayStr);
    const [endDate, setEndDate] = useState(todayStr);

    const syncFdhIpdAuthen = async (rangeStart: string, rangeEnd: string, force = false) => {
        setIpdAuthenSyncing(true);
        setIpdAuthenNotice(null);
        try {
            const response = await fetch('/api/fdh/ipd/authen/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate: rangeStart, endDate: rangeEnd, force }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) throw new Error(result.error || 'ตรวจ Authen IPD จาก API ไม่สำเร็จ');
            const summary = result.summary || {};
            setIpdAuthenNotice({
                type: 'success',
                text: `ตรวจ Authen ผู้ป่วยในสำหรับ FDH แล้ว ${Number(summary.total || 0)} AN — นำเข้าใหม่ ${Number(summary.updated || 0)}, ไม่พบ ${Number(summary.notFound || 0)}, ข้าม ${Number(summary.skipped || 0)}, ผิดพลาด ${Number(summary.errors || 0)}`,
            });
        } catch (err) {
            setIpdAuthenNotice({ type: 'warning', text: err instanceof Error ? err.message : 'ตรวจ Authen IPD จาก API ไม่สำเร็จ' });
        } finally {
            setIpdAuthenSyncing(false);
        }
    };

    const fetchEligibleData = async (dateRange?: { startDate?: string; endDate?: string; forceIpdAuthen?: boolean }) => {
        const rangeStart = dateRange?.startDate ?? startDate;
        const rangeEnd = dateRange?.endDate ?? endDate;
        setLoading(true);
        setError(null);
        setSelectedVns([]); // Clear selection on refresh
        try {
            const syncKey = `${rangeStart}:${rangeEnd}`;
            if (dateRange?.forceIpdAuthen || lastIpdAuthenSyncKey.current !== syncKey) {
                lastIpdAuthenSyncKey.current = syncKey;
                await syncFdhIpdAuthen(rangeStart, rangeEnd, Boolean(dateRange?.forceIpdAuthen));
            }
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

    useEffect(() => {
        const scroller = visitTableScrollRef.current;
        if (!scroller) return undefined;

        const forwardVerticalWheelToPage = (event: WheelEvent) => {
            if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            if (scroller.scrollHeight > scroller.clientHeight + 2) return;
            event.preventDefault();
            window.scrollBy({ top: event.deltaY, behavior: 'auto' });
        };

        scroller.addEventListener('wheel', forwardVerticalWheelToPage, { passive: false });
        return () => scroller.removeEventListener('wheel', forwardVerticalWheelToPage);
    }, [loading, error]);

    const specialFundOptions = Array.from(data.reduce((options, item) => {
        const logic = evaluateBillingLogic(item);
        new Set<string>(logic.detectedSpecialFundNotes).forEach((fundName) => {
            const current = options.get(fundName) || { total: 0, ready: 0, pending: 0 };
            current.total += 1;
            if (item.status === 'ready' && logic.matchedSpecialFundNotes.includes(fundName)) {
                current.ready += 1;
            } else {
                current.pending += 1;
            }
            options.set(fundName, current);
        });
        return options;
    }, new Map<string, { total: number; ready: number; pending: number }>()).entries())
        .map(([name, counts]) => ({ name, ...counts }))
        .sort((left, right) => left.name.localeCompare(right.name, 'th'));

    const matchesExportFund = (item: EligibleVisit) => exportFund === ALL_SPECIAL_FUNDS
        || evaluateBillingLogic(item).detectedSpecialFundNotes.includes(exportFund);

    const isReadyForExportFund = (item: EligibleVisit) => item.status === 'ready'
        && (exportFund === ALL_SPECIAL_FUNDS
            || evaluateBillingLogic(item).matchedSpecialFundNotes.includes(exportFund));

    const hasFdhSubmission = (item: EligibleVisit) => Boolean(
        item.fdh_has_submission ||
        item.fdh_claim_code ||
        item.fdh_upload_uid ||
        item.fdh_sent_at ||
        item.fdh_error_code ||
        !isMissingFdhStatus(
            item.fdh_claim_detail_status ||
            item.fdh_reservation_status ||
            item.fdh_claim_status_message
        )
    );

    const isSelectableForExport = (item: EligibleVisit) => isReadyForExportFund(item)
        && (isFailedFdhSubmission(item) || confirmResend || !hasFdhSubmission(item));

    const normalizeSearchValue = (value: unknown) => String(value ?? '').trim().toLowerCase();

    const matchesSearchTerm = (item: EligibleVisit) => {
        const query = normalizeSearchValue(searchTerm);
        if (!query) return true;

        const logic = evaluateBillingLogic(item);
        const haystack = [
            item.vn,
            item.hn,
            item.patientName,
            item.fund,
            item.hipdata_code,
            item.serviceDate,
            item.main_diag,
            item.project_code,
            item.fdh_status_label,
            item.fdh_claim_code,
            item.fdh_error_code,
            item.fdh_claim_detail_status,
            logic.billingStatusLabel,
            logic.matchedFund ? 'พร้อมส่ง' : '',
            logic.incompleteFund ? 'รอแก้ไข' : '',
            ...logic.specialFundNotes,
            ...item.missing,
        ].map(normalizeSearchValue);

        return haystack.some((value) => value.includes(query));
    };

    const filtered = data.filter(item => {
        if (!matchesExportFund(item)) return false;
        if (statusFilter === 'ready' && !isReadyForExportFund(item)) return false;
        if (statusFilter === 'pending' && isReadyForExportFund(item)) return false;
        if (fdhStatusFilter === 'not-submitted' && hasFdhSubmission(item)) return false;
        if (fdhStatusFilter === 'failed' && !isFailedFdhSubmission(item)) return false;
        if (fdhStatusFilter === 'submitted' && !hasFdhSubmission(item)) return false;
        return matchesSearchTerm(item);
    });

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            // Select only those that are ready
            const readyVns = filtered.filter(isSelectableForExport).map(i => i.vn);
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

    const getReadyVns = () => {
        const visibleReadyVns = filtered.filter(isSelectableForExport).map(i => i.vn).filter(Boolean);
        if (selectedVns.length === 0) return visibleReadyVns;
        const visibleReadySet = new Set(visibleReadyVns);
        return selectedVns.filter((vn) => visibleReadySet.has(vn));
    };

    const buildFdhPayload = (vns: string[]) => ({
        vns,
        patientType: 'OPD',
        profile: exportProfile,
        fcodeByHn,
        uucByVn: Object.fromEntries(vns.map((vn) => {
            const visit = data.find((item) => item.vn === vn);
            return [vn, visit && evaluateBillingLogic(visit).isUUC1 ? '1' : '2'];
        })),
    });

    const handlePreviewData = async () => {
        const vnsToPreview = getReadyVns();

        if (vnsToPreview.length === 0) return alert('ไม่มีรายการพร้อมส่ง (Ready) สำหรับดูข้อมูล');

        setIsLoadingPreview(true);
        try {
            const response = await fetch('/api/fdh/view-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildFdhPayload(vnsToPreview))
            });

            const result = await response.json();
            if (result.success) {
                setPreviewData(result.data);
                setPreviewValidation(result.validation || null);
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
        const headers = '#,VN,HN,ชื่อผู้ป่วย,สิทธิ์,วันที่รับบริการ,ประเภท,DIAG,สถานะกองทุน,สถานะ FDH,สถานะข้อมูล,ราคา (บาท)';
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
                item.fdh_status_label || 'ยังไม่พบข้อมูล FDH',
                item.status === 'ready'
                    ? (item.palliative_authen_ready && !item.has_close ? 'พร้อมส่ง (Palliative/Authen)' : 'พร้อมส่ง (ปิดสิทธิแล้ว)')
                    : 'รอแก้ไข/รอปิดสิทธิ',
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
                'สถานะ FDH': item.fdh_status_label || 'ยังไม่พบข้อมูล FDH',
                'สถานะข้อมูล': item.status === 'ready'
                    ? (item.palliative_authen_ready && !item.has_close ? 'พร้อมส่ง (Palliative/Authen)' : 'พร้อมส่ง (ปิดสิทธิแล้ว)')
                    : 'รอแก้ไข/รอปิดสิทธิ',
                'ราคา (บาท)': item.total_price
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "FDH Data");

        const colWidths = [
            { wch: 5 }, { wch: 15 }, { wch: 12 }, { wch: 30 },
            { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 10 },
            { wch: 15 }, { wch: 24 }, { wch: 12 }, { wch: 12 }
        ];
        worksheet['!cols'] = colWidths;

        XLSX.writeFile(workbook, `fdh-check-${formatLocalDateStamp()}.xlsx`);
    };

    const handleExportZip = async () => {
        // If no rows selected, export all ready records in current filtered view
        const vnsToExport = getReadyVns();

        if (vnsToExport.length === 0) return alert('ไม่มีรายการพร้อมส่ง (Ready) สำหรับส่งออก');

        setExporting(true);
        try {
            const response = await fetch('/api/fdh/export-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...buildFdhPayload(vnsToExport), includeHeader: exportWithHeader })
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

    const handleSubmitFdhApi = async () => {
        const vnsToSubmit = getReadyVns();
        if (vnsToSubmit.length === 0) return alert('ไม่มีรายการพร้อมส่งสำหรับส่ง FDH API');
        const resendCount = filtered.filter((item) => vnsToSubmit.includes(item.vn) && hasFdhSubmission(item)).length;
        const confirmationText = confirmResend
            ? `ยืนยันส่ง ${vnsToSubmit.length} visit ไป FDH API จริง?\n\nมี ${resendCount} รายการที่เคยส่ง/มีสถานะ FDH และจะถูกส่งซ้ำ`
            : `ยืนยันส่ง ${vnsToSubmit.length} visit ที่ยังไม่เคยส่งไป FDH API จริง?`;
        if (!window.confirm(confirmationText)) return;
        setSubmitting(true);
        try {
            const response = await fetch('/api/fdh/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...buildFdhPayload(vnsToSubmit), confirm: true }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                setPreviewValidation(result.validation || previewValidation);
                const firstIssues = result.validation?.errors?.slice(0, 5).map((issue: FdhValidationIssue) => issue.message).join('\n');
                return alert(`${result.error || result.message || 'FDH API ปฏิเสธข้อมูล'}${firstIssues ? `\n\n${firstIssues}` : ''}`);
            }
            alert(`ส่ง FDH สำเร็จ\nBatch: ${result.batchUid}\n${result.submittedVisits} visits / ${result.submittedFiles?.length || 0} files`);
            setIsPreviewOpen(false);
        } catch {
            alert('เชื่อมต่อเซิร์ฟเวอร์เพื่อส่ง FDH API ไม่สำเร็จ');
        } finally {
            setSubmitting(false);
        }
    };

    const fundFilteredData = data.filter(matchesExportFund);
    const readyCount = fundFilteredData.filter(isReadyForExportFund).length;
    const pendingCount = fundFilteredData.length - readyCount;
    const exportVisitCount = getReadyVns().length;
    const selectedVisibleCount = selectedVns.filter((vn) => filtered.some((item) => item.vn === vn && isSelectableForExport(item))).length;
    const visibleReadyCount = filtered.filter(isReadyForExportFund).length;
    const visiblePendingCount = filtered.length - visibleReadyCount;
    const visibleAlreadySentCount = filtered.filter((item) => isReadyForExportFund(item) && hasFdhSubmission(item)).length;
    const failedFdhCount = fundFilteredData.filter(isFailedFdhSubmission).length;
    const notSubmittedFdhCount = fundFilteredData.filter((item) => !hasFdhSubmission(item)).length;
    const submittedFdhCount = fundFilteredData.length - notSubmittedFdhCount;

    const clearListFilters = () => {
        setExportFund(ALL_SPECIAL_FUNDS);
        setStatusFilter('all');
        setFdhStatusFilter('all');
        setSearchTerm('');
        setConfirmResend(false);
        setSelectedVns([]);
        setPreviewValidation(null);
    };



    return (
        <div className="page-container fdh-checker-page">
            <div className="page-header">
                <h1 className="page-title">📤 ส่งออกผู้ป่วยนอก (OPD 16 แฟ้ม)</h1>
                <p className="page-subtitle">คัดเลือกด้วย VN ตรวจความพร้อม/Preflight และส่ง FDH แยกจากรายการ IPD</p>
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

            <details className="card" style={{ marginBottom: 16 }}>
                <summary style={{ cursor: 'pointer', padding: '14px 16px', fontWeight: 700 }}>
                    📋 ดูเงื่อนไขกองทุนและเกณฑ์ตรวจสอบ OPD
                </summary>
                <div style={{ padding: '0 16px 16px' }}>
                    <FundEligibilityRules />
                </div>
            </details>

            <div className="card fdh-filter-card" style={{ marginBottom: 16 }}>
                <div className="fdh-filter-heading">
                    <div>
                        <div className="fdh-filter-title">ตั้งค่าชุดส่งออกและตัวกรอง</div>
                        <div className="fdh-filter-subtitle">เลือกชุดข้อมูลก่อน แล้วจึงกรองรายการที่ต้องการตรวจหรือส่งออก</div>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary fdh-filter-clear"
                        onClick={clearListFilters}
                        disabled={exportFund === ALL_SPECIAL_FUNDS && statusFilter === 'all' && fdhStatusFilter === 'all' && !searchTerm}
                    >
                        ล้างตัวกรอง
                    </button>
                </div>

                <div className="fdh-filter-body">
                    <section className="fdh-filter-section">
                        <div className="fdh-filter-section-label">
                            <span className="fdh-filter-step">1</span>
                            <span>กำหนดชุดส่งออก</span>
                        </div>
                        <div className="fdh-filter-grid fdh-filter-grid--export">
                        <div className="form-group">
                            <label className="form-label">มาตรฐานส่งออก</label>
                            <select
                                className="form-control fdh-filter-select"
                                value={exportProfile}
                                onChange={(event) => {
                                    setExportProfile(event.target.value as FdhExportProfile);
                                    setPreviewValidation(null);
                                }}
                            >
                                <option value="standard">FDH 16 แฟ้มทั่วไป</option>
                                <option value="fwf-migrants">FWF Migrants (แรงงานต่างด้าว)</option>
                            </select>
                        </div>
                        <div className="form-group fdh-filter-fund">
                            <label className="form-label">🏷️ กองทุนที่จะส่งออก</label>
                            <select
                                className="form-control fdh-filter-select"
                                value={exportFund}
                                onChange={(event) => {
                                    setExportFund(event.target.value);
                                    setSelectedVns([]);
                                    setPreviewValidation(null);
                                }}
                            >
                                <option value={ALL_SPECIAL_FUNDS}>ทุกกองทุน / ทุก Visit ({data.length})</option>
                                {specialFundOptions.map((fund) => (
                                    <option key={fund.name} value={fund.name}>
                                        {fund.name} (พร้อมส่ง {fund.ready} / รอแก้ {fund.pending})
                                    </option>
                                ))}
                            </select>
                            <div className="fdh-filter-help">
                                ตาราง ตรวจสอบก่อนส่ง และ ZIP จะใช้กองทุนเดียวกัน
                                {!confirmResend && visibleAlreadySentCount > 0 ? ` • ไม่รวม ${visibleAlreadySentCount} รายการที่มีสถานะ FDH แล้ว` : ''}
                            </div>
                        </div>
                        <div className="form-group fdh-header-option">
                            <label className="form-label">รูปแบบไฟล์ TXT</label>
                            <label className="fdh-checkbox-card">
                                <input
                                    type="checkbox"
                                    checked={exportWithHeader}
                                    onChange={(event) => setExportWithHeader(event.target.checked)}
                                />
                                <span>
                                    <strong>มีหัวคอลัมน์</strong>
                                    <small>ใส่ชื่อฟิลด์ในแถวแรก</small>
                                </span>
                            </label>
                        </div>
                        </div>
                    </section>

                    <section className="fdh-filter-section">
                        <div className="fdh-filter-section-label">
                            <span className="fdh-filter-step">2</span>
                            <span>กรองรายการในตาราง</span>
                        </div>
                        <div className="fdh-filter-grid fdh-filter-grid--list">
                        <div className="form-group">
                            <label className="form-label">🔍 สถานะความพร้อม</label>
                            <select
                                className="form-control fdh-filter-select"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                            >
                                <option value="all">ทั้งหมด ({data.length})</option>
                                <option value="ready">🟢 ข้อมูลพร้อมส่ง ({readyCount})</option>
                                <option value="pending">🟡 ข้อมูลรอแก้ไข ({pendingCount})</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">📡 สถานะการส่ง FDH</label>
                            <select
                                className="form-control fdh-filter-select"
                                value={fdhStatusFilter}
                                onChange={(event) => {
                                    const nextFilter = event.target.value as FdhStatusFilter;
                                    setFdhStatusFilter(nextFilter);
                                    setSelectedVns([]);
                                    setPreviewValidation(null);
                                    if (nextFilter === 'failed') {
                                        setConfirmResend(true);
                                        setStatusFilter('ready');
                                    } else if (nextFilter === 'not-submitted') {
                                        setConfirmResend(false);
                                    }
                                }}
                            >
                                <option value="all">ทุกสถานะ FDH ({fundFilteredData.length})</option>
                                <option value="not-submitted">ยังไม่ส่ง / ไม่พบใน FDH ({notSubmittedFdhCount})</option>
                                <option value="failed">🔴 ประมวลผลไม่ผ่าน — ส่งซ้ำ ({failedFdhCount})</option>
                                <option value="submitted">เคยส่ง / มีสถานะ FDH ({submittedFdhCount})</option>
                            </select>
                            <div className={`fdh-filter-help${fdhStatusFilter === 'failed' ? ' fdh-filter-help--danger' : ''}`}>
                                {fdhStatusFilter === 'failed'
                                    ? 'เปิด “ยืนยันส่งซ้ำ” แล้ว • เลือกได้เฉพาะรายการไม่ผ่านที่ข้อมูลพร้อมส่ง'
                                    : 'ใช้กรองรายการตามผลตอบกลับล่าสุดจาก FDH'}
                            </div>
                        </div>

                        <div className="form-group fdh-filter-search">
                            <label className="form-label">🔎 ค้นหาในตาราง</label>
                            <div className="fdh-search-control">
                                <input
                                    type="text"
                                    className="form-control"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="ค้นหา VN, HN, ชื่อ, สิทธิ์, DIAG, สถานะ"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setSearchTerm('')}
                                    >
                                        ล้าง
                                    </button>
                                )}
                            </div>
                            <div className="fdh-filter-help">
                                แสดง {filtered.length} รายการ จากทั้งหมด {fundFilteredData.length} รายการ
                                {searchTerm ? ` • พร้อมส่ง ${visibleReadyCount} • รอแก้ ${visiblePendingCount}` : ''}
                            </div>
                        </div>
                        </div>
                    </section>

                    <section className="fdh-filter-section fdh-filter-section--last">
                        <div className="fdh-filter-section-label">
                            <span className="fdh-filter-step">3</span>
                            <span>เลือกช่วงบริการและดึงข้อมูล</span>
                        </div>
                        <div className="fdh-filter-grid fdh-filter-grid--dates">
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
                            disabled={loading || exporting || ipdAuthenSyncing}
                            style={{ height: 'fit-content' }}
                        >
                            🔄 ดึงข้อมูลใหม่
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={() => fetchEligibleData({ forceIpdAuthen: true })}
                            disabled={loading || exporting || ipdAuthenSyncing}
                            style={{ height: 'fit-content' }}
                        >
                            {ipdAuthenSyncing ? '⏳ กำลังตรวจ Authen IPD...' : '🪪 ตรวจ Authen IPD ใหม่'}
                        </button>
                    </div>
                    </section>
                </div>
            </div>

            {(ipdAuthenSyncing || ipdAuthenNotice) && (
                <div className={`alert ${ipdAuthenNotice?.type === 'warning' ? 'alert-warning' : 'alert-info'}`} style={{ marginBottom: 16 }}>
                    <span>{ipdAuthenSyncing ? '⏳' : ipdAuthenNotice?.type === 'warning' ? '⚠️' : '✅'}</span>
                    <span>{ipdAuthenSyncing ? 'กำลังตรวจสอบและนำเข้า Authen Code ของผู้ป่วยในก่อนส่ง FDH...' : ipdAuthenNotice?.text}</span>
                </div>
            )}

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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                    <span className="badge badge-primary">OPD Visit {fundFilteredData.length}</span>
                    <span className="badge badge-success">พร้อมส่ง {readyCount}</span>
                    <span className="badge badge-warning">รอแก้ไข {pendingCount}</span>
                    <span className="badge badge-info">ยังไม่ส่ง {notSubmittedFdhCount}</span>
                    <span className="badge badge-danger">ส่งไม่ผ่าน {failedFdhCount}</span>
                    <span className="badge">เคยส่งแล้ว {submittedFdhCount}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <button className="btn btn-success" type="button" onClick={handleExportCSV}>📥 CSV</button>
                        <button className="btn btn-warning" type="button" onClick={handleExportExcel}>📊 Excel</button>
                    </span>
                </div>
            )}

            {!loading && !error && (
                <div className="card overflow-hidden fdh-visit-table-card">
                    <div ref={visitTableScrollRef} className="fdh-visit-table-scroll">
                        <table className="table fdh-visit-table">
                            <thead>
                            <tr>
                                <th style={{ width: 40, textAlign: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedVns.length > 0 && selectedVns.length === filtered.filter(isSelectableForExport).length}
                                        onChange={handleSelectAll}
                                        disabled={filtered.filter(isSelectableForExport).length === 0}
                                    />
                                </th>
                                <th style={{ width: 40 }}>#</th>
                                <th>VN / HN</th>
                                {exportProfile === 'fwf-migrants' && <th style={{ minWidth: 150 }}>FCode (FDH-Migrants)</th>}
                                <th>ชื่อผู้ป่วย</th>
                                <th style={{ minWidth: 100 }}>📅 วันที่รับบริการ</th>
                                <th>สิทธิ์</th>
                                <th style={{ textAlign: 'center' }}>CID</th>
                                <th style={{ textAlign: 'center' }}>Diagnosis</th>
                                <th style={{ textAlign: 'center' }}>Invoice</th>
                                <th style={{ minWidth: 150, textAlign: 'center' }}>Authen Code<br /><span style={{ fontSize: 10, fontWeight: 400 }}>FDH IPD</span></th>
                                <th style={{ textAlign: 'center' }}>ปิดสิทธิ (EP)</th>
                                <th className="fdh-fund-status-column">สถานะกองทุน (สปสช.)</th>
                                <th style={{ minWidth: 180 }}>สถานะ FDH</th>
                                <th>สถานะส่งออก / ข้อมูล</th>
                            </tr>
                        </thead>
                            <tbody>
                                {filtered.length > 0 ? (
                                    filtered.map((item, index) => {
                                        const logic = evaluateBillingLogic(item);
                                        const readyForSelectedFund = isReadyForExportFund(item);
                                        const fdhStatus = String(item.fdh_status_label || '').trim();
                                        const fdhStatusText = `${fdhStatus} ${item.fdh_error_code || ''}`.trim();
                                        const fdhStatusClass = /ประมวลผลไม่ผ่าน|ไม่ผ่าน|reject|deny|failed|error/i.test(fdhStatusText)
                                            ? 'badge-danger'
                                            : /ผ่าน|สำเร็จ|accepted|approved|อนุมัติ/i.test(fdhStatusText)
                                                ? 'badge-success'
                                                : fdhStatus
                                                    ? 'badge-info'
                                                    : 'badge-secondary';
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
                                                        disabled={!isSelectableForExport(item)}
                                                        title={!readyForSelectedFund
                                                            ? 'ข้อมูลยังไม่พร้อมส่ง'
                                                            : isFailedFdhSubmission(item)
                                                                ? 'FDH ประมวลผลไม่ผ่าน สามารถเลือกเพื่อส่งใหม่ได้'
                                                                : hasFdhSubmission(item) && !confirmResend
                                                                ? 'รายการนี้มีสถานะ FDH แล้ว หากต้องการเลือกให้กด “ยืนยันส่งซ้ำ”'
                                                                : undefined}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center', opacity: 0.6, fontSize: 13 }}>{index + 1}</td>
                                                <td>
                                                    <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 13 }}>{item.vn}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>HN: {item.hn}</div>
                                                </td>
                                                {exportProfile === 'fwf-migrants' && (
                                                    <td>
                                                        <input
                                                            className="form-control"
                                                            value={fcodeByHn[item.hn] || ''}
                                                            onChange={(event) => setFcodeByHn((current) => ({
                                                                ...current,
                                                                [item.hn]: event.target.value.trim(),
                                                            }))}
                                                            placeholder="กรอก FCode"
                                                            maxLength={16}
                                                            aria-label={`FCode ของ HN ${item.hn}`}
                                                            style={{ minWidth: 140, padding: '6px 8px' }}
                                                        />
                                                    </td>
                                                )}
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
                                                    {item.authen_code ? (
                                                        <div>
                                                            <span className="badge badge-success">พบแล้ว</span>
                                                            <div style={{ marginTop: 4, fontSize: 11, fontWeight: 800, color: '#0e7490' }}>{item.authen_code}</div>
                                                        </div>
                                                    ) : item.an ? (
                                                        <span className="badge badge-warning">ยังไม่พบ</span>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)' }}>{item.has_authen ? '✓' : '-'}</span>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.has_close ? (
                                                        <span style={{ color: 'var(--success)' }}>✓</span>
                                                    ) : item.palliative_authen_ready ? (
                                                        <span className="badge badge-success">Authen ผ่าน</span>
                                                    ) : (
                                                        <span style={{ color: 'var(--danger)' }}>✗</span>
                                                    )}
                                                </td>
                                                <td className="fdh-fund-status-column">
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
                                                                if (note.match(/คุมกำเนิด|ถุงยาง|ยาฉีด/)) {
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
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                                        <span className={`badge ${fdhStatusClass}`} style={{ fontSize: 10 }}>
                                                            {fdhStatus || 'ยังไม่พบข้อมูล FDH'}
                                                        </span>
                                                        {item.fdh_error_code && (
                                                            <span style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 700 }}>
                                                                Error: {item.fdh_error_code}
                                                            </span>
                                                        )}
                                                        {(item.fdh_claim_code || item.fdh_sent_at || item.fdh_updated_at) && (
                                                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                                                                {item.fdh_claim_code ? `Claim: ${item.fdh_claim_code}` : ''}
                                                                {item.fdh_claim_code && (item.fdh_sent_at || item.fdh_updated_at) ? ' • ' : ''}
                                                                {item.fdh_sent_at || item.fdh_updated_at || ''}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    {exportFund !== ALL_SPECIAL_FUNDS && !readyForSelectedFund ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            <span className="badge badge-warning">🟡 รอแก้เงื่อนไขกองทุน</span>
                                                            <div style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 600 }}>{exportFund}</div>
                                                        </div>
                                                    ) : item.status === 'ready' ? (
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
                                        <td colSpan={exportProfile === 'fwf-migrants' ? 15 : 14} style={{ textAlign: 'center', padding: '40px 0', opacity: 0.6 }}>
                                            ไม่พบข้อมูล Visit ในช่วงวันที่เลือก
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {!loading && !error && (
                <div
                    className="no-print"
                    role="region"
                    aria-label="คำสั่งส่งออก OPD"
                    style={{ position: 'fixed', left: 24, right: 24, bottom: 18, zIndex: 90, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.96)', border: '1px solid var(--border)', boxShadow: '0 12px 35px rgba(15,23,42,.18)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
                >
                    <strong style={{ marginRight: 'auto' }}>
                        เลือกส่ง {exportVisitCount} VN {selectedVisibleCount === 0 && exportVisitCount > 0 ? '(รายการพร้อมส่งที่มองเห็นทั้งหมด)' : ''}
                    </strong>
                    <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, cursor: 'pointer' }} title="เปิดเพื่อเลือกรายการที่เคยส่งสำเร็จหรือมีสถานะ FDH แล้ว">
                        <input
                            type="checkbox"
                            checked={confirmResend}
                            onChange={(event) => {
                                setConfirmResend(event.target.checked);
                                setSelectedVns([]);
                                setPreviewValidation(null);
                            }}
                        />
                        ยืนยันให้เลือกและส่งรายการที่เคยส่งซ้ำ
                    </label>
                    <button className="btn btn-secondary" type="button" onClick={handlePreviewData} disabled={isLoadingPreview || exportVisitCount === 0}>
                        {isLoadingPreview ? 'กำลังตรวจ...' : '🔎 Preview / Preflight'}
                    </button>
                    <button className="btn btn-warning" type="button" onClick={handleExportZip} disabled={exporting || exportVisitCount === 0}>
                        {exporting ? 'กำลังสร้าง ZIP...' : '📦 ดาวน์โหลด 16 แฟ้ม'}
                    </button>
                    <button className="btn btn-success" type="button" onClick={handleSubmitFdhApi} disabled={submitting || exportVisitCount === 0}>
                        {submitting ? 'กำลังส่ง...' : '🚀 ส่ง FDH API'}
                    </button>
                </div>
            )}
            <FDHPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                data={previewData}
                validation={previewValidation}
                onDownload={handleExportZip}
                isDownloading={exporting}
                onSubmit={handleSubmitFdhApi}
                isSubmitting={submitting}
            />
        </div>
    );
};
