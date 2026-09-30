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
  return { kind, hn: pick(['HN']) || String(row.hn ?? '').trim(), tranId,
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
// Only one confirmed encounter is safe; an import timestamp may omit seconds.
export async function findStatementEncounter(connection: EncounterReader, identity: ReturnType<typeof statementEncounterIdentity>): Promise<HisEncounter | null> {
  if (!identity.hn || !identity.serviceDatetime) return null;
  const date = identity.serviceDatetime.slice(0, 10);
  const minute = identity.serviceDatetime.slice(11, 16);
  const encounters: HisEncounter[] = [];
  if (identity.kind !== 'IP') {
    const timeClause = minute && minute !== '00:00' ? ' AND vsttime >= ? AND vsttime <= ?' : '';
    const params = timeClause ? [identity.hn, date, `${minute}:00`, `${minute}:59`] : [identity.hn, date];
    const [rows] = await connection.query(`SELECT vn AS visit_code, hn FROM ovst WHERE hn = ? AND vstdate = ?${timeClause} LIMIT 2`, params) as [Array<{ visit_code: string; hn: string }>];
    encounters.push(...rows.map(r => ({ kind: 'OP' as const, hn: String(r.hn), visit_code: String(r.visit_code) })));
  }
  if (identity.kind !== 'OP') {
    const [rows] = await connection.query('SELECT an AS visit_code, hn FROM ipt WHERE hn = ? AND (regdate = ? OR dchdate = ?) LIMIT 2', [identity.hn, date, date]) as [Array<{ visit_code: string; hn: string }>];
    encounters.push(...rows.map(r => ({ kind: 'IP' as const, hn: String(r.hn), visit_code: String(r.visit_code) })));
  }
  return uniqueHisEncounter(identity.hn, identity.kind, encounters);
}
