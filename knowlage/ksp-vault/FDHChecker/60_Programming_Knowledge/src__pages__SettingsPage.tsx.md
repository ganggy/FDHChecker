---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/pages/SettingsPage.tsx"
source_hash: "1b7f8f38ee62355bb3f0acbd2d32e39b9b580d5623d868e0c30b497b8851ca18"
managed_by: "sync-ksp-vault"
---
# SettingsPage.tsx

> Source: `src/pages/SettingsPage.tsx`
> SHA-256: `1b7f8f38ee62355bb3f0acbd2d32e39b9b580d5623d868e0c30b497b8851ca18`

````tsx
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
        nhso_region?: string;
        province?: string;
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

interface SettingsMeta {
    updatedAt?: string;
    updatedBy?: { id?: number; username?: string };
}

interface FdhConnectionTestState {
    type: 'success' | 'error';
    message: string;
    responseTimeMs?: number;
}

const SECRET_PLACEHOLDER = '***';

const isPlainRecord = (value: unknown): value is Record<string, any> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const stripConfigSource = (value: Record<string, any>) => {
    const copy = { ...value };
    delete copy._source;
    return copy;
};

const readJsonResponse = async <T,>(response: Response, label: string): Promise<T> => {
    const payload = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) throw new Error(String(payload.error || `ไม่สามารถโหลด${label}ได้`));
    return payload as T;
};

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
    { id: 'condom', name: 'ยาฉีดคุมกำเนิด', description: 'ADP FP003_4 อัตรา 60 บาท' },
    { id: 'cacervix', name: 'คัดกรองมะเร็งปากมดลูก', description: 'Pap smear / Cervix screening' },
    { id: 'er_emergency', name: 'ฉุกเฉิน (ER)', description: 'ผู้ป่วยฉุกเฉินและนอกเขต' },
    { id: 'fpg_screening', name: 'คัดกรองเบาหวาน', description: 'FPG / เบาหวาน' },
    { id: 'cholesterol_screening', name: 'คัดกรองหัวใจหลอดเลือด', description: 'Total Cholesterol และ HDL อายุ 45-70 ปี' },
    { id: 'anemia_screening', name: 'คัดกรองโลหิตจาง', description: 'CBC / Hb-Hct + Z130/Z138 + 13001' },
    { id: 'syphilis_screening_male', name: 'คัดกรองซิฟิลิส (ชาย)', description: 'ประชาชนทั่วไปเพศชาย + Lab Treponema/Syphilis' },
    { id: 'iron_supplement', name: 'เสริมธาตุเหล็ก', description: 'ยาเสริมธาตุเหล็ก' },
    { id: 'ferrokid_child', name: 'เสริมธาตุเหล็กเด็ก (Ferrokid)', description: 'กองทุนเด็ก 6-12 เดือน (PP-B FS)' },
    { id: 'mental_health_counselling', name: 'ปรึกษาสุขภาพจิต', description: 'อายุ 12 ปีขึ้นไป + ST-5/9Q + counselling' },
    { id: 'gender_affirming_hormone', name: 'ฮอร์โมนยืนยันเพศสภาพ', description: 'KTB/VMI + hormone protocol' },
    { id: 'latent_tb_screening', name: 'คัดกรอง Latent TB', description: 'IGRA / NTIP/TB Data Hub' },
    { id: 'osteoporosis_screening', name: 'คัดกรองกระดูกพรุน', description: 'หญิง 60 ปีขึ้นไป + FRAX/DXA/BMD' },
    { id: 'autism_tdas_screening', name: 'คัดกรอง TDAS', description: 'เด็ก 12-60 เดือน + TDAS' },
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
    const [activeTab, setActiveTab] = useState<'hospital' | 'lab' | 'fdh' | 'db' | 'advanced'>('hospital');
    const [frontendConfig, setFrontendConfig] = useState<Config | null>(null);
    const [backendConfig, setBackendConfig] = useState<any | null>(null);
    const [frontendSource, setFrontendSource] = useState<'database' | 'file' | 'unknown'>('unknown');
    const [backendSource, setBackendSource] = useState<'database' | 'file' | 'unknown'>('unknown');
    const [appSettings, setAppSettings] = useState<Record<string, any> | null>(null);
    const [appSettingsSource, setAppSettingsSource] = useState<'database' | 'empty' | 'unknown'>('unknown');
    const [fdhApiSettings, setFdhApiSettings] = useState<FdhApiSettings | null>(null);
    const [fdhPasswordConfigured, setFdhPasswordConfigured] = useState(false);
    const [settingsMeta, setSettingsMeta] = useState<SettingsMeta | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingFdhConnection, setTestingFdhConnection] = useState(false);
    const [fdhConnectionTest, setFdhConnectionTest] = useState<FdhConnectionTestState | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const appImportRef = useRef<HTMLInputElement | null>(null);
    const fundDefinitions = getGuaranteedFundDefinitions();

    const fetchConfigs = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError('');
            const [feRes, beRes, appRes, fdhApiRes, statusRes] = await Promise.all([
                fetch('/api/config/business-rules/frontend'),
                fetch('/api/config/business-rules/backend'),
                fetch('/api/config/app-settings'),
                fetch('/api/config/fdh-api-settings'),
                fetch('/api/config/system-settings/status')
            ]);
            const [feData, beData, appData, fdhApiData, statusData] = await Promise.all([
                readJsonResponse<Config>(feRes, ' Frontend config'),
                readJsonResponse<Record<string, any>>(beRes, ' Backend config'),
                readJsonResponse<{ data?: Record<string, any>; source?: 'database' | 'empty' }>(appRes, ' App settings'),
                readJsonResponse<{ data?: FdhApiSettings; source?: string }>(fdhApiRes, ' FDH API settings'),
                readJsonResponse<{ data?: SettingsMeta }>(statusRes, 'สถานะการตั้งค่า'),
            ]);

            setFrontendConfig(feData);
            setBackendConfig(beData);
            setFrontendSource(feData._source || 'unknown');
            setBackendSource(beData._source || 'unknown');
            setAppSettings(appData.data || null);
            setAppSettingsSource(appData.source || 'unknown');
            setFdhPasswordConfigured(fdhApiData.data?.password === SECRET_PLACEHOLDER);
            setFdhApiSettings(fdhApiData.data ? { ...fdhApiData.data, password: '' } : null);
            setSettingsMeta(statusData.data || null);
            setIsDirty(false);
        } catch (error) {
            console.error('Error fetching configs:', error);
            const message = error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลตั้งค่าได้';
            setLoadError(message);
            setToast({ message: `❌ ${message}`, type: 'error' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchConfigs();
    }, [fetchConfigs]);

    useEffect(() => {
        const warnBeforeLeave = (event: BeforeUnloadEvent) => {
            if (!isDirty) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warnBeforeLeave);
        return () => window.removeEventListener('beforeunload', warnBeforeLeave);
    }, [isDirty]);

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleCostChange = (key: string, value: string) => {
        if (!frontendConfig) return;
        const numValue = parseFloat(value) || 0;
        setIsDirty(true);
        setFrontendConfig({
            ...frontendConfig,
            costs: {
                ...frontendConfig.costs,
                [key]: numValue
            }
        });
        if (key === 'dialysis_fixed' || key === 'epo_real_base') {
            setAppSettings((previous) => {
                const base = structuredClone(previous || frontendConfig.site_settings || {});
                return {
                    ...base,
                    lab_costs: {
                        ...(base.lab_costs || {}),
                        service_cost_overrides: {
                            ...(base.lab_costs?.service_cost_overrides || {}),
                            [key]: numValue,
                        }
                    }
                };
            });
        }
    };

    const handleLabRuleChange = (ruleKey: string, field: 'label' | 'adp_codes' | 'cost', value: string) => {
        setIsDirty(true);
        setAppSettings((previous) => {
            const base = structuredClone(previous || frontendConfig?.site_settings || {});
            const rules = Array.isArray(base?.lab_costs?.rules) ? [...base.lab_costs.rules] : [];
            const index = rules.findIndex((item: { key?: string }) => item.key === ruleKey);
            if (index < 0) return base;
            const rule = { ...rules[index] };
            if (field === 'adp_codes') rule.adp_codes = value.split(',').map(v => v.trim()).filter(Boolean);
            else if (field === 'cost') rule.cost = Number(value) || 0;
            else rule.label = value;
            rules[index] = rule;
            return {
                ...base,
                lab_costs: { ...(base.lab_costs || {}), rules }
            };
        });
    };

    const setSiteSetting = (path: Array<string>, value: unknown) => {
        setIsDirty(true);
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

    const setFdhSetting = <K extends keyof FdhApiSettings>(key: K, value: FdhApiSettings[K]) => {
        setIsDirty(true);
        setFdhConnectionTest(null);
        setFdhApiSettings((previous) => ({ ...(previous || {}), [key]: value }));
    };

    const handleTestFdhConnection = async () => {
        try {
            setTestingFdhConnection(true);
            setFdhConnectionTest(null);
            const response = await fetch('/api/settings/fdh-api/test-connection', { method: 'POST' });
            const result = await readJsonResponse<{
                message?: string;
                data?: { responseTimeMs?: number };
            }>(response, 'การทดสอบการเชื่อมต่อ FDH API');
            setFdhConnectionTest({
                type: 'success',
                message: result.message || 'เชื่อมต่อ FDH API สำเร็จ',
                responseTimeMs: result.data?.responseTimeMs,
            });
        } catch (error) {
            setFdhConnectionTest({
                type: 'error',
                message: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการทดสอบการเชื่อมต่อ FDH API',
            });
        } finally {
            setTestingFdhConnection(false);
        }
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
        if (file.size > 1024 * 1024) throw new Error('ไฟล์ตั้งค่าต้องมีขนาดไม่เกิน 1 MB');
        const text = await file.text();
        const parsed = JSON.parse(text);
        const siteSettings = parsed.site_settings || parsed;
        if (!isPlainRecord(siteSettings)) throw new Error('ไฟล์ตั้งค่าต้องเป็น JSON object');
        setAppSettings(siteSettings);
        setIsDirty(true);
        setToast({ message: '✅ โหลดไฟล์ตั้งค่าเรียบร้อยแล้ว กดบันทึกเพื่อส่งเข้า DB', type: 'success' });
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const siteSettings = appSettings || frontendConfig?.site_settings || {};
            const businessRules = {
                ...stripConfigSource(backendConfig || {}),
                ...stripConfigSource((frontendConfig || {}) as Record<string, any>),
                costs: { ...(backendConfig?.costs || {}), ...(frontendConfig?.costs || {}) },
                site_settings: siteSettings,
            };
            const hospitalCode = String((siteSettings as Record<string, any>).hospital_code || '').trim();
            if (hospitalCode && !/^\d{5}$/.test(hospitalCode)) throw new Error('รหัสหน่วยบริการต้องเป็นตัวเลข 5 หลัก');

            const response = await fetch('/api/config/system-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ businessRules, siteSettings, fdhApiSettings: fdhApiSettings || {} })
            });
            const result = await readJsonResponse<{ data?: SettingsMeta }>(response, 'การตั้งค่าระบบ');
            setSettingsMeta(result.data || null);
            setIsDirty(false);
            showToast('✅ บันทึกการตั้งค่าทั้งระบบเรียบร้อยแล้ว', 'success');
            await fetchConfigs();
        } catch (error) {
            console.error('Error saving config:', error);
            showToast(`❌ ${error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการบันทึก'}`, 'error');
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
                    <h1><span>⚙️</span> ตั้งค่าระบบ</h1>
                    <div className="settings-status-line">
                        <span className={`settings-status-chip ${frontendSource === 'database' && backendSource === 'database' ? 'is-ok' : ''}`}>กฎระบบ: {frontendSource}/{backendSource}</span>
                        <span className={`settings-status-chip ${appSettingsSource === 'database' ? 'is-ok' : ''}`}>ค่าหน่วยบริการ: {appSettingsSource}</span>
                        {settingsMeta?.updatedAt && (
                            <span className="settings-status-chip">
                                บันทึกล่าสุด {new Date(settingsMeta.updatedAt).toLocaleString('th-TH')}
                                {settingsMeta.updatedBy?.username ? ` โดย ${settingsMeta.updatedBy.username}` : ''}
                            </span>
                        )}
                        {isDirty && <span className="settings-status-chip is-warning">มีรายการยังไม่บันทึก</span>}
                    </div>
                </div>
                <div className="settings-header-actions">
                    <button className="secondary-btn" type="button" onClick={() => void fetchConfigs()} disabled={loading || saving}>
                        ↻ โหลดค่าล่าสุด
                    </button>
                    <button
                        className="save-btn"
                        onClick={handleSave}
                        disabled={saving || !frontendConfig || !isDirty}
                    >
                        {saving ? 'กำลังบันทึก...' : '💾 บันทึกการเปลี่ยนแปลง'}
                    </button>
                    {activeTab === 'advanced' && (
                        <div className="settings-transfer-actions">
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
                                    void importAppSettings(file).catch((error) => {
                                        showToast(`❌ ${error instanceof Error ? error.message : 'ไม่สามารถอ่านไฟล์ได้'}`, 'error');
                                    });
                                }
                                e.currentTarget.value = '';
                            }}
                        />
                        </div>
                    )}
                </div>
            </div>

            {loadError && (
                <div className="settings-load-error">
                    <div><strong>โหลดการตั้งค่าไม่ครบ:</strong> {loadError}</div>
                    <button type="button" className="secondary-btn" onClick={() => void fetchConfigs()}>ลองใหม่</button>
                </div>
            )}

            <div className="settings-tabs">
                <button className={`tab-btn ${activeTab === 'hospital' ? 'active' : ''}`} onClick={() => setActiveTab('hospital')}>🏥 หน่วยบริการ</button>
                <button className={`tab-btn ${activeTab === 'lab' ? 'active' : ''}`} onClick={() => setActiveTab('lab')}>💰 ต้นทุนและกฎ</button>
                <button className={`tab-btn ${activeTab === 'db' ? 'active' : ''}`} onClick={() => setActiveTab('db')}>📋 กองทุนและเอกสาร</button>
                <button className={`tab-btn ${activeTab === 'fdh' ? 'active' : ''}`} onClick={() => setActiveTab('fdh')}>🔐 เชื่อมต่อ FDH</button>
                <button className={`tab-btn ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>🛠️ ขั้นสูง</button>
            </div>

            <div className="settings-card">
                {activeTab === 'hospital' && frontendConfig && (
                    <div className="settings-section">
                        <h3>🏥 ข้อมูลหน่วยบริการ</h3>
                        <p className="settings-section-description">ข้อมูลกลางที่ใช้ในหัวรายงาน การเชื่อมต่อ FDH และการอ้างอิงภายในระบบ</p>
                        <div className="settings-grid">
                            <div className="form-group">
                                <label>ชื่อหน่วยบริการ</label>
                                <input type="text" value={mergedSiteSettings?.hospital_name || ''} onChange={(e) => setSiteSetting(['hospital_name'], e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>รหัสหน่วยบริการ (HCODE)</label>
                                <input type="text" inputMode="numeric" maxLength={5} value={mergedSiteSettings?.hospital_code || ''} onChange={(e) => setSiteSetting(['hospital_code'], e.target.value.replace(/\D/g, '').slice(0, 5))} />
                                <small>ต้องเป็นตัวเลข 5 หลัก และจะใช้ร่วมกับ FDH API</small>
                            </div>
                            <div className="form-group">
                                <label>เขต สปสช.</label>
                                <input type="text" value={mergedSiteSettings?.nhso_region || ''} onChange={(e) => setSiteSetting(['nhso_region'], e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>จังหวัด</label>
                                <input type="text" value={mergedSiteSettings?.province || ''} onChange={(e) => setSiteSetting(['province'], e.target.value)} />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'lab' && (
                    <div className="settings-section">
                        <h3>💰 ต้นทุนบริการและกฎ Lab</h3>
                        <p className="settings-section-description">ต้นทุนต้องเป็นค่าตั้งแต่ 0 ขึ้นไป การเปลี่ยนแปลงจะใช้กับการคำนวณและรายงานหลังบันทึก</p>
                        <div className="settings-grid settings-cost-grid">
                            <div className="form-group"><label>รายรับเหมาจ่าย/เคส บัตรทอง/ประกันสังคม</label><input min="0" type="number" value={cfg?.costs?.dialysis_ucs_sss_total ?? 0} onChange={(e) => handleCostChange('dialysis_ucs_sss_total', e.target.value)} /></div>
                            <div className="form-group"><label>รายรับเหมาจ่าย/เคส ข้าราชการ/อปท.</label><input min="0" type="number" value={cfg?.costs?.dialysis_ofc_lgo_total ?? 0} onChange={(e) => handleCostChange('dialysis_ofc_lgo_total', e.target.value)} /></div>
                            <div className="form-group"><label>ต้นทุนจ่ายหน่วยไต</label><input min="0" type="number" value={mergedCostSettings.dialysis_fixed} onChange={(e) => handleCostChange('dialysis_fixed', e.target.value)} /></div>
                            <div className="form-group"><label>ต้นทุนยา EPO ต่อเข็ม</label><input min="0" type="number" value={mergedCostSettings.epo_real_base} onChange={(e) => handleCostChange('epo_real_base', e.target.value)} /></div>
                        </div>
                        <h4 className="settings-subheading">กฎรายการ Lab</h4>
                        <div className="settings-grid">
                            {((mergedSiteSettings?.lab_costs?.rules || []) as Array<{ key: string; label: string; adp_codes: string[]; cost: number }>).filter((r) => r.key.includes('lab') || r.key.includes('preg') || r.key.includes('fpg') || r.key.includes('cholesterol') || r.key.includes('anemia') || r.key.includes('iron')).map((rule) => (
                                <div key={rule.key} className="settings-rule-card">
                                    <div className="form-group">
                                        <label>{rule.key} · ชื่อรายการ</label>
                                        <input type="text" value={rule.label} onChange={(e) => handleLabRuleChange(rule.key, 'label', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label>ADP codes (คั่นด้วยเครื่องหมายจุลภาค)</label>
                                        <input type="text" value={rule.adp_codes.join(', ')} onChange={(e) => handleLabRuleChange(rule.key, 'adp_codes', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label>ต้นทุน</label>
                                        <input min="0" type="number" value={rule.cost} onChange={(e) => handleLabRuleChange(rule.key, 'cost', e.target.value)} />
                                    </div>
                                </div>
                            ))}
                        </div>
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
                                    onChange={(e) => setFdhSetting('environment', e.target.value as 'prd' | 'uat')}
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
                                    type="url"
                                    value={mergedFdhApiSettings.tokenUrl || 'https://fdh.moph.go.th/token?Action=get_moph_access_token'}
                                    onChange={(e) => setFdhSetting('tokenUrl', e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>URL สำรองแจ้ง / API Base URL</label>
                                <input
                                    type="url"
                                    value={mergedFdhApiSettings.apiBaseUrl || 'https://fdh.moph.go.th'}
                                    onChange={(e) => setFdhSetting('apiBaseUrl', e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>URL ส่งข้อมูล 16 แฟ้ม</label>
                                <input
                                    type="url"
                                    value={mergedFdhApiSettings.upload16Url || 'https://fdh.moph.go.th/api/v2/data_hub/16_files'}
                                    onChange={(e) => setFdhSetting('upload16Url', e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>URL PreScreen</label>
                                <input
                                    type="url"
                                    value={mergedFdhApiSettings.preScreenUrl || 'https://fdh.moph.go.th/api/v1/auth/open_api/fda/file'}
                                    onChange={(e) => setFdhSetting('preScreenUrl', e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>User</label>
                                <input
                                    type="text"
                                    value={mergedFdhApiSettings.username || ''}
                                    autoComplete="off"
                                    onChange={(e) => setFdhSetting('username', e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>Password</label>
                                <input
                                    type="password"
                                    value={mergedFdhApiSettings.password || ''}
                                    autoComplete="new-password"
                                    placeholder={fdhPasswordConfigured ? 'ตั้งรหัสผ่านไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม' : 'ยังไม่ได้ตั้งรหัสผ่าน'}
                                    onChange={(e) => setFdhSetting('password', e.target.value)}
                                />
                                <small>{fdhPasswordConfigured ? '✅ มีรหัสผ่านจัดเก็บในระบบแล้ว' : '⚠️ ยังไม่มีรหัสผ่าน FDH'}</small>
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
                        <div className="fdh-connection-test">
                            <div>
                                <strong>ทดสอบค่าที่บันทึกไว้</strong>
                                <p>ระบบจะใช้ username/password จากฐานข้อมูลโดยตรง และจะไม่แสดงหรือส่งรหัสผ่านกลับมาที่หน้านี้</p>
                            </div>
                            <button
                                type="button"
                                className="secondary-btn fdh-test-btn"
                                onClick={() => void handleTestFdhConnection()}
                                disabled={testingFdhConnection || saving || isDirty || !fdhPasswordConfigured || !mergedFdhApiSettings.username}
                                title={isDirty ? 'กรุณาบันทึกการตั้งค่าก่อนทดสอบ' : undefined}
                            >
                                {testingFdhConnection ? 'กำลังทดสอบ...' : '🔌 ทดสอบการเชื่อมต่อ FDH API'}
                            </button>
                        </div>
                        {isDirty && (
                            <div className="fdh-test-hint">กรุณาบันทึกการตั้งค่าก่อน จึงจะทดสอบการเชื่อมต่อด้วยค่าล่าสุดได้</div>
                        )}
                        {fdhConnectionTest && (
                            <div
                                className={`fdh-test-result is-${fdhConnectionTest.type}`}
                                role={fdhConnectionTest.type === 'error' ? 'alert' : 'status'}
                                aria-live="polite"
                            >
                                <strong>{fdhConnectionTest.type === 'success' ? '✅ สำเร็จ' : '❌ ไม่สำเร็จ'}</strong>
                                <span>{fdhConnectionTest.message}</span>
                                {fdhConnectionTest.responseTimeMs != null && (
                                    <small>ใช้เวลา {fdhConnectionTest.responseTimeMs.toLocaleString('th-TH')} มิลลิวินาที</small>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'db' && (
                    <div className="settings-section">
                        <h3>📋 กองทุนและเอกสาร</h3>
                        <p className="settings-section-description">กำหนดผู้ลงนามในรายงานและเลือกกองทุนที่หน่วยบริการต้องการใช้งาน</p>
                        <div className="settings-summary-strip">
                            <span className="settings-status-chip is-ok">แหล่งข้อมูล: {appSettingsSource}</span>
                            <span className="settings-status-chip">กองทุนที่แสดง {visibleSpecificFundCount}/{fundDefinitions.length}</span>
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
                    </div>
                )}

                {activeTab === 'advanced' && (
                    <div className="settings-section">
                        <h3>🛠️ ข้อมูลขั้นสูง</h3>
                        <p className="settings-section-description">
                            ใช้สำหรับสำรอง/ย้ายค่า และตรวจสอบกฎระบบเท่านั้น การแก้กฎรหัสยา บริการ หรือวินิจฉัยควรผ่านการทดสอบและออกรุ่นโปรแกรม
                        </p>
                        <div className="settings-advanced-grid">
                            <details>
                                <summary>💊 รหัสยาและ ADP</summary>
                                <pre>{JSON.stringify((frontendConfig || ((defaultRules as unknown) as Config))?.adp_codes, null, 2)}</pre>
                            </details>
                            <details>
                                <summary>🏥 รหัสบริการ/โครงการ</summary>
                                <pre>{JSON.stringify((frontendConfig || ((defaultRules as unknown) as Config))?.project_codes, null, 2)}</pre>
                            </details>
                            <details>
                                <summary>🧬 รูปแบบรหัสวินิจฉัย</summary>
                                <pre>{JSON.stringify((frontendConfig || ((defaultRules as unknown) as Config))?.diagnosis_patterns, null, 2)}</pre>
                            </details>
                            <details>
                                <summary>🗄️ Site settings ที่จะบันทึก</summary>
                                <pre>{JSON.stringify(mergedSiteSettings, null, 2)}</pre>
                            </details>
                        </div>
                        <div className="alert alert-info settings-advanced-note">
                            Export จะไม่รวมรหัสผ่าน FDH และ Import รองรับเฉพาะไฟล์ JSON ขนาดไม่เกิน 1 MB
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

````
