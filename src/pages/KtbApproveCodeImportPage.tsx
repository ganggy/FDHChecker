import React, { useState, useMemo, useRef } from 'react';
import { navigateFromDashboard } from '../utils/navigationState';

export type KtbParsedRow = {
  rowNo: number;
  hospitalCode: string;
  hospitalName: string;
  merchantId: string;
  terminalId: string;
  transactionDate: string;
  transactionTime: string;
  transactionDateTime: string;
  cid: string;
  patientName: string;
  amount: number;
  approveCode: string;
  traceNo?: string;
  transactionType: string;
  invoiceNo: string;
  channel: string;
  rawLine: string;
};

export type KtbMatchedVisit = {
  vn: string;
  hn: string;
  vstdate: string;
  vsttime: string;
  an?: string | null;
  pttype: string;
  pttypeName?: string;
  patientName: string;
  hosxpPrice: number;
  existingAuthCode?: string;
  existingAuthDateTime?: string;
};

export type KtbMatchStatus =
  | 'READY_TO_IMPORT'
  | 'ALREADY_SET'
  | 'CONFLICT'
  | 'VISIT_NOT_FOUND'
  | 'PATIENT_NOT_FOUND'
  | 'NO_APPROVE_CODE';

export type KtbMatchItem = {
  rowNo: number;
  ktb: KtbParsedRow;
  status: KtbMatchStatus;
  statusMessage: string;
  matchedVisit?: KtbMatchedVisit;
  candidateVisits?: KtbMatchedVisit[];
  selectedVn?: string;
};

export type KtbMatchSummary = {
  totalRows: number;
  matchedCount: number;
  readyToImportCount: number;
  alreadySetCount: number;
  conflictCount: number;
  notFoundCount: number;
  noApproveCodeCount: number;
  totalAmount: number;
  items: KtbMatchItem[];
};

export function KtbApproveCodeImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchSummary, setMatchSummary] = useState<KtbMatchSummary | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'READY' | 'ALREADY' | 'CONFLICT' | 'NOT_FOUND'>('ALL');
  const [search, setSearch] = useState('');

  // Selections
  const [selectedRowNos, setSelectedRowNos] = useState<Set<number>>(new Set());
  const [allowOverwrite, setAllowOverwrite] = useState(false);

  // Saving
  const [saving, setSaving] = useState(false);
  const [savedVns, setSavedVns] = useState<Set<string>>(new Set());
  const [saveResultNotice, setSaveResultNotice] = useState<{ updatedCount: number; skippedCount: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = (file: File) => {
    setSelectedFile(file);
    setError(null);
    setSaveResultNotice(null);
    setSavedVns(new Set());
    setSelectedRowNos(new Set());

    const reader = new FileReader();
    setUploading(true);

    reader.onload = async () => {
      try {
        const base64Data = reader.result as string;
        const res = await fetch('/api/ktb-approve/upload-and-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            fileBase64: base64Data,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'ประมวลผลไฟล์ไม่สำเร็จ');
        }

        const data: KtbMatchSummary = json.data;
        setMatchSummary(data);

        // Pre-select rows that are READY_TO_IMPORT
        const initialSelected = new Set<number>();
        data.items.forEach((item) => {
          if (item.status === 'READY_TO_IMPORT') {
            initialSelected.add(item.rowNo);
          }
        });
        setSelectedRowNos(initialSelected);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์');
      } finally {
        setUploading(false);
      }
    };

    reader.onerror = () => {
      setError('ไม่สามารถอ่านไฟล์ได้');
      setUploading(false);
    };

    reader.readAsDataURL(file);
  };

  // Filtered rows
  const filteredItems = useMemo(() => {
    if (!matchSummary) return [];
    return matchSummary.items.filter((item) => {
      // Status filter
      if (statusFilter === 'READY' && item.status !== 'READY_TO_IMPORT') return false;
      if (statusFilter === 'ALREADY' && item.status !== 'ALREADY_SET') return false;
      if (statusFilter === 'CONFLICT' && item.status !== 'CONFLICT') return false;
      if (statusFilter === 'NOT_FOUND' && !['VISIT_NOT_FOUND', 'PATIENT_NOT_FOUND'].includes(item.status)) return false;

      // Search
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const ktb = item.ktb;
        const v = item.matchedVisit;
        const matchKtb =
          ktb.patientName.toLowerCase().includes(q) ||
          ktb.cid.includes(q) ||
          ktb.approveCode.toLowerCase().includes(q) ||
          ktb.invoiceNo.toLowerCase().includes(q);
        const matchVisit = v && (v.vn.includes(q) || v.hn.includes(q) || v.patientName.toLowerCase().includes(q));
        if (!matchKtb && !matchVisit) return false;
      }

      return true;
    });
  }, [matchSummary, statusFilter, search]);

  // Select all / Deselect all
  const handleToggleSelectAll = () => {
    const selectableRows = filteredItems.filter((i) => i.matchedVisit && i.ktb.approveCode);
    const allSelected = selectableRows.length > 0 && selectableRows.every((i) => selectedRowNos.has(i.rowNo));

    const next = new Set(selectedRowNos);
    if (allSelected) {
      selectableRows.forEach((i) => next.delete(i.rowNo));
    } else {
      selectableRows.forEach((i) => next.add(i.rowNo));
    }
    setSelectedRowNos(next);
  };

  // Apply approve codes to HOSxP
  const handleSaveToHosxp = async () => {
    if (!matchSummary || selectedRowNos.size === 0) {
      alert('กรุณาเลือกรายการที่ต้องการบันทึก');
      return;
    }

    const entriesToSave = matchSummary.items
      .filter((i) => selectedRowNos.has(i.rowNo) && i.matchedVisit && i.ktb.approveCode)
      .map((i) => ({
        vn: i.matchedVisit!.vn,
        cid: i.ktb.cid,
        approveCode: i.ktb.approveCode,
        transactionDateTime: i.ktb.transactionDateTime,
        terminalId: i.ktb.terminalId,
        overwrite: allowOverwrite,
      }));

    if (entriesToSave.length === 0) {
      alert('ไม่มีรายการที่สามารถบันทึกได้');
      return;
    }

    if (!confirm(`ยืนยันการบันทึก Approve Code จำนวน ${entriesToSave.length} รายการลงฐานข้อมูล HOSxP?`)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/ktb-approve/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToSave }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'บันทึกข้อมูลไม่สำเร็จ');
      }

      const newlySaved = new Set(savedVns);
      (json.data.updatedVns || []).forEach((vn: string) => newlySaved.add(vn));
      setSavedVns(newlySaved);
      setSaveResultNotice({
        updatedCount: json.data.updatedCount,
        skippedCount: json.data.skippedCount,
      });

      // Update local match items status
      setMatchSummary((prev) => {
        if (!prev) return null;
        const nextItems = prev.items.map((item) => {
          if (item.matchedVisit && newlySaved.has(item.matchedVisit.vn)) {
            return {
              ...item,
              status: 'ALREADY_SET' as KtbMatchStatus,
              statusMessage: `บันทึกลง HOSxP เรียบร้อยแล้ว (${item.ktb.approveCode})`,
              matchedVisit: {
                ...item.matchedVisit,
                existingAuthCode: item.ktb.approveCode,
              },
            };
          }
          return item;
        });
        return { ...prev, items: nextItems };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setSaving(false);
    }
  };

  // Direct export to FDH for saved visits
  const handleSendToFdh = (vnsToSend: string[]) => {
    if (vnsToSend.length === 0) {
      alert('ไม่มีวิสิตสำหรับส่งออก');
      return;
    }
    navigateFromDashboard('fdh', {
      source: 'dashboard',
      contextLabel: `นำเข้าจาก KTB EDC: ${vnsToSend.length} รายการ`,
      fdh: {
        targetVns: vnsToSend,
        statusFilter: 'all',
      },
    });
  };

  const getStatusBadge = (status: KtbMatchStatus) => {
    switch (status) {
      case 'READY_TO_IMPORT':
        return <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>🟢 พร้อมบันทึก</span>;
      case 'ALREADY_SET':
        return <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>🔵 รหัสเดิมตรงกัน</span>;
      case 'CONFLICT':
        return <span style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>⚠️ รหัสเดิมไม่ตรง</span>;
      case 'VISIT_NOT_FOUND':
        return <span style={{ background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '6px', fontSize: '11px' }}>⚪ ไม่พบวิสิต</span>;
      case 'PATIENT_NOT_FOUND':
        return <span style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '3px 8px', borderRadius: '6px', fontSize: '11px' }}>❌ ไม่พบ CID</span>;
      case 'NO_APPROVE_CODE':
        return <span style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb', padding: '3px 8px', borderRadius: '6px', fontSize: '11px' }}>⛔ ไม่มีรหัสอนุมัติ</span>;
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '32px' }}>🏦</span>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#1e293b' }}>
                นำเข้าและ Matching Approve Code KTB (EDC / กรมบัญชีกลาง)
              </h1>
              <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '14px' }}>
                นำเข้าไฟล์สรุปรายการรูดบัตร EDC จากธนาคารกรุงไทย (ไฟล์ ZIP หรือ TXT) เพื่อจับคู่กับวิสิต HOSxP และบันทึก Approve Code สำหรับเบิก E-Claim และ FDH 16 แฟ้ม
              </p>
            </div>
          </div>
        </div>

        {savedVns.size > 0 && (
          <button
            type="button"
            onClick={() => handleSendToFdh(Array.from(savedVns))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              border: 'none',
              color: '#fff',
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 4px 10px rgba(16, 185, 129, 0.3)',
            }}
          >
            🚀 ส่งออก FDH เคสที่เพิ่งอัปเดต ({savedVns.size} เคส)
          </button>
        )}
      </div>

      {/* Upload Zone Card */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              📁 เลือกไฟล์รายการรูดบัตร KTB
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
              รองรับทั้งไฟล์ ZIP (เช่น <code>DWN_HOSPITAL_0000011101_*.zip</code>) หรือไฟล์ข้อความ TXT (<code>HCG*.txt</code>) จากระบบ Krungthai Health Platform
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".zip,.txt"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {uploading ? '⏳ กำลังประมวลผลไฟล์...' : '📂 เลือกไฟล์นำเข้า (.zip / .txt)'}
            </button>

            {selectedFile && (
              <span style={{ fontSize: '13px', color: '#334155', fontWeight: 600, background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px' }}>
                📄 {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>
        </div>

        {error && (
          <div style={{ marginTop: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px', color: '#991b1b', fontSize: '13px' }}>
            ⚠️ {error}
          </div>
        )}

        {saveResultNotice && (
          <div style={{ marginTop: '16px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '12px 16px', color: '#065f46', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>✅ บันทึก Approve Code สำเร็จ {saveResultNotice.updatedCount} รายการ!</strong>
              {saveResultNotice.skippedCount > 0 && <span style={{ marginLeft: 8 }}>(ข้าม {saveResultNotice.skippedCount} รายการ)</span>}
            </div>
            {savedVns.size > 0 && (
              <button
                type="button"
                onClick={() => handleSendToFdh(Array.from(savedVns))}
                style={{ background: '#059669', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                🚀 ส่งต่อไปหน้าส่งออก FDH ทันที
              </button>
            )}
          </div>
        )}
      </div>

      {/* Summary KPI Cards */}
      {matchSummary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', borderLeft: '4px solid #64748b' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>รายการทั้งหมดในไฟล์</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
              {matchSummary.totalRows.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
              ยอดรวม ฿{matchSummary.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '14px', borderLeft: '4px solid #10b981' }}>
            <div style={{ fontSize: '12px', color: '#047857', fontWeight: 600 }}>🟢 พร้อมนำเข้า (ไม่มีรหัสเดิม)</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#059669', marginTop: '4px' }}>
              {matchSummary.readyToImportCount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: '#047857' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '12px', color: '#059669', marginTop: '2px' }}>
              จับคู่ตรงกับวิสิต HOSxP
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '14px', borderLeft: '4px solid #3b82f6' }}>
            <div style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 600 }}>🔵 มีรหัสตรงกันแล้ว</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563eb', marginTop: '4px' }}>
              {matchSummary.alreadySetCount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: '#1d4ed8' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '12px', color: '#2563eb', marginTop: '2px' }}>
              รหัสใน HOSxP ตรงกับ KTB แล้ว
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: '10px', padding: '14px', borderLeft: '4px solid #f59e0b' }}>
            <div style={{ fontSize: '12px', color: '#b45309', fontWeight: 600 }}>⚠️ มีรหัสเดิมแต่ไม่ตรง</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#d97706', marginTop: '4px' }}>
              {matchSummary.conflictCount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: '#b45309' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '12px', color: '#d97706', marginTop: '2px' }}>
              ต้องเปิด Overwrite หากต้องการทับ
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', borderLeft: '4px solid #94a3b8' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>⚪ ไม่พบวิสิตในวันที่ระบุ</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#475569', marginTop: '4px' }}>
              {matchSummary.notFoundCount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              ไม่มี visit ในวันรูดบัตร
            </div>
          </div>
        </div>
      )}

      {/* Main Content Table & Control */}
      {matchSummary && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {/* Action & Filter Toolbar */}
          <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            {/* Filter buttons */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: statusFilter === 'ALL' ? '2px solid #0284c7' : '1px solid #cbd5e1',
                  background: statusFilter === 'ALL' ? '#e0f2fe' : '#fff',
                  color: statusFilter === 'ALL' ? '#0369a1' : '#334155',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ทั้งหมด ({matchSummary.items.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('READY')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: statusFilter === 'READY' ? '2px solid #059669' : '1px solid #cbd5e1',
                  background: statusFilter === 'READY' ? '#ecfdf5' : '#fff',
                  color: statusFilter === 'READY' ? '#047857' : '#334155',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                🟢 พร้อมบันทึก ({matchSummary.readyToImportCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ALREADY')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: statusFilter === 'ALREADY' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background: statusFilter === 'ALREADY' ? '#eff6ff' : '#fff',
                  color: statusFilter === 'ALREADY' ? '#1d4ed8' : '#334155',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                🔵 มีรหัสตรงกันแล้ว ({matchSummary.alreadySetCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('CONFLICT')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: statusFilter === 'CONFLICT' ? '2px solid #d97706' : '1px solid #cbd5e1',
                  background: statusFilter === 'CONFLICT' ? '#fffbeb' : '#fff',
                  color: statusFilter === 'CONFLICT' ? '#b45309' : '#334155',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ⚠️ รหัสขัดแย้ง ({matchSummary.conflictCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('NOT_FOUND')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: statusFilter === 'NOT_FOUND' ? '2px solid #475569' : '1px solid #cbd5e1',
                  background: statusFilter === 'NOT_FOUND' ? '#f1f5f9' : '#fff',
                  color: statusFilter === 'NOT_FOUND' ? '#1e293b' : '#334155',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ⚪ ไม่พบวิสิต ({matchSummary.notFoundCount})
              </button>
            </div>

            {/* Search */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 ค้นหา ชื่อ, CID, HN, VN, รหัส..."
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12px',
                  width: '240px',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  ล้าง
                </button>
              )}
            </div>
          </div>

          {/* Action Banner */}
          <div style={{ padding: '12px 20px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#1e40af', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={filteredItems.length > 0 && filteredItems.filter((i) => i.matchedVisit && i.ktb.approveCode).every((i) => selectedRowNos.has(i.rowNo))}
                  onChange={handleToggleSelectAll}
                />
                เลือกทั้งหมดในมุมมองนี้
              </label>
              <span style={{ fontSize: '13px', color: '#3b82f6' }}>
                เลือกแล้ว <strong>{selectedRowNos.size}</strong> รายการ
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={allowOverwrite}
                  onChange={(e) => setAllowOverwrite(e.target.checked)}
                />
                ⚠️ อนุญาตให้บันทึกทับรหัสเดิมใน HOSxP (Overwrite)
              </label>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handleSaveToHosxp}
                disabled={saving || selectedRowNos.size === 0}
                style={{
                  background: selectedRowNos.size > 0 ? '#2563eb' : '#94a3b8',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: selectedRowNos.size > 0 && !saving ? 'pointer' : 'not-allowed',
                  boxShadow: selectedRowNos.size > 0 ? '0 2px 4px rgba(37, 99, 235, 0.3)' : 'none',
                }}
              >
                {saving ? '⏳ กำลังบันทึก...' : `💾 บันทึก Approve Code ลง HOSxP (${selectedRowNos.size} รายการ)`}
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto', maxHeight: '600px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, position: 'sticky', top: 0, zIndex: 10 }}>
                  <th style={{ padding: '10px 12px', width: '40px', textAlign: 'center' }}>เลือก</th>
                  <th style={{ padding: '10px 12px', width: '40px' }}>#</th>
                  <th style={{ padding: '10px 12px', width: '130px' }}>วันที่-เวลา (KTB)</th>
                  <th style={{ padding: '10px 12px', width: '190px' }}>ผู้ป่วย (KTB)</th>
                  <th style={{ padding: '10px 12px', width: '90px', textAlign: 'right' }}>ยอดเงิน KTB</th>
                  <th style={{ padding: '10px 12px', width: '110px', textAlign: 'center' }}>Approve Code</th>
                  <th style={{ padding: '10px 12px', width: '220px' }}>วิสิตใน HOSxP (Matching)</th>
                  <th style={{ padding: '10px 12px', width: '120px' }}>รหัสเดิมใน HOSxP</th>
                  <th style={{ padding: '10px 12px', width: '150px' }}>สถานะการจับคู่</th>
                  <th style={{ padding: '10px 12px', width: '120px' }}>ข้อมูลอ้างอิง</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isSelected = selectedRowNos.has(item.rowNo);
                  const isEligibleForCheck = Boolean(item.matchedVisit && item.ktb.approveCode);
                  const v = item.matchedVisit;
                  const isJustSaved = v && savedVns.has(v.vn);

                  return (
                    <tr
                      key={item.rowNo}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isJustSaved ? '#f0fdf4' : isSelected ? '#eff6ff' : '#fff',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isEligibleForCheck}
                          onChange={() => {
                            const next = new Set(selectedRowNos);
                            if (next.has(item.rowNo)) next.delete(item.rowNo);
                            else next.add(item.rowNo);
                            setSelectedRowNos(next);
                          }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{item.rowNo}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{item.ktb.transactionDate}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{item.ktb.transactionTime}</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.ktb.patientName || 'ไม่ระบุชื่อ'}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>CID: {item.ktb.cid}</div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                        ฿{item.ktb.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {item.ktb.approveCode ? (
                          <span style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '3px 8px', borderRadius: '6px', fontFamily: 'monospace', fontWeight: 800, fontSize: '13px', letterSpacing: '1px' }}>
                            {item.ktb.approveCode}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>- ว่าง -</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {v ? (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 700, color: '#0284c7' }}>VN: {v.vn}</span>
                              <span style={{ color: '#64748b', fontSize: '11px' }}>HN: {v.hn}</span>
                              {isJustSaved && (
                                <span style={{ background: '#dcfce7', color: '#15803d', padding: '1px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                                  ✨ บันทึกแล้ว
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11px', color: '#475569', marginTop: 2 }}>
                              สิทธิ: <strong>{v.pttypeName || v.pttype}</strong> | ยอดรวม HOSxP: ฿{v.hosxpPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>{item.statusMessage}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {v?.existingAuthCode ? (
                          <div>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: v.existingAuthCode === item.ktb.approveCode ? '#15803d' : '#b45309' }}>
                              {v.existingAuthCode}
                            </span>
                            {v.existingAuthDateTime && (
                              <div style={{ fontSize: '10px', color: '#94a3b8' }}>{v.existingAuthDateTime.slice(0, 10)}</div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>- ยังไม่มีรหัส -</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {getStatusBadge(item.status)}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '11px', color: '#64748b' }}>
                        <div>เครื่อง: {item.ktb.terminalId || '-'}</div>
                        {item.ktb.traceNo && <div>Trace: {item.ktb.traceNo}</div>}
                        {item.ktb.invoiceNo && item.ktb.invoiceNo !== item.ktb.approveCode && <div>Inv: {item.ktb.invoiceNo}</div>}
                      </td>
                    </tr>
                  );
                })}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8' }}>
                      ไม่พบรายการที่ตรงกับเงื่อนไขตัวกรอง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              แสดง {filteredItems.length} จากทั้งหมด {matchSummary.items.length} รายการ
            </div>
            {savedVns.size > 0 && (
              <button
                type="button"
                onClick={() => handleSendToFdh(Array.from(savedVns))}
                style={{ background: '#059669', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                🚀 ส่งออก FDH เฉพาะวิสิตที่เพิ่งอัปเดต ({savedVns.size} เคส)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
