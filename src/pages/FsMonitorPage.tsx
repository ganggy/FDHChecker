import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { formatLocalDateInput } from '../utils/dateUtils';

type FsSummary = {
  totalAmount: number;
  itemCount: number;
  visitCount: number;
  patientCount: number;
};

type FsAggregate = {
  key: string;
  label: string;
  amount: number;
  qty: number;
  items: number;
  visitCount: number;
  patientCount: number;
};

type FsDetail = {
  vn: string;
  hn: string;
  serviceDate: string;
  cid: string;
  patientName: string;
  patientPttype: string;
  patientPttypeName: string;
  patientHipdata: string;
  visitPttype: string;
  visitPttypeName: string;
  visitHipdata: string;
  icode: string;
  incomeCode: string;
  incomeName: string;
  fsCode: string;
  serviceKey: string;
  serviceLabel: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  rawAmount: number;
  amount: number;
};

type FsMonitorResponse = {
  success: boolean;
  summary: FsSummary;
  byHipdata: FsAggregate[];
  byPatientPttype: FsAggregate[];
  byVisitPttype: FsAggregate[];
  topServices: FsAggregate[];
  details: FsDetail[];
  message?: string;
  error?: string;
};

const money = (value: number) => `฿${Number(value || 0).toLocaleString('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const numberText = (value: number) => Number(value || 0).toLocaleString('th-TH');

const today = formatLocalDateInput();

export const FsMonitorPage = () => {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<FsMonitorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/hosxp/fs-monitor?startDate=${startDate}&endDate=${endDate}`);
      const result = await response.json() as FsMonitorResponse;
      if (!response.ok || !result.success) {
        throw new Error(result.message || result.error || 'ไม่สามารถโหลดข้อมูลมอนิเตอร์ FS ได้');
      }
      setData(result);
    } catch (err) {
      setData(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data?.summary || { totalAmount: 0, itemCount: 0, visitCount: 0, patientCount: 0 };

  const exportExcel = () => {
    if (!data) return;
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      'วันที่เริ่ม': startDate,
      'วันที่สิ้นสุด': endDate,
      'ยอดเงิน FS': summary.totalAmount,
      'จำนวน Visit': summary.visitCount,
      'จำนวนผู้ป่วย': summary.patientCount,
      'จำนวนรายการ': summary.itemCount,
    }]), 'Summary');

    const aggregateSheet = (rows: FsAggregate[]) => XLSX.utils.json_to_sheet(rows.map((row) => ({
      'รหัส': row.key,
      'ชื่อ': row.label,
      'ยอดเงิน': row.amount,
      'จำนวน Visit': row.visitCount,
      'จำนวนผู้ป่วย': row.patientCount,
      'จำนวนรายการ': row.items,
      'จำนวนรวม': row.qty,
    })));

    XLSX.utils.book_append_sheet(workbook, aggregateSheet(data.byHipdata), 'By Hipdata');
    XLSX.utils.book_append_sheet(workbook, aggregateSheet(data.byPatientPttype), 'By Patient Pttype');
    XLSX.utils.book_append_sheet(workbook, aggregateSheet(data.byVisitPttype), 'By Visit Pttype');
    XLSX.utils.book_append_sheet(workbook, aggregateSheet(data.topServices), 'Top Services');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.details.map((row) => ({
      VN: row.vn,
      HN: row.hn,
      'วันที่รับบริการ': row.serviceDate,
      CID: row.cid,
      'ชื่อผู้ป่วย': row.patientName,
      'HIPDATA คนไข้': row.patientHipdata,
      'สิทธิ์จริง patient.pttype': `${row.patientPttype} ${row.patientPttypeName}`.trim(),
      'HIPDATA Visit': row.visitHipdata,
      'สิทธิ์ Visit': `${row.visitPttype} ${row.visitPttypeName}`.trim(),
      'รหัส FS/ADP': row.fsCode,
      'บริการ': row.serviceLabel,
      'ICODE': row.icode,
      'รายการ': row.itemName,
      'หมวดรายได้': `${row.incomeCode} ${row.incomeName}`.trim(),
      'จำนวน': row.qty,
      'ราคา/หน่วย': row.unitPrice,
      'ยอดตามคู่มือ FS': row.amount,
      'ยอดจริง HOSxP': row.rawAmount,
    }))), 'Details');

    XLSX.writeFile(workbook, `fs-monitor-${startDate}-${endDate}.xlsx`);
  };

  const topSummaryText = useMemo(() => {
    const top = data?.topServices?.[0];
    if (!top) return 'ยังไม่มีรายการ FS ในช่วงวันที่ที่เลือก';
    return `${top.label} ${money(top.amount)} จาก ${numberText(top.visitCount)} visit`;
  }, [data]);

  return (
    <div className="fs-monitor-page">
      <section className="fs-hero">
        <div>
          <span className="fs-eyebrow">Fund Schedule Monitor</span>
          <h1>มอนิเตอร์กองทุน FS</h1>
          <p>
            สรุปรายการ FS โดยนับเฉพาะ ProjectCode/ADP ที่อยู่ในคู่มือ 16 แฟ้มเท่านั้น
            แยกตาม hipdata, สิทธิ์จริงจาก patient.pttype และบริการที่เบิกได้สูงสุด
          </p>
        </div>
        <div className="fs-hero-card">
          <span>Top service</span>
          <strong>{topSummaryText}</strong>
        </div>
      </section>

      <section className="fs-filter-card">
        <label>
          <span>วันที่เริ่ม</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          <span>วันที่สิ้นสุด</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <div className="fs-filter-actions">
          <button className="fs-btn fs-btn-primary" onClick={loadData} disabled={loading}>
            {loading ? 'กำลังโหลด...' : 'ดึงข้อมูล'}
          </button>
          <button className="fs-btn fs-btn-success" onClick={exportExcel} disabled={!data || loading}>
            ส่งออก Excel
          </button>
        </div>
      </section>

      {error && <div className="fs-alert">⚠️ {error}</div>}

      <section className="fs-summary-grid">
        <div className="fs-metric-card fs-metric-card--money">
          <span>ยอดเงิน FS รวม</span>
          <strong>{money(summary.totalAmount)}</strong>
        </div>
        <div className="fs-metric-card">
          <span>จำนวน Visit</span>
          <strong>{numberText(summary.visitCount)}</strong>
        </div>
        <div className="fs-metric-card">
          <span>จำนวนผู้ป่วย</span>
          <strong>{numberText(summary.patientCount)}</strong>
        </div>
        <div className="fs-metric-card">
          <span>จำนวนรายการ</span>
          <strong>{numberText(summary.itemCount)}</strong>
        </div>
      </section>

      <div className="fs-grid-two">
        <AggregateTable title="แยกตาม HIPDATA สิทธิ์จริง" rows={data?.byHipdata || []} />
        <AggregateTable title="แยกตามสิทธิ์จริง patient.pttype" rows={data?.byPatientPttype || []} />
      </div>

      <div className="fs-grid-two">
        <AggregateTable title="แยกตามสิทธิ์ Visit" rows={data?.byVisitPttype || []} />
        <AggregateTable title="Top รายการบริการ FS" rows={data?.topServices || []} />
      </div>

      <section className="fs-table-card">
        <div className="fs-section-title">
          <h2>รายละเอียดรายการ FS</h2>
          <span>{numberText(data?.details.length || 0)} รายการ</span>
        </div>
        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead>
              <tr>
                <th>VN / HN</th>
                <th>ผู้ป่วย</th>
                <th>วันที่</th>
                <th>สิทธิ์จริง</th>
                <th>HIPDATA</th>
                <th>บริการ FS</th>
                <th>รายการ</th>
                <th className="right">จำนวน</th>
                <th className="right">ยอดตามคู่มือ</th>
              </tr>
            </thead>
            <tbody>
              {(data?.details || []).slice(0, 500).map((row, index) => (
                <tr key={`${row.vn}-${row.icode}-${index}`}>
                  <td>
                    <strong>{row.vn}</strong>
                    <small>HN: {row.hn}</small>
                  </td>
                  <td>
                    <strong>{row.patientName || '-'}</strong>
                    <small>{row.cid}</small>
                  </td>
                  <td>{row.serviceDate}</td>
                  <td>
                    <span className="fs-pill">{row.patientPttype || '-'}</span>
                    <small>{row.patientPttypeName}</small>
                  </td>
                  <td>{row.patientHipdata || '-'}</td>
                  <td>
                    <span className="fs-pill fs-pill--blue">{row.serviceLabel}</span>
                    <small>{row.fsCode}</small>
                  </td>
                  <td>{row.itemName}</td>
                  <td className="right">{numberText(row.qty)}</td>
                  <td className="right money">
                    {money(row.amount)}
                    <small>จริง HOSxP {money(row.rawAmount)}</small>
                  </td>
                </tr>
              ))}
              {!data?.details.length && (
                <tr>
                  <td colSpan={9} className="fs-empty">ไม่พบรายการ FS ในช่วงวันที่ที่เลือก</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const AggregateTable = ({ title, rows }: { title: string; rows: FsAggregate[] }) => (
  <section className="fs-table-card">
    <div className="fs-section-title">
      <h2>{title}</h2>
      <span>{numberText(rows.length)} กลุ่ม</span>
    </div>
    <div className="fs-table-wrap fs-table-wrap--compact">
      <table className="fs-table">
        <thead>
          <tr>
            <th>รหัส/กลุ่ม</th>
            <th>ชื่อ</th>
            <th className="right">Visit</th>
            <th className="right">ผู้ป่วย</th>
            <th className="right">รายการ</th>
            <th className="right">ยอดเงิน</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((row) => (
            <tr key={row.key}>
              <td><strong>{row.key}</strong></td>
              <td>{row.label}</td>
              <td className="right">{numberText(row.visitCount)}</td>
              <td className="right">{numberText(row.patientCount)}</td>
              <td className="right">{numberText(row.items)}</td>
              <td className="right money">{money(row.amount)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={6} className="fs-empty">ยังไม่มีข้อมูล</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
);
