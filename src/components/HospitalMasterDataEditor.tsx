import React, { useState, useEffect, useCallback, useMemo } from 'react';
import '../styles/Settings.css';

export type MasterCatalogType = 'drugs' | 'nondrugs' | 'pttypes';

export interface MasterDataItem {
  code: string;
  name: string;
  detail?: string;
  currentValues: Record<string, string>;
  overrideValues: Record<string, string>;
  effectiveValues: Record<string, string>;
  isComplete: boolean;
  missingFields: string[];
}

export interface MasterDataCatalogSummary {
  catalog: MasterCatalogType;
  catalogName: string;
  total: number;
  incomplete: number;
  completed: number;
  percent: number;
}

export interface MasterDataQueryResult {
  summary: MasterDataCatalogSummary;
  items: MasterDataItem[];
  totalMatches: number;
}

const HIPDATA_OPTIONS = [
  { code: 'UCS', name: 'UCS (ประกันสุขภาพถ้วนหน้า / บัตรทอง)' },
  { code: 'OFC', name: 'OFC (สวัสดิการข้าราชการ กรมบัญชีกลาง)' },
  { code: 'SSS', name: 'SSS (ประกันสังคม)' },
  { code: 'LGO', name: 'LGO (องค์กรปกครองส่วนท้องถิ่น)' },
  { code: 'BKK', name: 'BKK (ข้าราชการ กทม.)' },
  { code: 'STF', name: 'STF (พนักงานรัฐวิสาหกิจ)' },
  { code: 'FRN', name: 'FRN (แรงงานต่างด้าว/ประกันสุขภาพบุคคลไร้สัญชาติ)' },
  { code: 'PVT', name: 'PVT (ชำระเงินเอง / ประกันชีวิตเอกชน)' },
];

export const HospitalMasterDataEditor: React.FC = () => {
  const [catalog, setCatalog] = useState<MasterCatalogType>('drugs');
  const [filter, setFilter] = useState<'incomplete' | 'completed' | 'all'>('incomplete');
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [data, setData] = useState<MasterDataQueryResult | null>(null);

  // Draft changes per catalog: code -> { field: value }
  const [draftChanges, setDraftChanges] = useState<Record<string, Record<string, string>>>({});
  const [sqlModalOpen, setSqlModalOpen] = useState<boolean>(false);
  const [generatedSql, setGeneratedSql] = useState<string>('');

  const fetchCatalogData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const params = new URLSearchParams({
        catalog,
        filter,
        search,
        limit: '150',
      });

      const res = await fetch(`/api/system/hospital-master-data?${params.toString()}`, { headers });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.success) {
        throw new Error(body.error || 'ไม่สามารถโหลดข้อมูล Master Data ได้');
      }

      setData(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  }, [catalog, filter, search]);

  useEffect(() => {
    void fetchCatalogData();
  }, [fetchCatalogData]);

  // Handle in-place change
  const handleFieldChange = (code: string, field: string, value: string) => {
    setDraftChanges((prev) => ({
      ...prev,
      [code]: {
        ...(prev[code] || {}),
        [field]: value,
      },
    }));
  };

  const getEffectiveValue = (item: MasterDataItem, field: string): string => {
    if (draftChanges[item.code] && draftChanges[item.code][field] !== undefined) {
      return draftChanges[item.code][field];
    }
    return item.effectiveValues[field] || '';
  };

  const hasDraftForCode = (code: string): boolean => {
    return Boolean(draftChanges[code] && Object.keys(draftChanges[code]).length > 0);
  };

  const draftCount = useMemo(() => {
    return Object.keys(draftChanges).length;
  }, [draftChanges]);

  // Save changes to FDH Checker overrides
  const handleSaveToFdh = async () => {
    if (draftCount === 0) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const updates = Object.entries(draftChanges).map(([code, fields]) => ({
        code,
        ...fields,
      }));

      const res = await fetch('/api/system/hospital-master-data/override', {
        method: 'POST',
        headers,
        body: JSON.stringify({ catalog, updates }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.error || 'ไม่สามารถบันทึกข้อมูลได้');
      }

      setDraftChanges({});
      setSuccessMessage(`บันทึกข้อมูล ${updates.length} รายการลงใน FDH Checker เรียบร้อยแล้ว`);
      setTimeout(() => setSuccessMessage(null), 4000);
      await fetchCatalogData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  // Generate SQL script
  const handleGenerateSql = async () => {
    if (draftCount === 0) {
      alert('กรุณากรอกข้อมูลในรายการที่ต้องการก่อนสร้าง SQL Script');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const updates = Object.entries(draftChanges).map(([code, fields]) => ({
        code,
        ...fields,
      }));

      const res = await fetch('/api/system/hospital-master-data/export-sql', {
        method: 'POST',
        headers,
        body: JSON.stringify({ catalog, updates }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.error || 'ไม่สามารถสร้าง SQL Script ได้');
      }

      setGeneratedSql(body.sql);
      setSqlModalOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  };

  // Sync direct to HOSxP
  const handleSyncToHosxp = async () => {
    if (draftCount === 0) return;
    const confirmSync = window.confirm(
      `คุณต้องการอัปเดตข้อมูล ${draftCount} รายการลงในฐานข้อมูล HOSxP โดยตรงหรือไม่? (คำเตือน: ต้องใช้บัญชีที่มีสิทธิ์เขียนฐานข้อมูล HOSxP)`
    );
    if (!confirmSync) return;

    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const updates = Object.entries(draftChanges).map(([code, fields]) => ({
        code,
        ...fields,
      }));

      const res = await fetch('/api/system/hospital-master-data/sync-hosxp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ catalog, updates }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.error || 'ซิงค์ข้อมูลกับ HOSxP ไม่สำเร็จ');
      }

      const { updatedCount, errors } = body.data || {};
      let msg = `อัปเดตตรงเข้า HOSxP สำเร็จ ${updatedCount} รายการ`;
      if (errors && errors.length > 0) {
        msg += ` (พบข้อผิดพลาด ${errors.length} รายการ: ${errors[0]})`;
      }

      setDraftChanges({});
      setSuccessMessage(msg);
      await fetchCatalogData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการซิงค์');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header & Catalog Tabs */}
      <div style={{ background: 'var(--card-bg, #fff)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
              ✏️ เติมข้อมูล & แก้ไขรหัสมาตรฐาน (Master Data Mapping Hub)
            </h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted, #64748b)', fontSize: '0.88rem' }}>
              ตรวจหารายการที่ยังขาดรหัสมาตรฐาน (TMT 24 หลัก, รหัส ADP สปสช., HIPDATA) และกรอกข้อมูลเติมเข้าไปได้ทันที
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSaveToFdh}
              disabled={saving || draftCount === 0}
              className="settings-action-btn"
              style={{
                background: draftCount > 0 ? '#10b981' : undefined,
                color: draftCount > 0 ? '#fff' : undefined,
                borderColor: draftCount > 0 ? '#059669' : undefined,
                fontWeight: 700,
              }}
            >
              {saving ? '⏳ กำลังบันทึก...' : `💾 บันทึกใน FDH Checker ${draftCount > 0 ? `(${draftCount})` : ''}`}
            </button>

            <button
              type="button"
              onClick={handleGenerateSql}
              disabled={draftCount === 0}
              className="settings-action-btn"
              style={{ fontSize: '0.85rem' }}
            >
              📋 สร้าง SQL Script
            </button>

            <button
              type="button"
              onClick={handleSyncToHosxp}
              disabled={saving || draftCount === 0}
              className="settings-action-btn"
              style={{ fontSize: '0.85rem', color: '#b45309' }}
            >
              ⚡ ซิงค์เข้า HOSxP
            </button>
          </div>
        </div>

        {/* Catalog Selector */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '14px' }}>
          <button
            type="button"
            className={`tab-btn ${catalog === 'drugs' ? 'active' : ''}`}
            onClick={() => { setCatalog('drugs'); setDraftChanges({}); }}
            style={{ fontWeight: 700 }}
          >
            💊 รายการยา (TMT 24 หลัก)
          </button>
          <button
            type="button"
            className={`tab-btn ${catalog === 'nondrugs' ? 'active' : ''}`}
            onClick={() => { setCatalog('nondrugs'); setDraftChanges({}); }}
            style={{ fontWeight: 700 }}
          >
            🧪 ค่าบริการ / หัตถการ (ADP & Billcode)
          </button>
          <button
            type="button"
            className={`tab-btn ${catalog === 'pttypes' ? 'active' : ''}`}
            onClick={() => { setCatalog('pttypes'); setDraftChanges({}); }}
            style={{ fontWeight: 700 }}
          >
            📋 สิทธิการรักษา (HIPDATA / กองทุน)
          </button>
        </div>

        {/* Status notifications */}
        {error && (
          <div className="settings-load-error" style={{ marginTop: '16px' }}>
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div style={{ marginTop: '16px', padding: '12px 16px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#065f46', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 600, fontSize: '0.9rem' }}>
            ✅ {successMessage}
          </div>
        )}

        {/* Filter & Search Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginTop: '16px' }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted, #64748b)', fontWeight: 600 }}>แสดง:</span>
            <button
              type="button"
              className={`settings-action-btn ${filter === 'incomplete' ? 'active' : ''}`}
              onClick={() => setFilter('incomplete')}
              style={{
                fontSize: '0.82rem',
                padding: '4px 10px',
                background: filter === 'incomplete' ? 'rgba(239, 68, 68, 0.1)' : undefined,
                color: filter === 'incomplete' ? '#dc2626' : undefined,
                borderColor: filter === 'incomplete' ? '#f87171' : undefined,
                fontWeight: filter === 'incomplete' ? 700 : 400,
              }}
            >
              ⚠️ เฉพาะที่ยังไม่สมบูรณ์ {data && `(${data.summary.incomplete})`}
            </button>
            <button
              type="button"
              className={`settings-action-btn ${filter === 'completed' ? 'active' : ''}`}
              onClick={() => setFilter('completed')}
              style={{
                fontSize: '0.82rem',
                padding: '4px 10px',
                background: filter === 'completed' ? 'rgba(16, 185, 129, 0.1)' : undefined,
                color: filter === 'completed' ? '#059669' : undefined,
                borderColor: filter === 'completed' ? '#34d399' : undefined,
                fontWeight: filter === 'completed' ? 700 : 400,
              }}
            >
              ✅ สมบูรณ์แล้ว {data && `(${data.summary.completed})`}
            </button>
            <button
              type="button"
              className={`settings-action-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
              style={{
                fontSize: '0.82rem',
                padding: '4px 10px',
                fontWeight: filter === 'all' ? 700 : 400,
              }}
            >
              📑 ทั้งหมด {data && `(${data.summary.total})`}
            </button>
          </div>

          {/* Search */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: '1', maxWidth: '400px' }}>
            <input
              type="text"
              placeholder="🔍 ค้นหาตามชื่อ, รหัส icode หรือรหัสมาตรฐาน..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontSize: '0.85rem',
              }}
            />
          </div>
        </div>
      </div>

      {/* Summary progress bar */}
      {data && (
        <div style={{ background: 'var(--card-bg, #fff)', padding: '14px 20px', borderRadius: '10px', border: '1px solid var(--border-color, #e2e8f0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
              ความสมบูรณ์ของ {data.summary.catalogName}:
            </span>
            <span style={{ fontSize: '1.2rem', fontWeight: 800, color: data.summary.percent >= 80 ? '#10b981' : data.summary.percent >= 50 ? '#f59e0b' : '#ef4444' }}>
              {data.summary.percent}%
            </span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted, #64748b)' }}>
              ({data.summary.completed.toLocaleString()} จาก {data.summary.total.toLocaleString()} รายการ)
            </span>
          </div>

          <div style={{ width: '240px', height: '8px', background: 'rgba(148, 163, 184, 0.2)', borderRadius: '999px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${data.summary.percent}%`,
                backgroundColor: data.summary.percent >= 80 ? '#10b981' : data.summary.percent >= 50 ? '#f59e0b' : '#ef4444',
                borderRadius: '999px',
              }}
            />
          </div>
        </div>
      )}

      {/* Items Table */}
      <div style={{ background: 'var(--card-bg, #fff)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted, #64748b)' }}>
            ⏳ กำลังโหลดรายการ...
          </div>
        )}

        {!loading && data && data.items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted, #64748b)' }}>
            🎉 ไม่พบรายการที่ตรงตามเงื่อนไข (ข้อมูลสมบูรณ์แล้ว หรือไม่พบคำค้นหา)
          </div>
        )}

        {!loading && data && data.items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: 'var(--background-soft, #f8fafc)', borderBottom: '2px solid var(--border-color, #e2e8f0)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', width: '90px' }}>รหัส (Code)</th>
                  <th style={{ padding: '10px 12px' }}>ชื่อรายการ (Name)</th>
                  <th style={{ padding: '10px 12px', width: '140px' }}>สถานะ</th>
                  <th style={{ padding: '10px 12px', width: catalog === 'drugs' ? '320px' : '360px' }}>
                    {catalog === 'drugs' && 'รหัส TMT 24 หลัก (DIDSTD)'}
                    {catalog === 'nondrugs' && 'รหัส ADP สปสช. / Billcode'}
                    {catalog === 'pttypes' && 'รหัสสิทธิกลาง HIPDATA / Pcode'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const isDraft = hasDraftForCode(item.code);
                  return (
                    <tr
                      key={item.code}
                      style={{
                        borderBottom: '1px solid var(--border-color, #e2e8f0)',
                        background: isDraft ? 'rgba(254, 243, 199, 0.4)' : undefined,
                      }}
                    >
                      {/* Code */}
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 700 }}>
                        {item.code}
                      </td>

                      {/* Name & details */}
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-main, #0f172a)' }}>
                          {item.name}
                        </div>
                        {item.detail && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '2px' }}>
                            {item.detail}
                          </div>
                        )}
                        {item.missingFields.length > 0 && (
                          <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '2px' }}>
                            ⚠️ {item.missingFields.join(', ')}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '10px 12px' }}>
                        {item.isComplete ? (
                          <span className="settings-status-chip is-ok" style={{ fontSize: '0.75rem' }}>
                            ✅ สมบูรณ์
                          </span>
                        ) : (
                          <span className="settings-status-chip" style={{ fontSize: '0.75rem', color: '#dc2626', borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.08)' }}>
                            ❌ ขาดข้อมูล
                          </span>
                        )}
                        {isDraft && (
                          <span className="settings-status-chip is-warning" style={{ fontSize: '0.72rem', marginLeft: '4px' }}>
                            แก้ไขแล้ว
                          </span>
                        )}
                      </td>

                      {/* In-place input cells */}
                      <td style={{ padding: '10px 12px' }}>
                        {/* Drug Item: TMT 24-digit input */}
                        {catalog === 'drugs' && (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input
                                type="text"
                                maxLength={24}
                                placeholder="กรอกรหัส TMT 24 หลัก..."
                                value={getEffectiveValue(item, 'tmt_code')}
                                onChange={(e) => handleFieldChange(item.code, 'tmt_code', e.target.value.trim())}
                                style={{
                                  width: '100%',
                                  padding: '6px 10px',
                                  fontSize: '0.85rem',
                                  fontFamily: 'monospace',
                                  borderRadius: '6px',
                                  border: `1px solid ${getEffectiveValue(item, 'tmt_code').length === 24 ? '#10b981' : '#cbd5e1'}`,
                                }}
                              />
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  minWidth: '40px',
                                  color: getEffectiveValue(item, 'tmt_code').length === 24 ? '#10b981' : '#64748b',
                                }}
                              >
                                {getEffectiveValue(item, 'tmt_code').length}/24
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Non-drug Item: ADP and Billcode input */}
                        {catalog === 'nondrugs' && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1 }}>
                              <input
                                type="text"
                                placeholder="รหัส ADP (เช่น 30001)"
                                value={getEffectiveValue(item, 'nhso_adp_code')}
                                onChange={(e) => handleFieldChange(item.code, 'nhso_adp_code', e.target.value.trim())}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  fontSize: '0.82rem',
                                  fontFamily: 'monospace',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                }}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <input
                                type="text"
                                placeholder="Billcode"
                                value={getEffectiveValue(item, 'billcode')}
                                onChange={(e) => handleFieldChange(item.code, 'billcode', e.target.value.trim())}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  fontSize: '0.82rem',
                                  fontFamily: 'monospace',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Pttype: HIPDATA dropdown & Pcode input */}
                        {catalog === 'pttypes' && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1.2 }}>
                              <select
                                value={getEffectiveValue(item, 'hipdata_code')}
                                onChange={(e) => handleFieldChange(item.code, 'hipdata_code', e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  fontSize: '0.82rem',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                }}
                              >
                                <option value="">-- เลือก HIPDATA --</option>
                                {HIPDATA_OPTIONS.map((opt) => (
                                  <option key={opt.code} value={opt.code}>
                                    {opt.code} ({opt.name.split(' ')[0]})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ flex: 0.8 }}>
                              <input
                                type="text"
                                placeholder="Pcode (เช่น UC)"
                                value={getEffectiveValue(item, 'pcode')}
                                onChange={(e) => handleFieldChange(item.code, 'pcode', e.target.value.trim())}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  fontSize: '0.82rem',
                                  fontFamily: 'monospace',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SQL Script Modal */}
      {sqlModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '12px',
              maxWidth: '700px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
                📋 SQL Script สำหรับอัปเดต HOSxP
              </h3>
              <button
                type="button"
                onClick={() => setSqlModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
              สคริปต์นี้สร้างขึ้นจากรายการที่คุณได้แก้ไข คุณสามารถคัดลอกไปรันในเครื่องมือจัดการฐานข้อมูล (เช่น HeidiSQL, Navicat หรือ MySQL Workbench)
            </p>

            <textarea
              readOnly
              value={generatedSql}
              rows={10}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(generatedSql);
                  alert('คัดลอก SQL Script ลง Clipboard แล้ว!');
                }}
                className="settings-action-btn"
                style={{ background: '#3b82f6', color: '#fff', borderColor: '#2563eb', fontWeight: 700 }}
              >
                📋 คัดลอก SQL Script
              </button>
              <button
                type="button"
                onClick={() => setSqlModalOpen(false)}
                className="settings-action-btn"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
