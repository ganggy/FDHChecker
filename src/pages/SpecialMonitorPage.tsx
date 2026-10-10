import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { DetailKidneyModal } from '../components/DetailKidneyModal';
import { OpReferMonitorPanel } from '../components/OpReferMonitorPanel';
import type { KidneyMonitorRecord } from '../mockKidneyData';
import businessRules from '../config/business_rules.json';
import { formatLocalDateInput } from '../utils/dateUtils';
import './SpecialMonitorPage.css';

interface MonitorAnalysis {
    right: string;
    totalCost?: number;
    totalAmount?: number;
    epoPayment?: number;
    profit?: number;
    profitMargin?: number;
    category?: string;
    epoDetail?: any;
    error?: string;
    record?: KidneyMonitorRecord;
}

interface MonitorItem {
    hn?: string;
    ptname?: string;
    hipdata_code?: string;
    has_sss?: string;
    has_lgo?: string;
    serviceDate?: string;
    vn?: string;
    [key: string]: any;
}

interface MonitorCategory {
    id: string;
    name: string;
    icon: string;
    description: string;
}

type KidneyTrackingRight = 'civilServant' | 'socialSecurity' | 'nhso' | 'localGovernment' | 'other';

interface KidneyTrackingSummary {
    totalSessions: number;
    totalPatients: number;
    byRight: Record<KidneyTrackingRight, { sessions: number; patients: number }>;
}

type KidneyTrackingIssueKind = 'RIGHT_CHANGED' | 'MISSING_EVIDENCE' | 'UNKNOWN_RIGHT' | 'MISSING_HN';

interface KidneyTrackingIssue {
    kind: KidneyTrackingIssueKind;
    hn: string;
    patientName: string;
    visits: Array<{
        vn: string;
        serviceDate: string;
        right: KidneyTrackingRight;
        hipdataCode: string;
        pttypeName: string;
    }>;
}

interface KidneyTrackingIssueSummary {
    total: number;
    rightChanged: number;
    missingEvidence: number;
    unknownRight: number;
    missingHn: number;
    issues: KidneyTrackingIssue[];
}

interface KidneyMonitorMeta {
    total: number;
    returned: number;
    truncated: boolean;
    limit: number;
    candidateTotal?: number;
    excludedWithoutEvidence?: number;
    trackingSummary?: KidneyTrackingSummary;
    trackingIssues?: KidneyTrackingIssueSummary;
    repstmSummary?: {
        totalVisits: number;
        repVisits: number;
        pendingRep: number;
        stmVisits: number;
        pendingStm: number;
        zeroAmountVisits: number;
        matchedVisits: number;
        differentVisits: number;
        errorVisits: number;
        repAmount: number;
        stmPaidAmount: number;
        amountDiff: number;
    };
}

const CLAIM_TRACKING_LABELS = {
    NO_REP: { label: 'ยังไม่มี REP', color: '#92400e', background: '#fef3c7' },
    WAITING_STM: { label: 'พบ REP · รอ STM', color: '#1d4ed8', background: '#dbeafe' },
    WAITING_PAYMENT: { label: 'พบ REP · รอยอดชดเชย', color: '#b45309', background: '#fef3c7' },
    MATCHED: { label: 'REP/STM ตรง', color: '#166534', background: '#dcfce7' },
    AMOUNT_DIFFERENT: { label: 'REP/STM ยอดต่าง', color: '#b91c1c', background: '#fee2e2' },
    REP_ERROR: { label: 'REP/STM มี Error', color: '#9a3412', background: '#ffedd5' },
} as const;

export type ClaimCategoryKey = 'all' | 'ucs' | 'ofc' | 'lgo' | 'sss' | 'other';

const RIGHT_LABEL_MAP: Record<ClaimCategoryKey, string> = {
    all: 'ทุกกลุ่มสิทธิ',
    ucs: 'บัตรทอง (UCS)',
    ofc: 'ข้าราชการ (OFC)',
    lgo: 'อปท. (LGO)',
    sss: 'ประกันสังคม (SSS)',
    other: 'สิทธิอื่นๆ',
};

const CLAIM_CATEGORY_CONFIG: Record<
    Exclude<ClaimCategoryKey, 'all'>,
    { label: string; short: string; code: string; color: string; background: string; border: string }
> = {
    ucs: { label: 'บัตรทอง', short: 'UCS', code: 'UCS', color: '#059669', background: '#ecfdf5', border: '#10b981' },
    ofc: { label: 'ข้าราชการ', short: 'OFC', code: 'OFC', color: '#7c3aed', background: '#f5f3ff', border: '#8b5cf6' },
    lgo: { label: 'อปท.', short: 'LGO', code: 'LGO', color: '#d97706', background: '#fffbeb', border: '#f59e0b' },
    sss: { label: 'ประกันสังคม', short: 'SSS', code: 'SSS', color: '#0284c7', background: '#f0f9ff', border: '#0ea5e9' },
    other: { label: 'สิทธิอื่นๆ', short: 'OTHER', code: 'OTHER', color: '#64748b', background: '#f8fafc', border: '#94a3b8' },
};

export const getVisitClaimCategory = (item: MonitorItem): Exclude<ClaimCategoryKey, 'all'> => {
    const code = String(item.hipdataCode || item.hipdata_code || '').trim().toUpperCase();
    const rightName = String(item.insuranceType || item.pttypeName || '').trim().toLowerCase();
    const group = String(item.insuranceGroup || '').trim().toUpperCase();

    if (code === 'LGO' || /อปท|ท้องถิ่น/.test(rightName)) return 'lgo';
    if (code === 'OFC' || /ข้าราชการ|ส่วนราชการ|cscd|เบิกตรง|เบิกหน่วยงาน/.test(rightName)) return 'ofc';
    if (code === 'SSS' || /ประกันสังคม/.test(rightName)) return 'sss';
    if (['UCS', 'UC', 'WEL'].includes(code) || /บัตรทอง|สุขภาพ|สปสช|ผู้สูงอายุ|ผู้พิการ|ผู้มีรายได้น้อย|ทหารผ่านศึก|อสม/.test(rightName)) return 'ucs';

    if (group === 'UC-EPO') return 'ucs';
    if (group === 'OFC+LGO') {
        return (/อปท|ท้องถิ่น/.test(rightName)) ? 'lgo' : 'ofc';
    }
    if (group === 'UCS+SSS') {
        return (/ประกันสังคม/.test(rightName)) ? 'sss' : 'ucs';
    }
    return 'other';
};

type StmView = 'all' | 'received' | 'waiting' | 'no-rep';

const STM_VIEW_LABELS: Record<StmView, string> = {
    all: 'ทุกรายการ',
    received: 'ได้รับ STM',
    waiting: 'รอ STM',
    'no-rep': 'ยังไม่มี REP',
};

export const SpecialMonitorPage: React.FC = () => {
    const [activeMonitor, setActiveMonitor] = useState('kidney');
    const [filterRight, setFilterRight] = useState<ClaimCategoryKey>('all');
    const [filterPatientRight, setFilterPatientRight] = useState('all');
    const [stmView, setStmView] = useState<StmView>('all');
    const [searchText, setSearchText] = useState('');
    const [startDate, setStartDate] = useState(() => formatLocalDateInput());
    const [endDate, setEndDate] = useState(() => formatLocalDateInput());
    const [allKidneyData, setAllKidneyData] = useState<MonitorItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dataMeta, setDataMeta] = useState<KidneyMonitorMeta | null>(null);
    const [selectedKidneyRecord, setSelectedKidneyRecord] = useState<KidneyMonitorRecord | null>(null);
    const siteSettings = businessRules.site_settings as {
        hospital_name?: string;
        hospital_code?: string;
        lab_costs?: {
            service_cost_overrides?: {
                dialysis_fixed?: number;
                epo_real_base?: number;
            };
        };
    };
    const dialysisFixed = siteSettings.lab_costs?.service_cost_overrides?.dialysis_fixed ?? businessRules.costs.dialysis_fixed;
    const epoRealBase = siteSettings.lab_costs?.service_cost_overrides?.epo_real_base ?? businessRules.costs.epo_real_base;
    const hospitalName = siteSettings.hospital_name || 'FDH Checker';

    const monitorCategories: MonitorCategory[] = [
        {
            id: 'kidney',
            name: 'หน่วยไต (N185)',
            icon: '🏥',
            description: 'ตรวจสอบการเบิกจ่ายผู้ป่วยผ่าตัดไต - สิทธิ์ UCS+SSS, OFC+LGO, UC-EPO',
        },
        {
            id: 'chronic',
            name: 'โรคเรื้อรัง (NCD)',
            icon: '🩺',
            description: 'ตรวจสอบโรคเรื้อรัง E11-E14, I10-I15 และอื่นๆ',
        },
        {
            id: 'special',
            name: 'OP Refer',
            icon: '⭐',
            description: 'ตรวจสิทธิรับส่งต่อ ข้อมูล Refer, Diagnosis, ค่าใช้จ่าย และการปิดสิทธิ',
        },
    ];    const fetchMonitorData = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        setDataMeta(null);
        try {
            const res = await fetch(
                `/api/hosxp/kidney-monitor?startDate=${startDate}&endDate=${endDate}`
            );
            const json = await res.json();
            if (json.success && json.data) {
                if (json.meta) {
                    setDataMeta(json.meta);
                    if (json.meta.truncated) {
                        console.warn(`⚠️ Data truncated: showing ${json.meta.returned} of ${json.meta.total} records`);
                    }
                }
                setAllKidneyData(json.data);
            } else {
                console.warn('❌ API returned no data');
                setError('ไม่พบข้อมูลจากระบบ');
                setAllKidneyData([]);
            }
        } catch (err) {
            console.error('❌ API error:', err);
            setError(`เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setAllKidneyData([]);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => {
        void fetchMonitorData();
    }, [fetchMonitorData]);

    const analyzeUcsCase = useCallback((item: MonitorItem): MonitorAnalysis | null => {
        const isUCS = item.hipdata_code === 'UCS';
        const hasSSS = item.has_sss === 'Y';

        if (!isUCS && !hasSSS) return null;

        const revenue = businessRules.costs.dialysis_ucs_sss_total;
        const roomCost = dialysisFixed;
        const profit = revenue - roomCost;

        return {
            right: 'UCS + SSS',
            totalCost: revenue,
            epoPayment: roomCost,
            profit,
            category: 'dialysis',
            epoDetail: `ค่ายูนิต: ฿${roomCost} บาท`,
        };
    }, [dialysisFixed]);

    const analyzeOfcLgoCase = useCallback((item: MonitorItem): MonitorAnalysis | null => {
        const isOFC = item.hipdata_code === 'OFC';

        if (!isOFC) return null;

        const revenue = businessRules.costs.dialysis_ofc_lgo_total;
        const roomCost = dialysisFixed;
        const profit = revenue - roomCost;

        return {
            right: 'OFC + LGO',
            totalCost: revenue,
            epoPayment: roomCost,
            profit,
            category: 'dialysis',
            epoDetail: `ค่ายูนิต: ฿${roomCost} บาท`,
        };
    }, [dialysisFixed]);

    const analyzeUcEpoCase = useCallback((item: MonitorItem): MonitorAnalysis | null => {
        const isUC = item.hipdata_code === 'UC';
        if (!isUC) return null;

        const epoRealAmount = epoRealBase;
        const epoDetail = businessRules.costs.epo_detail;

        return {
            right: 'UC (EPO จริง)',
            totalAmount: epoRealAmount,
            epoDetail,
            category: 'epo_real',
        };
    }, [epoRealBase]);

    const getAnalysis = useCallback((item: MonitorItem): MonitorAnalysis => {        // Check if this is a kidney monitor record
        if ('insuranceType' in item && 'dialysisFee' in item && 'costTotal' in item) {
            const kidneyRecord = item as unknown as KidneyMonitorRecord;
            return {
                right: kidneyRecord.insuranceGroup || kidneyRecord.insuranceType,
                totalCost: kidneyRecord.revenue,
                profit: kidneyRecord.profit,
                profitMargin: kidneyRecord.profitMargin,
                category: 'dialysis',
                record: kidneyRecord,
            };
        }

        const ucsCase = analyzeUcsCase(item);
        if (ucsCase) return ucsCase;

        const ofcLgoCase = analyzeOfcLgoCase(item);
        if (ofcLgoCase) return ofcLgoCase;

        const ucEpoCase = analyzeUcEpoCase(item);
        if (ucEpoCase) return ucEpoCase;

        return {
            right: item.hipdata_code || 'ไม่ระบุ',
            error: 'ไม่เข้าเกณฑ์ Monitor',
        };
    }, [analyzeUcsCase, analyzeOfcLgoCase, analyzeUcEpoCase]);

    const filteredData = useMemo(() => {
        return (Array.isArray(allKidneyData) ? allKidneyData : []).filter((item) => {
            // Filter by active monitor type
            if (activeMonitor === 'kidney') {
                // Backend returns only department 060 visits with dialysis evidence.
                if (!('insuranceGroup' in item && 'dialysisFee' in item)) return false;
            }

            // Filter by claim group (ucs, ofc, lgo, sss, other)
            if (filterRight !== 'all') {
                const category = getVisitClaimCategory(item);
                if (category !== filterRight) return false;
            }

            if (filterPatientRight !== 'all') {
                const patientRight = 'insuranceType' in item
                    ? String((item as unknown as KidneyMonitorRecord).insuranceType || '').trim()
                    : String(item.hipdata_code || '').trim();
                if (patientRight !== filterPatientRight) return false;
            }

            return true;
        });
    }, [allKidneyData, activeMonitor, filterRight, filterPatientRight]);

    const stmCounts = useMemo(() => {
        const records = filteredData as KidneyMonitorRecord[];
        return {
            all: records.length,
            received: records.filter((row) => row.stmFound).length,
            waiting: records.filter((row) => row.repFound && !row.stmFound).length,
            'no-rep': records.filter((row) => !row.repFound && !row.stmFound).length,
        };
    }, [filteredData]);

    const visibleData = useMemo(() => {
        const query = searchText.trim().toLocaleLowerCase('th');
        return filteredData.filter((item) => {
            const row = item as KidneyMonitorRecord;
            if (stmView === 'received' && !row.stmFound) return false;
            if (stmView === 'waiting' && (!row.repFound || row.stmFound)) return false;
            if (stmView === 'no-rep' && (row.repFound || row.stmFound)) return false;
            if (!query) return true;
            return [row.hn, row.vn, row.patientName, ...(row.repNos || []), ...(row.stmNos || [])]
                .some((value) => String(value || '').toLocaleLowerCase('th').includes(query));
        });
    }, [filteredData, searchText, stmView]);

    const patientRightOptions = useMemo(() => {
        const set = new Set<string>();
        (Array.isArray(allKidneyData) ? allKidneyData : []).forEach((item) => {
            const right = 'insuranceType' in item
                ? String((item as unknown as KidneyMonitorRecord).insuranceType || '').trim()
                : String(item.hipdata_code || '').trim();
            if (right) set.add(right);
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
    }, [allKidneyData]);

    // สรุปยอดรวมแยกตามกลุ่มสิทธิ 5 กลุ่ม (UCS, OFC, LGO, SSS, OTHER) + ภาพรวม
    const rightSummaries = useMemo(() => {
        const list = (Array.isArray(allKidneyData) ? allKidneyData : []).filter((item) => {
            if (activeMonitor === 'kidney') {
                return 'insuranceGroup' in item && 'dialysisFee' in item;
            }
            return true;
        });

        const initialCategory = () => ({
            count: 0,
            revenue: 0,
            costTotal: 0,
            profit: 0,
            repAmount: 0,
            stmPaidAmount: 0,
            repCount: 0,
            stmCount: 0,
        });

        const byCat: Record<Exclude<ClaimCategoryKey, 'all'>, ReturnType<typeof initialCategory>> = {
            ucs: initialCategory(),
            ofc: initialCategory(),
            lgo: initialCategory(),
            sss: initialCategory(),
            other: initialCategory(),
        };

        const overall = initialCategory();

        list.forEach((item) => {
            const cat = getVisitClaimCategory(item);
            const row = item as KidneyMonitorRecord;
            const rev = Number(row.revenue ?? item.revenue ?? 0);
            const cost = Number(row.costTotal ?? item.costTotal ?? 0);
            const prof = Number(row.profit ?? item.profit ?? (rev - cost));
            const rep = Number(row.repAmount ?? 0);
            const stm = Number(row.stmPaidAmount ?? 0);

            byCat[cat].count += 1;
            byCat[cat].revenue += rev;
            byCat[cat].costTotal += cost;
            byCat[cat].profit += prof;
            byCat[cat].repAmount += rep;
            byCat[cat].stmPaidAmount += stm;
            if (row.repFound) byCat[cat].repCount += 1;
            if (row.stmFound) byCat[cat].stmCount += 1;

            overall.count += 1;
            overall.revenue += rev;
            overall.costTotal += cost;
            overall.profit += prof;
            overall.repAmount += rep;
            overall.stmPaidAmount += stm;
            if (row.repFound) overall.repCount += 1;
            if (row.stmFound) overall.stmCount += 1;
        });

        return { byCat, overall };
    }, [allKidneyData, activeMonitor]);

    const currentFilteredSummary = useMemo(() => {
        let count = 0;
        let revenue = 0;
        let costTotal = 0;
        let profit = 0;
        let repAmount = 0;
        let stmPaidAmount = 0;

        visibleData.forEach((item) => {
            const row = item as KidneyMonitorRecord;
            count += 1;
            revenue += Number(row.revenue ?? item.revenue ?? 0);
            costTotal += Number(row.costTotal ?? item.costTotal ?? 0);
            profit += Number(row.profit ?? item.profit ?? 0);
            repAmount += Number(row.repAmount ?? 0);
            stmPaidAmount += Number(row.stmPaidAmount ?? 0);
        });

        return { count, revenue, costTotal, profit, repAmount, stmPaidAmount };
    }, [visibleData]);

    const handleExportExcel = useCallback(() => {
        if (!visibleData.length) return;

        const workbook = XLSX.utils.book_new();
        const rows = visibleData.map((item, index) => {
            const analysis = getAnalysis(item);
            const isKidneyRecord = 'insuranceType' in item && 'dialysisFee' in item;
            const kidneyRecord = isKidneyRecord ? (item as unknown as KidneyMonitorRecord) : null;
            const dateValue = isKidneyRecord && kidneyRecord ? kidneyRecord.serviceDate : item.serviceDate;
            const rightValue = isKidneyRecord && kidneyRecord
                ? kidneyRecord.insuranceType
                : analysis.right || item.hipdata_code || '-';
            const groupValue = isKidneyRecord && kidneyRecord
                ? kidneyRecord.insuranceGroup
                : analysis.category || '-';
            const claimCat = getVisitClaimCategory(item);
            const claimCatLabel = CLAIM_CATEGORY_CONFIG[claimCat]?.label || claimCat;

            return {
                ลำดับ: index + 1,
                VN: item.vn || kidneyRecord?.vn || '-',
                HN: item.hn || kidneyRecord?.hn || '-',
                ชื่อผู้ป่วย: item.ptname || kidneyRecord?.patientName || '-',
                กลุ่มสิทธิหลัก: claimCatLabel,
                สิทธิการรักษา: rightValue,
                กลุ่มสิทธิ_เดิม: groupValue,
                วันที่รับบริการ: dateValue || '-',
                ยอดเงิน_Visit: Number(
                    isKidneyRecord && kidneyRecord
                        ? kidneyRecord.revenue
                        : item.revenue ?? analysis.totalCost ?? analysis.totalAmount ?? 0
                ),
                ต้นทุน: Number(
                    isKidneyRecord && kidneyRecord
                        ? kidneyRecord.costTotal
                        : item.costTotal ?? analysis.epoPayment ?? analysis.totalAmount ?? 0
                ),
                กำไร: Number(
                    isKidneyRecord && kidneyRecord
                        ? kidneyRecord.profit
                        : item.profit ?? analysis.profit ?? 0
                ),
                สถานะ: analysis.error ? analysis.error : (analysis.category || 'ปกติ'),
                สถานะ_REP_STM: kidneyRecord?.claimTrackingStatus ? CLAIM_TRACKING_LABELS[kidneyRecord.claimTrackingStatus].label : '-',
                เลข_REP: kidneyRecord?.repNos?.join(', ') || '-',
                ยอด_REP: Number(kidneyRecord?.repAmount || 0),
                เลข_STM: kidneyRecord?.stmNos?.join(', ') || '-',
                ยอดจ่าย_STM: Number(kidneyRecord?.stmPaidAmount || 0),
                ผลต่าง_REP_STM: Number(kidneyRecord?.repStmDiff || 0),
                Error_REP_STM: kidneyRecord?.repStmErrors?.join(', ') || '',
                หมายเหตุ: analysis.epoDetail || '',
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [
            { wch: 8 },
            { wch: 16 },
            { wch: 12 },
            { wch: 28 },
            { wch: 18 },
            { wch: 18 },
            { wch: 14 },
            { wch: 14 },
            { wch: 14 },
            { wch: 14 },
            { wch: 14 },
            { wch: 20 },
            { wch: 18 },
            { wch: 18 },
            { wch: 14 },
            { wch: 18 },
            { wch: 14 },
            { wch: 14 },
            { wch: 24 },
            { wch: 34 },
        ];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'SpecialMonitor');

        const safeRight = RIGHT_LABEL_MAP[filterRight] || filterRight;
        const filename = [
            'special-monitor',
            activeMonitor,
            safeRight.replace(/\s+/g, '_'),
            (filterPatientRight === 'all' ? 'all_patient_rights' : filterPatientRight.replace(/\s+/g, '_')),
            stmView,
            startDate,
            endDate,
        ].join('_');

        XLSX.writeFile(workbook, `${filename}.xlsx`);
    }, [activeMonitor, endDate, filterRight, filterPatientRight, visibleData, getAnalysis, startDate, stmView]);

    // Calculate category summary by insurance type
    const calculateCategorySummary = (insuranceType: 'UCS+SSS' | 'OFC+LGO' | 'UC-EPO') => {
        const recordsByType = filteredData.filter((item) => {
            if ('insuranceGroup' in item) {
                return (item as unknown as KidneyMonitorRecord).insuranceGroup === insuranceType;
            }
            return false;
        });

        return {
            drugs: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('drugTotalSale' in item) {
                    return sum + (item.drugTotalSale as number);
                }
                return sum;
            }, 0),
            drugsCost: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('drugTotalCost' in item) {
                    return sum + (item.drugTotalCost as number);
                }
                return sum;
            }, 0),
            labs: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('labTotalSale' in item) {
                    return sum + (item.labTotalSale as number);
                }
                return sum;
            }, 0),
            labsCost: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('labTotalCost' in item) {
                    return sum + (item.labTotalCost as number);
                }
                return sum;
            }, 0),
            dialysis: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('dialysisFee' in item) {
                    return sum + (item.dialysisFee as number);
                }
                return sum;
            }, 0),
            dialysisCost: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('dialysisCost' in item) {
                    return sum + (item.dialysisCost as number);
                }
                return sum;
            }, 0),
            service: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('revenue' in item && 'drugTotalSale' in item && 'labTotalSale' in item) {
                    const service = (item.revenue as number) - (item.drugTotalSale as number) - (item.labTotalSale as number);
                    return sum + service;
                }
                return sum;
            }, 0),
            serviceCost: recordsByType.reduce((sum: number, item: MonitorItem) => {
                if ('costTotal' in item && 'drugTotalCost' in item && 'labTotalCost' in item) {
                    const serviceCost = (item.costTotal as number) - (item.drugTotalCost as number) - (item.labTotalCost as number);
                    return sum + serviceCost;
                }
                return sum;
            }, 0),
            totalRevenue: recordsByType.reduce((sum: number, item: MonitorItem) => sum + (Number(item.revenue) || 0), 0),
            totalCost: recordsByType.reduce((sum: number, item: MonitorItem) => sum + (Number(item.costTotal) || 0), 0),
            totalProfit: recordsByType.reduce((sum: number, item: MonitorItem) => sum + (Number(item.profit) || 0), 0),
            count: recordsByType.length,
        };
    };

    // Get category summaries for each insurance type
    // OFC+LGO is strictly matched
    const ofcLgoSummary = calculateCategorySummary('OFC+LGO');

    // UCS+SSS becomes the "catch-all" for everything else (UCS, SSS, UC-EPO, OTHER)
    const baseUcsSummary = calculateCategorySummary('UCS+SSS');
    const ucEpoSummary = calculateCategorySummary('UC-EPO');
    
    // Group everything else into 'OTHER'
    const otherData = filteredData.filter(item => {
        if ('insuranceGroup' in item) {
            const group = (item as unknown as KidneyMonitorRecord).insuranceGroup;
            return group === 'OTHER' || !['UCS+SSS', 'OFC+LGO', 'UC-EPO'].includes(group);
        }
        return true;
    });

    const otherSummary = {
        totalRevenue: otherData.reduce((sum, item) => sum + (Number(item.revenue) || 0), 0),
        totalCost: otherData.reduce((sum, item) => sum + (Number(item.costTotal) || 0), 0),
        totalProfit: otherData.reduce((sum, item) => sum + (Number(item.profit) || 0), 0),
        count: otherData.length,
        dialysisCost: otherData.reduce((sum, item) => sum + (Number(item.dialysisFee) || 0), 0), // Not really used for other but good for safety
        drugsCost: otherData.reduce((sum, item) => sum + (Number(item.drugTotalCost) || 0), 0),
        labsCost: otherData.reduce((sum, item) => sum + (Number(item.labTotalCost) || 0), 0),
        serviceCost: otherData.reduce((sum, item) => sum + (Number((item as any).serviceCost) || 0), 0),
        dialysis: 0, drugs: 0, labs: 0, service: 0 // placeholders
    };

    // Composite UCS+SSS Summary
    const ucsSssSummary = {
        count: baseUcsSummary.count + ucEpoSummary.count + otherSummary.count,
        totalRevenue: baseUcsSummary.totalRevenue + ucEpoSummary.totalRevenue + otherSummary.totalRevenue,
        totalCost: baseUcsSummary.totalCost + ucEpoSummary.totalCost + otherSummary.totalCost,
        totalProfit: baseUcsSummary.totalProfit + ucEpoSummary.totalProfit + otherSummary.totalProfit,
        // Breakdown fields for the gain/loss summary boxes
        dialysisCost: baseUcsSummary.dialysisCost + ucEpoSummary.dialysisCost + otherSummary.dialysisCost,
        drugsCost: baseUcsSummary.drugsCost + ucEpoSummary.drugsCost + otherSummary.drugsCost,
        labsCost: baseUcsSummary.labsCost + ucEpoSummary.labsCost + otherSummary.labsCost,
        serviceCost: baseUcsSummary.serviceCost + ucEpoSummary.serviceCost + otherSummary.serviceCost,
        dialysis: baseUcsSummary.dialysis + ucEpoSummary.dialysis,
        drugs: baseUcsSummary.drugs + ucEpoSummary.drugs,
        labs: baseUcsSummary.labs + ucEpoSummary.labs,
        service: baseUcsSummary.service + ucEpoSummary.service,
        // Keep separate counts for the card sub-labels
        identifiedCount: baseUcsSummary.count,
        otherCount: ucEpoSummary.count + otherSummary.count
    };

    const trackingRightCards: Array<{
        key: Exclude<KidneyTrackingRight, 'other'>;
        label: string;
        code: string;
        color: string;
        background: string;
    }> = [
        { key: 'civilServant', label: 'ขรก.', code: 'OFC', color: '#7c3aed', background: '#f3e8ff' },
        { key: 'socialSecurity', label: 'ปกส.', code: 'SSS', color: '#0284c7', background: '#e0f2fe' },
        { key: 'nhso', label: 'สปสช.', code: 'UCS/UC', color: '#059669', background: '#d1fae5' },
        { key: 'localGovernment', label: 'อปท.', code: 'LGO', color: '#d97706', background: '#fef3c7' },
    ];

    const trackingRightLabels: Record<KidneyTrackingRight, string> = {
        civilServant: 'ขรก.',
        socialSecurity: 'ปกส.',
        nhso: 'สปสช.',
        localGovernment: 'อปท.',
        other: 'อื่น/ไม่ระบุ',
    };

    const trackingIssueLabels: Record<KidneyTrackingIssueKind, { label: string; color: string; background: string }> = {
        RIGHT_CHANGED: { label: 'สิทธิ์เปลี่ยนภายในช่วง', color: '#b91c1c', background: '#fee2e2' },
        MISSING_EVIDENCE: { label: 'หลักฐานฟอกไตไม่ครบ', color: '#b45309', background: '#fef3c7' },
        UNKNOWN_RIGHT: { label: 'สิทธิ์อื่น/ไม่ระบุ', color: '#7c3aed', background: '#f3e8ff' },
        MISSING_HN: { label: 'ไม่มี HN', color: '#be123c', background: '#ffe4e6' },
    };

    return (
        <div style={{ padding: '20px', width: '100%', maxWidth: 'var(--content-max)', margin: '0 auto' }}>            {/* Header */}
            <div style={{ marginBottom: '30px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '10px' }}>
                    📊 รายการมอนิเตอร์พิเศษ
                </h1>
                <p style={{ color: '#666', fontSize: '14px' }}>
                    ตรวจสอบการเบิกจ่ายสำหรับกลุ่มผู้ป่วยพิเศษ
                </p>
                <p style={{ color: '#94a3b8', fontSize: '12px', marginTop: 4 }}>
                    สถานพยาบาล: {hospitalName}
                </p>
            </div>

            <nav className="special-monitor-nav" aria-label="ประเภทมอนิเตอร์">
                {monitorCategories.map((category) => (
                    <button
                        key={category.id}
                        type="button"
                        className={activeMonitor === category.id ? 'special-monitor-nav-item active' : 'special-monitor-nav-item'}
                        aria-current={activeMonitor === category.id ? 'page' : undefined}
                        onClick={() => setActiveMonitor(category.id)}
                    >
                        <span aria-hidden="true">{category.icon}</span> {category.name}
                    </button>
                ))}
            </nav>

            {/* Dialysis Service Summary Section - shown for kidney monitor */}
            {activeMonitor === 'kidney' && (
                <>
                    {dataMeta?.trackingSummary && (
                        <details className="special-monitor-details">
                            <summary>สรุป Session ตามสิทธิ์ · {dataMeta.trackingSummary.totalSessions.toLocaleString('th-TH')} visit</summary>
                        <div
                            style={{
                                background: 'white',
                                padding: '20px',
                                borderRadius: '8px',
                                marginTop: '30px',
                                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                            }}
                        >
                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#333' }}>
                                📋 สรุป Session หน่วยไตตาม 4 สิทธิ
                            </div>
                            <div style={{ color: '#64748b', fontSize: '12px', marginTop: 5, lineHeight: 1.6 }}>
                                นับทุก visit ที่มารับบริการหน่วยไต (main_dep 060) ในช่วงวันที่ โดยสรุปและตารางด้านล่างใช้ visit ชุดเดียวกัน
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginTop: '16px' }}>
                                {trackingRightCards.map((card) => {
                                    const value = dataMeta.trackingSummary!.byRight[card.key];
                                    return (
                                        <div key={card.key} style={{ padding: '14px', borderRadius: '8px', borderLeft: `4px solid ${card.color}`, background: card.background }}>
                                            <div style={{ fontSize: '12px', fontWeight: 700, color: card.color }}>{card.label} <span style={{ opacity: 0.75 }}>({card.code})</span></div>
                                            <div style={{ fontSize: '24px', fontWeight: 800, color: card.color, marginTop: 5 }}>{value.sessions.toLocaleString('th-TH')}</div>
                                            <div style={{ fontSize: '11px', color: '#475569' }}>session · {value.patients.toLocaleString('th-TH')} คน</div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginTop: '14px', padding: '12px 14px', borderRadius: '8px', background: '#f8fafc', color: '#475569', fontSize: '12px' }}>
                                <strong>รวม {dataMeta.trackingSummary.totalSessions.toLocaleString('th-TH')} session / {dataMeta.trackingSummary.totalPatients.toLocaleString('th-TH')} คน</strong>
                                <span>แสดงรายละเอียดครบ {dataMeta.returned.toLocaleString('th-TH')} visit</span>
                                <span style={{ color: (dataMeta.excludedWithoutEvidence || 0) > 0 ? '#b45309' : '#15803d' }}>
                                    ต้องตรวจหลักฐาน N185/Z49/รายการฟอกไต {(dataMeta.excludedWithoutEvidence || 0).toLocaleString('th-TH')} visit (ยังรวมในยอด)
                                </span>
                                {dataMeta.trackingSummary.byRight.other.sessions > 0 && (
                                    <span style={{ color: '#dc2626' }}>สิทธิอื่น/ไม่ระบุ {dataMeta.trackingSummary.byRight.other.sessions.toLocaleString('th-TH')} session</span>
                                )}
                            </div>
                            {dataMeta.trackingIssues && (
                                <div style={{ marginTop: '16px', border: `1px solid ${dataMeta.trackingIssues.total > 0 ? '#fecaca' : '#bbf7d0'}`, borderRadius: '8px', overflow: 'hidden' }}>
                                    <div style={{ padding: '12px 14px', background: dataMeta.trackingIssues.total > 0 ? '#fff7ed' : '#f0fdf4' }}>
                                        <div style={{ fontWeight: 800, color: dataMeta.trackingIssues.total > 0 ? '#9a3412' : '#166534', fontSize: '13px' }}>
                                            {dataMeta.trackingIssues.total > 0 ? `⚠️ จุดที่ต้องตรวจสอบ ${dataMeta.trackingIssues.total.toLocaleString('th-TH')} รายการ` : '✅ ไม่พบจุดผิดปกติจากการตรวจสอบอัตโนมัติ'}
                                        </div>
                                        {dataMeta.trackingIssues.total > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '7px', color: '#7c2d12', fontSize: '11px' }}>
                                                <span>สิทธิ์เปลี่ยน {dataMeta.trackingIssues.rightChanged.toLocaleString('th-TH')} คน</span>
                                                <span>หลักฐานไม่ครบ {dataMeta.trackingIssues.missingEvidence.toLocaleString('th-TH')} visit</span>
                                                <span>สิทธิ์อื่น/ไม่ระบุ {dataMeta.trackingIssues.unknownRight.toLocaleString('th-TH')} visit</span>
                                                {dataMeta.trackingIssues.missingHn > 0 && <span>ไม่มี HN {dataMeta.trackingIssues.missingHn.toLocaleString('th-TH')} visit</span>}
                                            </div>
                                        )}
                                    </div>
                                    {dataMeta.trackingIssues.issues.length > 0 && (
                                        <div style={{ overflowX: 'auto', maxHeight: '360px', overflowY: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                                                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', color: '#475569' }}>
                                                    <tr>
                                                        <th style={{ padding: '9px', textAlign: 'left' }}>จุดที่พบ</th>
                                                        <th style={{ padding: '9px', textAlign: 'left' }}>HN</th>
                                                        <th style={{ padding: '9px', textAlign: 'left' }}>ชื่อ-สกุล</th>
                                                        <th style={{ padding: '9px', textAlign: 'left' }}>วันที่และสิทธิ์ของ visit</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {dataMeta.trackingIssues.issues.map((issue, issueIndex) => {
                                                        const issueStyle = trackingIssueLabels[issue.kind];
                                                        return (
                                                            <tr key={`${issue.kind}-${issue.hn}-${issueIndex}`} style={{ borderTop: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                                                                <td style={{ padding: '9px' }}>
                                                                    <span style={{ display: 'inline-block', padding: '3px 7px', borderRadius: '999px', fontWeight: 700, color: issueStyle.color, background: issueStyle.background }}>{issueStyle.label}</span>
                                                                </td>
                                                                <td style={{ padding: '9px', fontWeight: 700 }}>{issue.hn || '-'}</td>
                                                                <td style={{ padding: '9px' }}>{issue.patientName || '-'}</td>
                                                                <td style={{ padding: '9px', color: '#475569', lineHeight: 1.6 }}>
                                                                    {issue.visits.map((visit) => `${visit.serviceDate || '-'} · ${visit.hipdataCode || trackingRightLabels[visit.right]}${visit.vn ? ` (VN ${visit.vn})` : ''}`).join(', ')}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        </details>
                    )}
                    {dataMeta?.repstmSummary && (
                        <div className="special-monitor-amounts">
                            <span>ยอดรวมทั้งช่วงวันที่</span>
                            <span>REP <strong>฿{dataMeta.repstmSummary.repAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong></span>
                            <span>STM จ่ายรวม <strong>฿{dataMeta.repstmSummary.stmPaidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong></span>
                            <span>ผลต่าง <strong>฿{dataMeta.repstmSummary.amountDiff.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong></span>
                        </div>
                    )}
                    <details className="special-monitor-details">
                        <summary>ดูรายละเอียดรายรับ ต้นทุน และกำไรตามสิทธิ์</summary>
                    <div
                        style={{
                            background: 'white',
                            padding: '20px',
                            borderRadius: '8px',
                            marginTop: '30px',
                            marginBottom: '30px',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                        }}
                    >
                        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '15px', color: '#333' }}>
                            🏥 ค่าล้างไต (Dialysis Service) - สรุปตามประเภทสิทธิ์
                        </div>

                        {/* UCS + SSS Dialysis */}
                        {ucsSssSummary.count > 0 && (
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: '#2196f3', marginBottom: '12px', paddingBottom: '8px', borderBottom: '2px solid #2196f3' }}>
                                    💙 UCS + SSS - ค่าล้างไต
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                                    <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '6px', borderLeft: '3px solid #2196f3' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#2196f3', marginBottom: '4px' }}>📊 จำนวน visit</div>
                                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#2196f3' }}>
                                            {ucsSssSummary.count}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                            ระบุสิทธิ์ชัดเจน: {ucsSssSummary.identifiedCount} | อื่นๆ/ไม่ระบุ: {ucsSssSummary.otherCount}
                                        </div>
                                    </div>
                                    {/* Real Revenue */}
                                    <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '6px', borderLeft: '3px solid #2196f3' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#2196f3', marginBottom: '4px' }}>💰 รายรับรวม (Revenue)</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#2196f3', marginBottom: '4px' }}>
                                            ฿{ucsSssSummary.totalRevenue.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666' }}>รวมทุกบริการในกลุ่ม</div>
                                    </div>
                                    {/* Real Cost */}
                                    <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: '6px', borderLeft: '3px solid #999' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', marginBottom: '4px' }}>💸 ต้นทุนรวม (Cost)</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#999', marginBottom: '4px' }}>
                                            ฿{ucsSssSummary.totalCost.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666' }}>รวมต้นทุนทุกหมวด</div>
                                    </div>
                                    {/* Real Profit */}
                                    <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '6px', borderLeft: '3px solid #4caf50' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#4caf50', marginBottom: '4px' }}>📈 กำไรสุทธิ (Profit)</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#4caf50', marginBottom: '4px' }}>
                                            ฿{ucsSssSummary.totalProfit.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666' }}>รายรับ - ต้นทุนจริง</div>
                                    </div>
                                </div>

                                {/* Cost & Profit Breakdown */}
                                <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '2px solid #e0e0e0' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#555', marginBottom: '12px' }}>
                                        📊 ทุนและกำไรตามประเภท
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                        {/* Cost Breakdown */}
                                        <div style={{ padding: '12px', background: '#fff5e6', borderRadius: '6px', border: '1px solid #ffe0b2' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#e65100', marginBottom: '10px' }}>💸 ทุน (Cost) รวมทั้งหมด</div>
                                            <div style={{ fontSize: '13px', fontWeight: 800, color: '#e65100', marginBottom: '8px' }}>
                                                ฿{(ucsSssSummary.dialysisCost + ucsSssSummary.drugsCost + ucsSssSummary.labsCost + ucsSssSummary.serviceCost).toLocaleString()}
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.6' }}>
                                                <div>ค่าล้างไต: ฿{ucsSssSummary.dialysisCost.toLocaleString()}</div>
                                                <div>ยา: ฿{ucsSssSummary.drugsCost.toLocaleString()}</div>
                                                <div>แลป: ฿{ucsSssSummary.labsCost.toLocaleString()}</div>
                                                <div>บริการ: ฿{ucsSssSummary.serviceCost.toLocaleString()}</div>
                                            </div>
                                        </div>

                                        {/* Profit Breakdown */}
                                        <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '6px', border: '1px solid #a5d6a7' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#2e7d32', marginBottom: '10px' }}>📈 กำไร (Profit) รวมทั้งหมด</div>
                                            <div style={{ fontSize: '13px', fontWeight: 800, color: '#2e7d32', marginBottom: '8px' }}>
                                                ฿{(ucsSssSummary.dialysis + ucsSssSummary.drugs + ucsSssSummary.labs + ucsSssSummary.service - (ucsSssSummary.dialysisCost + ucsSssSummary.drugsCost + ucsSssSummary.labsCost + ucsSssSummary.serviceCost)).toLocaleString()}
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.6' }}>
                                                <div>ค่าล้างไต: ฿{(ucsSssSummary.dialysis - ucsSssSummary.dialysisCost).toLocaleString()}</div>
                                                <div>ยา: ฿{(ucsSssSummary.drugs - ucsSssSummary.drugsCost).toLocaleString()}</div>
                                                <div>แลป: ฿{(ucsSssSummary.labs - ucsSssSummary.labsCost).toLocaleString()}</div>
                                                <div>บริการ: ฿{(ucsSssSummary.service - ucsSssSummary.serviceCost).toLocaleString()}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Drugs & Labs & Service Summary */}
                                <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                                        {/* Drugs */}
                                        {ucsSssSummary.drugs > 0 && (
                                            <div style={{ padding: '12px', background: '#fce4ec', borderRadius: '6px', borderLeft: '3px solid #e91e63' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#e91e63', marginBottom: '4px' }}>💊 ยา (Drugs)</div>
                                                <div style={{ fontSize: '14px', fontWeight: 800, color: '#e91e63', marginBottom: '2px' }}>
                                                    ฿{ucsSssSummary.drugs.toLocaleString()}
                                                </div>
                                                <div style={{ fontSize: '9px', color: '#666' }}>เบิก: {ucsSssSummary.drugs.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#999' }}>ทุน: {ucsSssSummary.drugsCost.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#d81b60', fontWeight: 700 }}>กำไร: ฿{(ucsSssSummary.drugs - ucsSssSummary.drugsCost).toLocaleString()}</div>
                                            </div>
                                        )}
                                        
                                        {/* Labs */}
                                        {ucsSssSummary.labs > 0 && (
                                            <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '6px', borderLeft: '3px solid #2e7d32' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#2e7d32', marginBottom: '4px' }}>🔬 แลป (Labs)</div>
                                                <div style={{ fontSize: '14px', fontWeight: 800, color: '#2e7d32', marginBottom: '2px' }}>
                                                    ฿{ucsSssSummary.labs.toLocaleString()}
                                                </div>
                                                <div style={{ fontSize: '9px', color: '#666' }}>เบิก: {ucsSssSummary.labs.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#999' }}>ทุน: {ucsSssSummary.labsCost.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#1b5e20', fontWeight: 700 }}>กำไร: ฿{(ucsSssSummary.labs - ucsSssSummary.labsCost).toLocaleString()}</div>
                                            </div>
                                        )}
                                        
                                        {/* Service */}
                                        {ucsSssSummary.service > 0 && (
                                            <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '6px', borderLeft: '3px solid #f57c00' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f57c00', marginBottom: '4px' }}>🏥 บริการ (Service)</div>
                                                <div style={{ fontSize: '14px', fontWeight: 800, color: '#f57c00', marginBottom: '2px' }}>
                                                    ฿{ucsSssSummary.service.toLocaleString()}
                                                </div>
                                                <div style={{ fontSize: '9px', color: '#666' }}>เบิก: {ucsSssSummary.service.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#999' }}>ทุน: {ucsSssSummary.serviceCost.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#e65100', fontWeight: 700 }}>กำไร: ฿{(ucsSssSummary.service - ucsSssSummary.serviceCost).toLocaleString()}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* OFC + LGO Dialysis */}
                        {ofcLgoSummary.count > 0 && (
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: '#9c27b0', marginBottom: '12px', paddingBottom: '8px', borderBottom: '2px solid #9c27b0' }}>
                                    💜 OFC + LGO - ค่าล้างไต
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                                    <div style={{ padding: '12px', background: '#f3e5f5', borderRadius: '6px', borderLeft: '3px solid #9c27b0' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#9c27b0', marginBottom: '4px' }}>📊 จำนวน visit</div>
                                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#9c27b0' }}>
                                            {ofcLgoSummary.count}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                            ผู้ป่วยห้องไตเทียม (ล้างไตจริง: {filteredData.filter((item) => {
                                                if ('insuranceGroup' in item) {
                                                    return (item as unknown as KidneyMonitorRecord).insuranceGroup === 'OFC+LGO' && 'dialysisFee' in item && (item.dialysisFee as number) > 0;
                                                }
                                                return false;
                                            }).length})
                                        </div>
                                    </div>
                                    {/* Real Revenue */}
                                    <div style={{ padding: '12px', background: '#f3e5f5', borderRadius: '6px', borderLeft: '3px solid #9c27b0' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#9c27b0', marginBottom: '4px' }}>💰 รายรับรวม (Revenue)</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#9c27b0', marginBottom: '4px' }}>
                                            ฿{ofcLgoSummary.totalRevenue.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666' }}>รวมทุกบริการในกลุ่ม</div>
                                    </div>
                                    {/* Real Cost */}
                                    <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: '6px', borderLeft: '3px solid #999' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', marginBottom: '4px' }}>💸 ต้นทุนรวม (Cost)</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#999', marginBottom: '4px' }}>
                                            ฿{ofcLgoSummary.totalCost.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666' }}>รวมต้นทุนทุกหมวด</div>
                                    </div>
                                    {/* Real Profit */}
                                    <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '6px', borderLeft: '3px solid #4caf50' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#4caf50', marginBottom: '4px' }}>📈 กำไรสุทธิ (Profit)</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#4caf50', marginBottom: '4px' }}>
                                            ฿{ofcLgoSummary.totalProfit.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#666' }}>รายรับ - ต้นทุนจริง</div>
                                    </div>
                                </div>

                                {/* Cost & Profit Breakdown */}
                                <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '2px solid #e0e0e0' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#555', marginBottom: '12px' }}>
                                        📊 ทุนและกำไรตามประเภท
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                        {/* Cost Breakdown */}
                                        <div style={{ padding: '12px', background: '#fff5e6', borderRadius: '6px', border: '1px solid #ffe0b2' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#e65100', marginBottom: '10px' }}>💸 ทุน (Cost) รวมทั้งหมด</div>
                                            <div style={{ fontSize: '13px', fontWeight: 800, color: '#e65100', marginBottom: '8px' }}>
                                                ฿{(ofcLgoSummary.dialysisCost + ofcLgoSummary.drugsCost + ofcLgoSummary.labsCost + ofcLgoSummary.serviceCost).toLocaleString()}
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.6' }}>
                                                <div>ค่าล้างไต: ฿{ofcLgoSummary.dialysisCost.toLocaleString()}</div>
                                                <div>ยา: ฿{ofcLgoSummary.drugsCost.toLocaleString()}</div>
                                                <div>แลป: ฿{ofcLgoSummary.labsCost.toLocaleString()}</div>
                                                <div>บริการ: ฿{ofcLgoSummary.serviceCost.toLocaleString()}</div>
                                            </div>
                                        </div>

                                        {/* Profit Breakdown */}
                                        <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '6px', border: '1px solid #a5d6a7' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#2e7d32', marginBottom: '10px' }}>📈 กำไร (Profit) รวมทั้งหมด</div>
                                            <div style={{ fontSize: '13px', fontWeight: 800, color: '#2e7d32', marginBottom: '8px' }}>
                                                ฿{(ofcLgoSummary.dialysis + ofcLgoSummary.drugs + ofcLgoSummary.labs + ofcLgoSummary.service - (ofcLgoSummary.dialysisCost + ofcLgoSummary.drugsCost + ofcLgoSummary.labsCost + ofcLgoSummary.serviceCost)).toLocaleString()}
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.6' }}>
                                                <div>ค่าล้างไต: ฿{(ofcLgoSummary.dialysis - ofcLgoSummary.dialysisCost).toLocaleString()}</div>
                                                <div>ยา: ฿{(ofcLgoSummary.drugs - ofcLgoSummary.drugsCost).toLocaleString()}</div>
                                                <div>แลป: ฿{(ofcLgoSummary.labs - ofcLgoSummary.labsCost).toLocaleString()}</div>
                                                <div>บริการ: ฿{(ofcLgoSummary.service - ofcLgoSummary.serviceCost).toLocaleString()}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Drugs & Labs & Service Summary */}
                                <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                                        {/* Drugs */}
                                        {ofcLgoSummary.drugs > 0 && (
                                            <div style={{ padding: '12px', background: '#fce4ec', borderRadius: '6px', borderLeft: '3px solid #e91e63' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#e91e63', marginBottom: '4px' }}>💊 ยา (Drugs)</div>
                                                <div style={{ fontSize: '14px', fontWeight: 800, color: '#e91e63', marginBottom: '2px' }}>
                                                    ฿{ofcLgoSummary.drugs.toLocaleString()}
                                                </div>
                                                <div style={{ fontSize: '9px', color: '#666' }}>เบิก: {ofcLgoSummary.drugs.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#999' }}>ทุน: {ofcLgoSummary.drugsCost.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#d81b60', fontWeight: 700 }}>กำไร: ฿{(ofcLgoSummary.drugs - ofcLgoSummary.drugsCost).toLocaleString()}</div>
                                            </div>
                                        )}
                                        
                                        {/* Labs */}
                                        {ofcLgoSummary.labs > 0 && (
                                            <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '6px', borderLeft: '3px solid #2e7d32' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#2e7d32', marginBottom: '4px' }}>🔬 แลป (Labs)</div>
                                                <div style={{ fontSize: '14px', fontWeight: 800, color: '#2e7d32', marginBottom: '2px' }}>
                                                    ฿{ofcLgoSummary.labs.toLocaleString()}
                                                </div>
                                                <div style={{ fontSize: '9px', color: '#666' }}>เบิก: {ofcLgoSummary.labs.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#999' }}>ทุน: {ofcLgoSummary.labsCost.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#1b5e20', fontWeight: 700 }}>กำไร: ฿{(ofcLgoSummary.labs - ofcLgoSummary.labsCost).toLocaleString()}</div>
                                            </div>
                                        )}
                                        
                                        {/* Service */}
                                        {ofcLgoSummary.service > 0 && (
                                            <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '6px', borderLeft: '3px solid #f57c00' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f57c00', marginBottom: '4px' }}>🏥 บริการ (Service)</div>
                                                <div style={{ fontSize: '14px', fontWeight: 800, color: '#f57c00', marginBottom: '2px' }}>
                                                    ฿{ofcLgoSummary.service.toLocaleString()}
                                                </div>
                                                <div style={{ fontSize: '9px', color: '#666' }}>เบิก: {ofcLgoSummary.service.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#999' }}>ทุน: {ofcLgoSummary.serviceCost.toLocaleString()}</div>
                                                <div style={{ fontSize: '9px', color: '#e65100', fontWeight: 700 }}>กำไร: ฿{(ofcLgoSummary.service - ofcLgoSummary.serviceCost).toLocaleString()}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                    </details>
                </>
                )}

            {activeMonitor === 'chronic' && (
                <div style={{ padding: '20px', background: '#f5f5f5', borderRadius: '8px', marginBottom: '30px', textAlign: 'center', color: '#999' }}>
                    🚧 โรคเรื้อรัง (NCD) - ยังไม่พร้อมใช้งาน (Coming Soon)
                </div>
            )}            {activeMonitor === 'special' && (
                <OpReferMonitorPanel
                    startDate={startDate}
                    endDate={endDate}
                    onStartDateChange={setStartDate}
                    onEndDateChange={setEndDate}
                />
            )}

            {activeMonitor === 'kidney' && (
                <section className="special-monitor-workspace" aria-label="รายการติดตาม STM">
                    <div className="special-monitor-workspace-head">
                        <div>
                            <h2>รายการติดตาม STM</h2>
                            <p>แสดง visit หน่วยไตที่จับคู่ข้อมูล REP/STM ได้ในช่วงวันที่เลือก · ไฟล์นำเข้าที่ยังจับคู่ไม่ได้ดูได้ในหน้านำเข้า/ตรวจสอบ</p>
                        </div>
                        <div className="special-monitor-actions">
                            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'repstm' } }))}>ดูไฟล์นำเข้า REP/STM</button>
                            <button type="button" onClick={() => void fetchMonitorData()}>รีโหลด</button>
                            <button type="button" onClick={handleExportExcel} disabled={visibleData.length === 0}>ส่งออก Excel ({visibleData.length})</button>
                        </div>
                    </div>

                    {/* สรุปยอดรวมแยกตามกลุ่มสิทธิการรักษา (UCS, OFC, LGO, SSS, OTHER) */}
                    <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                                💳 สรุปยอดรวมแยกตามกลุ่มสิทธิ ({allKidneyData.length.toLocaleString('th-TH')} visit ทั้งหมดในช่วงวันที่)
                            </div>
                            {filterRight !== 'all' && (
                                <button
                                    type="button"
                                    onClick={() => setFilterRight('all')}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#2563eb',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        textDecoration: 'underline'
                                    }}
                                >
                                    ล้างตัวกรองสิทธิ (แสดงทั้งหมด)
                                </button>
                            )}
                        </div>
                        <div className="special-monitor-summary-grid">
                            {(['ucs', 'ofc', 'lgo', 'sss', 'other'] as const).map((catKey) => {
                                const conf = CLAIM_CATEGORY_CONFIG[catKey];
                                const sum = rightSummaries.byCat[catKey];
                                const isSelected = filterRight === catKey;
                                return (
                                    <div
                                        key={catKey}
                                        role="button"
                                        tabIndex={0}
                                        className={`special-monitor-summary-card ${isSelected ? 'active' : ''}`}
                                        style={{
                                            borderLeft: `4px solid ${conf.border}`,
                                            background: isSelected ? conf.background : '#ffffff',
                                        }}
                                        onClick={() => setFilterRight((prev) => prev === catKey ? 'all' : catKey)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setFilterRight((prev) => prev === catKey ? 'all' : catKey);
                                            }
                                        }}
                                        title={`คลิกเพื่อกรองเฉพาะกลุ่ม ${conf.label}`}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 700, color: conf.color }}>
                                                {conf.label} ({conf.code})
                                            </span>
                                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                                                {sum.count.toLocaleString('th-TH')} visit
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                                            ฿{sum.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span>ได้รับ STM:</span>
                                                <strong style={{ color: '#166534' }}>฿{sum.stmPaidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span>รอชดเชย REP:</span>
                                                <strong style={{ color: '#2563eb' }}>฿{sum.repAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #e2e8f0', paddingTop: '3px', marginTop: '2px' }}>
                                                <span>กำไรสุทธิ:</span>
                                                <strong style={{ color: sum.profit >= 0 ? '#166534' : '#b91c1c' }}>
                                                    ฿{sum.profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                                </strong>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="special-monitor-filters">
                        <label>เริ่มวันที่<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
                        <label>ถึงวันที่<input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></label>
                        <label>กลุ่มสิทธิ์
                            <select value={filterRight} onChange={(e) => setFilterRight(e.target.value as ClaimCategoryKey)}>
                                <option value="all">ทุกกลุ่มสิทธิ์ ({rightSummaries.overall.count.toLocaleString('th-TH')} visit · ฿{rightSummaries.overall.revenue.toLocaleString('th-TH', { minimumFractionDigits: 0 })})</option>
                                <option value="ucs">บัตรทอง (UCS) - {rightSummaries.byCat.ucs.count} visit (฿{rightSummaries.byCat.ucs.revenue.toLocaleString('th-TH', { minimumFractionDigits: 0 })})</option>
                                <option value="ofc">ข้าราชการ (OFC) - {rightSummaries.byCat.ofc.count} visit (฿{rightSummaries.byCat.ofc.revenue.toLocaleString('th-TH', { minimumFractionDigits: 0 })})</option>
                                <option value="lgo">อปท. (LGO) - {rightSummaries.byCat.lgo.count} visit (฿{rightSummaries.byCat.lgo.revenue.toLocaleString('th-TH', { minimumFractionDigits: 0 })})</option>
                                <option value="sss">ประกันสังคม (SSS) - {rightSummaries.byCat.sss.count} visit (฿{rightSummaries.byCat.sss.revenue.toLocaleString('th-TH', { minimumFractionDigits: 0 })})</option>
                                <option value="other">สิทธิอื่นๆ (Other) - {rightSummaries.byCat.other.count} visit (฿{rightSummaries.byCat.other.revenue.toLocaleString('th-TH', { minimumFractionDigits: 0 })})</option>
                            </select>
                        </label>
                        <label>สิทธิ์คนไข้
                            <select value={filterPatientRight} onChange={(e) => setFilterPatientRight(e.target.value)}>
                                <option value="all">ทุกสิทธิ์</option>
                                {patientRightOptions.map((right) => <option key={right} value={right}>{right}</option>)}
                            </select>
                        </label>
                        <label className="special-monitor-search">ค้นหา HN / VN / ชื่อ / เลข REP หรือ STM
                            <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="พิมพ์คำค้น" />
                        </label>
                    </div>

                    <div className="special-monitor-status-tabs" role="group" aria-label="สถานะ STM">
                        {(Object.keys(STM_VIEW_LABELS) as StmView[]).map((view) => (
                            <button
                                key={view}
                                type="button"
                                className={stmView === view ? 'active' : ''}
                                aria-pressed={stmView === view}
                                onClick={() => setStmView(view)}
                            >
                                {STM_VIEW_LABELS[view]} <strong>{stmCounts[view].toLocaleString('th-TH')}</strong>
                            </button>
                        ))}
                    </div>
                    <p className="special-monitor-result-count">
                        แสดง {visibleData.length.toLocaleString('th-TH')} จาก {stmCounts[stmView].toLocaleString('th-TH')} visit ในกลุ่มนี้{searchText.trim() ? ' หลังค้นหา' : ''}
                        {' · '}ยอดเงินรวม <strong>฿{currentFilteredSummary.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong>
                        {' · '}ชดเชย STM <strong>฿{currentFilteredSummary.stmPaidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong>
                        {' · '}รอ REP <strong>฿{currentFilteredSummary.repAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong>
                        {' · '}คลิกรายการเพื่อดูรายละเอียด
                    </p>
                </section>
            )}

            {/* Error & Loading */}
            {error && (
                <div style={{ padding: '15px', background: '#ffebee', color: '#c62828', borderRadius: '4px', marginBottom: '20px' }}>
                    ⚠️ {error}
                </div>
            )}

            {loading && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>⏳ กำลังโหลดข้อมูล...</div>
            )}

            {/* Truncation Warning Banner */}
            {!loading && dataMeta?.truncated && (
                <div style={{ padding: '12px 16px', background: '#fff3e0', color: '#e65100', borderRadius: '6px', marginBottom: '16px', border: '1px solid #ffb74d', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '18px' }}>⚠️</span>
                    <div>
                        <strong>ข้อมูลถูกตัดทอน</strong> — แสดง <strong>{dataMeta.returned.toLocaleString()}</strong> รายการ
                        จากทั้งหมด <strong>{dataMeta.total.toLocaleString()}</strong> รายการ
                        (เกิน safety limit 5,000)
                        <br />
                        <span style={{ fontSize: '12px', color: '#bf360c' }}>กรุณาแบ่งช่วงวันที่ให้สั้นลง หรือติดต่อทีม IT เพื่อเพิ่ม limit</span>
                    </div>
                </div>
            )}

            {activeMonitor === 'kidney' && !loading && visibleData.length > 0 && (
                <div className="special-monitor-table-wrap">
                    <table className="special-monitor-table">
                        <thead><tr>
                            <th>visit / ผู้ป่วย</th>
                            <th>สิทธิ์</th>
                            <th>ยอดเงิน Visit</th>
                            <th>REP</th>
                            <th>STM</th>
                            <th>ตรวจสอบ</th>
                        </tr></thead>
                        <tbody>
                            {visibleData.map((item, index) => {
                                const row = item as KidneyMonitorRecord;
                                const status = row.claimTrackingStatus ? CLAIM_TRACKING_LABELS[row.claimTrackingStatus] : null;
                                const claimCat = getVisitClaimCategory(row);
                                const claimConfig = CLAIM_CATEGORY_CONFIG[claimCat];
                                return (
                                    <tr key={`${row.vn || row.hn}-${row.serviceDate}-${index}`} role="button" aria-label={`ดูรายละเอียด visit ${row.vn || row.hn}`} onClick={() => setSelectedKidneyRecord(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedKidneyRecord(row); } }}>
                                        <td><strong>{row.patientName || '-'}</strong><small>{row.serviceDate || '-'} · HN {row.hn || '-'} · VN {row.vn || '-'}</small></td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span
                                                    className="special-monitor-right-badge"
                                                    style={{
                                                        color: claimConfig.color,
                                                        background: claimConfig.background,
                                                        borderColor: claimConfig.border,
                                                    }}
                                                >
                                                    {claimConfig.short}
                                                </span>
                                                <strong>{row.insuranceGroup || '-'}</strong>
                                            </div>
                                            <small>{row.insuranceType || '-'}</small>
                                        </td>
                                        <td>
                                            <strong style={{ color: '#0f172a', fontSize: '14px' }}>
                                                ฿{Number(row.revenue || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                            </strong>
                                            <small style={{ color: '#64748b' }}>
                                                ทุน ฿{Number(row.costTotal || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                                <span style={{ color: Number(row.profit || 0) >= 0 ? '#166534' : '#b91c1c', marginLeft: 4, fontWeight: 600 }}>
                                                    · กำไร ฿{Number(row.profit || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                                </span>
                                            </small>
                                        </td>
                                        <td>{row.repFound ? <><strong>฿{Number(row.repAmount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong><small>{row.repNos?.length ? `เลข ${row.repNos.join(', ')}` : 'พบ REP'}</small></> : <span className="special-monitor-muted">ยังไม่มี REP</span>}</td>
                                        <td>{row.stmFound ? <><span className="special-monitor-pill received">ได้รับ STM</span><strong>฿{Number(row.stmPaidAmount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong><small>{row.stmNos?.length ? `เลข ${row.stmNos.join(', ')}` : 'พบรายการ STM ที่จับคู่แล้ว'}</small></> : <span className="special-monitor-pill waiting">{row.repFound ? 'รอ STM' : 'รอ REP'}</span>}</td>
                                        <td>
                                            {status && <span className="special-monitor-pill" style={{ color: status.color, background: status.background }}>{status.label}</span>}
                                            {row.hasDialysisEvidence === false && <small className="special-monitor-warning">หลักฐานฟอกไตไม่ครบ</small>}
                                            {row.stmFound && row.repFound && Math.abs(Number(row.repStmDiff || 0)) > 0.01 && <small className="special-monitor-warning">ผลต่าง ฿{Number(row.repStmDiff).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</small>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {!loading && !error && activeMonitor === 'kidney' && visibleData.length === 0 && (
                <div className="special-monitor-empty">ไม่พบ visit ตามตัวกรองนี้ ลองเปลี่ยนช่วงวันที่หรือสถานะ STM</div>
            )}

            {/* Detail Modal */}
            <DetailKidneyModal record={selectedKidneyRecord} onClose={() => setSelectedKidneyRecord(null)} />
        </div>
    );
};
