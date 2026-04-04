import React, { useEffect, useMemo, useState } from 'react';

interface ImportResultItem {
  transaction_uid: string;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown>;
  response_status?: number;
  response_message?: string;
  response_message_th?: string;
}

interface ImportLogItem {
  id: number;
  transaction_uid: string;
  hcode: string;
  environment: string;
  response_status?: number;
  response_message?: string;
  response_message_th?: string;
  imported_at: string;
}

interface FdhApiSettings {
  environment?: 'prd' | 'uat';
  hcode?: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
  upload16Url?: string;
  preScreenUrl?: string;
  username?: string;
}

export const FDHImportStatusPage: React.FC = () => {
  const [jwtToken, setJwtToken] = useState('');
  const [transactionUidText, setTransactionUidText] = useState('');
  const [hcode, setHcode] = useState('');
  const [environment, setEnvironment] = useState<'prd' | 'uat'>('prd');
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [results, setResults] = useState<ImportResultItem[]>([]);
  const [logs, setLogs] = useState<ImportLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestingToken, setRequestingToken] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [fdhSettings, setFdhSettings] = useState<FdhApiSettings | null>(null);

  const transactionUids = useMemo(
    () => transactionUidText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    [transactionUidText]
  );

  const effectiveHcode = (hcode || fdhSettings?.hcode || '').trim();

  const fetchSettingsAndLogs = async () => {
    try {
      setLogsLoading(true);
      const [settingsRes, logsRes] = await Promise.all([
        fetch('/api/config/fdh-api-settings'),
        fetch('/api/fdh/import-status/logs'),
      ]);

      const settingsJson = await settingsRes.json();
      const logsJson = await logsRes.json();

      if (settingsJson?.data) {
        setFdhSettings(settingsJson.data || null);
        setHcode(settingsJson.data.hcode || '');
        setEnvironment(settingsJson.data.environment || 'prd');
      }

      if (logsJson?.success) {
        setLogs(logsJson.data || []);
      }
    } catch {
      // Keep page usable even if settings/logs fail
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void fetchSettingsAndLogs();
  }, []);

  const handleImportStatus = async () => {
    if (!jwtToken.trim()) {
      setError('กรุณากรอก JWT token จาก FDH ก่อน');
      return;
    }

    if (!effectiveHcode) {
      setError('กรุณากรอก HCODE');
      return;
    }

    if (transactionUids.length === 0) {
      setError('กรุณากรอก transaction_uid อย่างน้อย 1 รายการ');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/fdh/import-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jwtToken: jwtToken.trim(),
          hcode: effectiveHcode,
          environment,
          transactionUids,
        }),
      });

      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถนำเข้าสถานะจาก FDH ได้');
      }

      setResults(json.data || []);
      await fetchSettingsAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการนำเข้าสถานะ');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestToken = async () => {
    try {
      setRequestingToken(true);
      setError(null);
      setConnectionMessage(null);
      const response = await fetch('/api/fdh/request-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment })
      });

      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถขอ token อัตโนมัติได้');
      }

      setJwtToken(json.token || '');
      setConnectionMessage('เชื่อมต่อ FDH token endpoint สำเร็จ และเติม token ให้แล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการขอ token');
    } finally {
      setRequestingToken(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTestingConnection(true);
      setError(null);
      setConnectionMessage(null);
      const response = await fetch('/api/fdh/request-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, hcode })
      });

      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'ทดสอบการเชื่อมต่อ FDH ไม่สำเร็จ');
      }

      if (typeof json.token === 'string' && json.token.trim()) {
        setJwtToken(json.token.trim());
      }

      setConnectionMessage(`ทดสอบการเชื่อมต่อสำเร็จ (${environment.toUpperCase()}) สำหรับ HCODE ${effectiveHcode || '-'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการทดสอบการเชื่อมต่อ');
    } finally {
      setTestingConnection(false);
    }
  };

  const maskedToken = useMemo(() => {
    if (!jwtToken.trim()) return 'ยังไม่มี token';
    if (jwtToken.length <= 18) return jwtToken;
    return `${jwtToken.slice(0, 12)}...${jwtToken.slice(-6)}`;
  }, [jwtToken]);

  const settingsSummary = useMemo(() => ({
    hcode: hcode || fdhSettings?.hcode || '-',
    user: fdhSettings?.username || '-',
    tokenUrl: fdhSettings?.tokenUrl || 'https://fdh.moph.go.th/token?Action=get_moph_access_token',
    upload16Url: fdhSettings?.upload16Url || 'https://fdh.moph.go.th/api/v2/data_hub/16_files',
    preScreenUrl: fdhSettings?.preScreenUrl || 'https://fdh.moph.go.th/api/v1/auth/open_api/fda/file',
    apiBaseUrl: fdhSettings?.apiBaseUrl || 'https://fdh.moph.go.th'
  }), [fdhSettings, hcode]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">📥 นำเข้าสถานะจาก FDH</h1>
        <p className="page-subtitle">
          ดึงสถานะการจอง/การรับข้อมูลจาก FDH ผ่าน API <code>/api/v2/reservation/get</code> โดยใช้ <code>transaction_uid</code> และ <code>HCODE</code>
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>ℹ️</span>
            <span>
              หน้านี้ออกแบบให้เข้ากับ flow ของโปรแกรม FDH เดิมของโรงพยาบาล โดยแยกส่วน Token, HCODE และรายการ <code>transaction_uid</code> สำหรับนำเข้าสถานะแบบรอบเดียวหลายรายการ
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>ค่าที่จะใช้เชื่อมต่อ FDH</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                <div>Hospital Code: <strong>{settingsSummary.hcode}</strong></div>
                <div>User: <strong>{settingsSummary.user}</strong></div>
                <div>Environment: <strong>{environment.toUpperCase()}</strong></div>
                <div>Token ปัจจุบัน: <strong>{maskedToken}</strong></div>
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>ปลายทาง API</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8, wordBreak: 'break-word' }}>
                <div>URL Token: <strong>{settingsSummary.tokenUrl}</strong></div>
                <div>URL ส่ง 16 แฟ้ม: <strong>{settingsSummary.upload16Url}</strong></div>
                <div>URL PreScreen: <strong>{settingsSummary.preScreenUrl}</strong></div>
                <div>URL สำรองแจ้ง: <strong>{settingsSummary.apiBaseUrl}</strong></div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">Environment</label>
              <select className="form-control" value={environment} onChange={(e) => setEnvironment(e.target.value as 'prd' | 'uat')}>
                <option value="prd">Production</option>
                <option value="uat">UAT</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">HCODE</label>
              <input className="form-control" value={effectiveHcode} readOnly placeholder="ดึงจากฐานข้อมูลอัตโนมัติ" />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">JWT Token</label>
            <textarea
              className="form-control"
              rows={4}
              value={jwtToken}
              onChange={(e) => setJwtToken(e.target.value)}
              placeholder="วาง Bearer JWT token จาก FDH ที่นี่"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn btn-secondary" onClick={handleTestConnection} disabled={requestingToken || testingConnection}>
                {testingConnection ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
              </button>
              <button className="btn btn-secondary" onClick={handleRequestToken} disabled={requestingToken}>
                {requestingToken ? 'กำลังขอ token...' : 'ขอ token อัตโนมัติ'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                ปุ่มทั้งสองจะใช้ username/password จากหน้า Settings เพื่อทดลองเชื่อมต่อและขอ token ให้ก่อน
              </span>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Transaction UID</label>
            <textarea
              className="form-control"
              rows={6}
              value={transactionUidText}
              onChange={(e) => setTransactionUidText(e.target.value)}
              placeholder="ใส่ transaction_uid ทีละบรรทัด"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              พบ {transactionUids.length.toLocaleString()} รายการที่จะนำเข้าสถานะ
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleImportStatus} disabled={loading}>
              {loading ? 'กำลังนำเข้าสถานะ...' : 'ดึงสถานะจาก FDH'}
            </button>
            <button className="btn btn-secondary" onClick={() => setResults([])} disabled={loading}>
              ล้างผลลัพธ์
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {connectionMessage && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>✅</span>
          <span>{connectionMessage}</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">ผลการนำเข้าสถานะล่าสุด</div>
          <span className="badge badge-primary">{results.length} รายการ</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {results.length > 0 ? (
            <div className="modal-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Transaction UID</th>
                    <th>HTTP/Status</th>
                    <th>Message</th>
                    <th>Message TH</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((item, index) => (
                    <tr key={`${item.transaction_uid}-${index}`}>
                      <td>{index + 1}</td>
                      <td className="table-cell-nowrap" style={{ fontFamily: 'monospace' }}>{item.transaction_uid}</td>
                      <td>
                        <span className={`badge ${item.response_status === 200 ? 'badge-success' : item.response_status ? 'badge-warning' : 'badge-danger'}`}>
                          {item.response_status || '-'}
                        </span>
                      </td>
                      <td>{item.response_message || '-'}</td>
                      <td>{item.response_message_th || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
              ยังไม่มีผลลัพธ์จากการนำเข้าในรอบนี้
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">ประวัติการนำเข้าสถานะ</div>
          <span className="badge badge-info">{logsLoading ? 'กำลังโหลด...' : `${logs.length} รายการ`}</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {logs.length > 0 ? (
            <div className="modal-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Transaction UID</th>
                    <th>HCODE</th>
                    <th>ENV</th>
                    <th>Status</th>
                    <th>Message TH</th>
                    <th>Imported At</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td className="table-cell-nowrap" style={{ fontFamily: 'monospace' }}>{item.transaction_uid}</td>
                      <td className="table-cell-nowrap">{item.hcode}</td>
                      <td><span className="badge badge-primary">{item.environment.toUpperCase()}</span></td>
                      <td><span className={`badge ${item.response_status === 200 ? 'badge-success' : 'badge-warning'}`}>{item.response_status || '-'}</span></td>
                      <td>{item.response_message_th || item.response_message || '-'}</td>
                      <td className="table-cell-nowrap">{item.imported_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
              ยังไม่มีประวัติการนำเข้าสถานะ
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
