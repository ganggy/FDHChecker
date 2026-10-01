import { pickImportColumn } from './utils/importColumnLookup.js';
import { parseFlexibleDateTime } from './utils/dataNormalization.js';
import { parseOriginalRow } from '../src/utils/stmZeroAudit.js';

export type EncounterKind = 'OP' | 'IP' | 'UNKNOWN';
export function statementEncounterIdentity(row: Record<string, unknown>) {
  const raw = parseOriginalRow(row.raw_data);
  const pick = (keys: string[]) => pickImportColumn(raw, keys, true);
  const tranId = pick(['TRAN_ID', 'transaction_uid', 'tranid']) || String(row.tran_id ?? '').trim();
  const rawAn = pick(['AN', 'รหัสผู้ป่วยใน (AN)', 'admission_no']);
  const rawVn = pick(['VN', 'visit_no', 'รหัสบริการ (SEQ)']);
  const forbidden = new Set([tranId, pick(['REP', 'REP No.', 'statement_no', 'STM', 'STM No.'])].filter(Boolean));
  const clean = (value: unknown) => { const key = String(value ?? '').trim(); return forbidden.has(key) ? '' : key; };
  const type = pick(['ประเภทผู้ป่วย', 'patient_type', 'department']).toUpperCase();
  const filename = String(row.source_filename ?? row.filename ?? '');
  let kind: EncounterKind = 'UNKNOWN';
  if (/^(OP|OPD)$/.test(type) || type.includes('ผู้ป่วยนอก')) kind = 'OP';
  else if (/^(IP|IPD)$/.test(type) || type.includes('ผู้ป่วยใน')) kind = 'IP';
  else if (/(?:^|[_\s.-])OP(?:UCS)?(?=[\d_\s.-]|$)/i.test(filename)) kind = 'OP';
  else if (/(?:^|[_\s.-])IP(?:UCS)?(?=[\d_\s.-]|$)/i.test(filename)) kind = 'IP';
  else if (clean(rawAn)) kind = 'IP';
  else if (clean(rawVn)) kind = 'OP';
  const serviceDatetime = parseFlexibleDateTime(pick(['service_datetime', 'service_date', 'date_serv', 'วันที่รับบริการ', 'วันเข้ารักษา', 'วันที่ฟอกเลือดด้วยเครื่องไตเทียม', 'วันจำหน่าย']) || String(row.service_datetime ?? row.service_date ?? ''));
  return { kind, hn: pick(['HN']) || String(row.hn ?? '').trim(), cid: pick(['CID', 'PID', 'เลขบัตรประชาชน', 'เลขบัตรประชาชน (PID)']) || String(row.pid ?? row.cid ?? '').trim(), tranId,
    vn: kind === 'IP' ? '' : clean(rawVn || row.vn),
    an: kind === 'OP' ? '' : clean(rawAn || row.an),
    serviceDatetime,
  };
}

export type HisEncounter = { kind: 'OP' | 'IP'; visit_code: string; hn: string };
export function uniqueHisEncounter(hn: string, kind: EncounterKind, encounters: HisEncounter[]): HisEncounter | null {
  const unique = new Map<string, HisEncounter>();
  for (const e of encounters) if (hn && e.hn === hn && (kind === 'UNKNOWN' || kind === e.kind)) unique.set(`${e.kind}:${e.visit_code}`, e);
  return unique.size === 1 ? [...unique.values()][0] : null;
}

type EncounterReader = { query(sql: string, values: string[]): Promise<unknown> };
type EncounterIdentity = { kind: EncounterKind; hn: string; cid?: string; vn?: string; an?: string; serviceDatetime: string | null };
export function matchesHospitalIdentity(identity: EncounterIdentity, kind: 'OP' | 'IP', record: Record<string, unknown>): boolean {
  if (identity.kind !== 'UNKNOWN' && identity.kind !== kind) return false;
  if (identity.hn && String(record.hn ?? '') !== identity.hn) return false;
  const cid = String(identity.cid || '').replace(/[^0-9]/g, '');
  if (cid.length === 13 && String(record.cid ?? '') !== cid) return false;
  if (!identity.hn && cid.length !== 13) return false;
  const date = identity.serviceDatetime?.slice(0, 10);
  if (date && !(kind === 'OP' ? String(record.service_date) === date : [String(record.regdate), String(record.dchdate)].includes(date))) return false;
  const minute = identity.serviceDatetime?.slice(11, 16);
  if (kind === 'OP' && minute && minute !== '00:00' && String(record.service_time || '').slice(0, 5) !== minute) return false;
  return true;
}
// Explicit keys must also agree with the patient and supplied service date/time.
export async function resolveHospitalEncounter(connection: EncounterReader, identity: EncounterIdentity, useKeys = true): Promise<HisEncounter | null> {
  const hn = identity.hn.trim();
  const cid = String(identity.cid || '').replace(/[^0-9]/g, '');
  if (!hn && cid.length !== 13) return null;
  const date = identity.serviceDatetime?.slice(0, 10);
  const minute = identity.serviceDatetime?.slice(11, 16);
  const encounters: HisEncounter[] = [];
  for (const kind of ['OP', 'IP'] as const) {
    if (identity.kind !== 'UNKNOWN' && identity.kind !== kind) continue;
    const key = useKeys ? (kind === 'OP' ? identity.vn : identity.an)?.trim() : '';
    if (!date && !key) continue;
    const column = kind === 'OP' ? 'vn' : 'an';
    const clauses: string[] = []; const values: string[] = [];
    if (hn) { clauses.push('v.hn = ?'); values.push(hn); }
    if (cid.length === 13) { clauses.push('pt.cid = ?'); values.push(cid); }
    if (date) {
      clauses.push(kind === 'OP' ? 'v.vstdate = ?' : '(v.regdate = ? OR v.dchdate = ?)');
      values.push(date); if (kind === 'IP') values.push(date);
    }
    if (kind === 'OP' && minute && minute !== '00:00') {
      clauses.push('v.vsttime >= ? AND v.vsttime <= ?'); values.push(`${minute}:00`, `${minute}:59`);
    }
    if (key) { clauses.push(`v.${column} = ?`); values.push(key); }
    const [rows] = await connection.query(`SELECT v.${column} AS visit_code, v.hn FROM ${kind === 'OP' ? 'ovst' : 'ipt'} v${cid.length === 13 ? ' JOIN patient pt ON pt.hn = v.hn' : ''} WHERE ${clauses.join(' AND ')} LIMIT 2`, values) as [Array<{ visit_code: string; hn: string }>];
    encounters.push(...rows.map(r => ({ kind, hn: String(r.hn), visit_code: String(r.visit_code) })));
  }
  const unique = new Map(encounters.map(e => [`${e.kind}:${e.visit_code}`, e]));
  if (unique.size === 1) return [...unique.values()][0];
  if (unique.size === 0 && useKeys && date && (identity.vn || identity.an)) return resolveHospitalEncounter(connection, identity, false);
  return null;
}
export async function findStatementEncounter(connection: EncounterReader, identity: EncounterIdentity): Promise<HisEncounter | null> {
  return resolveHospitalEncounter(connection, identity, false);
}
