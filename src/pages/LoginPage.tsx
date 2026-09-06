import { useState } from 'react';
import { login, register, type AuthSession } from '../services/authService';
import {
  clearSavedApiBaseUrl,
  getEffectiveApiBaseUrl,
  getSavedApiBaseUrl,
  isNativeApp,
  saveApiBaseUrl,
} from '../services/apiEndpointService';

type Props = {
  onAuthenticated: (session: AuthSession) => void;
};

export const LoginPage = ({ onAuthenticated }: Props) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverPanelOpen, setServerPanelOpen] = useState(() => isNativeApp() && !getEffectiveApiBaseUrl());
  const [apiBaseUrl, setApiBaseUrl] = useState(() => getEffectiveApiBaseUrl());
  const [serverTesting, setServerTesting] = useState(false);
  const [serverMessage, setServerMessage] = useState('');
  const [serverError, setServerError] = useState('');

  const effectiveApiBaseUrl = getEffectiveApiBaseUrl();
  const serverLabel = effectiveApiBaseUrl
    ? effectiveApiBaseUrl.replace(/^https?:\/\//, '')
    : isNativeApp()
      ? 'ยังไม่ได้ตั้งค่า'
      : 'เซิร์ฟเวอร์เดียวกับหน้าเว็บ';

  const handleServerTest = async () => {
    setServerError('');
    setServerMessage('');
    setServerTesting(true);
    try {
      const normalized = saveApiBaseUrl(apiBaseUrl);
      if (isNativeApp() && !normalized) {
        throw new Error('กรุณากรอก HTTPS URL ของ FDH Checker API');
      }
      setApiBaseUrl(normalized);
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) throw new Error(`เซิร์ฟเวอร์ตอบกลับ ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('ปลายทางนี้ไม่ใช่ FDH Checker API');
      setServerMessage('เชื่อมต่อเซิร์ฟเวอร์สำเร็จ');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setServerTesting(false);
    }
  };

  const handleClearServer = () => {
    clearSavedApiBaseUrl();
    setApiBaseUrl('');
    setServerMessage('');
    setServerError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const session = await login(username, password);
        onAuthenticated(session);
      } else {
        if (password !== confirmPassword) {
          throw new Error('ยืนยันรหัสผ่านไม่ตรงกัน');
        }
        const result = await register({ username, password, displayName });
        setMessage(result.message || 'สมัครสมาชิกแล้ว กรุณารอ admin อนุมัติ');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-icon">🏥</div>
          <div>
            <h1>FDH Checker</h1>
            <p>เข้าสู่ระบบก่อนใช้งาน และผู้ใช้ใหม่ต้องรอ admin approve</p>
          </div>
        </div>

        <div className={`auth-server-status ${effectiveApiBaseUrl || !isNativeApp() ? 'is-ready' : 'is-missing'}`}>
          <span className="auth-server-dot" aria-hidden="true" />
          <div>
            <small>เซิร์ฟเวอร์ FDH</small>
            <strong>{serverLabel}</strong>
          </div>
          <button type="button" onClick={() => setServerPanelOpen((open) => !open)}>
            {serverPanelOpen ? 'ปิด' : 'ตั้งค่า'}
          </button>
        </div>

        {serverPanelOpen && (
          <div className="auth-server-panel">
            <label>
              HTTPS URL ของ API
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder="https://fdh-api.example.go.th"
              />
            </label>
            <p>กรอกเฉพาะโดเมน ไม่ต้องต่อท้าย <code>/api</code></p>
            {serverError && <div className="auth-alert auth-alert--error">{serverError}</div>}
            {serverMessage && <div className="auth-alert auth-alert--success">{serverMessage}</div>}
            <div className="auth-server-actions">
              {getSavedApiBaseUrl() && <button type="button" onClick={handleClearServer}>ล้างค่า</button>}
              <button type="button" className="is-primary" onClick={() => void handleServerTest()} disabled={serverTesting}>
                {serverTesting ? 'กำลังทดสอบ…' : 'บันทึกและทดสอบ'}
              </button>
            </div>
          </div>
        )}

        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>เข้าสู่ระบบ</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>สมัครสมาชิก</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              ชื่อ-สกุล
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="ชื่อที่แสดงในระบบ" />
            </label>
          )}
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              required
            />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </label>
          {mode === 'register' && (
            <label>
              ยืนยัน Password
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
            </label>
          )}

          {error && <div className="auth-alert auth-alert--error">{error}</div>}
          {message && <div className="auth-alert auth-alert--success">{message}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'กำลังดำเนินการ...' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครและรออนุมัติ'}
          </button>
        </form>
      </div>
    </div>
  );
};
