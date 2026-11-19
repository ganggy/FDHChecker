import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface DrugCatalogReplyComparison {
  found: boolean;
  tmtid: string;
  genericName: string;
  unitPrice: number | null;
  ised: string;
  isedApproved: string;
  isedStatus: string;
  ndc24Approved: string;
  updateFlag: string;
  dateEffective: string;
  dateApproved: string;
  rp: string;
  status: string;
  error: string;
  tmtMismatch: boolean;
  priceMismatch: boolean;
  isedMismatch: boolean;
  hasError: boolean;
}

interface DrugCatalogReplySourceMeta {
  filename: string;
  rowCount: number;
  errorCount: number;
  importedAt: string;
  importedBy: string;
}

interface DrugCatalogReplyMeta {
  nhso?: DrugCatalogReplySourceMeta;
  chi?: DrugCatalogReplySourceMeta;
}

interface DrugCatalogIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

interface DrugCatalogRow {
  HospDrugCode: string;
  ProductCat: string;
  TMTID: string;
  SpecPrep: string;
  GenericName: string;
  TradeName: string;
  DFSCode: string;
  DosageForm: string;
  Strength: string;
  Content: string;
  UnitPrice: number;
  Price2?: number;
  Price3?: number;
  Distributor: string;
  Manufacturer: string;
  ISED: 'E' | 'N';
  NDC24: string;
  Packsize: string;
  Packprice: string;
  UpdateFlag: 'A' | 'E' | 'U' | 'D';
  DateChange: string;
  DateUpdate: string;
  DateEffective: string;
  DateExpiry: string;
  active: boolean;
  has_override: boolean;
  r51_flagged: boolean;
  nhso?: DrugCatalogReplyComparison | null;
  chi?: DrugCatalogReplyComparison | null;
  validation_status: 'ready' | 'warning' | 'error';
  issues: DrugCatalogIssue[];
}

interface DrugCatalogSummary {
  total: number;
  ready: number;
  warning: number;
  error: number;
  missingTmt: number;
  r51Flagged: number;
  nhsoFound?: number;
  nhsoMissing?: number;
  nhsoMismatch?: number;
  nhsoError?: number;
  chiFound?: number;
  chiMissing?: number;
  chiMismatch?: number;
  chiError?: number;
}

const emptySummary: DrugCatalogSummary = {
  total: 0,
  ready: 0,
  warning: 0,
  error: 0,
  missingTmt: 0,
  r51Flagged: 0,
  nhsoFound: 0,
  nhsoMissing: 0,
  nhsoMismatch: 0,
  nhsoError: 0,
  chiFound: 0,
  chiMissing: 0,
  chiMismatch: 0,
  chiError: 0,
};

const PRODUCT_CAT_LABELS: Record<string, string> = {
  '1': '1: ยาแผนปัจจุบัน (ทางการค้า)',
  '2': '2: ยาแผนปัจจุบันผลิตใช้เอง',
  '3': '3: ยาแผนไทย (ทางการค้า)',
  '4': '4: ยาแผนไทยผลิตใช้เอง',
  '5': '5: ยาแผนทางเลือกอื่น',
  '6': '6: เวชภัณฑ์',
  '7': '7: อื่นๆ',
};

export const DrugCatalogPage: React.FC = () => {
  const [items, setItems] = useState<DrugCatalogRow[]>([]);
  const [summary, setSummary] = useState<DrugCatalogSummary>(emptySummary);
  const [replyMeta, setReplyMeta] = useState<DrugCatalogReplyMeta>({});
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importingReply, setImportingReply] = useState(false);
  const [replySourceChoice, setReplySourceChoice] = useState<'auto' | 'nhso' | 'chi'>('auto');
  const [replaceExistingReply, setReplaceExistingReply] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'R51' | 'error' | 'warning' | 'missing_tmt' | 'ready' | 'nhso_mismatch' | 'nhso_missing' | 'chi_mismatch' | 'chi_missing' | 'reply_error'
  >('ALL');
  const [isedFilter, setIsedFilter] = useState<'ALL' | 'E' | 'N'>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [editing, setEditing] = useState<DrugCatalogRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [priceTier, setPriceTier] = useState<1 | 2 | 3>(1);
  const [chiSeq, setChiSeq] = useState<string>('9');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/drug-catalog/items?includeInactive=${includeInactive ? '1' : '0'}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'โหลดข้อมูล DrugCatalog ไม่สำเร็จ');
      setItems(Array.isArray(json.data) ? json.data : []);
      setSummary(json.summary || emptySummary);
      setReplyMeta(json.replyMeta || {});
      if (typeof json.chiSeq === 'number' && Number.isFinite(json.chiSeq)) {
        setChiSeq(String(json.chiSeq + 1));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูล DrugCatalog ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter === 'R51' && !it.r51_flagged) return false;
      if (statusFilter === 'missing_tmt' && !(it.ProductCat === '1' && !/^\d{6,7}$/.test(it.TMTID))) return false;
      if ((statusFilter === 'error' || statusFilter === 'warning' || statusFilter === 'ready') && it.validation_status !== statusFilter) return false;
      if (statusFilter === 'nhso_mismatch' && !(it.nhso?.found && (it.nhso.tmtMismatch || it.nhso.priceMismatch || it.nhso.isedMismatch))) return false;
      if (statusFilter === 'nhso_missing' && !(it.nhso && !it.nhso.found)) return false;
      if (statusFilter === 'chi_mismatch' && !(it.chi?.found && (it.chi.tmtMismatch || it.chi.priceMismatch || it.chi.isedMismatch))) return false;
      if (statusFilter === 'chi_missing' && !(it.chi && !it.chi.found)) return false;
      if (statusFilter === 'reply_error' && !(it.nhso?.hasError || it.chi?.hasError)) return false;
      if (isedFilter !== 'ALL' && it.ISED !== isedFilter) return false;
      if (!q) return true;
      return [it.HospDrugCode, it.GenericName, it.TradeName, it.TMTID, it.NDC24, it.DosageForm]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [items, statusFilter, isedFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, isedFilter, search, includeInactive]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page]);

  const toggleSelectAllFiltered = () => {
    const allSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.HospDrugCode));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((it) => it.HospDrugCode)));
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/drug-catalog/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
      setMessage(`บันทึกรายการยา ${editing.HospDrugCode} (${editing.GenericName}) เรียบร้อยแล้ว`);
      setEditing(null);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (target: 'nhso' | 'chi' | 'fdh' | 'xml') => {
    setExporting(true);
    setError('');
    setMessage('');
    try {
      const codes = selected.size > 0 ? [...selected] : filtered.map((it) => it.HospDrugCode);
      if (codes.length === 0) throw new Error('ไม่มีรายการยาที่จะส่งออก');
      const parsedSeq = Number(chiSeq);
      const res = await fetch('/api/drug-catalog/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          priceTier,
          chiSeq: target === 'chi' && Number.isFinite(parsedSeq) && parsedSeq > 0 ? Math.floor(parsedSeq) : undefined,
          includeInactive,
          codes,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'ส่งออกไม่สำเร็จ');
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const defaultName =
        target === 'nhso'
          ? 'Export_DrugCat.xls'
          : target === 'chi'
            ? `DrugN${String(Math.max(1, Math.floor(parsedSeq || 1))).padStart(3, '0')}.xls`
            : target === 'fdh'
              ? 'DrugCat4FDH.xlsx'
              : 'DrugCatalog.zip';
      const filename = disp.match(/filename="?([^";]+)"?/i)?.[1] || defaultName;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      if (target === 'chi') {
        const usedSeqHeader = Number(res.headers.get('X-CHI-Seq'));
        const usedSeq = Number.isFinite(usedSeqHeader) && usedSeqHeader > 0 ? usedSeqHeader : (Number.isFinite(parsedSeq) ? parsedSeq : 1);
        setChiSeq(String(usedSeq + 1));
      }
      setMessage(`ส่งออก ${filename} สำเร็จ (${codes.length.toLocaleString()} รายการ)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งออกไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  const handleImportReplyFile = async (file: File | null) => {
    if (!file) return;
    setImportingReply(true);
    setError('');
    setMessage('');
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/drug-catalog/import-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentBase64,
          source: replySourceChoice,
          replaceExisting: replaceExistingReply,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'นำเข้าไฟล์ตอบกลับไม่สำเร็จ');
      setMessage(json.message || `นำเข้าไฟล์ ${file.name} สำเร็จ`);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'นำเข้าไฟล์ตอบกลับไม่สำเร็จ');
    } finally {
      setImportingReply(false);
    }
  };

  const handleClearReply = async (source: 'nhso' | 'chi') => {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/drug-catalog/reply/${source}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'ล้างข้อมูลไม่สำเร็จ');
      setMessage(json.message || 'ล้างข้อมูลไฟล์ตอบกลับแล้ว');
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ล้างข้อมูลไม่สำเร็จ');
    }
  };

  const hasNhsoReply = Boolean(replyMeta.nhso);
  const hasChiReply = Boolean(replyMeta.chi);

  const displayPrice = (row: DrugCatalogRow): number => {
    if (priceTier === 2) return row.Price2 && row.Price2 > 0 ? row.Price2 : row.UnitPrice;
    if (priceTier === 3) return row.Price3 && row.Price3 > 0 ? row.Price3 : row.UnitPrice;
    return row.UnitPrice;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">💊 จัดทำ DrugCatalog (สปสช. / สกส. / FDH)</h1>
        <p className="page-subtitle">
          ดึงทะเบียนยาจาก HOSxP เชื่อมตาราง tmt_tpu_code ตรวจสอบ TMTID, ProductCat, ISED, NDC24 และยาติด R51 พร้อมส่งออกแยกไฟล์ตามโครงสร้างจริงของ สปสช. (.xls 25 คอลัมน์), สกส. (DrugN###.xls 22 คอลัมน์) และ FDH (.xlsx)
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className="badge badge-primary">ทั้งหมด {summary.total.toLocaleString()}</span>
        <span className="badge badge-success">พร้อมส่ง {summary.ready.toLocaleString()}</span>
        <span className="badge badge-warning">ควรตรวจ {summary.warning.toLocaleString()}</span>
        <span className="badge badge-danger">ต้องแก้ไข {summary.error.toLocaleString()}</span>
        <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>ขาด TMTID {summary.missingTmt.toLocaleString()}</span>
        <span
          className="badge"
          style={{ background: '#fef3c7', color: '#92400e', cursor: 'pointer', fontWeight: 700 }}
          onClick={() => setStatusFilter('R51')}
          title="คลิกเพื่อกรองเฉพาะยาที่ติด R51 จาก สปส."
        >
          ⚠️ ติด R51 จาก สปส. ({summary.r51Flagged})
        </span>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
      {message && <div className="alert alert-success" style={{ marginBottom: 12 }}>✅ {message}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong>📤 นำเข้าไฟล์ตอบกลับ / ไฟล์อนุมัติ DrugCatalog (สปสช. / สกส.)</strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                รองรับไฟล์ .xls, .xlsx, .csv, .xml, .zip เพื่อเทียบชน TMTID, ราคา และ ISED กับทะเบียนยา HOSxP อัตโนมัติ
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select
                className="form-control"
                style={{ width: 200 }}
                value={replySourceChoice}
                onChange={(e) => setReplySourceChoice(e.target.value as 'auto' | 'nhso' | 'chi')}
              >
                <option value="auto">ตรวจจับกองทุนอัตโนมัติ</option>
                <option value="nhso">สปสช. (NHSO / e-Claim)</option>
                <option value="chi">สกส. (CHI / สปส.)</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={replaceExistingReply}
                  onChange={(e) => setReplaceExistingReply(e.target.checked)}
                />
                <span>แทนที่ข้อมูลเดิมของกองทุนนี้</span>
              </label>
              <label className="btn btn-primary" style={{ margin: 0, cursor: importingReply ? 'wait' : 'pointer' }}>
                {importingReply ? 'กำลังนำเข้า...' : '📂 เลือกไฟล์ตอบกลับ'}
                <input
                  type="file"
                  accept=".xls,.xlsx,.csv,.xml,.zip,.txt"
                  disabled={importingReply}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    e.target.value = '';
                    void handleImportReplyFile(f);
                  }}
                />
              </label>
            </div>
          </div>

          {(replyMeta.nhso || replyMeta.chi) && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
              {replyMeta.nhso && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '6px 10px' }}>
                  <span><strong>สปสช.:</strong> {replyMeta.nhso.filename} ({replyMeta.nhso.rowCount.toLocaleString()} รายการ)</span>
                  <span className="badge badge-success">พบ {summary.nhsoFound || 0}</span>
                  {(summary.nhsoMismatch || 0) > 0 && (
                    <span className="badge badge-warning" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('nhso_mismatch')}>
                      ไม่ตรง {summary.nhsoMismatch}
                    </span>
                  )}
                  {(summary.nhsoMissing || 0) > 0 && (
                    <span className="badge badge-danger" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('nhso_missing')}>
                      ยังไม่มี {summary.nhsoMissing}
                    </span>
                  )}
                  <button type="button" className="btn btn-sm btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => void handleClearReply('nhso')}>
                    ล้าง
                  </button>
                </div>
              )}
              {replyMeta.chi && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '6px 10px' }}>
                  <span><strong>สกส.:</strong> {replyMeta.chi.filename} ({replyMeta.chi.rowCount.toLocaleString()} รายการ)</span>
                  <span className="badge badge-success">พบ {summary.chiFound || 0}</span>
                  {(summary.chiMismatch || 0) > 0 && (
                    <span className="badge badge-warning" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('chi_mismatch')}>
                      ไม่ตรง {summary.chiMismatch}
                    </span>
                  )}
                  {(summary.chiMissing || 0) > 0 && (
                    <span className="badge badge-danger" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('chi_missing')}>
                      ยังไม่มี {summary.chiMissing}
                    </span>
                  )}
                  <button type="button" className="btn btn-sm btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => void handleClearReply('chi')}>
                    ล้าง
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label className="form-group">
            <span className="form-label">ตัวกรองสถานะ</span>
            <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="ALL">ทั้งหมด ({items.length})</option>
              <option value="R51">⚠️ เฉพาะยาที่ติด R51 จาก สปส. ({summary.r51Flagged})</option>
              <option value="error">✕ ต้องแก้ไข ({summary.error})</option>
              <option value="missing_tmt">🔍 ขาด TMTID ({summary.missingTmt})</option>
              <option value="warning">⚠️ ควรตรวจ ({summary.warning})</option>
              <option value="ready">✓ พร้อมส่ง ({summary.ready})</option>
              {hasNhsoReply && <option value="nhso_mismatch">⚠️ สปสช. ไม่ตรง (TMT/ราคา/ISED) ({summary.nhsoMismatch || 0})</option>}
              {hasNhsoReply && <option value="nhso_missing">🆕 ยังไม่มีใน สปสช. ({summary.nhsoMissing || 0})</option>}
              {hasChiReply && <option value="chi_mismatch">⚠️ สกส. ไม่ตรง (TMT/ราคา/ISED) ({summary.chiMismatch || 0})</option>}
              {hasChiReply && <option value="chi_missing">🆕 ยังไม่มีใน สกส. ({summary.chiMissing || 0})</option>}
              {(hasNhsoReply || hasChiReply) && (
                <option value="reply_error">❌ ติด Error จากไฟล์ตอบกลับ ({(summary.nhsoError || 0) + (summary.chiError || 0)})</option>
              )}
            </select>
          </label>
          <label className="form-group">
            <span className="form-label">บัญชียาหลัก (ISED)</span>
            <select className="form-control" value={isedFilter} onChange={(e) => setIsedFilter(e.target.value as typeof isedFilter)}>
              <option value="ALL">ทั้งหมด</option>
              <option value="E">E — ในบัญชียาหลัก</option>
              <option value="N">N — นอกบัญชียาหลัก</option>
            </select>
          </label>
          <label className="form-group">
            <span className="form-label">ค้นหา icode / ชื่อยา / TMTID / NDC24</span>
            <input className="form-control" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา..." />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            <span>รวมรายการที่ปิดใช้งาน</span>
          </label>
          <button className="btn btn-primary" onClick={() => void loadItems()} disabled={loading}>
            {loading ? 'กำลังโหลด...' : '🔄 โหลดข้อมูลใหม่'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={toggleSelectAllFiltered}>
              ☑️ {selected.size > 0 && filtered.every((it) => selected.has(it.HospDrugCode)) ? 'ยกเลิกเลือกทั้งหมด' : `เลือกทั้งหมด (${filtered.length})`}
            </button>
            <label className="form-group" style={{ marginBottom: 0, minWidth: 165 }}>
              <span className="form-label" style={{ fontSize: 12 }}>ราคาที่ส่งออก</span>
              <select className="form-control" value={priceTier} onChange={(e) => setPriceTier(Number(e.target.value) as 1 | 2 | 3)}>
                <option value={1}>1: ราคาทั่วไป (unitprice)</option>
                <option value={2}>2: Special 1 (price2)</option>
                <option value={3}>3: Special 2 (price3)</option>
              </select>
            </label>
            <label className="form-group" style={{ marginBottom: 0, width: 120 }}>
              <span className="form-label" style={{ fontSize: 12 }}>งวด สกส. (DrugN)</span>
              <input
                type="number"
                min={1}
                max={999}
                className="form-control"
                value={chiSeq}
                onChange={(e) => setChiSeq(e.target.value)}
                title="เลขลำดับไฟล์ สกส. เช่น 9 -> DrugN009.xls"
              />
            </label>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', paddingBottom: 8 }}>
              เลือกแล้ว {selected.size > 0 ? `${selected.size.toLocaleString()} รายการ` : `ทั้งหมดในตัวกรอง (${filtered.length.toLocaleString()} รายการ)`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-success" disabled={exporting || filtered.length === 0} onClick={() => void handleExport('nhso')}>
              {exporting ? 'กำลังส่งออก...' : '📥 สปสช. (_Export_DrugCat.xls)'}
            </button>
            <button type="button" className="btn btn-primary" disabled={exporting || filtered.length === 0} onClick={() => void handleExport('chi')}>
              {exporting ? 'กำลังส่งออก...' : `📥 สกส. (DrugN${String(Math.max(1, Math.floor(Number(chiSeq) || 1))).padStart(3, '0')}.xls)`}
            </button>
            <button type="button" className="btn btn-secondary" disabled={exporting || filtered.length === 0} onClick={() => void handleExport('fdh')}>
              {exporting ? 'กำลังส่งออก...' : '📥 FDH (DrugCat4FDH.xlsx)'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={exporting || filtered.length === 0} onClick={() => void handleExport('xml')}>
              {exporting ? 'กำลังส่งออก...' : '📦 XML ZIP'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /><span>กำลังโหลดทะเบียนยาจาก HOSxP...</span></div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>HospDrugCode</th>
                  <th>Cat / Flag</th>
                  <th>TMTID</th>
                  <th>ชื่อสามัญ / ชื่อการค้า</th>
                  <th>รูปแบบ / ความแรง / บรรจุ</th>
                  <th style={{ textAlign: 'right' }}>ราคา (฿)</th>
                  <th>ISED / NDC24</th>
                  {hasNhsoReply && <th>เทียบ สปสช.</th>}
                  {hasChiReply && <th>เทียบ สกส.</th>}
                  <th>ผลตรวจ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.HospDrugCode} className={row.validation_status === 'error' ? 'row-danger' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.HospDrugCode)}
                        onChange={() => setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.HospDrugCode)) next.delete(row.HospDrugCode);
                          else next.add(row.HospDrugCode);
                          return next;
                        })}
                      />
                    </td>
                    <td>
                      <strong><code>{row.HospDrugCode}</code></strong>
                      {row.r51_flagged && <div><span className="badge badge-warning" style={{ fontSize: 10 }}>⚠️ ติด R51</span></div>}
                      {row.has_override && <div><span className="badge badge-info" style={{ fontSize: 10 }}>✏️ แก้ไขแล้ว</span></div>}
                    </td>
                    <td>
                      <div>Cat: <strong>{row.ProductCat}</strong></div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Flag: {row.UpdateFlag}</div>
                    </td>
                    <td><code>{row.TMTID || '-'}</code></td>
                    <td style={{ maxWidth: 260 }}>
                      <div style={{ fontWeight: 600 }}>{row.GenericName || '-'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.TradeName || '-'}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div>{row.DosageForm || '-'} · {row.Strength || '-'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Content: {row.Content || '-'}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{displayPrice(row).toFixed(2)}</td>
                    <td style={{ fontSize: 11 }}>
                      <div><span className={`badge ${row.ISED === 'E' ? 'badge-success' : 'badge-warning'}`}>{row.ISED}</span></div>
                      <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{row.NDC24 || '-'}</div>
                    </td>
                    {hasNhsoReply && (
                      <td style={{ fontSize: 11, minWidth: 140 }}>
                        {!row.nhso?.found ? (
                          <span className="badge badge-danger">✕ ยังไม่มีใน สปสช.</span>
                        ) : (
                          <div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span className={`badge ${row.nhso.hasError ? 'badge-danger' : (row.nhso.tmtMismatch || row.nhso.priceMismatch || row.nhso.isedMismatch) ? 'badge-warning' : 'badge-success'}`}>
                                {row.nhso.hasError ? '❌ Error' : (row.nhso.tmtMismatch || row.nhso.priceMismatch || row.nhso.isedMismatch) ? '⚠️ ไม่ตรง' : '✓ ตรง'}
                              </span>
                              {row.nhso.isedApproved && <span style={{ color: 'var(--text-muted)' }}>ISED:{row.nhso.isedApproved}</span>}
                            </div>
                            <div style={{ color: row.nhso.tmtMismatch ? '#b91c1c' : 'var(--text-muted)', fontWeight: row.nhso.tmtMismatch ? 700 : 400 }}>
                              TMT: {row.nhso.tmtid || '-'}
                            </div>
                            <div style={{ color: row.nhso.priceMismatch ? '#b45309' : 'var(--text-muted)', fontWeight: row.nhso.priceMismatch ? 700 : 400 }}>
                              ราคา: {row.nhso.unitPrice != null ? row.nhso.unitPrice.toFixed(2) : '-'}
                            </div>
                            {row.nhso.isedMismatch && <div style={{ color: '#b91c1c', fontWeight: 700 }}>ISED ต่าง ({row.nhso.isedApproved || row.nhso.ised})</div>}
                            {(row.nhso.error || row.nhso.isedStatus) && (
                              <div style={{ color: '#b91c1c' }}>{row.nhso.error || row.nhso.isedStatus}</div>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    {hasChiReply && (
                      <td style={{ fontSize: 11, minWidth: 140 }}>
                        {!row.chi?.found ? (
                          <span className="badge badge-danger">✕ ยังไม่มีใน สกส.</span>
                        ) : (
                          <div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span className={`badge ${row.chi.hasError ? 'badge-danger' : (row.chi.tmtMismatch || row.chi.priceMismatch || row.chi.isedMismatch) ? 'badge-warning' : 'badge-success'}`}>
                                {row.chi.hasError ? '❌ Error' : (row.chi.tmtMismatch || row.chi.priceMismatch || row.chi.isedMismatch) ? '⚠️ ไม่ตรง' : '✓ ตรง'}
                              </span>
                              {row.chi.updateFlag && <span style={{ color: 'var(--text-muted)' }}>Flag:{row.chi.updateFlag}</span>}
                            </div>
                            <div style={{ color: row.chi.tmtMismatch ? '#b91c1c' : 'var(--text-muted)', fontWeight: row.chi.tmtMismatch ? 700 : 400 }}>
                              TMT: {row.chi.tmtid || '-'}
                            </div>
                            <div style={{ color: row.chi.priceMismatch ? '#b45309' : 'var(--text-muted)', fontWeight: row.chi.priceMismatch ? 700 : 400 }}>
                              ราคา: {row.chi.unitPrice != null ? row.chi.unitPrice.toFixed(2) : '-'}
                            </div>
                            {row.chi.isedMismatch && <div style={{ color: '#b91c1c', fontWeight: 700 }}>ISED ต่าง ({row.chi.ised})</div>}
                            {(row.chi.error || row.chi.status) && (
                              <div style={{ color: '#b91c1c' }}>{row.chi.error || row.chi.status}</div>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    <td style={{ maxWidth: 240 }}>
                      <span className={`badge ${row.validation_status === 'ready' ? 'badge-success' : row.validation_status === 'warning' ? 'badge-warning' : 'badge-danger'}`}>
                        {row.validation_status === 'ready' ? 'พร้อมส่ง' : row.validation_status === 'warning' ? 'ควรตรวจ' : 'ต้องแก้'}
                      </span>
                      {row.issues.length > 0 && (
                        <div style={{ fontSize: 11, marginTop: 3 }}>
                          {row.issues.map((iss) => (
                            <div key={iss.code} style={{ color: iss.severity === 'error' ? '#b91c1c' : '#92400e' }}>
                              • {iss.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing({ ...row })}>✏️ แก้ไข</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: 12 }}>
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>◀ ก่อนหน้า</button>
              <span style={{ fontSize: 13 }}>หน้า {page} / {totalPages} ({filtered.length.toLocaleString()} รายการ)</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>ถัดไป ▶</button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>✏️ แก้ไขรายการ DrugCatalog — <code>{editing.HospDrugCode}</code></h3>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditing(null)}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                <label className="form-group">
                  <span className="form-label">ProductCat (1–7)</span>
                  <select className="form-control" value={editing.ProductCat} onChange={(e) => setEditing({ ...editing, ProductCat: e.target.value })}>
                    {Object.entries(PRODUCT_CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="form-group">
                  <span className="form-label">TMTID (6 หลัก)</span>
                  <input className="form-control" value={editing.TMTID} onChange={(e) => setEditing({ ...editing, TMTID: e.target.value })} placeholder="เช่น 723456" />
                </label>
                <label className="form-group">
                  <span className="form-label">UpdateFlag</span>
                  <select className="form-control" value={editing.UpdateFlag} onChange={(e) => setEditing({ ...editing, UpdateFlag: e.target.value as DrugCatalogRow['UpdateFlag'] })}>
                    <option value="A">A — เพิ่มรายการใหม่</option>
                    <option value="E">E — แก้ไขรายละเอียด</option>
                    <option value="U">U — ปรับราคา</option>
                    <option value="D">D — ยกเลิก</option>
                  </select>
                </label>
                <label className="form-group">
                  <span className="form-label">GenericName</span>
                  <input className="form-control" value={editing.GenericName} onChange={(e) => setEditing({ ...editing, GenericName: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">TradeName</span>
                  <input className="form-control" value={editing.TradeName} onChange={(e) => setEditing({ ...editing, TradeName: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">UnitPrice (บาท)</span>
                  <input type="number" step="0.01" className="form-control" value={editing.UnitPrice} onChange={(e) => setEditing({ ...editing, UnitPrice: Number(e.target.value) })} />
                </label>
                <label className="form-group">
                  <span className="form-label">DosageForm</span>
                  <input className="form-control" value={editing.DosageForm} onChange={(e) => setEditing({ ...editing, DosageForm: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">Strength</span>
                  <input className="form-control" value={editing.Strength} onChange={(e) => setEditing({ ...editing, Strength: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">Content</span>
                  <input className="form-control" value={editing.Content} onChange={(e) => setEditing({ ...editing, Content: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">ISED</span>
                  <select className="form-control" value={editing.ISED} onChange={(e) => setEditing({ ...editing, ISED: e.target.value as 'E' | 'N' })}>
                    <option value="E">E — ในบัญชียาหลัก</option>
                    <option value="N">N — นอกบัญชียาหลัก</option>
                  </select>
                </label>
                <label className="form-group">
                  <span className="form-label">NDC24 (24 หลัก)</span>
                  <input className="form-control" value={editing.NDC24} onChange={(e) => setEditing({ ...editing, NDC24: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">SpecPrep (M/R/F/X)</span>
                  <input className="form-control" value={editing.SpecPrep} onChange={(e) => setEditing({ ...editing, SpecPrep: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">Distributor</span>
                  <input className="form-control" value={editing.Distributor} onChange={(e) => setEditing({ ...editing, Distributor: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">Manufacturer</span>
                  <input className="form-control" value={editing.Manufacturer} onChange={(e) => setEditing({ ...editing, Manufacturer: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">DateEffective (DD/MM/YYYY)</span>
                  <input className="form-control" value={editing.DateEffective} onChange={(e) => setEditing({ ...editing, DateEffective: e.target.value })} />
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>ยกเลิก</button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleSaveEdit()}>
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไข'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
