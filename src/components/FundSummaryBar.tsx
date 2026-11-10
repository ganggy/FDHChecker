import React, { useMemo } from 'react';
import type { CheckRecord } from '../mockData';
import '../styles/fundSummary.css';

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
        <div className="fsb">
            <div className="summary-toolbar">
                <h2 className="section-title" style={{ flex: 1 }}>สรุปรายกองทุน</h2>
                <div className="summary-toolbar-meta">
                    <span>รวมทั้งหมด: <strong>{grandTotal.toLocaleString()}</strong> รายการ</span>
                    <span>•</span>
                    <span>สมบูรณ์: <strong style={{ color: 'var(--success)' }}>{grandComplete.toLocaleString()}</strong></span>
                    <span>•</span>
                    <span>มูลค่า: <strong style={{ color: 'var(--teal)' }}>{grandValue.toLocaleString()}</strong> บาท</span>
                </div>
            </div>

            <div className="fsb-grid">
                {fundSummaries.map(fund => {
                    const isSelected = selectedFund === fund.fund;
                    const otherCount = fund.total - fund.opd - fund.ipd;
                    const rateTone = fund.rate >= 80 ? 'good' : fund.rate >= 50 ? 'warn' : 'bad';

                    return (
                        <button
                            type="button"
                            key={fund.fund}
                            onClick={() => onSelectFund(isSelected ? '' : fund.fund)}
                            aria-pressed={isSelected}
                            title={isSelected ? 'คลิกเพื่อยกเลิกการกรอง' : `คลิกเพื่อดูเฉพาะ ${fund.fund}`}
                            className={`fund-summary-card fsb-card${isSelected ? ' selected' : ''}`}
                            style={{ ['--fund-color' as string]: fund.color }}
                        >
                            <span className="fund-summary-card-topbar" />

                            <span className="fsb-head">
                                <span className="fsb-name-block">
                                    <span className="fsb-name">
                                        <span className="fsb-dot" aria-hidden="true" />
                                        <span>{fund.fund}</span>
                                    </span>
                                    {fund.fullName !== fund.fund && <span className="fsb-fullname">{fund.fullName}</span>}
                                    {fund.rateInfo && <span className="fsb-rate-info">{fund.rateInfo}</span>}
                                </span>
                                {isSelected ? (
                                    <span className="fsb-badge fsb-badge--viewing">กำลังดู</span>
                                ) : fund.incomplete > 0 ? (
                                    <span className="fsb-badge fsb-badge--pending">รอแก้ {fund.incomplete.toLocaleString()}</span>
                                ) : null}
                            </span>

                            <span className="fsb-stats">
                                <span>
                                    <strong className="fsb-total">{fund.total.toLocaleString()}</strong>
                                    <span className="fsb-unit">รายการ</span>
                                </span>
                                <span className="fsb-value">
                                    {fund.totalValue.toLocaleString()} <span className="fsb-unit">บาท</span>
                                </span>
                            </span>

                            <span className="fsb-progress">
                                <span className="fsb-progress-label">
                                    <span>ความสมบูรณ์</span>
                                    <strong className={`fsb-tone--${rateTone}`}>{fund.rate}%</strong>
                                </span>
                                <span className="fsb-progress-track">
                                    <span className={`fsb-progress-fill fsb-fill--${rateTone}`} style={{ width: `${fund.rate}%` }} />
                                </span>
                            </span>

                            <span className="fsb-foot">
                                {fund.opd > 0 && <span className="fsb-chip fsb-chip--opd">OPD {fund.opd.toLocaleString()}</span>}
                                {fund.ipd > 0 && <span className="fsb-chip fsb-chip--ipd">IPD {fund.ipd.toLocaleString()}</span>}
                                {(fund.opd > 0 || fund.ipd > 0) && otherCount > 0 && (
                                    <span className="fsb-chip">อื่นๆ {otherCount.toLocaleString()}</span>
                                )}
                                <span className="fsb-counts">
                                    <span className="fsb-tone--good">✓ {fund.complete.toLocaleString()}</span>
                                    <span className="fsb-tone--bad">✗ {fund.incomplete.toLocaleString()}</span>
                                </span>
                            </span>
                        </button>
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
