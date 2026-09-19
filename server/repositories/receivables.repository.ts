import businessRules from '../config/business_rules.json';
import {
  normalizeImportCellValue,
  parseFlexibleDateTime,
  formatTrackingDateTime,
  latestTrackingDateTime,
} from '../utils/dataNormalization.js';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { getUTFConnection, getRepstmConnection, repstmConfig, repstmPool, repstmDatabaseName } from '../db/connection.js';
import {
  ensureRepstmTables,
  ensureFdhClaimStatusTable,
  ensureNhsoClosePrivilegeTable,
  REP_DATA_TABLE_SQL,
  REP_DATA_VERIFY_TABLE_SQL,
  REPSTM_STATEMENT_DATA_TABLE_SQL,
  FDH_CLAIM_DETAIL_BATCH_TABLE_SQL,
  FDH_CLAIM_DETAIL_ROW_TABLE_SQL,
  RECEIVABLE_BATCH_TABLE_SQL,
  RECEIVABLE_ITEM_TABLE_SQL,
} from '../db/schema.js';
import { RECEIVABLE_RIGHT_MAPPINGS, type ReceivableRightMapping } from '../receivableMapping.js';
import { resolveStatementVisitKeys } from '../repstmVisitKeys.js';
import { mergeFdhClaimDetails } from '../fdhClaimDetailMerge.js';
import { activeHospitalDatabaseConfig, rethrowHospitalDatabaseError, type HospitalConnection } from '../hospitalDatabase.js';


const normalizeCitizenId = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  return digits.length === 13 ? digits : '';
};

const pickRowValue = (row: Record<string, unknown>, candidates: string[]) => {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.trim().toLowerCase() === candidate.trim().toLowerCase());
    if (found) return normalizeImportCellValue(found[1]);
  }
  return '';
};

const toAmountValue = (value: string): number | null => {
  if (!value) return null;
  const cleaned = value.replace(/,/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const buildRowsHash = (scope: string, rows: Record<string, unknown>[]) => {
  const serializedRows = rows.map((row) => {
    const normalizedEntries = Object.entries(row).map(([key, value]) => [key.trim(), normalizeImportCellValue(value)]);
    return stableStringify(Object.fromEntries(normalizedEntries.sort(([a], [b]) => a.localeCompare(b))));
  }).sort((a, b) => a.localeCompare(b));
  const normalizedRows = serializedRows.map((row) => JSON.parse(row) as Record<string, string>);
  const payload = stableStringify({ scope, rowCount: normalizedRows.length, rows: normalizedRows });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
};

const buildBatchHash = (dataType: 'REP' | 'STM' | 'INV', rows: Record<string, unknown>[]) => buildRowsHash(dataType, rows);

const normalizeLookupKey = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[._\-\\/()[\]{}:%]/g, '');

const pickRowValueAdvanced = (row: Record<string, unknown>, candidates: string[]) => {
  const entries = Object.entries(row).map(([key, value]) => ({
    key,
    normalizedKey: normalizeLookupKey(key),
    value: normalizeImportCellValue(value),
  }));

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeLookupKey(candidate);
    const exact = entries.find((entry) => entry.normalizedKey === normalizedCandidate);
    if (exact?.value) return exact.value;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeLookupKey(candidate);
    const fuzzy = entries.find((entry) => entry.normalizedKey.includes(normalizedCandidate));
    if (fuzzy?.value) return fuzzy.value;
  }

  return '';
};

type RepstmDataType = 'REP' | 'STM' | 'INV';

type ImportCompletenessProfile = {
  logicalHash: string;
  rowCount: number;
  distinctRecordCount: number;
  columnCount: number;
  nonEmptyCellCount: number;
  completenessScore: number;
  rowIdentities: Set<string>;
};

type RepstmImportDecision =
  | { action: 'import' }
  | { action: 'skip'; batchId: number; rowCount: number; message: string }
  | { action: 'replace'; batchId: number; rowCount: number; message: string };

const hashText = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const normalizeLogicalToken = (value: unknown) => normalizeImportCellValue(value)
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeLogicalAmount = (value: string) => {
  const amount = toAmountValue(value);
  return amount == null ? '' : amount.toFixed(2);
};

const normalizeLogicalDateToken = (value: string) => {
  const text = value.trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year > 2400) year -= 543;
    return `${String(year).padStart(4, '0')}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return text.toLowerCase();
};

const buildLogicalRowIdentity = (
  dataType: RepstmDataType,
  row: Record<string, unknown>,
  rowIndex: number
) => {
  const tranId = normalizeLogicalToken(pickRowValueAdvanced(row, ['TRAN_ID', 'transaction_uid', 'tranid']));
  const repNo = normalizeLogicalToken(pickRowValueAdvanced(row, ['REP No.', 'REP No', 'REP']));
  const statementNo = normalizeLogicalToken(pickRowValueAdvanced(row, [
    'STM No.', 'STM No', 'STM',
    'INV No.', 'INV No', 'INV',
    'invoice_no', 'เลขที่เอกสาร', 'เลขที่ใบแจ้งหนี้', 'document_no', 'docno'
  ]));
  const seqNo = normalizeLogicalToken(pickRowValueAdvanced(row, ['SEQ NO', 'SEQ_NO', 'SEQNO', 'SEQ', 'VN', 'visit_no', 'ลำดับที่', 'no']));
  const hcode = normalizeLogicalToken(pickRowValueAdvanced(row, ['HOSPCODE', 'hcode']));
  const hn = normalizeLogicalToken(pickRowValueAdvanced(row, ['HN']));
  const an = normalizeLogicalToken(pickRowValueAdvanced(row, ['AN']));
  const cid = normalizeCitizenId(pickRowValueAdvanced(row, ['PID', 'CID', 'เลขบัตรประชาชน']));
  const serviceDate = normalizeLogicalDateToken(pickRowValueAdvanced(row, [
    'วันเข้ารักษา', 'admdate', 'service_datetime', 'service_date', 'date_serv', 'วันที่รับบริการ', 'วันที่'
  ]));
  const amount = normalizeLogicalAmount(pickRowValueAdvanced(row, [
    'ชดเชยสุทธิ', 'compensated', 'ชดเชยสุทธิรวม',
    'amount', 'total', 'paid', 'paid_amount', 'ยอดชำระ', 'ยอดเงิน', 'จำนวนเงิน', 'sum_amount'
  ]));

  if (tranId) return `${dataType}:tran:${tranId}`;
  if (dataType === 'REP' && (repNo || seqNo || hn || an || cid)) {
    return [dataType, repNo, seqNo, hcode, hn, an, cid, serviceDate, amount].join('|');
  }
  if ((dataType === 'STM' || dataType === 'INV') && (statementNo || seqNo || hn || an || cid)) {
    return [dataType, statementNo, seqNo, hcode, hn, an, cid, serviceDate, amount].join('|');
  }

  const normalizedEntries = Object.entries(row)
    .map(([key, value]) => [normalizeLookupKey(key), normalizeImportCellValue(value)] as const)
    .filter(([, value]) => value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  if (normalizedEntries.length === 0) return `${dataType}:blank:${rowIndex}`;
  return `${dataType}:row:${hashText(stableStringify(normalizedEntries))}`;
};

const buildImportCompletenessProfile = (
  dataType: RepstmDataType,
  rows: Record<string, unknown>[]
): ImportCompletenessProfile => {
  const rowIdentities = rows.map((row, index) => hashText(buildLogicalRowIdentity(dataType, row, index)));
  const distinctIdentities = new Set(rowIdentities);
  const columnSet = new Set<string>();
  let nonEmptyCellCount = 0;

  rows.forEach((row) => {
    Object.entries(row).forEach(([key, value]) => {
      const normalizedKey = normalizeLookupKey(key);
      if (normalizedKey) columnSet.add(normalizedKey);
      if (normalizeImportCellValue(value) !== '') nonEmptyCellCount += 1;
    });
  });

  const sortedIdentities = [...rowIdentities].sort();
  const logicalHash = hashText(stableStringify({ scope: dataType, identities: sortedIdentities }));
  const distinctRecordCount = distinctIdentities.size;
  const rowCount = rows.length;
  const columnCount = columnSet.size;
  const completenessScore = (distinctRecordCount * 1_000_000_000)
    + (rowCount * 1_000_000)
    + (nonEmptyCellCount * 100)
    + columnCount;

  return {
    logicalHash,
    rowCount,
    distinctRecordCount,
    columnCount,
    nonEmptyCellCount,
    completenessScore,
    rowIdentities: distinctIdentities,
  };
};

const deduplicateRepstmRows = (
  dataType: RepstmDataType,
  rows: Record<string, unknown>[]
) => {
  const uniqueRows = new Map<string, { row: Record<string, unknown>; score: number; order: number }>();
  rows.forEach((row, index) => {
    const identity = hashText(buildLogicalRowIdentity(dataType, row, index));
    const score = Object.values(row).filter((value) => normalizeImportCellValue(value) !== '').length;
    const current = uniqueRows.get(identity);
    if (!current || score > current.score) {
      uniqueRows.set(identity, { row, score, order: current?.order ?? index });
    }
  });
  return Array.from(uniqueRows.values())
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.row);
};

const isIdentitySuperset = (candidate: Set<string>, required: Set<string>) => {
  for (const identity of required) {
    if (!candidate.has(identity)) return false;
  }
  return true;
};

const parseImportRawData = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return parseImportRawData(value.toString('utf8'));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
};

type LegacyStatementAmountRepairSummary = {
  scanned: number;
  updated: number;
};

let legacyStatementAmountRepairComplete = false;
let legacyStatementAmountRepairPromise: Promise<LegacyStatementAmountRepairSummary> | null = null;

const runLegacyStatementAmountRepair = async (): Promise<LegacyStatementAmountRepairSummary> => {
  const connection = await getRepstmConnection();
  const summary: LegacyStatementAmountRepairSummary = { scanned: 0, updated: 0 };
  const batchSize = 1000;
  let lastId = 0;

  try {
    while (true) {
      const [rows] = await connection.query(
        `SELECT id, data_type, amount, paid_amount, invoice_amount, raw_data
         FROM repstm_statement_data
         WHERE id > ?
           AND data_type IN ('STM', 'INV')
           AND (
             amount IS NULL
             OR paid_amount IS NULL
             OR (data_type = 'INV' AND invoice_amount IS NULL)
           )
         ORDER BY id
         LIMIT ?`,
        [lastId, batchSize]
      );
      const batch = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
      if (batch.length === 0) break;

      summary.scanned += batch.length;
      lastId = Number(batch[batch.length - 1].id || lastId);
      const repairs: Array<{ id: number; amount: number | null; paidAmount: number | null; invoiceAmount: number | null }> = [];

      for (const row of batch) {
        const raw = parseImportRawData(row.raw_data);
        if (!raw) continue;
        const dataType = String(row.data_type || '').toUpperCase();
        const paymentCandidates = dataType === 'INV'
          ? [
              'ชดเชยสุทธิ', 'ยอดรับสุทธิ', 'ยอดเงินสุทธิ', 'ยอดชดเชยหลังหักเงินเดือน',
              'ยอดชดเชยทั้งสิ้น', 'จ่ายชดเชย', 'พึงรับทั้งหมด', 'พึงรับ', 'amount',
            ]
          : [
              'ยอดชดเชยทั้งสิ้น', 'ยอดชดเชยสุทธิ', 'จ่ายชดเชยหลังหัก พรบ.และเงินเดือน',
              'ยอดชดเชยหลังหักเงินเดือน', 'พึงรับทั้งหมด', 'พึงรับ', 'จ่ายชดเชย', 'ยอดเงิน', 'amount',
            ];
        const paymentAmount = toAmountValue(pickRowValueAdvanced(raw, paymentCandidates));
        const invoiceAmount = dataType === 'INV'
          ? toAmountValue(pickRowValueAdvanced(raw, ['ยอดเรียกเก็บ', 'เรียกเก็บ (1)', 'เรียกเก็บ', 'invoice_amount', 'inv_amount']))
          : null;
        const nextAmount = row.amount == null ? paymentAmount : null;
        const nextPaidAmount = row.paid_amount == null ? paymentAmount : null;
        const nextInvoiceAmount = dataType === 'INV' && row.invoice_amount == null ? invoiceAmount : null;
        if (nextAmount == null && nextPaidAmount == null && nextInvoiceAmount == null) continue;
        repairs.push({
          id: Number(row.id),
          amount: nextAmount,
          paidAmount: nextPaidAmount,
          invoiceAmount: nextInvoiceAmount,
        });
      }

      if (repairs.length > 0) {
        const derivedRows = repairs.map(() =>
          'SELECT CAST(? AS UNSIGNED) AS id, CAST(? AS DECIMAL(15,2)) AS amount, CAST(? AS DECIMAL(15,2)) AS paid_amount, CAST(? AS DECIMAL(15,2)) AS invoice_amount'
        ).join(' UNION ALL ');
        const params = repairs.flatMap((repair) => [repair.id, repair.amount, repair.paidAmount, repair.invoiceAmount]);
        const [result] = await connection.query(
          `UPDATE repstm_statement_data s
           JOIN (${derivedRows}) repair ON repair.id = s.id
           SET s.amount = COALESCE(s.amount, repair.amount),
               s.paid_amount = COALESCE(s.paid_amount, repair.paid_amount),
               s.invoice_amount = COALESCE(s.invoice_amount, repair.invoice_amount)`,
          params
        );
        summary.updated += Number((result as mysql.ResultSetHeader).affectedRows || 0);
      }
    }
    return summary;
  } finally {
    connection.release();
  }
};

export const repairLegacyStatementAmounts = async (): Promise<LegacyStatementAmountRepairSummary> => {
  if (legacyStatementAmountRepairComplete) return { scanned: 0, updated: 0 };
  if (!legacyStatementAmountRepairPromise) {
    legacyStatementAmountRepairPromise = runLegacyStatementAmountRepair()
      .then((summary) => {
        legacyStatementAmountRepairComplete = true;
        return summary;
      })
      .finally(() => {
        legacyStatementAmountRepairPromise = null;
      });
  }
  return legacyStatementAmountRepairPromise;
};

const loadBatchCompletenessProfile = async (
  connection: HospitalConnection,
  batchId: number,
  dataType: RepstmDataType
) => {
  const [rows] = await connection.query(
    `SELECT raw_data
     FROM repstm_import_row
     WHERE batch_id = ?
     ORDER BY row_no`,
    [batchId]
  );
  const rawRows = (Array.isArray(rows) ? rows : [])
    .map((row) => parseImportRawData((row as Record<string, unknown>).raw_data))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  return buildImportCompletenessProfile(dataType, rawRows);
};

const updateBatchCompletenessProfile = async (
  connection: HospitalConnection,
  batchId: number,
  profile: ImportCompletenessProfile
) => {
  await connection.query(
    `UPDATE repstm_import_batch
     SET logical_hash = ?,
         completeness_score = ?,
         distinct_record_count = ?,
         column_count = ?,
         non_empty_cell_count = ?
     WHERE id = ?`,
    [
      profile.logicalHash,
      profile.completenessScore,
      profile.distinctRecordCount,
      profile.columnCount,
      profile.nonEmptyCellCount,
      batchId,
    ]
  );
};

const backfillBatchRowIdentities = async (
  connection: HospitalConnection,
  batchId: number,
  dataType: RepstmDataType,
  rows: Record<string, unknown>[]
) => {
  const batchSize = 500;
  for (let start = 0; start < rows.length; start += batchSize) {
    const slice = rows.slice(start, start + batchSize);
    const params: unknown[] = [];
    const cases = slice.map((row, offset) => {
      const rowNo = start + offset + 1;
      const rowIdentity = hashText(buildLogicalRowIdentity(dataType, row, start + offset));
      params.push(rowIdentity, rowNo);
      return 'WHEN row_no = ? THEN ?';
    }).join(' ');
    const caseParams: unknown[] = [];
    for (let index = 0; index < params.length; index += 2) {
      caseParams.push(params[index + 1], params[index]);
    }
    await connection.query(
      `UPDATE repstm_import_row
       SET row_identity = CASE ${cases} ELSE row_identity END
       WHERE batch_id = ?
         AND row_no IN (${slice.map(() => '?').join(',')})`,
      [...caseParams, batchId, ...slice.map((_, offset) => start + offset + 1)]
    );
  }
};

const formatExistingBatchLabel = (batch: Record<string, unknown>) => {
  const filename = String(batch.source_filename || '-');
  const createdAt = String(batch.created_at || '-');
  return `${filename} / ${createdAt}`;
};

const loadIndexedOverlapCounts = async (
  connection: HospitalConnection,
  dataType: RepstmDataType,
  rowIdentities: Set<string>
) => {
  const counts = new Map<number, number>();
  const identities = [...rowIdentities];
  const chunkSize = 800;
  for (let start = 0; start < identities.length; start += chunkSize) {
    const chunk = identities.slice(start, start + chunkSize);
    if (chunk.length === 0) continue;
    const [rows] = await connection.query(
      `SELECT batch_id, COUNT(DISTINCT row_identity) AS match_count
       FROM repstm_import_row
       WHERE data_type = ?
         AND row_identity IN (${chunk.map(() => '?').join(',')})
       GROUP BY batch_id`,
      [dataType, ...chunk]
    );
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Record<string, unknown>[]) {
      const batchId = Number(row.batch_id || 0);
      const matchCount = Number(row.match_count || 0);
      if (batchId > 0 && matchCount > 0) {
        counts.set(batchId, (counts.get(batchId) || 0) + matchCount);
      }
    }
  }
  return counts;
};

const findRepstmImportDecision = async (
  connection: HospitalConnection,
  dataType: RepstmDataType,
  profile: ImportCompletenessProfile
): Promise<RepstmImportDecision> => {
  const indexedOverlapCounts = await loadIndexedOverlapCounts(connection, dataType, profile.rowIdentities);
  if (indexedOverlapCounts.size > 0) {
    const indexedBatchIds = [...indexedOverlapCounts.keys()];
    const [indexedRows] = await connection.query(
      `SELECT id, row_count, source_filename, created_at, logical_hash, completeness_score,
              distinct_record_count, column_count, non_empty_cell_count
       FROM repstm_import_batch
       WHERE data_type = ?
         AND id IN (${indexedBatchIds.map(() => '?').join(',')})`,
      [dataType, ...indexedBatchIds]
    );

    let replaceCandidate: { batch: Record<string, unknown>; score: number; rowCount: number } | null = null;
    if (Array.isArray(indexedRows)) {
      for (const candidate of indexedRows as Record<string, unknown>[]) {
        const batchId = Number(candidate.id || 0);
        const matchCount = indexedOverlapCounts.get(batchId) || 0;
        const existingDistinctCount = Number(candidate.distinct_record_count || candidate.row_count || 0);
        const existingScore = Number(candidate.completeness_score || 0);
        const sameLogicalSet = String(candidate.logical_hash || '') === profile.logicalHash
          || (matchCount >= profile.distinctRecordCount && matchCount >= existingDistinctCount);

        if (matchCount >= profile.distinctRecordCount && existingScore >= profile.completenessScore) {
          return {
            action: 'skip',
            batchId,
            rowCount: Number(candidate.row_count || 0),
            message: sameLogicalSet
              ? `ข้ามไฟล์นี้: เคยนำเข้าข้อมูลชุดเดียวกันแล้ว (${formatExistingBatchLabel(candidate)})`
              : `ข้ามไฟล์นี้: มีข้อมูลชุดเดิมที่ครอบคลุมและสมบูรณ์กว่าแล้ว (${formatExistingBatchLabel(candidate)})`,
          };
        }

        if (matchCount >= existingDistinctCount && profile.completenessScore > existingScore) {
          if (!replaceCandidate || existingScore > replaceCandidate.score) {
            replaceCandidate = {
              batch: candidate,
              score: existingScore,
              rowCount: Number(candidate.row_count || 0),
            };
          }
        }
      }
    }

    if (replaceCandidate) {
      return {
        action: 'replace',
        batchId: Number(replaceCandidate.batch.id || 0),
        rowCount: replaceCandidate.rowCount,
        message: `ไฟล์นี้สมบูรณ์กว่า batch เดิม จึงนำเข้าแทน (${formatExistingBatchLabel(replaceCandidate.batch)})`,
      };
    }
  }

  const [candidateRows] = await connection.query(
    `SELECT b.id, b.row_count, b.source_filename, b.created_at, b.logical_hash, b.completeness_score,
            distinct_record_count, column_count, non_empty_cell_count
     FROM repstm_import_batch b
     WHERE b.data_type = ?
       AND (
         b.logical_hash = ?
         OR b.logical_hash IS NULL
         OR b.completeness_score = 0
         OR NOT EXISTS (
           SELECT 1
           FROM repstm_import_row rr
           WHERE rr.batch_id = b.id
             AND rr.row_identity IS NOT NULL
           LIMIT 1
         )
       )
     ORDER BY CASE WHEN b.logical_hash = ? THEN 0 ELSE 1 END, b.created_at DESC
     LIMIT 100`,
    [dataType, profile.logicalHash, profile.logicalHash]
  );

  if (!Array.isArray(candidateRows) || candidateRows.length === 0) return { action: 'import' };

  let replaceCandidate: { batch: Record<string, unknown>; profile: ImportCompletenessProfile } | null = null;

  for (const candidate of candidateRows as Record<string, unknown>[]) {
    const batchId = Number(candidate.id || 0);
    if (!Number.isFinite(batchId) || batchId <= 0) continue;

    let existingProfile: ImportCompletenessProfile | null = null;
    const storedLogicalHash = String(candidate.logical_hash || '');
    const storedScore = Number(candidate.completeness_score || 0);
    const storedDistinctCount = Number(candidate.distinct_record_count || 0);
    const storedColumnCount = Number(candidate.column_count || 0);
    const storedNonEmptyCount = Number(candidate.non_empty_cell_count || 0);

    if (storedLogicalHash === profile.logicalHash && storedScore > 0) {
      existingProfile = {
        logicalHash: storedLogicalHash,
        rowCount: Number(candidate.row_count || 0),
        distinctRecordCount: storedDistinctCount,
        columnCount: storedColumnCount,
        nonEmptyCellCount: storedNonEmptyCount,
        completenessScore: storedScore,
        rowIdentities: profile.rowIdentities,
      };
    } else {
      existingProfile = await loadBatchCompletenessProfile(connection, batchId, dataType);
      if (existingProfile.rowCount > 0) {
        const [identityRows] = await connection.query(
          `SELECT COUNT(*) AS count
           FROM repstm_import_row
           WHERE batch_id = ?
             AND row_identity IS NOT NULL`,
          [batchId]
        );
        const hasIdentities = Array.isArray(identityRows)
          && Number((identityRows[0] as Record<string, unknown>).count || 0) > 0;
        if (!hasIdentities) {
          const [rawRows] = await connection.query(
            `SELECT raw_data
             FROM repstm_import_row
             WHERE batch_id = ?
             ORDER BY row_no`,
            [batchId]
          );
          const parsedRows = (Array.isArray(rawRows) ? rawRows : [])
            .map((row) => parseImportRawData((row as Record<string, unknown>).raw_data))
            .filter((row): row is Record<string, unknown> => Boolean(row));
          await backfillBatchRowIdentities(connection, batchId, dataType, parsedRows);
        }
      }
      if (
        storedLogicalHash !== existingProfile.logicalHash
        || storedScore !== existingProfile.completenessScore
        || storedDistinctCount !== existingProfile.distinctRecordCount
        || storedColumnCount !== existingProfile.columnCount
        || storedNonEmptyCount !== existingProfile.nonEmptyCellCount
      ) {
        await updateBatchCompletenessProfile(connection, batchId, existingProfile);
      }
    }

    const existingCoversNew = isIdentitySuperset(existingProfile.rowIdentities, profile.rowIdentities);
    const newCoversExisting = isIdentitySuperset(profile.rowIdentities, existingProfile.rowIdentities);
    const sameLogicalSet = existingProfile.logicalHash === profile.logicalHash || (existingCoversNew && newCoversExisting);

    if (existingCoversNew && existingProfile.completenessScore >= profile.completenessScore) {
      return {
        action: 'skip',
        batchId,
        rowCount: existingProfile.rowCount,
        message: sameLogicalSet
          ? `ข้ามไฟล์นี้: เคยนำเข้าข้อมูลชุดเดียวกันแล้ว (${formatExistingBatchLabel(candidate)})`
          : `ข้ามไฟล์นี้: มีข้อมูลชุดเดิมที่ครอบคลุมและสมบูรณ์กว่าแล้ว (${formatExistingBatchLabel(candidate)})`,
      };
    }

    if (newCoversExisting && profile.completenessScore > existingProfile.completenessScore) {
      if (!replaceCandidate || existingProfile.completenessScore > replaceCandidate.profile.completenessScore) {
        replaceCandidate = { batch: candidate, profile: existingProfile };
      }
    }
  }

  if (replaceCandidate) {
    return {
      action: 'replace',
      batchId: Number(replaceCandidate.batch.id || 0),
      rowCount: replaceCandidate.profile.rowCount,
      message: `ไฟล์นี้สมบูรณ์กว่า batch เดิม จึงนำเข้าแทน (${formatExistingBatchLabel(replaceCandidate.batch)})`,
    };
  }

  return { action: 'import' };
};


const formatBudgetYear = (dateTime: string | null) => {
  if (!dateTime) return null;
  const [datePart] = dateTime.split(' ');
  const [yearText, monthText] = datePart.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return String(month >= 10 ? year + 1 : year);
};

const formatYYMM = (dateTime: string | null) => {
  if (!dateTime) return null;
  const [datePart] = dateTime.split(' ');
  const [yearText, monthText] = datePart.split('-');
  if (!yearText || !monthText) return null;
  return `${yearText.slice(-2)}${monthText}`;
};

const resolveDepartment = (patientType: string, an: string) => {
  const normalized = patientType.trim().toUpperCase();
  if (normalized.includes('OP') || patientType.includes('ผู้ป่วยนอก')) return 'OP';
  if (normalized.includes('IP') || patientType.includes('ผู้ป่วยใน') || an.trim()) return 'IP';
  return 'OP';
};

const resolvePercentPay = (value: string): number | null => {
  const parsed = toAmountValue(value);
  if (parsed == null) return null;
  if (parsed >= 80) return parsed;
  if (parsed > 3) return 80;
  if (parsed === 3) return 85;
  if (parsed === 2) return 90;
  if (parsed === 1) return 95;
  if (parsed === 0) return 100;
  return parsed;
};

const resolveRepRecordUid = (tranId: string, repNo: string, department: string, vn: string, an: string, hn: string, index: number) => {
  if (tranId.trim()) return tranId.trim();
  const visitCode = department === 'IP' ? an.trim() : vn.trim();
  return [repNo.trim() || 'REP', visitCode || hn.trim() || String(index + 1)].filter(Boolean).join(':');
};

const resolveStatementRecordUid = (
  dataType: 'STM' | 'INV',
  tranId: string,
  statementNo: string,
  department: string,
  vn: string,
  an: string,
  hn: string,
  index: number
) => {
  if (tranId.trim()) return `${dataType}:${tranId.trim()}`;
  const visitCode = department === 'IP' ? an.trim() : vn.trim();
  return [dataType, statementNo.trim() || 'STATEMENT', visitCode || hn.trim() || String(index + 1)]
    .filter(Boolean)
    .join(':');
};

const resolveVisitDateOnly = (dateTime: string | null) => dateTime?.split(' ')[0] || null;

const resolveRepVisitCode = async (
  hosConnection: HospitalConnection,
  department: string,
  hn: string,
  admdate: string | null,
  pid: string,
  an: string,
  vn: string
) => {
  const normalizedCid = normalizeCitizenId(pid);
  if (department === 'IP') {
    if (an.trim()) return an.trim();
    if (!hn.trim() || !admdate) return '';
    const visitDate = resolveVisitDateOnly(admdate);
    if (!visitDate) return '';
    if (normalizedCid) {
      const [cidRows] = await hosConnection.query(
        `SELECT i.an
         FROM ipt i
         JOIN patient pt ON pt.hn = i.hn
         WHERE i.hn = ?
           AND pt.cid = ?
           AND (i.regdate = ? OR i.dchdate = ?)
         ORDER BY i.an DESC
         LIMIT 1`,
        [hn.trim(), normalizedCid, visitDate, visitDate]
      );
      if (Array.isArray(cidRows) && cidRows.length > 0) {
        return normalizeImportCellValue((cidRows[0] as Record<string, unknown>).an);
      }
    }
    const [rows] = await hosConnection.query(
      `SELECT an
       FROM ipt
       WHERE hn = ? AND (regdate = ? OR dchdate = ?)
       ORDER BY an DESC
       LIMIT 1`,
      [hn.trim(), visitDate, visitDate]
    );
    return Array.isArray(rows) && rows.length > 0 ? normalizeImportCellValue((rows[0] as Record<string, unknown>).an) : '';
  }

  if (vn.trim()) return vn.trim();
  if (!hn.trim() || !admdate) return '';
  const visitDate = resolveVisitDateOnly(admdate);
  if (!visitDate) return '';
  if (normalizedCid) {
    const [cidRows] = await hosConnection.query(
      `SELECT o.vn
       FROM ovst o
       JOIN patient pt ON pt.hn = o.hn
       WHERE o.hn = ?
         AND pt.cid = ?
         AND o.vstdate = ?
       ORDER BY o.vn DESC
       LIMIT 1`,
      [hn.trim(), normalizedCid, visitDate]
    );
    if (Array.isArray(cidRows) && cidRows.length > 0) {
      return normalizeImportCellValue((cidRows[0] as Record<string, unknown>).vn);
    }
  }
  const [rows] = await hosConnection.query(
    `SELECT vn
     FROM ovst
     WHERE hn = ? AND vstdate = ?
     ORDER BY vn DESC
     LIMIT 1`,
    [hn.trim(), visitDate]
  );
  return Array.isArray(rows) && rows.length > 0 ? normalizeImportCellValue((rows[0] as Record<string, unknown>).vn) : '';
};

const resolveRepIncome = async (
  hosConnection: HospitalConnection,
  department: string,
  vn: string,
  an: string
) => {
  if (department === 'IP') {
    if (!an.trim()) return null;
    const [rows] = await hosConnection.query(
      `SELECT ROUND(IFNULL(income, 0) - IFNULL(discount_money, 0) - IFNULL(rcpt_money, 0), 2) AS income
       FROM an_stat
       WHERE an = ?
       LIMIT 1`,
      [an.trim()]
    );
    return Array.isArray(rows) && rows.length > 0 ? toAmountValue(normalizeImportCellValue((rows[0] as Record<string, unknown>).income)) : null;
  }

  if (!vn.trim()) return null;
  const [rows] = await hosConnection.query(
    `SELECT ROUND(IFNULL(income, 0) - IFNULL(discount_money, 0) - IFNULL(rcpt_money, 0), 2) AS income
     FROM vn_stat
     WHERE vn = ?
     LIMIT 1`,
    [vn.trim()]
  );
  return Array.isArray(rows) && rows.length > 0 ? toAmountValue(normalizeImportCellValue((rows[0] as Record<string, unknown>).income)) : null;
};

const importRepDataRows = async (
  repConnection: HospitalConnection,
  hosConnection: HospitalConnection,
  batchId: number,
  payload: {
    sourceFilename: string;
    rows: Record<string, unknown>[];
  }
) => {
  await repConnection.query(REP_DATA_TABLE_SQL);
  await repConnection.query(REP_DATA_VERIFY_TABLE_SQL);

  const visitCodeCache = new Map<string, string>();
  const incomeCache = new Map<string, number | null>();

  const opVisitCodes = new Set<string>();
  const ipVisitCodes = new Set<string>();
  payload.rows.forEach((row) => {
    const rawAn = pickRowValueAdvanced(row, ['AN']).trim();
    const patientType = pickRowValueAdvanced(row, ['ประเภทผู้ป่วย']);
    const department = resolveDepartment(patientType, rawAn);
    const seqNo = normalizeImportCellValue(pickRowValueAdvanced(row, ['SEQ NO', 'SEQ_NO', 'SEQNO', 'SEQ', 'ลำดับที่', 'no']));
    if (department === 'IP') {
      const an = rawAn || seqNo;
      if (an) ipVisitCodes.add(an);
    } else if (seqNo) {
      opVisitCodes.add(seqNo);
    }
  });

  const prefetchIncome = async (department: 'OP' | 'IP', visitCodes: Set<string>) => {
    const codes = [...visitCodes];
    const column = department === 'IP' ? 'an' : 'vn';
    const table = department === 'IP' ? 'an_stat' : 'vn_stat';
    for (let offset = 0; offset < codes.length; offset += 500) {
      const chunk = codes.slice(offset, offset + 500);
      const [incomeRows] = await hosConnection.query(
        `SELECT ${column} AS visit_code,
                ROUND(IFNULL(income, 0) - IFNULL(discount_money, 0) - IFNULL(rcpt_money, 0), 2) AS income
         FROM ${table}
         WHERE ${column} IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      if (Array.isArray(incomeRows)) {
        (incomeRows as Record<string, unknown>[]).forEach((incomeRow) => {
          const visitCode = normalizeImportCellValue(incomeRow.visit_code);
          const cacheKey = department === 'IP' ? `IP||${visitCode}` : `OP|${visitCode}|`;
          incomeCache.set(cacheKey, toAmountValue(normalizeImportCellValue(incomeRow.income)));
        });
      }
    }
  };
  await prefetchIncome('OP', opVisitCodes);
  await prefetchIncome('IP', ipVisitCodes);

  for (let index = 0; index < payload.rows.length; index += 1) {
    const row = payload.rows[index];
    const repNo = pickRowValueAdvanced(row, ['REP No.', 'REP No', 'REP']);
    const seqNo = pickRowValueAdvanced(row, ['SEQ NO', 'SEQ_NO', 'SEQNO', 'SEQ', 'ลำดับที่', 'no']);
    const tranId = pickRowValueAdvanced(row, ['TRAN_ID', 'transaction_uid', 'tranid']);
    const fallbackSiteSettings = (businessRules as Record<string, unknown>)?.site_settings as Record<string, unknown> | undefined;
    const hcode = pickRowValueAdvanced(row, ['HOSPCODE', 'hcode']) || String(fallbackSiteSettings?.hospital_code || '');
    const hn = pickRowValueAdvanced(row, ['HN']);
    const rawAn = pickRowValueAdvanced(row, ['AN']);
    const pid = pickRowValueAdvanced(row, ['PID', 'CID']);
    const patientName = pickRowValueAdvanced(row, ['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล']);
    const patientType = pickRowValueAdvanced(row, ['ประเภทผู้ป่วย']);
    const admdate = parseFlexibleDateTime(pickRowValueAdvanced(row, ['วันเข้ารักษา', 'admdate']));
    const dchdate = parseFlexibleDateTime(pickRowValueAdvanced(row, ['วันจำหน่าย', 'dchdate']));
    const senddate = parseFlexibleDateTime(pickRowValueAdvanced(row, ['senddate', 'วันส่งข้อมูล']));
    const maininscl = pickRowValueAdvanced(row, ['maininscl', 'สิทธิหลัก', 'กองทุนหลัก', 'fund', 'fund_code']);
    const subinscl = pickRowValueAdvanced(row, ['subinscl', 'สิทธิย่อย', 'กองทุนย่อย']);
    const errorcode = pickRowValueAdvanced(row, ['errorcode', 'error code']);
    const verifycode = pickRowValueAdvanced(row, ['verifycode', 'verify code']);
    const projectcode = pickRowValueAdvanced(row, ['projectcode', 'project code', 'projcode', 'proj']);
    const percentpay = resolvePercentPay(pickRowValueAdvanced(row, ['percentpay', '%จ่าย', 'ร้อยละ']));
    const compensated = toAmountValue(pickRowValueAdvanced(row, [
      'ชดเชยสุทธิ', 'compensated', 'ชดเชยสุทธิรวม', 'พึงรับ', 'พึงรับทั้งหมด',
      'ยอดชดเชยทั้งสิ้น', 'จ่ายชดเชย', 'ยอดชดเชยหลังหักเงินเดือน'
    ]));
    const nhso = toAmountValue(pickRowValueAdvanced(row, ['ชดเชยสุทธิ สปสช.', 'nhso']));
    const agency = toAmountValue(pickRowValueAdvanced(row, ['ชดเชยสุทธิ ต้นสังกัด', 'agency']));
    const hc = toAmountValue(pickRowValueAdvanced(row, ['HC']));
    const ae = toAmountValue(pickRowValueAdvanced(row, ['AE']));
    const inst = toAmountValue(pickRowValueAdvanced(row, ['INST']));
    const op = toAmountValue(pickRowValueAdvanced(row, ['OP']));
    const ip = toAmountValue(pickRowValueAdvanced(row, ['IP']));
    const dmis = toAmountValue(pickRowValueAdvanced(row, ['DMIS']));
    const drug = toAmountValue(pickRowValueAdvanced(row, ['DRUG']));
    const ontop = toAmountValue(pickRowValueAdvanced(row, ['ONTOP']));

    const department = resolveDepartment(patientType, rawAn);
    const normalizedSeqNo = normalizeImportCellValue(seqNo);
    const fallbackVn = department === 'OP' ? normalizedSeqNo : '';
    const fallbackAn = department === 'IP' ? (rawAn.trim() || normalizedSeqNo) : rawAn.trim();
    const visitLookupKey = [department, hn.trim(), admdate || '', normalizeCitizenId(pid), fallbackAn, fallbackVn].join('|');
    let resolvedVisitCode = visitCodeCache.get(visitLookupKey);
    if (resolvedVisitCode == null) {
      resolvedVisitCode = await resolveRepVisitCode(hosConnection, department, hn, admdate, pid, fallbackAn, fallbackVn);
      visitCodeCache.set(visitLookupKey, resolvedVisitCode);
    }
    const vn = department === 'OP' ? (resolvedVisitCode || fallbackVn) : '';
    const an = department === 'IP' ? (resolvedVisitCode || fallbackAn) : '';
    const incomeLookupKey = [department, vn, an].join('|');
    let income = incomeCache.get(incomeLookupKey);
    if (income === undefined) {
      income = await resolveRepIncome(hosConnection, department, vn, an);
      incomeCache.set(incomeLookupKey, income);
    }
    const effectiveCompensated = compensated ?? nhso ?? null;
    const diff = income != null && effectiveCompensated != null ? Number((effectiveCompensated - income).toFixed(2)) : null;
    const downAmount = diff != null && diff > 0 ? diff : null;
    const upAmount = diff != null && diff < 0 ? diff : null;
    const seqNoForSave = department === 'OP' ? (vn || normalizedSeqNo) : normalizedSeqNo;
    const recordUid = resolveRepRecordUid(tranId, repNo, department, vn, an, hn, index);
    const yymm = formatYYMM(department === 'IP' ? dchdate || admdate : admdate);
    const yearbudget = formatBudgetYear(department === 'IP' ? dchdate || admdate : admdate);

    await repConnection.query(
      `INSERT INTO rep_data
       (batch_id, record_uid, rep_no, seq_no, tran_id, hcode, hn, vn, an, pid, patient_name, patient_type, department,
        admdate, dchdate, senddate, maininscl, subinscl, errorcode, verifycode, projectcode, filename, filefrom,
        percentpay, income, compensated, nhso, agency, hc, ae, inst, op, ip, dmis, drug, ontop, diff, down_amount, up_amount,
        yymm, yearbudget, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NHSO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        batch_id = VALUES(batch_id),
        rep_no = VALUES(rep_no),
        seq_no = VALUES(seq_no),
        tran_id = VALUES(tran_id),
        hcode = VALUES(hcode),
        hn = VALUES(hn),
        vn = VALUES(vn),
        an = VALUES(an),
        pid = VALUES(pid),
        patient_name = VALUES(patient_name),
        patient_type = VALUES(patient_type),
        department = VALUES(department),
        admdate = VALUES(admdate),
        dchdate = VALUES(dchdate),
        senddate = VALUES(senddate),
        maininscl = VALUES(maininscl),
        subinscl = VALUES(subinscl),
        errorcode = VALUES(errorcode),
        verifycode = VALUES(verifycode),
        projectcode = VALUES(projectcode),
        filename = VALUES(filename),
        percentpay = VALUES(percentpay),
        income = VALUES(income),
        compensated = VALUES(compensated),
        nhso = VALUES(nhso),
        agency = VALUES(agency),
        hc = VALUES(hc),
        ae = VALUES(ae),
        inst = VALUES(inst),
        op = VALUES(op),
        ip = VALUES(ip),
        dmis = VALUES(dmis),
        drug = VALUES(drug),
        ontop = VALUES(ontop),
        diff = VALUES(diff),
        down_amount = VALUES(down_amount),
        up_amount = VALUES(up_amount),
        yymm = VALUES(yymm),
        yearbudget = VALUES(yearbudget),
        raw_data = VALUES(raw_data)`,
      [
        batchId, recordUid, repNo || null, seqNoForSave || null, tranId || null, hcode || null, hn || null, vn || null, an || null, pid || null,
        patientName || null, patientType || null, department || null, admdate, dchdate, senddate, maininscl || null,
        subinscl || null, errorcode || null, verifycode || null, projectcode || null, payload.sourceFilename,
        percentpay, income, effectiveCompensated, nhso, agency, hc, ae, inst, op, ip, dmis, drug, ontop, diff, downAmount, upAmount,
        yymm, yearbudget, JSON.stringify(row),
      ]
    );
  }
};

const importStatementDataRows = async (
  repConnection: HospitalConnection,
  hosConnection: HospitalConnection,
  batchId: number,
  payload: {
    dataType: 'STM' | 'INV';
    sourceFilename: string;
    rows: Record<string, unknown>[];
  }
) => {
  await repConnection.query(REPSTM_STATEMENT_DATA_TABLE_SQL);

  const visitCodeCache = new Map<string, string>();

  for (let index = 0; index < payload.rows.length; index += 1) {
    const row = payload.rows[index];
    const statementNo = pickRowValueAdvanced(row, [
      'STM No.', 'STM No', 'STM',
      'INV No.', 'INV No', 'INV',
      'REP No.', 'REP No', 'REP',
      'invoice_no', 'เลขที่เอกสาร', 'เลขที่ใบแจ้งหนี้', 'document_no', 'docno'
    ]);
    const tranId = pickRowValueAdvanced(row, ['TRAN_ID', 'transaction_uid', 'tranid']);
    const fallbackSiteSettings = (businessRules as Record<string, unknown>)?.site_settings as Record<string, unknown> | undefined;
    const hcode = pickRowValueAdvanced(row, ['HOSPCODE', 'hcode']) || String(fallbackSiteSettings?.hospital_code || '');
    const hn = pickRowValueAdvanced(row, ['HN']);
    const rawVn = pickRowValueAdvanced(row, ['VN', 'SEQ', 'SEQ NO', 'SEQ_NO', 'SEQNO', 'visit_no']);
    const rawAn = pickRowValueAdvanced(row, ['AN']);
    const pid = pickRowValueAdvanced(row, ['PID', 'CID']);
    const patientName = pickRowValueAdvanced(row, ['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล']);
    const patientType = pickRowValueAdvanced(row, ['ประเภทผู้ป่วย']);
    const serviceDateTime = parseFlexibleDateTime(pickRowValueAdvanced(row, [
      'service_datetime', 'service_date', 'date_serv', 'วันที่รับบริการ', 'วันที่',
      'วันเข้ารักษา', 'วันจำหน่าย', 'admdate', 'dchdate'
    ]));
    const senddate = parseFlexibleDateTime(pickRowValueAdvanced(row, ['senddate', 'วันส่งข้อมูล']));
    const maininscl = pickRowValueAdvanced(row, ['maininscl', 'สิทธิหลัก', 'กองทุนหลัก', 'fund', 'fund_code']);
    const subinscl = pickRowValueAdvanced(row, ['subinscl', 'สิทธิย่อย']);
    const errorcode = pickRowValueAdvanced(row, ['errorcode', 'error code']);
    const verifycode = pickRowValueAdvanced(row, ['verifycode', 'verify code']);
    const parsedAmount = toAmountValue(pickRowValueAdvanced(row, [
      'amount', 'total', 'ยอดเงิน', 'จำนวนเงิน', 'sum_amount', 'พึงรับ', 'พึงรับทั้งหมด',
      'ยอดชดเชยทั้งสิ้น', 'ชดเชยสุทธิ', 'จ่ายชดเชย', 'ยอดชดเชยหลังหักเงินเดือน'
    ]));
    const parsedPaidAmount = toAmountValue(pickRowValueAdvanced(row, [
      'paid', 'paid_amount', 'ยอดชำระ', 'ยอดรับสุทธิ', 'ยอดเงินสุทธิ', 'net_paid', 'net_amount',
      'พึงรับ', 'พึงรับทั้งหมด', 'ยอดชดเชยทั้งสิ้น', 'ชดเชยสุทธิ'
    ]));
    const invoiceAmount = toAmountValue(pickRowValueAdvanced(row, [
      'invoice_amount', 'inv_amount', 'ยอดเรียกเก็บ', 'เรียกเก็บ', 'เรียกเก็บ (1)', 'เบิกได้'
    ]));
    // INV เป็นหลักฐานการรับเงินจริง: ยอดเงินที่พบถือเป็นยอดรับสุทธิและปิดกระบวนการได้
    const paidAmount = payload.dataType === 'INV'
      ? (parsedPaidAmount ?? parsedAmount ?? invoiceAmount)
      : parsedPaidAmount;
    const amount = payload.dataType === 'INV' ? paidAmount : parsedAmount;

    const department = resolveDepartment(patientType, rawAn);
    const visitLookupKey = [department, hn.trim(), serviceDateTime || '', normalizeCitizenId(pid), rawAn.trim(), rawVn.trim()].join('|');
    let matchedVisitCode = visitCodeCache.get(visitLookupKey);
    if (matchedVisitCode == null) {
      matchedVisitCode = await resolveRepVisitCode(hosConnection, department, hn, serviceDateTime, pid, rawAn, rawVn);
      visitCodeCache.set(visitLookupKey, matchedVisitCode);
    }
    const vn = department === 'OP' ? (matchedVisitCode || rawVn.trim()) : rawVn.trim();
    const an = department === 'IP' ? (matchedVisitCode || rawAn.trim()) : '';
    const recordUid = resolveStatementRecordUid(payload.dataType, tranId, statementNo, department, vn, an, hn, index);
    const matchedStatus = matchedVisitCode ? 'matched' : 'unmatched';

    await repConnection.query(
      `INSERT INTO repstm_statement_data
       (batch_id, data_type, record_uid, statement_no, tran_id, hcode, hn, vn, an, pid, patient_name, patient_type, department,
        service_datetime, senddate, maininscl, subinscl, errorcode, verifycode, amount, paid_amount, invoice_amount,
        filename, filefrom, matched_visit_code, matched_status, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NHSO', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        batch_id = VALUES(batch_id),
        statement_no = VALUES(statement_no),
        tran_id = VALUES(tran_id),
        hcode = VALUES(hcode),
        hn = VALUES(hn),
        vn = VALUES(vn),
        an = VALUES(an),
        pid = VALUES(pid),
        patient_name = VALUES(patient_name),
        patient_type = VALUES(patient_type),
        department = VALUES(department),
        service_datetime = VALUES(service_datetime),
        senddate = VALUES(senddate),
        maininscl = VALUES(maininscl),
        subinscl = VALUES(subinscl),
        errorcode = VALUES(errorcode),
        verifycode = VALUES(verifycode),
        amount = VALUES(amount),
        paid_amount = VALUES(paid_amount),
        invoice_amount = VALUES(invoice_amount),
        filename = VALUES(filename),
        matched_visit_code = VALUES(matched_visit_code),
        matched_status = VALUES(matched_status),
        raw_data = VALUES(raw_data)`,
      [
        batchId,
        payload.dataType,
        recordUid,
        statementNo || null,
        tranId || null,
        hcode || null,
        hn || null,
        vn || null,
        an || null,
        pid || null,
        patientName || null,
        patientType || null,
        department || null,
        serviceDateTime,
        senddate,
        maininscl || null,
        subinscl || null,
        errorcode || null,
        verifycode || null,
        amount,
        paidAmount,
        invoiceAmount,
        payload.sourceFilename,
        matchedVisitCode || null,
        matchedStatus,
        JSON.stringify(row),
      ]
    );
  }
};

const summarizeImportRow = (row: Record<string, unknown>) => {
  const refKey = pickRowValue(row, ['rep', 'stm', 'invoice', 'invoice_no', 'เลขที่เอกสาร', 'เลขที่ใบแจ้งหนี้', 'document_no', 'docno', 'claimno', 'transaction_uid']);
  const hn = pickRowValue(row, ['hn', 'HN']);
  const vn = pickRowValue(row, ['vn', 'VN', 'seq', 'visit_no']);
  const an = pickRowValue(row, ['an', 'AN']);
  const cid = pickRowValue(row, ['cid', 'person_id', 'เลขบัตรประชาชน']);
  const amount = toAmountValue(pickRowValue(row, ['amount', 'total', 'paid', 'ยอดเงิน', 'จำนวนเงิน', 'sum_amount']));
  const serviceDate = pickRowValue(row, ['service_date', 'date_serv', 'date', 'วันที่รับบริการ', 'วันที่']);

  return {
    refKey: refKey || null,
    hn: hn || null,
    vn: vn || null,
    an: an || null,
    cid: cid || null,
    amount,
    serviceDate: serviceDate || null,
  };
};

const insertRepstmImportRows = async (
  connection: HospitalConnection,
  batchId: number,
  dataType: 'REP' | 'STM' | 'INV',
  rows: Record<string, unknown>[]
) => {
  const batchSize = 500;
  for (let start = 0; start < rows.length; start += batchSize) {
    const slice = rows.slice(start, start + batchSize);
    const valuesSql = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];

    slice.forEach((row, offset) => {
      const summary = summarizeImportRow(row);
      const rowIdentity = hashText(buildLogicalRowIdentity(dataType, row, start + offset));
      params.push(
        batchId,
        dataType,
        start + offset + 1,
        summary.refKey,
        rowIdentity,
        summary.hn,
        summary.vn,
        summary.an,
        summary.cid,
        summary.amount,
        summary.serviceDate,
        JSON.stringify(row)
      );
    });

    await connection.query(
      `INSERT INTO repstm_import_row
       (batch_id, data_type, row_no, ref_key, row_identity, hn, vn, an, cid, amount, service_date, raw_data)
       VALUES ${valuesSql}`,
      params
    );
  }
};

export const importRepstmRows = async (payload: {
  dataType: 'REP' | 'STM' | 'INV';
  sourceFilename: string;
  fileSize?: number;
  fileHash?: string;
  sheetName?: string;
  isSubfile?: boolean;
  importedBy?: string;
  notes?: string;
  rows: Record<string, unknown>[];
  forceReimport?: boolean;
}) => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  const hosConnection = await getUTFConnection();
  try {
    await connection.beginTransaction();

    const uniqueRows = deduplicateRepstmRows(payload.dataType, payload.rows);
    const removedDuplicateRows = payload.rows.length - uniqueRows.length;
    const contentBatchHash = buildBatchHash(payload.dataType, uniqueRows);
    const originalBatchHash = payload.isSubfile
      ? hashText(`${payload.dataType}:SUBFILE:${payload.sheetName || ''}:${contentBatchHash}`)
      : contentBatchHash;
    const batchHash = payload.forceReimport
      ? hashText(`${originalBatchHash}:force:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`)
      : originalBatchHash;
    const completenessProfile = buildImportCompletenessProfile(payload.dataType, uniqueRows);
    const [duplicateRows] = await connection.query(
      `SELECT id, row_count, source_filename, created_at
       FROM repstm_import_batch
       WHERE data_type = ? AND batch_hash = ?
       LIMIT 1`,
      [payload.dataType, originalBatchHash]
    );

    if (!payload.forceReimport && Array.isArray(duplicateRows) && duplicateRows.length > 0) {
      await connection.rollback();
      const existing = duplicateRows[0] as Record<string, unknown>;
      return {
        success: true,
        duplicate: true,
        batchId: Number(existing.id || 0),
        rowCount: Number(existing.row_count || uniqueRows.length),
        message: `ข้อมูลชุดนี้ถูกนำเข้าแล้วเมื่อ ${String(existing.created_at || '-')} (ตรวจจากเนื้อหาไฟล์)`,
      };
    }

    const detectedDecision: RepstmImportDecision = payload.isSubfile
      ? { action: 'import' }
      : await findRepstmImportDecision(connection, payload.dataType, completenessProfile);
    const exactDuplicate = Array.isArray(duplicateRows) && duplicateRows.length > 0
      ? duplicateRows[0] as Record<string, unknown>
      : null;
    let importDecision: RepstmImportDecision = detectedDecision;
    if (payload.forceReimport) {
      // Prefer the latest active logical batch. This keeps repeated force-imports as
      // one replacement chain instead of creating several visible replacements of
      // the original batch.
      const activeBatch = detectedDecision.action !== 'import' ? detectedDecision : null;
      const previousBatchId = Number(activeBatch?.batchId || exactDuplicate?.id || 0);
      importDecision = previousBatchId > 0
        ? {
            action: 'replace',
            batchId: previousBatchId,
            rowCount: Number(activeBatch?.rowCount || exactDuplicate?.row_count || 0),
            message: `นำเข้าซ้ำโดยผู้ใช้และแทน batch เดิม #${previousBatchId}`,
          }
        : { action: 'import' };
    }
    if (!payload.forceReimport && importDecision.action === 'skip') {
      await connection.rollback();
      return {
        success: true,
        duplicate: true,
        skipped: true,
        batchId: importDecision.batchId,
        rowCount: importDecision.rowCount,
        message: importDecision.message,
      };
    }

    const [batchResult] = await connection.query(
      `INSERT INTO repstm_import_batch
       (data_type, source_filename, file_size, file_hash, batch_hash, logical_hash, completeness_score, distinct_record_count,
        column_count, non_empty_cell_count, replaces_batch_id, sheet_name, is_subfile, imported_by, row_count, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.dataType,
        payload.sourceFilename,
        Number.isFinite(payload.fileSize) ? Math.max(0, Math.trunc(Number(payload.fileSize))) : null,
        /^[a-f0-9]{64}$/i.test(payload.fileHash || '') ? String(payload.fileHash).toLowerCase() : null,
        batchHash,
        completenessProfile.logicalHash,
        completenessProfile.completenessScore,
        completenessProfile.distinctRecordCount,
        completenessProfile.columnCount,
        completenessProfile.nonEmptyCellCount,
        importDecision.action === 'replace' ? importDecision.batchId : null,
        payload.sheetName || null,
        payload.isSubfile ? 1 : 0,
        payload.importedBy || null,
        uniqueRows.length,
        payload.forceReimport
          ? `[FORCE REIMPORT]${payload.notes ? ` ${payload.notes}` : ''}`
          : payload.notes || null,
      ]
    );

    const batchId = Number((batchResult as mysql.ResultSetHeader).insertId);

    await insertRepstmImportRows(connection, batchId, payload.dataType, uniqueRows);

    if (!payload.isSubfile && payload.dataType === 'REP') {
      await importRepDataRows(connection, hosConnection, batchId, {
        sourceFilename: payload.sourceFilename,
        rows: uniqueRows,
      });
    } else if (!payload.isSubfile && (payload.dataType === 'STM' || payload.dataType === 'INV')) {
      await importStatementDataRows(connection, hosConnection, batchId, {
        dataType: payload.dataType,
        sourceFilename: payload.sourceFilename,
        rows: uniqueRows,
      });
    }

    // ไฟล์ eclaim_* จาก BMS/NHSO เป็น REP ระดับ visit หากเวอร์ชันเดิมเคยจัดเป็น INV
    // ให้ลบ batch ที่จำแนกผิดหลังสร้าง REP สำเร็จ เพื่อไม่ให้นับยอดซ้ำสองประเภท
    if (!payload.isSubfile && payload.dataType === 'REP' && /^eclaim[_-]/i.test(payload.sourceFilename)) {
      await connection.query(
        `DELETE FROM repstm_import_batch
         WHERE data_type = 'INV'
           AND source_filename = ?
           AND id <> ?`,
        [payload.sourceFilename, batchId]
      );
    }

    await connection.commit();
    return {
      success: true,
      duplicate: false,
      replaced: importDecision.action === 'replace',
      replacedBatchId: importDecision.action === 'replace' ? importDecision.batchId : null,
      batchId,
      rowCount: uniqueRows.length,
      removedDuplicateRows,
      forced: Boolean(payload.forceReimport),
      message: importDecision.action === 'replace'
        ? `${importDecision.message}${removedDuplicateRows > 0 ? ` · ตัดแถวซ้ำ ${removedDuplicateRows} แถว` : ''}`
        : `นำเข้า ${payload.dataType}${payload.isSubfile ? ` Sub file (${payload.sheetName || 'ข้อมูลประกอบ'})` : ''} สำเร็จ${removedDuplicateRows > 0 ? ` · ตัดแถวซ้ำ ${removedDuplicateRows} แถว` : ''}`,
    };
  } catch (error) {
    await connection.rollback();
    console.error('Error importing REP/STM/INV rows:', error);
    return { success: false, error };
  } finally {
    hosConnection.release();
    connection.release();
  }
};

export const importFdhClaimDetailRows = async (payload: {
  sourceFilename: string;
  sheetName?: string;
  importedBy?: string;
  notes?: string;
  rows: Record<string, unknown>[];
}) => {
  const connection = await getRepstmConnection();
  try {
    await connection.beginTransaction();
    await connection.query(FDH_CLAIM_DETAIL_BATCH_TABLE_SQL);
    await connection.query(FDH_CLAIM_DETAIL_ROW_TABLE_SQL);

    const normalizedRows = payload.rows.filter((row) => {
      const claimCode = pickRowValueAdvanced(row, ['รหัสการเคลม', 'claim_code', 'claim code']);
      const hn = pickRowValueAdvanced(row, ['HN']);
      const vn = pickRowValueAdvanced(row, ['รหัสบริการ (SEQ)', 'SEQ', 'VN']);
      const an = pickRowValueAdvanced(row, ['รหัสผู้ป่วยใน (AN)', 'AN']);
      return Boolean(claimCode || hn || vn || an);
    });

    const batchHash = buildRowsHash('FDH_CLAIM_DETAIL', normalizedRows);
    const [duplicateRows] = await connection.query(
      `SELECT id, row_count, op_count, ip_count, source_filename, created_at
       FROM fdh_claim_detail_batch
       WHERE batch_hash = ?
       LIMIT 1`,
      [batchHash]
    );

    if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
      await connection.rollback();
      const existing = duplicateRows[0] as Record<string, unknown>;
      return {
        success: true,
        duplicate: true,
        batchId: Number(existing.id || 0),
        rowCount: Number(existing.row_count || normalizedRows.length),
        opCount: Number(existing.op_count || 0),
        ipCount: Number(existing.ip_count || 0),
        message: `ไฟล์ FDH ClaimDetail นี้ถูกนำเข้าแล้วเมื่อ ${String(existing.created_at || '-')}`,
      };
    }

    const opCount = normalizedRows.filter((row) => {
      const patientType = pickRowValueAdvanced(row, ['ประเภทผู้ป่วย', 'patient_type']).toUpperCase();
      return patientType === 'OP' || patientType === 'OPD';
    }).length;
    const ipCount = normalizedRows.filter((row) => {
      const patientType = pickRowValueAdvanced(row, ['ประเภทผู้ป่วย', 'patient_type']).toUpperCase();
      return patientType === 'IP' || patientType === 'IPD';
    }).length;

    const [batchResult] = await connection.query(
      `INSERT INTO fdh_claim_detail_batch
       (source_filename, batch_hash, sheet_name, imported_by, row_count, op_count, ip_count, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.sourceFilename,
        batchHash,
        payload.sheetName || null,
        payload.importedBy || null,
        normalizedRows.length,
        opCount,
        ipCount,
        payload.notes || null,
      ]
    );
    const batchId = Number((batchResult as mysql.ResultSetHeader).insertId);

    for (let index = 0; index < normalizedRows.length; index += 1) {
      const row = normalizedRows[index];
      const claimCode = pickRowValueAdvanced(row, ['รหัสการเคลม', 'claim_code', 'claim code']);
      const hn = pickRowValueAdvanced(row, ['HN']);
      const vn = pickRowValueAdvanced(row, ['รหัสบริการ (SEQ)', 'SEQ', 'VN']);
      const an = pickRowValueAdvanced(row, ['รหัสผู้ป่วยใน (AN)', 'AN']);
      const patientTypeRaw = pickRowValueAdvanced(row, ['ประเภทผู้ป่วย', 'patient_type']);
      const patientType = patientTypeRaw.toUpperCase() === 'IPD' ? 'IP' : patientTypeRaw.toUpperCase() === 'OPD' ? 'OP' : patientTypeRaw.toUpperCase();
      const serviceDateTime = parseFlexibleDateTime(pickRowValueAdvanced(row, ['วันเข้ารับบริการ', 'service_datetime', 'service date']));
      const admitDateTime = parseFlexibleDateTime(pickRowValueAdvanced(row, ['วันที่รับการรักษา', 'วันเข้ารักษา', 'admit_datetime', 'admdate']));
      const dischargeDateTime = parseFlexibleDateTime(pickRowValueAdvanced(row, ['วันจำหน่ายออก', 'วันจำหน่าย', 'discharge_datetime', 'dchdate']));
      const sentAt = parseFlexibleDateTime(pickRowValueAdvanced(row, ['วันที่ส่งหา สปสช.', 'วันส่งข้อมูล', 'sent_at', 'senddate']));
      const privilegeUse = pickRowValueAdvanced(row, ['การใช้สิทธิ']);
      const uploadUid = pickRowValueAdvanced(row, ['upload uid', 'upload_uid']);
      const maininscl = pickRowValueAdvanced(row, ['สิทธิ', 'maininscl']);
      const claimStatus = pickRowValueAdvanced(row, ['สถานะรายการเคลม', 'claim_status', 'status']);

      await connection.query(
        `INSERT INTO fdh_claim_detail_row
         (batch_id, row_no, claim_code, hn, vn, an, patient_type, service_datetime, admit_datetime,
          discharge_datetime, privilege_use, sent_at, upload_uid, maininscl, claim_status, raw_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          batch_id = VALUES(batch_id),
          row_no = VALUES(row_no),
          hn = VALUES(hn),
          vn = VALUES(vn),
          an = VALUES(an),
          patient_type = VALUES(patient_type),
          service_datetime = VALUES(service_datetime),
          admit_datetime = VALUES(admit_datetime),
          discharge_datetime = VALUES(discharge_datetime),
          privilege_use = VALUES(privilege_use),
          sent_at = VALUES(sent_at),
          upload_uid = VALUES(upload_uid),
          maininscl = VALUES(maininscl),
          claim_status = VALUES(claim_status),
          raw_data = VALUES(raw_data)`,
        [
          batchId,
          index + 1,
          claimCode || null,
          hn || null,
          vn || null,
          an || null,
          patientType || null,
          serviceDateTime,
          admitDateTime,
          dischargeDateTime,
          privilegeUse || null,
          sentAt,
          uploadUid || null,
          maininscl || null,
          claimStatus || null,
          JSON.stringify(row),
        ]
      );
    }

    await connection.commit();
    return { success: true, duplicate: false, batchId, rowCount: normalizedRows.length, opCount, ipCount };
  } catch (error) {
    await connection.rollback();
    console.error('Error importing FDH ClaimDetail rows:', error);
    return { success: false, error };
  } finally {
    connection.release();
  }
};

export const getFdhClaimDetailBatches = async (limit = 20): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(FDH_CLAIM_DETAIL_BATCH_TABLE_SQL);
    const [rows] = await connection.query(
      `SELECT id, source_filename, sheet_name, imported_by, row_count, op_count, ip_count, notes, created_at
       FROM fdh_claim_detail_batch
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit]
    );
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } finally {
    connection.release();
  }
};

export const getFdhClaimDetailSummary = async (): Promise<Record<string, unknown>> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(FDH_CLAIM_DETAIL_BATCH_TABLE_SQL);
    await connection.query(FDH_CLAIM_DETAIL_ROW_TABLE_SQL);

    const [batchRows] = await connection.query(
      `SELECT
         COUNT(*) AS batch_count,
         COALESCE(SUM(row_count), 0) AS batch_row_total,
         COALESCE(SUM(op_count), 0) AS batch_op_total,
         COALESCE(SUM(ip_count), 0) AS batch_ip_total,
         MAX(created_at) AS latest_import_at
       FROM fdh_claim_detail_batch`
    );

    const [rowRows] = await connection.query(
      `SELECT
         COUNT(*) AS row_total,
         SUM(CASE WHEN UPPER(IFNULL(patient_type, '')) IN ('OP', 'OPD') THEN 1 ELSE 0 END) AS op_total,
         SUM(CASE WHEN UPPER(IFNULL(patient_type, '')) IN ('IP', 'IPD') THEN 1 ELSE 0 END) AS ip_total,
         COUNT(DISTINCT NULLIF(claim_code, '')) AS distinct_claim_total,
         COUNT(DISTINCT NULLIF(upload_uid, '')) AS distinct_upload_total
       FROM fdh_claim_detail_row`
    );

    const [statusRows] = await connection.query(
      `SELECT COALESCE(NULLIF(claim_status, ''), '(ว่าง)') AS claim_status, COUNT(*) AS total
       FROM fdh_claim_detail_row
       GROUP BY COALESCE(NULLIF(claim_status, ''), '(ว่าง)')
       ORDER BY total DESC
       LIMIT 6`
    );

    const batchSummary = Array.isArray(batchRows) ? (batchRows[0] as Record<string, unknown> | undefined) : undefined;
    const rowSummary = Array.isArray(rowRows) ? (rowRows[0] as Record<string, unknown> | undefined) : undefined;
    return {
      ...(batchSummary || {}),
      ...(rowSummary || {}),
      status_counts: Array.isArray(statusRows) ? statusRows : [],
    };
  } finally {
    connection.release();
  }
};

export const getFdhClaimDetailRows = async (options: {
  patientType?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
} = {}): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(FDH_CLAIM_DETAIL_ROW_TABLE_SQL);
    const where: string[] = [];
    const params: Array<string | number> = [];
    const patientType = String(options.patientType || '').toUpperCase();
    if (patientType === 'OP' || patientType === 'IP') {
      where.push('patient_type = ?');
      params.push(patientType);
    }
    if (options.status) {
      where.push('claim_status = ?');
      params.push(options.status);
    }
    if (options.startDate) {
      where.push('DATE(COALESCE(discharge_datetime, service_datetime, admit_datetime, sent_at)) >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      where.push('DATE(COALESCE(discharge_datetime, service_datetime, admit_datetime, sent_at)) <= ?');
      params.push(options.endDate);
    }
    if (options.search) {
      where.push('(claim_code LIKE ? OR upload_uid LIKE ? OR hn LIKE ? OR vn LIKE ? OR an LIKE ?)');
      const q = `%${options.search}%`;
      params.push(q, q, q, q, q);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(options.limit || 200), 1), 1000);
    const [rows] = await connection.query(
      `SELECT id, batch_id, row_no, claim_code, hn, vn, an, patient_type, service_datetime, admit_datetime,
              discharge_datetime, privilege_use, sent_at, upload_uid, maininscl, claim_status, raw_data, created_at
       FROM fdh_claim_detail_row
       ${whereSql}
       ORDER BY COALESCE(sent_at, discharge_datetime, service_datetime, admit_datetime, created_at) DESC, id DESC
       LIMIT ?`,
      [...params, limit]
    );
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } finally {
    connection.release();
  }
};

export const getRepDataRows = async (
  limit = 200,
  visit: { vn?: string; an?: string; hn?: string } = {}
): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(REP_DATA_TABLE_SQL);
    const visitConditions: string[] = [];
    const visitParams: string[] = [];
    if (visit.vn) { visitConditions.push('vn = ?'); visitParams.push(visit.vn); }
    if (visit.an) { visitConditions.push('an = ?'); visitParams.push(visit.an); }
    const [rows] = await connection.query(
      `SELECT id, batch_id, rep_no, seq_no, tran_id, hcode, hn, vn, an, pid, patient_name, patient_type, department,
              admdate, dchdate, senddate, maininscl, subinscl, errorcode, verifycode, projectcode, filename,
              percentpay, income, compensated, nhso, agency, hc, ae, inst, op, ip, dmis, drug, ontop,
              diff, down_amount, up_amount, yymm, yearbudget, raw_data, created_at
       FROM rep_data
       ${visitConditions.length ? `WHERE (${visitConditions.join(' OR ')})` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [...visitParams, limit]
    );
    const repRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    if (repRows.length === 0) return [];

    // FDH ClaimDetail stores the latest claim state for each VN/AN. Attach it to
    // every REP attempt so the C/Deny tracker can identify explicit unclaim cases.
    const latestFdhByVisit = new Map<string, Record<string, unknown>>();
    try {
      await connection.query(FDH_CLAIM_DETAIL_ROW_TABLE_SQL);
      const [fdhRows] = await connection.query(
        `SELECT vn, an, claim_status, sent_at, created_at
         FROM fdh_claim_detail_row
         ORDER BY COALESCE(sent_at, created_at) DESC, id DESC`
      );
      for (const row of (Array.isArray(fdhRows) ? fdhRows : []) as Record<string, unknown>[]) {
        const vn = String(row.vn || '').trim();
        const an = String(row.an || '').trim();
        if (vn && !latestFdhByVisit.has(`VN:${vn}`)) latestFdhByVisit.set(`VN:${vn}`, row);
        if (an && !latestFdhByVisit.has(`AN:${an}`)) latestFdhByVisit.set(`AN:${an}`, row);
      }
    } catch (error) {
      console.warn('Unable to attach FDH claim status to REP rows:', error);
    }

    return repRows.map((row) => {
      const an = String(row.an || '').trim();
      const vn = String(row.vn || '').trim();
      const fdh = (an ? latestFdhByVisit.get(`AN:${an}`) : undefined)
        ?? (vn ? latestFdhByVisit.get(`VN:${vn}`) : undefined);
      return {
        ...row,
        latest_fdh_status: fdh?.claim_status || null,
        latest_fdh_at: fdh?.sent_at || fdh?.created_at || null,
      };
    });
  } catch (error) {
    console.error('Error reading REP normalized rows:', error);
    return [];
  } finally {
    connection.release();
  }
};

export interface ReceivableQueryParams {
  startDate?: string;
  endDate?: string;
  patientType?: 'ALL' | 'OPD' | 'IPD' | string;
  patientRight?: string;
  hosxpRight?: string;
  financeRight?: string;
  /** Max rows to return per patient type (OPD / IPD). Default unlimited. */
  limit?: number;
  /** Offset for pagination. Default 0. */
  offset?: number;
}

export interface ReceivableBatchPayload extends ReceivableQueryParams {
  createdBy?: string;
  notes?: string;
  openingBalance?: number | string;
  collectedAmount?: number | string;
  closingBalance?: number | string;
  items: Record<string, unknown>[];
}

const toReceivableNumber = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const normalizeRightFilter = (value?: string) => {
  const normalized = String(value || 'ALL').trim().toUpperCase();
  return normalized || 'ALL';
};

const buildRightFilterSql = (fieldAlias: string, params: unknown[], patientRight?: string) => {
  const right = normalizeRightFilter(patientRight);
  if (right === 'ALL' || right === 'ทั้งหมด') return '';
  if (right === 'UCS') return ` AND (${fieldAlias} IN ('UCS', 'WEL') OR ${fieldAlias} LIKE 'UC%')`;
  if (right === 'OFC') return ` AND (${fieldAlias} IN ('OFC', 'BKK', 'PTY') OR ${fieldAlias} LIKE 'A%')`;
  if (right === 'SSS') return ` AND (${fieldAlias} LIKE 'SS%' OR ${fieldAlias} = 'SSI')`;
  if (right === 'LGO') return ` AND ${fieldAlias} = 'LGO'`;
  params.push(right);
  return ` AND ${fieldAlias} = ?`;
};

const isAllFilter = (value?: string) => {
  const normalized = String(value || 'ALL').trim().toUpperCase();
  return !normalized || normalized === 'ALL' || normalized === 'ทั้งหมด';
};

const buildExactFilterSql = (fieldAlias: string, params: unknown[], value?: string) => {
  if (isAllFilter(value)) return '';
  params.push(String(value).trim());
  return ` AND ${fieldAlias} = ?`;
};

const buildFinanceRightFilterSql = (fieldAlias: string, params: unknown[], financeRight?: string) => {
  if (isAllFilter(financeRight)) return '';
  const codes = RECEIVABLE_RIGHT_MAPPINGS
    .filter((item) => item.finance_code === String(financeRight).trim())
    .map((item) => item.hosxp_code)
    .filter(Boolean);

  if (codes.length === 0) {
    params.push('__NO_MATCH__');
    return ` AND ${fieldAlias} = ?`;
  }

  params.push(...codes);
  return ` AND ${fieldAlias} IN (${codes.map(() => '?').join(',')})`;
};

const findReceivableMapping = (pttype?: unknown, hipdataCode?: unknown): ReceivableRightMapping | null => {
  const code = String(pttype || '').trim().toUpperCase();
  const hipdata = String(hipdataCode || '').trim().toUpperCase();
  const exactMapping = RECEIVABLE_RIGHT_MAPPINGS.find((item) => item.hosxp_code.toUpperCase() === code);
  if (exactMapping) return exactMapping;
  // A HOSxP right is the accounting rule key. Falling back from an unknown
  // HOSxP code to the first row with the same HIPDATA code can silently choose
  // the wrong finance/debtor account because many local rights share HIPDATA.
  if (code) return null;
  return RECEIVABLE_RIGHT_MAPPINGS.find((item) => item.hipdata_code.toUpperCase() === hipdata) || null;
};

const isWholeVisitReceivableHipdata = (hipdataCode?: unknown) => {
  const hipdata = String(hipdataCode || '').trim().toUpperCase();
  return hipdata === 'OFC' || hipdata === 'LGO';
};

const resolveReceivableAccount = (
  row: Record<string, unknown>,
  mapping: ReceivableRightMapping | null,
  isIpd: boolean,
) => {
  const sourceText = [
    row.pttype,
    row.pttype_name,
    mapping?.hosxp_code,
    mapping?.hosxp_name,
    mapping?.finance_code,
    mapping?.finance_name,
  ].map((value) => String(value || '').trim()).join(' ');

  let debtorCode = isIpd ? mapping?.debtor_ipd || '' : mapping?.debtor_opd || '';
  let revenueCode = isIpd ? mapping?.revenue_ipd || '' : mapping?.revenue_opd || '';

  const isCr = /\bCR\b/i.test(sourceText) || sourceText.includes('บริการเฉพาะ');
  const isOpRefer = /OP\s*Refer/i.test(sourceText) || sourceText.includes('รับส่งต่อ');
  const isPp = debtorCode === '1102050101.209'
    || revenueCode === '4301020105.223'
    || sourceText.includes('PP')
    || sourceText.includes('P&P')
    || sourceText.includes('สร้างเสริมสุขภาพ');

  if (isOpRefer) {
    debtorCode = '1102050101.222';
    revenueCode = '4301020105.263';
  } else if (isCr) {
    debtorCode = isIpd ? '1102050101.217' : '1102050101.216';
    revenueCode = isIpd ? '4301020105.245' : '4301020105.244';
  } else if (isPp) {
    debtorCode = '1102050101.209';
    revenueCode = '4301020105.223';
  }

  let accountGroup = 'อื่น ๆ / รอตรวจสอบ';
  let paymentSource = 'other';
  let pricingMethod = 'ตามสิทธิ/เงื่อนไขบริการ';

  if (isOpRefer || debtorCode === '1102050101.222' || revenueCode === '4301020105.263') {
    accountGroup = 'OP Refer';
    paymentSource = 'clearing_house';
    pricingMethod = 'fee schedule';
  } else if (isCr || ['1102050101.216', '1102050101.217'].includes(debtorCode)) {
    accountGroup = 'UC บริการเฉพาะ (CR)';
    paymentSource = 'CR';
    pricingMethod = 'ตามรายการบริการเฉพาะ';
  } else if (debtorCode === '1102050101.209') {
    accountGroup = 'P&P / PPFS';
    paymentSource = 'PPFS';
    pricingMethod = 'fee schedule / flat rate';
  } else if (debtorCode === '1102050101.201' || debtorCode === '1102050101.202') {
    accountGroup = isIpd ? 'UC IP ปกติ' : 'UC OP ใน CUP';
    paymentSource = 'UC';
    pricingMethod = isIpd ? 'DRG / global budget' : 'เหมาจ่ายรายหัว/OP';
  } else if (String(mapping?.hipdata_code || '').toUpperCase().startsWith('SS')) {
    accountGroup = 'ประกันสังคม';
    paymentSource = 'SSS';
    pricingMethod = 'ตามประกาศประกันสังคม';
  } else if (['OFC', 'LGO'].includes(String(mapping?.hipdata_code || '').toUpperCase())) {
    accountGroup = 'เบิกจ่ายตรง';
    paymentSource = String(mapping?.hipdata_code || '').toUpperCase();
    pricingMethod = 'เบิกได้ทั้ง Visit';
  }

  return { debtorCode, revenueCode, accountGroup, paymentSource, pricingMethod };
};

const enrichReceivableRow = (row: Record<string, unknown>) => {
  const mapping = findReceivableMapping(row.pttype, row.hipdata_code);
  const isIpd = String(row.patient_type || '').toUpperCase() === 'IPD';
  const account = resolveReceivableAccount(row, mapping, isIpd);
  const totalIncome = toReceivableNumber(row.total_income);
  const isWholeVisit = isWholeVisitReceivableHipdata(row.hipdata_code) || mapping?.finance_code === '07';
  const claimableAmount = isWholeVisit
    ? totalIncome
    : toReceivableNumber(row.claimable_amount);
  const hipdata = String(row.hipdata_code || '').trim().toUpperCase();

  return {
    ...row,
    claimable_amount: claimableAmount,
    item_count: isWholeVisit ? Math.max(toReceivableNumber(row.item_count), 1) : row.item_count,
    claim_summary: isWholeVisit
      ? `เบิกได้ทั้ง Visit (${hipdata})`
      : row.claim_summary,
    hosxp_right_code: row.pttype || '',
    hosxp_right_name: row.pttype_name || '',
    finance_right_code: mapping?.finance_code || '',
    finance_right_name: mapping?.finance_name || '',
    debtor_code: account.debtorCode,
    revenue_code: account.revenueCode,
    account_group: account.accountGroup,
    payment_source: account.paymentSource,
    pricing_method: account.pricingMethod,
    receipt_no: row.receipt_no || '',
    receipt_amount: row.receipt_amount == null ? null : toReceivableNumber(row.receipt_amount),
    receipt_date: row.receipt_date || null,
    payment_type_code: mapping?.payment_type_code || '',
    payment_type_name: mapping?.payment_type_name || '',
    rep_amount: null,
    diff_amount: null,
    compare_status: null,
  };
};

export const getReceivableFilterOptions = async () => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT pttype AS code, name, hipdata_code
       FROM pttype
       ORDER BY pttype`
    );
    const hosxpRights = (Array.isArray(rows) ? rows : [])
      .map((row) => row as Record<string, unknown>)
      .map((row) => ({
        code: String(row.code || '').trim(),
        name: String(row.name || '').trim(),
        hipdata_code: String(row.hipdata_code || '').trim(),
      }))
      .filter((row) => row.code);

    const financeRights = Array.from(
      new Map(
        RECEIVABLE_RIGHT_MAPPINGS
          .filter((item) => item.finance_code)
          .map((item) => [item.finance_code, { code: item.finance_code, name: item.finance_name }])
      ).values()
    ).sort((a, b) => a.code.localeCompare(b.code, 'th'));

    return { hosxpRights, financeRights };
  } catch (error) {
    console.error('Error reading receivable filter options:', error);
    return {
      hosxpRights: RECEIVABLE_RIGHT_MAPPINGS
        .map((item) => ({ code: item.hosxp_code, name: item.hosxp_name, hipdata_code: item.hipdata_code })),
      financeRights: Array.from(
        new Map(
          RECEIVABLE_RIGHT_MAPPINGS
            .filter((item) => item.finance_code)
            .map((item) => [item.finance_code, { code: item.finance_code, name: item.finance_name }])
        ).values()
      ),
    };
  } finally {
    connection.release();
  }
};

const RECEIVABLE_CLAIMABLE_ITEM_SQL = `
  SELECT
    item.vn,
    SUM(item.claim_amount) AS claimable_amount,
    COUNT(*) AS item_count,
    GROUP_CONCAT(DISTINCT item.claim_label ORDER BY item.claim_label SEPARATOR ', ') AS claim_summary
  FROM (
    SELECT
      oo.vn,
      COALESCE(oo.sum_price, oo.qty * oo.unitprice, 0) AS claim_amount,
      CASE
        WHEN COALESCE(sd.nhso_adp_code, '') <> '' THEN CONCAT('ADP ', sd.nhso_adp_code)
        WHEN COALESCE(sd.ttmt_code, '') <> '' OR COALESCE(di.ttmt_code, '') <> '' THEN 'ยา/สมุนไพร TTMT'
        WHEN COALESCE(sd.tmlt_code, '') <> '' THEN 'Lab TMLT'
        WHEN UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'สมุนไพร|ยาไทย|HERB' THEN 'ยาสมุนไพร/ยาไทย'
        WHEN UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'ARMSLING|ARM SLING|SLING' THEN 'อุปกรณ์ Armsling'
        WHEN UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'ค่าบริการผู้ป่วยนอก|ผู้ป่วยนอก|OPD' THEN 'ค่าบริการผู้ป่วยนอก'
        ELSE 'รายการเบิกได้'
      END AS claim_label
    FROM opitemrece oo
    LEFT JOIN income inc ON inc.income = oo.income
    LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
    LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
    LEFT JOIN drugitems di ON di.icode = oo.icode
    WHERE oo.vstdate BETWEEN ? AND ?
      AND COALESCE(oo.sum_price, oo.qty * oo.unitprice, 0) > 0
      AND UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) NOT REGEXP 'อุดฟัน|ถอนฟัน|ทันต|DENTAL'
      AND (
        COALESCE(sd.nhso_adp_code, '') <> ''
        OR COALESCE(sd.ttmt_code, '') <> ''
        OR COALESCE(di.ttmt_code, '') <> ''
        OR COALESCE(sd.tmlt_code, '') <> ''
        OR UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'สมุนไพร|ยาไทย|HERB|ARMSLING|ARM SLING|SLING|ค่าบริการผู้ป่วยนอก|ผู้ป่วยนอก|OPD'
      )
  ) item
  GROUP BY item.vn
`;

const attachRepComparison = async (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return rows;
  const connection = await getRepstmConnection();
  try {
    await connection.query(REP_DATA_TABLE_SQL);
    const vns = Array.from(new Set(rows.map(row => String(row.vn || '').trim()).filter(Boolean)));
    const ans = Array.from(new Set(rows.map(row => String(row.an || '').trim()).filter(Boolean)));
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (vns.length > 0) {
      clauses.push(`vn IN (${vns.map(() => '?').join(',')})`);
      params.push(...vns);
    }
    if (ans.length > 0) {
      clauses.push(`an IN (${ans.map(() => '?').join(',')})`);
      params.push(...ans);
    }

    if (clauses.length === 0) return rows;

    const [repRows] = await connection.query(
      `SELECT
         COALESCE(vn, '') AS vn,
         COALESCE(an, '') AS an,
         MAX(COALESCE(compensated, nhso, agency, 0)) AS rep_amount,
         GROUP_CONCAT(DISTINCT rep_no ORDER BY rep_no SEPARATOR ', ') AS rep_no
       FROM rep_data
       WHERE ${clauses.join(' OR ')}
       GROUP BY COALESCE(vn, ''), COALESCE(an, '')`,
      params
    );

    const repMap = new Map<string, Record<string, unknown>>();
    (Array.isArray(repRows) ? repRows : []).forEach((repRow) => {
      const record = repRow as Record<string, unknown>;
      const vn = String(record.vn || '').trim();
      const an = String(record.an || '').trim();
      if (vn) repMap.set(`VN:${vn}`, record);
      if (an) repMap.set(`AN:${an}`, record);
    });

    return rows.map((row) => {
      const vn = String(row.vn || '').trim();
      const an = String(row.an || '').trim();
      const rep = (vn && repMap.get(`VN:${vn}`)) || (an && repMap.get(`AN:${an}`)) || null;
      const claimableAmount = toReceivableNumber(row.claimable_amount);
      const repAmount = rep ? toReceivableNumber(rep.rep_amount) : null;
      return {
        ...row,
        rep_amount: repAmount,
        rep_no: rep?.rep_no || null,
        diff_amount: repAmount == null ? null : repAmount - claimableAmount,
        compare_status: repAmount == null
          ? 'รอ REP/STM'
          : Math.abs(repAmount - claimableAmount) < 0.01
            ? 'ตรงกัน'
            : 'ยอดต่าง',
      };
    });
  } catch (error) {
    console.error('Error comparing receivable with REP data:', error);
    return rows.map(row => ({
      ...row,
      rep_amount: null,
      diff_amount: null,
      compare_status: 'ยังไม่ได้เทียบ REP/STM',
    }));
  } finally {
    connection.release();
  }
};

export const countReceivableCandidates = async (params: Omit<ReceivableQueryParams, 'limit' | 'offset'>): Promise<number> => {
  const startDate = String(params.startDate || '').slice(0, 10);
  const endDate = String(params.endDate || startDate || '').slice(0, 10);
  const patientType = String(params.patientType || 'ALL').toUpperCase();
  const connection = await getUTFConnection();
  try {
    let total = 0;
    if (patientType === 'ALL' || patientType === 'OPD') {
      const opdParams: unknown[] = [startDate, endDate];
      const rightSql = buildRightFilterSql('ptt.hipdata_code', opdParams, params.patientRight);
      const hosxpSql = buildExactFilterSql('o.pttype', opdParams, params.hosxpRight);
      const financeSql = buildFinanceRightFilterSql('o.pttype', opdParams, params.financeRight);
      const [cntRows] = await connection.query(
        `SELECT COUNT(*) AS cnt
         FROM ovst o
         LEFT JOIN patient pt ON pt.hn = o.hn
         LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
         LEFT JOIN vn_stat v ON v.vn = o.vn
         WHERE o.vstdate BETWEEN ? AND ?
           AND COALESCE(v.income, 0) > 0
           ${rightSql}
           ${hosxpSql}
           ${financeSql}`,
        opdParams
      );
      total += Number((Array.isArray(cntRows) ? (cntRows[0] as Record<string, unknown>)?.cnt : 0) ?? 0);
    }
    if (patientType === 'ALL' || patientType === 'IPD') {
      const ipdParams: unknown[] = [startDate, endDate];
      const rightSql = buildRightFilterSql('ptt.hipdata_code', ipdParams, params.patientRight);
      const hosxpSql = buildExactFilterSql('i.pttype', ipdParams, params.hosxpRight);
      const financeSql = buildFinanceRightFilterSql('i.pttype', ipdParams, params.financeRight);
      const [cntRows] = await connection.query(
        `SELECT COUNT(*) AS cnt
         FROM ipt i
         LEFT JOIN patient pt ON pt.hn = i.hn
         LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
         LEFT JOIN an_stat a ON a.an = i.an
         WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
           AND (
             CASE
               WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
               ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
             END
           ) > 0
           ${rightSql}
           ${hosxpSql}
           ${financeSql}`,
        ipdParams
      );
      total += Number((Array.isArray(cntRows) ? (cntRows[0] as Record<string, unknown>)?.cnt : 0) ?? 0);
    }
    return total;
  } catch (err) {
    console.error('Error counting receivable candidates:', err);
    return 0;
  } finally {
    connection.release();
  }
};

export const getReceivableCandidates = async (params: ReceivableQueryParams): Promise<Record<string, unknown>[]> => {
  const startDate = String(params.startDate || '').slice(0, 10);
  const endDate = String(params.endDate || startDate || '').slice(0, 10);
  const patientType = String(params.patientType || 'ALL').toUpperCase();
  const rowLimit = params.limit != null ? Math.max(1, Number(params.limit)) : null;
  const rowOffset = params.offset != null ? Math.max(0, Number(params.offset)) : 0;
  const connection = await getUTFConnection();

  try {
    const resultRows: Record<string, unknown>[] = [];

    if (patientType === 'ALL' || patientType === 'OPD') {
      // Step A: get paginated VNs (fast - simple join, no heavy subqueries)
      const vnFilterParams: unknown[] = [startDate, endDate];
      const rightSqlVn = buildRightFilterSql('ptt.hipdata_code', vnFilterParams, params.patientRight);
      const hosxpSqlVn = buildExactFilterSql('o.pttype', vnFilterParams, params.hosxpRight);
      const financeSqlVn = buildFinanceRightFilterSql('o.pttype', vnFilterParams, params.financeRight);
      const limitSql = rowLimit != null ? ` LIMIT ${rowLimit} OFFSET ${rowOffset}` : '';
      const [vnRows] = await connection.query(
        `SELECT o.vn
         FROM ovst o
         LEFT JOIN patient pt ON pt.hn = o.hn
         LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
         LEFT JOIN vn_stat v ON v.vn = o.vn
         WHERE o.vstdate BETWEEN ? AND ?
           AND COALESCE(v.income, 0) > 0
           ${rightSqlVn}
           ${hosxpSqlVn}
           ${financeSqlVn}
         ORDER BY o.vstdate, o.vn${limitSql}`,
        vnFilterParams
      );
      const pagedVns = (Array.isArray(vnRows) ? vnRows : []).map((r) => String((r as Record<string, unknown>).vn || '').trim()).filter(Boolean);

      if (pagedVns.length > 0) {
        // Step B: enrich only the paged VNs — filter all subqueries by VN list (fast, no full table scan)
        const vnPlaceholders = pagedVns.map(() => '?').join(',');
        // param order: startDate, endDate (claimItem), pagedVns (claimItem vn IN),
        //              startDate, endDate (item_count), pagedVns (item_count vn IN),
        //              pagedVns (rcpt_print), pagedVns (main IN)
        const enrichParams: unknown[] = [
          startDate, endDate, ...pagedVns,  // claimItemSql: vstdate BETWEEN + vn IN
          startDate, endDate, ...pagedVns,  // item_count: vstdate BETWEEN + vn IN
          ...pagedVns,                       // rcpt_print: rp.vn IN
          ...pagedVns,                       // main WHERE o.vn IN
        ];
        const claimItemSql = `
  SELECT
    item.vn,
    SUM(item.claim_amount) AS claimable_amount,
    COUNT(*) AS item_count,
    GROUP_CONCAT(DISTINCT item.claim_label ORDER BY item.claim_label SEPARATOR ', ') AS claim_summary
  FROM (
    SELECT
      oo.vn,
      COALESCE(oo.sum_price, oo.qty * oo.unitprice, 0) AS claim_amount,
      CASE
        WHEN COALESCE(sd.nhso_adp_code, '') <> '' THEN CONCAT('ADP ', sd.nhso_adp_code)
        WHEN COALESCE(sd.ttmt_code, '') <> '' OR COALESCE(di.ttmt_code, '') <> '' THEN 'ยา/สมุนไพร TTMT'
        WHEN COALESCE(sd.tmlt_code, '') <> '' THEN 'Lab TMLT'
        WHEN UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'สมุนไพร|ยาไทย|HERB' THEN 'ยาสมุนไพร/ยาไทย'
        WHEN UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'ARMSLING|ARM SLING|SLING' THEN 'อุปกรณ์ Armsling'
        WHEN UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'ค่าบริการผู้ป่วยนอก|ผู้ป่วยนอก|OPD' THEN 'ค่าบริการผู้ป่วยนอก'
        ELSE 'รายการเบิกได้'
      END AS claim_label
    FROM opitemrece oo
    LEFT JOIN income inc ON inc.income = oo.income
    LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
    LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
    LEFT JOIN drugitems di ON di.icode = oo.icode
    WHERE oo.vstdate BETWEEN ? AND ?
      AND oo.vn IN (${vnPlaceholders})
      AND COALESCE(oo.sum_price, oo.qty * oo.unitprice, 0) > 0
      AND UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) NOT REGEXP 'อุดฟัน|ถอนฟัน|ทันต|DENTAL'
      AND (
        COALESCE(sd.nhso_adp_code, '') <> ''
        OR COALESCE(sd.ttmt_code, '') <> ''
        OR COALESCE(di.ttmt_code, '') <> ''
        OR COALESCE(sd.tmlt_code, '') <> ''
        OR UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(ndi.name, ''), COALESCE(sd.name, ''), COALESCE(di.name, ''))) REGEXP 'สมุนไพร|ยาไทย|HERB|ARMSLING|ARM SLING|SLING|ค่าบริการผู้ป่วยนอก|ผู้ป่วยนอก|OPD'
      )
  ) item
  GROUP BY item.vn
`;
        const [opdRows] = await connection.query(
          `SELECT
             'OPD' AS patient_type,
             o.vn,
             '' AS an,
             o.hn,
             pt.cid,
             CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
             o.pttype,
             ptt.name AS pttype_name,
             ptt.hipdata_code,
             COALESCE(o.hospmain, '') AS hospmain,
             DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
             DATE_FORMAT(CONCAT(o.vstdate, ' ', COALESCE(o.vsttime, '00:00:00')), '%Y-%m-%d %H:%i:%s') AS service_datetime,
             COALESCE(v.income, 0) AS total_income,
             CASE
               WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(v.income, 0)
               ELSE claim.claimable_amount
             END AS claimable_amount,
             CASE
               WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN GREATEST(COALESCE(item_count.count_item, 0), 1)
               ELSE claim.item_count
             END AS item_count,
             CASE
               WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN CONCAT('เบิกได้ทั้ง Visit (', UPPER(COALESCE(ptt.hipdata_code, '')), ')')
               ELSE claim.claim_summary
             END AS claim_summary,
             rcpt.receipt_no,
             rcpt.receipt_amount,
             rcpt.receipt_date
           FROM ovst o
           LEFT JOIN (${claimItemSql}) claim ON claim.vn = o.vn
           LEFT JOIN (
             SELECT vn, COUNT(*) AS count_item
             FROM opitemrece
             WHERE vstdate BETWEEN ? AND ?
               AND vn IN (${vnPlaceholders})
             GROUP BY vn
           ) item_count ON item_count.vn = o.vn
           LEFT JOIN (
             SELECT
               rp.vn,
               GROUP_CONCAT(DISTINCT rp.rcpno ORDER BY rp.finance_number SEPARATOR ', ') AS receipt_no,
               ROUND(SUM(COALESCE(rp.total_amount, 0)), 2) AS receipt_amount,
               DATE_FORMAT(MAX(rp.bill_date_time), '%Y-%m-%d') AS receipt_date
             FROM rcpt_print rp
             WHERE rp.vn IN (${vnPlaceholders})
               AND COALESCE(rp.status, '') NOT REGEXP 'Abort'
             GROUP BY rp.vn
           ) rcpt ON rcpt.vn = o.vn
           LEFT JOIN patient pt ON pt.hn = o.hn
           LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
           LEFT JOIN vn_stat v ON v.vn = o.vn
           WHERE o.vn IN (${vnPlaceholders})
           ORDER BY o.vstdate, o.vn`,
          enrichParams
        );
        if (Array.isArray(opdRows)) resultRows.push(...(opdRows as Record<string, unknown>[]));
      }
    }

    if (patientType === 'ALL' || patientType === 'IPD') {
      const ipdParams: unknown[] = [startDate, endDate];
      const rightSql = buildRightFilterSql('ptt.hipdata_code', ipdParams, params.patientRight);
      const hosxpSql = buildExactFilterSql('i.pttype', ipdParams, params.hosxpRight);
      const financeSql = buildFinanceRightFilterSql('i.pttype', ipdParams, params.financeRight);
      const ipdLimitSql = rowLimit != null ? ` LIMIT ${rowLimit} OFFSET ${rowOffset}` : '';
      const [ipdRows] = await connection.query(
        `SELECT
           'IPD' AS patient_type,
           '' AS vn,
           i.an,
           i.hn,
           pt.cid,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           i.pttype,
           ptt.name AS pttype_name,
           ptt.hipdata_code,
           COALESCE(ov.hospmain, '') AS hospmain,
           DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%Y-%m-%d') AS service_date,
           DATE_FORMAT(CONCAT(COALESCE(i.regdate, i.dchdate), ' ', COALESCE(i.regtime, '00:00:00')), '%Y-%m-%d %H:%i:%s') AS service_datetime,
           COALESCE(a.income, 0) AS total_income,
           CASE
             WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
             ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
           END AS claimable_amount,
           1 AS item_count,
           CASE
             WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN CONCAT('เบิกได้ทั้ง Visit (', UPPER(COALESCE(ptt.hipdata_code, '')), ')')
             ELSE 'ผู้ป่วยใน: ตั้งลูกหนี้จากยอดค่ารักษาหลังหักรับชำระ/ส่วนลด'
           END AS claim_summary,
           '' AS receipt_no,
           NULL AS receipt_amount,
           NULL AS receipt_date
         FROM ipt i
         LEFT JOIN ovst ov ON ov.vn = i.vn
         LEFT JOIN patient pt ON pt.hn = i.hn
         LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
         LEFT JOIN an_stat a ON a.an = i.an
         WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
           AND (
             CASE
               WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
               ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
             END
           ) > 0
           ${rightSql}
           ${hosxpSql}
           ${financeSql}
         ORDER BY COALESCE(i.dchdate, i.regdate), i.an${ipdLimitSql}`,
        ipdParams
      );
      if (Array.isArray(ipdRows)) resultRows.push(...(ipdRows as Record<string, unknown>[]));   
    }

    return resultRows
      .map(enrichReceivableRow)
      .filter((row) => toReceivableNumber(row.claimable_amount) > 0);
  } catch (error) {
    console.error('Error reading receivable candidates:', error);
    throw error;
  } finally {
    connection.release();
  }
};

export const getReceivableBatches = async (limit = 50): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await ensureRepstmTables();
    const [rows] = await connection.query(
      `SELECT id, batch_no, patient_type, start_date, end_date, created_by, notes, item_count, total_receivable,
              COALESCE(opening_balance, 0) AS opening_balance,
              COALESCE(collected_amount, 0) AS collected_amount,
              COALESCE(closing_balance, 0) AS closing_balance,
              created_at
       FROM receivable_batch
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit]
    );
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } catch (error) {
    console.error('Error reading receivable batches:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const getReceivableLatestBalance = async (params: {
  beforeDate?: string;
  patientType?: string;
}): Promise<{
  previousBatchNo?: string;
  previousEndDate?: string;
  suggestedOpeningBalance: number;
}> => {
  const connection = await getRepstmConnection();
  try {
    await ensureRepstmTables();
    const conditions: string[] = [];
    const sqlParams: unknown[] = [];
    if (params.beforeDate) {
      conditions.push('end_date <= ?');
      sqlParams.push(params.beforeDate);
    }
    if (params.patientType && params.patientType !== 'ALL') {
      conditions.push('(patient_type = ? OR patient_type = "ALL")');
      sqlParams.push(params.patientType);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await connection.query(
      `SELECT batch_no, end_date, closing_balance, total_receivable
       FROM receivable_batch
       ${whereClause}
       ORDER BY end_date DESC, id DESC
       LIMIT 1`,
      sqlParams
    );
    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0] as any;
      const closing = Number(row.closing_balance ?? row.total_receivable ?? 0);
      return {
        previousBatchNo: row.batch_no,
        previousEndDate: row.end_date,
        suggestedOpeningBalance: Number.isFinite(closing) ? closing : 0,
      };
    }
    return { suggestedOpeningBalance: 0 };
  } catch (error) {
    console.error('Error reading receivable latest balance:', error);
    return { suggestedOpeningBalance: 0 };
  } finally {
    connection.release();
  }
};

export const getStatementVisitRows = async (
  dataType: 'STM' | 'INV',
  limit = 200,
  visit: { vn?: string; an?: string; hn?: string } = {}
): Promise<Record<string, unknown>[]> => {
  await ensureRepstmTables();
  await repairLegacyStatementAmounts();
  const connection = await getRepstmConnection();
  try {
    const visitConditions: string[] = [];
    const visitParams: string[] = [];
    if (visit.vn) { visitConditions.push('s.vn = ?'); visitParams.push(visit.vn); }
    if (visit.an) { visitConditions.push('s.an = ?'); visitParams.push(visit.an); }
    const [rows] = await connection.query(
      `SELECT s.id, s.batch_id, s.data_type, s.record_uid, s.statement_no, s.tran_id,
              s.hn, s.vn, s.an, s.pid, s.patient_name, s.patient_type, s.department,
              s.service_datetime AS service_date, s.senddate, s.maininscl, s.subinscl,
              s.errorcode, s.verifycode, s.amount, s.paid_amount, s.invoice_amount,
              s.filename, s.filename AS source_filename, s.matched_visit_code, s.matched_status,
              s.raw_data, s.created_at
       FROM repstm_statement_data s
       JOIN repstm_import_batch b ON b.id = s.batch_id
       WHERE s.data_type = ?
         AND NOT EXISTS (
           SELECT 1
           FROM repstm_import_batch replacement
           WHERE replacement.replaces_batch_id = b.id
         )
         ${visitConditions.length ? `AND (${visitConditions.join(' OR ')})` : ''}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ?`,
      [dataType, ...visitParams, limit]
    );
    if (!Array.isArray(rows)) return [];

    const seen = new Set<string>();
    return (rows as Record<string, unknown>[]).filter((row) => {
      const tranId = normalizeImportCellValue(row.tran_id);
      const statementNo = normalizeImportCellValue(row.statement_no);
      const visitCode = normalizeImportCellValue(row.an || row.vn || row.matched_visit_code || row.hn);
      const identity = tranId
        ? `${dataType}:TRAN:${tranId}`
        : statementNo
          ? `${dataType}:STATEMENT:${statementNo}:${visitCode}`
          : [
              dataType,
              visitCode,
              normalizeImportCellValue(row.service_date),
              normalizeImportCellValue(row.amount),
              normalizeImportCellValue(row.paid_amount),
              normalizeImportCellValue(row.invoice_amount),
              normalizeImportCellValue(row.errorcode),
              normalizeImportCellValue(row.verifycode),
              normalizeImportCellValue(row.filename),
            ].join('|');
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  } catch (error) {
    console.error('Error reading normalized STM/INV visit rows:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ---- Reconciliation: Compare claimable amounts vs REP/STM/INV per visit ----

export interface ReconciliationQueryParams {
  startDate?: string;
  endDate?: string;
  patientType?: string;
  claimStatus?: string;
  patientRight?: string;
  hosxpRight?: string;
  financeRight?: string;
  paymentSource?: string;
  compareStatus?: string;
  hmain?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ReconciliationRow {
  patient_type: string;
  visit_key: string;
  vn: string;
  an: string;
  hn: string;
  cid: string | null;
  patient_name: string;
  pttype: string;
  pttype_name: string;
  hipdata_code: string;
  hospmain: string;
  service_datetime: string | null;
  account_group?: string;
  payment_source?: string;
  claim_summary?: string;
  service_date: string;
  claimable_amount: number;
  rep_amount: number | null;
  rep_no: string | null;
  rep_tran_id: string | null;
  rep_senddate: string | null;
  rep_imported_at: string | null;
  rep_errorcode: string | null;
  rep_verifycode: string | null;
  has_rep: boolean;
  stm_amount: number | null;
  stm_paid_amount: number | null;
  stm_statement_no: string | null;
  stm_imported_at: string | null;
  stm_errorcode: string | null;
  stm_verifycode: string | null;
  has_stm: boolean;
  inv_amount: number | null;
  inv_invoice_amount: number | null;
  inv_statement_no: string | null;
  inv_imported_at: string | null;
  has_inv: boolean;
  fdh_status: string | null;
  fdh_claim_code: string | null;
  fdh_sent_at: string | null;
  diff_rep: number | null;
  diff_stm: number | null;
  diff_stm_paid: number | null;
  diff_inv: number | null;
  compare_status: string;
  issue_status: string;
  days_to_rep: number | null;
  days_to_stm: number | null;
}

export const getVisitRepStmComparison = async (params: ReconciliationQueryParams): Promise<{
  data: ReconciliationRow[];
  total: number;
  group_summary: Array<{
    hmain: string;
    visits: number;
    claimable_amount: number;
    rep_amount: number;
    stm_paid_amount: number;
    inv_amount: number;
    outstanding_amount: number;
  }>;
  summary: {
    total_visits: number;
    matched: number;
    completed_inv: number;
    mismatched: number;
    pending_rep: number;
    pending_stm: number;
    no_data: number;
    total_claimable: number;
    total_rep: number;
    total_stm: number;
    total_stm_paid: number;
    total_inv: number;
    rep_issue: number;
    stm_zero: number;
    overpaid: number;
    underpaid: number;
  };
}> => {
  await ensureRepstmTables();
  await repairLegacyStatementAmounts();
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(params.startDate || today).slice(0, 10);
  const endDate = String(params.endDate || startDate).slice(0, 10);
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(500, Math.max(10, Number(params.pageSize || 100)));
  const compareStatusFilter = String(params.compareStatus || '').trim();

  // Step 1: load the full candidate set for the selected period so summary and filters are consistent.
  // The reconciliation page is an accounting page; correct totals are more important than page-only summaries.
  const candidateParams = {
    startDate,
    endDate,
    patientType: params.patientType,
    patientRight: params.patientRight,
    hosxpRight: params.hosxpRight,
    financeRight: params.financeRight,
  };

  const totalCount = await countReceivableCandidates(candidateParams);
  const scanLimit = totalCount;

  if (totalCount === 0) {
    const emptySummary = {
      total_visits: 0, matched: 0, completed_inv: 0, mismatched: 0, pending_rep: 0, pending_stm: 0,
      no_data: 0, total_claimable: 0, total_rep: 0, total_stm: 0, total_stm_paid: 0, total_inv: 0,
      rep_issue: 0, stm_zero: 0, overpaid: 0, underpaid: 0,
    };
    return { data: [], total: 0, summary: emptySummary, group_summary: [] };
  }

  const allBaseRows = await getReceivableCandidates({
    ...candidateParams,
    limit: scanLimit,
    offset: 0,
  });
  const paymentSourceFilter = String(params.paymentSource || '').trim().toUpperCase();
  const baseRows = paymentSourceFilter
    ? allBaseRows.filter((row) => String(row.payment_source || '').trim().toUpperCase() === paymentSourceFilter)
    : allBaseRows;

  if (baseRows.length === 0) {
    const emptySummary = {
      total_visits: 0, matched: 0, completed_inv: 0, mismatched: 0, pending_rep: 0, pending_stm: 0,
      no_data: 0, total_claimable: 0, total_rep: 0, total_stm: 0, total_stm_paid: 0, total_inv: 0,
      rep_issue: 0, stm_zero: 0, overpaid: 0, underpaid: 0,
    };
    return { data: [], total: 0, summary: emptySummary, group_summary: [] };
  }

  const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const toNumNull = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  const vns = Array.from(new Set(baseRows.map(r => String(r.vn || '').trim()).filter(Boolean)));
  const ans = Array.from(new Set(baseRows.map(r => String(r.an || '').trim()).filter(Boolean)));

  const repConnection = await getRepstmConnection();
  const repMap = new Map<string, {
    rep_amount: number;
    rep_no: string;
    tran_id: string;
    senddate: string | null;
    imported_at: string | null;
    errorcode: string;
    verifycode: string;
  }>();
  const repTranToVisit = new Map<string, string>();
  const stmMap = new Map<string, {
    stm_amount: number | null;
    stm_paid_amount: number | null;
    statement_no: string;
    imported_at: string | null;
    errorcode: string;
    verifycode: string;
  }>();
  const invMap = new Map<string, { inv_amount: number | null; inv_invoice_amount: number | null; statement_no: string; imported_at: string | null }>();
  const fdhMap = new Map<string, { status: string | null; claim_code: string | null; sent_at: string | null }>();

  try {
    // --- Step 2: Attach REP data ---
    const repClauses: string[] = [];
    const repParams: unknown[] = [];
    if (vns.length > 0) { repClauses.push(`vn IN (${vns.map(() => '?').join(',')})`); repParams.push(...vns); }
    if (ans.length > 0) { repClauses.push(`an IN (${ans.map(() => '?').join(',')})`); repParams.push(...ans); }

    if (repClauses.length > 0) {
      const [repRows] = await repConnection.query(
        `SELECT
           COALESCE(vn, '') AS vn,
           COALESCE(an, '') AS an,
           MAX(COALESCE(compensated, nhso, agency, 0)) AS rep_amount,
           GROUP_CONCAT(DISTINCT rep_no ORDER BY rep_no SEPARATOR ', ') AS rep_no,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(tran_id, '')), '') SEPARATOR ',') AS tran_id,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(errorcode, '')), '') SEPARATOR ', ') AS errorcode,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(verifycode, '')), '') SEPARATOR ', ') AS verifycode,
           MAX(senddate) AS senddate,
           MAX(b.created_at) AS imported_at
         FROM rep_data r
         LEFT JOIN repstm_import_batch b ON b.id = r.batch_id
         WHERE ${repClauses.join(' OR ')}
         GROUP BY COALESCE(vn, ''), COALESCE(an, '')`,
        repParams
      );
      (Array.isArray(repRows) ? repRows : []).forEach((r) => {
        const rec = r as Record<string, unknown>;
        const vn = String(rec.vn || '').trim();
        const an = String(rec.an || '').trim();
        const entry = {
          rep_amount: toNum(rec.rep_amount),
          rep_no: String(rec.rep_no || ''),
          tran_id: String(rec.tran_id || ''),
          senddate: formatTrackingDateTime(rec.senddate),
          imported_at: formatTrackingDateTime(rec.imported_at),
          errorcode: String(rec.errorcode || ''),
          verifycode: String(rec.verifycode || ''),
        };
        if (vn) repMap.set(`VN:${vn}`, entry);
        if (an) repMap.set(`AN:${an}`, entry);
        entry.tran_id.split(',').map((item) => item.trim()).filter(Boolean).forEach((tranId) => {
          repTranToVisit.set(tranId, vn || an || '');
        });
      });
    }

    // --- Attach the latest FDH status for the same visit only ---
    const fdhClauses: string[] = [];
    const fdhParams: unknown[] = [];
    if (vns.length > 0) { fdhClauses.push(`d.vn IN (${vns.map(() => '?').join(',')})`); fdhParams.push(...vns); }
    if (ans.length > 0) { fdhClauses.push(`d.an IN (${ans.map(() => '?').join(',')})`); fdhParams.push(...ans); }
    if (fdhClauses.length > 0) {
      const [fdhRows] = await repConnection.query(
        `SELECT d.vn, d.an, d.claim_status, d.claim_code, d.sent_at
         FROM fdh_claim_detail_row d
         JOIN (
           SELECT COALESCE(NULLIF(an, ''), NULLIF(vn, '')) AS visit_code, MAX(id) AS latest_id
           FROM fdh_claim_detail_row
           WHERE ${fdhClauses.map((clause) => clause.replaceAll('d.', '')).join(' OR ')}
           GROUP BY COALESCE(NULLIF(an, ''), NULLIF(vn, ''))
         ) latest ON latest.latest_id = d.id`,
        fdhParams
      );
      (Array.isArray(fdhRows) ? fdhRows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const entry = {
          status: String(rec.claim_status || '').trim() || null,
          claim_code: String(rec.claim_code || '').trim() || null,
          sent_at: formatTrackingDateTime(rec.sent_at),
        };
        const vn = String(rec.vn || '').trim();
        const an = String(rec.an || '').trim();
        if (vn) fdhMap.set(`VN:${vn}`, entry);
        if (an) fdhMap.set(`AN:${an}`, entry);
      });
    }

    if (vns.length > 0) {
      const [apiRows] = await repConnection.query(
        `SELECT s.vn, s.fdh_reservation_status, s.fdh_claim_status_message,
                s.transaction_uid, s.fdh_reservation_datetime, s.updated_at
         FROM fdh_claim_status s
         JOIN (SELECT vn, MAX(id) AS latest_id FROM fdh_claim_status
               WHERE vn IN (${vns.map(() => '?').join(',')}) GROUP BY vn) latest ON latest.latest_id = s.id`,
        vns
      );
      (Array.isArray(apiRows) ? apiRows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const vn = String(rec.vn || '').trim();
        if (!vn || fdhMap.has(`VN:${vn}`)) return;
        fdhMap.set(`VN:${vn}`, {
          status: String(rec.fdh_reservation_status || rec.fdh_claim_status_message || '').trim() || null,
          claim_code: String(rec.transaction_uid || '').trim() || null,
          sent_at: formatTrackingDateTime(rec.fdh_reservation_datetime || rec.updated_at),
        });
      });
    }

    // --- Step 3: Attach STM data ---
    const stmClauses: string[] = [];
    const stmParams: unknown[] = [];
    const repTranIds = Array.from(repTranToVisit.keys());
    if (vns.length > 0) {
      stmClauses.push(`s.matched_visit_code IN (${vns.map(() => '?').join(',')}) OR s.vn IN (${vns.map(() => '?').join(',')})`);
      stmParams.push(...vns, ...vns);
    }
    if (ans.length > 0) {
      stmClauses.push(`s.matched_visit_code IN (${ans.map(() => '?').join(',')}) OR s.an IN (${ans.map(() => '?').join(',')})`);
      stmParams.push(...ans, ...ans);
    }
    if (repTranIds.length > 0) {
      stmClauses.push(`s.tran_id IN (${repTranIds.map(() => '?').join(',')})`);
      stmParams.push(...repTranIds);
    }

    if (stmClauses.length > 0) {
      const [stmRows] = await repConnection.query(
        `SELECT
           COALESCE(NULLIF(TRIM(s.matched_visit_code), ''), NULLIF(TRIM(s.vn), ''), NULLIF(TRIM(s.an), ''), '') AS visit_code,
           COALESCE(s.tran_id, '') AS tran_id,
           s.data_type,
           SUM(COALESCE(s.amount, 0)) AS total_amount,
           SUM(COALESCE(s.paid_amount, 0)) AS total_paid_amount,
           SUM(CASE WHEN s.data_type = 'INV' THEN COALESCE(s.paid_amount, s.amount, s.invoice_amount, 0) ELSE 0 END) AS total_net_received,
           SUM(COALESCE(s.invoice_amount, 0)) AS total_invoice_amount,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(s.statement_no, '')), '') ORDER BY s.statement_no SEPARATOR ', ') AS statement_no,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(s.errorcode, '')), '') SEPARATOR ', ') AS errorcode,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(s.verifycode, '')), '') SEPARATOR ', ') AS verifycode,
           MAX(b.created_at) AS imported_at
         FROM repstm_statement_data s
         LEFT JOIN repstm_import_batch b ON b.id = s.batch_id
         WHERE s.data_type IN ('STM', 'INV')
           AND (${stmClauses.join(' OR ')})
         GROUP BY COALESCE(NULLIF(TRIM(s.matched_visit_code), ''), NULLIF(TRIM(s.vn), ''), NULLIF(TRIM(s.an), ''), ''), COALESCE(s.tran_id, ''), s.data_type`,
        stmParams
      );
      (Array.isArray(stmRows) ? stmRows : []).forEach((r) => {
        const rec = r as Record<string, unknown>;
        const tranId = String(rec.tran_id || '').trim();
        const vc = String(rec.visit_code || '').trim() || (tranId ? (repTranToVisit.get(tranId) || '') : '');
        const dtype = String(rec.data_type || '').toUpperCase();
        if (!vc) return;
        if (dtype === 'STM') {
          const existing = stmMap.get(vc);
          const next = {
            stm_amount: toNumNull(rec.total_amount),
            stm_paid_amount: toNumNull(rec.total_paid_amount),
            statement_no: String(rec.statement_no || ''),
            imported_at: formatTrackingDateTime(rec.imported_at),
            errorcode: String(rec.errorcode || ''),
            verifycode: String(rec.verifycode || ''),
          };
          if (existing) {
            stmMap.set(vc, {
              stm_amount: (existing.stm_amount ?? 0) + (next.stm_amount ?? 0),
              stm_paid_amount: (existing.stm_paid_amount ?? 0) + (next.stm_paid_amount ?? 0),
              statement_no: [existing.statement_no, next.statement_no].filter(Boolean).join(', '),
              imported_at: latestTrackingDateTime(existing.imported_at, next.imported_at),
              errorcode: [existing.errorcode, next.errorcode].filter(Boolean).join(', '),
              verifycode: [existing.verifycode, next.verifycode].filter(Boolean).join(', '),
            });
          } else {
            stmMap.set(vc, next);
          }
        } else if (dtype === 'INV') {
          const existing = invMap.get(vc);
          const next = {
            inv_amount: toNumNull(rec.total_net_received),
            inv_invoice_amount: toNumNull(rec.total_invoice_amount),
            statement_no: String(rec.statement_no || ''),
            imported_at: formatTrackingDateTime(rec.imported_at),
          };
          if (existing) {
            invMap.set(vc, {
              inv_amount: (existing.inv_amount ?? 0) + (next.inv_amount ?? 0),
              inv_invoice_amount: (existing.inv_invoice_amount ?? 0) + (next.inv_invoice_amount ?? 0),
              statement_no: [existing.statement_no, next.statement_no].filter(Boolean).join(', '),
              imported_at: latestTrackingDateTime(existing.imported_at, next.imported_at),
            });
          } else {
            invMap.set(vc, next);
          }
        }
      });
    }
  } catch (err) {
    console.error('Error fetching REP/STM/INV for reconciliation:', err);
  } finally {
    repConnection.release();
  }

  // --- Step 4: Assemble rows and compute diffs/status ---
  const assembled: ReconciliationRow[] = baseRows.map((base) => {
    const vn = String(base.vn || '').trim();
    const an = String(base.an || '').trim();
    const visitKey = an ? `AN:${an}` : `VN:${vn}`;
    const claimable = toNum(base.claimable_amount);

    const rep = (vn && repMap.get(`VN:${vn}`)) || (an && repMap.get(`AN:${an}`)) || null;
    const stm = (vn && stmMap.get(vn)) || (an && stmMap.get(an)) || null;
    const inv = (vn && invMap.get(vn)) || (an && invMap.get(an)) || null;
    const fdh = (vn && fdhMap.get(`VN:${vn}`)) || (an && fdhMap.get(`AN:${an}`)) || null;

    const repAmt = rep ? rep.rep_amount : null;
    const stmAmt = stm ? stm.stm_amount : null;
    const stmPaidAmt = stm ? stm.stm_paid_amount : null;
    const invAmt = inv ? inv.inv_amount : null;

    const diffRep = repAmt != null ? repAmt - claimable : null;
    const diffStm = stmAmt != null ? stmAmt - claimable : null;
    const diffStmPaid = stmPaidAmt != null ? stmPaidAmt - claimable : null;
    const diffInv = invAmt != null ? invAmt - claimable : null;

    // แถวประกอบ เช่น Data Drug อาจมี TRAN_ID แต่ไม่มี REP No. จึงยังไม่ถือว่าได้รับ REP หลัก
    const hasRep = Boolean(rep?.rep_no);
    const hasStm = stmAmt != null;
    const hasInv = invAmt != null;
    const invCompleted = invAmt != null && invAmt > 0;

    let compareStatus: string;
    if (!hasRep && !hasStm && !hasInv) {
      compareStatus = 'ไม่มีข้อมูล';
    } else if (hasRep && !hasStm && !hasInv) {
      compareStatus = 'รอ STM/INV';
    } else if (!hasRep && (hasStm || hasInv)) {
      const stmOrInvAmt = stmAmt ?? invAmt ?? 0;
      const diff = stmOrInvAmt - claimable;
      if (Math.abs(diff) < 0.01) compareStatus = 'ตรงกัน';
      else compareStatus = 'ยอดต่าง';
    } else {
      // has both REP and STM/INV
      const repOk = diffRep != null && Math.abs(diffRep) < 0.01;
      const stmOk = (stmPaidAmt == null || (diffStmPaid != null && Math.abs(diffStmPaid) < 0.01));
      const invOk = (invAmt == null || (diffInv != null && Math.abs(diffInv) < 0.01));
      if (repOk && stmOk && invOk) compareStatus = 'ตรงกัน';
      else compareStatus = 'ยอดต่าง';
    }
    if (invCompleted) {
      compareStatus = 'เสร็จสิ้น (INV)';
    } else {
      // ยังไม่ถือว่าเสร็จจนกว่าจะพบยอดรับสุทธิ INV มากกว่า 0
      if (claimable > 0 && !hasRep) compareStatus = 'รอ REP';
      if (claimable > 0 && hasRep && !hasStm && !hasInv) compareStatus = 'รอ STM/INV';
      if (hasStm && stmPaidAmt != null && Math.abs(stmPaidAmt) < 0.01) compareStatus = 'ยอดต่าง';
    }

    const issueParts: string[] = [];
    if (rep?.errorcode || rep?.verifycode) issueParts.push('REP C/Deny');
    if (stm?.errorcode || stm?.verifycode) issueParts.push('STM C/Deny');
    if (hasStm && stmPaidAmt != null && Math.abs(stmPaidAmt) < 0.01) issueParts.push('STM จ่าย 0');
    if (diffStmPaid != null && Math.abs(diffStmPaid) >= 0.01) issueParts.push(diffStmPaid > 0 ? 'รับเกิน' : 'รับขาด');
    const serviceDate = String(base.service_date || '');

    return {
      patient_type: String(base.patient_type || ''),
      visit_key: visitKey,
      vn: vn,
      an: an,
      hn: String(base.hn || ''),
      cid: base.cid != null ? String(base.cid) : null,
      patient_name: String(base.patient_name || ''),
      pttype: String(base.pttype || ''),
      pttype_name: String(base.pttype_name || ''),
      hipdata_code: String(base.hipdata_code || ''),
      hospmain: String(base.hospmain || ''),
      service_datetime: base.service_datetime ? String(base.service_datetime) : null,
      account_group: String(base.account_group || ''),
      payment_source: String(base.payment_source || ''),
      claim_summary: String(base.claim_summary || ''),
      service_date: String(base.service_date || ''),
      claimable_amount: claimable,
      rep_amount: repAmt,
      rep_no: rep ? rep.rep_no || null : null,
      rep_tran_id: rep ? rep.tran_id || null : null,
      rep_senddate: rep ? rep.senddate : null,
      rep_imported_at: rep ? rep.imported_at : null,
      rep_errorcode: rep ? rep.errorcode || null : null,
      rep_verifycode: rep ? rep.verifycode || null : null,
      has_rep: hasRep,
      stm_amount: stmAmt,
      stm_paid_amount: stmPaidAmt,
      stm_statement_no: stm ? stm.statement_no || null : null,
      stm_imported_at: stm ? stm.imported_at : null,
      stm_errorcode: stm ? stm.errorcode || null : null,
      stm_verifycode: stm ? stm.verifycode || null : null,
      has_stm: hasStm,
      inv_amount: invAmt,
      inv_invoice_amount: inv ? inv.inv_invoice_amount : null,
      inv_statement_no: inv ? inv.statement_no || null : null,
      inv_imported_at: inv ? inv.imported_at : null,
      has_inv: hasInv,
      fdh_status: fdh?.status || null,
      fdh_claim_code: fdh?.claim_code || null,
      fdh_sent_at: fdh?.sent_at || null,
      diff_rep: diffRep,
      diff_stm: diffStm,
      diff_stm_paid: diffStmPaid,
      diff_inv: diffInv,
      compare_status: compareStatus,
      issue_status: issueParts.length ? issueParts.join(', ') : 'ปกติ',
      days_to_rep: trackingDayDiff(serviceDate, rep?.senddate || rep?.imported_at || null),
      days_to_stm: trackingDayDiff(rep?.senddate || rep?.imported_at || serviceDate, stm?.imported_at || null),
    };
  });

  // --- Step 5: Filter by compareStatus if requested ---
  const statusFiltered = compareStatusFilter
    ? assembled.filter(r => r.compare_status === compareStatusFilter)
    : assembled;
  const hmainFilter = String(params.hmain || '').trim();
  const searchFilter = String(params.search || '').trim().toLowerCase();
  const filtered = statusFiltered.filter((row) => {
    if (hmainFilter && row.hospmain !== hmainFilter) return false;
    if (!searchFilter) return true;
    return [row.vn, row.an, row.hn, row.cid, row.patient_name, row.hospmain, row.rep_no, row.stm_statement_no, row.inv_statement_no]
      .some((value) => String(value || '').toLowerCase().includes(searchFilter));
  });

  // --- Step 6: Summary ---
  const summary = {
    total_visits: filtered.length,
    matched: filtered.filter(r => r.compare_status === 'ตรงกัน').length,
    completed_inv: filtered.filter(r => r.compare_status === 'เสร็จสิ้น (INV)').length,
    mismatched: filtered.filter(r => r.compare_status === 'ยอดต่าง').length,
    pending_rep: filtered.filter(r => r.compare_status === 'รอ REP').length,
    pending_stm: filtered.filter(r => r.compare_status === 'รอ STM/INV').length,
    no_data: filtered.filter(r => r.compare_status === 'ไม่มีข้อมูล').length,
    total_claimable: Math.round(filtered.reduce((s, r) => s + r.claimable_amount, 0) * 100) / 100,
    total_rep: Math.round(filtered.reduce((s, r) => s + (r.rep_amount ?? 0), 0) * 100) / 100,
    total_stm: Math.round(filtered.reduce((s, r) => s + (r.stm_amount ?? 0), 0) * 100) / 100,
    total_stm_paid: Math.round(filtered.reduce((s, r) => s + (r.stm_paid_amount ?? 0), 0) * 100) / 100,
    total_inv: Math.round(filtered.reduce((s, r) => s + (r.inv_amount ?? 0), 0) * 100) / 100,
    rep_issue: filtered.filter(r => Boolean(r.rep_errorcode || r.rep_verifycode)).length,
    stm_zero: filtered.filter(r => r.stm_paid_amount != null && Math.abs(r.stm_paid_amount) < 0.01).length,
    overpaid: filtered.filter(r => r.diff_stm_paid != null && r.diff_stm_paid > 0.01).length,
    underpaid: filtered.filter(r => r.diff_stm_paid != null && r.diff_stm_paid < -0.01).length,
  };

  const total = filtered.length;
  const groupMap = new Map<string, {
    hmain: string; visits: number; claimable_amount: number; rep_amount: number;
    stm_paid_amount: number; inv_amount: number; outstanding_amount: number;
  }>();
  filtered.forEach((row) => {
    const hmain = row.hospmain || 'ไม่ระบุ HMAIN';
    const group = groupMap.get(hmain) || {
      hmain, visits: 0, claimable_amount: 0, rep_amount: 0,
      stm_paid_amount: 0, inv_amount: 0, outstanding_amount: 0,
    };
    group.visits += 1;
    group.claimable_amount += row.claimable_amount;
    group.rep_amount += row.rep_amount || 0;
    group.stm_paid_amount += row.stm_paid_amount || 0;
    group.inv_amount += row.inv_amount || 0;
    group.outstanding_amount += Math.max(row.claimable_amount - (row.stm_paid_amount || row.inv_amount || 0), 0);
    groupMap.set(hmain, group);
  });
  const group_summary = Array.from(groupMap.values())
    .map((group) => ({
      ...group,
      claimable_amount: Math.round(group.claimable_amount * 100) / 100,
      rep_amount: Math.round(group.rep_amount * 100) / 100,
      stm_paid_amount: Math.round(group.stm_paid_amount * 100) / 100,
      inv_amount: Math.round(group.inv_amount * 100) / 100,
      outstanding_amount: Math.round(group.outstanding_amount * 100) / 100,
    }))
    .sort((a, b) => b.claimable_amount - a.claimable_amount);
  const offset = (page - 1) * pageSize;
  const data = filtered.slice(offset, offset + pageSize);

  return { data, total, summary, group_summary };
};

export const getUcOutsideCupDashboard = async (params: ReconciliationQueryParams) => {
  const result = await getVisitRepStmComparison({
    ...params,
    financeRight: '07',
  });

  const hmainCodes = Array.from(new Set(result.group_summary.map((item) => item.hmain)
    .filter((code) => code && code !== 'ไม่ระบุ HMAIN')));
  const hospitalNames = new Map<string, string>();
  if (hmainCodes.length > 0) {
    const connection = await getUTFConnection();
    try {
      const [rows] = await connection.query(
        `SELECT hospcode, name
         FROM hospcode
         WHERE hospcode IN (${hmainCodes.map(() => '?').join(',')})`,
        hmainCodes
      );
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const record = row as Record<string, unknown>;
        hospitalNames.set(String(record.hospcode || '').trim(), String(record.name || '').trim());
      });
    } catch (error) {
      console.warn('Unable to load HMAIN hospital names:', error);
    } finally {
      connection.release();
    }
  }

  return {
    ...result,
    data: result.data.map((row) => ({ ...row, hmain_name: hospitalNames.get(row.hospmain) || '' })),
    group_summary: result.group_summary.map((group) => ({
      ...group,
      hmain_name: hospitalNames.get(group.hmain) || '',
    })),
  };
};

export interface Uuc1TrackingQueryParams {
  startDate?: string;
  endDate?: string;
  patientType?: string;
  patientRight?: string;
  hosxpRight?: string;
  financeRight?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface RepDailySummaryQueryParams {
  startDate?: string;
  endDate?: string;
  patientType?: 'ALL' | 'OPD' | 'IPD' | string;
  claimStatus?: 'ALL' | 'UUC1' | 'UUC2' | string;
}

export interface RepDailySummaryRow {
  claim_date: string;
  total_visits: number;
  opd_visits: number;
  ipd_visits: number;
  uuc1_visits: number;
  uuc2_visits: number;
  opd_uuc1: number;
  opd_uuc2: number;
  ipd_uuc1: number;
  ipd_uuc2: number;
  rep_records: number;
  rep_clean_cases: number;
  rep_error_cases: number;
  rep_amount: number;
  stm_visits: number;
  pending_stm_visits: number;
  stm_zero_cases: number;
  stm_records: number;
  stm_amount: number;
  stm_paid_amount: number;
  latest_stm_import_at: string | null;
  latest_stm_statement_no: string | null;
  latest_rep_import_at: string | null;
  latest_rep_senddate: string | null;
}

type RepDailyBaseVisit = {
  patientType: 'OPD' | 'IPD';
  visitCode: string;
  serviceDate: string;
  expectedAmount: number;
  hn?: string;
  cid?: string;
  patientName?: string;
  age?: string;
  pttype?: string;
  pttypeName?: string;
  department?: string;
  clinic?: string;
};

type RepDailyRepEntry = {
  amount: number;
  records: number;
  hasIssue: boolean;
  tranIds: string[];
  latestImportAt: string | null;
  latestSenddate: string | null;
};

type RepDailyStmEntry = {
  amount: number;
  paidAmount: number;
  invoiceAmount: number;
  records: number;
  latestImportAt: string | null;
  latestStatementNo: string | null;
};

export interface RepDailyVisitRow {
  patient_type: 'OPD' | 'IPD';
  visit_code: string;
  vn: string | null;
  an: string | null;
  hn: string | null;
  cid: string | null;
  patient_name: string | null;
  age: string | null;
  pttype: string | null;
  pttype_name: string | null;
  department: string | null;
  clinic: string | null;
  service_date: string;
  claimable_amount: number;
  has_rep: boolean;
  has_stm: boolean;
  rep_amount: number | null;
  stm_amount: number | null;
  stm_paid_amount: number | null;
  rep_records: number;
  stm_records: number;
  rep_issue: boolean;
  stm_zero: boolean;
  latest_rep_import_at: string | null;
  latest_stm_import_at: string | null;
  latest_stm_statement_no: string | null;
}

export interface RepDailyVisitDetail {
  patient_type: 'OPD' | 'IPD';
  visit_code: string;
  patient: Record<string, unknown> | null;
  diagnoses: Record<string, unknown>[];
  procedures: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  labs: Record<string, unknown>[];
  rep: Record<string, unknown>[];
  stm: Record<string, unknown>[];
}

export interface Uuc1TrackingRow {
  patient_type: string;
  visit_key: string;
  vn: string;
  an: string;
  hn: string;
  cid: string | null;
  patient_name: string;
  pttype: string;
  pttype_name: string;
  hipdata_code: string;
  service_date: string;
  sent_amount: number;
  rep_amount: number | null;
  rep_no: string | null;
  rep_imported_at: string | null;
  rep_senddate: string | null;
  rep_filename: string | null;
  rep_errorcode: string | null;
  rep_verifycode: string | null;
  rep_projectcode: string | null;
  stm_amount: number | null;
  stm_paid_amount: number | null;
  stm_imported_at: string | null;
  stm_statement_no: string | null;
  stm_filename: string | null;
  inv_amount: number | null;
  inv_imported_at: string | null;
  diff_rep: number | null;
  diff_stm: number | null;
  days_to_rep: number | null;
  days_to_stm: number | null;
  followup_status: string;
  followup_status_key: string;
  followup_note: string;
}

type RepTrackingEntry = {
  rep_amount: number | null;
  rep_no: string | null;
  rep_imported_at: string | null;
  rep_senddate: string | null;
  rep_filename: string | null;
  rep_errorcode: string | null;
  rep_verifycode: string | null;
  rep_projectcode: string | null;
  tran_ids: string[];
};

type StatementTrackingEntry = {
  amount: number | null;
  paid_amount: number | null;
  imported_at: string | null;
  statement_no: string | null;
  filename: string | null;
};


const toTrackingNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const splitTrackingList = (value: unknown): string[] => {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const mergeTrackingText = (...values: Array<unknown>): string | null => {
  const merged = new Set<string>();
  values.forEach((value) => splitTrackingList(value).forEach((item) => merged.add(item)));
  return merged.size > 0 ? Array.from(merged).join(', ') : null;
};


const trackingDayDiff = (start?: string | null, end?: string | null): number | null => {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
};

const initRepDailyRow = (claimDate: string): RepDailySummaryRow => ({
  claim_date: claimDate,
  total_visits: 0,
  opd_visits: 0,
  ipd_visits: 0,
  uuc1_visits: 0,
  uuc2_visits: 0,
  opd_uuc1: 0,
  opd_uuc2: 0,
  ipd_uuc1: 0,
  ipd_uuc2: 0,
  rep_records: 0,
  rep_clean_cases: 0,
  rep_error_cases: 0,
  rep_amount: 0,
  stm_visits: 0,
  pending_stm_visits: 0,
  stm_zero_cases: 0,
  stm_records: 0,
  stm_amount: 0,
  stm_paid_amount: 0,
  latest_stm_import_at: null,
  latest_stm_statement_no: null,
  latest_rep_import_at: null,
  latest_rep_senddate: null,
});

const splitIntoChunks = <T,>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const matchesRepDailyClaimStatus = (claimStatus: string, hasRep: boolean) => {
  const normalized = String(claimStatus || 'ALL').toUpperCase();
  if (normalized === 'UUC1' || normalized === 'REP' || normalized === 'HAS_REP') return hasRep;
  if (normalized === 'UUC2' || normalized === 'NO_REP' || normalized === 'MISSING_REP') return !hasRep;
  return true;
};

const loadRepEntriesForVisitCodes = async (
  connection: HospitalConnection,
  vns: string[],
  ans: string[]
) => {
  const repMap = new Map<string, RepDailyRepEntry>();
  const mergeEntry = (key: string, rec: Record<string, unknown>) => {
    if (!key) return;
    const existing = repMap.get(key);
    const amount = toReceivableNumber(rec.rep_amount);
    const records = Math.max(1, toReceivableNumber(rec.rep_records));
    const hasIssue = String(rec.issue_codes || '').trim() !== '';
    const tranIds = String(rec.tran_ids || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const latestImportAt = formatTrackingDateTime(rec.latest_rep_import_at);
    const latestSenddate = formatTrackingDateTime(rec.latest_rep_senddate);
    if (!existing) {
      repMap.set(key, { amount, records, hasIssue, tranIds, latestImportAt, latestSenddate });
      return;
    }
    existing.amount += amount;
    existing.records += records;
    existing.hasIssue = existing.hasIssue || hasIssue;
    existing.tranIds = Array.from(new Set([...existing.tranIds, ...tranIds]));
    existing.latestImportAt = latestTrackingDateTime(existing.latestImportAt, latestImportAt);
    existing.latestSenddate = latestTrackingDateTime(existing.latestSenddate, latestSenddate);
  };

  const queryRepChunk = async (fieldName: 'vn' | 'an', values: string[]) => {
    for (const chunk of splitIntoChunks(values, 800)) {
      if (chunk.length === 0) continue;
      const [rows] = await connection.query(
        `SELECT
           COALESCE(${fieldName}, '') AS visit_code,
           COUNT(DISTINCT record_uid) AS rep_records,
           SUM(COALESCE(compensated, nhso, agency, 0)) AS rep_amount,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(CONCAT_WS('', errorcode, verifycode)), '') SEPARATOR ', ') AS issue_codes,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(tran_id, '')), '') SEPARATOR ',') AS tran_ids,
           MAX(senddate) AS latest_rep_senddate,
           MAX(b.created_at) AS latest_rep_import_at
         FROM rep_data rd
         LEFT JOIN repstm_import_batch b ON b.id = rd.batch_id
         WHERE ${fieldName} IN (${chunk.map(() => '?').join(',')})
         GROUP BY COALESCE(${fieldName}, '')`,
        chunk
      );

      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        mergeEntry(String(rec.visit_code || '').trim(), rec);
      });
    }
  };

  await queryRepChunk('vn', vns);
  await queryRepChunk('an', ans);
  return repMap;
};

const loadStmEntriesForVisitCodes = async (
  connection: HospitalConnection,
  vns: string[],
  ans: string[],
  repMap: Map<string, RepDailyRepEntry>
) => {
  const stmMap = new Map<string, RepDailyStmEntry>();
  const tranToVisit = new Map<string, string>();
  const seenRecords = new Set<string>();

  repMap.forEach((entry, visitCode) => {
    entry.tranIds.forEach((tranId) => {
      if (tranId) tranToVisit.set(tranId, visitCode);
    });
  });

  const mergeEntry = (key: string, rec: Record<string, unknown>) => {
    if (!key) return;
    const recordKey = String(rec.record_key || '').trim();
    if (recordKey && seenRecords.has(recordKey)) return;
    if (recordKey) seenRecords.add(recordKey);
    const existing = stmMap.get(key);
    const latestStatementNo = String(rec.statement_no || '').trim() || null;
    const latestImportAt = formatTrackingDateTime(rec.latest_stm_import_at);
    const nextEntry: RepDailyStmEntry = {
      amount: toReceivableNumber(rec.stm_amount),
      paidAmount: toReceivableNumber(rec.stm_paid_amount),
      invoiceAmount: toReceivableNumber(rec.invoice_amount),
      records: 1,
      latestImportAt,
      latestStatementNo,
    };

    if (!existing) {
      stmMap.set(key, nextEntry);
      return;
    }

    existing.amount += nextEntry.amount;
    existing.paidAmount += nextEntry.paidAmount;
    existing.invoiceAmount += nextEntry.invoiceAmount;
    existing.records += nextEntry.records;
    existing.latestImportAt = latestTrackingDateTime(existing.latestImportAt, nextEntry.latestImportAt);
    existing.latestStatementNo = nextEntry.latestStatementNo || existing.latestStatementNo;
  };

  const visitCodes = Array.from(new Set([...vns, ...ans]));
  const tranIds = Array.from(tranToVisit.keys());

  for (const chunk of splitIntoChunks(visitCodes, 500)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(',');
    const [rows] = await connection.query(
      `SELECT
         CONCAT(COALESCE(s.record_uid, ''), '#', s.id) AS record_key,
         COALESCE(NULLIF(TRIM(s.matched_visit_code), ''), NULLIF(TRIM(s.vn), ''), NULLIF(TRIM(s.an), '')) AS visit_code,
         s.statement_no,
         COALESCE(s.amount, 0) AS stm_amount,
         COALESCE(s.paid_amount, 0) AS stm_paid_amount,
         COALESCE(s.invoice_amount, 0) AS invoice_amount,
         b.created_at AS latest_stm_import_at
       FROM repstm_statement_data s
       LEFT JOIN repstm_import_batch b ON b.id = s.batch_id
       WHERE s.data_type = 'STM'
         AND (
           s.matched_visit_code IN (${placeholders})
           OR s.vn IN (${placeholders})
           OR s.an IN (${placeholders})
         )`,
      [...chunk, ...chunk, ...chunk]
    );

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const rec = row as Record<string, unknown>;
      mergeEntry(String(rec.visit_code || '').trim(), rec);
    });
  }

  for (const chunk of splitIntoChunks(tranIds, 500)) {
    if (chunk.length === 0) continue;
    const [rows] = await connection.query(
      `SELECT
         CONCAT(COALESCE(s.record_uid, ''), '#', s.id) AS record_key,
         COALESCE(s.tran_id, '') AS tran_id,
         s.statement_no,
         COALESCE(s.amount, 0) AS stm_amount,
         COALESCE(s.paid_amount, 0) AS stm_paid_amount,
         COALESCE(s.invoice_amount, 0) AS invoice_amount,
         b.created_at AS latest_stm_import_at
       FROM repstm_statement_data s
       LEFT JOIN repstm_import_batch b ON b.id = s.batch_id
       WHERE s.data_type = 'STM'
         AND s.tran_id IN (${chunk.map(() => '?').join(',')})`,
      chunk
    );

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const rec = row as Record<string, unknown>;
      const visitCode = tranToVisit.get(String(rec.tran_id || '').trim()) || '';
      mergeEntry(visitCode, rec);
    });
  }

  return stmMap;
};

export const getRepDailyClaimSummary = async (params: RepDailySummaryQueryParams): Promise<{
  data: RepDailySummaryRow[];
  summary: Omit<RepDailySummaryRow, 'claim_date'> & {
    days: number;
    total_rep_amount: number;
    latest_rep_import_at: string | null;
    latest_rep_senddate: string | null;
  };
  recommended_reports: Array<{ key: string; title: string; description: string }>;
}> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(params.startDate || today.slice(0, 8) + '01').slice(0, 10);
  const endDate = String(params.endDate || today).slice(0, 10);
  const patientType = String(params.patientType || 'ALL').toUpperCase();
  const claimStatus = String(params.claimStatus || 'ALL').toUpperCase();
  const hosConnection = await getUTFConnection();
  const repConnection = await getRepstmConnection();

  try {
    await ensureRepstmTables();
    const baseVisits: RepDailyBaseVisit[] = [];

    if (patientType === 'ALL' || patientType === 'OPD') {
      const [opdRows] = await hosConnection.query(
        `SELECT
           o.vn AS visit_code,
           DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
           COALESCE(v.income, 0) AS expected_amount,
           o.hn,
           pt.cid,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           thaiage(pt.birthday, o.vstdate) AS age,
           o.pttype,
           ptt.name AS pttype_name,
           k.department AS department,
           sp.name AS clinic
         FROM ovst o
         LEFT JOIN vn_stat v ON v.vn = o.vn
         LEFT JOIN patient pt ON pt.hn = o.hn
         LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
         LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
         LEFT JOIN spclty sp ON sp.spclty = o.spclty
         WHERE o.vstdate BETWEEN ? AND ?
           AND COALESCE(v.income, 0) > 0`,
        [startDate, endDate]
      );
      (Array.isArray(opdRows) ? opdRows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const visitCode = String(rec.visit_code || '').trim();
        if (!visitCode) return;
        baseVisits.push({
          patientType: 'OPD',
          visitCode,
          serviceDate: String(rec.service_date || '').slice(0, 10),
          expectedAmount: toReceivableNumber(rec.expected_amount),
          hn: String(rec.hn || ''),
          cid: String(rec.cid || ''),
          patientName: String(rec.patient_name || ''),
          age: String(rec.age || ''),
          pttype: String(rec.pttype || ''),
          pttypeName: String(rec.pttype_name || ''),
          department: String(rec.department || ''),
          clinic: String(rec.clinic || ''),
        });
      });
    }

    if (patientType === 'ALL' || patientType === 'IPD') {
      const [ipdRows] = await hosConnection.query(
        `SELECT
           i.an AS visit_code,
           DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%Y-%m-%d') AS service_date,
           i.hn,
           pt.cid,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           thaiage(pt.birthday, COALESCE(i.dchdate, i.regdate)) AS age,
           i.pttype,
           ptt.name AS pttype_name,
           w.name AS department,
           sp.name AS clinic,
           CASE
             WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
             ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
           END AS expected_amount
         FROM ipt i
         LEFT JOIN an_stat a ON a.an = i.an
         LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
         LEFT JOIN patient pt ON pt.hn = i.hn
         LEFT JOIN ward w ON w.ward = i.ward
         LEFT JOIN spclty sp ON sp.spclty = i.spclty
         WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
           AND (
             CASE
               WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
               ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
             END
           ) > 0`,
        [startDate, endDate]
      );
      (Array.isArray(ipdRows) ? ipdRows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const visitCode = String(rec.visit_code || '').trim();
        if (!visitCode) return;
        baseVisits.push({
          patientType: 'IPD',
          visitCode,
          serviceDate: String(rec.service_date || '').slice(0, 10),
          expectedAmount: toReceivableNumber(rec.expected_amount),
          hn: String(rec.hn || ''),
          cid: String(rec.cid || ''),
          patientName: String(rec.patient_name || ''),
          age: String(rec.age || ''),
          pttype: String(rec.pttype || ''),
          pttypeName: String(rec.pttype_name || ''),
          department: String(rec.department || ''),
          clinic: String(rec.clinic || ''),
        });
      });
    }

    const vns = Array.from(new Set(baseVisits.filter((visit) => visit.patientType === 'OPD').map((visit) => visit.visitCode)));
    const ans = Array.from(new Set(baseVisits.filter((visit) => visit.patientType === 'IPD').map((visit) => visit.visitCode)));
    const repMap = await loadRepEntriesForVisitCodes(repConnection, vns, ans);
    const stmMap = await loadStmEntriesForVisitCodes(repConnection, vns, ans, repMap);
    const dailyMap = new Map<string, RepDailySummaryRow>();

    baseVisits
      .filter((visit) => matchesRepDailyClaimStatus(claimStatus, Boolean(repMap.get(visit.visitCode))))
      .forEach((visit) => {
      const claimDate = visit.serviceDate || 'ไม่ระบุ';
      if (!dailyMap.has(claimDate)) dailyMap.set(claimDate, initRepDailyRow(claimDate));
      const row = dailyMap.get(claimDate)!;
      const rep = repMap.get(visit.visitCode) || null;
      const stm = stmMap.get(visit.visitCode) || null;
      row.total_visits += 1;
      if (visit.patientType === 'OPD') row.opd_visits += 1;
      if (visit.patientType === 'IPD') row.ipd_visits += 1;

      if (rep) {
        row.uuc1_visits += 1;
        if (visit.patientType === 'OPD') row.opd_uuc1 += 1;
        if (visit.patientType === 'IPD') row.ipd_uuc1 += 1;
        row.rep_records += rep.records;
        row.rep_amount += rep.amount;
        if (rep.hasIssue) row.rep_error_cases += 1;
        else row.rep_clean_cases += 1;
        row.latest_rep_import_at = latestTrackingDateTime(row.latest_rep_import_at, rep.latestImportAt);
        row.latest_rep_senddate = latestTrackingDateTime(row.latest_rep_senddate, rep.latestSenddate);
      } else {
        row.uuc2_visits += 1;
        if (visit.patientType === 'OPD') row.opd_uuc2 += 1;
        if (visit.patientType === 'IPD') row.ipd_uuc2 += 1;
      }

      if (stm) {
        row.stm_visits += 1;
        row.stm_records += stm.records;
        row.stm_amount += stm.amount;
        row.stm_paid_amount += stm.paidAmount;
        if (Math.abs(stm.paidAmount) < 0.01) row.stm_zero_cases += 1;
        row.latest_stm_import_at = latestTrackingDateTime(row.latest_stm_import_at, stm.latestImportAt);
        row.latest_stm_statement_no = stm.latestStatementNo || row.latest_stm_statement_no;
      } else if (rep) {
        row.pending_stm_visits += 1;
      }
    });

    const data = Array.from(dailyMap.values())
      .sort((a, b) => a.claim_date.localeCompare(b.claim_date))
      .map((row) => ({
        ...row,
        rep_amount: Math.round(row.rep_amount * 100) / 100,
        stm_amount: Math.round(row.stm_amount * 100) / 100,
        stm_paid_amount: Math.round(row.stm_paid_amount * 100) / 100,
      }));

    const summary = data.reduce((acc, row) => {
      acc.total_visits += row.total_visits;
      acc.opd_visits += row.opd_visits;
      acc.ipd_visits += row.ipd_visits;
      acc.uuc1_visits += row.uuc1_visits;
      acc.uuc2_visits += row.uuc2_visits;
      acc.opd_uuc1 += row.opd_uuc1;
      acc.opd_uuc2 += row.opd_uuc2;
      acc.ipd_uuc1 += row.ipd_uuc1;
      acc.ipd_uuc2 += row.ipd_uuc2;
      acc.rep_records += row.rep_records;
      acc.rep_clean_cases += row.rep_clean_cases;
      acc.rep_error_cases += row.rep_error_cases;
      acc.rep_amount += row.rep_amount;
      acc.stm_visits += row.stm_visits;
      acc.pending_stm_visits += row.pending_stm_visits;
      acc.stm_zero_cases += row.stm_zero_cases;
      acc.stm_records += row.stm_records;
      acc.stm_amount += row.stm_amount;
      acc.stm_paid_amount += row.stm_paid_amount;
      acc.latest_stm_import_at = latestTrackingDateTime(acc.latest_stm_import_at, row.latest_stm_import_at);
      acc.latest_stm_statement_no = row.latest_stm_statement_no || acc.latest_stm_statement_no;
      acc.latest_rep_import_at = latestTrackingDateTime(acc.latest_rep_import_at, row.latest_rep_import_at);
      acc.latest_rep_senddate = latestTrackingDateTime(acc.latest_rep_senddate, row.latest_rep_senddate);
      return acc;
    }, {
      total_visits: 0,
      opd_visits: 0,
      ipd_visits: 0,
      uuc1_visits: 0,
      uuc2_visits: 0,
      opd_uuc1: 0,
      opd_uuc2: 0,
      ipd_uuc1: 0,
      ipd_uuc2: 0,
      rep_records: 0,
      rep_clean_cases: 0,
      rep_error_cases: 0,
      rep_amount: 0,
      stm_visits: 0,
      pending_stm_visits: 0,
      stm_zero_cases: 0,
      stm_records: 0,
      stm_amount: 0,
      stm_paid_amount: 0,
      latest_stm_import_at: null as string | null,
      latest_stm_statement_no: null as string | null,
      latest_rep_import_at: null as string | null,
      latest_rep_senddate: null as string | null,
      days: data.length,
      total_rep_amount: 0,
    });

    summary.rep_amount = Math.round(summary.rep_amount * 100) / 100;
    summary.stm_amount = Math.round(summary.stm_amount * 100) / 100;
    summary.stm_paid_amount = Math.round(summary.stm_paid_amount * 100) / 100;
    summary.total_rep_amount = summary.rep_amount;
    summary.days = data.length;

    return {
      data,
      summary,
      recommended_reports: [
        { key: 'daily', title: 'สรุปรายวัน', description: 'จำนวน visit ทั้งหมด, พบ REP, ยังไม่พบ REP และยอด REP แยกตามวัน' },
        { key: 'missing_rep', title: 'รายการยังไม่พบ REP', description: 'ใช้ติดตาม UUC2/ยังไม่ส่งหรือไฟล์ REP ที่ยังไม่นำเข้า' },
        { key: 'op_ip_split', title: 'ผู้ป่วยนอก/ผู้ป่วยใน', description: 'ดูสัดส่วน OPD/IPD ที่เข้า REP แล้วและที่ยังไม่พบ REP' },
        { key: 'cdeny', title: 'C/Deny จาก REP', description: 'แยกเคสที่มี errorcode/verifycode เพื่อส่งต่อไปหน้าติดตาม Reject' },
        { key: 'stm', title: 'ติดตาม STM', description: 'ดูจำนวน visit ที่ได้รับ STM แล้ว, รอ STM, STM จ่าย 0 และยอดรับ STM รายวัน' },
        { key: 'money', title: 'ยอดเงิน REP/STM', description: 'ติดตามยอดชดเชย REP เทียบยอดตั้งและยอดรับ STM รายวัน' },
      ],
    };
  } finally {
    hosConnection.release();
    repConnection.release();
  }
};

export const getRepDailyVisitsForDate = async (params: {
  claimDate: string;
  patientType?: 'ALL' | 'OPD' | 'IPD' | string;
  claimStatus?: 'ALL' | 'UUC1' | 'UUC2' | string;
}): Promise<{ data: RepDailyVisitRow[]; summary: { total: number; opd: number; ipd: number; rep: number; stm: number; pending_stm: number; stm_zero: number } }> => {
  const claimDate = String(params.claimDate || '').slice(0, 10);
  const patientType = String(params.patientType || 'ALL').toUpperCase();
  const claimStatus = String(params.claimStatus || 'ALL').toUpperCase();
  if (!claimDate) {
    return { data: [], summary: { total: 0, opd: 0, ipd: 0, rep: 0, stm: 0, pending_stm: 0, stm_zero: 0 } };
  }

  const hosConnection = await getUTFConnection();
  const repConnection = await getRepstmConnection();
  try {
    await ensureRepstmTables();
    const visits: RepDailyBaseVisit[] = [];

    if (patientType === 'ALL' || patientType === 'OPD') {
      const [rows] = await hosConnection.query(
        `SELECT
           o.vn AS visit_code,
           DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
           COALESCE(v.income, 0) AS expected_amount,
           o.hn,
           pt.cid,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           thaiage(pt.birthday, o.vstdate) AS age,
           o.pttype,
           ptt.name AS pttype_name,
           k.department AS department,
           sp.name AS clinic
         FROM ovst o
         LEFT JOIN vn_stat v ON v.vn = o.vn
         LEFT JOIN patient pt ON pt.hn = o.hn
         LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
         LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
         LEFT JOIN spclty sp ON sp.spclty = o.spclty
         WHERE o.vstdate = ?
           AND COALESCE(v.income, 0) > 0
         ORDER BY o.vsttime, o.vn`,
        [claimDate]
      );
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const visitCode = String(rec.visit_code || '').trim();
        if (!visitCode) return;
        visits.push({
          patientType: 'OPD',
          visitCode,
          serviceDate: String(rec.service_date || '').slice(0, 10),
          expectedAmount: toReceivableNumber(rec.expected_amount),
          hn: String(rec.hn || ''),
          cid: String(rec.cid || ''),
          patientName: String(rec.patient_name || ''),
          age: String(rec.age || ''),
          pttype: String(rec.pttype || ''),
          pttypeName: String(rec.pttype_name || ''),
          department: String(rec.department || ''),
          clinic: String(rec.clinic || ''),
        });
      });
    }

    if (patientType === 'ALL' || patientType === 'IPD') {
      const [rows] = await hosConnection.query(
        `SELECT
           i.an AS visit_code,
           DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%Y-%m-%d') AS service_date,
           i.hn,
           pt.cid,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           thaiage(pt.birthday, COALESCE(i.dchdate, i.regdate)) AS age,
           i.pttype,
           ptt.name AS pttype_name,
           w.name AS department,
           sp.name AS clinic,
           CASE
             WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
             ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
           END AS expected_amount
         FROM ipt i
         LEFT JOIN an_stat a ON a.an = i.an
         LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
         LEFT JOIN patient pt ON pt.hn = i.hn
         LEFT JOIN ward w ON w.ward = i.ward
         LEFT JOIN spclty sp ON sp.spclty = i.spclty
         WHERE COALESCE(i.dchdate, i.regdate) = ?
           AND (
             CASE
               WHEN UPPER(COALESCE(ptt.hipdata_code, '')) IN ('OFC', 'LGO') THEN COALESCE(a.income, 0)
               ELSE GREATEST(COALESCE(a.income, 0) - COALESCE(a.rcpt_money, 0) - COALESCE(a.discount_money, 0), 0)
             END
           ) > 0
         ORDER BY COALESCE(i.dchdate, i.regdate), i.an`,
        [claimDate]
      );
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const visitCode = String(rec.visit_code || '').trim();
        if (!visitCode) return;
        visits.push({
          patientType: 'IPD',
          visitCode,
          serviceDate: String(rec.service_date || '').slice(0, 10),
          expectedAmount: toReceivableNumber(rec.expected_amount),
          hn: String(rec.hn || ''),
          cid: String(rec.cid || ''),
          patientName: String(rec.patient_name || ''),
          age: String(rec.age || ''),
          pttype: String(rec.pttype || ''),
          pttypeName: String(rec.pttype_name || ''),
          department: String(rec.department || ''),
          clinic: String(rec.clinic || ''),
        });
      });
    }

    const vns = visits.filter((visit) => visit.patientType === 'OPD').map((visit) => visit.visitCode);
    const ans = visits.filter((visit) => visit.patientType === 'IPD').map((visit) => visit.visitCode);
    const repMap = await loadRepEntriesForVisitCodes(repConnection, vns, ans);
    const stmMap = await loadStmEntriesForVisitCodes(repConnection, vns, ans, repMap);

    const data = visits
      .filter((visit) => matchesRepDailyClaimStatus(claimStatus, Boolean(repMap.get(visit.visitCode))))
      .map((visit) => {
      const rep = repMap.get(visit.visitCode) || null;
      const stm = stmMap.get(visit.visitCode) || null;
      const stmPaid = stm ? stm.paidAmount : null;
      return {
        patient_type: visit.patientType,
        visit_code: visit.visitCode,
        vn: visit.patientType === 'OPD' ? visit.visitCode : null,
        an: visit.patientType === 'IPD' ? visit.visitCode : null,
        hn: visit.hn || null,
        cid: visit.cid || null,
        patient_name: visit.patientName || null,
        age: visit.age || null,
        pttype: visit.pttype || null,
        pttype_name: visit.pttypeName || null,
        department: visit.department || null,
        clinic: visit.clinic || null,
        service_date: visit.serviceDate,
        claimable_amount: Math.round(visit.expectedAmount * 100) / 100,
        has_rep: Boolean(rep),
        has_stm: Boolean(stm),
        rep_amount: rep ? Math.round(rep.amount * 100) / 100 : null,
        stm_amount: stm ? Math.round(stm.amount * 100) / 100 : null,
        stm_paid_amount: stmPaid == null ? null : Math.round(stmPaid * 100) / 100,
        rep_records: rep?.records || 0,
        stm_records: stm?.records || 0,
        rep_issue: Boolean(rep?.hasIssue),
        stm_zero: stmPaid != null && Math.abs(stmPaid) < 0.01,
        latest_rep_import_at: rep?.latestImportAt || null,
        latest_stm_import_at: stm?.latestImportAt || null,
        latest_stm_statement_no: stm?.latestStatementNo || null,
      };
    });

    const summary = data.reduce((acc, row) => {
      acc.total += 1;
      if (row.patient_type === 'OPD') acc.opd += 1;
      if (row.patient_type === 'IPD') acc.ipd += 1;
      if (row.has_rep) acc.rep += 1;
      if (row.has_stm) acc.stm += 1;
      if (row.has_rep && !row.has_stm) acc.pending_stm += 1;
      if (row.stm_zero) acc.stm_zero += 1;
      return acc;
    }, { total: 0, opd: 0, ipd: 0, rep: 0, stm: 0, pending_stm: 0, stm_zero: 0 });

    return { data, summary };
  } finally {
    hosConnection.release();
    repConnection.release();
  }
};

export const getRepDailyVisitDetail = async (params: {
  patientType: 'OPD' | 'IPD' | string;
  visitCode: string;
}): Promise<RepDailyVisitDetail | null> => {
  const patientType = String(params.patientType || '').toUpperCase() as 'OPD' | 'IPD';
  const visitCode = String(params.visitCode || '').trim();
  if (!visitCode || !['OPD', 'IPD'].includes(patientType)) return null;

  const hosConnection = await getUTFConnection();
  const repConnection = await getRepstmConnection();
  try {
    await ensureRepstmTables();
    let patientRows: Record<string, unknown>[] = [];
    let diagnosisRows: Record<string, unknown>[] = [];
    let procedureRows: Record<string, unknown>[] = [];
    let receiptRows: Record<string, unknown>[] = [];
    let labRows: Record<string, unknown>[] = [];

    if (patientType === 'OPD') {
      const [patient] = await hosConnection.query(
        `SELECT
           o.vn, NULL AS an, o.hn, pt.cid,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           thaiage(pt.birthday, o.vstdate) AS age,
           DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
           TIME_FORMAT(o.vsttime, '%H:%i') AS service_time,
           o.pttype, ptt.name AS pttype_name,
           k.department AS department,
           sp.name AS clinic,
           os.cc, os.bps, os.bpd, os.bw, os.height, os.temperature, os.pulse
         FROM ovst o
         LEFT JOIN patient pt ON pt.hn = o.hn
         LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
         LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
         LEFT JOIN spclty sp ON sp.spclty = o.spclty
         LEFT JOIN opdscreen os ON os.vn = o.vn
         WHERE o.vn = ?
         LIMIT 1`,
        [visitCode]
      );
      patientRows = Array.isArray(patient) ? patient as Record<string, unknown>[] : [];

      const [diags] = await hosConnection.query(
        `SELECT d.diagtype, d.icd10, i.name AS code_name
         FROM ovstdiag d
         LEFT JOIN icd101 i ON i.code = d.icd10
         WHERE d.vn = ?
         ORDER BY d.diagtype, d.icd10`,
        [visitCode]
      );
      diagnosisRows = Array.isArray(diags) ? diags as Record<string, unknown>[] : [];

      const [procedures] = await hosConnection.query(
        `SELECT o.icd9, i.name AS code_name, 'doctor_operation' AS source
         FROM doctor_operation o
         LEFT JOIN icd9cm1 i ON i.code = o.icd9
         WHERE o.vn = ?
         UNION ALL
         SELECT eo.er_oper_code AS icd9, e.name AS code_name, 'er_regist_oper' AS source
         FROM er_regist_oper eo
         LEFT JOIN er_oper_code e ON e.er_oper_code = eo.er_oper_code
         WHERE eo.vn = ?`,
        [visitCode, visitCode]
      );
      procedureRows = Array.isArray(procedures) ? procedures as Record<string, unknown>[] : [];

      const [labs] = await hosConnection.query(
        `SELECT h.order_date, li.lab_items_name, lo.lab_order_result, li.lab_items_normal_value
         FROM lab_head h
         JOIN lab_order lo ON lo.lab_order_number = h.lab_order_number
         JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
         WHERE h.vn = ?
           AND lo.lab_order_result IS NOT NULL
           AND lo.lab_order_result <> ''
         ORDER BY h.order_date DESC, li.lab_items_name
         LIMIT 200`,
        [visitCode]
      );
      labRows = Array.isArray(labs) ? labs as Record<string, unknown>[] : [];
    } else {
      const [patient] = await hosConnection.query(
        `SELECT
           i.vn, i.an, i.hn, pt.cid,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           thaiage(pt.birthday, COALESCE(i.dchdate, i.regdate)) AS age,
           DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admit_date,
           TIME_FORMAT(i.regtime, '%H:%i') AS admit_time,
           DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS discharge_date,
           TIME_FORMAT(i.dchtime, '%H:%i') AS discharge_time,
           i.pttype, ptt.name AS pttype_name,
           w.name AS department,
           sp.name AS clinic
         FROM ipt i
         LEFT JOIN patient pt ON pt.hn = i.hn
         LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
         LEFT JOIN ward w ON w.ward = i.ward
         LEFT JOIN spclty sp ON sp.spclty = i.spclty
         WHERE i.an = ?
         LIMIT 1`,
        [visitCode]
      );
      patientRows = Array.isArray(patient) ? patient as Record<string, unknown>[] : [];

      const [diags] = await hosConnection.query(
        `SELECT d.diagtype, d.icd10, i.name AS code_name
         FROM iptdiag d
         LEFT JOIN icd101 i ON i.code = d.icd10
         WHERE d.an = ?
         ORDER BY d.diagtype, d.icd10`,
        [visitCode]
      );
      diagnosisRows = Array.isArray(diags) ? diags as Record<string, unknown>[] : [];

      const [procedures] = await hosConnection.query(
        `SELECT o.icd9, i.name AS code_name, 'iptoprt' AS source
         FROM iptoprt o
         LEFT JOIN icd9cm1 i ON i.code = o.icd9
         WHERE o.an = ?
         ORDER BY o.icd9`,
        [visitCode]
      );
      procedureRows = Array.isArray(procedures) ? procedures as Record<string, unknown>[] : [];

      const [labs] = await hosConnection.query(
        `SELECT h.order_date, li.lab_items_name, lo.lab_order_result, li.lab_items_normal_value
         FROM lab_head h
         JOIN lab_order lo ON lo.lab_order_number = h.lab_order_number
         JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
         WHERE (h.vn = ? OR h.vn = (SELECT vn FROM ipt WHERE an = ? LIMIT 1))
           AND lo.lab_order_result IS NOT NULL
           AND lo.lab_order_result <> ''
         ORDER BY h.order_date DESC, li.lab_items_name
         LIMIT 200`,
        [visitCode, visitCode]
      );
      labRows = Array.isArray(labs) ? labs as Record<string, unknown>[] : [];
    }

    const [receipts] = await hosConnection.query(
      `SELECT
         o.icode,
         COALESCE(sd.name, di.name, ndi.name, o.icode) AS item_name,
         inc.name AS income_name,
         o.qty,
         o.unitprice,
         o.sum_price,
         o.income,
         COALESCE(sd.nhso_adp_code, '') AS nhso_adp_code,
         COALESCE(sd.nhso_adp_type_id, '') AS nhso_adp_type_id,
         COALESCE(di.ttmt_code, '') AS ttmt_code,
         COALESCE(ndi.tmlt_code, '') AS tmlt_code
       FROM opitemrece o
       LEFT JOIN s_drugitems sd ON sd.icode = o.icode
       LEFT JOIN drugitems di ON di.icode = o.icode
       LEFT JOIN nondrugitems ndi ON ndi.icode = o.icode
       LEFT JOIN income inc ON inc.income = o.income
       WHERE ${patientType === 'OPD' ? 'o.vn = ?' : 'o.an = ?'}
       ORDER BY o.income, o.icode
       LIMIT 500`,
      [visitCode]
    );
    receiptRows = Array.isArray(receipts) ? receipts as Record<string, unknown>[] : [];

    const [repRows] = await repConnection.query(
      `SELECT rep_no, tran_id, vn, an, patient_type, department, senddate, maininscl, subinscl,
              errorcode, verifycode, projectcode, income, compensated, nhso, agency, filename, created_at
       FROM rep_data
       WHERE ${patientType === 'OPD' ? 'vn = ?' : 'an = ?'}
       ORDER BY senddate DESC, id DESC
       LIMIT 100`,
      [visitCode]
    );

    const tranIds = (Array.isArray(repRows) ? repRows as Record<string, unknown>[] : [])
      .map((row) => String(row.tran_id || '').trim())
      .filter(Boolean);
    const stmWhere = patientType === 'OPD'
      ? `(s.vn = ? OR s.matched_visit_code = ?${tranIds.length ? ` OR s.tran_id IN (${tranIds.map(() => '?').join(',')})` : ''})`
      : `(s.an = ? OR s.matched_visit_code = ?${tranIds.length ? ` OR s.tran_id IN (${tranIds.map(() => '?').join(',')})` : ''})`;
    const [stmRows] = await repConnection.query(
      `SELECT s.data_type, s.statement_no, s.tran_id, s.vn, s.an, s.patient_type, s.department,
              s.service_datetime, s.senddate, s.maininscl, s.subinscl, s.errorcode, s.verifycode,
              s.amount, s.paid_amount, s.invoice_amount, s.filename, s.matched_status, b.created_at
       FROM repstm_statement_data s
       LEFT JOIN repstm_import_batch b ON b.id = s.batch_id
       WHERE s.data_type IN ('STM', 'INV')
         AND ${stmWhere}
       ORDER BY b.created_at DESC, s.id DESC
       LIMIT 100`,
      [visitCode, visitCode, ...tranIds]
    );

    return {
      patient_type: patientType,
      visit_code: visitCode,
      patient: patientRows[0] || null,
      diagnoses: diagnosisRows,
      procedures: procedureRows,
      receipts: receiptRows,
      labs: labRows,
      rep: Array.isArray(repRows) ? repRows as Record<string, unknown>[] : [],
      stm: Array.isArray(stmRows) ? stmRows as Record<string, unknown>[] : [],
    };
  } finally {
    hosConnection.release();
    repConnection.release();
  }
};

export const getUuc1RepStmTracking = async (params: Uuc1TrackingQueryParams): Promise<{
  data: Uuc1TrackingRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    total_visits: number;
    rep_received: number;
    pending_rep: number;
    pending_stm: number;
    stm_received: number;
    stm_zero: number;
    rep_issue: number;
    mismatch: number;
    total_sent: number;
    total_rep: number;
    total_stm_paid: number;
    last_rep_import_at: string | null;
    last_stm_import_at: string | null;
  };
}> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(params.startDate || today.slice(0, 8) + '01').slice(0, 10);
  const endDate = String(params.endDate || today).slice(0, 10);
  const patientType = String(params.patientType || 'OPD').toUpperCase();
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(1000, Math.max(25, Number(params.pageSize || 200)));
  const statusFilter = String(params.status || 'ALL').trim();
  const search = String(params.search || '').trim().toLowerCase();
  const scanLimit = 20000;

  const baseRows = await getReceivableCandidates({
    startDate,
    endDate,
    patientType,
    patientRight: params.patientRight,
    hosxpRight: params.hosxpRight,
    financeRight: params.financeRight,
    limit: scanLimit,
  });

  if (baseRows.length === 0) {
    return {
      data: [],
      total: 0,
      page,
      pageSize,
      summary: {
        total_visits: 0,
        rep_received: 0,
        pending_rep: 0,
        pending_stm: 0,
        stm_received: 0,
        stm_zero: 0,
        rep_issue: 0,
        mismatch: 0,
        total_sent: 0,
        total_rep: 0,
        total_stm_paid: 0,
        last_rep_import_at: null,
        last_stm_import_at: null,
      },
    };
  }

  const vns = Array.from(new Set(baseRows.map((row) => String(row.vn || '').trim()).filter(Boolean)));
  const ans = Array.from(new Set(baseRows.map((row) => String(row.an || '').trim()).filter(Boolean)));
  const repMap = new Map<string, RepTrackingEntry>();
  const repTranToVisit = new Map<string, string>();
  const stmMap = new Map<string, StatementTrackingEntry>();
  const invMap = new Map<string, StatementTrackingEntry>();

  const repConnection = await getRepstmConnection();
  try {
    await ensureRepstmTables();

    const repClauses: string[] = [];
    const repParams: unknown[] = [];
    if (vns.length > 0) {
      repClauses.push(`rd.vn IN (${vns.map(() => '?').join(',')})`);
      repParams.push(...vns);
    }
    if (ans.length > 0) {
      repClauses.push(`rd.an IN (${ans.map(() => '?').join(',')})`);
      repParams.push(...ans);
    }

    if (repClauses.length > 0) {
      const [repRows] = await repConnection.query(
        `SELECT
           COALESCE(rd.vn, '') AS vn,
           COALESCE(rd.an, '') AS an,
           MAX(COALESCE(rd.compensated, rd.nhso, rd.agency, 0)) AS rep_amount,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(rd.rep_no, '')), '') ORDER BY rd.rep_no SEPARATOR ', ') AS rep_no,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(rd.tran_id, '')), '') ORDER BY rd.tran_id SEPARATOR ', ') AS tran_ids,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(rd.filename, '')), '') ORDER BY rd.filename SEPARATOR ', ') AS rep_filename,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(rd.errorcode, '')), '') ORDER BY rd.errorcode SEPARATOR ', ') AS rep_errorcode,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(rd.verifycode, '')), '') ORDER BY rd.verifycode SEPARATOR ', ') AS rep_verifycode,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(rd.projectcode, '')), '') ORDER BY rd.projectcode SEPARATOR ', ') AS rep_projectcode,
           MAX(rd.senddate) AS rep_senddate,
           MAX(b.created_at) AS rep_imported_at
         FROM rep_data rd
         LEFT JOIN repstm_import_batch b ON b.id = rd.batch_id
         WHERE ${repClauses.join(' OR ')}
         GROUP BY COALESCE(rd.vn, ''), COALESCE(rd.an, '')`,
        repParams,
      );

      (Array.isArray(repRows) ? repRows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const vn = String(rec.vn || '').trim();
        const an = String(rec.an || '').trim();
        const key = vn ? `VN:${vn}` : an ? `AN:${an}` : '';
        if (!key) return;
        const entry: RepTrackingEntry = {
          rep_amount: toTrackingNumber(rec.rep_amount),
          rep_no: mergeTrackingText(rec.rep_no),
          rep_imported_at: formatTrackingDateTime(rec.rep_imported_at),
          rep_senddate: formatTrackingDateTime(rec.rep_senddate),
          rep_filename: mergeTrackingText(rec.rep_filename),
          rep_errorcode: mergeTrackingText(rec.rep_errorcode),
          rep_verifycode: mergeTrackingText(rec.rep_verifycode),
          rep_projectcode: mergeTrackingText(rec.rep_projectcode),
          tran_ids: splitTrackingList(rec.tran_ids),
        };
        repMap.set(key, entry);
        entry.tran_ids.forEach((tranId) => repTranToVisit.set(tranId, vn || an));
      });
    }

    const statementClauses: string[] = [];
    const statementParams: unknown[] = [];
    const repTranIds = Array.from(repTranToVisit.keys());
    if (vns.length > 0) {
      statementClauses.push(`s.matched_visit_code IN (${vns.map(() => '?').join(',')})`);
      statementParams.push(...vns);
      statementClauses.push(`s.vn IN (${vns.map(() => '?').join(',')})`);
      statementParams.push(...vns);
    }
    if (ans.length > 0) {
      statementClauses.push(`s.matched_visit_code IN (${ans.map(() => '?').join(',')})`);
      statementParams.push(...ans);
      statementClauses.push(`s.an IN (${ans.map(() => '?').join(',')})`);
      statementParams.push(...ans);
    }
    if (repTranIds.length > 0) {
      statementClauses.push(`s.tran_id IN (${repTranIds.map(() => '?').join(',')})`);
      statementParams.push(...repTranIds);
    }

    const mergeStatementEntry = (map: Map<string, StatementTrackingEntry>, key: string, rec: Record<string, unknown>) => {
      const current = map.get(key);
      const nextAmount = toTrackingNumber(rec.total_amount);
      const nextPaid = toTrackingNumber(rec.total_paid_amount);
      if (!current) {
        map.set(key, {
          amount: nextAmount,
          paid_amount: nextPaid,
          imported_at: formatTrackingDateTime(rec.imported_at),
          statement_no: mergeTrackingText(rec.statement_no),
          filename: mergeTrackingText(rec.filename),
        });
        return;
      }
      current.amount = (current.amount ?? 0) + (nextAmount ?? 0);
      current.paid_amount = (current.paid_amount ?? 0) + (nextPaid ?? 0);
      current.imported_at = latestTrackingDateTime(current.imported_at, rec.imported_at);
      current.statement_no = mergeTrackingText(current.statement_no, rec.statement_no);
      current.filename = mergeTrackingText(current.filename, rec.filename);
    };

    if (statementClauses.length > 0) {
      const [statementRows] = await repConnection.query(
        `SELECT
           COALESCE(s.matched_visit_code, s.vn, s.an, '') AS visit_code,
           COALESCE(s.tran_id, '') AS tran_id,
           s.data_type,
           SUM(COALESCE(s.amount, 0)) AS total_amount,
           SUM(COALESCE(s.paid_amount, s.amount, 0)) AS total_paid_amount,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(s.statement_no, '')), '') ORDER BY s.statement_no SEPARATOR ', ') AS statement_no,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(s.filename, '')), '') ORDER BY s.filename SEPARATOR ', ') AS filename,
           MAX(b.created_at) AS imported_at
         FROM repstm_statement_data s
         LEFT JOIN repstm_import_batch b ON b.id = s.batch_id
         WHERE s.data_type IN ('STM', 'INV')
           AND (${statementClauses.join(' OR ')})
         GROUP BY COALESCE(s.matched_visit_code, s.vn, s.an, ''), COALESCE(s.tran_id, ''), s.data_type`,
        statementParams,
      );

      (Array.isArray(statementRows) ? statementRows : []).forEach((row) => {
        const rec = row as Record<string, unknown>;
        const tranId = String(rec.tran_id || '').trim();
        const visitCode = String(rec.visit_code || '').trim() || (tranId ? repTranToVisit.get(tranId) || '' : '');
        const dataType = String(rec.data_type || '').toUpperCase();
        if (!visitCode) return;
        if (dataType === 'STM') {
          mergeStatementEntry(stmMap, visitCode, rec);
        } else if (dataType === 'INV') {
          mergeStatementEntry(invMap, visitCode, rec);
        }
      });
    }
  } catch (error) {
    console.error('Error fetching UUC1 REP/STM tracking data:', error);
  } finally {
    repConnection.release();
  }

  const assembled: Uuc1TrackingRow[] = baseRows.map((base) => {
    const patientTypeValue = String(base.patient_type || '');
    const vn = String(base.vn || '').trim();
    const an = String(base.an || '').trim();
    const visitKey = an ? `AN:${an}` : `VN:${vn}`;
    const lookupCode = vn || an;
    const serviceDate = String(base.service_date || '').slice(0, 10);
    const sentAmount = toReceivableNumber(base.claimable_amount);
    const rep = repMap.get(visitKey) || null;
    const stm = lookupCode ? stmMap.get(lookupCode) || null : null;
    const inv = lookupCode ? invMap.get(lookupCode) || null : null;
    const repAmount = rep?.rep_amount ?? null;
    const stmPaidAmount = stm?.paid_amount ?? null;
    const invNetReceived = inv?.paid_amount ?? inv?.amount ?? null;
    const diffRep = repAmount == null ? null : Number((repAmount - sentAmount).toFixed(2));
    const effectiveNetReceived = invNetReceived ?? stmPaidAmount;
    const diffStm = effectiveNetReceived == null ? null : Number((effectiveNetReceived - sentAmount).toFixed(2));
    const hasRepIssue = Boolean(rep?.rep_errorcode || rep?.rep_verifycode);

    let followupStatusKey = 'paid';
    let followupStatus = 'ได้รับ STM';
    let followupNote = 'มี REP และ STM แล้ว';

    if (invNetReceived != null && invNetReceived > 0) {
      followupStatusKey = 'paid';
      followupStatus = 'เสร็จสิ้น (INV)';
      followupNote = `ได้รับยอดสุทธิจาก INV ${invNetReceived.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
    } else if (!rep) {
      followupStatusKey = 'pending_rep';
      followupStatus = 'รอ REP';
      followupNote = 'ยังไม่พบข้อมูล REP จากไฟล์ที่นำเข้า';
    } else if (hasRepIssue) {
      followupStatusKey = 'rep_issue';
      followupStatus = 'ติด C/Deny';
      followupNote = `พบรหัส ${mergeTrackingText(rep.rep_errorcode, rep.rep_verifycode) || 'C/Deny'} ใน REP`;
    } else if (!stm) {
      followupStatusKey = 'pending_stm';
      followupStatus = 'รอ STM';
      followupNote = 'มี REP แล้ว แต่ยังไม่พบ STM จากไฟล์ที่นำเข้า';
    } else if ((stmPaidAmount ?? 0) === 0) {
      followupStatusKey = 'stm_zero';
      followupStatus = 'STM = 0';
      followupNote = 'พบ STM แล้วแต่ยอดจ่ายเป็น 0';
    } else if (diffStm != null && Math.abs(diffStm) >= 0.01) {
      followupStatusKey = 'mismatch';
      followupStatus = 'ยอดต่าง';
      followupNote = 'ยอด STM ไม่ตรงกับยอดส่ง';
    }

    return {
      patient_type: patientTypeValue,
      visit_key: visitKey,
      vn,
      an,
      hn: String(base.hn || ''),
      cid: base.cid != null ? String(base.cid) : null,
      patient_name: String(base.patient_name || ''),
      pttype: String(base.pttype || ''),
      pttype_name: String(base.pttype_name || ''),
      hipdata_code: String(base.hipdata_code || ''),
      service_date: serviceDate,
      sent_amount: sentAmount,
      rep_amount: repAmount,
      rep_no: rep?.rep_no || null,
      rep_imported_at: rep?.rep_imported_at || null,
      rep_senddate: rep?.rep_senddate || null,
      rep_filename: rep?.rep_filename || null,
      rep_errorcode: rep?.rep_errorcode || null,
      rep_verifycode: rep?.rep_verifycode || null,
      rep_projectcode: rep?.rep_projectcode || null,
      stm_amount: stm?.amount ?? null,
      stm_paid_amount: stmPaidAmount,
      stm_imported_at: stm?.imported_at || null,
      stm_statement_no: stm?.statement_no || null,
      stm_filename: stm?.filename || null,
      inv_amount: invNetReceived,
      inv_imported_at: inv?.imported_at || null,
      diff_rep: diffRep,
      diff_stm: diffStm,
      days_to_rep: trackingDayDiff(serviceDate, rep?.rep_imported_at || null),
      days_to_stm: trackingDayDiff(rep?.rep_imported_at || serviceDate, inv?.imported_at || stm?.imported_at || null),
      followup_status: followupStatus,
      followup_status_key: followupStatusKey,
      followup_note: followupNote,
    };
  });

  const searched = search
    ? assembled.filter((row) => [
        row.vn,
        row.an,
        row.hn,
        row.cid,
        row.patient_name,
        row.pttype,
        row.pttype_name,
        row.rep_no,
        row.stm_statement_no,
        row.followup_note,
      ].some((value) => String(value || '').toLowerCase().includes(search)))
    : assembled;

  const filtered = statusFilter === 'ALL' || statusFilter === ''
    ? searched
    : searched.filter((row) => row.followup_status_key === statusFilter);

  const summary = {
    total_visits: filtered.length,
    rep_received: filtered.filter((row) => Boolean(row.rep_no)).length,
    pending_rep: filtered.filter((row) => row.followup_status_key === 'pending_rep').length,
    pending_stm: filtered.filter((row) => row.followup_status_key === 'pending_stm').length,
    stm_received: filtered.filter((row) => row.stm_imported_at != null || row.inv_imported_at != null).length,
    stm_zero: filtered.filter((row) => row.followup_status_key === 'stm_zero').length,
    rep_issue: filtered.filter((row) => row.followup_status_key === 'rep_issue').length,
    mismatch: filtered.filter((row) => row.followup_status_key === 'mismatch').length,
    total_sent: Math.round(filtered.reduce((sum, row) => sum + row.sent_amount, 0) * 100) / 100,
    total_rep: Math.round(filtered.reduce((sum, row) => sum + (row.rep_amount ?? 0), 0) * 100) / 100,
    total_stm_paid: Math.round(filtered.reduce((sum, row) => sum + (row.inv_amount ?? row.stm_paid_amount ?? 0), 0) * 100) / 100,
    last_rep_import_at: latestTrackingDateTime(...filtered.map((row) => row.rep_imported_at)),
    last_stm_import_at: latestTrackingDateTime(...filtered.map((row) => row.inv_imported_at || row.stm_imported_at)),
  };

  const total = filtered.length;
  const offset = (page - 1) * pageSize;
  const data = filtered.slice(offset, offset + pageSize);

  return { data, total, page, pageSize, summary };
};

export const getInsuranceOverview = async (options: {
  startDate?: string;
  endDate?: string;
  accountCode?: string;
  valeTargetFilename?: string;
}): Promise<Record<string, unknown>> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(options.startDate || today.slice(0, 8) + '01').slice(0, 10);
  const endDate = String(options.endDate || today).slice(0, 10);
  const accountCode = String(options.accountCode || '').trim();
  const valeTargetFilename = String(options.valeTargetFilename || '16แฟ้มFDH.xlsx').trim();
  const hosConnection = await getUTFConnection();
  const repConnection = await getRepstmConnection();

  const toNumber = (value: unknown) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
  };

  const resolveValeImportStatus = async (targetFilename: string) => {
    if (!targetFilename) return null;
    const likePattern = `%${targetFilename}%`;
    const [valeBatchRows] = await repConnection.query(
      `SELECT
         COUNT(*) AS batch_matches,
         MAX(created_at) AS last_import_at
       FROM repstm_import_batch
       WHERE source_filename LIKE ?`,
      [likePattern]
    );
    const [valeRepRows] = await repConnection.query(
      `SELECT COUNT(*) AS rep_data_matches
       FROM rep_data
       WHERE filename LIKE ?`,
      [likePattern]
    );
    const [latestBatchRows] = await repConnection.query(
      `SELECT id, data_type, source_filename, row_count, created_at
       FROM repstm_import_batch
       WHERE source_filename LIKE ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [likePattern]
    );

    const batchRow = Array.isArray(valeBatchRows) && valeBatchRows.length > 0
      ? valeBatchRows[0] as Record<string, unknown>
      : {};
    const repRow = Array.isArray(valeRepRows) && valeRepRows.length > 0
      ? valeRepRows[0] as Record<string, unknown>
      : {};
    const latestBatchRow = Array.isArray(latestBatchRows) && latestBatchRows.length > 0
      ? latestBatchRows[0] as Record<string, unknown>
      : {};
    const batchMatches = toNumber(batchRow.batch_matches);
    const repDataMatches = toNumber(repRow.rep_data_matches);

    return {
      target_filename: targetFilename,
      status: batchMatches > 0 || repDataMatches > 0 ? 'found' : 'missing',
      batch_matches: batchMatches,
      rep_data_matches: repDataMatches,
      last_import_at: batchRow.last_import_at || null,
      latest_batch_id: batchMatches > 0 ? toNumber(latestBatchRow.id) : null,
      latest_batch_data_type: latestBatchRow.data_type || null,
      latest_batch_source_filename: latestBatchRow.source_filename || null,
      latest_batch_row_count: batchMatches > 0 ? toNumber(latestBatchRow.row_count) : null,
    };
  };

  const diffDays = (from: unknown, to: unknown) => {
    if (!from || !to) return null;
    const start = new Date(String(from));
    const end = new Date(String(to));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  };

  const monthKey = (value: unknown) => String(value || '').slice(0, 7) || 'ไม่ระบุ';
  const hasFdhStatus = (row: Record<string, unknown>) => Boolean(
    row.transaction_uid
    || row.fdh_reservation_status
    || row.fdh_claim_status_message
    || row.error_code
    || row.fdh_stm_period
    || row.fdh_act_amt != null
    || row.fdh_settle_at
    || row.fdh_updated_at
  );
  const formatFdhDisplayStatus = (value: unknown) => {
    const raw = String(value || '').trim();
    const normalized = raw.toLowerCase();
    if (!raw) return '';
    if (normalized === 'received') return 'รับข้อมูลรอประมวลผล';
    if (normalized === 'unclaimed') return 'ไม่มีรายการนี้ส่งเข้ามาในระบบ';
    if (normalized.includes('unclaimed') && raw.includes('ไม่ประสงค์')) return 'ไม่ประสงค์เบิก สปสช.';
    if (normalized === 'cut_off_batch') return 'ตัดรอบการเบิกจ่าย';
    if (normalized.includes('cut_off_batch')) return raw.includes('ตัดรอบ') ? raw : 'ตัดรอบการเบิกจ่าย';
    if (normalized.includes('processed') || normalized.includes('process_pass') || normalized.includes('approved')) return 'ประมวลผลผ่าน';
    if (normalized.includes('reject') || normalized.includes('deny')) return raw;
    return raw;
  };
  const isFdhMissingStatus = (value: unknown) => {
    const raw = String(value || '').trim().toLowerCase();
    const display = formatFdhDisplayStatus(value).toLowerCase();
    return !raw
      || raw.includes('unclaimed')
      || display.includes('ไม่มีรายการนี้')
      || display.includes('ไม่ประสงค์')
      || display.includes('ยังไม่พบ');
  };
  const buildFdhStatusLabel = (row: Record<string, unknown>) => {
    const reservationStatus = String(row.fdh_reservation_status || '').trim();
    const message = String(row.fdh_claim_status_message || '').trim();
    if (reservationStatus) return formatFdhDisplayStatus(reservationStatus);
    if (message) return formatFdhDisplayStatus(message);
    if (row.transaction_uid) return 'ส่ง FDH แล้ว';
    return 'ยังไม่พบในรายการส่งเคลม FDH';
  };
  const initMonth = (month: string) => ({
    month,
    opdVisits: 0,
    opdIncome: 0,
    opdExpectedReceivable: 0,
    opdClosed: 0,
    opdMissingClose: 0,
    ipdDischarged: 0,
    ipdIncome: 0,
    ipdExpectedReceivable: 0,
    ipdFdhSubmitted: 0,
    ipdRepReceived: 0,
    nonClaimable: 0,
    receivable: 0,
  });

  try {
    await ensureFdhClaimStatusTable();
    await ensureRepstmTables();
    await ensureNhsoClosePrivilegeTable();

    const receivableRows = await getReceivableCandidates({
      startDate,
      endDate,
      patientType: 'ALL',
    });

    const filteredReceivableRows = accountCode
      ? receivableRows.filter((row) => (
        String(row.debtor_code || '').includes(accountCode)
        || String(row.revenue_code || '').includes(accountCode)
        || String(row.finance_right_code || '').includes(accountCode)
        || String(row.finance_right_name || '').includes(accountCode)
      ))
      : receivableRows;

    const receivableByVisit = new Map<string, Record<string, unknown>>();
    filteredReceivableRows.forEach((row) => {
      const key = String(row.patient_type).toUpperCase() === 'IPD'
        ? `AN:${row.an || ''}`
        : `VN:${row.vn || ''}`;
      if (key !== 'AN:' && key !== 'VN:') receivableByVisit.set(key, row);
    });

    const [opdRows] = await hosConnection.query(
      `SELECT
         DATE_FORMAT(o.vstdate, '%Y-%m') AS month,
         COUNT(*) AS visit_count,
         ROUND(SUM(COALESCE(v.income, 0)), 2) AS total_income,
         SUM(
           CASE
             WHEN IFNULL(ncp.nhso_status, '') = 'Y'
               OR IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
               OR IFNULL((SELECT claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1), '') <> ''
             THEN 1 ELSE 0
           END
         ) AS closed_count
       FROM ovst o
       LEFT JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN nhso_confirm_privilege ncp ON ncp.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(o.vstdate, '%Y-%m')
       ORDER BY month`,
      [startDate, endDate]
    );

    const [opdDetailRowsRaw] = await hosConnection.query(
      `SELECT
         o.vn,
         o.hn,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
         DATE_FORMAT(o.vstdate, '%Y-%m') AS month,
         COALESCE(v.income, 0) AS income,
         ptt.pttype,
         ptt.name AS pttype_name,
         ptt.hipdata_code,
         CASE
           WHEN IFNULL(ncp.nhso_status, '') = 'Y'
             OR IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
             OR IFNULL((SELECT claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1), '') <> ''
           THEN 1 ELSE 0
         END AS close_completed,
         COALESCE(
           NULLIF(ncp.nhso_authen_code, ''),
           (SELECT claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1)
         ) AS close_code
       FROM ovst o
       LEFT JOIN patient pt ON pt.hn = o.hn
       LEFT JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
       LEFT JOIN nhso_confirm_privilege ncp ON ncp.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ?
       ORDER BY o.vstdate DESC, o.vn DESC`,
      [startDate, endDate]
    );

    const [ipdRows] = await hosConnection.query(
      `SELECT
         i.an,
         i.vn,
         i.hn,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admdate,
         DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dchdate,
         DATE_FORMAT(i.dchdate, '%Y-%m') AS month,
         COALESCE(a.income, 0) AS income,
         COALESCE(a.rcpt_money, 0) AS rcpt_money,
         COALESCE(a.discount_money, 0) AS discount_money,
         ptt.pttype,
         ptt.name AS pttype_name,
         ptt.hipdata_code,
         COALESCE(w.name, i.ward, '') AS ward,
         fdh.transaction_uid,
         fdh.fdh_reservation_status,
         fdh.fdh_reservation_datetime,
         fdh.fdh_claim_status_message,
         fdh.error_code,
         fdh.fdh_stm_period,
         fdh.fdh_act_amt,
         fdh.fdh_settle_at,
         fdh.updated_at AS fdh_updated_at
       FROM ipt i
       LEFT JOIN an_stat a ON a.an = i.an
       LEFT JOIN patient pt ON pt.hn = i.hn
       LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
       LEFT JOIN ward w ON w.ward = i.ward
       LEFT JOIN (
         SELECT s.*
         FROM fdh_claim_status s
         JOIN (
           SELECT vn, MAX(updated_at) AS max_updated_at
           FROM fdh_claim_status
           WHERE IFNULL(vn, '') <> ''
           GROUP BY vn
         ) latest ON latest.vn = s.vn AND latest.max_updated_at = s.updated_at
       ) fdh ON fdh.vn = i.vn
       WHERE i.dchdate BETWEEN ? AND ?
       ORDER BY i.dchdate DESC, i.an DESC`,
      [startDate, endDate]
    );

    const opdVnList = (Array.isArray(opdDetailRowsRaw) ? opdDetailRowsRaw : [])
      .map((row: any) => String(row.vn || '').trim())
      .filter(Boolean);
    const opdClaimDetailMap = new Map<string, Record<string, unknown>>();
    if (opdVnList.length > 0) {
      const [opdClaimDetailRows] = await repConnection.query(
        `SELECT d.*
         FROM fdh_claim_detail_row d
         JOIN (
           SELECT vn AS match_key, MAX(id) AS max_id
           FROM fdh_claim_detail_row
           WHERE IFNULL(vn, '') <> ''
             AND UPPER(IFNULL(patient_type, '')) IN ('OP', 'OPD')
             AND vn IN (${opdVnList.map(() => '?').join(',')})
           GROUP BY vn
         ) latest ON latest.max_id = d.id`,
        opdVnList
      );
      (Array.isArray(opdClaimDetailRows) ? opdClaimDetailRows : []).forEach((row: any) => {
        const vn = String(row.vn || '').trim();
        if (vn) opdClaimDetailMap.set(`VN:${vn}`, row as Record<string, unknown>);
      });
    }

    // OPD fallback: check fdh_claim_status for VNs not found in ClaimDetail import
    const opdFdhStatusMap = new Map<string, Record<string, unknown>>();
    const opdVnsNotInClaimDetail = opdVnList.filter((vn) => !opdClaimDetailMap.has(`VN:${vn}`));
    if (opdVnsNotInClaimDetail.length > 0) {
      const [opdFdhStatusRows] = await hosConnection.query(
        `SELECT s.*
         FROM fdh_claim_status s
         JOIN (
           SELECT vn, MAX(updated_at) AS max_updated_at
           FROM fdh_claim_status
           WHERE IFNULL(vn, '') <> '' AND vn IN (${opdVnsNotInClaimDetail.map(() => '?').join(',')})
           GROUP BY vn
         ) latest ON latest.vn = s.vn AND latest.max_updated_at = s.updated_at`,
        opdVnsNotInClaimDetail
      );
      (Array.isArray(opdFdhStatusRows) ? opdFdhStatusRows : []).forEach((row: any) => {
        const vn = String(row.vn || '').trim();
        if (vn) opdFdhStatusMap.set(`VN:${vn}`, row as Record<string, unknown>);
      });
    }

    const ipdAnList = (Array.isArray(ipdRows) ? ipdRows : [])
      .map((row: any) => String(row.an || '').trim())
      .filter(Boolean);
    const ipdVnList = (Array.isArray(ipdRows) ? ipdRows : [])
      .map((row: any) => String(row.vn || '').trim())
      .filter(Boolean);
    const ipdTranIdList = (Array.isArray(ipdRows) ? ipdRows : [])
      .map((row: any) => String(row.transaction_uid || '').trim())
      .filter(Boolean);

    let fdhClaimDetailMap = new Map<string, Record<string, unknown>>();
    if (ipdAnList.length > 0) {
      const fdhDetailParams: string[] = [...ipdAnList];
      const [fdhDetailRows] = await repConnection.query(
        `SELECT d.*
         FROM fdh_claim_detail_row d
         JOIN (
           SELECT an AS match_key, MAX(id) AS max_id
           FROM fdh_claim_detail_row
           WHERE IFNULL(an, '') <> ''
             AND UPPER(IFNULL(patient_type, '')) IN ('IP', 'IPD')
             AND an IN (${ipdAnList.map(() => '?').join(',')})
           GROUP BY an
         ) latest ON latest.max_id = d.id`,
        fdhDetailParams
      );
      fdhClaimDetailMap = new Map();
      (Array.isArray(fdhDetailRows) ? fdhDetailRows : []).forEach((row: any) => {
        const detail = row as Record<string, unknown>;
        const an = String(row.an || '').trim();
        if (an) fdhClaimDetailMap.set(`AN:${an}`, detail);
      });
    }

    let repMap = new Map<string, Record<string, unknown>>();
    if (ipdAnList.length > 0 || ipdVnList.length > 0 || ipdTranIdList.length > 0) {
      const whereParts: string[] = [];
      const repParams: string[] = [];
      if (ipdAnList.length > 0) {
        whereParts.push(`an IN (${ipdAnList.map(() => '?').join(',')})`);
        repParams.push(...ipdAnList);
      }
      if (ipdVnList.length > 0) {
        whereParts.push(`vn IN (${ipdVnList.map(() => '?').join(',')})`);
        repParams.push(...ipdVnList);
      }
      if (ipdTranIdList.length > 0) {
        whereParts.push(`tran_id IN (${ipdTranIdList.map(() => '?').join(',')})`);
        repParams.push(...ipdTranIdList);
      }
      const [repRows] = await repConnection.query(
        `SELECT
           an,
           vn,
           tran_id,
           MAX(rep_no) AS rep_no,
           MIN(senddate) AS senddate,
           MAX(created_at) AS rep_imported_at,
           MAX(COALESCE(compensated, nhso, agency, 0)) AS rep_amount,
           GROUP_CONCAT(DISTINCT errorcode ORDER BY errorcode SEPARATOR ', ') AS errorcode
         FROM rep_data
         WHERE department = 'IP' AND (${whereParts.join(' OR ')})
         GROUP BY an, vn, tran_id`,
        repParams
      );
      repMap = new Map();
      (Array.isArray(repRows) ? repRows : []).forEach((row: any) => {
        const repRow = row as Record<string, unknown>;
        const an = String(row.an || '').trim();
        const vn = String(row.vn || '').trim();
        const tranId = String(row.tran_id || '').trim();
        if (an) repMap.set(`AN:${an}`, repRow);
        if (vn) repMap.set(`VN:${vn}`, repRow);
        if (tranId) repMap.set(`TRN:${tranId}`, repRow);
      });
    }

    const months = new Map<string, ReturnType<typeof initMonth>>();
    const getMonth = (month: string) => {
      if (!months.has(month)) months.set(month, initMonth(month));
      return months.get(month)!;
    };

    (Array.isArray(opdRows) ? opdRows : []).forEach((row: any) => {
      const month = getMonth(String(row.month || 'ไม่ระบุ'));
      month.opdVisits += toNumber(row.visit_count);
      month.opdIncome += toNumber(row.total_income);
      month.opdClosed += toNumber(row.closed_count);
      month.opdMissingClose += Math.max(0, toNumber(row.visit_count) - toNumber(row.closed_count));
    });

    filteredReceivableRows.forEach((row) => {
      const month = getMonth(monthKey(row.service_date));
      const amount = toNumber(row.claimable_amount);
      month.receivable += amount;
      if (String(row.patient_type).toUpperCase() === 'IPD') {
        month.ipdExpectedReceivable += amount;
      } else {
        month.opdExpectedReceivable += amount;
      }
    });

    const opdStatusRows = (Array.isArray(opdDetailRowsRaw) ? opdDetailRowsRaw : []).map((row: any) => {
      const claimDetail = opdClaimDetailMap.get(`VN:${String(row.vn || '').trim()}`) || null;
      const fdhApiStatus = opdFdhStatusMap.get(`VN:${String(row.vn || '').trim()}`) || null;
      const claimDetailStatus = String(claimDetail?.claim_status || '').trim();
      const fdhApiRawStatus = String(fdhApiStatus?.fdh_reservation_status || fdhApiStatus?.fdh_claim_status_message || '').trim();
      const rawFdhStatus = claimDetailStatus || fdhApiRawStatus;
      const isMissingInFdh = isFdhMissingStatus(rawFdhStatus) && !fdhApiStatus?.transaction_uid;
      const fdhFoundViaClaimDetail = Boolean(claimDetail) && !isFdhMissingStatus(claimDetailStatus);
      const fdhFoundViaApi = Boolean(fdhApiStatus) && Boolean(fdhApiStatus?.transaction_uid) && !isFdhMissingStatus(fdhApiRawStatus);
      const fdhFound = fdhFoundViaClaimDetail || fdhFoundViaApi;
      const effectiveFdhSentAt = fdhFound
        ? (claimDetail?.sent_at || fdhApiStatus?.fdh_reservation_datetime || null)
        : null;
      const fdhSource = claimDetail ? 'FDH ClaimDetail' : (fdhApiStatus ? 'FDH API' : null);
      const fdhStatusDisplay = claimDetail
        ? formatFdhDisplayStatus(claimDetail.claim_status)
        : (fdhApiStatus
          ? formatFdhDisplayStatus(fdhApiStatus.fdh_reservation_status || fdhApiStatus.fdh_claim_status_message)
          : 'ยังไม่พบในรายการส่งเคลม FDH');
      return {
        vn: row.vn,
        hn: row.hn,
        patient_name: row.patient_name,
        service_date: row.service_date,
        month: row.month,
        pttype: row.pttype,
        pttype_name: row.pttype_name,
        hipdata_code: row.hipdata_code,
        income: toNumber(row.income),
        close_completed: Boolean(row.close_completed),
        close_code: row.close_code || null,
        fdh_found: fdhFound,
        fdh_source: fdhSource,
        fdh_claim_code: claimDetail?.claim_code || null,
        fdh_upload_uid: claimDetail?.upload_uid || fdhApiStatus?.transaction_uid || null,
        fdh_status: fdhStatusDisplay,
        fdh_sent_at: effectiveFdhSentAt,
        fdh_followup_note: fdhFound ? 'ส่งเข้า FDH แล้ว' : (isMissingInFdh ? 'ยังไม่ส่งหรือยังไม่พบรายการ OPD ใน FDH' : 'พบสถานะ FDH แต่ยังไม่มี transaction_uid'),
      };
    });

    const ipdDetailRows = (Array.isArray(ipdRows) ? ipdRows : []).map((row: any) => {
      const fdhClaimDetail = fdhClaimDetailMap.get(`AN:${String(row.an || '').trim()}`) || null;
      const rep = repMap.get(`AN:${String(row.an || '').trim()}`)
        || repMap.get(`VN:${String(row.vn || '').trim()}`)
        || repMap.get(`TRN:${String(row.transaction_uid || '').trim()}`)
        || null;
      const rawFdhStatus = fdhClaimDetail?.claim_status || row.fdh_reservation_status || row.fdh_claim_status_message || '';
      const fdhStatus = fdhClaimDetail?.claim_status ? String(fdhClaimDetail.claim_status) : buildFdhStatusLabel(row);
      const isMissingInFdh = isFdhMissingStatus(rawFdhStatus || fdhStatus);
      const fdhSentAt = fdhClaimDetail?.sent_at || row.fdh_reservation_datetime || row.fdh_updated_at || null;
      const effectiveFdhSentAt = isMissingInFdh ? null : fdhSentAt;
      const fdhFound = !isMissingInFdh && (Boolean(fdhClaimDetail) || hasFdhStatus(row));
      const fdhFollowupNote = isMissingInFdh
        ? 'ยังไม่ส่งหรือยังไม่พบรายการ IPD ใน FDH ให้ตาม chart'
        : (effectiveFdhSentAt ? 'ส่งเข้า FDH แล้ว' : 'พบสถานะ FDH แต่ยังไม่มีวันส่ง');
      const receivable = receivableByVisit.get(`AN:${row.an || ''}`);
      const expected = receivable ? toNumber(receivable.claimable_amount) : Math.max(toNumber(row.income) - toNumber(row.rcpt_money) - toNumber(row.discount_money), 0);
      const repAmount = rep ? toNumber(rep.rep_amount) : null;
      const month = getMonth(String(row.month || monthKey(row.dchdate)));
      month.ipdDischarged += 1;
      month.ipdIncome += toNumber(row.income);
      if (fdhFound) month.ipdFdhSubmitted += 1;
      if (rep) month.ipdRepReceived += 1;
      if (expected <= 0) month.nonClaimable += toNumber(row.income);

      return {
        an: row.an,
        vn: row.vn,
        hn: row.hn,
        patient_name: row.patient_name,
        admdate: row.admdate,
        dchdate: row.dchdate,
        month: row.month,
        pttype: row.pttype,
        pttype_name: row.pttype_name,
        hipdata_code: row.hipdata_code,
        ward: row.ward,
        income: toNumber(row.income),
        expected_receivable: expected,
        transaction_uid: fdhClaimDetail?.upload_uid || row.transaction_uid,
        fdh_found: fdhFound,
        fdh_source: fdhClaimDetail ? 'FDH ClaimDetail' : 'FDH API',
        fdh_claim_code: fdhClaimDetail?.claim_code || null,
        fdh_upload_uid: fdhClaimDetail?.upload_uid || null,
        fdh_status_raw: rawFdhStatus,
        fdh_status: fdhStatus,
        fdh_followup_note: fdhFollowupNote,
        fdh_message: fdhClaimDetail?.claim_status || row.fdh_claim_status_message,
        fdh_error_code: row.error_code,
        fdh_sent_at: effectiveFdhSentAt,
        days_dch_to_fdh: diffDays(row.dchdate, effectiveFdhSentAt || today),
        rep_no: rep?.rep_no || null,
        rep_received_at: rep?.rep_imported_at || rep?.senddate || null,
        days_dch_to_rep: diffDays(row.dchdate, rep?.rep_imported_at || rep?.senddate),
        rep_amount: repAmount,
        diff_amount: repAmount == null ? null : repAmount - expected,
        errorcode: rep?.errorcode || null,
      };
    });

    const accountRows = new Map<string, Record<string, unknown>>();
    filteredReceivableRows.forEach((row) => {
      const patientType = String(row.patient_type || '').toUpperCase();
      const debtorCode = String(row.debtor_code || '').trim() || 'ไม่พบหัวบัญชีลูกหนี้';
      const revenueCode = String(row.revenue_code || '').trim() || 'ไม่พบหัวบัญชีรายได้';
      const key = `${patientType}|${debtorCode}|${revenueCode}|${row.finance_right_code || ''}`;
      const current = accountRows.get(key) || {
        patient_type: patientType,
        finance_right_code: row.finance_right_code || '',
        finance_right_name: row.finance_right_name || 'ไม่พบ mapping สิทธิ',
        debtor_code: debtorCode,
        revenue_code: revenueCode,
        item_count: 0,
        total_receivable: 0,
      };
      current.item_count = toNumber(current.item_count) + 1;
      current.total_receivable = toNumber(current.total_receivable) + toNumber(row.claimable_amount);
      accountRows.set(key, current);
    });

    const missingRuleRowsFull = filteredReceivableRows
      .filter((row) => !row.debtor_code || !row.revenue_code || !row.finance_right_code);
    const missingRuleRows = missingRuleRowsFull.slice(0, 50).map((row) => ({
      patient_type: row.patient_type,
      vn: row.vn,
      an: row.an,
      hn: row.hn,
      pttype: row.pttype,
      pttype_name: row.pttype_name,
      hipdata_code: row.hipdata_code,
      claimable_amount: row.claimable_amount,
    }));

    const summary = {
      opdVisits: 0,
      opdIncome: 0,
      opdExpectedReceivable: 0,
      opdClosed: 0,
      opdMissingClose: 0,
      ipdDischarged: ipdDetailRows.length,
      ipdIncome: ipdDetailRows.reduce((sum, row) => sum + toNumber(row.income), 0),
      ipdExpectedReceivable: 0,
      ipdFdhSubmitted: ipdDetailRows.filter(row => row.fdh_found).length,
      ipdRepReceived: ipdDetailRows.filter(row => row.rep_no).length,
      receivableTotal: filteredReceivableRows.reduce((sum, row) => sum + toNumber(row.claimable_amount), 0),
      nonClaimableTotal: 0,
      missingRuleCount: missingRuleRowsFull.length,
    };

    Array.from(months.values()).forEach((month) => {
      summary.opdVisits += month.opdVisits;
      summary.opdIncome += month.opdIncome;
      summary.opdExpectedReceivable += month.opdExpectedReceivable;
      summary.opdClosed += month.opdClosed;
      summary.opdMissingClose += month.opdMissingClose;
      summary.ipdExpectedReceivable += month.ipdExpectedReceivable;
      summary.nonClaimableTotal += month.nonClaimable;
    });

    const lagRows = ipdDetailRows
      .filter(row => row.dchdate);

    const valeSuggestionMap = new Map<string, {
      patient_type: string;
      pttype: string;
      pttype_name: string;
      hipdata_code: string;
      total: number;
      claimable_amount: number;
      missing_finance_count: number;
      missing_debtor_count: number;
      missing_revenue_count: number;
      suggested_action: string;
    }>();

    missingRuleRowsFull.forEach((row) => {
      const patientType = String(row.patient_type || '-').toUpperCase();
      const pttype = String(row.pttype || '-');
      const pttypeName = String(row.pttype_name || '');
      const hipdataCode = String(row.hipdata_code || '-').trim() || '-';
      const key = `${patientType}|${pttype}|${hipdataCode}`;
      const current = valeSuggestionMap.get(key) || {
        patient_type: patientType,
        pttype,
        pttype_name: pttypeName,
        hipdata_code: hipdataCode,
        total: 0,
        claimable_amount: 0,
        missing_finance_count: 0,
        missing_debtor_count: 0,
        missing_revenue_count: 0,
        suggested_action: '',
      };

      current.total += 1;
      current.claimable_amount += toNumber(row.claimable_amount);
      if (!row.finance_right_code) current.missing_finance_count += 1;
      if (!row.debtor_code) current.missing_debtor_count += 1;
      if (!row.revenue_code) current.missing_revenue_count += 1;

      const actions: string[] = [];
      if (current.missing_finance_count > 0) actions.push('เพิ่ม mapping สิทธิการเงิน');
      if (current.missing_debtor_count > 0) actions.push('เพิ่ม vale/rules รหัสลูกหนี้');
      if (current.missing_revenue_count > 0) actions.push('เพิ่ม vale/rules รหัสรายได้');
      current.suggested_action = actions.join(' + ');
      valeSuggestionMap.set(key, current);
    });

    const frequentEntryIssues = [
      {
        issue_key: 'OPD_CLOSE_MISSING',
        issue_label: 'OPD ยังไม่ปิดสิทธิ์/ไม่พบรหัส EP',
        total: opdStatusRows.filter((row) => !row.close_completed).length,
        total_amount: opdStatusRows
          .filter((row) => !row.close_completed)
          .reduce((sum, row) => sum + toNumber(row.income), 0),
      },
      {
        issue_key: 'OPD_NOT_FOUND_FDH',
        issue_label: 'OPD ยังไม่พบใน FDH',
        total: opdStatusRows.filter((row) => !row.fdh_found).length,
        total_amount: opdStatusRows
          .filter((row) => !row.fdh_found)
          .reduce((sum, row) => sum + toNumber(row.income), 0),
      },
      {
        issue_key: 'IPD_NOT_FOUND_FDH',
        issue_label: 'IPD ยังไม่พบใน FDH',
        total: ipdDetailRows.filter((row) => !row.fdh_found).length,
        total_amount: ipdDetailRows
          .filter((row) => !row.fdh_found)
          .reduce((sum, row) => sum + toNumber(row.expected_receivable), 0),
      },
      {
        issue_key: 'IPD_REP_NOT_RECEIVED',
        issue_label: 'IPD ส่ง FDH แล้วแต่ยังไม่มี REP/STM',
        total: ipdDetailRows.filter((row) => row.fdh_found && !row.rep_no).length,
        total_amount: ipdDetailRows
          .filter((row) => row.fdh_found && !row.rep_no)
          .reduce((sum, row) => sum + toNumber(row.expected_receivable), 0),
      },
      {
        issue_key: 'MAPPING_MISSING',
        issue_label: 'ข้อมูลสิทธิยังขาด mapping (vale/rules)',
        total: missingRuleRowsFull.length,
        total_amount: missingRuleRowsFull.reduce((sum, row) => sum + toNumber(row.claimable_amount), 0),
      },
    ].filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || b.total_amount - a.total_amount);

    const repErrorMap = new Map<string, { error_code: string; total: number }>();
    ipdDetailRows.forEach((row) => {
      String(row.errorcode || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((errorCode) => {
          const current = repErrorMap.get(errorCode) || { error_code: errorCode, total: 0 };
          current.total += 1;
          repErrorMap.set(errorCode, current);
        });
    });

    const fdhErrorStatusMap = new Map<string, { status_label: string; total: number }>();
    [...opdStatusRows, ...ipdDetailRows].forEach((row) => {
      const status = String(row.fdh_status || '').trim();
      if (!status) return;
      const normalized = status.toLowerCase();
      const isErrorLike = normalized.includes('reject')
        || normalized.includes('deny')
        || normalized.includes('unclaimed')
        || normalized.includes('cut_off')
        || status.includes('ไม่พบ')
        || status.includes('ไม่ประสงค์')
        || status.includes('ตัดรอบ')
        || status.includes('ปฏิเสธ');
      if (!isErrorLike) return;
      const current = fdhErrorStatusMap.get(status) || { status_label: status, total: 0 };
      current.total += 1;
      fdhErrorStatusMap.set(status, current);
    });

    const frequentSystemErrors = {
      rep_error_codes: Array.from(repErrorMap.values())
        .sort((a, b) => b.total - a.total || a.error_code.localeCompare(b.error_code, 'th'))
        .slice(0, 10),
      fdh_status_errors: Array.from(fdhErrorStatusMap.values())
        .sort((a, b) => b.total - a.total || a.status_label.localeCompare(b.status_label, 'th'))
        .slice(0, 10),
    };

    const repRowsWithAmount = ipdDetailRows.filter((row) => row.rep_amount != null);
    const repRowsWithDiff = ipdDetailRows.filter((row) => row.diff_amount != null);
    const repRowsWithLag = ipdDetailRows
      .map((row) => Number(row.days_dch_to_rep))
      .filter((value) => Number.isFinite(value));
    const sortedLagDays = [...repRowsWithLag].sort((a, b) => a - b);
    const percentile = (values: number[], p: number) => {
      if (values.length === 0) return null;
      const idx = Math.max(0, Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1));
      return values[idx];
    };

    const repFinancial = {
      ipd_total_cases: ipdDetailRows.length,
      rep_received_cases: repRowsWithAmount.length,
      rep_missing_cases: Math.max(0, ipdDetailRows.length - repRowsWithAmount.length),
      expected_total: ipdDetailRows.reduce((sum, row) => sum + toNumber(row.expected_receivable), 0),
      rep_amount_total: repRowsWithAmount.reduce((sum, row) => sum + toNumber(row.rep_amount), 0),
      diff_total: repRowsWithDiff.reduce((sum, row) => sum + toNumber(row.diff_amount), 0),
      underpaid_cases: repRowsWithDiff.filter((row) => toNumber(row.diff_amount) < 0).length,
      underpaid_total: repRowsWithDiff
        .filter((row) => toNumber(row.diff_amount) < 0)
        .reduce((sum, row) => sum + Math.abs(toNumber(row.diff_amount)), 0),
      overpaid_cases: repRowsWithDiff.filter((row) => toNumber(row.diff_amount) > 0).length,
      overpaid_total: repRowsWithDiff
        .filter((row) => toNumber(row.diff_amount) > 0)
        .reduce((sum, row) => sum + toNumber(row.diff_amount), 0),
      lag_avg_days: sortedLagDays.length > 0
        ? Number((sortedLagDays.reduce((sum, days) => sum + days, 0) / sortedLagDays.length).toFixed(1))
        : null,
      lag_p50_days: percentile(sortedLagDays, 50),
      lag_p90_days: percentile(sortedLagDays, 90),
    };

    const [rejectStatusRows] = await repConnection.query(
      `SELECT
         COALESCE(rn.resolve_status, 'open') AS resolve_status,
         COUNT(*) AS total
       FROM rep_data rd
       LEFT JOIN claim_reject_note rn ON rn.tran_id = rd.tran_id AND rn.tran_id IS NOT NULL
       WHERE rd.department = 'IP'
         AND COALESCE(rd.errorcode, '') <> ''
         AND DATE(COALESCE(rd.dchdate, rd.admdate)) BETWEEN ? AND ?
       GROUP BY COALESCE(rn.resolve_status, 'open')`,
      [startDate, endDate]
    );

    const rejectStatusSummary = (Array.isArray(rejectStatusRows) ? rejectStatusRows : []).map((row) => {
      const item = row as Record<string, unknown>;
      return {
        resolve_status: String(item.resolve_status || 'open'),
        total: toNumber(item.total),
      };
    });

    const [rejectTopErrorsRows] = await repConnection.query(
      `SELECT
         rd.errorcode,
         COUNT(*) AS total,
         SUM(COALESCE(rd.income, 0)) AS income_total,
         SUM(COALESCE(rd.compensated, 0)) AS compensated_total,
         SUM(COALESCE(rd.diff, 0)) AS diff_total
       FROM rep_data rd
       WHERE rd.department = 'IP'
         AND COALESCE(rd.errorcode, '') <> ''
         AND DATE(COALESCE(rd.dchdate, rd.admdate)) BETWEEN ? AND ?
       GROUP BY rd.errorcode
       ORDER BY total DESC, income_total DESC
       LIMIT 10`,
      [startDate, endDate]
    );

    const rejectTopErrors = (Array.isArray(rejectTopErrorsRows) ? rejectTopErrorsRows : []).map((row) => {
      const item = row as Record<string, unknown>;
      return {
        errorcode: String(item.errorcode || ''),
        total: toNumber(item.total),
        income_total: toNumber(item.income_total),
        compensated_total: toNumber(item.compensated_total),
        diff_total: toNumber(item.diff_total),
      };
    });

    const [importHealthRows] = await repConnection.query(
      `SELECT
         data_type,
         COUNT(*) AS batch_count,
         SUM(COALESCE(row_count, 0)) AS row_count,
         MAX(created_at) AS last_import_at
       FROM repstm_import_batch
       WHERE data_type IN ('REP', 'STM', 'INV')
         AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY data_type`,
      [startDate, endDate]
    );

    const [stmInvAmountRows] = await repConnection.query(
      `SELECT
         r.data_type,
         SUM(COALESCE(r.amount, 0)) AS total_amount
       FROM repstm_import_row r
       JOIN repstm_import_batch b ON b.id = r.batch_id
       WHERE r.data_type IN ('STM', 'INV')
         AND DATE(b.created_at) BETWEEN ? AND ?
       GROUP BY r.data_type`,
      [startDate, endDate]
    );

    const [statementMatchRows] = await repConnection.query(
      `SELECT
         data_type,
         COUNT(*) AS total_rows,
         SUM(CASE WHEN matched_status = 'matched' THEN 1 ELSE 0 END) AS matched_rows,
         SUM(CASE WHEN matched_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_rows,
         SUM(COALESCE(amount, 0)) AS total_amount
       FROM repstm_statement_data
       WHERE data_type IN ('STM', 'INV')
         AND DATE(COALESCE(service_datetime, senddate, created_at)) BETWEEN ? AND ?
       GROUP BY data_type`,
      [startDate, endDate]
    );

    const [statementErrorRows] = await repConnection.query(
      `SELECT
         data_type,
         errorcode,
         COUNT(*) AS total,
         SUM(COALESCE(amount, 0)) AS amount_total
       FROM repstm_statement_data
       WHERE data_type IN ('STM', 'INV')
         AND COALESCE(errorcode, '') <> ''
         AND DATE(COALESCE(service_datetime, senddate, created_at)) BETWEEN ? AND ?
       GROUP BY data_type, errorcode
       ORDER BY total DESC, amount_total DESC
       LIMIT 20`,
      [startDate, endDate]
    );

    const stmInvAmountMap = new Map<string, number>();
    (Array.isArray(stmInvAmountRows) ? stmInvAmountRows : []).forEach((row) => {
      const item = row as Record<string, unknown>;
      stmInvAmountMap.set(String(item.data_type || '').toUpperCase(), toNumber(item.total_amount));
    });

    const repstmImportHealth = (Array.isArray(importHealthRows) ? importHealthRows : []).map((row) => {
      const item = row as Record<string, unknown>;
      const dataType = String(item.data_type || '').toUpperCase();
      return {
        data_type: dataType,
        batch_count: toNumber(item.batch_count),
        row_count: toNumber(item.row_count),
        last_import_at: item.last_import_at || null,
        total_amount: dataType === 'STM' || dataType === 'INV'
          ? toNumber(stmInvAmountMap.get(dataType) || 0)
          : null,
      };
    });

    const statementMatchSummary = (Array.isArray(statementMatchRows) ? statementMatchRows : []).map((row) => {
      const item = row as Record<string, unknown>;
      const totalRows = toNumber(item.total_rows);
      const matchedRows = toNumber(item.matched_rows);
      const unmatchedRows = toNumber(item.unmatched_rows);
      return {
        data_type: String(item.data_type || '').toUpperCase(),
        total_rows: totalRows,
        matched_rows: matchedRows,
        unmatched_rows: unmatchedRows,
        matched_rate: totalRows > 0 ? Number(((matchedRows / totalRows) * 100).toFixed(1)) : 0,
        total_amount: toNumber(item.total_amount),
      };
    });

    const statementTopErrors = (Array.isArray(statementErrorRows) ? statementErrorRows : []).map((row) => {
      const item = row as Record<string, unknown>;
      return {
        data_type: String(item.data_type || '').toUpperCase(),
        errorcode: String(item.errorcode || ''),
        total: toNumber(item.total),
        amount_total: toNumber(item.amount_total),
      };
    });

    const repAnalytics = {
      financial: repFinancial,
      reject_status_summary: rejectStatusSummary,
      reject_top_errors: rejectTopErrors,
      import_health: repstmImportHealth,
      statement_match_summary: statementMatchSummary,
      statement_top_errors: statementTopErrors,
    };

    const valeImportStatus = await resolveValeImportStatus(valeTargetFilename);

    return {
      startDate,
      endDate,
      accountCode,
      summary,
      months: Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month)),
      opdStatusRows,
      ipdLagRows: lagRows,
      accountRows: Array.from(accountRows.values()).sort((a, b) => String(a.debtor_code).localeCompare(String(b.debtor_code))),
      missingRuleRows,
      valeRuleSuggestions: Array.from(valeSuggestionMap.values())
        .sort((a, b) => b.total - a.total || b.claimable_amount - a.claimable_amount)
        .slice(0, 20),
      valeImportStatus,
      frequentEntryIssues,
      frequentSystemErrors,
      repAnalytics,
    };
  } catch (error) {
    console.error('Error building insurance overview:', error);
    throw error;
  } finally {
    hosConnection.release();
    repConnection.release();
  }
};

export const getValeImportStatus = async (options: {
  valeTargetFilename?: string;
}): Promise<Record<string, unknown> | null> => {
  const repConnection = await getRepstmConnection();
  const targetFilename = String(options.valeTargetFilename || '16แฟ้มFDH.xlsx').trim();

  try {
    await ensureRepstmTables();

    const likePattern = `%${targetFilename}%`;
    const [valeBatchRows] = await repConnection.query(
      `SELECT
         COUNT(*) AS batch_matches,
         MAX(created_at) AS last_import_at
       FROM repstm_import_batch
       WHERE source_filename LIKE ?`,
      [likePattern]
    );
    const [valeRepRows] = await repConnection.query(
      `SELECT COUNT(*) AS rep_data_matches
       FROM rep_data
       WHERE filename LIKE ?`,
      [likePattern]
    );
    const [latestBatchRows] = await repConnection.query(
      `SELECT id, data_type, source_filename, row_count, created_at
       FROM repstm_import_batch
       WHERE source_filename LIKE ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [likePattern]
    );

    const toNumber = (value: unknown) => {
      const amount = Number(value);
      return Number.isFinite(amount) ? amount : 0;
    };

    const batchRow = Array.isArray(valeBatchRows) && valeBatchRows.length > 0
      ? valeBatchRows[0] as Record<string, unknown>
      : {};
    const repRow = Array.isArray(valeRepRows) && valeRepRows.length > 0
      ? valeRepRows[0] as Record<string, unknown>
      : {};
    const latestBatchRow = Array.isArray(latestBatchRows) && latestBatchRows.length > 0
      ? latestBatchRows[0] as Record<string, unknown>
      : {};
    const batchMatches = toNumber(batchRow.batch_matches);
    const repDataMatches = toNumber(repRow.rep_data_matches);

    return {
      target_filename: targetFilename,
      status: batchMatches > 0 || repDataMatches > 0 ? 'found' : 'missing',
      batch_matches: batchMatches,
      rep_data_matches: repDataMatches,
      last_import_at: batchRow.last_import_at || null,
      latest_batch_id: batchMatches > 0 ? toNumber(latestBatchRow.id) : null,
      latest_batch_data_type: latestBatchRow.data_type || null,
      latest_batch_source_filename: latestBatchRow.source_filename || null,
      latest_batch_row_count: batchMatches > 0 ? toNumber(latestBatchRow.row_count) : null,
    };
  } catch (error) {
    console.error('Error loading Vale import status:', error);
    return null;
  } finally {
    repConnection.release();
  }
};

export const saveReceivableBatch = async (payload: ReceivableBatchPayload) => {
  let connection: Awaited<ReturnType<typeof getRepstmConnection>> | null = null;
  let transactionStarted = false;
  try {
    const startDate = String(payload.startDate || '').slice(0, 10);
    const endDate = String(payload.endDate || '').slice(0, 10);
    const patientType = String(payload.patientType || 'ALL').toUpperCase();
    const requestedItems = Array.isArray(payload.items) ? payload.items : [];
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    const isValidIsoDate = (value: string) => {
      if (!isoDatePattern.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };

    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      return { success: false, statusCode: 400, error: 'ช่วงวันที่ไม่ถูกต้อง' };
    }
    if (!['ALL', 'OPD', 'IPD'].includes(patientType)) {
      return { success: false, statusCode: 400, error: 'ประเภทผู้ป่วยไม่ถูกต้อง' };
    }
    if (requestedItems.length === 0) {
      return { success: false, statusCode: 400, error: 'กรุณาเลือกรายการก่อนบันทึก' };
    }
    if (requestedItems.length > 10_000) {
      return { success: false, statusCode: 400, error: 'จำนวนรายการต่อชุดต้องไม่เกิน 10,000 รายการ' };
    }

    // Recalculate from HOSxP immediately before saving. Client-provided money and
    // account codes are display data only and must never be trusted for accounting.
    const currentCandidates = await getReceivableCandidates({
      startDate,
      endDate,
      patientType,
      patientRight: payload.patientRight,
      hosxpRight: payload.hosxpRight,
      financeRight: payload.financeRight,
    });
    const candidateKey = (item: Record<string, unknown>) => {
      const type = String(item.patient_type || item.patientType || '').trim().toUpperCase();
      const visit = type === 'IPD'
        ? String(item.an || '').trim()
        : String(item.vn || '').trim();
      return `${type}:${visit}`;
    };
    const candidateMap = new Map(currentCandidates.map((item) => [candidateKey(item), item]));
    const seen = new Set<string>();
    const items: Record<string, unknown>[] = [];

    for (const requestedItem of requestedItems) {
      const key = candidateKey(requestedItem);
      if (!key || key.endsWith(':')) {
        return { success: false, statusCode: 400, error: 'พบรายการที่ไม่มี VN/AN' };
      }
      if (seen.has(key)) {
        return { success: false, statusCode: 400, error: `พบรายการซ้ำ ${key}` };
      }
      seen.add(key);
      const current = candidateMap.get(key);
      if (!current) {
        return { success: false, statusCode: 409, error: `ข้อมูล ${key} เปลี่ยนแปลงหรือไม่อยู่ในเงื่อนไขแล้ว กรุณาดึงข้อมูลใหม่` };
      }
      const missingAccounts = [current.finance_right_code, current.debtor_code, current.revenue_code]
        .some((value) => !String(value || '').trim());
      if (toReceivableNumber(current.claimable_amount) <= 0 || missingAccounts) {
        return { success: false, statusCode: 422, error: `รายการ ${key} ยังไม่พร้อมตั้งลูกหนี้ กรุณาตรวจสอบสิทธิ์และรหัสบัญชี` };
      }
      items.push(current);
    }

    connection = await getRepstmConnection();
    await ensureRepstmTables();
    await connection.beginTransaction();
    transactionStarted = true;
    const batchNo = `AR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const totalReceivable = items.reduce((sum, item) => sum + toReceivableNumber(item.claimable_amount), 0);
    const openingBalance = toReceivableNumber(payload.openingBalance);
    const collectedAmount = toReceivableNumber(payload.collectedAmount);
    const calculatedClosing = openingBalance + totalReceivable - collectedAmount;
    const closingBalance = payload.closingBalance !== undefined && payload.closingBalance !== null && payload.closingBalance !== ''
      ? toReceivableNumber(payload.closingBalance)
      : calculatedClosing;

    const [insertResult] = await connection.query(
      `INSERT INTO receivable_batch
        (batch_no, patient_type, start_date, end_date, created_by, notes, item_count, total_receivable, opening_balance, collected_amount, closing_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchNo,
        patientType,
        startDate,
        endDate,
        payload.createdBy || null,
        String(payload.notes || '').trim().slice(0, 2000) || null,
        items.length,
        totalReceivable,
        openingBalance,
        collectedAmount,
        closingBalance,
      ]
    );
    const batchId = Number((insertResult as any).insertId || 0);

    for (const item of items) {
      await connection.query(
        `INSERT INTO receivable_item
          (batch_id, patient_type, vn, an, hn, cid, patient_name, pttype, pttype_name, hipdata_code, service_date,
           claimable_amount, rep_amount, diff_amount, claim_summary, raw_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          batchId,
          String(item.patient_type || item.patientType || ''),
          item.vn || null,
          item.an || null,
          item.hn || null,
          item.cid || null,
          item.patient_name || item.patientName || null,
          item.pttype || null,
          item.pttype_name || item.pttypename || null,
          item.hipdata_code || null,
          item.service_date || item.serviceDate || null,
          toReceivableNumber(item.claimable_amount),
          item.rep_amount == null ? null : toReceivableNumber(item.rep_amount),
          item.diff_amount == null ? null : toReceivableNumber(item.diff_amount),
          item.claim_summary || null,
          JSON.stringify(item),
        ]
      );
    }

    await connection.commit();
    transactionStarted = false;
    return { success: true, batchId, batchNo, itemCount: items.length, totalReceivable };
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error('Error saving receivable batch:', error);
    return { success: false, statusCode: 500, error: 'ไม่สามารถบันทึกชุดบัญชีลูกหนี้ได้ กรุณาลองใหม่' };
  } finally {
    connection?.release();
  }
};

/**
 * Older import screens could classify NHSO eclaim_* visit-response workbooks as
 * INV when they contained an (often empty) Invoice column. Re-import the stored
 * raw rows through the REP mapper, then remove the obsolete INV batch. The
 * operation is idempotent and only targets the authoritative eclaim_* filename.
 */
export const repairMisclassifiedEclaimRepImports = async () => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  let candidates: Record<string, unknown>[] = [];
  try {
    const [rows] = await connection.query(
      `SELECT id, source_filename, file_size, file_hash, sheet_name, imported_by, notes, row_count
       FROM repstm_import_batch
       WHERE data_type = 'INV'
         AND LOWER(SUBSTRING_INDEX(source_filename, ' [', 1)) REGEXP '^eclaim[_-]'
       ORDER BY id ASC`
    );
    candidates = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } finally {
    connection.release();
  }

  const summary = { found: candidates.length, repaired: 0, failed: 0 };
  for (const candidate of candidates) {
    const batchId = Number(candidate.id || 0);
    const readConnection = await getRepstmConnection();
    let rawRows: Record<string, unknown>[] = [];
    try {
      const [storedRows] = await readConnection.query(
        `SELECT raw_data FROM repstm_import_row WHERE batch_id = ? ORDER BY row_no ASC`,
        [batchId]
      );
      rawRows = (Array.isArray(storedRows) ? storedRows : []).map((stored) => {
        const raw = (stored as Record<string, unknown>).raw_data;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
        try { return JSON.parse(String(raw || '{}')) as Record<string, unknown>; } catch { return {}; }
      }).filter((row) => Object.keys(row).length > 0);
    } finally {
      readConnection.release();
    }

    if (rawRows.length === 0) {
      summary.failed += 1;
      continue;
    }

    const result = await importRepstmRows({
      dataType: 'REP',
      sourceFilename: String(candidate.source_filename || ''),
      fileSize: candidate.file_size == null ? undefined : Number(candidate.file_size),
      fileHash: String(candidate.file_hash || ''),
      sheetName: String(candidate.sheet_name || ''),
      importedBy: String(candidate.imported_by || 'system-repair'),
      notes: [String(candidate.notes || '').trim(), `แก้ประเภทอัตโนมัติจาก INV เป็น REP (batch #${batchId})`].filter(Boolean).join(' · '),
      rows: rawRows,
    });

    if (!result.success) {
      summary.failed += 1;
      continue;
    }

    // A successful new REP import already removes matching legacy INV batches.
    // Duplicate/skip results need this explicit cleanup of the obsolete batch.
    const cleanupConnection = await getRepstmConnection();
    try {
      await cleanupConnection.query(
        `DELETE FROM repstm_import_batch WHERE id = ? AND data_type = 'INV'`,
        [batchId]
      );
      summary.repaired += 1;
    } finally {
      cleanupConnection.release();
    }
  }

  return summary;
};

export const getRepstmImportBatches = async (
  dataType?: 'REP' | 'STM' | 'INV',
  limit = 20
): Promise<Record<string, unknown>[]> => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      `SELECT id, data_type, source_filename, sheet_name, is_subfile, imported_by, row_count, notes,
              logical_hash, completeness_score, distinct_record_count, column_count,
              non_empty_cell_count, replaces_batch_id, created_at
       FROM repstm_import_batch
       WHERE (? IS NULL OR data_type = ?)
       ORDER BY created_at DESC
       LIMIT ?`,
      [dataType || null, dataType || null, limit]
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } catch (error) {
    console.error('Error reading REP/STM/INV batches:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const getRepstmImportBatchDetail = async (
  batchId: number,
  limit = 2000,
): Promise<{ batch: Record<string, unknown>; rows: Record<string, unknown>[] } | null> => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  try {
    const [batchRows] = await connection.query(
      `SELECT id, data_type, source_filename, file_size, file_hash, sheet_name, is_subfile,
              imported_by, row_count, notes, logical_hash, completeness_score,
              distinct_record_count, column_count, non_empty_cell_count, replaces_batch_id, created_at
       FROM repstm_import_batch
       WHERE id = ?
       LIMIT 1`,
      [batchId],
    );
    if (!Array.isArray(batchRows) || batchRows.length === 0) return null;

    const safeLimit = Math.max(1, Math.min(5000, Math.trunc(limit) || 2000));
    const [rowResults] = await connection.query(
      `SELECT id, batch_id, data_type, row_no, ref_key, row_identity, hn, vn, an, cid,
              amount, service_date, raw_data, created_at
       FROM repstm_import_row
       WHERE batch_id = ?
       ORDER BY row_no ASC, id ASC
       LIMIT ?`,
      [batchId, safeLimit],
    );
    const rows = Array.isArray(rowResults)
      ? (rowResults as Record<string, unknown>[]).map((row) => ({
          ...row,
          raw_data: parseImportRawData(row.raw_data) || {},
        }))
      : [];
    return { batch: batchRows[0] as Record<string, unknown>, rows };
  } catch (error) {
    console.error('Error reading REP/STM/INV batch detail:', error);
    return null;
  } finally {
    connection.release();
  }
};

export const searchRepstmManagedBatches = async (filters: {
  dataType: 'ALL' | 'REP' | 'STM' | 'INV';
  query: string;
  page: number;
  pageSize: number;
  includeReplaced: boolean;
}) => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.dataType !== 'ALL') {
      where.push('b.data_type = ?');
      params.push(filters.dataType);
    }
    if (!filters.includeReplaced) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM repstm_import_batch replacement WHERE replacement.replaces_batch_id = b.id
      )`);
    }
    if (filters.query) {
      const like = `%${filters.query}%`;
      where.push(`(
        CAST(b.id AS CHAR) LIKE ? OR COALESCE(b.source_filename, '') LIKE ?
        OR COALESCE(b.sheet_name, '') LIKE ? OR COALESCE(b.imported_by, '') LIKE ?
        OR COALESCE(b.notes, '') LIKE ?
      )`);
      params.push(like, like, like, like, like);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (filters.page - 1) * filters.pageSize;
    const [summaryRows] = await connection.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(b.row_count), 0) AS total_rows
       FROM repstm_import_batch b
       ${whereSql}`,
      params,
    );
    const [batchResults] = await connection.query(
      `SELECT b.id, b.data_type, b.source_filename, b.file_size, b.sheet_name, b.is_subfile,
              b.imported_by, b.row_count, b.notes, b.replaces_batch_id, b.created_at,
              EXISTS(SELECT 1 FROM repstm_import_batch replacement WHERE replacement.replaces_batch_id = b.id) AS is_replaced
       FROM repstm_import_batch b
       ${whereSql}
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.pageSize, offset],
    );
    const summary = Array.isArray(summaryRows) && summaryRows.length > 0
      ? summaryRows[0] as Record<string, unknown>
      : {};
    return {
      batches: Array.isArray(batchResults) ? batchResults as Record<string, unknown>[] : [],
      total: Number(summary.total || 0),
      totalRows: Number(summary.total_rows || 0),
      page: filters.page,
      pageSize: filters.pageSize,
    };
  } finally {
    connection.release();
  }
};

const restoreRepstmBatchNormalizedRows = async (
  connection: HospitalConnection,
  hosConnection: HospitalConnection,
  batchId: number,
) => {
  const [batchRows] = await connection.query(
    `SELECT id, data_type, source_filename, is_subfile FROM repstm_import_batch WHERE id = ? LIMIT 1`,
    [batchId],
  );
  if (!Array.isArray(batchRows) || batchRows.length === 0) return;
  const batch = batchRows[0] as Record<string, unknown>;
  if (Number(batch.is_subfile || 0) === 1) return;
  const dataType = String(batch.data_type || '').toUpperCase();
  const [rawRows] = await connection.query(
    `SELECT raw_data FROM repstm_import_row WHERE batch_id = ? ORDER BY row_no ASC, id ASC`,
    [batchId],
  );
  const rows = (Array.isArray(rawRows) ? rawRows as Record<string, unknown>[] : [])
    .map((row) => parseImportRawData(row.raw_data))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  if (rows.length === 0) return;
  if (dataType === 'REP') {
    await importRepDataRows(connection, hosConnection, batchId, {
      sourceFilename: String(batch.source_filename || ''),
      rows,
    });
  } else if (dataType === 'STM' || dataType === 'INV') {
    await importStatementDataRows(connection, hosConnection, batchId, {
      dataType,
      sourceFilename: String(batch.source_filename || ''),
      rows,
    });
  }
};

const deleteRepstmBatchWithinTransaction = async (
  connection: HospitalConnection,
  hosConnection: HospitalConnection,
  batchId: number,
) => {
  const [batchRows] = await connection.query(
    `SELECT id, data_type, source_filename, row_count, replaces_batch_id
     FROM repstm_import_batch WHERE id = ? LIMIT 1 FOR UPDATE`,
    [batchId],
  );
  if (!Array.isArray(batchRows) || batchRows.length === 0) return null;
  const batch = batchRows[0] as Record<string, unknown>;
  const previousBatchId = Number(batch.replaces_batch_id || 0);
  const [replacementRows] = await connection.query(
    `SELECT id FROM repstm_import_batch WHERE replaces_batch_id = ? FOR UPDATE`,
    [batchId],
  );
  const replacements = Array.isArray(replacementRows) ? replacementRows as Record<string, unknown>[] : [];
  if (replacements.length > 0) {
    await connection.query(
      `UPDATE repstm_import_batch SET replaces_batch_id = ? WHERE replaces_batch_id = ?`,
      [previousBatchId || null, batchId],
    );
  }
  await connection.query(`DELETE FROM repstm_import_batch WHERE id = ?`, [batchId]);
  if (replacements.length === 0 && previousBatchId > 0) {
    await restoreRepstmBatchNormalizedRows(connection, hosConnection, previousBatchId);
  }
  return batch;
};

export const deleteRepstmManagedBatch = async (input: {
  batchId: number;
  reason: string;
  deletedBy: string;
}) => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  const hosConnection = await getUTFConnection();
  try {
    await connection.beginTransaction();
    const batch = await deleteRepstmBatchWithinTransaction(connection, hosConnection, input.batchId);
    if (!batch) throw new Error('ไม่พบ batch ที่เลือก หรือ batch ถูกลบไปแล้ว');
    await connection.query(
      `INSERT INTO repstm_delete_audit
       (delete_scope, data_type, batch_id, source_filename, deleted_row_count, deleted_by, reason)
       VALUES ('BATCH', ?, ?, ?, ?, ?, ?)`,
      [
        String(batch.data_type || ''),
        input.batchId,
        String(batch.source_filename || ''),
        Number(batch.row_count || 0),
        input.deletedBy,
        input.reason,
      ],
    );
    await connection.commit();
    return {
      batchId: input.batchId,
      dataType: String(batch.data_type || ''),
      sourceFilename: String(batch.source_filename || ''),
      deletedRows: Number(batch.row_count || 0),
      restoredBatchId: Number(batch.replaces_batch_id || 0) || null,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    hosConnection.release();
    connection.release();
  }
};

export const preflightRepstmImportFiles = async (
  files: Array<{ filename: string; size?: number; hash?: string }>
): Promise<Record<string, unknown>[]> => {
  await ensureRepstmTables();
  const normalizedFiles = files
    .map((file) => ({
      filename: String(file.filename || '').trim(),
      size: Number.isFinite(file.size) ? Math.max(0, Math.trunc(Number(file.size))) : null,
      hash: /^[a-f0-9]{64}$/i.test(String(file.hash || '')) ? String(file.hash).toLowerCase() : null,
    }))
    .filter((file) => file.filename)
    .slice(0, 1000);
  if (normalizedFiles.length === 0) return [];

  const names = [...new Set(normalizedFiles.map((file) => file.filename))];
  const hashes = [...new Set(normalizedFiles.map((file) => file.hash).filter(Boolean))] as string[];
  const namePlaceholders = names.map(() => '?').join(',');
  const hashCondition = hashes.length > 0
    ? ` OR file_hash IN (${hashes.map(() => '?').join(',')})`
    : '';
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      `SELECT id, data_type, source_filename, file_size, file_hash, row_count, created_at
       FROM repstm_import_batch
       WHERE SUBSTRING_INDEX(source_filename, ' [', 1) IN (${namePlaceholders})${hashCondition}
       ORDER BY id DESC`,
      [...names, ...hashes]
    );
    const batches = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];

    return normalizedFiles.map((file) => {
      const sameName = batches.filter((batch) =>
        String(batch.source_filename || '').split(' [')[0].toLowerCase() === file.filename.toLowerCase()
      );
      const exact = file.hash
        ? sameName.find((batch) => String(batch.file_hash || '').toLowerCase() === file.hash)
        : null;
      const legacy = sameName.find((batch) => !batch.file_hash);
      const sameContent = file.hash
        ? batches.find((batch) => String(batch.file_hash || '').toLowerCase() === file.hash)
        : null;
      const matched = exact || legacy || sameName[0] || sameContent || null;
      const status = exact
        ? 'exact'
        : legacy
          ? 'name_match'
          : sameName.length > 0
            ? 'changed'
            : sameContent
              ? 'content_match'
              : 'new';
      return {
        filename: file.filename,
        status,
        batchId: matched ? Number(matched.id || 0) : null,
        dataType: matched ? String(matched.data_type || '') : null,
        importedFilename: matched ? String(matched.source_filename || '') : null,
        importedAt: matched?.created_at || null,
        rowCount: matched ? Number(matched.row_count || 0) : 0,
      };
    });
  } finally {
    connection.release();
  }
};

export const getRepstmImportedRows = async (
  dataType: 'REP' | 'STM' | 'INV',
  limit = 200,
  visit: { vn?: string; an?: string; hn?: string } = {}
): Promise<Record<string, unknown>[]> => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  try {
    const visitConditions: string[] = [];
    const visitParams: string[] = [];
    if (visit.vn) { visitConditions.push('r.vn = ?'); visitParams.push(visit.vn); }
    if (visit.an) { visitConditions.push('r.an = ?'); visitParams.push(visit.an); }
    const [rows] = await connection.query(
      `SELECT r.id, r.batch_id, r.data_type, r.row_no, r.ref_key, r.row_identity, r.hn, r.vn, r.an, r.cid, r.amount, r.service_date, r.raw_data, r.created_at,
              b.source_filename, b.sheet_name
       FROM repstm_import_row r
       JOIN repstm_import_batch b ON b.id = r.batch_id
       LEFT JOIN repstm_import_batch replacement ON replacement.replaces_batch_id = b.id
       WHERE r.data_type = ?
       AND replacement.id IS NULL
       ${visitConditions.length ? `AND (${visitConditions.join(' OR ')})` : ''}
       ORDER BY r.id DESC
       LIMIT ?`,
      [dataType, ...visitParams, limit]
    );
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    return (rows as Record<string, unknown>[]).filter((row) => {
      const storedIdentity = String(row.row_identity || '').trim();
      const raw = parseImportRawData(row.raw_data) || {};
      const identity = storedIdentity || hashText(buildLogicalRowIdentity(dataType, raw, Number(row.row_no || 0)));
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  } catch (error) {
    console.error('Error reading REP/STM/INV imported rows:', error);
    return [];
  } finally {
    connection.release();
  }
};

