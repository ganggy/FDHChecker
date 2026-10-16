import { useEffect, useState } from 'react';
import {
  fetchFacilityDatabases,
  testFacilityDatabase,
  saveFacilityDatabase,
  deleteFacilityDatabase,
  type FacilityDatabaseItem,
} from '../services/authService';

type Config = {
  type: 'mysql' | 'postgresql';
  host: string;
  port: number;
  database: string;
  schema: string;
  user: string;
  passwordConfigured: boolean;
  ssl: boolean;
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

  // Facility Databases state
  const [facilityDatabases, setFacilityDatabases] = useState<FacilityDatabaseItem[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(false);
  const [facilityEditorOpen, setFacilityEditorOpen] = useState(false);
  const [editingFacility, setEditingFacility] = useState<{
    hcode: string;
    isNew: boolean;
    type: 'mysql' | 'postgresql';
    host: string;
    port: number;
    database: string;
    schema: string;
    user: string;
    password: string;
    passwordConfigured: boolean;
    ssl: boolean;
  }>({
    hcode: '',
    isNew: true,
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: 'hos',
    schema: '',
    user: '',
    password: '',
    passwordConfigured: false,
    ssl: false,
  });
  const [facilityBusy, setFacilityBusy] = useState(false);
  const [facilityCheck, setFacilityCheck] = useState<Check | null>(null);
  const [facilityError, setFacilityError] = useState('');
  const [facilityMessage, setFacilityMessage] = useState('');

  const loadFacilityDbs = async () => {
    try {
      setLoadingFacilities(true);
      const list = await fetchFacilityDatabases();
      setFacilityDatabases(list);
    } catch {
      // ignore
    } finally {
      setLoadingFacilities(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'โหลดค่าการเชื่อมต่อไม่สำเร็จ');
        setConfig(body.data);
        setActive(body.active);
        setRestartRequired(body.restartRequired);
      })
      .catch((cause: Error) => {
        if (cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    loadFacilityDbs();
    return () => controller.abort();
  }, []);

  function update(value: Partial<Config>) {
    setConfig((previous) => (previous ? { ...previous, ...value } : previous));
    setCheck(null);
    setMessage('');
    setError('');
  }

  async function submit(action: 'test' | 'save') {
    if (!config) return;
    setBusy(true);
    setError('');
    setMessage('');
    setCheck(null);
    try {
      const response = await fetch(`${endpoint}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, password: clearPassword ? '' : password || undefined }),
      });
      const body = await response.json();
      if (body.data) setCheck(body.data);
      if (!response.ok || !body.success) throw new Error(body.error || 'ดำเนินการไม่สำเร็จ');
      if (action === 'save') {
        setRestartRequired(body.restartRequired);
        setConfig({
          ...config,
          passwordConfigured: clearPassword ? false : Boolean(password) || config.passwordConfigured,
        });
        setPassword('');
        setClearPassword(false);
        setMessage(
          body.restartRequired
            ? 'บันทึกแล้ว ให้ผู้ดูแลรีสตาร์ต backend เพื่อใช้ฐานข้อมูลที่เลือก'
            : 'บันทึกแล้ว ค่าตรงกับฐานข้อมูลที่กำลังใช้งาน'
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เชื่อมต่อไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  // Facility DB actions
  const openNewFacilityEditor = () => {
    setEditingFacility({
      hcode: '',
      isNew: true,
      type: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      database: 'hos',
      schema: '',
      user: '',
      password: '',
      passwordConfigured: false,
      ssl: false,
    });
    setFacilityCheck(null);
    setFacilityError('');
    setFacilityMessage('');
    setFacilityEditorOpen(true);
  };

  const openEditFacility = (item: FacilityDatabaseItem) => {
    setEditingFacility({
      hcode: item.hcode,
      isNew: false,
      type: item.type,
      host: item.host,
      port: item.port,
      database: item.database,
      schema: item.schema || '',
      user: item.user,
      password: '',
      passwordConfigured: item.passwordConfigured,
      ssl: item.ssl,
    });
    setFacilityCheck(null);
    setFacilityError('');
    setFacilityMessage('');
    setFacilityEditorOpen(true);
  };

  const handleTestFacility = async (hcode?: string) => {
    setFacilityBusy(true);
    setFacilityCheck(null);
    setFacilityError('');
    setFacilityMessage('');
    try {
      const targetHcode = hcode || editingFacility.hcode;
      if (!targetHcode || !/^\d{5}$/.test(targetHcode.trim())) {
        throw new Error('รหัสหน่วยบริการต้องเป็นตัวเลข 5 หลัก');
      }
      const payload = hcode
        ? {}
        : {
            type: editingFacility.type,
            host: editingFacility.host,
            port: editingFacility.port,
            database: editingFacility.database,
            schema: editingFacility.type === 'postgresql' ? editingFacility.schema : '',
            user: editingFacility.user,
            password: editingFacility.password || undefined,
            ssl: editingFacility.ssl,
          };
      const result = await testFacilityDatabase(targetHcode.trim(), payload);
      setFacilityCheck(result);
      if (result.connected && result.compatible) {
        setFacilityMessage(`✅ เชื่อมต่อฐานข้อมูลสำเร็จ โครงสร้างตารางถูกต้อง`);
      } else if (result.connected) {
        setFacilityError(`⚠️ เชื่อมต่อได้แต่โครงสร้างตารางไม่ครบ: ${result.message}`);
      }
    } catch (err) {
      setFacilityError(err instanceof Error ? err.message : 'เชื่อมต่อฐานข้อมูล รพ.สต. ไม่สำเร็จ');
    } finally {
      setFacilityBusy(false);
    }
  };

  const handleSaveFacility = async (event: React.FormEvent) => {
    event.preventDefault();
    setFacilityBusy(true);
    setFacilityCheck(null);
    setFacilityError('');
    setFacilityMessage('');
    try {
      const hcode = editingFacility.hcode.trim();
      if (!/^\d{5}$/.test(hcode)) {
        throw new Error('รหัสหน่วยบริการ (HCODE) ต้องเป็นตัวเลข 5 หลักเท่านั้น');
      }
      const payload = {
        type: editingFacility.type,
        host: editingFacility.host.trim(),
        port: editingFacility.port,
        database: editingFacility.database.trim(),
        schema: editingFacility.type === 'postgresql' ? editingFacility.schema.trim() : '',
        user: editingFacility.user.trim(),
        password: editingFacility.password ? editingFacility.password : undefined,
        ssl: editingFacility.ssl,
      };

      const res = await saveFacilityDatabase(hcode, payload);
      setFacilityMessage(`✅ บันทึกการเชื่อมต่อฐานข้อมูล รพ.สต. ${hcode} สำเร็จ (มีผลทันทีไม่ต้องรีสตาร์ต)`);
      setFacilityCheck(res.test);
      await loadFacilityDbs();
      setFacilityEditorOpen(false);
    } catch (err) {
      setFacilityError(err instanceof Error ? err.message : 'บันทึกการเชื่อมต่อไม่สำเร็จ');
    } finally {
      setFacilityBusy(false);
    }
  };

  const handleDeleteFacility = async (hcode: string) => {
    if (!window.confirm(`ยืนยันการลบการตั้งค่าฐานข้อมูลสำหรับ รพ.สต. ${hcode} ใช่หรือไม่?\n(เมื่อลบแล้ว ผู้ใช้งานจากหน่วยบริการนี้จะเปลี่ยนไปใช้ฐานข้อมูล รพ. หลัก)`)) {
      return;
    }
    setFacilityBusy(true);
    setFacilityError('');
    setFacilityMessage('');
    try {
      await deleteFacilityDatabase(hcode);
      setFacilityMessage(`ลบการเชื่อมต่อฐานข้อมูล รพ.สต. ${hcode} แล้ว`);
      await loadFacilityDbs();
    } catch (err) {
      setFacilityError(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
    } finally {
      setFacilityBusy(false);
    }
  };

  if (loading) return <p>กำลังโหลดค่าฐานข้อมูลโรงพยาบาล...</p>;
  if (!config) return <p role="alert">{error || 'ไม่สามารถโหลดค่าการเชื่อมต่อได้'}</p>;

  return (
    <div>
      <section className="settings-section">
        <h3>ฐานข้อมูล HOSxP ของโรงพยาบาลหลัก</h3>
        <p>เลือกชนิดฐานข้อมูลและระบุชื่อฐานข้อมูลของโรงพยาบาลนี้ ระบบตรวจการเชื่อมต่อและตารางหลักอีกครั้งก่อนบันทึก</p>
        {active && (
          <p>
            กำลังใช้งาน: <strong>{active.type === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL'} · {active.database}</strong>
          </p>
        )}
        {restartRequired && (
          <p role="status" className="settings-status-chip is-warning">
            มีค่าที่บันทึกไว้รอรีสตาร์ต backend
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit('save');
          }}
        >
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="settings-grid">
              <div className="form-group">
                <label htmlFor="his-db-type">ชนิดฐานข้อมูล</label>
                <select
                  id="his-db-type"
                  value={config.type}
                  onChange={(event) => {
                    const type = event.target.value as Config['type'];
                    update({
                      type,
                      port: type === 'postgresql' ? 5432 : 3306,
                      schema: type === 'postgresql' ? config.schema || 'public' : '',
                    });
                  }}
                >
                  <option value="mysql">MySQL / MariaDB</option>
                  <option value="postgresql">PostgreSQL — อ่านข้อมูล</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="his-db-host">Host</label>
                <input
                  id="his-db-host"
                  required
                  value={config.host}
                  onChange={(event) => update({ host: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="his-db-port">Port</label>
                <input
                  id="his-db-port"
                  required
                  type="number"
                  min={1}
                  max={65535}
                  value={config.port}
                  onChange={(event) => update({ port: Number(event.target.value) })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="his-db-name">ชื่อฐานข้อมูล</label>
                <input
                  id="his-db-name"
                  required
                  value={config.database}
                  onChange={(event) => update({ database: event.target.value })}
                />
              </div>
              {config.type === 'postgresql' && (
                <div className="form-group">
                  <label htmlFor="his-db-schema">Schema</label>
                  <input
                    id="his-db-schema"
                    required
                    pattern="[a-z_][a-z0-9_]*"
                    value={config.schema}
                    onChange={(event) => update({ schema: event.target.value })}
                  />
                </div>
              )}
              <div className="form-group">
                <label htmlFor="his-db-user">ผู้ใช้ฐานข้อมูล</label>
                <input
                  id="his-db-user"
                  required
                  autoComplete="off"
                  value={config.user}
                  onChange={(event) => update({ user: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="his-db-password">
                  รหัสผ่าน{config.passwordConfigured ? ' (เว้นว่างเพื่อใช้ค่าเดิม)' : ''}
                </label>
                <input
                  id="his-db-password"
                  type="password"
                  autoComplete="new-password"
                  disabled={clearPassword}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setCheck(null);
                  }}
                />
              </div>
            </div>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={config.ssl}
                  onChange={(event) => update({ ssl: event.target.checked })}
                />{' '}
                ใช้ SSL พร้อมตรวจสอบใบรับรองเซิร์ฟเวอร์
              </label>
            </p>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(event) => {
                    setClearPassword(event.target.checked);
                    setCheck(null);
                  }}
                />{' '}
                ล้างรหัสผ่านที่บันทึกไว้
              </label>
            </p>
            {config.type === 'postgresql' && (
              <div role="note">
                <p>
                  <strong>PostgreSQL เปิดใช้งานแบบอ่านข้อมูล:</strong> ยังไม่เปิดฟังก์ชันแก้ไขข้อมูล HOSxP
                  รายงานที่ใช้ SQL ไม่รองรับจะแสดงข้อผิดพลาด ต้องตรวจผลรายงานและการจับคู่รหัสของโรงพยาบาลก่อนใช้งานจริง
                </p>
                <p>ฐานผู้ใช้และ REP/STM ของ FDH Checker ยังคงใช้ MySQL/MariaDB แยกต่างหาก</p>
              </div>
            )}
            <div className="settings-header-actions">
              <button className="secondary-btn" type="button" onClick={() => void submit('test')}>
                ทดสอบการเชื่อมต่อ
              </button>
              <button className="save-btn" type="submit">
                {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบและบันทึกการเชื่อมต่อ'}
              </button>
            </div>
          </fieldset>
        </form>
        {check && (
          <div role="status">
            <p>{check.message}</p>
            {check.missing.length > 0 && (
              <>
                <p>ตารางหรือคอลัมน์ที่ขาด:</p>
                <ul>
                  {check.missing.map((field) => (
                    <li key={field}>
                      <code>{field}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </section>

      {/* PCU / รพ.สต. Multi-facility Database Section */}
      <hr style={{ margin: '2.5rem 0', borderColor: 'var(--border-color, #e2e8f0)' }} />

      <section className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🏥</span>
              <span>ฐานข้อมูล HOSxP_PCU / MySQL สำหรับ รพ.สต. (แยกตาม HCODE)</span>
            </h3>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted, #64748b)', fontSize: '0.9rem' }}>
              เมื่อผู้ใช้งานจาก รพ.สต. ที่ผูกกับรหัส 5 หลักเข้าสู่ระบบ คำสั่งสืบค้น HIS และรายงานทั้งหมดจะเชื่อมต่อกับฐานข้อมูลของหน่วยบริการนั้นโดยตรง
              หากยังไม่ได้ตั้งค่าจะใช้ฐานข้อมูลโรงพยาบาลหลัก
            </p>
          </div>
          <button className="save-btn" type="button" onClick={openNewFacilityEditor}>
            ➕ เพิ่มการเชื่อมต่อ รพ.สต.
          </button>
        </div>

        {facilityMessage && <p role="status" style={{ padding: '0.75rem 1rem', background: 'rgba(34, 197, 94, 0.1)', color: '#15803d', borderRadius: 6 }}>{facilityMessage}</p>}
        {facilityError && <p role="alert" style={{ padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: 6 }}>{facilityError}</p>}

        {loadingFacilities ? (
          <p>กำลังโหลดรายการฐานข้อมูล รพ.สต....</p>
        ) : facilityDatabases.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', background: 'rgba(0,0,0,0.02)', borderRadius: 8, border: '1px dashed var(--border-color, #cbd5e1)' }}>
            <p style={{ margin: 0, color: 'var(--text-muted, #64748b)' }}>ยังไม่มีการกำหนดฐานข้อมูลแยกราย รพ.สต. (ขณะนี้ทุกหน่วยบริการใช้ฐานข้อมูลโรงพยาบาลหลักร่วมกัน)</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table className="repstm-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.04)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem' }}>HCODE</th>
                  <th style={{ padding: '0.75rem' }}>ชนิด</th>
                  <th style={{ padding: '0.75rem' }}>Host : Port</th>
                  <th style={{ padding: '0.75rem' }}>ชื่อฐานข้อมูล</th>
                  <th style={{ padding: '0.75rem' }}>ผู้ใช้งาน</th>
                  <th style={{ padding: '0.75rem' }}>SSL</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center' }}>การกระทำ</th>
                </tr>
              </thead>
              <tbody>
                {facilityDatabases.map((item) => (
                  <tr key={item.hcode} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>
                      <span style={{ padding: '2px 8px', background: 'rgba(14, 165, 233, 0.15)', color: '#0284c7', borderRadius: 4 }}>
                        {item.hcode}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>{item.type === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL'}</td>
                    <td style={{ padding: '0.75rem', fontFamily: 'monospace' }}>{item.host}:{item.port}</td>
                    <td style={{ padding: '0.75rem', fontWeight: 500 }}>{item.database}</td>
                    <td style={{ padding: '0.75rem' }}>{item.user}</td>
                    <td style={{ padding: '0.75rem' }}>
                      {item.ssl ? (
                        <span style={{ fontSize: '0.8rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(34, 197, 94, 0.2)', color: '#16a34a' }}>SSL</span>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                          onClick={() => void handleTestFacility(item.hcode)}
                          disabled={facilityBusy}
                          title="ทดสอบการเชื่อมต่อ"
                        >
                          🔌 ทดสอบ
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                          onClick={() => openEditFacility(item)}
                          disabled={facilityBusy}
                          title="แก้ไขการตั้งค่า"
                        >
                          ✏️ แก้ไข
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: '4px 10px', fontSize: '0.85rem', color: '#dc2626' }}
                          onClick={() => void handleDeleteFacility(item.hcode)}
                          disabled={facilityBusy}
                          title="ลบการเชื่อมต่อ"
                        >
                          🗑️ ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal or Card for editing/adding facility DB */}
        {facilityEditorOpen && (
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1.5rem',
              background: 'var(--surface-color, #ffffff)',
              borderRadius: 8,
              border: '1px solid var(--border-color, #cbd5e1)',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0 }}>
                {editingFacility.isNew ? '➕ เพิ่มการเชื่อมต่อฐานข้อมูล รพ.สต.' : `✏️ แก้ไขการเชื่อมต่อฐานข้อมูล รพ.สต. [${editingFacility.hcode}]`}
              </h4>
              <button
                type="button"
                className="secondary-btn"
                style={{ padding: '2px 8px' }}
                onClick={() => setFacilityEditorOpen(false)}
              >
                ✕ ปิด
              </button>
            </div>

            <form onSubmit={handleSaveFacility}>
              <div className="settings-grid">
                <div className="form-group">
                  <label htmlFor="facility-hcode">รหัสหน่วยบริการ (HCODE 5 หลัก)</label>
                  <input
                    id="facility-hcode"
                    required
                    pattern="\\d{5}"
                    maxLength={5}
                    placeholder="เช่น 01234"
                    disabled={!editingFacility.isNew}
                    value={editingFacility.hcode}
                    onChange={(e) => setEditingFacility({ ...editingFacility, hcode: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="facility-db-type">ชนิดฐานข้อมูล</label>
                  <select
                    id="facility-db-type"
                    value={editingFacility.type}
                    onChange={(e) => {
                      const type = e.target.value as 'mysql' | 'postgresql';
                      setEditingFacility({
                        ...editingFacility,
                        type,
                        port: type === 'postgresql' ? 5432 : 3306,
                      });
                    }}
                  >
                    <option value="mysql">MySQL / MariaDB (HOSxP_PCU / HosXP)</option>
                    <option value="postgresql">PostgreSQL — อ่านข้อมูล</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="facility-db-host">Host / IP เซิร์ฟเวอร์ รพ.สต.</label>
                  <input
                    id="facility-db-host"
                    required
                    placeholder="เช่น 192.168.1.50 หรือ domain"
                    value={editingFacility.host}
                    onChange={(e) => setEditingFacility({ ...editingFacility, host: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="facility-db-port">Port</label>
                  <input
                    id="facility-db-port"
                    required
                    type="number"
                    min={1}
                    max={65535}
                    value={editingFacility.port}
                    onChange={(e) => setEditingFacility({ ...editingFacility, port: Number(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="facility-db-database">ชื่อฐานข้อมูล</label>
                  <input
                    id="facility-db-database"
                    required
                    placeholder="เช่น hosxp_pcu หรือ hos"
                    value={editingFacility.database}
                    onChange={(e) => setEditingFacility({ ...editingFacility, database: e.target.value })}
                  />
                </div>
                {editingFacility.type === 'postgresql' && (
                  <div className="form-group">
                    <label htmlFor="facility-db-schema">Schema</label>
                    <input
                      id="facility-db-schema"
                      required
                      value={editingFacility.schema}
                      onChange={(e) => setEditingFacility({ ...editingFacility, schema: e.target.value })}
                    />
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="facility-db-user">ผู้ใช้งานฐานข้อมูล</label>
                  <input
                    id="facility-db-user"
                    required
                    autoComplete="off"
                    value={editingFacility.user}
                    onChange={(e) => setEditingFacility({ ...editingFacility, user: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="facility-db-password">
                    รหัสผ่าน
                    {!editingFacility.isNew && editingFacility.passwordConfigured ? ' (เว้นว่างไว้เพื่อใช้ค่าเดิม)' : ''}
                  </label>
                  <input
                    id="facility-db-password"
                    type="password"
                    autoComplete="new-password"
                    value={editingFacility.password}
                    onChange={(e) => setEditingFacility({ ...editingFacility, password: e.target.value })}
                  />
                </div>
              </div>

              <p style={{ marginTop: '0.75rem' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={editingFacility.ssl}
                    onChange={(e) => setEditingFacility({ ...editingFacility, ssl: e.target.checked })}
                  />{' '}
                  ใช้ SSL พร้อมตรวจสอบใบรับรองเซิร์ฟเวอร์
                </label>
              </p>

              {facilityCheck && (
                <div role="status" style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 6, background: facilityCheck.compatible ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
                  <p style={{ margin: 0, fontWeight: 500 }}>{facilityCheck.message}</p>
                  {facilityCheck.missing.length > 0 && (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>ตาราง/คอลัมน์ที่ขาด: {facilityCheck.missing.join(', ')}</p>
                  )}
                </div>
              )}

              <div className="settings-header-actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => void handleTestFacility()}
                  disabled={facilityBusy}
                >
                  {facilityBusy ? 'กำลังทดสอบ...' : '🔌 ทดสอบการเชื่อมต่อ'}
                </button>
                <button
                  className="save-btn"
                  type="submit"
                  disabled={facilityBusy}
                >
                  {facilityBusy ? 'กำลังบันทึก...' : '💾 ตรวจสอบและบันทึก'}
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => setFacilityEditorOpen(false)}
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
