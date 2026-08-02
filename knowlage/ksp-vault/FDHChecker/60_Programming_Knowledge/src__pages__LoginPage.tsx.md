---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/pages/LoginPage.tsx"
source_hash: "d66c34e2a3015eae9a8b347cd5614d52d728259a4edbe46277fa813bed75e67b"
managed_by: "sync-ksp-vault"
---
# LoginPage.tsx

> Source: `src/pages/LoginPage.tsx`
> SHA-256: `d66c34e2a3015eae9a8b347cd5614d52d728259a4edbe46277fa813bed75e67b`

````tsx
import { useState } from 'react';
import { login, register, type AuthSession } from '../services/authService';

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
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
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

````
