import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

type ImportStatus = 'idle' | 'parsing' | 'ready' | 'importing' | 'success' | 'duplicate' | 'error';

interface ClaimDetailBatch {
  id: number;
  source_filename: string;
  sheet_name?: string;
  imported_by?: string;
  row_count: number;
  op_count: number;
  ip_count: number;
  notes?: string;
  created_at: string;
}

interface ClaimDetailRow {
  claim_code?: string;
  hn?: string;
  vn?: string;
  an?: string;
  patient_type?: string;
  discharge_datetime?: string;
  sent_at?: string;
  upload_uid?: string;
  maininscl?: string;
  claim_status?: string;
}

interface ClaimDetailSummary {
  batch_count?: number;
  batch_row_total?: number;
  batch_op_total?: number;
  batch_ip_total?: number;
  latest_import_at?: string;
  row_total?: number;
  op_total?: number;
  ip_total?: number;
  distinct_claim_total?: number;
  distinct_upload_total?: number;
  status_counts?: Array<{ claim_status: string; total: number }>;
}

const normalizeCell = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const numberTh = (value: unknown) => Number(value || 0).toLocaleString('th-TH');

const isHeaderRow = (row: unknown[]) => {
  const text = row.map(normalizeCell).join('|');
  const signals = ['รหัสการเคลม', 'HN', 'รหัสบริการ (SEQ)', 'รหัสผู้ป่วยใน (AN)', 'ประเภทผู้ป่วย', 'สถานะรายการเคลม'];
  return signals.filter((signal) => text.includes(signal)).length >= 4;
};

const parseClaimDetailWorkbook = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes('claimdetail')) || workbook.SheetNames[0];
  if (!sheetName) throw new Error('ไม่พบ sheet ในไฟล์');

  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  const headerIndex = grid.findIndex((row) => Array.isArray(row) && isHeaderRow(row));
  if (headerIndex < 0) {
    throw new Error('ไม่พบ header ของ FDH ClaimDetail กรุณาใช้ไฟล์ export จากหน้า FDH');
  }

  const headers = grid[headerIndex].map(normalizeCell);
  const activeIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header);

  const rows = grid
    .slice(headerIndex + 1)
    .filter((row) => Array.isArray(row) && row.some((cell) => normalizeCell(cell)))
    .map((row) => Object.fromEntries(activeIndexes.map(({ header, index }) => [header, normalizeCell(row[index])])))
    .filter((row) => row['รหัสการเคลม'] || row['HN'] || row['รหัสบริการ (SEQ)'] || row['รหัสผู้ป่วยใน (AN)']);

  return { sheetName, headers: activeIndexes.map(({ header }) => header), rows };
};

const statusTone = (status: ImportStatus) => {
  if (status === 'success') return 'insurance-status insurance-status--success';
  if (status === 'duplicate') return 'insurance-status insurance-status--warning';
  if (status === 'error') return 'insurance-status insurance-status--danger';
  if (status === 'ready') return 'insurance-status insurance-status--success';
  return 'insurance-status insurance-status--muted';
};

export const FdhClaimDetailImportPage = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [message, setMessage] = useState('');
  const [importedBy, setImportedBy] = useState('เปรมศักดิ์ เทพวงสา');
  const [notes, setNotes] = useState('');
  const [batches, setBatches] = useState<ClaimDetailBatch[]>([]);
  const [importedRows, setImportedRows] = useState<ClaimDetailRow[]>([]);
  const [dbSummary, setDbSummary] = useState<ClaimDetailSummary | null>(null);

  const summary = useMemo(() => {
    const statusCounts = rows.reduce<Record<string, number>>((acc, row) => {
      const key = normalizeCell(row['สถานะรายการเคลม']) || '(ว่าง)';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const opCount = rows.filter((row) => normalizeCell(row['ประเภทผู้ป่วย']).toUpperCase().startsWith('OP')).length;
    const ipCount = rows.filter((row) => normalizeCell(row['ประเภทผู้ป่วย']).toUpperCase().startsWith('IP')).length;
    return { statusCounts, opCount, ipCount };
  }, [rows]);

  const loadHistory = async () => {
    const [batchRes, rowRes, summaryRes] = await Promise.all([
      fetch('/api/fdh/claim-detail/batches?limit=20'),
      fetch('/api/fdh/claim-detail/rows?limit=100'),
      fetch('/api/fdh/claim-detail/summary'),
    ]);
    const batchJson = await batchRes.json();
    const rowJson = await rowRes.json();
    const summaryJson = await summaryRes.json();
    if (batchJson.success) setBatches(batchJson.data || []);
    if (rowJson.success) setImportedRows(rowJson.data || []);
    if (summaryJson.success) setDbSummary(summaryJson.data || null);
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const handleFile = async (file: File) => {
    try {
      setStatus('parsing');
      setMessage('');
      const parsed = await parseClaimDetailWorkbook(file);
      setFileName(file.name);
      setSheetName(parsed.sheetName);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setStatus('ready');
      setMessage(`อ่านไฟล์สำเร็จ ${parsed.rows.length.toLocaleString('th-TH')} รายการ`);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'อ่านไฟล์ไม่สำเร็จ');
      setRows([]);
      setHeaders([]);
    }
  };

  const handleImport = async () => {
    if (!fileName || rows.length === 0) return;
    try {
      setStatus('importing');
      setMessage('กำลังนำเข้า FDH ClaimDetail...');
      const response = await fetch('/api/fdh/claim-detail/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFilename: fileName, sheetName, importedBy, notes, rows }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'นำเข้าไม่สำเร็จ');
      setStatus(json.duplicate ? 'duplicate' : 'success');
      setMessage(json.message || `นำเข้าสำเร็จ ${Number(json.rowCount || rows.length).toLocaleString('th-TH')} รายการ`);
      await loadHistory();
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'นำเข้าไม่สำเร็จ');
    }
  };

  return (
    <div className="workflow-page insurance-page">
      <div className="page-header insurance-hero">
        <h1 className="page-title">นำเข้า ClaimDetail จาก FDH</h1>
        <p className="page-subtitle">เก็บไฟล์ส่งออกจาก Financial Data Hub ทั้ง OP/IP เพื่อเทียบสถานะการส่งเบิกกับข้อมูล HOSxP, REP และ STM</p>
      </div>

      <section className="card workflow-panel">
        <div className="card-body">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <div className="workflow-filter-grid">
            <div className="form-group">
              <label>ไฟล์ FDH ClaimDetail</label>
              <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()}>
                เลือกไฟล์ Excel จาก FDH
              </button>
              <small>{fileName || 'รองรับไฟล์ 11101-NHSO-ClaimDetail.xlsx'}</small>
              <small style={{ display: 'block', marginTop: 6, color: '#64748b' }}>
                ระบบตรวจซ้ำจากเนื้อหาในไฟล์ ไม่ได้ดูแค่ชื่อไฟล์ หากชื่อเดิมแต่สถานะในไฟล์เปลี่ยน จะนำเข้าเป็นรอบใหม่ได้
              </small>
            </div>
            <div className="form-group">
              <label>ผู้นำเข้า</label>
              <input className="form-control" value={importedBy} onChange={(event) => setImportedBy(event.target.value)} />
            </div>
            <div className="form-group">
              <label>หมายเหตุ</label>
              <input className="form-control" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="เช่น รอบส่งเคลมปลายเดือน" />
            </div>
            <div className="workflow-filter-actions">
              <button className="btn btn-success" onClick={handleImport} disabled={status !== 'ready' && status !== 'duplicate' && status !== 'success'}>
                {status === 'importing' ? 'กำลังนำเข้า...' : 'นำเข้าไฟล์'}
              </button>
            </div>
          </div>
          {message && <div style={{ marginTop: 12 }}><span className={statusTone(status)}>{message}</span></div>}
        </div>
      </section>

      <div className="insurance-kpi-grid">
        <div className="insurance-kpi-card insurance-kpi-card--blue">
          <span>นำเข้าสะสมทั้งหมด</span>
          <strong>{numberTh(dbSummary?.row_total)}</strong>
          <small>จาก {numberTh(dbSummary?.batch_count)} รอบนำเข้า</small>
        </div>
        <div className="insurance-kpi-card insurance-kpi-card--green">
          <span>OP สะสมในฐาน</span>
          <strong>{numberTh(dbSummary?.op_total)}</strong>
          <small>ใช้เทียบ SEQ/VN</small>
        </div>
        <div className="insurance-kpi-card insurance-kpi-card--teal">
          <span>IP สะสมในฐาน</span>
          <strong>{numberTh(dbSummary?.ip_total)}</strong>
          <small>ใช้เทียบ AN</small>
        </div>
        <div className="insurance-kpi-card insurance-kpi-card--amber">
          <span>Claim ไม่ซ้ำ</span>
          <strong>{numberTh(dbSummary?.distinct_claim_total)}</strong>
          <small>Upload UID {numberTh(dbSummary?.distinct_upload_total)}</small>
        </div>
        <div className="insurance-kpi-card insurance-kpi-card--slate">
          <span>นำเข้าล่าสุด</span>
          <strong style={{ fontSize: '1.1rem' }}>{dbSummary?.latest_import_at || '-'}</strong>
          <small>ยอดตามฐานข้อมูลปัจจุบัน</small>
        </div>
        {(dbSummary?.status_counts || []).slice(0, 1).map((item) => (
          <div className="insurance-kpi-card insurance-kpi-card--rose" key={item.claim_status}>
            <span>สถานะมากสุด</span>
            <strong>{numberTh(item.total)}</strong>
            <small>{item.claim_status || '-'}</small>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <>
          <div className="insurance-kpi-grid">
            <div className="insurance-kpi-card insurance-kpi-card--blue">
              <span>รายการทั้งหมด</span>
              <strong>{numberTh(rows.length)}</strong>
              <small>Sheet: {sheetName}</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--green">
              <span>ผู้ป่วยนอก OP</span>
              <strong>{numberTh(summary.opCount)}</strong>
              <small>เทียบด้วย SEQ/VN</small>
            </div>
            <div className="insurance-kpi-card insurance-kpi-card--teal">
              <span>ผู้ป่วยใน IP</span>
              <strong>{numberTh(summary.ipCount)}</strong>
              <small>เทียบด้วย AN</small>
            </div>
            {Object.entries(summary.statusCounts).slice(0, 3).map(([claimStatus, value]) => (
              <div className="insurance-kpi-card insurance-kpi-card--amber" key={claimStatus}>
                <span>{claimStatus}</span>
                <strong>{numberTh(value)}</strong>
                <small>สถานะจาก FDH</small>
              </div>
            ))}
          </div>

          <section className="card workflow-table-card">
            <div className="card-header">
              <span className="workflow-table-title">ตัวอย่างข้อมูลในไฟล์</span>
              <span className="workflow-table-meta">{headers.length} คอลัมน์</span>
            </div>
            <div className="modal-table-wrap">
              <table className="data-table workflow-readable-table insurance-ipd-lag-table">
                <thead>
                  <tr>
                    <th>รหัสเคลม</th>
                    <th>HN</th>
                    <th>SEQ/VN</th>
                    <th>AN</th>
                    <th>ประเภท</th>
                    <th>D/C</th>
                    <th>วันที่ส่ง สปสช.</th>
                    <th>Upload UID</th>
                    <th>สถานะ FDH</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((row, index) => (
                    <tr key={`${row['รหัสการเคลม'] || index}`}>
                      <td className="workflow-id-cell">{normalizeCell(row['รหัสการเคลม']) || '-'}</td>
                      <td>{normalizeCell(row.HN) || '-'}</td>
                      <td>{normalizeCell(row['รหัสบริการ (SEQ)']) || '-'}</td>
                      <td>{normalizeCell(row['รหัสผู้ป่วยใน (AN)']) || '-'}</td>
                      <td>{normalizeCell(row['ประเภทผู้ป่วย']) || '-'}</td>
                      <td>{normalizeCell(row['วันจำหน่ายออก']) || '-'}</td>
                      <td>{normalizeCell(row['วันที่ส่งหา สปสช.']) || '-'}</td>
                      <td className="workflow-id-cell">{normalizeCell(row['upload uid']) || '-'}</td>
                      <td><span className="insurance-status insurance-status--success">{normalizeCell(row['สถานะรายการเคลม']) || '-'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="insurance-split-grid">
        <div className="card workflow-table-card">
          <div className="card-header">
            <span className="workflow-table-title">ประวัตินำเข้า FDH ClaimDetail</span>
          </div>
          <div className="modal-table-wrap">
            <table className="data-table workflow-readable-table insurance-account-table">
              <thead>
                <tr>
                  <th>ไฟล์</th>
                  <th>รายการ</th>
                  <th>OP/IP</th>
                  <th>วันที่นำเข้า</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.source_filename}</td>
                    <td>{Number(batch.row_count || 0).toLocaleString('th-TH')}</td>
                    <td>OP {Number(batch.op_count || 0).toLocaleString('th-TH')} / IP {Number(batch.ip_count || 0).toLocaleString('th-TH')}</td>
                    <td>{batch.created_at}</td>
                  </tr>
                ))}
                {batches.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20 }}>ยังไม่มีประวัตินำเข้า</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card workflow-table-card">
          <div className="card-header">
            <span className="workflow-table-title">รายการล่าสุดที่นำเข้า</span>
          </div>
          <div className="modal-table-wrap">
            <table className="data-table workflow-readable-table insurance-missing-table">
              <thead>
                <tr>
                  <th>HN</th>
                  <th>VN/AN</th>
                  <th>ประเภท</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {importedRows.slice(0, 20).map((row, index) => (
                  <tr key={`${row.claim_code || index}`}>
                    <td>{row.hn || '-'}</td>
                    <td>{row.an || row.vn || '-'}</td>
                    <td>{row.patient_type || '-'}</td>
                    <td><span className="insurance-status insurance-status--success">{row.claim_status || '-'}</span></td>
                  </tr>
                ))}
                {importedRows.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20 }}>ยังไม่มีรายการนำเข้า</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
};
