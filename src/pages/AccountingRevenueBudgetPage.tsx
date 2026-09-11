import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { formatLocalDateInput } from '../utils/dateUtils';
import './AccountingRevenueBudgetPage.css';

type RightDetail = { pttype: string; name: string; hipdata_code: string; service_count: number; adjrw: number; actual_charge: number; mapped_by: string };
type RevenueRow = { key: string; account_code: string; label: string; service_count: number; adjrw: number; actual_charge: number; rights: RightDetail[] };
type Report = {
  startDate: string; endDate: string; opd: RevenueRow[]; ipd: RevenueRow[];
  audit: { opd_source_count: number; opd_grouped_count: number; ipd_source_count: number; ipd_grouped_count: number; opd_balanced: boolean; ipd_balanced: boolean; fallback_rights: RightDetail[] };
  notes: string[];
};

type Rates = Record<string, number>;
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value: unknown) => number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = (value: unknown, digits = 0) => number(value).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fiscalDefaults = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const currentFiscalYear = year + (month >= 10 ? 544 : 543);
  const startYear = month >= 10 ? year : year - 1;
  return { startDate: `${startYear}-10-01`, endDate: formatLocalDateInput(), targetYear: currentFiscalYear + 1 };
};

const createWorksheet = (title: string, year: number, rows: RevenueRow[], rates: Rates, type: 'opd' | 'ipd') => {
  const quantityHeader = type === 'opd' ? 'OP Visit' : 'SumAdjRW';
  const rateHeader = type === 'opd' ? 'Charge Per Visit' : 'Charge Per RW';
  const grid: Array<Array<string | number>> = [
    ['11000', '', '', `ปี ${year}`],
    ['Revenue', '', '', 'ประมาณการ'],
    ['รหัส', title, quantityHeader, rateHeader, 'Total Charge', 'ค่ารักษา HOSxP (อ้างอิง)'],
    ...rows.map((row) => {
      const base = type === 'opd' ? row.service_count : row.adjrw;
      const rate = number(rates[row.account_code]);
      return [row.account_code, row.label, base, rate, base * rate, row.actual_charge];
    }),
  ];
  const totalBase = rows.reduce((sum, row) => sum + (type === 'opd' ? row.service_count : row.adjrw), 0);
  grid.push([type === 'opd' ? '41111' : '42111', `รวม${title}`, totalBase, '', rows.reduce((sum, row) => sum + (type === 'opd' ? row.service_count : row.adjrw) * number(rates[row.account_code]), 0), rows.reduce((sum, row) => sum + row.actual_charge, 0)]);
  const sheet = XLSX.utils.aoa_to_sheet(grid);
  sheet['!cols'] = [{ wch: 12 }, { wch: 50 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 24 }];
  return sheet;
};

export const AccountingRevenueBudgetPage = () => {
  const defaults = useMemo(fiscalDefaults, []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [targetYear, setTargetYear] = useState(defaults.targetYear);
  const [report, setReport] = useState<Report | null>(null);
  const [rates, setRates] = useState<Rates>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try { setRates(JSON.parse(localStorage.getItem(`accounting-revenue-rates-${targetYear}`) || '{}')); }
    catch { setRates({}); }
  }, [targetYear]);

  const loadReport = async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`/api/accounting/revenue-budget?${params}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'โหลดรายงานไม่สำเร็จ');
      setReport(json.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'โหลดรายงานไม่สำเร็จ'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadReport(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRate = (code: string, value: string) => {
    const next = { ...rates, [code]: Math.max(0, number(value)) };
    setRates(next);
    localStorage.setItem(`accounting-revenue-rates-${targetYear}`, JSON.stringify(next));
  };

  const exportExcel = () => {
    if (!report) return;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, createWorksheet('รายได้ค่ารักษา OP', targetYear, report.opd, rates, 'opd'), 'OPD');
    XLSX.utils.book_append_sheet(workbook, createWorksheet('รายได้ค่ารักษา IP', targetYear, report.ipd, rates, 'ipd'), 'IPD');
    const audit = XLSX.utils.json_to_sheet([
      { รายการ: 'OPD ยอดต้นทาง', ค่า: report.audit.opd_source_count }, { รายการ: 'OPD ยอดจัดกลุ่ม', ค่า: report.audit.opd_grouped_count },
      { รายการ: 'IPD ยอดต้นทาง', ค่า: report.audit.ipd_source_count }, { รายการ: 'IPD ยอดจัดกลุ่ม', ค่า: report.audit.ipd_grouped_count },
      ...report.audit.fallback_rights.map((right) => ({ รายการ: `สิทธิยังไม่จับคู่ ${right.pttype}`, ค่า: right.name || right.hipdata_code })),
    ]);
    XLSX.utils.book_append_sheet(workbook, audit, 'ตรวจสอบ');
    XLSX.writeFile(workbook, `revenue-budget-11000-${targetYear}-${startDate}-${endDate}.xlsx`);
  };

  const renderTable = (rows: RevenueRow[], type: 'opd' | 'ipd') => {
    const baseFor = (row: RevenueRow) => type === 'opd' ? row.service_count : row.adjrw;
    const totalEstimate = rows.reduce((sum, row) => sum + baseFor(row) * number(rates[row.account_code]), 0);
    return (
      <section className="revenue-budget-card">
        <h2>{type === 'opd' ? '1 OPD' : '2 IPD'}</h2>
        <div className="revenue-budget-table-wrap">
          <table>
            <thead><tr><th>รหัส</th><th>รายการรายได้</th><th>{type === 'opd' ? 'OP Visit' : 'SumAdjRW'}</th><th>{type === 'opd' ? 'Charge Per Visit' : 'Charge Per RW'}</th><th>Total Charge</th><th>ค่ารักษา HOSxP</th><th>ตรวจสอบสิทธิ</th></tr></thead>
            <tbody>{rows.map((row) => {
              const base = baseFor(row); const rate = number(rates[row.account_code]);
              return <tr key={row.account_code}>
                <td className="revenue-budget-code">{row.account_code}</td><td>{row.label}</td><td className="num">{quantity(base, type === 'ipd' ? 4 : 0)}</td>
                <td><input aria-label={`อัตรา ${row.account_code}`} type="number" min="0" step="0.01" value={rates[row.account_code] ?? ''} placeholder="0.00" onChange={(event) => updateRate(row.account_code, event.target.value)} /></td>
                <td className="num strong">{money(base * rate)}</td><td className="num reference">{money(row.actual_charge)}</td>
                <td><details><summary>{row.rights.length} สิทธิ</summary><div className="right-detail">{row.rights.length ? row.rights.map((right) => <div key={`${row.account_code}-${right.pttype}`}><b>{right.pttype || '-'}</b> {right.name || right.hipdata_code || 'ไม่ระบุชื่อ'} <span>{right.mapped_by === 'fallback' ? 'ต้องตรวจจับคู่' : quantity(type === 'opd' ? right.service_count : right.adjrw, type === 'ipd' ? 4 : 0)}</span></div>) : 'ไม่มีข้อมูล'}</div></details></td>
              </tr>;
            })}</tbody>
            <tfoot><tr><td>{type === 'opd' ? '41111' : '42111'}</td><td>รวมรายได้ค่ารักษา {type.toUpperCase()}</td><td className="num">{quantity(rows.reduce((sum, row) => sum + baseFor(row), 0), type === 'ipd' ? 4 : 0)}</td><td></td><td className="num">{money(totalEstimate)}</td><td className="num">{money(rows.reduce((sum, row) => sum + row.actual_charge, 0))}</td><td></td></tr></tfoot>
          </table>
        </div>
      </section>
    );
  };

  return <main className="accounting-revenue-page">
    <header className="revenue-budget-hero"><div><span className="eyebrow">การเงิน / บัญชี</span><h1>ประมาณการรายได้ 11000</h1><p>จัดกลุ่มสิทธิจาก HOSxP และคำนวณตามแบบฟอร์มบัญชี พร้อมตรวจยอดย้อนกลับถึงข้อมูลต้นทาง</p></div><div className="budget-year"><label>ปีงบประมาณ</label><input type="number" min="2500" max="2700" value={targetYear} onChange={(event) => setTargetYear(number(event.target.value))} /></div></header>
    <section className="revenue-budget-controls no-print"><label>วันที่เริ่ม<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>วันที่สิ้นสุด<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><button type="button" onClick={() => void loadReport()} disabled={loading}>{loading ? 'กำลังตรวจสอบ...' : 'ดึงข้อมูลและตรวจยอด'}</button><button type="button" className="secondary" onClick={exportExcel} disabled={!report}>ส่งออก Excel</button></section>
    {error && <div className="revenue-budget-error">{error}</div>}
    {report && <>
      <section className={`revenue-budget-audit ${report.audit.opd_balanced && report.audit.ipd_balanced ? 'ok' : 'bad'}`}>
        <b>{report.audit.opd_balanced && report.audit.ipd_balanced ? '✓ ยอดจัดกลุ่มครบ' : '⚠ ยอดจัดกลุ่มไม่สมดุล'}</b>
        <span>OPD {quantity(report.audit.opd_grouped_count)}/{quantity(report.audit.opd_source_count)}</span><span>IPD {quantity(report.audit.ipd_grouped_count)}/{quantity(report.audit.ipd_source_count)}</span>
        <span className={report.audit.fallback_rights.length ? 'warn' : ''}>สิทธิที่ต้องตรวจจับคู่ {report.audit.fallback_rights.length} รายการ</span>
      </section>
      {renderTable(report.opd, 'opd')}{renderTable(report.ipd, 'ipd')}
      <section className="revenue-budget-notes"><h3>หลักการตรวจสอบ</h3>{report.notes.map((note) => <p key={note}>• {note}</p>)}<p>• Total Charge = OP Visit × Charge Per Visit หรือ SumAdjRW × Charge Per RW; ช่องว่างและค่าที่ไม่ใช่ตัวเลขใช้ 0 จึงไม่เกิด #VALUE!</p></section>
    </>}
  </main>;
};
