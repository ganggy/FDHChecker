import { useEffect, useState } from 'react';

type Config = {
  type: 'mysql' | 'postgresql'; host: string; port: number; database: string; schema: string;
  user: string; passwordConfigured: boolean; ssl: boolean;
};
type Check = { connected: boolean; compatible: boolean; missing: string[]; message: string };
const endpoint = '/api/config/hospital-database';

export function HospitalDatabaseSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [active, setActive] = useState<Config | null>(null);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restartRequired, setRestartRequired] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'โหลดค่าการเชื่อมต่อไม่สำเร็จ');
      setConfig(body.data); setActive(body.active); setRestartRequired(body.restartRequired);
    }).catch((cause: Error) => { if (cause.name !== 'AbortError') setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  function update(value: Partial<Config>) {
    setConfig((previous) => previous ? { ...previous, ...value } : previous);
    setCheck(null); setMessage(''); setError('');
  }
  async function submit(action: 'test' | 'save') {
    if (!config) return;
    setBusy(true); setError(''); setMessage(''); setCheck(null);
    try {
      const response = await fetch(`${endpoint}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, password: clearPassword ? '' : password || undefined }),
      });
      const body = await response.json();
      if (body.data) setCheck(body.data);
      if (!response.ok || !body.success) throw new Error(body.error || 'ดำเนินการไม่สำเร็จ');
      if (action === 'save') {
        setRestartRequired(body.restartRequired);
        setConfig({ ...config, passwordConfigured: clearPassword ? false : Boolean(password) || config.passwordConfigured });
        setPassword(''); setClearPassword(false);
        setMessage(body.restartRequired ? 'บันทึกแล้ว ให้ผู้ดูแลรีสตาร์ต backend เพื่อใช้ฐานข้อมูลที่เลือก' : 'บันทึกแล้ว ค่าตรงกับฐานข้อมูลที่กำลังใช้งาน');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'เชื่อมต่อไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  if (loading) return <p>กำลังโหลดค่าฐานข้อมูลโรงพยาบาล...</p>;
  if (!config) return <p role="alert">{error || 'ไม่สามารถโหลดค่าการเชื่อมต่อได้'}</p>;
  return <section className="settings-section">
    <h3>ฐานข้อมูล HOSxP ของโรงพยาบาล</h3>
    <p>เลือกชนิดฐานข้อมูลและระบุชื่อฐานข้อมูลของโรงพยาบาลนี้ ระบบตรวจการเชื่อมต่อและตารางหลักอีกครั้งก่อนบันทึก</p>
    {active && <p>กำลังใช้งาน: <strong>{active.type === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL'} · {active.database}</strong></p>}
    {restartRequired && <p role="status" className="settings-status-chip is-warning">มีค่าที่บันทึกไว้รอรีสตาร์ต backend</p>}
    <form onSubmit={(event) => { event.preventDefault(); void submit('save'); }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="settings-grid">
          <div className="form-group"><label htmlFor="his-db-type">ชนิดฐานข้อมูล</label>
            <select id="his-db-type" value={config.type} onChange={(event) => {
              const type = event.target.value as Config['type'];
              update({ type, port: type === 'postgresql' ? 5432 : 3306, schema: type === 'postgresql' ? config.schema || 'public' : '' });
            }}><option value="mysql">MySQL / MariaDB</option><option value="postgresql">PostgreSQL — อ่านข้อมูล</option></select>
          </div>
          <div className="form-group"><label htmlFor="his-db-host">Host</label><input id="his-db-host" required value={config.host} onChange={(event) => update({ host: event.target.value })} /></div>
          <div className="form-group"><label htmlFor="his-db-port">Port</label><input id="his-db-port" required type="number" min={1} max={65535} value={config.port} onChange={(event) => update({ port: Number(event.target.value) })} /></div>
          <div className="form-group"><label htmlFor="his-db-name">ชื่อฐานข้อมูล</label><input id="his-db-name" required value={config.database} onChange={(event) => update({ database: event.target.value })} /></div>
          {config.type === 'postgresql' && <div className="form-group"><label htmlFor="his-db-schema">Schema</label><input id="his-db-schema" required pattern="[a-z_][a-z0-9_]*" value={config.schema} onChange={(event) => update({ schema: event.target.value })} /></div>}
          <div className="form-group"><label htmlFor="his-db-user">ผู้ใช้ฐานข้อมูล</label><input id="his-db-user" required autoComplete="off" value={config.user} onChange={(event) => update({ user: event.target.value })} /></div>
          <div className="form-group"><label htmlFor="his-db-password">รหัสผ่าน{config.passwordConfigured ? ' (เว้นว่างเพื่อใช้ค่าเดิม)' : ''}</label><input id="his-db-password" type="password" autoComplete="new-password" disabled={clearPassword} value={password} onChange={(event) => { setPassword(event.target.value); setCheck(null); }} /></div>
        </div>
        <p><label><input type="checkbox" checked={config.ssl} onChange={(event) => update({ ssl: event.target.checked })} /> ใช้ SSL พร้อมตรวจสอบใบรับรองเซิร์ฟเวอร์</label></p>
        <p><label><input type="checkbox" checked={clearPassword} onChange={(event) => { setClearPassword(event.target.checked); setCheck(null); }} /> ล้างรหัสผ่านที่บันทึกไว้</label></p>
        {config.type === 'postgresql' && <div role="note">
          <p><strong>PostgreSQL เปิดใช้งานแบบอ่านข้อมูล:</strong> ยังไม่เปิดฟังก์ชันแก้ไขข้อมูล HOSxP รายงานที่ใช้ SQL ไม่รองรับจะแสดงข้อผิดพลาด ต้องตรวจผลรายงานและการจับคู่รหัสของโรงพยาบาลก่อนใช้งานจริง</p>
          <p>ฐานผู้ใช้และ REP/STM ของ FDH Checker ยังคงใช้ MySQL/MariaDB แยกต่างหาก</p>
        </div>}
        <div className="settings-header-actions">
          <button className="secondary-btn" type="button" onClick={() => void submit('test')}>ทดสอบการเชื่อมต่อ</button>
          <button className="save-btn" type="submit">{busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบและบันทึกการเชื่อมต่อ'}</button>
        </div>
      </fieldset>
    </form>
    {check && <div role="status"><p>{check.message}</p>{check.missing.length > 0 && <><p>ตารางหรือคอลัมน์ที่ขาด:</p><ul>{check.missing.map((field) => <li key={field}><code>{field}</code></li>)}</ul></>}</div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
