---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiErrorTools.ts"
source_hash: "c4671e00f8b053121b0f04a353c3fbc1350dd461f30d0832b8855543bbfc6647"
managed_by: "sync-ksp-vault"
---
# aiErrorTools.ts

> Source: `server/aiErrorTools.ts`
> SHA-256: `c4671e00f8b053121b0f04a353c3fbc1350dd461f30d0832b8855543bbfc6647`

````typescript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUTFConnection } from './db.js';

type ErrorCatalogEntry = { type: string; description: string; guide: string };
type ErrorCatalog = Record<string, ErrorCatalogEntry>;

export type ErrorAnalysisIntent = {
  codes: string[];
  vn?: string;
};

let cachedCatalog: ErrorCatalog | null = null;

export const loadErrorCatalog = (): ErrorCatalog => {
  if (cachedCatalog) return cachedCatalog;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, '../public/repErrorCatalog.json'),
    path.resolve(process.cwd(), 'public/repErrorCatalog.json'),
  ];
  const filename = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filename) throw new Error('ไม่พบคลังคำอธิบายรหัสข้อผิดพลาด REP');
  cachedCatalog = JSON.parse(fs.readFileSync(filename, 'utf8')) as ErrorCatalog;
  return cachedCatalog;
};

const normalizeCode = (value: string) => value.trim().toUpperCase();

export const parseErrorAnalysisIntent = (question: string): ErrorAnalysisIntent | null => {
  const normalized = question.trim();
  if (!/(?:error|err|รหัส|ข้อผิดพลาด|ผิดอะไร|แก้(?:ไข)?อย่างไร|แก้ยังไง|rep)/i.test(normalized)) return null;
  const vn = normalized.match(/\bvn\s*[:#-]?\s*(\d{6,20})\b/i)?.[1];
  const catalog = loadErrorCatalog();
  const candidates = normalized.match(/\b(?:[a-z]{1,3}\d{2,4}|\d{3,4})\b/gi) || [];
  const codes = [...new Set(candidates.map(normalizeCode).filter((code) => Boolean(catalog[code])))];
  return { codes, ...(vn ? { vn } : {}) };
};

const splitCodes = (value: unknown) => (
  String(value || '')
    .split(/[,;|/\s]+/)
    .map(normalizeCode)
    .filter(Boolean)
);

const lookupLatestVnErrors = async (vn: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT vn, error_code, fdh_reservation_status, fdh_claim_status_message, updated_at
       FROM fdh_claim_status
       WHERE vn = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [vn],
    );
    return (rows as Array<Record<string, unknown>>)[0] || null;
  } finally {
    connection.release();
  }
};

export const answerErrorAnalysisQuestion = async (intent: ErrorAnalysisIntent) => {
  const catalog = loadErrorCatalog();
  let codes = intent.codes;
  let vnRow: Record<string, unknown> | null = null;
  if (intent.vn) {
    vnRow = await lookupLatestVnErrors(intent.vn);
    codes = [...new Set([...codes, ...splitCodes(vnRow?.error_code)])];
  }
  if (intent.vn && !vnRow) {
    return {
      answer: `ไม่พบสถานะ FDH ล่าสุดของ VN ${intent.vn} กรุณาตรวจสอบเลข VN หรือระบุรหัสข้อผิดพลาดที่เห็น`,
      needsClarification: true,
    };
  }
  if (!codes.length) {
    const status = vnRow
      ? String(vnRow.fdh_claim_status_message || vnRow.fdh_reservation_status || '').trim()
      : '';
    return {
      answer: status
        ? `VN ${intent.vn} มีสถานะล่าสุด: ${status}\nไม่พบรหัสข้อผิดพลาดในรายการนี้`
        : 'กรุณาระบุรหัสข้อผิดพลาดหรือ VN เช่น “รหัส 116 แก้อย่างไร” หรือ “ตรวจ error VN 670000123456”',
      needsClarification: !status,
    };
  }
  const details = codes.map((code) => {
    const entry = catalog[code];
    return entry
      ? `${code} — ${entry.description}\nประเภท: ${entry.type}\nแนวทางตรวจสอบ: ${entry.guide}`
      : `${code} — ยังไม่มีคำอธิบายในคลัง REP`;
  });
  const prefix = intent.vn
    ? `ผลตรวจ VN ${intent.vn}${vnRow?.updated_at ? ` (ข้อมูลล่าสุด ${String(vnRow.updated_at)})` : ''}\n`
    : '';
  return {
    answer: `${prefix}${details.join('\n\n')}\n\nAI แสดงแนวทางจากคลัง REP และไม่แก้ไขข้อมูล HOSxP อัตโนมัติ`,
    report: { type: 'error-analysis', source: 'FDHChecker/REP', vn: intent.vn, codes },
  };
};


````
