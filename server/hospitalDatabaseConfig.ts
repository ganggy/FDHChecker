import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type HospitalDatabaseConfig = {
  type: 'mysql' | 'postgresql';
  host: string;
  port: number;
  database: string;
  schema: string;
  user: string;
  password: string;
  ssl: boolean;
};

export const hospitalDatabaseConfigPath = () => path.resolve(process.env.HOSXP_CONFIG_FILE || '.secrets/hospital-database.json');

export function validateHospitalDatabaseConfig(input: unknown): HospitalDatabaseConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ข้อมูลการเชื่อมต่อไม่ถูกต้อง');
  const value = input as Record<string, unknown>;
  if (value.type !== 'mysql' && value.type !== 'postgresql') throw new Error('เลือก MySQL/MariaDB หรือ PostgreSQL');
  const field = (key: string) => {
    if (typeof value[key] !== 'string' || !(value[key] as string).trim() || (value[key] as string).length > 255 || [...value[key] as string].some((char) => char.charCodeAt(0) < 32)) {
      throw new Error(`กรุณาระบุ ${key} ให้ถูกต้อง`);
    }
    return (value[key] as string).trim();
  };
  const port = Number(value.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port ต้องอยู่ระหว่าง 1–65535');
  const schema = value.type === 'postgresql' ? field('schema') : '';
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Schema ต้องเป็นอักษรอังกฤษพิมพ์เล็ก ตัวเลข หรือ underscore');
  if (typeof value.password !== 'string' || value.password.length > 4096) throw new Error('รูปแบบรหัสผ่านไม่ถูกต้อง');
  if (typeof value.ssl !== 'boolean') throw new Error('ค่า SSL ไม่ถูกต้อง');
  return { type: value.type, host: field('host'), port, database: field('database'), schema, user: field('user'), password: value.password, ssl: value.ssl };
}

export function readHospitalDatabaseConfig(): HospitalDatabaseConfig {
  const filename = hospitalDatabaseConfigPath();
  if (fs.existsSync(filename)) {
    try { return validateHospitalDatabaseConfig(JSON.parse(fs.readFileSync(filename, 'utf8'))); }
    catch { throw new Error('ไฟล์ตั้งค่าฐานข้อมูลโรงพยาบาลไม่ถูกต้อง กรุณาตรวจ HOSXP_CONFIG_FILE'); }
  }
  const type = process.env.HOSXP_DB_TYPE || 'mysql';
  if (!['mysql', 'postgresql'].includes(type)) throw new Error('HOSXP_DB_TYPE must be mysql or postgresql');
  const port = Number(process.env.HOSXP_PORT || (type === 'postgresql' ? 5432 : 3306));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HOSXP_PORT');
  const schema = process.env.HOSXP_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid HOSXP_SCHEMA');
  return {
    type: type as HospitalDatabaseConfig['type'], host: process.env.HOSXP_HOST || '127.0.0.1',
    port, database: process.env.HOSXP_DB || 'hos', schema: type === 'postgresql' ? schema : '',
    user: process.env.HOSXP_USER || '', password: process.env.HOSXP_PASSWORD || '', ssl: process.env.HOSXP_SSL === 'true',
  };
}

export function publicHospitalDatabaseConfig(config: HospitalDatabaseConfig) {
  const { password, ...safe } = config;
  return { ...safe, passwordConfigured: Boolean(password) };
}

export function resolveHospitalDatabaseInput(input: unknown, previous: HospitalDatabaseConfig) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ข้อมูลการเชื่อมต่อไม่ถูกต้อง');
  const value = input as Record<string, unknown>;
  // Only an omitted password preserves the old secret; an explicit empty string clears it.
  if (value.password === undefined && ['type', 'host', 'port', 'user'].some((key) => String(value[key]) !== String(previous[key as keyof HospitalDatabaseConfig]))) {
    throw new Error('เมื่อเปลี่ยนเซิร์ฟเวอร์ ชนิดฐานข้อมูล หรือบัญชี กรุณาระบุรหัสผ่านใหม่ หรือเลือกล้างรหัสผ่าน');
  }
  return validateHospitalDatabaseConfig({ ...value, password: value.password === undefined ? previous.password : value.password });
}

export function saveHospitalDatabaseConfig(config: HospitalDatabaseConfig) {
  const validated = validateHospitalDatabaseConfig(config);
  const filename = hospitalDatabaseConfigPath();
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
