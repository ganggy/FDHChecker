import React, { useState, useEffect } from 'react';
import { formatLocalDateInput } from '../utils/dateUtils';
import * as XLSX from 'xlsx';

const readResponseError = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text().catch(() => '');

    if (contentType.toLowerCase().includes('application/json')) {
        try {
            const parsed = JSON.parse(rawText);
            const message = parsed?.error || parsed?.message || rawText;
            return message ? String(message) : `HTTP ${response.status}`;
        } catch {
            // fall through to raw text
        }
    }

    const snippet = rawText.trim().slice(0, 240);
    return snippet ? `HTTP ${response.status}: ${snippet}` : `HTTP ${response.status}`;
};

const fetchJsonOrThrow = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);

    if (!response.ok) {
        throw new Error(await readResponseError(response));
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.toLowerCase().includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(text.trim() ? text.trim().slice(0, 240) : 'Response is not JSON');
    }
};

// Skeleton row used while loading
const SkeletonRows: React.FC<{ cols: number; rows?: number }> = ({ cols, rows = 3 }) => (
    <>
        {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
                {Array.from({ length: cols }).map((_, j) => (
                    <td key={j}>
                        <div style={{
                            height: 14, borderRadius: 6,
                            background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)',
                            backgroundSize: '200% 100%',
                            animation: 'shimmer 1.4s infinite',
                            width: j === 0 ? '60%' : '80%',
                        }} />
                    </td>
                ))}
            </tr>
        ))}
    </>
);

const ChartDetailModal: React.FC<{ an: string; onClose: () => void; onAuditComplete?: () => void }> = ({ an, onClose, onAuditComplete }) => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isAuditing, setIsAuditing] = useState(false);

    const handleAudit = async () => {
        setIsAuditing(true);
        try {
            const response = await fetch('/api/hosxp/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ an, status: 'AUDITED', updated_by: 'IPD Coder', notes: 'ตรวจสอบผ่าน Dashboard' })
            });
            const result = await response.json();
            if (result.success) {
                if (onAuditComplete) onAuditComplete();
                onClose();
            } else {
                alert('เกิดข้อผิดพลาดในการบันทึก: ' + result.error);
            }
        } catch (e) {
            alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setIsAuditing(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 s hard timeout

        setLoading(true);
        setLoadError(null);

        fetchJsonOrThrow(`/api/hosxp/ipd-chart?an=${encodeURIComponent(an)}`, { signal: controller.signal })
            .then(res => {
                if (res.success) {
                    setData(res.data);
                } else {
                    setLoadError(res.error || 'ไม่สามารถดึงข้อมูลชาร์ตได้');
                }
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    setLoadError(err?.message || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
                }
            })
            .finally(() => {
                clearTimeout(timeoutId);
                setLoading(false);
            });

        return () => { clearTimeout(timeoutId); controller.abort(); };
    }, [an]);

    return (
        <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 800, maxHeight: '90vh', overflowY: 'auto', borderRadius: 12, padding: '24px 32px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
                    <h2 style={{ margin: 0, color: 'var(--primary)', fontSize: 20 }}>📋 รายละเอียดชาร์ตเวชระเบียนผู้ป่วยใน</h2>
                    <button onClick={onClose} style={{ background: 'var(--surface-2)', border: 'none', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>&times;</button>
                </div>                {loading ? (
                    <div>
                        {/* Patient info skeleton */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24, padding: '16px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'rgba(37,99,235,0.03)' }}>
                            {[70, 90, 60].map((w, i) => (
                                <div key={i}>
                                    <div style={{ height: 10, width: '40%', borderRadius: 4, background: '#e5e7eb', marginBottom: 8 }} />
                                    <div style={{ height: 16, width: `${w}%`, borderRadius: 4, background: 'linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
                                </div>
                            ))}
                        </div>
                        {/* Section skeletons */}
                        {[
                            { label: '🔴 การวินิจฉัยโรค (Diagnosis ICD-10)', cols: 3, rows: 3 },
                            { label: '🟢 หัตถการและผ่าตัด (Procedure ICD-9)', cols: 2, rows: 2 },
                            { label: '🟡 ผลการตรวจทางห้องปฏิบัติการ', cols: 4, rows: 4 },
                            { label: '🔵 รายการยา', cols: 3, rows: 4 },
                        ].map(({ label, cols, rows }) => (
                            <div key={label} style={{ marginBottom: 28 }}>
                                <div style={{ height: 15, width: '40%', borderRadius: 4, background: '#d1d5db', marginBottom: 12 }} />
                                <table className="data-table" style={{ fontSize: 13 }}>
                                    <tbody><SkeletonRows cols={cols} rows={rows} /></tbody>
                                </table>
                            </div>
                        ))}
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, marginTop: 8, paddingBottom: 8 }}>
                            ⏳ กำลังดึงข้อมูลชาร์ตจาก HOSxP... (ประมวลผลแบบขนาน)
                        </div>
                    </div>
                ) : loadError ? (
                    <div style={{ padding: '40px 0', textAlign: 'center' }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                        <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 8 }}>เกิดข้อผิดพลาดในการดึงข้อมูล</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>{loadError}</div>
                        <button className="btn btn-primary" onClick={() => {
                            setLoading(true);
                            setLoadError(null);
                            fetchJsonOrThrow(`/api/hosxp/ipd-chart?an=${encodeURIComponent(an)}`)
                                .then(res => {
                                    if (res.success) setData(res.data);
                                    else setLoadError(res.error || 'error');
                                })
                                .catch((err) => setLoadError(err?.message || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'))
                                .finally(() => setLoading(false));
                        }}>
                            🔄 ลองใหม่อีกครั้ง
                        </button>
                    </div>
                ) : !data ? (
                    <div className="alert alert-danger">ไม่พบข้อมูลชาร์ต หรือเกิดข้อผิดพลาดในการดึงข้อมูล</div>
                ) : (
                    <div>
                        {Array.isArray(data.warnings) && data.warnings.length > 0 && (
                            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>ดึงข้อมูลได้บางส่วน</div>
                                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                                    {data.warnings.map((warning: string, index: number) => (
                                        <div key={`${warning}-${index}`}>{warning}</div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24, background: 'linear-gradient(to right, rgba(37, 99, 235, 0.05), rgba(37, 99, 235, 0.02))', padding: '16px 20px', borderRadius: 8, border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                            <div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>ชื่อผู้ป่วย (Patient Name)</div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{data.patient?.patientName}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>AN / HN</div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}><span style={{ color: 'var(--primary)' }}>{data.patient?.an}</span> / {data.patient?.hn}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>ตึกผู้ป่วย (Ward)</div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{data.patient?.ward || '-'}</div>
                            </div>
                        </div>

                        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'inline-block', width: 4, height: 16, background: 'var(--danger)', borderRadius: 2 }}></span>
                            การวินิจฉัยโรค (Diagnosis ICD-10)
                        </h3>
                        <table className="data-table detail-modal-table detail-modal-table--diagnoses" style={{ marginBottom: 28, fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'var(--surface-2)' }}>
                                    <th style={{ width: 100, textAlign: 'center' }}>ประเภท</th>
                                    <th style={{ width: 120 }}>รหัส ICD-10</th>
                                    <th>ชื่อโรค (Description)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.diags?.length ? data.diags.map((d: any, i: number) => (
                                    <tr key={i}>
                                        <td style={{ textAlign: 'center' }}>
                                            <span className={`badge ${d.diagtype === '1' ? 'badge-danger' : d.diagtype === '2' ? 'badge-warning' : 'badge-primary'}`} style={{ width: '100%', display: 'inline-block' }}>
                                                {d.diagtype === '1' ? 'PDX (หลัก)' : d.diagtype === '2' ? 'Comorbid' : d.diagtype === '3' ? 'Complication' : 'Other'}
                                            </span>
                                        </td>
                                        <td style={{ fontWeight: 700, color: d.diagtype === '1' ? 'var(--danger)' : 'var(--text-primary)' }}>{d.icd10}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{d.codeName || '-'}</td>
                                    </tr>
                                )) : <tr><td colSpan={3} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>ไม่พบข้อมูลรหัสโรค</td></tr>}
                            </tbody>
                        </table>

                        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'inline-block', width: 4, height: 16, background: 'var(--success)', borderRadius: 2 }}></span>
                            หัตถการและผ่าตัด (Procedure ICD-9)
                        </h3>
                        <table className="data-table detail-modal-table detail-modal-table--procedures" style={{ marginBottom: 28, fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'var(--surface-2)' }}>
                                    <th style={{ width: 120 }}>รหัส ICD-9</th>
                                    <th>ชื่อหัตถการ (Description)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.opers?.length ? data.opers.map((o: any, i: number) => (
                                    <tr key={i}>
                                        <td style={{ fontWeight: 700, color: 'var(--success)' }}>{o.icd9}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{o.opName || '-'}</td>
                                    </tr>
                                )) : <tr><td colSpan={2} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>ไม่พบข้อมูลรหัสหัตถการ (ICD-9)</td></tr>}
                            </tbody>
                        </table>

                        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'inline-block', width: 4, height: 16, background: 'var(--warning)', borderRadius: 2 }}></span>
                            ผลการตรวจทางห้องปฏิบัติการ (Lab Results ล่าสุด)
                        </h3>
                        <table className="data-table detail-modal-table detail-modal-table--labs" style={{ marginBottom: 28, fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'var(--surface-2)' }}>
                                    <th style={{ width: 150 }}>วันที่-เวลา</th>
                                    <th>รายการตรวจ (Lab Item)</th>
                                    <th style={{ width: 120, textAlign: 'center' }}>ผลลัพธ์ (Result)</th>
                                    <th style={{ width: 120, textAlign: 'center' }}>ค่าปกติ (Normal)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.labs?.length ? data.labs.map((l: any, i: number) => {
                                    return (
                                        <tr key={i}>
                                            <td className="detail-modal-date-cell">{new Date(l.order_date).toLocaleString('th-TH')}</td>
                                            <td className="detail-modal-primary-cell">{l.lab_items_name || '-'}</td>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>{l.lab_order_result || '-'}</td>
                                            <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{l.lab_items_normal_value || '-'}</td>
                                        </tr>
                                    );
                                }) : <tr><td colSpan={4} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>ไม่พบข้อมูลผลแล็บ</td></tr>}
                            </tbody>
                        </table>

                        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'inline-block', width: 4, height: 16, background: 'var(--primary)', borderRadius: 2 }}></span>
                            รายการยาราคาแพง 10 อันดับแรก (Top High-Cost Drugs)
                        </h3>
                        <table className="data-table detail-modal-table detail-modal-table--drugs" style={{ marginBottom: 28, fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'var(--surface-2)' }}>
                                    <th>ชื่อยา (Drug Name)</th>
                                    <th style={{ width: 100, textAlign: 'center' }}>จำนวน</th>
                                    <th style={{ width: 120, textAlign: 'right' }}>มูลค่ารวม (บาท)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.drugs?.length ? data.drugs.map((d: any, i: number) => (
                                    <tr key={i}>
                                        <td style={{ fontWeight: 600 }}>{d.name || '-'}</td>
                                        <td style={{ textAlign: 'center' }}>{Number(d.total_qty).toLocaleString()}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--teal)' }}>{Number(d.total_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                    </tr>
                                )) : <tr><td colSpan={3} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>ไม่พบข้อมูลสั่งจ่ายยา</td></tr>}
                            </tbody>
                        </table>

                        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'inline-block', width: 4, height: 16, background: 'var(--teal)', borderRadius: 2 }}></span>
                            สรุปค่าใช้จ่ายตามหมวดหมู่ (Cost Summary)
                        </h3>
                        <table className="data-table detail-modal-table detail-modal-table--costs" style={{ fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'var(--surface-2)' }}>
                                    <th>หมวดหมู่ค่าใช้จ่าย (Income Group)</th>
                                    <th style={{ textAlign: 'right', width: 150 }}>จำนวนเงิน (บาท)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.costSummary?.length ? data.costSummary.map((c: any, i: number) => (
                                    <tr key={i}>
                                        <td style={{ color: 'var(--text-secondary)' }}>{c.incomeGroup || 'ไม่ระบุหมวด'}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{Number(c.sumPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    </tr>
                                )) : <tr><td colSpan={2} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>ไม่พบข้อมูลค่าใช้จ่าย</td></tr>}
                            </tbody>
                            {data.costSummary?.length > 0 && (
                                <tfoot>
                                    <tr style={{ background: 'rgba(20, 184, 166, 0.1)' }}>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--teal)' }}>ยอดรวมทั้งหมด (Total Cost)</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--teal)', fontSize: 15 }}>
                                            {data.costSummary.reduce((sum: number, c: any) => sum + Number(c.sumPrice || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>

                        <div style={{ marginTop: 24, padding: 16, background: 'rgba(16, 185, 129, 0.05)', borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h4 style={{ margin: '0 0 4px 0', color: 'var(--success)' }}>ยืนยันการตรวจสอบชาร์ต (Audit)</h4>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>เมื่อตรวจสอบรหัสโรคและค่าใช้จ่ายครบถ้วนแล้ว ให้กดปุ่มนี้เพื่อบันทึกสถานะให้ทีมงานทราบว่าตรวจสอบแล้ว</div>
                            </div>
                            <button className="btn btn-success" onClick={handleAudit} disabled={isAuditing} style={{ padding: '8px 24px', fontSize: 14 }}>
                                {isAuditing ? 'กำลังบันทึก...' : '✅ บันทึกว่าตรวจสอบแล้ว'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const IPDPage: React.FC = () => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const todayStr = formatLocalDateInput();
    const [startDate, setStartDate] = useState(todayStr);
    const [endDate, setEndDate] = useState(todayStr);
    const [statusFilter, setStatusFilter] = useState('all');
    const [wardFilter, setWardFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [selectedAN, setSelectedAN] = useState<string | null>(null);

    const fetchIPDData = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchJsonOrThrow(`/api/hosxp/ipd-list?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&statusFilter=${encodeURIComponent(statusFilter)}`);
            if (result.success) {
                setData(result.data);
            } else {
                setError(result.error || 'Failed to fetch IPD data');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error connecting to server');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchIPDData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, startDate, endDate]);

    const exportToCSV = () => {
        if (!data || data.length === 0) {
            alert('ไม่พบข้อมูลสำหรับส่งออก');
            return;
        }

        const headers = ['ลำดับ', 'AN', 'HN', 'ชื่อ-สกุล', 'ตึกผู้ป่วย', 'สิทธิ', 'วันที่ Admit', 'วันที่ D/C', 'วันนอน (LOS)', 'รหัสโรค (PDx)', 'รหัสหัตถการ (OR)', 'DRG', 'RW', 'ค่าใช้จ่าย', 'สถานะ FDH', 'วันที่ส่ง FDH', 'Error FDH', 'สถานะ'];

        const rows = data.map((item, index) => {
            const statusStr = !item.pdx || item.pdx === '-' ? 'รอสรุปชาร์ต' : (item.dchdate ? 'จำหน่าย (D/C)' : 'กำลังรักษา');
            return [
                index + 1,
                item.an || '',
                item.hn || '',
                item.patientName || '',
                item.ward || '-',
                item.pttype || item.hipdata_code || '',
                item.regdate || '',
                item.dchdate || '',
                item.los || '0',
                (item.pdx || '').replace(/,/g, ' '),
                (item.or_codes || '').replace(/,/g, ' '),
                item.drg || '',
                item.rw || '',
                item.totalPrice || '0',
                getFdhStatusLabel(item),
                item.fdh_reservation_datetime || item.fdh_updated_at || '',
                item.fdh_error_code || '',
                statusStr
            ].map(cell => `"${cell}"`).join(',');
        });

        const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `IPD_Report_${startDate}_to_${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportToExcel = () => {
        if (!filteredData || filteredData.length === 0) {
            alert('ไม่พบข้อมูลสำหรับส่งออก');
            return;
        }

        const dataForExcel = filteredData.map((item, index) => {
            const statusStr = !item.pdx || item.pdx === '-' ? 'รอสรุปชาร์ต' : (item.dchdate ? 'จำหน่าย (D/C)' : 'กำลังรักษา');
            return {
                'ลำดับ': index + 1,
                'AN': item.an || '',
                'HN': item.hn || '',
                'ชื่อ-สกุล': item.patientName || '',
                'ตึกผู้ป่วย': item.ward || '-',
                'สิทธิ': item.pttype || item.hipdata_code || '',
                'วันที่ Admit': item.regdate || '',
                'วันที่ D/C': item.dchdate || '',
                'วันนอน (LOS)': item.los || '0',
                'รหัสโรค (PDx)': item.pdx || '',
                'รหัสหัตถการ (OR)': item.or_codes || '',
                'DRG': item.drg || '',
                'RW': item.rw || '',
                'ค่าใช้จ่าย': item.totalPrice || '0',
                'สถานะ FDH': getFdhStatusLabel(item),
                'วันที่ส่ง FDH': item.fdh_reservation_datetime || item.fdh_updated_at || '',
                'Error FDH': item.fdh_error_code || '',
                'สถานะ': statusStr
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "IPD Data");

        const colWidths = [
            { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 25 },
            { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
            { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 10 },
            { wch: 10 }, { wch: 15 }, { wch: 18 }, { wch: 18 },
            { wch: 14 }, { wch: 15 }
        ];
        worksheet['!cols'] = colWidths;

        XLSX.writeFile(workbook, `IPD_Report_${startDate}_to_${endDate}.xlsx`);
    };

    const uniqueWards = Array.from(new Set(data.map(item => item.ward))).filter(Boolean).sort();

    const filteredData = data.filter(item => {
        if (wardFilter !== 'all' && item.ward !== wardFilter) return false;

        if (!search) return true;
        const q = search.toLowerCase();
        return (
            (item.an && item.an.toLowerCase().includes(q)) ||
            (item.hn && item.hn.toLowerCase().includes(q)) ||
            (item.patientName && item.patientName.toLowerCase().includes(q))
        );
    });

    const admittedCount = data.filter(i => i.status === 'Admitted').length;
    const dischargedCount = data.filter(i => i.status === 'Discharged').length;
    const pendingChartCount = data.filter(i => i.chartStatus === 'รอแพทย์สรุปชาร์ต').length;
    const auditedCount = data.filter(i => i.audit_status === 'AUDITED').length;
    const fdhSubmittedCount = data.filter(i => i.fdh_transaction_uid || i.fdh_reservation_status || i.fdh_updated_at).length;

    const getFdhStatusTone = (item: any) => {
        const text = String(item.fdh_reservation_status || item.fdh_claim_status_message || '').toLowerCase();
        if (item.fdh_error_code || text.includes('reject') || text.includes('error') || text.includes('fail') || text.includes('ปฏิเสธ')) return 'danger';
        if (!item.fdh_transaction_uid && !item.fdh_reservation_status && !item.fdh_updated_at) return 'muted';
        if (text.includes('รอ') || text.includes('pending')) return 'warning';
        return 'success';
    };

    const getFdhStatusLabel = (item: any) => {
        if (item.fdh_reservation_status) return item.fdh_reservation_status;
        if (item.fdh_transaction_uid || item.fdh_updated_at) return 'พบสถานะ FDH';
        return 'ยังไม่พบ FDH';
    };

    return (
        <div className="page-container" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div>
                    <h1 className="page-title">🛏️ รายการผู้ป่วยใน (IPD Monitoring)</h1>
                    <p className="page-subtitle">แสดงรายการผู้ป่วยใน พร้อมตัวชี้วัดสำคัญ (DRG, RW, วันนอน) เพื่อการตรวจสอบการเบิกจ่าย</p>
                </div>

                {/* Dashboard Summary Cards */}
                <div style={{ display: 'flex', gap: 16 }}>
                    <div className="card" style={{ padding: '12px 20px', textAlign: 'center', background: 'var(--surface-2)', minWidth: 150 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ผู้ป่วยพักรักษาตัว (Admitting)</div>
                        <div style={{ fontSize: 24, fontWeight: '700', color: 'var(--primary)' }}>{admittedCount} <span style={{ fontSize: 14 }}>ราย</span></div>
                    </div>
                    <div className="card" style={{ padding: '12px 20px', textAlign: 'center', background: 'var(--surface-2)', minWidth: 150 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>จำหน่ายแล้ว (Discharged)</div>
                        <div style={{ fontSize: 24, fontWeight: '700', color: 'var(--text-primary)' }}>{dischargedCount} <span style={{ fontSize: 14 }}>ราย</span></div>
                    </div>
                    <div className="card" style={{ padding: '12px 20px', textAlign: 'center', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', minWidth: 150 }}>
                        <div style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>รอสรุป / รอตรวจสอบ</div>
                        <div style={{ fontSize: 24, fontWeight: '700', color: 'var(--danger)' }}>{pendingChartCount} <span style={{ fontSize: 14 }}>แฟ้ม</span></div>
                    </div>
                    <div className="card" style={{ padding: '12px 20px', textAlign: 'center', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', minWidth: 150 }}>
                        <div style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>ตรวจสอบเรียบร้อยแล้ว</div>
                        <div style={{ fontSize: 24, fontWeight: '700', color: 'var(--success)' }}>{auditedCount} <span style={{ fontSize: 14 }}>แฟ้ม</span></div>
                    </div>
                    <div className="card" style={{ padding: '12px 20px', textAlign: 'center', background: 'rgba(14, 165, 233, 0.1)', border: '1px solid rgba(14, 165, 233, 0.26)', minWidth: 150 }}>
                        <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>มีสถานะจาก FDH</div>
                        <div style={{ fontSize: 24, fontWeight: '700', color: 'var(--primary)' }}>{fdhSubmittedCount} <span style={{ fontSize: 14 }}>ราย</span></div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
                        <label className="form-label">🔍 ค้นหา (AN, HN, ชื่อผู้ป่วย)</label>
                        <input type="text" className="form-control" placeholder="พิมพ์เพื่อค้นหา..." value={search} onChange={e => setSearch(e.target.value)} />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, width: 150 }}>
                        <label className="form-label">📅 เริ่มวันที่ (Admit)</label>
                        <input
                            type="date"
                            className="form-control"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, width: 150 }}>
                        <label className="form-label">📅 ถึงวันที่</label>
                        <input
                            type="date"
                            className="form-control"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, width: 200 }}>
                        <label className="form-label">ตึกผู้ป่วย (Ward)</label>
                        <select className="form-control" value={wardFilter} onChange={e => setWardFilter(e.target.value)}>
                            <option value="all">ทั้งหมด</option>
                            {uniqueWards.map(w => (
                                <option key={w as string} value={w as string}>{w as string}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, width: 200 }}>
                        <label className="form-label">สถานะ</label>
                        <select className="form-control" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="all">ทั้งหมด</option>
                            <option value="admitted">กำลังรักษา (Admitted)</option>
                            <option value="discharged">จำหน่ายแล้ว (Discharged)</option>
                        </select>
                    </div>

                    <button className="btn btn-primary" onClick={fetchIPDData} disabled={loading}>
                        {loading ? '⏳ กำลังโหลด...' : '🔄 กรองข้อมูล'}
                    </button>
                    <button className="btn" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} onClick={exportToCSV} disabled={loading || filteredData.length === 0}>
                        ⬇️ ออกรายงาน (CSV)
                    </button>
                    <button className="btn btn-warning" onClick={exportToExcel} disabled={loading || filteredData.length === 0}>
                        📊 ออกรายงาน (Excel)
                    </button>
                </div>
            </div>            {error && (
                <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                    <span>⚠️</span> <span>{error}</span>
                </div>
            )}            <div className="card" style={{ overflow: 'visible' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table ipd-status-table" style={{ minWidth: 1510 }}>
                        <thead>
                            <tr>
                                <th style={{ width: 40, textAlign: 'center' }}>#</th>
                                <th style={{ width: 100 }}>AN / HN</th>
                                <th style={{ minWidth: 160 }}>ชื่อผู้ป่วย / สิทธิการรักษา</th>
                                <th style={{ width: 120 }}>ตึกผู้ป่วย (Ward)</th>
                                <th style={{ width: 110, textAlign: 'center' }}>วันที่ Admit <br /><span style={{ fontSize: 11, fontWeight: 'normal' }}>และจำนวนวันนอน (LOS)</span></th>
                                <th style={{ width: 160, background: 'rgba(37, 99, 235, 0.05)' }}>ข้อมูลทางคลินิก (รหัสโรค/หัตถการ)</th>
                                <th style={{ width: 130, textAlign: 'center', background: 'rgba(16, 185, 129, 0.05)' }}>ระบบเบิกจ่าย<br /><span style={{ fontSize: 11, fontWeight: 'normal' }}>(RW / ค่าใช้จ่าย)</span></th>
                                <th style={{ width: 160, textAlign: 'center', background: 'rgba(14, 165, 233, 0.06)' }}>สถานะ FDH<br /><span style={{ fontSize: 11, fontWeight: 'normal' }}>รายตัว</span></th>
                                <th style={{ width: 150, textAlign: 'center' }}>สถานะผู้ป่วย / ชาร์ต</th>
                                <th style={{ width: 180, textAlign: 'center', background: 'rgba(245, 158, 11, 0.05)' }}>ตรวจจับความเสี่ยง<br /><span style={{ fontSize: 11, fontWeight: 'normal' }}>(Auto Pre-Audit)</span></th>
                                <th style={{ width: 90, textAlign: 'center' }}>จัดการ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={11} style={{ textAlign: 'center', padding: '40px 0' }}>
                                        <div className="spinner" style={{ margin: '0 auto 10px' }} />
                                        กำลังดึงข้อมูลจากระบบ HOSxP...
                                    </td>
                                </tr>                            ) : filteredData.length > 0 ? (
                                filteredData.map((item, index) => (
                                    <tr 
                                        key={item.an || index} 
                                        className="clickable-row"
                                        onClick={() => setSelectedAN(item.an)}
                                        style={{ cursor: 'pointer', transition: 'background-color 0.2s ease' }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.08)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{index + 1}</td>
                                        <td>
                                            <div style={{ fontWeight: 600, color: 'var(--primary)' }}>{item.an}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>HN: {item.hn}</div>
                                        </td>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{item.patientName}</div>
                                            <div style={{ fontSize: 11, color: 'var(--teal)' }}>{item.pttype || item.hipdata_code}</div>
                                        </td>
                                        <td>
                                            <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{item.ward || '-'}</span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <div>{item.admDate}</div>
                                            <div style={{ fontSize: 12, marginTop: 4 }}>
                                                <span className={`badge ${Number(item.los) > 5 ? 'badge-warning' : 'badge-success'}`}>LOS: {item.los || 0} วัน</span>
                                            </div>
                                        </td>
                                        <td style={{ background: 'rgba(37, 99, 235, 0.02)', maxWidth: 160 }}>
                                            <div style={{ fontSize: 13, marginBottom: 4, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>PDx: </span>
                                                <strong style={{ color: item.pdx ? 'var(--danger)' : 'var(--text-muted)' }}>{item.pdx || 'ยังไม่ระบุ'}</strong>
                                            </div>
                                            <div style={{ fontSize: 12, whiteSpace: 'normal', wordBreak: 'break-all' }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>OR: </span>
                                                <span style={{ color: item.or_codes ? 'var(--primary)' : 'var(--text-muted)' }}>{item.or_codes || '-'}</span>
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.02)' }}>
                                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)', marginBottom: 4 }}>
                                                RW: {item.rw ? Number(item.rw).toFixed(4) : '-'}
                                                {item.drg && <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{item.drg}</div>}
                                            </div>
                                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                                {Number(item.totalPrice || 0).toLocaleString()} ฿
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'center', background: 'rgba(14, 165, 233, 0.03)' }}>
                                            <div className={`ipd-fdh-status ipd-fdh-status--${getFdhStatusTone(item)}`}>
                                                <strong>{getFdhStatusLabel(item)}</strong>
                                                <small>{item.fdh_reservation_datetime || item.fdh_updated_at || 'ยังไม่มีวันส่ง'}</small>
                                                {item.fdh_error_code ? <small>ERR {item.fdh_error_code}</small> : null}
                                                {item.fdh_stm_period ? <small>STM {item.fdh_stm_period}</small> : null}
                                                {item.fdh_act_amt ? <small>{Number(item.fdh_act_amt).toLocaleString()} ฿</small> : null}
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <div style={{ marginBottom: 4 }}>
                                                {item.status === 'Admitted'
                                                    ? <span className="badge badge-primary">กำลังรักษา (Admitted)</span>
                                                    : <span className="badge badge-success">จำหน่ายแล้ว (D/C)</span>
                                                }
                                            </div>
                                            <div style={{ fontSize: 11 }}>
                                                {item.audit_status === 'AUDITED'
                                                    ? <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✅ ตรวจสอบแล้ว<br /><span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 'normal' }}>{item.audit_date ? new Date(item.audit_date).toLocaleDateString('th-TH') : ''}</span></span>
                                                    : item.chartStatus === 'สรุปชาร์ตแล้ว'
                                                        ? <span style={{ color: 'var(--primary)' }}>สรุปชาร์ตแล้ว</span>
                                                        : item.chartStatus === 'รอแพทย์สรุปชาร์ต'
                                                            ? <span style={{ color: 'var(--danger)' }}>⏳ รอแพทย์สรุปชาร์ต</span>
                                                            : <span style={{ color: 'var(--text-muted)' }}>- {item.chartStatus} -</span>
                                                }
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'left', background: 'rgba(245, 158, 11, 0.02)' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                                                {!item.pdx || item.pdx === '-' ? (
                                                    <span style={{ color: 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <span style={{ fontSize: 13 }}>🔴</span> Missing PDx (ขาดรหัสโรคหลัก)
                                                    </span>
                                                ) : null}
                                                {item.or_codes && item.or_codes !== '-' && (!item.rw || Number(item.rw) === 0) ? (
                                                    <span style={{ color: 'var(--warning)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <span style={{ fontSize: 13 }}>🟠</span> OR but RW=0 (ผ่าตัดแต่ RW ไม่ขึ้น)
                                                    </span>
                                                ) : null}
                                                {Number(item.los) > 10 && (!item.rw || Number(item.rw) < 0.8) ? (
                                                    <span style={{ color: 'var(--warning)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <span style={{ fontSize: 13 }}>🟠</span> High LOS/Low RW (นอนนานแต่ RW ต่ำ)
                                                    </span>
                                                ) : null}
                                                {(item.pdx && item.pdx !== '-') && (!item.or_codes || item.or_codes === '-' || Number(item.rw) > 0) && (Number(item.los) <= 10 || Number(item.rw) >= 0.8) ? (
                                                    <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <span style={{ fontSize: 13 }}>🟢</span> ปกติเบื้องต้น (Basic Pass)
                                                    </span>
                                                ) : null}
                                            </div>
                                        </td>                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                className="btn btn-sm"
                                                style={{ padding: '4px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(37, 99, 235, 0.1)', color: 'var(--primary)', border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'all 0.2s ease' }}
                                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(37, 99, 235, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(37, 99, 235, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }}
                                                onClick={(e) => { e.stopPropagation(); setSelectedAN(item.an); }}
                                            >
                                                <span>🔍</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={11} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                                        ไม่พบข้อมูลผู้ป่วยใน ตามเงื่อนไขที่ระบุ
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style={{ marginTop: 24, padding: 24, background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                <h3 style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24 }}>🛡️</span> แนวทางการตรวจสอบชาร์ต (IPD Pre-Audit Checkpoints)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                    <div className="card" style={{ padding: 16, border: 'none', background: '#fff' }}>
                        <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 10 }}>1. ข้อมูลพื้นฐานที่ห้ามขาด (Essential)</div>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                            <li><strong>Principal Diagnosis (PDx):</strong> ต้องลงรหัสโรคที่เป็นเหตุผลหลักในการรับไว้รักษา</li>
                            <li><strong>Admission/Discharge Date:</strong> ตรวจสอบว่ามีวัน Admit และจำหน่ายครบถ้วน</li>
                        </ul>
                    </div>
                    <div className="card" style={{ padding: 16, border: 'none', background: '#fff' }}>
                        <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 10 }}>2. จุดเสี่ยงการเสียโอกาส (Billing Risk)</div>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                            <li><strong>OR/Procedure Mapping:</strong> หากมีการผ่าตัด ต้องลงรหัส ICD-9-CM ให้ครบ เพื่อเปลี่ยนกลุ่ม DRG ให้สูงขึ้น</li>
                            <li><strong>Low RW Warning:</strong> หากคนไข้มีวันนอนนาน (LOS &gt; 10 วัน) แต่ RW &lt; 0.8 ให้ตรวจสอบว่าลืมลงรหัส Complication หรือไม่</li>
                        </ul>
                    </div>
                    <div className="card" style={{ padding: 16, border: 'none', background: '#fff' }}>
                        <div style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: 10 }}>3. การเพิ่มคุณภาพรหัส (Clinical Refinement)</div>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                            <li><strong>Secondary Diagnosis (SDx):</strong> ค้นหาโรคร่วม/โรคแทรกซ้อน จากผล Lab หรือบันทึกทางการพยาบาล</li>
                            <li><strong>RW Boosters:</strong> ตรวจสอบอุปกรณ์พิเศษ (Devices) หรือยาความเสี่ยงสูงที่มีค่าใช้จ่ายนอกจาก DRG</li>
                        </ul>
                    </div>
                </div>
            </div>

            {selectedAN && (
                <ChartDetailModal an={selectedAN} onClose={() => setSelectedAN(null)} onAuditComplete={fetchIPDData} />
            )}
        </div>
    );
};
