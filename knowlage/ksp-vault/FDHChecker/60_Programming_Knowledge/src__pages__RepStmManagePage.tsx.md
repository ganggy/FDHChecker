---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/pages/RepStmManagePage.tsx"
source_hash: "89965cd5c0fca434169af3768fc90123f88ff2be45f643d72e776248297e0d92"
managed_by: "sync-ksp-vault"
---
# RepStmManagePage.tsx

> Source: `src/pages/RepStmManagePage.tsx`
> SHA-256: `89965cd5c0fca434169af3768fc90123f88ff2be45f643d72e776248297e0d92`

````tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RepStmImportDetail } from '../components/RepStmImportDetail';
import {
  deleteRepstmManagementBatch,
  fetchRepstmBatchDetail,
  searchRepstmManagement,
  type RepstmManagedBatch,
  type RepstmManagementSearchResult,
} from '../services/hosxpService';

type ManageType = 'ALL' | 'REP' | 'STM' | 'INV';

const EMPTY_RESULT: RepstmManagementSearchResult = {
  batches: [],
  total: 0,
  totalRows: 0,
  page: 1,
  pageSize: 50,
};

const collectHeaders = (rows: Record<string, unknown>[]) => {
  const headers = new Set<string>();
  rows.slice(0, 100).forEach((row) => Object.keys(row).forEach((key) => headers.add(key)));
  return [...headers];
};

export const RepStmManagePage: React.FC = () => {
  const [dataType, setDataType] = useState<ManageType>('ALL');
  const [query, setQuery] = useState('');
  const [includeReplaced, setIncludeReplaced] = useState(false);
  const [result, setResult] = useState<RepstmManagementSearchResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteBatch, setDeleteBatch] = useState<RepstmManagedBatch | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [detailBatch, setDetailBatch] = useState<RepstmManagedBatch | null>(null);
  const [detailRows, setDetailRows] = useState<Record<string, unknown>[]>([]);
  const [detailHeaders, setDetailHeaders] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const searchRequestId = useRef(0);

  const loadBatches = useCallback(async (page = 1) => {
    const requestId = ++searchRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const data = await searchRepstmManagement({ dataType, query, includeReplaced, page, pageSize: 50 });
      if (requestId !== searchRequestId.current) return;
      setResult(data);
    } catch (err) {
      if (requestId !== searchRequestId.current) return;
      setError(err instanceof Error ? err.message : 'ค้นหา Batch ไม่สำเร็จ');
    } finally {
      if (requestId === searchRequestId.current) setLoading(false);
    }
  }, [dataType, includeReplaced, query]);

  useEffect(() => {
    void loadBatches(1);
  }, [loadBatches]);

  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const expectedConfirmation = useMemo(
    () => deleteBatch ? `DELETE BATCH #${deleteBatch.id}` : '',
    [deleteBatch],
  );
  const canDelete = deleteReason.trim().length >= 3
    && deleteConfirmation.trim().toUpperCase() === expectedConfirmation;

  const openDelete = (batch: RepstmManagedBatch) => {
    setDeleteBatch(batch);
    setDeleteReason('');
    setDeleteConfirmation('');
    setError(null);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteBatch(null);
    setDeleteReason('');
    setDeleteConfirmation('');
  };

  const openBatchDetail = async (batch: RepstmManagedBatch) => {
    setDetailBatch(batch);
    setDetailRows([]);
    setDetailHeaders([]);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const detail = await fetchRepstmBatchDetail(batch.id, 5000);
      const rows = detail.rows.map((row) => ({
        'ลำดับ': row.row_no,
        ...(row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {}),
      }));
      setDetailRows(rows);
      setDetailHeaders(collectHeaders(rows));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'อ่านข้อมูลภายใน Batch ไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteBatch || !canDelete) return;
    setDeleting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await deleteRepstmManagementBatch({
        batchId: deleteBatch.id,
        reason: deleteReason.trim(),
        confirmation: deleteConfirmation.trim(),
      });
      const restoredText = response.data.restoredBatchId
        ? ` และคืน Batch #${response.data.restoredBatchId} กลับมาใช้งาน`
        : '';
      setSuccess(`${response.message}${restoredText}`);
      setDeleteBatch(null);
      setDeleteReason('');
      setDeleteConfirmation('');
      await loadBatches(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบ Batch ไม่สำเร็จ');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page-container repstm-manage-page">
      <div className="page-header repstm-manage-header">
        <div>
          <h1 className="page-title">🗃️ ค้นหาและลบ Batch REP / STM / INV</h1>
          <p className="page-subtitle">แสดงข้อมูลระดับ Batch เท่านั้น จึงค้นหาได้เร็วและลบไฟล์ที่นำเข้าผิดได้ทั้งชุด</p>
        </div>
        <span className="badge badge-warning">Admin only</span>
      </div>

      {error && !deleteBatch ? <div className="alert alert-danger"><span>⚠️</span><span>{error}</span></div> : null}
      {success ? <div className="alert alert-success"><span>✅</span><span>{success}</span></div> : null}

      <div className="card repstm-manage-search-card">
        <form className="repstm-manage-search-form" onSubmit={(event) => { event.preventDefault(); void loadBatches(1); }}>
          <label>
            <span>ประเภทข้อมูล</span>
            <select className="form-control" value={dataType} onChange={(event) => setDataType(event.target.value as ManageType)}>
              <option value="ALL">ทั้งหมด</option>
              <option value="REP">REP</option>
              <option value="STM">STM</option>
              <option value="INV">INV</option>
            </select>
          </label>
          <label className="repstm-manage-query-field">
            <span>ค้นหา Batch</span>
            <input
              className="form-control"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="เลข Batch, ชื่อไฟล์, Sheet, ผู้นำเข้า หรือหมายเหตุ"
            />
          </label>
          <label className="repstm-manage-replaced-option">
            <input type="checkbox" checked={includeReplaced} onChange={(event) => setIncludeReplaced(event.target.checked)} />
            <span>รวม Batch เก่าที่ถูกแทน</span>
          </label>
          <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'กำลังค้นหา...' : 'ค้นหา'}</button>
        </form>
      </div>

      <div className="repstm-manage-summary-grid repstm-manage-summary-grid--batch">
        <div className="card"><span>พบทั้งหมด</span><strong>{result.total.toLocaleString('th-TH')}</strong><small>Batch</small></div>
        <div className="card"><span>ข้อมูลรวม</span><strong>{result.totalRows.toLocaleString('th-TH')}</strong><small>แถว</small></div>
      </div>

      <div className="card repstm-manage-results-card">
        <div className="card-header">
          <div>
            <div className="card-title">รายการ Batch ที่นำเข้า</div>
            <small className="repstm-manage-muted">การลบจะลบข้อมูล REP/STM/INV ทุกแถวที่อยู่ใน Batch เดียวกัน</small>
          </div>
          <span className="badge badge-info">หน้า {result.page.toLocaleString('th-TH')} / {pageCount.toLocaleString('th-TH')}</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="modal-table-wrap repstm-table-shell">
            <table className="data-table repstm-manage-table repstm-manage-batch-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>ประเภท</th>
                  <th>ชื่อไฟล์</th>
                  <th>Sheet</th>
                  <th>จำนวนแถว</th>
                  <th>ผู้นำเข้า</th>
                  <th>หมายเหตุ</th>
                  <th>วันที่นำเข้า</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {result.batches.map((batch) => (
                  <tr key={batch.id}>
                    <td><strong>#{batch.id}</strong>{batch.replaces_batch_id ? <small>แทน #{batch.replaces_batch_id}</small> : null}</td>
                    <td><span className="badge badge-primary">{batch.data_type}</span>{batch.is_replaced ? <span className="badge badge-warning">ถูกแทนแล้ว</span> : null}</td>
                    <td><div className="repstm-file-name" title={batch.source_filename}>{batch.source_filename}</div></td>
                    <td>{batch.sheet_name || '-'}</td>
                    <td className="workflow-money-cell">{Number(batch.row_count || 0).toLocaleString('th-TH')}</td>
                    <td>{batch.imported_by || '-'}</td>
                    <td className="repstm-message-cell">{batch.notes || '-'}</td>
                    <td className="table-cell-nowrap">{String(batch.created_at || '-')}</td>
                    <td>
                      <div className="repstm-manage-actions">
                        <button className="btn btn-secondary" type="button" onClick={() => void openBatchDetail(batch)}>ดูข้อมูล</button>
                        <button className="btn btn-danger" type="button" onClick={() => openDelete(batch)}>ลบทั้ง Batch</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && result.batches.length === 0 ? <tr><td colSpan={9} className="empty-cell">ไม่พบ Batch ตามเงื่อนไข</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="repstm-manage-pagination">
            <button className="btn btn-secondary" type="button" disabled={loading || result.page <= 1} onClick={() => void loadBatches(result.page - 1)}>ก่อนหน้า</button>
            <span>หน้า {result.page.toLocaleString('th-TH')} / {pageCount.toLocaleString('th-TH')}</span>
            <button className="btn btn-secondary" type="button" disabled={loading || result.page >= pageCount} onClick={() => void loadBatches(result.page + 1)}>ถัดไป</button>
          </div>
        </div>
      </div>

      {detailBatch ? (
        <RepStmImportDetail
          title={`${detailBatch.data_type} · Batch #${detailBatch.id}`}
          subtitle={`${detailBatch.source_filename} · แสดง ${detailRows.length.toLocaleString('th-TH')} จาก ${Number(detailBatch.row_count || 0).toLocaleString('th-TH')} แถว`}
          importerType={detailBatch.data_type}
          headers={detailHeaders}
          rows={detailRows}
          loading={detailLoading}
          error={detailError}
          onClose={() => {
            setDetailBatch(null);
            setDetailRows([]);
            setDetailHeaders([]);
            setDetailError(null);
          }}
        />
      ) : null}

      {deleteBatch ? (
        <div className="repstm-delete-backdrop" role="presentation" onMouseDown={closeDelete}>
          <section className="repstm-delete-dialog" role="dialog" aria-modal="true" aria-label="ยืนยันการลบ Batch" onMouseDown={(event) => event.stopPropagation()}>
            <div className="repstm-delete-icon">⚠️</div>
            <h2>ลบ Batch #{deleteBatch.id}</h2>
            <p><strong>{deleteBatch.source_filename}</strong><br />ข้อมูล {Number(deleteBatch.row_count || 0).toLocaleString('th-TH')} แถวจะถูกลบทั้งชุด ไม่สามารถเลือกลบเป็นรายคนได้</p>
            {error ? <div className="alert alert-danger"><span>⚠️</span><span>{error}</span></div> : null}
            <label>
              <span>เหตุผลในการลบ</span>
              <textarea className="form-control" rows={3} maxLength={500} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="เช่น นำเข้าไฟล์ผิดงวด หรือเลือกประเภทข้อมูลผิด" />
            </label>
            <label>
              <span>พิมพ์ <code>{expectedConfirmation}</code> เพื่อยืนยัน</span>
              <input className="form-control" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" />
            </label>
            <div className="repstm-delete-actions">
              <button className="btn btn-secondary" type="button" disabled={deleting} onClick={closeDelete}>ยกเลิก</button>
              <button className="btn btn-danger" type="button" disabled={!canDelete || deleting} onClick={() => void confirmDelete()}>{deleting ? 'กำลังลบ...' : 'ยืนยันลบทั้ง Batch'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};

````
