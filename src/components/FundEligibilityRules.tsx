import React, { useState } from 'react';

interface FundRule {
    id: string;
    name: string;
    color: string;
    icon: string;
    conditions: string[];
    rates: string[];
    projectCodes: string[];
    description: string;
}

const RULES: FundRule[] = [
    {
        id: 'uc',
        name: 'สิทธิบัตรทอง (UCS)',
        color: '#f59e0b',
        icon: '🟡',
        description: 'เน้นการเบิกจ่ายตามนโยบาย บัตรประชาชนใบเดียวรักษาทุกที่ และรายการ On-top',
        conditions: [
            'ต้องปิดสิทธิ NHSO (EP) ก่อนส่งเบิก',
            'ต้องมีรหัสววินิจฉัย ICD-10 (Standard)',
            'ข้อมูลครบ 16 แฟ้ม / MDS (Minimal Data Set)',
        ],
        rates: [
            'OP Anywhere: จ่ายตาม Fee Schedule รายครั้ง',
            'IP: DRG v6 อัตรา 8,350 บ./AdjRW (ปี 2568)',
            'Home Ward: จ่ายตาม TDRGs v6.3',
        ],
        projectCodes: ['OPANY', 'OP AE', 'UCEP', 'CANCER', 'HOME WARD', 'ODS', 'ER-EXT'],
    },
    {
        id: 'sss',
        name: 'สิทธิประกันสังคม (SSS)',
        color: '#3b82f6',
        icon: '🔵',
        description: 'เน้นรายการ On-top และรายการอุปกรณ์เครื่องมือแพทย์พิเศษ',
        conditions: [
            'ผู้ประกันตนเข้ารับบริการใน รพ. คู่สัญญา',
            'กรณีฉุกเฉินเบิก UCEP ได้ทุกที่',
            'รายการอุปกรณ์แพทย์ต้องมีรหัสตามประกาศ สปส.',
        ],
        rates: [
            'IP: จ่ายตาม DRG อัตรา 12,000 บ./AdjRW (ปี 2568)',
            'อุปกรณ์: จ่ายตามรายการราคา (Fee Schedule)',
        ],
        projectCodes: ['UCEP', 'SSS_OPD_AE'],
    },
    {
        id: 'ofc',
        name: 'สิทธิข้าราชการ (OFC)',
        color: '#8b5cf6',
        icon: '🟣',
        description: 'ระบบเบิกจ่ายตรงกรมบัญชีกลางผ่าน FDH',
        conditions: [
            'ต้องเป็นระบบจ่ายตรง (Direct Billing) เท่านั้น',
            'ตรวจสอบไฟล์ CHT/CHA ให้ครบถ้วน',
            'ยารักษามะเร็งและยาค่าใช้จ่ายสูง ต้องมีรหัสที่ถูกต้อง',
        ],
        rates: [
            'จ่ายตามราคาประกาศกรมบัญชีกลาง',
            'กรณี IP ใช้ระบบ DRG',
        ],
        projectCodes: ['UCEP', 'OFC_DIRECT'],
    },
    {
        id: 'well',
        name: 'งบสร้างเสริมสุขภาพ (PP)',
        color: '#10b981',
        icon: '🟢',
        description: 'กองทุนสร้างเสริมสุขภาพและป้องกันโรค (PP Fee Schedule)',
        conditions: [
            'กิจกรรมตามกลุ่มวัย (เด็ก, วัยรุ่น, วัยทำงาน, ผู้สูงอายุ)',
            'บริการวัคซีนและการตรวจคัดกรอง',
        ],
        rates: [
            'จ่ายตามรายการกิจกรรม (Fee Schedule)',
        ],
        projectCodes: ['PP', 'WELL'],
    },
];

export const FundEligibilityRules: React.FC = () => {
    const [expandedId, setExpandedId] = useState<string | null>('uc');

    return (
        <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>⚖️</span>
                <h3 style={{ margin: 0, fontSize: 16 }}>เกณฑ์การตรวจสอบเบิก FDH (อ้างอิงปีงบ 2568)</h3>
            </div>
            <div className="card-body" style={{ padding: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                    {RULES.map((rule) => (
                        <div
                            key={rule.id}
                            className={`rule-card ${expandedId === rule.id ? 'active' : ''}`}
                            onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                            style={{
                                borderLeft: `4px solid ${rule.color}`,
                                background: expandedId === rule.id ? '#f8fafc' : 'white',
                                borderRadius: 'var(--radius)',
                                boxShadow: 'var(--shadow-sm)',
                                padding: '12px 14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontWeight: 700, color: rule.color, fontSize: 14 }}>
                                    {rule.icon} {rule.name}
                                </div>
                                <span>{expandedId === rule.id ? '▲' : '▼'}</span>
                            </div>

                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                {rule.description}
                            </div>

                            {expandedId === rule.id && (
                                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                                    <div style={{ marginBottom: 10 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', marginBottom: 4, textTransform: 'uppercase' }}>✅ เงื่อนไขหลัก</div>
                                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6 }}>
                                            {rule.conditions.map((c, i) => <li key={i}>{c}</li>)}
                                        </ul>
                                    </div>

                                    <div style={{ marginBottom: 10 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--teal)', marginBottom: 4, textTransform: 'uppercase' }}>💰 อัตรารับเงิน</div>
                                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6 }}>
                                            {rule.rates.map((r, i) => <li key={i}>{r}</li>)}
                                        </ul>
                                    </div>

                                    <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginBottom: 4, textTransform: 'uppercase' }}>📂 Project Codes</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                                            {rule.projectCodes.map((code) => (
                                                <span key={code} style={{
                                                    fontSize: 9, fontWeight: 700, background: '#fff7ed',
                                                    color: '#c2410c', border: '1px solid #ffedd5',
                                                    padding: '1px 6px', borderRadius: 4
                                                }}>
                                                    {code}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
