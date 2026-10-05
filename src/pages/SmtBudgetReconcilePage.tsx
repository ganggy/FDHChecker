import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './SmtBudgetReconcilePage.css';

interface SmtTransfer {
  id: number;
  hcode: string;
  budget_year: string;
  run_date: string;
  posting_date: string;
  batch_no: string;
  ref_doc_no: string;
  fund_name: string;
  fund_group?: string;
  fund_descr?: string;
  efund_desc?: string;
  budget_source?: string;
  moph_id?: string;
  moph_desc?: string;
  amount: number;
  wait_amount: number;
  debt_amount: number;
  bond_amount: number;
  vat_amount: number;
  net_total: number;
  bank_name?: string;
  reconcile_status: 'settled' | 'stm_imported' | 'unimported';
  matched_statement_file?: string | null;
}

interface MophAccount {
  moph_id: string;
  moph_desc: string;
  account_type: 'receivable_1' | 'revenue_4' | 'other';
  record_count: number;
  sum_amount: number;
  sum_wait: number;
  sum_debt: number;
  sum_vat: number;
  sum_net_total: number;
}

export interface SmtBatchGroup {
  batchKey: string;
  run_date: string;
  posting_date: string;
  batch_no: string;
  bank_name: string;
  ref_doc_summary: string;
  funds_summary: string;
  moph_summary: string;
  total_amount: number;
  total_wait: number;
  total_debt: number;
  total_vat: number;
  total_net: number;
  reconcile_status: 'settled' | 'stm_imported' | 'unimported';
  items: SmtTransfer[];
}

interface SmtSummaryData {
  budget_year: string;
  hcode: string;
  hospital_name: string;
  total_records: number;
  total_batches?: number;
  total_amount: number;
  total_wait: number;
  total_debt: number;
  total_vat: number;
  total_net: number;
  settled_count: number;
  imported_count: number;
  unimported_count: number;
  transfers: SmtTransfer[];
  moph_accounts: MophAccount[];
  unimported_alerts: Array<{
    ref_doc_no: string;
    batch_no: string;
    run_date: string;
    fund_name: string;
    moph_id: string;
    moph_desc: string;
    net_total: number;
    wait_amount: number;
    debt_amount: number;
  }>;
}

export const SmtBudgetReconcilePage: React.FC = () => {
  const currentThaiYear = useMemo(() => {
    const d = new Date();
    return String(d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0));
  }, []);

  const [selectedYear, setSelectedYear] = useState<string>(currentThaiYear);
  const [data, setData] = useState<SmtSummaryData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Filters & Views
  const [activeTab, setActiveTab] = useState<'transfers' | 'moph' | 'alerts'>('transfers');
  const [viewMode, setViewMode] = useState<'batches' | 'items'>('batches');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unimported' | 'stm_imported' | 'settled'>('all');
  const [mophFilter, setMophFilter] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(100);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const availableYears = useMemo(() => {
    const base = Number(currentThaiYear);
    return [String(base), String(base - 1), String(base - 2), String(base - 3)];
  }, [currentThaiYear]);

  const loadSummary = async (year: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/smt-budget/summary?budgetYear=${year}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถโหลดข้อมูล SMT ได้');
      }
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary(selectedYear);
  }, [selectedYear]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/smt-budget/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetYear: selectedYear }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'ดึงข้อมูลไม่สำเร็จ');
      }
      setSyncMessage(json.data.message || 'ดึงข้อมูลสำเร็จ');
      // Reload summary
      await loadSummary(selectedYear);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เชื่อมต่อ SMT สปสช. ล้มเหลว');
    } finally {
      setSyncing(false);
    }
  };

  const filteredTransfers = useMemo(() => {
    if (!data?.transfers) return [];
    return data.transfers.filter((t) => {
      if (statusFilter !== 'all' && t.reconcile_status !== statusFilter) return false;
      if (mophFilter !== 'all') {
        if (mophFilter === '1' && !t.moph_id?.startsWith('1')) return false;
        if (mophFilter === '4' && !t.moph_id?.startsWith('4')) return false;
      }
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchDoc = t.ref_doc_no?.toLowerCase().includes(term);
        const matchBatch = t.batch_no?.toLowerCase().includes(term);
        const matchFund = t.fund_name?.toLowerCase().includes(term);
        const matchMoph = t.moph_id?.toLowerCase().includes(term) || t.moph_desc?.toLowerCase().includes(term);
        if (!matchDoc && !matchBatch && !matchFund && !matchMoph) return false;
      }
      return true;
    });
  }, [data, statusFilter, mophFilter, searchTerm]);

  const batchGroups = useMemo<SmtBatchGroup[]>(() => {
    if (!filteredTransfers || filteredTransfers.length === 0) return [];
    const map = new Map<string, SmtBatchGroup>();

    for (const t of filteredTransfers) {
      const key = `${t.run_date || t.posting_date}_${t.batch_no}`;
      let group = map.get(key);
      if (!group) {
        group = {
          batchKey: key,
          run_date: t.run_date,
          posting_date: t.posting_date,
          batch_no: t.batch_no,
          bank_name: t.bank_name || '',
          ref_doc_summary: '',
          funds_summary: '',
          moph_summary: '',
          total_amount: 0,
          total_wait: 0,
          total_debt: 0,
          total_vat: 0,
          total_net: 0,
          reconcile_status: 'settled',
          items: [],
        };
        map.set(key, group);
      }
      group.total_amount += Number(t.amount || 0);
      group.total_wait += Number(t.wait_amount || 0);
      group.total_debt += Number(t.debt_amount || 0);
      group.total_vat += Number(t.vat_amount || 0);
      group.total_net += Number(t.net_total || 0);
      group.items.push(t);
    }

    for (const group of map.values()) {
      const uniqueDocs = Array.from(new Set(group.items.map(i => i.ref_doc_no).filter(Boolean)));
      group.ref_doc_summary = uniqueDocs.length === 1 ? uniqueDocs[0] : `${uniqueDocs.slice(0, 2).join(', ')}${uniqueDocs.length > 2 ? ` (+${uniqueDocs.length - 2})` : ''}`;

      const uniqueFunds = Array.from(new Set(group.items.map(i => i.fund_name).filter(Boolean)));
      group.funds_summary = uniqueFunds.length === 1 ? uniqueFunds[0] : `${uniqueFunds[0]} (+${uniqueFunds.length - 1} กองทุน)`;

      const uniqueMoph = Array.from(new Set(group.items.map(i => i.moph_id).filter(Boolean)));
      group.moph_summary = uniqueMoph.length === 1 ? uniqueMoph[0] : `${uniqueMoph.length} ผังบัญชี`;

      const hasUnimported = group.items.some(i => i.reconcile_status === 'unimported');
      const hasImported = group.items.some(i => i.reconcile_status === 'stm_imported');
      if (hasUnimported) group.reconcile_status = 'unimported';
      else if (hasImported) group.reconcile_status = 'stm_imported';
      else group.reconcile_status = 'settled';
    }

    return Array.from(map.values());
  }, [filteredTransfers]);

  useEffect(() => {
    setPage(1);
  }, [selectedYear, statusFilter, mophFilter, searchTerm, viewMode]);

  const toggleExpandBatch = (key: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalItems = viewMode === 'batches' ? batchGroups.length : filteredTransfers.length;
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalItems / pageSize) || 1;

  const paginatedBatchGroups = useMemo(() => {
    if (pageSize === 0) return batchGroups;
    const start = (page - 1) * pageSize;
    return batchGroups.slice(start, start + pageSize);
  }, [batchGroups, page, pageSize]);

  const paginatedTransfers = useMemo(() => {
    if (pageSize === 0) return filteredTransfers;
    const start = (page - 1) * pageSize;
    return filteredTransfers.slice(start, start + pageSize);
  }, [filteredTransfers, page, pageSize]);

  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: สรุปตามงวดการโอน (ตรงกับหน้าเว็บ SMT e-Budget)
    const bRows = batchGroups.map((b, idx) => ({
      ลำดับ: idx + 1,
      วันที่โอน: b.run_date,
      'Batch No': b.batch_no,
      'งวด/เลขที่เบิกจ่าย': b.ref_doc_summary,
      กองทุน: b.funds_summary,
      ผังบัญชี_สปสธ: b.moph_summary,
      จำนวนรายการย่อย: b.items.length,
      ยอดเงินจัดสรร: b.total_amount,
      ชะลอการโอน: b.total_wait,
      หักกลบหนี้: b.total_debt,
      ภาษี: b.total_vat,
      เงินโอนเข้าบัญชี: b.total_net,
      ธนาคาร: b.bank_name,
      สถานะกระทบยอด: b.reconcile_status === 'settled' ? 'ตัดหนี้ครบ' : b.reconcile_status === 'stm_imported' ? 'พบ STM ครบ' : 'ยังไม่พบ Statement',
    }));
    const ws0 = XLSX.utils.json_to_sheet(bRows);
    XLSX.utils.book_append_sheet(wb, ws0, 'สรุปตามงวดโอน (Batches)');

    // Sheet 2: รายการย่อยตามผังบัญชี
    const tRows = data.transfers.map((t, idx) => ({
      ลำดับ: idx + 1,
      วันที่โอน: t.run_date,
      'Batch No': t.batch_no,
      'งวด/เลขที่เบิกจ่าย': t.ref_doc_no,
      กองทุน: t.fund_name,
      กองทุนย่อย: t.efund_desc || t.fund_descr || '',
      รหัสผังบัญชี_สปสธ: t.moph_id || '',
      ชื่อผังบัญชี: t.moph_desc || '',
      จำนวนเงินจัดสรร: t.amount,
      ชะลอการโอน: t.wait_amount,
      หักกลบหนี้: t.debt_amount,
      ภาษี: t.vat_amount,
      เงินโอนเข้าบัญชี: t.net_total,
      ธนาคาร: t.bank_name || '',
      สถานะกระทบยอด: t.reconcile_status === 'settled' ? 'ตัดหนี้แล้ว' : t.reconcile_status === 'stm_imported' ? 'พบ STM รอตัดหนี้' : 'ยังไม่พบ Statement',
    }));
    const ws1 = XLSX.utils.json_to_sheet(tRows);
    XLSX.utils.book_append_sheet(wb, ws1, 'รายการย่อยผังบัญชี (776 รายการ)');

    // Sheet 3: สรุปผังบัญชี
    const mRows = data.moph_accounts.map((m) => ({
      รหัสผังบัญชี: m.moph_id,
      ชื่อผังบัญชี: m.moph_desc,
      หมวดบัญชี: m.account_type === 'receivable_1' ? 'หมวด 1 (ลูกหนี้)' : m.account_type === 'revenue_4' ? 'หมวด 4 (รายได้)' : 'อื่นๆ',
      จำนวนงวด: m.record_count,
      ยอดเงินจัดสรร: m.sum_amount,
      ชะลอการโอน: m.sum_wait,
      หักกลบ: m.sum_debt,
      เงินโอนสุทธิ: m.sum_net_total,
    }));
    const ws2 = XLSX.utils.json_to_sheet(mRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'สรุปผังบัญชี สป.สธ.');

    XLSX.writeFile(wb, `SMT_eBudget_${data.hcode}_ปี${selectedYear}.xlsx`);
  };

  const formatMoney = (val: number) =>
    val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="smt-budget-page">
      {/* Top Header */}
      <div className="smt-header">
        <div className="smt-header-left">
          <div className="smt-title-badge">🏦 ระบบการเงิน & ลูกหนี้</div>
          <h1 className="smt-title">
            ระบบตัดหนี้ SMT / e-Budget สปสช.
            <span className="smt-hcode">({data?.hospital_name || 'รพ.โคกศรีสุพรรณ'} - {data?.hcode || '11101'})</span>
          </h1>
          <p className="smt-subtitle">
            ดึงข้อมูลรายงานการโอนเงินกองทุน สปสช. (Smart Money Transfer) เทียบผังบัญชี สป.สธ. (หมวด 1 ลูกหนี้ & หมวด 4 รายได้) เพื่อตัดบัญชีลูกหนี้และตรวจงวดตกหล่น
          </p>
        </div>

        <div className="smt-header-actions">
          <div className="smt-year-select-group">
            <label htmlFor="year-select">ปีงบประมาณ:</label>
            <select
              id="year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="smt-year-select"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className={`smt-btn-sync ${syncing ? 'loading' : ''}`}
          >
            {syncing ? '🔄 กำลังดึงข้อมูลจาก SMT...' : '⚡ ดึงข้อมูล Auto จาก SMT สปสช.'}
          </button>

          {data && data.transfers.length > 0 && (
            <button type="button" onClick={exportExcel} className="smt-btn-export">
              📥 ส่งออก Excel
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="smt-alert-box error">
          <span>⚠️ {error}</span>
        </div>
      )}
      {syncMessage && (
        <div className="smt-alert-box success">
          <span>✅ {syncMessage}</span>
        </div>
      )}

      {/* Missing Statements Alert Banner */}
      {data && data.unimported_count > 0 && (
        <div className="smt-warning-banner">
          <div className="smt-warning-icon">⚠️</div>
          <div className="smt-warning-content">
            <strong>พบเงินโอนในระบบ e-Budget แต่ยังไม่นำเข้า Statement จำนวน {data.unimported_count} งวด</strong>
            <p>
              เงินโอนเข้าบัญชีธนาคารแล้ว แต่ในระบบ FDH Checker ยังไม่มีไฟล์ Statement (REP/STM) หรือยังไม่ได้กดตัดลูกหนี้
              กรุณาตรวจสอบงวดเบิกจ่ายด้านล่างเพื่อนำเข้าไฟล์และตัดรับรู้ลูกหนี้ให้ตรงรอบบัญชี
            </p>
          </div>
          <button
            type="button"
            className="smt-warning-btn"
            onClick={() => setActiveTab('alerts')}
          >
            ดูรายการตกหล่น ({data.unimported_count})
          </button>
        </div>
      )}

      {/* KPI Cards */}
      {data && (
        <div className="smt-kpi-grid">
          <div className="smt-kpi-card highlight-green">
            <div className="smt-kpi-icon">💰</div>
            <div className="smt-kpi-body">
              <span className="smt-kpi-label">เงินโอนเข้าบัญชีจริง (สุทธิ)</span>
              <span className="smt-kpi-value text-green">{formatMoney(data.total_net)} ฿</span>
              <span className="smt-kpi-meta">ยอดจัดสรร: {formatMoney(data.total_amount)} ฿</span>
            </div>
          </div>

          <div className="smt-kpi-card highlight-amber">
            <div className="smt-kpi-icon">⏳</div>
            <div className="smt-kpi-body">
              <span className="smt-kpi-label">ยอดชะลอการโอน (Hold)</span>
              <span className="smt-kpi-value text-amber">{formatMoney(data.total_wait)} ฿</span>
              <span className="smt-kpi-meta">สปสช. ระงับโอนรอเอกสาร</span>
            </div>
          </div>

          <div className="smt-kpi-card highlight-red">
            <div className="smt-kpi-icon">⚖️</div>
            <div className="smt-kpi-body">
              <span className="smt-kpi-label">ยอดหักกลบหนี้เก่า / ภาษี</span>
              <span className="smt-kpi-value text-red">{formatMoney(data.total_debt + data.total_vat)} ฿</span>
              <span className="smt-kpi-meta">หักกลบ {formatMoney(data.total_debt)} ฿ | ภาษี {formatMoney(data.total_vat)} ฿</span>
            </div>
          </div>

          <div className="smt-kpi-card highlight-blue">
            <div className="smt-kpi-icon">📋</div>
            <div className="smt-kpi-body">
              <span className="smt-kpi-label">ความครบถ้วน Statement</span>
              <div className="smt-kpi-status-row">
                <span className="status-tag settled">✅ ตัดหนี้: {data.settled_count}</span>
                <span className="status-tag imported">📄 มี STM: {data.imported_count}</span>
                <span className="status-tag missing">⚠️ รอ STM: {data.unimported_count}</span>
              </div>
              <span className="smt-kpi-meta">
                ทั้งหมด {data.total_batches || batchGroups.length} งวดโอน ({data.total_records} รายการย่อยผังบัญชี)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs Header */}
      <div className="smt-tabs-header">
        <button
          type="button"
          className={`smt-tab-btn ${activeTab === 'transfers' ? 'active' : ''}`}
          onClick={() => setActiveTab('transfers')}
        >
          📑 รายการโอนเงิน e-Budget ({viewMode === 'batches' ? `${batchGroups.length} งวด` : `${filteredTransfers.length} รายการ`})
        </button>
        <button
          type="button"
          className={`smt-tab-btn ${activeTab === 'moph' ? 'active' : ''}`}
          onClick={() => setActiveTab('moph')}
        >
          🧮 ผังบัญชี สป.สธ. (หมวด 1 และ 4) ({data?.moph_accounts.length || 0})
        </button>
        <button
          type="button"
          className={`smt-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          🔔 งวดที่ยังไม่นำเข้า Statement ({data?.unimported_alerts.length || 0})
        </button>
      </div>

      {/* Tab 1: Transfers List */}
      {activeTab === 'transfers' && (
        <div className="smt-tab-content">
          <div className="smt-filter-toolbar">
            {/* View Mode Toggle */}
            <div className="smt-view-toggle">
              <button
                type="button"
                className={`smt-view-btn ${viewMode === 'batches' ? 'active' : ''}`}
                onClick={() => setViewMode('batches')}
                title="จัดกลุ่มตามงวดโอน (Batch) ตรงกับจำนวน 312 ลำดับในเว็บ SMT e-Budget"
              >
                📦 สรุปตามงวดโอน ({batchGroups.length} งวด - ตามเว็บ SMT)
              </button>
              <button
                type="button"
                className={`smt-view-btn ${viewMode === 'items' ? 'active' : ''}`}
                onClick={() => setViewMode('items')}
                title="แสดงแยกตามรายการย่อยผังบัญชี สป.สธ. ทั้งหมดเพื่อใช้กระทบยอดตัดลูกหนี้"
              >
                📑 รายการย่อยตามผังบัญชี ({filteredTransfers.length} รายการ)
              </button>
            </div>

            <input
              type="text"
              placeholder="🔍 ค้นหางวด/เลขที่เบิกจ่าย, กองทุน, หรือรหัสผังบัญชี..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="smt-search-input"
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="smt-filter-select"
            >
              <option value="all">สถานะทั้งหมด</option>
              <option value="unimported">⚠️ ยังไม่พบ Statement ({data?.unimported_count || 0})</option>
              <option value="stm_imported">📄 มีไฟล์ STM รอตัดหนี้ ({data?.imported_count || 0})</option>
              <option value="settled">✅ ตัดหนี้แล้ว ({data?.settled_count || 0})</option>
            </select>

            <select
              value={mophFilter}
              onChange={(e) => setMophFilter(e.target.value)}
              className="smt-filter-select"
            >
              <option value="all">ผังบัญชีทุกหมวด</option>
              <option value="1">หมวด 1 (ลูกหนี้ 1102...)</option>
              <option value="4">หมวด 4 (รายได้ 4301...)</option>
            </select>
          </div>

          {loading ? (
            <div className="smt-loading">กำลังโหลดข้อมูล...</div>
          ) : totalItems === 0 ? (
            <div className="smt-empty">
              {data?.total_records === 0
                ? 'ยังไม่มีข้อมูลการโอนเงินในระบบ กรุณากดปุ่ม "⚡ ดึงข้อมูล Auto จาก SMT สปสช."'
                : 'ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา'}
            </div>
          ) : (
            <div className="smt-table-wrapper">
              {viewMode === 'batches' ? (
                /* BATCH VIEW (Matches SMT Website 312 Rows) */
                <table className="smt-table">
                  <thead>
                    <tr>
                      <th>ลำดับ</th>
                      <th>วันที่โอน</th>
                      <th>Batch</th>
                      <th>งวด/เลขที่เบิกจ่าย</th>
                      <th>กองทุน</th>
                      <th>ผังบัญชี สป.สธ.</th>
                      <th className="text-right">ยอดจัดสรร</th>
                      <th className="text-right">ชะลอโอน</th>
                      <th className="text-right">หักกลบ</th>
                      <th className="text-right">เงินโอนเข้าบัญชี</th>
                      <th>สถานะกระทบยอด</th>
                      <th className="text-center">รายการย่อย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedBatchGroups.map((b, idx) => {
                      const rowNum = pageSize === 0 ? idx + 1 : (page - 1) * pageSize + idx + 1;
                      const isExpanded = expandedBatches.has(b.batchKey);
                      return (
                        <React.Fragment key={b.batchKey}>
                          <tr>
                            <td>{rowNum}</td>
                            <td>{b.run_date}</td>
                            <td><span className="badge-code">{b.batch_no}</span></td>
                            <td>
                              <strong className="text-doc">{b.ref_doc_summary}</strong>
                            </td>
                            <td>
                              <div>{b.funds_summary}</div>
                              {b.bank_name && <small className="text-muted">{b.bank_name}</small>}
                            </td>
                            <td>
                              <span className="moph-id">{b.moph_summary}</span>
                            </td>
                            <td className="text-right">{formatMoney(b.total_amount)}</td>
                            <td className="text-right text-amber">{b.total_wait > 0 ? formatMoney(b.total_wait) : '-'}</td>
                            <td className="text-right text-red">{b.total_debt > 0 ? formatMoney(b.total_debt) : '-'}</td>
                            <td className="text-right font-bold text-green">{formatMoney(b.total_net)}</td>
                            <td>
                              {b.reconcile_status === 'settled' && (
                                <span className="status-badge settled">✅ ตัดหนี้ครบ</span>
                              )}
                              {b.reconcile_status === 'stm_imported' && (
                                <span className="status-badge imported">📄 มี STM ครบ</span>
                              )}
                              {b.reconcile_status === 'unimported' && (
                                <span className="status-badge missing">⚠️ รอ STM</span>
                              )}
                            </td>
                            <td className="text-center">
                              <button
                                type="button"
                                className="smt-expand-btn"
                                onClick={() => toggleExpandBatch(b.batchKey)}
                                title="คลิกเพื่อดูรายการย่อยตามกองทุน/ผังบัญชี"
                              >
                                {isExpanded ? '▲ ซ่อน' : `▼ ดูย่อย (${b.items.length})`}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="smt-expanded-row">
                              <td colSpan={12} style={{ background: '#f8fafc', padding: '0.75rem 1.25rem' }}>
                                <table className="smt-subtable">
                                  <thead>
                                    <tr>
                                      <th>#</th>
                                      <th>งวด/เลขที่เบิกจ่าย</th>
                                      <th>กองทุน</th>
                                      <th>กองทุนย่อย</th>
                                      <th>ผังบัญชี สป.สธ.</th>
                                      <th className="text-right">ยอดจัดสรร</th>
                                      <th className="text-right">ชะลอโอน</th>
                                      <th className="text-right">หักกลบ</th>
                                      <th className="text-right">เงินโอนเข้าบัญชี</th>
                                      <th>สถานะ</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {b.items.map((sub, sIdx) => (
                                      <tr key={sub.id || sIdx}>
                                        <td>{sIdx + 1}</td>
                                        <td><strong className="text-doc">{sub.ref_doc_no}</strong></td>
                                        <td>{sub.fund_name}</td>
                                        <td>{sub.efund_desc || sub.fund_descr || '-'}</td>
                                        <td>
                                          {sub.moph_id ? (
                                            <span className={`moph-id ${sub.moph_id.startsWith('1') ? 'text-sky-700' : 'text-emerald-700'}`}>
                                              {sub.moph_id} - {sub.moph_desc}
                                            </span>
                                          ) : '-'}
                                        </td>
                                        <td className="text-right">{formatMoney(sub.amount)}</td>
                                        <td className="text-right text-amber">{sub.wait_amount > 0 ? formatMoney(sub.wait_amount) : '-'}</td>
                                        <td className="text-right text-red">{sub.debt_amount > 0 ? formatMoney(sub.debt_amount) : '-'}</td>
                                        <td className="text-right font-bold text-green">{formatMoney(sub.net_total)}</td>
                                        <td>
                                          {sub.reconcile_status === 'settled' && <span className="status-badge settled">ตัดหนี้แล้ว</span>}
                                          {sub.reconcile_status === 'stm_imported' && <span className="status-badge imported">มี STM</span>}
                                          {sub.reconcile_status === 'unimported' && <span className="status-badge missing">รอ STM</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                /* ITEMS VIEW (Shows all 776 detailed accounts) */
                <table className="smt-table">
                  <thead>
                    <tr>
                      <th>ลำดับ</th>
                      <th>วันที่โอน</th>
                      <th>Batch</th>
                      <th>งวด/เลขที่เบิกจ่าย</th>
                      <th>กองทุน</th>
                      <th>ผังบัญชี สป.สธ.</th>
                      <th className="text-right">ยอดจัดสรร</th>
                      <th className="text-right">ชะลอโอน</th>
                      <th className="text-right">หักกลบ</th>
                      <th className="text-right">เงินโอนเข้าบัญชี</th>
                      <th>ธนาคาร</th>
                      <th>สถานะกระทบยอด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTransfers.map((t, idx) => {
                      const rowNum = pageSize === 0 ? idx + 1 : (page - 1) * pageSize + idx + 1;
                      return (
                        <tr key={t.id || idx}>
                          <td>{rowNum}</td>
                          <td>{t.run_date}</td>
                          <td><span className="badge-code">{t.batch_no}</span></td>
                          <td>
                            <strong className="text-doc">{t.ref_doc_no}</strong>
                          </td>
                          <td>
                            <div>{t.fund_name}</div>
                            {t.efund_desc && <small className="text-muted">{t.efund_desc}</small>}
                          </td>
                          <td>
                            {t.moph_id ? (
                              <div className={`moph-pill ${t.moph_id.startsWith('1') ? 'acc-1' : 'acc-4'}`}>
                                <span className="moph-id">{t.moph_id}</span>
                                <span className="moph-desc">{t.moph_desc}</span>
                              </div>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td className="text-right">{formatMoney(t.amount)}</td>
                          <td className="text-right text-amber">{t.wait_amount > 0 ? formatMoney(t.wait_amount) : '-'}</td>
                          <td className="text-right text-red">{t.debt_amount > 0 ? formatMoney(t.debt_amount) : '-'}</td>
                          <td className="text-right font-bold text-green">{formatMoney(t.net_total)}</td>
                          <td><small>{t.bank_name || '-'}</small></td>
                          <td>
                            {t.reconcile_status === 'settled' && (
                              <span className="status-badge settled">✅ ตัดหนี้แล้ว</span>
                            )}
                            {t.reconcile_status === 'stm_imported' && (
                              <span className="status-badge imported" title={t.matched_statement_file || ''}>
                                📄 พบ STM แล้ว
                              </span>
                            )}
                            {t.reconcile_status === 'unimported' && (
                              <span className="status-badge missing">⚠️ รอ Statement</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* Dynamic Pagination Bar */}
              <div className="smt-pagination-bar">
                <div>
                  แสดง {totalItems === 0 ? 0 : (page - 1) * (pageSize || totalItems) + 1} -{' '}
                  {pageSize === 0 ? totalItems : Math.min(page * pageSize, totalItems)} จากทั้งหมด{' '}
                  <strong>{totalItems}</strong> {viewMode === 'batches' ? 'งวดการโอน' : 'รายการ'}
                </div>

                <div className="smt-page-controls">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>แสดงหน้าละ:</span>
                    <select
                      className="smt-page-size-select"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                      <option value={0}>ทั้งหมด ({totalItems})</option>
                    </select>
                  </label>

                  {pageSize > 0 && totalPages > 1 && (
                    <>
                      <button
                        type="button"
                        className="smt-page-btn"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                      >
                        ◀ ก่อนหน้า
                      </button>
                      <span>
                        หน้า <strong>{page}</strong> / {totalPages}
                      </span>
                      <button
                        type="button"
                        className="smt-page-btn"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                      >
                        ถัดไป ▶
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: MOPH Accounting Summary */}
      {activeTab === 'moph' && (
        <div className="smt-tab-content">
          <div className="smt-accounting-guide">
            <h3>📑 สรุปการลงบัญชีตามผังมาตรฐาน สป.สธ. สำหรับงบประมาณปี {selectedYear}</h3>
            <p>
              รหัสขึ้นต้นด้วย <strong>หมวด 1</strong> คือสินทรัพย์/ลูกหนี้ (Accounts Receivable) และ{' '}
              <strong>หมวด 4</strong> คือรายได้ (Revenues) สามารถนำยอดรวมด้านล่างไปประกอบการทำใบสำคัญรายวันทั่วไป (JV)
            </p>
          </div>

          <div className="smt-table-wrapper">
            <table className="smt-table">
              <thead>
                <tr>
                  <th>รหัสผังบัญชี</th>
                  <th>ชื่อผังบัญชี สป.สธ.</th>
                  <th>หมวดบัญชี</th>
                  <th className="text-center">จำนวนงวด</th>
                  <th className="text-right">ยอดจัดสรร (฿)</th>
                  <th className="text-right">ชะลอโอน (฿)</th>
                  <th className="text-right">หักกลบ (฿)</th>
                  <th className="text-right">เงินโอนเข้าจริง (Dr. ธนาคาร)</th>
                </tr>
              </thead>
              <tbody>
                {data?.moph_accounts.map((m) => (
                  <tr key={m.moph_id}>
                    <td>
                      <span className="badge-code font-bold">{m.moph_id || '9999999999.999'}</span>
                    </td>
                    <td>{m.moph_desc || 'ไม่ระบุคำอธิบาย'}</td>
                    <td>
                      {m.account_type === 'receivable_1' ? (
                        <span className="moph-type-tag type-1">หมวด 1 (ลูกหนี้)</span>
                      ) : m.account_type === 'revenue_4' ? (
                        <span className="moph-type-tag type-4">หมวด 4 (รายได้)</span>
                      ) : (
                        <span className="moph-type-tag type-other">อื่นๆ</span>
                      )}
                    </td>
                    <td className="text-center">{m.record_count}</td>
                    <td className="text-right">{formatMoney(m.sum_amount)}</td>
                    <td className="text-right text-amber">{m.sum_wait > 0 ? formatMoney(m.sum_wait) : '-'}</td>
                    <td className="text-right text-red">{m.sum_debt > 0 ? formatMoney(m.sum_debt) : '-'}</td>
                    <td className="text-right font-bold text-green">{formatMoney(m.sum_net_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="smt-total-row">
                  <td colSpan={3}><strong>รวมทั้งสิ้น</strong></td>
                  <td className="text-center"><strong>{data?.total_records}</strong></td>
                  <td className="text-right"><strong>{formatMoney(data?.total_amount || 0)}</strong></td>
                  <td className="text-right text-amber"><strong>{formatMoney(data?.total_wait || 0)}</strong></td>
                  <td className="text-right text-red"><strong>{formatMoney(data?.total_debt || 0)}</strong></td>
                  <td className="text-right font-bold text-green"><strong>{formatMoney(data?.total_net || 0)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Missing Statements Alerts */}
      {activeTab === 'alerts' && (
        <div className="smt-tab-content">
          <div className="smt-alerts-intro">
            <h3>🔔 งวด/เลขที่เบิกจ่าย ที่โอนเงินแล้วแต่ยังไม่ได้นำเข้า Statement ({data?.unimported_alerts.length || 0} งวด)</h3>
            <p>
              รายการเหล่านี้มียอดเงินโอนเข้าบัญชีธนาคารของโรงพยาบาลจริงจากระบบ SMT แล้ว
              แต่ระบบยังไม่พบไฟล์ Statement รายเคส กรุณาดาวน์โหลดไฟล์ STM จากโปรแกรม e-Claim / NHSO แล้วนำเข้าที่หน้า{' '}
              <strong>"นำเข้า REP / STM"</strong> เพื่อให้ระบบตัดลูกหนี้รายบุคคลได้ถูกต้อง
            </p>
          </div>

          <div className="smt-table-wrapper">
            <table className="smt-table">
              <thead>
                <tr>
                  <th>ลำดับ</th>
                  <th>วันที่โอน</th>
                  <th>Batch</th>
                  <th>งวด/เลขที่เบิกจ่าย (Ref Doc No.)</th>
                  <th>กองทุน</th>
                  <th>ผังบัญชี สป.สธ.</th>
                  <th className="text-right">เงินโอนเข้าจริง (฿)</th>
                  <th className="text-right">ชะลอโอน (฿)</th>
                  <th className="text-right">หักกลบ (฿)</th>
                </tr>
              </thead>
              <tbody>
                {data?.unimported_alerts.slice(0, 100).map((a, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{a.run_date}</td>
                    <td><span className="badge-code">{a.batch_no}</span></td>
                    <td>
                      <strong className="text-red">{a.ref_doc_no}</strong>
                    </td>
                    <td>{a.fund_name}</td>
                    <td>
                      <small>{a.moph_id} {a.moph_desc}</small>
                    </td>
                    <td className="text-right font-bold text-green">{formatMoney(a.net_total)}</td>
                    <td className="text-right text-amber">{a.wait_amount > 0 ? formatMoney(a.wait_amount) : '-'}</td>
                    <td className="text-right text-red">{a.debt_amount > 0 ? formatMoney(a.debt_amount) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmtBudgetReconcilePage;
