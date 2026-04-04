import React, { useEffect, useState } from 'react';
import { formatLocalDateDaysAgo, formatLocalDateInput } from '../utils/dateUtils';

interface NhsoAuthenSettings {
  environment?: 'prd' | 'uat';
  token?: string;
  apiBaseUrl?: string;
  maxDays?: number;
}

interface AuthenLogRow {
  id: number;
  vn: string;
  cid?: string;
  hn?: string;
  vstdate?: string;
  claim_code?: string;
  authen_type?: string;
  authen_datetime?: string;
  status: string;
  message?: string;
  synced_at: string;
}

export const AuthenSyncPage: React.FC = () => {
  const [settings, setSettings] = useState<NhsoAuthenSettings>({ environment: 'prd', token: '', apiBaseUrl: 'https://authenucws.nhso.go.th', maxDays: 4 });
  const [startDate, setStartDate] = useState(formatLocalDateDaysAgo(4));
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [logs, setLogs] = useState<AuthenLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLogsLoading(true);
      const [settingsRes, logsRes] = await Promise.all([
        fetch('/api/config/nhso-authen-settings'),
        fetch('/api/nhso/authen/logs?limit=100'),
      ]);
      const settingsJson = await settingsRes.json();
      const logsJson = await logsRes.json();
      if (settingsJson?.success) setSettings(settingsJson.data || {});
      if (logsJson?.success) setLogs(logsJson.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูล Authen ไม่สำเร็จ');
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const response = await fetch('/api/config/nhso-authen-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'บันทึก token ไม่สำเร็จ');
      setSuccess('บันทึก NHSO token และค่าการเชื่อมต่อเรียบร้อยแล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกข้อมูลไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      setSuccess(null);
      const response = await fetch('/api/nhso/authen/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Sync authen ไม่สำเร็จ');
      setSummary(json.summary || null);
      setSuccess('Sync Authen Code เรียบร้อยแล้ว');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync authen ไม่สำเร็จ');
    } finally {
      setSyncing(false);
    }
  };

  const maskedToken = settings.token
    ? settings.token.length > 10
      ? `${settings.token.slice(0, 6)}...${settings.token.slice(-4)}`
      : settings.token
    : 'ยังไม่ได้ตั้งค่า';

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">🪪 นำเข้า Authen Code</h1>
        <p className="page-subtitle">
          ดึงเลขยืนยันตัวตนจาก NHSO แล้วอัปเดตเข้า <code>visit_pttype.auth_code</code> และ <code>authenhos.claim_code</code> พร้อมเก็บ log ไว้ในฐาน <code>repstminv</code>
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>ℹ️</span>
            <span>รอบนี้ผมตั้ง flow ตามโค้ดเดิมของคุณเป็นหลัก และจำกัดช่วงวันที่ไม่เกินจำนวนวันที่กำหนดเพื่อไม่ให้ยิง NHSO หนักเกินไป</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>สถานะ Token</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8 }}>
                <div>Environment: <strong>{(settings.environment || 'prd').toUpperCase()}</strong></div>
                <div>Token ปัจจุบัน: <strong>{maskedToken}</strong></div>
                <div>Base URL: <strong>{settings.apiBaseUrl || '-'}</strong></div>
              </div>
            </div>
            {summary && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>ผลการ sync ล่าสุด</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="badge badge-info">ทั้งหมด {summary.total || 0}</span>
                  <span className="badge badge-success">อัปเดต {summary.updated || 0}</span>
                  <span className="badge badge-warning">ข้าม {summary.skipped || 0}</span>
                  <span className="badge badge-primary">ไม่พบ {summary.duplicates || 0}</span>
                  <span className="badge badge-danger">ผิดพลาด {summary.errors || 0}</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Environment</label>
              <select className="form-control" value={settings.environment || 'prd'} onChange={(e) => setSettings((prev) => ({ ...prev, environment: e.target.value as 'prd' | 'uat' }))}>
                <option value="prd">Production</option>
                <option value="uat">UAT</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">NHSO API Base URL</label>
              <input className="form-control" value={settings.apiBaseUrl || ''} onChange={(e) => setSettings((prev) => ({ ...prev, apiBaseUrl: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Sync ไม่เกินกี่วัน</label>
              <input className="form-control" type="number" min={1} max={10} value={settings.maxDays || 4} onChange={(e) => setSettings((prev) => ({ ...prev, maxDays: Number(e.target.value) || 4 }))} />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">NHSO Token</label>
            <textarea
              className="form-control"
              rows={3}
              value={settings.token || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, token: e.target.value }))}
              placeholder="วาง token key ของ NHSO ที่นี่"
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">วันที่เริ่มต้น</label>
              <input className="form-control" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">วันที่สิ้นสุด</label>
              <input className="form-control" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleSave} disabled={saving || syncing}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก Token'}
            </button>
            <button className="btn btn-primary" onClick={handleSync} disabled={saving || syncing}>
              {syncing ? 'กำลัง Sync Authen...' : 'เริ่มนำเข้า Authen Code'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}><span>⚠️</span><span>{error}</span></div>}
      {success && <div className="alert alert-success" style={{ marginBottom: 16 }}><span>✅</span><span>{success}</span></div>}

      <div className="card">
        <div className="card-header">
          <div className="card-title">ประวัติการนำเข้า Authen</div>
          <span className="badge badge-info">{logsLoading ? 'กำลังโหลด...' : `${logs.length} รายการ`}</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {logs.length > 0 ? (
            <div className="modal-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>VN</th>
                    <th>CID</th>
                    <th>Claim Code</th>
                    <th>สถานะ</th>
                    <th>ข้อความ</th>
                    <th>เวลา</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={row.id}>
                      <td className="table-cell-nowrap">{row.vn}</td>
                      <td className="table-cell-nowrap">{row.cid || '-'}</td>
                      <td className="table-cell-nowrap">{row.claim_code || '-'}</td>
                      <td className="table-cell-nowrap">
                        <span className={`badge ${row.status === 'updated' ? 'badge-success' : row.status === 'error' ? 'badge-danger' : 'badge-warning'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>{row.message || '-'}</td>
                      <td className="table-cell-nowrap">{row.synced_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>ยังไม่มีประวัติการ sync Authen</div>
          )}
        </div>
      </div>
    </div>
  );
};
