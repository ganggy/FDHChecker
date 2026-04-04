import React, { useMemo } from 'react';
import type { CheckRecord } from '../mockData';

interface FundSummaryBarProps {
    data: CheckRecord[];
    selectedFund: string;
    onSelectFund: (fund: string) => void;
}

// ข้อมูลกองทุนจาก NHSO เอกสารปีงบ 2568
const FUND_META: Record<string, {
    shortName: string;
    fullName: string;
    color: string;
    icon: string;
    type: 'UC' | 'SSS' | 'OFC' | 'OTHER';
    // อัตราเหมาจ่าย/ข้อมูลอ้างอิง NHSO ปี 2568
    rateInfo?: string;
}> = {
    // UC / บัตรทอง variants
    'UCS': { shortName: 'UCS', fullName: 'บัตรทองทั่วไป', color: '#f59e0b', icon: '🟡', type: 'UC', rateInfo: '3,856 บ./คน/ปี' },
    'UC': { shortName: 'UC', fullName: 'บัตรทอง', color: '#f59e0b', icon: '🟡', type: 'UC', rateInfo: '3,856 บ./คน/ปี' },
    'บัตรทอง': { shortName: 'บัตรทอง', fullName: 'หลักประกันสุขภาพถ้วนหน้า', color: '#f59e0b', icon: '🟡', type: 'UC', rateInfo: '3,856 บ./คน/ปี' },
    'บัตรประชาชน': { shortName: 'บัตรประชาชน', fullName: 'สิทธิบัตรประชาชน', color: '#f59e0b', icon: '🟡', type: 'UC', rateInfo: '3,856 บ./คน/ปี' },

    // SSS ประกันสังคม
    'SSS': { shortName: 'SSS', fullName: 'ประกันสังคม', color: '#3b82f6', icon: '🔵', type: 'SSS', rateInfo: 'เหมาจ่ายผู้ประกันตน' },
    'ประกันสังคม': { shortName: 'ปสส.', fullName: 'ประกันสังคม', color: '#3b82f6', icon: '🔵', type: 'SSS', rateInfo: 'เหมาจ่ายผู้ประกันตน' },

    // OFC ข้าราชการ
    'OFC': { shortName: 'OFC', fullName: 'ข้าราชการ', color: '#8b5cf6', icon: '🟣', type: 'OFC', rateInfo: 'เบิกจ่ายตรงกรมบัญชีกลาง' },
    'ข้าราชการ': { shortName: 'ข้าราชการ', fullName: 'สิทธิข้าราชการ', color: '#8b5cf6', icon: '🟣', type: 'OFC', rateInfo: 'เบิกจ่ายตรงกรมบัญชีกลาง' },

    // LGO / อปท.
    'LGO': { shortName: 'LGO', fullName: 'อปท.', color: '#10b981', icon: '🟢', type: 'OTHER', rateInfo: 'งบ อปท.' },
    'อปท.': { shortName: 'อปท.', fullName: 'องค์กรปกครองส่วนท้องถิ่น', color: '#10b981', icon: '🟢', type: 'OTHER', rateInfo: 'งบ อปท.' },

    // ผู้สูงอายุ LTC
    'ผู้สูงอายุ': { shortName: 'LTC', fullName: 'ผู้สูงอายุ (LTC)', color: '#f97316', icon: '🔶', type: 'OTHER', rateInfo: 'กองทุนดูแลระยะยาว' },
    'LTC': { shortName: 'LTC', fullName: 'การดูแลระยะยาว', color: '#f97316', icon: '🔶', type: 'OTHER', rateInfo: 'กองทุนดูแลระยะยาว' },

    // CSCD
    'CSCD': { shortName: 'CSCD', fullName: 'โรคเรื้อรัง', color: '#ef4444', icon: '🔴', type: 'OTHER', rateInfo: 'กองทุนโรคเรื้อรัง' },

    // ว่าง/ไม่มีสิทธิ์
    'สิทธิว่าง': { shortName: 'ว่าง', fullName: 'ไม่มีสิทธิ์', color: '#94a3b8', icon: '⚪', type: 'OTHER', rateInfo: 'ชำระเงินสด' },
};

// คำนวณสถิติ OPD/IPD จากข้อมูล
const getServiceBreakdown = (items: CheckRecord[]) => {
    const opd = items.filter(i =>
        i.serviceType && (i.serviceType.includes('OPD') || i.serviceType.includes('ผู้ป่วยนอก'))
    ).length;
    const ipd = items.filter(i =>
        i.serviceType && (i.serviceType.includes('IPD') || i.serviceType.includes('ผู้ป่วยใน'))
    ).length;
    const other = items.length - opd - ipd;
    return { opd, ipd, other };
};

// แยกประเภทกองทุนเพื่อ group
const getFundType = (fund: string): { shortName: string; color: string; icon: string; fullName: string; rateInfo?: string } => {
    const meta = FUND_META[fund];
    if (meta) return meta;

    // Fuzzy match
    const key = Object.keys(FUND_META).find(k =>
        fund.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(fund.toLowerCase())
    );
    if (key) return FUND_META[key];

    return { shortName: fund, color: '#64748b', icon: '⚫', fullName: fund, rateInfo: undefined };
};

export const FundSummaryBar: React.FC<FundSummaryBarProps> = ({ data, selectedFund, onSelectFund }) => {
    const fundSummaries = useMemo(() => {
        const fundMap = new Map<string, CheckRecord[]>();

        data.forEach(item => {
            const fund = item.fund || 'ไม่ระบุ';
            if (!fundMap.has(fund)) fundMap.set(fund, []);
            fundMap.get(fund)!.push(item);
        });        return Array.from(fundMap.entries())
            .map(([fund, items]) => {
                const total = items.length;
                const complete = items.filter(i => i.status === 'ready').length;
                const incomplete = total - complete;
                const totalValue = items.reduce((sum, i) => sum + (i.price || 0), 0);
                const rate = total > 0 ? Math.round((complete / total) * 100) : 0;
                const { opd, ipd } = getServiceBreakdown(items);
                const meta = getFundType(fund);

                return {
                    fund,
                    total,
                    complete,
                    incomplete,
                    totalValue,
                    rate,
                    opd,
                    ipd,
                    ...meta,
                };
            })
            .sort((a, b) => b.total - a.total);
    }, [data]);

    if (fundSummaries.length === 0) return null;

    const grandTotal = data.length;
    const grandComplete = data.filter(i => i.status === 'ready').length;
    const grandValue = data.reduce((sum, i) => sum + (i.price || 0), 0);

    return (
        <div style={{ marginBottom: 20 }}>
            {/* Header */}
            <div className="summary-toolbar">
                <h2 className="section-title" style={{ flex: 1 }}>สรุปรายกองทุน</h2>
                <div className="summary-toolbar-meta">
                    <span>รวมทั้งหมด: <strong>{grandTotal}</strong> รายการ</span>
                    <span>•</span>
                    <span>สมบูรณ์: <strong style={{ color: 'var(--success)' }}>{grandComplete}</strong></span>
                    <span>•</span>
                    <span>มูลค่า: <strong style={{ color: 'var(--teal)' }}>{grandValue.toLocaleString()}</strong> บาท</span>
                </div>
            </div>

            {/* Fund Cards Scroll */}
            <div className="fund-summary-scroll">
                {fundSummaries.map(fund => {
                    const isSelected = selectedFund === fund.fund;
                    const hasIssues = fund.incomplete > 0;

                    return (
                        <div
                            key={fund.fund}
                            onClick={() => onSelectFund(isSelected ? '' : fund.fund)}
                            className={`fund-summary-card${isSelected ? ' selected' : ''}`}
                            style={{
                                borderColor: isSelected ? fund.color : undefined,
                                boxShadow: isSelected ? `0 4px 16px ${fund.color}30` : undefined,
                            }}
                        >
                            {/* Top accent */}
                            <div className="fund-summary-card-topbar" style={{ background: fund.color }} />

                            {/* Fund Name Row */}
                            <div className="fund-summary-card-header">
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: fund.color, display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span>{fund.icon}</span>
                                        <span>{fund.fund}</span>
                                    </div>
                                    {fund.fullName !== fund.fund && (
                                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{fund.fullName}</div>
                                    )}
                                    {fund.rateInfo && (
                                        <div style={{ fontSize: 9, color: fund.color, opacity: 0.8, marginTop: 1, fontWeight: 500 }}>
                                            📋 {fund.rateInfo}
                                        </div>
                                    )}
                                </div>
                                {hasIssues && (
                                    <div style={{
                                        background: '#fef2f2', color: '#dc2626',
                                        borderRadius: 'var(--radius-full)',
                                        padding: '2px 8px', fontSize: 10, fontWeight: 700,
                                        border: '1px solid #fecaca',
                                    }}>
                                        ⚠️ {fund.incomplete}
                                    </div>
                                )}
                            </div>

                            {/* Stats */}
                            <div className="fund-summary-card-grid">
                                <div className="fund-summary-mini">
                                    <div style={{ fontSize: 18, fontWeight: 700 }}>{fund.total}</div>
                                    <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 500 }}>รายการ</div>
                                </div>
                                <div className="fund-summary-mini">
                                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)' }}>
                                        {fund.totalValue >= 1000
                                            ? `${(fund.totalValue / 1000).toFixed(1)}K`
                                            : fund.totalValue.toLocaleString()}
                                    </div>
                                    <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 500 }}>บาท</div>
                                </div>
                            </div>

                            {/* OPD/IPD Breakdown */}
                            {(fund.opd > 0 || fund.ipd > 0) && (
                                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                                    {fund.opd > 0 && (
                                        <span style={{
                                            padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 10, fontWeight: 600,
                                            background: '#dbeafe', color: '#1d4ed8',
                                        }}>
                                            OPD {fund.opd}
                                        </span>
                                    )}
                                    {fund.ipd > 0 && (
                                        <span style={{
                                            padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 10, fontWeight: 600,
                                            background: '#fce7f3', color: '#be185d',
                                        }}>
                                            IPD {fund.ipd}
                                        </span>
                                    )}
                                    {fund.total - fund.opd - fund.ipd > 0 && (
                                        <span style={{
                                            padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 10, fontWeight: 600,
                                            background: '#f3f4f6', color: '#6b7280',
                                        }}>
                                            อื่นๆ {fund.total - fund.opd - fund.ipd}
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Progress Bar */}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>ความสมบูรณ์</span>
                                    <span style={{ fontWeight: 700, color: fund.rate >= 80 ? 'var(--success)' : fund.rate >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
                                        {fund.rate}%
                                    </span>
                                </div>
                                <div style={{ height: 5, background: 'var(--surface-2)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${fund.rate}%`,
                                        background: fund.rate >= 80
                                            ? 'linear-gradient(90deg, #16a34a, #22c55e)'
                                            : fund.rate >= 50
                                                ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                                                : 'linear-gradient(90deg, #dc2626, #f87171)',
                                        borderRadius: 'var(--radius-full)',
                                        transition: 'width 0.5s ease',
                                    }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 3, color: 'var(--text-muted)' }}>
                                    <span style={{ color: 'var(--success)' }}>✓ {fund.complete}</span>
                                    <span style={{ color: 'var(--danger)' }}>✗ {fund.incomplete}</span>
                                </div>
                            </div>

                            {/* Selected indicator */}
                            {isSelected && (
                                <div style={{
                                    position: 'absolute', bottom: 8, right: 8,
                                    background: fund.color, color: 'white',
                                    borderRadius: 'var(--radius-full)',
                                    fontSize: 9, fontWeight: 700,
                                    padding: '2px 6px',
                                }}>
                                    กำลังดู
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Legend from NHSO documents */}
            <div className="fund-summary-legend">
                <span style={{ fontWeight: 600 }}>📋 อ้างอิง NHSO ปี 2568:</span>
                <span>🟡 UC: เหมาจ่ายรายหัว 3,856 บ./คน/ปี</span>
                <span>• OP: 1,391 บ.</span>
                <span>• IP (DRG v6): 1,581 บ.</span>
                <span>• เฉพาะโรค: 504 บ.</span>
                <span style={{ color: '#0369a1' }}>🔵 SSS: เหมาจ่ายผู้ประกันตน</span>
                <span style={{ color: '#7c3aed' }}>🟣 OFC: เบิกตรงกรมบัญชีกลาง</span>
            </div>
        </div>
    );
};
