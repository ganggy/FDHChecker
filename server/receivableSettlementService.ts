import { getRepstmConnection, getUTFConnection } from './db/connection.js';
import { ensureRepstmTables } from './db/schema.js';
import { RECEIVABLE_RIGHT_MAPPINGS, type ReceivableRightMapping } from './receivableMapping.js';
import businessRules from './config/business_rules.json';
import { readHospitalIdentity } from './siteProfile.js';
import type { PoolConnection } from 'mysql2/promise';

export interface SettlementStatementSummary {
  statement_no: string;
  data_type: string;
  filefrom: string;
  record_count: number;
  total_paid_amount: number;
  total_invoice_amount: number;
  min_service_date: string | null;
  max_service_date: string | null;
  filename: string;
  imported_at: string;
}

export interface SettlementCandidateItem {
  id: number;
  statement_no: string;
  tran_id: string | null;
  hn: string | null;
  vn: string | null;
  an: string | null;
  cid: string | null;
  patient_name: string | null;
  patient_type: string;
  service_date: string | null;
  maininscl: string | null;
  subinscl: string | null;
  errorcode: string | null;
  verifycode: string | null;
  debtor_code: string;
  revenue_code: string;
  claimable_amount: number;
  paid_amount: number;
  payment_known?: boolean;
  mapping_known?: boolean;
  diff_amount: number;
  settle_action: 'full' | 'partial' | 'writeoff_diff' | 'hold_appeal';
  match_level?: SettlementMatchLevel;
  already_settled?: boolean;
  settled_no?: string | null;
  notes?: string;
}

export interface SettlementJournalEntry {
  type: 'DEBIT' | 'CREDIT';
  account_code: string;
  account_name: string;
  amount: number;
}

export interface SettlementCandidateResult {
  statement_no: string;
  payer_type: string;
  total_cases: number;
  total_claimable: number;
  total_received: number;
  total_diff: number;
  total_disallowance: number;
  total_overpay: number;
  items: SettlementCandidateItem[];
  journal_entries: SettlementJournalEntry[];
  is_balanced: boolean;
}

export interface ExecuteSettlementPayload {
  payer_type: string;
  statement_no: string;
  transfer_date: string;
  bank_account?: string;
  notes?: string;
  created_by?: string;
  items: Array<{
    statement_record_id?: number;
    patient_type: string;
    vn?: string | null;
    an?: string | null;
    hn?: string | null;
    cid?: string | null;
    patient_name?: string | null;
    service_date?: string | null;
    pttype?: string | null;
    pttype_name?: string | null;
    hipdata_code?: string | null;
    debtor_code?: string | null;
    revenue_code?: string | null;
    claimable_amount: number;
    paid_amount: number;
    diff_amount: number;
    settle_action: string;
    error_code?: string | null;
    notes?: string | null;
  }>;
}

export const findRightMapping = (hipdataCode?: string | null, pttype?: string | null): ReceivableRightMapping | undefined => {
  if (pttype) return RECEIVABLE_RIGHT_MAPPINGS.find(item => item.hosxp_code === pttype);
  const matches = RECEIVABLE_RIGHT_MAPPINGS.filter(item => item.hipdata_code === String(hipdataCode || '').trim().toUpperCase());
  const accounts = new Set(matches.map(item => JSON.stringify([item.debtor_opd, item.debtor_ipd, item.revenue_opd, item.revenue_ipd])));
  return accounts.size === 1 ? matches[0] : undefined;
};

export type SettlementMatchLevel = 'exact' | 'strong' | 'weak' | 'none';

/** ระดับความเชื่อมั่นของการจับคู่รายการ STM กับลูกหนี้ (ไม่ใช้ยอดเงินตัดสิน) */
export const classifyMatchLevel = (item: {
  tran_id?: string | null; hn?: string | null; vn?: string | null; an?: string | null;
  cid?: string | null; service_date?: string | null; mapping_known?: boolean; payment_known?: boolean;
}): SettlementMatchLevel => {
  const has = (value?: string | null) => Boolean(value && String(value).trim());
  if (item.mapping_known === false || item.payment_known === false) return has(item.cid) ? 'weak' : 'none';
  if (has(item.tran_id) && has(item.hn) && has(item.service_date)) return 'exact';
  if (has(item.hn) && (has(item.vn) || has(item.an))) return 'strong';
  if (has(item.cid) && has(item.service_date)) return 'weak';
  return 'none';
};

const BANK_ACCOUNT = { code: '1101010104.101', name: 'เงินฝากธนาคารในงบประมาณ/เงินบำรุง' };
const DISALLOWANCE_ACCOUNT = { code: '5103010102.101', name: 'ค่ารักษาพยาบาลต่ำกว่าเกณฑ์/ส่วนลดจ่าย' };
const OVERPAY_ACCOUNT = { code: '4301020105.101', name: 'รายได้ค่ารักษาพยาบาลสูงกว่าเกณฑ์/เงินชดเชยเพิ่ม' };

/** สร้างรายการบัญชีชุดเดียวกันทั้งหน้าพรีวิวและตอนบันทึก โดยเครดิตลูกหนี้แยกตามรหัสบัญชีจาก mapping สิทธิ์ */
export const buildSettlementJournal = (items: Array<{ debtor_code?: string | null; claimable_amount: number; paid_amount: number; diff_amount: number }>) => {
  const round = (value: number) => Number(value.toFixed(2));
  let received = 0; let disallowance = 0; let overpay = 0;
  const byDebtor = new Map<string, number>();
  for (const item of items) {
    received += Number(item.paid_amount || 0);
    const diff = Number(item.diff_amount || 0);
    if (diff < 0) disallowance += Math.abs(diff); else if (diff > 0) overpay += diff;
    const code = String(item.debtor_code || '');
    byDebtor.set(code, (byDebtor.get(code) || 0) + Number(item.claimable_amount || 0));
  }
  const entries: SettlementJournalEntry[] = [{ type: 'DEBIT', account_code: BANK_ACCOUNT.code, account_name: BANK_ACCOUNT.name, amount: round(received) }];
  if (round(disallowance) > 0) entries.push({ type: 'DEBIT', account_code: DISALLOWANCE_ACCOUNT.code, account_name: DISALLOWANCE_ACCOUNT.name, amount: round(disallowance) });
  for (const [code, amount] of byDebtor) {
    entries.push({ type: 'CREDIT', account_code: code, account_name: code ? 'ลูกหนี้ตาม mapping สิทธิ์' : 'ยังไม่ยืนยันบัญชีลูกหนี้', amount: round(amount) });
  }
  if (round(overpay) > 0) entries.push({ type: 'CREDIT', account_code: OVERPAY_ACCOUNT.code, account_name: OVERPAY_ACCOUNT.name, amount: round(overpay) });
  const debit = entries.filter(e => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0);
  const credit = entries.filter(e => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0);
  return { entries, isBalanced: Math.abs(debit - credit) < 0.05 };
};

export const getAvailableStatements = async (payerType?: string): Promise<SettlementStatementSummary[]> => {
  const connection = await getRepstmConnection();
  try {
  await ensureRepstmTables();

  let whereClause = "WHERE statement_no IS NOT NULL AND statement_no != ''";
  const params: unknown[] = [];

  if (payerType && payerType !== 'ALL') {
    if (payerType === 'NHSO') {
      whereClause += " AND filefrom = 'NHSO'";
    } else if (payerType === 'OFC') {
      whereClause += " AND (filefrom = 'OFC' OR filefrom = 'CSCD' OR filename LIKE '%OFC%' OR filename LIKE '%CSCD%')";
    } else if (payerType === 'LGO') {
      whereClause += " AND (filefrom = 'LGO' OR filename LIKE '%LGO%')";
    } else if (payerType === 'SSS') {
      whereClause += " AND (filefrom = 'SSS' OR filename LIKE '%SSS%')";
    }
  }

  const [rows] = await connection.query(
    `SELECT 
       statement_no,
       data_type,
       filefrom,
       COUNT(*) AS record_count,
       ROUND(SUM(COALESCE(paid_amount, amount, 0)), 2) AS total_paid_amount,
       ROUND(SUM(COALESCE(invoice_amount, 0)), 2) AS total_invoice_amount,
       DATE_FORMAT(MIN(service_datetime), '%Y-%m-%d') AS min_service_date,
       DATE_FORMAT(MAX(service_datetime), '%Y-%m-%d') AS max_service_date,
       MAX(filename) AS filename,
       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i') AS imported_at
     FROM repstm_statement_data
     ${whereClause}
     GROUP BY statement_no, data_type, filefrom
     ORDER BY MAX(created_at) DESC
     LIMIT 100`,
    params
  );

  return (rows as any[]).map((r) => ({
    statement_no: String(r.statement_no || ''),
    data_type: String(r.data_type || 'STM'),
    filefrom: String(r.filefrom || 'NHSO'),
    record_count: Number(r.record_count || 0),
    total_paid_amount: Number(r.total_paid_amount || 0),
    total_invoice_amount: Number(r.total_invoice_amount || 0),
    min_service_date: r.min_service_date ? String(r.min_service_date) : null,
    max_service_date: r.max_service_date ? String(r.max_service_date) : null,
    filename: String(r.filename || ''),
    imported_at: String(r.imported_at || ''),
  }));
  } finally {
    connection.release();
  }
};

export const getStatementSettlementCandidates = async (
  statementNo: string, existingConnection?: PoolConnection
): Promise<SettlementCandidateResult> => {
  const connection = existingConnection || await getRepstmConnection();
  try {
  if (!existingConnection) await ensureRepstmTables();

  const [rawRows] = await connection.query(
    `SELECT
       id,
       data_type,
       statement_no,
       tran_id,
       hn,
       vn,
       an,
       pid,
       patient_name,
       patient_type,
       department,
       DATE_FORMAT(service_datetime, '%Y-%m-%d') AS service_date,
       maininscl,
       subinscl,
       errorcode,
       verifycode,
       COALESCE(amount, 0) AS amount,
       paid_amount,
       COALESCE(invoice_amount, 0) AS invoice_amount,
       filename
     FROM repstm_statement_data
     WHERE statement_no = ? AND data_type IN ('STM', 'INV')
       AND NOT EXISTS (SELECT 1 FROM repstm_import_batch replacement WHERE replacement.replaces_batch_id = repstm_statement_data.batch_id)
     ORDER BY id ASC`,
    [statementNo]
  );

  const rows = rawRows as any[];
  const items: SettlementCandidateItem[] = [];
  const settledMap = new Map<number, string>();
  if (rows.length) {
    const [settledRows] = await connection.query(
      `SELECT i.statement_record_id, b.settlement_no FROM receivable_settlement_item i
       JOIN receivable_settlement_batch b ON b.id = i.settlement_batch_id
       WHERE i.statement_record_id IN (${rows.map(() => '?').join(',')})`,
      rows.map(r => Number(r.id))
    );
    for (const s of (settledRows as any[]) || []) settledMap.set(Number(s.statement_record_id), String(s.settlement_no || ''));
  }

  let totalClaimable = 0;
  let totalReceived = 0;
  let totalDiff = 0;
  let totalDisallowance = 0;
  let totalOverpay = 0;

  for (const r of rows) {
    const isIpd = Boolean(r.an && String(r.an).trim() !== '') || String(r.patient_type || '').toUpperCase() === 'IPD';
    const patientType = isIpd ? 'IPD' : 'OPD';
    const mapping = findRightMapping(r.maininscl || r.subinscl, undefined);

    const debtorCode = isIpd
      ? (mapping?.debtor_ipd || '')
      : (mapping?.debtor_opd || '');
    const revenueCode = isIpd
      ? (mapping?.revenue_ipd || '')
      : (mapping?.revenue_opd || '');

    const invAmount = Number(r.invoice_amount || 0);
    const rawAmount = Number(r.amount || 0);
    const paidAmount = Number(r.paid_amount || 0);

    // Billed/claimable amount: use invoice_amount if > 0, else amount, else paidAmount
    const claimableAmount = invAmount > 0 ? invAmount : (rawAmount > 0 ? rawAmount : paidAmount);
    const diffAmount = Number((paidAmount - claimableAmount).toFixed(2));

    let settleAction: 'full' | 'partial' | 'writeoff_diff' | 'hold_appeal' = 'full';
    if (diffAmount < 0) {
      settleAction = paidAmount > 0 ? 'writeoff_diff' : 'hold_appeal';
    } else if (diffAmount > 0) {
      settleAction = 'full';
    }

    if (diffAmount < 0) {
      totalDisallowance += Math.abs(diffAmount);
    } else if (diffAmount > 0) {
      totalOverpay += diffAmount;
    }

    totalClaimable += claimableAmount;
    totalReceived += paidAmount;
    totalDiff += diffAmount;

    items.push({
      id: Number(r.id),
      statement_no: String(r.statement_no || ''),
      tran_id: r.tran_id ? String(r.tran_id) : null,
      hn: r.hn ? String(r.hn) : null,
      vn: r.vn ? String(r.vn) : null,
      an: r.an ? String(r.an) : null,
      cid: r.pid ? String(r.pid) : null,
      patient_name: r.patient_name ? String(r.patient_name) : null,
      patient_type: patientType,
      service_date: r.service_date ? String(r.service_date) : null,
      maininscl: r.maininscl ? String(r.maininscl) : null,
      subinscl: r.subinscl ? String(r.subinscl) : null,
      errorcode: r.errorcode ? String(r.errorcode) : null,
      verifycode: r.verifycode ? String(r.verifycode) : null,
      debtor_code: debtorCode,
      revenue_code: revenueCode,
      claimable_amount: claimableAmount,
      paid_amount: paidAmount,
      payment_known: r.paid_amount != null,
      mapping_known: Boolean(debtorCode && revenueCode),
      diff_amount: diffAmount,
      settle_action: settleAction,
    });
    const pushed = items[items.length - 1];
    pushed.match_level = classifyMatchLevel(pushed);
    pushed.already_settled = settledMap.has(pushed.id);
    pushed.settled_no = settledMap.get(pushed.id) || null;
  }

  totalClaimable = Number(totalClaimable.toFixed(2));
  totalReceived = Number(totalReceived.toFixed(2));
  totalDiff = Number(totalDiff.toFixed(2));
  totalDisallowance = Number(totalDisallowance.toFixed(2));
  totalOverpay = Number(totalOverpay.toFixed(2));

  // Build GL Journal Preview according to MOPH accounting rules (GFMIS)
  const { entries: journalEntries, isBalanced } = buildSettlementJournal(items);

  return {
    statement_no: statementNo,
    payer_type: rows[0]?.filefrom || 'NHSO',
    total_cases: items.length,
    total_claimable: totalClaimable,
    total_received: totalReceived,
    total_diff: totalDiff,
    total_disallowance: totalDisallowance,
    total_overpay: totalOverpay,
    items,
    journal_entries: journalEntries,
    is_balanced: isBalanced,
  };
  } finally {
    if (!existingConnection) connection.release();
  }
};

export function validateSettlementPayload(payload: ExecuteSettlementPayload) {
  const transferDate = String(payload.transfer_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate) || !Number.isFinite(Date.parse(transferDate)) || new Date(transferDate).toISOString().slice(0, 10) !== transferDate) throw new Error('วันที่โอนเงินไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)');
  const requests = Array.isArray(payload.items) ? payload.items : [];
  if (!requests.length) throw new Error('กรุณาเลือกรายการที่ต้องการตัดลูกหนี้อย่างน้อย 1 รายการ');
  if (requests.length > 2000) throw new Error('บันทึกได้ครั้งละไม่เกิน 2,000 รายการ');
  const ids = requests.map(item => Number(item.statement_record_id));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new Error('รหัสรายการต้นทางไม่ถูกต้องหรือมีรายการซ้ำ');
  if (!String(payload.statement_no || '').trim()) throw new Error('กรุณาระบุ Statement ต้นทาง');
  return { transferDate, requests, ids };
}

type SettlementDependencies = {
  getConnection: typeof getRepstmConnection;
  ensureTables: typeof ensureRepstmTables;
  getCandidates: typeof getStatementSettlementCandidates;
};
export const executeSettlement = async (payload: ExecuteSettlementPayload, actor = '', dependencies: SettlementDependencies = { getConnection: getRepstmConnection, ensureTables: ensureRepstmTables, getCandidates: getStatementSettlementCandidates }) => {
  const { transferDate, requests, ids } = validateSettlementPayload(payload);
  if (!actor.trim() || actor.length > 128) throw new Error('ไม่พบผู้บันทึกจากการเข้าสู่ระบบ');
  await dependencies.ensureTables();
  const connection = await dependencies.getConnection();
  let inTransaction = false; let locked = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK('FDH_SETTLEMENT_WRITE', 15) AS acquired");
    if (Number((lockRows as Array<{ acquired: number }>)[0]?.acquired) !== 1) throw new Error('มีการบันทึกตัดลูกหนี้อยู่ กรุณาลองใหม่');
    locked = true;
    await connection.beginTransaction(); inTransaction = true;
    await connection.query('SELECT id FROM repstm_statement_data WHERE id IN (' + ids.map(() => '?').join(',') + ') FOR UPDATE', ids);
    const candidates = await dependencies.getCandidates(payload.statement_no, connection);
    const items = requests.map(request => {
      const candidate = candidates.items.find(item => item.id === Number(request.statement_record_id));
      if (candidate?.mapping_known === false) throw new Error('ยังยืนยันบัญชีลูกหนี้และรายได้ไม่ได้ กรุณาตรวจ mapping สิทธิ์กับฝ่ายการเงิน');
      if (!candidate || candidate.payment_known === false) throw new Error('รายการต้นทางเปลี่ยนแปลงหรือยังไม่ทราบยอดจ่าย กรุณาโหลดใหม่');
      for (const key of ['claimable_amount', 'paid_amount', 'diff_amount'] as const) {
        if (!Number.isFinite(candidate[key]) || (key !== 'diff_amount' && candidate[key] < 0)) throw new Error('ยอดต้นทางไม่ถูกต้อง');
        if (request[key] != null && (!Number.isFinite(Number(request[key])) || Math.abs(Number(request[key]) - candidate[key]) > 0.005)) throw new Error('ยอดต้นทางเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนบันทึก');
      }
      const action = request.settle_action || candidate.settle_action;
      if (!['full', 'partial', 'writeoff_diff'].includes(action)) throw new Error('รายการรอทักท้วงยังไม่สามารถตัดลูกหนี้ได้');
      return { ...candidate, statement_record_id: candidate.id, pttype: candidate.maininscl, hipdata_code: candidate.maininscl, error_code: candidate.errorcode, settle_action: action, notes: String(request.notes || '').slice(0,255) };
    });
    const [priorRows] = await connection.query(
      "SELECT b.id AS batch_id, b.settlement_no, DATE_FORMAT(b.transfer_date, '%Y-%m-%d') AS transfer_date, b.payer_type, b.bank_account, b.total_claimable, b.total_received, b.total_diff, i.statement_record_id FROM receivable_settlement_item i JOIN receivable_settlement_batch b ON b.id = i.settlement_batch_id WHERE i.statement_record_id IN (" + ids.map(() => '?').join(',') + ')', ids);
    const prior = priorRows as Array<Record<string, unknown>>;
    if (prior.length) {
      const first = prior[0];
      const [allItems] = await connection.query('SELECT statement_record_id FROM receivable_settlement_item WHERE settlement_batch_id = ?', [first.batch_id]);
      const same = prior.length === ids.length && prior.every(row => row.batch_id === first.batch_id)
        && (allItems as unknown[]).length === ids.length && first.transfer_date === transferDate
        && String(first.payer_type) === String(payload.payer_type || 'NHSO') && String(first.bank_account || '') === String(payload.bank_account || 'ธนาคารกรุงไทย (บัญชีเงินบำรุงโรงพยาบาล)');
      if (!same) throw new Error('มีรายการที่ถูกตัดลูกหนี้แล้ว กรุณาโหลดใหม่');
      await connection.rollback(); inTransaction = false;
      return { success: true, duplicate: true, batch_id: Number(first.batch_id), settlement_no: String(first.settlement_no), item_count: ids.length, total_claimable: Number(first.total_claimable), total_received: Number(first.total_received), total_diff: Number(first.total_diff) };
    }
    const yymm = transferDate.slice(0, 7).replace('-', '');
    const [lastRows] = await connection.query("SELECT MAX(CAST(SUBSTRING_INDEX(settlement_no, '-', -1) AS UNSIGNED)) AS last_no FROM receivable_settlement_batch WHERE settlement_no LIKE ?", ['STL-' + yymm + '-%']);
    const seq = (Number((lastRows as Array<{ last_no: number }>)[0]?.last_no || 0) + 1).toString().padStart(4, '0');
    const settlementNo = 'STL-' + yymm + '-' + seq;

  let totalClaimable = 0;
  let totalReceived = 0;
  let totalDiff = 0;
  let totalDisallowance = 0;
  let totalOverpay = 0;

  for (const item of items) {
    const claimable = Number(item.claimable_amount || 0);
    const paid = Number(item.paid_amount || 0);
    const diff = Number(item.diff_amount || 0);

    totalClaimable += claimable;
    totalReceived += paid;
    totalDiff += diff;

    if (diff < 0) totalDisallowance += Math.abs(diff);
    else if (diff > 0) totalOverpay += diff;
  }

  totalClaimable = Number(totalClaimable.toFixed(2));
  totalReceived = Number(totalReceived.toFixed(2));
  totalDiff = Number(totalDiff.toFixed(2));
  totalDisallowance = Number(totalDisallowance.toFixed(2));
  totalOverpay = Number(totalOverpay.toFixed(2));

  // Compute Journal summary payload (same builder as preview; credit debtors per mapping account)
  const journalPayload = buildSettlementJournal(items).entries;

  // Insert batch
  const [batchResult] = await connection.query(
    `INSERT INTO receivable_settlement_batch (
       settlement_no, payer_type, statement_no, transfer_date, bank_account,
       total_claimable, total_received, total_diff, total_disallowance, total_overpay,
       item_count, created_by, notes, journal_payload
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      settlementNo,
      payload.payer_type || 'NHSO',
      payload.statement_no || '',
      transferDate,
      payload.bank_account || 'ธนาคารกรุงไทย (บัญชีเงินบำรุงโรงพยาบาล)',
      totalClaimable,
      totalReceived,
      totalDiff,
      totalDisallowance,
      totalOverpay,
      items.length,
      actor,
      payload.notes || null,
      JSON.stringify(journalPayload),
    ]
  );

  const batchId = (batchResult as any).insertId;

  // Insert items in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const values = chunk.map((item) => [
      batchId,
      item.patient_type || 'OPD',
      item.vn || null,
      item.an || null,
      item.hn || null,
      item.cid || null,
      item.patient_name || null,
      item.service_date ? String(item.service_date).slice(0, 10) : null,
      item.pttype || null,
      null,
      item.hipdata_code || null,
      item.debtor_code || null,
      item.revenue_code || null,
      Number(item.claimable_amount || 0),
      Number(item.paid_amount || 0),
      Number(item.diff_amount || 0),
      item.settle_action || 'full',
      item.error_code || null,
      item.statement_record_id || null,
      item.notes || null,
    ]);

    await connection.query(
      `INSERT INTO receivable_settlement_item (
         settlement_batch_id, patient_type, vn, an, hn, cid, patient_name,
         service_date, pttype, pttype_name, hipdata_code, debtor_code, revenue_code,
         claimable_amount, paid_amount, diff_amount, settle_action, error_code,
         statement_record_id, notes
       ) VALUES ?`,
      [values]
    );
  }

  await connection.commit();
  inTransaction = false;
  return {
    success: true,
    batch_id: batchId,
    settlement_no: settlementNo,
    item_count: items.length,
    total_claimable: totalClaimable,
    total_received: totalReceived,
    total_diff: totalDiff,
  };
  } catch (error) {
    if (inTransaction) await connection.rollback();
    throw error;
  } finally {
    let reusable = true;
    try { if (locked) await connection.query("SELECT RELEASE_LOCK('FDH_SETTLEMENT_WRITE')"); }
    catch { reusable = false; connection.destroy(); }
    finally { if (reusable) connection.release(); }
  }
};

export const getSettlementHistory = async (limit = 50) => {
  const connection = await getRepstmConnection();
  try {
  await ensureRepstmTables();

  const [rows] = await connection.query(
    `SELECT
       id,
       settlement_no,
       payer_type,
       statement_no,
       DATE_FORMAT(transfer_date, '%Y-%m-%d') AS transfer_date,
       bank_account,
       total_claimable,
       total_received,
       total_diff,
       total_disallowance,
       total_overpay,
       item_count,
       created_by,
       notes,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at
     FROM receivable_settlement_batch
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  );

  return rows as any[];
  } finally {
    connection.release();
  }
};

export const getSettlementVoucher = async (batchId: number) => {
  const connection = await getRepstmConnection();
  try {
  await ensureRepstmTables();

  const [batchRows] = await connection.query(
    `SELECT
       id,
       settlement_no,
       payer_type,
       statement_no,
       DATE_FORMAT(transfer_date, '%Y-%m-%d') AS transfer_date,
       bank_account,
       total_claimable,
       total_received,
       total_diff,
       total_disallowance,
       total_overpay,
       item_count,
       created_by,
       notes,
       journal_payload,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at
     FROM receivable_settlement_batch
     WHERE id = ?`,
    [batchId]
  );

  const batch = (batchRows as any[])[0];
  if (!batch) {
    throw new Error(`ไม่พบใบสำคัญตัดลูกหนี้รหัส ${batchId}`);
  }

  const [itemRows] = await connection.query(
    `SELECT
       id,
       patient_type,
       vn,
       an,
       hn,
       cid,
       patient_name,
       DATE_FORMAT(service_date, '%Y-%m-%d') AS service_date,
       pttype,
       pttype_name,
       hipdata_code,
       debtor_code,
       revenue_code,
       claimable_amount,
       paid_amount,
       diff_amount,
       settle_action,
       error_code,
       notes
     FROM receivable_settlement_item
     WHERE settlement_batch_id = ?
     ORDER BY id ASC`,
    [batchId]
  );

  const hospitalConnection = await getUTFConnection();
  let hospital;
  try {
    const identity = await readHospitalIdentity(hospitalConnection);
    hospital = {
      hospital_code: identity.hospital_code || businessRules.site_settings.hospital_code,
      hospital_name: identity.hospital_name || businessRules.site_settings.hospital_name,
    };
  } finally {
    hospitalConnection.release();
  }

  let journalEntries: SettlementJournalEntry[] = [];
  try {
    if (batch.journal_payload) {
      journalEntries = typeof batch.journal_payload === 'string'
        ? JSON.parse(batch.journal_payload)
        : batch.journal_payload;
    }
  } catch {
    journalEntries = [];
  }

  return {
    batch: {
      ...batch,
      journal_entries: journalEntries,
    },
    items: itemRows as any[],
    hospital,
  };
  } finally {
    connection.release();
  }
};
