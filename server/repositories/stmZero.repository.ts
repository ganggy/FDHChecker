import type { RowDataPacket } from 'mysql2/promise';
import { getRepstmConnection, getUTFConnection } from '../db/connection.js';
import { readVisitItems, readVisitClinical } from '../visitDetails.js';
import { statementEncounterIdentity, findStatementEncounter, type HisEncounter } from '../stmEncounterIdentity.js';
import { classifyZeroAction, isExplicitZero, originalPaidAmount, parseOriginalRow, resolveUniqueRepVisit, type StmZeroRow } from '../../src/utils/stmZeroAudit.js';

const active = `NOT EXISTS (SELECT 1 FROM repstm_import_batch replacement WHERE replacement.replaces_batch_id = b.id)`;
const sheetZero = `LOWER(REPLACE(REPLACE(COALESCE(b.sheet_name, ''), ' ', ''), '_', '')) IN ('sheet0', 'datasheet0', '0')`;
const text = (v: unknown) => v == null ? '' : String(v);
const amount = (v: unknown) => v == null || v === '' ? null : Number(v);
export async function readStmZeroRows(startDate: string, endDate: string): Promise<StmZeroRow[]> {
  const connection = await getRepstmConnection();
  try {
    // Imported period deliberately includes rows without service dates and visits not found in HIS.
    const [normalized] = await connection.query<RowDataPacket[]>(`SELECT s.*, b.source_filename, b.sheet_name,
      DATE_FORMAT(s.service_datetime, '%Y-%m-%d') AS service_date
      FROM repstm_statement_data s JOIN repstm_import_batch b ON b.id = s.batch_id
      WHERE s.data_type = 'STM' AND (s.paid_amount = 0 OR s.paid_amount IS NULL) AND ${active}
      AND b.created_at >= ? AND b.created_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY s.id DESC LIMIT 20001`, [startDate, endDate]);
    const [archive] = await connection.query<RowDataPacket[]>(`SELECT r.*, b.source_filename, b.sheet_name
      FROM repstm_import_row r JOIN repstm_import_batch b ON b.id = r.batch_id
      WHERE ${sheetZero} AND ${active} AND b.created_at >= ? AND b.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      AND NOT EXISTS (SELECT 1 FROM repstm_statement_data s WHERE s.batch_id = b.id)
      ORDER BY r.id DESC LIMIT 20001`, [startDate, endDate]);
    if (normalized.length + archive.length > 20000) throw new Error('เกิน 20,000 แถว กรุณาลดช่วงวันที่นำเข้า');
    const sourceRows: Array<Record<string, unknown> & { audit_id: string }> = [...normalized.map(r => ({ ...r, audit_id: `stm-${r.id}` })), ...archive.map(r => ({ ...r, audit_id: `raw-${r.id}` }))];
    const identities = new Map(sourceRows.map(r => [r.audit_id, statementEncounterIdentity(r)]));
    const rows = sourceRows
      .map(r => {
        const raw = parseOriginalRow(r.raw_data);
        const identity = identities.get(r.audit_id)!;
        const paid = r.audit_id.startsWith('raw-') || r.paid_amount == null ? originalPaidAmount(raw) : amount(r.paid_amount);
        const pick = (...keys: string[]) => text(Object.entries(raw).find(([key]) => keys.includes(key.trim().toLowerCase()))?.[1]);
        return {
          id: r.audit_id, batch_id: Number(r.batch_id), source_filename: text(r.source_filename), sheet_name: text(r.sheet_name),
          row_no: r.row_no == null ? null : Number(r.row_no), statement_no: text(r.statement_no) || pick('stm', 'stm no.', 'statement_no'),
          tran_id: identity.tranId, hn: identity.hn, vn: identity.vn, an: identity.an, encounter_type: identity.kind,
          patient_name: text(r.patient_name) || pick('ชื่อ-สกุล', 'ชื่อ - สกุล'), service_date: identity.serviceDatetime?.slice(0, 10) || text(r.service_date),
          maininscl: text(r.maininscl) || pick('maininscl', 'fund', 'fund_code'),
          errorcode: text(r.errorcode) || pick('errorcode', 'error code'), verifycode: text(r.verifycode) || pick('verifycode', 'verify code'),
          amount: amount(r.amount), paid_amount: paid, raw_data: raw, matched: false, has_payment: false, payment_uncertain: false,
          action: 'review' as const, reason: '',
        };
      }).filter(r => r.paid_amount == null || isExplicitZero(r.paid_amount));
    const hospital = await getUTFConnection();
    try {
      const recoveryCache = new Map<string, HisEncounter | null>();
      for (let offset = 0; offset < rows.length; offset += 400) {
        const chunk = rows.slice(offset, offset + 400);
        const unresolved = chunk.filter(r => !r.vn && !r.an && r.tran_id && r.hn);
        if (unresolved.length) {
          const tranKeys = [...new Set(unresolved.map(r => r.tran_id))];
          const [responses] = await connection.query<RowDataPacket[]>(`SELECT tran_id, vn, an, hn FROM rep_data WHERE tran_id IN (${tranKeys.map(() => '?').join(',')})`, tranKeys);
          for (const r of unresolved) {
            const match = resolveUniqueRepVisit(r.hn, r.tran_id, responses);
            if (match && !(r.encounter_type === 'OP' && match.an) && !(r.encounter_type === 'IP' && match.vn)) { r.an = match.an; r.vn = match.vn; }
          }
        }
        let vns = [...new Set(chunk.filter(r => !r.an && r.vn).map(r => r.vn))];
        let ans = [...new Set(chunk.filter(r => r.an).map(r => r.an))];
        const visits = new Map<string, string>();
        for (const [keys, table, column] of [[vns, 'ovst', 'vn'], [ans, 'ipt', 'an']] as const) {
          if (!keys.length) continue;
          const [found] = await hospital.query(`SELECT ${column} AS visit_code, hn FROM ${table} WHERE ${column} IN (${keys.map(() => '?').join(',')})`, keys);
          for (const item of found as Array<{ visit_code: string; hn: string }>) visits.set(`${column}:${item.visit_code}`, text(item.hn));
        }
        for (const r of chunk) {
          r.matched = Boolean(r.hn && visits.get(r.an ? `an:${r.an}` : `vn:${r.vn}`) === r.hn);
          if (!r.matched) {
            // Repair legacy TRAN_ID-as-AN mappings on read, without changing imported rows.
            r.vn = ''; r.an = '';
            const identity = identities.get(r.id)!;
            const cacheKey = JSON.stringify([identity.kind, identity.hn, identity.serviceDatetime]);
            if (!recoveryCache.has(cacheKey)) recoveryCache.set(cacheKey, await findStatementEncounter(hospital, identity));
            const recovered = recoveryCache.get(cacheKey);
            if (recovered) {
              r.vn = recovered.kind === 'OP' ? recovered.visit_code : '';
              r.an = recovered.kind === 'IP' ? recovered.visit_code : '';
              r.matched = true; r.encounter_type = recovered.kind;
            }
          } else r.encounter_type = r.an ? 'IP' : 'OP';
        }
        vns = [...new Set(chunk.map(r => r.vn).filter(Boolean))];
        ans = [...new Set(chunk.map(r => r.an).filter(Boolean))];
        const conditions: string[] = []; const params: string[] = [];
        if (vns.length) { conditions.push(`s.vn IN (${vns.map(() => '?').join(',')})`); params.push(...vns); }
        if (ans.length) { conditions.push(`s.an IN (${ans.map(() => '?').join(',')})`); params.push(...ans); }
        const tranIds = [...new Set(chunk.map(r => r.tran_id).filter(Boolean))];
        if (tranIds.length) { conditions.push(`s.tran_id IN (${tranIds.map(() => '?').join(',')})`); params.push(...tranIds); }
        if (conditions.length) {
          const [paid] = await connection.query<RowDataPacket[]>(`SELECT s.vn, s.an, s.tran_id, s.paid_amount, s.raw_data FROM repstm_statement_data s
            JOIN repstm_import_batch b ON b.id = s.batch_id WHERE s.data_type IN ('STM','INV')
            AND (s.paid_amount > 0 OR s.paid_amount IS NULL) AND ${active} AND (${conditions.join(' OR ')})`, params);
          for (const r of chunk) {
            const linked = paid.filter(p => (r.an ? p.an === r.an : r.vn && p.vn === r.vn) || (r.tran_id && p.tran_id === r.tran_id));
            r.has_payment = linked.some(p => (amount(p.paid_amount) ?? originalPaidAmount(parseOriginalRow(p.raw_data)) ?? 0) > 0);
            r.payment_uncertain = linked.some(p => p.paid_amount == null && originalPaidAmount(parseOriginalRow(p.raw_data)) == null);
          }
        }
      }
    } finally { hospital.release(); }
    return rows.map(r => ({ ...r, action: classifyZeroAction(r), reason: !r.matched ? 'ยังยืนยัน VN/AN และ HN กับ HIS ไม่ได้' : r.payment_uncertain ? 'Visit มีรายการที่ยังไม่ทราบยอดจ่าย ต้องตรวจให้ครบก่อน' : r.paid_amount == null ? 'ไม่พบคอลัมน์ยอดจ่ายที่อ่านได้ ต้องตรวจแถวต้นฉบับ' : 'อ่านเหตุผลจากแถวต้นฉบับและตรวจข้อมูล HIS ก่อนดำเนินการ' }));
  } finally { connection.release(); }
}

export async function readStmZeroSource(row: StmZeroRow) {
  if (!row.matched) return { diagnoses: [], procedures: [], items: [], warnings: [], warning: 'ยังจับคู่กับ HIS ไม่ได้' };
  const connection = await getUTFConnection();
  try {
    const clinical = await readVisitClinical(connection, row.vn, row.an || undefined);
    const items = await readVisitItems(connection, row.vn, row.an || undefined);
    return { ...clinical, items, warning: '' };
  } finally { connection.release(); }
}
