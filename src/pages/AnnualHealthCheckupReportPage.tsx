import { useState, useEffect, useMemo } from 'react';
import { thaiBahtText } from '../utils/thaiBahtText';
import './AnnualHealthCheckupReportPage.css';

export type CheckupItem = {
  name: string;
  price: number;
  qty?: number;
  category: 'xray' | 'lab' | 'other';
  code?: string;
};

export type CheckupVisit = {
  vn: string;
  hn: string;
  vstdate: string;
  vsttime: string;
  pname: string;
  fname: string;
  lname: string;
  fullname: string;
  birthday: string | null;
  age_y: number;
  age_m: number;
  sex: string;
  pttype: string;
  pttype_name: string;
  pcode: string;
  hipdata_code: string;
  xray_items: CheckupItem[];
  xray_total: number;
  lab_items: CheckupItem[];
  lab_total: number;
  other_items: CheckupItem[];
  other_total: number;
  total_price: number;
};

export type PttypeOption = {
  pttype: string;
  name: string;
  pcode: string;
  hipdata_code: string;
};

export type MatrixColumnDef = {
  id: string;
  name: string;
  shortName: string;
  rate: number;
  match: (item: CheckupItem) => boolean;
};

export const CHECKUP_MATRIX_COLUMNS: MatrixColumnDef[] = [
  {
    id: 'film_chest',
    name: 'Film Chest',
    shortName: 'Film Chest',
    rate: 170,
    match: (item) => item.category === 'xray' || /chest|cxr|film|x-ray|เอกซเรย์/i.test(item.name)
  },
  {
    id: 'urine',
    name: 'urine Examination',
    shortName: 'urine Exam.',
    rate: 50,
    match: (item) => /urine\s*analysis|ua\b|urine\s*exam|ปัสสาวะ/i.test(item.name) && !/culture|protein.*24/i.test(item.name)
  },
  {
    id: 'stool',
    name: 'Stool Exam.',
    shortName: 'Stool Exam.',
    rate: 70,
    match: (item) => /stool|occult|อุจจาระ/i.test(item.name)
  },
  {
    id: 'cbc',
    name: 'CBC',
    shortName: 'CBC',
    rate: 90,
    match: (item) => /cbc|complete blood/i.test(item.name)
  },
  {
    id: 'fpg',
    name: 'Glucose FPG',
    shortName: 'Glucose FPG',
    rate: 40,
    match: (item) => /glucose|fbs|fpg|dtx|น้ำตาล/i.test(item.name)
  },
  {
    id: 'chol',
    name: 'Cholesterol',
    shortName: 'Cholesterol',
    rate: 60,
    match: (item) => /cholesterol/i.test(item.name) && !/hdl|ldl/i.test(item.name)
  },
  {
    id: 'tg',
    name: 'TG',
    shortName: 'TG',
    rate: 60,
    match: (item) => /triglyceride|^tg\b/i.test(item.name)
  },
  {
    id: 'bun',
    name: 'BUN',
    shortName: 'BUN',
    rate: 50,
    match: (item) => /^bun\b|blood urea/i.test(item.name)
  },
  {
    id: 'cr',
    name: 'Cr',
    shortName: 'Cr',
    rate: 50,
    match: (item) => /^cr\b|creatinine/i.test(item.name)
  },
  {
    id: 'sgot',
    name: 'SGOT',
    shortName: 'SGOT',
    rate: 50,
    match: (item) => /sgot|ast\b/i.test(item.name)
  },
  {
    id: 'sgpt',
    name: 'SGPT',
    shortName: 'SGPT',
    rate: 50,
    match: (item) => /sgpt|alt\b/i.test(item.name)
  },
  {
    id: 'alk',
    name: 'Alk Phosphatase',
    shortName: 'Alk Phos',
    rate: 50,
    match: (item) => /alk|alkaline/i.test(item.name)
  },
  {
    id: 'uric',
    name: 'Uric acid',
    shortName: 'Uric acid',
    rate: 60,
    match: (item) => /uric/i.test(item.name)
  },
  {
    id: 'pelvic',
    name: 'ตรวจภายใน',
    shortName: 'ตรวจภายใน',
    rate: 100,
    match: (item) => /ตรวจภายใน|pelvic/i.test(item.name)
  },
  {
    id: 'pap',
    name: 'PAP Smear',
    shortName: 'PAP Smear',
    rate: 50,
    match: (item) => /pap|smear|cervical/i.test(item.name)
  },
];

export function getVisitMatrixValues(v: CheckupVisit) {
  const allItems: CheckupItem[] = [
    ...(v.xray_items || []),
    ...(v.lab_items || []),
    ...(v.other_items || [])
  ];

  const matchedItemIndices = new Set<number>();
  const colValues: Record<string, number> = {};

  // ตรวจสอบแพ็กเกจ Lipid profile
  let hasLipidProfile = false;
  let lipidProfilePrice = 0;
  allItems.forEach((it, idx) => {
    if (/lipid profile/i.test(it.name)) {
      hasLipidProfile = true;
      lipidProfilePrice = it.price;
      matchedItemIndices.add(idx);
    }
  });

  // จับคู่รายการเข้าคอลัมน์มาตรฐาน 15 รายการ
  for (const col of CHECKUP_MATRIX_COLUMNS) {
    let sum = 0;
    allItems.forEach((it, idx) => {
      if (!matchedItemIndices.has(idx) && col.match(it)) {
        sum += it.price;
        matchedItemIndices.add(idx);
      }
    });

    if (hasLipidProfile) {
      if (col.id === 'chol' && sum === 0) sum = 60;
      if (col.id === 'tg' && sum === 0) sum = 60;
    }
    colValues[col.id] = sum;
  }

  // รายการอื่นๆ นอกเหนือจาก 15 รายการมาตรฐาน (เช่น Electrolyte, EKG)
  let otherSum = 0;
  const otherNames: string[] = [];
  allItems.forEach((it, idx) => {
    if (!matchedItemIndices.has(idx)) {
      otherSum += it.price;
      otherNames.push(`${it.name} (${it.price})`);
    }
  });

  if (hasLipidProfile && lipidProfilePrice > 120) {
    const diff = lipidProfilePrice - 120;
    otherSum += diff;
    otherNames.push(`HDL/LDL (${diff})`);
  }

  const computedTotal = Object.values(colValues).reduce((a, b) => a + b, 0) + otherSum;
  return {
    colValues,
    otherSum,
    otherNames: otherNames.join(', '),
    total: v.total_price || computedTotal
  };
}

const STORAGE_KEYS = {
  GOV_ORG: 'checkup_gov_org',
  DISTRICT: 'checkup_district',
  PROVINCE: 'checkup_province',
  NURSE_NAME: 'checkup_nurse_name',
  NURSE_POS: 'checkup_nurse_pos',
  HEAD_NAME: 'checkup_head_name',
  HEAD_POS: 'checkup_head_pos',
  YEAR: 'checkup_year',
  PTTYPE_LABEL: 'checkup_pttype_label',
  WORK_PLACE: 'checkup_work_place',
};

export function AnnualHealthCheckupReportPage() {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Filter States
  const [dateStart, setDateStart] = useState<string>(todayStr);
  const [dateEnd, setDateEnd] = useState<string>(todayStr);
  const [selectedPttype, setSelectedPttype] = useState<string>('OFC_LGO');
  const [searchText, setSearchText] = useState<string>('');
  const [pttypesList, setPttypesList] = useState<PttypeOption[]>([]);

  // Data States
  const [visits, setVisits] = useState<CheckupVisit[]>([]);
  const [selectedVns, setSelectedVns] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // View States
  const [activeTab, setActiveTab] = useState<'summary' | 'individual'>('summary');
  const [singlePrintVn, setSinglePrintVn] = useState<string | null>(null);

  // Form Inputs for Report Header & Signers (persisted in localStorage)
  const [govOrg, setGovOrg] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.GOV_ORG) || 'สำนักงานสาธารณสุขอำเภอโคกศรีสุพรรณ');
  const [district, setDistrict] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.DISTRICT) || 'โคกศรีสุพรรณ');
  const [province, setProvince] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.PROVINCE) || 'สกลนคร');
  const [nurseName, setNurseName] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.NURSE_NAME) || 'นางสาววราภรณ์ บุญศิริ');
  const [nursePos, setNursePos] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.NURSE_POS) || 'พยาบาลวิชาชีพชำนาญการพิเศษ');
  const [headPos, setHeadPos] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.HEAD_POS) || 'หัวหน้าพยาบาล');
  const [checkupYear, setCheckupYear] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.YEAR) || '2569');
  const [pttypeLabel, setPttypeLabel] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.PTTYPE_LABEL) || 'NON UC');
  const [workPlace, setWorkPlace] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.WORK_PLACE) || '');

  // Save header settings
  const handleSaveSettings = () => {
    localStorage.setItem(STORAGE_KEYS.GOV_ORG, govOrg);
    localStorage.setItem(STORAGE_KEYS.DISTRICT, district);
    localStorage.setItem(STORAGE_KEYS.PROVINCE, province);
    localStorage.setItem(STORAGE_KEYS.NURSE_NAME, nurseName);
    localStorage.setItem(STORAGE_KEYS.NURSE_POS, nursePos);
    localStorage.setItem(STORAGE_KEYS.HEAD_POS, headPos);
    localStorage.setItem(STORAGE_KEYS.YEAR, checkupYear);
    localStorage.setItem(STORAGE_KEYS.PTTYPE_LABEL, pttypeLabel);
    localStorage.setItem(STORAGE_KEYS.WORK_PLACE, workPlace);
  };

  // Load Pttypes
  useEffect(() => {
    fetch('/api/reports/checkup/pttypes')
      .then((res) => res.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setPttypesList(res.data);
        }
      })
      .catch((err) => console.error('Failed to load pttypes:', err));
  }, []);

  // Fetch Visits
  const fetchVisits = async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        date_start: dateStart,
        date_end: dateEnd,
        pttype: selectedPttype,
        search: searchText.trim(),
      });
      const res = await fetch(`/api/reports/checkup/visits?${query.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ดึงข้อมูลไม่สำเร็จ');
      }
      const data: CheckupVisit[] = json.data || [];
      setVisits(data);
      // Default: select all
      setSelectedVns(new Set(data.map((v) => v.vn)));
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVisits();
  }, []);

  // Toggle selection
  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedVns(new Set(visits.map((v) => v.vn)));
    } else {
      setSelectedVns(new Set());
    }
  };

  const handleToggleVn = (vn: string) => {
    const next = new Set(selectedVns);
    if (next.has(vn)) {
      next.delete(vn);
    } else {
      next.add(vn);
    }
    setSelectedVns(next);
  };

  // Filtered Selected Visits
  const selectedVisits = useMemo(() => {
    return visits.filter((v) => selectedVns.has(v.vn));
  }, [visits, selectedVns]);

  // Check if any selected visit has unmapped other test items
  const hasOtherItems = useMemo(() => {
    return selectedVisits.some((v) => {
      const { otherSum } = getVisitMatrixValues(v);
      return otherSum > 0;
    });
  }, [selectedVisits]);

  // Total summary calculations
  const totalAmount = useMemo(() => {
    return selectedVisits.reduce((sum, v) => sum + (v.total_price || 0), 0);
  }, [selectedVisits]);

  const totalAmountText = useMemo(() => {
    return thaiBahtText(totalAmount);
  }, [totalAmount]);

  // Format Thai Date
  const formatThaiDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const thMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
      ];
      return `${d.getDate()} ${thMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
    } catch {
      return dateStr;
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (selectedVisits.length === 0) {
      alert('กรุณาเลือกอย่างน้อย 1 รายการ');
      return;
    }
    const headers = [
      'ลำดับ', 'HN', 'ชื่อ-สกุล', 'อายุ(ปี)',
      ...CHECKUP_MATRIX_COLUMNS.map((c) => c.name),
      ...(hasOtherItems ? ['อื่นๆ'] : []),
      'รวม'
    ];

    const rows = selectedVisits.map((v, i) => {
      const { colValues, otherSum, total } = getVisitMatrixValues(v);
      return [
        i + 1,
        v.hn,
        v.fullname,
        v.age_y,
        ...CHECKUP_MATRIX_COLUMNS.map((c) => colValues[c.id] || 0),
        ...(hasOtherItems ? [otherSum] : []),
        total
      ];
    });

    const csvContent = '\uFEFF' + [headers, ...rows].map((e) => e.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `checkup_report_${dateStart}_${dateEnd}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print Handler
  const handlePrint = (tab: 'summary' | 'individual', vn?: string) => {
    handleSaveSettings();
    setActiveTab(tab);
    setSinglePrintVn(vn || null);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  return (
    <div className={`checkup-page ${activeTab === 'summary' ? 'page-landscape' : 'page-portrait'}`}>
      {/* Dynamic page orientation style for printing */}
      <style>{`
        @media print {
          @page {
            size: ${activeTab === 'summary' ? 'A4 landscape' : 'A4 portrait'};
            margin: ${activeTab === 'summary' ? '6mm 8mm' : '10mm 12mm'};
          }
        }
      `}</style>

      {/* Control Card (Hidden during print) */}
      <div className="checkup-header-card no-print">
        <div className="checkup-title-row">
          <h2>🩺 หลักฐานการเบิกจ่ายเงินค่าตรวจสุขภาพประจำปี</h2>
          <div className="checkup-tabs">
            <button
              className={`checkup-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => { setActiveTab('summary'); setSinglePrintVn(null); }}
            >
              📑 ตารางรวม (หลักฐานเบิกจ่าย)
            </button>
            <button
              className={`checkup-tab-btn ${activeTab === 'individual' ? 'active' : ''}`}
              onClick={() => { setActiveTab('individual'); setSinglePrintVn(null); }}
            >
              👤 ใบรายบุคคล (ใบแสดงรายการ)
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="checkup-filter-grid">
          <div className="checkup-form-group">
            <label>วันที่เริ่มต้น</label>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </div>
          <div className="checkup-form-group">
            <label>วันที่สิ้นสุด</label>
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>
          <div className="checkup-form-group">
            <label>สิทธิการรักษา</label>
            <select value={selectedPttype} onChange={(e) => setSelectedPttype(e.target.value)}>
              <option value="OFC_LGO">ข้าราชการ / อปท. (OFC, LGO, CSCD, กทม.)</option>
              <option value="all">ทุกสิทธิการรักษา</option>
              {pttypesList.map((pt) => (
                <option key={pt.pttype} value={pt.pttype}>
                  [{pt.pttype}] {pt.name} ({pt.hipdata_code || pt.pcode || '-'})
                </option>
              ))}
            </select>
          </div>
          <div className="checkup-form-group">
            <label>ค้นหา (ชื่อ / HN / VN)</label>
            <input
              type="text"
              placeholder="พิมพ์ชื่อ นามสกุล หรือ HN..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchVisits()}
            />
          </div>
        </div>

        {/* Report Configuration (User editable header & signers matching Image 2) */}
        <div className="checkup-info-banner">
          ⚙️ <strong>ข้อมูลสำหรับพิมพ์ออกหัวกระดาษและส่วนท้าย (บันทึกจำอัตโนมัติ):</strong>
        </div>
        <div className="checkup-filter-grid">
          <div className="checkup-form-group">
            <label>ปี พ.ศ. ของรายงาน</label>
            <input type="text" value={checkupYear} onChange={(e) => setCheckupYear(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>ข้อความสิทธิ (ในวงเล็บหัวกระดาษ)</label>
            <input type="text" value={pttypeLabel} onChange={(e) => setPttypeLabel(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>ส่วนราชการ</label>
            <input type="text" value={govOrg} onChange={(e) => setGovOrg(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>อำเภอ</label>
            <input type="text" value={district} onChange={(e) => setDistrict(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>จังหวัด</label>
            <input type="text" value={province} onChange={(e) => setProvince(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>สถานที่ปฏิบัติงาน (บรรทัดบนหัวกระดาษ)</label>
            <input type="text" placeholder="ระบุหรือไม่ระบุก็ได้" value={workPlace} onChange={(e) => setWorkPlace(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>ผู้ลงนาม (พยาบาลวิชาชีพ)</label>
            <input type="text" placeholder="ชื่อ-สกุล" value={nurseName} onChange={(e) => setNurseName(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>ตำแหน่งวิชาชีพ</label>
            <input type="text" value={nursePos} onChange={(e) => setNursePos(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>ตำแหน่งบริหาร / หน้าที่</label>
            <input type="text" value={headPos} onChange={(e) => setHeadPos(e.target.value)} onBlur={handleSaveSettings} />
          </div>
        </div>

        {/* Patient Selection Strip (Explicit multi-selection) */}
        <div className="checkup-selector-section">
          <div className="selector-title-bar">
            <div>
              <strong>👥 เลือกผู้ตรวจสุขภาพที่จะพิมพ์ออกรายงาน:</strong>{' '}
              <span className="selection-badge">เลือกแล้ว <strong>{selectedVisits.length}</strong> จาก <strong>{visits.length}</strong> คน</span>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" className="checkup-btn btn-secondary btn-sm" onClick={() => handleToggleSelectAll(true)}>
                ✅ เลือกทั้งหมด ({visits.length})
              </button>
              <button type="button" className="checkup-btn btn-secondary btn-sm" onClick={() => handleToggleSelectAll(false)}>
                ❌ ยกเลิกทั้งหมด
              </button>
            </div>
          </div>
          {visits.length > 0 && (
            <div className="patient-selector-scroll">
              {visits.map((v, i) => {
                const isChecked = selectedVns.has(v.vn);
                return (
                  <label key={v.vn} className={`patient-select-item ${isChecked ? 'is-selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleVn(v.vn)}
                    />
                    <span className="p-num">{i + 1}.</span>
                    <span className="p-name">{v.fullname}</span>
                    <span className="p-age">({v.age_y}ปี)</span>
                    <span className="p-price">{v.total_price.toLocaleString()}.-</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="checkup-action-bar">
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="checkup-btn btn-primary" onClick={fetchVisits} disabled={loading}>
              {loading ? '⏳ กำลังค้นหา...' : '🔍 ค้นหาข้อมูล'}
            </button>
            <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
              ในรายงานจะแสดงและพิมพ์เฉพาะ <strong>{selectedVisits.length}</strong> คนที่เลือกไว้
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="checkup-btn btn-outline" onClick={handleExportCSV} disabled={selectedVisits.length === 0}>
              📥 ส่งออก Excel (CSV)
            </button>
            <button className="checkup-btn btn-success" onClick={() => handlePrint('summary')} disabled={selectedVisits.length === 0}>
              🖨️ พิมพ์ตารางรวม ({selectedVisits.length} คน)
            </button>
            <button className="checkup-btn btn-primary" onClick={() => handlePrint('individual')} disabled={selectedVisits.length === 0}>
              🖨️ พิมพ์ใบรายบุคคล ({selectedVisits.length} คน)
            </button>
          </div>
        </div>

        {error && <div style={{ color: '#ef4444', marginTop: '0.75rem', fontWeight: 600 }}>❌ {error}</div>}
      </div>

      {/* VIEW 1: TAB SUMMARY TABLE (MATCHING IMAGE 2 EXACTLY) */}
      {activeTab === 'summary' && (
        <div className="checkup-paper-card matrix-paper-card">
          {/* Top Line Meta matching Image 2 */}
          <div className="matrix-top-meta">
            <div className="matrix-meta-left">
              <span>ชื่อ - สกุล ................................................................</span>
            </div>
            <div className="matrix-meta-right">
              <span>สถานที่ปฏิบัติงาน {workPlace ? <strong>{workPlace}</strong> : '................................................................'}</span>
            </div>
          </div>
          <div className="matrix-top-meta" style={{ marginTop: '0.35rem' }}>
            <div className="matrix-meta-left">
              <span>
                วัน/เดือน/ปี ที่ตรวจ <strong>{formatThaiDate(dateStart)}</strong> {dateStart !== dateEnd && <>ถึง <strong>{formatThaiDate(dateEnd)}</strong></>}
              </span>
            </div>
          </div>

          {/* Report Main Title matching Image 2 */}
          <div className="matrix-report-header">
            <h3>หลักฐานการเบิกจ่ายเงินค่าตรวจสุขภาพประจำปี {checkupYear || '2569'} ( {pttypeLabel || 'NON UC'} )</h3>
            <p>
              ส่วนราชการ <strong>{govOrg}</strong> อ. <strong>{district}</strong> จ. <strong>{province}</strong>
            </p>
          </div>

          {/* Matrix Table matching Image 2 */}
          <div className="report-table-wrapper">
            <table className="matrix-report-table">
              <thead>
                {/* 1. Super Header Row */}
                <tr className="matrix-super-header-row">
                  <th rowSpan={2} style={{ width: '32px' }}>ลำดับ</th>
                  <th rowSpan={2} style={{ width: '150px' }}>ชื่อ-สกุล</th>
                  <th rowSpan={2} style={{ width: '45px' }}>อายุ<br />( ปี )</th>
                  <th colSpan={hasOtherItems ? 16 : 15} className="matrix-group-title">รายการตรวจ</th>
                  <th rowSpan={2} style={{ width: '65px' }}>รวม</th>
                </tr>

                {/* 3. Sub Header: Test Names matching Image 2 */}
                <tr className="matrix-test-names-row">
                  {CHECKUP_MATRIX_COLUMNS.map((c) => (
                    <th key={c.id} className="test-name-th">
                      {c.name}
                    </th>
                  ))}
                  {hasOtherItems && <th className="test-name-th">อื่นๆ</th>}
                </tr>
              </thead>
              <tbody>
                {selectedVisits.length === 0 ? (
                  <tr>
                    <td colSpan={hasOtherItems ? 20 : 19} className="text-center" style={{ padding: '2.5rem', color: '#94a3b8' }}>
                      {visits.length === 0
                        ? (loading ? 'กำลังดึงข้อมูล...' : 'ไม่พบข้อมูลการตรวจสุขภาพในช่วงเวลาและสิทธิที่เลือก')
                        : '⚠️ ยังไม่ได้เลือกรายชื่อผู้รับการตรวจ (กรุณากดเลือกผู้ตรวจสุขภาพจากกล่องด้านบน)'}
                    </td>
                  </tr>
                ) : (
                  selectedVisits.map((v, index) => {
                    const { colValues, otherSum, total } = getVisitMatrixValues(v);
                    return (
                      <tr key={v.vn} className="matrix-row">
                        <td className="text-center">{index + 1}</td>
                        <td className="td-name">{v.fullname}</td>
                        <td className="text-center">{v.age_y}</td>
                        {CHECKUP_MATRIX_COLUMNS.map((c) => {
                          const val = colValues[c.id] || 0;
                          return (
                            <td key={c.id} className={`td-val ${val === 0 ? 'td-zero' : 'td-positive'}`}>
                              {val}
                            </td>
                          );
                        })}
                        {hasOtherItems && (
                          <td className={`td-val ${otherSum === 0 ? 'td-zero' : 'td-positive'}`}>
                            {otherSum}
                          </td>
                        )}
                        <td className="td-total">
                          {total.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="matrix-tfoot-row">
                  <td colSpan={3} className="text-center font-bold">รวมทั้งสิ้น</td>
                  <td colSpan={hasOtherItems ? 16 : 15} className="text-center font-bold" style={{ fontSize: '9pt' }}>
                    ({totalAmountText})
                  </td>
                  <td className="td-total font-bold" style={{ fontSize: '9.5pt' }}>
                    {totalAmount.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Single Signature Block at Bottom Right (Matching Image 2) */}
          <div className="matrix-signature-container">
            <div className="matrix-sig-box">
              <div className="sig-line">(ลงชื่อ) ................................................................</div>
              <div className="sig-name">( {nurseName || '................................................................'} )</div>
              <div className="sig-pos">{nursePos}</div>
              <div className="sig-head">{headPos}</div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: TAB INDIVIDUAL CERTIFICATE (PRINT BATCH OR SINGLE) */}
      {activeTab === 'individual' && (
        <div>
          {/* Individual view filter bar if multiple */}
          <div className="no-print" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div>
              <strong>โหมดแสดงใบรายบุคคล:</strong>{' '}
              {singlePrintVn ? (
                <span>กำลังดูเฉพาะของ VN: {singlePrintVn}</span>
              ) : (
                <span>แสดงทุกคนที่เลือก ({selectedVisits.length} คน) เพื่อพิมพ์ชุด</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {singlePrintVn && (
                <button className="checkup-btn btn-secondary" onClick={() => setSinglePrintVn(null)}>
                  แสดงทุกคน
                </button>
              )}
              <button className="checkup-btn btn-primary" onClick={() => window.print()}>
                🖨️ พิมพ์ออกกระดาษ
              </button>
            </div>
          </div>

          {/* Render Individual Slips */}
          {(singlePrintVn ? selectedVisits.filter((v) => v.vn === singlePrintVn) : selectedVisits).map((v) => {
            const allItems: CheckupItem[] = [
              ...v.xray_items,
              ...v.lab_items,
              ...v.other_items
            ];

            return (
              <div key={v.vn} className="individual-slip">
                <div className="slip-header">
                  <h4>ใบแสดงรายการตรวจสุขภาพประจำปี</h4>
                  <p style={{ margin: '0.2rem 0', fontSize: '0.95rem' }}>
                    ส่วนราชการ <strong>{govOrg}</strong> อำเภอ <strong>{district}</strong> จังหวัด <strong>{province}</strong>
                  </p>
                </div>

                <div className="slip-meta-grid">
                  <div className="slip-meta-row">
                    <span className="slip-meta-label">ชื่อ - นามสกุล:</span>
                    <strong>{v.fullname}</strong>
                  </div>
                  <div className="slip-meta-row">
                    <span className="slip-meta-label">HN / VN:</span>
                    <span>{v.hn} (VN: {v.vn})</span>
                  </div>
                  <div className="slip-meta-row">
                    <span className="slip-meta-label">วันเดือนปีเกิด:</span>
                    <span>{v.birthday ? formatThaiDate(v.birthday) : '-'}</span>
                  </div>
                  <div className="slip-meta-row">
                    <span className="slip-meta-label">อายุ:</span>
                    <span><strong>{v.age_y}</strong> ปี {v.age_m > 0 && <><strong>{v.age_m}</strong> เดือน</>}</span>
                  </div>
                  <div className="slip-meta-row">
                    <span className="slip-meta-label">วันที่รับการตรวจ:</span>
                    <span><strong>{formatThaiDate(v.vstdate)}</strong></span>
                  </div>
                  <div className="slip-meta-row">
                    <span className="slip-meta-label">สถานที่ปฏิบัติงาน:</span>
                    <span>{govOrg}</span>
                  </div>
                  <div className="slip-meta-row" style={{ gridColumn: 'span 2' }}>
                    <span className="slip-meta-label">สิทธิการรักษา:</span>
                    <span>{v.pttype_name} (เบิกหน่วยงานต้นสังกัด)</span>
                  </div>
                </div>

                {/* Details Table */}
                <table className="slip-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>ลำดับ</th>
                      <th>รายการที่ตรวจ</th>
                      <th style={{ width: '130px' }}>ราคา (บาท)</th>
                      <th style={{ width: '140px' }}>ขอเบิก (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allItems.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center" style={{ padding: '1.5rem', color: '#94a3b8' }}>
                          ไม่มีรายการตรวจที่บันทึกไว้
                        </td>
                      </tr>
                    ) : (
                      allItems.map((item, itemIdx) => (
                        <tr key={itemIdx}>
                          <td className="text-center">{itemIdx + 1}</td>
                          <td>
                            {item.category === 'xray' && '📸 [X-Ray] '}
                            {item.category === 'lab' && '🔬 [Lab] '}
                            {item.name}
                          </td>
                          <td className="text-right">
                            {item.price.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          {/* ช่องขอเบิก เว้นว่างไว้ตามข้อกำหนด */}
                          <td className="text-center" style={{ color: '#cbd5e1' }}>
                            &nbsp;
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} className="text-right font-bold">
                        รวมเงินทั้งสิ้น
                        <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600 }}>
                          ({thaiBahtText(v.total_price)})
                        </div>
                      </td>
                      <td className="text-right font-bold" style={{ fontSize: '1rem' }}>
                        {v.total_price.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="text-center" style={{ color: '#cbd5e1' }}>
                        &nbsp;
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* Footer Signatures */}
                <div className="slip-footer">
                  <div style={{ textAlign: 'center', width: '260px' }}>
                    <div>(ลงชื่อ) ................................................................ ผู้ขอรับการตรวจ</div>
                    <div style={{ margin: '1rem 0 0.3rem 0' }}>({v.fullname})</div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>วันที่ ......./......./............</div>
                  </div>

                  <div style={{ textAlign: 'center', width: '280px' }}>
                    <div>(ลงชื่อ) ................................................................ ผู้รับรอง / ผู้ตรวจ</div>
                    <div style={{ margin: '1rem 0 0.3rem 0' }}>({nurseName || '................................................................'})</div>
                    <div>ตำแหน่ง {nursePos || 'พยาบาลวิชาชีพ'}</div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>วันที่ ......./......./............</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
export default AnnualHealthCheckupReportPage;
