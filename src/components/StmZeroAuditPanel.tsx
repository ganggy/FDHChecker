import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { formatLocalDateInput } from '../utils/dateUtils';
import { navigateFromDashboard } from '../utils/navigationState';
import { canPrepareZeroResend, ZERO_ACTION_LABELS, type StmZeroRow } from '../utils/stmZeroAudit';
import './StmZeroAuditPanel.css';
import { loadRepErrorCatalog, type RepErrorCatalog } from '../services/repErrorCatalogService';
import { repSheetZeroReasons } from '../utils/repSheetZeroAudit';

type Summary = { total: number; confirmedZero: number; unknownPayment: number; matched: number; unmatched: number;
  paidElsewhere: number; prepareCandidates: number; requestedAmount: number; groups: Array<{ action: string; label: string; count: number }> };
type Snapshot = { data: StmZeroRow[]; total: number; summary: Summary; snapshot: string };
const money = (n: number | null) => n == null ? 'ไม่ระบุ' : n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
const writeWorkbook = (name: string, sheets: Array<[string, Record<string, unknown>[]]>) => {
  const wb = XLSX.utils.book_new();
  for (const [label, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), label);
  XLSX.writeFile(wb, `${name}.xlsx`);
};

export function StmZeroAuditPanel({ mode = 'stm' }: { mode?: 'stm' | 'rep-sheet-zero' }) {
  const isRep = mode === 'rep-sheet-zero';
  const title = isRep ? 'REP Data Sheet 0' : 'STM 0';
  const endpoint = `/api/reconciliation/${isRep ? 'rep-sheet-zero' : 'stm-zero'}`;
  const [catalog, setCatalog] = useState<RepErrorCatalog>({});
  const [catalogError, setCatalogError] = useState('');
  useEffect(() => {
    if (!isRep) return;
    let active = true;
    loadRepErrorCatalog().then(data => { if (active) setCatalog(data); }).catch(() => { if (active) setCatalogError('โหลดคำอธิบายรหัสไม่สำเร็จ ยังดูข้อความต้นฉบับ REP และข้อมูล HIS ได้'); });
    return () => { active = false; };
  }, [isRep]);
  const reasons = (row: StmZeroRow) => {
    const { original, explanations } = repSheetZeroReasons(row, catalog);
    return <div className="zero-rep-reasons">{original.map(r => <p key={r.label}><strong>{r.label}:</strong> {r.text}</p>)}{explanations.map(r => <p key={r.code}><strong>{r.code}</strong> · {r.description}{r.guide && <small>แนวทางตรวจ/แก้ไข: {r.guide}</small>}</p>)}{!original.length && !explanations.length && <p>ไม่พบเหตุผลหรือรหัสในแถวนี้ ต้องตรวจไฟล์ REP ต้นฉบับเพิ่มเติม</p>}</div>;
  };
  const [start, setStart] = useState(() => `${formatLocalDateInput().slice(0, 7)}-01`);
  const [end, setEnd] = useState(formatLocalDateInput);
  const [action, setAction] = useState(''); const [match, setMatch] = useState(''); const [search, setSearch] = useState('');
  const [result, setResult] = useState<Snapshot | null>(null); const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState({ start: '', end: '', action: '', match: '', search: '' });
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, StmZeroRow>>({});
  const [detail, setDetail] = useState<StmZeroRow | null>(null);
  const [source, setSource] = useState<{ diagnoses: Record<string, unknown>[]; procedures: Record<string, unknown>[]; items: Record<string, unknown>[]; warnings: string[]; warning: string } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false); const [sourceError, setSourceError] = useState('');
  const detailRequest = useRef(0);
  const [reviewed, setReviewed] = useState(false); const [note, setNote] = useState('');
  const [channel, setChannel] = useState('eclaim');
  const load = async (nextPage = 1, overrides: Partial<typeof loaded> = {}) => {
    setLoading(true); setError(''); setResult(null); setSelected({}); setReviewed(false);
    const filters = { ...(nextPage === 1 ? { start, end, action, match, search } : loaded), ...overrides };
    try {
      const query = new URLSearchParams({ startDate: filters.start, endDate: filters.end, action: filters.action,
        match: filters.match, search: filters.search, page: String(nextPage) });
      const response = await fetch(`${endpoint}?${query}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'โหลด audit ไม่สำเร็จ');
      setResult(payload); setPage(nextPage); setLoaded(filters);
    } catch (err) { setError(err instanceof Error ? err.message : 'โหลด audit ไม่สำเร็จ'); }
    finally { setLoading(false); }
  };
  const openDetail = async (row: StmZeroRow) => {
    const requestId = ++detailRequest.current;
    setDetail(row); setSource(null); setSourceError(''); setSourceLoading(true);
    try {
      const query = new URLSearchParams({ startDate: loaded.start, endDate: loaded.end, sourceId: row.id });
      const response = await fetch(`${endpoint}?${query}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'อ่านข้อมูล HIS ไม่สำเร็จ');
      if (detailRequest.current === requestId) setSource(payload.data);
    } catch (err) { if (detailRequest.current === requestId) setSourceError(err instanceof Error ? err.message : 'อ่านข้อมูล HIS ไม่สำเร็จ'); }
    finally { if (detailRequest.current === requestId) setSourceLoading(false); }
  };
  const exportExecutive = () => {
    if (!result) return;
    const s = result.summary;
    writeWorkbook(`audit_${isRep ? 'REP_DataSheet0' : 'STM0'}_${loaded.start}_${loaded.end}`, [['สรุปผู้บริหาร', [
      { หัวข้อ: 'แหล่งข้อมูล', ค่า: title },
      { หัวข้อ: 'ช่วงวันที่นำเข้า', ค่า: `${loaded.start} ถึง ${loaded.end}` },
      { หัวข้อ: 'เวลาประมวลผล', ค่า: result.snapshot },
      { หัวข้อ: 'ตัวกรอง', ค่า: `${ZERO_ACTION_LABELS[loaded.action as keyof typeof ZERO_ACTION_LABELS] || 'ทุกเหตุผล'} / ${loaded.match || 'ทุกสถานะจับคู่'} / ${loaded.search || 'ไม่มีคำค้น'}` },
      { หัวข้อ: 'แถวทั้งหมดตามตัวกรอง', ค่า: s.total }, { หัวข้อ: isRep ? 'ระบุยอดชดเชย 0 ใน REP' : 'ยืนยันยอดจ่าย 0 บาท', ค่า: s.confirmedZero },
      { หัวข้อ: 'ยอดจ่ายไม่ทราบค่า', ค่า: s.unknownPayment }, { หัวข้อ: 'จับคู่ HIS ได้', ค่า: s.matched },
      { หัวข้อ: 'ยังจับคู่ HIS ไม่ได้', ค่า: s.unmatched }, { หัวข้อ: 'พบยอดจ่ายใน Visit เดียวกัน', ค่า: s.paidElsewhere },
      { หัวข้อ: 'แถวที่เลือกเตรียมตรวจส่งใหม่ได้ (ยังไม่อนุมัติส่ง)', ค่า: s.prepareCandidates },
      { หัวข้อ: 'หมายเหตุ', ค่า: `นับแถว ${title} ไม่ใช่จำนวนผู้ป่วยหรือ Visit; ข้อมูลเฉพาะไฟล์ที่นำเข้า ยังไม่ใช่รายได้ที่เรียกคืนได้${isRep ? '; REP ไม่ใช่หลักฐานยอดจ่าย STM' : ''}` },
    ]], ['ประเด็นที่ต้องติดตาม', s.groups.map(g => ({ ประเด็น: g.label, จำนวนแถว: g.count }))]]);
  };
  const chosen = Object.values(selected);
  const exportQueue = () => writeWorkbook(`STM0_เตรียมแก้ไข_${loaded.start}_${loaded.end}`, [['รายการตรวจส่งใหม่', chosen.map(r => ({
    รหัสแถว: r.id, Batch: r.batch_id, ไฟล์: r.source_filename, ชีต: r.sheet_name, แถวข้อมูลนำเข้า: r.row_no ?? '',
    HN: r.hn, VN: r.vn, AN: r.an, TRAN_ID: r.tran_id, วันที่บริการ: r.service_date,
    ยอดจ่าย: r.paid_amount, รหัสเหตุผล: `${r.errorcode} ${r.verifycode}`, ขั้นตอน: ZERO_ACTION_LABELS[r.action],
    ช่องทาง: channel === 'fdh' ? 'FDH (ผู้ใช้ยืนยันช่องทางเดิม)' : 'eClaim / OSR', บันทึกตรวจสอบ: note, เวลาข้อมูลAudit: result?.snapshot || '',
    ยืนยันตรวจข้อมูล: reviewed ? 'ตรวจแล้ว; ต้องยืนยันสิทธิแก้ไขกับระบบปลายทางอีกครั้ง' : 'ยังไม่ยืนยัน',
  }))]]);
  const handoff = async (ipd: boolean) => {
    const rows = chosen.filter(r => ipd ? Boolean(r.an) : !r.an && r.vn);
    if (!rows.length || !reviewed || !note.trim()) return;
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ startDate: loaded.start, endDate: loaded.end, checkIds: rows.map(r => r.id).join(',') });
      const response = await fetch(`/api/reconciliation/stm-zero?${query}`);
      const payload = await response.json();
      const refreshed: StmZeroRow[] = payload.data || [];
      if (!response.ok || !payload.success || rows.some(r => !refreshed.some(current => current.id === r.id && current.vn === r.vn && current.an === r.an && current.hn === r.hn && current.service_date === r.service_date))) {
        setError('ข้อมูลเปลี่ยนหรือยังยืนยันส่งใหม่ไม่ได้ กรุณาโหลด audit และตรวจรายการอีกครั้ง'); setReviewed(false); return;
      }
    const dates = rows.map(r => r.service_date.slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (dates.length !== rows.length) { setError('บางรายการไม่มีวันที่บริการ กรุณาตรวจต้นทางก่อนส่งต่อ'); return; }
    navigateFromDashboard(ipd ? 'ipdExport' : 'fdh', { contextLabel: `STM 0: ${note.trim()} — ตรวจสิทธิแก้ไขและยืนยันส่งซ้ำก่อนส่งจริง`,
      startDate: dates[0], endDate: dates[dates.length - 1],
      ...(ipd ? { ipdExport: { targetAns: [...new Set(rows.map(r => r.an))] } } : { fdh: { statusFilter: 'all', targetVns: [...new Set(rows.map(r => r.vn))] } }),
    });
    } catch { setError('ตรวจสถานะล่าสุดไม่สำเร็จ กรุณาลองใหม่ก่อนเปิดส่งออก'); }
    finally { setLoading(false); }
  };
  return <section className="stm-zero-audit" aria-label={`ตรวจ ${title}`}>
    <header className={`zero-hero ${isRep ? 'zero-hero-rep' : ''}`}><div className="zero-hero-title"><span className="zero-eyebrow">{isRep ? 'ผลตอบกลับ REP · ตรวจเหตุผลไม่ชดเชย' : 'ติดตามผลชดเชย · ตรวจสอบหลักฐาน'}</span><h1>ตรวจ {title}</h1><p>{isRep ? 'ดูแถบ Data Sheet 0 ใน REP อ่านเหตุผล และเทียบข้อมูลต้นทาง HIS' : 'ค้นรายการจ่าย 0 บาท เทียบข้อมูลต้นทาง และติดตามการแก้ไขในที่เดียว'}</p></div>
      <button className="zero-report-button" disabled={!result || loading} onClick={exportExecutive}>↗ ดาวน์โหลดสรุปผู้บริหาร</button></header>
    <ol className="zero-workflow"><li><b>1</b><span>ค้นรายการ<span>ตามวันที่นำเข้าไฟล์</span></span></li><li><b>2</b><span>ตรวจหลักฐาน<span>เทียบแถว {isRep ? 'REP' : 'STM'} กับ HIS</span></span></li><li><b>3</b><span>{isRep ? 'ตรวจเหตุผล' : 'เตรียมแก้ไข'}<span>{isRep ? 'อ่านรหัสและข้อความต้นฉบับ' : 'ยืนยันสิทธิส่งใหม่ก่อนส่ง'}</span></span></li></ol>
    <div className="zero-notice"><strong>{isRep ? 'Data Sheet 0 จาก REP' : 'ตรวจเหตุผลก่อนส่งซ้ำ'}</strong><span>{isRep ? 'แสดงทุกแถวของชีตนี้ แม้ไม่มียอดจ่าย ใช้เหตุผลจากไฟล์และคำอธิบายรหัสประกอบ ไม่สรุปสาเหตุจากยอด 0 เพียงอย่างเดียว' : 'บางรายการต้องรอรอบจ่าย อนุมัติ SMCS หรือเปิดแก้ไขผ่าน OSR ยอดว่างจะแยกจากยอด 0 เสมอ'}</span></div>
    {isRep && <div className="zero-actions"><button onClick={() => navigateFromDashboard('repstm', {})}>นำเข้าไฟล์ REP</button><button onClick={() => navigateFromDashboard('stmZeroAudit', {})}>เปิดหน้าตรวจ STM 0</button></div>}
    {catalogError && <p role="alert" className="zero-error">{catalogError}</p>}
    <section className="zero-filter-card" aria-label={`ตัวกรอง ${title}`}><div className="zero-section-heading"><h2>ค้นหารายการที่ต้องตรวจ</h2><span>ใช้วันที่นำเข้าไฟล์ ไม่ใช่วันที่บริการ</span></div><div className="zero-filters">
      <label>นำเข้าตั้งแต่<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>นำเข้าถึง<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      <label>ขั้นตอนติดตาม<select value={action} onChange={e => setAction(e.target.value)}><option value="">ทุกขั้นตอน</option>{Object.entries(ZERO_ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>การจับคู่<select value={match} onChange={e => setMatch(e.target.value)}><option value="">ทั้งหมด</option><option value="matched">จับคู่ HIS แล้ว</option><option value="unmatched">ยังจับคู่ไม่ได้</option></select></label>
      <label>ค้น HN / VN / AN / รหัส / ไฟล์<input value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button className="rec-btn rec-btn-primary" disabled={loading} onClick={() => void load()}>{loading ? 'กำลังตรวจ...' : `ค้นหา ${isRep ? 'Data Sheet 0' : 'STM 0'}`}</button>
    </div></section>
    {error && <p role="alert" className="zero-error">{error}</p>}
    {loading && <div className="zero-empty" role="status"><span className="zero-empty-icon">⌕</span><h2>กำลังเทียบ {isRep ? 'REP' : 'STM'} กับข้อมูล HIS</h2><p>ตรวจสถานะจับคู่และข้อมูลที่นำเข้าแล้ว</p></div>}
    {!result && !loading && !error && <div className="zero-empty"><span className="zero-empty-icon">⌕</span><h2>{isRep ? 'ตรวจเหตุผลใน REP Data Sheet 0' : 'เริ่มตรวจรายการชดเชย 0 บาท'}</h2><p>เลือกช่วงวันที่นำเข้าไฟล์ แล้วกด “ค้นหา {isRep ? 'Data Sheet 0' : 'STM 0'}”<br />{isRep ? 'นำเข้าไฟล์ REP ผ่านเมนูนำเข้า REP/STM ระบบจะเก็บ Data Sheet 0 อัตโนมัติ หากเคยนำเข้าเฉพาะชีตหลัก ให้เลือกไฟล์เดิมนำเข้าอีกครั้งเพื่อเพิ่มชีตนี้' : 'หากยังไม่มีข้อมูล ให้นำเข้า STM ผ่านเมนูนำเข้า REP/STM ก่อน'}</p><div className="zero-empty-tags"><span>ดูแถวต้นฉบับ</span><span>เทียบวินิจฉัย / ยา / หัตถการ</span><span>สรุปผู้บริหาร</span></div></div>}
    {result && <>
      <p className="zero-snapshot">ข้อมูลนำเข้า {loaded.start}–{loaded.end} · ประมวลผล {new Date(result.snapshot).toLocaleString('th-TH')} · สรุปทุกแถวตามตัวกรอง</p>
      <div className="zero-metrics">{[
        { label: isRep ? 'รายการ Data Sheet 0' : 'ยืนยันจ่าย 0 บาท', value: isRep ? result.summary.total : result.summary.confirmedZero, tone: 'blue', sub: isRep ? 'ทุกแถวในชีต REP ตามตัวกรอง' : 'มีการระบุยอดจ่ายชัดเจน' },
        { label: 'ยังจับคู่ HIS ไม่ได้', value: result.summary.unmatched, tone: 'amber', sub: 'ต้องตรวจ VN / AN และ HN' },
        { label: isRep ? 'จับคู่ HIS แล้ว' : 'ยอดจ่ายไม่ทราบค่า', value: isRep ? result.summary.matched : result.summary.unknownPayment, tone: 'slate', sub: isRep ? 'เปิดเทียบข้อมูลต้นทางได้' : 'ไม่ถือเป็นรายการจ่ายศูนย์' },
        { label: 'พบยอดจ่ายใน Visit', value: result.summary.paidElsewhere, tone: 'teal', sub: 'ตรวจระดับรายการก่อนส่งซ้ำ' },
      ].map(m => <div className={`zero-metric ${m.tone}`} key={m.label}><span>{m.label}</span><strong>{m.value.toLocaleString('th-TH')} <small>แถว</small></strong><small>{m.sub}</small></div>)}</div>
      <div className="zero-groups" aria-label="กรองขั้นตอนอย่างรวดเร็ว"><button disabled={loading} aria-pressed={loaded.action === ''} onClick={() => { setAction(''); void load(1, { action: '' }); }}>ทุกขั้นตอน</button>{result.summary.groups.filter(g => g.count).map(g => <button disabled={loading} aria-pressed={loaded.action === g.action} key={g.action} onClick={() => { setAction(g.action); void load(1, { action: g.action }); }}>{g.label} <b>{g.count}</b></button>)}</div>
      <p className="zero-caption">{isRep ? 'นับแถว REP ไม่ใช่จำนวน Visit; คำอธิบายรหัสช่วยตรวจสาเหตุ ต้องเทียบหลักฐานจริงก่อนแก้ข้อมูล และ REP ไม่ใช่หลักฐานรับเงิน' : 'นับแถว ไม่ใช่จำนวน Visit; แถว 0 อาจเป็นเพียงบางรายการใน Visit ที่ได้รับเงินแล้ว จึงไม่รวมยอดเงินเป็นความเสียหาย'}</p>
      <div className="zero-section-heading"><h2>รายการตรวจสอบ <span className="zero-count">{result.total.toLocaleString('th-TH')} แถว</span></h2><span>{isRep ? 'เปิดหลักฐานเพื่อเทียบแถว REP กับ HIS' : 'เลือกได้เฉพาะแถวที่ผ่านเงื่อนไขเตรียมตรวจส่งใหม่'}</span></div>
      <div className="zero-table-scroll" tabIndex={0} aria-label={`ตารางรายการ ${title} เลื่อนแนวนอนเพื่อดูหลักฐาน`}><table><thead><tr>{!isRep && <th>เลือก</th>}<th>Visit / วันที่</th><th>ต้นทาง</th><th>{isRep ? 'ยอดชดเชยใน REP' : 'ยอดจ่าย'}</th><th>เหตุผล / ขั้นตอน</th><th>จับคู่</th><th>หลักฐาน</th></tr></thead><tbody>
        {result.data.map(r => <tr key={r.id}>{!isRep && <td><input aria-label={`เลือก ${r.id}`} type="checkbox" disabled={!canPrepareZeroResend(r)} checked={Boolean(selected[r.id])} onChange={e => { setReviewed(false); setSelected(prev => { const next = { ...prev }; if (e.target.checked) next[r.id] = r; else delete next[r.id]; return next; }); }} /></td>}
          <td><b>{r.an ? `IPD · AN ${r.an}` : r.vn ? `OPD · VN ${r.vn}` : `${r.encounter_type === 'OP' ? 'OPD' : r.encounter_type === 'IP' ? 'IPD' : 'ไม่ทราบประเภท'} · รอจับคู่ HIS`}</b>{r.tran_id && <small>TRAN_ID {r.tran_id}</small>}<small>HN {r.hn || 'ไม่พบ'} · {r.service_date || 'ไม่ระบุวันที่'}</small></td>
          <td className="zero-file">{r.source_filename}<small>{r.sheet_name || 'STM'} · {r.statement_no || r.tran_id || r.id}</small></td>
          <td className="zero-paid">{money(r.paid_amount)}</td><td>{isRep ? reasons(r) : <b>{r.errorcode} {r.verifycode}</b>}<small className="zero-action-badge" data-action={r.action}>{ZERO_ACTION_LABELS[r.action]}</small></td>
          <td><span className={`zero-match-badge ${r.matched ? 'matched' : ''}`}>{r.matched ? '✓ จับคู่ HIS แล้ว' : 'รอจับคู่'}</span>{r.payment_uncertain && <small>Visit มียอดจ่ายไม่ทราบค่า</small>}</td><td><button className="zero-detail-button" onClick={() => void openDetail(r)}>ดูต้นทาง / HIS ↗</button></td></tr>)}
        {!result.data.length && <tr><td colSpan={isRep ? 6 : 7}>ไม่พบรายการตามเงื่อนไข — ตรวจว่ามีการนำเข้า {title} ครบแล้วหรือไม่</td></tr>}
      </tbody></table></div>
      <div className="zero-pagination"><button disabled={loading || page <= 1} onClick={() => void load(page - 1)}>ก่อนหน้า</button><span>หน้า {page} / {Math.max(1, Math.ceil(result.total / 50))} · {result.total} แถว</span><button disabled={loading || page * 50 >= result.total} onClick={() => void load(page + 1)}>ถัดไป</button></div>
      {!isRep && (chosen.length > 0 ? <section className="zero-prepare"><h3>เตรียมรายการแก้ไข / ส่งใหม่ ({chosen.length} แถวในหน้านี้)</h3>
        <p>รายการรออนุมัติ รอรอบจ่าย ยังจับคู่ไม่ได้ หรือพบยอดจ่ายแล้วจะเลือกไม่ได้ ตรวจแถว 0 ที่ไม่ทราบเหตุผลให้ครบก่อนเลือก</p>
        <label>ช่องทางเดิม<select value={channel} onChange={e => { setChannel(e.target.value); setReviewed(false); }}><option value="eclaim">eClaim / OSR — ดาวน์โหลดรายการไปดำเนินการ</option><option value="fdh">FDH — ยืนยันว่ารายการเดิมส่งทาง FDH</option></select></label>
        <label>ผลการตรวจ / สิ่งที่แก้ไข<textarea value={note} onChange={e => { setNote(e.target.value); setReviewed(false); }} placeholder="ระบุเหตุผล หลักฐานที่ตรวจ และสิทธิแก้ไขจากระบบปลายทาง" /></label>
        <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> ตรวจข้อมูลต้นทาง แก้ไขในระบบงาน และยืนยันสิทธิแก้ไขส่งใหม่ตามกองทุนแล้ว</label>
        <div className="zero-actions"><button disabled={!chosen.length || !reviewed || !note.trim()} onClick={exportQueue}>ดาวน์โหลดรายการที่ตรวจแล้ว</button>
          {channel === 'fdh' && <><button disabled={loading || !reviewed || !note.trim() || !chosen.some(r => !r.an && r.vn)} onClick={() => void handoff(false)}>เปิดส่งออก OPD เฉพาะที่เลือก</button><button disabled={loading || !reviewed || !note.trim() || !chosen.some(r => r.an)} onClick={() => void handoff(true)}>เปิดส่งออก IPD เฉพาะที่เลือก</button></>}
        </div><small>การเปิดส่งออกยังต้องผ่านการตรวจความพร้อมและยืนยันส่งซ้ำ ระบบนี้ไม่ได้ส่งเคลมโดยอัตโนมัติ การเปลี่ยนหน้า/โหลดใหม่ล้างรายการที่เลือกและการยืนยัน</small>
      </section> : <div className="zero-selection-hint">เลือกแถวในตารางเพื่อเตรียมรายการแก้ไข / ส่งใหม่ · แถวที่ยังไม่ผ่านเงื่อนไขสามารถเปิดดูหลักฐานได้</div>)}
    </>}
    {!isRep && <details className="zero-guide"><summary>อ่านเพิ่มเติม: Sheet 0 และแนวทางตรวจ</summary><p>เอกสารชี้แจง สปสช. แสดง Sheet 0 เป็นรายการจ่าย 0 พร้อมเหตุผล กองทุน HERB_GB อาจอยู่ระหว่างรอประมวลผล ส่วน W305 ต้องตรวจการอนุมัติ และ D011 ต้องตรวจการเปิดแก้ไขใน eClaim/OSR คำแนะนำนี้ไม่ใช่การรับรองสิทธิส่งใหม่หรือกำหนดเวลาทักท้วงปัจจุบัน</p>
      <a href="https://www.kpnhospital.com/wp-content/uploads/2025/09/ระบบโปรแกรม_e-Claim_ยาสมุนไพร_HERBFS_25680523.pdf" target="_blank" rel="noreferrer">เอกสารชี้แจง eClaim ยาสมุนไพร (เผยแพร่ผ่านโรงพยาบาล)</a><br />
      <a href="https://fliphtml5.com/cxuqh/kzfq/9_Provider_Center_Claim_30_ตค_68/" target="_blank" rel="noreferrer">เอกสารชี้แจง Provider Center Claim (สำเนาเผยแพร่)</a>
    </details>}
    {detail && <div className="zero-modal-backdrop"><section role="dialog" aria-modal="true" aria-label={`หลักฐาน ${isRep ? 'REP' : 'STM'} และข้อมูล HIS`} className="zero-modal"><button className="zero-close" onClick={() => setDetail(null)}>ปิด</button>
      <h2>หลักฐาน {detail.id}</h2><p>{detail.source_filename} · {detail.sheet_name} · Batch {detail.batch_id}{detail.row_no != null ? ` · แถวข้อมูลนำเข้า ${detail.row_no}` : ''}</p>
      <p>{detail.reason} · {ZERO_ACTION_LABELS[detail.action]}</p>
      {isRep && <><h3>เหตุผลจาก REP และคำอธิบายรหัส</h3>{reasons(detail)}<p>ข้อความจากไฟล์เป็นหลักฐานต้นฉบับ คำอธิบายรหัสเป็นแนวทางตรวจ ไม่ใช่ผลยืนยันจากการตรวจ HIS</p></>}
      <h3>แถวต้นฉบับจากไฟล์นำเข้า</h3><dl>{Object.entries(detail.raw_data).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}</dd></div>)}</dl>
      <h3>ข้อมูล HIS ปัจจุบัน</h3>{sourceLoading && <p>กำลังอ่าน...</p>}{sourceError && <p role="alert">{sourceError}</p>}{source && <><p>{source.warning} {source.warnings.join(' / ')}</p>
        <h4>วินิจฉัย</h4><table><thead><tr><th>ICD10</th><th>ชื่อ</th><th>ประเภท</th></tr></thead><tbody>{source.diagnoses.map((r, i) => <tr key={i}><td>{String(r.code || '')}</td><td>{String(r.name || '')}</td><td>{String(r.type || '')}</td></tr>)}</tbody></table>
        <h4>หัตถการ</h4><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แหล่งบันทึก</th></tr></thead><tbody>{source.procedures.map((r, i) => <tr key={i}><td>{String(r.code || '')}</td><td>{String(r.name || '')}</td><td>{String(r.type || '')}</td></tr>)}</tbody></table>
        <h4>ยา / ค่าใช้จ่าย</h4><table><thead><tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th>ยอด</th><th>ADP</th></tr></thead><tbody>{source.items.map((r, i) => <tr key={i}><td>{String(r.icode || '')}</td><td>{String(r.item_name || '')}</td><td>{String(r.qty ?? '')}</td><td>{money(Number(r.price || 0))}</td><td>{String(r.nhso_adp_code || '')}</td></tr>)}</tbody></table>
        {!source.diagnoses.length && !source.items.length && <p>ไม่มีข้อมูลที่อ่านได้ใน HIS — ไม่ถือว่าผ่านการตรวจ</p>}
      </>}
    </section></div>}
  </section>;
}
