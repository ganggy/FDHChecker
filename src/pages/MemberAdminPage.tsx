import { useEffect, useMemo, useState } from 'react';
import { allMenuItems, primaryNavItems, rolePresets, toolNavGroups } from '../config/menuDefinitions';
import { FUND_DEFINITIONS } from '../config/fundDefinitions';
import {
  createMember,
  fetchMemberAdminData,
  fetchLoginLocks,
  saveGroup,
  unlockLoginLock,
  updateMember,
  type LoginLockItem,
  type MemberAdminData,
  type MemberGroup,
} from '../services/authService';
import type { AppPage } from '../utils/navigationState';

const menuSections = (() => {
  const byPage = new Map(allMenuItems.map((item) => [item.page, item]));
  const sections = [
    { label: 'งานเคลม OPD/IPD', icon: '🏥', items: primaryNavItems },
    ...toolNavGroups.map((group) => ({
      label: group.label,
      icon: group.icon,
      items: group.pages.map((page) => byPage.get(page)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    })),
  ];
  const used = new Set(sections.flatMap((section) => section.items.map((item) => item.page)));
  const rest = allMenuItems.filter((item) => !used.has(item.page));
  if (rest.length) sections.push({ label: 'อื่นๆ', icon: '📁', items: rest });
  return sections;
})();

const emptyGroup = (): { id: number | null; groupName: string; isAdmin: boolean; menuPermissions: AppPage[] } => ({
  id: null,
  groupName: '',
  isAdmin: false,
  menuPermissions: ['staff', 'ipd', 'fdh', 'guide'],
});

export const MemberAdminPage = () => {
  const [data, setData] = useState<MemberAdminData | null>(null);
  const [editingGroup, setEditingGroup] = useState(emptyGroup);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
    groupId: '',
    isAdmin: false,
    allFunds: true,
    fundPermissions: [] as string[],
  });
  const [fundEditor, setFundEditor] = useState<{ userId: number; name: string; allFunds: boolean; fundPermissions: string[] } | null>(null);
  const [loginLocks, setLoginLocks] = useState<LoginLockItem[]>([]);
  const [loadingLocks, setLoadingLocks] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [unlockingTarget, setUnlockingTarget] = useState<string | null>(null);
  const [lockFilter, setLockFilter] = useState<'all' | 'locked'>('locked');

  const loadLocks = async () => {
    try {
      setLoadingLocks(true);
      setLoginLocks(await fetchLoginLocks());
    } catch (err) {
      console.error('Cannot load login locks:', err);
    } finally {
      setLoadingLocks(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [memberData, lockData] = await Promise.all([
        fetchMemberAdminData(),
        fetchLoginLocks().catch(() => [] as LoginLockItem[]),
      ]);
      setData(memberData);
      setLoginLocks(lockData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลสมาชิกไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const pendingCount = useMemo(() => data?.users.filter((user) => !user.approved).length || 0, [data]);
  const lockedCount = useMemo(() => loginLocks.filter((item) => item.isLocked).length, [loginLocks]);

  const displayedLocks = useMemo(() => {
    if (lockFilter === 'locked') {
      return loginLocks.filter((item) => item.isLocked);
    }
    return loginLocks;
  }, [loginLocks, lockFilter]);

  const handleUnlock = async (ip?: string, all?: boolean) => {
    setError('');
    setMessage('');
    setUnlockingTarget(all ? 'ALL' : (ip || ''));
    try {
      const res = await unlockLoginLock(all ? { all: true } : { ip });
      setMessage(res.message);
      await loadLocks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ปลดล็อกไม่สำเร็จ');
    } finally {
      setUnlockingTarget(null);
    }
  };

  const handleUserUpdate = async (userId: number, payload: Parameters<typeof updateMember>[1]) => {
    setError('');
    setMessage('');
    try {
      await updateMember(userId, payload);
      setMessage('อัปเดตสมาชิกแล้ว');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปเดตสมาชิกไม่สำเร็จ');
    }
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (newUser.password.length < 12) {
      setError('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร');
      return;
    }
    if (newUser.password !== newUser.confirmPassword) {
      setError('ยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    setCreatingUser(true);
    try {
      await createMember({
        username: newUser.username,
        displayName: newUser.displayName,
        password: newUser.password,
        groupId: Number(newUser.groupId) || null,
        isAdmin: newUser.isAdmin,
        fundPermissions: newUser.allFunds ? null : newUser.fundPermissions,
      });
      setNewUser({ username: '', displayName: '', password: '', confirmPassword: '', groupId: '', isAdmin: false, allFunds: true, fundPermissions: [] });
      setMessage('เพิ่มผู้ใช้และเปิดใช้งานแล้ว');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เพิ่มผู้ใช้ไม่สำเร็จ');
    } finally {
      setCreatingUser(false);
    }
  };

  const toggleNewUserFund = (fundId: string) => {
    setNewUser((current) => ({
      ...current,
      fundPermissions: current.fundPermissions.includes(fundId)
        ? current.fundPermissions.filter((id) => id !== fundId)
        : [...current.fundPermissions, fundId],
    }));
  };

  const openFundEditor = (user: NonNullable<MemberAdminData>['users'][number]) => {
    setFundEditor({
      userId: user.id,
      name: user.display_name || user.username,
      allFunds: user.is_admin || user.fund_permissions === null,
      fundPermissions: user.fund_permissions || [],
    });
  };

  const toggleEditedFund = (fundId: string) => {
    setFundEditor((current) => current ? ({
      ...current,
      fundPermissions: current.fundPermissions.includes(fundId)
        ? current.fundPermissions.filter((id) => id !== fundId)
        : [...current.fundPermissions, fundId],
    }) : current);
  };

  const saveFundPermissions = async () => {
    if (!fundEditor) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await updateMember(fundEditor.userId, { fundPermissions: fundEditor.allFunds ? null : fundEditor.fundPermissions });
      setMessage(`บันทึกสิทธิ์กองทุนของ ${fundEditor.name} แล้ว`);
      setFundEditor(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกสิทธิ์กองทุนไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const startEditGroup = (group: MemberGroup) => {
    setEditingGroup({
      id: group.id,
      groupName: group.group_name,
      isAdmin: Boolean(group.is_admin),
      menuPermissions: group.menu_permissions,
    });
  };

  const togglePermission = (page: AppPage) => {
    setEditingGroup((current) => ({
      ...current,
      menuPermissions: current.menuPermissions.includes(page)
        ? current.menuPermissions.filter((item) => item !== page)
        : [...current.menuPermissions, page],
    }));
  };

  const handleSaveGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const nextData = await saveGroup(editingGroup);
      setData(nextData);
      setEditingGroup(emptyGroup());
      setMessage('บันทึกกลุ่มผู้ใช้แล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกกลุ่มไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="workflow-page member-admin-page">
      <section className="workflow-hero">
        <div className="workflow-hero__content">
          <div>
            <h1 className="workflow-hero__title">สมาชิกและสิทธิ์เมนู</h1>
            <p className="workflow-hero__description">อนุมัติผู้ใช้ใหม่ ตั้งกลุ่ม และเลือกเมนูที่แต่ละกลุ่มสามารถมองเห็นได้</p>
          </div>
          <div className="workflow-hero__meta">
            <span className="workflow-badge workflow-badge--accent">{pendingCount} รออนุมัติ</span>
            {lockedCount > 0 && (
              <button
                type="button"
                className="workflow-badge"
                style={{ background: '#ef4444', color: '#fff', cursor: 'pointer', border: 'none' }}
                onClick={() => document.getElementById('login-locks-section')?.scrollIntoView({ behavior: 'smooth' })}
              >
                🔒 {lockedCount} เครื่องถูกล็อก (คลิกดู)
              </button>
            )}
          </div>
        </div>
      </section>

      {error && <div className="auth-alert auth-alert--error">{error}</div>}
      {message && <div className="auth-alert auth-alert--success">{message}</div>}

      {lockedCount > 0 && (
        <div
          className="auth-alert"
          style={{
            background: '#fef2f2',
            border: '2px solid #ef4444',
            borderRadius: 8,
            padding: '1rem',
            color: '#991b1b',
            boxShadow: '0 2px 8px rgba(239, 68, 68, 0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.3rem' }}>🚨</span>
                <span>เครื่องที่กำลังถูก LOCK อยู่ในขณะนี้ ({lockedCount} เครื่อง):</span>
              </div>
              <div style={{ fontSize: '0.88rem', color: '#7f1d1d', marginTop: '0.2rem' }}>
                เครื่องเหล่านี้ใส่รหัสผ่านผิดเกินกำหนด (10 ครั้ง) ทำให้ระบบระงับการเข้าสู่ระบบ 15 นาที
              </div>
            </div>
            <button
              type="button"
              className="btn-primary btn-small"
              style={{ background: '#dc2626', borderColor: '#b91c1c' }}
              onClick={() => {
                setLockFilter('locked');
                document.getElementById('login-locks-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              ไปยังรายการจัดการ 👇
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem', marginTop: '0.85rem' }}>
            {loginLocks.filter((l) => l.isLocked).map((lock) => (
              <div
                key={lock.ip}
                style={{
                  background: '#fff',
                  border: '1px solid #fca5a5',
                  borderRadius: 6,
                  padding: '0.75rem 0.9rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#991b1b', fontSize: '0.95rem' }}>
                    🖥️ {lock.hostname ? lock.hostname : lock.ip}
                  </span>
                  <span style={{ fontSize: '0.75rem', background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                    ผิด {lock.count}/{lock.max} ครั้ง
                  </span>
                </div>
                {lock.hostname && (
                  <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    IP: <code>{lock.ip}</code>
                  </div>
                )}
                <div style={{ fontSize: '0.85rem', color: '#1e293b' }}>
                  👤 ผู้ใช้ล่าสุด: <strong>{lock.lastUsername || 'ไม่ระบุ'}</strong>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                  💻 เครื่อง/ระบบ: {lock.deviceInfo || 'ไม่ทราบอุปกรณ์'}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                  ⏱️ เหลือเวลาล็อกอีก: {Math.floor(lock.remainingSeconds / 60)} นาที {lock.remainingSeconds % 60} วินาที
                </div>
                <button
                  type="button"
                  className="btn-primary btn-small"
                  style={{ marginTop: '0.35rem', background: '#dc2626', borderColor: '#b91c1c' }}
                  onClick={() => void handleUnlock(lock.ip)}
                  disabled={unlockingTarget === lock.ip}
                >
                  {unlockingTarget === lock.ip ? 'กำลังปลดล็อก...' : '🔓 ปลดล็อกเครื่องนี้ทันที'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="card"><div className="card-body">กำลังโหลดข้อมูลสมาชิก...</div></div>
      ) : (
        <div className="member-admin-grid">
          <section className="card member-admin-panel">
            <div className="card-header">
              <div>
                <h3>เพิ่มผู้ใช้</h3>
                <div className="muted">บัญชีที่สร้างจากหน้านี้พร้อมเข้าสู่ระบบทันที</div>
              </div>
            </div>
            <form className="member-create-form" onSubmit={handleCreateUser}>
              <label>
                ชื่อผู้ใช้
                <input
                  value={newUser.username}
                  onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value.toLowerCase() }))}
                  pattern="[a-z0-9._-]{3,64}"
                  minLength={3}
                  maxLength={64}
                  autoComplete="off"
                  placeholder="เช่น somchai"
                  required
                />
              </label>
              <label>
                ชื่อที่แสดง
                <input value={newUser.displayName} onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} maxLength={191} placeholder="ชื่อ-นามสกุล" />
              </label>
              <label>
                รหัสผ่าน
                <input type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} minLength={12} autoComplete="new-password" required />
              </label>
              <label>
                ยืนยันรหัสผ่าน
                <input type="password" value={newUser.confirmPassword} onChange={(event) => setNewUser((current) => ({ ...current, confirmPassword: event.target.value }))} minLength={12} autoComplete="new-password" required />
              </label>
              <label>
                กลุ่มผู้ใช้
                <select value={newUser.groupId} onChange={(event) => setNewUser((current) => ({ ...current, groupId: event.target.value }))}>
                  <option value="">ผู้ใช้งานทั่วไป</option>
                  {data?.groups.map((group) => <option key={group.id} value={group.id}>{group.group_name}</option>)}
                </select>
              </label>
              <label className="inline-check member-create-admin">
                <input type="checkbox" checked={newUser.isAdmin} onChange={(event) => setNewUser((current) => ({ ...current, isAdmin: event.target.checked }))} />
                ให้สิทธิ์ผู้ดูแลระบบ
              </label>
              <div className="member-fund-access">
                <div className="member-fund-access__header">
                  <strong>กองทุนที่เข้าถึงได้</strong>
                  <label className="inline-check">
                    <input type="checkbox" checked={newUser.allFunds} onChange={(event) => setNewUser((current) => ({ ...current, allFunds: event.target.checked }))} />
                    ทุกกองทุน
                  </label>
                </div>
                {!newUser.allFunds && (
                  <div className="member-fund-grid">
                    {FUND_DEFINITIONS.map((fund) => (
                      <label key={fund.id}>
                        <input type="checkbox" checked={newUser.fundPermissions.includes(fund.id)} onChange={() => toggleNewUserFund(fund.id)} />
                        <span>{fund.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="member-create-actions">
                <small>รหัสผ่านอย่างน้อย 12 ตัวอักษร</small>
                <button className="btn-primary" type="submit" disabled={creatingUser}>
                  {creatingUser ? 'กำลังเพิ่มผู้ใช้...' : 'เพิ่มผู้ใช้'}
                </button>
              </div>
            </form>

            <div className="card-header">
              <h3>ผู้ใช้งาน</h3>
              <span className="workflow-table-meta">{data?.users.length || 0} users</span>
            </div>
            <div className="table-container">
              <table className="data-table member-table">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th>กลุ่ม</th>
                    <th>สถานะ</th>
                    <th>สิทธิ์</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.users.map((user) => (
                    <tr key={user.id} className={!user.approved ? 'row-warning' : ''}>
                      <td>
                        <strong>{user.display_name || user.username}</strong>
                        <div className="muted">{user.username}</div>
                      </td>
                      <td>
                        <select value={user.group_id || ''} onChange={(event) => handleUserUpdate(user.id, { groupId: Number(event.target.value) || null })}>
                          <option value="">ไม่มีกลุ่ม</option>
                          {data.groups.map((group) => (
                            <option key={group.id} value={group.id}>{group.group_name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`member-pill ${user.approved ? 'member-pill--ok' : 'member-pill--wait'}`}>
                          {user.approved ? 'approved' : 'pending'}
                        </span>
                        {!user.is_active && <span className="member-pill member-pill--danger">inactive</span>}
                      </td>
                      <td>
                        <label className="inline-check">
                          <input type="checkbox" checked={user.is_admin} onChange={(event) => handleUserUpdate(user.id, { isAdmin: event.target.checked })} />
                          admin
                        </label>
                      </td>
                      <td className="member-actions">
                        {!user.approved && <button className="btn-primary btn-small" onClick={() => handleUserUpdate(user.id, { approved: true })}>Approve</button>}
                        <button className="btn-secondary btn-small" onClick={() => handleUserUpdate(user.id, { isActive: !user.is_active })}>
                          {user.is_active ? 'ปิดใช้' : 'เปิดใช้'}
                        </button>
                        <button className="btn-secondary btn-small" onClick={() => openFundEditor(user)}>กองทุน</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fundEditor && (
              <div className="member-fund-editor">
                <div className="member-fund-access__header">
                  <div>
                    <strong>สิทธิ์กองทุน: {fundEditor.name}</strong>
                    <div className="muted">ใช้กับหน้า “รวมทุกกองทุน” และหน้ากองทุนแยกตามช่องทาง</div>
                  </div>
                  <button type="button" className="btn-secondary btn-small" onClick={() => setFundEditor(null)}>ปิด</button>
                </div>
                <label className="inline-check">
                  <input type="checkbox" checked={fundEditor.allFunds} onChange={(event) => setFundEditor((current) => current ? ({ ...current, allFunds: event.target.checked }) : current)} />
                  เข้าถึงทุกกองทุน
                </label>
                {!fundEditor.allFunds && (
                  <div className="member-fund-grid">
                    {FUND_DEFINITIONS.map((fund) => (
                      <label key={fund.id}>
                        <input type="checkbox" checked={fundEditor.fundPermissions.includes(fund.id)} onChange={() => toggleEditedFund(fund.id)} />
                        <span>{fund.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveFundPermissions()}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึกสิทธิ์กองทุน'}
                </button>
              </div>
            )}
          </section>

          <section className="card member-admin-panel">
            <div className="card-header">
              <h3>กลุ่มและเมนู</h3>
              <button className="btn-secondary btn-small" onClick={() => setEditingGroup(emptyGroup())}>กลุ่มใหม่</button>
            </div>

            <div className="member-group-list">
              {data?.groups.map((group) => (
                <button key={group.id} className={`member-group-item ${editingGroup.id === group.id ? 'active' : ''}`} onClick={() => startEditGroup(group)}>
                  <strong>{group.group_name}</strong>
                  <span>{group.is_admin ? 'ทุกเมนู' : `${group.menu_permissions.length} เมนู`}</span>
                </button>
              ))}
            </div>

            <form className="member-group-form" onSubmit={handleSaveGroup}>
              <label>
                ชื่อกลุ่ม
                <input value={editingGroup.groupName} onChange={(event) => setEditingGroup((current) => ({ ...current, groupName: event.target.value }))} required />
              </label>
              <label className="inline-check">
                <input type="checkbox" checked={editingGroup.isAdmin} onChange={(event) => setEditingGroup((current) => ({ ...current, isAdmin: event.target.checked }))} />
                กลุ่มผู้ดูแลระบบ เห็นทุกเมนู
              </label>

              {!editingGroup.isAdmin && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>ชุดสิทธิ์สำเร็จรูป:</span>
                  {rolePresets.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className="btn-secondary"
                      onClick={() => setEditingGroup((current) => ({ ...current, menuPermissions: Array.from(new Set(preset.pages)) }))}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}

              {menuSections.map((section) => (
                <fieldset key={section.label} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                  <legend style={{ fontWeight: 600, padding: '0 6px' }}>{section.icon} {section.label}</legend>
                  <div className="member-menu-grid">
                    {section.items.map((item) => (
                      <label key={item.page} className={`member-menu-check ${editingGroup.isAdmin ? 'disabled' : ''}`}>
                        <input
                          type="checkbox"
                          disabled={editingGroup.isAdmin}
                          checked={editingGroup.isAdmin || editingGroup.menuPermissions.includes(item.page)}
                          onChange={() => togglePermission(item.page)}
                        />
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}

              <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึกกลุ่ม'}</button>
            </form>
          </section>

          <section id="login-locks-section" className="card member-admin-panel" style={{ gridColumn: '1 / -1', marginTop: '1.25rem' }}>
            <div className="card-header">
              <div>
                <h3>🔓 ปลดล็อกเครื่องที่เข้าสู่ระบบไม่ผ่าน (Login Lockout)</h3>
                <div className="muted">
                  เครื่องหรือ IP ที่ใส่รหัสผ่านผิดเกิน 10 ครั้งใน 15 นาทีจะถูกระงับชั่วคราว ผู้ดูแลระบบสามารถตรวจสอบชื่อเครื่องและกดปลดล็อกได้ทันที
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 2, borderRadius: 6 }}>
                  <button
                    type="button"
                    className={`btn-secondary btn-small ${lockFilter === 'locked' ? 'active' : ''}`}
                    style={{
                      background: lockFilter === 'locked' ? '#dc2626' : 'transparent',
                      color: lockFilter === 'locked' ? '#fff' : '#475569',
                      borderColor: 'transparent',
                      fontWeight: 600,
                    }}
                    onClick={() => setLockFilter('locked')}
                  >
                    🔒 ถูก LOCK อยู่ ({lockedCount})
                  </button>
                  <button
                    type="button"
                    className={`btn-secondary btn-small ${lockFilter === 'all' ? 'active' : ''}`}
                    style={{
                      background: lockFilter === 'all' ? '#2563eb' : 'transparent',
                      color: lockFilter === 'all' ? '#fff' : '#475569',
                      borderColor: 'transparent',
                      fontWeight: 600,
                    }}
                    onClick={() => setLockFilter('all')}
                  >
                    📋 ทั้งหมด ({loginLocks.length})
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => void loadLocks()}
                  disabled={loadingLocks}
                >
                  {loadingLocks ? 'กำลังโหลด...' : 'รีเฟรช'}
                </button>
                {lockedCount > 0 && (
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    style={{ borderColor: '#ef4444', color: '#ef4444' }}
                    onClick={() => {
                      if (window.confirm('ยืนยันปลดล็อกเครื่องและ IP ทั้งหมดหรือไม่?')) {
                        void handleUnlock(undefined, true);
                      }
                    }}
                    disabled={unlockingTarget === 'ALL'}
                  >
                    {unlockingTarget === 'ALL' ? 'กำลังปลดล็อก...' : 'ปลดล็อกทั้งหมด'}
                  </button>
                )}
              </div>
            </div>

            <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (manualIp.trim()) {
                    const target = manualIp.trim();
                    setManualIp('');
                    void handleUnlock(target);
                  }
                }}
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
              >
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>ปลดล็อกด้วย IP เจาะจง:</span>
                <input
                  placeholder="เช่น 192.168.1.50 หรือ ::1"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  style={{ maxWidth: 240, padding: '0.35rem 0.6rem', fontSize: '0.9rem' }}
                />
                <button
                  type="submit"
                  className="btn-primary btn-small"
                  disabled={!manualIp.trim() || unlockingTarget !== null}
                >
                  ปลดล็อก IP นี้
                </button>
              </form>
            </div>

            {displayedLocks.length === 0 ? (
              <div style={{ padding: '1.75rem', textAlign: 'center', color: '#16a34a', fontWeight: 500 }}>
                {lockFilter === 'locked'
                  ? '✅ ไม่มีเครื่องใดที่กำลังถูก LOCK อยู่ในขณะนี้ (ทุกคนสามารถเข้าใช้งานได้ตามปกติ)'
                  : '✅ ไม่มีประวัติเครื่องที่ถูกระงับหรือสะสมการลองผิดในระบบ'}
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table member-table">
                  <thead>
                    <tr>
                      <th>เครื่อง / อุปกรณ์</th>
                      <th>ผู้ใช้ล่าสุด</th>
                      <th>จำนวนครั้งที่ลอง</th>
                      <th>สถานะ</th>
                      <th>เวลาที่เหลือ</th>
                      <th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLocks.map((lock) => (
                      <tr key={lock.ip} className={lock.isLocked ? 'row-warning' : ''}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '0.95rem', color: lock.isLocked ? '#b91c1c' : '#1e293b' }}>
                              🖥️ {lock.hostname ? lock.hostname : lock.ip}
                            </strong>
                            <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontSize: '0.82rem' }}>
                              {lock.ip}
                            </code>
                          </div>
                          <div
                            style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}
                            title={lock.userAgent || ''}
                          >
                            💻 {lock.deviceInfo || 'ไม่ทราบอุปกรณ์'}
                          </div>
                        </td>
                        <td>
                          {lock.lastUsername ? <strong>{lock.lastUsername}</strong> : <span className="muted">-</span>}
                          {lock.lastAttemptAt && (
                            <div className="muted" style={{ fontSize: '0.8rem' }}>
                              {new Date(lock.lastAttemptAt).toLocaleTimeString('th-TH')}
                            </div>
                          )}
                        </td>
                        <td>
                          <strong style={{ color: lock.isLocked ? '#dc2626' : 'inherit' }}>{lock.count}</strong> / {lock.max} ครั้ง
                        </td>
                        <td>
                          {lock.isLocked ? (
                            <span className="member-pill member-pill--danger" style={{ fontWeight: 700 }}>
                              🔒 ถูก LOCK อยู่
                            </span>
                          ) : (
                            <span className="member-pill member-pill--wait">
                              ⚠️ กำลังสะสม
                            </span>
                          )}
                        </td>
                        <td>
                          {lock.remainingSeconds > 0 ? (
                            <span>
                              {Math.floor(lock.remainingSeconds / 60)} นาที {lock.remainingSeconds % 60} วินาที
                            </span>
                          ) : (
                            <span className="muted">หมดเวลาแล้ว</span>
                          )}
                        </td>
                        <td className="member-actions">
                          <button
                            type="button"
                            className="btn-primary btn-small"
                            style={lock.isLocked ? { background: '#dc2626', borderColor: '#b91c1c' } : {}}
                            onClick={() => void handleUnlock(lock.ip)}
                            disabled={unlockingTarget === lock.ip}
                          >
                            {unlockingTarget === lock.ip ? 'กำลังปลดล็อก...' : 'ปลดล็อกเครื่องนี้'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
