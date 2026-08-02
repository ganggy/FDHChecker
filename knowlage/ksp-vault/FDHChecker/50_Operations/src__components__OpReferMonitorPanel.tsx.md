---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "src/components/OpReferMonitorPanel.tsx"
source_hash: "67b308c1a39ff300e9f53a5e4254ce14880e9ef08f157cff2b5b866c4e217da6"
managed_by: "sync-ksp-vault"
---
# OpReferMonitorPanel.tsx

> Source: `src/components/OpReferMonitorPanel.tsx`
> SHA-256: `67b308c1a39ff300e9f53a5e4254ce14880e9ef08f157cff2b5b866c4e217da6`

````tsx
import { useCallback, useEffect, useMemo, useState } from 'react';

type MonitorStatus = 'data_error' | 'ready' | 'submitted' | 'paid';

interface ReferMonitorItem {
    id: string;
    category: string;
    categoryLabel: string;
    serviceDate: string;
    visitCode: string;
    hn: string;
    patientName: string;
    fund: string;
    evidence: string[];
    missing: string[];
    instruction: string;
    status: MonitorStatus;
    statusLabel: string;
    chargeAmount: number | null;
    eligibility?: 'claimable' | 'not_claimable' | 'review';
    eligibilityLabel?: string;
    eligibilityReasons?: string[];
    transportMode?: 'ambulance' | 'self' | 'unknown';
    dataAction?: 'no_fix_self' | 'no_fix_complete' | 'no_fix_not_claimable' | 'remove_transport_adp' | 'fix_ambulance' | 'fix_adp' | 'review';
    dataActionLabel?: string;
    dataActionReasons?: string[];
}

interface ReferMonitorData {
    categories: Array<{
        key: string;
        total: number;
        dataErrors: number;
        ready: number;
        submitted: number;
        paid: number;
        knownCharges: number;
    }>;
    items: ReferMonitorItem[];
}

const STATUS_META: Record<MonitorStatus, { label: string; color: string; background: string }> = {
    data_error: { label: 'ต้องแก้ข้อมูล', color: '#b91c1c', background: '#fee2e2' },
    ready: { label: 'ข้อมูลครบ/รอตรวจสิทธิ', color: '#b45309', background: '#fef3c7' },
    submitted: { label: 'ส่งแล้วรอผล', color: '#1d4ed8', background: '#dbeafe' },
    paid: { label: 'พบยอดรับ', color: '#15803d', background: '#dcfce7' },
};

const ELIGIBILITY_META = {
    claimable: { icon: '✅', color: '#15803d', background: '#dcfce7' },
    not_claimable: { icon: '⛔', color: '#b91c1c', background: '#fee2e2' },
    review: { icon: '⚠️', color: '#b45309', background: '#fef3c7' },
} as const;

const ACTION_META = {
    no_fix_self: { icon: '🚶', color: '#166534', background: '#dcfce7' },
    no_fix_complete: { icon: '✅', color: '#166534', background: '#dcfce7' },
    no_fix_not_claimable: { icon: '⊘', color: '#475569', background: '#f1f5f9' },
    remove_transport_adp: { icon: '🗑️', color: '#b91c1c', background: '#fee2e2' },
    fix_ambulance: { icon: '🚑', color: '#b91c1c', background: '#fee2e2' },
    fix_adp: { icon: '⚠️', color: '#b91c1c', background: '#fee2e2' },
    review: { icon: '🔎', color: '#b45309', background: '#fef3c7' },
} as const;

const money = (value: number | null | undefined) =>
    value == null ? '—' : `${value.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;

export const OpReferMonitorPanel = ({
    startDate,
    endDate,
    onStartDateChange,
    onEndDateChange,
}: {
    startDate: string;
    endDate: string;
    onStartDateChange: (value: string) => void;
    onEndDateChange: (value: string) => void;
}) => {
    const [data, setData] = useState<ReferMonitorData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState<'all' | MonitorStatus>('all');
    const [eligibility, setEligibility] = useState<'all' | 'claimable' | 'not_claimable' | 'review'>('all');
    const [dataAction, setDataAction] = useState<'all' | NonNullable<ReferMonitorItem['dataAction']>>('all');
    const [search, setSearch] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ startDate, endDate });
            const response = await fetch(`/api/hosxp/revenue-opportunity-monitor?${params.toString()}`);
            const payload = await response.json() as { success?: boolean; data?: ReferMonitorData; error?: string };
            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error || 'ไม่สามารถโหลดข้อมูล OP Refer ได้');
            }
            setData(payload.data);
        } catch (loadError) {
            setData(null);
            setError(loadError instanceof Error ? loadError.message : 'ไม่สามารถโหลดข้อมูล OP Refer ได้');
        } finally {
            setLoading(false);
        }
    }, [endDate, startDate]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const items = useMemo(() => {
        const query = search.trim().toLowerCase();
        return (data?.items || []).filter((item) => {
            if (item.category !== 'op_refer') return false;
            if (status !== 'all' && item.status !== status) return false;
            if (eligibility !== 'all' && item.eligibility !== eligibility) return false;
            if (dataAction !== 'all' && item.dataAction !== dataAction) return false;
            if (!query) return true;
            return [item.hn, item.visitCode, item.patientName, item.fund, ...item.evidence, ...item.missing]
                .join(' ')
                .toLowerCase()
                .includes(query);
        });
    }, [data?.items, dataAction, eligibility, search, status]);

    const summary = data?.categories.find((category) => category.key === 'op_refer');
    const referItems = (data?.items || []).filter((item) => item.category === 'op_refer');
    const eligibilitySummary = {
        claimable: referItems.filter((item) => item.eligibility === 'claimable').length,
        notClaimable: referItems.filter((item) => item.eligibility === 'not_claimable').length,
        review: referItems.filter((item) => item.eligibility === 'review').length,
        ambulance: referItems.filter((item) => item.transportMode === 'ambulance').length,
        self: referItems.filter((item) => item.transportMode === 'self').length,
        missingAdpS: referItems.filter((item) => item.missing.some((issue) => /ADP.*S18|ADP รหัส S/i.test(issue))).length,
        noFixSelf: referItems.filter((item) => item.dataAction === 'no_fix_self').length,
        noFixComplete: referItems.filter((item) => item.dataAction === 'no_fix_complete').length,
        noFixNotClaimable: referItems.filter((item) => item.dataAction === 'no_fix_not_claimable').length,
        removeTransportAdp: referItems.filter((item) => item.dataAction === 'remove_transport_adp').length,
        fixAmbulance: referItems.filter((item) => item.dataAction === 'fix_ambulance').length,
        fixAdp: referItems.filter((item) => item.dataAction === 'fix_adp').length,
        actionReview: referItems.filter((item) => item.dataAction === 'review').length,
    };

    return (
        <section style={{ marginBottom: 30 }}>
            <div style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%)', border: '1px solid #bae6fd', borderRadius: 14, padding: 20 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                        <h2 style={{ margin: 0, color: '#0f3d66', fontSize: 22 }}>🔁 มอนิเตอร์ OP Refer</h2>
                        <p style={{ margin: '6px 0 0', color: '#475569', fontSize: 13 }}>
                            ตรวจสิทธิรับส่งต่อ Ambulance, Admit, ปลายทาง, เลข/วันที่ Refer, Diagnosis, ค่าใช้จ่าย และ EP
                        </p>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 8 }}>
                        <label style={{ color: '#475569', fontSize: 11 }}>วันเริ่มต้น
                            <input type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} style={{ display: 'block', padding: '7px 9px', border: '1px solid #bae6fd', borderRadius: 7 }} />
                        </label>
                        <label style={{ color: '#475569', fontSize: 11 }}>วันสิ้นสุด
                            <input type="date" value={endDate} onChange={(event) => onEndDateChange(event.target.value)} style={{ display: 'block', padding: '7px 9px', border: '1px solid #bae6fd', borderRadius: 7 }} />
                        </label>
                        <button type="button" className="btn btn-primary" onClick={() => void loadData()} disabled={loading || !startDate || !endDate}>
                            {loading ? 'กำลังตรวจสอบ…' : 'ตรวจสอบใหม่'}
                        </button>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 18 }}>
                    {[
                        ['ผู้ป่วยเข้าข่าย', summary?.total || 0, '#0f3d66', '#ffffff'],
                        ['ต้องแก้ข้อมูล', summary?.dataErrors || 0, '#b91c1c', '#fff1f2'],
                        ['ข้อมูลครบ/รอตรวจสิทธิ', summary?.ready || 0, '#b45309', '#fffbeb'],
                        ['ส่งแล้วรอผล', summary?.submitted || 0, '#1d4ed8', '#eff6ff'],
                        ['เบิกได้ตามกฎ', eligibilitySummary.claimable, '#15803d', '#f0fdf4'],
                        ['เบิกไม่ได้', eligibilitySummary.notClaimable, '#b91c1c', '#fff1f2'],
                        ['ต้องทบทวน', eligibilitySummary.review, '#b45309', '#fffbeb'],
                        ['เสี่ยง ADP/Ambulance', eligibilitySummary.missingAdpS, '#be123c', '#fff1f2'],
                        ['ยอดค่าบริการ', money(summary?.knownCharges || 0), '#15803d', '#f0fdf4'],
                    ].map(([label, value, color, background]) => (
                        <article key={String(label)} style={{ padding: 14, borderRadius: 10, background: String(background), border: '1px solid #e2e8f0' }}>
                            <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
                            <strong style={{ display: 'block', color: String(color), fontSize: 22, marginTop: 5 }}>{String(value)}</strong>
                        </article>
                    ))}
                </div>
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: '#fff', border: '1px solid #bae6fd', color: '#334155', fontSize: 12 }}>
                    🚑 ทำเครื่องหมาย Ambulance {eligibilitySummary.ambulance} รายการ ·
                    🚶 ระบบถือว่าเดินทางเอง {eligibilitySummary.self} รายการ ·
                    ⚠️ ADP S18xx ขาดหรือขัดแย้งกับ Ambulance {eligibilitySummary.missingAdpS} รายการ
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
                    {[
                        ['🚶 ไปเอง — ไม่ต้องแก้', eligibilitySummary.noFixSelf, '#166534', '#f0fdf4'],
                        ['✅ Ambulance ครบ — ไม่ต้องแก้', eligibilitySummary.noFixComplete, '#166534', '#f0fdf4'],
                        ['⊘ ไม่เข้าเกณฑ์ — ไม่ต้องแก้', eligibilitySummary.noFixNotClaimable, '#475569', '#f8fafc'],
                        ['🗑️ ติด C — ลบค่ารถ', eligibilitySummary.removeTransportAdp, '#b91c1c', '#fff1f2'],
                        ['🚑 ควรแก้ Ambulance', eligibilitySummary.fixAmbulance, '#b91c1c', '#fff1f2'],
                        ['⚠️ ควรแก้ ADP S18xx', eligibilitySummary.fixAdp, '#b91c1c', '#fff1f2'],
                        ['🔎 ต้องทบทวน', eligibilitySummary.actionReview, '#b45309', '#fffbeb'],
                    ].map(([label, value, color, background]) => (
                        <article key={String(label)} style={{ padding: 11, borderRadius: 9, background: String(background), border: '1px solid #e2e8f0' }}>
                            <div style={{ color: String(color), fontSize: 11, fontWeight: 700 }}>{label}</div>
                            <strong style={{ display: 'block', color: String(color), fontSize: 20, marginTop: 3 }}>{String(value)}</strong>
                        </article>
                    ))}
                </div>
            </div>

            {error && <div className="alert alert-danger" style={{ marginTop: 14 }}>{error}</div>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '16px 0' }}>
                <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ค้นหา HN, VN, ชื่อ, เลข Refer, Diagnosis"
                    style={{ flex: '1 1 280px', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }}
                />
                <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} style={{ padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                    <option value="all">ทุกสถานะ</option>
                    <option value="data_error">ต้องแก้ข้อมูล</option>
                    <option value="ready">ข้อมูลครบ/รอตรวจสิทธิ</option>
                    <option value="submitted">ส่งแล้วรอผล</option>
                    <option value="paid">พบยอดรับ</option>
                </select>
                <select value={eligibility} onChange={(event) => setEligibility(event.target.value as typeof eligibility)} style={{ padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                    <option value="all">ทุกผลตามกฎเบิก</option>
                    <option value="claimable">เบิกได้</option>
                    <option value="not_claimable">เบิกไม่ได้</option>
                    <option value="review">ต้องทบทวน</option>
                </select>
                <select value={dataAction} onChange={(event) => setDataAction(event.target.value as typeof dataAction)} style={{ padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                    <option value="all">ทุกการจัดการ</option>
                    <option value="no_fix_self">ไม่ต้องแก้ — Refer ไปเอง</option>
                    <option value="no_fix_complete">ไม่ต้องแก้ — Ambulance/ADP ครบ</option>
                    <option value="no_fix_not_claimable">ไม่ต้องแก้ — กฎไม่ให้เบิก</option>
                    <option value="remove_transport_adp">ติด C — ลบข้อเบิกค่ารถ</option>
                    <option value="fix_ambulance">ควรแก้ — Ambulance ขัดแย้ง</option>
                    <option value="fix_adp">ควรแก้ — ขาด ADP S18xx</option>
                    <option value="review">ต้องทบทวนเอกสาร</option>
                </select>
            </div>

            <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                    <thead style={{ background: '#f8fafc', color: '#334155', fontSize: 12 }}>
                        <tr>
                            {['สถานะข้อมูล', 'การจัดการ', 'ผลตามกฎเบิก', 'วันที่ / VN', 'ผู้ป่วย', 'สิทธิ', 'หลักฐาน Refer', 'ข้อมูลที่ต้องแก้', 'ค่าใช้จ่าย'].map((heading) => (
                                <th key={heading} style={{ padding: 12, textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>{heading}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => {
                            const meta = STATUS_META[item.status];
                            const expanded = expandedId === item.id;
                            return (
                                <tr key={item.id} onClick={() => setExpandedId(expanded ? null : item.id)} style={{ cursor: 'pointer', verticalAlign: 'top', background: expanded ? '#f8fafc' : '#fff' }}>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>
                                        <span style={{ display: 'inline-block', padding: '5px 8px', borderRadius: 999, color: meta.color, background: meta.background, fontSize: 11, fontWeight: 700 }}>{meta.label}</span>
                                    </td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0', minWidth: 220 }}>
                                        {item.dataAction && (() => {
                                            const actionMeta = ACTION_META[item.dataAction];
                                            return (
                                                <>
                                                    <span style={{ display: 'inline-block', padding: '5px 8px', borderRadius: 8, color: actionMeta.color, background: actionMeta.background, fontSize: 11, fontWeight: 700 }}>
                                                        {actionMeta.icon} {item.dataActionLabel}
                                                    </span>
                                                    {item.dataActionReasons?.map((reason) => <div key={reason} style={{ marginTop: 4, color: '#64748b', fontSize: 11 }}>• {reason}</div>)}
                                                </>
                                            );
                                        })()}
                                    </td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0', minWidth: 210 }}>
                                        {item.eligibility && (() => {
                                            const eligibilityMeta = ELIGIBILITY_META[item.eligibility];
                                            return (
                                                <>
                                                    <span style={{ display: 'inline-block', padding: '5px 8px', borderRadius: 8, color: eligibilityMeta.color, background: eligibilityMeta.background, fontSize: 11, fontWeight: 700 }}>
                                                        {eligibilityMeta.icon} {item.eligibilityLabel || item.eligibility}
                                                    </span>
                                                    {item.eligibilityReasons?.map((reason) => <div key={reason} style={{ marginTop: 4, color: '#64748b', fontSize: 11 }}>• {reason}</div>)}
                                                </>
                                            );
                                        })()}
                                    </td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}><strong>{item.serviceDate || '—'}</strong><br /><small>VN {item.visitCode || '—'}</small></td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}><strong>{item.patientName || '—'}</strong><br /><small>HN {item.hn || '—'}</small></td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>{item.fund || '—'}</td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>
                                        {item.evidence.length ? item.evidence.map((entry) => <div key={entry} style={{ marginBottom: 3, fontSize: 12 }}>• {entry}</div>) : '—'}
                                        {expanded && <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#eff6ff', color: '#1e3a8a', fontSize: 12 }}><strong>วิธีดำเนินการ</strong><br />{item.instruction}</div>}
                                    </td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0', color: item.missing.length ? '#b91c1c' : '#15803d', fontSize: 12 }}>
                                        {item.missing.length ? item.missing.map((entry) => <div key={entry} style={{ marginBottom: 4 }}>✕ {entry}</div>) : '✓ กฎพื้นฐานครบ'}
                                    </td>
                                    <td style={{ padding: 12, borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', fontWeight: 700 }}>{money(item.chargeAmount)}</td>
                                </tr>
                            );
                        })}
                        {!loading && items.length === 0 && (
                            <tr><td colSpan={9} style={{ padding: 34, textAlign: 'center', color: '#64748b' }}>ไม่พบรายการ OP Refer ตามช่วงวันที่และตัวกรอง</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <p style={{ color: '#64748b', fontSize: 11, marginTop: 10 }}>
                หมายเหตุ: ผู้ป่วย Refer ไปเองห้ามมีข้อเบิกค่ารถ ADP กลุ่ม S1... ในใบสั่งยา หากพบระบบจะแจ้งติด C ให้ลบรายการ ส่วนกรณีใช้รถพยาบาลจริงให้ตรวจ S1801/S1802 และหลักฐานประกอบ
            </p>
        </section>
    );
};

````
