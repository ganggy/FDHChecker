import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './PcuHerbalReconcilePage.css';

export interface HerbalMasterItem {
  id: number;
  name: string;
  size: string;
  cost: number;
  unitCost: number;
  keywords: string[];
  category?: 'herbal' | 'iron_folic';
  monthlyRateNote?: string;
}

export interface PcuHerbalSummary {
  pcu_code: string;
  pcu_name: string;
  host_ip: string;
  is_online: boolean;
  total_dispense_count: number;
  total_dispensed_qty: number;
  total_drug_cost: number;
  total_charge_amt: number;
  hsub_claim_amt: number;
  hsub_hc_drug: number;
  hsub_total_paid: number;
  triferdine_reimbursed?: number;
  folic_reimbursed?: number;
  gross_profit: number;
  payable_profit: number;
  margin_percentage: number;
  item_breakdown: Array<{
    herbal_id: number;
    herbal_name: string;
    size: string;
    cost_price: number;
    dispense_count: number;
    dispensed_qty: number;
    total_cost: number;
    total_charge: number;
    category?: string;
  }>;
}

export interface PcuHerbalResponse {
  period: { startDate: string; endDate: string };
  grand_total: {
    total_dispense_count: number;
    total_dispensed_qty: number;
    total_drug_cost: number;
    total_charge_amt: number;
    hsub_claim_amt: number;
    hsub_hc_drug: number;
    hsub_total_paid: number;
    gross_profit: number;
    payable_profit: number;
  };
  pcus: PcuHerbalSummary[];
  master_items: HerbalMasterItem[];
}

export interface DrillDownItem {
  vn: string;
  hn: string;
  vstdate: string;
  patient_name: string;
  icode: string;
  drug_name: string;
  units: string;
  qty: number;
  unit_price: number;
  sum_price: number;
  herbal_master_name: string;
  herbal_size: string;
  category?: string;
  unit_cost: number;
  total_cost: number;
  margin: number;
}

export interface DiagAuditItem {
  vn: string;
  hn: string;
  vstdate: string;
  patient_name: string;
  pcu_code: string;
  pcu_name: string;
  drug_name: string;
  qty: number;
  sum_price: number;
  pdx: string;
  all_diags: string[];
  audit_status: 'valid' | 'mismatch' | 'missing';
  indication_group: string;
  issue_reason: string;
  recommended_diags: string[];
}

export interface DiagAuditPcuBreakdown {
  pcu_code: string;
  pcu_name: string;
  total_prescriptions: number;
  valid_cnt: number;
  mismatch_cnt: number;
  missing_cnt: number;
  error_rate_pct: number;
  at_risk_value_baht: number;
}

export interface DiagAuditResponse {
  period: { startDate: string; endDate: string };
  summary: {
    total_prescriptions: number;
    valid_cnt: number;
    mismatch_cnt: number;
    missing_cnt: number;
    error_rate_pct: number;
    at_risk_value_baht: number;
    pcu_breakdown: DiagAuditPcuBreakdown[];
  };
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  items: DiagAuditItem[];
}

export interface PcuConfigItem {
  code: string;
  name: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  db: string;
  vpnNote?: string;
}

export interface PcuTestStatus {
  code: string;
  name: string;
  host: string;
  port: number;
  db: string;
  user: string;
  connected: boolean;
  latencyMs?: number;
  error?: string;
  diagnostics?: string;
}

export const TRIFERDINE_PCU_ALLOCATION = [
  { code: '05569', name: 'รพ.สต.บ้านห้วยหีบรุ่งอรุณ', amt: 45760.00 },
  { code: '05571', name: 'รพ.สต.บ้านม่วงไข่น้อย', amt: 27040.00 },
  { code: '05572', name: 'รพ.สต.บ้านโคกนาดี', amt: 195920.00 },
  { code: '05573', name: 'รพ.สต.บ้านโพนทองวัฒนา', amt: 21360.00 },
  { code: '05570', name: 'รพ.สต.บ้านโพนค้อ', amt: 0.00 },
];

export const TRIFERDINE_MONTHLY_TIERS = [
  { month: 'ก.ย. 69 (2026-09)', priceBox: 38.52, priceTab: 1.2840 },
  { month: 'ส.ค. 69 (2026-08)', priceBox: 38.52, priceTab: 1.2840 },
  { month: 'ก.ค. 69 (2026-07)', priceBox: 38.52, priceTab: 1.2840 },
  { month: 'ต.ค. 68 – มิ.ย. 69 (9 เดือน)', priceBox: 26.75, priceTab: 0.89167 },
];

export const PcuHerbalReconcilePage: React.FC = () => {
  const [data, setData] = useState<PcuHerbalResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedHcode, setSelectedHcode] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'herbal' | 'iron_folic'>('all');
  const [startDate, setStartDate] = useState<string>('2025-10-01');
  const [endDate, setEndDate] = useState<string>('2026-10-31');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Active Tab: 'summary' | 'master_items' | 'diag_audit' | 'rates_info'
  const [activeTab, setActiveTab] = useState<'summary' | 'master_items' | 'diag_audit' | 'rates_info'>('summary');

  // Diagnosis Audit State
  const [auditData, setAuditData] = useState<DiagAuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);
  const [auditHcode, setAuditHcode] = useState<string>('all');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'all' | 'mismatch' | 'missing' | 'valid'>('mismatch');
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [auditPage, setAuditPage] = useState<number>(1);
  const [exportingAudit, setExportingAudit] = useState<boolean>(false);

  // Connection status testing
  const [testingConn, setTestingConn] = useState<boolean>(false);
  const [connStatus, setConnStatus] = useState<PcuTestStatus[] | null>(null);

  // Config Modal State
  const [configModalOpen, setConfigModalOpen] = useState<boolean>(false);
  const [pcuConfigs, setPcuConfigs] = useState<PcuConfigItem[]>([]);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, PcuTestStatus>>({});
  const [testingCode, setTestingCode] = useState<string | null>(null);
  const [testingAllConfigs, setTestingAllConfigs] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);

  // Drill down modal state
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalTitle, setModalTitle] = useState<string>('');
  const [modalHcode, setModalHcode] = useState<string>('05570');
  const [modalHerbalId, setModalHerbalId] = useState<number | undefined>(undefined);
  const [modalSearch, setModalSearch] = useState<string>('');
  const [modalPage, setModalPage] = useState<number>(1);
  const [modalLoading, setModalLoading] = useState<boolean>(false);
  const [modalData, setModalData] = useState<{ total: number; totalPages: number; items: DrillDownItem[] } | null>(null);

  // Load summary data
  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        category: selectedCategory,
      });
      if (selectedHcode !== 'all') {
        params.append('hcode', selectedHcode);
      }
      const res = await fetch(`/api/pcu-herbal/summary?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูลสรุปจ่ายยาได้');
      }
      setData(json.data);
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedHcode, selectedCategory]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Load diagnosis audit data
  const loadDiagAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        status: auditStatusFilter,
        search: auditSearch,
        page: String(auditPage),
        limit: '50',
      });
      if (auditHcode !== 'all') {
        params.append('hcode', auditHcode);
      }
      const res = await fetch(`/api/pcu-herbal/diag-audit?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setAuditData(json.data);
      }
    } catch (err) {
      console.error('Error fetching diag audit:', err);
    } finally {
      setAuditLoading(false);
    }
  }, [startDate, endDate, auditHcode, auditStatusFilter, auditSearch, auditPage]);

  useEffect(() => {
    if (activeTab === 'diag_audit') {
      loadDiagAudit();
    }
  }, [activeTab, loadDiagAudit]);

  // Test connections from header
  const handleTestConnections = async () => {
    setTestingConn(true);
    try {
      const res = await fetch('/api/pcu-herbal/test-connections', { method: 'POST' });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setConnStatus(json.data);
      }
    } catch (err) {
      console.error('Error testing connections:', err);
    } finally {
      setTestingConn(false);
    }
  };

  // Open config modal
  const openConfigModal = async () => {
    try {
      const res = await fetch('/api/pcu-herbal/config');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setPcuConfigs(json.data);
      }
    } catch {
      // ignore
    }
    setConfigModalOpen(true);
  };

  // Reset config to defaults
  const handleResetDefaults = async () => {
    try {
      const res = await fetch('/api/pcu-herbal/config');
      const json = await res.json();
      if (json.success && Array.isArray(json.defaults)) {
        setPcuConfigs(json.defaults);
      }
    } catch {
      // ignore
    }
  };

  // Test single PCU
  const handleTestSingle = async (pcu: PcuConfigItem) => {
    setTestingCode(pcu.code);
    try {
      const res = await fetch('/api/pcu-herbal/test-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pcu),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setTestResults(prev => ({ ...prev, [pcu.code]: json.data }));
      }
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [pcu.code]: {
          code: pcu.code,
          name: pcu.name,
          host: pcu.host,
          port: pcu.port,
          db: pcu.db,
          user: pcu.user,
          connected: false,
          diagnostics: 'เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message,
        },
      }));
    } finally {
      setTestingCode(null);
    }
  };

  // Test all configs
  const handleTestAllConfigs = async () => {
    setTestingAllConfigs(true);
    try {
      const res = await fetch('/api/pcu-herbal/test-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs: pcuConfigs }),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const map: Record<string, PcuTestStatus> = {};
        json.data.forEach((item: PcuTestStatus) => {
          map[item.code] = item;
        });
        setTestResults(map);
      }
    } finally {
      setTestingAllConfigs(false);
    }
  };

  // Save configs
  const handleSaveConfigs = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch('/api/pcu-herbal/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs: pcuConfigs }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'บันทึกการตั้งค่าไม่สำเร็จ');
      }
      setConfigModalOpen(false);
      loadSummary();
    } catch (err: any) {
      alert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  // Load modal drill-down data
  const loadDrillDown = useCallback(async (hcode: string, herbalId?: number, search = '', page = 1) => {
    setModalLoading(true);
    try {
      const params = new URLSearchParams({
        hcode,
        startDate,
        endDate,
        category: selectedCategory,
        page: String(page),
        limit: '50',
      });
      if (herbalId) params.append('herbalId', String(herbalId));
      if (search) params.append('search', search);

      const res = await fetch(`/api/pcu-herbal/drill-down?${params.toString()}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setModalData(json.data);
      }
    } catch (err) {
      console.error('Error loading drill down:', err);
    } finally {
      setModalLoading(false);
    }
  }, [startDate, endDate, selectedCategory]);

  const openDrillDown = (hcode: string, title: string, herbalId?: number) => {
    setModalHcode(hcode);
    setModalHerbalId(herbalId);
    setModalTitle(title);
    setModalSearch('');
    setModalPage(1);
    setModalOpen(true);
    loadDrillDown(hcode, herbalId, '', 1);
  };

  const handleModalSearchChange = (val: string) => {
    setModalSearch(val);
    setModalPage(1);
    loadDrillDown(modalHcode, modalHerbalId, val, 1);
  };

  const handleModalPageChange = (newPage: number) => {
    setModalPage(newPage);
    loadDrillDown(modalHcode, modalHerbalId, modalSearch, newPage);
  };

  // Filter 46 items
  const filteredMasterItems = useMemo(() => {
    if (!data?.master_items) return [];
    if (!searchTerm.trim()) return data.master_items;
    const term = searchTerm.toLowerCase().trim();
    return data.master_items.filter(item =>
      item.name.toLowerCase().includes(term) ||
      String(item.id).includes(term) ||
      item.size.toLowerCase().includes(term)
    );
  }, [data?.master_items, searchTerm]);

  // Aggregate master item stats across all or selected PCUs
  const masterItemAggregates = useMemo(() => {
    if (!data?.pcus || !data?.master_items) return new Map<number, { qty: number; cost: number; charge: number; count: number }>();
    const map = new Map<number, { qty: number; cost: number; charge: number; count: number }>();

    for (const item of data.master_items) {
      map.set(item.id, { qty: 0, cost: 0, charge: 0, count: 0 });
    }

    const pcusToUse = selectedHcode === 'all'
      ? data.pcus
      : data.pcus.filter(p => p.pcu_code === selectedHcode);

    for (const pcu of pcusToUse) {
      for (const breakdown of pcu.item_breakdown) {
        const current = map.get(breakdown.herbal_id) || { qty: 0, cost: 0, charge: 0, count: 0 };
        current.qty += breakdown.dispensed_qty;
        current.cost += breakdown.total_cost;
        current.charge += breakdown.total_charge;
        current.count += breakdown.dispense_count;
        map.set(breakdown.herbal_id, current);
      }
    }
    return map;
  }, [data?.pcus, data?.master_items, selectedHcode]);

  // Export to Excel
  const handleExportExcel = () => {
    if (!data) return;

    // Sheet 1: PCU Summary
    const pcuSheetData = data.pcus.map(p => ({
      'รหัส รพ.สต.': p.pcu_code,
      'ชื่อหน่วยบริการ': p.pcu_name,
      'IP Host': p.host_ip,
      'สถานะเชื่อมต่อ': p.is_online ? 'ออนไลน์' : 'ออฟไลน์',
      'จำนวนครั้งจ่ายยา': p.total_dispense_count,
      'ปริมาณยาที่จ่าย (หน่วย)': p.total_dispensed_qty,
      'ยอดต้นทุนค่ายา (บาท)': p.total_drug_cost,
      'ยอดเรียกเก็บ รพ.สต. (บาท)': p.total_charge_amt,
      'ยอดส่งเบิก สปสช. (บาท)': p.hsub_claim_amt,
      'ยอดชดเชยสมุนไพร สปสช. (บาท)': p.hsub_hc_drug,
      'ยอดชดเชย Triferdine (บาท)': p.triferdine_reimbursed || 0,
      'ยอดชดเชย Folic Acid (บาท)': p.folic_reimbursed || 0,
      'ยอดชดเชยรวมทั้งหมด (บาท)': p.hsub_total_paid,
      'กำไรส่วนต่าง (บาท)': p.gross_profit,
      'ส่วนแบ่งกำไรพึงจ่าย รพ.สต. (บาท)': p.payable_profit,
      'อัตรากำไร (%)': p.margin_percentage,
    }));

    // Sheet 2: Master Items
    const masterSheetData = data.master_items.map(m => {
      const agg = masterItemAggregates.get(m.id) || { qty: 0, cost: 0, charge: 0, count: 0 };
      return {
        'ลำดับ': m.id,
        'หมวดหมู่': m.category === 'iron_folic' ? 'Triferdine & Folic Acid' : 'เวชภัณฑ์สมุนไพร 46 รายการ',
        'รายการยา': m.name,
        'ขนาดบรรจุ': m.size,
        'ราคาต้นทุนมาตรฐาน (บาท)': m.cost,
        'ต้นทุนต่อหน่วย (บาท)': m.unitCost,
        'จำนวนจ่ายจริง (หน่วย)': agg.qty,
        'รวมต้นทุนจ่ายยา (บาท)': Math.round(agg.cost * 100) / 100,
        'ยอดเรียกเก็บ รพ.สต. (บาท)': Math.round(agg.charge * 100) / 100,
        'ส่วนต่างกำไรประมาณการ (บาท)': Math.round((agg.charge - agg.cost) * 100) / 100,
        'หมายเหตุอัตรา/เงื่อนไข': m.monthlyRateNote || '-',
      };
    });

    // Sheet 3: เกณฑ์จัดสรร Triferdine
    const triferdineSheetData = TRIFERDINE_PCU_ALLOCATION.map(item => ({
      'รหัส รพ.สต.': item.code,
      'ชื่อ รพ.สต.': item.name,
      'ยอดชดเชยจัดสรร Triferdine (บาท)': item.amt,
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(pcuSheetData);
    const ws2 = XLSX.utils.json_to_sheet(masterSheetData);
    const ws3 = XLSX.utils.json_to_sheet(triferdineSheetData);
    XLSX.utils.book_append_sheet(wb, ws1, 'สรุปจัดสรรกำไร 5 รพ.สต.');
    XLSX.utils.book_append_sheet(wb, ws2, 'รายการยาและเวชภัณฑ์');
    XLSX.utils.book_append_sheet(wb, ws3, 'เกณฑ์ชดเชย Triferdine');

    XLSX.writeFile(wb, `PCU_Drug_Profit_Reconciliation_${selectedCategory}_${startDate}_to_${endDate}.xlsx`);
  };

  // Export Diag Audit to Excel
  const handleExportAuditExcel = async () => {
    setExportingAudit(true);
    try {
      let exportItems = auditData?.items || [];
      try {
        const params = new URLSearchParams({
          startDate,
          endDate,
          status: auditStatusFilter,
          search: auditSearch,
          page: '1',
          limit: '10000',
        });
        if (auditHcode !== 'all') {
          params.append('hcode', auditHcode);
        }
        const res = await fetch(`/api/pcu-herbal/diag-audit?${params.toString()}`);
        const json = await res.json();
        if (json.success && json.data.items) {
          exportItems = json.data.items;
        }
      } catch (err) {
        console.warn('Fallback to current page items for export', err);
      }

      const rows = exportItems.map((item, idx) => ({
        'ลำดับ': idx + 1,
        'วันที่รับบริการ': item.vstdate,
        'รหัส รพ.สต.': item.pcu_code,
        'ชื่อ รพ.สต.': item.pcu_name,
        'VN': item.vn,
        'HN': item.hn,
        'ชื่อ-สกุล ผู้ป่วย': item.patient_name,
        'รายการยา': item.drug_name,
        'จำนวนที่จ่าย': item.qty,
        'มูลค่า (บาท)': item.sum_price,
        'PDX (รหัสโรคหลัก)': item.pdx,
        'รหัสโรคทั้งหมด': item.all_diags.join(', '),
        'สถานะการตรวจ': item.audit_status === 'valid' ? 'ถูกต้อง' : item.audit_status === 'mismatch' ? 'ยาไม่สัมพันธ์กับโรค (เสี่ยงติด C / ชดเชย 0 บาท)' : 'ไม่ระบุรหัสโรค/มีแต่รหัสตรวจสุขภาพ',
        'กลุ่มข้อบ่งใช้ยา': item.indication_group,
        'ปัญหา/สาเหตุ': item.issue_reason,
        'รหัส ICD-10 แนะนำให้แก้ไข': item.recommended_diags.join(', '),
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'ผลตรวจวินิจฉัยยาสมุนไพร');
      XLSX.writeFile(wb, `PCU_Herbal_Diag_Audit_${auditHcode}_${auditStatusFilter}_${startDate}_to_${endDate}.xlsx`);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExportingAudit(false);
    }
  };


  return (
    <div className="pcu-herbal-page">
      {/* Header */}
      <div className="pcu-herbal-header">
        <div className="pcu-herbal-title-group">
          <h1>
            <span>🌿</span> ตรวจสอบการจ่ายยา & จัดสรรกำไร รพ.สต. (สมุนไพร, Triferdine & Folic)
          </h1>
          <p>
            เชื่อมต่อฐานข้อมูล HOSxP PCU ทั้ง 5 แห่ง ตรวจสอบยอดจ่ายยาสมุนไพร 46 รายการ และ Triferdine/Folic Acid เทียบกับยอดชดเชยเพื่อคำนวณส่วนแบ่งกำไรที่ต้องจ่าย รพ.สต.
          </p>
        </div>
        <div className="pcu-herbal-actions">
          <button
            className="btn-herbal"
            style={{ background: '#0284c7', color: '#ffffff' }}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'pcuCaseCost' } }));
            }}
            title="ไปที่หน้าดูจำนวน Case และราคาทุนการจ่ายยาแยกตาม รพ.สต."
          >
            📦 ดู Case & ราคาทุน รพ.สต.
          </button>
          <button
            className="btn-herbal"
            style={{ background: '#7c3aed', color: '#ffffff' }}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'pcuPayout' } }));
            }}
            title="ไปที่หน้าคำนวณและจำลองการสั่งจ่ายเงินให้ รพ.สต. โดยหักต้นทุนคราวๆ"
          >
            💳 คำนวณจ่ายเงิน รพ.สต.
          </button>
          <button
            className="btn-herbal btn-config-herbal"
            onClick={openConfigModal}
            title="ตั้งค่า Host, IP, Database, Username และ Password ของ รพ.สต. ทั้ง 5 แห่ง"
          >
            ⚙️ ตั้งค่าการเชื่อมต่อ รพ.สต.
          </button>
          <button
            className="btn-herbal btn-secondary-herbal"
            onClick={handleTestConnections}
            disabled={testingConn}
          >
            {testingConn ? '🔄 กำลังทดสอบ...' : '⚡ ทดสอบเชื่อมต่อ 5 รพ.สต.'}
          </button>
          <button
            className="btn-herbal btn-export-herbal"
            onClick={handleExportExcel}
            disabled={!data}
          >
            📊 ส่งออก Excel
          </button>
        </div>
      </div>

      {/* Filter Card */}
      <div className="pcu-herbal-filters-card">
        <div className="filter-item">
          <label>เลือก รพ.สต.</label>
          <select value={selectedHcode} onChange={(e) => setSelectedHcode(e.target.value)}>
            <option value="all">🏢 ทั้งหมด (5 รพ.สต.)</option>
            <option value="05570">05570 รพ.สต.โพนค้อ (hospcu05570)</option>
            <option value="05572">05572 รพ.สต.โคกนาดี (hospcu05572)</option>
            <option value="05573">05573 รพ.สต.โพนทอง (hospcu05573)</option>
            <option value="05571">05571 รพ.สต.ม่วงไข่ (hospcu05571)</option>
            <option value="05569">05569 รพ.สต.ห้วยหีบ (hospcu05569)</option>
          </select>
        </div>
        <div className="filter-item">
          <label>วันที่เริ่มต้น</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="filter-item">
          <label>วันที่สิ้นสุด</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="filter-item" style={{ alignSelf: 'flex-end' }}>
          <button className="btn-herbal btn-primary-herbal" onClick={loadSummary} disabled={loading}>
            {loading ? '⏳ กำลังประมวลผล...' : '🔍 ประมวลผลข้อมูล'}
          </button>
        </div>
      </div>

      {/* Category Filter Switcher */}
      <div className="category-switcher-group">
        <button
          className={`category-btn ${selectedCategory === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('all')}
        >
          📊 รวมทุกหมวดหมู่ (สมุนไพร 46 รายการ + Triferdine + Folic)
        </button>
        <button
          className={`category-btn ${selectedCategory === 'herbal' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('herbal')}
        >
          🌿 ยาสมุนไพร 46 รายการ (H-Sub)
        </button>
        <button
          className={`category-btn ${selectedCategory === 'iron_folic' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('iron_folic')}
        >
          💊 Triferdine 150 mg & Folic Acid
        </button>
      </div>

      {/* PCU Connection Status Pills */}
      <div className="pcu-status-bar">
        {(connStatus || (data?.pcus.map(p => ({
          code: p.pcu_code,
          name: p.pcu_name,
          host: p.host_ip,
          port: 3306,
          db: `hospcu${p.pcu_code}`,
          user: 'root',
          connected: p.is_online,
          diagnostics: p.is_online ? 'ออนไลน์' : 'ออฟไลน์ (คลิกเพื่อดูรายละเอียดและตั้งค่าการเชื่อมต่อ)',
        })) || [])).map(s => (
          <div
            key={s.code}
            className="pcu-status-pill"
            style={{ cursor: 'pointer' }}
            onClick={openConfigModal}
            title={s.diagnostics || (s.connected ? 'ออนไลน์' : 'ออฟไลน์ — คลิกเพื่อเปิดหน้าต่างตั้งค่าและทดสอบ')}
          >
            <span className={`status-dot ${s.connected ? 'online' : 'offline'}`} />
            <strong>{s.code}</strong> {s.name} ({s.host}): {s.connected ? 'Online' : 'Offline'}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '1rem', background: '#fee2e2', border: '1px solid #f87171', borderRadius: '0.5rem', color: '#b91c1c', marginBottom: '1.5rem' }}>
          ⚠️ <strong>ข้อผิดพลาด:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="loading-box">
          <div className="spinner" />
          <p>กำลังเชื่อมต่อฐานข้อมูล HOSxP PCU ทั้ง 5 แห่ง และคำนวณยอดเงิน กรุณารอสักครู่...</p>
        </div>
      ) : data ? (
        <>
          {/* Top KPI Cards */}
          <div className="kpi-cards-grid">
            <div className="kpi-card blue">
              <div className="kpi-card-header">
                <span className="kpi-card-title">
                  {selectedCategory === 'iron_folic'
                    ? 'จำนวนครั้งจ่ายยา Triferdine & Folic'
                    : selectedCategory === 'herbal'
                      ? 'จำนวนครั้งจ่ายยาสมุนไพร'
                      : 'จำนวนครั้งจ่ายยารวมทั้งหมด'}
                </span>
                <span className="kpi-card-icon">💊</span>
              </div>
              <div className="kpi-card-value">
                {data.grand_total.total_dispense_count.toLocaleString()} ครั้ง
              </div>
              <div className="kpi-card-sub">
                ปริมาณรวม: {data.grand_total.total_dispensed_qty.toLocaleString()} หน่วย
              </div>
            </div>

            <div className="kpi-card amber">
              <div className="kpi-card-header">
                <span className="kpi-card-title">
                  {selectedCategory === 'iron_folic'
                    ? 'ต้นทุนยา Triferdine & Folic'
                    : selectedCategory === 'herbal'
                      ? 'ต้นทุนค่ายา (46 รายการ)'
                      : 'รวมต้นทุนค่ายาทั้งหมด'}
                </span>
                <span className="kpi-card-icon">🏷️</span>
              </div>
              <div className="kpi-card-value">
                {data.grand_total.total_drug_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
              </div>
              <div className="kpi-card-sub">
                ยอดเรียกเก็บ รพ.สต.: {data.grand_total.total_charge_amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
              </div>
            </div>

            <div className="kpi-card purple">
              <div className="kpi-card-header">
                <span className="kpi-card-title">
                  {selectedCategory === 'iron_folic'
                    ? 'ยอดชดเชยรวม (Triferdine + Folic)'
                    : selectedCategory === 'herbal'
                      ? 'ยอดชดเชยที่ได้รับ (H-Sub)'
                      : 'รวมยอดชดเชยทั้งหมด'}
                </span>
                <span className="kpi-card-icon">💰</span>
              </div>
              <div className="kpi-card-value">
                {data.grand_total.hsub_total_paid.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
              </div>
              <div className="kpi-card-sub">
                {selectedCategory === 'iron_folic'
                  ? 'Triferdine คงที่ 290,080฿ + Folic 80฿/คอร์ส'
                  : selectedCategory === 'herbal'
                    ? `สมุนไพรเฉพาะ: ${data.grand_total.hsub_hc_drug.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`
                    : 'รวม H-Sub + Triferdine + Folic Acid'}
              </div>
            </div>

            <div className="kpi-card green">
              <div className="kpi-card-header">
                <span className="kpi-card-title">กำไรส่วนต่างสุทธิ</span>
                <span className="kpi-card-icon">📈</span>
              </div>
              <div className="kpi-card-value profit-text">
                +{data.grand_total.gross_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
              </div>
              <div className="kpi-card-sub">
                อัตรากำไร: {data.grand_total.hsub_total_paid > 0 ? ((data.grand_total.gross_profit / data.grand_total.hsub_total_paid) * 100).toFixed(1) : 0}%
              </div>
            </div>

            <div className="kpi-card emerald">
              <div className="kpi-card-header">
                <span className="kpi-card-title">ยอดจัดสรรพึงจ่าย รพ.สต.</span>
                <span className="kpi-card-icon">🤝</span>
              </div>
              <div className="kpi-card-value profit-text">
                {data.grand_total.payable_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
              </div>
              <div className="kpi-card-sub">
                ส่วนแบ่งกำไรที่ต้องโอนให้ 5 รพ.สต.
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="pcu-herbal-tabs">
            <button
              className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              🏢 สรุปจัดสรรกำไร 5 รพ.สต.
            </button>
            <button
              className={`tab-btn ${activeTab === 'master_items' ? 'active' : ''}`}
              onClick={() => setActiveTab('master_items')}
            >
              📋 รายการยาและเวชภัณฑ์ ({filteredMasterItems.length} รายการ)
            </button>
            <button
              className={`tab-btn ${activeTab === 'rates_info' ? 'active' : ''}`}
              onClick={() => setActiveTab('rates_info')}
            >
              ℹ️ เกณฑ์ชดเชย Triferdine & Folic
            </button>
            <button
              className={`tab-btn ${activeTab === 'diag_audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('diag_audit')}
            >
              🔍 ตรวจสอบ Diag ผิด & ยาไม่สัมพันธ์กับโรค
            </button>
          </div>

          {/* TAB 1: Summary By PCU */}
          {activeTab === 'summary' && (
            <div className="pcu-table-card">
              <div className="pcu-table-card-header">
                <h3 className="pcu-table-card-title">
                  <span>🏢</span> ตารางเปรียบเทียบยอดจ่ายยา ต้นทุน และส่วนแบ่งกำไรราย รพ.สต.
                </h3>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  ฐานข้อมูลระบบ: HOSxP PCU (`hospcu055xx`) & อัตราชดเชยจัดสรร
                </span>
              </div>
              <div className="pcu-table-responsive">
                <table className="pcu-table">
                  <thead>
                    <tr>
                      <th>รหัส</th>
                      <th>ชื่อ รพ.สต.</th>
                      <th>ฐานข้อมูล</th>
                      <th className="text-right">ครั้งที่จ่าย</th>
                      <th className="text-right">ปริมาณยา (หน่วย)</th>
                      <th className="text-right">ต้นทุนค่ายา</th>
                      {selectedCategory === 'iron_folic' ? (
                        <>
                          <th className="text-right">ชดเชย Triferdine</th>
                          <th className="text-right">ชดเชย Folic (80฿/คอร์ส)</th>
                          <th className="text-right">รวมยอดชดเชย</th>
                        </>
                      ) : selectedCategory === 'all' ? (
                        <>
                          <th className="text-right">ชดเชยสมุนไพร</th>
                          <th className="text-right">ชดเชย Triferdine</th>
                          <th className="text-right">ชดเชย Folic</th>
                          <th className="text-right">รวมยอดชดเชย</th>
                        </>
                      ) : (
                        <th className="text-right">ยอดชดเชย สปสช. (H-Sub)</th>
                      )}
                      <th className="text-right">กำไรส่วนต่าง</th>
                      <th className="text-right">ยอดพึงจ่าย รพ.สต.</th>
                      <th className="text-center">อัตรากำไร</th>
                      <th className="text-center">ดูรายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pcus.map((pcu) => (
                      <tr key={pcu.pcu_code}>
                        <td>
                          <span className="badge-pcu">{pcu.pcu_code}</span>
                        </td>
                        <td>
                          <strong>{pcu.pcu_name}</strong>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>IP: {pcu.host_ip}</div>
                        </td>
                        <td>
                          <code style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                            hospcu{pcu.pcu_code}
                          </code>
                        </td>
                        <td className="text-right">{pcu.total_dispense_count.toLocaleString()}</td>
                        <td className="text-right">{pcu.total_dispensed_qty.toLocaleString()}</td>
                        <td className="text-right">{pcu.total_drug_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</td>
                        {selectedCategory === 'iron_folic' ? (
                          <>
                            <td className="text-right" style={{ color: '#4338ca' }}>
                              {(pcu.triferdine_reimbursed || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                            <td className="text-right" style={{ color: '#0891b2' }}>
                              {(pcu.folic_reimbursed || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                            <td className="text-right" style={{ color: '#2563eb', fontWeight: 600 }}>
                              {pcu.hsub_total_paid.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                          </>
                        ) : selectedCategory === 'all' ? (
                          <>
                            <td className="text-right">
                              {(pcu.hsub_claim_amt + pcu.hsub_hc_drug).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                            <td className="text-right" style={{ color: '#4338ca' }}>
                              {(pcu.triferdine_reimbursed || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                            <td className="text-right" style={{ color: '#0891b2' }}>
                              {(pcu.folic_reimbursed || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                            <td className="text-right" style={{ color: '#2563eb', fontWeight: 600 }}>
                              {pcu.hsub_total_paid.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                            </td>
                          </>
                        ) : (
                          <td className="text-right" style={{ color: '#2563eb', fontWeight: 600 }}>
                            {pcu.hsub_total_paid.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                        )}
                        <td className="text-right profit-text">
                          +{pcu.gross_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                        </td>
                        <td className="text-right" style={{ color: '#059669', fontWeight: 700, fontSize: '0.95rem' }}>
                          {pcu.payable_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                        </td>
                        <td className="text-center">
                          <span style={{ padding: '0.2rem 0.5rem', background: '#dcfce7', color: '#15803d', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                            {pcu.margin_percentage}%
                          </span>
                        </td>
                        <td className="text-center">
                          <button
                            className="btn-detail"
                            onClick={() => openDrillDown(pcu.pcu_code, `${pcu.pcu_name} (${pcu.pcu_code})`)}
                          >
                            🔎 เจาะลึกคนไข้
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
                      <td colSpan={3}>รวมทั้งหมด 5 รพ.สต.</td>
                      <td className="text-right">{data.grand_total.total_dispense_count.toLocaleString()}</td>
                      <td className="text-right">{data.grand_total.total_dispensed_qty.toLocaleString()}</td>
                      <td className="text-right">{data.grand_total.total_drug_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</td>
                      {selectedCategory === 'iron_folic' ? (
                        <>
                          <td className="text-right" style={{ color: '#4338ca' }}>
                            {data.pcus.reduce((a, b) => a + (b.triferdine_reimbursed || 0), 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                          <td className="text-right" style={{ color: '#0891b2' }}>
                            {data.pcus.reduce((a, b) => a + (b.folic_reimbursed || 0), 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                          <td className="text-right" style={{ color: '#2563eb' }}>
                            {data.grand_total.hsub_total_paid.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                        </>
                      ) : selectedCategory === 'all' ? (
                        <>
                          <td className="text-right">
                            {data.grand_total.hsub_claim_amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                          <td className="text-right" style={{ color: '#4338ca' }}>
                            {data.pcus.reduce((a, b) => a + (b.triferdine_reimbursed || 0), 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                          <td className="text-right" style={{ color: '#0891b2' }}>
                            {data.pcus.reduce((a, b) => a + (b.folic_reimbursed || 0), 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                          <td className="text-right" style={{ color: '#2563eb' }}>
                            {data.grand_total.hsub_total_paid.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                        </>
                      ) : (
                        <td className="text-right" style={{ color: '#2563eb' }}>{data.grand_total.hsub_total_paid.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</td>
                      )}
                      <td className="text-right profit-text">+{data.grand_total.gross_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</td>
                      <td className="text-right" style={{ color: '#059669', fontSize: '1rem' }}>{data.grand_total.payable_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</td>
                      <td className="text-center">
                        <span style={{ padding: '0.2rem 0.5rem', background: '#dcfce7', color: '#15803d', borderRadius: '9999px', fontSize: '0.75rem' }}>
                          {data.grand_total.hsub_total_paid > 0 ? ((data.grand_total.gross_profit / data.grand_total.hsub_total_paid) * 100).toFixed(1) : 0}%
                        </span>
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Master Items Catalog */}
          {activeTab === 'master_items' && (
            <div className="pcu-table-card">
              <div className="pcu-table-card-header">
                <h3 className="pcu-table-card-title">
                  <span>📋</span> รายการยาและเวชภัณฑ์ (ราคาต้นทุนมาตรฐาน & ยอดจ่ายจริง)
                </h3>
                <div>
                  <input
                    type="text"
                    placeholder="🔎 ค้นหาชื่อยา หรือลำดับ..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ padding: '0.4rem 0.8rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.85rem', width: '220px' }}
                  />
                </div>
              </div>
              <div className="pcu-table-responsive">
                <table className="pcu-table">
                  <thead>
                    <tr>
                      <th className="text-center" style={{ width: '50px' }}>ลำดับ</th>
                      <th>หมวดหมู่</th>
                      <th>รายการยา</th>
                      <th>ขนาดบรรจุ</th>
                      <th className="text-right">ราคาต้นทุน (บาท)</th>
                      <th className="text-right">ต้นทุน/หน่วย (บาท)</th>
                      <th className="text-right">จำนวนที่จ่ายจริง</th>
                      <th className="text-right">รวมต้นทุนจ่ายยา</th>
                      <th className="text-right">ยอดเรียกเก็บ รพ.สต.</th>
                      <th className="text-right">ส่วนต่างกำไรประมาณการ</th>
                      <th className="text-center">ดูประวัติการจ่าย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMasterItems.map((item) => {
                      const agg = masterItemAggregates.get(item.id) || { qty: 0, cost: 0, charge: 0, count: 0 };
                      const margin = agg.charge - agg.cost;
                      return (
                        <tr key={item.id}>
                          <td className="text-center font-bold" style={{ color: '#64748b' }}>{item.id}</td>
                          <td>
                            <span className={`category-badge-pill ${item.category || 'herbal'}`}>
                              {item.category === 'iron_folic' ? '💊 เหล็ก & โฟลิก' : '🌿 สมุนไพร'}
                            </span>
                          </td>
                          <td>
                            <strong>{item.name}</strong>
                            {item.monthlyRateNote && (
                              <div style={{ fontSize: '0.75rem', color: '#6366f1', marginTop: '2px' }}>
                                ℹ️ {item.monthlyRateNote}
                              </div>
                            )}
                          </td>
                          <td>
                            <span style={{ background: '#f1f5f9', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                              {item.size}
                            </span>
                          </td>
                          <td className="text-right">{item.cost.toFixed(2)} ฿</td>
                          <td className="text-right" style={{ color: '#64748b' }}>{item.unitCost.toFixed(3)} ฿</td>
                          <td className="text-right" style={{ fontWeight: 600 }}>
                            {agg.qty > 0 ? (
                              <span>{agg.qty.toLocaleString()}</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>0</span>
                            )}
                          </td>
                          <td className="text-right">
                            {agg.cost > 0 ? (
                              <span>{agg.cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>0.00 ฿</span>
                            )}
                          </td>
                          <td className="text-right">
                            {agg.charge > 0 ? (
                              <span>{agg.charge.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>0.00 ฿</span>
                            )}
                          </td>
                          <td className="text-right">
                            {margin > 0 ? (
                              <span className="profit-text">+{margin.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
                            ) : margin < 0 ? (
                              <span style={{ color: '#ef4444' }}>{margin.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>0.00 ฿</span>
                            )}
                          </td>
                          <td className="text-center">
                            {agg.count > 0 ? (
                              <button
                                className="btn-detail"
                                onClick={() => openDrillDown(selectedHcode === 'all' ? '05572' : selectedHcode, `${item.name} (ขนาด ${item.size})`, item.id)}
                              >
                                📋 {agg.count} Visit
                              </button>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>ไม่มีจ่าย</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Rates & Compensation Rules Info */}
          {activeTab === 'rates_info' && (
            <div className="rates-info-grid">
              <div className="rates-info-card">
                <h4>💊 ยอดชดเชยจัดสรร Triferdine 150 mg (5 รพ.สต.)</h4>
                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1rem 0' }}>
                  ยอดเงินจัดสรรคงที่สำหรับยา Triferdine ที่จัดสรรให้แต่ละ รพ.สต. เพื่อนำมาหักลบกับต้นทุนยาที่จ่ายจริง
                </p>
                <div className="pcu-table-responsive">
                  <table className="pcu-table">
                    <thead>
                      <tr>
                        <th>รหัส</th>
                        <th>ชื่อ รพ.สต.</th>
                        <th className="text-right">ยอดชดเชยจัดสรร (บาท)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TRIFERDINE_PCU_ALLOCATION.map((item) => (
                        <tr key={item.code}>
                          <td><span className="badge-pcu">{item.code}</span></td>
                          <td><strong>{item.name}</strong></td>
                          <td className="text-right" style={{ fontWeight: 700, color: '#4338ca' }}>
                            {item.amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                        <td colSpan={2}>รวมยอดชดเชยจัดสรร Triferdine ทั้งหมด</td>
                        <td className="text-right" style={{ color: '#4338ca', fontSize: '1.05rem' }}>
                          {TRIFERDINE_PCU_ALLOCATION.reduce((a, b) => a + b.amt, 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="rates-info-card">
                <h4>📅 ราคาต้นทุน Triferdine 150 mg รายเดือน</h4>
                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1rem 0' }}>
                  ขนาดบรรจุกล่องละ 30 เม็ด (30's) คำนวณราคาต้นทุนตามเดือนที่คนไข้มารับบริการ (vstdate)
                </p>
                <div className="pcu-table-responsive">
                  <table className="pcu-table">
                    <thead>
                      <tr>
                        <th>ช่วงเดือน</th>
                        <th className="text-right">ราคากล่อง (30's)</th>
                        <th className="text-right">ต้นทุนต่อเม็ด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TRIFERDINE_MONTHLY_TIERS.map((tier) => (
                        <tr key={tier.month}>
                          <td><strong>{tier.month}</strong></td>
                          <td className="text-right" style={{ fontWeight: 600 }}>{tier.priceBox.toFixed(2)} ฿</td>
                          <td className="text-right" style={{ color: '#059669', fontWeight: 700 }}>{tier.priceTab.toFixed(5)} ฿</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0' }}>🍃 เกณฑ์ชดเชย Folic Acid</h4>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.875rem', color: '#334155', lineHeight: '1.8' }}>
                    <li><strong>ราคาต้นทุน:</strong> 0.12 บาท / เม็ด</li>
                    <li><strong>ขนาดคอร์ส:</strong> 1 คอร์ส = 52 เม็ด (ต้นทุนคอร์สละ 6.24 บาท)</li>
                    <li><strong>ยอดชดเชย:</strong> 80.00 บาท / คอร์ส</li>
                    <li><strong>สูตรคำนวณชดเชย:</strong> <code>(จำนวนเม็ดที่จ่าย / 52) × 80.00 บาท</code></li>
                    <li><strong>กำไรส่วนต่าง:</strong> <code>80.00 - 6.24 = 73.76 บาท / คอร์ส</code></li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Diagnosis & Indication Audit */}
          {activeTab === 'diag_audit' && (
            <div className="diag-audit-container">
              {/* Educational Notice Banner */}
              <div className="audit-alert-banner">
                <div className="audit-alert-icon">💡</div>
                <div className="audit-alert-content">
                  <h4>ทำไม รพ.สต. จ่ายยาไปเยอะ แต่ยอดชดเชยไม่ขึ้นหรือได้ 0 บาท?</h4>
                  <p>
                    ตามระเบียบ e-Claim / H-Sub ของ สปสช. และกรมการแพทย์แผนไทย <strong>ยาสมุนไพรจำเป็นต้องมีรหัสการวินิจฉัยโรค (ICD-10 หรือ U-Code) ที่สัมพันธ์กับกลุ่มสรรพคุณของยา</strong>
                    หากระบุรหัสโรคไม่ตรง เช่น <em>จ่ายครีมไพลแต่ลงฟันผุ (K020)</em> หรือ <em>จ่ายขมิ้นชันแต่ลงปวดกล้ามเนื้อ (M791)</em> หรือ <em>ไม่ระบุรหัสโรค (มีแต่รหัสตรวจสุขภาพ Z000)</em>
                    ทาง สปสช. จะปฏิเสธการจ่ายชดเชยทันที (Denial / Rep 0 บาท) ทำให้ รพ.สต. สูญเสียโอกาสในการได้รับเงินชดเชย
                  </p>
                </div>
              </div>

              {/* KPI Cards for Audit */}
              {auditData?.summary && (
                <div className="kpi-cards-grid audit-kpi-grid">
                  <div className="kpi-card blue">
                    <div className="kpi-card-header">
                      <span className="kpi-card-title">จำนวนครั้งจ่ายยาที่ตรวจสอบ</span>
                      <span className="kpi-card-icon">📋</span>
                    </div>
                    <div className="kpi-card-value">
                      {auditData.summary.total_prescriptions.toLocaleString()} ครั้ง
                    </div>
                    <div className="kpi-card-sub">
                      ช่วง {startDate} ถึง {endDate}
                    </div>
                  </div>

                  <div className="kpi-card rose">
                    <div className="kpi-card-header">
                      <span className="kpi-card-title">ยาไม่สัมพันธ์กับโรค (Mismatch)</span>
                      <span className="kpi-card-icon">❌</span>
                    </div>
                    <div className="kpi-card-value" style={{ color: '#dc2626' }}>
                      {auditData.summary.mismatch_cnt.toLocaleString()} ครั้ง
                    </div>
                    <div className="kpi-card-sub" style={{ color: '#991b1b' }}>
                      ระบุรหัสโรคไม่ตรงกลุ่มสรรพคุณ
                    </div>
                  </div>

                  <div className="kpi-card amber">
                    <div className="kpi-card-header">
                      <span className="kpi-card-title">ขาดรหัสโรค / มีแต่รหัส Z</span>
                      <span className="kpi-card-icon">⚠️</span>
                    </div>
                    <div className="kpi-card-value" style={{ color: '#d97706' }}>
                      {auditData.summary.missing_cnt.toLocaleString()} ครั้ง
                    </div>
                    <div className="kpi-card-sub">
                      ไม่มี ICD-10 บ่งชี้ความเจ็บป่วย
                    </div>
                  </div>

                  <div className="kpi-card purple">
                    <div className="kpi-card-header">
                      <span className="kpi-card-title">มูลค่าเงินที่เสี่ยงถูกตัด (ชดเชย 0 บาท)</span>
                      <span className="kpi-card-icon">💸</span>
                    </div>
                    <div className="kpi-card-value" style={{ color: '#9333ea' }}>
                      {auditData.summary.at_risk_value_baht.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </div>
                    <div className="kpi-card-sub">
                      อัตราข้อผิดพลาดรวม: {auditData.summary.error_rate_pct}%
                    </div>
                  </div>

                  <div className="kpi-card green">
                    <div className="kpi-card-header">
                      <span className="kpi-card-title">วินิจฉัยถูกต้องตามเกณฑ์</span>
                      <span className="kpi-card-icon">✅</span>
                    </div>
                    <div className="kpi-card-value" style={{ color: '#16a34a' }}>
                      {auditData.summary.valid_cnt.toLocaleString()} ครั้ง
                    </div>
                    <div className="kpi-card-sub" style={{ color: '#15803d' }}>
                      {(100 - auditData.summary.error_rate_pct).toFixed(1)}% ผ่านเกณฑ์เบิกได้
                    </div>
                  </div>
                </div>
              )}

              {/* PCU Comparison Breakdown Cards */}
              {auditData?.summary?.pcu_breakdown && (
                <div className="audit-pcu-breakdown-section">
                  <div className="audit-section-header">
                    <h4>🏢 อัตราข้อผิดพลาดและการสูญเสียชดเชยราย รพ.สต. (คลิกเพื่อกรองข้อมูล)</h4>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      เลือกคลิกที่การ์ด รพ.สต. เพื่อดูรายการที่ต้องแก้ไขของที่นั่นโดยเฉพาะ
                    </span>
                  </div>
                  <div className="audit-pcu-cards">
                    {auditData.summary.pcu_breakdown.map((pcu) => {
                      const isSelected = auditHcode === pcu.pcu_code;
                      return (
                        <div
                          key={pcu.pcu_code}
                          className={`audit-pcu-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setAuditHcode(isSelected ? 'all' : pcu.pcu_code);
                            setAuditPage(1);
                          }}
                        >
                          <div className="audit-pcu-card-top">
                            <span className="badge-pcu">{pcu.pcu_code}</span>
                            <span className={`audit-badge-error-rate ${pcu.error_rate_pct > 10 ? 'high' : pcu.error_rate_pct > 5 ? 'med' : 'low'}`}>
                              ผิด {pcu.error_rate_pct}%
                            </span>
                          </div>
                          <div className="audit-pcu-card-name">{pcu.pcu_name}</div>
                          <div className="audit-pcu-card-stats">
                            <div>
                              <span className="lbl">จ่ายทั้งหมด:</span>
                              <strong>{pcu.total_prescriptions.toLocaleString()}</strong>
                            </div>
                            <div>
                              <span className="lbl">ผิด/ไม่ตรง:</span>
                              <strong style={{ color: '#dc2626' }}>{(pcu.mismatch_cnt + pcu.missing_cnt).toLocaleString()}</strong>
                            </div>
                            <div>
                              <span className="lbl">เสี่ยงสูญเงิน:</span>
                              <strong style={{ color: '#9333ea' }}>{pcu.at_risk_value_baht.toLocaleString('th-TH', { minimumFractionDigits: 0 })} ฿</strong>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Controls and Search Toolbar */}
              <div className="audit-toolbar">
                <div className="audit-filter-group">
                  <div className="filter-pill-label">หน่วยบริการ:</div>
                  <select
                    className="pcu-select"
                    value={auditHcode}
                    onChange={(e) => {
                      setAuditHcode(e.target.value);
                      setAuditPage(1);
                    }}
                  >
                    <option value="all">🏥 ทั้งหมด 5 รพ.สต.</option>
                    {data?.pcus.map((p) => (
                      <option key={p.pcu_code} value={p.pcu_code}>
                        {p.pcu_code} - {p.pcu_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="audit-status-tabs">
                  <button
                    className={`audit-status-tab ${auditStatusFilter === 'mismatch' ? 'active rose' : ''}`}
                    onClick={() => { setAuditStatusFilter('mismatch'); setAuditPage(1); }}
                  >
                    ❌ ยาไม่ตรงกับโรค ({auditData?.summary.mismatch_cnt || 0})
                  </button>
                  <button
                    className={`audit-status-tab ${auditStatusFilter === 'missing' ? 'active amber' : ''}`}
                    onClick={() => { setAuditStatusFilter('missing'); setAuditPage(1); }}
                  >
                    ⚠️ ขาดรหัสโรค ({auditData?.summary.missing_cnt || 0})
                  </button>
                  <button
                    className={`audit-status-tab ${auditStatusFilter === 'valid' ? 'active green' : ''}`}
                    onClick={() => { setAuditStatusFilter('valid'); setAuditPage(1); }}
                  >
                    ✅ วินิจฉัยถูกต้อง ({auditData?.summary.valid_cnt || 0})
                  </button>
                  <button
                    className={`audit-status-tab ${auditStatusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => { setAuditStatusFilter('all'); setAuditPage(1); }}
                  >
                    📋 ทั้งหมด ({auditData?.summary.total_prescriptions || 0})
                  </button>
                </div>

                <div className="audit-search-box">
                  <input
                    type="text"
                    placeholder="🔎 ค้นหา ชื่อผู้ป่วย, HN, VN, ชื่อยา, รหัสโรค..."
                    value={auditSearch}
                    onChange={(e) => {
                      setAuditSearch(e.target.value);
                      setAuditPage(1);
                    }}
                  />
                  {auditSearch && (
                    <button className="btn-clear-search" onClick={() => { setAuditSearch(''); setAuditPage(1); }}>
                      ✕
                    </button>
                  )}
                </div>

                <div className="audit-actions">
                  <button
                    className="btn-herbal btn-export-herbal"
                    onClick={handleExportAuditExcel}
                    disabled={exportingAudit || !auditData?.items?.length}
                    title="ดาวน์โหลดไฟล์ Excel รายการที่ต้องแก้ไขรหัสโรคเพื่อให้ รพ.สต. นำไปปรับปรุง"
                  >
                    {exportingAudit ? '⏳ กำลังสร้าง Excel...' : '📥 ส่งออก Excel รายการที่ต้องแก้ไข'}
                  </button>
                  <button
                    className="btn-herbal btn-secondary-herbal"
                    onClick={() => loadDiagAudit()}
                    disabled={auditLoading}
                    title="โหลดข้อมูลใหม่ล่าสุด"
                  >
                    {auditLoading ? '🔄 กำลังโหลด...' : '🔄 รีเฟรช'}
                  </button>
                </div>
              </div>

              {/* Audit Results Table */}
              <div className="pcu-table-card">
                <div className="pcu-table-card-header">
                  <h3 className="pcu-table-card-title">
                    <span>🔍</span> ผลการตรวจสอบการสั่งใช้ยากับรหัสการวินิจฉัยโรค
                    {auditHcode !== 'all' && (
                      <span style={{ fontSize: '0.9rem', color: '#2563eb', fontWeight: 600, marginLeft: '0.5rem' }}>
                        (เฉพาะ {auditData?.summary.pcu_breakdown.find(p => p.pcu_code === auditHcode)?.pcu_name || auditHcode})
                      </span>
                    )}
                  </h3>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    พบทั้งหมด <strong>{auditData?.total.toLocaleString() || 0}</strong> รายการ | หน้า {auditPage} จาก {auditData?.totalPages || 1}
                  </span>
                </div>

                {auditLoading ? (
                  <div className="loading-box" style={{ padding: '3rem' }}>
                    <div className="spinner" />
                    <p>กำลังตรวจสอบการวินิจฉัยโรคตามหลักเกณฑ์ สปสช. กรุณารอสักครู่...</p>
                  </div>
                ) : auditData && auditData.items.length > 0 ? (
                  <div className="pcu-table-responsive">
                    <table className="pcu-table audit-table">
                      <thead>
                        <tr>
                          <th>ว/ด/ป</th>
                          <th>รพ.สต.</th>
                          <th>VN / HN</th>
                          <th>ชื่อ-สกุล ผู้ป่วย</th>
                          <th>รายการยาที่จ่าย</th>
                          <th className="text-right">จำนวน</th>
                          <th className="text-right">มูลค่า (บาท)</th>
                          <th>รหัสโรคที่บันทึก (PDX)</th>
                          <th>สถานะ & ปัญหาที่พบ</th>
                          <th>คำแนะนำรหัส ICD-10 ที่ถูกต้อง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditData.items.map((item, idx) => (
                          <tr key={`${item.vn}-${item.drug_name}-${idx}`}>
                            <td>{item.vstdate}</td>
                            <td>
                              <span className="badge-pcu">{item.pcu_code}</span>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.pcu_name.replace('รพ.สต.บ้าน', '').replace('รพ.สต.', '')}</div>
                            </td>
                            <td>
                              <code>{item.vn}</code>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>HN: {item.hn}</div>
                            </td>
                            <td><strong>{item.patient_name}</strong></td>
                            <td>
                              <span className="audit-drug-name">{item.drug_name}</span>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                กลุ่ม: {item.indication_group}
                              </div>
                            </td>
                            <td className="text-right font-mono">{item.qty}</td>
                            <td className="text-right font-mono" style={{ fontWeight: 600 }}>
                              {item.sum_price.toFixed(2)} ฿
                            </td>
                            <td>
                              <div className="audit-diags-list">
                                {item.all_diags.length > 0 ? (
                                  item.all_diags.map((d) => (
                                    <span
                                      key={d}
                                      className={`diag-badge ${d === item.pdx ? 'pdx' : ''}`}
                                      title={d === item.pdx ? 'รหัสโรคหลัก (PDX)' : 'รหัสโรครอง'}
                                    >
                                      {d} {d === item.pdx && '★'}
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>ไม่มีรหัสโรค</span>
                                )}
                              </div>
                            </td>
                            <td>
                              {item.audit_status === 'valid' && (
                                <span className="badge-status-audit valid">
                                  ✅ ถูกต้องตามเกณฑ์
                                </span>
                              )}
                              {item.audit_status === 'mismatch' && (
                                <div>
                                  <span className="badge-status-audit mismatch">
                                    ❌ ยาไม่ตรงกับโรค
                                  </span>
                                  <div className="audit-reason-text">{item.issue_reason}</div>
                                </div>
                              )}
                              {item.audit_status === 'missing' && (
                                <div>
                                  <span className="badge-status-audit missing">
                                    ⚠️ ขาดรหัสโรค
                                  </span>
                                  <div className="audit-reason-text">{item.issue_reason}</div>
                                </div>
                              )}
                            </td>
                            <td>
                              {item.recommended_diags.length > 0 ? (
                                <div className="recommended-diags-box">
                                  {item.recommended_diags.map((rec) => (
                                    <span key={rec} className="recommended-chip" title="รหัส ICD-10 ที่กลุ่มยานี้สามารถเบิกชดเชยได้">
                                      + {rec}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: '#16a34a' }}>ถูกต้องแล้ว</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-box" style={{ padding: '3rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
                    <h4>ไม่พบรายการที่ตรงกับเงื่อนไข</h4>
                    <p style={{ color: '#64748b' }}>
                      ไม่มีรายการวินิจฉัยผิด หรือคำค้นหาไม่ตรงกับข้อมูลใดๆ
                    </p>
                  </div>
                )}

                {/* Pagination */}
                {auditData && auditData.totalPages > 1 && (
                  <div className="audit-pagination">
                    <button
                      className="pagination-btn"
                      disabled={auditPage <= 1}
                      onClick={() => setAuditPage(1)}
                    >
                      « หน้าแรก
                    </button>
                    <button
                      className="pagination-btn"
                      disabled={auditPage <= 1}
                      onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                    >
                      ‹ ก่อนหน้า
                    </button>
                    <span className="pagination-info">
                      หน้า <strong>{auditPage}</strong> / {auditData.totalPages} (รวม {auditData.total.toLocaleString()} รายการ)
                    </span>
                    <button
                      className="pagination-btn"
                      disabled={auditPage >= auditData.totalPages}
                      onClick={() => setAuditPage(p => Math.min(auditData.totalPages, p + 1))}
                    >
                      ถัดไป ›
                    </button>
                    <button
                      className="pagination-btn"
                      disabled={auditPage >= auditData.totalPages}
                      onClick={() => setAuditPage(auditData.totalPages)}
                    >
                      หน้าสุดท้าย »
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Drill Down Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔎 รายละเอียดการจ่ายยา: {modalTitle}</h3>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="🔎 ค้นหา ชื่อผู้ป่วย, HN, หรือ VN..."
                  value={modalSearch}
                  onChange={(e) => handleModalSearchChange(e.target.value)}
                  style={{ flex: 1, padding: '0.5rem 0.8rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                />
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  พบทั้งหมด {modalData?.total.toLocaleString() || 0} รายการ
                </span>
              </div>

              {modalLoading ? (
                <div className="loading-box">
                  <div className="spinner" />
                  <p>กำลังดึงข้อมูลรายละเอียด...</p>
                </div>
              ) : modalData?.items && modalData.items.length > 0 ? (
                <div className="pcu-table-responsive">
                  <table className="pcu-table">
                    <thead>
                      <tr>
                        <th>วันที่</th>
                        <th>VN</th>
                        <th>HN</th>
                        <th>ชื่อ-สกุลผู้ป่วย</th>
                        <th>รายการยาที่จ่าย</th>
                        <th>ขนาดมาตรฐาน</th>
                        <th className="text-right">จำนวน</th>
                        <th className="text-right">ต้นทุน (บาท)</th>
                        <th className="text-right">เรียกเก็บ (บาท)</th>
                        <th className="text-right">ส่วนต่างกำไร</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalData.items.map((item, idx) => (
                        <tr key={`${item.vn}-${item.icode}-${idx}`}>
                          <td>{item.vstdate}</td>
                          <td><code>{item.vn}</code></td>
                          <td><code>{item.hn}</code></td>
                          <td><strong>{item.patient_name}</strong></td>
                          <td>
                            {item.drug_name}
                            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
                              (รหัสแม่: {item.herbal_master_name})
                            </span>
                          </td>
                          <td>{item.herbal_size}</td>
                          <td className="text-right"><strong>{item.qty}</strong> {item.units}</td>
                          <td className="text-right">{item.total_cost.toFixed(2)} ฿</td>
                          <td className="text-right">{item.sum_price.toFixed(2)} ฿</td>
                          <td className="text-right">
                            <span className={item.margin >= 0 ? 'profit-text' : ''}>
                              {item.margin >= 0 ? `+${item.margin.toFixed(2)}` : item.margin.toFixed(2)} ฿
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  ไม่พบข้อมูลรายการจ่ายยาตามเงื่อนไขที่เลือก
                </div>
              )}
            </div>

            <div className="modal-footer">
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                หน้า {modalPage} จาก {modalData?.totalPages || 1}
              </div>
              <div className="pagination-controls">
                <button
                  className="btn-page"
                  disabled={modalPage <= 1}
                  onClick={() => handleModalPageChange(modalPage - 1)}
                >
                  ◀ ก่อนหน้า
                </button>
                <button
                  className="btn-page"
                  disabled={modalPage >= (modalData?.totalPages || 1)}
                  onClick={() => handleModalPageChange(modalPage + 1)}
                >
                  ถัดไป ▶
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PCU Connection Config & Diagnostic Modal */}
      {configModalOpen && (
        <div className="modal-backdrop" onClick={() => !savingConfig && setConfigModalOpen(false)}>
          <div className="modal-dialog config-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>⚙️ ตั้งค่าและทดสอบการเชื่อมต่อฐานข้อมูล HOSxP รพ.สต. (5 แห่ง)</h2>
                <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                  กำหนด Host IP, Port, Username, Password และชื่อฐานข้อมูล MySQL ของ รพ.สต. ในเครือข่าย GDCC
                </p>
              </div>
              <button
                className="btn-close-modal"
                disabled={savingConfig}
                onClick={() => setConfigModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="vpn-guidance-box">
                ℹ️ <strong>คำแนะนำเครือข่าย GDCC:</strong> หากทดสอบแล้วขึ้น <code>Timeout (ETIMEDOUT)</code> แปลว่าเครื่องเซิร์ฟเวอร์ยังไม่ได้เชื่อมต่อวงเครือข่าย GDCC ให้เชื่อมต่อ VPN <code>pho4701.health</code> หรือตรวจสอบ Routing จากเครื่องเซิร์ฟเวอร์ไปยัง IP รพ.สต.
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="pcu-config-table">
                  <thead>
                    <tr>
                      <th style={{ width: '130px' }}>รหัส / รพ.สต.</th>
                      <th style={{ width: '140px' }}>Host / IP</th>
                      <th style={{ width: '80px' }}>Port</th>
                      <th style={{ width: '130px' }}>Database</th>
                      <th style={{ width: '90px' }}>Username</th>
                      <th style={{ width: '160px' }}>Password</th>
                      <th style={{ width: '100px' }}>การทดสอบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pcuConfigs.map((pcu, idx) => {
                      const testRes = testResults[pcu.code];
                      const isTestingThis = testingCode === pcu.code;
                      const showPwd = showPasswords[pcu.code] || false;

                      return (
                        <React.Fragment key={pcu.code}>
                          <tr>
                            <td>
                              <strong>{pcu.code}</strong>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{pcu.name}</div>
                            </td>
                            <td>
                              <input
                                className="pcu-config-input"
                                value={pcu.host}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPcuConfigs(prev => prev.map((item, i) => i === idx ? { ...item, host: val } : item));
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="pcu-config-input"
                                type="number"
                                value={pcu.port}
                                onChange={(e) => {
                                  const val = Number(e.target.value) || 3306;
                                  setPcuConfigs(prev => prev.map((item, i) => i === idx ? { ...item, port: val } : item));
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="pcu-config-input"
                                value={pcu.db}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPcuConfigs(prev => prev.map((item, i) => i === idx ? { ...item, db: val } : item));
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="pcu-config-input"
                                value={pcu.user}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPcuConfigs(prev => prev.map((item, i) => i === idx ? { ...item, user: val } : item));
                                }}
                              />
                            </td>
                            <td>
                              <div className="password-input-wrapper">
                                <input
                                  className="pcu-config-input"
                                  type={showPwd ? 'text' : 'password'}
                                  value={pcu.pass}
                                  placeholder="รหัสผ่าน MySQL"
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPcuConfigs(prev => prev.map((item, i) => i === idx ? { ...item, pass: val } : item));
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn-toggle-pwd"
                                  onClick={() => setShowPasswords(prev => ({ ...prev, [pcu.code]: !showPwd }))}
                                  title={showPwd ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                                >
                                  {showPwd ? '🙈' : '👁️'}
                                </button>
                              </div>
                            </td>
                            <td>
                              <button
                                className="btn-test-single"
                                disabled={isTestingThis}
                                onClick={() => handleTestSingle(pcu)}
                              >
                                {isTestingThis ? '⏳' : '⚡ ทดสอบ'}
                              </button>
                            </td>
                          </tr>
                          {testRes && (
                            <tr>
                              <td colSpan={7} style={{ paddingTop: 0, paddingBottom: '0.6rem' }}>
                                <div className={`diag-result-row ${testRes.connected ? 'success' : 'error'}`}>
                                  {testRes.connected ? '🟢 ' : '🔴 '}
                                  <strong>{testRes.connected ? 'เชื่อมต่อสำเร็จ' : 'เชื่อมต่อไม่สำเร็จ'}:</strong> {testRes.diagnostics || testRes.error}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn-herbal btn-reset-default"
                onClick={handleResetDefaults}
                disabled={savingConfig || testingAllConfigs}
              >
                🔄 โหลดค่าเริ่มต้น
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn-herbal btn-secondary-herbal"
                  onClick={handleTestAllConfigs}
                  disabled={savingConfig || testingAllConfigs}
                >
                  {testingAllConfigs ? '⏳ กำลังทดสอบทั้งหมด...' : '⚡ ทดสอบทั้งหมด (5 แห่ง)'}
                </button>
                <button
                  className="btn-herbal btn-primary-herbal"
                  onClick={handleSaveConfigs}
                  disabled={savingConfig}
                >
                  {savingConfig ? '⏳ กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PcuHerbalReconcilePage;
