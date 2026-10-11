import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import './HsubPaymentReconcilePage.css';

interface HsubHospitalSummary {
  hcode: string;
  hospital_name: string;
  record_count: number;
  claim_total: number;
  hc_drug_total: number;
  ae_total: number;
  ae_drug_total: number;
  inst_total: number;
  pp_total: number;
  fs_total: number;
  op_total: number;
  ip_total: number;
  dmis_total: number;
  palliative_total: number;
  total_paid: number;
}

interface HsubFundCategorySummary {
  category_key: string;
  category_name: string;
  description: string;
  moph_account_suggested: string;
  moph_desc_suggested: string;
  record_count: number;
  total_amount: number;
  percentage: number;
}

interface HsubEbudgetMatchRow {
  rep: string;
  hsub_record_count: number;
  hsub_total_paid: number;
  hsub_hcodes: string[];
  hsub_fund_tags: string[];
  ebudget_matched: boolean;
  match_type: 'exact_rep' | 'fiscal_group' | 'unmatched';
  ebudget_batch_no?: string;
  ebudget_ref_doc_no?: string;
  ebudget_fund_name?: string;
  ebudget_moph_id?: string;
  ebudget_moph_desc?: string;
  ebudget_net_total?: number;
  ebudget_posting_date?: string;
  explanation: string;
}

interface HsubDashboardSummary {
  total_files: number;
  total_records: number;
  total_claim: number;
  total_paid: number;
  hospital_count: number;
  hospitals: HsubHospitalSummary[];
  fund_categories: HsubFundCategorySummary[];
  ebudget_matches: HsubEbudgetMatchRow[];
  latest_import_date?: string;
}

interface HsubPaymentItem {
  id?: number;
  filename: string;
  rep: string;
  item_no?: number | null;
  tran_id: string;
  hn?: string | null;
  an?: string | null;
  pid?: string | null;
  patient_name?: string | null;
  service_date?: string | null;
  discharge_date?: string | null;
  maininscl?: string | null;
  projcode?: string | null;
  hcode: string;
  claim_amt: number;
  hc_drug: number;
  ae_amt: number;
  ae_drug: number;
  inst_amt: number;
  pp_amt: number;
  fs_amt: number;
  total_paid: number;
  section_type: 'normal' | 'appeal';
}

export const HsubPaymentReconcilePage: React.FC = () => {
  const [summary, setSummary] = useState<HsubDashboardSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // File upload & drag-drop state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    filename: string;
    percentage: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showServerModal, setShowServerModal] = useState<boolean>(false);
  const [serverPath, setServerPath] = useState<string>('D:\\hsub');

  // Tabs: 'hospitals' | 'ebudget' | 'transactions'
  const [activeTab, setActiveTab] = useState<'hospitals' | 'ebudget' | 'transactions'>('hospitals');

  // Filters
  const [selectedHcode, setSelectedHcode] = useState<string>('all');
  const [selectedRep, setSelectedRep] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Transactions pagination
  const [transactions, setTransactions] = useState<HsubPaymentItem[]>([]);
  const [txTotal, setTxTotal] = useState<number>(0);
  const [txPage, setTxPage] = useState<number>(1);
  const [txLimit] = useState<number>(50);
  const [txLoading, setTxLoading] = useState<boolean>(false);

  // Load summary
  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedHcode !== 'all') params.append('hcode', selectedHcode);
      if (selectedRep !== 'all') params.append('rep', selectedRep);

      const res = await fetch(`/api/hsub/summary?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูลสรุปพึงจ่าย รพ.สต. ได้');
      }
      setSummary(json.data);
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [selectedHcode, selectedRep]);

  // Load transactions
  const loadTransactions = useCallback(async () => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(txPage),
        limit: String(txLimit),
      });
      if (selectedHcode !== 'all') params.append('hcode', selectedHcode);
      if (selectedRep !== 'all') params.append('rep', selectedRep);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await fetch(`/api/hsub/transactions?${params.toString()}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setTransactions(json.data.rows || []);
        setTxTotal(json.data.total || 0);
      }
    } catch (err) {
      console.error('Error loading transactions:', err);
    } finally {
      setTxLoading(false);
    }
  }, [txPage, txLimit, selectedHcode, selectedRep, searchQuery]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (activeTab === 'transactions') {
      loadTransactions();
    }
  }, [activeTab, loadTransactions]);

  // Client-side Excel File Processing
  const processFiles = async (files: File[]) => {
    const excelFiles = files.filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv');
    });

    if (excelFiles.length === 0) {
      setError('กรุณาเลือกไฟล์ Excel หรือ CSV (.xls, .xlsx, .csv)');
      return;
    }

    setImporting(true);
    setError(null);
    setImportFeedback(null);

    let totalImported = 0;
    let totalRecords = 0;
    let totalPaid = 0;
    const errors: string[] = [];

    for (let i = 0; i < excelFiles.length; i++) {
      const file = excelFiles[i];
      const percent = Math.round(((i + 1) / excelFiles.length) * 100);
      setUploadProgress({
        current: i + 1,
        total: excelFiles.length,
        filename: file.name,
        percentage: percent,
      });

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          throw new Error('ไม่พบแผ่นงาน (Sheet) ในไฟล์');
        }
        const sheet = workbook.Sheets[firstSheetName];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];

        const res = await fetch('/api/hsub/import-raw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            data: rawData,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'นำเข้าไม่สำเร็จ');
        }

        const d = json.data;
        totalImported += d.imported_files || 1;
        totalRecords += d.total_records || 0;
        totalPaid += d.total_paid || 0;
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    setUploadProgress(null);
    setImporting(false);

    let feedbackMsg = `นำเข้าสำเร็จ ${totalImported}/${excelFiles.length} ไฟล์ (${totalRecords.toLocaleString()} รายการ, ยอดพึงจ่าย ฿${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    if (errors.length > 0) {
      feedbackMsg += ` [พบข้อผิดพลาด ${errors.length} ไฟล์: ${errors.slice(0, 3).join(', ')}]`;
    }
    setImportFeedback(feedbackMsg);

    await loadSummary();
    if (activeTab === 'transactions') {
      await loadTransactions();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      processFiles(files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    }
  };

  // Handle Import from server directory
  const handleImportDir = async () => {
    if (importing) return;
    setImporting(true);
    setImportFeedback(null);
    setError(null);
    setShowServerModal(false);
    try {
      const res = await fetch('/api/hsub/import-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: serverPath.trim() || 'D:\\hsub' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'นำเข้าไฟล์ล้มเหลว');
      }
      const d = json.data;
      setImportFeedback(
        `นำเข้าสำเร็จ! ประมวลผล ${d.imported_files}/${d.total_files} ไฟล์ (${d.total_records.toLocaleString()} รายการ, ยอดพึงจ่าย ฿${d.total_paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
      );
      await loadSummary();
      if (activeTab === 'transactions') {
        await loadTransactions();
      }
    } catch (err: any) {
      setError(err.message || 'นำเข้าข้อมูลไม่สำเร็จ');
    } finally {
      setImporting(false);
    }
  };


  // Export Excel
  const handleExportExcel = () => {
    if (!summary) return;
    const wb = XLSX.utils.book_new();

    // 1. Sheet สรุปจัดสรร รพ.สต.
    const hospData = summary.hospitals.map((h) => ({
      'รหัส รพ.สต.': h.hcode,
      'ชื่อหน่วยบริการ': h.hospital_name,
      'จำนวนรายการ': h.record_count,
      'ยอดเรียกเก็บ (บาท)': h.claim_total,
      'ค่ายา Home Care (บาท)': h.hc_drug_total,
      'อุบัติเหตุฉุกเฉิน AE (บาท)': h.ae_total,
      'ยาฉุกเฉิน AE (บาท)': h.ae_drug_total,
      'อุปกรณ์ INST (บาท)': h.inst_total,
      'ส่งเสริม PP (บาท)': h.pp_total,
      'ยอดชดเชยสุทธิ (บาท)': h.total_paid,
      'สัดส่วน (%)': summary.total_paid > 0 ? Number(((h.total_paid / summary.total_paid) * 100).toFixed(2)) : 0,
    }));
    const wsHosp = XLSX.utils.json_to_sheet(hospData);
    XLSX.utils.book_append_sheet(wb, wsHosp, 'สรุปจัดสรร รพ.สต.');

    // 2. Sheet เทียบหมวดเงิน e-Budget
    const matchData = summary.ebudget_matches.map((m) => ({
      'เลขหนังสือ REP': m.rep,
      'จำนวนรายการ': m.hsub_record_count,
      'ยอดพึงจ่าย H-Sub': m.hsub_total_paid,
      'รพ.สต. ที่ได้รับ': m.hsub_hcodes.join(', '),
      'หมวดเงินในรายงาน': m.hsub_fund_tags.join(', '),
      'สถานะจับคู่': m.match_type === 'exact_rep' ? 'ตรงตัวใน e-Budget' : m.match_type === 'fiscal_group' ? 'งวดโอนงบเหมาจ่าย' : 'งบปฐมภูมิ/รอโอน',
      'Batch e-Budget': m.ebudget_batch_no || '-',
      'Ref Doc e-Budget': m.ebudget_ref_doc_no || '-',
      'กองทุน e-Budget': m.ebudget_fund_name || '-',
      'รหัสบัญชี สธ.': m.ebudget_moph_id || '-',
      'ชื่อบัญชี สธ.': m.ebudget_moph_desc || '-',
      'คำอธิบาย': m.explanation,
    }));
    const wsMatch = XLSX.utils.json_to_sheet(matchData);
    XLSX.utils.book_append_sheet(wb, wsMatch, 'เทียบ e-Budget');

    // 3. Sheet หมวดเงิน
    const fundData = summary.fund_categories.map((c) => ({
      'หมวดเงิน': c.category_name,
      'คำอธิบาย': c.description,
      'ผังบัญชี สธ. ที่แนะนำ': c.moph_account_suggested,
      'ชื่อบัญชี สธ.': c.moph_desc_suggested,
      'จำนวนรายการ': c.record_count,
      'ยอดเงิน (บาท)': c.total_amount,
      'สัดส่วน (%)': c.percentage,
    }));
    const wsFund = XLSX.utils.json_to_sheet(fundData);
    XLSX.utils.book_append_sheet(wb, wsFund, 'หมวดเงิน');

    XLSX.writeFile(wb, `รายงานพึงจ่าย_รพสต_CUP_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Unique REPs for filter dropdown
  const uniqueReps = useMemo(() => {
    if (!summary?.ebudget_matches) return [];
    return summary.ebudget_matches.map((m) => m.rep);
  }, [summary]);

  const totalPages = Math.ceil(txTotal / txLimit);

  return (
    <div className="hsub-page">
      {/* Header */}
      <div className="hsub-header">
        <div>
          <span className="hsub-title-badge">CUP Network Sub-Center Statements</span>
          <h1 className="hsub-title">
            🏥 รายงานพึงจ่าย รพ.สต. (H-Sub) & เทียบหมวดเงิน e-Budget
          </h1>
          <p className="hsub-subtitle">
            ประมวลผลรายงาน Statement พึงจ่าย รพ.สต. (โฟลเดอร์ <code>D:\hsub</code>) เครือข่าย CUP โรงพยาบาลโคกศรีสุพรรณ
            แยกตาม รพ.สต. (05569 - 05573) และจับคู่กระทบยอดกับ e-Budget สปสช. เพื่อชี้แจงแหล่งเงินและผังบัญชี
          </p>
        </div>
        <div className="hsub-header-actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xls,.xlsx,.csv"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
          <button
            className="hsub-btn hsub-btn-import"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? '⏳ กำลังประมวลผลนำเข้า...' : '📁 เลือกไฟล์จากเครื่อง (เลือกหลายไฟล์ได้)'}
          </button>
          <button
            className="hsub-btn hsub-btn-secondary"
            onClick={() => setShowServerModal(true)}
            disabled={importing}
          >
            🖥️ โฟลเดอร์เซิร์ฟเวอร์
          </button>
          <button
            className="hsub-btn hsub-btn-export"
            onClick={handleExportExcel}
            disabled={!summary || summary.total_records === 0}
          >
            📊 ส่งออก Excel
          </button>
        </div>
      </div>

      {/* Drag & Drop Zone */}
      <div
        className={`hsub-dropzone ${isDragging ? 'active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="hsub-dropzone-icon">📥</div>
        <div className="hsub-dropzone-text">ลากไฟล์ Excel / CSV (.xls, .xlsx, .csv) ของ รพ.สต. มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</div>
        <div className="hsub-dropzone-hint">
          รองรับการเลือกทีละหลายไฟล์พร้อมกันจากโฟลเดอร์ <code>D:\hsub</code> หรือที่จัดเก็บในเครื่องของคุณ
        </div>
      </div>

      {/* Upload Progress Bar */}
      {uploadProgress && (
        <div className="hsub-progress-box">
          <div className="hsub-progress-header">
            <span>⏳ กำลังนำเข้า: <strong>{uploadProgress.filename}</strong></span>
            <span>{uploadProgress.current} / {uploadProgress.total} ไฟล์ ({uploadProgress.percentage}%)</span>
          </div>
          <div className="hsub-progress-bar-bg">
            <div className="hsub-progress-bar-fill" style={{ width: `${uploadProgress.percentage}%` }} />
          </div>
        </div>
      )}

      {/* Feedback Messages */}
      {loading && (
        <div className="hsub-banner hsub-banner-success">
          <span>⏳</span>
          <span>กำลังโหลดข้อมูลสรุปพึงจ่าย รพ.สต. ...</span>
        </div>
      )}
      {importFeedback && (
        <div className="hsub-banner hsub-banner-success">
          <span>✅</span>
          <span>{importFeedback}</span>
        </div>
      )}
      {error && (
        <div className="hsub-banner hsub-banner-error">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* KPI Overview Grid */}
      <div className="hsub-kpi-grid">
        <div className="hsub-kpi-card primary">
          <div className="hsub-kpi-label">ยอดพึงจ่ายรวมสุทธิ (Total Paid)</div>
          <div className="hsub-kpi-value">
            ฿{summary ? Number(summary.total_paid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
          </div>
          <div className="hsub-kpi-sub">
            {summary && summary.total_claim > 0
              ? `คิดเป็น ${((summary.total_paid / summary.total_claim) * 100).toFixed(1)}% ของยอดเรียกเก็บ`
              : 'ยอดเงินที่ต้องจัดสรรให้ รพ.สต.'}
          </div>
        </div>

        <div className="hsub-kpi-card secondary">
          <div className="hsub-kpi-label">ยอดเรียกเก็บรวม (Total Claimed)</div>
          <div className="hsub-kpi-value">
            ฿{summary ? Number(summary.total_claim).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
          </div>
          <div className="hsub-kpi-sub">
            {summary ? `${summary.total_records.toLocaleString()} รายการบริการ` : '-'}
          </div>
        </div>

        <div className="hsub-kpi-card accent">
          <div className="hsub-kpi-label">รพ.สต. ในเครือข่าย CUP</div>
          <div className="hsub-kpi-value">
            {summary ? summary.hospitals.length : 0} แห่ง
          </div>
          <div className="hsub-kpi-sub">
            {summary ? `นำเข้าแล้ว ${summary.total_files} ไฟล์ Statement` : '-'}
          </div>
        </div>

        <div className="hsub-kpi-card warning">
          <div className="hsub-kpi-label">หมวดค่ายา Home Care (98.8%)</div>
          <div className="hsub-kpi-value">
            ฿{summary?.fund_categories.find(f => f.category_key === 'hc_drug')?.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
          </div>
          <div className="hsub-kpi-sub">
            ค่ายาและเวชภัณฑ์ผู้ป่วยที่บ้าน
          </div>
        </div>

        <div className="hsub-kpi-card success">
          <div className="hsub-kpi-label">หมวดส่งเสริม PP & ฉุกเฉิน AE</div>
          <div className="hsub-kpi-value">
            ฿{
              summary
                ? (
                    (summary.fund_categories.find(f => f.category_key === 'pp_amt')?.total_amount || 0) +
                    (summary.fund_categories.find(f => f.category_key === 'ae_amt')?.total_amount || 0) +
                    (summary.fund_categories.find(f => f.category_key === 'ae_drug')?.total_amount || 0)
                  ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '0.00'
            }
          </div>
          <div className="hsub-kpi-sub">
            งบสร้างเสริมสุขภาพ + ฉุกเฉินปฐมภูมิ
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="hsub-tabs">
        <button
          className={`hsub-tab-btn ${activeTab === 'hospitals' ? 'active' : ''}`}
          onClick={() => setActiveTab('hospitals')}
        >
          🏥 สรุปจัดสรรตาม รพ.สต. ({summary?.hospitals.length || 0} แห่ง)
        </button>
        <button
          className={`hsub-tab-btn ${activeTab === 'ebudget' ? 'active' : ''}`}
          onClick={() => setActiveTab('ebudget')}
        >
          🏦 เทียบหมวดเงิน e-Budget / แหล่งเงิน ({summary?.ebudget_matches.length || 0} REP)
        </button>
        <button
          className={`hsub-tab-btn ${activeTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          📋 รายการธุรกรรมรายบุคคล ({txTotal.toLocaleString()} รายการ)
        </button>
      </div>

      {/* Filters Bar */}
      <div className="hsub-filters-bar">
        <div className="hsub-filter-group">
          <label htmlFor="hsub-filter-hcode">รพ.สต.:</label>
          <select
            id="hsub-filter-hcode"
            className="hsub-select"
            value={selectedHcode}
            onChange={(e) => {
              setSelectedHcode(e.target.value);
              setTxPage(1);
            }}
          >
            <option value="all">ทั้งหมด (5 แห่ง)</option>
            {summary?.hospitals.map((h) => (
              <option key={h.hcode} value={h.hcode}>
                {h.hospital_name} ({h.hcode})
              </option>
            ))}
          </select>
        </div>

        <div className="hsub-filter-group">
          <label htmlFor="hsub-filter-rep">หนังสือ REP:</label>
          <select
            id="hsub-filter-rep"
            className="hsub-select"
            value={selectedRep}
            onChange={(e) => {
              setSelectedRep(e.target.value);
              setTxPage(1);
            }}
          >
            <option value="all">ทุกหนังสือ REP</option>
            {uniqueReps.map((r) => (
              <option key={r} value={r}>
                REP {r}
              </option>
            ))}
          </select>
        </div>

        {activeTab === 'transactions' && (
          <div className="hsub-filter-group" style={{ marginLeft: 'auto' }}>
            <input
              type="text"
              className="hsub-input"
              placeholder="ค้นหา HN, เลขบัตร ปชช., ชื่อ, TRAN ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setTxPage(1);
                  loadTransactions();
                }
              }}
            />
            <button
              className="hsub-btn hsub-btn-export"
              onClick={() => {
                setTxPage(1);
                loadTransactions();
              }}
            >
              🔍 ค้นหา
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: Hospitals Allocation Summary */}
      {activeTab === 'hospitals' && (
        <div className="hsub-card">
          <h2 className="hsub-card-title">
            <span>🏥</span> สรุปยอดเงินพึงจ่ายจัดสรรให้ รพ.สต. ในเครือข่าย CUP (รหัส 05569 - 05573)
          </h2>
          <div className="hsub-table-responsive">
            <table className="hsub-table">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>หน่วยบริการ (รพ.สต.)</th>
                  <th className="text-right">จำนวนรายการ</th>
                  <th className="text-right">ยอดเรียกเก็บ (บาท)</th>
                  <th className="text-right">ค่ายา Home Care</th>
                  <th className="text-right">ฉุกเฉิน AE</th>
                  <th className="text-right">ยาฉุกเฉิน</th>
                  <th className="text-right">อุปกรณ์</th>
                  <th className="text-right">ส่งเสริม PP</th>
                  <th className="text-right">รวมพึงจ่าย (บาท)</th>
                  <th style={{ width: '180px' }}>สัดส่วนจัดสรร</th>
                </tr>
              </thead>
              <tbody>
                {summary?.hospitals.map((h) => {
                  const pct = summary.total_paid > 0 ? (h.total_paid / summary.total_paid) * 100 : 0;
                  return (
                    <tr key={h.hcode}>
                      <td>
                        <span className="hsub-badge hsub-badge-blue">{h.hcode}</span>
                      </td>
                      <td>
                        <strong>{h.hospital_name}</strong>
                      </td>
                      <td className="text-right">{h.record_count.toLocaleString()}</td>
                      <td className="text-right">{h.claim_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="text-right">{h.hc_drug_total > 0 ? h.hc_drug_total.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right">{h.ae_total > 0 ? h.ae_total.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right">{h.ae_drug_total > 0 ? h.ae_drug_total.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right">{h.inst_total > 0 ? h.inst_total.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right">{h.pp_total > 0 ? h.pp_total.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right" style={{ fontWeight: 700, color: '#0d9488' }}>
                        ฿{h.total_paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        <div className="hsub-alloc-bar-container">
                          <div className="hsub-alloc-bar">
                            <div className="hsub-alloc-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, minWidth: '40px' }}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>รวมทั้งสิ้น (CUP 5 แห่ง)</td>
                  <td className="text-right">{summary?.total_records.toLocaleString()}</td>
                  <td className="text-right">฿{summary?.total_claim.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="text-right">
                    ฿{summary?.hospitals.reduce((acc, h) => acc + h.hc_drug_total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
                  </td>
                  <td className="text-right">
                    ฿{summary?.hospitals.reduce((acc, h) => acc + h.ae_total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
                  </td>
                  <td className="text-right">
                    ฿{summary?.hospitals.reduce((acc, h) => acc + h.ae_drug_total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
                  </td>
                  <td className="text-right">
                    ฿{summary?.hospitals.reduce((acc, h) => acc + h.inst_total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
                  </td>
                  <td className="text-right">
                    ฿{summary?.hospitals.reduce((acc, h) => acc + h.pp_total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
                  </td>
                  <td className="text-right" style={{ color: '#0d9488' }}>
                    ฿{summary?.total_paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td>100.0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: eBudget & Funds Breakdown */}
      {activeTab === 'ebudget' && (
        <>
          {/* Fund Categories Explanations Cards */}
          <div className="hsub-card">
            <h2 className="hsub-card-title">
              <span>💡</span> วิเคราะห์แหล่งเงิน & หมวดงบประมาณ (เงินแต่ละก้อนเป็นเงินของอะไรบ้าง)
            </h2>
            <div className="hsub-fund-cards-grid">
              {summary?.fund_categories.map((cat) => (
                <div key={cat.category_key} className="hsub-fund-item-card">
                  <div>
                    <div className="hsub-fund-item-header">
                      <span className="hsub-fund-item-title">{cat.category_name}</span>
                      <span className="hsub-badge hsub-badge-green">{cat.percentage}%</span>
                    </div>
                    <p className="hsub-fund-item-desc">{cat.description}</p>
                    <div className="hsub-fund-item-moph">
                      <div>รหัสบัญชี สธ. ที่เกี่ยวข้อง:</div>
                      <span className="hsub-fund-item-moph-id">{cat.moph_account_suggested}</span>
                      <div style={{ color: '#64748b', fontSize: '0.78rem' }}>{cat.moph_desc_suggested}</div>
                    </div>
                  </div>
                  <div className="hsub-fund-item-footer">
                    <div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>จำนวน {cat.record_count.toLocaleString()} รายการ</div>
                      <div className="hsub-fund-item-amount">฿{cat.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                    <div className="hsub-fund-item-pct">{cat.percentage}% ของยอดรวม</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* eBudget Matching Table */}
          <div className="hsub-card">
            <h2 className="hsub-card-title">
              <span>🔄</span> การกระทบยอดหนังสือ REP พึงจ่าย กับโอนเงิน e-Budget (smt_budget_transfers)
            </h2>
            <div className="hsub-table-responsive">
              <table className="hsub-table">
                <thead>
                  <tr>
                    <th>หนังสือ REP</th>
                    <th className="text-right">รายการ</th>
                    <th className="text-right">ยอดพึงจ่าย H-Sub</th>
                    <th>รพ.สต. ที่ได้รับ</th>
                    <th>หมวดเงินในรายงาน</th>
                    <th>สถานะเทียบ e-Budget</th>
                    <th>Batch e-Budget</th>
                    <th>กองทุน e-Budget</th>
                    <th>ผังบัญชี สธ. (MOPH)</th>
                    <th>คำอธิบายความสอดคล้อง</th>
                  </tr>
                </thead>
                <tbody>
                  {summary?.ebudget_matches.map((m) => (
                    <tr key={m.rep}>
                      <td>
                        <strong>{m.rep}</strong>
                      </td>
                      <td className="text-right">{m.hsub_record_count.toLocaleString()}</td>
                      <td className="text-right" style={{ fontWeight: 600, color: '#0d9488' }}>
                        ฿{m.hsub_total_paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {m.hsub_hcodes.map((hc) => (
                            <span key={hc} className="hsub-badge hsub-badge-blue">{hc}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {m.hsub_fund_tags.map((tag) => (
                            <span key={tag} className="hsub-badge hsub-badge-purple">{tag}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {m.match_type === 'exact_rep' && (
                          <span className="hsub-badge hsub-badge-green">✓ ตรงตัวใน e-Budget</span>
                        )}
                        {m.match_type === 'fiscal_group' && (
                          <span className="hsub-badge hsub-badge-blue">✓ งวดโอนงบเหมาจ่าย</span>
                        )}
                        {m.match_type === 'unmatched' && (
                          <span className="hsub-badge hsub-badge-amber">งบปฐมภูมิ/รอโอน</span>
                        )}
                      </td>
                      <td>
                        {m.ebudget_batch_no ? (
                          <span className="hsub-badge hsub-badge-gray">Batch {m.ebudget_batch_no}</span>
                        ) : '-'}
                      </td>
                      <td>
                        <div style={{ fontSize: '0.82rem' }}>{m.ebudget_fund_name || '-'}</div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 600 }}>{m.ebudget_moph_id || '-'}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{m.ebudget_moph_desc || ''}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem', color: '#475569' }}>{m.explanation}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* TAB 3: Transactions Explorer */}
      {activeTab === 'transactions' && (
        <div className="hsub-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="hsub-card-title" style={{ margin: 0 }}>
              <span>📋</span> รายการชดเชยระดับบุคคล (Transaction Items)
            </h2>
            <div style={{ fontSize: '0.88rem', color: '#64748b' }}>
              พบ {txTotal.toLocaleString()} รายการ (หน้า {txPage} จาก {totalPages || 1})
            </div>
          </div>

          <div className="hsub-table-responsive">
            <table className="hsub-table">
              <thead>
                <tr>
                  <th>REP</th>
                  <th>TRAN ID</th>
                  <th>HN</th>
                  <th>เลขบัตร ปชช.</th>
                  <th>ชื่อ-นามสกุล</th>
                  <th>วันที่รับบริการ</th>
                  <th>สิทธิ</th>
                  <th>รพ.สต.</th>
                  <th className="text-right">เรียกเก็บ</th>
                  <th className="text-right">ยา Home Care</th>
                  <th className="text-right">ฉุกเฉิน AE</th>
                  <th className="text-right">ส่งเสริม PP</th>
                  <th className="text-right">อุปกรณ์</th>
                  <th className="text-right">ชดเชยสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {txLoading ? (
                  <tr>
                    <td colSpan={14} className="text-center" style={{ padding: '2rem' }}>
                      กำลังโหลดข้อมูลธุรกรรม...
                    </td>
                  </tr>
                ) : transactions.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="text-center" style={{ padding: '2rem', color: '#94a3b8' }}>
                      ไม่พบข้อมูลรายการธุรกรรมที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={`${tx.tran_id}_${tx.rep}_${tx.hcode}`}>
                      <td>{tx.rep}</td>
                      <td>
                        <code style={{ fontSize: '0.8rem' }}>{tx.tran_id}</code>
                      </td>
                      <td>{tx.hn || '-'}</td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{tx.pid || '-'}</span>
                      </td>
                      <td>{tx.patient_name || '-'}</td>
                      <td>{tx.service_date ? tx.service_date.slice(0, 16) : '-'}</td>
                      <td>
                        <span className={`hsub-badge ${tx.maininscl === 'UCS' ? 'hsub-badge-green' : 'hsub-badge-blue'}`}>
                          {tx.maininscl || 'UCS'}
                        </span>
                      </td>
                      <td>
                        <span className="hsub-badge hsub-badge-blue">{tx.hcode}</span>
                      </td>
                      <td className="text-right">{Number(tx.claim_amt).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="text-right">{tx.hc_drug > 0 ? Number(tx.hc_drug).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right">{(tx.ae_amt + tx.ae_drug) > 0 ? Number(tx.ae_amt + tx.ae_drug).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right">{tx.pp_amt > 0 ? Number(tx.pp_amt).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right">{tx.inst_amt > 0 ? Number(tx.inst_amt).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                      <td className="text-right" style={{ fontWeight: 700, color: '#0d9488' }}>
                        ฿{Number(tx.total_paid).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="hsub-pagination">
            <div>
              แสดงหน้า {txPage} จาก {totalPages || 1} (ทั้งหมด {txTotal.toLocaleString()} รายการ)
            </div>
            <div className="hsub-page-btns">
              <button
                className="hsub-page-btn"
                onClick={() => setTxPage(1)}
                disabled={txPage <= 1 || txLoading}
              >
                « หน้าแรก
              </button>
              <button
                className="hsub-page-btn"
                onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                disabled={txPage <= 1 || txLoading}
              >
                ‹ ก่อนหน้า
              </button>
              <span style={{ padding: '0 0.5rem', alignSelf: 'center', fontWeight: 600 }}>
                {txPage} / {totalPages || 1}
              </span>
              <button
                className="hsub-page-btn"
                onClick={() => setTxPage((p) => Math.min(totalPages, p + 1))}
                disabled={txPage >= totalPages || txLoading}
              >
                ถัดไป ›
              </button>
              <button
                className="hsub-page-btn"
                onClick={() => setTxPage(totalPages)}
                disabled={txPage >= totalPages || txLoading}
              >
                หน้าสุดท้าย »
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Server Directory Modal */}
      {showServerModal && (
        <div className="hsub-modal-overlay" onClick={() => setShowServerModal(false)}>
          <div className="hsub-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="hsub-modal-title">🖥️ นำเข้าจากโฟลเดอร์บนเครื่องเซิร์ฟเวอร์</h3>
            <p className="hsub-modal-desc">
              กรณีโปรแกรมรันอยู่บนเครื่องเดียวกับที่เก็บไฟล์ (เช่น โฮสต์เซิร์ฟเวอร์มีไดรฟ์หรือโฟลเดอร์เก็บไฟล์) สามารถระบุตำแหน่งโฟลเดอร์เพื่อนำเข้าโดยตรงได้
            </p>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                โฟลเดอร์บนเซิร์ฟเวอร์
              </label>
              <input
                type="text"
                value={serverPath}
                onChange={(e) => setServerPath(e.target.value)}
                placeholder="D:\hsub"
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                }}
              />
            </div>
            <div className="hsub-modal-actions">
              <button
                type="button"
                className="hsub-btn hsub-btn-secondary"
                onClick={() => setShowServerModal(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="hsub-btn hsub-btn-import"
                onClick={handleImportDir}
                disabled={importing}
              >
                {importing ? '⏳ กำลังประมวลผล...' : 'เริ่มนำเข้า'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HsubPaymentReconcilePage;
