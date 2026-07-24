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
    ready: { label: 'พร้อมตรวจ/ส่ง', color: '#b45309', background: '#fef3c7' },
    submitted: { label: 'ส่งแล้วรอผล', color: '#1d4ed8', background: '#dbeafe' },
    paid: { label: 'พบยอดรับ', color: '#15803d', background: '#dcfce7' },
};

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
            if (!query) return true;
            return [item.hn, item.visitCode, item.patientName, item.fund, ...item.evidence, ...item.missing]
                .join(' ')
                .toLowerCase()
                .includes(query);
        });
    }, [data?.items, search, status]);

    const summary = data?.categories.find((category) => category.key === 'op_refer');

    return (
        <section style={{ marginBottom: 30 }}>
            <div style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%)', border: '1px solid #bae6fd', borderRadius: 14, padding: 20 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                        <h2 style={{ margin: 0, color: '#0f3d66', fontSize: 22 }}>🔁 มอนิเตอร์ OP Refer</h2>
                        <p style={{ margin: '6px 0 0', color: '#475569', fontSize: 13 }}>
                            ตรวจสิทธิรับส่งต่อ เลข/วันที่ Refer ทิศทาง รหัสหน่วยบริการ 5 หลัก Diagnosis ค่าใช้จ่าย และ EP
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
                        ['พร้อมตรวจ/ส่ง', summary?.ready || 0, '#b45309', '#fffbeb'],
                        ['ส่งแล้วรอผล', summary?.submitted || 0, '#1d4ed8', '#eff6ff'],
                        ['ยอดค่าบริการ', money(summary?.knownCharges || 0), '#15803d', '#f0fdf4'],
                    ].map(([label, value, color, background]) => (
                        <article key={String(label)} style={{ padding: 14, borderRadius: 10, background: String(background), border: '1px solid #e2e8f0' }}>
                            <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
                            <strong style={{ display: 'block', color: String(color), fontSize: 22, marginTop: 5 }}>{String(value)}</strong>
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
                    <option value="ready">พร้อมตรวจ/ส่ง</option>
                    <option value="submitted">ส่งแล้วรอผล</option>
                    <option value="paid">พบยอดรับ</option>
                </select>
            </div>

            <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                    <thead style={{ background: '#f8fafc', color: '#334155', fontSize: 12 }}>
                        <tr>
                            {['สถานะ', 'วันที่ / VN', 'ผู้ป่วย', 'สิทธิ', 'หลักฐาน Refer', 'ข้อมูลที่ต้องแก้', 'ค่าใช้จ่าย'].map((heading) => (
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
                            <tr><td colSpan={7} style={{ padding: 34, textAlign: 'center', color: '#64748b' }}>ไม่พบรายการ OP Refer ตามช่วงวันที่และตัวกรอง</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <p style={{ color: '#64748b', fontSize: 11, marginTop: 10 }}>
                หมายเหตุ: มอนิเตอร์นี้ช่วยคัดกรองความครบถ้วนเบื้องต้น ต้องยืนยันสิทธิและเกณฑ์รับส่งต่อที่ใช้จริงก่อนส่งเบิก
            </p>
        </section>
    );
};
