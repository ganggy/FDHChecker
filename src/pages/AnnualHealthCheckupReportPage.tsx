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

const STORAGE_KEYS = {
  GOV_ORG: 'checkup_gov_org',
  DISTRICT: 'checkup_district',
  PROVINCE: 'checkup_province',
  NURSE_NAME: 'checkup_nurse_name',
  NURSE_POS: 'checkup_nurse_pos',
  HEAD_NAME: 'checkup_head_name',
  HEAD_POS: 'checkup_head_pos',
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
  const [govOrg, setGovOrg] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.GOV_ORG) || 'โรงพยาบาลโคกศรีสุพรรณ');
  const [district, setDistrict] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.DISTRICT) || 'โคกศรีสุพรรณ');
  const [province, setProvince] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.PROVINCE) || 'สกลนคร');
  const [nurseName, setNurseName] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.NURSE_NAME) || '');
  const [nursePos, setNursePos] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.NURSE_POS) || 'พยาบาลวิชาชีพชำนาญการ');
  const [headName, setHeadName] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.HEAD_NAME) || '');
  const [headPos, setHeadPos] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.HEAD_POS) || 'หัวหน้ากลุ่มงานการพยาบาล');

  // Save header settings
  const handleSaveSettings = () => {
    localStorage.setItem(STORAGE_KEYS.GOV_ORG, govOrg);
    localStorage.setItem(STORAGE_KEYS.DISTRICT, district);
    localStorage.setItem(STORAGE_KEYS.PROVINCE, province);
    localStorage.setItem(STORAGE_KEYS.NURSE_NAME, nurseName);
    localStorage.setItem(STORAGE_KEYS.NURSE_POS, nursePos);
    localStorage.setItem(STORAGE_KEYS.HEAD_NAME, headName);
    localStorage.setItem(STORAGE_KEYS.HEAD_POS, headPos);
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
      'ลำดับ', 'วันที่รับบริการ', 'HN', 'VN', 'ชื่อ-นามสกุล', 'อายุ(ปี)', 'สิทธิการรักษา',
      'รายการ X-Ray', 'ค่าตรวจ X-Ray', 'รายการตรวจ Lab', 'ค่าตรวจ Lab', 'รายการอื่นๆ', 'ค่าตรวจอื่นๆ', 'รวมเงิน(บาท)'
    ];

    const rows = selectedVisits.map((v, i) => [
      i + 1,
      v.vstdate,
      v.hn,
      v.vn,
      v.fullname,
      v.age_y,
      v.pttype_name,
      v.xray_items.map((x) => `${x.name} (${x.price}บ.)`).join('; '),
      v.xray_total,
      v.lab_items.map((l) => `${l.name} (${l.price}บ.)`).join('; '),
      v.lab_total,
      v.other_items.map((o) => `${o.name} (${o.price}บ.)`).join('; '),
      v.other_total,
      v.total_price
    ]);

    const csvContent = '\uFEFF' + [headers, ...rows].map((e) => e.map((x) => `"${String(x || '').replace(/"/g, '""')}"`).join(',')).join('\n');
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
    <div className="checkup-page">
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

        {/* Report Configuration (User editable header & signers) */}
        <div className="checkup-info-banner">
          ⚙️ <strong>ข้อมูลสำหรับพิมพ์ออกหัวกระดาษและส่วนท้าย:</strong> สามารถพิมพ์แก้ไขได้ ระบบจะบันทึกจำไว้ใช้อัตโนมัติ
        </div>
        <div className="checkup-filter-grid">
          <div className="checkup-form-group">
            <label>ส่วนราชการ / โรงพยาบาล</label>
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
            <label>ผู้ตรวจสอบ (พยาบาลวิชาชีพ)</label>
            <input type="text" placeholder="ชื่อ-สกุล" value={nurseName} onChange={(e) => setNurseName(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>ตำแหน่งผู้ตรวจสอบ</label>
            <input type="text" value={nursePos} onChange={(e) => setNursePos(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>หัวหน้าพยาบาล / ผู้มีอำนาจลงนาม</label>
            <input type="text" placeholder="ชื่อ-สกุล" value={headName} onChange={(e) => setHeadName(e.target.value)} onBlur={handleSaveSettings} />
          </div>
          <div className="checkup-form-group">
            <label>ตำแหน่งหัวหน้าพยาบาล</label>
            <input type="text" value={headPos} onChange={(e) => setHeadPos(e.target.value)} onBlur={handleSaveSettings} />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="checkup-action-bar">
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="checkup-btn btn-primary" onClick={fetchVisits} disabled={loading}>
              {loading ? '⏳ กำลังค้นหา...' : '🔍 ค้นหาข้อมูล'}
            </button>
            <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
              พบทั้งหมด <strong>{visits.length}</strong> รายการ (เลือกแล้ว <strong>{selectedVisits.length}</strong> คน)
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

      {/* VIEW 1: TAB SUMMARY TABLE */}
      {activeTab === 'summary' && (
        <div className="checkup-paper-card">
          <div className="report-paper-header">
            <h3>หลักฐานการเบิกจ่ายเงินค่าตรวจสุขภาพประจำปี</h3>
            <p>
              ส่วนราชการ <strong>{govOrg || '...........................................'}</strong> อำเภอ <strong>{district || '........................'}</strong> จังหวัด <strong>{province || '........................'}</strong>
            </p>
            <p>
              ประจำวันที่ <strong>{formatThaiDate(dateStart)}</strong> {dateStart !== dateEnd && <>ถึง <strong>{formatThaiDate(dateEnd)}</strong></>}
            </p>
          </div>

          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }} className="no-print">
                    <input
                      type="checkbox"
                      checked={visits.length > 0 && selectedVns.size === visits.length}
                      onChange={(e) => handleToggleSelectAll(e.target.checked)}
                      title="เลือกทั้งหมด"
                    />
                  </th>
                  <th style={{ width: '45px' }}>ลำดับ</th>
                  <th style={{ width: '90px' }}>วันที่ตรวจ</th>
                  <th style={{ width: '80px' }}>HN / VN</th>
                  <th style={{ width: '160px' }}>ชื่อ - สกุล</th>
                  <th style={{ width: '55px' }}>อายุ</th>
                  <th style={{ width: '130px' }}>สิทธิการรักษา</th>
                  <th style={{ width: '220px' }}>รายการ X-Ray (ราคา)</th>
                  <th>รายการตรวจ Lab แบบละเอียด (ราคา)</th>
                  <th style={{ width: '100px' }}>รวมเงิน (บาท)</th>
                  <th style={{ width: '70px' }} className="no-print">ใบรายคน</th>
                </tr>
              </thead>
              <tbody>
                {visits.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center" style={{ padding: '2rem', color: '#94a3b8' }}>
                      {loading ? 'กำลังดึงข้อมูล...' : 'ไม่พบข้อมูลการตรวจสุขภาพในช่วงเวลาและสิทธิที่เลือก'}
                    </td>
                  </tr>
                ) : (
                  visits.map((v, index) => {
                    const isChecked = selectedVns.has(v.vn);
                    return (
                      <tr key={v.vn} style={{ opacity: isChecked ? 1 : 0.45 }}>
                        <td className="text-center no-print">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleVn(v.vn)}
                          />
                        </td>
                        <td className="text-center">{index + 1}</td>
                        <td className="text-center">{v.vstdate}</td>
                        <td className="text-center">
                          <div style={{ fontWeight: 600 }}>{v.hn}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{v.vn}</div>
                        </td>
                        <td>
                          <strong>{v.fullname}</strong>
                        </td>
                        <td className="text-center">{v.age_y} ปี</td>
                        <td style={{ fontSize: '0.8rem' }}>{v.pttype_name}</td>

                        {/* X-Ray Column */}
                        <td>
                          {v.xray_items.length === 0 ? (
                            <span style={{ color: '#94a3b8' }}>-</span>
                          ) : (
                            <ul className="item-tag-list">
                              {v.xray_items.map((x, xi) => (
                                <li key={xi} className="item-tag">
                                  <span>• {x.name}</span>
                                  <span className="item-price">{x.price.toLocaleString()} ฿</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>

                        {/* Lab Column (Detailed list without results, with prices) */}
                        <td>
                          {v.lab_items.length === 0 ? (
                            <span style={{ color: '#94a3b8' }}>-</span>
                          ) : (
                            <ul className="item-tag-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.35rem 0.75rem' }}>
                              {v.lab_items.map((l, li) => (
                                <li key={li} className="item-tag">
                                  <span>• {l.name}</span>
                                  <span className="item-price">{l.price.toLocaleString()} ฿</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>

                        {/* Total Amount per Visit */}
                        <td className="text-right font-bold" style={{ fontSize: '0.95rem', color: '#0f172a' }}>
                          {v.total_price.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        {/* Action Column */}
                        <td className="text-center no-print">
                          <button
                            className="checkup-btn btn-secondary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => handlePrint('individual', v.vn)}
                            title="ดูใบรายบุคคล"
                          >
                            👁️ ดูใบ
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 'bold' }}>
                  <td colSpan={2} className="no-print"></td>
                  <td colSpan={7} className="text-right" style={{ fontSize: '0.95rem' }}>
                    รวมทั้งสิ้น ({selectedVisits.length} คน)
                    <div style={{ fontSize: '0.85rem', color: '#0369a1', fontWeight: 600 }}>
                      ({totalAmountText})
                    </div>
                  </td>
                  <td className="text-right font-bold" style={{ fontSize: '1.1rem', color: '#0369a1' }}>
                    {totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                  </td>
                  <td className="no-print"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Signatures for Summary Report */}
          <div className="report-signatures">
            <div className="sig-col">
              <div>ลงชื่อ ................................................................ ผู้ตรวจสอบ</div>
              <div className="sig-dots">({nurseName || '................................................................'})</div>
              <div>ตำแหน่ง {nursePos || 'พยาบาลวิชาชีพชำนาญการ'}</div>
            </div>

            <div className="sig-col">
              <div>ลงชื่อ ................................................................ ผู้มีอำนาจลงนาม</div>
              <div className="sig-dots">({headName || '................................................................'})</div>
              <div>ตำแหน่ง {headPos || 'หัวหน้ากลุ่มงานการพยาบาล'}</div>
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
