import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  fetchDiagsAndProceduresData,
  fetchUcOutsideCupClinicalAudit,
  fetchUcOutsideCupDashboard,
  fetchUcOutsideCupWalkinAudit,
  fetchVisitChargeItems,
  insertUcOutsideCupWalkin,
  type ReconciliationRow,
  type UcOutsideCupGroup,
  type UcOutsideCupResponse,
  type UcOutsideCupWalkinAudit,
  type UcWalkinClinicalAuditResponse,
  type VisitClinicalData,
} from '../services/hosxpService';
import type { PrescriptionItem } from '../mockData';

const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currentFiscalYear = () => {
  const today = new Date();
  return today.getFullYear() + 543 + (today.getMonth() >= 9 ? 1 : 0);
};
const fiscalDates = (year: number) => ({ startDate: `${year - 544}-10-01`, endDate: `${year - 543}-09-30` });
const WALKIN_AUDIT_START = '2024-10-01';
const todayIso = () => new Date().toISOString().slice(0, 10);
const statusClass = (status: string) => status.includes('เสร็จ') || status === 'ตรงกัน' ? 'is-ok' : status.includes('รอ') ? 'is-wait' : status === 'ยอดต่าง' ? 'is-error' : '';

const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) => (
  <div className="uc-cup-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="uc-cup-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header><h3>{title}</h3><button type="button" onClick={onClose}>✕</button></header>
      <div className="uc-cup-modal__body">{children}</div>
    </section>
  </div>
);

export const UcOutsideCupPage = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'reconciliation'>('audit');
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear());
  const [{ startDate, endDate }, setDates] = useState(() => fiscalDates(currentFiscalYear()));
  const [patientType, setPatientType] = useState('ALL');
  const [compareStatus, setCompareStatus] = useState('');
  const [hmain, setHmain] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<UcOutsideCupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ReconciliationRow | null>(null);
  const [prescriptionVisit, setPrescriptionVisit] = useState<ReconciliationRow | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  const [prescriptionLoading, setPrescriptionLoading] = useState(false);
  const [visitClinical, setVisitClinical] = useState<VisitClinicalData>({ clinical: {}, diagnoses: [], procedures: [] });
  const [walkinAudit, setWalkinAudit] = useState<UcOutsideCupWalkinAudit | null>(null);
  const [walkinLoading, setWalkinLoading] = useState(false);
  const [walkinInserting, setWalkinInserting] = useState(false);
  const [walkinConfirmation, setWalkinConfirmation] = useState('');
  const [walkinMessage, setWalkinMessage] = useState('');
  const loadedInitially = useRef(false);

  // Clinical & Dental audit state
  const [auditCategory, setAuditCategory] = useState<'ALL' | 'DENTAL' | 'GENERAL'>('ALL');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'VALID'>('ALL');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditResult, setAuditResult] = useState<UcWalkinClinicalAuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchUcOutsideCupDashboard({
        startDate, endDate, patientType: patientType === 'ALL' ? undefined : patientType,
        compareStatus: compareStatus || undefined, hmain: hmain || undefined,
        search: search.trim() || undefined, page: nextPage, pageSize: 100,
      });
      setResult(data);
      setPage(nextPage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, patientType, compareStatus, hmain, search]);

  useEffect(() => {
    if (loadedInitially.current) return;
    loadedInitially.current = true;
    void load(1);
  }, [load]);

  const loadWalkinAudit = useCallback(async () => {
    setWalkinLoading(true);
    try {
      setWalkinAudit(await fetchUcOutsideCupWalkinAudit({ startDate: WALKIN_AUDIT_START, endDate: todayIso(), page: 1, pageSize: 100 }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ตรวจสอบ WALKIN ไม่สำเร็จ');
    } finally {
      setWalkinLoading(false);
    }
  }, []);

  useEffect(() => { void loadWalkinAudit(); }, [loadWalkinAudit]);

  const loadClinicalAudit = useCallback(async (nextPage = 1) => {
    setAuditLoading(true);
    setError('');
    try {
      const data = await fetchUcOutsideCupClinicalAudit({
        startDate,
        endDate,
        serviceCategory: auditCategory,
        auditStatus: auditStatusFilter,
        search: auditSearch.trim() || undefined,
        page: nextPage,
        pageSize: 50,
      });
      setAuditResult(data);
      setAuditPage(nextPage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ตรวจสอบเวชระเบียน WALKIN ไม่สำเร็จ');
    } finally {
      setAuditLoading(false);
    }
  }, [startDate, endDate, auditCategory, auditStatusFilter, auditSearch]);

  useEffect(() => {
    if (activeTab === 'audit') {
      void loadClinicalAudit(1);
    }
  }, [loadClinicalAudit, activeTab]);

  const insertMissingWalkin = async () => {
    const missing = walkinAudit?.summary.missing_walkin || 0;
    if (!missing || walkinInserting) return;
    setWalkinInserting(true);
    setWalkinMessage('');
    setError('');
    try {
      const resultData = await insertUcOutsideCupWalkin({
        startDate: walkinAudit!.period.startDate,
        endDate: walkinAudit!.period.endDate,
        configurationKey: walkinAudit!.configurationKey,
        expectedCount: missing,
        confirmation: walkinConfirmation,
      });
      setWalkinMessage(`เพิ่ม WALKIN สำเร็จ ${resultData.insertedCount.toLocaleString('th-TH')} รายการ พร้อมสำหรับส่งออกใหม่`);
      setWalkinConfirmation('');
      await loadWalkinAudit();
      await load(1);
      if (activeTab === 'audit') await loadClinicalAudit(auditPage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เพิ่มรายการ WALKIN ไม่สำเร็จ');
      await loadWalkinAudit();
    } finally {
      setWalkinInserting(false);
    }
  };

  const selectFiscalYear = (year: number) => {
    setFiscalYear(year);
    setDates(fiscalDates(year));
    setPage(1);
    setAuditPage(1);
  };

  const openPrescription = async (row: { vn?: string; an?: string; [key: string]: any }) => {
    if (!row.vn) return;
    setPrescriptionVisit(row as ReconciliationRow);
    setPrescriptionLoading(true);
    setPrescriptions([]);
    setVisitClinical({ clinical: {}, diagnoses: [], procedures: [] });
    try {
      const [itemsResult, clinicalResult] = await Promise.allSettled([
        fetchVisitChargeItems(row.vn, row.an || undefined),
        fetchDiagsAndProceduresData(row.vn, row.an || undefined),
      ]);
      if (itemsResult.status === 'fulfilled') setPrescriptions(itemsResult.value);
      if (clinicalResult.status === 'fulfilled') setVisitClinical(clinicalResult.value.data);
      if (itemsResult.status === 'rejected' || clinicalResult.status === 'rejected') setError('ข้อมูลรายตัวบางส่วนอ่านไม่ได้ กรุณาตรวจสอบการเชื่อมต่อและโครงสร้าง HIS');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'อ่านใบสั่งยาไม่สำเร็จ');
    } finally {
      setPrescriptionLoading(false);
    }
  };

  const hmainOptions = useMemo(() => result?.group_summary || [], [result]);
  const summary = result?.summary;
  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / 100));
  const outstanding = Math.max((summary?.total_claimable || 0) - (summary?.total_stm_paid || summary?.total_inv || 0), 0);

  return (
    <div className="page-container uc-cup-page">
      <section className="uc-cup-hero">
        <div>
          <span className="uc-cup-eyebrow">การเงิน / เวชระเบียน / กองทุน WALKIN</span>
          <h1>UC นอก CUP (WALKIN: ผู้ป่วยนอกเหตุสมควร ทั่วประเทศ)</h1>
          <p>
            {activeTab === 'audit'
              ? 'ตรวจสอบความถูกต้องของการลงรหัสโรค (ICD-10) หัตถการทันตกรรม/การแพทย์ (ICD-9) และรายการเบิก เพื่อป้องกันการติด C และการปฏิเสธจ่าย'
              : 'ติดตามยอดเรียกเก็บและยอดตามจ่ายตาม HMAIN พร้อมหลักฐาน FDH, REP, STM และ INV ราย visit'}
          </p>
        </div>
        <div className="uc-cup-year">
          <label>ปีงบประมาณ</label>
          <select value={fiscalYear} onChange={(e) => selectFiscalYear(Number(e.target.value))}>
            {[0, 1, 2, 3, 4].map((offset) => {
              const year = currentFiscalYear() - offset;
              return <option key={year} value={year}>พ.ศ. {year}</option>;
            })}
          </select>
        </div>
      </section>

      {/* Main Mode Sub-tabs */}
      <div className="uc-cup-tabs">
        <button
          type="button"
          className={`uc-cup-tab-btn ${activeTab === 'audit' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <span>🩺</span> ตรวจสอบความถูกต้องเวชระเบียน / ป้องกันติด C
        </button>
        <button
          type="button"
          className={`uc-cup-tab-btn ${activeTab === 'reconciliation' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('reconciliation')}
        >
          <span>💰</span> กระทบยอดและตามจ่าย HMAIN
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {walkinMessage && <div className="alert alert-success">{walkinMessage}</div>}

      {/* TAB 1: CLINICAL & DENTAL AUDIT */}
      {activeTab === 'audit' && (
        <>
          <section className="uc-cup-kpis">
            <article>
              <span>Visit กองทุน WALKIN ทั้งหมด</span>
              <strong>{(auditResult?.summary.total_visits || 0).toLocaleString('th-TH')}</strong>
              <small>สิทธิ UC นอก CUP</small>
            </article>
            <article
              className="is-critical-kpi"
              style={{ cursor: 'pointer' }}
              onClick={() => { setAuditStatusFilter('CRITICAL'); setAuditPage(1); }}
              title="คลิกเพื่อกรองเฉพาะรายการเสี่ยงติด C"
            >
              <span>🚨 เสี่ยงติด C / รหัสผิดพลาด</span>
              <strong style={{ color: '#dc2626' }}>{(auditResult?.summary.critical_count || 0).toLocaleString('th-TH')}</strong>
              <small>คลิกเพื่อกรองเฉพาะเคสผิดพลาด</small>
            </article>
            <article
              className="is-dental-kpi"
              style={{ cursor: 'pointer' }}
              onClick={() => { setAuditCategory('DENTAL'); setAuditPage(1); }}
              title="คลิกเพื่อกรองเฉพาะงานทันตกรรม"
            >
              <span>🦷 งานทันตกรรมที่พบปัญหา</span>
              <strong style={{ color: '#b45309' }}>
                {(auditResult?.summary.dental_issue_count || 0).toLocaleString('th-TH')}
                <span style={{ fontSize: '13px', fontWeight: 'normal', color: '#64748b' }}>
                  {' '}/ {(auditResult?.summary.dental_total || 0).toLocaleString('th-TH')} visit
                </span>
              </strong>
              <small>คลิกเพื่อกรองเฉพาะทันตกรรม</small>
            </article>
            <article
              className="is-warning-kpi"
              style={{ cursor: 'pointer' }}
              onClick={() => { setAuditStatusFilter('WARNING'); setAuditPage(1); }}
              title="คลิกเพื่อกรองรายการขาด WALKIN"
            >
              <span>⚠️ ขาดรหัสค่าบริการ WALKIN</span>
              <strong style={{ color: '#ea580c' }}>{(auditResult?.summary.missing_walkin_count || 0).toLocaleString('th-TH')}</strong>
              <small>ยังไม่มี icode ในใบสั่งยา</small>
            </article>
            <article
              className="is-valid-kpi"
              style={{ cursor: 'pointer' }}
              onClick={() => { setAuditStatusFilter('VALID'); setAuditPage(1); }}
              title="คลิกเพื่อกรองรายการสมบูรณ์"
            >
              <span>✅ ข้อมูลสมบูรณ์พร้อมส่ง</span>
              <strong style={{ color: '#16a34a' }}>{(auditResult?.summary.valid_count || 0).toLocaleString('th-TH')}</strong>
              <small>ผ่านเกณฑ์เบื้องต้น</small>
            </article>
          </section>

          <section className="uc-cup-filters card">
            <label>
              วันที่เริ่ม
              <input type="date" value={startDate} onChange={(e) => setDates((old) => ({ ...old, startDate: e.target.value }))} />
            </label>
            <label>
              วันที่สิ้นสุด
              <input type="date" value={endDate} onChange={(e) => setDates((old) => ({ ...old, endDate: e.target.value }))} />
            </label>
            <label>
              กลุ่มบริการ / แผนก
              <select value={auditCategory} onChange={(e) => { setAuditCategory(e.target.value as any); setAuditPage(1); }}>
                <option value="ALL">ทุกกลุ่มบริการ</option>
                <option value="DENTAL">🦷 เฉพาะงานทันตกรรม (Dental)</option>
                <option value="GENERAL">🩺 ผู้ป่วยนอกทั่วไป (OPD General)</option>
              </select>
            </label>
            <label>
              สถานะการตรวจ
              <select value={auditStatusFilter} onChange={(e) => { setAuditStatusFilter(e.target.value as any); setAuditPage(1); }}>
                <option value="ALL">ทุกสถานะ</option>
                <option value="CRITICAL">🚨 เสี่ยงติด C (Critical Errors)</option>
                <option value="WARNING">⚠️ มีข้อควรระวัง (Warnings)</option>
                <option value="VALID">✅ ถูกต้องสมบูรณ์ (Valid)</option>
              </select>
            </label>
            <label className="uc-cup-search">
              ค้นหา
              <input
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="VN / HN / ชื่อผู้ป่วย"
                onKeyDown={(e) => { if (e.key === 'Enter') void loadClinicalAudit(1); }}
              />
            </label>
            <button className="btn btn-primary" type="button" onClick={() => void loadClinicalAudit(1)} disabled={auditLoading}>
              {auditLoading ? 'กำลังตรวจ…' : 'ตรวจสอบเวชระเบียน'}
            </button>
          </section>

          <section className="card uc-cup-visits">
            <header>
              <div>
                <h2>ผลการตรวจสอบเวชระเบียนและการลงรหัส กองทุน WALKIN</h2>
                <p>ระบบตรวจจับความไม่สัมพันธ์ของ ICD-10 และ ICD-9 (เช่น ขูดหินปูน/อุดฟัน/ผ่าฟันคุด), โรคหลัก PDX, และรหัสบริการ WALKIN</p>
              </div>
              <span>{(auditResult?.total || 0).toLocaleString('th-TH')} รายการ</span>
            </header>
            <div className="table-responsive">
              <table className="data-table uc-audit-table">
                <thead>
                  <tr>
                    <th style={{ width: '110px' }}>วันเวลา</th>
                    <th style={{ width: '130px' }}>VN / HN</th>
                    <th style={{ width: '160px' }}>ผู้ป่วย / แผนก</th>
                    <th style={{ width: '180px' }}>การวินิจฉัย (ICD-10)</th>
                    <th style={{ width: '170px' }}>หัตถการ (ICD-9 / ทันตกรรม)</th>
                    <th style={{ width: '100px' }}>ค่าบริการ</th>
                    <th style={{ width: '240px' }}>ผลการตรวจ / เสี่ยงติด C</th>
                    <th>คำแนะนำการแก้ไขใน HOSxP</th>
                    <th style={{ width: '90px' }}>ตรวจ Visit</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditResult?.data || []).map((row) => {
                    const isCrit = row.audit_status === 'critical';
                    const isWarn = row.audit_status === 'warning';
                    return (
                      <tr key={row.vn} className={isCrit ? 'row-critical' : isWarn ? 'row-warning' : ''}>
                        <td>
                          {row.service_date}
                          <small>{row.service_time}</small>
                        </td>
                        <td>
                          <strong>{row.vn}</strong>
                          <small>HN {row.hn}</small>
                          <small>{row.pttype} | {row.hospmain || '-'}</small>
                        </td>
                        <td>
                          <strong>{row.patient_name || '-'}</strong>
                          <small>{row.sex === '1' ? 'ชาย' : row.sex === '2' ? 'หญิง' : ''} {row.age_y ? `${row.age_y} ปี` : ''}</small>
                          <div style={{ marginTop: 4 }}>
                            {row.is_dental && <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: 4, fontSize: '10px', fontWeight: 'bold', marginRight: 4 }}>🦷 ทันตกรรม</span>}
                            <small style={{ display: 'inline' }}>{row.department || '-'}</small>
                          </div>
                        </td>
                        <td>
                          {row.diagnoses.length === 0 ? (
                            <span style={{ color: '#dc2626', fontSize: '12px', fontWeight: 'bold' }}>❌ ไม่มีรหัสโรค</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              {row.diagnoses.map((d, idx) => (
                                <div key={`${d.code}-${idx}`} style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span
                                    style={{
                                      fontSize: '9px', padding: '1px 5px', borderRadius: 4, fontWeight: 'bold',
                                      background: d.diagtype === '1' ? '#dbeafe' : '#f1f5f9',
                                      color: d.diagtype === '1' ? '#1d4ed8' : '#475569',
                                    }}
                                  >
                                    {d.diagtype === '1' ? 'PDX' : `DX${d.diagtype}`}
                                  </span>
                                  <strong style={{ fontFamily: 'monospace', color: d.diagtype === '1' ? '#1d4ed8' : '#0f172a' }}>{d.code}</strong>
                                  <span style={{ color: '#64748b', fontSize: '10px', maxWidth: '85px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>
                                    {d.name}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          {row.procedures.length === 0 ? (
                            <span style={{ color: '#94a3b8', fontSize: '12px' }}>- ไม่มีหัตถการ -</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              {row.procedures.map((p, idx) => (
                                <div key={`${p.code}-${idx}`} style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span
                                    style={{
                                      fontSize: '9px', padding: '1px 5px', borderRadius: 4, fontWeight: 'bold',
                                      background: p.type === 'Dental' ? '#fef3c7' : '#e0f2fe',
                                      color: p.type === 'Dental' ? '#b45309' : '#0369a1',
                                    }}
                                  >
                                    {p.type === 'Dental' ? 'ฟัน' : 'ICD9'}
                                  </span>
                                  <strong style={{ fontFamily: 'monospace' }}>{p.code}</strong>
                                  <span style={{ color: '#475569', fontSize: '10px', maxWidth: '85px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
                                    {p.name}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="money" style={{ display: 'block', fontWeight: 600 }}>฿{money(row.total_charge)}</span>
                          {row.has_walkin ? (
                            <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: 4, fontSize: '10px', fontWeight: 'bold' }}>มี WALKIN</span>
                          ) : (
                            <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: 4, fontSize: '10px', fontWeight: 'bold' }}>ขาด WALKIN</span>
                          )}
                        </td>
                        <td>
                          {row.issues.length === 0 ? (
                            <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 8px', borderRadius: 6, fontSize: '11px', fontWeight: 'bold' }}>
                              ✅ ข้อมูลสมบูรณ์
                            </span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {row.issues.map((iss) => (
                                <div
                                  key={iss.code}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    background: iss.level === 'critical' ? '#fef2f2' : '#fffbeb',
                                    border: `1px solid ${iss.level === 'critical' ? '#fca5a5' : '#fcd34d'}`,
                                    color: iss.level === 'critical' ? '#b91c1c' : '#92400e',
                                  }}
                                >
                                  <div style={{ fontWeight: 'bold' }}>{iss.title}</div>
                                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>{iss.detail}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          {row.issues.length === 0 ? (
                            <span style={{ color: '#16a34a', fontSize: '12px' }}>พร้อมส่งออกเบิกจ่าย</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {row.issues.map((iss) => (
                                <div
                                  key={`${iss.code}-rec`}
                                  style={{
                                    fontSize: '11px',
                                    background: '#f8fafc',
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    borderLeft: `3px solid ${iss.level === 'critical' ? '#ef4444' : '#f59e0b'}`,
                                    color: '#334155',
                                  }}
                                >
                                  💡 {iss.recommendation}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => void openPrescription({ vn: row.vn, hn: row.hn, pttype: row.pttype, hospmain: row.hospmain, service_date: row.service_date, claimable_amount: row.total_charge } as any)}
                          >
                            ตรวจ Visit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!auditLoading && (auditResult?.data || []).length === 0 && (
                    <tr>
                      <td colSpan={9} className="uc-cup-empty">ไม่พบรายการตามเงื่อนไขที่เลือก</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="uc-cup-pagination">
              <button disabled={auditPage <= 1 || auditLoading} onClick={() => void loadClinicalAudit(auditPage - 1)}>
                ก่อนหน้า
              </button>
              <span>หน้า {auditPage} / {Math.max(1, Math.ceil((auditResult?.total || 0) / 50))}</span>
              <button
                disabled={auditPage >= Math.max(1, Math.ceil((auditResult?.total || 0) / 50)) || auditLoading}
                onClick={() => void loadClinicalAudit(auditPage + 1)}
              >
                ถัดไป
              </button>
            </footer>
          </section>
        </>
      )}

      {/* TAB 2: RECONCILIATION & HMAIN TRACKING */}
      {activeTab === 'reconciliation' && (
        <>
          <section className="uc-cup-filters card">
            <label>วันที่เริ่ม<input type="date" value={startDate} onChange={(e) => setDates((old) => ({ ...old, startDate: e.target.value }))} /></label>
            <label>วันที่สิ้นสุด<input type="date" value={endDate} onChange={(e) => setDates((old) => ({ ...old, endDate: e.target.value }))} /></label>
            <label>ประเภท<select value={patientType} onChange={(e) => setPatientType(e.target.value)}><option value="ALL">OPD + IPD</option><option>OPD</option><option>IPD</option></select></label>
            <label>สถานะ<select value={compareStatus} onChange={(e) => setCompareStatus(e.target.value)}><option value="">ทุกสถานะ</option><option>รอ REP</option><option>รอ STM/INV</option><option>ยอดต่าง</option><option>ตรงกัน</option><option>เสร็จสิ้น (INV)</option><option>ไม่มีข้อมูล</option></select></label>
            <label>HMAIN<select value={hmain} onChange={(e) => setHmain(e.target.value)}><option value="">ทุก HMAIN</option>{hmainOptions.map((item) => <option key={item.hmain} value={item.hmain}>{item.hmain} {item.hmain_name || ''}</option>)}</select></label>
            <label className="uc-cup-search">ค้นหา<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="VN / AN / HN / ชื่อ / REP / STM / INV" onKeyDown={(e) => { if (e.key === 'Enter') void load(1); }} /></label>
            <button className="btn btn-primary" type="button" onClick={() => void load(1)} disabled={loading}>{loading ? 'กำลังโหลด…' : 'ค้นหาข้อมูล'}</button>
          </section>

          <section className="card uc-walkin-audit">
            <header>
              <div>
                <span>ตรวจใบสั่งยา · สิทธิ {(walkinAudit?.pttypes || []).join('/') || 'ตามการตั้งค่าโรงพยาบาล'}</span>
                <h2>WALKIN: ผู้ป่วยนอกเหตุสมควร ทั่วประเทศ</h2>
                <p>ตรวจตั้งแต่ปีงบประมาณ 2568 (1 ต.ค. 2567) ถึงปัจจุบัน เฉพาะ UC นอก CUP ในจังหวัด</p>
              </div>
              <button className="btn btn-sm" type="button" onClick={() => void loadWalkinAudit()} disabled={walkinLoading}>
                {walkinLoading ? 'กำลังตรวจ…' : 'ตรวจสอบใหม่'}
              </button>
            </header>
            <div className="uc-walkin-summary">
              <article><span>Visit {(walkinAudit?.pttypes || []).join('/')}</span><strong>{(walkinAudit?.summary.total_visits || 0).toLocaleString('th-TH')}</strong></article>
              <article className="is-ok"><span>มี WALKIN แล้ว</span><strong>{(walkinAudit?.summary.has_walkin || 0).toLocaleString('th-TH')}</strong></article>
              <article className="is-missing"><span>ต้องเพิ่ม WALKIN</span><strong>{(walkinAudit?.summary.missing_walkin || 0).toLocaleString('th-TH')}</strong></article>
              <article><span>ไม่มีแถวต้นแบบ</span><strong>{(walkinAudit?.summary.missing_without_template || 0).toLocaleString('th-TH')}</strong></article>
            </div>
            {(walkinAudit?.summary.missing_walkin || 0) > 0 && (
              <div className="uc-walkin-warning">
                <strong>พบ {(walkinAudit?.summary.missing_walkin || 0).toLocaleString('th-TH')} visit ที่ยังไม่มีรหัส {walkinAudit?.item.icode}</strong>
                <p>ระบบจะเพิ่มรายการราคา 0 บาท จำนวน 1 โดยไม่เปลี่ยนยอดใบสั่งยา และไม่เพิ่มซ้ำใน VN ที่มีแล้ว</p>
              </div>
            )}
            <div className="uc-walkin-list table-responsive">
              <table className="data-table">
                <thead>
                  <tr><th>วันที่</th><th>VN / HN</th><th>สิทธิ</th><th>HMAIN</th><th>ใบสั่งยาเดิม</th><th>สถานะ</th></tr>
                </thead>
                <tbody>
                  {(walkinAudit?.data || []).map((row) => (
                    <tr key={row.vn}>
                      <td>{row.service_date}<small>{row.service_time}</small></td>
                      <td><strong>{row.vn}</strong><small>HN {row.hn}</small></td>
                      <td>{row.pttype}</td>
                      <td>{row.hospmain || '-'}</td>
                      <td>{row.has_prescription_template ? 'มี' : 'ไม่มี'}</td>
                      <td><span className="uc-walkin-missing-chip">ขาด WALKIN</span></td>
                    </tr>
                  ))}
                  {!walkinLoading && (walkinAudit?.data.length || 0) === 0 && (
                    <tr><td colSpan={6} className="uc-cup-empty">ไม่พบรายการที่ขาด</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {(walkinAudit?.summary.missing_walkin || 0) > 0 && (
              <div className="uc-walkin-confirm">
                <label>
                  เพื่อป้องกันการกดผิด กรุณาพิมพ์ <b>{`เพิ่ม WALKIN ${walkinAudit?.summary.missing_walkin || 0} รายการ`}</b>
                  <input value={walkinConfirmation} onChange={(event) => setWalkinConfirmation(event.target.value)} placeholder="พิมพ์ข้อความยืนยันให้ตรงทุกตัว" />
                </label>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void insertMissingWalkin()}
                  disabled={walkinInserting || walkinConfirmation !== `เพิ่ม WALKIN ${walkinAudit?.summary.missing_walkin || 0} รายการ`}
                >
                  {walkinInserting ? 'กำลังเพิ่มและตรวจสอบ…' : 'เพิ่มรายการที่ขาดเพื่อส่งออกใหม่'}
                </button>
                <small>การทำงานนี้สงวนสิทธิ์สำหรับผู้ดูแลระบบ และมี audit log ของ VN/GUID ที่เพิ่มทุกครั้ง</small>
              </div>
            )}
          </section>

          <section className="uc-cup-kpis">
            <article><span>จำนวน Visit</span><strong>{(summary?.total_visits || 0).toLocaleString('th-TH')}</strong><small>สิทธิการเงิน 07</small></article>
            <article><span>ยอดต้องเรียกเก็บ</span><strong>฿{money(summary?.total_claimable)}</strong><small>ยอดตั้งลูกหนี้จาก HOSxP</small></article>
            <article><span>รับแล้วตาม STM</span><strong>฿{money(summary?.total_stm_paid)}</strong><small>{summary?.completed_inv || 0} visit มี INV แล้ว</small></article>
            <article className="is-warning"><span>ยอดคงค้างติดตาม</span><strong>฿{money(outstanding)}</strong><small>ตั้งลูกหนี้หักยอดรับแล้ว</small></article>
            <article><span>ยอด INV / ตามจ่าย</span><strong>฿{money(summary?.total_inv)}</strong><small>อ้างอิงไฟล์ INV ที่นำเข้า</small></article>
          </section>

          <section className="card uc-cup-groups">
            <header>
              <div>
                <h2>ยอดตาม HMAIN</h2>
                <p>ใช้สำหรับดูว่าต้องติดตามหน่วยบริการใดและจำนวนเท่าไร</p>
              </div>
              <span>{hmainOptions.length} แห่ง</span>
            </header>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>HMAIN / หน่วยบริการ</th>
                    <th>Visit</th>
                    <th>ต้องเรียกเก็บ</th>
                    <th>REP</th>
                    <th>STM รับแล้ว</th>
                    <th>INV / ตามจ่าย</th>
                    <th>คงค้าง</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {hmainOptions.map((group: UcOutsideCupGroup) => (
                    <tr key={group.hmain}>
                      <td><strong>{group.hmain}</strong><small>{group.hmain_name || 'ไม่พบชื่อหน่วยบริการใน HOSxP'}</small></td>
                      <td>{group.visits.toLocaleString()}</td>
                      <td className="money">{money(group.claimable_amount)}</td>
                      <td className="money">{money(group.rep_amount)}</td>
                      <td className="money is-paid">{money(group.stm_paid_amount)}</td>
                      <td className="money">{money(group.inv_amount)}</td>
                      <td className="money is-due">{money(group.outstanding_amount)}</td>
                      <td>
                        <button className="btn btn-sm" type="button" onClick={() => setHmain(group.hmain === 'ไม่ระบุ HMAIN' ? '' : group.hmain)}>
                          เลือก
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card uc-cup-visits">
            <header>
              <div>
                <h2>รายละเอียด Visit</h2>
                <p>คลิกสถานะเพื่อดูเลขอ้างอิงและผลตรวจของ visit นั้น</p>
              </div>
              <span>{(result?.total || 0).toLocaleString('th-TH')} รายการ</span>
            </header>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>วันเวลารับบริการ</th>
                    <th>VN / AN</th>
                    <th>ผู้ป่วย</th>
                    <th>HMAIN</th>
                    <th>ยอดเรียกเก็บ</th>
                    <th>FDH</th>
                    <th>REP</th>
                    <th>STM</th>
                    <th>INV</th>
                    <th>สถานะ</th>
                    <th>ตรวจ Visit</th>
                  </tr>
                </thead>
                <tbody>
                  {(result?.data || []).map((row) => (
                    <tr key={row.visit_key}>
                      <td>{row.service_datetime || row.service_date}</td>
                      <td><strong>{row.vn || row.an}</strong><small>{row.patient_type}</small></td>
                      <td>{row.patient_name}<small>HN {row.hn}</small></td>
                      <td><strong>{row.hospmain || '-'}</strong><small>{row.hmain_name || ''}</small></td>
                      <td className="money">{money(row.claimable_amount)}</td>
                      <td>
                        <button className={`uc-cup-chip ${row.fdh_status ? 'is-ok' : ''}`} onClick={() => setDetail(row)}>
                          {row.fdh_status ? 'FDH' : '-'}
                        </button>
                      </td>
                      <td>
                        <button className={`uc-cup-chip ${row.has_rep ? (row.rep_errorcode || row.rep_verifycode ? 'is-error' : 'is-ok') : ''}`} onClick={() => setDetail(row)}>
                          {row.has_rep ? `REP${row.rep_errorcode ? ` ${row.rep_errorcode}` : ''}` : '-'}
                        </button>
                      </td>
                      <td>
                        <button className={`uc-cup-chip ${row.has_stm ? 'is-ok' : ''}`} onClick={() => setDetail(row)}>
                          {row.has_stm ? money(row.stm_paid_amount) : '-'}
                        </button>
                      </td>
                      <td>
                        <button className={`uc-cup-chip ${row.has_inv ? 'is-ok' : ''}`} onClick={() => setDetail(row)}>
                          {row.has_inv ? money(row.inv_amount) : '-'}
                        </button>
                      </td>
                      <td><span className={`uc-cup-status ${statusClass(row.compare_status)}`}>{row.compare_status}</span></td>
                      <td>
                        {row.vn ? (
                          <button className="btn btn-sm" onClick={() => void openPrescription(row)}>ดูข้อมูล Visit</button>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="uc-cup-pagination">
              <button disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>ก่อนหน้า</button>
              <span>หน้า {page} / {totalPages}</span>
              <button disabled={page >= totalPages || loading} onClick={() => void load(page + 1)}>ถัดไป</button>
            </footer>
          </section>
        </>
      )}

      {detail && (
        <Modal title={`หลักฐานการเบิก ${detail.vn || detail.an}`} onClose={() => setDetail(null)}>
          <div className="uc-cup-evidence">
            <article><h4>FDH</h4><b>{detail.fdh_status || 'ยังไม่พบข้อมูล'}</b><p>Claim/Transaction: {detail.fdh_claim_code || '-'}</p><p>ส่งเมื่อ: {detail.fdh_sent_at || '-'}</p></article>
            <article><h4>REP</h4><b>{detail.rep_no || 'ยังไม่พบข้อมูล'}</b><p>ยอด: {detail.rep_amount == null ? '-' : `฿${money(detail.rep_amount)}`}</p><p>Error: {[detail.rep_errorcode, detail.rep_verifycode].filter(Boolean).join(', ') || '-'}</p></article>
            <article><h4>STM</h4><b>{detail.stm_statement_no || 'ยังไม่พบข้อมูล'}</b><p>ยอดรับ: {detail.stm_paid_amount == null ? '-' : `฿${money(detail.stm_paid_amount)}`}</p><p>Error: {[detail.stm_errorcode, detail.stm_verifycode].filter(Boolean).join(', ') || '-'}</p></article>
            <article><h4>INV</h4><b>{detail.inv_statement_no || 'ยังไม่พบข้อมูล'}</b><p>ยอด INV: {detail.inv_amount == null ? '-' : `฿${money(detail.inv_amount)}`}</p><p>นำเข้าเมื่อ: {detail.inv_imported_at || '-'}</p></article>
          </div>
        </Modal>
      )}

      {prescriptionVisit && (
        <Modal title={`ตรวจสอบ Visit VN ${prescriptionVisit.vn}`} onClose={() => setPrescriptionVisit(null)}>
          {prescriptionLoading ? (
            <p>กำลังอ่านข้อมูล Visit…</p>
          ) : (
            <div className="uc-cup-visit-review">
              {visitClinical.warnings?.map((warning) => <p role="status" key={warning}>{warning}</p>)}
              <section className="uc-cup-clinical">
                <h4>อาการสำคัญและประวัติปัจจุบัน</h4>
                <dl>
                  <div><dt>CC</dt><dd>{visitClinical.clinical?.cc || 'ไม่ระบุ'}</dd></div>
                  <div><dt>HPI</dt><dd>{visitClinical.clinical?.hpi || 'ไม่ระบุ'}</dd></div>
                </dl>
              </section>
              <section>
                <h4>การวินิจฉัย</h4>
                {visitClinical.diagnoses.length === 0 ? (
                  <p className="uc-cup-empty">ไม่พบข้อมูลการวินิจฉัย</p>
                ) : (
                  <div className="uc-cup-code-list">
                    {visitClinical.diagnoses.map((item, index) => (
                      <article key={`${item.code}-${index}`}>
                        <span className={item.type === '1' ? 'is-primary' : ''}>{item.type === '1' ? 'PDX' : `DX ${item.type || '-'}`}</span>
                        <strong>{item.code || '-'}</strong>
                        <p>{item.name || 'ไม่พบคำอธิบาย'}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <section>
                <h4>หัตถการ</h4>
                {visitClinical.procedures.length === 0 ? (
                  <p className="uc-cup-empty">ไม่พบข้อมูลหัตถการ</p>
                ) : (
                  <div className="uc-cup-code-list">
                    {visitClinical.procedures.map((item, index) => (
                      <article key={`${item.code}-${index}`}>
                        <span>{item.type || 'หัตถการ'}</span>
                        <strong>{item.code || '-'}</strong>
                        <p>{item.name || 'ไม่พบคำอธิบาย'}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <section>
                <h4>ยา เวชภัณฑ์ และรายการค่าใช้จ่าย</h4>
                {prescriptions.length === 0 ? (
                  <p className="uc-cup-empty">ไม่พบรายการยา เวชภัณฑ์ หรือค่าบริการของ visit นี้ใน HOSxP</p>
                ) : (
                  <div className="uc-cup-prescription-wrap">
                    <table className="data-table uc-cup-prescription-table">
                      <thead>
                        <tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>รวม</th></tr>
                      </thead>
                      <tbody>
                        {prescriptions.map((item, index) => (
                          <tr key={`${item.icode}-${index}`}>
                            <td className="uc-cup-prescription-code">{item.icode}</td>
                            <td className="uc-cup-prescription-name">{item.drugName || '-'}<small>{[item.itemType, item.incomeName].filter(Boolean).join(' · ')}</small></td>
                            <td className="uc-cup-prescription-qty">{Number(item.qty || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}</td>
                            <td className="money">{money(item.unitPrice)}</td>
                            <td className="money uc-cup-prescription-total">{money(item.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th colSpan={4}>รวมรายการค่าใช้จ่าย</th>
                          <th className="money">{money(prescriptions.reduce((sum, item) => sum + Number(item.price || 0), 0))}</th>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
