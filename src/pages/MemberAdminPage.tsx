import { useEffect, useMemo, useState } from 'react';
import { allMenuItems } from '../config/menuDefinitions';
import { createMember, fetchMemberAdminData, saveGroup, updateMember, type MemberAdminData, type MemberGroup } from '../services/authService';
import type { AppPage } from '../utils/navigationState';

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
  });

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchMemberAdminData());
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
      });
      setNewUser({ username: '', displayName: '', password: '', confirmPassword: '', groupId: '', isAdmin: false });
      setMessage('เพิ่มผู้ใช้และเปิดใช้งานแล้ว');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เพิ่มผู้ใช้ไม่สำเร็จ');
    } finally {
      setCreatingUser(false);
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
          </div>
        </div>
      </section>

      {error && <div className="auth-alert auth-alert--error">{error}</div>}
      {message && <div className="auth-alert auth-alert--success">{message}</div>}

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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

              <div className="member-menu-grid">
                {allMenuItems.map((item) => (
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

              <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึกกลุ่ม'}</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};
