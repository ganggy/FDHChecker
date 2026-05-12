import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  checkMophVaccineRows,
  fetchMophVaccineCandidates,
  sendMophVaccineRows,
  type MophVaccineActionResult,
  type MophVaccineCandidate,
} from '../services/hosxpService';
import { formatLocalDateInput } from '../utils/dateUtils';

const today = formatLocalDateInput();
const MOPH_VACCINE_ROW_LIMIT = 20000;

const rowKey = (row: Pick<MophVaccineCandidate, 'vn' | 'vaccine_code'>) =>
  `${row.vn}-${String(row.vaccine_code || '').toUpperCase()}`;

const formatDate = (value?: string | null) => String(value || '').slice(0, 10) || '-';

const formatVisitDate = (value?: string | null) => {
  const raw = String(value || '');
  return raw.length >= 16 ? raw.slice(0, 16).replace('T', ' ') : raw || '-';
};

const hasAuthen = (row: MophVaccineCandidate) => String(row.authencode || '').trim().length > 0;

const isSent = (row: MophVaccineCandidate) => ['Y', 'C'].includes(String(row.moph || '').toUpperCase());

const hasError = (row: MophVaccineCandidate) => String(row.errorname || '').startsWith('Error');

const hasWarn = (row: MophVaccineCandidate) => String(row.errorname || '').startsWith('Warn');

const isDefaultSelectable = (row: MophVaccineCandidate) =>
  Boolean(row.ready) && hasAuthen(row) && !hasError(row) && !isSent(row);

const mophLabel = (value?: string | null) => {
  const flag = String(value || '').toUpperCase();
  if (flag === 'Y') return 'ส่งแล้ว/ปิดเคส';
  if (flag === 'C') return 'ตรวจแล้วส่งไม่ได้';
  return 'ยังไม่ส่ง';
};

const actionLabel = (action: 'check' | 'send') => action === 'check' ? 'ตรวจสอบสถานะ' : 'ส่ง MOPH Claim';

const applyActionResults = (
  rows: MophVaccineCandidate[],
  results: MophVaccineActionResult[]
): MophVaccineCandidate[] => {
  if (results.length === 0) return rows;
  const resultByKey = new Map(results.map((result) => [rowKey(result), result]));
  return rows.map((row) => {
    const result = resultByKey.get(rowKey(row));
    if (!result) return row;
    return {
      ...row,
      moph: result.flag || row.moph,
      transaction_uid: result.transaction_uid || row.transaction_uid,
      note: result.message || row.note,
    };
  });
};

export const MophVaccineClaimPage = () => {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [showEpi, setShowEpi] = useState(true);
  const [showDt, setShowDt] = useState(true);
  const [showHpv, setShowHpv] = useState(false);
  const [showAp, setShowAp] = useState(false);
  const [ucOnly, setUcOnly] = useState(true);
  const [authenOnly, setAuthenOnly] = useState(true);
  const [errorFilter, setErrorFilter] = useState('ALL');
  const [sendFilter, setSendFilter] = useState('ALL');
  const [testZone, setTestZone] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<MophVaccineCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<'check' | 'send' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedRows = useMemo(
    () => rows.filter((row) => selected[rowKey(row)]),
    [rows, selected]
  );

  const selectedTypes = useMemo(() => {
    const types: string[] = [];
    if (showEpi) types.push('EPI');
    if (showDt) types.push('dT');
    if (showHpv) types.push('HPV');
    if (showAp) types.push('aP');
    return types;
  }, [showEpi, showDt, showHpv, showAp]);

  const loadData = async () => {
    if (selectedTypes.length === 0) {
      setRows([]);
      setSelected({});
      setNotice('');
      setError('กรุณาเลือกชนิดวัคซีนอย่างน้อย 1 รายการ');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await fetchMophVaccineCandidates({
        startDate,
        endDate,
        types: selectedTypes,
        ucOnly,
        authenOnly,
        errorFilter,
        sendFilter,
        search,
        limit: MOPH_VACCINE_ROW_LIMIT,
      });
      setRows(data);
      setSelected(Object.fromEntries(data.filter(isDefaultSelectable).map((row) => [rowKey(row), true])));
    } catch (err) {
      setRows([]);
      setSelected({});
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลวัคซีนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => ({
    total: rows.length,
    epi: rows.filter((row) => row.type === 'EPI').length,
    dt: rows.filter((row) => row.type === 'dT').length,
    hpv: rows.filter((row) => row.type === 'HPV').length,
    ap: rows.filter((row) => row.type === 'aP').length,
    errors: rows.filter(hasError).length,
    warnings: rows.filter(hasWarn).length,
    missingAuthen: rows.filter((row) => !hasAuthen(row)).length,
    sent: rows.filter(isSent).length,
    selected: selectedRows.length,
  }), [rows, selectedRows.length]);

  const selectDefaultRows = () => {
    setSelected(Object.fromEntries(rows.filter(isDefaultSelectable).map((row) => [rowKey(row), true])));
  };

  const clearSelection = () => setSelected({});

  const toggleRow = (row: MophVaccineCandidate) => {
    if (isSent(row)) return;
    const key = rowKey(row);
    setSelected((current) => ({ ...current, [key]: !current[key] }));
  };

  const runAction = async (action: 'check' | 'send') => {
    const actionRows = selectedRows.filter((row) => !isSent(row));
    if (actionRows.length === 0) {
      setNotice('');
      setError('กรุณาเลือกรายการก่อนทำงาน');
      return;
    }

    setActionBusy(action);
    setError('');
    setNotice('');
    try {
      const results = action === 'check'
        ? await checkMophVaccineRows(actionRows, testZone)
        : await sendMophVaccineRows(actionRows, testZone);
      setRows((currentRows) => applyActionResults(currentRows, results));
      setSelected((current) => {
        const next = { ...current };
        for (const result of results) {
          if (String(result.flag || '').trim()) delete next[rowKey(result)];
        }
        return next;
      });
      const saved = results.filter((result) => String(result.flag || '').trim()).length;
      setNotice(`${actionLabel(action)} แล้ว ${results.length.toLocaleString('th-TH')} รายการ บันทึกสถานะ ${saved.toLocaleString('th-TH')} รายการ`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${actionLabel(action)} ไม่สำเร็จ`);
    } finally {
      setActionBusy('');
    }
  };

  const exportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows.map((row, index) => ({
      ลำดับ: index + 1,
      เลือก: selected[rowKey(row)] ? 'Y' : 'N',
      ส่งแล้ว: isSent(row) ? 'Y' : 'N',
      VN: row.vn,
      HN: row.hn || '',
      CID: row.cid || '',
      ผู้ป่วย: row.patient_name || '',
      วันที่บริการ: formatVisitDate(row.visit_datetime || row.service_date),
      เลขปิดสิทธิ์_AuthenCode: row.authencode || '',
      สิทธิหลัก: row.maininscl || '',
      ชื่อสิทธิ: row.pttypename || '',
      แหล่ง: row.epi || '',
      ประเภท: row.type || '',
      รหัสวัคซีน: row.vaccine_code || '',
      ชื่อวัคซีน: row.vaccine_name || '',
      Dose: row.dose || '',
      Lot: row.lot || '',
      Expire: formatDate(row.dateexp),
      บริษัท: row.company || '',
      PregNo: row.preg_no || '',
      GA: row.ga || '',
      พร้อมส่ง: row.ready ? 'Y' : 'N',
      ErrorName: row.errorname || '',
      สถานะ_MOPH: mophLabel(row.moph),
      Transaction_UID: row.transaction_uid || '',
      หมายเหตุ: row.note || row.missing_reason || '',
    })));
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Vaccine MOPH Claim');
    XLSX.writeFile(workbook, `moph-vaccine-claim-${startDate}-${endDate}.xlsx`);
  };

  const allDefaultSelected = rows.some(isDefaultSelectable) && rows.filter(isDefaultSelectable).every((row) => selected[rowKey(row)]);
  const disabled = loading || Boolean(actionBusy);

  return (
    <div className="page-container workflow-page">
      <div className="workflow-hero">
        <div className="workflow-hero__content">
          <div>
            <h1 className="page-title workflow-hero__title">MOPH Claim Vaccine EPI/dT</h1>
            <p className="workflow-hero__description">
              ตรวจและส่งบริการฉีดวัคซีน EPI, dT, HPV และ aP ตามรูปแบบ MOPH Claim พร้อมตรวจ Lot, Dose, วันหมดอายุ, อายุ, GA และเลขปิดสิทธิ์
            </p>
          </div>
          <div className="workflow-hero__meta">
            <span className="workflow-badge workflow-badge--accent">{summary.selected} เลือกไว้</span>
            <span className="workflow-badge">{summary.errors} Error</span>
          </div>
        </div>
      </div>

      <div className="card workflow-panel">
        <div className="card-body">
          <div className="workflow-filter-grid">
            <div className="form-group">
              <label>วันที่เริ่มต้น</label>
              <input type="date" className="form-control" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </div>
            <div className="form-group">
              <label>วันที่สิ้นสุด</label>
              <input type="date" className="form-control" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </div>
            <div className="form-group">
              <label>ค้นหา</label>
              <input
                className="form-control"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="VN / HN / CID / ชื่อ"
              />
            </div>
            <div className="form-group">
              <label>ErrorName</label>
              <select className="form-control" value={errorFilter} onChange={(event) => setErrorFilter(event.target.value)}>
                <option value="ALL">ทั้งหมด</option>
                <option value="NONE">ไม่มี</option>
                <option value="HAS">มี</option>
                <option value="ERROR">Error</option>
                <option value="WARN">Warn</option>
              </select>
            </div>
            <div className="form-group">
              <label>ข้อมูล</label>
              <select className="form-control" value={sendFilter} onChange={(event) => setSendFilter(event.target.value)}>
                <option value="ALL">ทั้งหมด</option>
                <option value="SENT">ส่งแล้ว</option>
                <option value="UNSENT">ยังไม่ได้ส่ง</option>
              </select>
            </div>
            <label className="checkbox-row"><input type="checkbox" checked={showEpi} onChange={(event) => setShowEpi(event.target.checked)} /><span>EPI</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={showDt} onChange={(event) => setShowDt(event.target.checked)} /><span>dT</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={showHpv} onChange={(event) => setShowHpv(event.target.checked)} /><span>HPV</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={showAp} onChange={(event) => setShowAp(event.target.checked)} /><span>aP</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={ucOnly} onChange={(event) => setUcOnly(event.target.checked)} /><span>เฉพาะสิทธิ UC</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={authenOnly} onChange={(event) => setAuthenOnly(event.target.checked)} /><span>เฉพาะที่มีเลขปิดสิทธิ์/AuthenCode</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={testZone} onChange={(event) => setTestZone(event.target.checked)} /><span>TestZone</span></label>
            <div className="workflow-filter-actions workflow-action-strip">
              <button className="btn btn-primary" onClick={loadData} disabled={disabled}>
                {loading ? 'กำลังโหลด...' : 'Refresh'}
              </button>
              <button className="btn btn-secondary" onClick={() => void runAction('check')} disabled={disabled || selectedRows.length === 0}>
                {actionBusy === 'check' ? 'กำลังตรวจ...' : 'ตรวจสอบสถานะ'}
              </button>
              <button className="btn btn-primary" onClick={() => void runAction('send')} disabled={disabled || selectedRows.length === 0}>
                {actionBusy === 'send' ? 'กำลังส่ง...' : 'ส่ง MOPH Claim'}
              </button>
              <button className="btn btn-secondary" onClick={exportExcel} disabled={disabled || rows.length === 0}>
                ส่งออก Excel
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="workflow-stats-grid">
        <div className="workflow-stat-card"><span>ทั้งหมด</span><strong>{summary.total.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>EPI</span><strong>{summary.epi.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>dT</span><strong>{summary.dt.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>HPV</span><strong>{summary.hpv.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>aP</span><strong>{summary.ap.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>Error/Warn</span><strong>{summary.errors.toLocaleString('th-TH')} / {summary.warnings.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>ขาดเลขปิดสิทธิ์</span><strong>{summary.missingAuthen.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>ส่งแล้ว</span><strong>{summary.sent.toLocaleString('th-TH')}</strong></div>
      </div>

      <div className="card workflow-table-card">
        <div className="card-header workflow-table-header">
          <h3>รายการตรวจสอบ Vaccine MOPH Claim</h3>
          <div className="workflow-table-tools">
            <button className="btn btn-sm btn-secondary" onClick={selectDefaultRows} disabled={disabled || allDefaultSelected}>
              เลือกพร้อมส่ง
            </button>
            <button className="btn btn-sm btn-secondary" onClick={clearSelection} disabled={disabled || selectedRows.length === 0}>
              ล้างเลือก
            </button>
          </div>
        </div>
        <div className="table-responsive">
          <table className="data-table long-id-table long-id-table--moph-vaccine">
            <thead>
              <tr>
                <th>เลือก</th>
                <th>ที่</th>
                <th>ส่งแล้ว</th>
                <th>VN</th>
                <th>CID</th>
                <th>HN</th>
                <th>ผู้ป่วย</th>
                <th>วันที่</th>
                <th>เลขปิดสิทธิ์/AuthenCode</th>
                <th>สิทธิหลัก</th>
                <th>ชื่อสิทธิ</th>
                <th>แหล่ง</th>
                <th>ประเภท</th>
                <th>รหัส</th>
                <th>วัคซีน</th>
                <th>Dose</th>
                <th>Lot</th>
                <th>Expire</th>
                <th>ANC</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={20} className="empty-cell">{loading ? 'กำลังโหลดข้อมูล...' : 'ไม่พบข้อมูลในช่วงวันที่ที่เลือก'}</td>
                </tr>
              )}
              {rows.map((row, index) => {
                const key = rowKey(row);
                const sent = isSent(row);
                const rowClass = hasError(row) ? 'row-danger' : (hasWarn(row) || !hasAuthen(row) ? 'row-warning' : '');
                return (
                  <tr key={key} className={rowClass}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[key])}
                        disabled={sent || disabled}
                        onChange={() => toggleRow(row)}
                        aria-label={`เลือก ${row.vn} ${row.vaccine_code}`}
                      />
                    </td>
                    <td>{index + 1}</td>
                    <td><strong>{sent ? 'Y' : 'N'}</strong></td>
                    <td className="workflow-code-cell">{row.vn}</td>
                    <td className="workflow-code-cell">{row.cid || '-'}</td>
                    <td className="workflow-code-cell">{row.hn || '-'}</td>
                    <td className="workflow-person-cell">{row.patient_name || '-'}</td>
                    <td>{formatVisitDate(row.visit_datetime || row.service_date)}</td>
                    <td className={`workflow-code-cell ${hasAuthen(row) ? '' : 'text-danger'}`}>{row.authencode || 'ไม่มีเลขปิดสิทธิ์'}</td>
                    <td>{row.maininscl || '-'}</td>
                    <td>{row.pttypename || '-'}</td>
                    <td>{row.epi || '-'}</td>
                    <td><strong>{row.type || '-'}</strong></td>
                    <td className="workflow-code-cell">{row.vaccine_code || '-'}</td>
                    <td>{row.vaccine_name || '-'}</td>
                    <td>{row.dose || '-'}</td>
                    <td className="workflow-code-cell">{row.lot || '-'}</td>
                    <td>{formatDate(row.dateexp)}</td>
                    <td>{row.preg_no || row.ga ? `ครรภ์ ${row.preg_no || '-'} / GA ${row.ga || '-'}` : '-'}</td>
                    <td className="workflow-note-cell">{row.note || row.errorname || row.missing_reason || mophLabel(row.moph)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
