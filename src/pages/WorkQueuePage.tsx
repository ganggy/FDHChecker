import { useState, useEffect, useCallback } from 'react';
import { formatLocalDateDaysAgo, formatLocalDateInput } from '../utils/dateUtils';

const QUEUE_STATUSES: Array<{ value: string; label: string; color: string }> = [
  { value: 'pending_mr', label: 'รอแก้เวชระเบียน', color: '#f59e0b' },
  { value: 'pending_authen', label: 'รอ Authen Code', color: '#8b5cf6' },
  { value: 'pending_icd', label: 'รอ ICD/ICD9', color: '#6366f1' },
  { value: 'pending_finance', label: 'รอการเงิน', color: '#f97316' },
  { value: 'ready', label: 'พร้อมส่ง', color: '#10b981' },
  { value: 'sent', label: 'ส่งแล้ว', color: '#3b82f6' },
  { value: 'rejected', label: 'ตีกลับ', color: '#ef4444' },
];

const statusColor = (status: string) =>
  QUEUE_STATUSES.find((s) => s.value === status)?.color || '#6b7280';
const statusLabel = (status: string) =>
  QUEUE_STATUSES.find((s) => s.value === status)?.label || status;

interface QueueItem {
  id?: number;
  vn: string;
  hn?: string;
  patient_name?: string;
  fund?: string;
  service_date?: string;
  queue_status: string;
  assigned_to?: string;
  notes?: string;
  updated_at?: string;
}

interface EligibleVisitImportRow {
  vn?: string;
  vstId?: string;
  hn?: string;
  patient_name?: string;
  patientName?: string;
  maininscl?: string;
  fund?: string;
  vstdate?: string;
  serviceDate?: string;
  isBillable?: boolean;
  status?: string;
}

export default function WorkQueuePage() {
  const [startDate, setStartDate] = useState(() => formatLocalDateDaysAgo(14));
  const [endDate, setEndDate] = useState(() => formatLocalDateInput());
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState<QueueItem[]>([]);

  // edit modal state
  const [editItem, setEditItem] = useState<QueueItem | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editAssigned, setEditAssigned] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', '500');
      const resp = await fetch(`/api/work-queue?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, statusFilter, search]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleImportFromEligible = async () => {
    if (!startDate || !endDate) return;
    setSaving('import');
    setError('');
    try {
      // Load eligible visits
      const params = new URLSearchParams({ startDate, endDate, limit: '500' });
      const resp = await fetch(`/api/hosxp/eligible-visits?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const visits: EligibleVisitImportRow[] = Array.isArray(json) ? json : json.data || [];
      const workflowItems = visits.filter((item) => item.isBillable !== false && item.status !== 'rejected');

      if (workflowItems.length === 0) {
        throw new Error('ไม่พบรายการที่เข้า workflow สำหรับช่วงวันที่ที่เลือก');
      }

      // Bulk add to queue
      const bulkResp = await fetch('/api/work-queue/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: workflowItems }),
      });
      if (!bulkResp.ok) throw new Error(`HTTP ${bulkResp.status}`);
      const result = await bulkResp.json() as { success?: boolean; count?: number; error?: string };
      if (!result.success) throw new Error(result.error || 'เพิ่ม Work Queue ไม่สำเร็จ');
      alert(`เพิ่ม ${result.count} รายการเข้า Work Queue แล้ว`);
      await loadQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'นำเข้าข้อมูลไม่สำเร็จ');
    } finally {
      setSaving(null);
    }
  };

  const handleEditOpen = (item: QueueItem) => {
    setEditItem(item);
    setEditStatus(item.queue_status);
    setEditNotes(item.notes || '');
    setEditAssigned(item.assigned_to || '');
  };

  const handleEditSave = async () => {
    if (!editItem) return;
    setSaving(editItem.vn);
    try {
      const resp = await fetch(`/api/work-queue/${encodeURIComponent(editItem.vn)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueStatus: editStatus, notes: editNotes, assignedTo: editAssigned }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json() as { success?: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'บันทึกไม่สำเร็จ');
      setItems((prev) =>
        prev.map((i) =>
          i.vn === editItem.vn ? { ...i, queue_status: editStatus, notes: editNotes, assigned_to: editAssigned } : i
        )
      );
      setEditItem(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(null);
    }
  };

  // Summary by status
  const statusCounts = QUEUE_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s.value]: items.filter((i) => i.queue_status === s.value).length }),
    {} as Record<string, number>
  );

  return (
    <div className="page-container workflow-page">
      <div className="workflow-hero">
        <div className="workflow-hero__content">
          <div>
            <h1 className="page-title workflow-hero__title">Work Queue — คิวงาน VN</h1>
            <p className="workflow-hero__description">มองเห็นงานค้างแต่ละ VN ในภาพเดียว ไล่สถานะงานตามทีมที่รับผิดชอบ และอัปเดตหมายเหตุได้ทันทีจากตารางเดียว</p>
          </div>
          <div className="workflow-hero__meta">
            <span className="workflow-badge workflow-badge--accent">Workflow ตามสถานะจริง</span>
            <span className="workflow-badge">{items.length} รายการในมุมมองนี้</span>
          </div>
        </div>
      </div>

      <div className="card workflow-panel">
        <div className="card-body">
          <div className="workflow-filter-grid">
            <div className="form-group">
              <label>วันที่เริ่มต้น</label>
              <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>วันที่สิ้นสุด</label>
              <input type="date" className="form-control" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>สถานะ</label>
              <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                {QUEUE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>ค้นหา (VN/HN/ชื่อ)</label>
              <input
                type="text"
                className="form-control"
                placeholder="ค้นหา..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="workflow-filter-actions">
              <button className="btn btn-primary" onClick={loadQueue} disabled={loading}>
                {loading ? 'กำลังโหลด...' : '🔄 โหลด'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleImportFromEligible}
                disabled={saving === 'import'}
                title="ดึง visit จากช่วงวันที่ที่เลือกมาเพิ่มใน Queue"
              >
                {saving === 'import' ? 'กำลังนำเข้า...' : '➕ นำเข้าจาก Eligible Visits'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>
      )}

      <div className="workflow-summary-grid">
        {QUEUE_STATUSES.slice(0, 4).map((s) => (
          <div key={s.value} className="workflow-stat" style={{ ['--stat-color' as string]: s.color }}>
            <div className="workflow-stat__value">{statusCounts[s.value] || 0}</div>
            <div className="workflow-stat__label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="workflow-chip-row">
        {QUEUE_STATUSES.map((s) => (
          <span
            key={s.value}
            onClick={() => setStatusFilter(statusFilter === s.value ? 'all' : s.value)}
            className={`workflow-chip ${statusFilter === s.value ? 'is-active' : ''}`}
            style={{ ['--chip-color' as string]: s.color }}
          >
            {s.label} ({statusCounts[s.value] || 0})
          </span>
        ))}
      </div>

      <div className="card workflow-panel workflow-table-card">
        <div className="card-header">
          <span className="workflow-table-title">รายการคิวงาน</span>
          <span className="workflow-table-meta">ทั้งหมด {items.length} รายการ</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="modal-table-wrap">
            <table className="data-table workflow-readable-table workflow-readable-table--queue">
              <thead>
                <tr>
                  <th>VN</th>
                  <th>HN</th>
                  <th>ชื่อ-สกุล</th>
                  <th>สิทธิ์</th>
                  <th>วันที่บริการ</th>
                  <th>สถานะ</th>
                  <th>ผู้รับผิดชอบ</th>
                  <th>หมายเหตุ</th>
                  <th>อัปเดต</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>
                      ไม่พบข้อมูล
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.vn}>
                      <td className="table-cell-nowrap workflow-id-cell">{item.vn}</td>
                      <td className="table-cell-nowrap workflow-id-cell">{item.hn || '-'}</td>
                      <td className="workflow-person-cell">{item.patient_name || '-'}</td>
                      <td>{item.fund || '-'}</td>
                      <td className="table-cell-nowrap">{item.service_date?.slice(0, 10) || '-'}</td>
                      <td>
                        <span
                          className="workflow-status-pill"
                          style={{ ['--pill-color' as string]: statusColor(item.queue_status) }}
                        >
                          {statusLabel(item.queue_status)}
                        </span>
                      </td>
                      <td className="workflow-owner-cell">{item.assigned_to || '-'}</td>
                      <td className="workflow-note-cell">{item.notes || '-'}</td>
                      <td className="table-cell-nowrap" style={{ fontSize: 12, color: '#6b7280' }}>
                        {item.updated_at ? new Date(item.updated_at).toLocaleDateString('th-TH') : '-'}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '3px 10px', fontSize: 12 }}
                          onClick={() => handleEditOpen(item)}
                          disabled={saving === item.vn}
                        >
                          แก้ไข
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editItem && (
        <div
          className="workflow-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setEditItem(null); }}
        >
          <div className="workflow-modal">
            <div className="workflow-modal__header">
              <h3 className="workflow-modal__title">แก้ไขสถานะ — VN {editItem.vn}</h3>
              <p className="workflow-modal__subtitle">อัปเดตเจ้าของงาน สถานะปัจจุบัน และหมายเหตุให้ทีมเห็นข้อมูลชุดเดียวกัน</p>
            </div>
            <div className="workflow-modal__body">
            <div className="form-group">
              <label>สถานะ</label>
              <select className="form-control" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                {QUEUE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>ผู้รับผิดชอบ</label>
              <input type="text" className="form-control" value={editAssigned} onChange={(e) => setEditAssigned(e.target.value)} placeholder="ชื่อหรือแผนก" />
            </div>
            <div className="form-group">
              <label>หมายเหตุ</label>
              <textarea className="form-control" rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="รายละเอียด..." />
            </div>
            <div className="workflow-modal__actions">
              <button className="btn btn-secondary" onClick={() => setEditItem(null)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleEditSave} disabled={saving === editItem.vn}>
                {saving === editItem.vn ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
