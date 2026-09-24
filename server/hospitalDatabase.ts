import mysql from 'mysql2/promise';
import pg from 'pg';
import { readHospitalDatabaseConfig, type HospitalDatabaseConfig } from './hospitalDatabaseConfig.js';
import { compilePostgresQuery, UnsupportedPostgresQueryError } from './postgresSql.js';
import { recordHospitalDatabaseFailure } from './hospitalDatabaseContext.js';

export type HospitalConnection = Pick<mysql.PoolConnection, 'query' | 'execute' | 'release' | 'beginTransaction' | 'commit' | 'rollback'>;
export const activeHospitalDatabaseConfig = Object.freeze(readHospitalDatabaseConfig());

export class HospitalDatabaseError extends Error {
  code: string;
  constructor(code: string) {
    super(`ไม่สามารถอ่านข้อมูล HIS PostgreSQL (${code}) กรุณาตรวจโครงสร้างตารางและความเข้ากันได้ของรายงาน`);
    this.name = 'HospitalDatabaseError'; this.code = code;
  }
}
export function rethrowHospitalDatabaseError(error: unknown): void {
  if (error instanceof HospitalDatabaseError || error instanceof UnsupportedPostgresQueryError) throw error;
}

function pgOptions(config: HospitalDatabaseConfig): pg.PoolConfig {
  return {
    host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, max: 30,
    statement_timeout: 30000,
    // Set before any query. No privileged helper functions or writes to HIS are installed.
    options: `-c search_path=${config.schema} -c timezone=Asia/Bangkok -c default_transaction_read_only=on`,
    types: { getTypeParser: (oid: number, format?: string) => {
      // Match the MySQL driver's date-only values without converting them via host timezone.
      if ([1082, 1114, 1184].includes(oid)) return (value: string) => value;
      return pg.types.getTypeParser(oid, format as 'text');
    } },
  };
}

export function createHospitalPool(config: HospitalDatabaseConfig) {
  if (config.type === 'mysql') {
    const pool = mysql.createPool({
      host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
      waitForConnections: true, connectionLimit: 30, queueLimit: 0,
      enableKeepAlive: true, keepAliveInitialDelay: 0, charset: 'utf8mb4',
    });
    return {
      async getConnection(): Promise<HospitalConnection> {
        const connection = await pool.getConnection();
        try { await connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci'); return connection; }
        catch (error) { connection.release(); throw error; }
      },
      end: () => pool.end(),
    };
  }
  const pool = new pg.Pool(pgOptions(config));
  // pg emits background idle-client errors; never log connection strings or SQL parameters.
  pool.on('error', () => console.error('HIS PostgreSQL idle connection failed'));
  return {
    async getConnection(): Promise<HospitalConnection> {
      let client: pg.PoolClient;
      try { client = await pool.connect(); }
      catch {
        const failure = new HospitalDatabaseError('CONNECTION_FAILED');
        recordHospitalDatabaseFailure(failure);
        throw failure;
      }
      let released = false;
      let inTransaction = false;
      const query = async (input: string | mysql.QueryOptions, values: unknown[] = []) => {
        if (released) throw new HospitalDatabaseError('CONNECTION_RELEASED');
        const sql = typeof input === 'string' ? input : input.sql;
        try {
          const compiled = compilePostgresQuery(sql, values);
          const result = await client.query(compiled.text, compiled.values);
          return [result.rows, result.fields];
        } catch (error) {
          const code = String((error as { code?: string }).code || 'QUERY_FAILED');
          const failure = error instanceof UnsupportedPostgresQueryError ? error : new HospitalDatabaseError(/^[A-Z0-9_]+$/.test(code) ? code : 'QUERY_FAILED');
          recordHospitalDatabaseFailure(failure);
          throw failure;
        }
      };
      return {
        query: query as HospitalConnection['query'], execute: query as HospitalConnection['execute'],
        async beginTransaction() { await client.query('BEGIN READ ONLY'); inTransaction = true; },
        async commit() { await client.query('COMMIT'); inTransaction = false; },
        async rollback() { await client.query('ROLLBACK'); inTransaction = false; },
        release() {
          if (released) return;
          released = true;
          // A caller that forgets to rollback must not poison a pooled connection.
          client.release(inTransaction);
        },
      };
    },
    end: () => pool.end(),
  };
}

export const hospitalPool = createHospitalPool(activeHospitalDatabaseConfig);

const requiredSchema: Record<string, string[]> = {
  patient: ['hn', 'pname', 'fname', 'lname', 'birthday', 'sex'],
  ovst: ['vn', 'hn', 'vstdate', 'pttype'],
  pttype: ['pttype', 'hipdata_code'],
  opitemrece: ['vn', 'icode', 'qty'],
  ovstdiag: ['vn', 'icd10'],
};

export async function testHospitalDatabase(config: HospitalDatabaseConfig) {
  const pool = createHospitalPool(config);
  try {
    const connection = await pool.getConnection();
    try {
      await connection.query('SELECT 1 AS connected');
      const [rows] = await connection.query(
        'SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns WHERE table_schema = ?',
        [config.type === 'postgresql' ? config.schema : config.database],
      );
      const columns = new Set((rows as Array<{ table_name: string; column_name: string }>).map((row) => `${row.table_name}.${row.column_name}`));
      const missing = Object.entries(requiredSchema).flatMap(([table, fields]) => fields.filter((field) => !columns.has(`${table}.${field}`)).map((field) => `${table}.${field}`));
      if (!missing.length) {
        for (const [table, fields] of Object.entries(requiredSchema)) {
          // Verify SELECT grants without fetching any patient data.
          await connection.query(`SELECT ${fields.join(', ')} FROM ${table} LIMIT 0`);
        }
      }
      return {
        connected: true, compatible: missing.length === 0, missing,
        mode: config.type === 'postgresql' ? 'read-only' : 'read-write',
        message: missing.length ? 'เชื่อมต่อได้ แต่โครงสร้าง HIS ไม่ตรงตามที่ระบบต้องใช้' : 'เชื่อมต่อได้และพบตารางหลัก ต้องตรวจการจับคู่รหัสและรายงานก่อนใช้งานจริง',
      };
    } finally { connection.release(); }
  } finally { await pool.end(); }
}

/**
 * ดึง serial number ถัดไปสำหรับตารางใน HOSxP และอัปเดตตาราง serial
 * เพื่อป้องกันปัญหา Duplicate Entry เมื่อเจ้าหน้าที่บันทึกข้อมูลผ่านโปรแกรม HOSxP
 */
export async function getNextHospitalSerial(
  connection: HospitalConnection,
  serialName: string,
  tableName?: string,
  idColumn?: string
): Promise<number> {
  // 1. ตรวจสอบและปรับปรุง serial_no ในตาราง serial ให้ไม่ต่ำกว่า MAX(id) ในตารางจริงเสมอ
  if (tableName && idColumn) {
    try {
      await connection.query(
        `UPDATE serial s
         JOIN (SELECT COALESCE(MAX(${idColumn}), 0) AS max_id FROM ${tableName}) m
         SET s.serial_no = m.max_id
         WHERE s.name = ? AND s.serial_no < m.max_id`,
        [serialName]
      );
    } catch {
      // ignore
    }
  }

  // 2. เรียกใช้ Function มาตรฐาน Get_SerialNumber ของ HOSxP
  try {
    const [rows] = await connection.query(
      `SELECT Get_SerialNumber(?) AS new_id`,
      [serialName]
    );
    const newId = Number((rows as Array<{ new_id: number }>)[0]?.new_id);
    if (newId && Number.isFinite(newId)) {
      return newId;
    }
  } catch {
    // Fallback ถ้า Function Get_SerialNumber ไม่มีในฐานข้อมูล
  }

  // 3. Fallback: อัปเดตตาราง serial โดยตรงตามตรรกะ Get_SerialNumber ของ HOSxP
  try {
    await connection.query(
      `INSERT INTO serial (name, serial_no)
       VALUES (?, 0)
       ON DUPLICATE KEY UPDATE name = name`,
      [serialName]
    );

    await connection.query(
      `UPDATE serial SET serial_no = LAST_INSERT_ID(serial_no + 1) WHERE name = ?`,
      [serialName]
    );
    const [lastIdRows] = await connection.query(`SELECT LAST_INSERT_ID() AS new_id`);
    const fallbackId = Number((lastIdRows as Array<{ new_id: number }>)[0]?.new_id);
    if (fallbackId && Number.isFinite(fallbackId)) {
      return fallbackId;
    }
  } catch {
    // ignore
  }

  // 4. กรณีฉุกเฉิน (ไม่มีตาราง serial): ใช้ MAX + 1 จากตารางจริง
  if (tableName && idColumn) {
    const [maxRows] = await connection.query(
      `SELECT COALESCE(MAX(${idColumn}), 0) + 1 AS new_id FROM ${tableName}`
    );
    return Number((maxRows as Array<{ new_id: number }>)[0]?.new_id || 1);
  }

  return Date.now();
}
