import React, { useCallback, useEffect, useMemo, useState } from 'react';

type MatchType = 'exact' | 'prefix';

type IpdLosRule = {
    id: string;
    diagnosisCode: string;
    matchType: MatchType;
    targetLos: number;
    note: string;
    active: boolean;
};

const newRule = (): IpdLosRule => ({
    id: globalThis.crypto?.randomUUID?.() || `ipd-los-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    diagnosisCode: '',
    matchType: 'exact',
    targetLos: 1,
    note: '',
    active: true,
});

const readPayload = async (response: Response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.error || 'ดำเนินการไม่สำเร็จ');
    return payload;
};

export const IpdLosSettings: React.FC = () => {
    const [rules, setRules] = useState<IpdLosRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [search, setSearch] = useState('');

    const loadRules = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const payload = await readPayload(await fetch('/api/config/ipd-los-settings'));
            setRules(Array.isArray(payload.data) ? payload.data : []);
            setDirty(false);
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : 'โหลดค่ามาตรฐาน LOS ไม่สำเร็จ' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void loadRules(); }, [loadRules]);

    const updateRule = (id: string, changes: Partial<IpdLosRule>) => {
        setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...changes } : rule));
        setDirty(true);
        setMessage(null);
    };

    const addRule = () => {
        setRules((current) => [...current, newRule()]);
        setDirty(true);
        setMessage(null);
    };

    const removeRule = (id: string) => {
        setRules((current) => current.filter((rule) => rule.id !== id));
        setDirty(true);
        setMessage(null);
    };

    const saveRules = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const payload = await readPayload(await fetch('/api/config/ipd-los-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rules }),
            }));
            setRules(Array.isArray(payload.data) ? payload.data : rules);
            setDirty(false);
            setMessage({ type: 'success', text: 'บันทึกแล้ว หน้า IPD จะใช้ค่าใหม่เมื่อโหลดข้อมูลครั้งถัดไป' });
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : 'บันทึกค่ามาตรฐาน LOS ไม่สำเร็จ' });
        } finally {
            setSaving(false);
        }
    };

    const filteredRules = useMemo(() => {
        const query = search.trim().toUpperCase();
        if (!query) return rules;
        return rules.filter((rule) => `${rule.diagnosisCode} ${rule.note}`.toUpperCase().includes(query));
    }, [rules, search]);

    if (loading) return <div className="loading-state">กำลังโหลดค่ามาตรฐาน LOS...</div>;

    return (
        <div className="settings-section ipd-los-settings">
            <div className="ipd-los-settings__header">
                <div>
                    <h3>🛏️ LOS มาตรฐานตามรหัสโรค</h3>
                    <p className="settings-section-description">
                        จับคู่กับรหัสวินิจฉัยหลัก (PDx) ในหน้า IPD เพื่อแสดง LOS เป้าหมาย ส่วนต่าง และรายการที่นอนเกินเกณฑ์
                    </p>
                </div>
                <div className="ipd-los-settings__actions">
                    <button type="button" className="secondary-btn" onClick={() => void loadRules()} disabled={saving}>↻ โหลดใหม่</button>
                    <button type="button" className="secondary-btn" onClick={addRule} disabled={saving}>＋ เพิ่มรหัสโรค</button>
                    <button type="button" className="save-btn" onClick={() => void saveRules()} disabled={saving || !dirty}>
                        {saving ? 'กำลังบันทึก...' : '💾 บันทึก LOS'}
                    </button>
                </div>
            </div>

            <div className="alert alert-info ipd-los-settings__guide">
                <span>ℹ️</span>
                <span><strong>รหัสตรงกัน</strong> ใช้เฉพาะรหัสนั้น เช่น J189 ส่วน <strong>กลุ่มรหัส</strong> จะครอบคลุมรหัสที่ขึ้นต้นเหมือนกัน เช่น J18 ครอบคลุม J180–J189 โดยกฎรหัสตรงกันจะมีลำดับก่อนเสมอ</span>
            </div>

            {message && (
                <div className={`alert ${message.type === 'error' ? 'alert-danger' : 'alert-success'}`} role="status">
                    <span>{message.type === 'error' ? '⚠️' : '✅'}</span><span>{message.text}</span>
                </div>
            )}

            <div className="ipd-los-settings__toolbar">
                <input
                    type="search"
                    className="form-control"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ค้นหารหัสโรคหรือหมายเหตุ"
                />
                <span className="settings-status-chip is-ok">เปิดใช้ {rules.filter((rule) => rule.active).length}/{rules.length} กฎ</span>
                {dirty && <span className="settings-status-chip is-warning">มีรายการยังไม่บันทึก</span>}
            </div>

            <div className="ipd-los-settings__table-wrap">
                <table className="data-table ipd-los-settings__table">
                    <thead>
                        <tr>
                            <th>ใช้</th>
                            <th>รหัส ICD-10</th>
                            <th>วิธีจับคู่</th>
                            <th>LOS เป้าหมาย (วัน)</th>
                            <th>หมายเหตุ</th>
                            <th>ลบ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRules.map((rule) => (
                            <tr key={rule.id} className={rule.active ? '' : 'is-disabled'}>
                                <td><input type="checkbox" checked={rule.active} onChange={(event) => updateRule(rule.id, { active: event.target.checked })} /></td>
                                <td>
                                    <input
                                        className="form-control ipd-los-code-input"
                                        value={rule.diagnosisCode}
                                        maxLength={8}
                                        onChange={(event) => updateRule(rule.id, { diagnosisCode: event.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '') })}
                                        placeholder="เช่น J18.9"
                                    />
                                </td>
                                <td>
                                    <select className="form-control" value={rule.matchType} onChange={(event) => updateRule(rule.id, { matchType: event.target.value as MatchType })}>
                                        <option value="exact">รหัสตรงกัน</option>
                                        <option value="prefix">กลุ่มรหัส</option>
                                    </select>
                                </td>
                                <td>
                                    <input
                                        className="form-control"
                                        type="number"
                                        min="0.5"
                                        max="365"
                                        step="0.5"
                                        value={rule.targetLos}
                                        onChange={(event) => updateRule(rule.id, { targetLos: Number(event.target.value) })}
                                    />
                                </td>
                                <td><input className="form-control" value={rule.note} maxLength={250} onChange={(event) => updateRule(rule.id, { note: event.target.value })} placeholder="เช่น Pneumonia ไม่ซับซ้อน" /></td>
                                <td><button type="button" className="btn btn-sm btn-danger" onClick={() => removeRule(rule.id)} aria-label={`ลบ ${rule.diagnosisCode || 'รายการ'}`}>ลบ</button></td>
                            </tr>
                        ))}
                        {filteredRules.length === 0 && (
                            <tr><td colSpan={6} className="ipd-los-settings__empty">{rules.length ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีกฎ LOS กด “เพิ่มรหัสโรค” เพื่อเริ่มตั้งค่า'}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

