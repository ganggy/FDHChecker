import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/Settings.css';
import defaultRules from '../config/business_rules.json';
import { FUND_DEFINITIONS } from '../config/fundDefinitions';
import { formatLocalDateStamp } from '../utils/dateUtils';

interface Config {
    costs: {
        dialysis_ucs_sss_total: number;
        dialysis_ofc_lgo_total: number;
        dialysis_fixed: number;
        epo_real_base: number;
        [key: string]: number;
    };
    diagnosis_patterns: {
        [key: string]: string | string[];
    };
    adp_codes: {
        [key: string]: string | string[];
    };
    project_codes: {
        [key: string]: string;
    };
    site_settings?: {
        hospital_name?: string;
        hospital_code?: string;
        specific_fund_visibility?: Record<string, boolean>;
        receivable_signers?: {
            director?: { name?: string; position?: string };
            insurance_head?: { name?: string; position?: string };
            finance?: { name?: string; position?: string };
        };
        lab_costs?: {
            default?: {
                enabled?: boolean;
                source?: string;
                cost_field?: string;
                sale_field?: string;
            };
            rules?: Array<{
                key: string;
                label: string;
                adp_codes: string[];
                cost: number;
            }>;
            service_cost_overrides?: {
                dialysis_fixed?: number;
                epo_real_base?: number;
            };
        };
    };
    _source?: 'database' | 'file';
}

interface FdhApiSettings {
    environment?: 'prd' | 'uat';
    hcode?: string;
    tokenUrl?: string;
    apiBaseUrl?: string;
    upload16Url?: string;
    preScreenUrl?: string;
    username?: string;
    password?: string;
}

const FALLBACK_FUND_DEFINITIONS = [
    { id: 'palliative', name: 'Palliative Care', description: 'ผู้ป่วยระยะประคับประคอง' },
    { id: 'telemedicine', name: 'Telemedicine', description: 'บริการแพทย์ทางไกล / Telemed' },
    { id: 'drugp', name: 'ส่งยาไปรษณีย์', description: 'ยา EMS / ส่งยาถึงบ้าน' },
    { id: 'herb', name: 'สมุนไพร / ยาไทย', description: 'รายการสมุนไพรและยาไทย' },
    { id: 'instrument', name: 'อวัยวะเทียม', description: 'วัสดุ/อุปกรณ์เบิกได้' },
    { id: 'preg_test', name: 'ตรวจครรภ์ (UPT)', description: 'คัดกรองการตั้งครรภ์' },
    { id: 'anc', name: 'ANC Visit', description: 'ตรวจครรภ์คุณภาพ / ฝากครรภ์' },
    { id: 'anc_ultrasound', name: 'ANC Ultrasound', description: 'อัลตราซาวนด์ระหว่างตั้งครรภ์' },
    { id: 'anc_lab_1', name: 'ANC Lab 1', description: 'ห้องแล็บชุดที่ 1 ของ ANC' },
    { id: 'anc_lab_2', name: 'ANC Lab 2', description: 'ห้องแล็บชุดที่ 2 ของ ANC' },
    { id: 'postnatal_care', name: 'ดูแลหลังคลอด', description: 'ติดตาม/ตรวจหลังคลอด' },
    { id: 'postnatal_supplements', name: 'เสริมธาตุเหล็กหลังคลอด', description: 'ยาเสริมธาตุเหล็กหลังคลอด' },
    { id: 'fluoride', name: 'เคลือบฟลูออไรด์', description: 'ทันตกรรมป้องกันฟันผุ' },
    { id: 'fp', name: 'วางแผนครอบครัว', description: 'บริการคุมกำเนิดและวางแผนครอบครัว' },
    { id: 'contraceptive_pill', name: 'ยาคุมกำเนิด', description: 'ยาคุมชนิดเม็ด' },
    { id: 'condom', name: 'ถุงยางอนามัย', description: 'บริการถุงยางอนามัย' },
    { id: 'cacervix', name: 'คัดกรองมะเร็งปากมดลูก', description: 'Pap smear / Cervix screening' },
    { id: 'er_emergency', name: 'ฉุกเฉิน (ER)', description: 'ผู้ป่วยฉุกเฉินและนอกเขต' },
    { id: 'fpg_screening', name: 'คัดกรองเบาหวาน', description: 'FPG / เบาหวาน' },
    { id: 'cholesterol_screening', name: 'คัดกรองไขมัน', description: 'ตรวจไขมันในเลือด' },
    { id: 'anemia_screening', name: 'คัดกรองโลหิตจาง', description: 'CBC / Hb-Hct + Z130/Z138 + 13001' },
    { id: 'syphilis_screening_male', name: 'คัดกรองซิฟิลิส (ชาย)', description: 'ประชาชนทั่วไปเพศชาย + Lab Treponema/Syphilis' },
    { id: 'iron_supplement', name: 'เสริมธาตุเหล็ก', description: 'ยาเสริมธาตุเหล็ก' },
    { id: 'ferrokid_child', name: 'เสริมธาตุเหล็กเด็ก (Ferrokid)', description: 'กองทุนเด็ก 2 เดือน-12 ปี (PP-B FS)' },
    { id: 'chemo', name: 'เคมีบำบัด', description: 'ผู้ป่วยเคมีบำบัด' },
    { id: 'hepc', name: 'ไวรัสตับอักเสบซี', description: 'เกิดก่อน พ.ศ.2535 + Z11.5 + Anti-HCV' },
    { id: 'hepb', name: 'ไวรัสตับอักเสบบี', description: 'เกิดก่อน พ.ศ.2535 + Z11.5 + HBsAg' },
    { id: 'rehab', name: 'ฟื้นฟูสมรรถภาพ', description: 'งานฟื้นฟู / กายภาพ' },
    { id: 'crrt', name: 'ฟอกเลือด (CRRT)', description: 'ผู้ป่วยฟอกเลือด / ไต' },
    { id: 'robot', name: 'ผ่าตัดหุ่นยนต์', description: 'Robotic surgery' },
    { id: 'proton', name: 'รังสีรักษา (Proton)', description: 'ฉายแสงโปรตอน' },
    { id: 'cxr', name: 'อ่านฟิล์ม CXR', description: 'อ่านฟิล์มทรวงอก' },
    { id: 'clopidogrel', name: 'Clopidogrel', description: 'ยาต้านเกล็ดเลือด' },
];

const getGuaranteedFundDefinitions = () => {
    const source = Array.isArray(FUND_DEFINITIONS) && FUND_DEFINITIONS.length > 0
        ? FUND_DEFINITIONS
        : FALLBACK_FUND_DEFINITIONS;
    const seen = new Set<string>();
    return source.filter((fund) => {
        if (!fund?.id || seen.has(fund.id)) return false;
        seen.add(fund.id);
        return true;
    });
};

export const SettingsPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'hospital' | 'lab' | 'drug' | 'service' | 'diagnosis' | 'fdh' | 'db'>('hospital');
    const [frontendConfig, setFrontendConfig] = useState<Config | null>(null);
    const [backendConfig, setBackendConfig] = useState<any | null>(null);
    const [frontendSource, setFrontendSource] = useState<'database' | 'file' | 'unknown'>('unknown');
    const [backendSource, setBackendSource] = useState<'database' | 'file' | 'unknown'>('unknown');
    const [appSettings, setAppSettings] = useState<Record<string, any> | null>(null);
    const [appSettingsSource, setAppSettingsSource] = useState<'database' | 'empty' | 'unknown'>('unknown');
    const [fdhApiSettings, setFdhApiSettings] = useState<FdhApiSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const appImportRef = useRef<HTMLInputElement | null>(null);
    const fundDefinitions = getGuaranteedFundDefinitions();

    const fetchConfigs = useCallback(async () => {
        try {
            setLoading(true);
            const [feRes, beRes] = await Promise.all([
                fetch('/api/config/business-rules/frontend'),
                fetch('/api/config/business-rules/backend')
            ]);
            const appRes = await fetch('/api/config/app-settings');
            const fdhApiRes = await fetch('/api/config/fdh-api-settings');

            const feData = await feRes.json();
            const beData = await beRes.json();
            const appData = await appRes.json();
            const fdhApiData = await fdhApiRes.json();

            setFrontendConfig(feData);
            setBackendConfig(beData);
            setFrontendSource(feData._source || 'unknown');
            setBackendSource(beData._source || 'unknown');
            setAppSettings(appData.data || null);
            setAppSettingsSource(appData.source || 'unknown');
            setFdhApiSettings(fdhApiData.data || null);
        } catch (error) {
            console.error('Error fetching configs:', error);
            showToast('❌ ไม่สามารถโหลดข้อมูลตั้งค่าได้', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchConfigs();
    }, [fetchConfigs]);

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleCostChange = (key: string, value: string) => {
        if (!frontendConfig) return;
        const numValue = parseFloat(value) || 0;
        setFrontendConfig({
            ...frontendConfig,
            costs: {
                ...frontendConfig.costs,
                [key]: numValue
            }
        });
    };

    const handleLabRuleChange = (index: number, field: 'label' | 'adp_codes' | 'cost', value: string) => {
        if (!frontendConfig?.site_settings?.lab_costs?.rules) return;
        const rules = [...frontendConfig.site_settings.lab_costs.rules];
        const rule = { ...rules[index] };

        if (field === 'adp_codes') {
            rule.adp_codes = value.split(',').map(v => v.trim()).filter(Boolean);
        } else if (field === 'cost') {
            rule.cost = Number(value) || 0;
        } else {
            rule.label = value;
        }

        rules[index] = rule;
        setFrontendConfig({
            ...frontendConfig,
            site_settings: {
                ...frontendConfig.site_settings,
                lab_costs: {
                    ...frontendConfig.site_settings?.lab_costs,
                    rules
                }
            }
        });
    };

    const setSiteSetting = (path: Array<string>, value: unknown) => {
        setAppSettings((prev: any) => {
            const base = prev || frontendConfig?.site_settings || {};
            const next = structuredClone(base);
            let cursor: any = next;
            for (let i = 0; i < path.length - 1; i++) {
                const key = path[i];
                cursor[key] = cursor[key] || {};
                cursor = cursor[key];
            }
            cursor[path[path.length - 1]] = value;
            return next;
        });
    };

    const exportAppSettings = () => {
        const payload = {
            site_settings: appSettings || frontendConfig?.site_settings || {},
            exportedAt: new Date().toISOString(),
            exportedBy: 'FDH Checker'
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `fdh-app-settings-${formatLocalDateStamp()}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const importAppSettings = async (file: File) => {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const siteSettings = parsed.site_settings || parsed;
        setAppSettings(siteSettings);
        setToast({ message: '✅ โหลดไฟล์ตั้งค่าเรียบร้อยแล้ว กดบันทึกเพื่อส่งเข้า DB', type: 'success' });
    };

    const handleSave = async () => {
        try {
            setSaving(true);

            // Save to both frontend and backend for consistency
            const responses = await Promise.all([
                fetch('/api/config/business-rules/frontend', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(frontendConfig)
                }),
                fetch('/api/config/business-rules/backend', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...backendConfig,
                        costs: {
                            ...backendConfig.costs,
                            ...frontendConfig?.costs
                        },
                        site_settings: frontendConfig?.site_settings
                    })
                }),
                fetch('/api/config/app-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(appSettings || frontendConfig?.site_settings || {})
                }),
                fetch('/api/config/fdh-api-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fdhApiSettings || {})
                })
            ]);

            if (responses.every((response) => response.ok)) {
                showToast('✅ บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
            } else {
                throw new Error('Save failed');
            }
        } catch (error) {
            console.error('Error saving config:', error);
            showToast('❌ เกิดข้อผิดพลาดในการบันทึก', 'error');
        } finally {
            setSaving(false);
        }
    };

    const cfg = frontendConfig;
    const mergedSiteSettings = appSettings || frontendConfig?.site_settings || ((defaultRules as unknown) as Config).site_settings || {};
    const mergedFdhApiSettings: FdhApiSettings = {
        environment: 'prd',
        hcode: '',
        tokenUrl: 'https://fdh.moph.go.th/token?Action=get_moph_access_token',
        apiBaseUrl: 'https://fdh.moph.go.th',
        upload16Url: 'https://fdh.moph.go.th/api/v2/data_hub/16_files',
        preScreenUrl: 'https://fdh.moph.go.th/api/v1/auth/open_api/fda/file',
        username: '',
        password: '',
        ...(fdhApiSettings || {})
    };
    const mergedCostSettings = {
        dialysis_fixed: mergedSiteSettings?.lab_costs?.service_cost_overrides?.dialysis_fixed ?? frontendConfig?.costs?.dialysis_fixed ?? 0,
        epo_real_base: mergedSiteSettings?.lab_costs?.service_cost_overrides?.epo_real_base ?? frontendConfig?.costs?.epo_real_base ?? 0,
    };
    const specificFundVisibility = (mergedSiteSettings?.specific_fund_visibility || {}) as Record<string, boolean>;
    const visibleSpecificFundCount = fundDefinitions.filter((fund) => specificFundVisibility[fund.id] !== false).length;
    const receivableSigners = (mergedSiteSettings?.receivable_signers || {}) as Record<string, { name?: string; position?: string }>;
    const signerValue = (role: string, field: 'name' | 'position', fallback = '') => receivableSigners[role]?.[field] || fallback;

    if (loading) return <div className="loading-state">กำลังโหลดข้อมูลการตั้งค่า...</div>;

    return (
        <div className="settings-container">
            <div className="settings-header">
                <div>
                    <h1 style={{ marginBottom: 4 }}><span>⚙️</span> ตั้งค่าระบบ (Settings)</h1>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Frontend config: {frontendSource} | Backend config: {backendSource}
                        {appSettings && ` | DB app settings: ${appSettingsSource}`}
                    </div>
                </div>
                <button
                    className="save-btn"
                    onClick={handleSave}
                    disabled={saving || !frontendConfig}
                >
                    {saving ? 'กำลังบันทึก...' : '💾 บันทึกการเปลี่ยนแปลง'}
                </button>
                {activeTab === 'db' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button className="tab-btn" onClick={exportAppSettings}>⬇️ Export JSON</button>
                        <button className="tab-btn" onClick={() => appImportRef.current?.click()}>⬆️ Import JSON</button>
                        <input
                            ref={appImportRef}
                            type="file"
                            accept="application/json"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    void importAppSettings(file);
                                }
                                e.currentTarget.value = '';
                            }}
                        />
                    </div>
                )}
            </div>

            <div className="settings-tabs">
                <button className={`tab-btn ${activeTab === 'hospital' ? 'active' : ''}`} onClick={() => setActiveTab('hospital')}>🏥 Hospital</button>
                <button className={`tab-btn ${activeTab === 'lab' ? 'active' : ''}`} onClick={() => setActiveTab('lab')}>🔬 Lab</button>
                <button className={`tab-btn ${activeTab === 'drug' ? 'active' : ''}`} onClick={() => setActiveTab('drug')}>💊 Drug</button>
                <button className={`tab-btn ${activeTab === 'service' ? 'active' : ''}`} onClick={() => setActiveTab('service')}>🏥 Service</button>
                <button className={`tab-btn ${activeTab === 'diagnosis' ? 'active' : ''}`} onClick={() => setActiveTab('diagnosis')}>🧬 Diagnosis</button>
                <button className={`tab-btn ${activeTab === 'fdh' ? 'active' : ''}`} onClick={() => setActiveTab('fdh')}>🔐 FDH API</button>
                <button className={`tab-btn ${activeTab === 'db' ? 'active' : ''}`} onClick={() => setActiveTab('db')}>🗄️ DB Settings</button>
                </div>

            <div className="settings-card">
                {activeTab === 'hospital' && frontendConfig && (
                    <div className="settings-section">
                        <h3>🏥 Hospital Settings</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>ค่าพื้นฐานของโรงพยาบาลและการแสดงผล</p>
                        <div className="settings-grid">
                            <div className="form-group">
                                <label>💰 รายรับเหมาจ่าย/เคส (บัตรทอง/ประกันสังคม)</label>
                                <input type="number" value={cfg?.costs?.dialysis_ucs_sss_total ?? 0} onChange={(e) => handleCostChange('dialysis_ucs_sss_total', e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>💰 รายรับเหมาจ่าย/เคส (ข้าราชการ/อปท.)</label>
                                <input type="number" value={cfg?.costs?.dialysis_ofc_lgo_total ?? 0} onChange={(e) => handleCostChange('dialysis_ofc_lgo_total', e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>💸 ค่าใช้จ่ายที่จ่ายให้หน่วยไต (ต้นทุนโรงพยาบาล)</label>
                                <input type="number" value={cfg?.costs?.dialysis_fixed ?? 0} onChange={(e) => handleCostChange('dialysis_fixed', e.target.value)} />
                                <small style={{ color: '#10b981', display: 'block', marginTop: 5 }}>
                                    * ส่วนต่างจากรายรับข้างต้นจะเป็นกำไรของโรงพยาบาล
                                </small>
                            </div>
                            <div className="form-group">
                                <label>💉 ราคาต้นทุนยา EPO (ต่อเข็ม)</label>
                                <input type="number" value={cfg?.costs?.epo_real_base ?? 0} onChange={(e) => handleCostChange('epo_real_base', e.target.value)} />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'lab' && (
                    <div className="settings-section">
                        <h3>🔬 Lab Settings</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>ปรับชื่อ/รหัส/ค่าใช้จ่ายของรายการ lab ได้จากส่วนนี้</p>
                        <div className="settings-grid">
                            {((mergedSiteSettings?.lab_costs?.rules || []) as Array<{ key: string; label: string; adp_codes: string[]; cost: number }>).filter((r: { key: string; label: string; adp_codes: string[]; cost: number }) => r.key.includes('lab') || r.key.includes('preg') || r.key.includes('fpg') || r.key.includes('cholesterol') || r.key.includes('anemia') || r.key.includes('iron')).map((rule: { key: string; label: string; adp_codes: string[]; cost: number }, index: number) => (
                                <div key={rule.key} className="card" style={{ padding: 16, border: '1px solid #e2e8f0' }}>
                                    <div className="form-group">
                                        <label>{rule.key}</label>
                                        <input type="text" value={rule.label} onChange={(e) => handleLabRuleChange(index, 'label', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label>ADP codes</label>
                                        <input type="text" value={rule.adp_codes.join(', ')} onChange={(e) => handleLabRuleChange(index, 'adp_codes', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label>Cost</label>
                                        <input type="number" value={rule.cost} onChange={(e) => handleLabRuleChange(index, 'cost', e.target.value)} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'drug' && (
                    <div className="settings-section">
                        <h3>💊 Drug Settings</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>ตั้งค่ารหัสยาหลักและรายการยาที่ใช้ตรวจกองทุน</p>
                        <code style={{ display: 'block', background: '#1e1e1e', padding: 15, borderRadius: 8, marginTop: 10 }}>
                            {JSON.stringify((frontendConfig || ((defaultRules as unknown) as Config))?.adp_codes, null, 2)}
                        </code>
                    </div>
                )}

                {activeTab === 'service' && (
                    <div className="settings-section">
                        <h3>🏥 Service Settings</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>ตั้งค่ารหัสบริการและค่าแสดงผลของระบบ</p>
                        <code style={{ display: 'block', background: '#1e1e1e', padding: 15, borderRadius: 8, marginTop: 10 }}>
                            {JSON.stringify((frontendConfig || ((defaultRules as unknown) as Config))?.project_codes, null, 2)}
                        </code>
                    </div>
                )}

                {activeTab === 'diagnosis' && (
                    <div className="settings-section">
                        <h3>🧬 Diagnosis Settings</h3>
                        <p>ดูรายการ pattern ที่ใช้ตรวจโรคและกองทุนพิเศษ</p>
                        <code style={{ display: 'block', background: '#1e1e1e', padding: 15, borderRadius: 8, marginTop: 10 }}>
                            {JSON.stringify((frontendConfig || ((defaultRules as unknown) as Config))?.diagnosis_patterns, null, 2)}
                        </code>
                    </div>
                )}

                {activeTab === 'fdh' && (
                    <div className="settings-section">
                        <h3>🔐 FDH API Settings</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
                            ตั้งค่าพื้นฐานให้ตรงกับโปรแกรมส่ง 16 แฟ้มของโรงพยาบาล ทั้งส่วน Token, URL ส่งข้อมูล, URL PreScreen และ Account สำหรับ FDH
                        </p>
                        <div className="alert alert-info" style={{ marginBottom: 16 }}>
                            <span>ℹ️</span>
                            <span>
                                หน้านี้ใช้รูปแบบเดียวกับเครื่องมือเดิมของ FDH มากขึ้น เพื่อให้ทีมงานหน้างานจำค่าได้ง่ายและย้ายมาใช้ในระบบนี้ได้สะดวก
                            </span>
                        </div>
                        <div className="settings-grid">
                            <div className="form-group">
                                <label>Environment</label>
                                <select
                                    value={mergedFdhApiSettings.environment || 'prd'}
                                    onChange={(e) => setFdhApiSettings((prev) => ({ ...(prev || {}), environment: e.target.value as 'prd' | 'uat' }))}
                                >
                                    <option value="prd">Production</option>
                                    <option value="uat">UAT</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Hospital Code (HCODE)</label>
                                <input
                                    type="text"
                                    value={mergedFdhApiSettings.hcode || ''}
                                    readOnly
                                />
                                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: 6 }}>
                                    ดึงจากฐานข้อมูล/ค่ากลางของโรงพยาบาลอัตโนมัติ
                                </small>
                            </div>
                            <div className="form-group">
                                <label>URL Token</label>
                                <input
                                    type="text"
                                    value={mergedFdhApiSettings.tokenUrl || 'https://fdh.moph.go.th/token?Action=get_moph_access_token'}
                                    onChange={(e) => setFdhApiSettings((prev) => ({ ...(prev || {}), tokenUrl: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>URL สำรองแจ้ง / API Base URL</label>
                                <input
                                    type="text"
                                    value={mergedFdhApiSettings.apiBaseUrl || 'https://fdh.moph.go.th'}
                                    onChange={(e) => setFdhApiSettings((prev) => ({ ...(prev || {}), apiBaseUrl: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>URL ส่งข้อมูล 16 แฟ้ม</label>
                                <input
                                    type="text"
                                    value={mergedFdhApiSettings.upload16Url || 'https://fdh.moph.go.th/api/v2/data_hub/16_files'}
                                    onChange={(e) => setFdhApiSettings((prev) => ({ ...(prev || {}), upload16Url: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>URL PreScreen</label>
                                <input
                                    type="text"
                                    value={mergedFdhApiSettings.preScreenUrl || 'https://fdh.moph.go.th/api/v1/auth/open_api/fda/file'}
                                    onChange={(e) => setFdhApiSettings((prev) => ({ ...(prev || {}), preScreenUrl: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>User</label>
                                <input
                                    type="text"
                                    value={mergedFdhApiSettings.username || ''}
                                    onChange={(e) => setFdhApiSettings((prev) => ({ ...(prev || {}), username: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>Password</label>
                                <input
                                    type="password"
                                    value={mergedFdhApiSettings.password || ''}
                                    onChange={(e) => setFdhApiSettings((prev) => ({ ...(prev || {}), password: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="settings-grid" style={{ marginTop: 20 }}>
                            <div className="card" style={{ padding: 16 }}>
                                <div style={{ fontWeight: 700, marginBottom: 8 }}>รูปแบบส่งข้อมูล</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7 }}>
                                    <div>ชนิดแฟ้ม: <strong>txt</strong></div>
                                    <div>Encoding: <strong>UTF-8</strong></div>
                                    <div>ปลายทางหลัก: <strong>{mergedFdhApiSettings.environment === 'uat' ? 'UAT' : 'Production'}</strong></div>
                                </div>
                            </div>
                            <div className="card" style={{ padding: 16 }}>
                                <div style={{ fontWeight: 700, marginBottom: 8 }}>สถานะค่าปัจจุบัน</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7 }}>
                                    <div>HCODE: <strong>{mergedFdhApiSettings.hcode || '-'}</strong></div>
                                    <div>User: <strong>{mergedFdhApiSettings.username || '-'}</strong></div>
                                    <div>URL ส่ง 16 แฟ้ม: <strong>{mergedFdhApiSettings.upload16Url || '-'}</strong></div>
                                </div>
                            </div>
                        </div>
                        <div className="alert alert-info" style={{ marginTop: 16 }}>
                            <span>ℹ️</span>
                            <span>
                                ตอนนี้ระบบของเรารองรับการตั้งค่า URL สำคัญครบตามที่โปรแกรมเดิมใช้แล้ว และหน้า <code>นำเข้าสถานะ FDH</code> จะหยิบค่าชุดนี้ไปใช้ต่อได้ทันที
                            </span>
                        </div>
                    </div>
                )}

                {activeTab === 'db' && (
                    <div className="settings-section">
                        <h3>🗄️ DB Settings</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>แก้ค่า app_settings ที่เก็บในฐานข้อมูลโดยตรง</p>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                            <span className="badge badge-info">DB source: {appSettingsSource}</span>
                            <span className="badge badge-info">Rows: {Object.keys(mergedSiteSettings).length}</span>
                        </div>
                        <div className="settings-grid">
                            <div className="form-group">
                                <label>Hospital Name</label>
                                <input
                                    type="text"
                                    value={mergedSiteSettings?.hospital_name || ''}
                                    onChange={(e) => setSiteSetting(['hospital_name'], e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>Hospital Code</label>
                                <input
                                    type="text"
                                    value={mergedSiteSettings?.hospital_code || ''}
                                    onChange={(e) => setSiteSetting(['hospital_code'], e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>Dialysis Fixed</label>
                                <input
                                    type="number"
                                    value={mergedCostSettings.dialysis_fixed}
                                    onChange={(e) => setSiteSetting(['lab_costs', 'service_cost_overrides', 'dialysis_fixed'], Number(e.target.value) || 0)}
                                />
                            </div>
                            <div className="form-group">
                                <label>EPO Base</label>
                                <input
                                    type="number"
                                    value={mergedCostSettings.epo_real_base}
                                    onChange={(e) => setSiteSetting(['lab_costs', 'service_cost_overrides', 'epo_real_base'], Number(e.target.value) || 0)}
                                />
                            </div>
                        </div>
                        <div className="settings-card" style={{ marginTop: 20, padding: 20, background: 'rgba(16, 185, 129, 0.06)' }}>
                            <div style={{ marginBottom: 14 }}>
                                <h4 style={{ margin: 0 }}>✍️ ผู้ลงนามเอกสารบัญชีลูกหนี้</h4>
                                <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                                    ใช้สำหรับพิมพ์รายงานหลักฐานการเงินจากหน้า <strong>บัญชีลูกหนี้สิทธิ์</strong>
                                </p>
                            </div>
                            <div className="settings-grid">
                                <div className="form-group">
                                    <label>ชื่อ ผอ.</label>
                                    <input
                                        type="text"
                                        value={signerValue('director', 'name')}
                                        onChange={(e) => setSiteSetting(['receivable_signers', 'director', 'name'], e.target.value)}
                                        placeholder="ชื่อผู้ลงนาม"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>ตำแหน่ง ผอ.</label>
                                    <input
                                        type="text"
                                        value={signerValue('director', 'position', 'ผู้อำนวยการโรงพยาบาล')}
                                        onChange={(e) => setSiteSetting(['receivable_signers', 'director', 'position'], e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>ชื่อหัวหน้างานประกัน</label>
                                    <input
                                        type="text"
                                        value={signerValue('insurance_head', 'name')}
                                        onChange={(e) => setSiteSetting(['receivable_signers', 'insurance_head', 'name'], e.target.value)}
                                        placeholder="ชื่อผู้ลงนาม"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>ตำแหน่งหัวหน้างานประกัน</label>
                                    <input
                                        type="text"
                                        value={signerValue('insurance_head', 'position', 'หัวหน้างานประกันสุขภาพ')}
                                        onChange={(e) => setSiteSetting(['receivable_signers', 'insurance_head', 'position'], e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>ชื่อการเงิน</label>
                                    <input
                                        type="text"
                                        value={signerValue('finance', 'name')}
                                        onChange={(e) => setSiteSetting(['receivable_signers', 'finance', 'name'], e.target.value)}
                                        placeholder="ชื่อผู้ลงนาม"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>ตำแหน่งการเงิน</label>
                                    <input
                                        type="text"
                                        value={signerValue('finance', 'position', 'เจ้าหน้าที่การเงิน')}
                                        onChange={(e) => setSiteSetting(['receivable_signers', 'finance', 'position'], e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="settings-card" style={{ marginTop: 20, padding: 20, background: 'rgba(59, 130, 246, 0.04)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                                <div>
                                    <h4 style={{ margin: 0 }}>📋 การแสดงเมนูกองทุน (พิเศษ)</h4>
                                    <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                                        เปิดหรือปิดเมนูกองทุนที่แสดงในหน้า <strong>รายกองทุน (พิเศษ)</strong> ตามความพร้อมของหน่วยบริการ
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span className="badge badge-info">แสดง {visibleSpecificFundCount}/{fundDefinitions.length}</span>
                                    <button
                                        type="button"
                                        className="tab-btn active"
                                        onClick={() => setSiteSetting(['specific_fund_visibility'], Object.fromEntries(fundDefinitions.map((fund) => [fund.id, true])))}
                                    >
                                        แสดงทั้งหมด
                                    </button>
                                    <button
                                        type="button"
                                        className="tab-btn"
                                        onClick={() => setSiteSetting(['specific_fund_visibility'], Object.fromEntries(fundDefinitions.map((fund) => [fund.id, false])))}
                                    >
                                        ซ่อนทั้งหมด
                                    </button>
                                </div>
                            </div>
                            <div className="fund-visibility-grid">
                                {fundDefinitions.map((fund) => {
                                    const enabled = specificFundVisibility[fund.id] !== false;
                                    return (
                                        <label key={fund.id} className={`fund-visibility-card ${enabled ? 'is-on' : 'is-off'}`}>
                                            <div className="fund-visibility-card__head">
                                                <div className="fund-visibility-card__title">
                                                    <span>{enabled ? '✅' : '🚫'}</span>
                                                    <span>{fund.name}</span>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={enabled}
                                                    onChange={(e) => setSiteSetting(['specific_fund_visibility', fund.id], e.target.checked)}
                                                />
                                            </div>
                                            <div className="fund-visibility-card__desc">{fund.description}</div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="form-group" style={{ marginTop: 16 }}>
                            <label>Raw `site_settings` JSON</label>
                            <textarea
                                rows={14}
                                value={JSON.stringify(mergedSiteSettings, null, 2)}
                                onChange={(e) => {
                                    try {
                                        setAppSettings(JSON.parse(e.target.value));
                                    } catch {
                                        setAppSettings(mergedSiteSettings);
                                    }
                                }}
                                style={{ fontFamily: 'monospace' }}
                            />
                        </div>
                    </div>
                )}

            </div>

            {toast && (
                <div className="status-toast" style={{ background: toast.type === 'error' ? 'var(--danger)' : 'var(--success)' }}>
                    {toast.message}
                </div>
            )}
        </div>
    );
};
