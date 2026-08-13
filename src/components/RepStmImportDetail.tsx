import React, { useEffect, useMemo, useState } from 'react';

interface ArchiveEntry {
  name: string;
  size: number;
  kind: string;
}

interface RepStmImportDetailProps {
  title: string;
  subtitle?: string;
  importerType?: string;
  importerLabel?: string;
  headers: string[];
  rows: Record<string, unknown>[];
  summaries?: Record<string, unknown>[];
  archiveEntries?: ArchiveEntry[];
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}

const SUMMARY_LABELS: Record<string, string> = {
  accountId: 'ระบบบัญชี',
  hcode: 'รหัสหน่วยบริการ',
  hospitalName: 'หน่วยบริการ',
  accountingPeriod: 'งวดบัญชี',
  statementNo: 'เลขที่เอกสาร',
  detailDocument: 'เอกสารรายละเอียด',
  dateStart: 'เริ่มงวด',
  dateEnd: 'สิ้นสุดงวด',
  dateDue: 'กำหนดตอบกลับ',
  dateIssue: 'วันที่ออกเอกสาร',
  fundCode: 'รหัสกองทุน',
  fundName: 'ชื่อกองทุน',
  description: 'ประเภทบริการ',
  rowCount: 'จำนวนรายการ',
  totalAmount: 'ยอดรวม',
};

const formatSummaryValue = (key: string, value: unknown) => {
  if (key === 'totalAmount') return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (key === 'rowCount') return Number(value || 0).toLocaleString('th-TH');
  return String(value ?? '-');
};

const buildSearchText = (row: Record<string, unknown>) => Object.values(row)
  .map((value) => String(value ?? ''))
  .join(' ')
  .toLowerCase();

export const RepStmImportDetail: React.FC<RepStmImportDetailProps> = ({
  title,
  subtitle,
  importerType,
  importerLabel,
  headers,
  rows,
  summaries = [],
  archiveEntries = [],
  loading = false,
  error,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => buildSearchText(row).includes(query));
  }, [rows, search]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleHeaders = headers.length > 0 ? headers : Object.keys(rows[0] || {});

  return (
    <div className="repstm-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="repstm-detail-page" role="dialog" aria-modal="true" aria-label="รายละเอียดชุดนำเข้า" onMouseDown={(event) => event.stopPropagation()}>
        <header className="repstm-detail-header">
          <div>
            <div className="repstm-detail-kicker">รายละเอียดชุดนำเข้า</div>
            <h2>{title}</h2>
            <p>{subtitle || 'ตรวจข้อมูลต้นทางก่อนนำเข้าและตรวจสอบย้อนหลังได้จากหน้าจอนี้'}</p>
          </div>
          <div className="repstm-detail-header-actions">
            {importerType ? <span className="badge badge-primary">ตัวนำเข้า {importerType}</span> : null}
            {importerLabel ? <span className="badge badge-info">{importerLabel}</span> : null}
            <button type="button" className="btn btn-secondary" onClick={onClose}>ปิด</button>
          </div>
        </header>

        {loading ? <div className="repstm-detail-state">กำลังอ่านรายละเอียด...</div> : null}
        {error ? <div className="alert alert-danger"><span>⚠️</span><span>{error}</span></div> : null}

        {!loading && !error && summaries.length > 0 ? (
          <div className="repstm-detail-summary-grid">
            {summaries.map((summary, index) => (
              <article className="repstm-detail-summary-card" key={`${String(summary.entryName || 'summary')}-${index}`}>
                <div className="repstm-detail-summary-title">
                  {summary.documentKind === 'summary' ? 'เอกสารสรุป' : 'เอกสารรายละเอียด'}
                  <small>{String(summary.entryName || '')}</small>
                </div>
                <div className="repstm-detail-summary-fields">
                  {Object.entries(SUMMARY_LABELS).map(([key, label]) => {
                    const value = summary[key];
                    if (value == null || value === '') return null;
                    return (
                      <div key={key}>
                        <span>{label}</span>
                        <strong>{formatSummaryValue(key, value)}</strong>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {!loading && !error && archiveEntries.length > 0 ? (
          <details className="repstm-detail-archive">
            <summary>ไฟล์ทั้งหมดใน ZIP ({archiveEntries.length.toLocaleString('th-TH')} ไฟล์)</summary>
            <div className="repstm-detail-entry-list">
              {archiveEntries.map((entry) => (
                <div key={entry.name}>
                  <span>{entry.name}</span>
                  <small>{entry.kind} · {Number(entry.size || 0).toLocaleString('th-TH')} bytes</small>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {!loading && !error ? (
          <div className="repstm-detail-data-card">
            <div className="repstm-detail-toolbar">
              <div>
                <strong>ข้อมูลรายการ</strong>
                <span>{filteredRows.length.toLocaleString('th-TH')} จาก {rows.length.toLocaleString('th-TH')} แถว</span>
              </div>
              <input
                className="form-control"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="ค้นหา HN, ชื่อ, เลขเอกสาร หรือจำนวนเงิน"
              />
            </div>
            <div className="repstm-detail-table-wrap">
              <table className="data-table repstm-detail-table">
                <thead><tr>{visibleHeaders.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                <tbody>
                  {visibleRows.map((row, index) => (
                    <tr key={`${String(row.id || row['ลำดับ'] || index)}-${index}`}>
                      {visibleHeaders.map((header) => <td key={`${header}-${index}`}>{String(row[header] ?? '-')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleRows.length === 0 ? <div className="repstm-detail-empty">ไม่พบข้อมูลตามคำค้น</div> : null}
            </div>
            <div className="repstm-detail-pagination">
              <button className="btn btn-secondary" type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</button>
              <span>หน้า {currentPage.toLocaleString('th-TH')} / {pageCount.toLocaleString('th-TH')}</span>
              <button className="btn btn-secondary" type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>ถัดไป</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
};
