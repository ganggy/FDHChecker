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

const todayIso = () => new Date().toISOString().slice(0, 10);

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

const formatReceiptSummary = (row: ReceivableCandidate) => {
  const receiptNo = String(row.receipt_no || '').trim();
  const hasAmount = row.receipt_amount != null && row.receipt_amount !== '';
  const receiptAmount = hasAmount ? formatMoney(row.receipt_amount) : '-';
  const receiptDate = formatDate(row.receipt_date);

  if (!receiptNo && !hasAmount && receiptDate === '-') return '-';

  return [receiptNo || '-', receiptAmount, receiptDate].join(' / ');
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
  const [settings, setSettings] = useState<ReceivableSettings | null>(null);
  const [batches, setBatches] = useState<any[]>([]);

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

  const totalClaimable = useMemo(
    () => selectedRows.reduce((sum, row) => sum + toNumber(row.claimable_amount), 0),
    [selectedRows],
  );

  const debtorCodeCount = useMemo(
    () => new Set(selectedRows.map((row) => String(row.debtor_code || '').trim()).filter(Boolean)).size,
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
    try {
      setLoading(true);
      setError('');
      setMessage('');
      const data = await fetchReceivableCandidates({ startDate, endDate, patientType, hosxpRight, financeRight });
      setRows(data);
      setSelected(Object.fromEntries(data.map((row, index) => [rowKey(row, index), true])));
      setMessage(`โหลดข้อมูล ${data.length.toLocaleString('th-TH')} รายการ`);
    } catch (err) {
      setRows([]);
      setSelected({});
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลบัญชีลูกหนี้ได้');
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    setSelected(Object.fromEntries(rows.map((row, index) => [rowKey(row, index), checked])));
  };

  const exportExcel = () => {
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
    if (selectedRows.length === 0) {
      setError('กรุณาเลือกรายการก่อนบันทึกชุดบัญชีลูกหนี้');
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
      setMessage(`บันทึกชุดบัญชีลูกหนี้สำเร็จ เลขที่ชุด ${result.batchId || '-'}`);
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
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="form-group">
          <label>วันที่สิ้นสุด</label>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
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
          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="เช่น ลูกหนี้เดือนเมษายน 2569" />
        </div>
        <div className="receivable-actions">
          <button
            className={`btn btn-primary receivable-btn receivable-btn--load${loading ? ' is-loading' : ''}`}
            onClick={loadData}
            disabled={loading}
          >
            {loading ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูล'}
          </button>
          <button
            className="btn receivable-btn receivable-btn--soft"
            onClick={() => toggleAll(true)}
            disabled={!rows.length}
          >
            เลือกทั้งหมด
          </button>
          <button
            className="btn receivable-btn receivable-btn--soft"
            onClick={() => toggleAll(false)}
            disabled={!rows.length}
          >
            ล้างเลือก
          </button>
          <button
            className={`btn btn-success receivable-btn receivable-btn--save${saving ? ' is-loading' : ''}`}
            onClick={saveBatch}
            disabled={saving || selectedRows.length === 0}
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึกชุดลูกหนี้'}
          </button>
          <button
            className="btn receivable-btn receivable-btn--excel"
            onClick={exportExcel}
            disabled={selectedRows.length === 0}
          >
            ส่งออก Excel
          </button>
          <button
            className="btn receivable-btn receivable-btn--print"
            onClick={() => window.print()}
            disabled={selectedRows.length === 0}
          >
            พิมพ์หลักฐาน
          </button>
        </div>
      </section>

      {message && <div className="success-message no-print">✅ {message}</div>}
      {error && <div className="error-message no-print">⚠️ {error}</div>}

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
          <span>รหัสลูกหนี้ที่ใช้</span>
          <strong>{debtorCodeCount.toLocaleString('th-TH')}</strong>
        </div>
        <div className="summary-card">
          <span>ตัวกรองสิทธิ</span>
          <strong>{selectedFinanceRightLabel}</strong>
        </div>
      </section>

      <section className="receivable-table-card">
        <div className="section-header">
          <div>
            <h2>รายการสำหรับตั้งลูกหนี้</h2>
            <p>OPD ใช้เฉพาะรายการที่เบิกได้ ส่วน IPD ตั้งยอดเบื้องต้นจากยอดค้างสิทธิ์ตามสิทธิ์ผู้ป่วย</p>
          </div>
          <span className="badge badge-info">{rows.length.toLocaleString('th-TH')} รายการ</span>
        </div>
        <div className="receivable-table-wrap">
          <table className="receivable-table">
            <thead>
              <tr>
                <th className="no-print">เลือก</th>
                <th>ประเภท</th>
                <th>VN / AN</th>
                <th>HN</th>
                <th>ผู้ป่วย</th>
                <th>สิทธิ์ HOSxP</th>
                <th>สิทธิการเงิน</th>
                <th>รหัสลูกหนี้</th>
                <th>ใบเสร็จ / ยอด / วันที่</th>
                <th>วันที่</th>
                <th>รายการที่เบิกได้</th>
                <th className="text-right">ตั้งลูกหนี้</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="empty-cell">ยังไม่มีข้อมูล กด “ดึงข้อมูล” เพื่อเริ่มคำนวณบัญชีลูกหนี้</td>
                </tr>
              )}
              {rows.map((row, index) => {
                const key = rowKey(row, index);
                return (
                  <tr key={key} className={selected[key] ? 'is-selected' : ''}>
                    <td className="no-print">
                      <input
                        type="checkbox"
                        checked={selected[key] || false}
                        onChange={(event) => setSelected((prev) => ({ ...prev, [key]: event.target.checked }))}
                      />
                    </td>
                    <td><span className="type-pill">{row.patient_type}</span></td>
                    <td className="mono">{row.vn || row.an || '-'}</td>
                    <td className="mono">{row.hn || '-'}</td>
                    <td>{row.patient_name || '-'}</td>
                    <td>{optionLabel(row.hosxp_right_code || row.pttype, row.hosxp_right_name || row.pttype_name)}</td>
                    <td>{optionLabel(row.finance_right_code, row.finance_right_name)}</td>
                    <td className="mono">{row.debtor_code || '-'}</td>
                    <td className="mono">{formatReceiptSummary(row)}</td>
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
              <strong>#{batch.id}</strong>
              <span>{batch.start_date} ถึง {batch.end_date}</span>
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
              <th>เลขที่ใบเสร็จ</th>
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
                <td>{row.receipt_no || ''}</td>
                <td>{formatDate(row.receipt_date)}</td>
                <td>{formatDate(row.service_date)}</td>
                <td>{row.claim_summary || ''}</td>
                <td>{formatMoney(row.claimable_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={10}>รวม</td>
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
