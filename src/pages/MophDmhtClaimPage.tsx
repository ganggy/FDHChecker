import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  checkMophDmhtRows,
  fetchMophDmhtCandidates,
  sendMophDmhtRows,
  type MophDmhtActionResult,
  type MophDmhtCandidate,
} from '../services/hosxpService';
import { formatLocalDateInput } from '../utils/dateUtils';

const today = formatLocalDateInput();
const MOPH_DMHT_ROW_LIMIT = 20000;

const rowKey = (row: Pick<MophDmhtCandidate, 'vn' | 'diag'>) => `${row.vn}-${String(row.diag || '').toUpperCase()}`;

const yesNo = (value?: string | null) => String(value || '').toUpperCase() === 'Y' ? 'Y' : '';

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  return String(value).slice(0, 10);
};

const isSent = (row: MophDmhtCandidate) => {
  const flag = String(row.moph || '').toUpperCase();
  return flag === 'Y' || flag === 'C';
};

const hasAuthen = (row: MophDmhtCandidate) => String(row.authencode || '').trim().length > 0;

const isDefaultSelectable = (row: MophDmhtCandidate) => Boolean(row.ready) && hasAuthen(row) && !isSent(row);

const mophLabel = (value?: string | null) => {
  const flag = String(value || '').toUpperCase();
  if (flag === 'Y') return 'ส่งแล้ว/ปิดเคส';
  if (flag === 'C') return 'ตรวจแล้วส่งไม่ได้';
  return 'ยังไม่ส่ง';
};

const applyActionResults = (
  rows: MophDmhtCandidate[],
  results: MophDmhtActionResult[]
): MophDmhtCandidate[] => {
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

export const MophDmhtClaimPage = () => {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [diag, setDiag] = useState('ALL');
  const [ucOnly, setUcOnly] = useState(false);
  const [authenOnly, setAuthenOnly] = useState(false);
  const [testZone, setTestZone] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<MophDmhtCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<'check' | 'send' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedRows = useMemo(
    () => rows.filter((row) => selected[rowKey(row)]),
    [rows, selected]
  );

  const loadData = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await fetchMophDmhtCandidates({
        startDate,
        endDate,
        diag,
        ucOnly,
        authenOnly,
        search,
        limit: MOPH_DMHT_ROW_LIMIT,
      });
      setRows(data);
      setSelected(Object.fromEntries(data.filter(isDefaultSelectable).map((row) => [rowKey(row), true])));
    } catch (err) {
      setRows([]);
      setSelected({});
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    const dm = rows.filter((row) => row.diag === 'DM');
    const ht = rows.filter((row) => row.diag === 'HT');
    return {
      total: rows.length,
      dm: dm.length,
      ht: ht.length,
      ready: rows.filter((row) => row.ready).length,
      missingAuthen: rows.filter((row) => !hasAuthen(row)).length,
      sent: rows.filter((row) => String(row.moph || '').toUpperCase() === 'Y').length,
      selected: selectedRows.length,
    };
  }, [rows, selectedRows.length]);

  const selectDefaultRows = () => {
    setSelected(Object.fromEntries(rows.filter(isDefaultSelectable).map((row) => [rowKey(row), true])));
  };

  const clearSelection = () => setSelected({});

  const toggleRow = (row: MophDmhtCandidate) => {
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
        ? await checkMophDmhtRows(actionRows, testZone)
        : await sendMophDmhtRows(actionRows, testZone);
      setRows((currentRows) => applyActionResults(currentRows, results));
      setSelected((current) => {
        const next = { ...current };
        for (const result of results) {
          if (String(result.flag || '').trim()) {
            delete next[rowKey(result)];
          }
        }
        return next;
      });
      const successCount = results.filter((result) => String(result.flag || '').trim()).length;
      setNotice(`${action === 'check' ? 'ตรวจสอบสถานะ' : 'ส่ง MOPH Claim'} แล้ว ${results.length} รายการ บันทึกสถานะ ${successCount} รายการ`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setActionBusy('');
    }
  };

  const exportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows.map((row, index) => ({
      ลำดับ: index + 1,
      เลือก: selected[rowKey(row)] ? 'Y' : 'N',
      VN: row.vn,
      HN: row.hn || '',
      CID: row.cid || '',
      ผู้ป่วย: row.patient_name || '',
      ประเภท: row.diag,
      วันที่บริการ: formatDate(row.service_date),
      สิทธิ: row.maininscl || '',
      ชื่อสิทธิ: row.pttypename || '',
      เลขปิดสิทธิ์_AuthenCode: row.authencode || '',
      HbA1C: row.result_hba1c || '',
      Potassium: row.result_potassium || '',
      Creatinine: row.result_creatinine || '',
      พร้อมส่ง: row.ready ? 'Y' : 'N',
      สถานะ_MOPH: mophLabel(row.moph),
      Transaction_UID: row.transaction_uid || '',
      หมายเหตุ: row.note || row.missing_reason || '',
    })));
    XLSX.utils.book_append_sheet(workbook, worksheet, 'DMHT MOPH Claim');
    XLSX.writeFile(workbook, `moph-dmht-claim-${startDate}-${endDate}.xlsx`);
  };

  const allDefaultSelected = rows.some(isDefaultSelectable) && rows.filter(isDefaultSelectable).every((row) => selected[rowKey(row)]);
  const disabled = loading || Boolean(actionBusy);

  return (
    <div className="page-container workflow-page">
      <div className="workflow-hero">
        <div className="workflow-hero__content">
          <div>
            <h1 className="page-title workflow-hero__title">MOPH Claim DM/HT Lab</h1>
            <p className="workflow-hero__description">
              ตรวจผู้ป่วย DM/HT ที่มีผลแล็บตามรหัสบริการ MOPH Claim: DM ใช้ HbA1C `32401`,
              HT ใช้ Potassium `32103` หรือ Creatinine `32202`
            </p>
          </div>
          <div className="workflow-hero__meta">
            <span className="workflow-badge workflow-badge--accent">{summary.ready} พร้อมส่ง</span>
            <span className="workflow-badge">{summary.selected} เลือกไว้</span>
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
              <label>โรค</label>
              <select className="form-control" value={diag} onChange={(event) => setDiag(event.target.value)}>
                <option value="ALL">ทั้งหมด</option>
                <option value="DM">DM</option>
                <option value="HT">HT</option>
              </select>
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
            <label className="checkbox-row">
              <input type="checkbox" checked={ucOnly} onChange={(event) => setUcOnly(event.target.checked)} />
              <span>เฉพาะสิทธิ UC</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={authenOnly} onChange={(event) => setAuthenOnly(event.target.checked)} />
              <span>เฉพาะที่มีเลขปิดสิทธิ์/AuthenCode</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={testZone} onChange={(event) => setTestZone(event.target.checked)} />
              <span>TestZone</span>
            </label>
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
        <div className="workflow-stat-card"><span>DM</span><strong>{summary.dm.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>HT</span><strong>{summary.ht.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>ขาดเลขปิดสิทธิ์</span><strong>{summary.missingAuthen.toLocaleString('th-TH')}</strong></div>
        <div className="workflow-stat-card"><span>ส่งแล้ว</span><strong>{summary.sent.toLocaleString('th-TH')}</strong></div>
      </div>

      <div className="card workflow-table-card">
        <div className="card-header workflow-table-header">
          <h3>รายการตรวจสอบ DM/HT MOPH Claim</h3>
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
          <table className="data-table">
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
                <th>แผนก</th>
                <th>คลินิก</th>
                <th>HospMain</th>
                <th>HospSub</th>
                <th>ประเภท</th>
                <th>HbA1C</th>
                <th>Potassium</th>
                <th>Creatinine</th>
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
                const readyWithAuthen = Boolean(row.ready) && hasAuthen(row);
                const sent = isSent(row);
                return (
                  <tr key={key} className={!readyWithAuthen ? 'row-warning' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[key])}
                        disabled={sent || disabled}
                        onChange={() => toggleRow(row)}
                        aria-label={`เลือก ${row.vn} ${row.diag}`}
                      />
                    </td>
                    <td>{index + 1}</td>
                    <td><strong>{sent ? 'Y' : 'N'}</strong></td>
                    <td className="mono">{row.vn}</td>
                    <td className="mono">{row.cid || '-'}</td>
                    <td className="mono">{row.hn || '-'}</td>
                    <td>{row.patient_name || '-'}</td>
                    <td>{formatDate(row.service_date)}</td>
                    <td className={`mono ${hasAuthen(row) ? '' : 'text-danger'}`}>{row.authencode || 'ไม่มีเลขปิดสิทธิ์'}</td>
                    <td>{row.maininscl || '-'}</td>
                    <td>{row.pttypename || '-'}</td>
                    <td>{row.department || '-'}</td>
                    <td>{row.clinic || '-'}</td>
                    <td className="mono">{row.hospmain || '-'}</td>
                    <td className="mono">{row.hospsub || '-'}</td>
                    <td><strong>{row.diag}</strong></td>
                    <td>{yesNo(row.check_hba1c)} {row.result_hba1c || ''}</td>
                    <td>{yesNo(row.check_potassium)} {row.result_potassium || ''}</td>
                    <td>{yesNo(row.check_creatinine)} {row.result_creatinine || ''}</td>
                    <td>{row.note || row.missing_reason || (hasAuthen(row) ? mophLabel(row.moph) : 'ขาดเลขปิดสิทธิ์/AuthenCode')}</td>
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
