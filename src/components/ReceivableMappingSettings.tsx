import { useCallback, useEffect, useMemo, useState } from 'react';
import '../styles/ReceivableMappingSettings.css';

type ReceivableRightMapping = {
  hosxp_code: string;
  hosxp_name: string;
  hipdata_code: string;
  finance_code: string;
  finance_name: string;
  debtor_opd: string;
  debtor_ipd: string;
  revenue_opd: string;
  revenue_ipd: string;
  payment_type_code: string;
  payment_type_name: string;
  grouper: string;
  rounding: string;
};

interface HosxpRightOption {
  code: string;
  name: string;
  hipdata_code?: string;
}

const STANDARD_FINANCE_GROUPS: Array<{
  code: string;
  name: string;
  defaultHipdata: string;
  defaultDebtorOpd: string;
  defaultDebtorIpd: string;
  defaultRevenueOpd: string;
  defaultRevenueIpd: string;
  defaultPaymentCode: string;
  defaultPaymentName: string;
  defaultGrouper: string;
  defaultRounding: string;
}> = [
  {
    code: '01',
    name: 'UC ใน CUP',
    defaultHipdata: 'UCS',
    defaultDebtorOpd: '1102050101.201',
    defaultDebtorIpd: '1102050101.202',
    defaultRevenueOpd: '4301020105.201',
    defaultRevenueIpd: '4301020105.202',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '03',
    name: 'บริการเฉพาะ(CR)',
    defaultHipdata: 'UCS',
    defaultDebtorOpd: '1102050101.216',
    defaultDebtorIpd: '1102050101.202',
    defaultRevenueOpd: '4301020105.244',
    defaultRevenueIpd: '4301020105.202',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '06',
    name: 'UC-PP Expressed demand สร้างเสริมสุขภาพและป้องกันโรค',
    defaultHipdata: 'UCS',
    defaultDebtorOpd: '1102050101.209',
    defaultDebtorIpd: '1102050101.202',
    defaultRevenueOpd: '4301020105.241',
    defaultRevenueIpd: '4301020105.241',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'Y',
  },
  {
    code: '07',
    name: 'UC นอก CUP ในจังหวัด',
    defaultHipdata: 'UCS',
    defaultDebtorOpd: '1102050101.203',
    defaultDebtorIpd: '1102050101.202',
    defaultRevenueOpd: '4301020105.203',
    defaultRevenueIpd: '4301020105.202',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '08',
    name: 'UC นอก CUP ต่างจังหวัด',
    defaultHipdata: 'UCS',
    defaultDebtorOpd: '1102050101.204',
    defaultDebtorIpd: '1102050101.202',
    defaultRevenueOpd: '4301020105.205',
    defaultRevenueIpd: '4301020105.202',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '10',
    name: 'ประกันสังคม ในเครือข่าย',
    defaultHipdata: 'SSS',
    defaultDebtorOpd: '1102050101.301',
    defaultDebtorIpd: '1102050101.302',
    defaultRevenueOpd: '4301020106.305',
    defaultRevenueIpd: '4301020106.306',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '11',
    name: 'ประกันสังคม นอกเครือข่าย',
    defaultHipdata: 'SSS',
    defaultDebtorOpd: '1102050101.303',
    defaultDebtorIpd: '1102050101.304',
    defaultRevenueOpd: '4301020106.307',
    defaultRevenueIpd: '4301020106.308',
    defaultPaymentCode: '01',
    defaultPaymentName: 'ชำระเองเบิกได้',
    defaultGrouper: '6305',
    defaultRounding: 'Y',
  },
  {
    code: '13',
    name: 'ประกันสังคม กองทุนทดแทน',
    defaultHipdata: 'SSS',
    defaultDebtorOpd: '1102050101.307',
    defaultDebtorIpd: '1102050101.307',
    defaultRevenueOpd: '4301020106.311',
    defaultRevenueIpd: '4301020106.311',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'Y',
  },
  {
    code: '14',
    name: 'ประกันสังคม 72 ชั่วโมงแรก',
    defaultHipdata: 'SSS',
    defaultDebtorOpd: '',
    defaultDebtorIpd: '1102050101.308',
    defaultRevenueOpd: '',
    defaultRevenueIpd: '4301020106.312',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'Y',
  },
  {
    code: '16',
    name: 'เบิกต้นสังกัด',
    defaultHipdata: 'A2',
    defaultDebtorOpd: '1102050102.108',
    defaultDebtorIpd: '1102050102.109',
    defaultRevenueOpd: '4301020104.104',
    defaultRevenueIpd: '4301020104.105',
    defaultPaymentCode: '01',
    defaultPaymentName: 'ชำระเองเบิกได้',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '17',
    name: 'เบิกจ่ายตรงกรมบัญชีกลาง',
    defaultHipdata: 'OFC',
    defaultDebtorOpd: '1102050101.401',
    defaultDebtorIpd: '1102050101.402',
    defaultRevenueOpd: '4301020104.401',
    defaultRevenueIpd: '4301020104.402',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '18',
    name: 'เบิกจ่ายตรง อปท.',
    defaultHipdata: 'LGO',
    defaultDebtorOpd: '1102050102.801',
    defaultDebtorIpd: '1102050102.802',
    defaultRevenueOpd: '4301020104.801',
    defaultRevenueIpd: '4301020104.802',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '19',
    name: 'เบิกจ่ายตรง อปท.รูปแบบพิเศษ (กทม)',
    defaultHipdata: 'BKK',
    defaultDebtorOpd: '1102050102.803',
    defaultDebtorIpd: '1102050102.804',
    defaultRevenueOpd: '4301020104.805',
    defaultRevenueIpd: '4301020104.806',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'Y',
  },
  {
    code: '20',
    name: 'เบิกจ่ายตรง อปท.รูปแบบพิเศษ (พัทยา)',
    defaultHipdata: 'PTY',
    defaultDebtorOpd: '1102050102.803',
    defaultDebtorIpd: '1102050102.804',
    defaultRevenueOpd: '4301020104.805',
    defaultRevenueIpd: '4301020104.806',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '21',
    name: 'แรงงานต่างด้าว',
    defaultHipdata: 'NRD',
    defaultDebtorOpd: '1102050101.501',
    defaultDebtorIpd: '1102050101.502',
    defaultRevenueOpd: '4301020106.503',
    defaultRevenueIpd: '4301020106.504',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
  {
    code: '27',
    name: 'ชำระเงิน',
    defaultHipdata: 'A1',
    defaultDebtorOpd: '1102050102.106',
    defaultDebtorIpd: '1102050102.107',
    defaultRevenueOpd: '4301020104.106',
    defaultRevenueIpd: '4301020104.107',
    defaultPaymentCode: '03',
    defaultPaymentName: 'ชำระเองเบิกไม่ได้',
    defaultGrouper: '6305',
    defaultRounding: 'Y',
  },
  {
    code: '28',
    name: 'พรบ.รถ',
    defaultHipdata: 'INS',
    defaultDebtorOpd: '1102050102.602',
    defaultDebtorIpd: '1102050102.603',
    defaultRevenueOpd: '4301020104.602',
    defaultRevenueIpd: '4301020104.603',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'Y',
  },
  {
    code: '29',
    name: 'ตรวจสุขภาพหน่วยงานภาครัฐ',
    defaultHipdata: 'OFC',
    defaultDebtorOpd: '1102050101.103',
    defaultDebtorIpd: '',
    defaultRevenueOpd: '4301020102.104',
    defaultRevenueIpd: '4301020102.104',
    defaultPaymentCode: '02',
    defaultPaymentName: 'ลูกหนี้สิทธิ',
    defaultGrouper: '6305',
    defaultRounding: 'N',
  },
];

const STANDARD_HIPDATA_OPTIONS = [
  { code: 'UCS', label: 'UCS - ประกันสุขภาพถ้วนหน้า (บัตรทอง)' },
  { code: 'OFC', label: 'OFC - ข้าราชการ กรมบัญชีกลาง' },
  { code: 'SSS', label: 'SSS - ประกันสังคม' },
  { code: 'LGO', label: 'LGO - เบิกจ่ายตรง อปท.' },
  { code: 'PTY', label: 'PTY - อปท. เมืองพัทยา' },
  { code: 'BKK', label: 'BKK - อปท. กทม.' },
  { code: 'A1', label: 'A1 - ชำระเงินเอง' },
  { code: 'A2', label: 'A2 - เบิกต้นสังกัด' },
  { code: 'A9', label: 'A9 - พรบ. กองทุนทดแทน' },
  { code: 'INS', label: 'INS - พรบ. คุ้มครองผู้ประสบภัยจากรถ' },
  { code: 'NRD', label: 'NRD - แรงงานต่างด้าว' },
  { code: 'SSI', label: 'SSI - ประกันสังคมทุพพลภาพ' },
  { code: 'STP', label: 'STP - ผู้มีปัญหาสถานะสิทธิ' },
  { code: 'SRT', label: 'SRT - การรถไฟแห่งประเทศไทย' },
  { code: 'CSH', label: 'CSH - เงินสด / ประกันชีวิต' },
];

const STANDARD_PAYMENT_TYPES = [
  { code: '02', name: 'ลูกหนี้สิทธิ', label: '02 - ลูกหนี้สิทธิ' },
  { code: '01', name: 'ชำระเองเบิกได้', label: '01 - ชำระเองเบิกได้' },
  { code: '03', name: 'ชำระเองเบิกไม่ได้', label: '03 - ชำระเองเบิกไม่ได้' },
];

const STANDARD_GROUPERS = ['6305', '5103'];

const STANDARD_ROUNDING = [
  { value: 'N', label: 'N - ไม่ปัดเศษ' },
  { value: 'Y', label: 'Y - ปัดเศษ' },
];

export function ReceivableMappingSettings() {
  const [rows, setRows] = useState<ReceivableRightMapping[]>([]);
  const [initialRowsJson, setInitialRowsJson] = useState<string>('[]');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHipdata, setFilterHipdata] = useState('ALL');
  const [filterFinance, setFilterFinance] = useState('ALL');

  // HOSxP Rights from DB
  const [hosxpRights, setHosxpRights] = useState<HosxpRightOption[]>([]);

  // Modal / Form state for Add or Clone
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'clone'>('add');
  const [formData, setFormData] = useState<ReceivableRightMapping>({
    hosxp_code: '',
    hosxp_name: '',
    hipdata_code: 'UCS',
    finance_code: '01',
    finance_name: 'UC ใน CUP',
    debtor_opd: '1102050101.201',
    debtor_ipd: '1102050101.202',
    revenue_opd: '4301020105.201',
    revenue_ipd: '4301020105.202',
    payment_type_code: '02',
    payment_type_name: 'ลูกหนี้สิทธิ',
    grouper: '6305',
    rounding: 'N',
  });

  // Load Mapping from API
  const loadMappings = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/config/receivable-mappings');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'อ่าน mapping ไม่สำเร็จ');
      const data: ReceivableRightMapping[] = Array.isArray(json.data) ? json.data : [];
      setRows(data);
      setInitialRowsJson(JSON.stringify(data));
    } catch (err: any) {
      setMessage({ text: String(err?.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล'), type: 'error' });
    } finally {
      setBusy(false);
    }
  }, []);

  // Load HOSxP Pttype Filter Options
  const loadHosxpRights = useCallback(async () => {
    try {
      const res = await fetch('/api/receivables/filter-options');
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.hosxpRights)) {
        setHosxpRights(json.data.hosxpRights);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadMappings();
    void loadHosxpRights();
  }, [loadMappings, loadHosxpRights]);

  // Is data modified?
  const isDirty = useMemo(() => {
    return JSON.stringify(rows) !== initialRowsJson;
  }, [rows, initialRowsJson]);

  // Find duplicated HOSxP codes
  const duplicateCodes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const code = (r.hosxp_code || '').trim().toUpperCase();
      if (code) counts.set(code, (counts.get(code) || 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [code, count] of counts.entries()) {
      if (count > 1) dupes.add(code);
    }
    return dupes;
  }, [rows]);

  // Distinct values for combobox / datalist options
  const uniqueHipdataList = useMemo(() => {
    const set = new Set<string>(STANDARD_HIPDATA_OPTIONS.map((o) => o.code));
    for (const r of rows) if (r.hipdata_code) set.add(r.hipdata_code.trim().toUpperCase());
    return Array.from(set).sort();
  }, [rows]);

  const uniqueDebtorOpdList = useMemo(() => {
    const set = new Set<string>(STANDARD_FINANCE_GROUPS.map((f) => f.defaultDebtorOpd).filter(Boolean));
    for (const r of rows) if (r.debtor_opd) set.add(r.debtor_opd.trim());
    return Array.from(set).sort();
  }, [rows]);

  const uniqueDebtorIpdList = useMemo(() => {
    const set = new Set<string>(STANDARD_FINANCE_GROUPS.map((f) => f.defaultDebtorIpd).filter(Boolean));
    for (const r of rows) if (r.debtor_ipd) set.add(r.debtor_ipd.trim());
    return Array.from(set).sort();
  }, [rows]);

  const uniqueRevenueOpdList = useMemo(() => {
    const set = new Set<string>(STANDARD_FINANCE_GROUPS.map((f) => f.defaultRevenueOpd).filter(Boolean));
    for (const r of rows) if (r.revenue_opd) set.add(r.revenue_opd.trim());
    return Array.from(set).sort();
  }, [rows]);

  const uniqueRevenueIpdList = useMemo(() => {
    const set = new Set<string>(STANDARD_FINANCE_GROUPS.map((f) => f.defaultRevenueIpd).filter(Boolean));
    for (const r of rows) if (r.revenue_ipd) set.add(r.revenue_ipd.trim());
    return Array.from(set).sort();
  }, [rows]);

  // Available finance group options
  const financeGroupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of STANDARD_FINANCE_GROUPS) {
      map.set(f.code, f.name);
    }
    for (const r of rows) {
      if (r.finance_code && !map.has(r.finance_code)) {
        map.set(r.finance_code, r.finance_name || r.finance_code);
      }
    }
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name, label: `${code} - ${name}` }))
      .sort((a, b) => a.code.localeCompare(b.code, 'th'));
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterHipdata !== 'ALL' && (r.hipdata_code || '').toUpperCase() !== filterHipdata) {
        return false;
      }
      if (filterFinance !== 'ALL' && (r.finance_code || '') !== filterFinance) {
        return false;
      }
      if (!q) return true;
      return (
        (r.hosxp_code || '').toLowerCase().includes(q) ||
        (r.hosxp_name || '').toLowerCase().includes(q) ||
        (r.hipdata_code || '').toLowerCase().includes(q) ||
        (r.finance_code || '').toLowerCase().includes(q) ||
        (r.finance_name || '').toLowerCase().includes(q) ||
        (r.debtor_opd || '').toLowerCase().includes(q) ||
        (r.debtor_ipd || '').toLowerCase().includes(q) ||
        (r.revenue_opd || '').toLowerCase().includes(q) ||
        (r.revenue_ipd || '').toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, filterHipdata, filterFinance]);

  // Unmapped HOSxP rights
  const unmappedHosxpRights = useMemo(() => {
    const existing = new Set(rows.map((r) => (r.hosxp_code || '').trim().toUpperCase()));
    return hosxpRights.filter((h) => !existing.has(h.code.trim().toUpperCase()));
  }, [rows, hosxpRights]);

  // Handle cell edit
  const handleUpdateRow = useCallback((index: number, key: keyof ReceivableRightMapping, value: string) => {
    setRows((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [key]: value };

        // Auto-sync finance name if finance_code changed
        if (key === 'finance_code') {
          const matchedFinance = STANDARD_FINANCE_GROUPS.find((f) => f.code === value);
          if (matchedFinance) {
            updated.finance_name = matchedFinance.name;
            if (!updated.hipdata_code) updated.hipdata_code = matchedFinance.defaultHipdata;
            if (!updated.debtor_opd) updated.debtor_opd = matchedFinance.defaultDebtorOpd;
            if (!updated.debtor_ipd) updated.debtor_ipd = matchedFinance.defaultDebtorIpd;
            if (!updated.revenue_opd) updated.revenue_opd = matchedFinance.defaultRevenueOpd;
            if (!updated.revenue_ipd) updated.revenue_ipd = matchedFinance.defaultRevenueIpd;
          }
        }

        // Auto-sync payment type name if payment_type_code changed
        if (key === 'payment_type_code') {
          const matchedPayment = STANDARD_PAYMENT_TYPES.find((p) => p.code === value);
          if (matchedPayment) {
            updated.payment_type_name = matchedPayment.name;
          }
        }

        return updated;
      })
    );
  }, []);

  // Save Mappings
  const handleSave = async () => {
    if (duplicateCodes.size > 0) {
      setMessage({
        text: `ไม่สามารถบันทึกได้: พบรหัสสิทธิ์ซ้ำ (${Array.from(duplicateCodes).join(', ')}) กรุณาแก้ไขให้ไม่ซ้ำกัน`,
        type: 'error',
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/config/receivable-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: rows }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
      setInitialRowsJson(JSON.stringify(rows));
      setMessage({
        text: `💾 บันทึกการจับคู่สิทธิ์สำเร็จเรียบร้อย (${rows.length} สิทธิ์) ระบบรายงานและการตัดลูกหนี้จะใช้การตั้งค่านี้ทันที`,
        type: 'success',
      });
    } catch (err: any) {
      setMessage({ text: err.message || 'บันทึกไม่สำเร็จ', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Open Modal for Add
  const handleOpenAdd = () => {
    setFormData({
      hosxp_code: '',
      hosxp_name: '',
      hipdata_code: 'UCS',
      finance_code: '01',
      finance_name: 'UC ใน CUP',
      debtor_opd: '1102050101.201',
      debtor_ipd: '1102050101.202',
      revenue_opd: '4301020105.201',
      revenue_ipd: '4301020105.202',
      payment_type_code: '02',
      payment_type_name: 'ลูกหนี้สิทธิ',
      grouper: '6305',
      rounding: 'N',
    });
    setModalMode('add');
    setModalOpen(true);
  };

  // Open Modal for Clone
  const handleCloneRow = (row: ReceivableRightMapping) => {
    setFormData({
      ...row,
      hosxp_code: '',
      hosxp_name: `${row.hosxp_name} (สำเนา)`,
    });
    setModalMode('clone');
    setModalOpen(true);
  };

  // Add right from modal
  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = formData.hosxp_code.trim();
    if (!code) {
      alert('กรุณาระบุรหัสสิทธิ์ HIS');
      return;
    }
    if (rows.some((r) => r.hosxp_code.trim().toUpperCase() === code.toUpperCase())) {
      alert(`รหัสสิทธิ์ "${code}" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น`);
      return;
    }

    setRows((prev) => [formData, ...prev]);
    setModalOpen(false);
    setMessage({
      text: `➕ เพิ่มสิทธิ์ "${code} - ${formData.hosxp_name}" เรียบร้อยแล้ว (อย่าลืมกด "💾 บันทึก mapping")`,
      type: 'info',
    });
  };

  // When HOSxP right is picked in modal
  const handlePickHosxpRight = (code: string) => {
    const picked = hosxpRights.find((h) => h.code === code);
    if (!picked) return;
    setFormData((prev) => ({
      ...prev,
      hosxp_code: picked.code,
      hosxp_name: picked.name,
      hipdata_code: picked.hipdata_code || prev.hipdata_code,
    }));
  };

  // When Finance Group is picked in modal
  const handlePickModalFinance = (code: string) => {
    const f = STANDARD_FINANCE_GROUPS.find((g) => g.code === code);
    if (!f) {
      setFormData((prev) => ({ ...prev, finance_code: code }));
      return;
    }
    setFormData((prev) => ({
      ...prev,
      finance_code: f.code,
      finance_name: f.name,
      hipdata_code: f.defaultHipdata || prev.hipdata_code,
      debtor_opd: f.defaultDebtorOpd,
      debtor_ipd: f.defaultDebtorIpd,
      revenue_opd: f.defaultRevenueOpd,
      revenue_ipd: f.defaultRevenueIpd,
      payment_type_code: f.defaultPaymentCode,
      payment_type_name: f.defaultPaymentName,
      grouper: f.defaultGrouper,
      rounding: f.defaultRounding,
    }));
  };

  return (
    <section className="receivable-mapping-container">
      {/* HTML5 Datalists for Combobox Accounts */}
      <datalist id="debtor-opd-options">
        {uniqueDebtorOpdList.map((acc) => (
          <option key={acc} value={acc} />
        ))}
      </datalist>
      <datalist id="debtor-ipd-options">
        {uniqueDebtorIpdList.map((acc) => (
          <option key={acc} value={acc} />
        ))}
      </datalist>
      <datalist id="revenue-opd-options">
        {uniqueRevenueOpdList.map((acc) => (
          <option key={acc} value={acc} />
        ))}
      </datalist>
      <datalist id="revenue-ipd-options">
        {uniqueRevenueIpdList.map((acc) => (
          <option key={acc} value={acc} />
        ))}
      </datalist>

      {/* Header Area */}
      <div className="receivable-mapping-header">
        <div className="receivable-mapping-title-area">
          <h3>💳 สิทธิ์และผังบัญชีลูกหนี้ของโรงพยาบาล</h3>
          <p className="receivable-mapping-description">
            กำหนดการจับคู่รหัสสิทธิ์ HIS กับกลุ่มการเงินและผังบัญชีลูกหนี้/รายได้
            เพื่อให้ระบบประมวลผลเคลม รายงานการเงิน และกระทบยอดลูกหนี้ (AR) ได้อย่างถูกต้องตรงตามหน่วยบริการ
          </p>
          <div className="receivable-mapping-stats">
            <span className="receivable-stat-pill">
              📊 ทั้งหมด <strong>{rows.length}</strong> สิทธิ์
            </span>
            {filteredRows.length !== rows.length && (
              <span className="receivable-stat-pill">
                🔍 กรองพบ <strong>{filteredRows.length}</strong> สิทธิ์
              </span>
            )}
            {unmappedHosxpRights.length > 0 && (
              <span className="receivable-stat-pill warning" title="สิทธิ์ในตาราง pttype ของ HOSxP ที่ยังไม่ได้ทำ mapping">
                ⚠️ มีสิทธิ์ HOSxP ที่ยังไม่ map <strong>{unmappedHosxpRights.length}</strong> สิทธิ์
              </span>
            )}
            {duplicateCodes.size > 0 && (
              <span className="receivable-stat-pill danger">
                ❌ พบรหัสซ้ำ {duplicateCodes.size} รายการ ({Array.from(duplicateCodes).join(', ')})
              </span>
            )}
            {isDirty && (
              <span className="receivable-stat-pill warning">
                ✏️ มีการแก้ไขที่ยังไม่บันทึก
              </span>
            )}
          </div>
        </div>

        <div className="receivable-action-buttons">
          <button type="button" className="btn-add-right" onClick={handleOpenAdd}>
            ➕ เพิ่มสิทธิ์ใหม่
          </button>
          <button
            type="button"
            className="btn-save-mapping"
            disabled={busy || !isDirty || duplicateCodes.size > 0}
            onClick={() => void handleSave()}
            title={!isDirty ? 'ข้อมูลเป็นปัจจุบันแล้ว' : duplicateCodes.size > 0 ? 'มีรหัสสิทธิ์ซ้ำ' : 'บันทึกการตั้งค่าลงระบบ'}
          >
            {busy ? '⏳ กำลังบันทึก...' : isDirty ? '💾 บันทึก mapping (มีแก้ไข)' : '✓ บันทึกแล้ว'}
          </button>
        </div>
      </div>

      {/* Status Alert Toast */}
      {message && (
        <div className={`status-toast ${message.type}`} role="status">
          {message.type === 'success' ? '✅' : message.type === 'error' ? '❌' : 'ℹ️'} {message.text}
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="receivable-mapping-controls">
        <div className="receivable-search-filters">
          <div className="receivable-search-box">
            <span className="receivable-search-icon">🔍</span>
            <input
              type="text"
              className="receivable-search-input"
              placeholder="ค้นหาตามรหัสสิทธิ์, ชื่อสิทธิ์, กลุ่มการเงิน, ผังบัญชี..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select
            className="receivable-filter-select"
            value={filterHipdata}
            onChange={(e) => setFilterHipdata(e.target.value)}
            title="กรองตามกลุ่มสิทธิ์ HIPDATA"
          >
            <option value="ALL">ทุก HIPDATA</option>
            {uniqueHipdataList.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          <select
            className="receivable-filter-select"
            value={filterFinance}
            onChange={(e) => setFilterFinance(e.target.value)}
            title="กรองตามกลุ่มการเงิน"
          >
            <option value="ALL">ทุกกลุ่มการเงิน</option>
            {financeGroupOptions.map((f) => (
              <option key={f.code} value={f.code}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table Area */}
      <div className="receivable-table-wrapper">
        <table className="receivable-table">
          <thead>
            <tr>
              <th style={{ width: 75, textAlign: 'center' }}>รหัส HIS</th>
              <th style={{ width: 190 }}>ชื่อสิทธิ์</th>
              <th style={{ width: 105 }}>HIPDATA</th>
              <th style={{ width: 220 }}>กลุ่มการเงิน</th>
              <th style={{ width: 135 }}>บัญชีลูกหนี้ OPD</th>
              <th style={{ width: 135 }}>บัญชีลูกหนี้ IPD</th>
              <th style={{ width: 135 }}>บัญชีรายได้ OPD</th>
              <th style={{ width: 135 }}>บัญชีรายได้ IPD</th>
              <th style={{ width: 155 }}>ประเภทชำระ</th>
              <th style={{ width: 90, textAlign: 'center' }}>Grouper</th>
              <th style={{ width: 100, textAlign: 'center' }}>ปัดเศษ</th>
              <th style={{ width: 80, textAlign: 'center' }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                  ไม่พบรายการสิทธิ์ที่ตรงกับคำค้นหา
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const originalIndex = rows.indexOf(row);
                const isDupe = duplicateCodes.has((row.hosxp_code || '').trim().toUpperCase());
                return (
                  <tr key={originalIndex} className={isDupe ? 'row-duplicate' : ''}>
                    {/* รหัสสิทธิ์ HIS */}
                    <td>
                      <input
                        className="cell-input code-input"
                        value={row.hosxp_code || ''}
                        maxLength={20}
                        title={isDupe ? 'รหัสนี้ซ้ำกับแถวอื่น!' : 'รหัสสิทธิ์ HIS'}
                        style={isDupe ? { borderColor: '#dc2626', background: '#fee2e2' } : {}}
                        onChange={(e) => handleUpdateRow(originalIndex, 'hosxp_code', e.target.value)}
                      />
                    </td>

                    {/* ชื่อสิทธิ์ */}
                    <td>
                      <input
                        className="cell-input"
                        value={row.hosxp_name || ''}
                        maxLength={200}
                        onChange={(e) => handleUpdateRow(originalIndex, 'hosxp_name', e.target.value)}
                      />
                    </td>

                    {/* HIPDATA (Dropdown) */}
                    <td>
                      <select
                        className="cell-select"
                        value={row.hipdata_code || ''}
                        onChange={(e) => handleUpdateRow(originalIndex, 'hipdata_code', e.target.value)}
                      >
                        <option value="">- เลือก -</option>
                        {uniqueHipdataList.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* กลุ่มการเงิน (Dropdown sync code & name) */}
                    <td>
                      <select
                        className="cell-select"
                        value={row.finance_code || ''}
                        onChange={(e) => handleUpdateRow(originalIndex, 'finance_code', e.target.value)}
                      >
                        <option value="">- เลือกกลุ่มการเงิน -</option>
                        {financeGroupOptions.map((f) => (
                          <option key={f.code} value={f.code}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* บัญชีลูกหนี้ OPD */}
                    <td>
                      <input
                        className="cell-input cell-account-input"
                        list="debtor-opd-options"
                        value={row.debtor_opd || ''}
                        placeholder="1102050101.xxx"
                        onChange={(e) => handleUpdateRow(originalIndex, 'debtor_opd', e.target.value)}
                      />
                    </td>

                    {/* บัญชีลูกหนี้ IPD */}
                    <td>
                      <input
                        className="cell-input cell-account-input"
                        list="debtor-ipd-options"
                        value={row.debtor_ipd || ''}
                        placeholder="1102050101.xxx"
                        onChange={(e) => handleUpdateRow(originalIndex, 'debtor_ipd', e.target.value)}
                      />
                    </td>

                    {/* บัญชีรายได้ OPD */}
                    <td>
                      <input
                        className="cell-input cell-account-input"
                        list="revenue-opd-options"
                        value={row.revenue_opd || ''}
                        placeholder="4301020105.xxx"
                        onChange={(e) => handleUpdateRow(originalIndex, 'revenue_opd', e.target.value)}
                      />
                    </td>

                    {/* บัญชีรายได้ IPD */}
                    <td>
                      <input
                        className="cell-input cell-account-input"
                        list="revenue-ipd-options"
                        value={row.revenue_ipd || ''}
                        placeholder="4301020105.xxx"
                        onChange={(e) => handleUpdateRow(originalIndex, 'revenue_ipd', e.target.value)}
                      />
                    </td>

                    {/* ประเภทชำระเงิน (Dropdown) */}
                    <td>
                      <select
                        className="cell-select"
                        value={row.payment_type_code || '02'}
                        onChange={(e) => handleUpdateRow(originalIndex, 'payment_type_code', e.target.value)}
                      >
                        {STANDARD_PAYMENT_TYPES.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Grouper (Dropdown) */}
                    <td>
                      <select
                        className="cell-select"
                        style={{ textAlign: 'center' }}
                        value={row.grouper || '6305'}
                        onChange={(e) => handleUpdateRow(originalIndex, 'grouper', e.target.value)}
                      >
                        {STANDARD_GROUPERS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* ปัดเศษ (Dropdown) */}
                    <td>
                      <select
                        className="cell-select"
                        style={{ textAlign: 'center' }}
                        value={row.rounding || 'N'}
                        onChange={(e) => handleUpdateRow(originalIndex, 'rounding', e.target.value)}
                      >
                        {STANDARD_ROUNDING.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* จัดการ (คัดลอก & ลบ) */}
                    <td>
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="btn-icon-action clone"
                          title="คัดลอกสิทธิ์นี้เพื่อสร้างรายการใหม่"
                          onClick={() => handleCloneRow(row)}
                        >
                          📋
                        </button>
                        <button
                          type="button"
                          className="btn-icon-action delete"
                          title="ลบสิทธิ์นี้ออกจากระบบ"
                          onClick={() => {
                            if (window.confirm(`ยืนยันลบสิทธิ์ "${row.hosxp_code} - ${row.hosxp_name}"?`)) {
                              setRows((prev) => prev.filter((_, i) => i !== originalIndex));
                            }
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: เพิ่มหรือคัดลอกสิทธิ์ใหม่ */}
      {modalOpen && (
        <div className="receivable-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="receivable-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="receivable-modal-header">
              <h4>{modalMode === 'clone' ? '📋 คัดลอกและสร้างสิทธิ์ใหม่' : '➕ เพิ่มสิทธิ์และผังบัญชีใหม่'}</h4>
              <button
                type="button"
                className="btn-icon-action"
                style={{ fontSize: '1.2rem', cursor: 'pointer' }}
                onClick={() => setModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleModalSubmit}>
              <div className="receivable-modal-body">
                {/* Section 1: สิทธิ์ HIS */}
                <div className="modal-section-box">
                  <div className="modal-section-title">🏥 1. ข้อมูลสิทธิ์ในระบบ HIS (HOSxP)</div>
                  {hosxpRights.length > 0 && (
                    <div className="modal-form-group" style={{ marginBottom: 10 }}>
                      <label>เลือกจากสิทธิ์ HOSxP (ตาราง pttype):</label>
                      <select
                        onChange={(e) => handlePickHosxpRight(e.target.value)}
                        defaultValue=""
                      >
                        <option value="">-- เลือกสิทธิ์จาก HOSxP เพื่อเติมข้อมูลอัตโนมัติ --</option>
                        {hosxpRights.map((h) => (
                          <option key={h.code} value={h.code}>
                            {h.code} - {h.name} {h.hipdata_code ? `(${h.hipdata_code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="modal-grid-2">
                    <div className="modal-form-group">
                      <label>รหัสสิทธิ์ HIS (เช่น 10, 11, A1): *</label>
                      <input
                        type="text"
                        required
                        value={formData.hosxp_code}
                        placeholder="รหัสสิทธิ์"
                        onChange={(e) => setFormData((prev) => ({ ...prev, hosxp_code: e.target.value }))}
                      />
                    </div>
                    <div className="modal-form-group">
                      <label>ชื่อสิทธิ์การรักษา: *</label>
                      <input
                        type="text"
                        required
                        value={formData.hosxp_name}
                        placeholder="ชื่อสิทธิ์ เช่น ชำระเงินเอง, บัตรทองใน CUP"
                        onChange={(e) => setFormData((prev) => ({ ...prev, hosxp_name: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: กลุ่มการเงินและ HIPDATA */}
                <div className="modal-section-box">
                  <div className="modal-section-title">📊 2. กลุ่มการเงินและ HIPDATA (เลือกครั้งเดียวเติมอัตโนมัติ)</div>
                  <div className="modal-grid-2">
                    <div className="modal-form-group">
                      <label>เลือกกลุ่มการเงิน:</label>
                      <select
                        value={formData.finance_code}
                        onChange={(e) => handlePickModalFinance(e.target.value)}
                      >
                        {financeGroupOptions.map((f) => (
                          <option key={f.code} value={f.code}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="modal-form-group">
                      <label>กลุ่มสิทธิ์ HIPDATA:</label>
                      <select
                        value={formData.hipdata_code}
                        onChange={(e) => setFormData((prev) => ({ ...prev, hipdata_code: e.target.value }))}
                      >
                        {STANDARD_HIPDATA_OPTIONS.map((h) => (
                          <option key={h.code} value={h.code}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 3: ผังบัญชี */}
                <div className="modal-section-box">
                  <div className="modal-section-title">📑 3. ผังบัญชีลูกหนี้และรายได้ (เลือกจากที่เคยใช้หรือระบุใหม่)</div>
                  <div className="modal-grid-2">
                    <div className="modal-form-group">
                      <label>บัญชีลูกหนี้ OPD:</label>
                      <input
                        list="debtor-opd-options"
                        value={formData.debtor_opd}
                        placeholder="1102050101.201"
                        onChange={(e) => setFormData((prev) => ({ ...prev, debtor_opd: e.target.value }))}
                      />
                    </div>
                    <div className="modal-form-group">
                      <label>บัญชีลูกหนี้ IPD:</label>
                      <input
                        list="debtor-ipd-options"
                        value={formData.debtor_ipd}
                        placeholder="1102050101.202"
                        onChange={(e) => setFormData((prev) => ({ ...prev, debtor_ipd: e.target.value }))}
                      />
                    </div>
                    <div className="modal-form-group">
                      <label>บัญชีรายได้ OPD:</label>
                      <input
                        list="revenue-opd-options"
                        value={formData.revenue_opd}
                        placeholder="4301020105.201"
                        onChange={(e) => setFormData((prev) => ({ ...prev, revenue_opd: e.target.value }))}
                      />
                    </div>
                    <div className="modal-form-group">
                      <label>บัญชีรายได้ IPD:</label>
                      <input
                        list="revenue-ipd-options"
                        value={formData.revenue_ipd}
                        placeholder="4301020105.202"
                        onChange={(e) => setFormData((prev) => ({ ...prev, revenue_ipd: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: ประเภทชำระเงิน, Grouper, ปัดเศษ */}
                <div className="modal-section-box">
                  <div className="modal-section-title">⚙️ 4. ประเภทชำระเงินและข้อกำหนดอื่น</div>
                  <div className="modal-grid-3">
                    <div className="modal-form-group">
                      <label>ประเภทชำระเงิน:</label>
                      <select
                        value={formData.payment_type_code}
                        onChange={(e) => {
                          const p = STANDARD_PAYMENT_TYPES.find((pt) => pt.code === e.target.value);
                          setFormData((prev) => ({
                            ...prev,
                            payment_type_code: e.target.value,
                            payment_type_name: p ? p.name : prev.payment_type_name,
                          }));
                        }}
                      >
                        {STANDARD_PAYMENT_TYPES.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="modal-form-group">
                      <label>Grouper:</label>
                      <select
                        value={formData.grouper}
                        onChange={(e) => setFormData((prev) => ({ ...prev, grouper: e.target.value }))}
                      >
                        {STANDARD_GROUPERS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="modal-form-group">
                      <label>ปัดเศษ (Rounding):</label>
                      <select
                        value={formData.rounding}
                        onChange={(e) => setFormData((prev) => ({ ...prev, rounding: e.target.value }))}
                      >
                        {STANDARD_ROUNDING.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="receivable-modal-footer">
                <button
                  type="button"
                  className="btn"
                  style={{ background: '#e2e8f0', color: '#334155' }}
                  onClick={() => setModalOpen(false)}
                >
                  ยกเลิก
                </button>
                <button type="submit" className="btn-add-right">
                  {modalMode === 'clone' ? '📋 ยืนยันคัดลอกสิทธิ์นี้' : '➕ เพิ่มสิทธิ์นี้ลงในตาราง'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
