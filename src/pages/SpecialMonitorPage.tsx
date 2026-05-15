import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { DetailModal } from '../components/DetailModal';
import { DetailKidneyModal } from '../components/DetailKidneyModal';
import type { CheckRecord } from '../mockData';
import type { KidneyMonitorRecord } from '../mockKidneyData';
import businessRules from '../config/business_rules.json';
import { formatLocalDateInput } from '../utils/dateUtils';

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

const RIGHT_LABEL_MAP: Record<string, string> = {
    all: 'ทั้งหมด',
    ucs: 'UCS + SSS',
    ofc_lgo: 'OFC + LGO',
    uc: 'UC - EPO จริง',
};

const CATEGORY_LABEL_MAP: Record<string, string> = {
    all: 'ทั้งหมด',
    service: 'หน่วยไต (ค่าบริการ)',
    drug: 'ยา + แลป + บริการ',
};

export const SpecialMonitorPage: React.FC = () => {    const [activeMonitor, setActiveMonitor] = useState('kidney');
    const [filterRight, setFilterRight] = useState('all');
    const [filterPatientRight, setFilterPatientRight] = useState('all');
    const [filterCategory, setFilterCategory] = useState('all');
    const [startDate, setStartDate] = useState(() => formatLocalDateInput());
    const [endDate, setEndDate] = useState(() => formatLocalDateInput());
    const [allKidneyData, setAllKidneyData] = useState<MonitorItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dataMeta, setDataMeta] = useState<{ total: number; returned: number; truncated: boolean; limit: number } | null>(null);
    const [selectedRecord, setSelectedRecord] = useState<CheckRecord | null>(null);
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
            name: 'สิทธิพิเศษ',
            icon: '⭐',
            description: 'หน่วยฉุกเฉิน, OP Refer, AE และโครงการพิเศษอื่นๆ',
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
            console.log('✅ API Response:', json);
            if (json.success && json.data) {
                console.log(`📊 Loaded ${json.data.length} kidney monitor records from database`);
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
            const analysis = getAnalysis(item);
            // Filter by active monitor type
            if (activeMonitor === 'kidney') {
                // Only show kidney records (main_dep='060' ห้องไตเทียม)
                if (!('insuranceGroup' in item && 'dialysisFee' in item)) return false;
            }
    
            // Check if this is a kidney monitor record with insuranceGroup
            if ('insuranceGroup' in item) {
                const kidneyRecord = item as unknown as KidneyMonitorRecord;
                // Only apply filter if not 'all'
                if (filterRight !== 'all') {
                    if (filterRight === 'ucs' && kidneyRecord.insuranceGroup !== 'UCS+SSS') return false;
                    if (filterRight === 'ofc_lgo' && kidneyRecord.insuranceGroup !== 'OFC+LGO') return false;
                    if (filterRight === 'uc' && kidneyRecord.insuranceGroup !== 'UC-EPO') return false;
                }
            } else {
                // Old logic for non-kidney records (apply only if not 'all')
                if (filterRight !== 'all') {
                    if (filterRight === 'ucs' && analysis.right !== 'UCS + SSS') return false;
                    if (filterRight === 'ofc_lgo' && analysis.right !== 'OFC + LGO') return false;
                    if (filterRight === 'uc' && analysis.right !== 'UC (EPO จริง)') return false;
                }
            }
    
            if (filterCategory === 'service' && analysis.category !== 'dialysis') return false;
            if (filterCategory === 'drug' && analysis.category !== 'epo_real') return false;

            if (filterPatientRight !== 'all') {
                const patientRight = 'insuranceType' in item
                    ? String((item as unknown as KidneyMonitorRecord).insuranceType || '').trim()
                    : String(item.hipdata_code || '').trim();
                if (patientRight !== filterPatientRight) return false;
            }

            return true; // Keep item if it passes all filters
        });
    }, [allKidneyData, activeMonitor, filterRight, filterCategory, filterPatientRight, getAnalysis]);

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

    const handleExportExcel = useCallback(() => {
        if (!filteredData.length) return;

        const workbook = XLSX.utils.book_new();
        const rows = filteredData.map((item, index) => {
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

            return {
                ลำดับ: index + 1,
                VN: item.vn || kidneyRecord?.vn || '-',
                HN: item.hn || kidneyRecord?.hn || '-',
                ชื่อผู้ป่วย: item.ptname || kidneyRecord?.patientName || '-',
                สิทธิการรักษา: rightValue,
                กลุ่มสิทธิ: groupValue,
                วันที่รับบริการ: dateValue || '-',
                รายรับ: Number(
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
            { wch: 14 },
            { wch: 14 },
            { wch: 14 },
            { wch: 14 },
            { wch: 24 },
            { wch: 34 },
        ];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'SpecialMonitor');

        const safeRight = RIGHT_LABEL_MAP[filterRight] || filterRight;
        const safeCategory = CATEGORY_LABEL_MAP[filterCategory] || filterCategory;
        const filename = [
            'special-monitor',
            activeMonitor,
            safeRight.replace(/\s+/g, '_'),
            (filterPatientRight === 'all' ? 'all_patient_rights' : filterPatientRight.replace(/\s+/g, '_')),
            safeCategory.replace(/\s+/g, '_'),
            startDate,
            endDate,
        ].join('_');

        XLSX.writeFile(workbook, `${filename}.xlsx`);
    }, [activeMonitor, endDate, filterCategory, filterRight, filterPatientRight, filteredData, getAnalysis, startDate]);

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

    return (
        <div style={{ padding: '20px', width: '100%', maxWidth: 'var(--content-max)', margin: '0 auto' }}>            {/* Header */}
            <div style={{ marginBottom: '30px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '10px' }}>
                    📊 รายการมอนิเตอร์พิเศษ (เวอร์ชันแก้ไขแล้ว)
                </h1>
                <p style={{ color: '#666', fontSize: '14px' }}>
                    ตรวจสอบการเบิกจ่ายสำหรับกลุ่มผู้ป่วยพิเศษ
                </p>
                <p style={{ color: '#94a3b8', fontSize: '12px', marginTop: 4 }}>
                    สถานพยาบาล: {hospitalName}
                </p>
            </div>

            {/* Monitor Category Menu */}            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '20px',
                    marginBottom: '40px',
                }}
            >
                {monitorCategories.map((category) => {
                    const isActive = activeMonitor === category.id;
                    const categoryColors: Record<string, { gradient: string; accent: string; light: string }> = {
                        kidney: {
                            gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            accent: '#667eea',
                            light: '#f0f4ff'
                        },
                        chronic: {
                            gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                            accent: '#f5576c',
                            light: '#ffe5ec'
                        },
                        special: {
                            gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                            accent: '#00f2fe',
                            light: '#e0f7ff'
                        }
                    };
                    
                    const colors = categoryColors[category.id] || categoryColors.kidney;
                    
                    return (
                        <div
                            key={category.id}
                            onClick={() => setActiveMonitor(category.id)}
                            style={{
                                padding: isActive ? '24px' : '20px',
                                background: isActive ? colors.gradient : '#ffffff',
                                border: isActive ? 'none' : `1px solid #e0e0e0`,
                                borderRadius: '16px',
                                cursor: 'pointer',
                                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: isActive
                                    ? `0 8px 24px ${colors.accent}40, 0 0 1px ${colors.accent}80`
                                    : '0 2px 8px rgba(0, 0, 0, 0.08)',
                                transform: isActive ? 'translateY(-4px) scale(1.02)' : 'translateY(0) scale(1)',
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                            onMouseEnter={(e) => {
                                const el = e.currentTarget as HTMLElement;
                                if (!isActive) {
                                    el.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.12)';
                                    el.style.transform = 'translateY(-2px) scale(1.01)';
                                    el.style.borderColor = colors.accent;
                                    el.style.background = colors.light;
                                }
                            }}
                            onMouseLeave={(e) => {
                                const el = e.currentTarget as HTMLElement;
                                if (!isActive) {
                                    el.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
                                    el.style.transform = 'translateY(0) scale(1)';
                                    el.style.borderColor = '#e0e0e0';
                                    el.style.background = '#ffffff';
                                }
                            }}
                        >
                            {/* Decorative background element */}
                            <div
                                style={{
                                    position: 'absolute',
                                    top: '-50px',
                                    right: '-50px',
                                    width: '150px',
                                    height: '150px',
                                    background: isActive ? 'rgba(255, 255, 255, 0.1)' : `${colors.accent}10`,
                                    borderRadius: '50%',
                                    pointerEvents: 'none',
                                    transition: 'all 0.4s ease'
                                }}
                            />
                            
                            {/* Content */}
                            <div style={{ position: 'relative', zIndex: 1 }}>
                                <div style={{
                                    fontSize: '48px',
                                    marginBottom: '16px',
                                    display: 'inline-block',
                                    transition: 'transform 0.3s ease'
                                }}>
                                    {category.icon}
                                </div>
                                <div style={{
                                    fontSize: '18px',
                                    fontWeight: 700,
                                    marginBottom: '12px',
                                    color: isActive ? '#ffffff' : '#1a1a1a',
                                    transition: 'color 0.3s ease'
                                }}>
                                    {category.name}
                                </div>
                                <div style={{
                                    fontSize: '13px',
                                    color: isActive ? 'rgba(255, 255, 255, 0.9)' : '#666666',
                                    lineHeight: '1.6',
                                    transition: 'color 0.3s ease'
                                }}>
                                    {category.description}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Dialysis Service Summary Section - shown for kidney monitor */}
            {activeMonitor === 'kidney' && (
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
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#2196f3', marginBottom: '4px' }}>📊 จำนวนเคส</div>
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
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#9c27b0', marginBottom: '4px' }}>📊 จำนวนเคส</div>
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
                )}

            {activeMonitor === 'chronic' && (
                <div style={{ padding: '20px', background: '#f5f5f5', borderRadius: '8px', marginBottom: '30px', textAlign: 'center', color: '#999' }}>
                    🚧 โรคเรื้อรัง (NCD) - ยังไม่พร้อมใช้งาน (Coming Soon)
                </div>
            )}            {activeMonitor === 'special' && (
                <div style={{ padding: '20px', background: '#f5f5f5', borderRadius: '8px', marginBottom: '30px', textAlign: 'center', color: '#999' }}>
                    🚧 สิทธิพิเศษ - ยังไม่พร้อมใช้งาน (Coming Soon)
                </div>
            )}

            {/* Filter Controls */}
            {activeMonitor === 'kidney' && (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '15px',
                        marginBottom: '20px',
                        padding: '15px',
                        background: '#f5f5f5',
                        borderRadius: '8px',
                    }}
                >
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>📅 วันเริ่มต้น:</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                        />
                    </div>

                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>📅 วันสิ้นสุด:</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                        />
                    </div>

                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>🏷️ กลุ่มสิทธิ์ (เดิม):</label>
                        <select
                            value={filterRight}
                            onChange={(e) => setFilterRight(e.target.value)}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                        >
                            <option value="all">ทั้งหมด</option>
                            <option value="ucs">UCS + SSS (1,500)</option>
                            <option value="ofc_lgo">OFC + LGO (2,000)</option>
                            <option value="uc">UC - EPO จริง (180)</option>
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>🧾 สิทธิ์คนไข้:</label>
                        <select
                            value={filterPatientRight}
                            onChange={(e) => setFilterPatientRight(e.target.value)}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                        >
                            <option value="all">ทั้งหมด</option>
                            {patientRightOptions.map((right) => (
                                <option key={right} value={right}>{right}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>📦 หมวดบริการ:</label>
                        <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                        >
                            <option value="all">ทั้งหมด</option>
                            <option value="service">หน่วยไต (ค่าบริการ)</option>
                            <option value="drug">ยา + แลป + บริการ</option>
                        </select>
                    </div>

                    <div style={{ alignSelf: 'flex-end' }}>
                        <button
                            onClick={() => void fetchMonitorData()}
                            style={{ width: '100%', padding: '8px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', marginBottom: '8px' }}
                        >
                            🔄 รีโหลด
                        </button>
                        <button
                            onClick={handleExportExcel}
                            disabled={filteredData.length === 0}
                            style={{
                                width: '100%',
                                padding: '8px',
                                background: filteredData.length === 0 ? '#cfd8dc' : '#43a047',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                fontWeight: 600,
                                cursor: filteredData.length === 0 ? 'not-allowed' : 'pointer',
                            }}
                        >
                            📥 Excel
                        </button>
                    </div>
                </div>
            )}

            {/* Error & Loading */}
            {error && (
                <div style={{ padding: '15px', background: '#ffebee', color: '#c62828', borderRadius: '4px', marginBottom: '20px' }}>
                    ⚠️ {error}
                </div>
            )}            {loading && (
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

            {/* Record Count Info */}
            {!loading && dataMeta && !dataMeta.truncated && dataMeta.total > 0 && (
                <div style={{ padding: '8px 14px', background: '#e8f5e9', color: '#2e7d32', borderRadius: '6px', marginBottom: '12px', fontSize: '13px', border: '1px solid #a5d6a7' }}>
                    ✅ โหลดครบ <strong>{dataMeta.returned.toLocaleString()}</strong> รายการ (ทั้งหมด {dataMeta.total.toLocaleString()} รายการ)
                </div>
            )}{/* Data Table */}            {activeMonitor === 'kidney' && !loading && filteredData.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden' }}>                        <thead>                            <tr style={{ background: '#1976d2', color: 'white' }}>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, minWidth: '80px' }}>HN</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, minWidth: '150px' }}>ชื่อ-สกุล</th>
                        <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600, minWidth: '120px', backgroundColor: '#1565c0' }}>📅 วันที่</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, minWidth: '140px' }}>สิทธิ์</th>
                        <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600, minWidth: '100px' }}>กลุ่ม</th>
                        <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600, minWidth: '100px' }}>รายรับ (Revenue)</th>
                        <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600, minWidth: '120px' }}>จ่ายหน่วยไต (Cost)</th>
                        <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600, minWidth: '100px' }}>กำไร รพ.</th>
                    </tr>
                    </thead><tbody>                            {filteredData.map((item, idx) => {
                                const analysis = getAnalysis(item);
                                const isKidneyRecord = 'insuranceType' in item && 'dialysisFee' in item;
                                const kidneyRecord = isKidneyRecord ? (item as unknown as KidneyMonitorRecord) : null;

                                // Use actual values from kidney record if available
                                const displayCost = isKidneyRecord && kidneyRecord
                                    ? (kidneyRecord.revenue as number)
                                    : (analysis.totalCost || analysis.totalAmount || 0);
                                const displayPayment = isKidneyRecord && kidneyRecord
                                    ? (kidneyRecord.costTotal as number)
                                    : (analysis.epoPayment || analysis.totalAmount || 0);
                                const displayProfit = isKidneyRecord && kidneyRecord
                                    ? (kidneyRecord.profit as number)
                                    : (analysis.profit || 0);

                                const hn = isKidneyRecord && kidneyRecord ? kidneyRecord.hn : item.hn || '-';
                                const ptname = isKidneyRecord && kidneyRecord ? kidneyRecord.patientName : item.ptname || '-';

                                return (
                                    <tr
                                        key={idx}
                                        onClick={() => {
                                            if (isKidneyRecord && kidneyRecord) {
                                                try {
                                                    setSelectedKidneyRecord(kidneyRecord);
                                                } catch (err) {
                                                    console.error('Error setting kidney record:', err);
                                                }
                                            } else {
                                                const record: CheckRecord = {
                                                    id: idx,
                                                    vn: item.vn || '',
                                                    hn: item.hn || '',
                                                    patientName: item.ptname || '',
                                                    fund: item.hipdata_code || item.fund || '',
                                                    serviceDate: item.serviceDate || formatLocalDateInput(),
                                                    serviceType: 'OPD',
                                                    vstdate: item.serviceDate || formatLocalDateInput(),
                                                    status: 'completed',
                                                    issues: [],
                                                    price: analysis.totalCost || analysis.totalAmount || 0,
                                                    main_diag: item.main_diag || '',
                                                    hipdata_code: item.hipdata_code || '',
                                                    ...item as any,
                                                };
                                                setSelectedRecord(record);
                                            }
                                        }}
                                        style={{
                                            borderBottom: '1px solid #eee',
                                            background: idx % 2 === 0 ? 'white' : '#f9f9f9',
                                            transition: 'background-color 0.2s',
                                            cursor: 'pointer',
                                        }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f0f0f0'; }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'white' : '#f9f9f9'; }}
                                    >
                                        <td style={{ padding: '12px', minWidth: '80px' }}>{hn}</td>
                                        <td style={{ padding: '12px', minWidth: '150px' }}>{ptname}</td>
                                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#1565c0', fontWeight: 600, minWidth: '120px', backgroundColor: '#f0f7ff', borderRadius: '4px' }}>
                                            {(() => {
                                                const dateValue = isKidneyRecord && kidneyRecord ? kidneyRecord.serviceDate : item.serviceDate;
                                                return dateValue || '-';
                                            })()}
                                        </td>
                                        <td style={{ padding: '12px', fontWeight: 600, minWidth: '140px' }}>
                                            <div style={{ display: 'inline-block', padding: '4px 8px', background: analysis.right === 'UCS + SSS' || analysis.right === 'UCS+SSS' ? '#e3f2fd' : analysis.right === 'OFC + LGO' || analysis.right === 'OFC+LGO' ? '#f3e5f5' : '#fff3e0', color: analysis.right === 'UCS + SSS' || analysis.right === 'UCS+SSS' ? '#2196f3' : analysis.right === 'OFC + LGO' || analysis.right === 'OFC+LGO' ? '#9c27b0' : '#ff9800', borderRadius: '4px', fontSize: '11px', maxWidth: '200px', wordWrap: 'break-word' }}>
                                                {/* Show insurance type name, or group if not available */}
                                                {isKidneyRecord && kidneyRecord ? kidneyRecord.insuranceType : analysis.right}
                                            </div>
                                        </td>                                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '11px', fontWeight: 700, minWidth: '100px' }}>
                                            <span style={{ padding: '2px 6px', background: '#f5f5f5', borderRadius: '4px', border: '1px solid #ddd' }}>
                                                {(() => {
                                                    const displayValue = isKidneyRecord && kidneyRecord ? kidneyRecord.insuranceGroup : analysis.right;
                                                    return displayValue;
                                                })()}
                                            </span>
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'center', fontWeight: 800, color: '#1976d2', minWidth: '100px' }}>
                                            ฿{displayCost.toLocaleString()}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'center', minWidth: '120px' }}>
                                            <div style={{ fontWeight: 800, color: '#d32f2f' }}>฿{displayPayment.toLocaleString()}</div>
                                            {isKidneyRecord && kidneyRecord && (
                                                <div style={{ fontSize: '9px', color: '#666', fontWeight: 600 }}>
                                                    (หน่วยไต: ฿{dialysisFixed.toLocaleString()})
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'center', minWidth: '100px' }}>
                                            <div style={{
                                                fontWeight: 800,
                                                color: displayProfit > 0 ? '#2e7d32' : '#c62828',
                                                background: displayProfit > 0 ? '#e8f5e9' : '#ffebee',
                                                padding: '4px 8px',
                                                borderRadius: '6px',
                                                display: 'inline-block'
                                            }}>
                                                ฿{displayProfit.toLocaleString()}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>                </div>
            )}

            {filteredData.length === 0 && activeMonitor === 'kidney' && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '16px' }}>
                    📭 ไม่มีข้อมูลตรงตามเงื่อนไขที่คัดกรอง
                </div>
            )}

            {/* Detail Modal */}
            <DetailModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
            <DetailKidneyModal record={selectedKidneyRecord} onClose={() => setSelectedKidneyRecord(null)} />
        </div>
    );
};
