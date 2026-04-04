import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatLocalDateDaysAgo, formatLocalDateInput } from '../utils/dateUtils';

interface NhsoCloseSettings {
  environment?: 'prd' | 'uat';
  token?: string;
  apiBaseUrl?: string;
  sourceId?: string;
  claimServiceCode?: string;
  recorderPid?: string;
  maxDays?: number;
}

interface CloseCandidateRow {
  vn: string;
  hn?: string;
  an?: string;
  cid?: string;
  patient_name?: string;
  maininscl?: string;
  pttypename?: string;
  vst_datetime?: string;
  income?: number;
  uc_money?: number;
  rcpt_money?: number;
  authencode_web?: string;
  close_code?: string;
  authencode_endpoint?: string;
  close_status?: string;
  source_id?: string;
  invno?: string;
  can_close?: number;
}

interface CloseHistoryRow {
  nhso_confirm_privilege_id: number;
  vn: string;
  nhso_seq?: string;
  nhso_authen_code?: string;
  nhso_status?: string;
  nhso_total_amount?: number;
  nhso_privilege_amount?: number;
  nhso_cash_amount?: number;
  sourceID?: string;
  confirm_staff?: string;
  nhso_requst_datetime?: string;
  nhso_response_datetime?: string;
  nhso_reponse_json?: string;
  nhso_cancel_response?: string;
}

type CloseStatusDetailSource = {
  nhso_reponse_json?: string;
  nhso_cancel_response?: string;
};

interface TokenTestResult {
  requestUrl?: string;
  responseStatus?: number;
  seq?: string;
  authenCode?: string;
  errorMessage?: string;
  tokenLooksInvalid?: boolean;
}

const defaultSettings: NhsoCloseSettings = {
  environment: 'prd',
  token: '',
  apiBaseUrl: 'https://nhsoapi.nhso.go.th/nhsoendpoint',
  sourceId: 'KSPAPI',
  claimServiceCode: 'PG0060001',
  recorderPid: '',
  maxDays: 4,
};

export const NhsoClosePage: React.FC = () => {
  const [settings, setSettings] = useState<NhsoCloseSettings>(defaultSettings);
  const [startDate, setStartDate] = useState(formatLocalDateDaysAgo(1));
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [closeStatus, setCloseStatus] = useState<'all' | 'pending' | 'ok' | 'cancel' | 'error'>('pending');
  const [mainInscl, setMainInscl] = useState('all');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [rows, setRows] = useState<CloseCandidateRow[]>([]);
  const [history, setHistory] = useState<CloseHistoryRow[]>([]);
  const [selectedVns, setSelectedVns] = useState<string[]>([]);
  const [testingToken, setTestingToken] = useState(false);
  const [tokenTestResult, setTokenTestResult] = useState<TokenTestResult | null>(null);
  const parseHistoryDetail = (row: CloseStatusDetailSource) => {
    const candidates = [row.nhso_reponse_json, row.nhso_cancel_response];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        const message = String(parsed.message || parsed.Message || parsed.error || parsed.Error || parsed.dataError || '').trim();
        if (message) return message;
        const errors = parsed.errors;
        if (Array.isArray(errors) && errors.length > 0) {
          const first = errors[0] as Record<string, unknown> | undefined;
          const nested = first ? String(first.message || first.code || '').trim() : '';
          if (nested) return nested;
        }
      } catch {
        const plain = String(candidate).trim();
        if (plain) return plain;
      }
    }
    return '';
  };

  const loadSettingsAndHistory = async () => {
    const [settingsRes, historyRes] = await Promise.all([
      fetch('/api/config/nhso-close-settings'),
      fetch('/api/nhso/close/history?limit=100'),
    ]);
    const settingsJson = await settingsRes.json();
    const historyJson = await historyRes.json();

    if (settingsJson?.success) {
      setSettings({ ...defaultSettings, ...(settingsJson.data || {}) });
    }
    if (historyJson?.success) {
      setHistory(historyJson.data || []);
    }
  };

  const loadCandidates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        startDate,
        endDate,
        closeStatus,
        mainInscl,
        search,
        limit: '400',
      });
      const response = await fetch(`/api/nhso/close/candidates?${params.toString()}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'โหลดรายการปิดสิทธิไม่สำเร็จ');
      const nextRows = json.data || [];
      setRows(nextRows);
      setSelectedVns(nextRows.filter((row: CloseCandidateRow) => Number(row.can_close || 0) === 1).map((row: CloseCandidateRow) => row.vn));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายการปิดสิทธิไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [closeStatus, endDate, mainInscl, search, startDate]);

  useEffect(() => {
    void loadSettingsAndHistory();
  }, []);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const response = await fetch('/api/config/nhso-close-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'บันทึกค่าปิดสิทธิไม่สำเร็จ');
      setSuccess('บันทึกค่าการปิดสิทธิ NHSO เรียบร้อยแล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกค่าการปิดสิทธิไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggleSelection = (vn: string) => {
    setSelectedVns((prev) => (prev.includes(vn) ? prev.filter((item) => item !== vn) : [...prev, vn]));
  };

  const handleSelectClosable = () => {
    setSelectedVns(rows.filter((row) => Number(row.can_close || 0) === 1).map((row) => row.vn));
  };

  const handleSubmitSelected = async () => {
    try {
      const selectedRows = rows.filter((row) => selectedVns.includes(row.vn));
      if (selectedRows.length === 0) {
        setError('ยังไม่ได้เลือกรายการที่จะปิดสิทธิ');
        return;
      }

      setSubmitting(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/nhso/close/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selectedRows.map((row) => ({
            vn: row.vn,
            cid: row.cid,
            vstDateTime: row.vst_datetime,
            mainInscl: row.maininscl,
            income: Number(row.income || 0),
            rcptMoney: Number(row.rcpt_money || 0),
            ucMoney: Number(row.uc_money || 0),
            authencodeWeb: row.authencode_web,
            pttypeName: row.pttypename,
            invno: row.invno,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'ส่งปิดสิทธิ NHSO ไม่สำเร็จ');
      setSummary(json.summary || null);
      setSuccess('ส่งปิดสิทธิ NHSO เรียบร้อยแล้ว');
      await Promise.all([loadCandidates(), loadSettingsAndHistory()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งปิดสิทธิ NHSO ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestToken = async () => {
    try {
      setTestingToken(true);
      setError(null);
      setSuccess(null);
      setTokenTestResult(null);

      const response = await fetch('/api/nhso/close/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'ทดสอบ token ไม่สำเร็จ');

      setTokenTestResult(json.data || null);
      if (json.data?.tokenLooksInvalid) {
        setError('Token ปัจจุบันไม่ผ่านการยืนยันตัวตนกับ endpoint ปิดสิทธิ');
      } else {
        setSuccess('Token ปิดสิทธิผ่านการทดสอบเบื้องต้นแล้ว');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ทดสอบ token ไม่สำเร็จ');
    } finally {
      setTestingToken(false);
    }
  };

  const closableCount = useMemo(
    () => rows.filter((row) => Number(row.can_close || 0) === 1).length,
    [rows]
  );

  const pendingCount = useMemo(
    () => rows.filter((row) => Number(row.can_close || 0) === 1).length,
    [rows]
  );

  const latestHistoryError = useMemo(() => {
    const errorRow = history.find((row) => row.nhso_status === 'E');
    const detail = errorRow ? parseHistoryDetail(errorRow) : '';
    return detail;
  }, [history]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">🔐 ปิดสิทธิ NHSO</h1>
        <p className="page-subtitle">
          ใช้รายการ OPD ที่ยังต้องปิดสิทธิ ส่งเข้า <code>nhso-claim-detail</code> และบันทึกผลลง <code>nhso_confirm_privilege</code> ของ HOSxP โดยตรง
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>ℹ️</span>
            <span>หน้านี้โฟกัสงาน `ปิดสิทธิ (EP)` อย่างเดียว ระบบจะพาเฉพาะเคสที่ยังต้องปิดสิทธิมาให้ และตัวที่ปิดแล้วจะไม่ถูกรวมเข้ากลุ่มงานค้าง</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>สถานะการตั้งค่า</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8 }}>
                <div>Environment: <strong>{(settings.environment || 'prd').toUpperCase()}</strong></div>
                <div>Source ID: <strong>{settings.sourceId || 'KSPAPI'}</strong></div>
                <div>Recorder PID: <strong>{settings.recorderPid || 'ยังไม่ได้ตั้งค่า'}</strong></div>
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>ภาพรวมรายการ</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-info">ทั้งหมด {rows.length}</span>
                <span className="badge badge-warning">ต้องปิดสิทธิ {pendingCount}</span>
                <span className="badge badge-success">ปิดได้ {closableCount}</span>
                <span className="badge badge-primary">เลือกอยู่ {selectedVns.length}</span>
              </div>
            </div>
            {summary && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>ผลการส่งล่าสุด</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="badge badge-info">ทั้งหมด {Number(summary.total || 0)}</span>
                  <span className="badge badge-success">สำเร็จ {Number(summary.submitted || 0)}</span>
                  <span className="badge badge-warning">ข้าม {Number(summary.skipped || 0)}</span>
                  <span className="badge badge-danger">ผิดพลาด {Number(summary.errors || 0)}</span>
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
              <label className="form-label">NHSO Endpoint Base URL</label>
              <input className="form-control" value={settings.apiBaseUrl || ''} onChange={(e) => setSettings((prev) => ({ ...prev, apiBaseUrl: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Sync ไม่เกินกี่วัน</label>
              <input className="form-control" type="number" min={1} max={10} value={settings.maxDays || 4} onChange={(e) => setSettings((prev) => ({ ...prev, maxDays: Number(e.target.value) || 4 }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Source ID</label>
              <input className="form-control" value={settings.sourceId || ''} onChange={(e) => setSettings((prev) => ({ ...prev, sourceId: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Claim Service Code</label>
              <input className="form-control" value={settings.claimServiceCode || ''} onChange={(e) => setSettings((prev) => ({ ...prev, claimServiceCode: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Recorder PID</label>
              <input className="form-control" value={settings.recorderPid || ''} onChange={(e) => setSettings((prev) => ({ ...prev, recorderPid: e.target.value }))} placeholder="เลขบัตรประชาชนผู้บันทึก" />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">NHSO Close Token</label>
            <textarea
              className="form-control"
              rows={3}
              value={settings.token || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, token: e.target.value }))}
              placeholder="วาง token สำหรับ endpoint ปิดสิทธิ NHSO ที่นี่"
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleSaveSettings} disabled={saving || submitting}>
              {saving ? 'กำลังบันทึก...' : 'บันทึกค่าเชื่อมต่อ'}
            </button>
            <button className="btn btn-secondary" onClick={handleTestToken} disabled={testingToken || saving || submitting}>
              {testingToken ? 'กำลังทดสอบ token...' : 'ทดสอบ token'}
            </button>
            <button className="btn btn-secondary" onClick={() => void loadCandidates()} disabled={loading || submitting}>
              {loading ? 'กำลังโหลด...' : 'โหลดรายการปิดสิทธิ'}
            </button>
            <button className="btn btn-secondary" onClick={handleSelectClosable} disabled={loading || submitting}>
              เลือกเฉพาะตัวที่ต้องปิดสิทธิ
            </button>
            <button className="btn btn-primary" onClick={handleSubmitSelected} disabled={loading || submitting}>
              {submitting ? 'กำลังส่งปิดสิทธิ...' : 'ส่งปิดสิทธิรายการที่เลือก'}
            </button>
          </div>

          {latestHistoryError && latestHistoryError.toLowerCase().includes('invalid token') && (
            <div className="alert alert-danger" style={{ marginTop: 16 }}>
              <span>⚠️</span>
              <span>
                ระบบ NHSO ตอบกลับว่า <strong>Invalid token.</strong> หมายความว่า token ปัจจุบันไม่ผ่านการยืนยันตัวตนกับ endpoint นี้
                กรุณาตรวจสอบ token ที่บันทึกไว้ในหน้าตั้งค่า, สิทธิ์ของ token กับ environment ที่ใช้ และการออก token ใหม่จาก NHSO
              </span>
            </div>
          )}

          {tokenTestResult && (
            <div className="card" style={{ marginTop: 16, padding: 16, borderColor: tokenTestResult.tokenLooksInvalid ? 'var(--danger)' : 'var(--success)' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>ผลทดสอบ Token</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className={`badge ${tokenTestResult.tokenLooksInvalid ? 'badge-danger' : 'badge-success'}`}>
                  {tokenTestResult.tokenLooksInvalid ? 'Token ไม่ผ่าน' : 'Token ผ่านเบื้องต้น'}
                </span>
                {typeof tokenTestResult.responseStatus === 'number' && (
                  <span className="badge badge-info">HTTP {tokenTestResult.responseStatus}</span>
                )}
                {tokenTestResult.seq && <span className="badge badge-success">Seq {tokenTestResult.seq}</span>}
                {tokenTestResult.authenCode && <span className="badge badge-info">Authen {tokenTestResult.authenCode}</span>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                <div>URL: <code style={{ wordBreak: 'break-all' }}>{tokenTestResult.requestUrl || '-'}</code></div>
                <div>รายละเอียด: {tokenTestResult.errorMessage || 'ไม่พบข้อความผิดพลาด'}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}><span>⚠️</span><span>{error}</span></div>}
      {success && <div className="alert alert-success" style={{ marginBottom: 16 }}><span>✅</span><span>{success}</span></div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">ตัวกรองรายการ OPD ที่พร้อมปิดสิทธิ</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">วันที่เริ่มต้น</label>
              <input className="form-control" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">วันที่สิ้นสุด</label>
              <input className="form-control" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">สถานะปิดสิทธิ</label>
              <select className="form-control" value={closeStatus} onChange={(e) => setCloseStatus(e.target.value as 'all' | 'pending' | 'ok' | 'cancel' | 'error')}>
                <option value="all">ทั้งหมด</option>
                <option value="pending">ต้องปิดสิทธิ</option>
                <option value="ok">ปิดแล้ว</option>
                <option value="cancel">ยกเลิก</option>
                <option value="error">ผิดพลาด</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">สิทธิหลัก</label>
              <select className="form-control" value={mainInscl} onChange={(e) => setMainInscl(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                <option value="UCS">UCS</option>
                <option value="WEL">WEL</option>
                <option value="OFC">OFC</option>
                <option value="SSS">SSS</option>
                <option value="LGO">LGO</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">ค้นหา</label>
              <input className="form-control" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="VN / HN / CID / ชื่อผู้ป่วย" />
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">รายการพร้อมปิดสิทธิ NHSO</div>
          <span className="badge badge-info">{loading ? 'กำลังโหลด...' : `${rows.length} รายการ`}</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="modal-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>เลือก</th>
                  <th>VN</th>
                  <th>HN</th>
                  <th>ผู้ป่วย</th>
                  <th>วันรับบริการ</th>
                  <th>สิทธิ</th>
                  <th>ปิดสิทธิ (EP)</th>
                  <th>สถานะปิดสิทธิ</th>
                  <th>ยอดรวม</th>
                  <th>เบิกได้</th>
                  <th>รับเงินสด</th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? rows.map((row) => {
                  const disabled = Number(row.can_close || 0) !== 1;
                  const isSelected = selectedVns.includes(row.vn);
                  return (
                    <tr key={row.vn} className={isSelected ? 'row-selected' : ''}>
                      <td className="table-cell-nowrap">
                        <input type="checkbox" checked={isSelected} disabled={disabled} onChange={() => toggleSelection(row.vn)} />
                      </td>
                      <td className="table-cell-nowrap">{row.vn}</td>
                      <td className="table-cell-nowrap">{row.hn || '-'}</td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{row.patient_name || '-'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.cid || '-'}</div>
                      </td>
                      <td className="table-cell-nowrap">{row.vst_datetime || '-'}</td>
                      <td>
                        <div>{row.maininscl || '-'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.pttypename || '-'}</div>
                      </td>
                      <td className="table-cell-nowrap">{row.close_code || '-'}</td>
                      <td className="table-cell-nowrap">
                        <span className={`badge ${row.close_status === 'OK' ? 'badge-success' : row.close_status === 'Error' ? 'badge-danger' : row.close_status === 'Cancel' ? 'badge-warning' : 'badge-info'}`}>
                          {row.close_status || (disabled ? 'ปิดสิทธิแล้ว' : 'ต้องปิดสิทธิ')}
                        </span>
                      </td>
                      <td className="table-cell-nowrap">{Number(row.income || 0).toLocaleString()}</td>
                      <td className="table-cell-nowrap">{Number(row.uc_money || 0).toLocaleString()}</td>
                      <td className="table-cell-nowrap">{Number(row.rcpt_money || 0).toLocaleString()}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      {loading ? 'กำลังโหลดรายการ...' : 'ไม่พบรายการตามตัวกรองที่เลือก'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">ประวัติการปิดสิทธิ NHSO</div>
          <span className="badge badge-info">{history.length} รายการ</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="modal-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>VN</th>
                  <th>Seq</th>
                  <th>Authen Code</th>
                  <th>สถานะ</th>
                  <th>ยอดรวม</th>
                  <th>Source ID</th>
                  <th>ผู้บันทึก</th>
                  <th>เวลาตอบกลับ</th>
                </tr>
              </thead>
              <tbody>
                {history.length > 0 ? history.map((row) => (
                  <tr key={row.nhso_confirm_privilege_id}>
                    <td className="table-cell-nowrap">{row.vn}</td>
                    <td className="table-cell-nowrap">{row.nhso_seq || '-'}</td>
                    <td className="table-cell-nowrap">{row.nhso_authen_code || '-'}</td>
                    <td className="table-cell-nowrap">
                      <span className={`badge ${row.nhso_status === 'Y' ? 'badge-success' : row.nhso_status === 'C' ? 'badge-warning' : row.nhso_status === 'E' ? 'badge-danger' : 'badge-info'}`}>
                        {row.nhso_status === 'Y' ? 'OK' : row.nhso_status === 'C' ? 'Cancel' : row.nhso_status === 'E' ? 'Error' : '-'}
                      </span>
                    </td>
                    <td className="table-cell-nowrap">{Number(row.nhso_total_amount || 0).toLocaleString()}</td>
                    <td className="table-cell-nowrap">{row.sourceID || '-'}</td>
                    <td className="table-cell-nowrap">{row.confirm_staff || '-'}</td>
                    <td className="table-cell-nowrap">
                      <div>{row.nhso_response_datetime || row.nhso_requst_datetime || '-'}</div>
                      {parseHistoryDetail(row) && (
                        <div style={{ fontSize: 11, color: row.nhso_status === 'E' ? 'var(--danger)' : 'var(--text-muted)', marginTop: 4, maxWidth: 260, whiteSpace: 'normal' }}>
                          {parseHistoryDetail(row)}
                        </div>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      ยังไม่มีประวัติการปิดสิทธิ NHSO
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
