import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { formatLocalDateInput } from '../utils/dateUtils';
import { navigateFromDashboard } from '../utils/navigationState';
import { ZERO_ACTION_LABELS, type StmZeroRow } from '../utils/stmZeroAudit';
import './StmZeroAuditPanel.css';
import { loadRepErrorCatalog, type RepErrorCatalog } from '../services/repErrorCatalogService';
import { repSheetZeroReasons } from '../utils/repSheetZeroAudit';

type Summary = { total: number; confirmedZero: number; unknownPayment: number; matched: number; unmatched: number;
  paidElsewhere: number; prepareCandidates: number; requestedAmount: number; groups: Array<{ action: string; label: string; count: number }>;
  fdh?: { unsent: number; sentToday: number; sentAny: number; total: number } };
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
  const [fdhStatus, setFdhStatus] = useState<string>(isRep ? 'unsent' : 'all');
  const [result, setResult] = useState<Snapshot | null>(null); const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState({ start: '', end: '', action: '', match: '', search: '', fdhStatus: isRep ? 'unsent' : 'all' });
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, StmZeroRow>>({});
  const [detail, setDetail] = useState<StmZeroRow | null>(null);
  const [source, setSource] = useState<{ diagnoses: Record<string, unknown>[]; procedures: Record<string, unknown>[]; items: Record<string, unknown>[]; warnings: string[]; warning: string } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false); const [sourceError, setSourceError] = useState('');
  const detailRequest = useRef(0);
  const [reviewed, setReviewed] = useState(false); const [note, setNote] = useState('');
  const [channel, setChannel] = useState('fdh');
  const [fixingVn, setFixingVn] = useState<string | null>(null);
  const [batchFixing, setBatchFixing] = useState(false);
  const [fixNotification, setFixNotification] = useState<{ type: 'success' | 'error'; message: string; details?: string[] } | null>(null);
  const load = async (nextPage = 1, overrides: Partial<typeof loaded> = {}) => {
    setLoading(true); setError(''); setResult(null); setSelected({}); setReviewed(false);
    const filters = { ...(nextPage === 1 ? { start, end, action, match, search, fdhStatus } : loaded), ...overrides };
    try {
      const query = new URLSearchParams({ startDate: filters.start, endDate: filters.end, action: filters.action,
        match: filters.match, search: filters.search, fdhStatus: filters.fdhStatus || '', page: String(nextPage) });
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
  const exportFdhExcel = async (onlySelected = false) => {
    let listToExport = onlySelected && chosen.length > 0 ? chosen : [];
    if (!listToExport.length) {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          startDate: loaded.start,
          endDate: loaded.end,
          action: loaded.action,
          match: loaded.match,
          search: loaded.search,
          exportAll: 'true',
          ...(isRep && loaded.fdhStatus ? { fdhStatus: loaded.fdhStatus } : {}),
        });
        const res = await fetch(`${endpoint}?${query}`);
        const json = await res.json();
        listToExport = json.success && Array.isArray(json.data) ? json.data : (result?.data || []);
      } catch {
        listToExport = result?.data || [];
      } finally {
        setLoading(false);
      }
    }

    if (!listToExport.length) {
      alert('ไม่มีรายการสำหรับส่งออก');
      return;
    }

    const opdRows = listToExport.filter(r => !r.an && r.vn);
    const ipdRows = listToExport.filter(r => Boolean(r.an));

    const formatRow = (r: StmZeroRow) => ({
      'ประเภท': r.an ? 'IPD' : 'OPD',
      'VN': r.vn || '',
      'AN': r.an || '',
      'HN': r.hn || '',
      'ชื่อ-สกุล': r.patient_name || '',
      'วันที่รับบริการ': r.service_date || '',
      'สิทธิ/กองทุน': r.maininscl || '',
      'ยอดเรียกเก็บ': r.amount ?? '',
      'ยอดชดเชยใน REP': r.paid_amount ?? 0,
      'รหัสเหตุผล': `${r.errorcode || ''} ${r.verifycode || ''}`.trim(),
      'ขั้นตอน': ZERO_ACTION_LABELS[r.action] || r.action,
      'สถานะส่ง FDH': r.fdh_sent_today ? 'ส่งวันนี้แล้ว' : (r.last_fdh_sent_at ? `เคยส่งเมื่อ ${r.last_fdh_sent_at.slice(0, 10)}` : 'ยังไม่เคยส่ง'),
      'วันที่ส่ง FDH ล่าสุด': r.last_fdh_sent_at || '',
      'TRAN_ID': r.tran_id || '',
      'ชื่อไฟล์ REP': r.source_filename || '',
      'ชีต': r.sheet_name || 'Data Sheet 0',
    });

    const sheets: Array<[string, Record<string, unknown>[]]> = [];
    if (opdRows.length) sheets.push(['OPD (ผู้ป่วยนอก)', opdRows.map(formatRow)]);
    if (ipdRows.length) sheets.push(['IPD (ผู้ป่วยใน)', ipdRows.map(formatRow)]);
    if (!sheets.length) sheets.push(['รวมทั้งหมด', listToExport.map(formatRow)]);

    writeWorkbook(`REP_DataSheet0_FDH_Target_${loaded.start}_${loaded.end}`, sheets);
  };

  const handleSelectAllPages = async () => {
    if (!result) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        startDate: loaded.start,
        endDate: loaded.end,
        action: loaded.action,
        match: loaded.match,
        search: loaded.search,
        exportAll: 'true',
        ...(isRep && loaded.fdhStatus ? { fdhStatus: loaded.fdhStatus } : {}),
      });
      const res = await fetch(`${endpoint}?${query}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const next: Record<string, StmZeroRow> = {};
        json.data.forEach((r: StmZeroRow) => { next[r.id] = r; });
        setSelected(next);
        setFixNotification({
          type: 'success',
          message: `เลือกครบทุกหน้าแล้วทั้งหมด ${json.data.length.toLocaleString('th-TH')} รายการ`,
        });
      }
    } catch {
      alert('เลือกทุกหน้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const handleExcelImportFilter = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const extractedVns = new Set<string>();
      const extractedAns = new Set<string>();
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        for (const row of jsonRows) {
          for (const [key, val] of Object.entries(row)) {
            const strVal = String(val ?? '').trim();
            const normKey = key.trim().toUpperCase();
            if (normKey === 'VN' || normKey === 'VISIT' || normKey === 'VISIT_NO') {
              if (strVal) extractedVns.add(strVal);
            } else if (normKey === 'AN' || normKey === 'ADMISSION' || normKey === 'ADMISSION_NO') {
              if (strVal) extractedAns.add(strVal);
            } else {
              if (/^\d{12}$/.test(strVal)) extractedVns.add(strVal);
              else if (/^\d{9}$/.test(strVal)) extractedAns.add(strVal);
            }
          }
        }
      }
      if (extractedVns.size === 0 && extractedAns.size === 0) {
        alert('ไม่พบคอลัมน์ VN หรือ AN ในไฟล์ Excel ที่เลือก');
        return;
      }
      if (result) {
        const nextSelected = { ...selected };
        let matchedCount = 0;
        for (const row of result.data) {
          if ((row.vn && extractedVns.has(row.vn)) || (row.an && extractedAns.has(row.an))) {
            nextSelected[row.id] = row;
            matchedCount++;
          }
        }
        setSelected(nextSelected);
        setFixNotification({
          type: 'success',
          message: `นำเข้าไฟล์ Excel สำเร็จ: พบ ${extractedVns.size} VN และ ${extractedAns.size} AN (ตรงกับรายการในหน้านี้ ${matchedCount} แถว และเลือกให้เรียบร้อยแล้ว)`
        });
      }
    } catch (err) {
      alert(`อ่านไฟล์ Excel ไม่สำเร็จ: ${err instanceof Error ? err.message : 'รูปแบบไฟล์ไม่ถูกต้อง'}`);
    } finally {
      e.target.value = '';
    }
  };

  const exportQueue = () => writeWorkbook(`STM0_เตรียมแก้ไข_${loaded.start}_${loaded.end}`, [['รายการตรวจส่งใหม่', chosen.map(r => ({
    รหัสแถว: r.id, Batch: r.batch_id, ไฟล์: r.source_filename, ชีต: r.sheet_name, แถวข้อมูลนำเข้า: r.row_no ?? '',
    HN: r.hn, VN: r.vn, AN: r.an, TRAN_ID: r.tran_id, วันที่บริการ: r.service_date,
    ยอดจ่าย: r.paid_amount, รหัสเหตุผล: `${r.errorcode} ${r.verifycode}`, ขั้นตอน: ZERO_ACTION_LABELS[r.action],
    ช่องทาง: channel === 'fdh' ? 'FDH (ผู้ใช้ยืนยันช่องทางเดิม)' : 'eClaim / OSR', บันทึกตรวจสอบ: note, เวลาข้อมูลAudit: result?.snapshot || '',
    ยืนยันตรวจข้อมูล: reviewed ? 'ตรวจแล้ว; ต้องยืนยันสิทธิแก้ไขกับระบบปลายทางอีกครั้ง' : 'ยังไม่ยืนยัน',
  }))]]);
  const handleSingleAutoFix = async (row: StmZeroRow) => {
    if (!row.vn && !row.an) return;
    const targetKey = row.vn || row.an;
    setFixingVn(targetKey);
    setFixNotification(null);
    try {
      const res = await fetch('/api/reconciliation/rep-sheet-zero/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vn: row.vn, an: row.an, fixType: 'ALL' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'แก้ไขอัตโนมัติไม่สำเร็จ');
      setFixNotification({
        type: 'success',
        message: `${row.vn ? `VN ${row.vn}` : `AN ${row.an}`}: ${json.data.message}`,
        details: json.data.actionsApplied,
      });
      if (detail && detail.id === row.id) {
        void openDetail(row);
      }
    } catch (err) {
      setFixNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแก้ไขอัตโนมัติ',
      });
    } finally {
      setFixingVn(null);
    }
  };

  const handleBatchAutoFix = async (fixAll = false) => {
    const eligible = chosen.filter(r => r.vn || r.an);
    if (!fixAll && !eligible.length) return;

    if (fixAll) {
      const confirmRun = window.confirm(
        `⚡ ยืนยันการดำเนินการแก้ไขอัตโนมัติ "ทุกรายการใน Data Sheet 0" (${result?.total?.toLocaleString('th-TH') || 0} รายการ)?\n\n` +
        `ระบบจะตรวจและแก้ไขรหัส Claim/Authen Code, ลบรหัสหัตถการตัวเลขตกค้างใน ovstdiag, ตรวจสร้าง dtmain สำหรับทันตกรรม, และเพิ่มรหัสวินิจฉัยยาสมุนไพรใน HOSxP ให้อัตโนมัติ`
      );
      if (!confirmRun) return;
    }

    setBatchFixing(true);
    setFixNotification(null);
    try {
      const payload = fixAll
        ? {
            all: true,
            startDate: loaded.start,
            endDate: loaded.end,
            action: loaded.action,
            match: loaded.match,
            search: loaded.search,
            fdhStatus: loaded.fdhStatus,
          }
        : {
            items: eligible.map(r => ({ vn: r.vn, an: r.an })),
          };

      const res = await fetch('/api/reconciliation/rep-sheet-zero/batch-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'แก้ไขอัตโนมัติแบบกลุ่มไม่สำเร็จ');
      const { fixedCount, total, results } = json.data;
      const allActions = results.flatMap((r: any) => r.actionsApplied || []);
      setFixNotification({
        type: 'success',
        message: `ดำเนินการแก้ไขอัตโนมัติสำเร็จ ${fixedCount} จาก ${total} รายการ`,
        details: allActions.slice(0, 15),
      });
      await load(page);
    } catch (err) {
      setFixNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแก้ไขอัตโนมัติแบบกลุ่ม',
      });
    } finally {
      setBatchFixing(false);
    }
  };

  const handoff = async (ipd: boolean) => {
    let rows = chosen.filter(r => ipd ? Boolean(r.an) : !r.an && r.vn);
    if (!rows.length || !reviewed || !note.trim()) return;

    if (isRep) {
      const alreadySent = rows.filter(r => r.last_fdh_sent_at);
      if (alreadySent.length > 0) {
        const proceedWithExclusion = window.confirm(
          `⚠️ มี ${alreadySent.length} จาก ${rows.length} รายการที่เคยส่งออก FDH ไปแล้ว (หากส่งซ้ำ FDH จะปฏิเสธ 409 Duplicate Visit)!\n\n` +
          `• กด [ตกลง (OK)] เพื่อ "ข้ามรายการที่เคยส่งแล้ว" และเปิดส่งเฉพาะ ${rows.length - alreadySent.length} รายการที่ยังไม่เคยส่ง\n` +
          `• กด [ยกเลิก (Cancel)] เพื่อยกเลิกและตรวจรายการใหม่อีกครั้ง`
        );
        if (!proceedWithExclusion) return;
        rows = rows.filter(r => !r.last_fdh_sent_at);
        if (!rows.length) {
          setError('ทุกรายการที่เลือกเคยส่งออก FDH แล้ว ระบบป้องกันการส่งซ้ำ');
          return;
        }
      }
    }

    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ startDate: loaded.start, endDate: loaded.end, checkIds: rows.map(r => r.id).join(',') });
      const response = await fetch(`${endpoint}?${query}`);
      const payload = await response.json();
      const refreshed: StmZeroRow[] = payload.data || [];
      const matchFn = isRep
        ? (r: StmZeroRow, current: StmZeroRow) => current.id === r.id && current.vn === r.vn && current.an === r.an && current.hn === r.hn
        : (r: StmZeroRow, current: StmZeroRow) => current.id === r.id && current.vn === r.vn && current.an === r.an && current.hn === r.hn && current.service_date === r.service_date;
      if (!response.ok || !payload.success || rows.some(r => !refreshed.some(current => matchFn(r, current)))) {
        setError('ข้อมูลเปลี่ยนหรือยังยืนยันส่งใหม่ไม่ได้ กรุณาโหลด audit และตรวจรายการอีกครั้ง'); setReviewed(false); return;
      }
    const dates = rows.map(r => r.service_date.slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (dates.length !== rows.length) { setError('บางรายการไม่มีวันที่บริการ กรุณาตรวจต้นทางก่อนส่งต่อ'); return; }
    navigateFromDashboard(ipd ? 'ipdExport' : 'fdh', { contextLabel: `${title}: ${note.trim()} — ตรวจสิทธิแก้ไขและยืนยันส่งซ้ำก่อนส่งจริง`,
      startDate: dates[0], endDate: dates[dates.length - 1],
      ...(ipd ? { ipdExport: { targetAns: [...new Set(rows.map(r => r.an))] } } : { fdh: { statusFilter: 'all', targetVns: [...new Set(rows.map(r => r.vn))] } }),
    });
    } catch { setError('ตรวจสถานะล่าสุดไม่สำเร็จ กรุณาลองใหม่ก่อนเปิดส่งออก'); }
    finally { setLoading(false); }
  };
  return <section className="stm-zero-audit" aria-label={`ตรวจ ${title}`}>
    <header className={`zero-hero ${isRep ? 'zero-hero-rep' : ''}`}><div className="zero-hero-title"><span className="zero-eyebrow">{isRep ? 'ผลตอบกลับ REP · ตรวจเหตุผลและแก้ไขส่งซ้ำ' : 'ติดตามผลชดเชย · ตรวจสอบหลักฐาน'}</span><h1>ตรวจ {title}</h1><p>{isRep ? 'ดูแถบ Data Sheet 0 ใน REP แก้ไขอัตโนมัติใน HOSxP และเตรียมส่งเบิกซ้ำเข้า FDH / e-Claim' : 'ค้นรายการจ่าย 0 บาท เทียบข้อมูลต้นทาง และติดตามการแก้ไขในที่เดียว'}</p></div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {isRep && (
          <>
            <button
              type="button"
              className="rec-btn rec-btn-secondary"
              disabled={!result || loading || !(result?.data?.length)}
              onClick={() => exportFdhExcel(false)}
              title="ส่งออกรายการ Data Sheet 0 เป็นไฟล์ Excel สำหรับนำไปส่งต่อ FDH หรือเก็บรายงาน"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              📥 ส่งออก Excel สำหรับส่ง FDH
            </button>
            <button
              type="button"
              className="rec-btn rec-btn-primary"
              disabled={!result || loading || batchFixing || !(result?.data?.length)}
              onClick={() => void handleBatchAutoFix(true)}
              title="สั่งตรวจและแก้ไขข้อมูลอัตโนมัติใน HOSxP ทุกรายการใน Data Sheet 0 ตามตัวกรองปัจจุบัน"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#0284c7', borderColor: '#0284c7' }}
            >
              {batchFixing ? '⏳ กำลังแก้ไข Auto...' : `⚡ แก้ไข Auto ทุกรายการ (${result?.total?.toLocaleString('th-TH') || 0})`}
            </button>
          </>
        )}
        <button className="zero-report-button" disabled={!result || loading} onClick={exportExecutive}>↗ ดาวน์โหลดสรุปผู้บริหาร</button>
      </div></header>
    <ol className="zero-workflow"><li><b>1</b><span>ค้นรายการ<span>ตามวันที่นำเข้าไฟล์</span></span></li><li><b>2</b><span>ตรวจหลักฐาน<span>เทียบแถว {isRep ? 'REP' : 'STM'} กับ HIS</span></span></li><li><b>3</b><span>{isRep ? 'แก้ไข & ส่งซ้ำ' : 'เตรียมแก้ไข'}<span>{isRep ? 'ปุ่ม Auto-Fix และส่งเบิกซ้ำ' : 'ยืนยันสิทธิส่งใหม่ก่อนส่ง'}</span></span></li></ol>
    <div className="zero-notice"><strong>{isRep ? 'Data Sheet 0 จาก REP' : 'ตรวจเหตุผลก่อนส่งซ้ำ'}</strong><span>{isRep ? 'แสดงทุกแถวของชีตนี้ พร้อมปุ่ม ⚡ แก้ไข Auto ในแต่ละรายการ และสามารถเลือกแถวส่งเบิกซ้ำเข้า FDH หรือ e-Claim ได้ทันที' : 'บางรายการต้องรอรอบจ่าย อนุมัติ SMCS หรือเปิดแก้ไขผ่าน OSR ยอดว่างจะแยกจากยอด 0 เสมอ'}</span></div>
    {isRep && (
      <div className="zero-actions">
        <button onClick={() => navigateFromDashboard('repstm', {})}>นำเข้าไฟล์ REP</button>
        <button onClick={() => navigateFromDashboard('stmZeroAudit', {})}>เปิดหน้าตรวจ STM 0</button>
        <label
          className="rec-btn rec-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0, padding: '7px 14px', fontSize: '13px' }}
          title="เลือกไฟล์ Excel ที่มีคอลัมน์ VN หรือ AN เพื่อเลือกแถวในหน้านี้โดยอัตโนมัติ"
        >
          📂 นำเข้า Excel เพื่อเลือกแถว
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => void handleExcelImportFilter(e)}
          />
        </label>
      </div>
    )}
    {catalogError && <p role="alert" className="zero-error">{catalogError}</p>}
    <section className="zero-filter-card" aria-label={`ตัวกรอง ${title}`}><div className="zero-section-heading"><h2>ค้นหารายการที่ต้องตรวจ</h2><span>ใช้วันที่นำเข้าไฟล์ ไม่ใช่วันที่บริการ</span></div><div className="zero-filters">
      <label>นำเข้าตั้งแต่<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>นำเข้าถึง<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      <label>ขั้นตอนติดตาม<select value={action} onChange={e => setAction(e.target.value)}><option value="">ทุกขั้นตอน</option>{Object.entries(ZERO_ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>การจับคู่<select value={match} onChange={e => setMatch(e.target.value)}><option value="">ทั้งหมด</option><option value="matched">จับคู่ HIS แล้ว</option><option value="unmatched">ยังจับคู่ไม่ได้</option></select></label>
      <label>ค้น HN / VN / AN / รหัส / ไฟล์<input value={search} onChange={e => setSearch(e.target.value)} /></label>
      {isRep && (
        <label>
          สถานะส่ง FDH
          <select value={fdhStatus} onChange={e => { setFdhStatus(e.target.value); void load(1, { fdhStatus: e.target.value }); }}>
            <option value="unsent">🟢 ยังไม่เคยส่ง FDH (แนะนำ)</option>
            <option value="sent_previously">✔ เคยส่ง FDH แล้ว (ทุกรอบ)</option>
            <option value="sent_today">🔵 ส่ง FDH แล้ววันนี้</option>
            <option value="all">ทั้งหมด (รวมที่เคยส่งแล้ว)</option>
          </select>
        </label>
      )}
      <button className="rec-btn rec-btn-primary" disabled={loading} onClick={() => void load()}>{loading ? 'กำลังตรวจ...' : `ค้นหา ${isRep ? 'Data Sheet 0' : 'STM 0'}`}</button>
    </div></section>
    {error && <p role="alert" className="zero-error">{error}</p>}
    {fixNotification && (
      <div className={`zero-toast-alert ${fixNotification.type}`}>
        <strong>{fixNotification.type === 'success' ? '✅' : '❌'} {fixNotification.message}</strong>
        {fixNotification.details && fixNotification.details.length > 0 && (
          <ul>
            {fixNotification.details.map((d, idx) => <li key={idx}>{d}</li>)}
          </ul>
        )}
      </div>
    )}
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
      {isRep && result.summary.fdh && (
        <div className="zero-fdh-status-tabs" aria-label="กรองสถานะการส่ง FDH">
          <button
            type="button"
            className={`zero-fdh-tab-btn ${loaded.fdhStatus === 'unsent' ? 'active' : ''}`}
            onClick={() => { setFdhStatus('unsent'); void load(1, { fdhStatus: 'unsent' }); }}
          >
            <span>🟢 ยังไม่เคยส่ง FDH (แนะนำ)</span>
            <span className="zero-fdh-tab-badge">{result.summary.fdh.unsent.toLocaleString('th-TH')}</span>
          </button>
          <button
            type="button"
            className={`zero-fdh-tab-btn ${loaded.fdhStatus === 'sent_previously' ? 'active' : ''}`}
            onClick={() => { setFdhStatus('sent_previously'); void load(1, { fdhStatus: 'sent_previously' }); }}
          >
            <span>✔ เคยส่ง FDH แล้ว</span>
            <span className="zero-fdh-tab-badge">{result.summary.fdh.sentAny.toLocaleString('th-TH')}</span>
          </button>
          <button
            type="button"
            className={`zero-fdh-tab-btn ${loaded.fdhStatus === 'sent_today' ? 'active' : ''}`}
            onClick={() => { setFdhStatus('sent_today'); void load(1, { fdhStatus: 'sent_today' }); }}
          >
            <span>🔵 ส่ง FDH แล้ววันนี้</span>
            <span className="zero-fdh-tab-badge">{result.summary.fdh.sentToday.toLocaleString('th-TH')}</span>
          </button>
          <button
            type="button"
            className={`zero-fdh-tab-btn ${loaded.fdhStatus === 'all' || !loaded.fdhStatus ? 'active' : ''}`}
            onClick={() => { setFdhStatus('all'); void load(1, { fdhStatus: 'all' }); }}
          >
            <span>ทั้งหมด</span>
            <span className="zero-fdh-tab-badge">{result.summary.fdh.total.toLocaleString('th-TH')}</span>
          </button>
        </div>
      )}
      <p className="zero-caption">{isRep ? 'นับแถว REP ไม่ใช่จำนวน Visit; รายการที่จับคู่ HIS แล้วสามารถกดปุ่ม ⚡ แก้ไข Auto หรือเลือกแถวเพื่อส่งเบิกซ้ำได้' : 'นับแถว ไม่ใช่จำนวน Visit; แถว 0 อาจเป็นเพียงบางรายการใน Visit ที่ได้รับเงินแล้ว จึงไม่รวมยอดเงินเป็นความเสียหาย'}</p>
      {result && (() => {
        const displayedData = result.data;
        return (
          <>
            <div className="zero-section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2>รายการตรวจสอบ <span className="zero-count">{result.total.toLocaleString('th-TH')} แถว</span></h2>
                <span>{isRep ? 'เลือกแถวเพื่อกดแก้ไขอัตโนมัติ ส่งออก Excel หรือเตรียมส่งเบิกซ้ำเข้า FDH' : 'เลือกแถวเพื่อเตรียมตรวจส่งใหม่'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="rec-btn rec-btn-secondary"
                  style={{ fontSize: '12px', padding: '5px 12px' }}
                  onClick={() => {
                    const next = { ...selected };
                    displayedData.forEach(r => { next[r.id] = r; });
                    setSelected(next);
                  }}
                >
                  ☑ เลือกทั้งหมดในหน้านี้ ({displayedData.length})
                </button>
                {result.total > displayedData.length && (
                  <button
                    type="button"
                    className="rec-btn rec-btn-secondary"
                    style={{ fontSize: '12px', padding: '5px 12px' }}
                    onClick={() => void handleSelectAllPages()}
                    title="เลือกทุกรายการที่ตรงกับตัวกรองปัจจุบัน (ทุกหน้า)"
                  >
                    ☑ เลือกทั้งหมดทุกหน้า ({result.total.toLocaleString('th-TH')})
                  </button>
                )}
                {isRep && result && result.total > 0 && (
                  <button
                    type="button"
                    className="rec-btn rec-btn-primary"
                    style={{ fontSize: '12px', padding: '5px 12px', background: '#0284c7', borderColor: '#0284c7' }}
                    disabled={batchFixing}
                    onClick={() => void handleBatchAutoFix(true)}
                    title="สั่งตรวจและแก้ไขข้อมูลอัตโนมัติใน HOSxP ทุกรายการใน Data Sheet 0 ตามตัวกรองปัจจุบัน"
                  >
                    {batchFixing ? '⏳ กำลังแก้ไข Auto...' : `⚡ แก้ไข Auto ทุกรายการ (${result.total.toLocaleString('th-TH')})`}
                  </button>
                )}
                {chosen.length > 0 && (
                  <button
                    type="button"
                    className="rec-btn rec-btn-secondary"
                    style={{ fontSize: '12px', padding: '5px 12px', color: '#dc2626' }}
                    onClick={() => setSelected({})}
                  >
                    ☒ ล้างการเลือก ({chosen.length})
                  </button>
                )}
              </div>
            </div>
            {isRep && (loaded.fdhStatus === 'all' || loaded.fdhStatus === 'sent_previously') && result.summary.fdh && result.summary.fdh.sentAny > 0 && (
              <div className="zero-duplicate-warning-banner">
                <div>
                  <strong>⚠️ กำลังแสดงรายการที่เคยส่งออก FDH แล้ว ({result.summary.fdh.sentAny.toLocaleString('th-TH')} รายการ)</strong>
                  <span style={{ display: 'block', fontSize: '12px', marginTop: 2 }}>
                    เพื่อป้องกันข้อผิดพลาด 409 Duplicate Visit แนะนำให้สลับไปที่แถบ "ยังไม่เคยส่ง FDH" สำหรับการส่งซ้ำ
                  </span>
                </div>
                <button
                  type="button"
                  className="rec-btn rec-btn-primary"
                  onClick={() => { setFdhStatus('unsent'); void load(1, { fdhStatus: 'unsent' }); }}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  🟢 สลับไปดูเฉพาะที่ยังไม่เคยส่ง ({result.summary.fdh.unsent.toLocaleString('th-TH')})
                </button>
              </div>
            )}
            <div className="zero-table-scroll" tabIndex={0} aria-label={`ตารางรายการ ${title} เลื่อนแนวนอนเพื่อดูหลักฐาน`}><table><thead><tr><th>
              <input
                type="checkbox"
                title="เลือก/ยกเลิกทั้งหมดในหน้านี้"
                aria-label="เลือกแถวทั้งหมดในหน้านี้"
                checked={Boolean(displayedData.length && displayedData.every(r => Boolean(selected[r.id])))}
                onChange={e => {
                  setReviewed(false);
                  if (e.target.checked) {
                    const next = { ...selected };
                    displayedData.forEach(r => { next[r.id] = r; });
                    setSelected(next);
                  } else {
                    const currentIds = new Set(displayedData.map(r => r.id));
                    const next = { ...selected };
                    Object.keys(next).forEach(k => { if (currentIds.has(k)) delete next[k]; });
                    setSelected(next);
                  }
                }}
              />
            </th><th>Visit / วันที่</th><th>ต้นทาง</th><th>{isRep ? 'ยอดชดเชยใน REP' : 'ยอดจ่าย'}</th><th>เหตุผล / ขั้นตอน</th><th>จับคู่</th><th>การดำเนินการ / สถานะ FDH</th></tr></thead><tbody>
              {displayedData.map(r => <tr key={r.id}><td><input aria-label={`เลือก ${r.id}`} type="checkbox" checked={Boolean(selected[r.id])} onChange={e => { setReviewed(false); setSelected(prev => { const next = { ...prev }; if (e.target.checked) next[r.id] = r; else delete next[r.id]; return next; }); }} /></td>
                <td><b>{r.an ? `IPD · AN ${r.an}` : r.vn ? `OPD · VN ${r.vn}` : `${r.encounter_type === 'OP' ? 'OPD' : r.encounter_type === 'IP' ? 'IPD' : 'ไม่ทราบประเภท'} · รอจับคู่ HIS`}</b>{r.tran_id && <small>TRAN_ID {r.tran_id}</small>}<small>HN {r.hn || 'ไม่พบ'} · {r.service_date || 'ไม่ระบุวันที่'}</small></td>
                <td className="zero-file">{r.source_filename}<small>{r.sheet_name || 'STM'} · {r.statement_no || r.tran_id || r.id}</small></td>
                <td className="zero-paid">{money(r.paid_amount)}</td><td>{isRep ? reasons(r) : <b>{r.errorcode} {r.verifycode}</b>}<small className="zero-action-badge" data-action={r.action}>{ZERO_ACTION_LABELS[r.action]}</small></td>
                <td><span className={`zero-match-badge ${r.matched ? 'matched' : ''}`}>{r.matched ? '✓ จับคู่ HIS แล้ว' : 'รอจับคู่'}</span>{r.payment_uncertain && <small>Visit มียอดจ่ายไม่ทราบค่า</small>}</td>
                <td>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="zero-detail-button" onClick={() => void openDetail(r)}>ดูต้นทาง / HIS ↗</button>
                    {isRep && r.matched && Boolean(r.vn) && (
                      <button
                        type="button"
                        className="zero-autofix-button"
                        disabled={fixingVn === r.vn}
                        onClick={() => void handleSingleAutoFix(r)}
                        title="ตรวจและแก้ไขข้อมูลอัตโนมัติใน HOSxP (Authen, ทันตกรรม, ตารางโรค)"
                      >
                        {fixingVn === r.vn ? '⏳ กำลังแก้...' : '⚡ แก้ไข Auto'}
                      </button>
                    )}
                    {isRep && (
                      r.fdh_sent_today ? (
                        <span className="zero-fdh-badge sent-today" title={`ส่งออก FDH แล้วเมื่อ ${r.last_fdh_sent_at || 'วันนี้'} (${r.fdh_status_message || 'รอผล'})`}>
                          ⚠️ ส่ง FDH แล้ววันนี้ {r.last_fdh_sent_at ? `(${r.last_fdh_sent_at.slice(11, 16)} น.)` : ''}
                        </span>
                      ) : (
                        r.last_fdh_sent_at ? (
                          <span className="zero-fdh-badge previously-sent" title={`ประวัติส่ง FDH ล่าสุดเมื่อ ${r.last_fdh_sent_at} (${r.fdh_status_message || ''})`}>
                            ✔ เคยส่งเมื่อ {r.last_fdh_sent_at.slice(0, 10)}
                          </span>
                        ) : (
                          <span className="zero-fdh-badge unsent" title="ยังไม่เคยมีประวัติส่งออก FDH มาก่อน">
                            🟢 ยังไม่เคยส่ง
                          </span>
                        )
                      )
                    )}
                  </div>
                </td></tr>)}
              {!displayedData.length && <tr><td colSpan={7}>ไม่พบรายการตามเงื่อนไข ({loaded.fdhStatus === 'unsent' ? 'ไม่มีรายการค้างส่ง' : 'ตรวจตัวกรองอีกครั้ง'})</td></tr>}
            </tbody></table></div>
          </>
        );
      })()}
      <div className="zero-pagination"><button disabled={loading || page <= 1} onClick={() => void load(page - 1)}>ก่อนหน้า</button><span>หน้า {page} / {Math.max(1, Math.ceil(result.total / 50))} · {result.total} แถว</span><button disabled={loading || page * 50 >= result.total} onClick={() => void load(page + 1)}>ถัดไป</button></div>
      {chosen.length > 0 ? <section className="zero-prepare"><h3>เตรียมรายการแก้ไข / ส่งใหม่ ({title}: {chosen.length} แถวในหน้านี้)</h3>
        <p>{isRep ? 'รายการที่เลือกสามารถกดแก้ไขอัตโนมัติใน HOSxP หรือส่งต่อเข้าสู่หน้าส่งออก FDH (OPD / IPD) และดาวน์โหลดเพื่อนำไปส่ง e-Claim/OSR ได้' : 'รายการรออนุมัติ รอรอบจ่าย ยังจับคู่ไม่ได้ หรือพบยอดจ่ายแล้วจะเลือกไม่ได้ ตรวจแถว 0 ที่ไม่ทราบเหตุผลให้ครบก่อนเลือก'}</p>
        {isRep && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="zero-btn-autofix-batch"
                disabled={batchFixing || !chosen.some(r => r.vn || r.an)}
                onClick={() => void handleBatchAutoFix(false)}
              >
                {batchFixing ? '⏳ กำลังดำเนินการแก้ไขอัตโนมัติ...' : `⚡ แก้ไขอัตโนมัติเฉพาะที่เลือก (${chosen.filter(r => r.vn || r.an).length} รายการ)`}
              </button>
              {result && result.total > 0 && (
                <button
                  type="button"
                  className="zero-btn-autofix-batch"
                  style={{ background: '#0284c7' }}
                  disabled={batchFixing}
                  onClick={() => void handleBatchAutoFix(true)}
                >
                  {batchFixing ? '⏳ กำลังดำเนินการ...' : `⚡ แก้ไข Auto ทุกรายการใน Data Sheet 0 (${result.total.toLocaleString('th-TH')} รายการ)`}
                </button>
              )}
            </div>
            <small style={{ display: 'block', marginTop: 6, color: '#4b6584' }}>
              ระบบจะตรวจและแก้ไขรหัส Claim/Authen Code, ลบรหัสหัตถการตัวเลขตกค้างใน ovstdiag, และสร้าง dtmain ให้ใน HOSxP
            </small>
          </div>
        )}
        <label>ช่องทางส่งต่อ<select value={channel} onChange={e => { setChannel(e.target.value); setReviewed(false); }}><option value="fdh">FDH — ส่งออกเบิกซ้ำเข้า FDH (OPD / IPD)</option><option value="eclaim">eClaim / OSR — ดาวน์โหลดรายการไปดำเนินการ</option></select></label>
        <label>ผลการตรวจ / สิ่งที่แก้ไข<textarea value={note} onChange={e => { setNote(e.target.value); setReviewed(false); }} placeholder="ระบุเหตุผล หลักฐานที่ตรวจ และสิ่งที่แก้ไขในระบบ" /></label>
        <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> ตรวจข้อมูลต้นทาง แก้ไขในระบบงาน และยืนยันสิทธิแก้ไขส่งใหม่ตามกองทุนแล้ว</label>
        <div className="zero-actions">
          <button disabled={!chosen.length || !reviewed || !note.trim()} onClick={exportQueue}>📥 ดาวน์โหลดรายการที่ตรวจแล้ว (Excel)</button>
          {isRep && (
            <button
              type="button"
              className="rec-btn rec-btn-secondary"
              disabled={!chosen.length}
              onClick={() => exportFdhExcel(true)}
              title="ส่งออกเฉพาะรายการที่เลือกเป็น Excel สำหรับนำไปส่งต่อ FDH หรือ OSR"
            >
              📥 ส่งออก Excel (${chosen.length} รายการที่เลือก)
            </button>
          )}
          {channel === 'fdh' && <><button disabled={loading || !reviewed || !note.trim() || !chosen.some(r => !r.an && r.vn)} onClick={() => void handoff(false)}>🚀 เปิดส่งออก OPD เฉพาะที่เลือก ({chosen.filter(r => !r.an && r.vn).length})</button><button disabled={loading || !reviewed || !note.trim() || !chosen.some(r => r.an)} onClick={() => void handoff(true)}>🚀 เปิดส่งออก IPD เฉพาะที่เลือก ({chosen.filter(r => r.an).length})</button></>}
        </div><small>การเปิดส่งออกยังต้องผ่านการตรวจความพร้อมและยืนยันส่งซ้ำ ระบบนี้ไม่ได้ส่งเคลมโดยอัตโนมัติ การเปลี่ยนหน้า/โหลดใหม่ล้างรายการที่เลือกและการยืนยัน</small>
      </section> : (
        <div className="zero-selection-hint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span>เลือกแถวในตารางเพื่อเตรียมรายการแก้ไข / ส่งใหม่ หรือกดปุ่มสั่งแก้ไข Auto ทุกรายการใน Data Sheet 0</span>
          {isRep && result && result.total > 0 && (
            <button
              type="button"
              className="zero-btn-autofix-batch"
              style={{ margin: 0, padding: '8px 16px', background: '#0284c7' }}
              disabled={batchFixing}
              onClick={() => void handleBatchAutoFix(true)}
            >
              {batchFixing ? '⏳ กำลังดำเนินการ...' : `⚡ แก้ไข Auto ทุกรายการใน Data Sheet 0 (${result.total.toLocaleString('th-TH')} รายการ)`}
            </button>
          )}
        </div>
      )}
    </>}
    {!isRep && <details className="zero-guide"><summary>อ่านเพิ่มเติม: Sheet 0 และแนวทางตรวจ</summary><p>เอกสารชี้แจง สปสช. แสดง Sheet 0 เป็นรายการจ่าย 0 พร้อมเหตุผล กองทุน HERB_GB อาจอยู่ระหว่างรอประมวลผล ส่วน W305 ต้องตรวจการอนุมัติ และ D011 ต้องตรวจการเปิดแก้ไขใน eClaim/OSR คำแนะนำนี้ไม่ใช่การรับรองสิทธิส่งใหม่หรือกำหนดเวลาทักท้วงปัจจุบัน</p>
      <a href="https://www.kpnhospital.com/wp-content/uploads/2025/09/ระบบโปรแกรม_e-Claim_ยาสมุนไพร_HERBFS_25680523.pdf" target="_blank" rel="noreferrer">เอกสารชี้แจง eClaim ยาสมุนไพร (เผยแพร่ผ่านโรงพยาบาล)</a><br />
      <a href="https://fliphtml5.com/cxuqh/kzfq/9_Provider_Center_Claim_30_ตค_68/" target="_blank" rel="noreferrer">เอกสารชี้แจง Provider Center Claim (สำเนาเผยแพร่)</a>
    </details>}
    {detail && <div className="zero-modal-backdrop"><section role="dialog" aria-modal="true" aria-label={`หลักฐาน ${isRep ? 'REP' : 'STM'} และข้อมูล HIS`} className="zero-modal"><button className="zero-close" onClick={() => setDetail(null)}>ปิด</button>
      <h2>หลักฐาน {detail.id}</h2><p>{detail.source_filename} · {detail.sheet_name} · Batch {detail.batch_id}{detail.row_no != null ? ` · แถวข้อมูลนำเข้า ${detail.row_no}` : ''}</p>
      <p>{detail.reason} · {ZERO_ACTION_LABELS[detail.action]}</p>
      {isRep && detail.matched && Boolean(detail.vn) && (
        <div style={{ margin: '14px 0', padding: '12px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ color: '#0369a1' }}>⚡ ฟังก์ชันแก้ไขอัตโนมัติใน HOSxP</strong>
            <small style={{ display: 'block', color: '#475569' }}>ระบบจะผูกรหัส Claim/Authen Code, ลบรหัสหัตถการตัวเลขตกค้างในตารางโรค หรือสร้าง dtmain ให้</small>
          </div>
          <button
            type="button"
            className="zero-btn-autofix-batch"
            disabled={fixingVn === detail.vn}
            onClick={() => void handleSingleAutoFix(detail)}
          >
            {fixingVn === detail.vn ? '⏳ กำลังแก้ไข...' : '⚡ ดำเนินการแก้ไข Auto'}
          </button>
        </div>
      )}
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
