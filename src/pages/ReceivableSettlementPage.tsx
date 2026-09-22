import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchSettlementStatements,
  fetchSettlementCandidates,
  executeSettlement,
  fetchSettlementHistory,
  fetchSettlementVoucher,
  type SettlementStatementSummary,
  type SettlementCandidateResult,
  type SettlementBatchHistory,
  type SettlementVoucherDetail,
} from '../services/hosxpService';
import './ReceivableSettlementPage.css';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatMoney = (val: unknown) => {
  const n = Number(val || 0);
  return Number.isFinite(n)
    ? n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
};

export const ReceivableSettlementPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'settle' | 'history'>('settle');

  // Filter & Form state
  const [payerType, setPayerType] = useState<string>('NHSO');
  const [statements, setStatements] = useState<SettlementStatementSummary[]>([]);
  const [selectedStatementNo, setSelectedStatementNo] = useState<string>('');
  const [customStatementNo, setCustomStatementNo] = useState<string>('');
  const [transferDate, setTransferDate] = useState<string>(todayIso());
  const [bankAccount, setBankAccount] = useState<string>('ธนาคารกรุงไทย (บัญชีเงินบำรุงโรงพยาบาล)');
  const [notes, setNotes] = useState<string>('');

  // Candidates & Selection state
  const [candidates, setCandidates] = useState<SettlementCandidateResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [itemActions, setItemActions] = useState<Record<number, string>>({});
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'MATCHED' | 'DIFF' | 'ERROR'>('ALL');

  // Loading & Alerts
  const [loadingStatements, setLoadingStatements] = useState<boolean>(false);
  const [loadingCandidates, setLoadingCandidates] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // History state
  const [history, setHistory] = useState<SettlementBatchHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Voucher Modal
  const [voucherModalOpen, setVoucherModalOpen] = useState<boolean>(false);
  const [voucherData, setVoucherData] = useState<SettlementVoucherDetail | null>(null);
  const [loadingVoucher, setLoadingVoucher] = useState<boolean>(false);

  // Load available statements on mount or payerType change
  useEffect(() => {
    setLoadingStatements(true);
    fetchSettlementStatements(payerType)
      .then((data) => {
        setStatements(data);
        if (data.length > 0 && !selectedStatementNo) {
          setSelectedStatementNo(data[0].statement_no);
        }
      })
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'ดึงรายการ Statement ไม่สำเร็จ'))
      .finally(() => setLoadingStatements(false));
  }, [payerType]);

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history') {
      setLoadingHistory(true);
      fetchSettlementHistory(50)
        .then(setHistory)
        .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'ดึงประวัติไม่สำเร็จ'))
        .finally(() => setLoadingHistory(false));
    }
  }, [activeTab]);

  // Fetch candidate reconciliation items
  const handleLoadCandidates = async () => {
    const targetStatement = customStatementNo.trim() || selectedStatementNo.trim();
    if (!targetStatement) {
      setErrorMsg('กรุณาเลือกหรือระบุ Statement No.');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setLoadingCandidates(true);
    try {
      const result = await fetchSettlementCandidates(targetStatement);
      setCandidates(result);

      // Select all by default
      const initialSelected: Record<number, boolean> = {};
      const initialActions: Record<number, string> = {};
      result.items.forEach((item) => {
        initialSelected[item.id] = true;
        initialActions[item.id] = item.settle_action;
      });
      setSelectedIds(initialSelected);
      setItemActions(initialActions);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลกระทบยอด');
    } finally {
      setLoadingCandidates(false);
    }
  };

  // Filtered Items
  const filteredItems = useMemo(() => {
    if (!candidates) return [];
    return candidates.items.filter((item) => {
      const text = `${item.hn || ''} ${item.vn || ''} ${item.an || ''} ${item.cid || ''} ${item.patient_name || ''} ${item.errorcode || ''}`.toLowerCase();
      if (searchTerm && !text.includes(searchTerm.toLowerCase())) return false;

      if (statusFilter === 'MATCHED' && item.diff_amount !== 0) return false;
      if (statusFilter === 'DIFF' && item.diff_amount === 0) return false;
      if (statusFilter === 'ERROR' && !item.errorcode) return false;

      return true;
    });
  }, [candidates, searchTerm, statusFilter]);

  // Toggle select all filtered
  const handleToggleSelectAll = (checked: boolean) => {
    const updated = { ...selectedIds };
    filteredItems.forEach((item) => {
      updated[item.id] = checked;
    });
    setSelectedIds(updated);
  };

  // Recalculate totals based on currently SELECTED items
  const activeSummary = useMemo(() => {
    if (!candidates) return { claimable: 0, received: 0, diff: 0, disallowance: 0, overpay: 0, count: 0 };
    let claimable = 0;
    let received = 0;
    let diff = 0;
    let disallowance = 0;
    let overpay = 0;
    let count = 0;

    candidates.items.forEach((item) => {
      if (selectedIds[item.id]) {
        count += 1;
        claimable += item.claimable_amount;
        received += item.paid_amount;
        const d = item.diff_amount;
        diff += d;
        if (d < 0) disallowance += Math.abs(d);
        else if (d > 0) overpay += d;
      }
    });

    return {
      claimable: Number(claimable.toFixed(2)),
      received: Number(received.toFixed(2)),
      diff: Number(diff.toFixed(2)),
      disallowance: Number(disallowance.toFixed(2)),
      overpay: Number(overpay.toFixed(2)),
      count,
    };
  }, [candidates, selectedIds]);

  // Dynamic Journal Preview
  const activeJournal = useMemo(() => {
    const debit = [
      { code: '1101010104.101', name: 'เงินฝากธนาคารในงบประมาณ/เงินบำรุง', amount: activeSummary.received },
      ...(activeSummary.disallowance > 0
        ? [{ code: '5103010102.101', name: 'ค่ารักษาพยาบาลต่ำกว่าเกณฑ์/ส่วนลดจ่าย', amount: activeSummary.disallowance }]
        : []),
    ];
    const credit = [
      { code: '1102050101.201', name: 'ลูกหนี้ค่ารักษาพยาบาล สปสช./กองทุน', amount: activeSummary.claimable },
      ...(activeSummary.overpay > 0
        ? [{ code: '4301020105.101', name: 'รายได้ค่ารักษาพยาบาลสูงกว่าเกณฑ์/ชดเชยเพิ่ม', amount: activeSummary.overpay }]
        : []),
    ];

    const totalDebit = debit.reduce((s, e) => s + e.amount, 0);
    const totalCredit = credit.reduce((s, e) => s + e.amount, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.05;

    return { debit, credit, totalDebit, totalCredit, isBalanced };
  }, [activeSummary]);

  // Execute Settlement
  const handleExecuteSettlement = async () => {
    if (!candidates || activeSummary.count === 0) {
      setErrorMsg('กรุณาเลือกรายการที่ต้องการตัดลูกหนี้');
      return;
    }

    const targetStatement = customStatementNo.trim() || selectedStatementNo.trim();
    if (!window.confirm(`ยืนยันการบันทึกตัดรับรู้ลูกหนี้จำนวน ${activeSummary.count} รายการ ยอดเงินรับจริง ${formatMoney(activeSummary.received)} บาท หรือไม่?`)) {
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const selectedItemsPayload = candidates.items
        .filter((item) => selectedIds[item.id])
        .map((item) => ({
          statement_record_id: item.id,
          patient_type: item.patient_type,
          vn: item.vn,
          an: item.an,
          hn: item.hn,
          cid: item.cid,
          patient_name: item.patient_name,
          service_date: item.service_date,
          pttype: item.maininscl,
          hipdata_code: item.maininscl,
          debtor_code: item.debtor_code,
          revenue_code: item.revenue_code,
          claimable_amount: item.claimable_amount,
          paid_amount: item.paid_amount,
          diff_amount: item.diff_amount,
          settle_action: itemActions[item.id] || item.settle_action,
          error_code: item.errorcode,
          notes: item.notes,
        }));

      const res = await executeSettlement({
        payer_type: payerType,
        statement_no: targetStatement,
        transfer_date: transferDate,
        bank_account: bankAccount,
        notes,
        items: selectedItemsPayload,
      });

      setSuccessMsg(`บันทึกตัดรับรู้ลูกหนี้เรียบร้อยแล้ว เลขที่ใบสำคัญ: ${res.settlement_no}`);

      // Open voucher preview modal directly
      if (res.batch_id) {
        handleViewVoucher(res.batch_id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกตัดลูกหนี้');
    } finally {
      setSubmitting(false);
    }
  };

  // View & Print Voucher
  const handleViewVoucher = async (batchId: number) => {
    setLoadingVoucher(true);
    setVoucherModalOpen(true);
    try {
      const voucher = await fetchSettlementVoucher(batchId);
      setVoucherData(voucher);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'โหลดข้อมูลใบสำคัญไม่สำเร็จ');
      setVoucherModalOpen(false);
    } finally {
      setLoadingVoucher(false);
    }
  };

  // Export Candidate list to Excel
  const handleExportExcel = () => {
    if (!candidates || candidates.items.length === 0) return;
    const rows = candidates.items
      .filter((item) => selectedIds[item.id])
      .map((item, index) => ({
        ลำดับ: index + 1,
        ประเภท: item.patient_type,
        วันที่บริการ: item.service_date || '',
        HN: item.hn || '',
        'VN/AN': item.vn || item.an || '',
        ชื่อผู้ป่วย: item.patient_name || '',
        สิทธิ: item.maininscl || '',
        รหัสลูกหนี้: item.debtor_code,
        รหัสรายได้: item.revenue_code,
        ยอดตั้งหนี้: item.claimable_amount,
        ยอดเงินชดเชย: item.paid_amount,
        ผลต่าง: item.diff_amount,
        สถานะตัดหนี้: itemActions[item.id] || item.settle_action,
        ErrorCode: item.errorcode || '',
      }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'รายการตัดลูกหนี้');
    XLSX.writeFile(wb, `settlement-${candidates.statement_no || 'export'}.xlsx`);
  };

  return (
    <div className="settlement-container">
      {/* Header */}
      <div className="settlement-header">
        <h1 className="settlement-title">
          <span>💳</span> ระบบตัดรับรู้ลูกหนี้ค่ารักษาพยาบาล (AR Settlement)
        </h1>
        <p className="settlement-subtitle">
          บันทึกรับเงินโอน จับคู่ Statement (สปสช./กรมบัญชีกลาง/กองทุน) ตัดยอดลูกหนี้ตามเกณฑ์คงค้าง และออกใบสำคัญทางบัญชี
        </p>
      </div>

      {/* Tabs */}
      <div className="settlement-tabs">
        <button
          className={`settlement-tab-btn ${activeTab === 'settle' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('settle')}
        >
          <span>📝</span> บันทึกตัดรับรู้ลูกหนี้
        </button>
        <button
          className={`settlement-tab-btn ${activeTab === 'history' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span>📜</span> ประวัติใบสำคัญตัดลูกหนี้
        </button>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div style={{ background: '#fee2e2', border: '1px solid #f87171', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          ⚠️ {errorMsg}
        </div>
      )}
      {successMsg && (
        <div style={{ background: '#dcfce7', border: '1px solid #4ade80', color: '#15803d', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          ✅ {successMsg}
        </div>
      )}

      {activeTab === 'settle' ? (
        <div>
          {/* Step 1: Form Header */}
          <div className="settlement-card">
            <h2 className="settlement-card-title">
              <span>📥</span> 1. ข้อมูลการรับเงินและเลือก Statement
            </h2>
            <div className="settlement-form-grid">
              <div className="settlement-field">
                <label className="settlement-label">แหล่งเงิน / กองทุน</label>
                <select
                  className="settlement-select"
                  value={payerType}
                  onChange={(e) => setPayerType(e.target.value)}
                >
                  <option value="NHSO">สปสช. (e-Claim / NHSO)</option>
                  <option value="OFC">กรมบัญชีกลาง (เบิกจ่ายตรง CSCD / OFC)</option>
                  <option value="LGO">อปท. (เบิกจ่ายตรง อปท. / LGO)</option>
                  <option value="SSS">ประกันสังคม (SSS)</option>
                  <option value="ALL">ทั้งหมด</option>
                </select>
              </div>

              <div className="settlement-field">
                <label className="settlement-label">เลือกจาก Statement ที่นำเข้าแล้ว</label>
                <select
                  className="settlement-select"
                  value={selectedStatementNo}
                  onChange={(e) => {
                    setSelectedStatementNo(e.target.value);
                    setCustomStatementNo('');
                  }}
                  disabled={loadingStatements || statements.length === 0}
                >
                  {statements.length === 0 ? (
                    <option value="">{loadingStatements ? 'กำลังโหลด...' : 'ไม่พบ Statement ในระบบ'}</option>
                  ) : (
                    statements.map((s) => (
                      <option key={s.statement_no} value={s.statement_no}>
                        {s.statement_no} ({s.record_count} รายการ | {formatMoney(s.total_paid_amount)} บ.)
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="settlement-field">
                <label className="settlement-label">หรือระบุ Statement No. เอง</label>
                <input
                  type="text"
                  className="settlement-input"
                  placeholder="เช่น STM67-001 หรือพิมพ์ระบุ"
                  value={customStatementNo}
                  onChange={(e) => setCustomStatementNo(e.target.value)}
                />
              </div>

              <div className="settlement-field">
                <label className="settlement-label">วันที่เงินโอนเข้าธนาคาร</label>
                <input
                  type="date"
                  className="settlement-input"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                />
              </div>

              <div className="settlement-field">
                <label className="settlement-label">บัญชีธนาคารรับเงิน</label>
                <input
                  type="text"
                  className="settlement-input"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                />
              </div>

              <div className="settlement-field">
                <label className="settlement-label">หมายเหตุ / อ้างอิง</label>
                <input
                  type="text"
                  className="settlement-input"
                  placeholder="เช่น เงินโอนงวดที่ 1/2567"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="settlement-field" style={{ alignSelf: 'flex-end' }}>
                <button
                  className="btn-primary"
                  onClick={handleLoadCandidates}
                  disabled={loadingCandidates}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <span>🔄</span> {loadingCandidates ? 'กำลังโหลด...' : 'โหลดข้อมูลและคำนวณกระทบยอด'}
                </button>
              </div>
            </div>
          </div>

          {/* Step 2: Summary Metrics */}
          {candidates && (
            <>
              <div className="settlement-metrics-grid">
                <div className="metric-card accent-blue">
                  <div className="metric-label">ยอดตั้งลูกหนี้เดิม</div>
                  <div className="metric-value">{formatMoney(activeSummary.claimable)} <span style={{ fontSize: '0.8rem' }}>บาท</span></div>
                  <div className="metric-sub">{activeSummary.count} รายการที่เลือก</div>
                </div>
                <div className="metric-card accent-green">
                  <div className="metric-label">ยอดเงินรับโอนจริง</div>
                  <div className="metric-value">{formatMoney(activeSummary.received)} <span style={{ fontSize: '0.8rem' }}>บาท</span></div>
                  <div className="metric-sub">โอนเข้าธนาคาร</div>
                </div>
                <div className="metric-card accent-red">
                  <div className="metric-label">ยอดตัดจ่าย (ต่ำกว่าเกณฑ์)</div>
                  <div className="metric-value">{formatMoney(activeSummary.disallowance)} <span style={{ fontSize: '0.8rem' }}>บาท</span></div>
                  <div className="metric-sub">ผลต่างที่ถูกตัดจ่าย</div>
                </div>
                <div className="metric-card accent-purple">
                  <div className="metric-label">ยอดชดเชยเกิน (สูงกว่าเกณฑ์)</div>
                  <div className="metric-value">{formatMoney(activeSummary.overpay)} <span style={{ fontSize: '0.8rem' }}>บาท</span></div>
                  <div className="metric-sub">รายได้เงินเพิ่มพิเศษ/On-top</div>
                </div>
              </div>

              {/* Step 3: Journal Preview (ผังบัญชี GFMIS) */}
              <div className="journal-preview-card">
                <div className="journal-header">
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>
                    📊 พรีวิวการลงบัญชีแยกประเภท (GL Journal Entry - เกณฑ์คงค้าง สธ.)
                  </div>
                  {activeJournal.isBalanced ? (
                    <span className="badge-balanced">✓ ดุลบัญชีสมบูรณ์ (Debit = Credit)</span>
                  ) : (
                    <span className="badge-unbalanced">⚠ ดุลบัญชีไม่เท่ากัน</span>
                  )}
                </div>
                <table className="journal-table">
                  <thead>
                    <tr>
                      <th style={{ width: '12%' }}>ประเภท</th>
                      <th style={{ width: '22%' }}>รหัสบัญชี</th>
                      <th style={{ width: '46%' }}>ชื่อบัญชีตามผังมาตรฐาน สธ.</th>
                      <th style={{ width: '20%', textAlign: 'right' }}>จำนวนเงิน (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeJournal.debit.map((d, i) => (
                      <tr key={`dr-${i}`}>
                        <td style={{ fontWeight: 700, color: '#0284c7' }}>เดบิต (Dr.)</td>
                        <td style={{ fontFamily: 'monospace' }}>{d.code}</td>
                        <td>{d.name}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(d.amount)}</td>
                      </tr>
                    ))}
                    {activeJournal.credit.map((c, i) => (
                      <tr key={`cr-${i}`}>
                        <td style={{ fontWeight: 700, color: '#16a34a', paddingLeft: '1.5rem' }}>เครดิต (Cr.)</td>
                        <td style={{ fontFamily: 'monospace' }}>{c.code}</td>
                        <td style={{ paddingLeft: '1.5rem' }}>{c.name}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Step 4: Table Controls & Actions */}
              <div className="settlement-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      className="settlement-input"
                      placeholder="ค้นหา HN / VN / AN / ชื่อ / Error..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ width: '260px' }}
                    />
                    <select
                      className="settlement-select"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                    >
                      <option value="ALL">ทุกสถานะผลต่าง</option>
                      <option value="MATCHED">เฉพาะยอดตรงกัน (ครบ)</option>
                      <option value="DIFF">เฉพาะมียอดต่าง (ขาด/เกิน)</option>
                      <option value="ERROR">เฉพาะติด Error</option>
                    </select>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      แสดง {filteredItems.length} จาก {candidates.items.length} รายการ
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn-secondary" onClick={handleExportExcel}>
                      <span>📊</span> ส่งออก Excel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={handleExecuteSettlement}
                      disabled={submitting || activeSummary.count === 0}
                    >
                      <span>💾</span> {submitting ? 'กำลังบันทึก...' : `ยืนยันบันทึกตัดลูกหนี้ (${activeSummary.count} รายการ)`}
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div className="settlement-table-wrapper">
                  <table className="settlement-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={filteredItems.length > 0 && filteredItems.every((item) => selectedIds[item.id])}
                            onChange={(e) => handleToggleSelectAll(e.target.checked)}
                          />
                        </th>
                        <th>ประเภท</th>
                        <th>วันที่บริการ</th>
                        <th>HN</th>
                        <th>VN / AN</th>
                        <th>ชื่อผู้ป่วย</th>
                        <th>สิทธิ</th>
                        <th>รหัสลูกหนี้</th>
                        <th style={{ textAlign: 'right' }}>ยอดตั้งหนี้</th>
                        <th style={{ textAlign: 'right' }}>เงินชดเชย</th>
                        <th style={{ textAlign: 'right' }}>ผลต่าง</th>
                        <th>Error</th>
                        <th>การตัดหนี้</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => {
                        const isSelected = Boolean(selectedIds[item.id]);
                        return (
                          <tr key={item.id} style={{ opacity: isSelected ? 1 : 0.45 }}>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) =>
                                  setSelectedIds({ ...selectedIds, [item.id]: e.target.checked })
                                }
                              />
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                background: item.patient_type === 'IPD' ? '#ede9fe' : '#e0f2fe',
                                color: item.patient_type === 'IPD' ? '#6d28d9' : '#0369a1',
                              }}>
                                {item.patient_type}
                              </span>
                            </td>
                            <td>{item.service_date || '-'}</td>
                            <td style={{ fontFamily: 'monospace' }}>{item.hn || '-'}</td>
                            <td style={{ fontFamily: 'monospace' }}>{item.vn || item.an || '-'}</td>
                            <td>{item.patient_name || '-'}</td>
                            <td>{item.maininscl || '-'}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.debtor_code}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(item.claimable_amount)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>{formatMoney(item.paid_amount)}</td>
                            <td style={{ textAlign: 'right' }}>
                              {item.diff_amount === 0 ? (
                                <span className="badge-diff-zero">0.00</span>
                              ) : item.diff_amount < 0 ? (
                                <span className="badge-diff-neg">{formatMoney(item.diff_amount)}</span>
                              ) : (
                                <span className="badge-diff-pos">+{formatMoney(item.diff_amount)}</span>
                              )}
                            </td>
                            <td>
                              {item.errorcode ? (
                                <span style={{ color: '#dc2626', fontSize: '0.78rem', fontWeight: 600 }} title={item.verifycode || ''}>
                                  {item.errorcode}
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>-</span>
                              )}
                            </td>
                            <td>
                              <select
                                className="settlement-select"
                                style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                value={itemActions[item.id] || item.settle_action}
                                onChange={(e) =>
                                  setItemActions({ ...itemActions, [item.id]: e.target.value })
                                }
                              >
                                <option value="full">ตัดรับชำระครบ</option>
                                <option value="writeoff_diff">ตัดผลต่าง/หนี้สูญ</option>
                                <option value="hold_appeal">พักรออุทธรณ์</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        /* History Tab */
        <div className="settlement-card">
          <h2 className="settlement-card-title">
            <span>📜</span> ประวัติชุดใบสำคัญตัดรับรู้ลูกหนี้
          </h2>
          {loadingHistory ? (
            <p>กำลังโหลดประวัติ...</p>
          ) : history.length === 0 ? (
            <p style={{ color: '#64748b' }}>ยังไม่มีประวัติการตัดลูกหนี้</p>
          ) : (
            <div className="settlement-table-wrapper">
              <table className="settlement-table">
                <thead>
                  <tr>
                    <th>เลขที่ใบสำคัญ</th>
                    <th>วันที่โอน</th>
                    <th>กองทุน/สิทธิ</th>
                    <th>Statement No.</th>
                    <th style={{ textAlign: 'right' }}>จำนวนรายการ</th>
                    <th style={{ textAlign: 'right' }}>ยอดตั้งหนี้เดิม</th>
                    <th style={{ textAlign: 'right' }}>ยอดเงินรับจริง</th>
                    <th style={{ textAlign: 'right' }}>ยอดตัดจ่าย (ผลต่าง)</th>
                    <th>วันที่บันทึก</th>
                    <th style={{ textAlign: 'center' }}>การกระทำ</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td style={{ fontWeight: 700, color: '#0284c7' }}>{h.settlement_no}</td>
                      <td>{h.transfer_date}</td>
                      <td>{h.payer_type}</td>
                      <td>{h.statement_no || '-'}</td>
                      <td style={{ textAlign: 'right' }}>{h.item_count}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(h.total_claimable)}</td>
                      <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{formatMoney(h.total_received)}</td>
                      <td style={{ textAlign: 'right', color: '#dc2626' }}>{formatMoney(h.total_disallowance)}</td>
                      <td>{h.created_at}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => handleViewVoucher(h.id)}
                        >
                          <span>📄</span> ใบสำคัญ (A4)
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Official Voucher Modal (A4 Print Preview) */}
      {voucherModalOpen && (
        <div className="voucher-modal-overlay" onClick={() => setVoucherModalOpen(false)}>
          <div className="voucher-modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="voucher-modal-header">
              <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#0f172a' }}>
                📄 ใบสำคัญสรุปการตัดรับรู้ลูกหนี้ค่ารักษาพยาบาล (Settlement Voucher)
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-primary" onClick={() => window.print()}>
                  <span>🖨️</span> พิมพ์เอกสาร (A4)
                </button>
                <button className="btn-secondary" onClick={() => setVoucherModalOpen(false)}>
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>

            <div className="voucher-modal-body">
              {loadingVoucher || !voucherData ? (
                <p style={{ textAlign: 'center', padding: '2rem' }}>กำลังโหลดใบสำคัญ...</p>
              ) : (
                <>
                  <div className="voucher-title-section">
                    <div className="voucher-hospital-title">{voucherData.hospital.hospital_name}</div>
                    <div className="voucher-doc-title">ใบสำคัญสรุปการรับเงินและตัดรับรู้ลูกหนี้ค่ารักษาพยาบาล</div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      ตามมาตรฐานระบบบัญชีเกณฑ์คงค้างภาครัฐ กระทรวงสาธารณสุข
                    </div>
                  </div>

                  <div className="voucher-meta-grid">
                    <div><strong>เลขที่ใบสำคัญ:</strong> {voucherData.batch.settlement_no}</div>
                    <div><strong>วันที่รับเงินโอน:</strong> {voucherData.batch.transfer_date}</div>
                    <div><strong>แหล่งเงิน/กองทุน:</strong> {voucherData.batch.payer_type}</div>
                    <div><strong>Statement No.:</strong> {voucherData.batch.statement_no || '-'}</div>
                    <div><strong>บัญชีธนาคาร:</strong> {voucherData.batch.bank_account}</div>
                    <div><strong>จำนวนเคสที่ตัดหนี้:</strong> {voucherData.batch.item_count} รายการ</div>
                  </div>

                  {/* Summary Table */}
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                    1. สรุปยอดเงินกระทบยอด (Reconciliation Summary)
                  </div>
                  <table className="voucher-summary-table">
                    <thead>
                      <tr>
                        <th>รายการ</th>
                        <th style={{ textAlign: 'right', width: '25%' }}>จำนวนเงิน (บาท)</th>
                        <th>หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>ยอดลูกหนี้ค่ารักษาพยาบาลเดิม (Original AR Billed)</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(voucherData.batch.total_claimable)}</td>
                        <td>ยอดที่เคยตั้งลูกหนี้ไว้</td>
                      </tr>
                      <tr>
                        <td>ยอดเงินที่ได้รับโอนชดเชยจริง (Actual Cash Received)</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{formatMoney(voucherData.batch.total_received)}</td>
                        <td>เข้าบัญชีเงินบำรุงโรงพยาบาล</td>
                      </tr>
                      <tr>
                        <td>ยอดผลต่างตัดจ่าย/ต่ำกว่าเกณฑ์ (Disallowance / Deductions)</td>
                        <td style={{ textAlign: 'right', color: '#dc2626' }}>{formatMoney(voucherData.batch.total_disallowance)}</td>
                        <td>ตัดเป็นค่ารักษาต่ำกว่าเกณฑ์/ส่วนลดจ่าย</td>
                      </tr>
                      {Number(voucherData.batch.total_overpay) > 0 && (
                        <tr>
                          <td>ยอดเงินชดเชยสูงกว่าเกณฑ์ (Over-recovery / On-top)</td>
                          <td style={{ textAlign: 'right', color: '#0369a1' }}>{formatMoney(voucherData.batch.total_overpay)}</td>
                          <td>รายได้ค่ารักษาพยาบาลสูงกว่าเกณฑ์</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* GL Journal Table */}
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.95rem', marginTop: '1.5rem' }}>
                    2. การบันทึกบัญชีแยกประเภท (General Ledger Journal Voucher)
                  </div>
                  <table className="voucher-summary-table">
                    <thead>
                      <tr>
                        <th style={{ width: '15%' }}>ประเภท</th>
                        <th style={{ width: '25%' }}>รหัสบัญชี (GFMIS)</th>
                        <th style={{ width: '40%' }}>ชื่อบัญชี</th>
                        <th style={{ textAlign: 'right', width: '20%' }}>เดบิต / เครดิต (บาท)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {voucherData.batch.journal_entries?.map((j, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 700, color: j.type === 'DEBIT' ? '#0284c7' : '#16a34a', paddingLeft: j.type === 'CREDIT' ? '1rem' : '0.5rem' }}>
                            {j.type === 'DEBIT' ? 'เดบิต (Dr.)' : 'เครดิต (Cr.)'}
                          </td>
                          <td style={{ fontFamily: 'monospace' }}>{j.account_code}</td>
                          <td style={{ paddingLeft: j.type === 'CREDIT' ? '1rem' : '0.5rem' }}>{j.account_name}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(j.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Signatures */}
                  <div className="voucher-signature-grid">
                    <div className="voucher-signature-box">
                      <div>ลงชื่อ ......................................................</div>
                      <div style={{ marginTop: '0.5rem', fontWeight: 600 }}>({voucherData.batch.created_by || '......................................................'})</div>
                      <div style={{ color: '#64748b' }}>ผู้จัดทำ (เจ้าหน้าที่การเงิน)</div>
                    </div>
                    <div className="voucher-signature-box">
                      <div>ลงชื่อ ......................................................</div>
                      <div style={{ marginTop: '0.5rem', fontWeight: 600 }}>(......................................................)</div>
                      <div style={{ color: '#64748b' }}>ผู้ตรวจสอบ (หัวหน้ากลุ่มงานประกันฯ)</div>
                    </div>
                    <div className="voucher-signature-box">
                      <div>ลงชื่อ ......................................................</div>
                      <div style={{ marginTop: '0.5rem', fontWeight: 600 }}>(......................................................)</div>
                      <div style={{ color: '#64748b' }}>ผู้อนุมัติ (ผู้อำนวยการโรงพยาบาล)</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
