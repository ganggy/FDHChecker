---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiReadOnlyQuery.ts"
source_hash: "359719201b8e3e91209477c74cc75827f42272ab48fc11a05ed7fa290483ef1b"
managed_by: "sync-ksp-vault"
---
# aiReadOnlyQuery.ts

> Source: `server/aiReadOnlyQuery.ts`
> SHA-256: `359719201b8e3e91209477c74cc75827f42272ab48fc11a05ed7fa290483ef1b`

````typescript
import { getUTFConnection } from './db.js';
import { AI_ALLOWED_HOSXP_TABLES } from './aiHosxpCatalog.js';

export type ValidatedReadOnlyQuery = {
  sql: string;
  tables: string[];
  limit: number;
};

const MAX_ROWS = Math.min(500, Math.max(20, Number(process.env.AI_AGENT_MAX_ROWS) || 200));
const QUERY_TIMEOUT_MS = Math.min(60_000, Math.max(2_000, Number(process.env.AI_AGENT_QUERY_TIMEOUT_MS) || 15_000));
const WRITE_KEYWORDS = [
  'insert', 'update', 'delete', 'replace', 'drop', 'alter', 'create', 'truncate',
  'rename', 'grant', 'revoke', 'call', 'execute', 'prepare', 'deallocate', 'handler',
  'load', 'outfile', 'dumpfile', 'lock', 'unlock', 'set', 'use', 'begin', 'commit', 'rollback',
];

const stripCodeFence = (value: string) => value.trim()
  .replace(/^```(?:sql)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

const withoutQuotedText = (sql: string) => sql
  .replace(/'(?:''|\\.|[^'])*'/g, "''")
  .replace(/"(?:""|\\.|[^"])*"/g, '""');

export const validateReadOnlySql = (input: string): ValidatedReadOnlyQuery => {
  let sql = stripCodeFence(input).replace(/;+\s*$/, '').trim();
  if (!sql) throw new Error('AI ไม่ได้สร้างคำสั่งค้นข้อมูล');
  const inspected = withoutQuotedText(sql);
  if (/--|\/\*|\*\/|(^|\s)#[^\d]/m.test(inspected)) throw new Error('ไม่อนุญาต SQL comment');
  if (inspected.includes(';')) throw new Error('อนุญาตเพียงหนึ่ง SQL statement');
  if (!/^\s*(select|with)\b/i.test(inspected)) throw new Error('อนุญาตเฉพาะ SELECT');
  for (const keyword of WRITE_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(inspected)) throw new Error(`ไม่อนุญาตคำสั่ง ${keyword.toUpperCase()}`);
  }
  if (/\b(information_schema|performance_schema|mysql|sys)\b/i.test(inspected)) {
    throw new Error('ไม่อนุญาตอ่าน system schema');
  }
  if (/\binto\b/i.test(inspected)) throw new Error('ไม่อนุญาต SELECT INTO');
  if (/\b(sleep|benchmark|get_lock|release_lock|load_file)\s*\(/i.test(inspected)) throw new Error('ไม่อนุญาตฟังก์ชันที่เสี่ยงต่อระบบ');
  if (/@@|@[a-z_]/i.test(inspected)) throw new Error('ไม่อนุญาตอ่านหรือกำหนด SQL variable');
  if (/\bfor\s+update\b|\block\s+in\s+share\s+mode\b/i.test(inspected)) throw new Error('ไม่อนุญาตล็อกข้อมูล');
  if (/\bunion\b/i.test(inspected)) throw new Error('ไม่อนุญาต UNION ใน AI query');
  if (/\bfrom\s+`?[a-z_][a-z0-9_]*`?(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s*,/i.test(inspected)) {
    throw new Error('ไม่อนุญาต comma join; ต้องใช้ JOIN ที่ตรวจสอบตารางได้');
  }

  const cteNames = new Set([...inspected.matchAll(/(?:\bwith|,)\s*`?([a-z_][a-z0-9_]*)`?\s+as\s*\(/gi)]
    .map((match) => match[1].toLowerCase()));
  const tables = [...inspected.matchAll(/\b(?:from|join)\s+`?([a-z_][a-z0-9_]*)(?:`?\.`?([a-z_][a-z0-9_]*))?`?/gi)]
    .map((match) => (match[2] || match[1]).toLowerCase())
    .filter((table) => !cteNames.has(table));
  if (!tables.length) throw new Error('ไม่พบตารางในคำสั่งค้นข้อมูล');
  const denied = [...new Set(tables.filter((table) => !AI_ALLOWED_HOSXP_TABLES.has(table)))];
  if (denied.length) throw new Error(`ตารางไม่อยู่ในรายการอนุญาต: ${denied.join(', ')}`);

  const finalLimit = inspected.match(/\blimit\s+(\d+)\s*$/i);
  if (finalLimit) {
    const requested = Number(finalLimit[1]);
    if (!Number.isFinite(requested) || requested < 1) throw new Error('LIMIT ไม่ถูกต้อง');
    if (requested > MAX_ROWS) sql = sql.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${MAX_ROWS}`);
  } else {
    sql = `${sql}\nLIMIT ${MAX_ROWS}`;
  }
  return { sql, tables: [...new Set(tables)], limit: MAX_ROWS };
};

const serializable = (value: unknown): string | number | boolean | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
};

export const executeReadOnlyQuery = async (input: string) => {
  const validated = validateReadOnlySql(input);
  const connection = await getUTFConnection();
  let transactionStarted = false;
  try {
    await connection.query('START TRANSACTION READ ONLY');
    transactionStarted = true;
    const [rows, fields] = await connection.query({ sql: validated.sql, timeout: QUERY_TIMEOUT_MS });
    if (!Array.isArray(rows)) throw new Error('คำสั่งนี้ไม่ได้คืนข้อมูลแบบตาราง');
    const normalizedRows = (rows as Array<Record<string, unknown>>).slice(0, MAX_ROWS).map((row) => (
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serializable(value)]))
    ));
    return {
      rows: normalizedRows,
      columns: (fields || []).map((field) => field.name),
      truncated: rows.length > MAX_ROWS,
      tables: validated.tables,
    };
  } finally {
    if (transactionStarted) await connection.query('ROLLBACK').catch(() => undefined);
    connection.release();
  }
};

````
