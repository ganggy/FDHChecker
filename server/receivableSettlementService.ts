import { getRepstmConnection } from './db/connection.js';
import { ensureRepstmTables } from './db/schema.js';
import { RECEIVABLE_RIGHT_MAPPINGS, type ReceivableRightMapping } from './receivableMapping.js';
import businessRules from './config/business_rules.json';

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
  diff_amount: number;
  settle_action: 'full' | 'partial' | 'writeoff_diff' | 'hold_appeal';
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

const findRightMapping = (hipdataCode?: string | null, pttype?: string | null): ReceivableRightMapping | undefined => {
  if (pttype) {
    const match = RECEIVABLE_RIGHT_MAPPINGS.find((m) => m.hosxp_code === pttype);
    if (match) return match;
  }
  if (hipdataCode) {
    const normalized = hipdataCode.trim().toUpperCase();
    const match = RECEIVABLE_RIGHT_MAPPINGS.find((m) => m.hipdata_code === normalized);
    if (match) return match;
  }
  return undefined;
};

export const getAvailableStatements = async (payerType?: string): Promise<SettlementStatementSummary[]> => {
  const connection = await getRepstmConnection();
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
};

export const getStatementSettlementCandidates = async (
  statementNo: string
): Promise<SettlementCandidateResult> => {
  const connection = await getRepstmConnection();
  await ensureRepstmTables();

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
       COALESCE(paid_amount, 0) AS paid_amount,
       COALESCE(invoice_amount, 0) AS invoice_amount,
       filename
     FROM repstm_statement_data
     WHERE statement_no = ?
     ORDER BY id ASC`,
    [statementNo]
  );

  const rows = rawRows as any[];
  const items: SettlementCandidateItem[] = [];

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
      ? (mapping?.debtor_ipd || '1102050101.202')
      : (mapping?.debtor_opd || '1102050101.201');
    const revenueCode = isIpd
      ? (mapping?.revenue_ipd || '4301020105.202')
      : (mapping?.revenue_opd || '4301020105.201');

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
      diff_amount: diffAmount,
      settle_action: settleAction,
    });
  }

  totalClaimable = Number(totalClaimable.toFixed(2));
  totalReceived = Number(totalReceived.toFixed(2));
  totalDiff = Number(totalDiff.toFixed(2));
  totalDisallowance = Number(totalDisallowance.toFixed(2));
  totalOverpay = Number(totalOverpay.toFixed(2));

  // Build GL Journal Preview according to MOPH accounting rules (GFMIS)
  const journalEntries: SettlementJournalEntry[] = [
    {
      type: 'DEBIT',
      account_code: '1101010104.101',
      account_name: 'เงินฝากธนาคารในงบประมาณ/เงินบำรุง',
      amount: totalReceived,
    },
  ];

  if (totalDisallowance > 0) {
    journalEntries.push({
      type: 'DEBIT',
      account_code: '5103010102.101',
      account_name: 'ค่ารักษาพยาบาลต่ำกว่าเกณฑ์/ส่วนลดจ่าย',
      amount: totalDisallowance,
    });
  }

  journalEntries.push({
    type: 'CREDIT',
    account_code: '1102050101.201',
    account_name: 'ลูกหนี้ค่ารักษาพยาบาล สปสช./กองทุน',
    amount: totalClaimable,
  });

  if (totalOverpay > 0) {
    journalEntries.push({
      type: 'CREDIT',
      account_code: '4301020105.101',
      account_name: 'รายได้ค่ารักษาพยาบาลสูงกว่าเกณฑ์/เงินชดเชยเพิ่ม',
      amount: totalOverpay,
    });
  }

  const totalDebit = journalEntries
    .filter((e) => e.type === 'DEBIT')
    .reduce((sum, e) => sum + e.amount, 0);
  const totalCredit = journalEntries
    .filter((e) => e.type === 'CREDIT')
    .reduce((sum, e) => sum + e.amount, 0);

  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.05;

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
};

export const executeSettlement = async (payload: ExecuteSettlementPayload) => {
  const connection = await getRepstmConnection();
  await ensureRepstmTables();

  const transferDate = String(payload.transfer_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
    throw new Error('วันที่โอนเงินไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)');
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw new Error('กรุณาเลือกรายการที่ต้องการตัดลูกหนี้อย่างน้อย 1 รายการ');
  }

  // Generate settlement number STL-YYYYMM-XXXX
  const yymm = transferDate.slice(0, 7).replace('-', '');
  const [countRows] = await connection.query(
    'SELECT COUNT(*) AS total FROM receivable_settlement_batch WHERE settlement_no LIKE ?',
    [`STL-${yymm}-%`]
  );
  const seq = (Number((countRows as any[])[0]?.total || 0) + 1).toString().padStart(4, '0');
  const settlementNo = `STL-${yymm}-${seq}`;

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

  // Compute Journal summary payload
  const journalPayload = [
    { type: 'DEBIT', account_code: '1101010104.101', account_name: 'เงินฝากธนาคารในงบประมาณ/เงินบำรุง', amount: totalReceived },
    ...(totalDisallowance > 0 ? [{ type: 'DEBIT', account_code: '5103010102.101', account_name: 'ค่ารักษาพยาบาลต่ำกว่าเกณฑ์/ส่วนลดจ่าย', amount: totalDisallowance }] : []),
    { type: 'CREDIT', account_code: '1102050101.201', account_name: 'ลูกหนี้ค่ารักษาพยาบาล สปสช./กองทุน', amount: totalClaimable },
    ...(totalOverpay > 0 ? [{ type: 'CREDIT', account_code: '4301020105.101', account_name: 'รายได้ค่ารักษาพยาบาลสูงกว่าเกณฑ์/เงินชดเชยเพิ่ม', amount: totalOverpay }] : []),
  ];

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
      payload.created_by || 'เจ้าหน้าที่การเงิน',
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
      item.pttype_name || null,
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

  return {
    success: true,
    batch_id: batchId,
    settlement_no: settlementNo,
    item_count: items.length,
    total_claimable: totalClaimable,
    total_received: totalReceived,
    total_diff: totalDiff,
  };
};

export const getSettlementHistory = async (limit = 50) => {
  const connection = await getRepstmConnection();
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
};

export const getSettlementVoucher = async (batchId: number) => {
  const connection = await getRepstmConnection();
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

  const hospital = {
    hospital_code: businessRules.site_settings.hospital_code || '10698',
    hospital_name: businessRules.site_settings.hospital_name || 'โรงพยาบาลโคกศรีสุพรรณ',
  };

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
};
