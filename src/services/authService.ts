import type { AppPage } from '../utils/navigationState';

export const AUTH_TOKEN_KEY = 'fdh-auth-token';

export type AuthUser = {
  id: number;
  username: string;
  display_name: string | null;
  group_id: number | null;
  group_key: string | null;
  group_name: string | null;
  approved: boolean;
  is_active: boolean;
  is_admin: boolean;
  menu_permissions: AppPage[];
  last_login_at: string | null;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type MemberGroup = {
  id: number;
  group_key: string;
  group_name: string;
  is_admin: number;
  menu_permissions: AppPage[];
  created_at?: string | null;
  updated_at?: string | null;
};

export type MemberUser = AuthUser & {
  created_at?: string | null;
};

export type MemberAdminData = {
  users: MemberUser[];
  groups: MemberGroup[];
  menu_pages: AppPage[];
};

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const jsonOrThrow = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || data?.message || response.statusText);
  }
  return data as T;
};

export const login = async (username: string, password: string): Promise<AuthSession> => {
  const data = await jsonOrThrow<{ success: true; token: string; user: AuthUser }>(
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  );
  localStorage.setItem(AUTH_TOKEN_KEY, data.token);
  return { token: data.token, user: data.user };
};

export const register = async (payload: { username: string; password: string; displayName?: string }) => {
  return jsonOrThrow<{ success: true; message: string }>(
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
};

export const fetchMe = async (): Promise<AuthSession | null> => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) return null;
  const response = await fetch('/api/auth/me', { headers: authHeaders() });
  if (response.status === 401) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    return null;
  }
  const data = await jsonOrThrow<{ success: true; user: AuthUser }>(response);
  return { token, user: data.user };
};

export const logout = async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => undefined);
  localStorage.removeItem(AUTH_TOKEN_KEY);
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  const data = await jsonOrThrow<{ success: true; message: string }>(
    await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  );
  localStorage.removeItem(AUTH_TOKEN_KEY);
  return data;
};

export const fetchMemberAdminData = async () => {
  const data = await jsonOrThrow<{ success: true; data: MemberAdminData }>(
    await fetch('/api/admin/members', { headers: authHeaders() })
  );
  return data.data;
};

export const updateMember = async (
  userId: number,
  payload: { approved?: boolean; isActive?: boolean; isAdmin?: boolean; groupId?: number | null; displayName?: string }
) => {
  const data = await jsonOrThrow<{ success: true; user: MemberUser | null }>(
    await fetch(`/api/admin/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    })
  );
  return data.user;
};

export const saveGroup = async (payload: {
  id?: number | null;
  groupName: string;
  isAdmin: boolean;
  menuPermissions: AppPage[];
}) => {
  const data = await jsonOrThrow<{ success: true; data: MemberAdminData }>(
    await fetch('/api/admin/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    })
  );
  return data.data;
};
