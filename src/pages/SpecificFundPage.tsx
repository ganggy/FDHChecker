import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { DetailModal } from '../components/DetailModal';
import type { CheckRecord } from '../mockData';
import businessRules from '../config/business_rules.json';
import { FUND_DEFINITIONS, type FundDefinition } from '../config/fundDefinitions';
import { formatLocalDateInput } from '../utils/dateUtils';
import { consumeDashboardNavigation } from '../utils/navigationState';
import { fetchAppSettings } from '../services/hosxpService';

const FALLBACK_FUND_DEFINITIONS: FundDefinition[] = [
    { id: 'palliative', name: 'Palliative Care', description: 'ผู้ป่วยระยะประคับประคอง' },
    { id: 'telemedicine', name: 'Telemedicine', description: 'บริการแพทย์ทางไกล / Telemed' },
    { id: 'drugp', name: 'ส่งยาไปรษณีย์', description: 'ยา EMS / ส่งยาถึงบ้าน' },
    { id: 'herb', name: 'สมุนไพร / ยาไทย', description: 'รายการสมุนไพรและยาไทย' },
    { id: 'knee', name: 'ยาพอกเข่า', description: 'บริการยาพอก/ประคบเข่า' },
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
    { id: 'anemia_screening', name: 'คัดกรองโลหิตจาง', description: '13001 / CBC + Z130' },
    { id: 'iron_supplement', name: 'เสริมธาตุเหล็ก', description: 'ยาเสริมธาตุเหล็ก' },
    { id: 'ferrokid_child', name: 'เสริมธาตุเหล็กเด็ก (Ferrokid)', description: 'กองทุนเด็ก 2 เดือน-12 ปี (PP-B FS)' },
    { id: 'chemo', name: 'เคมีบำบัด', description: 'ผู้ป่วยเคมีบำบัด' },
    { id: 'hepc', name: 'ไวรัสตับอักเสบซี', description: 'Hep C / HCV' },
    { id: 'rehab', name: 'ฟื้นฟูสมรรถภาพ', description: 'งานฟื้นฟู / กายภาพ' },
    { id: 'crrt', name: 'ฟอกเลือด (CRRT)', description: 'ผู้ป่วยฟอกเลือด / ไต' },
    { id: 'robot', name: 'ผ่าตัดหุ่นยนต์', description: 'Robotic surgery' },
    { id: 'proton', name: 'รังสีรักษา (Proton)', description: 'ฉายแสงโปรตอน' },
    { id: 'cxr', name: 'อ่านฟิล์ม CXR', description: 'อ่านฟิล์มทรวงอก' },
    { id: 'clopidogrel', name: 'Clopidogrel', description: 'ยาต้านเกล็ดเลือด' },
];

export const SpecificFundPage: React.FC = () => {
    const [activeFund, setActiveFund] = useState('palliative');
    const todayStr = formatLocalDateInput();
    const [startDate, setStartDate] = useState(todayStr);
    const [endDate, setEndDate] = useState(todayStr);
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedRecord, setSelectedRecord] = useState<CheckRecord | null>(null);
    const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
    const [dashboardContextItems, setDashboardContextItems] = useState<string[]>([]);
    const [fundVisibility, setFundVisibility] = useState<Record<string, boolean>>({});
    const [exportingFundId, setExportingFundId] = useState<string | null>(null);
    const rules = businessRules as any;
    const codes = rules.adp_codes as Record<string, string | string[]>;
    const siteSettings = rules.site_settings as {
        lab_costs?: { rules?: Array<{ key: string; label: string; adp_codes: string[]; cost: number }> };
    };

    const getCodeValue = (key: string, fallback: string) => {
        const value = codes[key];
        if (typeof value === 'string') return value;
        if (Array.isArray(value) && value.length > 0) return value[0];
        return fallback;
    };

    const telmedCode = getCodeValue('telmed', 'TELMED');
    const pregnancyCode = getCodeValue('pregnancy_test', '30014');
    const clopidogrelLabel = (siteSettings.lab_costs?.rules?.find(r => r.key === 'clopidogrel')?.label) || 'Clopidogrel';
    const funds: FundDefinition[] = (FUND_DEFINITIONS && FUND_DEFINITIONS.length > 0 ? FUND_DEFINITIONS : FALLBACK_FUND_DEFINITIONS);
    const visibleFunds = useMemo(
        () => funds.filter((fund) => fundVisibility[fund.id] !== false),
        [fundVisibility, funds]
    );

    const fetchFundDataByType = useCallback(async (fundId: string) => {
        const res = await fetch(`/api/hosxp/specific-funds?fundType=${fundId}&startDate=${startDate}&endDate=${endDate}`);
        const json = await res.json();
        if (!json.success) {
            throw new Error('ไม่สามารถดึงข้อมูลได้');
        }
        return json.data as any[];
    }, [startDate, endDate]);

    const fetchFundData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const rows = await fetchFundDataByType(activeFund);
            setData(rows);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
        } finally {
            setLoading(false);
        }
    }, [activeFund, fetchFundDataByType]);

    useEffect(() => {
        const incoming = consumeDashboardNavigation('specific');
        if (!incoming) return;

        if (incoming.startDate) setStartDate(incoming.startDate);
        if (incoming.endDate) setEndDate(incoming.endDate);
        if (incoming.specific?.activeFund) setActiveFund(incoming.specific.activeFund);
        if (typeof incoming.specific?.showIncompleteOnly === 'boolean') setShowIncompleteOnly(incoming.specific.showIncompleteOnly);

        const noteParts: string[] = [];
        if (incoming.contextLabel) noteParts.push(incoming.contextLabel);
        if (incoming.startDate || incoming.endDate) {
            noteParts.push(`ช่วงวันที่ ${incoming.startDate || todayStr} ถึง ${incoming.endDate || todayStr}`);
        }
        if (incoming.specific?.activeFund) {
            noteParts.push(`กองทุน ${incoming.specific.activeFund}`);
        }
        if (incoming.specific?.showIncompleteOnly) {
            noteParts.push('แสดงเฉพาะรายการที่ยังไม่สมบูรณ์');
        }
        setDashboardContextItems(noteParts);
    }, [todayStr]);

    useEffect(() => {
        void fetchFundData();
    }, [fetchFundData]);

    useEffect(() => {
        const loadVisibility = async () => {
            try {
                const settings = await fetchAppSettings<{ specific_fund_visibility?: Record<string, boolean> }>();
                setFundVisibility(settings.data?.specific_fund_visibility || {});
            } catch {
                setFundVisibility({});
            }
        };

        void loadVisibility();
    }, []);

    useEffect(() => {
        if (visibleFunds.length === 0) return;
        if (!visibleFunds.some((fund) => fund.id === activeFund)) {
            setActiveFund(visibleFunds[0].id);
        }
    }, [activeFund, visibleFunds]);

    // Helper function to get gradient colors based on subfund
    const getSubfundColor = (subfund: string) => {
        const colors: Record<string, { bg: string; shadow: string }> = {
            'palliative': { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', shadow: 'rgba(102, 126, 234, 0.2)' },
            'telemedicine': { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', shadow: 'rgba(245, 87, 108, 0.2)' },
            'drugp': { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', shadow: 'rgba(79, 172, 254, 0.2)' },
            'herb': { bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', shadow: 'rgba(67, 233, 123, 0.2)' },
            'knee': { bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', shadow: 'rgba(250, 112, 154, 0.2)' },
            'instrument': { bg: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', shadow: 'rgba(48, 207, 208, 0.2)' },
            'preg_test': { bg: 'linear-gradient(135deg, #ff6b9d 0%, #c06c84 100%)', shadow: 'rgba(255, 107, 157, 0.2)' },
            'anc': { bg: 'linear-gradient(135deg, #ffa751 0%, #ffe259 100%)', shadow: 'rgba(255, 167, 81, 0.2)' },
            'cacervix': { bg: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)', shadow: 'rgba(255, 154, 86, 0.2)' },
            'fp': { bg: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', shadow: 'rgba(168, 237, 234, 0.2)' },
            'postnatal_care': { bg: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)', shadow: 'rgba(255, 154, 158, 0.2)' },
            'er_emergency': { bg: 'linear-gradient(135deg, #ff6e7f 0%, #bfe9ff 100%)', shadow: 'rgba(255, 110, 127, 0.2)' },
            'chemo': { bg: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)', shadow: 'rgba(161, 196, 253, 0.2)' },
            'hepc': { bg: 'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)', shadow: 'rgba(210, 153, 194, 0.2)' },
            'rehab': { bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', shadow: 'rgba(250, 112, 154, 0.2)' },
            'crrt': { bg: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', shadow: 'rgba(48, 207, 208, 0.2)' },
            'robot': { bg: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', shadow: 'rgba(168, 237, 234, 0.2)' },
            'proton': { bg: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)', shadow: 'rgba(255, 154, 86, 0.2)' },
            'cxr': { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', shadow: 'rgba(79, 172, 254, 0.2)' },
            'clopidogrel': { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', shadow: 'rgba(102, 126, 234, 0.2)' },
            'fpg_screening': { bg: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)', shadow: 'rgba(255, 75, 43, 0.2)' },
            'cholesterol_screening': { bg: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)', shadow: 'rgba(247, 151, 30, 0.2)' },
            'anemia_screening': { bg: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)', shadow: 'rgba(238, 156, 167, 0.2)' },
            'iron_supplement': { bg: 'linear-gradient(135deg, #870000 0%, #190a05 100%)', shadow: 'rgba(135, 0, 0, 0.2)' },
            'ferrokid_child': { bg: 'linear-gradient(135deg, #c31432 0%, #240b36 100%)', shadow: 'rgba(195, 20, 50, 0.22)' },
            'anc_ultrasound': { bg: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)', shadow: 'rgba(33, 147, 176, 0.2)' },
            'anc_lab_1': { bg: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)', shadow: 'rgba(58, 28, 113, 0.2)' },
            'anc_lab_2': { bg: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', shadow: 'rgba(30, 60, 114, 0.2)' },
            'postnatal_supplements': { bg: 'linear-gradient(135deg, #1d976c 0%, #93f9b9 100%)', shadow: 'rgba(29, 151, 108, 0.2)' },
            'fluoride': { bg: 'linear-gradient(135deg, #4ca1af 0%, #c4e0e5 100%)', shadow: 'rgba(76, 161, 175, 0.2)' },
            'contraceptive_pill': { bg: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)', shadow: 'rgba(106, 17, 203, 0.2)' },
            'condom': { bg: 'linear-gradient(135deg, #232526 0%, #414345 100%)', shadow: 'rgba(35, 37, 38, 0.2)' },
        };
        
        // Try to match subfund name to find the right color
        for (const [key, value] of Object.entries(colors)) {
            if (subfund.toLowerCase().includes(key) || activeFund === key) {
                return value;
            }
        }
        // Default
        return { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', shadow: 'rgba(102, 126, 234, 0.2)' };
    };

    const toFlag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'Y' || value === 'y';
    const cleanCode = (value: unknown) => String(value ?? '').replace(/\./g, '').trim().toUpperCase();
    const hasValue = (value: unknown) => String(value ?? '').trim() !== '';
    const collectCodeValues = (value: unknown) =>
        String(value ?? '')
            .split(',')
            .map((part) => cleanCode(part))
            .filter(Boolean);
    const hasAnyCodeValue = (value: unknown, codesToCheck: string[]) => {
        const available = new Set(collectCodeValues(value));
        return codesToCheck.map(cleanCode).some((code) => available.has(code));
    };
    const collectDiagValues = (item: any) => {
        const baseValues = [
            item?.pdx,
            item?.main_diag,
            item?.diag_code,
            item?.dx0,
            item?.dx1,
            item?.dx2,
            item?.dx3,
            item?.dx4,
            item?.dx5,
            item?.z515_code,
            item?.z718_code,
        ]
            .map(cleanCode)
            .filter(Boolean);

        [item?.fp_diags, item?.diag_list, item?.diagnosis_list]
            .filter(Boolean)
            .join(',')
            .split(/[^A-Z0-9.]+/)
            .map(cleanCode)
            .filter(Boolean)
            .forEach((code) => baseValues.push(code));

        return Array.from(new Set(baseValues));
    };
    const hasDiagCodes = (item: any, codesToCheck: string[]) => {
        const availableCodes = new Set(collectDiagValues(item));
        return codesToCheck.map(cleanCode).some((code) => availableCodes.has(code));
    };
    const hasDiagRegex = (item: any, regex: RegExp) => collectDiagValues(item).some((code) => regex.test(code));
    const hasText = (value: unknown, regex: RegExp) => regex.test(String(value ?? ''));
    const getAncLab1Requirements = (item: any, hasAncDiag: boolean) => {
        const isFemale = String(item?.sex ?? '').trim() === '2';
        return [
          { met: isFemale, label: ' เพศหญิง' },
          { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
          { met: toFlag(item?.anc_lab1_cbc), label: ' CBC' },
          { met: toFlag(item?.anc_lab1_dcip), label: ' DCIP' },
        { met: toFlag(item?.anc_lab1_abo), label: ' ABO group' },
        { met: toFlag(item?.anc_lab1_rh), label: ' Rh grouping' },
        { met: toFlag(item?.anc_lab1_hbsag), label: ' HBsAg' },
        { met: toFlag(item?.anc_lab1_syphilis), label: ' Treponema Pallidum Ab' },
        { met: toFlag(item?.anc_lab1_hiv), label: ' HIV-Ab Screening' },
        ];
    };
    const getAncLab2Requirements = (item: any, hasAncDiag: boolean) => {
        const isFemale = String(item?.sex ?? '').trim() === '2';
        return [
          { met: isFemale, label: ' เพศหญิง' },
          { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
          { met: toFlag(item?.anc_lab2_hiv), label: ' Anti-HIV ANC 2' },
          { met: toFlag(item?.anc_lab2_syphilis), label: ' Treponema Pallidum Ab ANC 2' },
        { met: toFlag(item?.anc_lab2_cbc), label: ' CBC' },
        ];
    };
    const buildStatusResult = (subfunds: string[], missing: string[], invalidMessage?: string, isMatched = missing.length === 0) => {
        if (invalidMessage) {
            return { status: invalidMessage, class: 'badge-danger', icon: '❌', subfunds };
        }
        if (isMatched) {
            return { status: 'สมบูรณ์', class: 'badge-success', icon: '✅', subfunds };
        }
        if (missing.length === 0) {
            return { status: 'ยังไม่เข้าเงื่อนไข', class: 'badge-secondary', icon: 'ℹ️', subfunds };
        }
        return {
            status: `ขาด${missing.join(' + ')}`,
            class: missing.length <= 2 ? 'badge-warning' : 'badge-danger',
            icon: missing.length <= 2 ? '⚠️' : '❌',
            subfunds,
        };
    };
    const getNearStatusMissing = (
        adpMet: boolean,
        adpLabel: string,
        requirements: Array<{ met: boolean; label: string }>,
        _hasServiceEvidence?: boolean
    ) => {
        const missingRequirements = requirements.filter((requirement) => !requirement.met).map((requirement) => requirement.label);
        const allRequirementsMet = missingRequirements.length === 0;

        if (adpMet) {
            return missingRequirements;
        }

        return allRequirementsMet ? [adpLabel] : [];
    };

    const getStatusForFund = (item: any, fundId: string = activeFund) => {
        const subfunds: string[] = [];
        const age = Number(item?.age_y ?? item?.age ?? 0);
        const hipdataText = `${item?.hipdata_code || ''} ${item?.fund || ''} ${item?.hipdata_desc || ''}`.toUpperCase();
        const isUcsLike = ['UCS', 'UC', 'WEL', 'UNK'].some((code) => hipdataText.includes(code));
        const hasPalliativeDiag = toFlag(item?.has_pal_diag) || hasDiagCodes(item, ['Z515', 'Z718']);
        const hasPalliativeAdp = toFlag(item?.has_pal_adp) || toFlag(item?.has_30001) || toFlag(item?.has_cons01) || toFlag(item?.has_eva001);
        const hasAncDiag = toFlag(item?.has_anc_diag) || hasDiagRegex(item, /^Z3[45]/) || hasValue(item?.anc_diags);
        const isFemale = String(item?.sex ?? '').trim() === '2';
        const hasPostpartumDiag = toFlag(item?.has_pp_diag) || hasDiagCodes(item, ['Z390', 'Z391', 'Z392']);
        const hasPostpartumSpecificDiag = hasDiagCodes(item, ['Z391', 'Z392']);
        const hasFpDiag = toFlag(item?.has_fp_diag) || hasDiagRegex(item, /^Z30/);

        if (fundId === 'palliative') {
            const isMatched = hasPalliativeDiag && hasPalliativeAdp;
            if (hasPalliativeDiag || hasPalliativeAdp) subfunds.push('🕊️ Palliative Care');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(
                    hasPalliativeAdp,
                    ' ADP 30001/Cons01/Eva001',
                    [{ met: hasPalliativeDiag, label: ' Diagnosis Z515/Z718' }],
                    hasPalliativeDiag
                ),
                !isUcsLike ? `ไม่ใช่สิทธิ์ UCS (${item.hipdata_code || 'ไม่มี'})` : undefined,
                isMatched
            );
        }

        if (fundId === 'telemedicine') {
            const hasTelmed = toFlag(item?.has_telmed) || item?.ovstist_export_code === rules.project_codes?.ovstist_tele;
            if (hasTelmed) subfunds.push(`📱 ${telmedCode}`);
            return buildStatusResult(subfunds, [hasTelmed ? '' : ` ADP/Export ${telmedCode}`].filter(Boolean), !isUcsLike ? `ไม่ใช่สิทธิ์ UCS (${item.hipdata_code || 'ไม่มี'})` : undefined);
        }

        if (fundId === 'drugp') {
            const hasDrugp = toFlag(item?.has_drugp);
            if (hasDrugp) subfunds.push('📦 EMS ส่งยา');
            return buildStatusResult(subfunds, [hasDrugp ? '' : ' ADP DRUGP'].filter(Boolean), !isUcsLike ? `ไม่ใช่สิทธิ์ UCS (${item.hipdata_code || 'ไม่มี'})` : undefined);
        }

        if (fundId === 'herb') {
            const hasHerb = Number(item?.herb_total_price || 0) > 0 || toFlag(item?.has_herb);
            if (hasHerb) subfunds.push('🌿 สมุนไพร');
            return buildStatusResult(subfunds, [hasHerb ? '' : ' รายการสมุนไพร/ยอดราคา'].filter(Boolean), !(isUcsLike || hipdataText.includes('WEL')) ? 'ไม่ใช่สิทธิ์ UCS/WEL' : undefined);
        }

        if (fundId === 'knee') {
            const hasKneeService = toFlag(item?.has_knee_oper) || hasText(item?.proc_name, /KNEE|เข่า/) || hasText(item?.service_name, /KNEE|เข่า/);
            if (hasKneeService) subfunds.push('🦵 พอกเข่า');
            return buildStatusResult(subfunds, [
                age >= 40 ? '' : ' อายุ 40 ปีขึ้นไป',
                hasKneeService ? '' : ' บริการพอก/ประคบเข่า',
            ].filter(Boolean));
        }

        if (fundId === 'preg_test') {
            const hasPregLab = toFlag(item?.has_preg_lab) || hasValue(item?.preg_lab_name) || hasValue(item?.preg_result);
            const hasPregDiag = toFlag(item?.has_preg_diag) || hasDiagCodes(item, ['Z320', 'Z321']) || hasValue(item?.preg_diags);
            const hasPregAdp = toFlag(item?.has_preg_item) || toFlag(item?.has_upt) || hasValue(item?.preg_item_name);
            const pregEvidence = hasPregLab || hasPregDiag || hasPregAdp;
            const isMatched = hasPregLab && hasPregDiag && hasPregAdp;
            if (pregEvidence) subfunds.push(`🧪 ตรวจครรภ์ (UPT ${pregnancyCode})`);
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasPregAdp, ' ADP 30014', [
                    { met: hasPregDiag, label: ' Diagnosis Z320/Z321' },
                    { met: hasPregLab, label: ' Lab UPT/31101' },
                ], hasPregLab && hasPregDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'instrument') {
            const hasInstrument = Number(item?.instrument_price || 0) > 0 || toFlag(item?.has_instrument);
            if (hasInstrument) subfunds.push('🦾 อวัยวะเทียม');
            return buildStatusResult(subfunds, [hasInstrument ? '' : ' อุปกรณ์/ยอดอวัยวะเทียม'].filter(Boolean));
        }

        if (fundId === 'cacervix') {
            const hasCxDiag = toFlag(item?.has_cx_diag);
            const hasCxAdp = toFlag(item?.has_cx_adp) || hasValue(item?.ca_adp_codes);
            const isMatched = hasCxDiag && hasCxAdp;
            if (hasCxDiag || hasCxAdp) subfunds.push('🎀 คัดกรองมะเร็งปากมดลูก');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasCxAdp, ' ADP คัดกรอง', [
                    { met: hasCxDiag, label: ' Diagnosis/บริการคัดกรอง' },
                ], hasCxDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'er_emergency') {
            const hasEr = toFlag(item?.has_er) || hasText(item?.project_code, /OP AE/) || hasText(item?.fund, /ฉุกเฉิน|นอกเขต|REFER|AE/);
            if (hasEr) subfunds.push('🚨 ฉุกเฉิน (ER)');
            return buildStatusResult(subfunds, [hasEr ? '' : ' สิทธินอกเขต/ฉุกเฉินที่เข้าเกณฑ์'].filter(Boolean));
        }

        if (fundId === 'fpg_screening') {
            const hasAge = toFlag(item?.age_eligible);
            const hasLab = toFlag(item?.has_fpg_lab);
            const hasDiag = toFlag(item?.has_fpg_diag) || hasDiagCodes(item, ['Z131', 'Z133', 'Z136']);
            const hasAdp = toFlag(item?.has_fpg_adp) || hasAnyCodeValue(item?.adp_names, ['12003']) || hasAnyCodeValue(item?.anc_adp_codes, ['12003']);
            const isMatched = hasAge && hasLab && hasDiag && hasAdp;
            if (hasLab || hasDiag || hasAdp) subfunds.push('🩸 คัดกรองเบาหวาน');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasAdp, ' ADP 12003', [
                    { met: hasAge, label: ' อายุ 35-59 ปี' },
                    { met: hasLab, label: ' Lab FPG' },
                    { met: hasDiag, label: ' Diagnosis Z131/Z133/Z136' },
                ], hasLab || hasDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'cholesterol_screening') {
            const hasAge = toFlag(item?.age_eligible);
            const hasLab = toFlag(item?.has_chol_lab);
            const hasDiag = toFlag(item?.has_chol_diag) || hasDiagCodes(item, ['Z136']);
            const hasAdp = toFlag(item?.has_chol_adp) || hasAnyCodeValue(item?.adp_names, ['12004']) || hasAnyCodeValue(item?.anc_adp_codes, ['12004']);
            const isMatched = hasAge && hasLab && hasDiag && hasAdp;
            if (hasLab || hasDiag || hasAdp) subfunds.push('🧪 คัดกรองไขมัน');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasAdp, ' ADP 12004', [
                    { met: hasAge, label: ' อายุ 45-59 ปี' },
                    { met: hasLab, label: ' Lab Cholesterol/HDL' },
                    { met: hasDiag, label: ' Diagnosis Z136' },
                ], hasLab || hasDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'anemia_screening') {
            const hasAge = toFlag(item?.age_eligible);
            const hasLab = toFlag(item?.has_anemia_lab);
            const hasDiag = toFlag(item?.has_anemia_diag) || hasDiagCodes(item, ['Z130']);
            const hasAdp = toFlag(item?.has_anemia_adp) || hasAnyCodeValue(item?.adp_names, ['13001']) || hasAnyCodeValue(item?.anc_adp_codes, ['13001']);
            const isMatched = hasAge && hasLab && hasDiag && hasAdp;
            if (isMatched || hasLab || hasDiag || hasAdp) {
                subfunds.push(item?.anemia_match_source === 'CBC+Z130' || (!hasAdp && hasAge && hasLab && hasDiag)
                    ? '🧪 คัดกรองโลหิตจาง (CBC+Z130)'
                    : '🩸 คัดกรองโลหิตจาง (13001)');
            }
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasAdp, ' ADP 13001', [
                    { met: hasAge, label: ' หญิงอายุ 13-24 ปี' },
                    { met: hasLab, label: ' Lab CBC' },
                    { met: hasDiag, label: ' Diagnosis Z130' },
                ], hasLab || hasDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'iron_supplement') {
            const hasAge = toFlag(item?.age_eligible) || (item?.sex === '2' && item?.age >= 13 && item?.age <= 45);
            const hasDiag = toFlag(item?.has_iron_diag) || hasDiagCodes(item, ['Z130']);
            const hasAdp = toFlag(item?.has_iron_adp) || hasAnyCodeValue(item?.adp_names, ['14001']) || hasAnyCodeValue(item?.anc_adp_codes, ['14001']);
            const hasIronMed = toFlag(item?.has_iron_med);
            const isMatched = hasAge && hasDiag && hasAdp && hasIronMed;
            if (hasIronMed || hasDiag || hasAdp) subfunds.push('💊 เสริมธาตุเหล็ก');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasAdp, ' ADP 14001', [
                    { met: hasAge, label: ' หญิงอายุ 13-45 ปี' },
                    { met: hasDiag, label: ' Diagnosis Z130' },
                    { met: hasIronMed, label: ' ยาเสริมธาตุเหล็ก' },
                ], hasIronMed || hasDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'ferrokid_child') {
            const ageYears = Number(item?.age_y ?? item?.age ?? -1);
            const ageMonths = Number(item?.age_month ?? -1);
            const hasAge = toFlag(item?.ferrokid_age_eligible)
                || (ageMonths >= 2 && ageMonths <= 144)
                || (ageYears >= 0 && ageYears <= 12);
            const hasDiag = toFlag(item?.has_ferrokid_diag) || hasDiagCodes(item, ['Z130']);
            const hasMed = toFlag(item?.has_ferrokid_med) || toFlag(item?.has_ferrokid);
            const isMatched = hasAge && hasDiag && hasMed;
            if (hasMed || hasDiag) subfunds.push('🧒 เสริมธาตุเหล็กเด็ก (Ferrokid)');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(true, '', [
                    { met: hasAge, label: ' อายุ 2 เดือน-12 ปี' },
                    { met: hasDiag, label: ' Diagnosis Z130' },
                    { met: hasMed, label: ' ยา Ferrokid' },
                ], hasMed || hasDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'anc') {
            const hasVisitAdp = toFlag(item?.has_anc_visit) || hasAnyCodeValue(item?.anc_adp_codes, ['30011']);
            const ancVisitEvidence = hasVisitAdp || hasAncDiag;
            const isMatched = isFemale && hasAncDiag && hasVisitAdp;
            if (ancVisitEvidence) subfunds.push('🤰 ANC Visit');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasVisitAdp, ' ADP 30011', [
                    { met: isFemale, label: ' เพศหญิง' },
                    { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
                ], isFemale && hasAncDiag),
                ancVisitEvidence && !isFemale ? 'เพศชาย ไม่สามารถรับบริการ ANC Visit' : undefined,
                isMatched
            );
        }

        if (fundId === 'anc_ultrasound') {
            const hasAncUs = toFlag(item?.has_anc_us) || hasAnyCodeValue(item?.anc_adp_codes, ['30010']);
            const hasAncUsProc = toFlag(item?.has_anc_us_proc);
            // ANC Ultrasound ต้องมีทั้ง ADP 30010 และหลักฐาน Ultrasound ANC
            const hasUltrasoundEvidence = hasAncUs && hasAncUsProc;
            const ancUsEvidence = hasAncUs || hasAncUsProc;
            const isMatched = isFemale && hasAncDiag && hasUltrasoundEvidence;
            if (ancUsEvidence) subfunds.push('📽️ ANC Ultrasound');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasAncUs, ' ADP 30010', [
                    { met: isFemale, label: ' เพศหญิง' },
                    { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
                    { met: hasAncUsProc, label: ' Ultrasound ANC' },
                ], isFemale && hasAncDiag && hasAncUsProc),
                ancUsEvidence && !isFemale ? 'เพศชาย ไม่สามารถรับบริการ ANC Ultrasound' : undefined,
                isMatched
            );
        }

        if (fundId === 'anc_lab_1') {
            const hasAncLab1Adp = toFlag(item?.has_anc_lab1) || hasAnyCodeValue(item?.anc_adp_codes, ['30012']);
            const ancLab1Requirements = getAncLab1Requirements(item, hasAncDiag);
            const ancLab1ServiceEvidence = toFlag(item?.anc_lab1_complete);
            const isMatched = hasAncLab1Adp && ancLab1Requirements.every((requirement) => requirement.met);
            if (hasAncLab1Adp || ancLab1ServiceEvidence) subfunds.push(siteSettings.lab_costs?.rules?.find((r) => r.key === 'anc_lab_1')?.label || '💉 ANC Lab 1');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasAncLab1Adp, ' ADP 30012', ancLab1Requirements, ancLab1ServiceEvidence),
                (hasAncLab1Adp || ancLab1ServiceEvidence) && !isFemale ? 'เพศชาย ไม่สามารถรับบริการ ANC Lab 1' : undefined,
                isMatched
            );
        }

        if (fundId === 'anc_lab_2') {
            const hasAncLab2Adp = toFlag(item?.has_anc_lab2) || hasAnyCodeValue(item?.anc_adp_codes, ['30013']);
            const ancLab2Requirements = getAncLab2Requirements(item, hasAncDiag);
            const ancLab2ServiceEvidence = toFlag(item?.anc_lab2_hiv) && toFlag(item?.anc_lab2_syphilis);
            const isMatched = hasAncLab2Adp && ancLab2Requirements.every((requirement) => requirement.met);
            if (hasAncLab2Adp || ancLab2ServiceEvidence) subfunds.push(siteSettings.lab_costs?.rules?.find((r) => r.key === 'anc_lab_2')?.label || '💉 ANC Lab 2');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasAncLab2Adp, ' ADP 30013', ancLab2Requirements, ancLab2ServiceEvidence),
                (hasAncLab2Adp || ancLab2ServiceEvidence) && !isFemale ? 'เพศชาย ไม่สามารถรับบริการ ANC Lab 2' : undefined,
                isMatched
            );
        }

        if (fundId === 'anc_dental_exam') {
            const hasExam = toFlag(item?.has_anc_dental_exam) || hasAnyCodeValue(item?.anc_adp_codes, ['30008']);
            const ancDentalExamEvidence = hasExam || hasAncDiag;
            const isMatched = isFemale && hasAncDiag && hasExam;
            if (ancDentalExamEvidence) subfunds.push('🦷 ANC ตรวจฟัน');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasExam, ' ADP 30008', [
                    { met: isFemale, label: ' เพศหญิง' },
                    { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
                ], isFemale && hasAncDiag),
                ancDentalExamEvidence && !isFemale ? 'เพศชาย ไม่สามารถรับบริการ ANC ตรวจฟัน' : undefined,
                isMatched
            );
        }

        if (fundId === 'anc_dental_clean') {
            const hasClean = toFlag(item?.has_anc_dental_clean) || hasAnyCodeValue(item?.anc_adp_codes, ['30009']);
            const ancDentalCleanEvidence = hasClean || hasAncDiag;
            const isMatched = isFemale && hasAncDiag && hasClean;
            if (ancDentalCleanEvidence) subfunds.push('🪥 ANC ขัดทำความสะอาดฟัน');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasClean, ' ADP 30009', [
                    { met: isFemale, label: ' เพศหญิง' },
                    { met: hasAncDiag, label: ' Diagnosis Z34/Z35' },
                ], isFemale && hasAncDiag),
                ancDentalCleanEvidence && !isFemale ? 'เพศชาย ไม่สามารถรับบริการ ANC ขัดทำความสะอาดฟัน' : undefined,
                isMatched
            );
        }

        if (fundId === 'postnatal_care') {
            const hasPpCare = toFlag(item?.has_post_care) || hasAnyCodeValue(item?.pp_adp_codes, ['30015']);
            const isMatched = hasPostpartumDiag && hasPpCare;
            if (hasPostpartumDiag || hasPpCare) subfunds.push('🤱 ตรวจหลังคลอด');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasPpCare, ' ADP 30015', [
                    { met: hasPostpartumDiag, label: ' Diagnosis Z390/Z391/Z392' },
                ], hasPostpartumDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'postnatal_supplements') {
            const hasPpSupp = toFlag(item?.has_post_supp) || hasAnyCodeValue(item?.pp_adp_codes, ['30016']);
            const hasPostIronMed = toFlag(item?.has_post_iron_med);
            const isMatched = hasPostpartumSpecificDiag && hasPpSupp && hasPostIronMed;
            if (hasPostpartumSpecificDiag || hasPpSupp || hasPostIronMed) subfunds.push('💊 เสริมธาตุเหล็กหลังคลอด');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasPpSupp, ' ADP 30016', [
                    { met: hasPostpartumSpecificDiag, label: ' Diagnosis Z391/Z392' },
                    { met: hasPostIronMed, label: ' ยาเสริมธาตุเหล็ก' },
                ], hasPostpartumSpecificDiag || hasPostIronMed),
                undefined,
                isMatched
            );
        }

        if (fundId === 'fluoride') {
            const hasFluoride = toFlag(item?.has_fluoride) || toFlag(item?.has_specific_adp) || hasAnyCodeValue(item?.anc_adp_codes, ['15001']);
            if (hasFluoride) subfunds.push('🦷 เคลือบฟลูออไรด์');
            return buildStatusResult(subfunds, [hasFluoride ? '' : ' ADP 15001'].filter(Boolean));
        }

        if (fundId === 'contraceptive_pill') {
            const hasZ304Diag = hasDiagCodes(item, ['Z304']);
            const adpNames = String(item?.adp_names || '').toUpperCase();
            const hasAnna = hasAnyCodeValue(item?.fp_adp_codes, ['FP003_1']) || adpNames.includes('ANNA');
            const hasLynestrenol = hasAnyCodeValue(item?.fp_adp_codes, ['FP003_2']) || adpNames.includes('LYNESTRENOL');
            const hasFpPill = toFlag(item?.has_fp_pill) || toFlag(item?.has_specific_adp) || hasAnna || hasLynestrenol;
            
            // Only count as matched if they have the specific Z304 diagnosis as requested
            const isMatched = hasZ304Diag && hasFpPill;
            
            if (hasZ304Diag || hasFpPill || hasFpDiag) subfunds.push('💊 ยาคุมกำเนิด');
            
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasFpPill, ' ADP FP003_1 (Anna) หรือ FP003_2 (Lynestrenol)', [
                    { met: hasZ304Diag, label: ' Diagnosis Z304 (การเฝ้าระวังสถาณะการใช้ยาคุมกำเนิด)' },
                ], hasZ304Diag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'condom') {
            const hasCondom = toFlag(item?.has_fp_condom) || toFlag(item?.has_specific_adp) || hasAnyCodeValue(item?.fp_adp_codes, ['FP003_4']);
            const isMatched = hasFpDiag && hasCondom;
            if (hasFpDiag || hasCondom) subfunds.push('🛡️ ถุงยางอนามัย');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasCondom, ' ADP FP003_4', [
                    { met: hasFpDiag, label: ' Diagnosis Z30x' },
                ], hasFpDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'fp') {
            const hasFpAdp = toFlag(item?.has_fp_adp) || hasValue(item?.fp_adp_codes);
            const isMatched = hasFpDiag && hasFpAdp;
            if (hasFpDiag || hasFpAdp) subfunds.push('💊 วางแผนครอบครัว');
            return buildStatusResult(
                subfunds,
                getNearStatusMissing(hasFpAdp, ' ADP/หัตถการ FP', [
                    { met: hasFpDiag, label: ' Diagnosis Z30x' },
                ], hasFpDiag),
                undefined,
                isMatched
            );
        }

        if (fundId === 'clopidogrel') {
            const hasDrug = toFlag(item?.has_clopidogrel) || toFlag(item?.has_clopidogrel_drug);
            if (hasDrug) subfunds.push(`💊 ${clopidogrelLabel}`);
            return buildStatusResult(subfunds, [hasDrug ? '' : ` รายการยา ${clopidogrelLabel}`].filter(Boolean));
        }

        if (fundId === 'chemo') {
            const hasChemo = toFlag(item?.has_chemo_diag) || hasDiagRegex(item, /^Z51[12]/);
            if (hasChemo) subfunds.push('⚗️ เคมีบำบัด');
            return buildStatusResult(subfunds, [hasChemo ? '' : ' Diagnosis Z511/Z512'].filter(Boolean));
        }

        if (fundId === 'hepc') {
            const hasHepc = toFlag(item?.has_hepc_diag) || hasDiagCodes(item, ['B182']);
            if (hasHepc) subfunds.push('🩹 ไวรัสตับอักเสบซี');
            return buildStatusResult(subfunds, [hasHepc ? '' : ' Diagnosis B182'].filter(Boolean));
        }

        if (fundId === 'rehab') {
            const hasRehab = toFlag(item?.has_rehab_diag) || hasDiagRegex(item, /^Z50/);
            if (hasRehab) subfunds.push('♿ ฟื้นฟูสมรรถภาพ');
            return buildStatusResult(subfunds, [hasRehab ? '' : ' Diagnosis Z50'].filter(Boolean));
        }

        if (fundId === 'crrt') {
            const hasCrrt = toFlag(item?.has_crrt_diag) || hasDiagRegex(item, /^Z49|^N185/);
            if (hasCrrt) subfunds.push('🏥 ฟอกเลือด (CRRT)');
            return buildStatusResult(subfunds, [hasCrrt ? '' : ' Diagnosis Z49/N185'].filter(Boolean));
        }

        if (fundId === 'robot') {
            const hasRobot = toFlag(item?.has_robot_item) || hasText(item?.proc_name, /ROBOT/) || hasText(item?.service_name, /ROBOT/);
            if (hasRobot) subfunds.push('🤖 ผ่าตัดหุ่นยนต์');
            return buildStatusResult(subfunds, [hasRobot ? '' : ' หัตถการ Robot'].filter(Boolean));
        }

        if (fundId === 'proton') {
            const hasProton = toFlag(item?.has_proton_diag) || hasDiagCodes(item, ['Z510']);
            if (hasProton) subfunds.push('⚛️ รังสีรักษา (Proton)');
            return buildStatusResult(subfunds, [hasProton ? '' : ' Diagnosis Z510'].filter(Boolean));
        }

        if (fundId === 'cxr') {
            const hasCxr = toFlag(item?.has_cxr_item) || hasText(item?.service_name, /CXR|CHEST X-?RAY/) || hasText(item?.proc_name, /CXR|CHEST X-?RAY/);
            if (hasCxr) subfunds.push('🩻 อ่านฟิล์ม CXR');
            return buildStatusResult(subfunds, [hasCxr ? '' : ' รายการ CXR'].filter(Boolean));
        }

        if (subfunds.length > 0) {
            return { status: 'สมบูรณ์', class: 'badge-success', icon: '✅', subfunds };
        }

        return { status: 'ยังไม่เข้าเงื่อนไข', class: 'badge-warning', icon: '❓', subfunds };
    };

    const getStatus = (item: any) => getStatusForFund(item, activeFund);
    const getStatusForFundRef = useRef(getStatusForFund);
    getStatusForFundRef.current = getStatusForFund;

    const handleRowClick = (item: any) => {
        const mockRecord: CheckRecord = {
            id: 0,
            vn: item.vn,
            hn: item.hn,
            patientName: item.patientName,
            fund: item.pttypename,
            serviceDate: item.serviceDate,
            serviceType: 'OPD',
            status: getStatus(item).status === 'สมบูรณ์' ? 'ready' : 'pending',
            issues: [],
            price: item.total_price || 0
        };
        setSelectedRecord(mockRecord);
    };

    // Show only visits that either match the fund or are close enough to warn what is missing.
    const actionableData = data.filter((item) => getStatus(item).status !== 'ยังไม่เข้าเงื่อนไข');
    const filteredData = showIncompleteOnly
        ? actionableData.filter((item) => getStatus(item).status !== 'สมบูรณ์')
        : actionableData;

    const buildExportRows = useCallback((items: any[], fundId: string): Array<Record<string, string | number>> => {
        const evaluateStatus = getStatusForFundRef.current;
        return items.map((item, index) => {
            const status = evaluateStatus(item, fundId);
            const baseRow: Record<string, string | number> = {
                '##': index + 1,
                'VN': item.vn || '',
                'HN': item.hn || '',
                'ชื่อผู้ป่วย': item.patientName || '',
                'CID': item.cid || '',
                'สิทธิ์': item.pttypename || '',
                'วันที่รับบริการ': item.serviceDate || '',
                'สถานะ': status.status,
                'บริการ': status.subfunds.join(' | ') || '',
            };

            if (fundId === 'palliative') {
                return {
                    ...baseRow,
                    'Diag Z515': item.z515_code || '',
                    'Diag Z718': item.z718_code || '',
                    'ADP Code': item.adp_code || '',
                };
            }
            if (fundId === 'telemedicine') {
                return {
                    ...baseRow,
                    'Ovstist Code': item.ovstist_export_code || '',
                    'ADP Code': item.has_telmed ? 'TELMED' : '',
                };
            }
            if (fundId === 'herb') {
                return {
                    ...baseRow,
                    'Diag หลัก': item.pdx || '',
                    'รายการสมุนไพร': item.herb_items || '',
                    'ยอดรวม': item.herb_total_price || '',
                };
            }
            if (fundId === 'fp') {
                return {
                    ...baseRow,
                    'Z308': item.pdx === 'Z308' || item.fp_diags?.includes('Z308') ? 'Z308' : '',
                    'ICD9 Code': item.icd9_code || '',
                    'ADP Codes': item.fp_adp_codes || '',
                };
            }

            return baseRow;
        });
    }, []);

    const writeExportFile = useCallback((fundId: string, items: any[]) => {
        if (items.length === 0) {
            alert('ไม่มีข้อมูลให้ส่งออก');
            return;
        }

        const fundName = funds.find((f) => f.id === fundId)?.name || fundId;
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const fileName = `${fundName}_${startDate}_${endDate}_${dateStr}.xlsx`;
        const exportRows = buildExportRows(items, fundId);
        const ws = XLSX.utils.json_to_sheet(exportRows);
        const headers = Object.keys(exportRows[0] || {});
        ws['!cols'] = headers.map((header) => {
            const width = Math.max(
                header.length + 2,
                ...exportRows.map((row) => String((row as Record<string, string | number>)[header] ?? '').length + 2)
            );
            return { wch: Math.min(Math.max(width, 10), 40) };
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, fundName);
        XLSX.writeFile(wb, fileName);
    }, [buildExportRows, endDate, funds, startDate]);

    const exportFundToExcel = useCallback(async (fundId: string) => {
        setExportingFundId(fundId);
        try {
            const rows = await fetchFundDataByType(fundId);
            const evaluateStatus = getStatusForFundRef.current;
            const actionableRows = rows.filter((item) => evaluateStatus(item, fundId).status !== 'ยังไม่เข้าเงื่อนไข');
            const exportRows = showIncompleteOnly
                ? actionableRows.filter((item) => evaluateStatus(item, fundId).status !== 'สมบูรณ์')
                : actionableRows;
            writeExportFile(fundId, exportRows);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการส่งออก');
        } finally {
            setExportingFundId(null);
        }
    }, [fetchFundDataByType, showIncompleteOnly, writeExportFile]);

    const exportToExcel = useCallback(() => {
        writeExportFile(activeFund, filteredData);
    }, [activeFund, filteredData, writeExportFile]);

    const activeFundDefinition = funds.find((fund) => fund.id === activeFund);

    return (
        <div className="page-container" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="page-header">
                <h1 className="page-title">🎯 ตรวจสอบเงื่อนไขรายกองทุน</h1>
                <p className="page-subtitle">แสดงรายการแยกตามเงื่อนไขพิเศษของแต่ละโครงการ เช่น Palliative Care</p>
            </div>

            {dashboardContextItems.length > 0 && (
                <div className="dashboard-context-banner">
                    <div className="dashboard-context-icon">📌</div>
                    <div className="dashboard-context-content">
                        <div className="dashboard-context-kicker">Dashboard Context</div>
                        <div className="dashboard-context-title">มุมมองกองทุนพิเศษนี้ถูกเปิดมาจาก Executive Dashboard</div>
                        <div className="dashboard-context-chips">
                            {dashboardContextItems.map((item) => (
                                <span key={item} className="dashboard-context-chip">{item}</span>
                            ))}
                        </div>
                    </div>
                    <button className="btn btn-secondary" onClick={() => setDashboardContextItems([])}>
                        ซ่อนป้ายนี้
                    </button>
                </div>
            )}
            {/* Main Layout: Fund Menu + Content */}
            <div className="specific-fund-layout" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'stretch' }}>
                {/* TOP FUND MENU */}
                <div className="specific-fund-sidebar" style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                    gap: '10px',
                    position: 'static',
                    top: 'auto',
                    alignSelf: 'stretch',
                }}>
                    {visibleFunds.length === 0 && (
                        <div className="specific-fund-empty" style={{ marginBottom: 12, gridColumn: '1 / -1' }}>
                            <div className="specific-fund-empty__icon">🚫</div>
                            <div className="specific-fund-empty__title">ไม่มีเมนูกองทุนที่แสดง</div>
                            <div className="specific-fund-empty__text">
                                กรุณาไปที่ <strong>ตั้งค่า</strong> แล้วเปิดกองทุนที่ต้องการแสดงในหน้า <strong>รายกองทุน (พิเศษ)</strong>
                            </div>
                        </div>
                    )}
                    {visibleFunds.map((f) => {
                        const isActive = activeFund === f.id;
                        const fundColors: Record<string, { gradient: string; accent: string; light: string }> = {
                            palliative: { gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', accent: '#667eea', light: '#f0f4ff' },
                            telemedicine: { gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', accent: '#f5576c', light: '#ffe5ec' },
                            drugp: { gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', accent: '#00f2fe', light: '#e0f7ff' },
                            herb: { gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', accent: '#38f9d7', light: '#e0f7f4' },
                            knee: { gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', accent: '#fee140', light: '#fff5e6' },
                            instrument: { gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', accent: '#30cfd0', light: '#e0f7f8' },
                            preg_test: { gradient: 'linear-gradient(135deg, #ff6b9d 0%, #c06c84 100%)', accent: '#ff6b9d', light: '#ffe5f0' },
                            anc: { gradient: 'linear-gradient(135deg, #ffa751 0%, #ffe259 100%)', accent: '#ffe259', light: '#fffce0' },
                            cacervix: { gradient: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)', accent: '#ff6a88', light: '#ffe5ec' },
                            fp: { gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', accent: '#fed6e3', light: '#ffe5f0' },
                            postnatal_care: { gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)', accent: '#fecfef', light: '#ffe5f0' },
                            er_emergency: { gradient: 'linear-gradient(135deg, #ff6e7f 0%, #bfe9ff 100%)', accent: '#bfe9ff', light: '#e0f7ff' },
                            chemo: { gradient: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)', accent: '#c2e9fb', light: '#e0f7ff' },
                            hepc: { gradient: 'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)', accent: '#fef9d7', light: '#fffce0' },
                            rehab: { gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', accent: '#38ef7d', light: '#e0f7f0' },
                            crrt: { gradient: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)', accent: '#6dd5ed', light: '#e0f7ff' },
                            robot: { gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', accent: '#fed6e3', light: '#ffe5f0' },
                            proton: { gradient: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)', accent: '#ff6a88', light: '#ffe5ec' },
                            cxr: { gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', accent: '#00f2fe', light: '#e0f7ff' },
                            clopidogrel: { gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', accent: '#667eea', light: '#f0f4ff' },
                            fpg_screening: { gradient: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)', accent: '#ff4b2b', light: '#ffe5e0' },
                            cholesterol_screening: { gradient: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)', accent: '#ffd200', light: '#fffce0' },
                            anemia_screening: { gradient: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)', accent: '#ffdde1', light: '#ffe5e8' },
                            iron_supplement: { gradient: 'linear-gradient(135deg, #870000 0%, #190a05 100%)', accent: '#c86464', light: '#ffe0e0' },
                            ferrokid_child: { gradient: 'linear-gradient(135deg, #c31432 0%, #240b36 100%)', accent: '#c31432', light: '#ffe1ea' },
                            anc_ultrasound: { gradient: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)', accent: '#6dd5ed', light: '#e0f7ff' },
                            anc_lab_1: { gradient: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)', accent: '#ffaf7b', light: '#fff5e6' },
                            anc_lab_2: { gradient: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', accent: '#2a5298', light: '#e0ebff' },
                            postnatal_supplements: { gradient: 'linear-gradient(135deg, #1d976c 0%, #93f9b9 100%)', accent: '#93f9b9', light: '#e0f7f0' },
                            fluoride: { gradient: 'linear-gradient(135deg, #4ca1af 0%, #c4e0e5 100%)', accent: '#c4e0e5', light: '#e0f7ff' },
                            contraceptive_pill: { gradient: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)', accent: '#2575fc', light: '#e0ebff' },
                            condom: { gradient: 'linear-gradient(135deg, #232526 0%, #414345 100%)', accent: '#666666', light: '#f0f0f0' },
                        };
                        
                        const colors = fundColors[f.id] || fundColors.palliative;
                          return (
                            <div
                                key={f.id}
                                onClick={() => setActiveFund(f.id)}
                                style={{
                                    width: '100%',
                                    minHeight: '72px',
                                    padding: isActive ? '12px 14px' : '10px 14px',
                                    background: isActive ? colors.gradient : '#ffffff',
                                    border: isActive ? 'none' : `1px solid #e0e0e0`,
                                    borderRadius: '14px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: isActive
                                        ? `0 6px 16px ${colors.accent}40`
                                        : '0 2px 4px rgba(0, 0, 0, 0.05)',
                                    transform: isActive ? 'translateY(-1px)' : 'translateY(0)',
                                    position: 'relative',
                                    overflow: 'visible',
                                    display: 'flex',
                                    flexDirection: 'row',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '10px',
                                }}
                                onMouseEnter={(e) => {
                                    const el = e.currentTarget as HTMLElement;
                                    if (!isActive) {
                                        el.style.background = colors.light;
                                        el.style.borderColor = colors.accent;
                                        el.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.08)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    const el = e.currentTarget as HTMLElement;
                                    if (!isActive) {
                                        el.style.background = '#ffffff';
                                        el.style.borderColor = '#e0e0e0';
                                        el.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                                    }
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    minWidth: 0,
                                    flex: 1,
                                }}>
                                    <div style={{
                                        fontSize: '16px',
                                        flexShrink: 0,
                                        lineHeight: '1',
                                        transition: 'transform 0.3s ease'
                                    }}>{(() => {
                                        const iconMap: Record<string, string> = {
                                            'palliative': '🕊️',
                                            'telemedicine': '📱',
                                            'drugp': '📦',
                                            'herb': '🌿',
                                            'knee': '🦵',
                                            'instrument': '🦾',
                                            'preg_test': '🧪',
                                            'anc': '👶',
                                            'cacervix': '🎀',
                                            'fp': '💊',
                                            'postnatal_care': '🤱',
                                            'er_emergency': '🚨',
                                            'chemo': '⚗️',
                                            'hepc': '🩹',
                                            'rehab': '♿',
                                            'crrt': '🏥',
                                            'robot': '🤖',
                                            'proton': '⚛️',
                                            'cxr': '🩻',
                                            'clopidogrel': '💊',
                                            'fpg_screening': '🩸',
                                            'cholesterol_screening': '🧪',
                                            'anemia_screening': '🩸',
                                            'iron_supplement': '💊',
                                            'ferrokid_child': '🧒',
                                            'anc_ultrasound': '🔊',
                                            'anc_lab_1': '🧬',
                                            'anc_lab_2': '🧪',
                                            'postnatal_supplements': '💊',
                                            'fluoride': '🦷',
                                            'contraceptive_pill': '💊',
                                            'condom': '🛡️',
                                        };
                                        return iconMap[f.id] || '📋';
                                    })()}
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        color: isActive ? '#ffffff' : '#1a1a1a',
                                        transition: 'color 0.3s ease',
                                        lineHeight: '1.3',
                                        wordBreak: 'break-word',
                                        whiteSpace: 'normal',
                                        minWidth: 0,
                                        flex: 1,
                                    }}>
                                        {f.name}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void exportFundToExcel(f.id);
                                    }}
                                    disabled={exportingFundId === f.id}
                                    title={`ส่งออก Excel ของ ${f.name}`}
                                    style={{
                                        flexShrink: 0,
                                        border: isActive ? '1px solid rgba(255,255,255,0.28)' : `1px solid ${colors.accent}`,
                                        background: isActive ? 'rgba(255,255,255,0.16)' : '#fff',
                                        color: isActive ? '#fff' : colors.accent,
                                        borderRadius: '999px',
                                        padding: '6px 10px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        lineHeight: '1',
                                        boxShadow: isActive ? 'none' : '0 1px 2px rgba(0,0,0,0.08)',
                                        cursor: exportingFundId === f.id ? 'wait' : 'pointer',
                                        opacity: exportingFundId === f.id ? 0.7 : 1,
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    {exportingFundId === f.id ? '⏳' : '📥 Excel'}
                                </button>
                            </div>
                        );
                    })}
                </div>                {/* RIGHT SIDE - Main Content */}
                <div className="specific-fund-content" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    {/* Check Conditions Section - At Top */}                    <div style={{
                        background: 'linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%)',
                        padding: '16px',
                        borderRadius: '12px',
                        marginBottom: '12px',
                        border: '1px solid #dee2e6',
                        flexShrink: 0,
                    }}>
                        <h2 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: '#1a1a1a' }}>
                            ✓ เงื่อนไขการตรวจสอบ: {activeFundDefinition?.name}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', fontSize: '12px', marginBottom: '10px' }}>
                            {(activeFundDefinition?.conditions || []).map((condition, index) => {
                                const cardBg = ['#e3f2fd', '#fff3e0', '#f3e5f5', '#e8f5e9'][index % 4];
                                const cardBorder = ['#2196f3', '#ff9800', '#9c27b0', '#4caf50'][index % 4];
                                const cardText = ['#1565c0', '#e65100', '#6a1b9a', '#2e7d32'][index % 4];
                                return (
                                    <div key={condition} style={{ padding: '12px', background: cardBg, borderRadius: '8px', borderLeft: `3px solid ${cardBorder}` }}>
                                        <div style={{ fontWeight: 700, color: cardBorder, marginBottom: '4px' }}>✓ เงื่อนไข {index + 1}</div>
                                        <div style={{ color: cardText, lineHeight: '1.45' }}>{condition}</div>
                                    </div>
                                );
                            })}
                            {activeFundDefinition?.caution && (
                                <div style={{ padding: '12px', background: '#fff7ed', borderRadius: '8px', borderLeft: '3px solid #f97316', gridColumn: '1 / -1' }}>
                                    <div style={{ fontWeight: 700, color: '#ea580c', marginBottom: '4px' }}>⚠️ หมายเหตุสำคัญ</div>
                                    <div style={{ color: '#9a3412', lineHeight: '1.45' }}>{activeFundDefinition.caution}</div>
                                </div>
                            )}
                            {!activeFundDefinition?.conditions?.length && (
                                <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '8px', borderLeft: '3px solid #2196f3', gridColumn: '1 / -1' }}>
                                    <div style={{ fontWeight: 700, color: '#2196f3' }}>ℹ️ ยังไม่มีเงื่อนไขที่ตั้งไว้</div>
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', fontSize: '12px' }}>
                            {activeFund === 'palliative' && (
                                <>
                                    <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '8px', borderLeft: '3px solid #2196f3' }}>
                                        <div style={{ fontWeight: 700, color: '#2196f3', marginBottom: '4px' }}>✓ สิทธิ์</div>
                                        <div style={{ color: '#1565c0' }}>UCS เท่านั้น</div>
                                    </div>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Diagnosis</div>
                                        <div style={{ color: '#e65100' }}>Z515 หรือ Z718</div>
                                    </div>
                                    <div style={{ padding: '12px', background: '#f3e5f5', borderRadius: '8px', borderLeft: '3px solid #9c27b0' }}>
                                        <div style={{ fontWeight: 700, color: '#9c27b0', marginBottom: '4px' }}>✓ ADP</div>
                                        <div style={{ color: '#6a1b9a' }}>30001/Cons01/Eva001</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'telemedicine' && (
                                <>
                                    <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '8px', borderLeft: '3px solid #2196f3' }}>
                                        <div style={{ fontWeight: 700, color: '#2196f3', marginBottom: '4px' }}>✓ สิทธิ์</div>
                                        <div style={{ color: '#1565c0' }}>UCS เท่านั้น</div>
                                    </div>
                                    <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '8px', borderLeft: '3px solid #4caf50' }}>
                                        <div style={{ fontWeight: 700, color: '#4caf50', marginBottom: '4px' }}>✓ ADP</div>
                                        <div style={{ color: '#2e7d32' }}>TELMED (Code 5)</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'herb' && (
                                <>
                                    <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '8px', borderLeft: '3px solid #4caf50' }}>
                                        <div style={{ fontWeight: 700, color: '#4caf50', marginBottom: '4px' }}>✓ สิทธิ์</div>
                                        <div style={{ color: '#2e7d32' }}>UCS/WEL</div>
                                    </div>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ ยอดราคา</div>
                                        <div style={{ color: '#e65100' }}>{'> 0 บาท'}</div>
                                    </div>
                                </>
                            )}                            {activeFund === 'knee' && (
                                <>
                                    <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '8px', borderLeft: '3px solid #4caf50' }}>
                                        <div style={{ fontWeight: 700, color: '#4caf50', marginBottom: '4px' }}>✓ อายุ</div>
                                        <div style={{ color: '#2e7d32' }}>{'>= 40 ปี'}</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'chemo' && (
                                <>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Diagnosis</div>
                                        <div style={{ color: '#e65100' }}>Z511 หรือ Z512</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'hepc' && (
                                <>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Diagnosis</div>
                                        <div style={{ color: '#e65100' }}>B18.2</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'rehab' && (
                                <>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Diagnosis</div>
                                        <div style={{ color: '#e65100' }}>Z50</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'crrt' && (
                                <>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Diagnosis</div>
                                        <div style={{ color: '#e65100' }}>Z49</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'robot' && (
                                <>
                                    <div style={{ padding: '12px', background: '#f3e5f5', borderRadius: '8px', borderLeft: '3px solid #9c27b0' }}>
                                        <div style={{ fontWeight: 700, color: '#9c27b0', marginBottom: '4px' }}>✓ หัตถการ</div>
                                        <div style={{ color: '#6a1b9a' }}>ผ่าตัดด้วยหุ่นยนต์</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'proton' && (
                                <>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Diagnosis</div>
                                        <div style={{ color: '#e65100' }}>Z51.0</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'cxr' && (
                                <>
                                    <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '8px', borderLeft: '3px solid #2196f3' }}>
                                        <div style={{ fontWeight: 700, color: '#2196f3', marginBottom: '4px' }}>✓ บริการ</div>
                                        <div style={{ color: '#1565c0' }}>อ่านฟิล์ม CXR</div>
                                    </div>
                                </>
                            )}                            {activeFund === 'fp' && (
                                <>
                                    <div style={{ padding: '12px', background: '#fff3e0', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Diagnosis Z30</div>
                                        <div style={{ color: '#e65100' }}>Z300-Z309 (Z30x)</div>
                                    </div>
                                    <div style={{ padding: '12px', background: '#ffe0b2', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                        <div style={{ fontWeight: 700, color: '#ff9800', marginBottom: '4px' }}>✓ Z308 + ICD9</div>
                                        <div style={{ color: '#e65100' }}>9923 (FP002_1) หรือ 8605 (FP002_2)</div>
                                    </div>
                                    <div style={{ padding: '12px', background: '#f3e5f5', borderRadius: '8px', borderLeft: '3px solid #9c27b0' }}>
                                        <div style={{ fontWeight: 700, color: '#9c27b0', marginBottom: '4px' }}>✓ ADP Codes</div>
                                        <div style={{ color: '#6a1b9a' }}>FP003_1, FP003_2, FP002_1, FP002_2</div>
                                    </div>
                                </>
                            )}
                            {activeFund === 'preg_test' && (
                                <>
                                    <div style={{ padding: '12px', background: '#e8f5e9', borderRadius: '8px', borderLeft: '3px solid #4caf50' }}>
                                        <div style={{ fontWeight: 700, color: '#4caf50', marginBottom: '4px' }}>✓ ADP Code</div>
                                        <div style={{ color: '#2e7d32' }}>30014</div>
                                    </div>
                                </>
                            )}
                            {!['palliative', 'telemedicine', 'herb', 'knee', 'chemo', 'hepc', 'rehab', 'crrt', 'robot', 'proton', 'cxr', 'fp', 'preg_test'].includes(activeFund) && (
                                <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '8px', borderLeft: '3px solid #2196f3', gridColumn: '1 / -1' }}>
                                    <div style={{ fontWeight: 700, color: '#2196f3' }}>ℹ️ เลือกกองทุนด้านซ้ายเพื่อดูเงื่อนไข</div>
                                </div>                            )}
                        </div>
                    </div>                    {/* Data Table Section */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>                        {/* Date Filter */}
                        <div className="card" style={{ marginBottom: 10, flexShrink: 0 }}>
                            <div className="card-body specific-fund-filters" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 16px' }}>
                                <div className="form-group" style={{ marginBottom: 0, flex: '0 1 auto' }}>
                                    <label className="form-label" style={{ fontSize: '11px' }}>📅 วันที่เริ่ม</label>
                                    <input type="date" className="form-control" style={{ width: '120px', fontSize: '12px', padding: '6px 8px' }} value={startDate} onChange={e => setStartDate(e.target.value)} />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0, flex: '0 1 auto' }}>
                                    <label className="form-label" style={{ fontSize: '11px' }}>📅 วันที่สิ้นสุด</label>
                                    <input type="date" className="form-control" style={{ width: '120px', fontSize: '12px', padding: '6px 8px' }} value={endDate} onChange={e => setEndDate(e.target.value)} />
                                </div>
                                <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={fetchFundData}>
                                    🔄 ดึงข้อมูล
                                </button>
                                <button 
                                    className="btn" 
                                    style={{
                                        background: showIncompleteOnly ? 'var(--danger)' : 'var(--warning)',
                                        color: 'white',
                                        borderColor: showIncompleteOnly ? 'var(--danger)' : 'var(--warning)',
                                        padding: '6px 12px',
                                        fontSize: '12px'
                                    }}
                                    onClick={() => setShowIncompleteOnly(!showIncompleteOnly)}
                                >
                                    {showIncompleteOnly ? '✓ เฉพาะไม่สมบูรณ์' : '○ ทั้งหมด'}
                                </button>
                                <button 
                                    className="btn btn-success" 
                                    style={{ padding: '6px 12px', fontSize: '12px', marginLeft: 'auto' }}
                                    onClick={exportToExcel}
                                    disabled={filteredData.length === 0}
                                >
                                    📥 ส่งออก Excel
                                </button>
                            </div>
                        </div>
                        {loading && <div className="loading-container"><div className="spinner" /><span>กำลังโหลดข้อมูล...</span></div>}
                        {error && <div className="alert alert-danger">{error}</div>}
                        {!loading && !error && (
                <div className="card" style={{ overflow: 'visible' }}>
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--primary)' }}>
                            รายการตรวจสอบ {funds.find(f => f.id === activeFund)?.name}
                        </div>
                        <div className="badge badge-primary">รวม {filteredData.length} / {data.length} รายการ</div>
                    </div>
                    <div className="specific-fund-table-wrap" style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ width: '100%', tableLayout: 'fixed', fontSize: 12 }}>
                            <thead>
                                <tr>
                                    <th style={{ width: 36, textAlign: 'center', padding: '8px 4px' }}>#</th>
                                    <th style={{ width: 120 }}>VN / HN</th>
                                    <th style={{ width: 150 }}>ชื่อผู้ป่วย / CID</th>
                                    <th style={{ width: 140 }}>สิทธิ์ (PTType)</th>
                                    <th style={{ width: 105 }}>วันที่รับบริการ</th>                                    {activeFund === 'palliative' && (
                                        <>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag (Z515)</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag (Z718)</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>ADP Code</th>
                                        </>
                                    )}
                                    {activeFund === 'telemedicine' && (
                                        <>
                                            <th style={{ width: 100, textAlign: 'center' }}>การมา (Ovstist)</th>
                                            <th style={{ width: 100, textAlign: 'center' }}>ADP Code</th>
                                        </>
                                    )}
                                    {activeFund === 'drugp' && (
                                        <th style={{ width: 100, textAlign: 'center' }}>ADP Code</th>
                                    )}
                                    {activeFund === 'herb' && (
                                        <>
                                            <th style={{ width: 80, textAlign: 'center' }}>Diag หลัก</th>
                                            <th style={{ textAlign: 'left' }}>รายการยาสมุนไพร</th>
                                            <th style={{ width: 110, textAlign: 'right' }}>ยอดรวม (฿)</th>
                                        </>
                                    )}
                                    {activeFund === 'knee' && (
                                        <>
                                            <th style={{ width: 60, textAlign: 'center' }}>อายุ</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag</th>
                                            <th style={{ width: 130, textAlign: 'center' }}>รหัสหัตถการ</th>
                                        </>
                                    )}
                                    {activeFund === 'instrument' && (
                                        <>
                                            <th style={{ textAlign: 'left' }}>รายการอุปกรณ์</th>
                                            <th style={{ width: 100, textAlign: 'center' }}>กลุ่ม</th>
                                            <th style={{ width: 110, textAlign: 'right' }}>ยอดรวม (฿)</th>
                                        </>
                                    )}
                                    {activeFund === 'preg_test' && (
                                        <>
                                            <th style={{ width: 110, textAlign: 'center' }}>รหัส 31101</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>รหัส 30014</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>ผลแล็ป UPT</th>
                                        </>
                                    )}
                                    {(activeFund === 'anc' || activeFund === 'anc_ultrasound') && (
                                        <>
                                            <th style={{ width: 140, textAlign: 'center' }}>Diag ฝากครรภ์</th>
                                            <th style={{ width: 120, textAlign: 'center' }}>รหัส ANC</th>
                                            {activeFund === 'anc_ultrasound' && <th style={{ width: 120, textAlign: 'center' }}>อัลตราซาวนด์</th>}
                                        </>
                                    )}
                                    {activeFund === 'cacervix' && (
                                        <>
                                            <th style={{ width: 120, textAlign: 'center' }}>Diag (Z124/Z014)</th>
                                            <th style={{ width: 140, textAlign: 'center' }}>รหัสคัดกรอง CA</th>
                                        </>
                                    )}
                                    {activeFund === 'fp' && (
                                        <>
                                            <th style={{ width: 110, textAlign: 'center' }}>Diag คุมกำเนิด</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>รหัสอุปกรณ์/ยา</th>
                                        </>
                                    )}
                                    {activeFund === 'postnatal_care' && (
                                        <>
                                            <th style={{ width: 120, textAlign: 'center' }}>Diag หลังคลอด</th>
                                            <th style={{ width: 100, textAlign: 'center' }}>รหัส 30015</th>
                                        </>
                                    )}
                                    {activeFund === 'er_emergency' && (
                                        <th style={{ width: 100, textAlign: 'center' }}>Project Code</th>
                                    )}
                                    {activeFund === 'chemo' && (
                                        <th style={{ width: 120, textAlign: 'center' }}>Diag เคมีบำบัด</th>
                                    )}
                                    {activeFund === 'hepc' && (
                                        <th style={{ width: 120, textAlign: 'center' }}>Diag ตับอักเสบซี</th>
                                    )}
                                    {activeFund === 'rehab' && (
                                        <th style={{ width: 100, textAlign: 'center' }}>Diag ฟื้นฟู</th>
                                    )}
                                    {activeFund === 'crrt' && (
                                        <th style={{ width: 110, textAlign: 'center' }}>Diag ฟอกเลือด</th>
                                    )}
                                    {activeFund === 'robot' && (
                                        <th style={{ width: 120, textAlign: 'center' }}>หัตถการ Robot</th>
                                    )}
                                    {activeFund === 'proton' && (
                                        <th style={{ width: 120, textAlign: 'center' }}>Diag รังสีรักษา</th>
                                    )}
                                    {activeFund === 'cxr' && (
                                        <th style={{ width: 130, textAlign: 'center' }}>รายการอ่านฟิล์ม</th>
                                    )}
                                    {activeFund === 'fpg_screening' && (
                                        <>
                                            <th style={{ width: 60, textAlign: 'center' }}>อายุ</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag หลัก</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>Authen Code</th>
                                        </>
                                    )}
                                    {activeFund === 'cholesterol_screening' && (
                                        <>
                                            <th style={{ width: 60, textAlign: 'center' }}>อายุ</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag หลัก</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>Authen Code</th>
                                        </>
                                    )}
                                    {activeFund === 'anemia_screening' && (
                                        <>
                                            <th style={{ width: 60, textAlign: 'center' }}>อายุ</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag หลัก</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>Authen Code</th>
                                        </>
                                    )}
                                    {(activeFund === 'iron_supplement' || activeFund === 'ferrokid_child') && (
                                        <>
                                            <th style={{ width: 60, textAlign: 'center' }}>อายุ</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag หลัก</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>Authen Code</th>
                                        </>
                                    )}
                                    {(activeFund?.startsWith('anc_') ||
                                      activeFund?.startsWith('postnatal_') ||
                                      activeFund === 'preg_test' ||
                                      activeFund === 'fluoride' ||
                                      activeFund === 'contraceptive_pill' ||
                                      activeFund === 'condom') && (
                                        <>
                                            <th style={{ width: 60, textAlign: 'center' }}>อายุ</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Diag หลัก</th>
                                            <th style={{ width: 110, textAlign: 'center' }}>Authen Code</th>
                                        </>
                                    )}
                                    <th style={{ width: 160, textAlign: 'left', padding: '8px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
                                        🏷️ SUBFUNDS TAGS
                                    </th>
                                    <th style={{ width: 90, textAlign: 'center' }}>สถานะ</th>
                                </tr>
                            </thead>                            <tbody>
                                {filteredData.length === 0 ? (
                                    <tr><td colSpan={100} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>ไม่พบข้อมูล{showIncompleteOnly ? ' ไม่สมบูรณ์' : 'ในช่วงวันที่เลือก'}</td></tr>
                                ) : (                                    filteredData.map((item, index) => {
                                        const st = getStatus(item);                                        return (
                                            <tr key={item.vn} onClick={() => handleRowClick(item)} className="clickable-row" style={{ cursor: 'pointer', background: st.status !== 'สมบูรณ์' ? 'rgba(239, 68, 68, 0.04)' : '' }}>
                                                <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '6px 4px' }}>{index + 1}</td>
                                                <td style={{ padding: '6px 8px' }}>
                                                    <div style={{ fontWeight: 600, color: 'var(--primary)', fontSize: 11 }}>{item.vn}</div>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>HN: {item.hn}</div>
                                                </td>
                                                <td style={{ padding: '6px 8px' }}>
                                                    <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.patientName}</div>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.cid}</div>
                                                </td>                                                <td style={{ padding: '6px 8px' }}>
                                                    <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.pttypename}>
                                                        {item.pttypename}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 600 }}>HIP: {item.hipdata_code || '-'}</div>
                                                </td>
                                                <td style={{ padding: '6px 8px' }}>
                                                    <div style={{ fontSize: 11 }}>{item.serviceDate}</div>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.vsttime}</div>
                                                </td>{activeFund === 'palliative' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.z515_code
                                                                ? <span className="badge badge-success">✓ มี Z515</span>
                                                                : <span className="badge badge-danger">✗ ขาด Z515</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.z718_code
                                                                ? <span className="badge badge-success">✓ มี Z718</span>
                                                                : <span className="badge badge-danger">✗ ขาด Z718</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                                                                {item.has_30001 === 'Y' && <span className="badge badge-primary">30001</span>}
                                                                {item.has_cons01 === 'Y' && <span className="badge badge-primary">Cons01</span>}
                                                                {item.has_eva001 === 'Y' && <span className="badge badge-primary">Eva001</span>}
                                                                {(item.has_30001 !== 'Y' && item.has_cons01 !== 'Y' && item.has_eva001 !== 'Y') &&
                                                                    <span className="badge badge-danger">✗ ไม่มี ADP</span>}
                                                            </div>
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'telemedicine' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.ovstist_export_code === '5'
                                                                ? <span className="badge badge-success" title={item.ovstist_name}>{item.ovstist_export_code} (Tele)</span>
                                                                : <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title={item.ovstist_name}>
                                                                    {item.ovstist_export_code || '-'}
                                                                </span>}
                                                        </td>                                                        <td style={{ textAlign: 'center', padding: '12px 8px', fontSize: '12px' }}>
                                                            {item.has_telmed === 'Y'
                                                                ? <span className="badge badge-primary">TELMED</span>
                                                                : <span className="badge badge-danger">✗ ขาด TELMED</span>}
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'drugp' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.has_drugp === 'Y'
                                                                ? <span className="badge badge-primary">DRUGP</span>
                                                                : <span className="badge badge-danger">✗ ขาด DRUGP</span>}
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'herb' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.pdx ? <span className="badge badge-primary">{item.pdx}</span> : <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>-</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'left' }}>
                                                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.herb_items}>
                                                                {item.herb_items || '-'}
                                                            </div>
                                                        </td>
                                                        <td style={{ textAlign: 'right' }}>
                                                            {item.herb_total_price ? <strong style={{ color: 'var(--teal)' }}>{Number(item.herb_total_price).toLocaleString()} ฿</strong> : '0 ฿'}
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'knee' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <strong style={{ color: item.age_y >= 40 ? 'var(--success)' : 'var(--danger)' }}>{item.age_y}</strong>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.diag_code ? <div style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.diag_code}>{item.diag_code}</div> : '-'}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span className="badge badge-success">{item.oper_code}</span>
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'instrument' && (
                                                    <>
                                                        <td style={{ textAlign: 'left' }}>
                                                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.instrument_items}>
                                                                {item.instrument_items || '-'}
                                                            </div>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                                                                {item.has_oa === 'Y' && <span className="badge badge-warning">ผ่าข้อเข่า (OA)</span>}
                                                                {item.has_dm === 'Y' && <span className="badge badge-primary">อุปกรณ์ DM</span>}
                                                                {item.has_oa !== 'Y' && item.has_dm !== 'Y' && <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>ทั่วไป</span>}
                                                            </div>
                                                        </td>
                                                        <td style={{ textAlign: 'right' }}>
                                                            {item.instrument_price ? <strong style={{ color: 'var(--teal)' }}>{Number(item.instrument_price).toLocaleString()} ฿</strong> : '0 ฿'}
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'preg_test' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {(toFlag(item?.has_preg_lab) || item.preg_lab_name || item.preg_result)
                                                                ? <span className="badge badge-primary" style={{ maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }} title={item.preg_lab_name || 'Lab UPT/31101'}>{item.preg_lab_name || 'มี 31101'}</span>
                                                                : <span className="badge badge-danger">✗ ขาด 31101</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {(toFlag(item?.has_preg_item) || toFlag(item?.has_upt) || item.preg_item_name)
                                                                ? <span className="badge badge-primary" style={{ maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }} title={item.preg_item_name || 'ADP 30014'}>{item.preg_item_name || 'มี 30014'}</span>
                                                                : <span className="badge badge-danger">✗ ขาด 30014</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.preg_result
                                                                ? <strong style={{ color: 'var(--teal)' }}>{item.preg_result}</strong>
                                                                : (toFlag(item?.has_preg_lab) ? <span className="badge badge-success">พบผลแล็ป</span> : <span className="badge badge-warning">ไม่พบผลแล็ป</span>)}
                                                        </td>
                                                    </>
                                                )}
                                                {(activeFund === 'anc' || activeFund === 'anc_ultrasound') && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.anc_diags ? <span className="badge badge-primary">{item.anc_diags}</span> : <span className="badge badge-danger">✗ ขาด Diag</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.anc_adp_codes ? <span className="badge badge-primary">{item.anc_adp_codes}</span> : <span className="badge badge-danger">✗ ขาด ADP Code</span>}
                                                        </td>
                                                        {activeFund === 'anc_ultrasound' && (
                                                            <td style={{ textAlign: 'center' }}>
                                                                {(item.has_anc_us === 'Y' || item.has_anc_us_proc === 'Y')
                                                                    ? ((item.has_anc_us === 'Y' && item.has_anc_us_proc === 'Y')
                                                                        ? <span className="badge badge-success">✓ มี 30010 + Ultrasound ANC</span>
                                                                        : <span className="badge badge-warning">⚠️ ขาด 30010 หรือ Ultrasound ANC</span>)
                                                                    : <span className="badge badge-danger">✗ ขาด 30010 + Ultrasound ANC</span>}
                                                            </td>
                                                        )}
                                                    </>
                                                )}
                                                {activeFund === 'cacervix' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.ca_diags ? <span className="badge badge-primary">{item.ca_diags}</span> : <span className="badge badge-danger">✗ ขาด Diag</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'left' }}>
                                                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                                                {item.ca_adp_codes ? <span className="badge badge-primary">{item.ca_adp_codes}</span> : <span className="badge badge-danger">✗ ขาด ADP Code</span>}
                                                            </div>
                                                        </td>
                                                    </>
                                                )}                                                {activeFund === 'fp' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.fp_diags ? <span className="badge badge-primary" style={{ maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }} title={item.fp_diags}>{item.fp_diags}</span> : <span className="badge badge-danger">✗ ขาด Z30</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <div style={{ fontSize: 11 }}>
                                                                {item.pdx === 'Z308' && (
                                                                    <>
                                                                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Z308</div>
                                                                        {item.icd9_code === '9923' && <span className="badge badge-success" style={{ marginRight: 4 }}>FP002_1 (9923)</span>}
                                                                        {item.icd9_code === '8605' && <span className="badge badge-success">FP002_2 (8605)</span>}
                                                                        {item.icd9_code !== '9923' && item.icd9_code !== '8605' && item.icd9_code && 
                                                                            <span className="badge badge-warning">ICD9: {item.icd9_code}</span>}
                                                                    </>
                                                                )}
                                                                {item.fp_adp_codes && <span className="badge badge-primary">{item.fp_adp_codes}</span>}
                                                                {!item.fp_adp_codes && item.pdx !== 'Z308' && <span className="badge badge-danger">✗ ขาดรหัส FP</span>}
                                                            </div>
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'postnatal_care' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {(item.pp_diags || toFlag(item?.has_pp_diag)) ? <span className="badge badge-primary">{item.pp_diags || 'Z390/Z391/Z392'}</span> : <span className="badge badge-danger">✗ ขาด Z390/Z391/Z392</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {(hasAnyCodeValue(item?.pp_adp_codes, ['30015']) || toFlag(item?.has_post_care)) ? <span className="badge badge-primary">{item.pp_adp_codes || '30015'}</span> : <span className="badge badge-danger">✗ ขาด 30015</span>}
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'er_emergency' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.project_code === 'OP AE' ? <span className="badge badge-primary">OP AE</span> : <span className="badge badge-danger">✗ ไม่ใช่</span>}
                                                    </td>
                                                )}
                                                {activeFund === 'chemo' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.has_chemo_diag ? <span className="badge badge-primary">Z511/Z512</span> : <span className="badge badge-danger">✗ ขาด Diag</span>}
                                                    </td>
                                                )}
                                                {activeFund === 'hepc' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.has_hepc_diag ? <span className="badge badge-primary">B18.2</span> : <span className="badge badge-danger">✗ ขาด Diag</span>}
                                                    </td>
                                                )}
                                                {activeFund === 'rehab' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.has_rehab_diag ? <span className="badge badge-primary">Z50.x</span> : <span className="badge badge-danger">✗ ขาด Diag</span>}
                                                    </td>
                                                )}
                                                {activeFund === 'crrt' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.has_crrt_diag ? <span className="badge badge-primary">Z49.x</span> : <span className="badge badge-danger">✗ ขาด Diag</span>}
                                                    </td>
                                                )}
                                                {activeFund === 'robot' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.has_robot_item ? <span className="badge badge-primary">มีการผ่าตัด</span> : <span className="badge badge-danger">✗ ไม่มี</span>}
                                                    </td>
                                                )}
                                                {activeFund === 'proton' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.has_proton_diag ? <span className="badge badge-primary">Z51.0</span> : <span className="badge badge-danger">✗ ขาด Diag</span>}
                                                    </td>
                                                )}                                                {activeFund === 'cxr' && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {item.has_cxr_item ? <span className="badge badge-primary">Chest X-Ray</span> : <span className="badge badge-danger">✗ ไม่มี</span>}
                                                    </td>
                                                )}
                                                {activeFund === 'fpg_screening' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <strong>{item.age}</strong>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.pdx ? <span className="badge badge-primary">{item.pdx}</span> : '-'}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span className="badge badge-success">{item.authencode || '-'}</span>
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'cholesterol_screening' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <strong>{item.age}</strong>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.pdx ? <span className="badge badge-primary">{item.pdx}</span> : '-'}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span className="badge badge-success">{item.authencode || '-'}</span>
                                                        </td>
                                                    </>
                                                )}
                                                {activeFund === 'anemia_screening' && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <strong style={{ color: item.age >= 13 && item.age <= 24 ? 'var(--success)' : 'var(--danger)' }}>{item.age}</strong>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.pdx ? <span className="badge badge-primary">{item.pdx}</span> : '-'}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span className="badge badge-success">{item.authencode || '-'}</span>
                                                        </td>
                                                    </>
                                                )}
                                                {(activeFund === 'iron_supplement' || activeFund === 'ferrokid_child') && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <strong style={{
                                                                color: activeFund === 'ferrokid_child'
                                                                    ? (Number(item.age_month ?? -1) >= 2 && Number(item.age_month ?? -1) <= 144 ? 'var(--success)' : 'var(--danger)')
                                                                    : (item.age >= 13 && item.age <= 45 ? 'var(--success)' : 'var(--danger)')
                                                            }}>
                                                                {activeFund === 'ferrokid_child' && item.age_month != null
                                                                    ? `${item.age} ปี (${item.age_month} เดือน)`
                                                                    : item.age}
                                                            </strong>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.pdx ? <span className="badge badge-primary">{item.pdx}</span> : '-'}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span className="badge badge-success">{item.authencode || '-'}</span>
                                                        </td>
                                                    </>
                                                )}
                                                {(activeFund?.startsWith('anc_') || 
                                                  activeFund?.startsWith('postnatal_') || 
                                                  activeFund === 'preg_test' || 
                                                  activeFund === 'fluoride' || 
                                                  activeFund === 'contraceptive_pill' || 
                                                  activeFund === 'condom') && (
                                                    <>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <strong>{item.age}</strong>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {item.pdx ? <span className="badge badge-primary">{item.pdx}</span> : '-'}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span className="badge badge-success">{item.authencode || '-'}</span>
                                                        </td>
                                                    </>                                                )}                                                <td style={{ padding: '6px 8px' }}>
                                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                        {st.subfunds && st.subfunds.length > 0 ? (
                                                            st.subfunds.map((subfund, idx) => {
                                                                const colors = getSubfundColor(subfund);
                                                                return (
                                                                    <span
                                                                        key={idx}
                                                                        className="badge"
                                                                        style={{
                                                                            fontSize: '10px',
                                                                            padding: '4px 8px',
                                                                            whiteSpace: 'nowrap',
                                                                            background: colors.bg,
                                                                            color: 'white',
                                                                            fontWeight: '600',
                                                                            boxShadow: `0 2px 4px ${colors.shadow}`,
                                                                            borderRadius: '12px',
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                        }}
                                                                    >
                                                                        {subfund}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', opacity: 0.6 }}>-</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                                                    <span className={`badge ${st.class}`} style={{ fontSize: 11 }}>{st.icon} {st.status}</span>
                                                </td>                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
                        )}
                    </div>
                </div>
            </div>

            {selectedRecord && (
                <DetailModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
            )}
        </div>
    );
};
