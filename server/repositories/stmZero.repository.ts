import type { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { getRepstmConnection, getUTFConnection } from '../db/connection.js';
import { readVisitItems, readVisitClinical } from '../visitDetails.js';
import { statementEncounterIdentity, findStatementEncounter, matchesHospitalIdentity, type HisEncounter } from '../stmEncounterIdentity.js';
import { pickImportColumn } from '../utils/importColumnLookup.js';
import { classifyZeroAction, computeZeroLifecycle, isExplicitZero, isFdhStatusPassed, originalPaidAmount, parseOriginalRow, resolveUniqueRepVisit, type StmZeroRow } from '../../src/utils/stmZeroAudit.js';

const active = `NOT EXISTS (SELECT 1 FROM repstm_import_batch replacement WHERE replacement.replaces_batch_id = b.id)`;
const sheetZero = `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(b.sheet_name, ''), ' ', ''), '_', ''), '-', ''), '.', '')) IN ('sheet0', 'datasheet0', '0')`;
const text = (v: unknown) => v == null ? '' : String(v);
const amount = (v: unknown) => v == null || v === '' ? null : Number(v);
export type ZeroAuditSource = 'stm' | 'rep-sheet-zero';
const repSheetZeroPredicate = `r.data_type = 'REP' AND b.data_type = 'REP' AND ${sheetZero}`;
export async function readZeroAuditSourceRows(connection: Pick<PoolConnection, 'query'>, startDate: string, endDate: string, source: ZeroAuditSource, selectedIds?: string[]) {
    const selection = (prefix: string, alias: string) => {
      if (selectedIds === undefined) return { sql: '', args: [] as string[] };
      const ids = selectedIds.filter(id => id.startsWith(prefix + '-')).map(id => id.slice(prefix.length + 1));
      return ids.length ? { sql: ` AND ${alias}.id IN (${ids.map(() => '?').join(',')})`, args: ids }
        : { sql: ' AND 1=0', args: [] as string[] };
    };
    const normalSelection = selection('stm', 's');
    const archiveSelection = selection('raw', 'r');
    // Imported period deliberately includes rows without service dates and visits not found in HIS.
    const [normalized] = source === 'rep-sheet-zero' ? [[] as RowDataPacket[]] : await connection.query<RowDataPacket[]>(`SELECT s.*, b.source_filename, b.sheet_name,
      DATE_FORMAT(s.service_datetime, '%Y-%m-%d') AS service_date
      FROM repstm_statement_data s JOIN repstm_import_batch b ON b.id = s.batch_id
      WHERE s.data_type = 'STM' AND (s.paid_amount = 0 OR s.paid_amount IS NULL) AND ${active}
      AND b.created_at >= ? AND b.created_at < DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY) ${normalSelection.sql} ORDER BY s.id DESC LIMIT 20001`, [startDate, endDate, ...normalSelection.args]);
    const [archive] = await connection.query<RowDataPacket[]>(`SELECT r.*, b.source_filename, b.sheet_name
      FROM repstm_import_row r JOIN repstm_import_batch b ON b.id = r.batch_id
      WHERE ${source === 'rep-sheet-zero' ? repSheetZeroPredicate : sheetZero} AND ${active} AND b.created_at >= ? AND b.created_at < DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY)
      ${source === 'rep-sheet-zero' ? '' : 'AND NOT EXISTS (SELECT 1 FROM repstm_statement_data s WHERE s.batch_id = b.id)'}
      ${archiveSelection.sql} ORDER BY r.id DESC LIMIT 20001`, [startDate, endDate, ...archiveSelection.args]);
    if (normalized.length + archive.length > 20000) throw new Error('เกิน 20,000 แถว กรุณาลดช่วงวันที่นำเข้า');
    return [...normalized.map(r => ({ ...r, audit_id: `stm-${r.id}` })), ...archive.map(r => ({ ...r, audit_id: `raw-${r.id}` }))] as Array<Record<string, unknown> & { audit_id: string }>;
}
export async function readStmZeroRows(startDate: string, endDate: string, source: ZeroAuditSource = 'stm', selectedIds?: string[]): Promise<StmZeroRow[]> {
  const connection = await getRepstmConnection();
  try {
    const sourceRows = await readZeroAuditSourceRows(connection, startDate, endDate, source, selectedIds);
    const identities = new Map(sourceRows.map(r => [r.audit_id, statementEncounterIdentity(r)]));
    const rows = sourceRows
      .map(r => {
        const raw = parseOriginalRow(r.raw_data);
        const identity = identities.get(r.audit_id)!;
        const paid = r.audit_id.startsWith('raw-') || r.paid_amount == null ? originalPaidAmount(raw) : amount(r.paid_amount);
        const pick = (...keys: string[]) => text(Object.entries(raw).find(([key]) => keys.includes(key.trim().toLowerCase()))?.[1]);
        return {
          id: r.audit_id, batch_id: Number(r.batch_id), source_filename: text(r.source_filename), sheet_name: text(r.sheet_name),
          row_no: r.row_no == null ? null : Number(r.row_no), statement_no: text(r.statement_no) || pickImportColumn(raw, ['REP', 'REP No.', 'REP_NO', 'stm', 'stm no.', 'statement_no'], true),
          tran_id: identity.tranId, hn: identity.hn, vn: identity.vn, an: identity.an, encounter_type: identity.kind,
          patient_name: text(r.patient_name) || pick('ชื่อ-สกุล', 'ชื่อ - สกุล'), service_date: identity.serviceDatetime?.slice(0, 10) || text(r.service_date),
          maininscl: text(r.maininscl) || pick('maininscl', 'fund', 'fund_code'),
          errorcode: text(r.errorcode) || pickImportColumn(raw, ['errorcode', 'error code', 'error_code', 'รหัสข้อผิดพลาด', 'รหัสไม่ผ่าน', 'รหัสปฏิเสธ'], true), verifycode: text(r.verifycode) || pickImportColumn(raw, ['verifycode', 'verify code', 'verify_code'], true),
          amount: amount(r.amount) ?? amount(pickImportColumn(raw, ['amount', 'เรียกเก็บ', 'ยอดเรียกเก็บ', 'จำนวนเงินที่ขอเบิก'], true) || null), paid_amount: paid, raw_data: raw, matched: false, has_payment: false, payment_uncertain: false,
          action: 'review' as const, reason: '',
          fdh_sent_today: false, last_fdh_sent_at: null as string | null, fdh_status_message: null as string | null, fdh_transaction_uid: null as string | null,
        };
      }).filter(r => source === 'rep-sheet-zero' || r.paid_amount == null || isExplicitZero(r.paid_amount));
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
        const visits = new Map<string, Record<string, unknown>>();
        for (const [keys, table, column] of [[vns, 'ovst', 'vn'], [ans, 'ipt', 'an']] as const) {
          if (!keys.length) continue;
          const dates = column === 'vn' ? "DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS service_date, CAST(v.vsttime AS CHAR) AS service_time" : "DATE_FORMAT(v.regdate, '%Y-%m-%d') AS regdate, DATE_FORMAT(v.dchdate, '%Y-%m-%d') AS dchdate";
          const [found] = await hospital.query(`SELECT v.${column} AS visit_code, v.hn, pt.cid, ${dates} FROM ${table} v LEFT JOIN patient pt ON pt.hn = v.hn WHERE v.${column} IN (${keys.map(() => '?').join(',')})`, keys);
          for (const item of found as Array<Record<string, unknown>>) visits.set(`${column}:${item.visit_code}`, item);
        }
        for (const r of chunk) {
          const identity = identities.get(r.id)!;
          const found = visits.get(r.an ? `an:${r.an}` : `vn:${r.vn}`);
          r.matched = Boolean(found && matchesHospitalIdentity(identity, r.an ? 'IP' : 'OP', found));
          if (!r.matched) {
            // Repair legacy TRAN_ID-as-AN mappings on read, without changing imported rows.
            r.vn = ''; r.an = '';
            const cacheKey = JSON.stringify([identity.kind, identity.hn, identity.cid, identity.serviceDatetime]);
            if (!recoveryCache.has(cacheKey)) recoveryCache.set(cacheKey, await findStatementEncounter(hospital, identity));
            const recovered = recoveryCache.get(cacheKey);
            if (recovered) {
              r.vn = recovered.kind === 'OP' ? recovered.visit_code : '';
              r.an = recovered.kind === 'IP' ? recovered.visit_code : '';
              r.hn = recovered.hn; r.matched = true; r.encounter_type = recovered.kind;
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

        // Query FDH submission history to prevent duplicate submission on the same day
        const fdhStatusMap = new Map<string, { sent_at: string; status: string; uid: string; sent_today: boolean }>();
        const allCodes = [...new Set([...vns, ...ans])].filter(Boolean);

        // 1. Check fdh_send_log in HOSxP (real-time export log recorded immediately when sending FDH today)
        if (allCodes.length) {
          try {
            const [sendLogs] = await hospital.query<RowDataPacket[]>(`
              SELECT fdh_send_log_vnan, fdh_send_log_type,
                DATE_FORMAT(COALESCE(fdh_send_log_lastupdate, fdh_send_log_date), '%Y-%m-%d %H:%i:%s') AS sent_at,
                COALESCE(fdh_send_log_message, fdh_send_log_status) AS status_msg,
                CASE WHEN DATE(COALESCE(fdh_send_log_lastupdate, fdh_send_log_date)) = CURRENT_DATE() THEN 1 ELSE 0 END AS sent_today
              FROM fdh_send_log
              WHERE fdh_send_log_vnan IN (${allCodes.map(() => '?').join(',')})
              ORDER BY fdh_send_log_id DESC
            `, allCodes);
            for (const item of sendLogs as Array<Record<string, unknown>>) {
              const code = String(item.fdh_send_log_vnan || '').trim();
              const isToday = Number(item.sent_today) === 1;
              const sentAt = String(item.sent_at || '');
              const statusMsg = String(item.status_msg || 'ส่งออก FDH แล้ว');
              if (vns.includes(code)) {
                const existing = fdhStatusMap.get(`vn:${code}`);
                if (!existing || (!existing.sent_today && isToday)) {
                  fdhStatusMap.set(`vn:${code}`, { sent_at: sentAt, status: statusMsg, uid: '', sent_today: isToday });
                }
              }
              if (ans.includes(code)) {
                const existing = fdhStatusMap.get(`an:${code}`);
                if (!existing || (!existing.sent_today && isToday)) {
                  fdhStatusMap.set(`an:${code}`, { sent_at: sentAt, status: statusMsg, uid: '', sent_today: isToday });
                }
              }
            }
          } catch {
            // fdh_send_log might not exist in some hospital setups
          }
        }

        // 2. Check mophclaim_send in App DB (exports performed via FDH Checker)
        if (allCodes.length) {
          try {
            const [appSendLogs] = await connection.query<RowDataPacket[]>(`
              SELECT vn, type,
                DATE_FORMAT(COALESCE(senddate, created_at), '%Y-%m-%d %H:%i:%s') AS sent_at,
                COALESCE(note, flag) AS status_msg,
                CASE WHEN DATE(COALESCE(senddate, created_at)) = CURRENT_DATE() THEN 1 ELSE 0 END AS sent_today
              FROM mophclaim_send
              WHERE vn IN (${allCodes.map(() => '?').join(',')})
              ORDER BY updated_at DESC
            `, allCodes);
            for (const item of appSendLogs as Array<Record<string, unknown>>) {
              const code = String(item.vn || '').trim();
              const isToday = Number(item.sent_today) === 1;
              const sentAt = String(item.sent_at || '');
              const statusMsg = String(item.status_msg || 'ส่งออก FDH แล้ว');
              if (vns.includes(code)) {
                const existing = fdhStatusMap.get(`vn:${code}`);
                if (!existing || (!existing.sent_today && isToday)) {
                  fdhStatusMap.set(`vn:${code}`, { sent_at: sentAt, status: statusMsg, uid: '', sent_today: isToday });
                }
              }
              if (ans.includes(code)) {
                const existing = fdhStatusMap.get(`an:${code}`);
                if (!existing || (!existing.sent_today && isToday)) {
                  fdhStatusMap.set(`an:${code}`, { sent_at: sentAt, status: statusMsg, uid: '', sent_today: isToday });
                }
              }
            }
          } catch {
            // best-effort
          }
        }

        // 3. Also check fdh_claim_status in HOSxP
        if (allCodes.length) {
          try {
            const [fdhRows] = await hospital.query<RowDataPacket[]>(`
              SELECT vn, DATE_FORMAT(COALESCE(last_update, fdh_claim_status_datetime), '%Y-%m-%d %H:%i:%s') AS sent_at,
                fdh_claim_status_message AS status_msg, transaction_uid,
                CASE WHEN DATE(COALESCE(last_update, fdh_claim_status_datetime)) = CURRENT_DATE() THEN 1 ELSE 0 END AS sent_today
              FROM fdh_claim_status
              WHERE vn IN (${allCodes.map(() => '?').join(',')})
              ORDER BY fdh_claim_status_id DESC
            `, allCodes);
            for (const item of fdhRows as Array<Record<string, unknown>>) {
              const vnKey = String(item.vn || '');
              const isToday = Number(item.sent_today) === 1;
              const sentAt = String(item.sent_at || '');
              const statusMsg = String(item.status_msg || '');
              const uid = String(item.transaction_uid || '');
              if (vns.includes(vnKey)) {
                const existing = fdhStatusMap.get(`vn:${vnKey}`);
                if (!existing || (!existing.sent_today && isToday)) {
                  fdhStatusMap.set(`vn:${vnKey}`, { sent_at: sentAt, status: statusMsg, uid, sent_today: isToday });
                }
              }
              if (ans.includes(vnKey)) {
                const existing = fdhStatusMap.get(`an:${vnKey}`);
                if (!existing || (!existing.sent_today && isToday)) {
                  fdhStatusMap.set(`an:${vnKey}`, { sent_at: sentAt, status: statusMsg, uid, sent_today: isToday });
                }
              }
            }
          } catch {
            // best-effort
          }
        }

        // 4. Also check repstminv fdh_claim_detail_row for both VN and AN
        if (allCodes.length) {
          try {
            const [claimDetails] = await connection.query<RowDataPacket[]>(`
              SELECT vn, an, DATE_FORMAT(COALESCE(sent_at, created_at), '%Y-%m-%d %H:%i:%s') AS sent_at,
                claim_status, upload_uid,
                CASE WHEN DATE(COALESCE(sent_at, created_at)) = CURRENT_DATE() THEN 1 ELSE 0 END AS sent_today
              FROM fdh_claim_detail_row
              WHERE vn IN (${allCodes.map(() => '?').join(',')}) OR an IN (${allCodes.map(() => '?').join(',')})
              ORDER BY id DESC
            `, [...allCodes, ...allCodes]);
            for (const item of claimDetails as Array<Record<string, unknown>>) {
              const vnKey = String(item.vn || '');
              const anKey = String(item.an || '');
              const targetKey = anKey && ans.includes(anKey) ? `an:${anKey}` : `vn:${vnKey}`;
              const isToday = Number(item.sent_today) === 1;
              const sentAt = String(item.sent_at || '');
              const statusMsg = String(item.claim_status || '');
              const uid = String(item.upload_uid || '');
              const existing = fdhStatusMap.get(targetKey);
              if (!existing || (!existing.sent_today && isToday)) {
                fdhStatusMap.set(targetKey, {
                  sent_at: sentAt,
                  status: statusMsg,
                  uid,
                  sent_today: isToday,
                });
              }
            }
          } catch {
            // best-effort
          }
        }

        for (const r of chunk) {
          const key = r.an ? `an:${r.an}` : (r.vn ? `vn:${r.vn}` : '');
          const fdh = key ? fdhStatusMap.get(key) : undefined;
          if (fdh) {
            r.last_fdh_sent_at = fdh.sent_at || null;
            r.fdh_status_message = fdh.status || null;
            r.fdh_transaction_uid = fdh.uid || null;
            r.fdh_sent_today = fdh.sent_today;
          } else {
            r.last_fdh_sent_at = null;
            r.fdh_status_message = null;
            r.fdh_transaction_uid = null;
            r.fdh_sent_today = false;
          }
        }
      }
    } finally { hospital.release(); }

    let resolutionMap = new Map<string, { status: string; reason: string; resolved_at: string; note: string }>();
    try {
      await ensureRepSheetZeroResolutionTable(connection);
      const [resolutions] = await connection.query<RowDataPacket[]>(`
        SELECT audit_id, status, resolved_reason, resolved_at, note
        FROM rep_sheet_zero_resolution
      `);
      for (const item of resolutions as Array<Record<string, unknown>>) {
        resolutionMap.set(String(item.audit_id), {
          status: String(item.status || 'resolved'),
          reason: String(item.resolved_reason || ''),
          resolved_at: String(item.resolved_at || ''),
          note: String(item.note || ''),
        });
      }
    } catch {
      // best-effort
    }

    return rows.map(r => {
      const isPassed = isFdhStatusPassed(r.fdh_status_message);
      const res = resolutionMap.get(r.id);
      const isResolved = Boolean(res);
      const updatedRow: StmZeroRow = {
        ...r,
        fdh_passed: isPassed,
        is_resolved: isResolved,
        resolution_status: res?.status || null,
        resolution_reason: res?.reason || null,
        resolved_at: res?.resolved_at || null,
        action: classifyZeroAction(r),
        reason: pickImportColumn(r.raw_data, ['เหตุผล', 'คำอธิบายเหตุผล', 'คำอธิบาย', 'reason', 'remark', 'error_description'], true)
          || (!r.matched ? 'ยังยืนยัน VN/AN และ HN กับ HIS ไม่ได้'
          : r.payment_uncertain ? 'Visit มีรายการที่ยังไม่ทราบยอดจ่าย ต้องตรวจให้ครบก่อน'
          : r.paid_amount == null ? 'ไม่พบคอลัมน์ยอดจ่ายที่อ่านได้ ต้องตรวจแถวต้นฉบับ'
          : 'อ่านเหตุผลจากแถวต้นฉบับและตรวจข้อมูล HIS ก่อนดำเนินการ'),
      };
      updatedRow.lifecycle_status = computeZeroLifecycle(updatedRow);
      return updatedRow;
    });
  } finally { connection.release(); }
}

export async function ensureRepSheetZeroResolutionTable(connection: Pick<PoolConnection, 'query'>) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS rep_sheet_zero_resolution (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      audit_id VARCHAR(64) NOT NULL UNIQUE,
      vn VARCHAR(32) NULL,
      an VARCHAR(32) NULL,
      hn VARCHAR(32) NULL,
      tran_id VARCHAR(191) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'resolved',
      resolved_reason VARCHAR(255) NULL,
      resolved_by VARCHAR(128) NULL,
      resolved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      note TEXT NULL,
      INDEX idx_vn (vn),
      INDEX idx_an (an),
      INDEX idx_tran_id (tran_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function resolveRepSheetZeroItems(params: {
  items: Array<string | { audit_id: string; vn?: string; an?: string; hn?: string; tran_id?: string }>;
  status?: string;
  reason?: string;
  user?: string;
  note?: string;
}): Promise<{ count: number }> {
  if (!params.items || !params.items.length) return { count: 0 };
  const connection = await getRepstmConnection();
  try {
    await ensureRepSheetZeroResolutionTable(connection);
    let count = 0;
    for (const raw of params.items) {
      const item = typeof raw === 'string' ? { audit_id: raw } : raw;
      if (!item.audit_id) continue;
      const [res] = await connection.query(`
        INSERT INTO rep_sheet_zero_resolution (audit_id, vn, an, hn, tran_id, status, resolved_reason, resolved_by, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          resolved_reason = VALUES(resolved_reason),
          resolved_by = VALUES(resolved_by),
          note = VALUES(note),
          resolved_at = CURRENT_TIMESTAMP
      `, [
        item.audit_id,
        item.vn || null,
        item.an || null,
        item.hn || null,
        item.tran_id || null,
        params.status || 'resolved',
        params.reason || 'ตัดยอด / ตรวจสอบผ่านแล้ว',
        params.user || 'System',
        params.note || null,
      ]);
      if ((res as any).affectedRows > 0) count++;
    }
    return { count };
  } finally {
    connection.release();
  }
}

export async function unresolveRepSheetZeroItems(auditIds: string[]): Promise<{ count: number }> {
  if (!auditIds || !auditIds.length) return { count: 0 };
  const connection = await getRepstmConnection();
  try {
    await ensureRepSheetZeroResolutionTable(connection);
    const [res] = await connection.query(`
      DELETE FROM rep_sheet_zero_resolution WHERE audit_id IN (${auditIds.map(() => '?').join(',')})
    `, auditIds);
    return { count: (res as any).affectedRows || 0 };
  } finally {
    connection.release();
  }
}

export async function autoSyncResolveRepSheetZero(startDate: string, endDate: string): Promise<{ resolvedCount: number }> {
  const rows = await readStmZeroRows(startDate, endDate, 'rep-sheet-zero');
  const eligible = rows.filter(r => !r.is_resolved && (r.has_payment || r.fdh_passed));
  if (!eligible.length) return { resolvedCount: 0 };
  const res = await resolveRepSheetZeroItems({
    items: eligible.map(r => ({
      audit_id: r.id,
      vn: r.vn,
      an: r.an,
      hn: r.hn,
      tran_id: r.tran_id,
    })),
    status: 'auto_settled',
    reason: 'ตรวจพบผลส่ง FDH ผ่าน หรือได้รับการชดเชยแล้วใน STM (Auto-Sync)',
    user: 'Auto-Sync',
  });
  return { resolvedCount: res.count };
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
