import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchAppSettings,
  fetchReceivableBatches,
  fetchReceivableCandidates,
  fetchReceivableFilterOptions,
  saveReceivableBatch,
  type ReceivableCandidate,
  type ReceivableFilterOptions,
} from '../services/hosxpService';

type Signer = {
  name?: string;
  position?: string;
};

type ReceivableSettings = {
  hospital_name?: string;
  hospital_code?: string;
  receivable_signers?: {
    director?: Signer;
    insurance_head?: Signer;
    finance?: Signer;
  };
};

type ReceivableBatch = {
  id: number;
  batch_no?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  item_count?: number | string | null;
  total_receivable?: number | string | null;
  created_at?: string | null;
};

const todayIso = () => {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
};

const toNumber = (value: unknown) => {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const formatMoney = (value: unknown) => toNumber(value).toLocaleString('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  return String(value).slice(0, 10);
};

const formatReceiptAmount = (value: unknown) => {
  if (value == null || value === '') return '-';
  return formatMoney(value);
};

const rowKey = (row: ReceivableCandidate, index: number) => (
  `${row.patient_type || 'NA'}:${row.vn || row.an || row.hn || index}:${index}`
);

const optionLabel = (code?: string | null, name?: string | null) => {
  const safeCode = String(code || '').trim();
  const safeName = String(name || '').trim();
  if (safeCode && safeName) return `${safeCode}: ${safeName}`;
  return safeName || safeCode || '-';
};

const candidateIssues = (row: ReceivableCandidate) => {
  const issues: string[] = [];
  if (toNumber(row.claimable_amount) <= 0) issues.push('ยอดตั้งลูกหนี้ต้องมากกว่า 0');
  if (!String(row.finance_right_code || '').trim()) issues.push('ไม่พบสิทธิการเงิน');
  if (!String(row.debtor_code || '').trim()) issues.push('ไม่พบรหัสลูกหนี้');
  if (!String(row.revenue_code || '').trim()) issues.push('ไม่พบรหัสรายรับ');
  return issues;
};

const isCandidateReady = (row: ReceivableCandidate) => candidateIssues(row).length === 0;

export const ReceivablePage = () => {
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [patientType, setPatientType] = useState('ALL');
  const [hosxpRight, setHosxpRight] = useState('ALL');
  const [financeRight, setFinanceRight] = useState('ALL');
  const [filterOptions, setFilterOptions] = useState<ReceivableFilterOptions>({ hosxpRights: [], financeRights: [] });
  const [rows, setRows] = useState<ReceivableCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [readiness, setReadiness] = useState<'ALL' | 'READY' | 'REVIEW'>('ALL');
  const [settings, setSettings] = useState<ReceivableSettings | null>(null);
  const [batches, setBatches] = useState<ReceivableBatch[]>([]);
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
  const [lastSavedSelection, setLastSavedSelection] = useState('');

  useEffect(() => {
    fetchAppSettings<ReceivableSettings>()
      .then((result) => setSettings(result.data || null))
      .catch(() => setSettings(null));
    fetchReceivableBatches(10)
      .then(setBatches)
      .catch(() => setBatches([]));
    fetchReceivableFilterOptions()
      .then(setFilterOptions)
      .catch(() => setFilterOptions({ hosxpRights: [], financeRights: [] }));
  }, []);

  const selectedRows = useMemo(
    () => rows.filter((row, index) => selected[rowKey(row, index)]),
    [rows, selected],
  );

  const querySignature = useMemo(
    () => [startDate, endDate, patientType, hosxpRight, financeRight].join('|'),
    [startDate, endDate, patientType, hosxpRight, financeRight],
  );

  const isStale = loadedSignature !== null && loadedSignature !== querySignature;

  const readyRows = useMemo(() => rows.filter(isCandidateReady), [rows]);
  const reviewRows = useMemo(() => rows.filter((row) => !isCandidateReady(row)), [rows]);

  const visibleRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('th-TH');
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const ready = isCandidateReady(row);
        if (readiness === 'READY' && !ready) return false;
        if (readiness === 'REVIEW' && ready) return false;
        if (!keyword) return true;
        return [
          row.vn, row.an, row.hn, row.cid, row.patient_name,
          row.pttype, row.pttype_name, row.finance_right_code, row.finance_right_name,
          row.debtor_code, row.revenue_code, row.account_group,
        ].some((value) => String(value || '').toLocaleLowerCase('th-TH').includes(keyword));
      });
  }, [rows, search, readiness]);

  const selectedSignature = useMemo(
    () => selectedRows.map((row) => `${row.patient_type}:${row.vn || row.an || ''}`).sort().join('|'),
    [selectedRows],
  );

  const totalClaimable = useMemo(
    () => selectedRows.reduce((sum, row) => sum + toNumber(row.claimable_amount), 0),
    [selectedRows],
  );

  const debtorCodeCount = useMemo(
    () => new Set(selectedRows.map((row) => String(row.debtor_code || '').trim()).filter(Boolean)).size,
    [selectedRows],
  );

  const revenueCodeCount = useMemo(
    () => new Set(selectedRows.map((row) => String(row.revenue_code || '').trim()).filter(Boolean)).size,
    [selectedRows],
  );

  const signers = {
    director: {
      name: settings?.receivable_signers?.director?.name || '',
      position: settings?.receivable_signers?.director?.position || 'ผู้อำนวยการโรงพยาบาล',
    },
    insurance: {
      name: settings?.receivable_signers?.insurance_head?.name || '',
      position: settings?.receivable_signers?.insurance_head?.position || 'หัวหน้างานประกันสุขภาพ',
    },
    finance: {
      name: settings?.receivable_signers?.finance?.name || '',
      position: settings?.receivable_signers?.finance?.position || 'เจ้าหน้าที่การเงิน',
    },
  };

  const selectedHosxpRightLabel = hosxpRight === 'ALL'
    ? 'ทั้งหมด'
    : optionLabel(hosxpRight, filterOptions.hosxpRights.find((item) => item.code === hosxpRight)?.name);

  const selectedFinanceRightLabel = financeRight === 'ALL'
    ? 'ทั้งหมด'
    : optionLabel(financeRight, filterOptions.financeRights.find((item) => item.code === financeRight)?.name);

  const loadData = async () => {
    if (!startDate || !endDate) {
      setError('กรุณาระบุวันที่เริ่มและวันที่สิ้นสุด');
      return;
    }
    if (startDate > endDate) {
      setError('วันที่เริ่มต้องไม่มากกว่าวันที่สิ้นสุด');
      return;
    }
    try {
      setLoading(true);
      setError('');
      setMessage('');
      const data = await fetchReceivableCandidates({ startDate, endDate, patientType, hosxpRight, financeRight });
      setRows(data);
      setSelected(Object.fromEntries(data.map((row, index) => [rowKey(row, index), isCandidateReady(row)])));
      setLoadedSignature(querySignature);
      setLastSavedSelection('');
      const issueCount = data.filter((row) => !isCandidateReady(row)).length;
      setMessage(issueCount > 0
        ? `โหลด ${data.length.toLocaleString('th-TH')} รายการ เลือกเฉพาะรายการพร้อมตั้งลูกหนี้ และพักตรวจสอบ ${issueCount.toLocaleString('th-TH')} รายการ`
        : `โหลดข้อมูล ${data.length.toLocaleString('th-TH')} รายการ พร้อมตั้งลูกหนี้ทั้งหมด`);
    } catch (err) {
      setRows([]);
      setSelected({});
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลบัญชีลูกหนี้ได้');
    } finally {
      setLoading(false);
    }
  };

  const toggleVisible = (checked: boolean) => {
    setSelected((previous) => {
      const next = { ...previous };
      visibleRows.forEach(({ row, index }) => {
        if (isCandidateReady(row)) next[rowKey(row, index)] = checked;
      });
      return next;
    });
    setLastSavedSelection('');
  };

  const exportExcel = () => {
    if (isStale) {
      setError('ตัวกรองมีการเปลี่ยนแปลง กรุณาดึงข้อมูลใหม่ก่อนส่งออก');
      return;
    }
    const exportRows = selectedRows.map((row, index) => ({
      ลำดับ: index + 1,
      ประเภท: row.patient_type,
      VN: row.vn || '',
      AN: row.an || '',
      HN: row.hn || '',
      CID: row.cid || '',
      ผู้ป่วย: row.patient_name || '',
      สิทธิ์_HOSxP: optionLabel(row.hosxp_right_code || row.pttype, row.hosxp_right_name || row.pttype_name),
      สิทธิการเงิน: optionLabel(row.finance_right_code, row.finance_right_name),
      รหัสลูกหนี้: row.debtor_code || '',
      รหัสรายรับ: row.revenue_code || '',
      กลุ่มบัญชี: row.account_group || '',
      แหล่งเงิน: row.payment_source || '',
      วิธีคิดอัตรา: row.pricing_method || '',
      เลขที่ใบเสร็จ: row.receipt_no || '',
      ยอดใบเสร็จ: row.receipt_amount == null || row.receipt_amount === '' ? '' : toNumber(row.receipt_amount),
      วันที่ใบเสร็จ: formatDate(row.receipt_date),
      ประเภทการชำระ: optionLabel(row.payment_type_code, row.payment_type_name),
      วันที่บริการ: formatDate(row.service_date),
      รายการที่ตั้งลูกหนี้: row.claim_summary || '',
      ยอดตั้งลูกหนี้: toNumber(row.claimable_amount),
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Receivable');
    XLSX.writeFile(workbook, `receivable_${startDate}_${endDate}.xlsx`);
  };

  const saveBatch = async () => {
    if (isStale) {
      setError('ตัวกรองมีการเปลี่ยนแปลง กรุณาดึงข้อมูลใหม่ก่อนบันทึก');
      return;
    }
    if (selectedRows.length === 0) {
      setError('กรุณาเลือกรายการก่อนบันทึกชุดบัญชีลูกหนี้');
      return;
    }
    if (selectedRows.some((row) => !isCandidateReady(row))) {
      setError('มีรายการที่รหัสบัญชีหรือยอดเงินไม่พร้อม กรุณาตรวจสอบก่อนบันทึก');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const result = await saveReceivableBatch({
        startDate,
        endDate,
        patientType,
        hosxpRight,
        financeRight,
        notes,
        items: selectedRows,
      });
      setMessage(`บันทึกชุดบัญชีลูกหนี้สำเร็จ เลขที่ชุด ${result.batchNo || result.batchId || '-'}`);
      setLastSavedSelection(selectedSignature);
      const latest = await fetchReceivableBatches(10);
      setBatches(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกชุดบัญชีลูกหนี้ได้');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="receivable-page">
      <section className="receivable-hero">
        <div>
          <div className="eyebrow">Accounts Receivable</div>
          <h1>💼 บัญชีลูกหนี้สิทธิ์</h1>
          <p>
            คำนวณค่าใช้จ่ายที่ควรตั้งลูกหนี้จากรายการที่เบิกได้ แยก OPD/IPD ตามสิทธิ์ HOSxP และสิทธิการเงิน
          </p>
        </div>
        <div className="receivable-hero-note">
          <strong>{settings?.hospital_name || 'หน่วยบริการ'}</strong>
          <span>ตั้งลูกหนี้เฉพาะรายการที่เข้าเกณฑ์เบิกได้ เช่น กองทุนพิเศษ ยาสมุนไพร ค่าบริการ OPD อุปกรณ์/ADP ที่เบิกได้</span>
        </div>
      </section>

      <section className="receivable-filter-panel no-print">
        <div className="form-group">
          <label>วันที่เริ่ม</label>
          <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="form-group">
          <label>วันที่สิ้นสุด</label>
          <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} />
        </div>
        <div className="form-group">
          <label>ประเภทผู้ป่วย</label>
          <select value={patientType} onChange={(event) => setPatientType(event.target.value)}>
            <option value="ALL">ทั้งหมด</option>
            <option value="OPD">OPD</option>
            <option value="IPD">IPD</option>
          </select>
        </div>
        <div className="form-group">
          <label>สิทธิ์ HOSxP</label>
          <select value={hosxpRight} onChange={(event) => setHosxpRight(event.target.value)}>
            <option value="ALL">ทั้งหมด</option>
            {filterOptions.hosxpRights.map((item) => (
              <option key={item.code} value={item.code}>{optionLabel(item.code, item.name)}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>สิทธิการเงิน</label>
          <select value={financeRight} onChange={(event) => setFinanceRight(event.target.value)}>
            <option value="ALL">ทั้งหมด</option>
            {filterOptions.financeRights.map((item) => (
              <option key={item.code} value={item.code}>{optionLabel(item.code, item.name)}</option>
            ))}
          </select>
        </div>
        <div className="form-group form-group--wide">
          <label>หมายเหตุชุดลูกหนี้</label>
          <input value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="เช่น ลูกหนี้เดือนเมษายน 2569" />
        </div>
        <div className="form-group form-group--wide">
          <label>ค้นหาในผลลัพธ์</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="VN / AN / HN / ชื่อผู้ป่วย / รหัสบัญชี"
          />
        </div>
        <div className="form-group">
          <label>ความพร้อม</label>
          <select value={readiness} onChange={(event) => setReadiness(event.target.value as typeof readiness)}>
            <option value="ALL">ทั้งหมด</option>
            <option value="READY">พร้อมตั้งลูกหนี้</option>
            <option value="REVIEW">ต้องตรวจสอบ</option>
          </select>
        </div>
        <div className="receivable-actions">
          <button
            className={`btn btn-primary receivable-btn receivable-btn--load${loading ? ' is-loading' : ''}`}
            onClick={loadData}
            disabled={loading}
          >
            <span className="receivable-btn__icon">↻</span>
            <span className="receivable-btn__label">{loading ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูล'}</span>
          </button>
          <button
            className="btn receivable-btn receivable-btn--soft"
            onClick={() => toggleVisible(true)}
            disabled={!visibleRows.some(({ row }) => isCandidateReady(row))}
          >
            <span className="receivable-btn__icon">✓</span>
            <span className="receivable-btn__label">เลือกที่แสดง</span>
          </button>
          <button
            className="btn receivable-btn receivable-btn--soft"
            onClick={() => toggleVisible(false)}
            disabled={!visibleRows.length}
          >
            <span className="receivable-btn__icon">×</span>
            <span className="receivable-btn__label">ล้างที่แสดง</span>
          </button>
          <button
            className={`btn btn-success receivable-btn receivable-btn--save${saving ? ' is-loading' : ''}`}
            onClick={saveBatch}
            disabled={saving || isStale || selectedRows.length === 0 || lastSavedSelection === selectedSignature}
          >
            <span className="receivable-btn__icon">💾</span>
            <span className="receivable-btn__label">{saving ? 'กำลังบันทึก...' : 'บันทึกชุดลูกหนี้'}</span>
          </button>
          <button
            className="btn receivable-btn receivable-btn--excel"
            onClick={exportExcel}
            disabled={isStale || selectedRows.length === 0}
          >
            <span className="receivable-btn__icon">📊</span>
            <span className="receivable-btn__label">ส่งออก Excel</span>
          </button>
          <button
            className="btn receivable-btn receivable-btn--print"
            onClick={() => {
              if (isStale) return setError('ตัวกรองมีการเปลี่ยนแปลง กรุณาดึงข้อมูลใหม่ก่อนพิมพ์');
              window.print();
            }}
            disabled={isStale || selectedRows.length === 0}
          >
            <span className="receivable-btn__icon">🖨</span>
            <span className="receivable-btn__label">พิมพ์หลักฐาน</span>
          </button>
        </div>
      </section>

      {message && <div className="success-message no-print">✅ {message}</div>}
      {error && <div className="error-message no-print">⚠️ {error}</div>}
      {isStale && (
        <div className="receivable-stale-warning no-print" role="alert">
          ตัวกรองเปลี่ยนจากข้อมูลที่แสดงอยู่ กรุณากด “ดึงข้อมูล” อีกครั้งก่อนบันทึก ส่งออก หรือพิมพ์
        </div>
      )}

      <section className="receivable-summary-grid">
        <div className="summary-card">
          <span>รายการที่เลือก</span>
          <strong>{selectedRows.length.toLocaleString('th-TH')}</strong>
        </div>
        <div className="summary-card">
          <span>ยอดตั้งลูกหนี้</span>
          <strong>{formatMoney(totalClaimable)} บาท</strong>
        </div>
        <div className="summary-card">
          <span>พร้อมตั้ง / ต้องตรวจสอบ</span>
          <strong>{readyRows.length.toLocaleString('th-TH')} / {reviewRows.length.toLocaleString('th-TH')}</strong>
        </div>
        <div className="summary-card">
          <span>รหัสลูกหนี้ / รายรับที่ใช้</span>
          <strong>{debtorCodeCount.toLocaleString('th-TH')} / {revenueCodeCount.toLocaleString('th-TH')}</strong>
        </div>
      </section>

      <section className="receivable-table-card">
        <div className="section-header">
          <div>
            <h2>รายการสำหรับตั้งลูกหนี้</h2>
            <p>OPD ใช้เฉพาะรายการที่เบิกได้ ส่วน IPD ตั้งยอดเบื้องต้นจากยอดค้างสิทธิ์ตามสิทธิ์ผู้ป่วย</p>
          </div>
          <div className="receivable-result-counts">
            <span className="badge badge-info">แสดง {visibleRows.length.toLocaleString('th-TH')} / {rows.length.toLocaleString('th-TH')}</span>
            {reviewRows.length > 0 && <span className="badge receivable-review-badge">ตรวจสอบ {reviewRows.length.toLocaleString('th-TH')}</span>}
          </div>
        </div>
        <div className="receivable-table-wrap">
          <table className="receivable-table">
            <thead>
              <tr>
                <th className="no-print">เลือก</th>
                <th>สถานะ</th>
                <th>ประเภท</th>
                <th>VN / AN</th>
                <th>HN</th>
                <th>ผู้ป่วย</th>
                <th>สิทธิ์ HOSxP</th>
                <th>สิทธิการเงิน</th>
                <th>รหัสลูกหนี้</th>
                <th>รหัสรายรับ</th>
                <th>กลุ่มบัญชี</th>
                <th>แหล่งเงิน/วิธีคิด</th>
                <th>เลขที่ใบเสร็จ</th>
                <th className="text-right">ยอดใบเสร็จ</th>
                <th>วันที่ใบเสร็จ</th>
                <th>วันที่</th>
                <th>รายการที่เบิกได้</th>
                <th className="text-right">ตั้งลูกหนี้</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={18} className="empty-cell">
                    {loadedSignature === null
                      ? 'ยังไม่มีข้อมูล กด “ดึงข้อมูล” เพื่อเริ่มคำนวณบัญชีลูกหนี้'
                      : 'ไม่พบรายการที่เข้าเงื่อนไขในช่วงวันที่และสิทธิ์ที่เลือก'}
                  </td>
                </tr>
              )}
              {rows.length > 0 && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={18} className="empty-cell">ไม่พบรายการที่ตรงกับคำค้นหรือสถานะที่เลือก</td>
                </tr>
              )}
              {visibleRows.map(({ row, index }) => {
                const key = rowKey(row, index);
                const issues = candidateIssues(row);
                const ready = issues.length === 0;
                return (
                  <tr key={key} className={`${selected[key] ? 'is-selected' : ''}${ready ? '' : ' row-review'}`}>
                    <td className="no-print">
                      <input
                        type="checkbox"
                        checked={selected[key] || false}
                        disabled={!ready}
                        aria-label={`เลือกรายการ ${row.vn || row.an || row.hn || index + 1}`}
                        title={ready ? 'เลือกรายการตั้งลูกหนี้' : issues.join(', ')}
                        onChange={(event) => {
                          setSelected((prev) => ({ ...prev, [key]: event.target.checked }));
                          setLastSavedSelection('');
                        }}
                      />
                    </td>
                    <td>
                      <span className={`receivable-status ${ready ? 'receivable-status--ready' : 'receivable-status--review'}`} title={issues.join(', ')}>
                        {ready ? 'พร้อมตั้ง' : 'ตรวจสอบ'}
                      </span>
                      {!ready && <small className="receivable-issue-text">{issues.join(' · ')}</small>}
                    </td>
                    <td><span className="type-pill">{row.patient_type}</span></td>
                    <td className="mono">{row.vn || row.an || '-'}</td>
                    <td className="mono">{row.hn || '-'}</td>
                    <td>{row.patient_name || '-'}</td>
                    <td>{optionLabel(row.hosxp_right_code || row.pttype, row.hosxp_right_name || row.pttype_name)}</td>
                    <td>{optionLabel(row.finance_right_code, row.finance_right_name)}</td>
                    <td className="mono">{row.debtor_code || '-'}</td>
                    <td className="mono">{row.revenue_code || '-'}</td>
                    <td>{row.account_group || '-'}</td>
                    <td className="claim-account-note">
                      <span>{row.payment_source || '-'}</span>
                      <small>{row.pricing_method || '-'}</small>
                    </td>
                    <td className="mono">{row.receipt_no || '-'}</td>
                    <td className="mono text-right">{formatReceiptAmount(row.receipt_amount)}</td>
                    <td>{formatDate(row.receipt_date)}</td>
                    <td>{formatDate(row.service_date)}</td>
                    <td className="claim-summary">{row.claim_summary || '-'}</td>
                    <td className="text-right">{formatMoney(row.claimable_amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="receivable-history no-print">
        <h2>ประวัติชุดบัญชีลูกหนี้ล่าสุด</h2>
        <div className="history-list">
          {batches.length === 0 && <span className="muted-text">ยังไม่มีประวัติการบันทึก</span>}
          {batches.map((batch) => (
            <div key={batch.id} className="history-item">
              <strong title={batch.batch_no || `#${batch.id}`}>{batch.batch_no || `#${batch.id}`}</strong>
              <span>{formatDate(batch.start_date)} ถึง {formatDate(batch.end_date)}</span>
              <span>{Number(batch.item_count || 0).toLocaleString('th-TH')} รายการ</span>
              <span>{formatMoney(batch.total_receivable)} บาท</span>
            </div>
          ))}
        </div>
      </section>

      <section className="receivable-print-section">
        <h1>รายงานบัญชีลูกหนี้สิทธิ์</h1>
        <p>{settings?.hospital_name || ''} {settings?.hospital_code ? `(${settings.hospital_code})` : ''}</p>
        <p>ช่วงวันที่ {startDate} ถึง {endDate} | ประเภท {patientType} | สิทธิ์ HOSxP {selectedHosxpRightLabel} | สิทธิการเงิน {selectedFinanceRightLabel}</p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>VN/AN</th>
              <th>HN</th>
              <th>ผู้ป่วย</th>
              <th>สิทธิ์การเงิน</th>
              <th>รหัสลูกหนี้</th>
              <th>รหัสรายรับ</th>
              <th>กลุ่มบัญชี</th>
              <th>เลขที่ใบเสร็จ</th>
              <th>ยอดใบเสร็จ</th>
              <th>วันที่ใบเสร็จ</th>
              <th>วันที่</th>
              <th>รายการ</th>
              <th>ยอดลูกหนี้</th>
            </tr>
          </thead>
          <tbody>
            {selectedRows.map((row, index) => (
              <tr key={`print-${rowKey(row, index)}`}>
                <td>{index + 1}</td>
                <td>{row.vn || row.an || ''}</td>
                <td>{row.hn || ''}</td>
                <td>{row.patient_name || ''}</td>
                <td>{optionLabel(row.finance_right_code, row.finance_right_name)}</td>
                <td>{row.debtor_code || ''}</td>
                <td>{row.revenue_code || ''}</td>
                <td>{row.account_group || ''}</td>
                <td>{row.receipt_no || ''}</td>
                <td>{formatReceiptAmount(row.receipt_amount)}</td>
                <td>{formatDate(row.receipt_date)}</td>
                <td>{formatDate(row.service_date)}</td>
                <td>{row.claim_summary || ''}</td>
                <td>{formatMoney(row.claimable_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={13}>รวม</td>
              <td>{formatMoney(totalClaimable)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="signature-grid">
          <div>
            <div className="signature-line" />
            <strong>{signers.finance.name || '........................................'}</strong>
            <span>{signers.finance.position}</span>
          </div>
          <div>
            <div className="signature-line" />
            <strong>{signers.insurance.name || '........................................'}</strong>
            <span>{signers.insurance.position}</span>
          </div>
          <div>
            <div className="signature-line" />
            <strong>{signers.director.name || '........................................'}</strong>
            <span>{signers.director.position}</span>
          </div>
        </div>
      </section>
    </div>
  );
};
