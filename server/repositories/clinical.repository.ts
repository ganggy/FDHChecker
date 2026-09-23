import mysql from 'mysql2/promise';
import { pool, getUTFConnection, getRepstmConnection } from '../db/connection.js';
import { ensureRepstmTables, ensureFdhClaimStatusSchema } from '../db/schema.js';
import { activeHospitalDatabaseConfig, rethrowHospitalDatabaseError, type HospitalConnection } from '../hospitalDatabase.js';
import { readHospitalIdentity } from '../siteProfile.js';
import { attachFundEligibility } from '../fundEligibility.js';
import { readVisitItems, readVisitClinical } from '../visitDetails.js';
import businessRules from '../config/business_rules.json';
import { evaluateFsRate, FS_PROJECT_ITEMS_2569 } from '../fsRateRules.js';
import { findKidneyTrackingIssues, isDialysisMonitorVisit, isKidneyUnitServiceVisit, summarizeKidneyTrackingVisits } from '../kidneyMonitorRules.js';
import { attachKidneyRepStmTracking } from '../kidneyRepStmTracking.js';
import { PALLIATIVE_DIAGNOSIS_GROUPS } from '../../src/config/palliativeDiagnosisCatalog.js';
import { FUND_DEFINITIONS } from '../../src/config/fundDefinitions.js';
import { reviewPalliativeCareVisit } from '../../src/utils/palliativeCareReview.js';
import { buildPostnatalTraditionalMedicineExclusionSql } from '../specificFundRules.js';
import { normalizeImportCellValue, formatTrackingDateTime, latestTrackingDateTime } from '../utils/dataNormalization.js';
import { resolveStatementVisitKeys } from '../repstmVisitKeys.js';
import { RECEIVABLE_RIGHT_MAPPINGS, type ReceivableRightMapping } from '../receivableMapping.js';
import { mergeFdhClaimDetails } from '../fdhClaimDetailMerge.js';
import { attachLatestFdhClaimDetails } from './claims.repository.js';
import {
  ANC_DENTAL_CLEAN_ICD9,
  ANC_DENTAL_CLEAN_PROCEDURE_CODES,
  ANC_DENTAL_CLEAN_PROCEDURE_CODES_SQL,
  ANC_DENTAL_EXAM_ICD9,
  ANC_DENTAL_EXAM_PROCEDURE_CODES,
  ANC_DENTAL_EXAM_PROCEDURE_CODES_SQL,
  ANC_LAB_1_REGEX,
  ANC_LAB_2_REGEX,
  ANEMIA_CBC_REGEX,
  ANEMIA_DX_CODES,
  ANEMIA_HBHCT_REGEX,
  CHOL_DX_CODES,
  FPG_DX_CODES,
  GENDER_AFFIRMING_HORMONE_REGEX,
  HEP_B_SCREENING_REGEX,
  HEP_C_SCREENING_REGEX,
  IRON_DX_CODES,
  LATENT_TB_SCREENING_REGEX,
  MENTAL_HEALTH_COUNSELLING_REGEX,
  OSTEOPOROSIS_SCREENING_REGEX,
  PALLIATIVE_ELIGIBLE_DX_CODES,
  PALLIATIVE_ELIGIBLE_DX_CODES_SQL,
  PALLIATIVE_SERVICE_DX_CODES,
  PILL_DX_CODES,
  POSTNATAL_CARE_DX_CODES,
  POSTNATAL_SUPPLEMENT_DX_CODES,
  SYPHILIS_SCREENING_ADP_CODES_SQL,
  SYPHILIS_SCREENING_REGEX,
  TDAS_SCREENING_REGEX,
  TELEMED_ADP_CODE,
  TELEMED_EXPORT_CODE,
  UPT_DX_CODES,
  buildAncLab1CompleteSql,
  buildAncLab1IdentifySql,
  buildAncLab2CompleteSql,
  buildAncLab2IdentifySql,
  buildAnemiaAgeBandSql,
  buildAnemiaAgeEligibleSql,
  buildAnemiaCbcExistsSql,
  buildAnemiaFallbackSql,
  buildAnemiaHbHctExistsSql,
  buildAnemiaLabExistsSql,
  buildCholLabExistsSql,
  buildCholNamedLabExistsSql,
  buildDiagnosisMatchSql,
  buildDxInSql,
  buildFerrokidMedExistsSql,
  buildFpgLabExistsSql,
  buildPostIronMedExistsSql,
  buildPregLabExistsSql,
  buildServiceOrLabNameExistsSql,
  buildTelemedExistsSql,
  buildVisitDiagnosisExistsSql,
  toSqlCodeList
} from './clinicalRules.js';

export const getVisitChargeItems = async (vn: string, an?: string): Promise<Record<string, unknown>[]> => {
  const connection = await getUTFConnection();
  try { return await readVisitItems(connection, vn, an); }
  finally { connection.release(); }
};
export const getDrugPrices = async (vn: string, an?: string) =>
  (await getVisitChargeItems(vn, an)).filter(row => Number(row.is_drug) === 1);
export const getServiceADPCodes = async (vn: string, an?: string) =>
  (await getVisitChargeItems(vn, an)).filter(row => Number(row.is_drug) !== 1);
export const getReceiptItems = getVisitChargeItems;

export const getProcedures = async (vn: string) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT 
        iptoprt.icode,
        opitemrece.icode,
        iptoprt.iprice as price
      FROM iptoprt
      WHERE iptoprt.an IN (
        SELECT an FROM ipt WHERE vn = ?
      )`,
      [vn]
    );

    return rows || [];
  } catch (error) {
    console.error('Error fetching procedures:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ฟังก์ชันดึงข้อมูลผู้ป่วย
export const getPatientData = async (hn: string) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT 
        hn,
        CONCAT(COALESCE(pname, ''), COALESCE(fname, ''), ' ', COALESCE(lname, '')) as patientName,
        birthday as birthDate,
        sex as gender,
        citizenship as nationality,
        cid as cardId
      FROM patient
      WHERE hn = ?`,
      [hn]
    );

    return (rows as Record<string, unknown>[])?.length ? (rows as Record<string, unknown>[])[0] : null;
  } catch (error) {
    console.error('Error fetching patient data:', error);
    throw error;
  } finally {
    connection.release();
  }
};


const attachSpecificFundStatusFields = async (connection: HospitalConnection, rows: Record<string, unknown>[]) => {
  const uniqueVns = Array.from(
    new Set(
      rows
        .map((row) => normalizeImportCellValue(row.vn))
        .filter(Boolean)
    )
  );

  if (uniqueVns.length === 0) {
    return rows;
  }

  const vnQuery = uniqueVns.map(() => 'SELECT ? AS vn').join(' UNION ALL ');
  const [statusRows] = await connection.query(
    `
      SELECT
        t.vn,
        COALESCE(
          (SELECT ah.claim_code FROM authenhos ah WHERE ah.vn = t.vn AND IFNULL(ah.claim_code, '') <> '' LIMIT 1),
          (SELECT vp.auth_code FROM visit_pttype vp WHERE vp.vn = t.vn AND IFNULL(vp.auth_code, '') <> '' LIMIT 1),
          ''
        ) AS authencode,
        COALESCE(
          (SELECT ncp.nhso_authen_code
           FROM nhso_confirm_privilege ncp
           WHERE ncp.vn = t.vn
             AND ncp.nhso_status = 'Y'
             AND IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
           LIMIT 1),
          (SELECT ah.claim_code
           FROM authenhos ah
           WHERE ah.vn = t.vn
             AND IFNULL(ah.claim_code, '') REGEXP '^EP'
           LIMIT 1),
          (SELECT vp.auth_code
           FROM visit_pttype vp
           WHERE vp.vn = t.vn
             AND IFNULL(vp.auth_code, '') REGEXP '^EP'
           LIMIT 1),
          ''
        ) AS close_code
      FROM (${vnQuery}) t
    `,
    uniqueVns
  );

  const statusMap = new Map<string, { authencode: string; closeCode: string }>();
  if (Array.isArray(statusRows)) {
    for (const row of statusRows as Record<string, unknown>[]) {
      const vn = normalizeImportCellValue(row.vn);
      statusMap.set(vn, {
        authencode: normalizeImportCellValue(row.authencode),
        closeCode: normalizeImportCellValue(row.close_code),
      });
    }
  }

  // Fetch FDH settlement fields from HosXP fdh_claim_status table (may not exist on all installs)
  const vnList = uniqueVns.map(() => '?').join(',');
  type FdhClaimRow = { fdh_claim_status_message: string; fdh_stm_period: string; fdh_act_amt: number | null; fdh_settle_at: string };
  const fdhClaimMap = new Map<string, FdhClaimRow>();
  try {
    const [fdhRows] = await connection.query(
      `SELECT vn, fdh_claim_status_message, fdh_stm_period, fdh_act_amt, fdh_settle_at
       FROM fdh_claim_status
       WHERE vn IN (${vnList})`,
      uniqueVns
    );
    if (Array.isArray(fdhRows)) {
      for (const row of fdhRows as Record<string, unknown>[]) {
        const vn = normalizeImportCellValue(row.vn);
        if (vn) {
          fdhClaimMap.set(vn, {
            fdh_claim_status_message: normalizeImportCellValue(row.fdh_claim_status_message),
            fdh_stm_period: normalizeImportCellValue(row.fdh_stm_period),
            fdh_act_amt: row.fdh_act_amt != null ? Number(row.fdh_act_amt) : null,
            fdh_settle_at: normalizeImportCellValue(row.fdh_settle_at),
          });
        }
      }
    }
  } catch {
    // fdh_claim_status table or settlement columns may not exist on this HosXP installation – skip silently
    try {
      // Fallback: try without the extended settlement columns
      const [fdhRowsFallback] = await connection.query(
        `SELECT vn, fdh_claim_status_message FROM fdh_claim_status WHERE vn IN (${vnList})`,
        uniqueVns
      );
      if (Array.isArray(fdhRowsFallback)) {
        for (const row of fdhRowsFallback as Record<string, unknown>[]) {
          const vn = normalizeImportCellValue(row.vn);
          if (vn) {
            fdhClaimMap.set(vn, {
              fdh_claim_status_message: normalizeImportCellValue(row.fdh_claim_status_message),
              fdh_stm_period: '',
              fdh_act_amt: null,
              fdh_settle_at: '',
            });
          }
        }
      }
    } catch {
      // Table doesn't exist at all – fdhClaimMap stays empty
    }
  }

  type ImportedClaimStatus = {
    claim_code: string;
    claim_status: string;
    upload_uid: string;
    sent_at: string;
  };
  type ImportedRepStatus = {
    rep_no: string;
    rep_amount: number | null;
    imported_at: string;
    errorcode: string;
    verifycode: string;
    tran_ids: string[];
  };
  type ImportedStatementStatus = {
    has_stm: boolean;
    has_inv: boolean;
    statement_no: string;
    stm_amount: number | null;
    stm_paid_amount: number | null;
    inv_net_amount: number | null;
    imported_at: string;
    errorcode: string;
    verifycode: string;
  };

  const fdhImportMap = new Map<string, ImportedClaimStatus>();
  const repImportMap = new Map<string, ImportedRepStatus>();
  const statementImportMap = new Map<string, ImportedStatementStatus>();
  let repConnection: HospitalConnection | null = null;

  try {
    repConnection = await getRepstmConnection();
    await ensureRepstmTables();

    const visitClauses = [
      `vn IN (${vnList})`,
      `an IN (${vnList})`,
    ];
    const visitParams = [...uniqueVns, ...uniqueVns];

    const [fdhImportedRows] = await repConnection.query(
      `SELECT vn, an, claim_code, claim_status, upload_uid, sent_at
       FROM fdh_claim_detail_row
       WHERE ${visitClauses.join(' OR ')}
       ORDER BY COALESCE(updated_at, created_at) ASC`,
      visitParams
    );
    for (const importedRow of (Array.isArray(fdhImportedRows) ? fdhImportedRows : []) as Record<string, unknown>[]) {
      const status = {
        claim_code: normalizeImportCellValue(importedRow.claim_code),
        claim_status: normalizeImportCellValue(importedRow.claim_status),
        upload_uid: normalizeImportCellValue(importedRow.upload_uid),
        sent_at: formatTrackingDateTime(importedRow.sent_at) || '',
      };
      const importedVn = normalizeImportCellValue(importedRow.vn);
      const importedAn = normalizeImportCellValue(importedRow.an);
      if (importedVn) fdhImportMap.set(importedVn, status);
      if (importedAn) fdhImportMap.set(importedAn, status);
    }

    const [repImportedRows] = await repConnection.query(
      `SELECT
         COALESCE(vn, '') AS vn,
         COALESCE(an, '') AS an,
         r.batch_id,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(rep_no), '') ORDER BY rep_no SEPARATOR ', ') AS rep_no,
         MAX(COALESCE(compensated, nhso, agency)) AS rep_amount,
         b.created_at AS imported_at,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(errorcode), '') SEPARATOR ', ') AS errorcode,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(verifycode), '') SEPARATOR ', ') AS verifycode,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(tran_id), '') SEPARATOR ',') AS tran_ids
       FROM rep_data r
       LEFT JOIN repstm_import_batch b ON b.id = r.batch_id
       WHERE ${visitClauses.join(' OR ')}
       GROUP BY COALESCE(vn, ''), COALESCE(an, ''), r.batch_id, b.created_at
       ORDER BY b.created_at ASC, r.batch_id ASC`,
      visitParams
    );
    const tranToVisit = new Map<string, string>();
    for (const importedRow of (Array.isArray(repImportedRows) ? repImportedRows : []) as Record<string, unknown>[]) {
      const importedVn = normalizeImportCellValue(importedRow.vn);
      const importedAn = normalizeImportCellValue(importedRow.an);
      const tranIds = normalizeImportCellValue(importedRow.tran_ids).split(',').map((value) => value.trim()).filter(Boolean);
      const status = {
        rep_no: normalizeImportCellValue(importedRow.rep_no),
        rep_amount: importedRow.rep_amount == null ? null : Number(importedRow.rep_amount),
        imported_at: formatTrackingDateTime(importedRow.imported_at) || '',
        errorcode: normalizeImportCellValue(importedRow.errorcode),
        verifycode: normalizeImportCellValue(importedRow.verifycode),
        tran_ids: tranIds,
      };
      if (importedVn) repImportMap.set(importedVn, status);
      if (importedAn) repImportMap.set(importedAn, status);
      tranIds.forEach((tranId) => tranToVisit.set(tranId, importedVn || importedAn));
    }

    const tranIds = Array.from(tranToVisit.keys());
    const statementClauses = [
      `s.matched_visit_code IN (${vnList})`,
      `s.vn IN (${vnList})`,
      `s.an IN (${vnList})`,
    ];
    const statementParams: unknown[] = [...uniqueVns, ...uniqueVns, ...uniqueVns];
    if (tranIds.length > 0) {
      statementClauses.push(`s.tran_id IN (${tranIds.map(() => '?').join(',')})`);
      statementParams.push(...tranIds);
    }

    const [statementRows] = await repConnection.query(
      `SELECT
         COALESCE(NULLIF(TRIM(s.matched_visit_code), ''), NULLIF(TRIM(s.vn), ''), NULLIF(TRIM(s.an), ''), '') AS visit_code,
         MAX(NULLIF(TRIM(s.matched_visit_code), '')) AS matched_visit_code,
         MAX(NULLIF(TRIM(s.vn), '')) AS vn,
         MAX(NULLIF(TRIM(s.an), '')) AS an,
         COALESCE(s.tran_id, '') AS tran_id,
         MAX(CASE WHEN s.data_type = 'STM' THEN 1 ELSE 0 END) AS has_stm,
         MAX(CASE WHEN s.data_type = 'INV' THEN 1 ELSE 0 END) AS has_inv,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(s.statement_no), '') ORDER BY s.statement_no SEPARATOR ', ') AS statement_no,
         SUM(CASE WHEN s.data_type = 'STM' THEN COALESCE(s.amount, 0) ELSE 0 END) AS stm_amount,
         SUM(CASE WHEN s.data_type = 'STM' THEN COALESCE(s.paid_amount, 0) ELSE 0 END) AS stm_paid_amount,
         SUM(CASE WHEN s.data_type = 'INV' THEN COALESCE(s.paid_amount, s.amount, s.invoice_amount, 0) ELSE 0 END) AS inv_net_amount,
         MAX(b.created_at) AS imported_at,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(s.errorcode), '') SEPARATOR ', ') AS errorcode,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(s.verifycode), '') SEPARATOR ', ') AS verifycode
       FROM repstm_statement_data s
       LEFT JOIN repstm_import_batch b ON b.id = s.batch_id
       WHERE s.data_type IN ('STM', 'INV') AND (${statementClauses.join(' OR ')})
       GROUP BY visit_code, s.tran_id`,
      statementParams
    );
    for (const importedRow of (Array.isArray(statementRows) ? statementRows : []) as Record<string, unknown>[]) {
      const hasStm = Number(importedRow.has_stm || 0) > 0;
      const hasInv = Number(importedRow.has_inv || 0) > 0;
      const nextStmAmount = hasStm ? Number(importedRow.stm_amount || 0) : null;
      const nextPaidAmount = hasStm ? Number(importedRow.stm_paid_amount || 0) : null;
      const nextInvAmount = hasInv ? Number(importedRow.inv_net_amount || 0) : null;
      const visitKeys = resolveStatementVisitKeys(importedRow, tranToVisit);
      for (const visitCode of visitKeys) {
        const current = statementImportMap.get(visitCode);
        statementImportMap.set(visitCode, {
          has_stm: Boolean(current?.has_stm || hasStm),
          has_inv: Boolean(current?.has_inv || hasInv),
          statement_no: [current?.statement_no, normalizeImportCellValue(importedRow.statement_no)].filter(Boolean).join(', '),
          stm_amount: current?.stm_amount == null ? nextStmAmount : current.stm_amount + (nextStmAmount || 0),
          stm_paid_amount: current?.stm_paid_amount == null ? nextPaidAmount : current.stm_paid_amount + (nextPaidAmount || 0),
          inv_net_amount: current?.inv_net_amount == null ? nextInvAmount : current.inv_net_amount + (nextInvAmount || 0),
          imported_at: latestTrackingDateTime(current?.imported_at || null, formatTrackingDateTime(importedRow.imported_at)) || '',
          errorcode: [current?.errorcode, normalizeImportCellValue(importedRow.errorcode)].filter(Boolean).join(', '),
          verifycode: [current?.verifycode, normalizeImportCellValue(importedRow.verifycode)].filter(Boolean).join(', '),
        });
      }
    }
  } catch (error) {
    console.error('Error attaching imported FDH/REP/STM status to specific funds:', error);
  } finally {
    repConnection?.release();
  }

  return rows.map((row) => {
    const vn = normalizeImportCellValue(row.vn);
    const an = normalizeImportCellValue(row.an);
    const statusInfo = statusMap.get(vn);
    const fdhClaim = fdhClaimMap.get(vn);
    const fdhImport = fdhImportMap.get(vn) || (an ? fdhImportMap.get(an) : undefined);
    const repImport = repImportMap.get(vn) || (an ? repImportMap.get(an) : undefined);
    const statementImport = statementImportMap.get(vn) || (an ? statementImportMap.get(an) : undefined);
    const authencode = normalizeImportCellValue(row.authencode) || statusInfo?.authencode || '';
    const closeCode = normalizeImportCellValue(row.close_code) || statusInfo?.closeCode || '';
    return {
      ...row,
      authencode,
      has_authen: normalizeImportCellValue(row.has_authen) || (authencode ? 'Y' : 'N'),
      close_code: closeCode,
      has_close: normalizeImportCellValue(row.has_close) || (closeCode ? 'Y' : 'N'),
      fdh_status_label: normalizeImportCellValue(row.fdh_status_label)
        || (closeCode ? 'ปิดสิทธิแล้ว (EP)' : authencode ? 'มี Authen (PP)' : 'ยังไม่มีสถานะ FDH'),
      fdh_claim_status_message: fdhClaim?.fdh_claim_status_message || '',
      fdh_stm_period: fdhClaim?.fdh_stm_period || '',
      fdh_act_amt: fdhClaim?.fdh_act_amt ?? null,
      fdh_settle_at: fdhClaim?.fdh_settle_at || '',
      has_fdh_import: Boolean(fdhImport),
      fdh_import_claim_code: fdhImport?.claim_code || '',
      fdh_import_status: fdhImport?.claim_status || '',
      fdh_import_upload_uid: fdhImport?.upload_uid || '',
      fdh_import_sent_at: fdhImport?.sent_at || '',
      has_rep_import: Boolean(repImport),
      rep_no: repImport?.rep_no || '',
      rep_amount: repImport?.rep_amount ?? null,
      rep_imported_at: repImport?.imported_at || '',
      rep_errorcode: repImport?.errorcode || '',
      rep_verifycode: repImport?.verifycode || '',
      has_stm_import: Boolean(statementImport?.has_stm),
      has_inv_import: Boolean(statementImport?.has_inv),
      stm_statement_no: statementImport?.statement_no || '',
      stm_amount: statementImport?.stm_amount ?? null,
      stm_paid_amount: statementImport?.stm_paid_amount ?? null,
      inv_net_amount: statementImport?.inv_net_amount ?? null,
      stm_imported_at: statementImport?.imported_at || '',
      stm_errorcode: statementImport?.errorcode || '',
      stm_verifycode: statementImport?.verifycode || '',
    };
  });
};


const PALLIATIVE_DIAG_DELETE_AUDIT_SQL = `
  CREATE TABLE IF NOT EXISTS z_fdh_palliative_diag_delete_audit (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(20) NOT NULL,
    hn VARCHAR(20) NOT NULL,
    deleted_diagnoses JSON NOT NULL,
    review_reasons JSON NOT NULL,
    deleted_by_user_id BIGINT NULL,
    deleted_by_username VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pal_diag_delete_vn (vn),
    KEY idx_pal_diag_delete_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const PALLIATIVE_HOME_VISIT_OVSTIST = '14';
const PALLIATIVE_HOME_VISIT_AUDIT_SQL = `
  CREATE TABLE IF NOT EXISTS z_fdh_palliative_home_visit_audit (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(20) NOT NULL,
    hn VARCHAR(20) NOT NULL,
    old_ovstist VARCHAR(10) NULL,
    old_ovstist_name VARCHAR(255) NULL,
    new_ovstist VARCHAR(10) NOT NULL,
    new_ovstist_name VARCHAR(255) NOT NULL,
    review_reasons JSON NOT NULL,
    updated_by_user_id BIGINT NULL,
    updated_by_username VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pal_home_visit_vn (vn),
    KEY idx_pal_home_visit_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const markPalliativeVisitAsHomeVisit = async (
  vn: string,
  actor: { userId?: number | null; username?: string | null },
) => {
  const normalizedVn = String(vn || '').trim();
  if (!/^\d{1,13}$/.test(normalizedVn)) throw new Error('รูปแบบ VN ไม่ถูกต้อง');
  const connection = await getUTFConnection();
  try {
    // MySQL DDL can implicitly commit, so create the audit table before the transaction.
    await connection.query(PALLIATIVE_HOME_VISIT_AUDIT_SQL);
    await connection.beginTransaction();

    const [homeVisitTypes] = await connection.query<any[]>(`
      SELECT ovstist, name
      FROM ovstist
      WHERE ovstist=?
        AND UPPER(COALESCE(name, '')) REGEXP 'เยี่ยมบ้าน|HOME[[:space:]_-]*VISIT'
      FOR UPDATE
    `, [PALLIATIVE_HOME_VISIT_OVSTIST]);
    if (homeVisitTypes.length !== 1) {
      throw new Error('ไม่พบรหัสประเภท visit เยี่ยมบ้าน (ovstist=14) กรุณาตรวจตาราง ovstist');
    }

    const [visitRows] = await connection.query<any[]>(`
      SELECT o.vn, o.hn, o.ovstist, osi.name AS ovstist_name,
        CASE WHEN UPPER(COALESCE(osi.name, '')) REGEXP 'เยี่ยมบ้าน|HOME[[:space:]_-]*VISIT' THEN 1 ELSE 0 END AS is_home_visit,
        CASE WHEN EXISTS (
          SELECT 1 FROM opitemrece oo
          LEFT JOIN s_drugitems sd ON sd.icode=oo.icode
          WHERE oo.vn=o.vn AND sd.nhso_adp_code IN (${businessRules.adp_codes.palliative.map(c => `'${c}'`).join(',')})
        ) THEN 1 ELSE 0 END AS has_pal_adp,
        CASE WHEN EXISTS (
          SELECT 1 FROM ovstdiag d
          WHERE d.vn=o.vn AND d.diagtype='1'
            AND REPLACE(UPPER(d.icd10), '.', '') IN (${PALLIATIVE_ELIGIBLE_DX_CODES_SQL})
        ) THEN 1 ELSE 0 END AS has_eligible_palliative_diag,
        (SELECT COUNT(DISTINCT oo.icode) FROM opitemrece oo JOIN drugitems di ON di.icode=oo.icode
          WHERE oo.vn=o.vn AND COALESCE(oo.qty, 0) > 0) AS drug_count
      FROM ovst o
      LEFT JOIN ovstist osi ON osi.ovstist=o.ovstist
      WHERE o.vn=?
      FOR UPDATE
    `, [normalizedVn]);
    if (visitRows.length === 0) throw new Error('ไม่พบ VN ที่ต้องการแก้ไข');

    const [diagnosisRows] = await connection.query<any[]>(`
      SELECT icd10
      FROM ovstdiag
      WHERE vn=? AND REPLACE(UPPER(icd10), '.', '') IN (${PALLIATIVE_SERVICE_DX_CODES.map(() => '?').join(',')})
      FOR UPDATE
    `, [normalizedVn, ...PALLIATIVE_SERVICE_DX_CODES]);
    const z515Code = diagnosisRows.find((row) => String(row.icd10).replace(/\./g, '').toUpperCase() === 'Z515')?.icd10;
    const z718Code = diagnosisRows.find((row) => String(row.icd10).replace(/\./g, '').toUpperCase() === 'Z718')?.icd10;
    const visit = visitRows[0];
    const review = reviewPalliativeCareVisit({
      z515Code,
      z718Code,
      isHomeVisit: visit.is_home_visit,
      hasPalliativeAdp: visit.has_pal_adp,
      hasEligibleDiseaseDiagnosis: visit.has_eligible_palliative_diag,
      drugCount: visit.drug_count,
    });
    if (!review.canMarkAsHomeVisit) {
      throw new Error('ปรับเป็นเยี่ยมบ้านได้เฉพาะ visit ที่ยังไม่ใช่เยี่ยมบ้าน และมี Diagnosis หรือรายการบริการ Palliative');
    }

    const [updateResult] = await connection.query(`
      UPDATE ovst SET ovstist=? WHERE vn=? AND COALESCE(ovstist, '')=COALESCE(?, '')
    `, [PALLIATIVE_HOME_VISIT_OVSTIST, normalizedVn, visit.ovstist]);
    if (Number((updateResult as { affectedRows?: number }).affectedRows || 0) !== 1) {
      throw new Error('ข้อมูลประเภท visit มีการเปลี่ยนแปลงระหว่างตรวจสอบ กรุณาโหลดข้อมูลใหม่');
    }

    const homeVisitType = homeVisitTypes[0];
    await connection.query(`
      INSERT INTO z_fdh_palliative_home_visit_audit
        (vn, hn, old_ovstist, old_ovstist_name, new_ovstist, new_ovstist_name,
         review_reasons, updated_by_user_id, updated_by_username)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      normalizedVn,
      String(visit.hn || ''),
      visit.ovstist == null ? null : String(visit.ovstist),
      visit.ovstist_name == null ? null : String(visit.ovstist_name).slice(0, 255),
      String(homeVisitType.ovstist),
      String(homeVisitType.name).slice(0, 255),
      JSON.stringify(review.reasons),
      actor.userId || null,
      String(actor.username || 'unknown').slice(0, 64),
    ]);
    await connection.commit();
    return {
      vn: normalizedVn,
      oldOvstist: visit.ovstist,
      oldOvstistName: visit.ovstist_name,
      newOvstist: String(homeVisitType.ovstist),
      newOvstistName: String(homeVisitType.name),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const deleteNonQualifyingPalliativeDiagnoses = async (
  vn: string,
  actor: { userId?: number | null; username?: string | null },
) => {
  const normalizedVn = String(vn || '').trim();
  if (!/^\d{1,13}$/.test(normalizedVn)) throw new Error('รูปแบบ VN ไม่ถูกต้อง');
  const connection = await getUTFConnection();
  try {
    // MySQL DDL can implicitly commit, so create the audit table before the transaction.
    await connection.query(PALLIATIVE_DIAG_DELETE_AUDIT_SQL);
    await connection.beginTransaction();
    const [visitRows] = await connection.query<any[]>(`
      SELECT o.vn, o.hn, osi.name AS ovstist_name,
        CASE WHEN UPPER(COALESCE(osi.name, '')) REGEXP 'เยี่ยมบ้าน|HOME[[:space:]_-]*VISIT' THEN 1 ELSE 0 END AS is_home_visit,
        CASE WHEN EXISTS (
          SELECT 1 FROM opitemrece oo
          LEFT JOIN s_drugitems sd ON sd.icode=oo.icode
          WHERE oo.vn=o.vn AND sd.nhso_adp_code IN (${businessRules.adp_codes.palliative.map(c => `'${c}'`).join(',')})
        ) THEN 1 ELSE 0 END AS has_pal_adp,
        CASE WHEN EXISTS (
          SELECT 1 FROM ovstdiag d
          WHERE d.vn=o.vn AND d.diagtype='1'
            AND REPLACE(UPPER(d.icd10), '.', '') IN (${PALLIATIVE_ELIGIBLE_DX_CODES_SQL})
        ) THEN 1 ELSE 0 END AS has_eligible_palliative_diag,
        (SELECT COUNT(DISTINCT oo.icode) FROM opitemrece oo JOIN drugitems di ON di.icode=oo.icode
          WHERE oo.vn=o.vn AND COALESCE(oo.qty, 0) > 0) AS drug_count
      FROM ovst o
      LEFT JOIN ovstist osi ON osi.ovstist=o.ovstist
      WHERE o.vn=?
      FOR UPDATE
    `, [normalizedVn]);
    if (visitRows.length === 0) throw new Error('ไม่พบ VN ที่ต้องการแก้ไข');

    const [diagnosisRows] = await connection.query<any[]>(`
      SELECT ovst_diag_id, icd10, diagtype, doctor, update_datetime
      FROM ovstdiag
      WHERE vn=? AND REPLACE(UPPER(icd10), '.', '') IN (${PALLIATIVE_SERVICE_DX_CODES.map(() => '?').join(',')})
      ORDER BY diagtype, ovst_diag_id
      FOR UPDATE
    `, [normalizedVn, ...PALLIATIVE_SERVICE_DX_CODES]);
    if (diagnosisRows.length === 0) throw new Error('ไม่พบ Diagnosis Z51.5/Z71.8 ใน VN นี้แล้ว');

    const z515Code = diagnosisRows.find((row) => String(row.icd10).replace(/\./g, '').toUpperCase() === 'Z515')?.icd10;
    const z718Code = diagnosisRows.find((row) => String(row.icd10).replace(/\./g, '').toUpperCase() === 'Z718')?.icd10;
    const visit = visitRows[0];
    const review = reviewPalliativeCareVisit({
      z515Code,
      z718Code,
      isHomeVisit: visit.is_home_visit,
      hasPalliativeAdp: visit.has_pal_adp,
      hasEligibleDiseaseDiagnosis: visit.has_eligible_palliative_diag,
      drugCount: visit.drug_count,
    });
    if (!review.canRemoveDiagnosis) {
      throw new Error('ลบได้เฉพาะ visit ที่ไม่ใช่เยี่ยมบ้าน กรุณาตรวจและแก้ข้อมูลบริการแทนการลบ Diagnosis');
    }

    const [deleteResult] = await connection.query(`
      DELETE FROM ovstdiag
      WHERE vn=? AND REPLACE(UPPER(icd10), '.', '') IN (${PALLIATIVE_SERVICE_DX_CODES.map(() => '?').join(',')})
    `, [normalizedVn, ...PALLIATIVE_SERVICE_DX_CODES]);
    const deletedCount = Number((deleteResult as { affectedRows?: number }).affectedRows || 0);
    if (deletedCount !== diagnosisRows.length) throw new Error('จำนวน Diagnosis ที่ลบไม่ตรงกับข้อมูลที่ตรวจสอบ กรุณาลองใหม่');

    await connection.query(`
      INSERT INTO z_fdh_palliative_diag_delete_audit
        (vn, hn, deleted_diagnoses, review_reasons, deleted_by_user_id, deleted_by_username)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      normalizedVn,
      String(visit.hn || ''),
      JSON.stringify(diagnosisRows),
      JSON.stringify(review.reasons),
      actor.userId || null,
      String(actor.username || 'unknown').slice(0, 64),
    ]);
    await connection.commit();
    return {
      vn: normalizedVn,
      deletedCount,
      deletedCodes: diagnosisRows.map((row) => String(row.icd10)),
      reviewReasons: review.reasons,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const PALLIATIVE_ITEM_DELETE_AUDIT_SQL = `
  CREATE TABLE IF NOT EXISTS z_fdh_palliative_item_delete_audit (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(20) NOT NULL,
    hn VARCHAR(20) NOT NULL,
    deleted_diagnoses JSON NOT NULL,
    deleted_service_items JSON NOT NULL,
    review_reasons JSON NOT NULL,
    deleted_by_user_id BIGINT NULL,
    deleted_by_username VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pal_item_delete_vn (vn),
    KEY idx_pal_item_delete_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const buildSyphilisScreeningExistsSql = (alias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND (
          UPPER(COALESCE(sd.nhso_adp_code, '')) IN (${SYPHILIS_SCREENING_ADP_CODES_SQL})
          OR UPPER(COALESCE(ndi.name, sd.name, '')) REGEXP '${SYPHILIS_SCREENING_REGEX}'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${SYPHILIS_SCREENING_REGEX}'
    )
  )
`;

export const deleteNonQualifyingPalliativeItems = async (
  vn: string,
  actor: { userId?: number | null; username?: string | null },
) => {
  const normalizedVn = String(vn || '').trim();
  if (!/^\d{1,13}$/.test(normalizedVn)) throw new Error('รูปแบบ VN ไม่ถูกต้อง');
  const connection = await getUTFConnection();
  try {
    // MySQL DDL can implicitly commit, so create the audit table before the transaction.
    await connection.query(PALLIATIVE_ITEM_DELETE_AUDIT_SQL);
    await connection.beginTransaction();

    const [visitRows] = await connection.query<any[]>(`
      SELECT o.vn, o.hn, osi.name AS ovstist_name,
        CASE WHEN UPPER(COALESCE(osi.name, '')) REGEXP 'เยี่ยมบ้าน|HOME[[:space:]_-]*VISIT' THEN 1 ELSE 0 END AS is_home_visit,
        CASE WHEN EXISTS (
          SELECT 1 FROM opitemrece oo
          LEFT JOIN s_drugitems sd ON sd.icode=oo.icode
          WHERE oo.vn=o.vn AND UPPER(COALESCE(sd.nhso_adp_code, '')) IN (${businessRules.adp_codes.palliative.map(c => `'${String(c).toUpperCase()}'`).join(',')})
        ) THEN 1 ELSE 0 END AS has_pal_adp,
        CASE WHEN EXISTS (
          SELECT 1 FROM ovstdiag d
          WHERE d.vn=o.vn AND d.diagtype='1'
            AND REPLACE(UPPER(d.icd10), '.', '') IN (${PALLIATIVE_ELIGIBLE_DX_CODES_SQL})
        ) THEN 1 ELSE 0 END AS has_eligible_palliative_diag,
        (SELECT COUNT(DISTINCT oo.icode) FROM opitemrece oo JOIN drugitems di ON di.icode=oo.icode
          WHERE oo.vn=o.vn AND COALESCE(oo.qty, 0) > 0) AS drug_count
      FROM ovst o
      LEFT JOIN ovstist osi ON osi.ovstist=o.ovstist
      WHERE o.vn=?
      FOR UPDATE
    `, [normalizedVn]);
    if (visitRows.length === 0) throw new Error('ไม่พบ VN ที่ต้องการแก้ไข');

    const [diagnosisRows] = await connection.query<any[]>(`
      SELECT ovst_diag_id, icd10, diagtype, doctor, update_datetime
      FROM ovstdiag
      WHERE vn=? AND REPLACE(UPPER(icd10), '.', '') IN (${PALLIATIVE_SERVICE_DX_CODES.map(() => '?').join(',')})
      ORDER BY diagtype, ovst_diag_id
      FOR UPDATE
    `, [normalizedVn, ...PALLIATIVE_SERVICE_DX_CODES]);
    const [serviceRows] = await connection.query<any[]>(`
      SELECT oo.hos_guid, oo.icode, oo.qty, oo.unitprice, oo.sum_price, oo.income,
        sd.nhso_adp_code, sd.name AS item_name
      FROM opitemrece oo
      INNER JOIN s_drugitems sd ON sd.icode=oo.icode
      WHERE oo.vn=?
        AND UPPER(COALESCE(sd.nhso_adp_code, '')) IN (${businessRules.adp_codes.palliative.map(() => '?').join(',')})
      ORDER BY oo.item_no, oo.hos_guid
      FOR UPDATE
    `, [normalizedVn, ...businessRules.adp_codes.palliative.map((code) => String(code).toUpperCase())]);
    if (diagnosisRows.length === 0 && serviceRows.length === 0) {
      throw new Error('ไม่พบ Diagnosis หรือรายการบริการ Palliative ใน VN นี้แล้ว');
    }

    const z515Code = diagnosisRows.find((row) => String(row.icd10).replace(/\./g, '').toUpperCase() === 'Z515')?.icd10;
    const z718Code = diagnosisRows.find((row) => String(row.icd10).replace(/\./g, '').toUpperCase() === 'Z718')?.icd10;
    const visit = visitRows[0];
    const review = reviewPalliativeCareVisit({
      z515Code,
      z718Code,
      isHomeVisit: visit.is_home_visit,
      hasPalliativeAdp: visit.has_pal_adp,
      hasEligibleDiseaseDiagnosis: visit.has_eligible_palliative_diag,
      drugCount: visit.drug_count,
    });
    if (!review.shouldReview) {
      throw new Error('ลบได้เฉพาะ visit ที่ระบบตรวจว่าไม่เข้าเกณฑ์ Palliative');
    }

    const diagnosisIds = diagnosisRows.map((row) => Number(row.ovst_diag_id)).filter(Number.isFinite);
    const serviceGuids = serviceRows.map((row) => String(row.hos_guid || '')).filter(Boolean);

    let deletedDiagnosisCount = 0;
    if (diagnosisIds.length > 0) {
      const [diagDeleteResult] = await connection.query(`
        DELETE FROM ovstdiag
        WHERE vn=? AND ovst_diag_id IN (${diagnosisIds.map(() => '?').join(',')})
      `, [normalizedVn, ...diagnosisIds]);
      deletedDiagnosisCount = Number((diagDeleteResult as { affectedRows?: number }).affectedRows || 0);
      if (deletedDiagnosisCount !== diagnosisRows.length) {
        throw new Error('จำนวน Diagnosis ที่ลบไม่ตรงกับข้อมูลที่ตรวจสอบ กรุณาลองใหม่');
      }
    }

    let deletedServiceCount = 0;
    if (serviceGuids.length > 0) {
      const [serviceDeleteResult] = await connection.query(`
        DELETE FROM opitemrece
        WHERE vn=? AND hos_guid IN (${serviceGuids.map(() => '?').join(',')})
      `, [normalizedVn, ...serviceGuids]);
      deletedServiceCount = Number((serviceDeleteResult as { affectedRows?: number }).affectedRows || 0);
      if (deletedServiceCount !== serviceRows.length) {
        throw new Error('จำนวนรายการบริการ Palliative ที่ลบไม่ตรงกับข้อมูลที่ตรวจสอบ กรุณาลองใหม่');
      }
    }

    await connection.query(`
      INSERT INTO z_fdh_palliative_item_delete_audit
        (vn, hn, deleted_diagnoses, deleted_service_items, review_reasons,
         deleted_by_user_id, deleted_by_username)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      normalizedVn,
      String(visit.hn || ''),
      JSON.stringify(diagnosisRows),
      JSON.stringify(serviceRows),
      JSON.stringify(review.reasons),
      actor.userId || null,
      String(actor.username || 'unknown').slice(0, 64),
    ]);
    await connection.commit();
    return {
      vn: normalizedVn,
      deletedDiagnosisCount,
      deletedDiagnosisCodes: diagnosisRows.map((row) => String(row.icd10)),
      deletedServiceCount,
      deletedServiceCodes: [...new Set(serviceRows.map((row) => String(row.nhso_adp_code || '').trim()).filter(Boolean))],
      reviewReasons: review.reasons,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getSpecificFundData = async (
  fundType: string,
  startDate: string,
  endDate: string,
  options: { includeTracking?: boolean; throwOnError?: boolean } = {},
) => {
  const connection = await getUTFConnection();
  try {
    const finalizeRows = async (rows: Record<string, unknown>[]) => {
      const evaluated = await attachFundEligibility(connection, fundType, rows);
      return options.includeTracking === false ? evaluated : attachSpecificFundStatusFields(connection, evaluated);
    };
    if (fundType === 'palliative') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          v.pdx,
          osi.name as ovstist_name,
          osi.export_code as ovstist_export_code,
          dep.department as department_name,
          CASE WHEN UPPER(COALESCE(osi.name, '')) REGEXP 'เยี่ยมบ้าน|HOME[[:space:]_-]*VISIT' THEN 1 ELSE 0 END as is_home_visit,
          GROUP_CONCAT(DISTINCT IF(REPLACE(UPPER(dx.icd10), '.', '')='${businessRules.diagnosis_patterns.palliative[0]}', dx.icd10, NULL)) as z515_code,
          GROUP_CONCAT(DISTINCT IF(REPLACE(UPPER(dx.icd10), '.', '')='${businessRules.diagnosis_patterns.palliative[1]}', dx.icd10, NULL)) as z718_code,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.palliative[0]}' LIMIT 1) as has_30001,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.palliative[1]}' LIMIT 1) as has_cons01,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.palliative[2]}' LIMIT 1) as has_eva001,
          CASE WHEN EXISTS (
            SELECT 1 FROM opitemrece oo
            LEFT JOIN s_drugitems d ON d.icode=oo.icode
            WHERE oo.vn=o.vn AND d.nhso_adp_code IN (${businessRules.adp_codes.palliative.map(c => `'${c}'`).join(',')})
          ) THEN 1 ELSE 0 END as has_pal_adp,
          CASE WHEN EXISTS (
            SELECT 1 FROM ovstdiag eligible_dx
            WHERE eligible_dx.vn=o.vn AND eligible_dx.diagtype='1'
              AND REPLACE(UPPER(eligible_dx.icd10), '.', '') IN (${PALLIATIVE_ELIGIBLE_DX_CODES_SQL})
          ) THEN 1 ELSE 0 END as has_eligible_palliative_diag,
          (SELECT GROUP_CONCAT(DISTINCT REPLACE(UPPER(eligible_dx.icd10), '.', '') ORDER BY eligible_dx.diagtype, eligible_dx.icd10 SEPARATOR ', ')
            FROM ovstdiag eligible_dx
            WHERE eligible_dx.vn=o.vn AND eligible_dx.diagtype='1'
              AND REPLACE(UPPER(eligible_dx.icd10), '.', '') IN (${PALLIATIVE_ELIGIBLE_DX_CODES_SQL})
          ) as eligible_palliative_diag_codes,
          (SELECT COUNT(DISTINCT oo.icode)
            FROM opitemrece oo
            JOIN drugitems di ON di.icode=oo.icode
            WHERE oo.vn=o.vn AND COALESCE(oo.qty, 0) > 0
          ) as drug_count
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        LEFT JOIN ovstist osi ON osi.ovstist = o.ovstist
        LEFT JOIN kskdepartment dep ON dep.depcode = o.main_dep
        LEFT JOIN ovstdiag dx ON o.vn = dx.vn AND REPLACE(UPPER(dx.icd10), '.', '') IN (${businessRules.diagnosis_patterns.palliative.map(c => `'${c}'`).join(',')})
        WHERE o.vstdate BETWEEN ? AND ?
          AND (REPLACE(UPPER(dx.icd10), '.', '') IN (${businessRules.diagnosis_patterns.palliative.map(c => `'${c}'`).join(',')}) OR EXISTS (SELECT 1 FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code IN (${businessRules.adp_codes.palliative.map(c => `'${c}'`).join(',')})))
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'telemedicine') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          ov.export_code as ovstist_export_code, ov.name as ovstist_name,
          CASE WHEN ${buildTelemedExistsSql('o', 'ov')} THEN 1 ELSE 0 END as has_telmed
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN ovstist ov ON ov.ovstist = o.ovstist
        WHERE o.vstdate BETWEEN ? AND ?
          AND ${buildTelemedExistsSql('o', 'ov')}
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'drugp') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.drugp}' LIMIT 1) as has_drugp,
          (SELECT COUNT(DISTINCT oo.icode)
            FROM opitemrece oo
            JOIN drugitems di ON di.icode = oo.icode
            LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
            WHERE oo.vn = o.vn
              AND COALESCE(sd.nhso_adp_code, '') <> '${businessRules.adp_codes.drugp}'
              AND COALESCE(oo.qty, 0) > 0) as drug_count
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        WHERE o.vstdate BETWEEN ? AND ?
          AND EXISTS (SELECT 1 FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${businessRules.adp_codes.drugp}')
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'herb') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          v.pdx,
          (SELECT GROUP_CONCAT(DISTINCT REPLACE(UPPER(herb_dx.icd10), '.', '') ORDER BY herb_dx.diagtype, herb_dx.icd10 SEPARATOR ', ')
           FROM ovstdiag herb_dx
           WHERE herb_dx.vn = o.vn) as diag_codes,
          SUM(oo.qty * oo.unitprice) as herb_total_price,
          GROUP_CONCAT(DISTINCT di.name SEPARATOR ', ') as herb_items
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        JOIN opitemrece oo ON oo.vn = o.vn
        JOIN drugitems di ON di.icode = oo.icode
        WHERE o.vstdate BETWEEN ? AND ?
          AND di.ttmt_code IS NOT NULL
          AND di.sks_product_category_id IN (3,4)
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'knee') {
      const kneeDiagM17Sql = `
        EXISTS (
          SELECT 1 FROM ovstdiag kd
          WHERE kd.vn = o.vn AND REPLACE(UPPER(kd.icd10), '.', '') LIKE 'M17%'
        )
      `;
      const kneeDiagU5753Sql = `
        EXISTS (
          SELECT 1 FROM ovstdiag kd
          WHERE kd.vn = o.vn AND REPLACE(UPPER(kd.icd10), '.', '') = 'U5753'
        )
      `;
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          COALESCE(v.age_y, TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate)) as age_y,
          CASE WHEN COALESCE(v.age_y, TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate)) >= 40 THEN 'Y' ELSE 'N' END as knee_age_eligible,
          CASE WHEN (${kneeDiagM17Sql}) AND (${kneeDiagU5753Sql}) THEN 'Y' ELSE 'N' END as has_knee_diag,
          CASE WHEN (${kneeDiagM17Sql}) THEN 'Y' ELSE 'N' END as has_knee_diag_m17,
          CASE WHEN (${kneeDiagU5753Sql}) THEN 'Y' ELSE 'N' END as has_knee_diag_u5753,
          (SELECT GROUP_CONCAT(DISTINCT kd.icd10 ORDER BY kd.diagtype SEPARATOR ', ')
             FROM ovstdiag kd
            WHERE kd.vn = o.vn
              AND (REPLACE(UPPER(kd.icd10), '.', '') LIKE 'M17%'
                   OR REPLACE(UPPER(kd.icd10), '.', '') = 'U5753')) as diag_code,
          NULL as oper_code,
          NULL as oper_names,
          'N' as has_knee_massage_thigh,
          'N' as has_knee_massage_knee,
          'N' as has_knee_massage_lower_leg,
          'N' as has_knee_poultice,
          'N' as has_knee_oper,
          0 as knee_oper_count,
          0 as knee_poultice_14d_count,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM vn_stat v
        JOIN ovst o ON o.vn = v.vn
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        WHERE v.vstdate BETWEEN ? AND ?
          AND (
            (COALESCE(v.age_y, TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate)) >= 40
              AND (${kneeDiagM17Sql}) AND (${kneeDiagU5753Sql}))
            OR EXISTS (
              SELECT 1
              FROM health_med_service ks
              JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
              JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
              WHERE ks.vn = o.vn
                AND REPLACE(ki.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
            )
          )
        ORDER BY o.vstdate DESC, o.vn DESC
      `, [startDate, endDate]);
      const kneeRows = rows as Record<string, unknown>[];
      const kneeVns = Array.from(new Set(kneeRows.map((row) => normalizeImportCellValue(row.vn)).filter(Boolean)));
      if (kneeVns.length > 0) {
        const vnPlaceholders = kneeVns.map(() => '?').join(',');
        const [operationRows] = await connection.query(`
          SELECT
            s.vn,
            REPLACE(i.icd10tm, '-', '') as raw_code,
            i.icd10tm,
            i.health_med_operation_item_name,
            op.health_med_organ_id
          FROM health_med_service s
          JOIN health_med_service_operation op ON op.health_med_service_id = s.health_med_service_id
          JOIN health_med_operation_item i ON i.health_med_operation_item_id = op.health_med_operation_item_id
          WHERE s.vn IN (${vnPlaceholders})
            AND (
              REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
              OR (REPLACE(i.icd10tm, '-', '') = '9007811' AND op.health_med_organ_id IN (39,40,41))
            )
        `, kneeVns);
        const operationMap = new Map<string, Record<string, unknown>>();
        if (Array.isArray(operationRows)) {
          for (const operationRow of operationRows as Record<string, unknown>[]) {
            const vn = normalizeImportCellValue(operationRow.vn);
            if (!vn) continue;
            const aggregate = operationMap.get(vn) || {
              operCodes: new Set<string>(),
              operNames: new Set<string>(),
              counts: { '8727811': 0, '8737811': 0, '8747811': 0, '8737835': 0 } as Record<string, number>,
              legacyCount: 0,
            };
            const rawCode = normalizeImportCellValue(operationRow.raw_code);
            const organId = Number(operationRow.health_med_organ_id || 0);
            const mappedCode = rawCode === '9007811'
              ? ({ 39: '8727811', 40: '8737811', 41: '8747811' } as Record<number, string>)[organId]
              : rawCode;
            if (mappedCode && mappedCode in (aggregate.counts as Record<string, number>)) {
              (aggregate.counts as Record<string, number>)[mappedCode] += 1;
              (aggregate.operCodes as Set<string>).add(normalizeImportCellValue(operationRow.icd10tm));
              (aggregate.operNames as Set<string>).add(normalizeImportCellValue(operationRow.health_med_operation_item_name));
              if (rawCode === '9007811') aggregate.legacyCount = Number(aggregate.legacyCount || 0) + 1;
            }
            operationMap.set(vn, aggregate);
          }
        }
        for (const row of kneeRows) {
          const vn = normalizeImportCellValue(row.vn);
          const operationRow = operationMap.get(vn);
          if (operationRow) {
            const counts = operationRow.counts as Record<string, number>;
            const duplicateCodes = Object.entries(counts).filter(([, count]) => count > 1).map(([code]) => code);
            Object.assign(row, {
              oper_code: Array.from(operationRow.operCodes as Set<string>).filter(Boolean).join(', '),
              oper_names: Array.from(operationRow.operNames as Set<string>).filter(Boolean).join(', '),
              has_knee_massage_thigh: counts['8727811'] > 0 ? 'Y' : 'N',
              has_knee_massage_knee: counts['8737811'] > 0 ? 'Y' : 'N',
              has_knee_massage_lower_leg: counts['8747811'] > 0 ? 'Y' : 'N',
              has_knee_poultice: counts['8737835'] > 0 ? 'Y' : 'N',
              has_knee_oper: Object.values(counts).every((count) => count > 0) ? 'Y' : 'N',
              knee_oper_count: Object.values(counts).filter((count) => count > 0).length,
              knee_has_data_error: duplicateCodes.length > 0 || Number(operationRow.legacyCount || 0) > 0 ? 'Y' : 'N',
              knee_duplicate_codes: duplicateCodes,
              knee_legacy_count: Number(operationRow.legacyCount || 0),
            });
          }
        }

        const kneeHns = Array.from(new Set(kneeRows.map((row) => normalizeImportCellValue(row.hn)).filter(Boolean)));
        if (kneeHns.length > 0) {
          const hnPlaceholders = kneeHns.map(() => '?').join(',');
          const [historyRows] = await connection.query(`
            SELECT DISTINCT s.hn, s.vn, DATE_FORMAT(s.service_date, '%Y-%m-%d') as service_date
            FROM health_med_service s
            JOIN health_med_service_operation op ON op.health_med_service_id = s.health_med_service_id
            JOIN health_med_operation_item i ON i.health_med_operation_item_id = op.health_med_operation_item_id
            WHERE s.hn IN (${hnPlaceholders})
              AND s.service_date BETWEEN DATE_SUB(?, INTERVAL 13 DAY) AND DATE_ADD(?, INTERVAL 13 DAY)
              AND REPLACE(i.icd10tm, '-', '') = '8737835'
            ORDER BY s.hn, s.service_date
          `, [...kneeHns, startDate, endDate]);
          const historyByHn = new Map<string, string[]>();
          for (const historyRow of historyRows as Record<string, unknown>[]) {
            const hn = normalizeImportCellValue(historyRow.hn);
            const date = normalizeImportCellValue(historyRow.service_date);
            if (!hn || !date) continue;
            const dates = historyByHn.get(hn) || [];
            dates.push(date);
            historyByHn.set(hn, dates);
          }
          for (const row of kneeRows) {
            const serviceDate = normalizeImportCellValue(row.serviceDate);
            const dates = (historyByHn.get(normalizeImportCellValue(row.hn)) || []).sort();
            let maxCount = 0;
            for (let left = 0; left < dates.length; left += 1) {
              const leftTime = new Date(`${dates[left]}T00:00:00Z`).getTime();
              let count = 0;
              let includesVisitWindow = false;
              for (let right = left; right < dates.length; right += 1) {
                const rightTime = new Date(`${dates[right]}T00:00:00Z`).getTime();
                if ((rightTime - leftTime) / 86_400_000 > 13) break;
                count += 1;
                includesVisitWindow ||= serviceDate >= dates[left] && serviceDate <= dates[right];
              }
              if (includesVisitWindow) maxCount = Math.max(maxCount, count);
            }
            row.knee_poultice_14d_count = maxCount;
          }
        }
      }
      return await finalizeRows(kneeRows);
    }

    if (fundType === 'instrument') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          SUM(oo.sum_price) as instrument_price,
          GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') as instrument_items,
          MAX(CASE WHEN d.nhso_adp_code REGEXP '^700[4-5]' THEN 'Y' ELSE 'N' END) as has_oa,
          MAX(CASE WHEN d.nhso_adp_code REGEXP '^8612|^8813|^8814' THEN 'Y' ELSE 'N' END) as has_dm
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        JOIN opitemrece oo ON oo.vn = o.vn
        JOIN nondrugitems d ON d.icode = oo.icode
        WHERE o.vstdate BETWEEN ? AND ?
          AND d.nhso_adp_type_id = 2
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }





    if (fundType === 'cacervix') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          (
            SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code SEPARATOR ', ') 
            FROM opitemrece oo 
            JOIN s_drugitems d ON d.icode = oo.icode 
            WHERE oo.vn = o.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.cx_regex}'
          ) as ca_adp_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT dx.icd10 SEPARATOR ', ') 
            FROM ovstdiag dx 
            WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.cx}'
          ) as ca_diags
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.cx}')
            OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.cx_regex}')
          )          GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    // Family Planning — Z30.x + ADP codes starting with FP (FP002_1, FP002_2, FP003_1, FP003_2, FP003_4 ...)
    if (fundType === 'fp') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          (
            SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.icd10 SEPARATOR ', ')
            FROM ovstdiag dx
            WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.fp}'
          ) as fp_diags,
          (
            SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
            FROM opitemrece oo
            JOIN s_drugitems d ON d.icode = oo.icode
            WHERE oo.vn = o.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.fp_regex}'
          ) as fp_adp_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT REPLACE(dro.icd9, '.', '') ORDER BY dro.icd9 SEPARATOR ', ')
            FROM doctor_operation dro
            WHERE dro.vn = o.vn AND REPLACE(dro.icd9, '.', '') IN ('9923', '8605')
          ) as fp_icd9_codes,
          (SELECT COALESCE(SUM(COALESCE(oo.qty, 0)), 0) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=o.hn AND YEAR(fy.vstdate)=YEAR(o.vstdate) AND d.nhso_adp_code='FP003_3') as fp_emergency_year_qty,
          (SELECT COUNT(DISTINCT oo.vn) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=o.hn AND YEAR(fy.vstdate)=YEAR(o.vstdate) AND d.nhso_adp_code='FP003_4') as fp_injection_year_count
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.fp}')
            OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.fp_regex}')
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }    // Antenatal Care (combined) — Z34/Z35 + ANC ADP codes
    if (fundType === 'anc') {
      const ancVisitCode = '30011';
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          (
            SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.icd10 SEPARATOR ', ')
            FROM ovstdiag dx
            WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}'
          ) as anc_diags,
          (
            SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
            FROM opitemrece oo
            JOIN s_drugitems d ON d.icode = oo.icode
            WHERE oo.vn = o.vn AND d.nhso_adp_code = '${ancVisitCode}'
          ) as anc_adp_codes
          ,
          CASE WHEN EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_diag,
          CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${ancVisitCode}' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_visit,
          CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30010' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_us,
          CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30012' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_lab1,
          CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30013' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_lab2,
          CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30008' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_dental_exam,
          CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30009' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_dental_clean
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}')
            OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${ancVisitCode}')
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    // Postpartum — Z39.x + ADP 30015
    if (fundType === 'postpartum') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          (
            SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.icd10 SEPARATOR ', ')
            FROM ovstdiag dx
            WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.adp_codes.pp_regex}'
          ) as pp_diags,
          (
            SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
            FROM opitemrece oo
            JOIN s_drugitems d ON d.icode = oo.icode
            WHERE oo.vn = o.vn AND d.nhso_adp_code = '${businessRules.adp_codes.pp_adp}'
          ) as pp_adp_codes
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.adp_codes.pp_regex}')
            OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${businessRules.adp_codes.pp_adp}')
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'clopidogrel') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ppt.name as pttypename, ppt.hipdata_code,
          (
            SELECT 'Y' FROM opitemrece oo 
            JOIN drugitems d ON d.icode = oo.icode 
            WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101') 
            LIMIT 1
          ) as has_clopidogrel_drug,
          (
            SELECT SUM(oo.qty * oo.unitprice)
            FROM opitemrece oo 
            JOIN drugitems d ON d.icode = oo.icode 
            WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101')
          ) as clopidogrel_price,
          (
            SELECT GROUP_CONCAT(DISTINCT CONCAT(d.name, ' (qty: ', oo.qty, ')') SEPARATOR ', ')
            FROM opitemrece oo 
            JOIN drugitems d ON d.icode = oo.icode 
            WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101')
          ) as clopidogrel_details
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ppt ON ppt.pttype = o.pttype
        WHERE o.vstdate BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM opitemrece oo 
            JOIN drugitems d ON d.icode = oo.icode 
            WHERE oo.vn = o.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101')
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'hepc' || fundType === 'hepb') {
      const labRegex = fundType === 'hepc' ? HEP_C_SCREENING_REGEX : HEP_B_SCREENING_REGEX;
      const labFlag = fundType === 'hepc' ? 'has_hepc_lab' : 'has_hepb_lab';
      const labNames = fundType === 'hepc' ? 'hepc_lab_names' : 'hepb_lab_names';
      const labResults = fundType === 'hepc' ? 'hepc_results' : 'hepb_results';
      const serviceNames = fundType === 'hepc' ? 'hepc_service_names' : 'hepb_service_names';
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          DATE_FORMAT(pt.birthday, '%Y-%m-%d') as birthday,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN pt.birthday < '1992-01-01' THEN 'Y' ELSE 'N' END as birth_before_2535,
          CASE WHEN ${buildDiagnosisMatchSql('o', 'v', ['Z115'])} THEN 'Y' ELSE 'N' END as has_z115_diag,
          CASE WHEN ${buildServiceOrLabNameExistsSql('o', labRegex)} THEN 'Y' ELSE 'N' END as ${labFlag},
          (
            SELECT GROUP_CONCAT(DISTINCT li.lab_items_name ORDER BY li.lab_items_name SEPARATOR ', ')
            FROM lab_head h
            JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
            JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
            WHERE h.vn = o.vn
              AND lo.lab_order_result IS NOT NULL
              AND lo.lab_order_result <> ''
              AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${labRegex}'
          ) as ${labNames},
          (
            SELECT GROUP_CONCAT(DISTINCT CONCAT(li.lab_items_name, ': ', lo.lab_order_result) ORDER BY li.lab_items_name SEPARATOR ', ')
            FROM lab_head h
            JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
            JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
            WHERE h.vn = o.vn
              AND lo.lab_order_result IS NOT NULL
              AND lo.lab_order_result <> ''
              AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${labRegex}'
          ) as ${labResults},
          (
            SELECT GROUP_CONCAT(DISTINCT COALESCE(ndi.name, sd.name, oo.icode) ORDER BY COALESCE(ndi.name, sd.name, oo.icode) SEPARATOR ', ')
            FROM opitemrece oo
            LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
            LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
            WHERE oo.vn = o.vn
              AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${labRegex}'
          ) as ${serviceNames},
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND ${buildServiceOrLabNameExistsSql('o', labRegex)}
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    const pp2569Funds: Record<string, {
      regex: string;
      diagRegex?: string;
      ageSql?: string;
      sexSql?: string;
      evidenceLabel: string;
      channelNote: string;
    }> = {
      mental_health_counselling: {
        regex: MENTAL_HEALTH_COUNSELLING_REGEX,
        ageSql: 'v.age_y >= 12',
        evidenceLabel: 'ST-5/9Q หรือบริการให้คำปรึกษาสุขภาพจิต',
        channelNote: 'e-Claim',
      },
      gender_affirming_hormone: {
        regex: GENDER_AFFIRMING_HORMONE_REGEX,
        diagRegex: '^F64|^Z76',
        evidenceLabel: 'บริการ/แล็บ/ยา hormone ตาม protocol',
        channelNote: 'KTB/VMI',
      },
      latent_tb_screening: {
        regex: LATENT_TB_SCREENING_REGEX,
        // Z11.1 = TB screening, Z20.1 = TB exposure, R76.1 = abnormal TB test.
        // Do not include Z11.5/Z20.5 (viral disease/hepatitis) or active TB A15-A19.
        diagRegex: '^Z111|^Z201|^R761',
        evidenceLabel: 'IGRA หรือบริการคัดกรองวัณโรคระยะแฝง',
        channelNote: 'NTIP/TB Data Hub',
      },
      osteoporosis_screening: {
        regex: OSTEOPOROSIS_SCREENING_REGEX,
        diagRegex: '^M80|^M81|^M82',
        ageSql: 'v.age_y >= 60',
        sexSql: "COALESCE(v.sex, pt.sex) = '2'",
        evidenceLabel: 'FRAX/DXA/BMD หรือบริการคัดกรองกระดูกพรุน',
        channelNote: 'KTB',
      },
      autism_tdas_screening: {
        regex: TDAS_SCREENING_REGEX,
        diagRegex: '^F84|^R62',
        ageSql: 'TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 12 AND 60',
        evidenceLabel: 'TDAS หรือบริการคัดกรองออทิสติก',
        channelNote: 'KTB',
      },
    };

    if (pp2569Funds[fundType]) {
      const rule = pp2569Funds[fundType];
      const ageSql = rule.ageSql || '1=1';
      const sexSql = rule.sexSql || '1=1';
      const diagCondition = rule.diagRegex
        ? `EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND REPLACE(UPPER(dx.icd10), '.', '') REGEXP '${rule.diagRegex}')`
        : '0';
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.age_y as age_y,
          TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) as age_month,
          DATE_FORMAT(pt.birthday, '%Y-%m-%d') as birthday,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN ${ageSql} THEN 'Y' ELSE 'N' END as age_eligible,
          CASE WHEN ${sexSql} THEN 'Y' ELSE 'N' END as sex_eligible,
          CASE WHEN ${diagCondition} THEN 'Y' ELSE 'N' END as has_specific_diag,
          (
            SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.icd10 SEPARATOR ', ')
            FROM ovstdiag dx
            WHERE dx.vn = o.vn
              AND REPLACE(UPPER(dx.icd10), '.', '') REGEXP '${rule.diagRegex || '^$'}'
          ) as specific_diags,
          CASE WHEN ${buildServiceOrLabNameExistsSql('o', rule.regex)} THEN 'Y' ELSE 'N' END as has_specific_evidence,
          (
            SELECT GROUP_CONCAT(DISTINCT li.lab_items_name ORDER BY li.lab_items_name SEPARATOR ', ')
            FROM lab_head h
            JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
            JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
            WHERE h.vn = o.vn
              AND lo.lab_order_result IS NOT NULL
              AND lo.lab_order_result <> ''
              AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${rule.regex}'
          ) as specific_lab_names,
          (
            SELECT GROUP_CONCAT(DISTINCT CONCAT(li.lab_items_name, ': ', lo.lab_order_result) ORDER BY li.lab_items_name SEPARATOR ', ')
            FROM lab_head h
            JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
            JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
            WHERE h.vn = o.vn
              AND lo.lab_order_result IS NOT NULL
              AND lo.lab_order_result <> ''
              AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${rule.regex}'
          ) as specific_results,
          (
            SELECT GROUP_CONCAT(DISTINCT COALESCE(ndi.name, sd.name, oo.icode) ORDER BY COALESCE(ndi.name, sd.name, oo.icode) SEPARATOR ', ')
            FROM opitemrece oo
            LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
            LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
            WHERE oo.vn = o.vn
              AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${rule.regex}'
          ) as specific_service_names,
          '${rule.evidenceLabel}' as specific_evidence_label,
          '${rule.channelNote}' as specific_channel_note,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (${ageSql})
          AND (${sexSql})
          AND (${buildServiceOrLabNameExistsSql('o', rule.regex)} OR ${diagCondition})
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'fpg_screening') {
      const [rows] = await connection.query(`
              SELECT 
                o.vn, o.hn, 
                DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
                DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
                pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
                COALESCE(v.sex, pt.sex) as sex,
                ptt.name as pttypename, ptt.hipdata_code,
                v.age_y as age,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN v.age_y BETWEEN 35 AND 59 THEN 'Y' ELSE 'N' END as age_eligible,
          CASE WHEN ${buildDiagnosisMatchSql('o', 'v', FPG_DX_CODES)} THEN 'Y' ELSE 'N' END as has_fpg_diag,
          CASE WHEN ${buildFpgLabExistsSql('o')} THEN 'Y' ELSE 'N' END as has_fpg_lab,
          CASE WHEN EXISTS (
            SELECT 1 FROM opitemrece oo 
            JOIN s_drugitems d ON d.icode = oo.icode 
            WHERE oo.vn = o.vn AND d.nhso_adp_code = '12003'
          ) THEN 'Y' ELSE 'N' END as has_fpg_adp,
          (SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='12003') as adp_names,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            (
              v.age_y BETWEEN 35 AND 59
              AND ${buildDiagnosisMatchSql('o', 'v', FPG_DX_CODES)}
              AND ${buildFpgLabExistsSql('o')}
            )
            OR EXISTS (
              SELECT 1 FROM opitemrece oo 
              JOIN s_drugitems d ON d.icode = oo.icode 
              WHERE oo.vn = o.vn AND d.nhso_adp_code = '12003'
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'cholesterol_screening') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          v.age_y as age,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN v.age_y BETWEEN 45 AND 70 THEN 'Y' ELSE 'N' END as age_eligible,
          CASE WHEN ${buildDiagnosisMatchSql('o', 'v', CHOL_DX_CODES)} THEN 'Y' ELSE 'N' END as has_chol_diag,
          CASE WHEN ${buildCholLabExistsSql('o')} THEN 'Y' ELSE 'N' END as has_chol_lab,
          CASE WHEN EXISTS (
            SELECT 1 FROM opitemrece oo 
            JOIN s_drugitems d ON d.icode = oo.icode 
            WHERE oo.vn = o.vn AND d.nhso_adp_code = '12004'
          ) THEN 'Y' ELSE 'N' END as has_chol_adp,
          (SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='12004') as adp_names,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            (
              v.age_y BETWEEN 45 AND 70
              AND ${buildDiagnosisMatchSql('o', 'v', CHOL_DX_CODES)}
              AND ${buildCholLabExistsSql('o')}
            )
            OR EXISTS (
              SELECT 1 FROM opitemrece oo 
              JOIN s_drugitems d ON d.icode = oo.icode 
              WHERE oo.vn = o.vn AND d.nhso_adp_code = '12004'
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'anemia_screening') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          v.age_y as age,
          TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) as age_month,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN v.age_y BETWEEN 13 AND 24 OR TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12 OR v.age_y BETWEEN 3 AND 6 THEN 'Y' ELSE 'N' END as age_eligible,
          CASE
            WHEN v.age_y BETWEEN 13 AND 24 THEN '13-24 ปี'
            WHEN TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12 THEN '6-12 เดือน'
            WHEN v.age_y BETWEEN 3 AND 6 THEN '3-6 ปี'
            ELSE NULL
          END as anemia_age_band,
          CASE WHEN ${buildDiagnosisMatchSql('o', 'v', ANEMIA_DX_CODES)} THEN 'Y' ELSE 'N' END as has_anemia_diag,
          CASE WHEN ${buildAnemiaCbcExistsSql('o')} THEN 'Y' ELSE 'N' END as has_anemia_cbc,
          CASE WHEN ${buildAnemiaHbHctExistsSql('o')} THEN 'Y' ELSE 'N' END as has_anemia_hbhct,
          CASE WHEN ${buildAnemiaLabExistsSql('o')} THEN 'Y' ELSE 'N' END as has_anemia_lab,
          CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code='13001') THEN 'Y' ELSE 'N' END as has_anemia_adp,
          (SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='13001') as adp_names,
          (SELECT GROUP_CONCAT(DISTINCT CONCAT(COALESCE(ndi.name, sd.name, oo.icode)) SEPARATOR ', ')
             FROM opitemrece oo
             LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
             LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
            WHERE oo.vn = o.vn
              AND (
                UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP 'CBC|COMPLETE BLOOD COUNT|FULL BLOOD COUNT|CBC WITHOUT SMEAR|CBC NO SMEAR|CBC W/O SMEAR|CBC W/O DIFF|HB/HCT|HBHCT|HB HCT|HB-HCT|HB|HGB|HEMOGLOBIN|HCT|HEMATOCRIT'
              )
          ) as cbc_names,
          (SELECT GROUP_CONCAT(DISTINCT REPLACE(UPPER(dx.icd10), '.', '') SEPARATOR ', ')
             FROM ovstdiag dx
            WHERE dx.vn = o.vn
              AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z130', 'Z138')
          ) as z130_diags,
          CASE
            WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '13001' LIMIT 1)
              THEN 'ADP13001'
            WHEN v.age_y BETWEEN 13 AND 24 AND (
              ${buildAnemiaFallbackSql('o', 'cbc')}
              OR REPLACE(UPPER(COALESCE(v.pdx, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx0, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx1, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx2, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx3, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx4, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx5, '')), '.', '') IN ('Z130', 'Z138')
            )
              THEN CONCAT('CBC+Z130/Z138(', '13-24Y', ')')
            WHEN (TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12 OR v.age_y BETWEEN 3 AND 6) AND (
              ${buildAnemiaFallbackSql('o', 'hbhct')}
              OR REPLACE(UPPER(COALESCE(v.pdx, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx0, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx1, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx2, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx3, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx4, '')), '.', '') IN ('Z130', 'Z138')
              OR REPLACE(UPPER(COALESCE(v.dx5, '')), '.', '') IN ('Z130', 'Z138')
            )
              THEN CONCAT('HbHct+Z130/Z138(', CASE WHEN TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12 THEN '6-12M' ELSE '3-6Y' END, ')')
            ELSE NULL
          END as anemia_match_source,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
          WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (
              SELECT 1
              FROM opitemrece oo
              JOIN s_drugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND d.nhso_adp_code = '13001'
            )
            OR (
              (
                v.age_y BETWEEN 13 AND 24
                OR TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12
                OR v.age_y BETWEEN 3 AND 6
              )
              AND (
                ${buildDiagnosisMatchSql('o', 'v', ANEMIA_DX_CODES)}
                OR ${buildAnemiaLabExistsSql('o')}
              )
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'syphilis_screening_male') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN COALESCE(v.sex, pt.sex) = '1' THEN 'Y' ELSE 'N' END as sex_eligible,
          CASE WHEN ${buildSyphilisScreeningExistsSql('o')} THEN 'Y' ELSE 'N' END as has_syphilis_lab,
          (
            SELECT GROUP_CONCAT(DISTINCT li.lab_items_name ORDER BY li.lab_items_name SEPARATOR ', ')
            FROM lab_head h
            JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
            JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
            WHERE h.vn = o.vn
              AND lo.lab_order_result IS NOT NULL
              AND lo.lab_order_result <> ''
              AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${SYPHILIS_SCREENING_REGEX}'
          ) as syphilis_lab_names,
          (
            SELECT GROUP_CONCAT(DISTINCT CONCAT(li.lab_items_name, ': ', lo.lab_order_result) ORDER BY li.lab_items_name SEPARATOR ', ')
            FROM lab_head h
            JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
            JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
            WHERE h.vn = o.vn
              AND lo.lab_order_result IS NOT NULL
              AND lo.lab_order_result <> ''
              AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${SYPHILIS_SCREENING_REGEX}'
          ) as syphilis_results,
          (
            SELECT GROUP_CONCAT(DISTINCT COALESCE(ndi.name, sd.name, oo.icode) ORDER BY COALESCE(ndi.name, sd.name, oo.icode) SEPARATOR ', ')
            FROM opitemrece oo
            LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
            LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
            WHERE oo.vn = o.vn
              AND (
                UPPER(COALESCE(sd.nhso_adp_code, '')) IN (${SYPHILIS_SCREENING_ADP_CODES_SQL})
                OR UPPER(COALESCE(ndi.name, sd.name, '')) REGEXP '${SYPHILIS_SCREENING_REGEX}'
              )
          ) as syphilis_service_names,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND COALESCE(v.sex, pt.sex) = '1'
          AND ${buildSyphilisScreeningExistsSql('o')}
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'iron_supplement') {
      const ironDIDs = [
        '202030120137819920381422', '100488000004203120381169', '100489000004320121881267',
        '100488000004203121781674', '100488000004203120381442', '100488000004203120381013',
        '100488000004203121781144', '100488000004203120381053', '100488000004203120381144',
        '100488000004203120381271', '100488000004203120381341', '100488000004203120381626',
        '100488000004203121881626', '100488000004203121881442', '100488000004203121881553',
        '100489000004192121881506', '100489000004320120381122', '100489000004320120381506',
        '100489000004203120381555', '100489000004203120381084', '100489000004203120381144',
        '100489000004203120381619', '100489000004203120381477', '100489000004203120381544',
        '100489000004203120381546'
      ];
      const ironDidStr = ironDIDs.map(id => `'${id}'`).join(',');

      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          v.age_y as age,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN COALESCE(v.sex, pt.sex) = '2' AND v.age_y BETWEEN 13 AND 45 THEN 'Y' ELSE 'N' END as age_eligible,
          CASE WHEN ${buildDiagnosisMatchSql('o', 'v', IRON_DX_CODES)} THEN 'Y' ELSE 'N' END as has_iron_diag,
          CASE WHEN EXISTS (
             SELECT 1 FROM opitemrece oo 
             LEFT JOIN drugitems d ON d.icode = oo.icode 
             WHERE oo.vn = o.vn 
               AND (d.did IN (${ironDidStr}) OR d.name LIKE '%FERROUS%' OR d.name LIKE '%F-TAB%')
          ) THEN 'Y' ELSE 'N' END as has_iron_med,
          CASE WHEN EXISTS (
             SELECT 1 FROM opitemrece oo 
             LEFT JOIN s_drugitems dd ON dd.icode = oo.icode
             WHERE oo.vn = o.vn 
               AND dd.nhso_adp_code = '14001'
          ) THEN 'Y' ELSE 'N' END as has_iron_adp,
          (SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='14001') as adp_names,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            (
              COALESCE(v.sex, pt.sex) = '2' AND v.age_y BETWEEN 13 AND 45
              AND ${buildDiagnosisMatchSql('o', 'v', IRON_DX_CODES)}
              AND EXISTS (
                 SELECT 1 FROM opitemrece oo 
                 LEFT JOIN drugitems d ON d.icode = oo.icode 
                 WHERE oo.vn = o.vn 
                   AND (d.did IN (${ironDidStr}) OR d.name LIKE '%FERROUS%' OR d.name LIKE '%F-TAB%')
              )
            )
            OR EXISTS (
               SELECT 1 FROM opitemrece oo 
               LEFT JOIN s_drugitems dd ON dd.icode = oo.icode
               WHERE oo.vn = o.vn 
                 AND dd.nhso_adp_code = '14001'
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'ferrokid_child') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          v.age_y as age,
          TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) as age_month,
          v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
          CASE WHEN TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12 THEN 'Y' ELSE 'N' END as ferrokid_age_eligible,
          CASE WHEN ${buildDiagnosisMatchSql('o', 'v', IRON_DX_CODES)} THEN 'Y' ELSE 'N' END as has_ferrokid_diag,
          CASE WHEN ${buildFerrokidMedExistsSql('o')} THEN 'Y' ELSE 'N' END as has_ferrokid_med,
          CASE
            WHEN TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12
              AND ${buildDiagnosisMatchSql('o', 'v', IRON_DX_CODES)}
              AND ${buildFerrokidMedExistsSql('o')}
            THEN 'Y' ELSE 'N'
          END as has_ferrokid,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) BETWEEN 6 AND 12
          AND (
            ${buildFerrokidMedExistsSql('o')}
            OR ${buildDiagnosisMatchSql('o', 'v', IRON_DX_CODES)}
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    // ANC Funds Mapping
    const ancFunds: Record<string, string> = {
        'anc_ultrasound': '30010',
        'anc_visit': '30011',
        'anc_lab_1': '30012',
        'anc_lab_2': '30013',
        'anc_dental_exam': '30008',
        'anc_dental_clean': '30009'
    };

    if (ancFunds[fundType]) {
        const adpCode = ancFunds[fundType];
        const ancFundWhere =
          fundType === 'anc_lab_1'
            ? `(CASE WHEN ${buildAncLab1IdentifySql('o')} THEN 1 ELSE 0 END = 1
                OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30012' LIMIT 1))`
            : fundType === 'anc_lab_2'
              ? `(CASE WHEN ${buildAncLab2IdentifySql('o')} THEN 1 ELSE 0 END = 1
                  OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30013' LIMIT 1))`
              : `(EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}')
                  OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${adpCode}'))`;
        const [rows] = await connection.query(`
            SELECT 
              o.vn, o.hn, 
              DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
              DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
              pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
              ptt.name as pttypename, ptt.hipdata_code,
              COALESCE(v.sex, pt.sex) as sex,
              v.age_y as age,
              v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
              (
                SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.icd10 SEPARATOR ', ')
                FROM ovstdiag dx
                WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}'
              ) as anc_diags,
              (
                SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
                FROM opitemrece oo
                JOIN s_drugitems d ON d.icode = oo.icode
                WHERE oo.vn = o.vn AND d.nhso_adp_code IN (${(businessRules.adp_codes.anc as string[]).map(code => `'${code}'`).join(',')})
              ) as anc_adp_codes,
              CASE WHEN EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_diag,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code IN (${(businessRules.adp_codes.anc as string[]).map(code => `'${code}'`).join(',')}) LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_adp,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30011' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_visit,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30010' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_us,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${adpCode}' LIMIT 1) THEN 'Y' ELSE 'N' END as has_specific_adp,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30012' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_lab1,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30013' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_lab2,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30008' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_dental_exam,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30009' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_dental_clean,
              CASE WHEN EXISTS (
                SELECT 1
                FROM dtmain dm
                LEFT JOIN dttm tm ON tm.code = dm.tmcode
                WHERE dm.vn = o.vn
                  AND COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
                    IN (${ANC_DENTAL_EXAM_PROCEDURE_CODES_SQL})
                  AND REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), '')), '.', '') = '${ANC_DENTAL_EXAM_ICD9}'
                LIMIT 1
              ) THEN 'Y' ELSE 'N' END as has_anc_dental_exam_procedure,
              CASE WHEN EXISTS (
                SELECT 1
                FROM dtmain dm
                LEFT JOIN dttm tm ON tm.code = dm.tmcode
                WHERE dm.vn = o.vn
                  AND COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
                    IN (${ANC_DENTAL_CLEAN_PROCEDURE_CODES_SQL})
                  AND REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), '')), '.', '') = '${ANC_DENTAL_CLEAN_ICD9}'
                LIMIT 1
              ) THEN 'Y' ELSE 'N' END as has_anc_dental_clean_procedure,
              (
                SELECT GROUP_CONCAT(
                  DISTINCT COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
                  ORDER BY dm.tm_no SEPARATOR ', '
                )
                FROM dtmain dm
                LEFT JOIN dttm tm ON tm.code = dm.tmcode
                WHERE dm.vn = o.vn
              ) as dental_procedure_codes,
              (
                SELECT GROUP_CONCAT(DISTINCT CONCAT(
                  COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(dm.icd9), ''), dm.tmcode),
                  ':', REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), ''), ''), '.', '')
                ) ORDER BY dm.tm_no SEPARATOR ', ')
                FROM dtmain dm
                LEFT JOIN dttm tm ON tm.code = dm.tmcode
                WHERE dm.vn = o.vn
              ) as dental_procedure_pairs,
              (
                SELECT GROUP_CONCAT(
                  DISTINCT CONCAT(
                    COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''), dm.tmcode),
                    ' ',
                    COALESCE(NULLIF(TRIM(tm.thai_name), ''), NULLIF(TRIM(tm.name), ''), NULLIF(TRIM(dm.ttcode), ''), 'หัตถการทันตกรรม')
                  )
                  ORDER BY dm.tm_no SEPARATOR ' | '
                )
                FROM dtmain dm
                LEFT JOIN dttm tm ON tm.code = dm.tmcode
                WHERE dm.vn = o.vn
              ) as dental_procedure_names,
              CASE WHEN EXISTS (SELECT 1 FROM dental_care dc WHERE dc.vn = o.vn LIMIT 1) THEN 'Y' ELSE 'N' END as has_dental_care_record,
              CASE WHEN ${buildAncLab1CompleteSql('o')} THEN 'Y' ELSE 'N' END as anc_lab1_complete,
              CASE WHEN ${buildAncLab2CompleteSql('o')} THEN 'Y' ELSE 'N' END as anc_lab2_complete,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_1_REGEX.cbc)} THEN 'Y' ELSE 'N' END as anc_lab1_cbc,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_1_REGEX.dcip)} THEN 'Y' ELSE 'N' END as anc_lab1_dcip,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_1_REGEX.abo)} THEN 'Y' ELSE 'N' END as anc_lab1_abo,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_1_REGEX.rh)} THEN 'Y' ELSE 'N' END as anc_lab1_rh,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_1_REGEX.hbsag)} THEN 'Y' ELSE 'N' END as anc_lab1_hbsag,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_1_REGEX.syphilis)} THEN 'Y' ELSE 'N' END as anc_lab1_syphilis,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_1_REGEX.hiv)} THEN 'Y' ELSE 'N' END as anc_lab1_hiv,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_2_REGEX.hiv)} THEN 'Y' ELSE 'N' END as anc_lab2_hiv,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_2_REGEX.syphilis)} THEN 'Y' ELSE 'N' END as anc_lab2_syphilis,
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_LAB_2_REGEX.cbc)} THEN 'Y' ELSE 'N' END as anc_lab2_cbc,
              (SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${adpCode}') as adp_names,
              (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
            FROM ovst o
            JOIN patient pt ON o.hn = pt.hn
              LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
              LEFT JOIN vn_stat v ON v.vn = o.vn
              WHERE o.vstdate BETWEEN ? AND ?
                AND ${ancFundWhere}
              GROUP BY o.vn
              ORDER BY o.vstdate DESC
          `, [startDate, endDate]);
        return await finalizeRows(rows as Record<string, unknown>[]);
    }

    // Other PP Funds Mapping
    const otherPPFunds: Record<string, string | string[]> = {
        'preg_test': '30014',
        'pregnancy_test': '30014',
        'postnatal_care': '30015',
        'postnatal_supplements': '30016',
        'fluoride': '15001',
        'contraceptive_pill': ['FP003_1', 'FP003_2', 'FP003_3'],
        'condom': 'FP003_4'
    };

    if (otherPPFunds[fundType]) {
        const adpParam = otherPPFunds[fundType];
        const adpCondition = Array.isArray(adpParam) 
            ? `d.nhso_adp_code IN (${adpParam.map(c => `'${c}'`).join(',')})`
            : `d.nhso_adp_code = '${adpParam}'`;
        const postnatalTraditionalMedicineExclusion = fundType === 'postnatal_care'
            ? `AND ${buildPostnatalTraditionalMedicineExclusionSql('o')}`
            : '';

        const [rows] = await connection.query(`
            SELECT 
              o.vn, o.hn, 
              DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
              DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
              pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
              ptt.name as pttypename, ptt.hipdata_code,
              v.age_y as age,
              COALESCE(v.sex, pt.sex) as sex,
              v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5,
              CASE WHEN ${buildPregLabExistsSql('o')} THEN 'Y' ELSE 'N' END as has_preg_lab,
              CASE WHEN ${buildDiagnosisMatchSql('o', 'v', UPT_DX_CODES)} THEN 'Y' ELSE 'N' END as has_preg_diag,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30014' LIMIT 1) THEN 'Y' ELSE 'N' END as has_preg_item,
              (SELECT GROUP_CONCAT(DISTINCT REPLACE(UPPER(dx.icd10), '.', '') ORDER BY dx.icd10 SEPARATOR ', ')
               FROM ovstdiag dx
               WHERE dx.vn = o.vn
                 AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z320', 'Z321')) as preg_diags,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30015' LIMIT 1) THEN 'Y' ELSE 'N' END as has_post_care,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30016' LIMIT 1) THEN 'Y' ELSE 'N' END as has_post_supp,
              CASE WHEN ${buildDiagnosisMatchSql('o', 'v', POSTNATAL_CARE_DX_CODES)} THEN 'Y' ELSE 'N' END as has_pp_diag,
              (SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.icd10 SEPARATOR ', ')
               FROM ovstdiag dx
               WHERE dx.vn = o.vn
                 AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z390', 'Z391', 'Z392')) as pp_diags,
              CASE WHEN ${buildDiagnosisMatchSql('o', 'v', POSTNATAL_SUPPLEMENT_DX_CODES)} THEN 'Y' ELSE 'N' END as has_post_supp_diag,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code IN ('30015','30016') LIMIT 1) THEN 'Y' ELSE 'N' END as has_pp_adp,
              (SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
               FROM opitemrece oo
               JOIN s_drugitems d ON d.icode = oo.icode
               WHERE oo.vn = o.vn AND d.nhso_adp_code = '30015') as pp_adp_codes,
              CASE WHEN ${buildPostIronMedExistsSql('o')} THEN 'Y' ELSE 'N' END as has_post_iron_med,
              CASE WHEN EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.fp}' LIMIT 1) THEN 'Y' ELSE 'N' END as has_fp_diag,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.fp_regex}' LIMIT 1) THEN 'Y' ELSE 'N' END as has_fp_adp,
              (SELECT COALESCE(SUM(COALESCE(oo.qty, 0)), 0) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=o.hn AND YEAR(fy.vstdate)=YEAR(o.vstdate) AND d.nhso_adp_code='FP003_3') as fp_emergency_year_qty,
              (SELECT COUNT(DISTINCT oo.vn) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=o.hn AND YEAR(fy.vstdate)=YEAR(o.vstdate) AND d.nhso_adp_code='FP003_4') as fp_injection_year_count,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND ${adpCondition} LIMIT 1) THEN 'Y' ELSE 'N' END as has_specific_adp,
              (SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND ${adpCondition}) as adp_names,
              (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
            FROM ovst o
            JOIN patient pt ON o.hn = pt.hn
            LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
            LEFT JOIN vn_stat v ON v.vn = o.vn
            WHERE o.vstdate BETWEEN ? AND ?
              ${postnatalTraditionalMedicineExclusion}
              AND (
                (${fundType === 'preg_test' || fundType === 'pregnancy_test' ? `((${buildPregLabExistsSql('o')} AND ${buildDiagnosisMatchSql('o', 'v', UPT_DX_CODES)}) OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30014'))` : '0'})
                OR (${fundType === 'postnatal_care' ? `(${buildDiagnosisMatchSql('o', 'v', POSTNATAL_CARE_DX_CODES)} OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30015'))` : '0'})
                OR (${fundType === 'postnatal_supplements' ? `(${buildDiagnosisMatchSql('o', 'v', POSTNATAL_SUPPLEMENT_DX_CODES)} AND (EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30016') OR ${buildPostIronMedExistsSql('o')}))` : '0'})
                OR (${fundType === 'contraceptive_pill' || fundType === 'condom' ? `(EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.fp}') OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.fp_regex}'))` : '0'})
                OR (${fundType === 'postnatal_supplements'
                  ? '0'
                  : `EXISTS (
                      SELECT 1 FROM opitemrece oo 
                      JOIN s_drugitems d ON d.icode = oo.icode 
                      WHERE oo.vn = o.vn AND ${adpCondition}
                    )`})
              )
            GROUP BY o.vn
            ORDER BY o.vstdate DESC
        `, [startDate, endDate]);
        return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'ttm_massage') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx,
          (
            SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.diagtype SEPARATOR ', ')
            FROM ovstdiag dx WHERE dx.vn = o.vn
          ) as diag_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.icd10tm ORDER BY ki.icd10tm SEPARATOR ', ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn
              AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U59%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^87[1-4]7810')
          ) as oper_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.health_med_operation_item_name ORDER BY ki.health_med_operation_item_name SEPARATOR ' | ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn
              AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U59%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^87[1-4]7810')
          ) as oper_names,
          (
            SELECT d.name FROM health_med_service ks
            LEFT JOIN doctor d ON d.code = ks.doctor_code
            WHERE ks.vn = o.vn LIMIT 1
          ) as provider_name,
          (
            SELECT d.licenseno FROM health_med_service ks
            LEFT JOIN doctor d ON d.code = ks.doctor_code
            WHERE ks.vn = o.vn LIMIT 1
          ) as provider_license_no,
          (SELECT TIME_FORMAT(ks.service_time, '%H:%i') FROM health_med_service ks WHERE ks.vn = o.vn LIMIT 1) as service_start_time,
          (SELECT TIME_FORMAT(ks.service_finish_time, '%H:%i') FROM health_med_service ks WHERE ks.vn = o.vn LIMIT 1) as service_finish_time,
          (
            SELECT TIMESTAMPDIFF(MINUTE, ks.service_time, ks.service_finish_time)
            FROM health_med_service ks WHERE ks.vn = o.vn LIMIT 1
          ) as service_duration_min,
          'Y' as has_ttm_oper,
          'Y' as has_massage_oper,
          CASE WHEN EXISTS (
            SELECT 1 FROM ovstdiag dx
            WHERE dx.vn = o.vn
              AND (REPLACE(UPPER(dx.icd10), '.', '') REGEXP '^M[0-9]|^G81|^U5[3-9]|^U6[0-9]|^U7[0-7]')
          ) THEN 'Y' ELSE 'N' END as has_ttm_diag,
          CASE WHEN EXISTS (
            SELECT 1 FROM health_med_service ks
            JOIN doctor d ON d.code = ks.doctor_code
            WHERE ks.vn = o.vn AND d.licenseno IS NOT NULL AND TRIM(d.licenseno) <> ''
          ) THEN 'Y' ELSE 'N' END as has_provider_license,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn
              AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U59%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^87[1-4]7810')
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'ttm_compress') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx,
          (SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.diagtype SEPARATOR ', ') FROM ovstdiag dx WHERE dx.vn = o.vn) as diag_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.icd10tm ORDER BY ki.icd10tm SEPARATOR ', ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U60%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^87[1-4]7820')
          ) as oper_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.health_med_operation_item_name ORDER BY ki.health_med_operation_item_name SEPARATOR ' | ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U60%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^87[1-4]7820')
          ) as oper_names,
          (SELECT d.name FROM health_med_service ks LEFT JOIN doctor d ON d.code = ks.doctor_code WHERE ks.vn = o.vn LIMIT 1) as provider_name,
          (SELECT d.licenseno FROM health_med_service ks LEFT JOIN doctor d ON d.code = ks.doctor_code WHERE ks.vn = o.vn LIMIT 1) as provider_license_no,
          'Y' as has_ttm_oper,
          'Y' as has_compress_oper,
          CASE WHEN EXISTS (
            SELECT 1 FROM ovstdiag dx
            WHERE dx.vn = o.vn AND (REPLACE(UPPER(dx.icd10), '.', '') REGEXP '^M[0-9]|^G81|^U5[3-9]|^U6[0-9]|^U7[0-7]')
          ) THEN 'Y' ELSE 'N' END as has_ttm_diag,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U60%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^87[1-4]7820')
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'ttm_steam') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx,
          (SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.diagtype SEPARATOR ', ') FROM ovstdiag dx WHERE dx.vn = o.vn) as diag_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.icd10tm ORDER BY ki.icd10tm SEPARATOR ', ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U61%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^8707830')
          ) as oper_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.health_med_operation_item_name ORDER BY ki.health_med_operation_item_name SEPARATOR ' | ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U61%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^8707830')
          ) as oper_names,
          (SELECT d.name FROM health_med_service ks LEFT JOIN doctor d ON d.code = ks.doctor_code WHERE ks.vn = o.vn LIMIT 1) as provider_name,
          'Y' as has_ttm_oper,
          'Y' as has_steam_oper,
          CASE WHEN EXISTS (
            SELECT 1 FROM ovstdiag dx
            WHERE dx.vn = o.vn AND (REPLACE(UPPER(dx.icd10), '.', '') REGEXP '^J[0-9]|^M[0-9]|^U5[3-9]|^U6[0-9]|^U7[0-7]')
          ) THEN 'Y' ELSE 'N' END as has_ttm_diag,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND (REPLACE(ki.icd10tm, '-', '') LIKE 'U61%' OR REPLACE(ki.icd10tm, '-', '') REGEXP '^8707830')
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'ttm_postnatal') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx,
          (SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.diagtype SEPARATOR ', ') FROM ovstdiag dx WHERE dx.vn = o.vn) as diag_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.icd10tm ORDER BY ki.icd10tm SEPARATOR ', ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND REPLACE(ki.icd10tm, '-', '') LIKE 'U62%'
          ) as oper_codes,
          (
            SELECT GROUP_CONCAT(DISTINCT ki.health_med_operation_item_name ORDER BY ki.health_med_operation_item_name SEPARATOR ' | ')
            FROM health_med_service ks
            JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
            JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
            WHERE ks.vn = o.vn AND REPLACE(ki.icd10tm, '-', '') LIKE 'U62%'
          ) as oper_names,
          (SELECT d.name FROM health_med_service ks LEFT JOIN doctor d ON d.code = ks.doctor_code WHERE ks.vn = o.vn LIMIT 1) as provider_name,
          'Y' as has_postnatal_oper,
          CASE WHEN EXISTS (
            SELECT 1 FROM ovstdiag dx
            WHERE dx.vn = o.vn AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z391', 'Z392', 'Z390')
          ) THEN 'Y' ELSE 'N' END as has_postnatal_diag,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (
              SELECT 1 FROM health_med_service ks
              JOIN health_med_service_operation kop ON kop.health_med_service_id = ks.health_med_service_id
              JOIN health_med_operation_item ki ON ki.health_med_operation_item_id = kop.health_med_operation_item_id
              WHERE ks.vn = o.vn AND REPLACE(ki.icd10tm, '-', '') LIKE 'U62%'
            )
            OR EXISTS (
              SELECT 1 FROM ovstdiag dx
              WHERE dx.vn = o.vn AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z391', 'Z392')
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'fecal_fit_test') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          CASE WHEN v.age_y BETWEEN 50 AND 70 THEN 'Y' ELSE 'N' END as age_eligible,
          (SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.diagtype SEPARATOR ', ') FROM ovstdiag dx WHERE dx.vn = o.vn) as diag_codes,
          COALESCE(
            (
              SELECT GROUP_CONCAT(DISTINCT pst.pp_special_type_name SEPARATOR ' | ')
              FROM pp_special ps
              JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) IN ('1B0060', '1B0061', '1B0080', '1B0081') OR pst.pp_special_type_name REGEXP 'มะเร็งลำไส้|Fit')
            ),
            (
              SELECT GROUP_CONCAT(DISTINCT CONCAT(li.lab_items_name, ': ', lo.lab_order_result) SEPARATOR ' | ')
              FROM lab_head lh
              JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
              JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
              WHERE lh.vn = o.vn
                AND UPPER(li.lab_items_name) REGEXP 'FIT|OCCULT|FOBT'
            )
          ) as fit_test_result,
          COALESCE(
            (
              SELECT GROUP_CONCAT(DISTINCT pst.pp_special_type_name SEPARATOR ', ')
              FROM pp_special ps
              JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) IN ('1B0060', '1B0061', '1B0080', '1B0081') OR pst.pp_special_type_name REGEXP 'มะเร็งลำไส้|Fit')
            ),
            (
              SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ')
              FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code IN ('1B0080', '1B0081') OR UPPER(d.name) REGEXP 'FIT|OCCULT')
            )
          ) as fit_service_names,
          CASE WHEN (
            EXISTS (
              SELECT 1 FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) IN ('1B0060', '1B0061', '1B0080', '1B0081') OR pst.pp_special_type_name REGEXP 'มะเร็งลำไส้|Fit')
            )
            OR EXISTS (
              SELECT 1 FROM lab_head lh
              JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
              JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
              WHERE lh.vn = o.vn AND (UPPER(li.lab_items_name) REGEXP 'FIT|OCCULT|FOBT')
            )
            OR EXISTS (
              SELECT 1 FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code IN ('1B0080', '1B0081') OR UPPER(d.name) REGEXP 'FIT|OCCULT')
            )
          ) THEN 'Y' ELSE 'N' END as has_fit_test,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (
              SELECT 1 FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) IN ('1B0060', '1B0061', '1B0080', '1B0081') OR pst.pp_special_type_name REGEXP 'มะเร็งลำไส้|Fit')
            )
            OR EXISTS (
              SELECT 1 FROM lab_head lh
              JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
              JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
              WHERE lh.vn = o.vn AND (UPPER(li.lab_items_name) REGEXP 'FIT|OCCULT|FOBT')
            )
            OR EXISTS (
              SELECT 1 FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code IN ('1B0080', '1B0081') OR UPPER(d.name) REGEXP 'FIT|OCCULT')
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'ncd_screening') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          CASE WHEN v.age_y >= 35 THEN 'Y' ELSE 'N' END as age_eligible,
          os.bps, os.bpd,
          os.bw as weight, os.height, os.bmi,
          CASE WHEN os.bps > 0 AND os.bpd > 0 THEN 'Y' ELSE 'N' END as has_bp,
          CASE WHEN os.bmi > 0 OR (os.bw > 0 AND os.height > 0) THEN 'Y' ELSE 'N' END as has_bmi,
          (
            SELECT lo.lab_order_result
            FROM lab_head lh
            JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
            JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
            WHERE lh.vn = o.vn AND UPPER(li.lab_items_name) REGEXP 'GLUCOSE|FBS|FPG|DTX'
            LIMIT 1
          ) as fbs,
          CASE WHEN EXISTS (
            SELECT 1 FROM lab_head lh
            JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
            JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
            WHERE lh.vn = o.vn AND UPPER(li.lab_items_name) REGEXP 'GLUCOSE|FBS|FPG|DTX'
          ) THEN 'Y' ELSE 'N' END as has_fbs,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN opdscreen os ON os.vn = o.vn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND v.age_y >= 35
          AND (
            EXISTS (
              SELECT 1 FROM lab_head lh
              JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
              JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
              WHERE lh.vn = o.vn AND UPPER(li.lab_items_name) REGEXP 'GLUCOSE|FBS|FPG|DTX'
            )
            OR EXISTS (
              SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.icd10 = 'Z131'
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'dspm_screening') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          TIMESTAMPDIFF(MONTH, pt.birthday, o.vstdate) as age_months,
          CASE WHEN v.age_y <= 5 THEN 'Y' ELSE 'N' END as age_eligible,
          COALESCE(
            (
              SELECT GROUP_CONCAT(DISTINCT COALESCE(ps.pp_special_code, pst.pp_special_code) ORDER BY COALESCE(ps.pp_special_code, pst.pp_special_code) SEPARATOR ', ')
              FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B26%' OR COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B27%')
            ),
            (
              SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
              FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND d.nhso_adp_code IN ('1B260', '1B261', '1B262', '1B263')
            )
          ) as dspm_code,
          COALESCE(
            (
              SELECT GROUP_CONCAT(DISTINCT pst.pp_special_type_name ORDER BY pst.pp_special_type_name SEPARATOR ' | ')
              FROM pp_special ps
              JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B26%' OR COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B27%' OR pst.pp_special_type_name REGEXP 'DSPM|DAIM|พัฒนาการ')
            ),
            (
              SELECT GROUP_CONCAT(DISTINCT d.name ORDER BY d.name SEPARATOR ' | ')
              FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code IN ('1B260', '1B261', '1B262', '1B263') OR UPPER(d.name) REGEXP 'DSPM|DAIM|พัฒนาการ')
            )
          ) as dspm_desc,
          CASE WHEN EXISTS (
            SELECT 1 FROM pp_special ps
            LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
            WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B26%' OR COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B27%' OR pst.pp_special_type_name REGEXP 'DSPM|DAIM|พัฒนาการ')
          ) OR EXISTS (
            SELECT 1 FROM opitemrece oo
            JOIN nondrugitems d ON d.icode = oo.icode
            WHERE oo.vn = o.vn AND (d.nhso_adp_code IN ('1B260', '1B261', '1B262', '1B263') OR UPPER(d.name) REGEXP 'DSPM|DAIM|พัฒนาการ')
          ) THEN 'Y' ELSE 'N' END as has_dspm,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (
              SELECT 1 FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B26%' OR COALESCE(ps.pp_special_code, pst.pp_special_code) LIKE '1B27%' OR pst.pp_special_type_name REGEXP 'DSPM|DAIM|พัฒนาการ')
            )
            OR EXISTS (
              SELECT 1 FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code IN ('1B260', '1B261', '1B262', '1B263') OR UPPER(d.name) REGEXP 'DSPM|DAIM|พัฒนาการ')
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'retinopathy_screening') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx,
          (SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.diagtype SEPARATOR ', ') FROM ovstdiag dx WHERE dx.vn = o.vn) as diag_codes,
          CASE WHEN EXISTS (
            SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND REPLACE(UPPER(dx.icd10), '.', '') REGEXP '^E1[0-4]'
          ) OR (v.pdx REGEXP '^E1[0-4]') THEN 'Y' ELSE 'N' END as has_dm_diag,
          COALESCE(
            (
              SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ' | ')
              FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code = '1B0120' OR UPPER(d.name) REGEXP 'RETINOPATHY|FUNDUS|จอตา|จอประสาทตา')
            ),
            (
              SELECT GROUP_CONCAT(DISTINCT pst.pp_special_type_name SEPARATOR ' | ')
              FROM pp_special ps
              JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) = '1B0120' OR pst.pp_special_type_name REGEXP 'จอตา|Fundus')
            )
          ) as retinopathy_service_names,
          CASE WHEN (
            EXISTS (
              SELECT 1 FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code = '1B0120' OR UPPER(d.name) REGEXP 'RETINOPATHY|FUNDUS|จอตา|จอประสาทตา')
            )
            OR EXISTS (
              SELECT 1 FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) = '1B0120' OR pst.pp_special_type_name REGEXP 'จอตา|Fundus')
            )
          ) THEN 'Y' ELSE 'N' END as has_retinopathy_exam,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (
              SELECT 1 FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code = '1B0120' OR UPPER(d.name) REGEXP 'RETINOPATHY|FUNDUS|จอตา|จอประสาทตา')
            )
            OR EXISTS (
              SELECT 1 FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) = '1B0120' OR pst.pp_special_type_name REGEXP 'จอตา|Fundus')
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    if (fundType === 'foot_screening') {
      const [rows] = await connection.query(`
        SELECT
          o.vn, o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          COALESCE(v.sex, pt.sex) as sex,
          v.age_y as age,
          v.pdx,
          (SELECT GROUP_CONCAT(DISTINCT dx.icd10 ORDER BY dx.diagtype SEPARATOR ', ') FROM ovstdiag dx WHERE dx.vn = o.vn) as diag_codes,
          CASE WHEN EXISTS (
            SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND REPLACE(UPPER(dx.icd10), '.', '') REGEXP '^E1[0-4]'
          ) OR (v.pdx REGEXP '^E1[0-4]') THEN 'Y' ELSE 'N' END as has_dm_diag,
          COALESCE(
            (
              SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ' | ')
              FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code = '1B0110' OR UPPER(d.name) REGEXP 'FOOT|เท้าเบาหวาน|ตรวจเท้า')
            ),
            (
              SELECT GROUP_CONCAT(DISTINCT pst.pp_special_type_name SEPARATOR ' | ')
              FROM pp_special ps
              JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) = '1B0110' OR pst.pp_special_type_name REGEXP 'เท้า')
            )
          ) as foot_service_names,
          CASE WHEN (
            EXISTS (
              SELECT 1 FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code = '1B0110' OR UPPER(d.name) REGEXP 'FOOT|เท้าเบาหวาน|ตรวจเท้า')
            )
            OR EXISTS (
              SELECT 1 FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) = '1B0110' OR pst.pp_special_type_name REGEXP 'เท้า')
            )
          ) THEN 'Y' ELSE 'N' END as has_foot_exam,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND (
            EXISTS (
              SELECT 1 FROM opitemrece oo
              JOIN nondrugitems d ON d.icode = oo.icode
              WHERE oo.vn = o.vn AND (d.nhso_adp_code = '1B0110' OR UPPER(d.name) REGEXP 'FOOT|เท้าเบาหวาน|ตรวจเท้า')
            )
            OR EXISTS (
              SELECT 1 FROM pp_special ps
              LEFT JOIN pp_special_type pst ON pst.pp_special_type_id = ps.pp_special_type_id
              WHERE ps.vn = o.vn AND (COALESCE(ps.pp_special_code, pst.pp_special_code) = '1B0110' OR pst.pp_special_type_name REGEXP 'เท้า')
            )
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await finalizeRows(rows as Record<string, unknown>[]);
    }

    // สามารถเพิ่มเงื่อนไขกองทุนอื่นๆ ต่อไปได้ที่นี่
    return [];
  } catch (error) {
    rethrowHospitalDatabaseError(error);
    console.error('Error fetching specific fund data:', error);
    if (options.throwOnError) throw error;
    return [];
  } finally {
    connection.release();
  }
};

// Lightweight source queries for the revenue monitor. These intentionally avoid
// loading every eligible OPD rule and the full IPD claim-monitor joins.
export const getRevenueOpportunitySourceRows = async (startDate: string, endDate: string) => {
  const connection = await getUTFConnection();
  try {
    const [opdRows] = await connection.query(`
      SELECT
        o.vn, o.hn, COALESCE(o.an, '') AS an,
        DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patientName,
        ptt.pttype AS pttype_code,
        ptt.name AS fund,
        ptt.hipdata_code,
        CASE WHEN COALESCE(o.an, '') <> '' OR EXISTS(SELECT 1 FROM ipt i WHERE i.vn = o.vn) THEN 1 ELSE 0 END AS is_admitted,
        CASE WHEN COALESCE(o.an, '') <> '' OR EXISTS(SELECT 1 FROM ipt i WHERE i.vn = o.vn) THEN 'IP' ELSE 'OP' END AS service_type,
        CASE WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn) THEN 1 ELSE 0 END AS has_refer_in,
        CASE WHEN EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 1 ELSE 0 END AS has_refer_out,
        CASE WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn)
          OR EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 1 ELSE 0 END AS has_refer_record,
        CASE
          WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn)
            AND EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 'BOTH'
          WHEN EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn) THEN 'IN'
          WHEN EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn) THEN 'OUT'
          ELSE ''
        END AS refer_direction,
        COALESCE(
          (SELECT CONCAT('IN:', COALESCE(ri.docno, '')) FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
          (SELECT CONCAT('OUT:', COALESCE(ro.refer_number, '')) FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
          ''
        ) AS refer_no,
        COALESCE(
          (SELECT ri.docno FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
          (SELECT ro.refer_number FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
          ''
        ) AS refer_no_raw,
        COALESCE(
          (SELECT DATE_FORMAT(ri.refer_date, '%Y-%m-%d') FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
          (SELECT DATE_FORMAT(ro.refer_date, '%Y-%m-%d') FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
          ''
        ) AS refer_date,
        COALESCE(
          (SELECT ri.refer_hospcode FROM referin ri WHERE ri.vn = o.vn LIMIT 1),
          (SELECT ro.refer_hospcode FROM referout ro WHERE ro.vn = o.vn LIMIT 1),
          ''
        ) AS refer_hospcode,
        COALESCE((SELECT TRIM(ro.refer_hospcode) FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS referout_hospcode,
        COALESCE((SELECT ro.refer_in_province FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS refer_in_province,
        COALESCE((SELECT ro.with_ambulance FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS with_ambulance,
        COALESCE((SELECT ro.car_registration_no FROM referout ro WHERE ro.vn = o.vn LIMIT 1), '') AS ambulance_registration,
        CASE WHEN EXISTS(
          SELECT 1
          FROM opitemrece oi
          JOIN s_drugitems sd ON sd.icode = oi.icode
          WHERE oi.vn = o.vn
            AND UPPER(TRIM(COALESCE(sd.nhso_adp_code, ''))) REGEXP '^S1'
        ) THEN 1 ELSE 0 END AS has_refer_adp_s,
        COALESCE((
          SELECT GROUP_CONCAT(DISTINCT UPPER(TRIM(sd.nhso_adp_code)) ORDER BY sd.nhso_adp_code SEPARATOR ', ')
          FROM opitemrece oi
          JOIN s_drugitems sd ON sd.icode = oi.icode
          WHERE oi.vn = o.vn
            AND UPPER(TRIM(COALESCE(sd.nhso_adp_code, ''))) REGEXP '^S1'
        ), '') AS refer_adp_codes,
        COALESCE((
          SELECT GROUP_CONCAT(
            DISTINCT CONCAT(oi.icode, ' ', COALESCE(sd.name, ''), ' [', UPPER(TRIM(sd.nhso_adp_code)), ']')
            ORDER BY oi.icode SEPARATOR ' | '
          )
          FROM opitemrece oi
          JOIN s_drugitems sd ON sd.icode = oi.icode
          WHERE oi.vn = o.vn
            AND UPPER(TRIM(COALESCE(sd.nhso_adp_code, ''))) REGEXP '^S1'
        ), '') AS refer_adp_items,
        (SELECT dx.icd10 FROM ovstdiag dx WHERE dx.vn = o.vn AND dx.diagtype = '1' LIMIT 1) AS main_diag,
        CASE WHEN EXISTS(SELECT 1 FROM opitemrece oi WHERE oi.vn = o.vn AND COALESCE(oi.sum_price, 0) > 0) THEN 1 ELSE 0 END AS has_receipt,
        COALESCE((SELECT SUM(oi.sum_price) FROM opitemrece oi WHERE oi.vn = o.vn), 0) AS total_price,
        CASE WHEN COALESCE(
          (SELECT ncp.nhso_authen_code FROM nhso_confirm_privilege ncp
           WHERE ncp.vn = o.vn AND ncp.nhso_status = 'Y' AND ncp.nhso_authen_code REGEXP '^EP' LIMIT 1),
          (SELECT ah.claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1),
          (SELECT vp.auth_code FROM visit_pttype vp WHERE vp.vn = o.vn AND vp.auth_code REGEXP '^EP' LIMIT 1)
        ) IS NOT NULL THEN 1 ELSE 0 END AS has_close,
        COALESCE(
          (SELECT ncp.nhso_authen_code FROM nhso_confirm_privilege ncp
           WHERE ncp.vn = o.vn AND ncp.nhso_status = 'Y' AND ncp.nhso_authen_code REGEXP '^EP' LIMIT 1),
          (SELECT ah.claim_code FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP' LIMIT 1),
          (SELECT vp.auth_code FROM visit_pttype vp WHERE vp.vn = o.vn AND vp.auth_code REGEXP '^EP' LIMIT 1),
          ''
        ) AS close_code,
        'OP Refer' AS project_code
      FROM ovst o
      JOIN patient pt ON pt.hn = o.hn
      JOIN pttype ptt ON ptt.pttype = o.pttype
      WHERE o.vstdate BETWEEN ? AND ?
        AND (
          ptt.name LIKE '%OP Refer%' OR ptt.name LIKE '%รับส่งต่อ%' OR ptt.name LIKE '%Refer%'
          OR EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = o.vn)
          OR EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = o.vn)
        )
      ORDER BY o.vstdate DESC, o.vsttime DESC
    `, [startDate, endDate]);

    const [ipdRows] = await connection.query(`
      SELECT
        i.an, i.hn, i.vn,
        DATE_FORMAT(i.regdate, '%Y-%m-%d') AS admDate,
        DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dchdate,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patientName,
        ptt.name AS pttype,
        w.name AS ward,
        (SELECT dx.icd10 FROM iptdiag dx WHERE dx.an = i.an AND dx.diagtype = '1' LIMIT 1) AS pdx,
        (SELECT s.drg FROM an_stat s WHERE s.an = i.an LIMIT 1) AS drg,
        (SELECT s.rw FROM an_stat s WHERE s.an = i.an LIMIT 1) AS rw,
        COALESCE((SELECT SUM(oi.sum_price) FROM opitemrece oi WHERE oi.an = i.an), 0) AS totalPrice
      FROM ipt i
      JOIN patient pt ON pt.hn = i.hn
      JOIN pttype ptt ON ptt.pttype = i.pttype
      LEFT JOIN ward w ON w.ward = i.ward
      WHERE (DATE(i.regdate) BETWEEN ? AND ? OR DATE(i.dchdate) BETWEEN ? AND ?)
        AND ptt.name LIKE '%CSCD%'
      ORDER BY i.regdate DESC
    `, [startDate, endDate, startDate, endDate]);

    const enrichedOpdRows = ((Array.isArray(opdRows) ? opdRows : []) as Record<string, unknown>[]).map((row) => {
      const pttypeCode = String(row.pttype_code || '').trim().toUpperCase();
      const mapping = RECEIVABLE_RIGHT_MAPPINGS.find((item) => item.hosxp_code.toUpperCase() === pttypeCode);
      return {
        ...row,
        finance_code: mapping?.finance_code || '',
        finance_name: mapping?.finance_name || '',
      };
    });

    return {
      opdRows: enrichedOpdRows,
      ipdRows: (Array.isArray(ipdRows) ? ipdRows : []) as Record<string, unknown>[],
    };
  } finally {
    connection.release();
  }
};

export const getKidneyMonitorDetailed = async (startDate: string, endDate: string) => {
  try {
    const connection = await getUTFConnection();

    console.log(`🔍 getKidneyMonitorDetailed: startDate=${startDate}, endDate=${endDate}`);

    // Step 1: Get every visit served by the dialysis unit. N185/Z49 and actual
    // dialysis items are validation flags only; they must not change the visit
    // count shown elsewhere on this page.
    // ไม่มี LIMIT — ดึงข้อมูลทั้งหมดตามช่วงวันที่
    const patientQuery = `
      SELECT DISTINCT
        ovst.hn,
        ovst.vn,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patientName,
        COALESCE(pttype.hipdata_code, ovst.pttype, 'UNKNOWN') AS hipdata_code,
        COALESCE(pttype.name, CONCAT('Type:', COALESCE(ovst.pttype, 'NULL'))) AS pttypeName,
        ovst.pttype AS raw_pttype,
        ovst.main_dep AS mainDepartment,
        EXISTS (
          SELECT 1
          FROM ovstdiag dx
          WHERE dx.vn = ovst.vn
            AND REPLACE(UPPER(COALESCE(dx.icd10, '')), '.', '') REGEXP '^(N185|Z49)'
        ) AS hasDialysisDiagnosis,
        EXISTS (
          SELECT 1
          FROM opitemrece dialysis_oe
          LEFT JOIN nondrugitems dialysis_ndi ON dialysis_ndi.icode = dialysis_oe.icode
          LEFT JOIN s_drugitems dialysis_sd ON dialysis_sd.icode = dialysis_oe.icode
          WHERE dialysis_oe.vn = ovst.vn
            AND (
              COALESCE(dialysis_ndi.name, dialysis_sd.name, '') LIKE '%ล้างไต%'
              OR COALESCE(dialysis_ndi.name, dialysis_sd.name, '') LIKE '%ฟอกไต%'
              OR COALESCE(dialysis_ndi.name, dialysis_sd.name, '') LIKE '%ฟอกเลือด%'
              OR LOWER(COALESCE(dialysis_ndi.name, dialysis_sd.name, '')) LIKE '%dialysi%'
            )
        ) AS hasDialysisService,
        DATE_FORMAT(ovst.vstdate, '%Y-%m-%d') AS serviceDate
      FROM ovst
      LEFT JOIN patient pt ON ovst.hn = pt.hn
      LEFT JOIN pttype ON ovst.pttype = pttype.pttype
      WHERE
        ovst.vstdate >= ? AND ovst.vstdate < DATE_ADD(?, INTERVAL 1 DAY)
        AND ovst.main_dep = '060'
      ORDER BY ovst.vstdate DESC
    `;    const [candidateVisits] = await connection.query(patientQuery, [startDate, endDate]);
    const visits = (candidateVisits as any[]).filter(isKidneyUnitServiceVisit);
    const evidenceCount = visits.filter(isDialysisMonitorVisit).length;
    const excludedCount = visits.length - evidenceCount;
    const totalCount = visits.length;
    const trackingSummary = summarizeKidneyTrackingVisits(visits);
    const trackingIssues = findKidneyTrackingIssues(visits);
    console.log(`🏥 Found ${totalCount} patient visits for kidney monitor (${startDate} to ${endDate})`);
    if (excludedCount > 0) {
      console.log(`⚠️ Kept ${excludedCount} department-060 visits without dialysis evidence for reconciliation`);
    }
    // Process visits sequentially (not all at once) to avoid connection pool exhaustion
    const detailedData: any[] = [];
    for (const row of visits) {
      console.log('📅 Processing row:', { hn: row.hn, vn: row.vn, serviceDate: row.serviceDate });
      const pttypeName = row.pttypeName || '';      const hipdataCode = row.hipdata_code || '';      // Determine insurance group based on both pttypeName and hipdata_code
      const insuranceType = pttypeName;
      let insuranceGroup = 'OTHER';

      // Debug logging
      console.log(`  💾 Checking insurance: hipdataCode="${hipdataCode}", pttypeName="${pttypeName}"`);

      // Check OFC/LGO
      if ((businessRules.insurance_mapping as any).OFC_LGO?.hipdata_codes?.includes(hipdataCode) ||
        (businessRules.insurance_mapping as any).OFC_LGO?.keywords?.some((k: string) => pttypeName.includes(k))) {
        insuranceGroup = 'OFC+LGO';
        console.log(`  ✅ Matched OFC+LGO`);
      } else if ((businessRules.insurance_mapping as any).UCS_SSS?.hipdata_codes?.includes(hipdataCode) ||
        (businessRules.insurance_mapping as any).UCS_SSS?.keywords?.some((k: string) => pttypeName.includes(k))) {
        insuranceGroup = 'UCS+SSS';
        console.log(`  ✅ Matched UCS+SSS`);
      } else if ((businessRules.insurance_mapping as any).UC_EPO?.hipdata_codes?.includes(hipdataCode) ||
        (businessRules.insurance_mapping as any).UC_EPO?.keywords?.some((k: string) => pttypeName.includes(k))) {
        insuranceGroup = 'UC-EPO';
        console.log(`  ✅ Matched UC-EPO`);      } else {
        insuranceGroup = 'OTHER';
        console.log(`  ⚠️ No match - setting to OTHER`);
        console.log(`     pttypeName="${pttypeName}"`);
        console.log(`     Available keywords:`, Object.entries(businessRules.insurance_mapping as any).map(([k, v]) => ({
          key: k,
          keywords: (v as any).keywords,
          hipdata_codes: (v as any).hipdata_codes
        })));
      }
      console.log(`  📋 Final insuranceGroup: ${insuranceGroup}`);// Step 2: Get drug items - classify using drugitems table (if exists, it's a drug)
      const drugQuery = `
        SELECT 
          oe.icode as drugcode,
          COALESCE(dg.name, oe.icode) as drugname,
          oe.qty,
          COALESCE(oe.unitprice * oe.qty, 0) as total_price,
          COALESCE(oe.unitprice, 0) as unitprice,
          COALESCE(dg.unitcost, 0) as unitcost,
          oe.income,
          CASE 
            WHEN COALESCE(dg.unitcost, 0) > 0 THEN COALESCE(dg.unitcost * oe.qty, 0)
            ELSE COALESCE(oe.unitprice * oe.qty, 0) * 0.5
          END as total_cost,
          CASE 
            WHEN COALESCE(dg.unitcost, 0) > 0 THEN 0
            ELSE 1
          END as cost_is_estimated
        FROM opitemrece oe
        INNER JOIN drugitems dg ON dg.icode = oe.icode
        WHERE oe.vn = ?
        ORDER BY oe.icode
      `;

      const [drugs] = await connection.query(drugQuery, [row.vn]);      // Step 3: Get lab items - TRUE labs only (NOT services/dialysis)
      // Exclude items with service-related keywords
      const labQuery = `
        SELECT 
          oe.icode as labcode,
          COALESCE(ndi.name, sd.name, oe.icode) as labname,
          oe.qty,
          COALESCE(oe.unitprice * oe.qty, 0) as total_price,
          COALESCE(oe.unitprice, 0) as unitprice,
          oe.income,
          CASE 
            WHEN COALESCE(oe.unitprice, 0) > 0 THEN COALESCE(oe.unitprice * oe.qty * 0.4, 0)
            ELSE COALESCE(oe.unitprice * oe.qty, 0) * 0.4
          END as total_cost,
          1 as cost_is_estimated
        FROM opitemrece oe
        LEFT JOIN nondrugitems ndi ON ndi.icode = oe.icode
        LEFT JOIN s_drugitems sd ON sd.icode = oe.icode
        WHERE oe.vn = ? 
          AND NOT EXISTS (SELECT 1 FROM drugitems WHERE icode = oe.icode)
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ค่า%'
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%บริการ%'
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ล้างไต%'
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ฟอกไต%'
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ฟอกเลือด%'
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ialysi%'
        ORDER BY oe.icode
      `;

      const [labs] = await connection.query(labQuery, [row.vn]);// Step 4: Calculate totals by category
      let drugTotalSale = 0;
      let drugTotalCost = 0;
      let labTotalSale = 0;
      let labTotalCost = 0;

      (drugs as any[]).forEach((drug: any) => {
        const total = parseFloat(drug.total_price) || 0;
        const cost = parseFloat(drug.total_cost) || 0;
        drugTotalSale += total;
        drugTotalCost += cost; // Use actual unitcost from drugitems table
      });

      (labs as any[]).forEach((lab: any) => {
        const total = parseFloat(lab.total_price) || 0;
        const cost = parseFloat(lab.total_cost) || 0; labTotalSale += total;
        labTotalCost += cost; // Use actual unitcost from drugitems table
      });      // Step 5: Get dialysis/medical services - items with service keywords
      // Includes: ค่าล้างไต, ค่าบริการแพทย์, etc.
      const dialysisQuery = `
        SELECT 
          oe.icode as servicecode,
          COALESCE(ndi.name, sd.name, oe.icode) as servicename,
          oe.qty,
          COALESCE(oe.unitprice * oe.qty, 0) as dialysisServicePrice,
          COALESCE(oe.unitprice, 0) as unitprice,
          -- Cost calculation: use 1380 for dialysis room if it's a dialysis service, otherwise use 40% fallback
          CASE 
            WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%'
              OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกไต%'
              OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกเลือด%'
              OR LOWER(COALESCE(ndi.name, sd.name, oe.icode)) LIKE '%dialysi%'
              THEN ${businessRules.costs.dialysis_fixed}  -- Fixed dialysis room cost
            ELSE COALESCE(oe.unitprice * oe.qty, 0) * ${businessRules.costs.fallback_margin}  -- Fallback margin for other services
          END as total_cost,
          CASE 
            WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%'
              OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกไต%'
              OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกเลือด%'
              OR LOWER(COALESCE(ndi.name, sd.name, oe.icode)) LIKE '%dialysi%'
              THEN 0  -- Fixed cost, not estimated
            ELSE 1  -- Estimated using fallback margin
          END as cost_is_estimated,
          CASE 
            WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%'
              OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกไต%'
              OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกเลือด%'
              OR LOWER(COALESCE(ndi.name, sd.name, oe.icode)) LIKE '%dialysi%'
              THEN 1
            ELSE 0
          END as is_dialysis
        FROM opitemrece oe
        LEFT JOIN nondrugitems ndi ON ndi.icode = oe.icode
        LEFT JOIN s_drugitems sd ON sd.icode = oe.icode
        WHERE oe.vn = ? 
          AND NOT EXISTS (SELECT 1 FROM drugitems WHERE icode = oe.icode)
          AND (COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ค่า%'
            OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%บริการ%'
            OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ialysi%'
            OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%'
            OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกไต%'
            OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ฟอกเลือด%')
      `;

      const [dialysisItems] = await connection.query(dialysisQuery, [row.vn]);      let dialysisServicePrice = 0;
      let dialysisServiceCost = 0;
      let otherServicePrice = 0;
      let otherServiceCost = 0;

      (dialysisItems as any[]).forEach((item: any) => {
        const total = parseFloat(item.dialysisServicePrice) || 0;
        const cost = parseFloat(item.total_cost) || 0;
        if (item.is_dialysis) {
          dialysisServicePrice += total;
          dialysisServiceCost += cost;
        } else {
          otherServicePrice += total;
          otherServiceCost += cost;
        }
      });      // Calculate totals
      const revenue = dialysisServicePrice + otherServicePrice + drugTotalSale + labTotalSale;
      const costTotal = dialysisServiceCost + otherServiceCost + drugTotalCost + labTotalCost;
      const profit = revenue - costTotal;      const profitMargin = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;

      const result = {
        hn: row.hn,
        vn: row.vn,
        patientName: row.patientName,
        insuranceType,
        hipdata_code: row.hipdata_code,
        serviceDate: row.serviceDate || new Date().toISOString().split('T')[0],
        hasDialysisDiagnosis: Number(row.hasDialysisDiagnosis) === 1,
        hasDialysisService: Number(row.hasDialysisService) === 1,
        hasDialysisEvidence: isDialysisMonitorVisit(row),
        dialysisFee: dialysisServicePrice,
        dialysisCost: dialysisServiceCost,
        otherServiceFee: otherServicePrice,
        otherServiceCost: otherServiceCost,
        drugTotalSale,
        drugTotalCost,
        labTotalSale,
        labTotalCost,
        revenue,
        costTotal,
        profit,
        profitMargin,
        insuranceGroup,drugs: (drugs as Record<string, unknown>[]).map((d: Record<string, unknown>) => ({
          drugName: (d.drugname as string) || (d.drugcode as string),
          drugcode: d.drugcode,
          qty: (d.qty as number) || 1,
          unitcost: (d.unitcost as number) || 0,
          unitprice: (d.unitprice as number) || 0,
          total_price: (d.total_price as number) || 0,
          total_cost: (d.total_cost as number) || 0,
          costIsEstimated: !!(d.cost_is_estimated as number),
        })), labs: (labs as Record<string, unknown>[]).map((l: Record<string, unknown>) => ({
          labName: (l.labname as string) || (l.labcode as string),
          labcode: l.labcode,
          qty: (l.qty as number) || 1,
          unitcost: (l.unitcost as number) || 0,
          service_cost: (l.total_cost as number) || 0,
          service_pprice: (l.unitprice as number) || 0,
          total_price: (l.total_price as number) || 0,
          costIsEstimated: !!(l.cost_is_estimated as number),
        })),        dialysisServices: (dialysisItems as Record<string, unknown>[]).map((d: Record<string, unknown>) => ({
          serviceName: (d.servicename as string) || (d.servicecode as string),
          servicecode: d.servicecode,
          qty: (d.qty as number) || 1,
          service_cost: (d.total_cost as number) || 0,
          service_pprice: (d.unitprice as number) || 0,
          total_price: (d.dialysisServicePrice as number) || 0,
          profit: ((d.dialysisServicePrice as number) || 0) - ((d.total_cost as number) || 0),
          costIsEstimated: !!(d.cost_is_estimated as number),
          isDialysis: !!(d.is_dialysis as number),        })),
      };
      detailedData.push(result);
    }

    // Debug: Show OTHER records
    const otherRecords = detailedData.filter((r: any) => r.insuranceGroup === 'OTHER');
    if (otherRecords.length > 0) {
      console.log(`\n⚠️ WARNING: Found ${otherRecords.length} records with insuranceGroup=OTHER:`);
      otherRecords.forEach((r: any) => {
        console.log(`  - HN: ${r.hn}, insuranceType: "${r.insuranceType}"`);
      });
    }    connection.release();

    let enrichedData = detailedData;
    let repstmSummary = attachKidneyRepStmTracking(detailedData, [], []).summary;
    let repstmConnection: HospitalConnection | null = null;
    try {
      const visitVns = Array.from(new Set(detailedData.map((row) => String(row.vn || '').trim()).filter(Boolean)));
      const visitHns = Array.from(new Set(detailedData.map((row) => String(row.hn || '').trim()).filter(Boolean)));
      const normalizedVisitHns = Array.from(new Set(visitHns.map((hn) => hn.replace(/_/g, '').replace(/^0+/, '') || '0')));
      if (detailedData.length > 0 && visitVns.length > 0 && visitHns.length > 0) {
        repstmConnection = await getRepstmConnection();
        const [repResult] = await repstmConnection.query(
          `SELECT r.id, r.vn, r.hn, DATE_FORMAT(r.admdate, '%Y-%m-%d') AS service_date,
                  r.rep_no, r.tran_id, r.compensated, r.errorcode, r.verifycode
             FROM rep_data r
            WHERE r.tran_id LIKE 'CHIHD:%'
              AND (r.vn IN (?)
               OR (TRIM(LEADING '0' FROM REPLACE(TRIM(r.hn), '_', '')) IN (?)
                   AND r.admdate >= ? AND r.admdate < DATE_ADD(?, INTERVAL 1 DAY)))`,
          [visitVns, normalizedVisitHns, startDate, endDate],
        );
        const repRows = repResult as any[];
        const repTranIds = Array.from(new Set(repRows.map((row) => String(row.tran_id || '').trim()).filter(Boolean)));
        const stmConditions = [
          's.matched_visit_code IN (?)',
          's.vn IN (?)',
          `(TRIM(LEADING '0' FROM REPLACE(TRIM(s.hn), '_', '')) IN (?)
            AND s.service_datetime >= ? AND s.service_datetime < DATE_ADD(?, INTERVAL 1 DAY))`,
        ];
        const stmParams: unknown[] = [visitVns, visitVns, normalizedVisitHns, startDate, endDate];
        if (repTranIds.length > 0) {
          stmConditions.push('s.tran_id IN (?)');
          stmParams.push(repTranIds);
        }
        const [stmResult] = await repstmConnection.query(
          `SELECT s.id, s.vn, s.matched_visit_code, s.hn,
                  DATE_FORMAT(s.service_datetime, '%Y-%m-%d') AS service_date,
                  s.statement_no, s.tran_id, s.amount, s.paid_amount, s.errorcode, s.verifycode
             FROM repstm_statement_data s
            WHERE s.data_type = 'STM' AND s.tran_id LIKE 'CHIHD:%'
              AND (${stmConditions.join(' OR ')})`,
          stmParams,
        );
        const attached = attachKidneyRepStmTracking(detailedData, repRows, stmResult as any[]);
        enrichedData = attached.data;
        repstmSummary = attached.summary;
      }
    } catch (repstmError) {
      console.error('⚠️ Kidney REP/STM linkage unavailable; returning visit data without claim tracking:', repstmError);
    } finally {
      repstmConnection?.release();
    }

    const returned = enrichedData.length;
    console.log(`✅ Processed ${returned} kidney monitor records - No truncation (all records shown)`);
    return {
      data: enrichedData,
      totalCount,
      returned,
      truncated: false,
      candidateCount: (candidateVisits as any[]).length,
      excludedCount,
      trackingSummary,
      trackingIssues,
      repstmSummary,
    };
  } catch (error) {
    console.error('Error in getKidneyMonitorDetailed:', error);
    return {
      data: [],
      totalCount: 0,
      returned: 0,
      truncated: false,
      candidateCount: 0,
      excludedCount: 0,
      trackingSummary: summarizeKidneyTrackingVisits([]),
      trackingIssues: findKidneyTrackingIssues([]),
      repstmSummary: attachKidneyRepStmTracking([], [], []).summary,
    };
  }
};

// FS monitor must use only ProjectCode/ADP items from the NHSO 16-file guide.
// Do not infer from broad item names, otherwise one matching visit can be over-counted.
const FS_PROJECT_ITEMS = FS_PROJECT_ITEMS_2569;

const FS_PROJECT_ITEM_BY_CODE = new Map(
  FS_PROJECT_ITEMS.map((item) => [item.code.toUpperCase(), item])
);

const sqlStringLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
const FS_PROJECT_CODE_SQL = FS_PROJECT_ITEMS
  .map((item) => sqlStringLiteral(item.code.toUpperCase()))
  .join(', ');

const buildFsProjectCodeExpression = (field: string) =>
  `UPPER(REPLACE(TRIM(COALESCE(${field}, '')), ' ', ''))`;

const FS_PROJECT_MATCH_SQL = `
  CASE
    WHEN ${buildFsProjectCodeExpression('sd.nhso_adp_code')} IN (${FS_PROJECT_CODE_SQL}) THEN ${buildFsProjectCodeExpression('sd.nhso_adp_code')}
    WHEN ${buildFsProjectCodeExpression('sd.tmlt_code')} IN (${FS_PROJECT_CODE_SQL}) THEN ${buildFsProjectCodeExpression('sd.tmlt_code')}
    WHEN ${buildFsProjectCodeExpression('sd.ttmt_code')} IN (${FS_PROJECT_CODE_SQL}) THEN ${buildFsProjectCodeExpression('sd.ttmt_code')}
    WHEN ${buildFsProjectCodeExpression('oo.icode')} IN (${FS_PROJECT_CODE_SQL}) THEN ${buildFsProjectCodeExpression('oo.icode')}
    ELSE ''
  END
`;

type FsAggregate = {
  key: string;
  label: string;
  amount: number;
  visits: Set<string>;
  patients: Set<string>;
  items: number;
  qty: number;
};

const addFsAggregate = (
  map: Map<string, FsAggregate>,
  key: string,
  label: string,
  row: { vn: string; hn: string; amount: number; qty: number }
) => {
  const normalizedKey = key || 'ไม่ระบุ';
  const existing = map.get(normalizedKey) || {
    key: normalizedKey,
    label: label || normalizedKey,
    amount: 0,
    visits: new Set<string>(),
    patients: new Set<string>(),
    items: 0,
    qty: 0,
  };
  existing.amount += row.amount;
  existing.qty += row.qty;
  existing.items += 1;
  if (row.vn) existing.visits.add(row.vn);
  if (row.hn) existing.patients.add(row.hn);
  map.set(normalizedKey, existing);
};

const serializeFsAggregate = (entry: FsAggregate) => ({
  key: entry.key,
  label: entry.label,
  amount: Number(entry.amount.toFixed(2)),
  qty: Number(entry.qty.toFixed(2)),
  items: entry.items,
  visitCount: entry.visits.size,
  patientCount: entry.patients.size,
});

export const getFsMonitor = async (startDate: string, endDate: string) => {
  const connection = await getUTFConnection();
  const toNumber = (value: unknown) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
  };
  const toText = (value: unknown) => String(value ?? '').trim();

  try {
    const [rows] = await connection.query(
      `
      SELECT *
      FROM (
        SELECT
          o.vn,
          o.hn,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
          pt.cid,
          CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
          pt.pttype AS patient_pttype,
          patient_ptt.name AS patient_pttype_name,
          patient_ptt.hipdata_code AS patient_hipdata_code,
          o.pttype AS visit_pttype,
          visit_ptt.name AS visit_pttype_name,
          visit_ptt.hipdata_code AS visit_hipdata_code,
          oo.icode,
          oo.income AS income_code,
          inc.name AS income_name,
          ${FS_PROJECT_MATCH_SQL} AS fs_code,
          COALESCE(NULLIF(sd.name, ''), NULLIF(di.name, ''), NULLIF(ndi.name, ''), oo.icode) AS item_name,
          COALESCE(oo.qty, 0) AS qty,
          COALESCE(oo.unitprice, 0) AS unit_price,
          COALESCE(oo.sum_price, oo.qty * oo.unitprice, 0) AS raw_amount
        FROM opitemrece oo
        JOIN ovst o ON o.vn = oo.vn
        LEFT JOIN patient pt ON pt.hn = o.hn
        LEFT JOIN pttype patient_ptt ON patient_ptt.pttype = pt.pttype
        LEFT JOIN pttype visit_ptt ON visit_ptt.pttype = o.pttype
        LEFT JOIN income inc ON inc.income = oo.income
        LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
        LEFT JOIN drugitems di ON di.icode = oo.icode
        LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
        WHERE o.vstdate BETWEEN ? AND ?
          AND COALESCE(oo.sum_price, oo.qty * oo.unitprice, 0) > 0
      ) fs
      WHERE fs.fs_code <> ''
      ORDER BY fs.service_date, fs.vn, fs.fs_code, fs.item_name
      LIMIT 10000
      `,
      [startDate, endDate]
    );

    const detailMap = new Map<string, {
      vn: string;
      hn: string;
      serviceDate: string;
      cid: string;
      patientName: string;
      patientPttype: string;
      patientPttypeName: string;
      patientHipdata: string;
      visitPttype: string;
      visitPttypeName: string;
      visitHipdata: string;
      icode: string;
      incomeCode: string;
      incomeName: string;
      fsCode: string;
      serviceKey: string;
      serviceLabel: string;
      itemName: string;
      qty: number;
      unitPrice: number;
      rawAmount: number;
      amount: number;
      rateStatus?: 'matched' | 'mismatch';
      rateDifference?: number;
      rateWarning?: string;
    }>();

    (rows as Record<string, unknown>[]).forEach((row) => {
      const fsCode = toText(row.fs_code).toUpperCase();
      const projectItem = FS_PROJECT_ITEM_BY_CODE.get(fsCode);
      if (!projectItem) return;

      const vn = toText(row.vn);
      const detailKey = `${vn}|${fsCode}`;
      const existing = detailMap.get(detailKey);

      if (existing) {
        existing.qty += toNumber(row.qty);
        existing.rawAmount += toNumber(row.raw_amount);
        const itemName = toText(row.item_name);
        if (itemName && !existing.itemName.split(' | ').includes(itemName)) {
          existing.itemName = `${existing.itemName} | ${itemName}`;
        }
        return;
      }

      detailMap.set(detailKey, {
        vn: toText(row.vn),
        hn: toText(row.hn),
        serviceDate: toText(row.service_date),
        cid: toText(row.cid),
        patientName: toText(row.patient_name),
        patientPttype: toText(row.patient_pttype),
        patientPttypeName: toText(row.patient_pttype_name),
        patientHipdata: toText(row.patient_hipdata_code),
        visitPttype: toText(row.visit_pttype),
        visitPttypeName: toText(row.visit_pttype_name),
        visitHipdata: toText(row.visit_hipdata_code),
        icode: toText(row.icode),
        incomeCode: toText(row.income_code),
        incomeName: toText(row.income_name),
        fsCode,
        serviceKey: fsCode,
        serviceLabel: projectItem.label,
        itemName: toText(row.item_name),
        qty: toNumber(row.qty),
        unitPrice: toNumber(row.unit_price),
        rawAmount: toNumber(row.raw_amount),
        amount: projectItem.amount,
      });
    });

    const detailRows = [...detailMap.values()].map((row) => {
      const rateCheck = evaluateFsRate(row.amount, row.rawAmount);
      return {
        ...row,
        rateStatus: rateCheck.status,
        rateDifference: rateCheck.difference,
        rateWarning: rateCheck.warning,
      };
    });

    const byHipdata = new Map<string, FsAggregate>();
    const byPatientPttype = new Map<string, FsAggregate>();
    const byVisitPttype = new Map<string, FsAggregate>();
    const topServices = new Map<string, FsAggregate>();
    const visits = new Set<string>();
    const patients = new Set<string>();
    let totalAmount = 0;
    let rateMismatchCount = 0;
    let totalRateDifference = 0;

    detailRows.forEach((row) => {
      totalAmount += row.amount;
      if (row.rateStatus === 'mismatch') {
        rateMismatchCount += 1;
        totalRateDifference += Number(row.rateDifference || 0);
      }
      if (row.vn) visits.add(row.vn);
      if (row.hn) patients.add(row.hn);
      addFsAggregate(byHipdata, row.patientHipdata || 'ไม่ระบุ', row.patientHipdata || 'ไม่ระบุ hipdata', row);
      addFsAggregate(
        byPatientPttype,
        row.patientPttype || 'ไม่ระบุ',
        `${row.patientPttype || 'ไม่ระบุ'} ${row.patientPttypeName || ''}`.trim(),
        row
      );
      addFsAggregate(
        byVisitPttype,
        row.visitPttype || 'ไม่ระบุ',
        `${row.visitPttype || 'ไม่ระบุ'} ${row.visitPttypeName || ''}`.trim(),
        row
      );
      addFsAggregate(
        topServices,
        row.fsCode,
        `${row.fsCode} ${row.serviceLabel}`.trim(),
        row
      );
    });

    const sortByAmount = (items: FsAggregate[]) => items
      .map(serializeFsAggregate)
      .sort((a, b) => b.amount - a.amount);

    return {
      summary: {
        totalAmount: Number(totalAmount.toFixed(2)),
        itemCount: detailRows.length,
        visitCount: visits.size,
        patientCount: patients.size,
        rateMismatchCount,
        totalRateDifference: Number(totalRateDifference.toFixed(2)),
      },
      byHipdata: sortByAmount([...byHipdata.values()]),
      byPatientPttype: sortByAmount([...byPatientPttype.values()]),
      byVisitPttype: sortByAmount([...byVisitPttype.values()]),
      topServices: sortByAmount([...topServices.values()]).slice(0, 30),
      details: detailRows,
    };
  } finally {
    connection.release();
  }
};

// API สำหรับดึงข้อมูล IPD (ผู้ป่วยใน)
export const getEligibleIPD = async (
  startDate?: string,
  endDate?: string,
  statusFilter?: string
): Promise<Record<string, unknown>[]> => {
  const connection = await getUTFConnection();
  try {
    await ensureFdhClaimStatusSchema(connection);
    await ensureRepstmTables();
    const [auditTableRows] = await connection.query("SHOW TABLES LIKE 'z_fdh_audit_log'");
    const hasAuditTable = Array.isArray(auditTableRows) && auditTableRows.length > 0;

    let query = `
      SELECT 
        ipt.an,
        ipt.hn,
        ipt.vn,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patientName,
        pt.sex as sex,
        DATEDIFF(ipt.regdate, pt.birthday) as ageDays,
        w.name as ward,
        DATE_FORMAT(ipt.regdate, '%Y-%m-%d') as admDate,
        TIME_FORMAT(ipt.regtime, '%H:%i:%s') as regTime,
        DATE_FORMAT(ipt.dchdate, '%Y-%m-%d') as dchdate,
        TIME_FORMAT(ipt.dchtime, '%H:%i:%s') as dchTime,
        CASE 
          WHEN ipt.dchdate IS NULL THEN DATEDIFF(CURDATE(), ipt.regdate)
          ELSE DATEDIFF(ipt.dchdate, ipt.regdate) 
        END as los,
        pttype.name as pttype,
        COALESCE(pttype.hipdata_code, ipt.pttype) as hipdata_code,
        COALESCE(
          (SELECT ah.claim_code FROM authenhos ah WHERE ah.vn = ipt.vn AND COALESCE(ah.claim_code, '') <> '' ORDER BY ah.created_date DESC, ah.created_time DESC LIMIT 1),
          (SELECT ah.claim_code FROM authenhos ah WHERE ah.vn = ipt.an AND COALESCE(ah.claim_code, '') <> '' ORDER BY ah.created_date DESC, ah.created_time DESC LIMIT 1),
          (SELECT vp.auth_code FROM visit_pttype vp WHERE vp.vn = ipt.vn AND COALESCE(vp.auth_code, '') <> '' LIMIT 1),
          ''
        ) as authen_code,
        COALESCE(
          (SELECT DATE_FORMAT(TIMESTAMP(ah.created_date, ah.created_time), '%Y-%m-%d %H:%i:%s') FROM authenhos ah WHERE ah.vn = ipt.vn AND COALESCE(ah.claim_code, '') <> '' ORDER BY ah.created_date DESC, ah.created_time DESC LIMIT 1),
          (SELECT DATE_FORMAT(TIMESTAMP(ah.created_date, ah.created_time), '%Y-%m-%d %H:%i:%s') FROM authenhos ah WHERE ah.vn = ipt.an AND COALESCE(ah.claim_code, '') <> '' ORDER BY ah.created_date DESC, ah.created_time DESC LIMIT 1),
          (SELECT DATE_FORMAT(vp.Auth_DateTime, '%Y-%m-%d %H:%i:%s') FROM visit_pttype vp WHERE vp.vn = ipt.vn AND COALESCE(vp.auth_code, '') <> '' LIMIT 1),
          ''
        ) as authen_datetime,
        CASE
          WHEN EXISTS (SELECT 1 FROM authenhos ah WHERE ah.vn IN (ipt.vn, ipt.an) AND COALESCE(ah.claim_code, '') <> '') THEN 'authenhos'
          WHEN EXISTS (SELECT 1 FROM visit_pttype vp WHERE vp.vn = ipt.vn AND COALESCE(vp.auth_code, '') <> '') THEN 'visit_pttype'
          ELSE ''
        END as authen_source,
        
        -- DRG & RW
        (SELECT drg FROM an_stat WHERE an = ipt.an LIMIT 1) as drg,
        (SELECT rw FROM an_stat WHERE an = ipt.an LIMIT 1) as rw,
        
        -- Diagnosis and Procedures
        (SELECT icd10 FROM iptdiag WHERE an = ipt.an AND diagtype = '1' LIMIT 1) as pdx,
        (SELECT GROUP_CONCAT(DISTINCT icd10 ORDER BY diagtype, icd10 SEPARATOR ',') FROM iptdiag WHERE an = ipt.an) as diagnosis_codes,
        (SELECT GROUP_CONCAT(icd9) FROM iptoprt WHERE an = ipt.an) as or_codes,
        EXISTS(
          SELECT 1
          FROM opitemrece oi
          JOIN s_drugitems sd ON sd.icode = oi.icode
          WHERE oi.an = ipt.an
            AND UPPER(COALESCE(sd.name, '')) REGEXP 'TAMIFLU|OSELTAMIVIR'
        ) as hasTamiflu,
        EXISTS(
          SELECT 1
          FROM lab_head lh
          JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
          JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
          WHERE lh.vn IN (ipt.an, ipt.vn)
            AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP 'INFLUENZA|FLU A|FLU B'
            AND COALESCE(lo.lab_order_result, '') <> ''
        ) as hasInfluenzaTest,
        EXISTS(
          SELECT 1
          FROM opitemrece oi
          JOIN nondrugitems nd ON nd.icode = oi.icode
          WHERE oi.an = ipt.an
            AND (
              UPPER(COALESCE(nd.name, '')) REGEXP '(^|[^A-Z])CT([^A-Z]|$)|COMPUTED TOMOGRAPHY'
              OR COALESCE(nd.name, '') LIKE '%เอกซเรย์คอมพิวเตอร์%'
            )
        ) as hasCtScan,
        (
          EXISTS(SELECT 1 FROM referin ri WHERE ri.vn = ipt.vn)
          OR EXISTS(SELECT 1 FROM referout ro WHERE ro.vn = ipt.vn)
        ) as hasReferral,
        (SELECT CONCAT(DATE_FORMAT(prev.dchdate, '%Y-%m-%d'), ' ', TIME_FORMAT(prev.dchtime, '%H:%i:%s'))
          FROM ipt prev
          WHERE prev.hn = ipt.hn
            AND prev.an <> ipt.an
            AND prev.dchdate IS NOT NULL
            AND TIMESTAMP(prev.dchdate, COALESCE(prev.dchtime, '00:00:00')) <= TIMESTAMP(ipt.regdate, COALESCE(ipt.regtime, '00:00:00'))
          ORDER BY prev.dchdate DESC, prev.dchtime DESC
          LIMIT 1
        ) as previousDischargeAt,
        
        -- Total Price
        COALESCE((SELECT SUM(sum_price) FROM opitemrece WHERE an = ipt.an), 0) as totalPrice,
        
        -- Status
        CASE WHEN ipt.dchdate IS NULL THEN 'Admitted' ELSE 'Discharged' END as status,
        CASE 
          WHEN ipt.dchdate IS NOT NULL AND (SELECT COUNT(*) FROM iptdiag WHERE an = ipt.an) > 0 THEN 'สรุปชาร์ตแล้ว'
          WHEN ipt.dchdate IS NOT NULL THEN 'รอแพทย์สรุปชาร์ต'
          ELSE 'รอดำเนินการ'
        END as chartStatus,
        ${hasAuditTable ? 'za.status' : 'NULL'} as audit_status,
        ${hasAuditTable ? 'za.updated_by' : 'NULL'} as audit_by,
        ${hasAuditTable ? 'za.updated_at' : 'NULL'} as audit_date,
        COALESCE(NULL, fdh.transaction_uid) as fdh_transaction_uid,
        COALESCE(
          NULL,
          CONVERT(fdh.fdh_reservation_status USING utf8mb4) COLLATE utf8mb4_unicode_ci,
          CONVERT(fdh.fdh_claim_status_message USING utf8mb4) COLLATE utf8mb4_unicode_ci,
          IF(fdh.transaction_uid IS NOT NULL, 'ส่ง FDH แล้ว', NULL)
        ) as fdh_status_label,
        fdh.fdh_reservation_status,
        COALESCE(NULL, fdh.fdh_reservation_datetime) as fdh_reservation_datetime,
        fdh.fdh_claim_status_message,
        fdh.error_code as fdh_error_code,
        fdh.fdh_stm_period,
        fdh.fdh_act_amt,
        fdh.fdh_settle_at,
        fdh.updated_at as fdh_updated_at,
        NULL as fdh_claim_code,
        NULL as fdh_upload_uid,
        NULL as fdh_claim_detail_status,
        NULL as fdh_claim_detail_sent_at,
        CASE
          WHEN ipt.dchdate IS NULL THEN NULL
          WHEN COALESCE(NULL, fdh.fdh_reservation_datetime, fdh.updated_at) IS NOT NULL
            THEN DATEDIFF(DATE(COALESCE(NULL, fdh.fdh_reservation_datetime, fdh.updated_at)), DATE(ipt.dchdate))
          ELSE DATEDIFF(CURDATE(), DATE(ipt.dchdate))
        END as fdh_days_from_discharge,
        CASE
          WHEN ipt.dchdate IS NULL THEN 'ยังไม่จำหน่าย'
          WHEN COALESCE(NULL, fdh.fdh_reservation_datetime, fdh.updated_at) IS NOT NULL THEN 'ส่ง FDH แล้ว'
          ELSE 'ยังไม่ส่ง/ยังไม่พบวันส่ง FDH'
        END as fdh_days_note
        
      FROM ipt
      JOIN patient pt ON ipt.hn = pt.hn
      LEFT JOIN ward w ON ipt.ward = w.ward
      LEFT JOIN pttype ON ipt.pttype = pttype.pttype
      ${hasAuditTable ? 'LEFT JOIN z_fdh_audit_log za ON ipt.an = za.an' : ''}
      LEFT JOIN (
        SELECT s.*
        FROM fdh_claim_status s
        JOIN (
          SELECT vn, MAX(updated_at) AS max_updated_at
          FROM fdh_claim_status
          WHERE IFNULL(vn, '') <> ''
          GROUP BY vn
        ) latest ON latest.vn = s.vn AND latest.max_updated_at = s.updated_at
      ) fdh ON fdh.vn = ipt.vn
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    // Default to last 30 days if no dates provided
    if (startDate) {
      query += ` AND (DATE(ipt.regdate) >= ? OR (ipt.dchdate IS NOT NULL AND DATE(ipt.dchdate) >= ?))`;
      params.push(startDate, startDate);
    } else {
      query += ` AND (DATE(ipt.regdate) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) OR (ipt.dchdate IS NOT NULL AND DATE(ipt.dchdate) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)))`;
    }

    if (endDate) {
      query += ` AND (DATE(ipt.regdate) <= ? OR (ipt.dchdate IS NOT NULL AND DATE(ipt.dchdate) <= ?))`;
      params.push(endDate, endDate);
    }

    if (statusFilter === 'admitted') {
      query += ` AND ipt.dchdate IS NULL`;
    } else if (statusFilter === 'discharged') {
      query += ` AND ipt.dchdate IS NOT NULL`;
    }

    query += ` ORDER BY ipt.regdate DESC LIMIT ${businessRules.query_limits.ipd_limit}`;

    const [rows] = await connection.query(query, params);
    return await attachLatestFdhClaimDetails((Array.isArray(rows) ? rows : []) as Record<string, unknown>[], 'IPD');
  } finally {
    connection.release();
  }
};

// API สำหรับดึงข้อมูลสรุปชาร์ตผู้ป่วยในแบบละเอียด (IPD Chart Review)
export const getIPDChartDetails = async (an: string) => {
  const warnings: string[] = [];
  // Use 6 separate connections so all queries run in parallel. Each section is
  // isolated because HOSxP schemas can differ slightly between hospitals.
  const connections = await Promise.all([
    getUTFConnection(),
    getUTFConnection(),
    getUTFConnection(),
    getUTFConnection(),
    getUTFConnection(),
    getUTFConnection(),
  ]);
  const [c1, c2, c3, c4, c5, c6] = connections;
  const runSectionQuery = async (
    section: string,
    connection: any,
    sql: string,
    params: unknown[]
  ): Promise<Record<string, unknown>[]> => {
    try {
      const [rows] = await connection.query(sql, params);
      return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${section}: ${message}`);
      console.error(`IPD chart section failed (${section})`);
      return [];
    }
  };

  try {
    const [
      patient,
      diags,
      opers,
      costs,
      labResult,
      drugs,
    ] = await Promise.all([
      runSectionQuery('patient', c1, `
        SELECT ipt.an, ipt.hn, ipt.vn,
          CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patientName,
          w.name as ward
        FROM ipt
        JOIN patient pt ON ipt.hn = pt.hn
        LEFT JOIN ward w ON ipt.ward = w.ward
        WHERE ipt.an = ? LIMIT 1
      `, [an]),
      runSectionQuery('diagnosis', c2, `
        SELECT i.diagtype, i.icd10, d.name as codeName
        FROM iptdiag i
        LEFT JOIN icd101 d ON i.icd10 = d.code
        WHERE i.an = ?
        ORDER BY i.diagtype
      `, [an]),
      runSectionQuery('procedure', c3, `
        SELECT i.icd9, d.name as opName
        FROM iptoprt i
        LEFT JOIN icd9cm1 d ON i.icd9 = d.code
        WHERE i.an = ?
      `, [an]),
      runSectionQuery('cost', c4, `
        SELECT inc.name as incomeGroup, SUM(o.sum_price) as sumPrice
        FROM opitemrece o
        LEFT JOIN income inc ON o.income = inc.income
        WHERE o.an = ?
        GROUP BY inc.name
        ORDER BY sumPrice DESC
      `, [an]),
      // Some HOSxP installations keep IPD lab_head.vn as AN, others keep the
      // admission VN. Check both so the modal does not miss real lab data.
      runSectionQuery('lab', c5, `
        SELECT h.order_date, i.lab_items_name, o.lab_order_result, i.lab_items_normal_value
        FROM lab_head h
        JOIN lab_order o ON h.lab_order_number = o.lab_order_number
        JOIN lab_items i ON o.lab_items_code = i.lab_items_code
        WHERE (h.vn = ? OR h.vn = (SELECT vn FROM ipt WHERE an = ? LIMIT 1))
          AND o.lab_order_result IS NOT NULL AND o.lab_order_result != ''
        ORDER BY h.order_date DESC
        LIMIT ${businessRules.query_limits.lab_limit}
      `, [an, an]),
      readVisitItems(c6, '', an).then(items => items.filter(item => Number(item.is_drug) === 1).map(item => ({
        name: item.item_name, total_qty: item.qty, total_price: item.price,
      }))),
    ]);



    const patientRow = patient[0] || null;
    if (!patientRow) return null;

    return {
      patient: patientRow,
      diags,
      opers,
      costSummary: costs,
      labs: labResult,
      drugs,
      warnings,
    };
  } catch (error) {
    console.error('Error fetching IPD Chart data:', error);
    return null;
  } finally {
    // Release all connections regardless of success/failure
    connections.forEach(c => c.release());
  }
};
