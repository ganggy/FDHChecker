---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/pages/UcOutsideCupPage.tsx"
source_hash: "bf771e2cfa8b76319b01d5d98fa668a6855bb1da128f1806330984cb930f7300"
managed_by: "sync-ksp-vault"
---
# UcOutsideCupPage.tsx

> Source: `src/pages/UcOutsideCupPage.tsx`
> SHA-256: `bf771e2cfa8b76319b01d5d98fa668a6855bb1da128f1806330984cb930f7300`

````tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchDiagsAndProceduresData, fetchUcOutsideCupDashboard, fetchVisitChargeItems, type ReconciliationRow, type UcOutsideCupGroup, type UcOutsideCupResponse, type VisitClinicalData } from '../services/hosxpService';
import type { PrescriptionItem } from '../mockData';

const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currentFiscalYear = () => {
  const today = new Date();
  return today.getFullYear() + 543 + (today.getMonth() >= 9 ? 1 : 0);
};
const fiscalDates = (year: number) => ({ startDate: `${year - 544}-10-01`, endDate: `${year - 543}-09-30` });
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
  const loadedInitially = useRef(false);

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

  const selectFiscalYear = (year: number) => {
    setFiscalYear(year);
    setDates(fiscalDates(year));
    setPage(1);
  };

  const openPrescription = async (row: ReconciliationRow) => {
    if (!row.vn) return;
    setPrescriptionVisit(row);
    setPrescriptionLoading(true);
    setPrescriptions([]);
    setVisitClinical({ clinical: {}, diagnoses: [], procedures: [] });
    try {
      const [itemsResult, clinicalResult] = await Promise.allSettled([
        fetchVisitChargeItems(row.vn),
        fetchDiagsAndProceduresData(row.vn),
      ]);
      if (itemsResult.status === 'fulfilled') setPrescriptions(itemsResult.value);
      if (clinicalResult.status === 'fulfilled') setVisitClinical(clinicalResult.value.data);
      if (itemsResult.status === 'rejected' && clinicalResult.status === 'rejected') throw itemsResult.reason;
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
        <div><span className="uc-cup-eyebrow">การเงิน / บัญชี</span><h1>UC นอก CUP ในจังหวัด</h1>
          <p>ติดตามยอดเรียกเก็บและยอดตามจ่ายตาม HMAIN พร้อมหลักฐาน FDH, REP, STM และ INV ราย visit</p></div>
        <div className="uc-cup-year"><label>ปีงบประมาณ</label><select value={fiscalYear} onChange={(e) => selectFiscalYear(Number(e.target.value))}>
          {[0, 1, 2, 3, 4].map((offset) => { const year = currentFiscalYear() - offset; return <option key={year} value={year}>พ.ศ. {year}</option>; })}
        </select></div>
      </section>

      <section className="uc-cup-filters card">
        <label>วันที่เริ่ม<input type="date" value={startDate} onChange={(e) => setDates((old) => ({ ...old, startDate: e.target.value }))} /></label>
        <label>วันที่สิ้นสุด<input type="date" value={endDate} onChange={(e) => setDates((old) => ({ ...old, endDate: e.target.value }))} /></label>
        <label>ประเภท<select value={patientType} onChange={(e) => setPatientType(e.target.value)}><option value="ALL">OPD + IPD</option><option>OPD</option><option>IPD</option></select></label>
        <label>สถานะ<select value={compareStatus} onChange={(e) => setCompareStatus(e.target.value)}><option value="">ทุกสถานะ</option><option>รอ REP</option><option>รอ STM/INV</option><option>ยอดต่าง</option><option>ตรงกัน</option><option>เสร็จสิ้น (INV)</option><option>ไม่มีข้อมูล</option></select></label>
        <label>HMAIN<select value={hmain} onChange={(e) => setHmain(e.target.value)}><option value="">ทุก HMAIN</option>{hmainOptions.map((item) => <option key={item.hmain} value={item.hmain}>{item.hmain} {item.hmain_name || ''}</option>)}</select></label>
        <label className="uc-cup-search">ค้นหา<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="VN / AN / HN / ชื่อ / REP / STM / INV" onKeyDown={(e) => { if (e.key === 'Enter') void load(1); }} /></label>
        <button className="btn btn-primary" type="button" onClick={() => void load(1)} disabled={loading}>{loading ? 'กำลังโหลด…' : 'ค้นหาข้อมูล'}</button>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="uc-cup-kpis">
        <article><span>จำนวน Visit</span><strong>{(summary?.total_visits || 0).toLocaleString('th-TH')}</strong><small>สิทธิการเงิน 07</small></article>
        <article><span>ยอดต้องเรียกเก็บ</span><strong>฿{money(summary?.total_claimable)}</strong><small>ยอดตั้งลูกหนี้จาก HOSxP</small></article>
        <article><span>รับแล้วตาม STM</span><strong>฿{money(summary?.total_stm_paid)}</strong><small>{summary?.completed_inv || 0} visit มี INV แล้ว</small></article>
        <article className="is-warning"><span>ยอดคงค้างติดตาม</span><strong>฿{money(outstanding)}</strong><small>ตั้งลูกหนี้หักยอดรับแล้ว</small></article>
        <article><span>ยอด INV / ตามจ่าย</span><strong>฿{money(summary?.total_inv)}</strong><small>อ้างอิงไฟล์ INV ที่นำเข้า</small></article>
      </section>

      <section className="card uc-cup-groups">
        <header><div><h2>ยอดตาม HMAIN</h2><p>ใช้สำหรับดูว่าต้องติดตามหน่วยบริการใดและจำนวนเท่าไร</p></div><span>{hmainOptions.length} แห่ง</span></header>
        <div className="table-responsive"><table className="data-table"><thead><tr><th>HMAIN / หน่วยบริการ</th><th>Visit</th><th>ต้องเรียกเก็บ</th><th>REP</th><th>STM รับแล้ว</th><th>INV / ตามจ่าย</th><th>คงค้าง</th><th></th></tr></thead>
          <tbody>{hmainOptions.map((group: UcOutsideCupGroup) => <tr key={group.hmain}><td><strong>{group.hmain}</strong><small>{group.hmain_name || 'ไม่พบชื่อหน่วยบริการใน HOSxP'}</small></td><td>{group.visits.toLocaleString()}</td><td className="money">{money(group.claimable_amount)}</td><td className="money">{money(group.rep_amount)}</td><td className="money is-paid">{money(group.stm_paid_amount)}</td><td className="money">{money(group.inv_amount)}</td><td className="money is-due">{money(group.outstanding_amount)}</td><td><button className="btn btn-sm" type="button" onClick={() => setHmain(group.hmain === 'ไม่ระบุ HMAIN' ? '' : group.hmain)}>เลือก</button></td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="card uc-cup-visits">
        <header><div><h2>รายละเอียด Visit</h2><p>คลิกสถานะเพื่อดูเลขอ้างอิงและผลตรวจของ visit นั้น</p></div><span>{(result?.total || 0).toLocaleString('th-TH')} รายการ</span></header>
        <div className="table-responsive"><table className="data-table"><thead><tr><th>วันเวลารับบริการ</th><th>VN / AN</th><th>ผู้ป่วย</th><th>HMAIN</th><th>ยอดเรียกเก็บ</th><th>FDH</th><th>REP</th><th>STM</th><th>INV</th><th>สถานะ</th><th>ตรวจ Visit</th></tr></thead>
          <tbody>{(result?.data || []).map((row) => <tr key={row.visit_key}><td>{row.service_datetime || row.service_date}</td><td><strong>{row.vn || row.an}</strong><small>{row.patient_type}</small></td><td>{row.patient_name}<small>HN {row.hn}</small></td><td><strong>{row.hospmain || '-'}</strong><small>{row.hmain_name || ''}</small></td><td className="money">{money(row.claimable_amount)}</td>
            <td><button className={`uc-cup-chip ${row.fdh_status ? 'is-ok' : ''}`} onClick={() => setDetail(row)}>{row.fdh_status ? 'FDH' : '-'}</button></td>
            <td><button className={`uc-cup-chip ${row.has_rep ? (row.rep_errorcode || row.rep_verifycode ? 'is-error' : 'is-ok') : ''}`} onClick={() => setDetail(row)}>{row.has_rep ? `REP${row.rep_errorcode ? ` ${row.rep_errorcode}` : ''}` : '-'}</button></td>
            <td><button className={`uc-cup-chip ${row.has_stm ? 'is-ok' : ''}`} onClick={() => setDetail(row)}>{row.has_stm ? money(row.stm_paid_amount) : '-'}</button></td>
            <td><button className={`uc-cup-chip ${row.has_inv ? 'is-ok' : ''}`} onClick={() => setDetail(row)}>{row.has_inv ? money(row.inv_amount) : '-'}</button></td>
            <td><span className={`uc-cup-status ${statusClass(row.compare_status)}`}>{row.compare_status}</span></td><td>{row.vn ? <button className="btn btn-sm" onClick={() => void openPrescription(row)}>ดูข้อมูล Visit</button> : <span>-</span>}</td></tr>)}</tbody>
        </table></div>
        <footer className="uc-cup-pagination"><button disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>ก่อนหน้า</button><span>หน้า {page} / {totalPages}</span><button disabled={page >= totalPages || loading} onClick={() => void load(page + 1)}>ถัดไป</button></footer>
      </section>

      {detail && <Modal title={`หลักฐานการเบิก ${detail.vn || detail.an}`} onClose={() => setDetail(null)}><div className="uc-cup-evidence">
        <article><h4>FDH</h4><b>{detail.fdh_status || 'ยังไม่พบข้อมูล'}</b><p>Claim/Transaction: {detail.fdh_claim_code || '-'}</p><p>ส่งเมื่อ: {detail.fdh_sent_at || '-'}</p></article>
        <article><h4>REP</h4><b>{detail.rep_no || 'ยังไม่พบข้อมูล'}</b><p>ยอด: {detail.rep_amount == null ? '-' : `฿${money(detail.rep_amount)}`}</p><p>Error: {[detail.rep_errorcode, detail.rep_verifycode].filter(Boolean).join(', ') || '-'}</p></article>
        <article><h4>STM</h4><b>{detail.stm_statement_no || 'ยังไม่พบข้อมูล'}</b><p>ยอดรับ: {detail.stm_paid_amount == null ? '-' : `฿${money(detail.stm_paid_amount)}`}</p><p>Error: {[detail.stm_errorcode, detail.stm_verifycode].filter(Boolean).join(', ') || '-'}</p></article>
        <article><h4>INV</h4><b>{detail.inv_statement_no || 'ยังไม่พบข้อมูล'}</b><p>ยอด INV: {detail.inv_amount == null ? '-' : `฿${money(detail.inv_amount)}`}</p><p>นำเข้าเมื่อ: {detail.inv_imported_at || '-'}</p></article>
      </div></Modal>}

      {prescriptionVisit && <Modal title={`ตรวจสอบ Visit VN ${prescriptionVisit.vn}`} onClose={() => setPrescriptionVisit(null)}>{prescriptionLoading ? <p>กำลังอ่านข้อมูล Visit…</p> : <div className="uc-cup-visit-review">
        <section className="uc-cup-clinical"><h4>อาการสำคัญและประวัติปัจจุบัน</h4><dl><div><dt>CC</dt><dd>{visitClinical.clinical?.cc || 'ไม่ระบุ'}</dd></div><div><dt>HPI</dt><dd>{visitClinical.clinical?.hpi || 'ไม่ระบุ'}</dd></div></dl></section>
        <section><h4>การวินิจฉัย</h4>{visitClinical.diagnoses.length === 0 ? <p className="uc-cup-empty">ไม่พบข้อมูลการวินิจฉัย</p> : <div className="uc-cup-code-list">{visitClinical.diagnoses.map((item, index) => <article key={`${item.code}-${index}`}><span className={item.type === '1' ? 'is-primary' : ''}>{item.type === '1' ? 'PDX' : `DX ${item.type || '-'}`}</span><strong>{item.code || '-'}</strong><p>{item.name || 'ไม่พบคำอธิบาย'}</p></article>)}</div>}</section>
        <section><h4>หัตถการ</h4>{visitClinical.procedures.length === 0 ? <p className="uc-cup-empty">ไม่พบข้อมูลหัตถการ</p> : <div className="uc-cup-code-list">{visitClinical.procedures.map((item, index) => <article key={`${item.code}-${index}`}><span>ICD-9-CM</span><strong>{item.code || '-'}</strong><p>{item.name || 'ไม่พบคำอธิบาย'}</p></article>)}</div>}</section>
        <section><h4>ยา เวชภัณฑ์ และรายการค่าใช้จ่าย</h4>{prescriptions.length === 0 ? <p className="uc-cup-empty">ไม่พบรายการยา เวชภัณฑ์ หรือค่าบริการของ visit นี้ใน HOSxP</p> : <div className="uc-cup-prescription-wrap"><table className="data-table uc-cup-prescription-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>รวม</th></tr></thead><tbody>{prescriptions.map((item, index) => <tr key={`${item.icode}-${index}`}><td className="uc-cup-prescription-code">{item.icode}</td><td className="uc-cup-prescription-name">{item.drugName || '-'}<small>{[item.itemType, item.incomeName].filter(Boolean).join(' · ')}</small></td><td className="uc-cup-prescription-qty">{Number(item.qty || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}</td><td className="money">{money(item.unitPrice)}</td><td className="money uc-cup-prescription-total">{money(item.price)}</td></tr>)}</tbody><tfoot><tr><th colSpan={4}>รวมรายการค่าใช้จ่าย</th><th className="money">{money(prescriptions.reduce((sum, item) => sum + Number(item.price || 0), 0))}</th></tr></tfoot></table></div>}</section>
      </div>}</Modal>}
    </div>
  );
};

````
