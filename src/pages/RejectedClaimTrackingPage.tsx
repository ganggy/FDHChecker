import { useState, useEffect, useCallback } from 'react';
import { formatLocalDateDaysAgo, formatLocalDateInput } from '../utils/dateUtils';

const RESOLVE_STATUSES = [
  { value: 'open', label: 'รอดำเนินการ', color: '#ef4444' },
  { value: 'in_progress', label: 'กำลังดำเนินการ', color: '#f59e0b' },
  { value: 'resubmit', label: 'ส่งใหม่แล้ว', color: '#3b82f6' },
  { value: 'resolved', label: 'แก้ไขแล้ว', color: '#10b981' },
];

const resolveLabel = (status: string) =>
  RESOLVE_STATUSES.find((s) => s.value === status)?.label || status;
const resolveColor = (status: string) =>
  RESOLVE_STATUSES.find((s) => s.value === status)?.color || '#6b7280';

interface RejectItem {
  rep_data_id: number;
  rep_no?: string;
  tran_id?: string;
  hn?: string;
  vn?: string;
  an?: string;
  pid?: string;
  patient_name?: string;
  department?: string;
  admdate?: string;
  maininscl?: string;
  errorcode?: string;
  verifycode?: string;
  income?: number;
  compensated?: number;
  diff?: number;
  note_id?: number;
  resolve_status?: string;
  note?: string;
  assigned_to?: string;
  resolved_at?: string;
  note_updated_at?: string;
}

export default function RejectedClaimTrackingPage() {
  const [startDate, setStartDate] = useState(() => formatLocalDateDaysAgo(90));
  const [endDate, setEndDate] = useState(() => formatLocalDateInput());
  const [resolveFilter, setResolveFilter] = useState('all');
  const [errorcodeFilter, setErrorcodeFilter] = useState('');
  const [fundFilter, setFundFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<RejectItem[]>([]);

  // note editor
  const [editItem, setEditItem] = useState<RejectItem | null>(null);
  const [editResolveStatus, setEditResolveStatus] = useState('open');
  const [editNote, setEditNote] = useState('');
  const [editAssigned, setEditAssigned] = useState('');
  const [saving, setSaving] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (resolveFilter !== 'all') params.set('resolveStatus', resolveFilter);
      if (errorcodeFilter.trim()) params.set('errorcode', errorcodeFilter.trim());
      if (fundFilter !== 'all') params.set('fund', fundFilter);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', '500');
      const resp = await fetch(`/api/reject-tracking?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, resolveFilter, errorcodeFilter, fundFilter, search]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleEditOpen = (item: RejectItem) => {
    setEditItem(item);
    setEditResolveStatus(item.resolve_status || 'open');
    setEditNote(item.note || '');
    setEditAssigned(item.assigned_to || '');
  };

  const handleEditSave = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      const resp = await fetch('/api/reject-tracking/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repDataId: editItem.rep_data_id,
          tranId: editItem.tran_id || undefined,
          vn: editItem.vn || undefined,
          an: editItem.an || undefined,
          hn: editItem.hn || undefined,
          errorcode: editItem.errorcode || undefined,
          verifycode: editItem.verifycode || undefined,
          resolveStatus: editResolveStatus,
          note: editNote,
          assignedTo: editAssigned,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setItems((prev) =>
        prev.map((i) =>
          i.rep_data_id === editItem.rep_data_id
            ? { ...i, resolve_status: editResolveStatus, note: editNote, assigned_to: editAssigned }
            : i
        )
      );
      setEditItem(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  // Derived stats
  const openCount = items.filter((i) => (i.resolve_status || 'open') === 'open').length;
  const resolvedCount = items.filter((i) => i.resolve_status === 'resolved').length;
  const inProgressCount = items.filter((i) => i.resolve_status === 'in_progress').length;

  // Unique funds from items
  const funds = Array.from(new Set(items.map((i) => i.maininscl || '').filter(Boolean))).sort();

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Rejected Claim Tracking</h1>
        <p style={{ color: '#6b7280', marginTop: 4 }}>ติดตามรายการเคลมที่ถูกตีกลับจาก สปสช. และบันทึกการดำเนินการ</p>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>วันที่เริ่มต้น</label>
              <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>วันที่สิ้นสุด</label>
              <input type="date" className="form-control" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>สถานะการแก้ไข</label>
              <select className="form-control" value={resolveFilter} onChange={(e) => setResolveFilter(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                {RESOLVE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>รหัสข้อผิดพลาด</label>
              <input
                type="text"
                className="form-control"
                placeholder="เช่น ER101"
                value={errorcodeFilter}
                onChange={(e) => setErrorcodeFilter(e.target.value)}
                style={{ width: 110 }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>กองทุน</label>
              <select className="form-control" value={fundFilter} onChange={(e) => setFundFilter(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                {funds.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0, flex: 1 }}>
              <label>ค้นหา</label>
              <input
                type="text"
                className="form-control"
                placeholder="VN / HN / ชื่อ / TRAN_ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={loadItems} disabled={loading}>
              {loading ? 'กำลังโหลด...' : '🔍 ค้นหา'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 16 }}>
        <div className="card" style={{ borderLeft: '4px solid #ef4444' }}>
          <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{openCount}</div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>รอดำเนินการ</div>
          </div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{inProgressCount}</div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>กำลังดำเนินการ</div>
          </div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
          <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#10b981' }}>{resolvedCount}</div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>แก้ไขแล้ว</div>
          </div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #6366f1' }}>
          <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#6366f1' }}>{items.length}</div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>รายการทั้งหมด</div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="modal-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>REP No.</th>
                  <th>VN/AN</th>
                  <th>HN</th>
                  <th>ชื่อ-สกุล</th>
                  <th>กองทุน</th>
                  <th>วันที่</th>
                  <th>Error Code</th>
                  <th>Verify Code</th>
                  <th>ยอดต่าง</th>
                  <th>สถานะ</th>
                  <th>หมายเหตุ</th>
                  <th>ผู้รับผิดชอบ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>
                      {loading ? 'กำลังโหลด...' : 'ไม่พบข้อมูล'}
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.rep_data_id}>
                      <td style={{ fontSize: 12 }}>{item.rep_no || '-'}</td>
                      <td className="table-cell-nowrap" style={{ fontSize: 12 }}>
                        {item.vn || item.an || '-'}
                      </td>
                      <td>{item.hn || '-'}</td>
                      <td>{item.patient_name || '-'}</td>
                      <td>{item.maininscl || '-'}</td>
                      <td className="table-cell-nowrap" style={{ fontSize: 12 }}>
                        {item.admdate ? String(item.admdate).slice(0, 10) : '-'}
                      </td>
                      <td>
                        {item.errorcode ? (
                          <span className="badge badge-danger" style={{ fontSize: 11 }}>{item.errorcode}</span>
                        ) : '-'}
                      </td>
                      <td style={{ fontSize: 11, color: '#6b7280' }}>{item.verifycode || '-'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>
                        {item.diff != null ? (
                          <span style={{ color: Number(item.diff) >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                            {Number(item.diff).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </span>
                        ) : '-'}
                      </td>
                      <td>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background: resolveColor(item.resolve_status || 'open') + '22',
                            color: resolveColor(item.resolve_status || 'open'),
                            border: `1px solid ${resolveColor(item.resolve_status || 'open')}44`,
                          }}
                        >
                          {resolveLabel(item.resolve_status || 'open')}
                        </span>
                      </td>
                      <td style={{ maxWidth: 160, whiteSpace: 'normal', fontSize: 12 }}>{item.note || '-'}</td>
                      <td style={{ fontSize: 12 }}>{item.assigned_to || '-'}</td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '3px 10px', fontSize: 12 }}
                          onClick={() => handleEditOpen(item)}
                        >
                          บันทึก
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

      {/* Note edit modal */}
      {editItem && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditItem(null); }}
        >
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, minWidth: 440, maxWidth: 560, width: '90%' }}>
            <h3 style={{ marginBottom: 4 }}>บันทึกการดำเนินการ</h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
              {editItem.patient_name || ''} {editItem.vn ? `VN: ${editItem.vn}` : ''} {editItem.an ? `AN: ${editItem.an}` : ''}
            </p>

            {editItem.errorcode && (
              <div className="alert alert-danger" style={{ marginBottom: 12, padding: '8px 12px', fontSize: 13 }}>
                รหัสข้อผิดพลาด: <strong>{editItem.errorcode}</strong>
                {editItem.verifycode && ` | Verify: ${editItem.verifycode}`}
              </div>
            )}

            <div className="form-group">
              <label>สถานะการแก้ไข</label>
              <select className="form-control" value={editResolveStatus} onChange={(e) => setEditResolveStatus(e.target.value)}>
                {RESOLVE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>ผู้รับผิดชอบ</label>
              <input
                type="text"
                className="form-control"
                value={editAssigned}
                onChange={(e) => setEditAssigned(e.target.value)}
                placeholder="ชื่อหรือแผนก"
              />
            </div>
            <div className="form-group">
              <label>หมายเหตุ / บันทึกการดำเนินการ</label>
              <textarea
                className="form-control"
                rows={4}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="รายละเอียดการดำเนินการ เช่น แก้ ICD-10 เป็น J06 แล้วส่งใหม่..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditItem(null)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleEditSave} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
