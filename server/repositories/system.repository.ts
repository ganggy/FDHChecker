import crypto from 'crypto';
import { pool, getUTFConnection, getRepstmConnection } from '../db/connection.js';
import { activeHospitalDatabaseConfig } from '../hospitalDatabase.js';
import { FUND_DEFINITIONS } from '../../src/config/fundDefinitions.js';

export const APP_SETTINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(191) NOT NULL PRIMARY KEY,
    setting_value JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const APP_USER_GROUP_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_user_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    group_key VARCHAR(64) NOT NULL UNIQUE,
    group_name VARCHAR(128) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    menu_permissions JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const APP_USER_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_user (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(128) NULL,
    group_id BIGINT NULL,
    approved TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    fund_permissions JSON NULL,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_group_id (group_id),
    INDEX idx_approved_active (approved, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const APP_SESSION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_session (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_expires_at (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const DEFAULT_MENU_PAGES = [
  'staff', 'ipd', 'aiReports', 'hospitalReports', 'admin', 'fdh', 'fdhImport', 'fdhClaimDetail', 'nhsoClose', 'repstm', 'repstmManage',
  'sssExport', 'sssRepStm',
  'receivable', 'insuranceOverview', 'accountingRevenueBudget', 'repDeny', 'specific', 'fundFdh', 'fund43', 'fundKtb',
  'fundOther', 'monitor', 'fsMonitor', 'mophDmht', 'mophVaccine', 'guide', 'settings',
  'memberAdmin', 'authenSync', 'preValidator', 'workQueue', 'rejectTracking', 'revenueOpportunity', 'reconciliation',
  'repDailySummary', 'ppfsBenchmark', 'ppfsVisitMatch', 'uuc1Tracking', 'ucOutsideCup'
];

export const DEFAULT_STAFF_MENU_PAGES = [
  'staff', 'ipd', 'aiReports', 'hospitalReports', 'fdh', 'nhsoClose', 'sssExport', 'sssRepStm', 'preValidator', 'workQueue', 'guide'
];

export const parseStoredSettingValue = <T>(value: unknown): T | null => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return trimmed as T;
    }
  }
  return value as T;
};

export const ensureAppSettingsTable = async () => {
  const connection = await (activeHospitalDatabaseConfig.type === 'postgresql' ? getRepstmConnection() : getUTFConnection());
  try {
    await connection.query(APP_SETTINGS_TABLE_SQL);
  } finally {
    connection.release();
  }
};

export const getAppSetting = async <T = unknown>(settingKey: string): Promise<T | null> => {
  const connection = await (activeHospitalDatabaseConfig.type === 'postgresql' ? getRepstmConnection() : getUTFConnection());
  try {
    try {
      const [rows] = await connection.query(
        'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
        [settingKey]
      );
      const record = Array.isArray(rows) && rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
      return record ? parseStoredSettingValue<T>(record.setting_value) : null;
    } catch {
      await connection.query(APP_SETTINGS_TABLE_SQL);
      const [rows] = await connection.query(
        'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
        [settingKey]
      );
      const record = Array.isArray(rows) && rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
      return record ? parseStoredSettingValue<T>(record.setting_value) : null;
    }
  } catch (error) {
    console.error('Error reading app setting:', error);
    return null;
  } finally {
    connection.release();
  }
};

export const setAppSetting = async (settingKey: string, settingValue: unknown) => {
  const connection = await (activeHospitalDatabaseConfig.type === 'postgresql' ? getRepstmConnection() : getUTFConnection());
  try {
    await connection.query(APP_SETTINGS_TABLE_SQL);
    await connection.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
      [settingKey, JSON.stringify(settingValue)]
    );
    return { success: true };
  } catch (error) {
    console.error('Error writing app setting:', error);
    throw error;
  } finally {
    connection.release();
  }
};

export const setAppSettingsBundle = async (
  settings: Array<{ settingKey: string; settingValue: unknown }>
) => {
  const connection = await (activeHospitalDatabaseConfig.type === 'postgresql' ? getRepstmConnection() : getUTFConnection());
  try {
    await connection.query(APP_SETTINGS_TABLE_SQL);
    await connection.beginTransaction();
    for (const setting of settings) {
      await connection.query(
        `INSERT INTO app_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
        [setting.settingKey, JSON.stringify(setting.settingValue)]
      );
    }
    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    console.error('Error writing app settings bundle:', error);
    throw error;
  } finally {
    connection.release();
  }
};

export type AppUserRecord = {
  id: number;
  username: string;
  display_name: string | null;
  group_id: number | null;
  group_key: string | null;
  group_name: string | null;
  approved: number;
  is_active: number;
  is_admin: number;
  group_is_admin: number;
  menu_permissions: unknown;
  fund_permissions: string[] | null;
  last_login_at: string | null;
  created_at: string | null;
};

const normalizeUsername = (username: unknown) => String(username || '').trim().toLowerCase();

export const normalizeMenuPermissions = (value: unknown): string[] => {
  const raw = parseStoredSettingValue<string[] | { pages?: string[] }>(value);
  const pages = Array.isArray(raw) ? raw : Array.isArray(raw?.pages) ? raw.pages : [];
  const allowed = new Set(DEFAULT_MENU_PAGES);
  return Array.from(new Set(pages.map((page) => String(page || '').trim()).filter((page) => allowed.has(page))));
};

const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const verifyPassword = (password: string, storedHash: string) => {
  const [algorithm, salt, hash] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const attempted = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (attempted.length !== stored.length) return false;
  return crypto.timingSafeEqual(attempted, stored);
};

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const ensureAuthTables = async () => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(APP_USER_GROUP_TABLE_SQL);
    await connection.query(APP_USER_TABLE_SQL);
    await connection.query(APP_SESSION_TABLE_SQL);

    const [userColumnRows] = await connection.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'fund_permissions'`
    );
    if (!Array.isArray(userColumnRows) || userColumnRows.length === 0) {
      await connection.query('ALTER TABLE app_user ADD COLUMN fund_permissions JSON NULL AFTER is_admin');
    }

    await connection.query(
      `INSERT INTO app_user_group (group_key, group_name, is_admin, menu_permissions)
       VALUES ('admin', 'ผู้ดูแลระบบ', 1, ?)
       ON DUPLICATE KEY UPDATE group_name = VALUES(group_name), is_admin = 1, menu_permissions = VALUES(menu_permissions)`,
      [JSON.stringify(DEFAULT_MENU_PAGES)]
    );

    await connection.query(
      `INSERT INTO app_user_group (group_key, group_name, is_admin, menu_permissions)
       VALUES ('staff', 'ผู้ใช้งานทั่วไป', 0, ?)
       ON DUPLICATE KEY UPDATE group_name = VALUES(group_name)`,
      [JSON.stringify(DEFAULT_STAFF_MENU_PAGES)]
    );

    const [staffGroupRows] = await connection.query(
      'SELECT id, menu_permissions FROM app_user_group WHERE group_key = ? LIMIT 1',
      ['staff']
    );
    const staffGroup = Array.isArray(staffGroupRows) && staffGroupRows.length > 0 ? (staffGroupRows[0] as any) : null;
    const staffPermissions = staffGroup ? normalizeMenuPermissions(staffGroup.menu_permissions) : [];
    if (staffGroup && staffPermissions.length === 0) {
      await connection.query(
        'UPDATE app_user_group SET menu_permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(DEFAULT_STAFF_MENU_PAGES), Number(staffGroup.id)]
      );
    } else if (staffGroup && staffPermissions.includes('hospitalReports') && !staffPermissions.includes('aiReports')) {
      await connection.query(
        'UPDATE app_user_group SET menu_permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify([...staffPermissions, 'aiReports']), Number(staffGroup.id)]
      );
    }
    if (staffGroup) {
      await connection.query(
        'UPDATE app_user SET group_id = ? WHERE group_id IS NULL AND is_admin = 0',
        [Number(staffGroup.id)]
      );
    }

    const [adminGroupRows] = await connection.query('SELECT id FROM app_user_group WHERE group_key = ? LIMIT 1', ['admin']);
    const adminGroupId = Array.isArray(adminGroupRows) && adminGroupRows.length > 0
      ? Number((adminGroupRows[0] as any).id)
      : null;

    if (adminGroupId) {
      const [adminCountRows] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM app_user u
         LEFT JOIN app_user_group g ON g.id = u.group_id
         WHERE u.is_active = 1 AND u.approved = 1 AND (u.is_admin = 1 OR g.is_admin = 1)`
      );
      const adminCount = Array.isArray(adminCountRows) && adminCountRows.length > 0
        ? Number((adminCountRows[0] as Record<string, unknown>).total || 0)
        : 0;
      const bootstrapUsername = normalizeUsername(process.env.APP_BOOTSTRAP_ADMIN_USERNAME);
      const bootstrapPassword = String(process.env.APP_BOOTSTRAP_ADMIN_PASSWORD || '');

      if (adminCount === 0 && bootstrapUsername && bootstrapPassword.length >= 12) {
        await connection.query(
          `INSERT INTO app_user (username, password_hash, display_name, group_id, approved, is_active, is_admin)
           VALUES (?, ?, ?, ?, 1, 1, 1)
           ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), group_id = VALUES(group_id),
             approved = 1, is_active = 1, is_admin = 1, updated_at = CURRENT_TIMESTAMP`,
          [bootstrapUsername, hashPassword(bootstrapPassword), bootstrapUsername, adminGroupId]
        );
        console.warn('Bootstrap admin created. Remove APP_BOOTSTRAP_ADMIN_USERNAME and APP_BOOTSTRAP_ADMIN_PASSWORD before restarting.');
      } else if (adminCount === 0) {
        console.warn('No active admin exists. Set one-time APP_BOOTSTRAP_ADMIN_USERNAME and APP_BOOTSTRAP_ADMIN_PASSWORD (12+ characters).');
      }
    }

    await connection.query('DELETE FROM app_session WHERE expires_at < NOW()');
  } finally {
    connection.release();
  }
};

const mapAppUser = (row: any): AppUserRecord => ({
  id: Number(row.id),
  username: String(row.username || ''),
  display_name: row.display_name == null ? null : String(row.display_name),
  group_id: row.group_id == null ? null : Number(row.group_id),
  group_key: row.group_key == null ? null : String(row.group_key),
  group_name: row.group_name == null ? null : String(row.group_name),
  approved: Number(row.approved || 0),
  is_active: Number(row.is_active || 0),
  is_admin: Number(row.is_admin || 0),
  group_is_admin: Number(row.group_is_admin || 0),
  menu_permissions: normalizeMenuPermissions(row.menu_permissions),
  fund_permissions: row.fund_permissions == null ? null : normalizeFundPermissions(row.fund_permissions),
  last_login_at: row.last_login_at == null ? null : String(row.last_login_at),
  created_at: row.created_at == null ? null : String(row.created_at),
});

const getUserSelectSql = () => `
  SELECT u.id, u.username, u.display_name, u.group_id, u.approved, u.is_active, u.is_admin, u.fund_permissions,
         u.last_login_at, u.created_at,
         g.group_key, g.group_name, g.is_admin AS group_is_admin, g.menu_permissions
  FROM app_user u
  LEFT JOIN app_user_group g ON g.id = u.group_id
`;

export const getAppUserById = async (userId: number) => {
  await ensureAuthTables();
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(`${getUserSelectSql()} WHERE u.id = ? LIMIT 1`, [userId]);
    return Array.isArray(rows) && rows.length > 0 ? mapAppUser(rows[0]) : null;
  } finally {
    connection.release();
  }
};

export const getAuthUserByToken = async (token: string) => {
  if (!token) return null;
  await ensureAuthTables();
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      `${getUserSelectSql()}
       JOIN app_session s ON s.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > NOW()
       LIMIT 1`,
      [tokenHash(token)]
    );
    return Array.isArray(rows) && rows.length > 0 ? mapAppUser(rows[0]) : null;
  } finally {
    connection.release();
  }
};

export const loginAppUser = async (usernameInput: string, password: string) => {
  await ensureAuthTables();
  const username = normalizeUsername(usernameInput);
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      `SELECT u.*, g.group_key, g.group_name, g.is_admin AS group_is_admin, g.menu_permissions
       FROM app_user u
       LEFT JOIN app_user_group g ON g.id = u.group_id
       WHERE u.username = ? LIMIT 1`,
      [username]
    );
    const record = Array.isArray(rows) && rows.length > 0 ? (rows[0] as any) : null;
    if (!record || !verifyPassword(password, String(record.password_hash || ''))) {
      return { success: false, status: 401, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }
    if (!Number(record.is_active || 0)) {
      return { success: false, status: 403, error: 'บัญชีนี้ถูกปิดใช้งาน' };
    }
    if (!Number(record.approved || 0)) {
      return { success: false, status: 403, error: 'บัญชียังรอผู้ดูแลระบบอนุมัติ' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    await connection.query(
      'INSERT INTO app_session (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [tokenHash(token), Number(record.id)]
    );
    await connection.query('UPDATE app_user SET last_login_at = NOW() WHERE id = ?', [Number(record.id)]);
    return { success: true, token, user: mapAppUser(record) };
  } finally {
    connection.release();
  }
};

export const logoutAppUser = async (token: string) => {
  if (!token) return { success: true };
  await ensureAuthTables();
  const connection = await getRepstmConnection();
  try {
    await connection.query('DELETE FROM app_session WHERE token_hash = ?', [tokenHash(token)]);
    return { success: true };
  } finally {
    connection.release();
  }
};

export const changeAppUserPassword = async (
  userId: number,
  currentPassword: string,
  newPassword: string,
) => {
  if (newPassword.length < 12) {
    return { success: false, status: 400, error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร' };
  }
  if (currentPassword === newPassword) {
    return { success: false, status: 400, error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' };
  }

  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      'SELECT password_hash FROM app_user WHERE id = ? AND is_active = 1 LIMIT 1',
      [userId]
    );
    const record = Array.isArray(rows) && rows.length > 0 ? rows[0] as Record<string, unknown> : null;
    if (!record || !verifyPassword(currentPassword, String(record.password_hash || ''))) {
      return { success: false, status: 401, error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' };
    }

    await connection.beginTransaction();
    await connection.query(
      'UPDATE app_user SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashPassword(newPassword), userId]
    );
    await connection.query('DELETE FROM app_session WHERE user_id = ?', [userId]);
    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const registerAppUser = async (input: { username: string; password: string; displayName?: string }) => {
  await ensureAuthTables();
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    return { success: false, status: 400, error: 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, จุด, ขีดกลาง หรือ underscore อย่างน้อย 3 ตัว' };
  }
  if (String(input.password || '').length < 8) {
    return { success: false, status: 400, error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' };
  }

  const connection = await getRepstmConnection();
  try {
    const [groupRows] = await connection.query('SELECT id FROM app_user_group WHERE group_key = ? LIMIT 1', ['staff']);
    const groupId = Array.isArray(groupRows) && groupRows.length > 0 ? Number((groupRows[0] as any).id) : null;
    await connection.query(
      `INSERT INTO app_user (username, password_hash, display_name, group_id, approved, is_active, is_admin)
       VALUES (?, ?, ?, ?, 0, 1, 0)`,
      [username, hashPassword(input.password), String(input.displayName || username).trim(), groupId]
    );
    return { success: true };
  } catch (error: any) {
    if (String(error?.code || '') === 'ER_DUP_ENTRY') {
      return { success: false, status: 409, error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' };
    }
    throw error;
  } finally {
    connection.release();
  }
};

export const normalizeFundPermissions = (value: unknown): string[] => {
  const raw = parseStoredSettingValue<string[]>(value);
  const allowed = new Set(FUND_DEFINITIONS.map((fund) => fund.id));
  return Array.from(new Set((Array.isArray(raw) ? raw : [])
    .map((fundId) => String(fundId || '').trim())
    .filter((fundId) => allowed.has(fundId))));
};

export const createMemberUser = async (input: {
  username: string;
  password: string;
  displayName?: string;
  groupId?: number | null;
  isAdmin?: boolean;
  fundPermissions?: string[] | null;
}) => {
  await ensureAuthTables();
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    return { success: false, status: 400, error: 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, จุด, ขีดกลาง หรือ underscore อย่างน้อย 3 ตัว' };
  }
  if (String(input.password || '').length < 12) {
    return { success: false, status: 400, error: 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร' };
  }

  const connection = await getRepstmConnection();
  try {
    let groupId = input.groupId || null;
    if (groupId) {
      const [groupRows] = await connection.query('SELECT id FROM app_user_group WHERE id = ? LIMIT 1', [groupId]);
      if (!Array.isArray(groupRows) || groupRows.length === 0) {
        return { success: false, status: 400, error: 'ไม่พบกลุ่มผู้ใช้ที่เลือก' };
      }
    } else {
      const [groupRows] = await connection.query(
        'SELECT id FROM app_user_group WHERE group_key = ? LIMIT 1',
        [input.isAdmin ? 'admin' : 'staff']
      );
      groupId = Array.isArray(groupRows) && groupRows.length > 0 ? Number((groupRows[0] as any).id) : null;
    }

    const [result] = await connection.query(
      `INSERT INTO app_user (username, password_hash, display_name, group_id, approved, is_active, is_admin, fund_permissions)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
      [
        username,
        hashPassword(input.password),
        String(input.displayName || username).trim().slice(0, 191),
        groupId,
        input.isAdmin ? 1 : 0,
        input.fundPermissions == null ? null : JSON.stringify(normalizeFundPermissions(input.fundPermissions)),
      ]
    );
    const userId = Number((result as any)?.insertId || 0);
    return { success: true, user: userId ? await getAppUserById(userId) : null };
  } catch (error: any) {
    if (String(error?.code || '') === 'ER_DUP_ENTRY') {
      return { success: false, status: 409, error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' };
    }
    throw error;
  } finally {
    connection.release();
  }
};

export const getMemberAdminData = async () => {
  await ensureAuthTables();
  const connection = await getRepstmConnection();
  try {
    const [userRows] = await connection.query(`${getUserSelectSql()} ORDER BY u.approved ASC, u.created_at DESC`);
    const [groupRows] = await connection.query(
      'SELECT id, group_key, group_name, is_admin, menu_permissions, created_at, updated_at FROM app_user_group ORDER BY is_admin DESC, group_name ASC'
    );
    return {
      users: (Array.isArray(userRows) ? userRows : []).map(mapAppUser),
      groups: (Array.isArray(groupRows) ? groupRows : []).map((row: any) => ({
        id: Number(row.id),
        group_key: String(row.group_key || ''),
        group_name: String(row.group_name || ''),
        is_admin: Number(row.is_admin || 0),
        menu_permissions: normalizeMenuPermissions(row.menu_permissions),
        created_at: row.created_at == null ? null : String(row.created_at),
        updated_at: row.updated_at == null ? null : String(row.updated_at),
      })),
      menu_pages: DEFAULT_MENU_PAGES,
    };
  } finally {
    connection.release();
  }
};

export const updateMemberUser = async (
  userId: number,
  input: { approved?: boolean; isActive?: boolean; isAdmin?: boolean; groupId?: number | null; displayName?: string; fundPermissions?: string[] | null }
) => {
  await ensureAuthTables();
  const connection = await getRepstmConnection();
  try {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof input.approved === 'boolean') {
      updates.push('approved = ?');
      values.push(input.approved ? 1 : 0);
    }
    if (typeof input.isActive === 'boolean') {
      updates.push('is_active = ?');
      values.push(input.isActive ? 1 : 0);
    }
    if (typeof input.isAdmin === 'boolean') {
      updates.push('is_admin = ?');
      values.push(input.isAdmin ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'groupId')) {
      updates.push('group_id = ?');
      values.push(input.groupId || null);
    }
    if (typeof input.displayName === 'string') {
      updates.push('display_name = ?');
      values.push(input.displayName.trim() || null);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'fundPermissions')) {
      updates.push('fund_permissions = ?');
      values.push(input.fundPermissions == null ? null : JSON.stringify(normalizeFundPermissions(input.fundPermissions)));
    }
    if (updates.length === 0) return getAppUserById(userId);
    values.push(userId);
    await connection.query(`UPDATE app_user SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    return getAppUserById(userId);
  } finally {
    connection.release();
  }
};

export const saveMemberGroup = async (input: {
  id?: number | null;
  groupName: string;
  isAdmin?: boolean;
  menuPermissions: string[];
}) => {
  await ensureAuthTables();
  const groupName = String(input.groupName || '').trim();
  if (!groupName) {
    return { success: false, status: 400, error: 'กรุณาระบุชื่อกลุ่ม' };
  }
  const permissions = normalizeMenuPermissions(input.isAdmin ? DEFAULT_MENU_PAGES : input.menuPermissions);
  const connection = await getRepstmConnection();
  try {
    if (input.id) {
      await connection.query(
        `UPDATE app_user_group
         SET group_name = ?, is_admin = ?, menu_permissions = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [groupName, input.isAdmin ? 1 : 0, JSON.stringify(permissions), input.id]
      );
    } else {
      const groupKey = `group_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
      await connection.query(
        `INSERT INTO app_user_group (group_key, group_name, is_admin, menu_permissions)
         VALUES (?, ?, ?, ?)`,
        [groupKey, groupName, input.isAdmin ? 1 : 0, JSON.stringify(permissions)]
      );
    }
    return { success: true };
  } finally {
    connection.release();
  }
};

// Database connection diagnostics & introspection
export const testConnection = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    console.log('✅ Successfully connected to HOSxP database');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to HOSxP database:', error);
    return false;
  } finally {
    connection.release();
  }
};

export const testDatabaseConnection = async (): Promise<{
  isConnected: boolean;
  hasData: boolean;
  tableCount: number;
  sampleRecordCount: number;
  error?: string;
}> => {
  try {
    const connection = await pool.getConnection();

    try {
      await connection.query('SELECT 1');

      const [patientRows] = await connection.query('SELECT COUNT(*) as count FROM patient LIMIT 1');
      const patientCount = (patientRows as Record<string, unknown>[])[0]?.count as number || 0;

      const [visitRows] = await connection.query(
        'SELECT COUNT(*) as count FROM ovst WHERE vstdate >= CURDATE() - INTERVAL 30 DAY'
      );
      const recentVisitCount = (visitRows as Record<string, unknown>[])[0]?.count as number || 0;

      const [tableRows] = await connection.query(
        'SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?',
        [activeHospitalDatabaseConfig.type === 'postgresql' ? activeHospitalDatabaseConfig.schema : activeHospitalDatabaseConfig.database]
      );
      const tableCount = (tableRows as Record<string, unknown>[])[0]?.count as number || 0;

      return {
        isConnected: true,
        hasData: patientCount > 0 && recentVisitCount > 0,
        tableCount,
        sampleRecordCount: recentVisitCount,
      };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Database connection test failed:', error);
    return {
      isConnected: false,
      hasData: false,
      tableCount: 0,
      sampleRecordCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

export const getTableInfo = async (tableName: string) => {
  const connection = await pool.getConnection();
  try {
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [process.env.HOSXP_DB || 'hos', tableName]
    );
    return columns || [];
  } catch (error) {
    console.error(`Error getting table info for ${tableName}:`, error);
    return [];
  } finally {
    connection.release();
  }
};

export const getAllTables = async () => {
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?`,
      [process.env.HOSXP_DB || 'hos']
    );
    return tables || [];
  } catch (error) {
    console.error('Error getting all tables:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const testSDrugitemsStructure = async (): Promise<Record<string, unknown>[]> => {
  const connection = await pool.getConnection();
  try {
    console.log('🔍 Testing s_drugitems table structure...');

    // ตรวจสอบว่าตาราง s_drugitems มีอยู่หรือไม่
    const [tableCheck] = await connection.query(
      "SHOW TABLES LIKE 's_drugitems'"
    );

    if (Array.isArray(tableCheck) && tableCheck.length === 0) {
      console.log('❌ Table s_drugitems does not exist');
      return [];
    }

    console.log('✅ Table s_drugitems exists');

    // ตรวจสอบโครงสร้างคอลัมน์
    const [columns] = await connection.query(
      "DESCRIBE s_drugitems"
    );

    console.log('📋 s_drugitems columns:', columns);

    // ตรวจสอบข้อมูลตัวอย่าง 5 รายการแรก
    const [sampleData] = await connection.query(
      "SELECT * FROM s_drugitems LIMIT 5"
    );

    console.log('📊 Sample data from s_drugitems:', sampleData);

    return (Array.isArray(columns) ? columns : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('❌ Error testing s_drugitems structure:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ฟังก์ชันทดสอบการเชื่อมต่อ opitemrece กับ s_drugitems
export const testReceiptJoin = async (vn: string): Promise<Record<string, unknown>[]> => {
  const connection = await pool.getConnection();
  try {
    console.log(`🔍 Testing receipt join for VN: ${vn}`);

    // ตรวจสอบข้อมูลใน opitemrece ก่อน
    const [opitemreceData] = await connection.query(
      "SELECT * FROM opitemrece WHERE vn = ? LIMIT 5",
      [vn]
    );

    console.log('📊 opitemrece data:', opitemreceData);

    if (Array.isArray(opitemreceData) && opitemreceData.length === 0) {
      console.log('❌ No data found in opitemrece for VN:', vn);
      return [];
    }

    // ทดสอบ JOIN แบบเบื้องต้น (ไม่ใช้คอลัมน์ที่มีปัญหา)
    const [basicJoin] = await connection.query(
      `SELECT 
        opitemrece.vn,
        opitemrece.icode,
        opitemrece.qty,
        opitemrece.sum_price,
        s_drugitems.icode as s_icode,
        s_drugitems.name as s_name
      FROM opitemrece
      LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
      WHERE opitemrece.vn = ?
      LIMIT 10`,
      [vn]
    );

    console.log('📊 Basic join result:', basicJoin);

    return (Array.isArray(basicJoin) ? basicJoin : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('❌ Error testing receipt join:', error);
    return [];
  } finally {
    connection.release();
  }
};

