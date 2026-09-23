import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { pool, getUTFConnection, getRepstmConnection, repstmDatabaseName } from '../db/connection.js';
import {
  ensureRepstmTables,
  ensureFdhClaimStatusTable,
  ensureNhsoClosePrivilegeTable,
  ensureFdhClaimStatusSchema,
  FDH_STATUS_IMPORT_LOG_TABLE_SQL,
  FDH_SUBMISSION_LOG_TABLE_SQL,
  AUTHEN_SYNC_LOG_TABLE_SQL,
  AUTHEN_SYNC_CANCEL_TABLE_SQL,
  CLAIM_WORK_QUEUE_TABLE_SQL,
  CLAIM_REJECT_NOTE_TABLE_SQL,
  NHSO_CONFIRM_PRIVILEGE_TABLE_SQL,
  MOPHCLAIM_SEND_TABLE_SQL,
  FDH_CLAIM_DETAIL_ROW_TABLE_SQL,
} from '../db/schema.js';
import { activeHospitalDatabaseConfig, type HospitalConnection } from '../hospitalDatabase.js';
import { readHospitalIdentity } from '../siteProfile.js';
import { getAppSetting } from './system.repository.js';
import { normalizeImportCellValue, parseFlexibleDateTime } from '../utils/dataNormalization.js';
import { fetchWithTimeout } from '../httpClient.js';
import { getApVaccineRule, validateApVaccineEligibility } from '../mophVaccineRules.js';
import { consolidateFdhOopRows, type FdhExportProfile } from '../fdhExport.js';
import { readVisitItems, readVisitClinical } from '../visitDetails.js';
import { attachFundEligibility } from '../fundEligibility.js';
import businessRules from '../config/business_rules.json';
import { mergeFdhClaimDetails } from '../fdhClaimDetailMerge.js';
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

export const saveFdhStatusImportLog = async (entry: {
  transactionUid: string;
  hcode: string;
  environment: string;
  responseStatus?: number | null;
  responseMessage?: string | null;
  responseMessageTh?: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
}) => {
  const connection = await getUTFConnection();
  try {
    await connection.query(FDH_STATUS_IMPORT_LOG_TABLE_SQL);
    await connection.query(
      `INSERT INTO fdh_status_import_log
       (transaction_uid, hcode, environment, response_status, response_message, response_message_th, request_payload, response_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.transactionUid,
        entry.hcode,
        entry.environment,
        entry.responseStatus ?? null,
        entry.responseMessage ?? null,
        entry.responseMessageTh ?? null,
        JSON.stringify(entry.requestPayload ?? {}),
        JSON.stringify(entry.responsePayload ?? {}),
      ]
    );
    return { success: true };
  } catch (error) {
    console.error('Error saving FDH status import log:', error);
    return { success: false };
  } finally {
    connection.release();
  }
};

export const getFdhStatusImportLogs = async (limit = 50): Promise<Record<string, unknown>[]> => {
  const connection = await getUTFConnection();
  try {
    await connection.query(FDH_STATUS_IMPORT_LOG_TABLE_SQL);
    const [rows] = await connection.query(
      `SELECT id, transaction_uid, hcode, environment, response_status, response_message, response_message_th, request_payload, response_payload, imported_at
       FROM fdh_status_import_log
       ORDER BY imported_at DESC
       LIMIT ?`,
      [limit]
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } catch (error) {
    console.error('Error reading FDH status import logs:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const saveFdhSubmissionLog = async (entry: {
  batchUid: string;
  profile: string;
  hcode: string;
  environment: string;
  requestCount: number;
  recordCount: number;
  requestDigest: string;
  responseStatus?: number | null;
  success: boolean;
  responsePayload: unknown;
}) => {
  const connection = await getUTFConnection();
  try {
    await connection.query(FDH_SUBMISSION_LOG_TABLE_SQL);
    await connection.query(
      `INSERT INTO fdh_submission_log
       (batch_uid, profile, hcode, environment, request_count, record_count, request_digest, response_status, success, response_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.batchUid,
        entry.profile,
        entry.hcode,
        entry.environment,
        entry.requestCount,
        entry.recordCount,
        entry.requestDigest,
        entry.responseStatus ?? null,
        entry.success ? 1 : 0,
        JSON.stringify(entry.responsePayload ?? {}),
      ],
    );
    return { success: true };
  } catch (error) {
    console.error('Error saving FDH submission log:', error);
    return { success: false };
  } finally {
    connection.release();
  }
};

export const getFdhSubmissionLogs = async (limit = 50): Promise<Record<string, unknown>[]> => {
  const connection = await getUTFConnection();
  try {
    await connection.query(FDH_SUBMISSION_LOG_TABLE_SQL);
    const [rows] = await connection.query(
      `SELECT id, batch_uid, profile, hcode, environment, request_count, record_count,
              request_digest, response_status, success, response_payload, submitted_at
       FROM fdh_submission_log
       ORDER BY submitted_at DESC
       LIMIT ?`,
      [Math.max(1, Math.min(200, Math.trunc(limit) || 50))],
    );
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } catch (error) {
    console.error('Error reading FDH submission logs:', error);
    return [];
  } finally {
    connection.release();
  }
};

const isValidThaiCid = (cid: string) => {
  if (!/^\d{13}$/.test(cid)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(cid[i]) * (13 - i);
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === Number(cid[12]);
};

const formatDateOnly = (value: unknown) => {
  const text = normalizeImportCellValue(value);
  if (!text) return '';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const saveAuthenSyncLog = async (entry: {
  vn: string;
  cid?: string;
  hn?: string;
  vstdate?: string;
  claimCode?: string | null;
  authenType?: string | null;
  authenDateTime?: string | null;
  status: string;
  message?: string | null;
  requestUrl?: string | null;
  responsePayload?: unknown;
}) => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(AUTHEN_SYNC_LOG_TABLE_SQL);
    await connection.query(
      `INSERT INTO authen_sync_log
       (vn, cid, hn, vstdate, claim_code, authen_type, authen_datetime, status, message, request_url, response_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.vn,
        entry.cid || null,
        entry.hn || null,
        entry.vstdate || null,
        entry.claimCode || null,
        entry.authenType || null,
        entry.authenDateTime || null,
        entry.status,
        entry.message || null,
        entry.requestUrl || null,
        JSON.stringify(entry.responsePayload ?? null),
      ]
    );
  } finally {
    connection.release();
  }
};

const saveAuthenSyncCancel = async (entry: { vn: string; cid?: string; vstdate?: string; reason: string }) => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(AUTHEN_SYNC_CANCEL_TABLE_SQL);
    await connection.query(
      `INSERT INTO authen_sync_cancel (vn, cid, vstdate, reason)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE cid = VALUES(cid), vstdate = VALUES(vstdate), reason = VALUES(reason)`,
      [entry.vn, entry.cid || null, entry.vstdate || null, entry.reason]
    );
  } finally {
    connection.release();
  }
};

export const getAuthenSyncLogs = async (limit = 100): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(AUTHEN_SYNC_LOG_TABLE_SQL);
    const [rows] = await connection.query(
      `SELECT id, vn, cid, hn, vstdate, claim_code, authen_type, authen_datetime, status, message, synced_at
       FROM authen_sync_log
       ORDER BY synced_at DESC, id DESC
       LIMIT ?`,
      [limit]
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } finally {
    connection.release();
  }
};

const getDoctorCodeByCid = async (cid: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT code
       FROM doctor
       WHERE cid = ?
       LIMIT 1`,
      [cid]
    );
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] as Record<string, unknown> : null;
    return normalizeImportCellValue(row?.code);
  } finally {
    connection.release();
  }
};

export const getNhsoClosePrivilegeCandidates = async (options: {
  startDate: string;
  endDate: string;
  closeStatus?: 'all' | 'pending' | 'ok' | 'cancel' | 'error';
  authenStatus?: 'all' | 'has_authen' | 'missing_authen';
  mainInscl?: string;
  search?: string;
  limit?: number;
}) => {
  await ensureNhsoClosePrivilegeTable();

  const connection = await getUTFConnection();
  try {
    const whereConditions = ['o.vstdate BETWEEN ? AND ?'];
    const params: Array<string | number> = [options.startDate, options.endDate];

    if (options.closeStatus === 'pending') {
      whereConditions.push(`(
        IFNULL(ncp.nhso_status, '') <> 'Y'
        AND IFNULL(ncp.nhso_authen_code, '') NOT REGEXP '^EP'
        AND IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^EP' LIMIT 1), '') = ''
        AND IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^EP' LIMIT 1), '') = ''
      )`);
    } else if (options.closeStatus === 'ok') {
      whereConditions.push(`(
        IFNULL(ncp.nhso_status, '') = 'Y'
        OR IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
        OR IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^EP' LIMIT 1), '') <> ''
        OR IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^EP' LIMIT 1), '') <> ''
      )`);
    } else if (options.closeStatus === 'cancel') {
      whereConditions.push(`ncp.nhso_status = 'C'`);
    } else if (options.closeStatus === 'error') {
      whereConditions.push(`ncp.nhso_status = 'E'`);
    }

    if (options.authenStatus === 'has_authen') {
      whereConditions.push(`(
        IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^PP' LIMIT 1), '') <> ''
        OR IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^PP' LIMIT 1), '') <> ''
      )`);
    } else if (options.authenStatus === 'missing_authen') {
      whereConditions.push(`(
        IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^PP' LIMIT 1), '') = ''
        AND IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^PP' LIMIT 1), '') = ''
      )`);
    }

    if (options.mainInscl && options.mainInscl !== 'all') {
      whereConditions.push(`IFNULL(ptt.hipdata_code, '') = ?`);
      params.push(options.mainInscl);
    }

    if (options.search?.trim()) {
      whereConditions.push(`(
        o.vn LIKE ?
        OR o.hn LIKE ?
        OR pt.cid LIKE ?
        OR CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) LIKE ?
      )`);
      const keyword = `%${options.search.trim()}%`;
      params.push(keyword, keyword, keyword, keyword);
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 300), 1000));
    params.push(limit);

    const [rows] = await connection.query(
      `SELECT
         o.vn,
         o.hn,
         IFNULL(o.an, '') AS an,
         pt.cid,
        COALESCE(v.sex, pt.sex) as sex,
        v.age_y as age,
        v.age_y as age_y,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         COALESCE(v.sex, pt.sex) as sex,
         DATE_FORMAT(pt.birthday, '%Y-%m-%d') AS birthday,
         TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate) AS age,
         IFNULL(pt.nationality, '') AS nation,
         TIMESTAMP(o.vstdate, o.vsttime) AS vst_datetime,
         DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
         TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time,
         o.main_dep AS room,
         IFNULL(s.cc, '') AS cc,
         IFNULL(ptt.hipdata_code, '') AS maininscl,
         CONCAT(o.pttype, ':', COALESCE(ptt.name, '')) AS pttypename,
         (
           SELECT GROUP_CONCAT(DISTINCT vp2.pttype ORDER BY vp2.pttype SEPARATOR ',')
           FROM visit_pttype vp2
           WHERE vp2.vn = o.vn
             AND vp2.pttype <> o.pttype
         ) AS copttype,
         IFNULL(v.income, 0) AS income,
         IFNULL(v.uc_money, 0) AS uc_money,
         IFNULL(v.rcpt_money, 0) AS rcpt_money,
         IFNULL(o.ovstost, '') AS ovstost,
         COALESCE(ost.name, '') AS visit_outcome,
         COALESCE(
           NULLIF((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^PP' LIMIT 1), ''),
           NULLIF((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^PP' LIMIT 1), ''),
           ''
         ) AS authencode_web,
         COALESCE(
           NULLIF(ncp.nhso_authen_code, ''),
           NULLIF((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^EP' LIMIT 1), ''),
           NULLIF((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^EP' LIMIT 1), ''),
           ''
         ) AS close_code,
         IF(
           ncp.nhso_status = 'Y'
           OR IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
           OR IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^EP' LIMIT 1), '') <> ''
           OR IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^EP' LIMIT 1), '') <> '',
           'Y',
           ''
         ) AS onweb,
         IFNULL(v.debt_id_list, '') AS invno,
         ncp.nhso_seq,
         ncp.nhso_authen_code AS authencode_endpoint,
         CASE
           WHEN ncp.nhso_status = 'Y' THEN 'OK'
           WHEN ncp.nhso_status = 'C' THEN 'Cancel'
           WHEN ncp.nhso_status = 'E' THEN 'Error'
           WHEN IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP' THEN 'OK'
           WHEN IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^EP' LIMIT 1), '') <> '' THEN 'OK'
           WHEN IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^EP' LIMIT 1), '') <> '' THEN 'OK'
           ELSE ''
         END AS close_status,
         IFNULL(ncp.sourceID, '') AS source_id,
         IFNULL(ncp.confirm_staff, '') AS confirm_staff,
         IFNULL(ncp.nhso_total_amount, 0) AS nhso_total_amount,
         IFNULL(ncp.nhso_privilege_amount, 0) AS nhso_privilege_amount,
         IFNULL(ncp.nhso_cash_amount, 0) AS nhso_cash_amount,
         CASE
           WHEN TRIM(COALESCE(ost.name, '')) <> 'กลับบ้าน' THEN 0
           WHEN IFNULL(ncp.nhso_status, '') = 'Y' THEN 0
           WHEN IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP' THEN 0
           WHEN IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^EP' LIMIT 1), '') <> '' THEN 0
           WHEN IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^EP' LIMIT 1), '') <> '' THEN 0
           ELSE 1
         END AS can_close
       FROM ovst o
       LEFT JOIN patient pt ON pt.hn = o.hn
       LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
       LEFT JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN opdscreen s ON s.vn = o.vn
       LEFT JOIN ovstost ost ON ost.ovstost = o.ovstost
       LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
       LEFT JOIN authenhos ah ON ah.vn = o.vn
       LEFT JOIN nhso_confirm_privilege ncp ON ncp.vn = o.vn
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY o.vstdate DESC, o.vsttime DESC, o.vn DESC
       LIMIT ?`,
      params
    );

    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } finally {
    connection.release();
  }
};

const callNhsoClosePrivilegeApi = async (baseUrl: string, token: string, payload: Record<string, unknown>) => {
  const requestUrl = `${baseUrl.replace(/\/+$/, '')}/api/nhso-claim-detail`;
  const requestBody = JSON.stringify(payload);
  const headerOptions: Array<Record<string, string>> = [
    { Authorization: `Bearer ${token}` },
    { token },
    { apikey: token },
    { Authorization: token },
  ];

  let lastResult: {
    responseStatus: number;
    responseText: string;
    parsedPayload: unknown;
  } | null = null;

  for (const extraHeaders of headerOptions) {
    const response = await fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: requestBody,
    });

    const responseText = await response.text();
    let parsedPayload: unknown = responseText;
    try {
      parsedPayload = JSON.parse(responseText);
    } catch {
      parsedPayload = responseText;
    }

    lastResult = {
      responseStatus: response.status,
      responseText,
      parsedPayload,
    };

    if (response.ok) {
      return {
        requestUrl,
        requestBody,
        responseStatus: response.status,
        parsedPayload,
      };
    }
  }

  return {
    requestUrl,
    requestBody,
    responseStatus: lastResult?.responseStatus || 500,
    parsedPayload: lastResult?.parsedPayload || { error: 'request failed' },
  };
};

export const testNhsoClosePrivilegeToken = async (options: {
  token: string;
  baseUrl: string;
  hospitalCode: string;
  recorderPid: string;
  sourceId: string;
  claimServiceCode: string;
  environment: 'prd' | 'uat';
}) => {
  const requestPayload = {
    hcode: options.hospitalCode,
    visitNumber: 'TESTTOKEN',
    pid: '0000000000000',
    transactionId: `${options.hospitalCode}TESTTOKEN`,
    serviceDateTime: Date.now(),
    invoiceDateTime: Date.now(),
    mainInsclCode: 'UCS',
    totalAmount: 0,
    paidAmount: 0,
    privilegeAmount: 0,
    claimServiceCode: options.claimServiceCode,
    sourceId: options.sourceId,
    computerName: process.env.COMPUTERNAME || 'FDH-RECT',
    recorderPid: options.recorderPid,
  };

  const apiResult = await callNhsoClosePrivilegeApi(options.baseUrl, options.token, requestPayload);
  const errorMessage = getCloseResponseError(apiResult.parsedPayload);
  const seq = getCloseResponseValue(apiResult.parsedPayload, ['Seq', 'seq']);
  const authenCode = getCloseResponseValue(apiResult.parsedPayload, ['authenCode', 'AuthenCode', 'nhso_authen_code']);

  return {
    requestUrl: apiResult.requestUrl,
    responseStatus: apiResult.responseStatus,
    seq,
    authenCode,
    errorMessage,
    rawPayload: apiResult.parsedPayload,
    requestPayload,
  };
};

const toUnixMillis = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
};

const getCloseResponseValue = (payload: unknown, candidates: string[]) => {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  for (const candidate of candidates) {
    const direct = record[candidate];
    const normalizedDirect = normalizeImportCellValue(direct);
    if (normalizedDirect) return normalizedDirect;

    const nestedData = record.data;
    if (nestedData && typeof nestedData === 'object') {
      const nestedValue = normalizeImportCellValue((nestedData as Record<string, unknown>)[candidate]);
      if (nestedValue) return nestedValue;
    }
  }
  return '';
};

const getCloseResponseError = (payload: unknown) => {
  const directMessage = getCloseResponseValue(payload, ['Error', 'error', 'message', 'Message', 'dataError']);
  if (directMessage) return directMessage;
  if (payload && typeof payload === 'object') {
    const errors = (payload as Record<string, unknown>).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const firstError = errors[0];
      if (firstError && typeof firstError === 'object') {
        return normalizeImportCellValue((firstError as Record<string, unknown>).message)
          || normalizeImportCellValue((firstError as Record<string, unknown>).code);
      }
    }
  }
  return '';
};

export const getNhsoClosePrivilegeHistory = async (limit = 100): Promise<Record<string, unknown>[]> => {
  await ensureNhsoClosePrivilegeTable();
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         nhso_confirm_privilege_id,
         vn,
         nhso_seq,
         nhso_authen_code,
         nhso_status,
         nhso_total_amount,
         nhso_privilege_amount,
         nhso_cash_amount,
         sourceID,
         confirm_staff,
         nhso_requst_datetime,
         nhso_response_datetime,
         nhso_reponse_json,
         nhso_cancel_response
       FROM nhso_confirm_privilege
       ORDER BY COALESCE(nhso_response_datetime, nhso_requst_datetime) DESC, nhso_confirm_privilege_id DESC
       LIMIT ?`,
      [limit]
    );
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  } finally {
    connection.release();
  }
};

export const submitNhsoClosePrivileges = async (options: {
  token: string;
  baseUrl: string;
  hospitalCode: string;
  recorderPid: string;
  sourceId: string;
  claimServiceCode: string;
  environment: 'prd' | 'uat';
  items: Array<{
    vn: string;
    cid: string;
    vstDateTime: string;
    mainInscl: string;
    income: number;
    rcptMoney: number;
    ucMoney: number;
    authencodeWeb?: string;
    pttypeName?: string;
    invno?: string;
  }>;
}) => {
  await ensureNhsoClosePrivilegeTable();
  const confirmStaff = await getDoctorCodeByCid(options.recorderPid);
  const connection = await getUTFConnection();
  const summary = {
    total: options.items.length,
    submitted: 0,
    skipped: 0,
    errors: 0,
    results: [] as Record<string, unknown>[],
  };

  try {
    for (const item of options.items) {
      const vn = normalizeImportCellValue(item.vn);
      const cid = normalizeImportCellValue(item.cid);
      const existingRows = await connection.query(
        `SELECT ncp.nhso_status, ncp.nhso_seq, COALESCE(ost.name, '') AS visit_outcome
         FROM ovst o
         LEFT JOIN ovstost ost ON ost.ovstost = o.ovstost
         LEFT JOIN nhso_confirm_privilege ncp ON ncp.vn = o.vn
         WHERE o.vn = ?
         LIMIT 1`,
        [vn]
      );
      const existingRow = Array.isArray(existingRows[0]) && existingRows[0].length > 0
        ? existingRows[0][0] as Record<string, unknown>
        : null;

      if (!cid || !isValidThaiCid(cid)) {
        summary.skipped += 1;
        summary.results.push({ vn, status: 'skipped', message: 'CID ไม่ถูกต้อง' });
        continue;
      }

      if (normalizeImportCellValue(existingRow?.visit_outcome) !== 'กลับบ้าน') {
        summary.skipped += 1;
        summary.results.push({ vn, status: 'skipped', message: 'สถานะคนไข้ยังไม่เป็นกลับบ้าน' });
        continue;
      }

      if (normalizeImportCellValue(existingRow?.nhso_status) === 'Y') {
        summary.skipped += 1;
        summary.results.push({
          vn,
          status: 'already_closed',
          message: 'รายการนี้ปิดสิทธิแล้ว',
          nhso_seq: normalizeImportCellValue(existingRow?.nhso_seq),
        });
        continue;
      }

      const requestPayload = {
        hcode: options.hospitalCode,
        visitNumber: vn,
        pid: cid,
        transactionId: `${options.hospitalCode}${vn}`,
        serviceDateTime: toUnixMillis(item.vstDateTime),
        invoiceDateTime: toUnixMillis(item.vstDateTime),
        mainInsclCode: normalizeImportCellValue(item.mainInscl) || 'UCS',
        totalAmount: Number(item.income || 0),
        paidAmount: Number(item.rcptMoney || 0),
        privilegeAmount: Number(item.ucMoney || 0),
        claimServiceCode: options.claimServiceCode,
        sourceId: options.sourceId,
        computerName: process.env.COMPUTERNAME || 'FDH-RECT',
        recorderPid: options.recorderPid,
      };

      try {
        const apiResult = await callNhsoClosePrivilegeApi(options.baseUrl, options.token, requestPayload);
        const seq = getCloseResponseValue(apiResult.parsedPayload, ['Seq', 'seq']);
        const authenCode = getCloseResponseValue(apiResult.parsedPayload, ['authenCode', 'AuthenCode', 'nhso_authen_code']);
        const sourceId = getCloseResponseValue(apiResult.parsedPayload, ['sourceID', 'sourceId']) || options.sourceId;
        const errorMessage = getCloseResponseError(apiResult.parsedPayload);
        const pttype = normalizeImportCellValue(item.pttypeName).split(':')[0] || null;
        const debtIdText = normalizeImportCellValue(item.invno).split(',')[0];
        const debtId = debtIdText ? Number(debtIdText) : null;
        const requestAt = new Date();

        await connection.query(
          `INSERT INTO nhso_confirm_privilege
             (vn, nhso_seq, nhso_authen_code, nhso_request_json, nhso_reponse_json, nhso_requst_datetime, nhso_response_datetime,
              confirm_staff, nhso_status, debt_id, nhso_total_amount, pttype, nhso_privilege_amount, nhso_cash_amount, testzone, sourceID)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             nhso_seq = VALUES(nhso_seq),
             nhso_authen_code = VALUES(nhso_authen_code),
             nhso_request_json = VALUES(nhso_request_json),
             nhso_reponse_json = VALUES(nhso_reponse_json),
             nhso_requst_datetime = VALUES(nhso_requst_datetime),
             nhso_response_datetime = VALUES(nhso_response_datetime),
             confirm_staff = VALUES(confirm_staff),
             nhso_status = VALUES(nhso_status),
             debt_id = VALUES(debt_id),
             nhso_total_amount = VALUES(nhso_total_amount),
             pttype = VALUES(pttype),
             nhso_privilege_amount = VALUES(nhso_privilege_amount),
             nhso_cash_amount = VALUES(nhso_cash_amount),
             testzone = VALUES(testzone),
             sourceID = VALUES(sourceID)`,
          [
            vn,
            seq || null,
            authenCode || null,
            apiResult.requestBody,
            typeof apiResult.parsedPayload === 'string' ? apiResult.parsedPayload : JSON.stringify(apiResult.parsedPayload ?? {}),
            requestAt,
            new Date(),
            confirmStaff || null,
            seq ? 'Y' : 'E',
            Number.isFinite(debtId) ? debtId : null,
            Number(item.income || 0),
            pttype || null,
            Number(item.ucMoney || 0),
            Number(item.rcptMoney || 0),
            options.environment === 'uat' ? 'Y' : null,
            sourceId || options.sourceId,
          ]
        );

        const isEpReturned = /^EP/i.test(authenCode || '');
        const isSuccess = !!seq || isEpReturned;

        if (isSuccess) {
          summary.submitted += 1;
          if (authenCode) {
            await connection.query(
              `UPDATE visit_pttype
               SET auth_code = IF(IFNULL(auth_code, '') = '', ?, auth_code)
               WHERE vn = ?`,
              [authenCode, vn]
            );
          }
          summary.results.push({
            vn,
            status: 'submitted',
            nhso_seq: seq || null,
            authen_code: authenCode,
            message: isEpReturned ? 'ปิดสิทธิสำเร็จ (EP)' : 'ปิดสิทธิสำเร็จ',
          });
        } else {
          summary.errors += 1;
          summary.results.push({
            vn,
            status: 'error',
            message: errorMessage || 'NHSO ไม่ตอบ Seq หรือ EP กลับมา',
          });
        }
      } catch (error) {
        summary.errors += 1;
        summary.results.push({
          vn,
          status: 'error',
          message: error instanceof Error ? error.message : 'ส่งข้อมูลปิดสิทธิไม่สำเร็จ',
        });
      }
    }

    return summary;
  } finally {
    connection.release();
  }
};

export interface MophDmhtQueryParams {
  startDate?: string;
  endDate?: string;
  diag?: 'ALL' | 'DM' | 'HT' | string;
  ucOnly?: boolean;
  authenOnly?: boolean;
  search?: string;
  limit?: number;
}

export interface MophVaccineQueryParams {
  startDate?: string;
  endDate?: string;
  types?: string[];
  ucOnly?: boolean;
  authenOnly?: boolean;
  errorFilter?: 'ALL' | 'NONE' | 'HAS' | 'ERROR' | 'WARN' | string;
  sendFilter?: 'ALL' | 'SENT' | 'UNSENT' | string;
  search?: string;
  limit?: number;
}

const buildDmhtLabResultSql = (
  visitAlias: string,
  adpCode: string,
  sysLabNames: string[],
  nameRegex: string,
) => {
  const sysNames = sysLabNames.map((name) => `'${name.replace(/'/g, "''")}'`).join(',');
  return `
    (SELECT lo.lab_order_result
       FROM lab_head lh
       JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
       LEFT JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
       LEFT JOIN nondrugitems ndi ON ndi.icode = li.icode
       LEFT JOIN sys_lab_link sll ON sll.lab_items_code = lo.lab_items_code
       LEFT JOIN sys_lab_code slc ON slc.sys_lab_code_id = sll.sys_lab_code_id
      WHERE lh.vn = ${visitAlias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND TRIM(lo.lab_order_result) <> ''
        AND (
          ndi.nhso_adp_code = '${adpCode}'
          OR LOWER(COALESCE(slc.sys_lab_name, '')) IN (${sysNames})
          OR UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${nameRegex}'
        )
      ORDER BY lh.order_date DESC, lh.order_time DESC
      LIMIT 1)
  `;
};

const buildDmhtAdpExistsSql = (visitAlias: string, adpCode: string) => `
  EXISTS (
    SELECT 1
    FROM opitemrece oo
    JOIN s_drugitems d ON d.icode = oo.icode
    WHERE oo.vn = ${visitAlias}.vn
      AND d.nhso_adp_code = '${adpCode}'
    LIMIT 1
  )
`;

export const getMophDmhtCandidates = async (params: MophDmhtQueryParams): Promise<Record<string, unknown>[]> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(params.startDate || today).slice(0, 10);
  const endDate = String(params.endDate || startDate).slice(0, 10);
  const diag = String(params.diag || 'ALL').toUpperCase();
  const limit = Math.min(20000, Math.max(1, Number(params.limit || 20000)));
  const search = String(params.search || '').trim();

  const hba1cResult = buildDmhtLabResultSql('o', '32401', ['hba1c'], 'HBA1C|HEMOGLOBIN A1C|GLYCATED');
  const potassiumResult = buildDmhtLabResultSql('o', '32103', ['potassium', 'potasssium'], 'POTASSIUM|(^|[^A-Z])K([^A-Z]|$)');
  const creatinineResult = buildDmhtLabResultSql('o', '32202', ['creatinine'], 'CREATININE|(^|[^A-Z])CR([^A-Z]|$)');
  const hba1cAdp = buildDmhtAdpExistsSql('o', '32401');
  const potassiumAdp = buildDmhtAdpExistsSql('o', '32103');
  const creatinineAdp = buildDmhtAdpExistsSql('o', '32202');

  const connection = await getUTFConnection();
  try {
    await connection.query(NHSO_CONFIRM_PRIVILEGE_TABLE_SQL);
    await connection.query(MOPHCLAIM_SEND_TABLE_SQL);
    const [rows] = await connection.query(
      `
      SELECT *
      FROM (
        SELECT
          o.vn, 'DM' AS diag, pt.cid, o.hn,
          CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
          pt.pname, pt.fname, pt.lname, pt.birthday AS dob,
          TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate) AS age,
          pt.sex, pt.marrystatus, LPAD(COALESCE(pt.nationality, ''), 3, '0') AS nation,
          COALESCE(oc.name, '') AS occupation,
          TIMESTAMP(o.vstdate, o.vsttime) AS visit_datetime,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
          COALESCE(
            (SELECT ncp.nhso_authen_code
             FROM nhso_confirm_privilege ncp
             WHERE ncp.vn = o.vn
               AND ncp.nhso_status = 'Y'
               AND IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
             LIMIT 1),
            (SELECT ah2.claim_code
             FROM authenhos ah2
             WHERE ah2.vn = o.vn
               AND IFNULL(ah2.claim_code, '') REGEXP '^EP'
             LIMIT 1),
            (SELECT vp2.auth_code
             FROM visit_pttype vp2
             WHERE vp2.vn = o.vn
               AND IFNULL(vp2.auth_code, '') REGEXP '^EP'
             LIMIT 1),
            (SELECT ah2.claim_code
             FROM authenhos ah2
             WHERE ah2.vn = o.vn
               AND IFNULL(ah2.claim_code, '') <> ''
             LIMIT 1),
            (SELECT vp2.auth_code
             FROM visit_pttype vp2
             WHERE vp2.vn = o.vn
               AND IFNULL(vp2.auth_code, '') <> ''
             LIMIT 1),
            ''
          ) AS authencode,
          COALESCE(ptt.hipdata_code, '') AS maininscl,
          COALESCE(ptt.name, '') AS pttypename,
          COALESCE(k.department, '') AS department,
          COALESCE(sp.name, '') AS clinic,
          COALESCE(vp.hospmain, '') AS hospmain,
          COALESCE(vp.hospsub, '') AS hospsub,
          CASE WHEN ${hba1cAdp} THEN 'Y' ELSE '' END AS check_hba1c_adp,
          ${hba1cResult} AS result_hba1c,
          '' AS check_potassium_adp, NULL AS result_potassium,
          '' AS check_creatinine_adp, NULL AS result_creatinine,
          COALESCE(ms.flag, '') AS moph,
          COALESCE(ms.transaction_uid, '') AS transaction_uid,
          COALESCE(ms.note, '') AS note,
          ms.senddate
        FROM ovst o
        JOIN patient pt ON pt.hn = o.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN occupation oc ON oc.occupation = pt.occupation
        LEFT JOIN visit_pttype vp ON vp.vn = o.vn
        LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN mophclaim_send ms ON ms.vn = o.vn AND ms.type = 'DM'
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND ${buildDiagnosisMatchSql('o', 'v', ['E10', 'E11', 'E12', 'E13', 'E14'])}
          AND (${hba1cAdp} OR ${hba1cResult} IS NOT NULL)
        GROUP BY o.vn

        UNION ALL

        SELECT
          o.vn, 'HT' AS diag, pt.cid, o.hn,
          CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
          pt.pname, pt.fname, pt.lname, pt.birthday AS dob,
          TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate) AS age,
          pt.sex, pt.marrystatus, LPAD(COALESCE(pt.nationality, ''), 3, '0') AS nation,
          COALESCE(oc.name, '') AS occupation,
          TIMESTAMP(o.vstdate, o.vsttime) AS visit_datetime,
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
          COALESCE(
            (SELECT ncp.nhso_authen_code
             FROM nhso_confirm_privilege ncp
             WHERE ncp.vn = o.vn
               AND ncp.nhso_status = 'Y'
               AND IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
             LIMIT 1),
            (SELECT ah2.claim_code
             FROM authenhos ah2
             WHERE ah2.vn = o.vn
               AND IFNULL(ah2.claim_code, '') REGEXP '^EP'
             LIMIT 1),
            (SELECT vp2.auth_code
             FROM visit_pttype vp2
             WHERE vp2.vn = o.vn
               AND IFNULL(vp2.auth_code, '') REGEXP '^EP'
             LIMIT 1),
            (SELECT ah2.claim_code
             FROM authenhos ah2
             WHERE ah2.vn = o.vn
               AND IFNULL(ah2.claim_code, '') <> ''
             LIMIT 1),
            (SELECT vp2.auth_code
             FROM visit_pttype vp2
             WHERE vp2.vn = o.vn
               AND IFNULL(vp2.auth_code, '') <> ''
             LIMIT 1),
            ''
          ) AS authencode,
          COALESCE(ptt.hipdata_code, '') AS maininscl,
          COALESCE(ptt.name, '') AS pttypename,
          COALESCE(k.department, '') AS department,
          COALESCE(sp.name, '') AS clinic,
          COALESCE(vp.hospmain, '') AS hospmain,
          COALESCE(vp.hospsub, '') AS hospsub,
          '' AS check_hba1c_adp, NULL AS result_hba1c,
          CASE WHEN ${potassiumAdp} THEN 'Y' ELSE '' END AS check_potassium_adp,
          ${potassiumResult} AS result_potassium,
          CASE WHEN ${creatinineAdp} THEN 'Y' ELSE '' END AS check_creatinine_adp,
          ${creatinineResult} AS result_creatinine,
          COALESCE(ms.flag, '') AS moph,
          COALESCE(ms.transaction_uid, '') AS transaction_uid,
          COALESCE(ms.note, '') AS note,
          ms.senddate
        FROM ovst o
        JOIN patient pt ON pt.hn = o.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN occupation oc ON oc.occupation = pt.occupation
        LEFT JOIN visit_pttype vp ON vp.vn = o.vn
        LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN mophclaim_send ms ON ms.vn = o.vn AND ms.type = 'HT'
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND ${buildDiagnosisMatchSql('o', 'v', ['I10', 'I11', 'I12', 'I13', 'I14', 'I15'])}
          AND (${potassiumAdp} OR ${creatinineAdp} OR ${potassiumResult} IS NOT NULL OR ${creatinineResult} IS NOT NULL)
        GROUP BY o.vn
      ) t
      WHERE (? = 'ALL' OR t.diag = ?)
        AND (? = 0 OR t.maininscl = 'UCS')
        AND (? = 0 OR TRIM(t.authencode) <> '')
        AND (
          ? = ''
          OR t.vn LIKE CONCAT('%', ?, '%')
          OR t.hn LIKE CONCAT('%', ?, '%')
          OR t.cid LIKE CONCAT('%', ?, '%')
          OR t.patient_name LIKE CONCAT('%', ?, '%')
        )
      ORDER BY t.service_date DESC, t.vn DESC, t.diag
      LIMIT ${limit}
      `,
      [
        startDate,
        endDate,
        startDate,
        endDate,
        diag,
        diag,
        params.ucOnly ? 1 : 0,
        params.authenOnly ? 1 : 0,
        search,
        search,
        search,
        search,
        search,
      ],
    );

    return (Array.isArray(rows) ? rows : []).map((row) => {
      const item = row as Record<string, unknown>;
      const type = String(item.diag || '').toUpperCase();
      const resultHba1c = String(item.result_hba1c || '').trim();
      const resultK = String(item.result_potassium || '').trim();
      const resultCr = String(item.result_creatinine || '').trim();
      const checkHba1c = resultHba1c ? 'Y' : '';
      const checkPotassium = resultK ? 'Y' : '';
      const checkCreatinine = resultCr ? 'Y' : '';
      const ready = type === 'DM' ? checkHba1c === 'Y' : (checkPotassium === 'Y' || checkCreatinine === 'Y');
      return {
        ...item,
        check_hba1c: checkHba1c,
        check_potassium: checkPotassium,
        check_creatinine: checkCreatinine,
        ready,
        missing_reason: ready ? '' : (type === 'DM' ? 'ไม่พบผล HbA1C' : 'ไม่พบผล Potassium/Creatinine'),
      };
    });
  } finally {
    connection.release();
  }
};

const MOPH_VACCINE_DT_REGEX = '^(106)$';
const MOPH_VACCINE_HPV_REGEX = '^(HPV|310|311|320)';
const MOPH_VACCINE_AP_REGEX = '^(P41)$';
const MOPH_VACCINE_EPI_PATTERN = '010|041|042|043|091|092|093|021|022|023|081|082|083|401|061|073|J11|J12|031|032|033|034|035|084|085|011|024|072|075|086|087|088|402|054|055|044|045|046|051|052|053|R11|R12|R21|R22|R23|D21|D22|D23|I11|I12|I13';
const MOPH_VACCINE_ALL_REGEX = '^(106|010|041|042|043|091|092|093|021|022|023|081|082|083|401|061|073|J11|J12|031|032|033|034|035|084|085|011|024|072|075|086|087|088|402|054|055|044|045|046|310|311|320|051|052|053|R11|R12|R21|R22|R23|D21|D22|D23|I11|I12|I13|HPV|P41)';

const mophCloseCodeSql = (visitAlias: string) => `
  COALESCE(
    (SELECT ncp.nhso_authen_code
     FROM nhso_confirm_privilege ncp
     WHERE ncp.vn = ${visitAlias}.vn
       AND ncp.nhso_status = 'Y'
       AND IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
     LIMIT 1),
    (SELECT ah2.claim_code
     FROM authenhos ah2
     WHERE ah2.vn = ${visitAlias}.vn
       AND IFNULL(ah2.claim_code, '') REGEXP '^EP'
     LIMIT 1),
    (SELECT vp2.auth_code
     FROM visit_pttype vp2
     WHERE vp2.vn = ${visitAlias}.vn
       AND IFNULL(vp2.auth_code, '') REGEXP '^EP'
     LIMIT 1),
    (SELECT ah2.claim_code
     FROM authenhos ah2
     WHERE ah2.vn = ${visitAlias}.vn
       AND IFNULL(ah2.claim_code, '') <> ''
     LIMIT 1),
    (SELECT vp2.auth_code
     FROM visit_pttype vp2
     WHERE vp2.vn = ${visitAlias}.vn
       AND IFNULL(vp2.auth_code, '') <> ''
     LIMIT 1),
    ''
  )
`;

const mophVaccineTypeSql = (codeExpression: string) => `
  CASE
    WHEN ${codeExpression} REGEXP '${MOPH_VACCINE_DT_REGEX}' THEN 'dT'
    WHEN ${codeExpression} REGEXP '${MOPH_VACCINE_HPV_REGEX}' THEN 'HPV'
    WHEN ${codeExpression} REGEXP '${MOPH_VACCINE_AP_REGEX}' THEN 'aP'
    ELSE 'EPI'
  END
`;

export const getMophVaccineCandidates = async (params: MophVaccineQueryParams): Promise<Record<string, unknown>[]> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(params.startDate || today).slice(0, 10);
  const endDate = String(params.endDate || startDate).slice(0, 10);
  const limit = Math.min(20000, Math.max(1, Number(params.limit || 20000)));
  const search = String(params.search || '').trim();
  const selectedTypes = (params.types && params.types.length > 0 ? params.types : ['EPI', 'dT'])
    .map((type) => String(type || '').trim())
    .filter((type) => ['EPI', 'dT', 'HPV', 'aP'].includes(type));
  const typeSet = selectedTypes.length > 0 ? selectedTypes : [''];
  const selectedVaccinePattern = selectedTypes
    .map((type) => {
      if (type === 'EPI') return MOPH_VACCINE_EPI_PATTERN;
      if (type === 'dT') return '106';
      if (type === 'HPV') return 'HPV|310|311|320';
      if (type === 'aP') return 'P41';
      return '';
    })
    .filter(Boolean)
    .join('|') || MOPH_VACCINE_ALL_REGEX.replace(/^\^\(/, '').replace(/\)$/, '');
  const selectedVaccineRegex = `^(${selectedVaccinePattern})`;
  const typePlaceholders = typeSet.map(() => '?').join(',');
  const errorFilter = String(params.errorFilter || 'ALL').toUpperCase();
  const sendFilter = String(params.sendFilter || 'ALL').toUpperCase();
  const connection = await getUTFConnection();

  const insertSource = async (sql: string, values: unknown[]) => {
    await connection.query(sql, values);
  };

  try {
    await connection.query(NHSO_CONFIRM_PRIVILEGE_TABLE_SQL);
    await connection.query(MOPHCLAIM_SEND_TABLE_SQL);
    await connection.query(`
      CREATE TEMPORARY TABLE IF NOT EXISTS tmp_moph_vaccine (
        source_type VARCHAR(10) NOT NULL,
        vn VARCHAR(25) NOT NULL,
        hn VARCHAR(25) NULL,
        vstdate DATE NULL,
        vsttime VARCHAR(8) NULL,
        vaccine_code VARCHAR(20) NOT NULL,
        vaccine_name VARCHAR(255) NULL,
        lot VARCHAR(100) NULL,
        dose DECIMAL(8,2) NULL,
        company VARCHAR(150) NULL,
        dateexp DATE NULL,
        dateinj DATETIME NULL,
        site VARCHAR(20) NULL,
        drugusage VARCHAR(20) NULL,
        doctorlicense VARCHAR(50) NULL,
        doctorname VARCHAR(150) NULL,
        note VARCHAR(255) NULL,
        preg_no DECIMAL(3,0) NULL,
        ga DECIMAL(3,0) NULL,
        PRIMARY KEY (vn, vaccine_code)
      ) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4
    `);
    await connection.query('DELETE FROM tmp_moph_vaccine');

    await insertSource(
      `
      INSERT IGNORE INTO tmp_moph_vaccine
      SELECT 'Person', o.vn, o.hn, o.vstdate, TIME_FORMAT(o.vsttime, '%H:%i:%s'),
        v.export_vaccine_code, v.vaccine_name,
        s.vaccine_lot_no,
        CASE
          WHEN COALESCE(s.dose_qty, 0) > 0 THEN s.dose_qty
          WHEN v.export_vaccine_code = '010' THEN 0.1
          WHEN v.export_vaccine_code REGEXP '^R' THEN 1.5
          ELSE 0.5
        END,
        '', s.expire_date, NULL, 'LA', 'IM',
        doc.licenseno, doc.name, '',
        CASE WHEN v.export_vaccine_code = 'P41' THEN a.preg_no ELSE NULL END,
        CASE WHEN v.export_vaccine_code = 'P41' THEN TIMESTAMPDIFF(WEEK, a.lmp, o.vstdate) ELSE NULL END
      FROM ovst o
      STRAIGHT_JOIN ovst_vaccine s ON s.vn = o.vn
      STRAIGHT_JOIN person_vaccine v ON v.person_vaccine_id = s.person_vaccine_id
      LEFT JOIN doctor doc ON doc.code = s.doctor_code
      LEFT JOIN person_anc_service pas ON pas.vn = o.vn
      LEFT JOIN person_anc a ON a.person_anc_id = pas.person_anc_id
      WHERE o.vstdate BETWEEN ? AND ?
        AND v.export_vaccine_code REGEXP ?
      `,
      [startDate, endDate, selectedVaccineRegex]
    );

    await insertSource(
      `
      INSERT IGNORE INTO tmp_moph_vaccine
      SELECT 'WBC', o.vn, o.hn, o.vstdate, TIME_FORMAT(o.vsttime, '%H:%i:%s'),
        v.export_vaccine_code, v.wbc_vaccine_name,
        dd.vaccine_lotno,
        CASE WHEN v.export_vaccine_code = '010' THEN 0.1 WHEN v.export_vaccine_code REGEXP '^R' THEN 1.5 ELSE 0.5 END,
        '', dd.vaccine_expire_date, NULL, 'LA', 'IM',
        doc.licenseno, doc.name, '', NULL, NULL
      FROM ovst o
      STRAIGHT_JOIN person_wbc_service s ON s.vn = o.vn
      STRAIGHT_JOIN person_wbc_vaccine_detail dd ON dd.person_wbc_service_id = s.person_wbc_service_id
      STRAIGHT_JOIN wbc_vaccine v ON v.wbc_vaccine_id = dd.wbc_vaccine_id
      LEFT JOIN doctor doc ON doc.code = dd.doctor_code
      WHERE o.vstdate BETWEEN ? AND ?
        AND v.export_vaccine_code REGEXP ?
      `,
      [startDate, endDate, selectedVaccineRegex]
    );

    await insertSource(
      `
      INSERT IGNORE INTO tmp_moph_vaccine
      SELECT 'EPI', o.vn, o.hn, o.vstdate, TIME_FORMAT(o.vsttime, '%H:%i:%s'),
        v.export_vaccine_code, v.epi_vaccine_name,
        dd.vaccine_lotno,
        CASE WHEN v.export_vaccine_code = '010' THEN 0.1 WHEN v.export_vaccine_code REGEXP '^R' THEN 1.5 ELSE 0.5 END,
        '', dd.vaccine_expire_date, NULL, 'LA', 'IM',
        doc.licenseno, doc.name, '', NULL, NULL
      FROM ovst o
      STRAIGHT_JOIN person_epi_vaccine s ON s.vn = o.vn
      STRAIGHT_JOIN person_epi_vaccine_list dd ON dd.person_epi_vaccine_id = s.person_epi_vaccine_id
      STRAIGHT_JOIN epi_vaccine v ON v.epi_vaccine_id = dd.epi_vaccine_id
      LEFT JOIN doctor doc ON doc.code = dd.doctor_code
      WHERE o.vstdate BETWEEN ? AND ?
        AND v.export_vaccine_code REGEXP ?
      `,
      [startDate, endDate, selectedVaccineRegex]
    );

    await insertSource(
      `
      INSERT IGNORE INTO tmp_moph_vaccine
      SELECT 'Student', o.vn, o.hn, o.vstdate, TIME_FORMAT(o.vsttime, '%H:%i:%s'),
        v.export_vaccine_code, v.student_vaccine_name,
        dd.vaccine_lotno,
        CASE WHEN v.export_vaccine_code = '010' THEN 0.1 WHEN v.export_vaccine_code REGEXP '^R' THEN 1.5 ELSE 0.5 END,
        '', dd.vaccine_expire_date, NULL, 'LA', 'IM',
        doc.licenseno, doc.name, '', NULL, NULL
      FROM ovst o
      STRAIGHT_JOIN village_student_vaccine s ON s.vn = o.vn
      STRAIGHT_JOIN village_student_vaccine_list dd ON dd.village_student_vaccine_id = s.village_student_vaccine_id
      STRAIGHT_JOIN student_vaccine v ON v.student_vaccine_id = dd.student_vaccine_id
      LEFT JOIN doctor doc ON doc.code = dd.doctor_code
      WHERE o.vstdate BETWEEN ? AND ?
        AND v.export_vaccine_code REGEXP ?
      `,
      [startDate, endDate, selectedVaccineRegex]
    );

    await insertSource(
      `
      INSERT IGNORE INTO tmp_moph_vaccine
      SELECT 'ANC', o.vn, o.hn, o.vstdate, TIME_FORMAT(o.vsttime, '%H:%i:%s'),
        v.export_vaccine_code, v.anc_service_name,
        dd.vaccine_lotno,
        CASE WHEN v.export_vaccine_code = '010' THEN 0.1 WHEN v.export_vaccine_code REGEXP '^R' THEN 1.5 ELSE 0.5 END,
        '', dd.vaccine_expire_date, NULL, 'LA', 'IM',
        doc.licenseno, doc.name, '',
        a.preg_no, s.pa_week
      FROM ovst o
      STRAIGHT_JOIN person_anc_service s ON s.vn = o.vn
      STRAIGHT_JOIN person_anc_service_detail dd ON dd.person_anc_service_id = s.person_anc_service_id
      STRAIGHT_JOIN anc_service v ON v.anc_service_id = dd.anc_service_id
      LEFT JOIN person_anc a ON a.person_anc_id = s.person_anc_id
      LEFT JOIN doctor doc ON doc.code = dd.anc_doctor_code
      WHERE o.vstdate BETWEEN ? AND ?
        AND v.export_vaccine_code REGEXP ?
      `,
      [startDate, endDate, selectedVaccineRegex]
    );

    await connection.query(`
      CREATE TEMPORARY TABLE IF NOT EXISTS tmp_moph_vaccine_auth (
        vn VARCHAR(25) NOT NULL,
        authencode VARCHAR(100) NOT NULL,
        hospmain VARCHAR(10) NULL,
        hospsub VARCHAR(10) NULL,
        PRIMARY KEY (vn)
      ) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4
    `);
    await connection.query('DELETE FROM tmp_moph_vaccine_auth');
    await connection.query(`
      INSERT IGNORE INTO tmp_moph_vaccine_auth
      SELECT DISTINCT vn, '', '', ''
      FROM tmp_moph_vaccine
    `);
    await connection.query(`
      UPDATE tmp_moph_vaccine_auth a
      JOIN (
        SELECT v.vn, MAX(ncp.nhso_authen_code) AS authencode
        FROM tmp_moph_vaccine_auth v
        JOIN nhso_confirm_privilege ncp ON ncp.vn = v.vn
        WHERE ncp.nhso_status = 'Y'
          AND IFNULL(ncp.nhso_authen_code, '') REGEXP '^EP'
        GROUP BY v.vn
      ) x ON x.vn = a.vn
      SET a.authencode = x.authencode
      WHERE a.authencode = ''
    `);
    await connection.query(`
      UPDATE tmp_moph_vaccine_auth a
      JOIN (
        SELECT v.vn,
          MAX(CASE WHEN IFNULL(ah.claim_code, '') REGEXP '^EP' THEN ah.claim_code END) AS ep_code,
          MAX(CASE WHEN IFNULL(ah.claim_code, '') <> '' THEN ah.claim_code END) AS any_code
        FROM tmp_moph_vaccine_auth v
        JOIN authenhos ah ON ah.vn = v.vn
        GROUP BY v.vn
      ) x ON x.vn = a.vn
      SET a.authencode = COALESCE(x.ep_code, x.any_code, '')
      WHERE a.authencode = ''
    `);
    await connection.query(`
      UPDATE tmp_moph_vaccine_auth a
      JOIN (
        SELECT v.vn,
          MAX(CASE WHEN IFNULL(vp.auth_code, '') REGEXP '^EP' THEN vp.auth_code END) AS ep_code,
          MAX(CASE WHEN IFNULL(vp.auth_code, '') <> '' THEN vp.auth_code END) AS any_code,
          MAX(vp.hospmain) AS hospmain,
          MAX(vp.hospsub) AS hospsub
        FROM tmp_moph_vaccine_auth v
        JOIN visit_pttype vp ON vp.vn = v.vn
        GROUP BY v.vn
      ) x ON x.vn = a.vn
      SET a.authencode = IF(a.authencode = '', COALESCE(x.ep_code, x.any_code, ''), a.authencode),
          a.hospmain = x.hospmain,
          a.hospsub = x.hospsub
    `);

    const rawConditions = [`${mophVaccineTypeSql('te.vaccine_code')} IN (${typePlaceholders})`];
    const rawValues: Array<string | number> = [...typeSet];
    if (params.authenOnly) rawConditions.push(`TRIM(COALESCE(auth.authencode, '')) <> ''`);
    if (sendFilter === 'SENT') rawConditions.push(`TRIM(COALESCE(ms.flag, '')) <> ''`);
    if (sendFilter === 'UNSENT') rawConditions.push(`TRIM(COALESCE(ms.flag, '')) = ''`);
    if (search) {
      rawConditions.push(`(te.vn LIKE CONCAT('%', ?, '%') OR te.hn LIKE CONCAT('%', ?, '%') OR te.vaccine_code LIKE CONCAT('%', ?, '%'))`);
      rawValues.push(search, search, search);
    }

    const [rawRows] = await connection.query(
      `
      SELECT te.source_type, te.vn, te.hn, DATE_FORMAT(te.vstdate, '%Y-%m-%d') AS service_date,
        DATE_FORMAT(TIMESTAMP(te.vstdate, te.vsttime), '%Y-%m-%d %H:%i') AS visit_datetime,
        te.vaccine_code, te.vaccine_name, te.lot, te.dose, te.company,
        DATE_FORMAT(te.dateexp, '%Y-%m-%d') AS dateexp,
        te.site, te.drugusage, te.doctorlicense, te.doctorname, te.note AS source_note,
        te.preg_no, te.ga,
        COALESCE(auth.authencode, '') AS authencode,
        COALESCE(auth.hospmain, '') AS hospmain,
        COALESCE(auth.hospsub, '') AS hospsub,
        COALESCE(ms.flag, '') AS moph,
        COALESCE(ms.transaction_uid, '') AS transaction_uid,
        COALESCE(ms.note, '') AS note,
        ms.senddate,
        CONCAT_WS('#', te.vaccine_code, COALESCE(te.lot, ''),
          IF(COALESCE(te.dose, 0) = 0, '', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(te.dose AS CHAR)))),
          COALESCE(te.company, ''), COALESCE(DATE_FORMAT(te.dateexp, '%Y-%m-%d'), ''),
          DATE_FORMAT(TIMESTAMP(te.vstdate, te.vsttime), '%Y-%m-%d %H:%i'),
          COALESCE(te.site, ''), COALESCE(te.drugusage, ''), COALESCE(te.doctorlicense, ''), COALESCE(te.doctorname, ''), COALESCE(te.note, '')
        ) AS vaccine_note
      FROM tmp_moph_vaccine te
      LEFT JOIN tmp_moph_vaccine_auth auth ON auth.vn = te.vn
      LEFT JOIN mophclaim_send ms ON ms.vn = te.vn AND ms.type = te.vaccine_code
      WHERE ${rawConditions.join(' AND ')}
      ORDER BY te.vstdate DESC, te.vn DESC, te.vaccine_code
      LIMIT ${limit}
      `,
      rawValues
    );
    const rawItems = Array.isArray(rawRows) ? rawRows as Record<string, unknown>[] : [];
    const vns = [...new Set(rawItems.map((row) => String(row.vn || '')).filter(Boolean))];
    const detailByVn = new Map<string, Record<string, unknown>>();
    if (vns.length > 0) {
      const [detailRows] = await connection.query(
        `
        SELECT o.vn, pt.cid, o.hn, pt.pname, pt.fname, pt.lname,
          CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
          DATE_FORMAT(pt.birthday, '%Y-%m-%d') AS dob,
          TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate) AS age_y,
          pt.sex, pt.marrystatus, LPAD(COALESCE(pt.nationality, ''), 3, '0') AS nation,
          COALESCE(oc.name, '') AS occupation,
          COALESCE(ptt.hipdata_code, '') AS maininscl,
          COALESCE(ptt.name, '') AS pttypename
        FROM ovst o
        LEFT JOIN patient pt ON pt.hn = o.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN occupation oc ON oc.occupation = pt.occupation
        WHERE o.vn IN (${vns.map(() => '?').join(',')})
        `,
        vns
      );
      for (const row of (Array.isArray(detailRows) ? detailRows as Record<string, unknown>[] : [])) {
        detailByVn.set(String(row.vn || ''), row);
      }
    }
    const classify = (codeValue: unknown) => {
      const code = String(codeValue || '');
      if (/^106$/.test(code)) return 'dT';
      if (/^(HPV|310|311|320)/.test(code)) return 'HPV';
      if (/^P41$/.test(code)) return 'aP';
      return 'EPI';
    };
    const finalRows: Record<string, unknown>[] = rawItems.map((row): Record<string, unknown> => {
      const detail = detailByVn.get(String(row.vn || '')) || {};
      const merged = { ...row, ...detail };
      const type = classify(merged.vaccine_code);
      const ageY = Number(merged.age_y || 0);
      const serviceDate = String(merged.service_date || '');
      const dateexp = String(merged.dateexp || '');
      const code = String(merged.vaccine_code || '');
      const lot = String(merged.lot || '');
      const dose = Number(merged.dose || 0);
      const authencode = String(merged.authencode || '');
      const apEligibilityError = validateApVaccineEligibility({
        vaccineCode: code,
        serviceDate,
        pregNo: merged.preg_no,
        ga: merged.ga,
      });
      const apRule = code === 'P41' ? getApVaccineRule(serviceDate) : null;
      let errorname = '';
      if (!lot) errorname = 'Error:ไม่พบ Lot No.';
      else if (!dose) errorname = 'Error:ไม่พบ Dose';
      else if (!dateexp || dateexp < serviceDate) errorname = 'Error:วันหมดอายุต้องมากกว่าวันที่บริการ';
      else if (code === 'I12' && serviceDate < '2023-07-01') errorname = 'Error:รหัส I12 ต้องเริ่มให้ตั้งแต่ 1 กรกฎาคม 2566';
      else if (code === '401' && serviceDate >= '2023-07-01') errorname = 'Error:รหัส 401 ต้องให้ก่อน 1 กรกฎาคม 2566';
      else if (['310', '311', '320'].includes(code)) errorname = 'Error:วัคซีน HPV ต้องใช้ตาม QuickWin เท่านั้น';
      else if (/^HPV/.test(code) && serviceDate < '2023-11-01') errorname = 'Warn:รหัส HPVxxx ต้องเริ่มให้ตั้งแต่ 1 พฤศจิกายน 2566';
      else if (/^HPV/.test(code) && (ageY < 11 || ageY > 20)) errorname = 'Warn:รหัส HPVxxx ไม่อยู่กลุ่มอายุ 11-20 ปี';
      else if (apEligibilityError) errorname = apEligibilityError;
      else if (!authencode) errorname = 'Warn:ไม่พบรหัส AuthenCode';
      return {
        ...merged,
        epi: merged.source_type,
        type,
        errorname,
        ready: errorname === '',
        missing_reason: errorname,
        ap_rule_label: apRule?.label || '',
        ap_rule_effective_date: apRule?.effectiveDate || '',
      };
    }).filter((row) => {
      const type = String(row.type || '');
      const ageY = Number(row.age_y || 0);
      const sex = String(row.sex || '');
      if (!(type === 'EPI' || type === 'aP' || (type === 'dT' && (ageY >= 24 || row.epi === 'ANC')) || (type === 'HPV' && sex === '2'))) return false;
      if (params.ucOnly && row.maininscl !== 'UCS') return false;
      if (search) {
        const haystack = `${row.vn || ''} ${row.hn || ''} ${row.cid || ''} ${row.patient_name || ''} ${row.vaccine_code || ''}`;
        if (!haystack.includes(search)) return false;
      }
      const errorName = String(row.errorname || '');
      if (errorFilter === 'NONE') return errorName === '';
      if (errorFilter === 'HAS') return errorName !== '';
      if (errorFilter === 'ERROR') return errorName.startsWith('Error');
      if (errorFilter === 'WARN') return errorName.startsWith('Warn');
      return true;
    });
    return finalRows.slice(0, limit);
  } finally {
    connection.release();
  }
};

export const getMophClaimDashboardSummary = async (options: {
  startDate?: string;
  endDate?: string;
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(options.startDate || today).slice(0, 10);
  const endDate = String(options.endDate || startDate).slice(0, 10);
  const connection = await getUTFConnection();

  try {
    await connection.query(MOPHCLAIM_SEND_TABLE_SQL);
    const [summaryRows] = await connection.query(
      `
      SELECT
        SUM(CASE WHEN ms.type IN ('DM', 'HT') THEN 1 ELSE 0 END) AS dmht_total,
        SUM(CASE WHEN ms.type = 'DM' THEN 1 ELSE 0 END) AS dm_total,
        SUM(CASE WHEN ms.type = 'HT' THEN 1 ELSE 0 END) AS ht_total,
        SUM(CASE WHEN ms.type IN ('DM', 'HT') AND COALESCE(ms.flag, '') = 'Y' THEN 1 ELSE 0 END) AS dmht_sent,
        SUM(CASE WHEN ms.type IN ('DM', 'HT') AND COALESCE(ms.flag, '') = 'C' THEN 1 ELSE 0 END) AS dmht_closed,
        SUM(CASE WHEN ms.type NOT IN ('DM', 'HT') THEN 1 ELSE 0 END) AS vaccine_total,
        SUM(CASE WHEN ms.type NOT IN ('DM', 'HT') AND COALESCE(ms.flag, '') = 'Y' THEN 1 ELSE 0 END) AS vaccine_sent,
        SUM(CASE WHEN ms.type NOT IN ('DM', 'HT') AND COALESCE(ms.flag, '') = 'C' THEN 1 ELSE 0 END) AS vaccine_closed,
        DATE_FORMAT(MAX(ms.senddate), '%Y-%m-%d') AS latest_senddate
      FROM mophclaim_send ms
      JOIN ovst o ON o.vn = ms.vn
      WHERE o.vstdate BETWEEN ? AND ?
      `,
      [startDate, endDate]
    );

    const [typeRows] = await connection.query(
      `
      SELECT
        ms.type,
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(ms.flag, '') = 'Y' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN COALESCE(ms.flag, '') = 'C' THEN 1 ELSE 0 END) AS closed,
        DATE_FORMAT(MAX(ms.senddate), '%Y-%m-%d') AS latest_senddate
      FROM mophclaim_send ms
      JOIN ovst o ON o.vn = ms.vn
      WHERE o.vstdate BETWEEN ? AND ?
      GROUP BY ms.type
      ORDER BY total DESC, ms.type
      LIMIT 12
      `,
      [startDate, endDate]
    );

    const summary = (Array.isArray(summaryRows) && summaryRows[0] ? summaryRows[0] : {}) as Record<string, unknown>;
    const numberValue = (key: string) => Number(summary[key] || 0);

    return {
      startDate,
      endDate,
      dmht: {
        total: numberValue('dmht_total'),
        dm: numberValue('dm_total'),
        ht: numberValue('ht_total'),
        sent: numberValue('dmht_sent'),
        closed: numberValue('dmht_closed'),
      },
      vaccine: {
        total: numberValue('vaccine_total'),
        sent: numberValue('vaccine_sent'),
        closed: numberValue('vaccine_closed'),
      },
      total: {
        recorded: numberValue('dmht_total') + numberValue('vaccine_total'),
        sent: numberValue('dmht_sent') + numberValue('vaccine_sent'),
        closed: numberValue('dmht_closed') + numberValue('vaccine_closed'),
      },
      latestSendDate: summary.latest_senddate || null,
      byType: Array.isArray(typeRows) ? typeRows : [],
    };
  } finally {
    connection.release();
  }
};

const getNhsoAuthenCandidates = async (startDate: string, endDate: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT o.vn, pt.cid, o.hn, o.vstdate, o.vsttime,
              TIMESTAMP(o.vstdate, o.vsttime) AS service_datetime,
              (
                SELECT COUNT(*)
                FROM ovst oo
                WHERE oo.hn = o.hn AND oo.vstdate = o.vstdate AND oo.vn <= o.vn
              ) AS visit_order,
              (
                SELECT COUNT(*)
                FROM ovst oo
                WHERE oo.hn = o.hn AND oo.vstdate = o.vstdate
              ) AS per_day
       FROM ovst o
       LEFT JOIN patient pt ON pt.hn = o.hn
       LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
       LEFT JOIN authenhos ah ON ah.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ?
         AND IFNULL(vp.auth_code, '') = ''
         AND IFNULL(ah.claim_code, '') = ''
         AND NOT EXISTS (
            SELECT 1
            FROM ${repstmDatabaseName}.authen_sync_cancel ac
            WHERE ac.vn = o.vn
         )
       ORDER BY o.vstdate DESC, o.vn DESC`,
      [startDate, endDate]
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } finally {
    connection.release();
  }
};

const callNhsoAuthenApi = async (baseUrl: string, token: string, cid: string, serviceDate: string) => {
  const requestUrl = `${baseUrl.replace(/\/+$/, '')}/authencodestatus/api/check-authen-status?personalId=${encodeURIComponent(cid)}&serviceDate=${encodeURIComponent(serviceDate)}`;
  const headerOptions: Array<Record<string, string>> = [
    { Authorization: `Bearer ${token}` },
    { token },
    { apikey: token },
    { Authorization: token },
  ];

  let lastPayload: unknown = null;
  for (const headers of headerOptions) {
    const response = await fetchWithTimeout(requestUrl, { method: 'GET', headers });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    lastPayload = payload;
    if (response.ok && typeof payload === 'object' && payload) {
      const data = payload as Record<string, unknown>;
      if ('statusAuthen' in data || 'serviceHistories' in data || 'errors' in data) {
        return { requestUrl, payload };
      }
    }
  }

  return { requestUrl, payload: lastPayload };
};

const upsertAuthenForVisit = async (entry: {
  vn: string;
  cid: string;
  claimCode: string;
  authenType: string;
  authenDateTime: string;
}) => {
  const connection = await getUTFConnection();
  try {
    await connection.query(
      `UPDATE visit_pttype
       SET auth_code = ?, pttype_note = ?, Auth_DateTime = ?
       WHERE vn = ?`,
      [entry.claimCode, entry.authenType, entry.authenDateTime, entry.vn]
    );
    await connection.query(`DELETE FROM authenhos WHERE vn = ?`, [entry.vn]);
    await connection.query(
      `INSERT INTO authenhos
       (pid, claim_type, claim_type_name, created_date, created_time, claim_code, vn)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.cid,
        entry.authenType,
        entry.authenType,
        entry.authenDateTime.slice(0, 10),
        entry.authenDateTime.slice(11, 19),
        entry.claimCode,
        entry.vn,
      ]
    );
  } finally {
    connection.release();
  }
};

export const syncNhsoAuthenCodes = async (options: {
  token: string;
  baseUrl: string;
  hospitalCode: string;
  startDate: string;
  endDate: string;
  maxDays?: number;
}) => {
  const start = new Date(options.startDate);
  const end = new Date(options.endDate);
  const dayDiff = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (Number.isNaN(dayDiff) || dayDiff < 0) {
    throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  }
  if (dayDiff > (options.maxDays ?? 4)) {
    throw new Error(`ช่วงวันที่มากเกินไป ระบบนี้รองรับไม่เกิน ${options.maxDays ?? 4} วัน`);
  }

  const candidates = await getNhsoAuthenCandidates(options.startDate, options.endDate);
  const summary = {
    total: candidates.length,
    updated: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0,
  };

  for (const row of candidates) {
    const vn = normalizeImportCellValue(row.vn);
    const cid = normalizeImportCellValue(row.cid);
    const hn = normalizeImportCellValue(row.hn);
    const vstdate = formatDateOnly(row.vstdate);
    const visitOrder = Number(row.visit_order || 0);

    if (!cid || !isValidThaiCid(cid)) {
      summary.skipped += 1;
      await saveAuthenSyncCancel({ vn, cid, vstdate, reason: 'INVALIDPID' });
      await saveAuthenSyncLog({ vn, cid, hn, vstdate, status: 'skipped', message: 'CID ไม่ถูกต้อง' });
      continue;
    }

    if (visitOrder !== 1) {
      summary.skipped += 1;
      await saveAuthenSyncCancel({ vn, cid, vstdate, reason: 'MULTIVISIT' });
      await saveAuthenSyncLog({ vn, cid, hn, vstdate, status: 'skipped', message: 'ไม่ใช่ visit แรกของวัน' });
      continue;
    }

    try {
      const apiResult = await callNhsoAuthenApi(options.baseUrl, options.token, cid, vstdate);
      const payload = apiResult.payload as Record<string, unknown> | null;
      const histories = Array.isArray(payload?.serviceHistories) ? payload?.serviceHistories as Record<string, unknown>[] : [];

      let matched = false;
      for (const history of histories) {
        const hospital = history.hospital as Record<string, unknown> | undefined;
        const hcode = normalizeImportCellValue(hospital?.hcode);
        const claimCode = normalizeImportCellValue(history.claimCode);
        const service = history.service as Record<string, unknown> | undefined;
        const authenType = normalizeImportCellValue(service?.code);
        const serviceDateTime = normalizeImportCellValue(history.serviceDateTime);
        const sameDate = formatDateOnly(serviceDateTime) === vstdate;

        if (hcode === options.hospitalCode && sameDate && claimCode) {
          matched = true;
          await upsertAuthenForVisit({
            vn,
            cid,
            claimCode,
            authenType,
            authenDateTime: parseFlexibleDateTime(serviceDateTime) || `${vstdate} 00:00:00`,
          });
          await saveAuthenSyncLog({
            vn,
            cid,
            hn,
            vstdate,
            claimCode,
            authenType,
            authenDateTime: parseFlexibleDateTime(serviceDateTime) || `${vstdate} 00:00:00`,
            status: 'updated',
            message: 'อัปเดต Authen Code สำเร็จ',
            requestUrl: apiResult.requestUrl,
            responsePayload: payload,
          });
          summary.updated += 1;
          break;
        }
      }

      if (!matched) {
        summary.duplicates += 1;
        await saveAuthenSyncCancel({ vn, cid, vstdate, reason: 'NOTFOUND' });
        await saveAuthenSyncLog({
          vn,
          cid,
          hn,
          vstdate,
          status: 'not_found',
          message: 'ไม่พบข้อมูล authen ที่ตรงกับโรงพยาบาล/วันที่',
          requestUrl: apiResult.requestUrl,
          responsePayload: payload,
        });
      }
    } catch (error) {
      summary.errors += 1;
      await saveAuthenSyncLog({
        vn,
        cid,
        hn,
        vstdate,
        status: 'error',
        message: error instanceof Error ? error.message : 'Sync authen ไม่สำเร็จ',
      });
    }
  }

  return summary;
};



const getNhsoIpdAuthenCandidates = async (
  startDate: string,
  endDate: string,
  options: { force?: boolean; fundCodes?: string[] } = {},
) => {
  const connection = await getUTFConnection();
  try {
    const fundCodes = Array.from(new Set(
      (options.fundCodes || ['UCS', 'LGO', 'WEL'])
        .map((code) => normalizeImportCellValue(code).toUpperCase())
        .filter((code) => ['UCS', 'LGO', 'WEL'].includes(code)),
    ));
    const cooldownCondition = options.force ? '' : `AND NOT EXISTS (
      SELECT 1 FROM ${repstmDatabaseName}.authen_sync_log asl
      WHERE asl.vn=i.vn AND asl.status IN ('not_found','error')
        AND asl.synced_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR)
    )`;
    const [rows] = await connection.query(
      `SELECT i.vn,i.an,i.hn,pt.cid,i.regdate AS vstdate,i.dchdate,
              TIMESTAMP(i.regdate,i.regtime) AS service_datetime
       FROM ipt i
       JOIN patient pt ON pt.hn=i.hn
       JOIN pttype ptt ON ptt.pttype=i.pttype
       WHERE (i.regdate BETWEEN ? AND ? OR i.dchdate BETWEEN ? AND ?)
         AND ptt.hipdata_code IN (?)
         AND NOT EXISTS (SELECT 1 FROM authenhos ah WHERE ah.vn IN (i.vn,i.an) AND COALESCE(ah.claim_code,'')<>'')
         AND NOT EXISTS (SELECT 1 FROM visit_pttype vp WHERE vp.vn=i.vn AND COALESCE(vp.auth_code,'')<>'')
         ${cooldownCondition}
       ORDER BY i.dchdate DESC,i.an DESC
       LIMIT 200`,
      [startDate,endDate,startDate,endDate,fundCodes],
    );
    return Array.isArray(rows) ? rows as Record<string,unknown>[] : [];
  } finally {
    connection.release();
  }
};

export const syncNhsoIpdAuthenCodes = async (options: {
  token: string;
  baseUrl: string;
  hospitalCode: string;
  startDate: string;
  endDate: string;
  maxDays?: number;
  force?: boolean;
  fundCodes?: string[];
}) => {
  const start = new Date(options.startDate);
  const end = new Date(options.endDate);
  const dayDiff = Math.floor((end.getTime()-start.getTime())/86400000);
  if (Number.isNaN(dayDiff) || dayDiff < 0) throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  if (dayDiff > (options.maxDays ?? 31)) throw new Error(`การตรวจ Authen อัตโนมัติรองรับช่วงวันที่ไม่เกิน ${options.maxDays ?? 31} วัน`);

  await getAuthenSyncLogs(1); // Ensure the shared sync-log table exists before applying the cooldown filter.
  const candidates = await getNhsoIpdAuthenCandidates(options.startDate,options.endDate,{
    force:Boolean(options.force),
    fundCodes:options.fundCodes,
  });
  const summary = { total:candidates.length,updated:0,skipped:0,notFound:0,errors:0 };
  for (const row of candidates) {
    const vn=normalizeImportCellValue(row.vn), an=normalizeImportCellValue(row.an), cid=normalizeImportCellValue(row.cid), hn=normalizeImportCellValue(row.hn), admitDate=formatDateOnly(row.vstdate);
    if (!cid || !isValidThaiCid(cid)) {
      summary.skipped+=1;
      await saveAuthenSyncLog({vn,cid,hn,vstdate:admitDate,status:'skipped',message:`FDH IPD ${an}: CID ไม่ถูกต้อง`});
      continue;
    }
    try {
      const apiResult=await callNhsoAuthenApi(options.baseUrl,options.token,cid,admitDate);
      const payload=apiResult.payload as Record<string,unknown>|null;
      const histories=Array.isArray(payload?.serviceHistories)?payload.serviceHistories as Record<string,unknown>[]:[];
      const matched=histories.find((history)=>{
        const hospital=history.hospital as Record<string,unknown>|undefined;
        return normalizeImportCellValue(hospital?.hcode)===options.hospitalCode
          && formatDateOnly(history.serviceDateTime)===admitDate
          && Boolean(normalizeImportCellValue(history.claimCode));
      });
      if (!matched) {
        summary.notFound+=1;
        await saveAuthenSyncLog({vn,cid,hn,vstdate:admitDate,status:'not_found',message:`FDH IPD ${an}: ไม่พบ Authen Code ที่ตรงกับโรงพยาบาล/วัน Admit`,requestUrl:apiResult.requestUrl,responsePayload:payload});
        continue;
      }
      const service=matched.service as Record<string,unknown>|undefined;
      const claimCode=normalizeImportCellValue(matched.claimCode);
      const authenType=normalizeImportCellValue(service?.code);
      const serviceDateTime=normalizeImportCellValue(matched.serviceDateTime);
      const authenDateTime=parseFlexibleDateTime(serviceDateTime)||`${admitDate} 00:00:00`;
      await upsertAuthenForVisit({vn,cid,claimCode,authenType,authenDateTime});
      await saveAuthenSyncLog({vn,cid,hn,vstdate:admitDate,claimCode,authenType,authenDateTime,status:'updated',message:`FDH IPD ${an}: นำเข้า Authen Code จาก NHSO API สำเร็จ`,requestUrl:apiResult.requestUrl,responsePayload:payload});
      summary.updated+=1;
    } catch (error) {
      summary.errors+=1;
      await saveAuthenSyncLog({vn,cid,hn,vstdate:admitDate,status:'error',message:`FDH IPD ${an}: ${error instanceof Error?error.message:'Sync Authen ไม่สำเร็จ'}`});
    }
  }
  return summary;
};


export const getWorkQueueItems = async (filters?: {
  status?: string;
  startDate?: string;
  endDate?: string;
  fund?: string;
  search?: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(CLAIM_WORK_QUEUE_TABLE_SQL);
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.status && filters.status !== 'all') {
      whereClauses.push('queue_status = ?');
      params.push(filters.status);
    }
    if (filters?.startDate) {
      whereClauses.push('service_date >= ?');
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      whereClauses.push('service_date <= ?');
      params.push(filters.endDate);
    }
    if (filters?.fund && filters.fund !== 'all') {
      whereClauses.push('fund = ?');
      params.push(filters.fund);
    }
    if (filters?.search?.trim()) {
      whereClauses.push('(vn LIKE ? OR hn LIKE ? OR patient_name LIKE ?)');
      const kw = `%${filters.search.trim()}%`;
      params.push(kw, kw, kw);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limit = Math.min(Number(filters?.limit || 500), 2000);
    params.push(limit);

    const [rows] = await connection.query(
      `SELECT id, vn, hn, patient_name, fund, service_date, queue_status, assigned_to, notes, created_at, updated_at
       FROM claim_work_queue
       ${whereStr}
       ORDER BY service_date DESC, updated_at DESC, id DESC
       LIMIT ?`,
      params
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } catch (error) {
    console.error('Error reading work queue:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const upsertWorkQueueItem = async (item: {
  vn: string;
  hn?: string;
  patientName?: string;
  fund?: string;
  serviceDate?: string;
  queueStatus?: string;
  assignedTo?: string;
  notes?: string;
}): Promise<{ success: boolean }> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(CLAIM_WORK_QUEUE_TABLE_SQL);
    await connection.query(
      `INSERT INTO claim_work_queue (vn, hn, patient_name, fund, service_date, queue_status, assigned_to, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         hn = COALESCE(VALUES(hn), hn),
         patient_name = COALESCE(VALUES(patient_name), patient_name),
         fund = COALESCE(VALUES(fund), fund),
         service_date = COALESCE(VALUES(service_date), service_date),
         queue_status = COALESCE(VALUES(queue_status), queue_status),
         assigned_to = VALUES(assigned_to),
         notes = VALUES(notes),
         updated_at = CURRENT_TIMESTAMP`,
      [
        item.vn,
        item.hn || null,
        item.patientName || null,
        item.fund || null,
        item.serviceDate || null,
        item.queueStatus || 'pending_mr',
        item.assignedTo || null,
        item.notes || null,
      ]
    );
    return { success: true };
  } catch (error) {
    console.error('Error upserting work queue item:', error);
    return { success: false };
  } finally {
    connection.release();
  }
};

export const bulkUpsertWorkQueue = async (items: Array<{
  vn: string;
  hn?: string;
  patientName?: string;
  fund?: string;
  serviceDate?: string;
}>): Promise<{ success: boolean; count: number }> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(CLAIM_WORK_QUEUE_TABLE_SQL);
    let count = 0;
    for (const item of items) {
      if (!item.vn) continue;
      await connection.query(
        `INSERT INTO claim_work_queue (vn, hn, patient_name, fund, service_date, queue_status)
         VALUES (?, ?, ?, ?, ?, 'pending_mr')
         ON DUPLICATE KEY UPDATE
           hn = COALESCE(VALUES(hn), hn),
           patient_name = COALESCE(VALUES(patient_name), patient_name),
           fund = COALESCE(VALUES(fund), fund),
           service_date = COALESCE(VALUES(service_date), service_date)`,
        [item.vn, item.hn || null, item.patientName || null, item.fund || null, item.serviceDate || null]
      );
      count += 1;
    }
    return { success: true, count };
  } catch (error) {
    console.error('Error bulk upserting work queue:', error);
    return { success: false, count: 0 };
  } finally {
    connection.release();
  }
};

// ============================================================
// Reject Tracking Functions
// ============================================================

export const getRejectTrackingItems = async (filters?: {
  startDate?: string;
  endDate?: string;
  errorcode?: string;
  resolveStatus?: string;
  fund?: string;
  search?: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(CLAIM_REJECT_NOTE_TABLE_SQL);
    const whereClauses: string[] = ["TRIM(COALESCE(rd.errorcode, '')) NOT IN ('', '-')"];
    const params: unknown[] = [];

    if (filters?.startDate) {
      whereClauses.push('rd.admdate >= ?');
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      whereClauses.push('rd.admdate <= ?');
      params.push(filters.endDate + ' 23:59:59');
    }
    if (filters?.errorcode && filters.errorcode !== 'all') {
      whereClauses.push('rd.errorcode LIKE ?');
      params.push(`%${filters.errorcode}%`);
    }
    if (filters?.resolveStatus && filters.resolveStatus !== 'all') {
      whereClauses.push('COALESCE(rn.resolve_status, \'open\') = ?');
      params.push(filters.resolveStatus);
    }
    if (filters?.fund && filters.fund !== 'all') {
      whereClauses.push('rd.maininscl = ?');
      params.push(filters.fund);
    }
    if (filters?.search?.trim()) {
      whereClauses.push('(rd.vn LIKE ? OR rd.hn LIKE ? OR rd.patient_name LIKE ? OR rd.tran_id LIKE ?)');
      const kw = `%${filters.search.trim()}%`;
      params.push(kw, kw, kw, kw);
    }

    const whereStr = `WHERE ${whereClauses.join(' AND ')}`;
    const limit = Math.min(Number(filters?.limit || 500), 2000);
    params.push(limit);

    const [rows] = await connection.query(
      `SELECT
         rd.id AS rep_data_id,
         rd.rep_no,
         rd.tran_id,
         rd.hn,
         rd.vn,
         rd.an,
         rd.pid,
         rd.patient_name,
         rd.department,
         rd.admdate,
         rd.dchdate,
         rd.maininscl,
         rd.subinscl,
         rd.errorcode,
         rd.verifycode,
         rd.income,
         rd.compensated,
         rd.diff,
         COALESCE(rn.id, NULL) AS note_id,
         COALESCE(rn.resolve_status, 'open') AS resolve_status,
         rn.note,
         rn.assigned_to,
         rn.resolved_at,
         rn.updated_at AS note_updated_at
       FROM rep_data rd
       LEFT JOIN claim_reject_note rn ON rn.tran_id = rd.tran_id AND rn.tran_id IS NOT NULL
       ${whereStr}
       ORDER BY rd.admdate DESC, rd.id DESC
       LIMIT ?`,
      params
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } catch (error) {
    console.error('Error reading reject tracking items:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const upsertRejectNote = async (note: {
  repDataId?: number;
  tranId?: string;
  vn?: string;
  an?: string;
  hn?: string;
  errorcode?: string;
  verifycode?: string;
  resolveStatus: string;
  note?: string;
  assignedTo?: string;
}): Promise<{ success: boolean; id?: number }> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(CLAIM_REJECT_NOTE_TABLE_SQL);
    const resolvedAt = note.resolveStatus === 'resolved' ? new Date() : null;
    const [result] = await connection.query(
      `INSERT INTO claim_reject_note
         (rep_data_id, tran_id, vn, an, hn, errorcode, verifycode, resolve_status, note, assigned_to, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         resolve_status = VALUES(resolve_status),
         note = VALUES(note),
         assigned_to = VALUES(assigned_to),
         resolved_at = IF(VALUES(resolve_status) = 'resolved', COALESCE(resolved_at, CURRENT_TIMESTAMP), NULL),
         updated_at = CURRENT_TIMESTAMP`,
      [
        note.repDataId || null,
        note.tranId || null,
        note.vn || null,
        note.an || null,
        note.hn || null,
        note.errorcode || null,
        note.verifycode || null,
        note.resolveStatus || 'open',
        note.note || null,
        note.assignedTo || null,
        resolvedAt,
      ]
    );
    const id = Number((result as any).insertId || 0);
    return { success: true, id };
  } catch (error) {
    console.error('Error upserting reject note:', error);
    return { success: false };
  } finally {
    connection.release();
  }
};

// ฟังก์ชันดึงข้อมูลตรวจสอบจาก HOSxP
export const getCheckData = async (
  fund?: string,
  startDate?: string,
  endDate?: string
): Promise<Record<string, unknown>[]> => {
  try {
    const connection = await getUTFConnection();

    // Query ข้อมูลจาก HOSxP ตามโครงสร้าง Data Dictionary
    let query = `
      SELECT 
        ovst.vn as id,
        ovst.hn,
        ovst.vn,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patientName,
        COALESCE(v.sex, pt.sex) as sex,
        v.age_y as age,
        v.age_y as age_y,
        COALESCE(pttype.name, 'ไม่ระบุสิทธิ') as fund,
        pttype.hipdata_code,
        COALESCE(pttype.pttype_eclaim_id, '') as pttype_eclaim_id,
        COALESCE((
          SELECT pe.name
          FROM pttype_eclaim pe
          WHERE pe.code = pttype.pttype_eclaim_id
          LIMIT 1
        ), '') as pttype_eclaim_name,
        DATE_FORMAT(ovst.vstdate, '%Y-%m-%d') as serviceDate,
        TIME_FORMAT(ovst.vsttime, '%H:%i:%s') as serviceTime,
        COALESCE(ovst.an, '') as an,
        (SELECT icd10 FROM ovstdiag WHERE vn = ovst.vn AND diagtype = '1' LIMIT 1) as main_diag,
        (SELECT GROUP_CONCAT(DISTINCT icd10 ORDER BY diagtype, icd10 SEPARATOR ',')
          FROM ovstdiag WHERE vn = ovst.vn) as diagnosis_codes,
        CASE 
          WHEN ovst.an IS NOT NULL AND ovst.an != '' THEN 'ผู้ป่วยใน'
          ELSE 'ผู้ป่วยนอก'
        END as serviceType,
        COALESCE(SUM(opitemrece.unitprice * opitemrece.qty), 0) as price,

        -- หลักฐานสำหรับ OPD Pre-audit (คำนวณใหม่ทุกครั้งที่ API โหลดข้อมูล)
        CASE WHEN COALESCE(NULLIF(TRIM(ovst.doctor), ''),
          (SELECT NULLIF(TRIM(dx.doctor), '') FROM ovstdiag dx WHERE dx.vn = ovst.vn AND TRIM(COALESCE(dx.doctor, '')) <> '' LIMIT 1),
          (SELECT NULLIF(TRIM(dop.doctor), '') FROM doctor_operation dop WHERE dop.vn = ovst.vn AND TRIM(COALESCE(dop.doctor, '')) <> '' LIMIT 1)
        ) IS NOT NULL THEN 1 ELSE 0 END as has_provider,
        CASE WHEN EXISTS (
          SELECT 1 FROM opdscreen os
          WHERE os.vn = ovst.vn
            AND (TRIM(COALESCE(os.cc, '')) <> '' OR TRIM(COALESCE(os.hpi, '')) <> '')
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_clinical_note,
        CASE WHEN EXISTS (
          SELECT 1 FROM lab_head lh
          JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
          WHERE lh.vn = ovst.vn
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_lab_order,
        CASE WHEN EXISTS (
          SELECT 1 FROM lab_head lh
          JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
          WHERE lh.vn = ovst.vn
          LIMIT 1
        ) AND NOT EXISTS (
          SELECT 1 FROM lab_head lh
          JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
          WHERE lh.vn = ovst.vn
            AND TRIM(COALESCE(lo.lab_order_result, '')) = ''
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_lab_result,
        (SELECT COUNT(*) FROM opitemrece oo WHERE oo.vn = ovst.vn AND COALESCE(oo.qty, 0) <= 0) as invalid_charge_qty_count,
        (SELECT GREATEST(COUNT(*) - COUNT(DISTINCT oo.icode), 0) FROM opitemrece oo WHERE oo.vn = ovst.vn) as duplicate_charge_count,
        CASE WHEN EXISTS (
          SELECT 1 FROM opitemrece oo
          LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
          LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
          WHERE oo.vn = ovst.vn
            AND (oo.icode = '55020' OR sd.nhso_adp_code = '55020' OR ndi.nhso_adp_code = '55020')
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_55020,
        CASE WHEN EXISTS (
          SELECT 1 FROM opitemrece oo
          LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
          LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
          WHERE oo.vn = ovst.vn
            AND (oo.icode = '55021' OR sd.nhso_adp_code = '55021' OR ndi.nhso_adp_code = '55021')
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_55021,
        CASE WHEN EXISTS (
          SELECT 1 FROM opitemrece oo
          LEFT JOIN income inc ON inc.income = oo.income
          LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
          LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
          WHERE oo.vn = ovst.vn
            AND UPPER(CONCAT_WS(' ', COALESCE(inc.name, ''), COALESCE(sd.name, ''), COALESCE(ndi.name, '')))
              REGEXP 'สังเกตอาการ|OBSERVATION|OBSERVE'
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_observation_charge,
        CASE WHEN EXISTS (SELECT 1 FROM doctor_operation dop WHERE dop.vn = ovst.vn LIMIT 1)
          OR EXISTS (SELECT 1 FROM dtmain dm WHERE dm.vn = ovst.vn LIMIT 1)
          THEN 1 ELSE 0 END as has_procedure_service,
        (SELECT COUNT(*)
          FROM opitemrece oo
          JOIN drugitems di ON di.icode = oo.icode
          WHERE oo.vn = ovst.vn AND COALESCE(oo.qty, 0) <= 0
        ) as invalid_drug_qty_count,
        
        -- กองทุนพิเศษ Subqueries
        TIMESTAMPDIFF(YEAR, pt.birthday, ovst.vstdate) as age_y,
        CASE WHEN ${buildTelemedExistsSql('ovst', 'ovstist')} THEN 1 ELSE 0 END as has_telmed,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = 'DRUGP' LIMIT 1) as has_drugp,
        (SELECT COUNT(DISTINCT oo.icode)
          FROM opitemrece oo
          JOIN drugitems di ON di.icode = oo.icode
          LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
          WHERE oo.vn = ovst.vn
            AND COALESCE(sd.nhso_adp_code, '') <> 'DRUGP'
            AND COALESCE(oo.qty, 0) > 0) as drug_count,
        (SELECT 1 FROM opitemrece oo JOIN drugitems di ON di.icode = oo.icode WHERE oo.vn = ovst.vn AND di.sks_product_category_id IN (3,4) AND di.ttmt_code IS NOT NULL LIMIT 1) as has_herb,
        (SELECT 1 FROM opitemrece oo JOIN nondrugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_type_id = 2 LIMIT 1) as has_instrument,
        (SELECT 1 FROM health_med_service s JOIN health_med_service_operation op ON op.health_med_service_id = s.health_med_service_id JOIN health_med_operation_item i ON i.health_med_operation_item_id = op.health_med_operation_item_id WHERE s.vn = ovst.vn AND REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835') LIMIT 1) as has_knee_oper,
        
        CASE WHEN v.age_y BETWEEN 35 AND 59 THEN 1 ELSE 0 END as fpg_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12003' LIMIT 1) THEN 1 ELSE 0 END as has_fpg_adp,
        CASE WHEN ${buildFpgLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_fpg_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', FPG_DX_CODES)} THEN 1 ELSE 0 END as has_fpg_diag,
        CASE
          WHEN v.age_y BETWEEN 35 AND 59
            AND EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12003' LIMIT 1)
            AND ${buildFpgLabExistsSql('ovst')}
            AND ${buildDiagnosisMatchSql('ovst', 'v', FPG_DX_CODES)}
            THEN 1
          ELSE 0
        END as has_fpg,
        CASE WHEN v.age_y BETWEEN 45 AND 70 THEN 1 ELSE 0 END as chol_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12004' LIMIT 1) THEN 1 ELSE 0 END as has_chol_adp,
        CASE WHEN ${buildCholLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_chol_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', CHOL_DX_CODES)} THEN 1 ELSE 0 END as has_chol_diag,
        CASE
          WHEN v.age_y BETWEEN 45 AND 70
            AND EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12004' LIMIT 1)
            AND ${buildCholLabExistsSql('ovst')}
            AND ${buildDiagnosisMatchSql('ovst', 'v', CHOL_DX_CODES)}
            THEN 1
          ELSE 0
        END as has_chol,
        CASE WHEN ${buildAnemiaAgeEligibleSql('ovst')} THEN 1 ELSE 0 END as anemia_age_eligible,
        ${buildAnemiaAgeBandSql('ovst')} as anemia_age_band,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '13001' LIMIT 1) THEN 1 ELSE 0 END as has_anemia_adp,
        CASE WHEN ${buildAnemiaCbcExistsSql('ovst')} THEN 1 ELSE 0 END as has_anemia_cbc,
        CASE WHEN ${buildAnemiaHbHctExistsSql('ovst')} THEN 1 ELSE 0 END as has_anemia_hbhct,
        CASE WHEN ${buildAnemiaLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_anemia_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} THEN 1 ELSE 0 END as has_anemia_diag,
        CASE
          WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '13001' LIMIT 1)
            THEN 1
          WHEN v.age_y BETWEEN 13 AND 24 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaCbcExistsSql('ovst')}
            THEN 1
          WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ovst.vstdate) BETWEEN 6 AND 12 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaHbHctExistsSql('ovst')}
            THEN 1
          WHEN v.age_y BETWEEN 3 AND 6 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaHbHctExistsSql('ovst')}
            THEN 1
          ELSE 0
        END as has_anemia,
        CASE
          WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '13001' LIMIT 1)
            THEN 'ADP13001'
          WHEN v.age_y BETWEEN 13 AND 24 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaCbcExistsSql('ovst')}
            THEN 'CBC+Z130/Z138(13-24Y)'
          WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ovst.vstdate) BETWEEN 6 AND 12 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaHbHctExistsSql('ovst')}
            THEN 'HbHct+Z130/Z138(6-12M)'
          WHEN v.age_y BETWEEN 3 AND 6 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaHbHctExistsSql('ovst')}
            THEN 'HbHct+Z130/Z138(3-6Y)'
          ELSE NULL
        END as anemia_match_source,
        CASE WHEN COALESCE(v.sex, pt.sex) = '2' AND v.age_y BETWEEN 13 AND 45 THEN 1 ELSE 0 END as iron_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '14001' LIMIT 1) THEN 1 ELSE 0 END as has_iron_adp,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND (d.name LIKE '%FERROUS%' OR d.name LIKE '%F-TAB%') LIMIT 1) THEN 1 ELSE 0 END as has_iron_med,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)} THEN 1 ELSE 0 END as has_iron_diag,
        CASE
          WHEN COALESCE(v.sex, pt.sex) = '2' AND v.age_y BETWEEN 13 AND 45
            AND (
              EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '14001' LIMIT 1)
              OR EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND (d.name LIKE '%FERROUS%' OR d.name LIKE '%F-TAB%') LIMIT 1)
            )
            AND ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)}
            THEN 1
          ELSE 0
        END as has_iron,
        CASE WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ovst.vstdate) BETWEEN 6 AND 12 THEN 1 ELSE 0 END as ferrokid_age_eligible,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)} THEN 1 ELSE 0 END as has_ferrokid_diag,
        CASE WHEN ${buildFerrokidMedExistsSql('ovst')} THEN 1 ELSE 0 END as has_ferrokid_med,
        CASE
          WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ovst.vstdate) BETWEEN 6 AND 12
            AND ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)}
            AND ${buildFerrokidMedExistsSql('ovst')}
            THEN 1
          ELSE 0
        END as has_ferrokid,
        CASE WHEN ${buildPregLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_preg_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', UPT_DX_CODES)} THEN 1 ELSE 0 END as has_preg_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30014' LIMIT 1) THEN 1 ELSE 0 END as has_preg_item,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30014' LIMIT 1) as has_upt,
        (SELECT GROUP_CONCAT(DISTINCT REPLACE(UPPER(dx.icd10), '.', '') ORDER BY dx.icd10 SEPARATOR ', ')
          FROM ovstdiag dx
          WHERE dx.vn = ovst.vn
            AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z320', 'Z321')) as preg_diags,
        CASE WHEN EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}' LIMIT 1) THEN 1 ELSE 0 END as has_anc_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN (${(businessRules.adp_codes.anc as string[]).map(code => `'${code}'`).join(',')}) LIMIT 1) THEN 1 ELSE 0 END as has_anc_adp,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30011' LIMIT 1) as has_anc_visit,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30010' LIMIT 1) as has_anc_us,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30012' LIMIT 1) as has_anc_lab1,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30013' LIMIT 1) as has_anc_lab2,
        CASE WHEN ${buildAncLab1CompleteSql('ovst')} THEN 1 ELSE 0 END as anc_lab1_complete,
        CASE WHEN ${buildAncLab2CompleteSql('ovst')} THEN 1 ELSE 0 END as anc_lab2_complete,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.cbc)} THEN 1 ELSE 0 END as anc_lab1_cbc,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.dcip)} THEN 1 ELSE 0 END as anc_lab1_dcip,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.abo)} THEN 1 ELSE 0 END as anc_lab1_abo,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.rh)} THEN 1 ELSE 0 END as anc_lab1_rh,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.hbsag)} THEN 1 ELSE 0 END as anc_lab1_hbsag,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.syphilis)} THEN 1 ELSE 0 END as anc_lab1_syphilis,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.hiv)} THEN 1 ELSE 0 END as anc_lab1_hiv,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_2_REGEX.hiv)} THEN 1 ELSE 0 END as anc_lab2_hiv,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_2_REGEX.syphilis)} THEN 1 ELSE 0 END as anc_lab2_syphilis,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_2_REGEX.cbc)} THEN 1 ELSE 0 END as anc_lab2_cbc,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30008' LIMIT 1) as has_anc_dental_exam,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30009' LIMIT 1) as has_anc_dental_clean,
        CASE WHEN EXISTS (
          SELECT 1
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
            AND COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
              IN (${ANC_DENTAL_EXAM_PROCEDURE_CODES_SQL})
            AND REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), '')), '.', '') = '${ANC_DENTAL_EXAM_ICD9}'
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_anc_dental_exam_procedure,
        CASE WHEN EXISTS (
          SELECT 1
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
            AND COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
              IN (${ANC_DENTAL_CLEAN_PROCEDURE_CODES_SQL})
            AND REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), '')), '.', '') = '${ANC_DENTAL_CLEAN_ICD9}'
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_anc_dental_clean_procedure,
        (
          SELECT GROUP_CONCAT(
            DISTINCT COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
            ORDER BY dm.tm_no SEPARATOR ', '
          )
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
        ) as dental_procedure_codes,
        (
          SELECT GROUP_CONCAT(DISTINCT CONCAT(
            COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(dm.icd9), ''), dm.tmcode),
            ':', REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), ''), ''), '.', '')
          ) ORDER BY dm.tm_no SEPARATOR ', ')
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
        ) as dental_procedure_pairs,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', POSTNATAL_CARE_DX_CODES)} THEN 1 ELSE 0 END as has_pp_diag,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', POSTNATAL_SUPPLEMENT_DX_CODES)} THEN 1 ELSE 0 END as has_pp_specific_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN ('30015','30016') LIMIT 1) THEN 1 ELSE 0 END as has_pp_adp,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30015' LIMIT 1) as has_post_care,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30016' LIMIT 1) as has_post_supp,
        (SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
          FROM opitemrece oo
          JOIN s_drugitems d ON d.icode = oo.icode
          WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN ('30015', '30016')) as pp_adp_codes,
        CASE WHEN ${buildPostIronMedExistsSql('ovst')} THEN 1 ELSE 0 END as has_post_iron_med,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '15001' LIMIT 1) as has_fluoride,
        CASE WHEN EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.fp}' LIMIT 1) THEN 1 ELSE 0 END as has_fp_diag,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', PILL_DX_CODES)} THEN 1 ELSE 0 END as has_z304_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.fp_regex}' LIMIT 1) THEN 1 ELSE 0 END as has_fp_adp,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND (d.nhso_adp_code IN ('FP003_1','FP003_2','FP003_3') OR d.name LIKE '%ANNA%' OR d.name LIKE '%LYNESTRENOL%') LIMIT 1) as has_fp_pill,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = 'FP003_4' LIMIT 1) as has_fp_condom,
        (SELECT COALESCE(SUM(COALESCE(oo.qty, 0)), 0) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=ovst.hn AND YEAR(fy.vstdate)=YEAR(ovst.vstdate) AND d.nhso_adp_code='FP003_3') as fp_emergency_year_qty,
        (SELECT COUNT(DISTINCT oo.vn) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=ovst.hn AND YEAR(fy.vstdate)=YEAR(ovst.vstdate) AND d.nhso_adp_code='FP003_4') as fp_injection_year_count,
        
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z124|^Z014' LIMIT 1) as has_cx_diag,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code REGEXP '1B004|1B005' LIMIT 1) as has_cx_adp,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 IN ('Z515', 'Z718') LIMIT 1) as has_pal_diag,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN ('30001', 'Cons01', 'Eva001') LIMIT 1) as has_pal_adp,
        
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z511|^Z512' LIMIT 1) as has_chemo_diag,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^B182' LIMIT 1) as has_hepc_diag,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z50' LIMIT 1) as has_rehab_diag,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z49' LIMIT 1) as has_crrt_diag,
        (SELECT 1 FROM opitemrece oo JOIN nondrugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.name LIKE '%robot%' LIMIT 1) as has_robot_item,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z510' LIMIT 1) as has_proton_diag,
        (SELECT 1 FROM opitemrece oo JOIN nondrugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.name LIKE '%chest x-ray%' LIMIT 1) as has_cxr_item,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101') LIMIT 1) as has_clopidogrel,
        
        ovst.ovstost,

        CASE
          WHEN COALESCE(
            (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^PP' LIMIT 1),
            (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^PP' LIMIT 1)
          ) IS NOT NULL THEN 1 ELSE 0
        END as has_authen_pp,
        COALESCE(
          (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^PP' LIMIT 1),
          (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^PP' LIMIT 1),
          ''
        ) as authen_code,
        CASE
          WHEN COALESCE(
            (SELECT nhso_authen_code FROM nhso_confirm_privilege WHERE vn = ovst.vn AND nhso_status = 'Y' AND nhso_authen_code REGEXP '^EP' LIMIT 1),
            (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^EP' LIMIT 1),
            (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^EP' LIMIT 1)
          ) IS NOT NULL THEN 1 ELSE 0
        END as has_close_ep,
        COALESCE(
          (SELECT nhso_authen_code FROM nhso_confirm_privilege WHERE vn = ovst.vn AND nhso_status = 'Y' AND nhso_authen_code REGEXP '^EP' LIMIT 1),
          (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^EP' LIMIT 1),
          (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^EP' LIMIT 1),
          ''
        ) as close_code,
        COALESCE(
          (SELECT nhso_status FROM nhso_confirm_privilege WHERE vn = ovst.vn LIMIT 1),
          ''
        ) as close_status,

        
        CASE WHEN (pttype.name LIKE '%อุบัติเหตุ%' OR ovst.pt_subtype = '7') THEN 'OP AE' ELSE '' END as project_code
        
      FROM ovst
      LEFT JOIN patient pt ON ovst.hn = pt.hn
      LEFT JOIN pttype ON ovst.pttype = pttype.pttype
      LEFT JOIN vn_stat v ON v.vn = ovst.vn
      LEFT JOIN ovstist ON ovstist.ovstist = ovst.ovstist
      LEFT JOIN opitemrece ON ovst.vn = opitemrece.vn
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (fund) {
      query += ` AND pttype.name = ?`;
      params.push(fund);
    }

    if (startDate) {
      query += ` AND DATE(ovst.vstdate) >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND DATE(ovst.vstdate) <= ?`;
      params.push(endDate);
    }

    query += ` GROUP BY ovst.vn, ovst.hn, pt.pname, pt.fname, pt.lname, pttype.name, pttype.hipdata_code, ovst.vstdate, ovst.vsttime, ovst.ovstost, pt.birthday, ovst.pt_subtype, v.age_y ORDER BY ovst.vstdate DESC, ovst.vsttime DESC, ovst.vn DESC`;

    const [rows] = await connection.query(query, params);
    connection.release();

    return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('Error fetching check data from HOSxP:', error);
    throw error;
  }
};

// ฟังก์ชันตรวจสอบความสมบูรณ์ของข้อมูล
export const validateCheckCompletenesss = async (
  hn: string,
  vn: string
) => {
  const connection = await pool.getConnection();
  try {
    const issues: string[] = [];
    let isComplete = true;

    // 1. ตรวจสอบข้อมูลผู้ป่วย (patient table)
    const [patientRows] = await connection.query(
      'SELECT fname, lname, pttype FROM patient WHERE hn = ?',
      [hn]
    );
    if (!patientRows || (patientRows as Record<string, unknown>[]).length === 0) {
      issues.push('ข้อมูลผู้ป่วยไม่พบ');
      isComplete = false;
    }

    // 2. ตรวจสอบรายการบริการ (ovst table)
    const [visitRows] = await connection.query(
      'SELECT vn, vstdate, ovstost FROM ovst WHERE vn = ? AND hn = ?',
      [vn, hn]
    );
    if (!visitRows || (visitRows as Record<string, unknown>[]).length === 0) {
      issues.push('ไม่พบบันทึกการมารับบริการ');
      isComplete = false;
    }

    // 3. ตรวจสอบการวินิจฉัย (ovstdiag table)
    const [diagRows] = await connection.query(
      'SELECT COUNT(*) as count FROM ovstdiag WHERE vn = ?',
      [vn]
    );
    if (!diagRows || (diagRows as Record<string, unknown>[]).length === 0 || (diagRows as Record<string, unknown>[])[0].count === 0) {
      issues.push('ขาดรหัสวินิจฉัย (ICD10)');
      isComplete = false;
    }

    // 4. ตรวจสอบรายการยา (opitemrece table)
    const [drugRows] = await connection.query(
      'SELECT COUNT(*) as count FROM opitemrece WHERE vn = ?',
      [vn]
    );
    const drugCount = (drugRows as Record<string, unknown>[]) ? (drugRows as Record<string, unknown>[])[0].count : 0;
    if (drugCount === 0) {
      // อาจจะไม่มียา ถ้าเป็นเคสที่ไม่ต้องใช้ยา
      // issues.push('ไม่มีรายการยา');
    }

    return {
      status: isComplete ? 'สมบูรณ์' : 'ไม่สมบูรณ์',
      issues,
      isComplete,
    };
  } catch (error) {
    console.error('Error validating completeness:', error);
    return {
      status: 'ไม่สมบูรณ์',
      issues: ['เกิดข้อผิดพลาดในการตรวจสอบ'],
      isComplete: false,
    };
  } finally {
    connection.release();
  }
};

// ฟังก์ชันดึงข้อมูลยา (เฉพาะรายการที่อยู่ในตาราง drugitems)


export const attachLatestFdhClaimDetails = async (rows: Record<string, unknown>[], patientType: 'OPD' | 'IPD') => {
  const key = patientType === 'IPD' ? 'an' : 'vn';
  const codes = [...new Set(rows.map((row) => String(row[key] || '')).filter(Boolean))];
  if (!codes.length) return rows;
  const connection = await getRepstmConnection();
  try {
    const details: Record<string, unknown>[] = [];
    for (let offset = 0; offset < codes.length; offset += 500) {
      const batch = codes.slice(offset, offset + 500);
      const [found] = await connection.query(`
        SELECT d.${key}, d.claim_status, d.claim_code, d.upload_uid, d.sent_at,
          DATE_FORMAT(d.sent_at, '%Y-%m-%d') AS sent_at_day
        FROM fdh_claim_detail_row d
        JOIN (
          SELECT ${key}, MAX(id) AS latest_id FROM fdh_claim_detail_row
          WHERE ${key} IN (${batch.map(() => '?').join(',')})
            ${patientType === 'IPD' ? "AND UPPER(IFNULL(patient_type, '')) IN ('IP', 'IPD')" : ''}
          GROUP BY ${key}
        ) latest ON latest.latest_id = d.id`, batch);
      details.push(...found as Record<string, unknown>[]);
    }
    return mergeFdhClaimDetails(rows, details, patientType);
  } finally { connection.release(); }
};

// ฟังก์ชันดึงข้อมูล Visit ที่เข้าข่ายส่งเบิก FDH
export const getEligibleVisits = async (
  startDate?: string,
  endDate?: string,
  fund?: string,
  applyLimit: boolean = true,
  targetVns?: string[]
): Promise<Record<string, unknown>[]> => {
  const connection = await getUTFConnection();
  try {
    const hospitalCode = (await readHospitalIdentity(connection)).hospital_code;
    if (!/^\d{5}$/.test(hospitalCode)) throw new Error('ไม่พบรหัสหน่วยบริการใน opdconfig');

    let walkinIcode = '';
    let walkinPttypes: string[] = [];
    try {
      const siteSettings = await getAppSetting<Record<string, unknown>>('site_settings');
      if (siteSettings?.uc_walkin_icode) {
        walkinIcode = String(siteSettings.uc_walkin_icode).trim();
      }
      if (Array.isArray(siteSettings?.uc_walkin_pttypes)) {
        walkinPttypes = (siteSettings.uc_walkin_pttypes as string[])
          .map(s => String(s).trim())
          .filter(s => /^[A-Za-z0-9]+$/.test(s));
      }
    } catch {
      // safe fallback if app_settings is not ready
    }

    let query = `
      SELECT 
        ovst.vn,
        ovst.hn,
        ovst.an,
        DATE_FORMAT(ovst.vstdate, '%Y-%m-%d') as serviceDate,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patientName,
        COALESCE(v.sex, pt.sex) as sex,
        v.age_y as age,
        pt.cid,
        pttype.name as fund,
        ovst.pttype as pttype_code,
        pttype.hipdata_code,
        ovst.vsttime,
        
        -- กองทุนพิเศษ Subqueries
        -- บริการจัดการ Tag พื้นฐาน
        CASE
          WHEN ${walkinIcode ? `EXISTS (SELECT 1 FROM opitemrece oo WHERE oo.vn = ovst.vn AND oo.icode = '${walkinIcode.replace(/'/g, "''")}' LIMIT 1) OR ` : ''}EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems sd ON sd.icode = oo.icode WHERE oo.vn = ovst.vn AND (sd.nhso_adp_code = 'WALKIN' OR UPPER(sd.name) LIKE '%WALKIN%' OR UPPER(sd.name) LIKE '%เหตุสมควร%') LIMIT 1) OR EXISTS (SELECT 1 FROM opitemrece oo JOIN nondrugitems nd ON nd.icode = oo.icode WHERE oo.vn = ovst.vn AND (UPPER(nd.name) LIKE '%WALKIN%' OR UPPER(nd.name) LIKE '%เหตุสมควร%') LIMIT 1)
          THEN 1
          ELSE 0
        END as has_walkin,
        ${walkinPttypes.length > 0 ? `CASE WHEN ovst.pttype IN (${walkinPttypes.map(p => `'${p}'`).join(',')}) THEN 1 ELSE 0 END` : '0'} as is_walkin_pttype,
        CASE WHEN ${buildTelemedExistsSql('ovst', 'ovstist')} THEN 1 ELSE 0 END as has_telmed,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '${businessRules.adp_codes.drugp}' LIMIT 1) as has_drugp,
        (SELECT COUNT(DISTINCT oo.icode)
          FROM opitemrece oo
          JOIN drugitems di ON di.icode = oo.icode
          LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
          WHERE oo.vn = ovst.vn
            AND COALESCE(sd.nhso_adp_code, '') <> '${businessRules.adp_codes.drugp}'
            AND COALESCE(oo.qty, 0) > 0) as drug_count,
        (SELECT 1 FROM opitemrece oo JOIN drugitems di ON di.icode = oo.icode WHERE oo.vn = ovst.vn AND di.sks_product_category_id IN (3,4) AND di.ttmt_code IS NOT NULL LIMIT 1) as has_herb,
        (SELECT 1 FROM opitemrece oo JOIN nondrugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_type_id = 2 LIMIT 1) as has_instrument,
        (SELECT 1 FROM health_med_service s JOIN health_med_service_operation op ON op.health_med_service_id = s.health_med_service_id JOIN health_med_operation_item i ON i.health_med_operation_item_id = op.health_med_operation_item_id WHERE s.vn = ovst.vn AND REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835') LIMIT 1) as has_knee_oper,
        
        -- คัดกรองความเสี่ยง
        CASE WHEN v.age_y BETWEEN 35 AND 59 THEN 1 ELSE 0 END as fpg_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12003' LIMIT 1) THEN 1 ELSE 0 END as has_fpg_adp,
        CASE WHEN ${buildFpgLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_fpg_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', FPG_DX_CODES)} THEN 1 ELSE 0 END as has_fpg_diag,
        CASE
          WHEN v.age_y BETWEEN 35 AND 59
            AND EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12003' LIMIT 1)
            AND ${buildFpgLabExistsSql('ovst')}
            AND ${buildDiagnosisMatchSql('ovst', 'v', FPG_DX_CODES)}
            THEN 1
          ELSE 0
        END as has_fpg,
        CASE WHEN v.age_y BETWEEN 45 AND 70 THEN 1 ELSE 0 END as chol_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12004' LIMIT 1) THEN 1 ELSE 0 END as has_chol_adp,
        CASE WHEN ${buildCholLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_chol_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', CHOL_DX_CODES)} THEN 1 ELSE 0 END as has_chol_diag,
        CASE
          WHEN v.age_y BETWEEN 45 AND 70
            AND EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12004' LIMIT 1)
            AND ${buildCholLabExistsSql('ovst')}
            AND ${buildDiagnosisMatchSql('ovst', 'v', CHOL_DX_CODES)}
            THEN 1
          ELSE 0
        END as has_chol,
        CASE WHEN ${buildAnemiaAgeEligibleSql('ovst')} THEN 1 ELSE 0 END as anemia_age_eligible,
        ${buildAnemiaAgeBandSql('ovst')} as anemia_age_band,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '13001' LIMIT 1) THEN 1 ELSE 0 END as has_anemia_adp,
        CASE WHEN ${buildAnemiaCbcExistsSql('ovst')} THEN 1 ELSE 0 END as has_anemia_cbc,
        CASE WHEN ${buildAnemiaHbHctExistsSql('ovst')} THEN 1 ELSE 0 END as has_anemia_hbhct,
        CASE WHEN ${buildAnemiaLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_anemia_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} THEN 1 ELSE 0 END as has_anemia_diag,
        CASE
          WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '13001' LIMIT 1)
            THEN 1
          WHEN v.age_y BETWEEN 13 AND 24 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaCbcExistsSql('ovst')}
            THEN 1
          WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ovst.vstdate) BETWEEN 6 AND 12 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaHbHctExistsSql('ovst')}
            THEN 1
          WHEN v.age_y BETWEEN 3 AND 6 AND ${buildDiagnosisMatchSql('ovst', 'v', ANEMIA_DX_CODES)} AND ${buildAnemiaHbHctExistsSql('ovst')}
            THEN 1
          ELSE 0
        END as has_anemia,
        CASE WHEN COALESCE(v.sex, pt.sex) = '2' AND v.age_y BETWEEN 13 AND 45 THEN 1 ELSE 0 END as iron_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '14001' LIMIT 1) THEN 1 ELSE 0 END as has_iron_adp,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)} THEN 1 ELSE 0 END as has_iron_diag,
        CASE
          WHEN COALESCE(v.sex, pt.sex) = '2' AND v.age_y BETWEEN 13 AND 45
            AND EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '14001' LIMIT 1)
            AND ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)}
            THEN 1
          ELSE 0
        END as has_iron,
        CASE WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ovst.vstdate) BETWEEN 6 AND 12 THEN 1 ELSE 0 END as ferrokid_age_eligible,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)} THEN 1 ELSE 0 END as has_ferrokid_diag,
        CASE WHEN ${buildFerrokidMedExistsSql('ovst')} THEN 1 ELSE 0 END as has_ferrokid_med,
        CASE
          WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ovst.vstdate) BETWEEN 6 AND 12
            AND ${buildDiagnosisMatchSql('ovst', 'v', IRON_DX_CODES)}
            AND ${buildFerrokidMedExistsSql('ovst')}
            THEN 1
          ELSE 0
        END as has_ferrokid,
        
        -- แม่และเด็ก/ANC
        CASE WHEN ${buildPregLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_preg_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', UPT_DX_CODES)} THEN 1 ELSE 0 END as has_preg_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30014' LIMIT 1) THEN 1 ELSE 0 END as has_preg_item,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30014' LIMIT 1) as has_upt,
        (SELECT GROUP_CONCAT(DISTINCT REPLACE(UPPER(dx.icd10), '.', '') ORDER BY dx.icd10 SEPARATOR ', ')
          FROM ovstdiag dx
          WHERE dx.vn = ovst.vn
            AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z320', 'Z321')) as preg_diags,
        CASE WHEN EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.anc}' LIMIT 1) THEN 1 ELSE 0 END as has_anc_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN (${(businessRules.adp_codes.anc as string[]).map(code => `'${code}'`).join(',')}) LIMIT 1) THEN 1 ELSE 0 END as has_anc_adp,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30011' LIMIT 1) as has_anc_visit,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30010' LIMIT 1) as has_anc_us,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30012' LIMIT 1) as has_anc_lab1,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30013' LIMIT 1) as has_anc_lab2,
        CASE WHEN ${buildAncLab1CompleteSql('ovst')} THEN 1 ELSE 0 END as anc_lab1_complete,
        CASE WHEN ${buildAncLab2CompleteSql('ovst')} THEN 1 ELSE 0 END as anc_lab2_complete,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.cbc)} THEN 1 ELSE 0 END as anc_lab1_cbc,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.dcip)} THEN 1 ELSE 0 END as anc_lab1_dcip,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.abo)} THEN 1 ELSE 0 END as anc_lab1_abo,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.rh)} THEN 1 ELSE 0 END as anc_lab1_rh,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.hbsag)} THEN 1 ELSE 0 END as anc_lab1_hbsag,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.syphilis)} THEN 1 ELSE 0 END as anc_lab1_syphilis,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_1_REGEX.hiv)} THEN 1 ELSE 0 END as anc_lab1_hiv,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_2_REGEX.hiv)} THEN 1 ELSE 0 END as anc_lab2_hiv,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_2_REGEX.syphilis)} THEN 1 ELSE 0 END as anc_lab2_syphilis,
        CASE WHEN ${buildServiceOrLabNameExistsSql('ovst', ANC_LAB_2_REGEX.cbc)} THEN 1 ELSE 0 END as anc_lab2_cbc,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30008' LIMIT 1) as has_anc_dental_exam,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30009' LIMIT 1) as has_anc_dental_clean,
        CASE WHEN EXISTS (
          SELECT 1
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
            AND COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
              IN (${ANC_DENTAL_EXAM_PROCEDURE_CODES_SQL})
            AND REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), '')), '.', '') = '${ANC_DENTAL_EXAM_ICD9}'
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_anc_dental_exam_procedure,
        CASE WHEN EXISTS (
          SELECT 1
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
            AND COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
              IN (${ANC_DENTAL_CLEAN_PROCEDURE_CODES_SQL})
            AND REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), '')), '.', '') = '${ANC_DENTAL_CLEAN_ICD9}'
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_anc_dental_clean_procedure,
        (
          SELECT GROUP_CONCAT(
            DISTINCT COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
            ORDER BY dm.tm_no SEPARATOR ', '
          )
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
        ) as dental_procedure_codes,
        (
          SELECT GROUP_CONCAT(DISTINCT CONCAT(
            COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(dm.icd9), ''), dm.tmcode),
            ':', REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), ''), ''), '.', '')
          ) ORDER BY dm.tm_no SEPARATOR ', ')
          FROM dtmain dm
          LEFT JOIN dttm tm ON tm.code = dm.tmcode
          WHERE dm.vn = ovst.vn
        ) as dental_procedure_pairs,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', POSTNATAL_CARE_DX_CODES)} THEN 1 ELSE 0 END as has_pp_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN ('30015','30016') LIMIT 1) THEN 1 ELSE 0 END as has_pp_adp,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30015' LIMIT 1) as has_post_care,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '30016' LIMIT 1) as has_post_supp,
        (SELECT GROUP_CONCAT(DISTINCT d.nhso_adp_code ORDER BY d.nhso_adp_code SEPARATOR ', ')
          FROM opitemrece oo
          JOIN s_drugitems d ON d.icode = oo.icode
          WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN ('30015', '30016')) as pp_adp_codes,
        CASE WHEN ${buildPostIronMedExistsSql('ovst')} THEN 1 ELSE 0 END as has_post_iron_med,
        
        -- ป้องกันและคุมกำเนิด
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '15001' LIMIT 1) as has_fluoride,
        CASE WHEN EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.fp}' LIMIT 1) THEN 1 ELSE 0 END as has_fp_diag,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.fp_regex}' LIMIT 1) THEN 1 ELSE 0 END as has_fp_adp,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN ('FP003_1','FP003_2','FP003_3') LIMIT 1) as has_fp_pill,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = 'FP003_4' LIMIT 1) as has_fp_condom,
        (SELECT COALESCE(SUM(COALESCE(oo.qty, 0)), 0) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=ovst.hn AND YEAR(fy.vstdate)=YEAR(ovst.vstdate) AND d.nhso_adp_code='FP003_3') as fp_emergency_year_qty,
        (SELECT COUNT(DISTINCT oo.vn) FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode JOIN ovst fy ON fy.vn=oo.vn WHERE fy.hn=ovst.hn AND YEAR(fy.vstdate)=YEAR(ovst.vstdate) AND d.nhso_adp_code='FP003_4') as fp_injection_year_count,
        
        -- ตรวจมะเร็งปากมดลูก (เดิม)
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '${businessRules.diagnosis_patterns.cx}' LIMIT 1) as has_cx_diag,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code REGEXP '${businessRules.adp_codes.cx_regex}' LIMIT 1) as has_cx_adp,
        
        -- Palliative/Other Specialized
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 IN (${businessRules.diagnosis_patterns.palliative.map(c => `'${c}'`).join(',')}) LIMIT 1) as has_pal_diag,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN (${businessRules.adp_codes.palliative.map(c => `'${c}'`).join(',')}) LIMIT 1) as has_pal_adp,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z511|^Z512' LIMIT 1) as has_chemo_diag,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^B182' LIMIT 1) as has_hepc_diag,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z50' LIMIT 1) as has_rehab_diag,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z49' LIMIT 1) as has_crrt_diag,
        (SELECT 1 FROM opitemrece oo JOIN nondrugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.name LIKE '%robot%' LIMIT 1) as has_robot_item,
        (SELECT 1 FROM ovstdiag dx WHERE dx.vn = ovst.vn AND dx.icd10 REGEXP '^Z510' LIMIT 1) as has_proton_diag,
        (SELECT 1 FROM opitemrece oo JOIN nondrugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.name LIKE '%chest x-ray%' LIMIT 1) as has_cxr_item,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%' OR d.nhso_adp_code = '3799977101') LIMIT 1) as has_clopidogrel,

        
        -- ตรวจสอบเงื่อนไข 6 ข้อ
        CASE WHEN pt.cid IS NOT NULL AND pt.cid != '' AND LENGTH(pt.cid) = 13 THEN 1 ELSE 0 END as has_cid,
        
        -- ตรวจสอบการลงวินิจฉัย (ICD-10)
        CASE WHEN (SELECT icd10 FROM ovstdiag WHERE vn = ovst.vn AND diagtype = '1' LIMIT 1) IS NOT NULL THEN 1 ELSE 0 END as has_diagnosis,
        (SELECT icd10 FROM ovstdiag WHERE vn = ovst.vn AND diagtype = '1' LIMIT 1) as main_diag,
        
        -- ตรวจสอบใบเสร็จและราคา
        CASE WHEN (SELECT SUM(sum_price) FROM opitemrece WHERE vn = ovst.vn) > 0 THEN 1 ELSE 0 END as has_receipt,
        COALESCE((SELECT SUM(sum_price) FROM opitemrece WHERE vn = ovst.vn), 0) as total_price,
        
        -- วิเคราะห์ Project Code (อ้างอิง FDH Ver 3.0)
        CASE 
          WHEN (SELECT icd10 FROM ovstdiag WHERE vn = ovst.vn AND diagtype = '1' LIMIT 1) REGEXP '${businessRules.diagnosis_patterns.cancer}' THEN 'CANCER' -- มะเร็งไปรับบริการที่ไหนก็ได้
          WHEN (pttype.name LIKE '%อุบัติเหตุ%' OR ovst.pt_subtype = '7') THEN 'OP AE' -- อุบัติเหตุ/ฉุกเฉิน
          WHEN (pttype.name LIKE '%สุขภาพ%' OR pttype.name LIKE '%บัตรทอง%' OR pttype.name = 'UCS') AND ovst.hospmain != '${hospitalCode}' THEN 'OPANY'
          ELSE ''
        END as project_code,
        
        -- PP = Authen, EP = ปิดสิทธิ
        CASE
          WHEN COALESCE(
            (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^PP' LIMIT 1),
            (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^PP' LIMIT 1)
          ) IS NOT NULL THEN 1 ELSE 0
        END as has_authen,
        COALESCE(
          (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^PP' LIMIT 1),
          (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^PP' LIMIT 1),
          ''
        ) as authen_code,
        CASE
          WHEN COALESCE(
            (SELECT nhso_authen_code FROM nhso_confirm_privilege WHERE vn = ovst.vn AND nhso_status = 'Y' AND nhso_authen_code REGEXP '^EP' LIMIT 1),
            (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^EP' LIMIT 1),
            (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^EP' LIMIT 1)
          ) IS NOT NULL THEN 1 ELSE 0
        END as has_close,
        COALESCE(
          (SELECT nhso_authen_code FROM nhso_confirm_privilege WHERE vn = ovst.vn AND nhso_status = 'Y' AND nhso_authen_code REGEXP '^EP' LIMIT 1),
          (SELECT claim_code FROM authenhos WHERE vn = ovst.vn AND claim_code REGEXP '^EP' LIMIT 1),
          (SELECT auth_code FROM visit_pttype WHERE vn = ovst.vn AND auth_code REGEXP '^EP' LIMIT 1),
          ''
        ) as close_code,
        COALESCE(
          (SELECT nhso_status FROM nhso_confirm_privilege WHERE vn = ovst.vn LIMIT 1),
          ''
        ) as close_status,
        COALESCE(
          NULLIF(NULL, ''),
          NULLIF(CONVERT(fdh.fdh_reservation_status USING utf8mb4) COLLATE utf8mb4_unicode_ci, ''),
          NULLIF(CONVERT(fdh.fdh_claim_status_message USING utf8mb4) COLLATE utf8mb4_unicode_ci, ''),
          IF(fdh.transaction_uid IS NOT NULL, 'ส่ง FDH แล้ว', NULL)
        ) as fdh_status_label,
        NULL as fdh_claim_detail_status,
        NULL as fdh_claim_code,
        NULL as fdh_upload_uid,
        NULL as fdh_sent_at,
        fdh.fdh_reservation_status,
        fdh.fdh_claim_status_message,
        fdh.error_code as fdh_error_code,
        fdh.updated_at as fdh_updated_at

      FROM ovst
      LEFT JOIN patient pt ON ovst.hn = pt.hn
      LEFT JOIN pttype ON ovst.pttype = pttype.pttype
      LEFT JOIN vn_stat v ON v.vn = ovst.vn
      LEFT JOIN ovstist ON ovstist.ovstist = ovst.ovstist
      LEFT JOIN (
        SELECT s.*
        FROM fdh_claim_status s
        JOIN (
          SELECT vn, MAX(updated_at) AS latest_updated_at
          FROM fdh_claim_status
          WHERE IFNULL(vn, '') <> ''
          GROUP BY vn
        ) latest ON latest.vn = s.vn AND latest.latest_updated_at = s.updated_at
      ) fdh ON fdh.vn = ovst.vn
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (targetVns && targetVns.length > 0) {
      const sanitizedVns = targetVns.map(v => String(v).trim()).filter(Boolean);
      if (sanitizedVns.length > 0) {
        query += ` AND ovst.vn IN (${sanitizedVns.map(() => '?').join(',')})`;
        params.push(...sanitizedVns);
      }
    } else {
      if (startDate) {
        query += ` AND ovst.vstdate >= ?`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND ovst.vstdate <= ?`;
        params.push(endDate);
      }
    }

    if (fund && fund !== 'ทั้งหมด' && fund !== '') {
      query += ` AND pttype.name = ?`;
      params.push(fund);
    }

    query += ` ORDER BY ovst.vstdate DESC, ovst.vsttime DESC`;
    if (applyLimit && (!targetVns || targetVns.length === 0)) {
      query += ` LIMIT ${businessRules.query_limits.default_limit}`;
    }

    const [rows] = await connection.query(query, params);
    return await attachLatestFdhClaimDetails((Array.isArray(rows) ? rows : []) as Record<string, unknown>[], 'OPD');
  } finally {
    connection.release();
  }
};

export interface FdhExportOptions {
  patientType?: 'ALL' | 'OPD' | 'IPD';
  profile?: FdhExportProfile;
  fcodeByHn?: Record<string, string>;
  uucByVn?: Record<string, string>;
}

// ฟังก์ชันดึงข้อมูลแบบละเอียดสำหรับส่งออก 16 แฟ้ม (FDH)
export const getExportData = async (vns: string[], options: FdhExportOptions = {}) => {
  if (!vns || vns.length === 0) return null;

  const connection = await getUTFConnection();
  try {
    // 🏥 1. Get hospital code from config (Check multiple column variations)
    const validHcode = (value: unknown) => {
      const normalized = String(value ?? '').trim();
      return /^\d{5}$/.test(normalized) && normalized !== '00000' ? normalized : '';
    };
    const hcode = validHcode((await readHospitalIdentity(connection)).hospital_code);
    if (!hcode) throw new Error('ไม่พบรหัสหน่วยบริการที่ถูกต้องใน opdconfig กรุณาตรวจสอบ HIS ก่อนส่งออก');

    const profile = options.profile === 'fwf-migrants' ? 'fwf-migrants' : 'standard';
    const isIpdExport = options.patientType === 'IPD';
    const fcodeByHn = options.fcodeByHn || {};
    const uucByVn = options.uucByVn || {};
    console.log(`📦 Generating 16-file export data for ${vns.length} visits (HCODE: ${hcode}, profile: ${profile})...`);

    // Helper to wrap queries for debugging
    const runQuery = async (name: string, query: string, params: any[]) => {
      try {
        const [rows] = await connection.query(query, params);
        return rows;
      } catch (err) {
        console.error(`❌ Error in ${name} query:`, err);
        return []; // Return empty instead of failing entire export
      }
    };

    // 1. INS (Insurance)
    const ins = await runQuery('INS', `
      SELECT 
        ovst.hn AS HN,
        COALESCE(pttype.hipdata_code, '') AS INSCL,
        COALESCE(pttype.pttype, '') AS SUBTYPE,
        COALESCE(pt.cid, '') AS CID,
        ? AS HCODE,
        DATE_FORMAT(ovst.vstdate, '%Y%m%d') AS DATEIN,
        DATE_FORMAT(COALESCE(vp.expire_date, ovst.vstdate), '%Y%m%d') AS DATEEXP,
        COALESCE(NULLIF(ovst.hospmain, ''), ?) AS HOSPMAIN,
        COALESCE(NULLIF(ovst.hospsub, ''), COALESCE(NULLIF(ovst.hospmain, ''), ?)) AS HOSPSUB,
        '' AS GOVCODE,
        '' AS GOVNAME,
        COALESCE(NULLIF(auth.claim_code, ''), NULLIF(vp.auth_code, ''), NULLIF(ncp.nhso_authen_code, ''), '') AS PERMITNO,
        '' AS DOCNO,
        '' AS OWNRPID,
        '' AS OWNNAME,
        COALESCE(ovst.an, '') AS AN,
        ovst.vn AS SEQ,
        '' AS SUBINSCL,
        '' AS RELINSCL,
        '' AS HTYPE
      FROM ovst
      JOIN patient pt ON ovst.hn = pt.hn
      JOIN pttype ON ovst.pttype = pttype.pttype
      LEFT JOIN visit_pttype vp ON ovst.vn = vp.vn AND ovst.pttype = vp.pttype
      LEFT JOIN (
        SELECT vn, MAX(claim_code) AS claim_code FROM authenhos GROUP BY vn
      ) auth ON ovst.vn = auth.vn
      LEFT JOIN (
        SELECT vn, MAX(NULLIF(nhso_authen_code, '')) AS nhso_authen_code
        FROM nhso_confirm_privilege
        WHERE nhso_status = 'Y'
        GROUP BY vn
      ) ncp ON ovst.vn = ncp.vn
      WHERE ovst.vn IN (?)
    `, [hcode, hcode, hcode, vns]);

    // 2. PAT (Patient)
    const pat = await runQuery('PAT', `
      SELECT 
        ? as HCODE,
        pt.hn as HN,
        pt.chwpart as CHANGWAT,
        pt.amppart as AMPHUR,
        DATE_FORMAT(pt.birthday, '%Y%m%d') as DOB,
        pt.sex as SEX,
        pt.marrystatus as MARRIAGE,
        pt.occupation as OCCUPA,
        LPAD(COALESCE(pt.nationality, ''), 3, '0') as NATION,
        CASE
          WHEN COALESCE(pt.nationality, '') <> '99' AND COALESCE(pt.passport_no, '') <> '' THEN pt.passport_no
          ELSE pt.cid
        END as PERSON_ID,
        CONCAT(COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, ''), ',', COALESCE(pt.pname, '')) as NAMEPAT,
        pt.pname as TITLE,
        pt.fname as FNAME,
        pt.lname as LNAME,
        CASE
          WHEN COALESCE(pt.nationality, '') <> '99' AND COALESCE(pt.passport_no, '') <> '' THEN '2'
          ELSE '1'
        END as IDTYPE
      FROM patient pt
      WHERE pt.hn IN (SELECT hn FROM ovst WHERE vn IN (?))
    `, [hcode, vns]);

    // 3. OPD (Visit)
    const opd = await runQuery('OPD', `
      SELECT 
        o.hn AS HN,
        COALESCE(sp.provis_code, o.main_dep, '') AS CLINIC,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEOPD,
        DATE_FORMAT(o.vsttime, '%H%i') AS TIMEOPD,
        o.vn AS SEQ,
        '1' AS UUC,
        COALESCE(s.cc, '') AS DETAIL,
        NULLIF(s.temperature, 0) AS BTEMP,
        NULLIF(s.bps, 0) AS SBP,
        NULLIF(s.bpd, 0) AS DBP,
        NULLIF(s.pulse, 0) AS PR,
        NULLIF(s.rr, 0) AS RR,
        CASE
          WHEN ri.vn IS NOT NULL THEN '0'
          WHEN ro.vn IS NOT NULL THEN '1'
          WHEN UPPER(COALESCE(ept.ucae, '')) = 'A' THEN '2'
          WHEN UPPER(COALESCE(ept.ucae, '')) = 'E' THEN '3'
          ELSE ''
        END AS OPTYPE,
        COALESCE(oi.export_code, '1') AS TYPEIN,
        COALESCE(oo.export_code, '') AS TYPEOUT
      FROM ovst o
      LEFT JOIN opdscreen s ON o.vn = s.vn
      LEFT JOIN spclty sp ON sp.spclty = o.spclty
      LEFT JOIN ovstist oi ON oi.ovstist = o.ovstist
      LEFT JOIN ovstost oo ON oo.ovstost = o.ovstost
      LEFT JOIN referin ri ON ri.vn = o.vn
      LEFT JOIN referout ro ON ro.vn = o.vn
      LEFT JOIN er_regist er ON er.vn = o.vn
      LEFT JOIN er_pt_type ept ON ept.er_pt_type = er.er_pt_type
      WHERE o.vn IN (?)
    `, [vns]);

    // 4. ORF (Refer Out)
    const orf = await runQuery('ORF', `
      SELECT 
        base.HN,
        DATE_FORMAT(base.DATEOPD, '%Y%m%d') AS DATEOPD,
        base.CLINIC,
        base.REFER,
        base.REFERTYPE,
        base.SEQ,
        DATE_FORMAT(base.REFERDATE, '%Y%m%d') AS REFERDATE
      FROM (
        SELECT
          o.hn AS HN,
          COALESCE(ri.refer_date, o.vstdate) AS DATEOPD,
          COALESCE(sp.provis_code, o.main_dep, '') AS CLINIC,
          COALESCE(ri.refer_hospcode, o.rfrilct, '') AS REFER,
          '1' AS REFERTYPE,
          o.vn AS SEQ,
          COALESCE(ri.refer_date, o.vstdate) AS REFERDATE
        FROM ovst o
        LEFT JOIN ovstist ist ON ist.ovstist = o.ovstist
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN referin ri ON ri.vn = o.vn
        WHERE o.vn IN (?) AND (ist.export_code = 3 OR ri.vn IS NOT NULL)
        UNION ALL
        SELECT
          o.hn AS HN,
          COALESCE(ro.refer_date, o.vstdate) AS DATEOPD,
          COALESCE(sp.provis_code, o.main_dep, '') AS CLINIC,
          COALESCE(ro.refer_hospcode, o.rfrolct, '') AS REFER,
          '2' AS REFERTYPE,
          o.vn AS SEQ,
          COALESCE(ro.refer_date, o.vstdate) AS REFERDATE
        FROM ovst o
        LEFT JOIN ovstost ost ON ost.ovstost = o.ovstost
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN referout ro ON ro.vn = o.vn
        WHERE o.vn IN (?) AND (ost.export_code = 3 OR ro.vn IS NOT NULL)
      ) base
      WHERE COALESCE(base.REFER, '') <> ''
    `, [vns, vns]);

    // 5. ODX (Diagnosis)
    const odx = await runQuery('ODX', `
      SELECT 
        o.hn AS HN,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEDX,
        COALESCE(sp.provis_code, o.main_dep, '') AS CLINIC,
        dx.icd10 AS DIAG,
        dx.diagtype AS DXTYPE,
        dx.doctor AS DRDX,
        COALESCE(pt.cid, '') AS PERSON_ID,
        dx.vn AS SEQ
      FROM ovstdiag dx
      JOIN ovst o ON dx.vn = o.vn
      LEFT JOIN spclty sp ON sp.spclty = o.spclty
      LEFT JOIN patient pt ON o.hn = pt.hn
      WHERE dx.vn IN (?) AND dx.icd10 NOT REGEXP '^[0-9]'
    `, [vns]);

    // 6. OOP (Procedures)
    const oop = await runQuery('OOP', `
      SELECT DISTINCT * FROM (
        SELECT 
          o.hn AS HN,
          DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEOPD,
          COALESCE(sp.provis_code, o.main_dep, '') AS CLINIC,
          dx.icd10 AS OPER,
          dx.doctor AS DROPID,
          COALESCE(pt.cid, '') AS PERSON_ID,
          o.vn AS SEQ,
          '' AS SERVPRICE,
          1 AS _SOURCE_PRIORITY
        FROM ovstdiag dx
        JOIN ovst o ON dx.vn = o.vn
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN patient pt ON o.hn = pt.hn
        WHERE dx.vn IN (?) AND dx.icd10 REGEXP '^[0-9]'
        UNION ALL
        SELECT 
          o.hn AS HN,
          DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEOPD,
          COALESCE(sp.provis_code, o.main_dep, '') AS CLINIC,
          COALESCE(eoc.icd9cm, eoc.icd10tm, '') AS OPER,
          dro.doctor AS DROPID,
          COALESCE(pt.cid, '') AS PERSON_ID,
          o.vn AS SEQ,
          '' AS SERVPRICE,
          2 AS _SOURCE_PRIORITY
        FROM doctor_operation dro
        JOIN ovst o ON dro.vn = o.vn
        LEFT JOIN er_oper_code eoc ON eoc.er_oper_code = dro.er_oper_code
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN patient pt ON o.hn = pt.hn
        WHERE dro.vn IN (?) AND COALESCE(eoc.icd9cm, eoc.icd10tm, '') <> ''
        UNION ALL
        SELECT
          o.hn AS HN,
          DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEOPD,
          COALESCE(sp.provis_code, o.main_dep, '') AS CLINIC,
          COALESCE(
            NULLIF(TRIM(tm.icd10tm_operation_code), ''),
            NULLIF(TRIM(tm.icd9cm), ''),
            NULLIF(TRIM(dm.icd9), '')
          ) AS OPER,
          dm.doctor AS DROPID,
          COALESCE(pt.cid, '') AS PERSON_ID,
          o.vn AS SEQ,
          '' AS SERVPRICE,
          3 AS _SOURCE_PRIORITY
        FROM dtmain dm
        JOIN ovst o ON dm.vn = o.vn
        LEFT JOIN dttm tm ON tm.code = dm.tmcode
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN patient pt ON o.hn = pt.hn
        WHERE dm.vn IN (?)
          AND COALESCE(
            NULLIF(TRIM(tm.icd10tm_operation_code), ''),
            NULLIF(TRIM(tm.icd9cm), ''),
            NULLIF(TRIM(dm.icd9), '')
          ) <> ''
      ) base
    `, [vns, vns, vns]);

    // 7. IPD (Admission)
    const ipd = await runQuery('IPD', `
      SELECT 
        i.hn AS HN,
        i.an AS AN,
        DATE_FORMAT(i.regdate, '%Y%m%d') AS DATEADM,
        DATE_FORMAT(i.regtime, '%H%i') AS TIMEADM,
        DATE_FORMAT(i.dchdate, '%Y%m%d') AS DATEDSC,
        DATE_FORMAT(i.dchtime, '%H%i') AS TIMEDSC,
        COALESCE(ds.nhso_dchstts, i.dchstts) AS DISCHS,
        COALESCE(dt.nhso_dchtype, i.dchtype) AS DISCHT,
        i.ward AS WARDDSC,
        COALESCE(sp.nhso_code, '01') AS DEPT,
        COALESCE(i.bw, 0) / 1000 AS ADM_W,
        '1' AS UUC,
        CASE WHEN it.is_ambulatory = 'Y' THEN 'A' ELSE 'I' END AS SVCTYPE
      FROM ipt i
      LEFT JOIN dchstts ds ON ds.dchstts = i.dchstts
      LEFT JOIN dchtype dt ON dt.dchtype = i.dchtype
      LEFT JOIN spclty sp ON sp.spclty = i.spclty
      LEFT JOIN ipt_type it ON it.ipt_type = i.ipt_type
      WHERE i.vn IN (?)
    `, [vns]);

    // 8. IRF (Refer IPD)
    const irf = await runQuery('IRF', `
      SELECT AN, REFER, REFERTYPE
      FROM (
        SELECT
          i.an AS AN,
          COALESCE(ro.refer_hospcode, i.rfrolct, '') AS REFER,
          '2' AS REFERTYPE
        FROM ipt i
        LEFT JOIN dchtype dt ON dt.dchtype = i.dchtype
        LEFT JOIN referout ro ON ro.vn = i.vn
        WHERE i.vn IN (?) AND (dt.nhso_dchtype = 4 OR ro.vn IS NOT NULL)
        UNION ALL
        SELECT
          i.an AS AN,
          COALESCE(ri.refer_hospcode, i.rfrilct, '') AS REFER,
          '1' AS REFERTYPE
        FROM ipt i
        LEFT JOIN ovstist ist ON ist.ovstist = i.ivstist
        LEFT JOIN referin ri ON ri.vn = i.vn
        WHERE i.vn IN (?) AND (ist.export_code = 3 OR ri.vn IS NOT NULL)
      ) base
      WHERE COALESCE(REFER, '') <> ''
    `, [vns, vns]);

    // 9. IDX (Diagnosis IPD)
    const idx = await runQuery('IDX', `
      SELECT 
        an as AN,
        icd10 as DIAG,
        diagtype as DXTYPE,
        doctor as DRDX
      FROM iptdiag
      WHERE an IN (SELECT an FROM ipt WHERE vn IN (?))
    `, [vns]);

    // 10. IOP (Procedures IPD)
    // ใช้ iptoprt ให้สอดคล้องกับตารางที่ระบบใช้จริงในส่วน IPD chart review
    const iop = await runQuery('IOP', `
      SELECT 
        op.an AS AN,
        op.icd9 AS OPER,
        COALESCE(op.oper_type, '1') AS OPTYPE,
        op.doctor AS DROPID,
        DATE_FORMAT(COALESCE(op.opdate, i.regdate), '%Y%m%d') AS DATEIN,
        DATE_FORMAT(COALESCE(op.optime, i.regtime), '%H%i') AS TIMEIN,
        DATE_FORMAT(CASE WHEN op.enddate < op.opdate THEN op.opdate ELSE COALESCE(op.enddate, op.opdate, i.dchdate) END, '%Y%m%d') AS DATEOUT,
        DATE_FORMAT(COALESCE(op.endtime, op.optime, i.dchtime), '%H%i') AS TIMEOUT
      FROM iptoprt op
      JOIN ipt i ON i.an = op.an
      WHERE i.vn IN (?) AND COALESCE(op.icd9, '') <> ''
    `, [vns]);

    // 11. CHT (Financial Summary)
    const cht = await runQuery('CHT', `
      SELECT 
        o.hn AS HN,
        COALESCE(NULLIF(o.an, ''), NULLIF(i.an, ''), '') AS AN,
        DATE_FORMAT(COALESCE(i.dchdate, o.vstdate), '%Y%m%d') AS DATE,
        SUM(COALESCE(oo.sum_price, 0)) AS TOTAL,
        SUM(CASE WHEN oo.paidst IN ('01', '03') THEN COALESCE(oo.sum_price, 0) ELSE 0 END) AS PAID,
        o.pttype AS PTTYPE,
        COALESCE(pt.cid, '') AS PERSON_ID,
        o.vn AS SEQ,
        '' AS OPD_MEMO,
        COALESCE(
          MAX(NULLIF(oo.finance_number, '')),
          CONCAT(?, '-', COALESCE(NULLIF(o.an, ''), o.vn))
        ) AS INVOICE_NO,
        '' AS INVOICE_LT
      FROM ovst o
      LEFT JOIN ipt i ON i.vn = o.vn
      LEFT JOIN opitemrece oo ON ${isIpdExport ? 'oo.an = i.an' : 'oo.vn = o.vn'}
      LEFT JOIN patient pt ON o.hn = pt.hn
      WHERE o.vn IN (?)
      GROUP BY o.vn, o.hn, o.an, i.an, o.vstdate, i.dchdate, o.pttype, pt.cid
    `, [hcode, vns]);

    // 12. CHA (Financial Details)
    const cha = await runQuery('CHA', `
      SELECT 
        ov.hn as HN,
        COALESCE(NULLIF(o.an, ''), NULLIF(i.an, ''), NULLIF(ov.an, ''), '') as AN,
        DATE_FORMAT(MAX(COALESCE(o.rxdate, ov.vstdate)), '%Y%m%d') as DATE,
        COALESCE(CASE WHEN o.paidst IN ('03') THEN drg.chrgitem_code2 ELSE drg.chrgitem_code1 END, LPAD(COALESCE(inc.drg_chrgitem_id, 18), 2, '0')) as CHRGITEM,
        SUM(o.sum_price) as AMOUNT,
        pt.cid as PERSON_ID,
        ov.vn as SEQ
      FROM ovst ov
      LEFT JOIN ipt i ON i.vn = ov.vn
      JOIN opitemrece o ON ${isIpdExport ? 'o.an = i.an' : 'o.vn = ov.vn'}
      JOIN patient pt ON ov.hn = pt.hn
      LEFT JOIN income inc ON inc.income = o.income
      LEFT JOIN drg_chrgitem drg ON drg.drg_chrgitem_id = inc.drg_chrgitem_id
      WHERE ov.vn IN (?)
      GROUP BY ov.vn, ov.hn, o.an, i.an, ov.an, pt.cid, CHRGITEM
    `, [vns]);

    // 13. AER (Accident/Emergency)
    const aer = await runQuery('AER', `
      SELECT
        o.hn AS HN,
        COALESCE(o.an, '') AS AN,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEOPD,
        '' AS AUTHAE,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS AEDATE,
        DATE_FORMAT(o.vsttime, '%H%i') AS AETIME,
        '' AS AETYPE,
        CONCAT_WS(',', IF(ri.vn IS NOT NULL, CONCAT('In:', ri.docno), NULL), IF(ro.vn IS NOT NULL, CONCAT('Out:', ro.refer_number), NULL)) AS REFER_NO,
        COALESCE(ri.refer_hospcode, '') AS REFMAINI,
        CASE WHEN ri.vn IS NOT NULL THEN '1100' ELSE '' END AS IREFTYPE,
        COALESCE(ro.refer_hospcode, '') AS REFMAINO,
        CASE WHEN ro.vn IS NOT NULL THEN '1100' ELSE '' END AS OREFTYPE,
        CASE WHEN ri.vn IS NOT NULL OR ro.vn IS NOT NULL THEN '' ELSE COALESCE(ept.ucae, '') END AS UCAE,
        '' AS EMTYPE,
        o.vn AS SEQ,
        '' AS AESTATUS,
        '' AS DALERT,
        '' AS TALERT
      FROM ovst o
      LEFT JOIN referin ri ON ri.vn = o.vn
      LEFT JOIN referout ro ON ro.vn = o.vn
      LEFT JOIN er_regist er ON er.vn = o.vn
      LEFT JOIN er_pt_type ept ON ept.er_pt_type = er.er_pt_type
      WHERE o.vn IN (?)
        AND (
          ri.vn IS NOT NULL
          OR ro.vn IS NOT NULL
          OR UPPER(COALESCE(ept.ucae, '')) IN ('A', 'E')
        )
    `, [vns]);

    // 14. ADP (Additionals)
    // อิงแนว export เดิมของ HOSxP: ดึงรายการจาก opitemrece + s_drugitems
    // แล้ว fallback TYPE/CODE ตามหมวด drg_chrgitem เพื่อไม่ให้ ADP ว่างเมื่อไม่ได้ map code ครบ
    const adp = await runQuery('ADP', `
      SELECT 
        base.HN,
        base.AN,
        MAX(base.DATEOPD) AS DATEOPD,
        base.TYPE,
        base.CODE,
        SUM(base.QTY) AS QTY,
        base.RATE,
        base.SEQ,
        '' AS CAGCODE,
        '' AS DOSE,
        '' AS CA_TYPE,
        '' AS SERIALNO,
        SUM(base.TOTCOPAY) AS TOTCOPAY,
        MAX(base.USE_STATUS) AS USE_STATUS,
        SUM(base.TOTAL) AS TOTAL,
        0 AS QTYDAY,
        MAX(base.TMLTCODE) AS TMLTCODE,
        '' AS STATUS1,
        MAX(base.BI) AS BI,
        MAX(base.CLINIC) AS CLINIC,
        '2' AS ITEMSRC,
        MAX(base.PROVIDER) AS PROVIDER,
        MAX(base.ICODE) AS _ICODE,
        '' AS GRAVIDA,
        '' AS GA_WEEK,
        '' AS \`DCIP/E_screen\`,
        '' AS LMP,
        '' AS SP_ITEM
      FROM (
        SELECT
          ov.hn AS HN,
          COALESCE(NULLIF(o.an, ''), NULLIF(i.an, ''), NULLIF(ov.an, ''), '') AS AN,
          DATE_FORMAT(COALESCE(o.rxdate, ov.vstdate), '%Y%m%d') AS DATEOPD,
          CASE
            WHEN inc.drg_chrgitem_id = 1 THEN '10'
            WHEN inc.drg_chrgitem_id = 5 THEN '11'
            WHEN inc.drg_chrgitem_id = 13 THEN '12'
            WHEN inc.drg_chrgitem_id = 6 THEN '14'
            WHEN inc.drg_chrgitem_id = 7 THEN '15'
            WHEN inc.drg_chrgitem_id = 8 THEN '16'
            WHEN inc.drg_chrgitem_id = 12 THEN '17'
            WHEN inc.drg_chrgitem_id = 10 THEN '18'
            WHEN inc.drg_chrgitem_id = 11 THEN '19'
            WHEN inc.drg_chrgitem_id = 14 THEN '20'
            ELSE COALESCE(NULLIF(sd.nhso_adp_type_id, ''), NULLIF(n.nhso_adp_type_id, ''), '4')
          END AS TYPE,
          CASE
            WHEN COALESCE(sd.nhso_adp_code, '') <> '' THEN sd.nhso_adp_code
            WHEN COALESCE(n.nhso_adp_code, '') <> '' THEN n.nhso_adp_code
            WHEN inc.drg_chrgitem_id = 9 THEN '51999'
            WHEN inc.drg_chrgitem_id = 10 THEN '52999'
            WHEN inc.drg_chrgitem_id = 11 THEN '72999'
            WHEN inc.drg_chrgitem_id = 12 THEN '55999'
            WHEN inc.drg_chrgitem_id = 14 THEN 'XXX14'
            WHEN inc.drg_chrgitem_id = 19 THEN 'XXX19'
            WHEN inc.drg_chrgitem_id IN (1, 5, 6, 7, 8, 13) THEN o.icode
            ELSE CONCAT('UNMAPPED:', o.icode)
          END AS CODE,
          CASE WHEN o.paidst IN ('03') THEN 0 ELSE COALESCE(o.qty, 0) END AS QTY,
          COALESCE(o.unitprice, 0) AS RATE,
          ov.vn AS SEQ,
          CASE WHEN o.paidst IN ('03') THEN COALESCE(o.sum_price, 0) ELSE 0 END AS TOTCOPAY,
          COALESCE(o.sum_price, 0) AS TOTAL,
          COALESCE(sd.tmlt_code, '') AS TMLTCODE,
          CASE WHEN COALESCE(sd.nhso_adp_type_id, n.nhso_adp_type_id, '') = '11' THEN '2' ELSE '' END AS USE_STATUS,
          '' AS BI,
          COALESCE(ov.main_dep, '') AS CLINIC,
          COALESCE(o.doctor, '') AS PROVIDER,
          o.icode AS ICODE
        FROM ovst ov
        LEFT JOIN ipt i ON i.vn = ov.vn
        JOIN opitemrece o ON ${isIpdExport ? 'o.an = i.an' : 'o.vn = ov.vn'}
        LEFT JOIN income inc ON inc.income = o.income
        LEFT JOIN s_drugitems sd ON o.icode = sd.icode
        LEFT JOIN nondrugitems n ON o.icode = n.icode
        WHERE ov.vn IN (?)
          AND (
            ${profile === 'fwf-migrants' ? 'COALESCE(o.sum_price, 0) <> 0' : 'inc.drg_chrgitem_id IN (1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19)'}
            OR COALESCE(sd.nhso_adp_code, '') <> ''
            OR COALESCE(n.nhso_adp_code, '') <> ''
            OR COALESCE(sd.nhso_adp_type_id, '') <> ''
            OR COALESCE(n.nhso_adp_type_id, '') <> ''
          )
      ) base
      WHERE COALESCE(base.CODE, '') <> ''
      GROUP BY
        base.HN,
        base.AN,
        base.TYPE,
        base.CODE,
        base.RATE,
        base.SEQ
        ${profile === 'fwf-migrants' ? ', base.ICODE' : ''}
    `, [vns]);

    // ข้อมูลครรภ์สำหรับฟิลด์ ADP ที่เพิ่มในคู่มือรุ่นปัจจุบัน
    const anc = await runQuery('ADP-ANC', `
      SELECT
        pas.vn AS SEQ,
        MAX(COALESCE(pa.preg_no, '')) AS GRAVIDA,
        MAX(COALESCE(pas.pa_week, pa.ga, '')) AS GA_WEEK,
        MAX(CASE
          WHEN UPPER(TRIM(COALESCE(pa.thalasseima_wife_dcip_result, ''))) IN ('28', 'POSITIVE', 'Y', '+') THEN '28'
          WHEN UPPER(TRIM(COALESCE(pa.thalasseima_wife_dcip_result, ''))) IN ('29', 'NEGATIVE', 'N', '-') THEN '29'
          ELSE ''
        END) AS DCIP_E_SCREEN,
        MAX(DATE_FORMAT(pa.lmp, '%Y%m%d')) AS LMP
      FROM person_anc_service pas
      JOIN person_anc pa ON pa.person_anc_id = pas.person_anc_id
      WHERE pas.vn IN (?)
      GROUP BY pas.vn
    `, [vns]);

    // FWF Migrants ใช้รหัสบริการจาก catalog fwf_item เท่านั้น ไม่ fallback เป็น icode
    const fwfMappings = profile === 'fwf-migrants'
      ? await runQuery('FWF-MAPPING', `
          SELECT
            o.icode AS ICODE,
            MAX(COALESCE(fi.fwf_item_code, '')) AS FWF_CODE
          FROM opitemrece o
          LEFT JOIN drugitems d ON d.icode = o.icode
          LEFT JOIN s_drugitems sd ON sd.icode = o.icode
          LEFT JOIN nondrugitems n ON n.icode = o.icode
          LEFT JOIN fwf_item fi ON fi.fwf_item_id = COALESCE(NULLIF(d.fwf_item_id, 0), NULLIF(sd.fwf_item_id, 0), NULLIF(n.fwf_item_id, 0))
          WHERE o.vn IN (?)
          GROUP BY o.icode
        `, [vns])
      : [];

    // 15. LVD (Leave Day)
    const lvdTableRows = await runQuery('LVD-TABLE', `
      SELECT COUNT(*) AS table_count
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'ipt_leave'
    `, []);
    const hasLvdTable = Number((lvdTableRows as Record<string, unknown>[])?.[0]?.table_count || 0) > 0;
    const lvd = hasLvdTable
      ? await runQuery('LVD', `
          SELECT
            '' AS SEQLVD,
            an AS AN,
            DATE_FORMAT(out_datetime, '%Y%m%d') AS DATEOUT,
            DATE_FORMAT(out_datetime, '%H%i') AS TIMEOUT,
            DATE_FORMAT(in_datetime, '%Y%m%d') AS DATEIN,
            DATE_FORMAT(in_datetime, '%H%i') AS TIMEIN,
            qty_day AS QTYDAY
          FROM ipt_leave
          WHERE an IN (SELECT an FROM ipt WHERE vn IN (?))
        `, [vns])
      : [];

    // 16. DRU (Drugs)
    const dru = await runQuery('DRU', `
      SELECT
        ? AS HCODE,
        base.HN,
        base.AN,
        MAX(base.CLINIC) AS CLINIC,
        MAX(base.PERSON_ID) AS PERSON_ID,
        DATE_FORMAT(MAX(base.RXDATE), '%Y%m%d') AS DATE_SERV,
        base.DID,
        MAX(base.DIDNAME) AS DIDNAME,
        SUM(base.QTY) AS AMOUNT,
        base.DRUGPRIC,
        MAX(base.DRUGCOST) AS DRUGCOST,
        MAX(base.DIDSTD) AS DIDSTD,
        MAX(base.UNIT) AS UNIT,
        MAX(base.UNIT_PACK) AS UNIT_PACK,
        base.SEQ,
        '' AS DRUGTYPE,
        MAX(base.DRUGREMARK) AS DRUGREMARK,
        MAX(base.PA_NO) AS PA_NO,
        SUM(base.TOTCOPAY) AS TOTCOPAY,
        MAX(base.USE_STATUS) AS USE_STATUS,
        SUM(base.TOTAL) AS TOTAL,
        MAX(base.SIGCODE) AS SIGCODE,
        MAX(base.SIGTEXT) AS SIGTEXT,
        MAX(base.PROVIDER) AS PROVIDER
      FROM (
        SELECT
          ov.hn AS HN,
          COALESCE(NULLIF(o.an, ''), NULLIF(i.an, ''), NULLIF(ov.an, ''), '') AS AN,
          COALESCE(sp.provis_code, ov.main_dep, '') AS CLINIC,
          COALESCE(pt.cid, '') AS PERSON_ID,
          COALESCE(o.rxdate, ov.vstdate) AS RXDATE,
          o.icode AS DID,
          CONCAT_WS(' ', d.name, d.strength) AS DIDNAME,
          COALESCE(d.units, '') AS UNIT,
          COALESCE(d.packqty, '') AS UNIT_PACK,
          COALESCE(o.qty, 0) AS QTY,
          COALESCE(o.unitprice, 0) AS DRUGPRIC,
          COALESCE(o.cost, d.unitcost, 0) AS DRUGCOST,
          COALESCE(s.did, d.did, '') AS DIDSTD,
          CASE
            WHEN COALESCE(d.continuous, '') = 'Y' AND o.item_type = 'H' THEN '4'
            WHEN o.item_type = 'H' THEN '2'
            ELSE '1'
          END AS USE_STATUS,
          CASE WHEN COALESCE(d.drugaccount, '') IN ('', '-') THEN 'EC' ELSE '' END AS DRUGREMARK,
          '' AS PA_NO,
          CASE WHEN o.paidst IN ('03') THEN COALESCE(o.sum_price, 0) ELSE 0 END AS TOTCOPAY,
          COALESCE(o.sum_price, 0) AS TOTAL,
          ov.vn AS SEQ,
          COALESCE(NULLIF(du.opi_usage_code, ''), NULLIF(du.code, ''), NULLIF(o.drugusage, ''), '') AS SIGCODE,
          CONCAT_WS(' ', NULLIF(du.name1, ''), NULLIF(du.name2, ''), NULLIF(du.name3, '')) AS SIGTEXT,
          COALESCE(o.doctor, '') AS PROVIDER
        FROM ovst ov
        LEFT JOIN ipt i ON i.vn = ov.vn
        JOIN opitemrece o ON ${isIpdExport ? 'o.an = i.an' : 'o.vn = ov.vn'}
        JOIN drugitems d ON o.icode = d.icode
        LEFT JOIN s_drugitems s ON o.icode = s.icode
        LEFT JOIN drugusage du ON du.drugusage = o.drugusage
        LEFT JOIN patient pt ON ov.hn = pt.hn
        LEFT JOIN spclty sp ON sp.spclty = ov.spclty
        WHERE ov.vn IN (?)
      ) base
      GROUP BY
        base.SEQ,
        base.HN,
        base.AN,
        base.DID,
        base.DRUGPRIC
      HAVING SUM(base.TOTAL) <> 0
    `, [hcode, vns]);

    const normalizedIns = (ins as Record<string, unknown>[]).map((row) => {
      if (profile !== 'fwf-migrants') return row;
      const hn = String(row.HN || '').trim();
      return {
        ...row,
        INSCL: 'FWF',
        CID: String(fcodeByHn[hn] || '').trim(),
        HCODE: hcode,
      };
    });
    const normalizedOpd = (opd as Record<string, unknown>[]).map((row) => ({
      ...row,
      UUC: ['1', '2'].includes(String(uucByVn[String(row.SEQ || '')] || ''))
        ? String(uucByVn[String(row.SEQ || '')])
        : row.UUC,
    }));
    const normalizedIpd = (ipd as Record<string, unknown>[]).map((row) => {
      const sourceVn = vns.find((vn) => String((ins as Record<string, unknown>[]).find((item) => String(item.AN || '') === String(row.AN || ''))?.SEQ || '') === vn);
      return {
        ...row,
        UUC: sourceVn && ['1', '2'].includes(String(uucByVn[sourceVn] || '')) ? String(uucByVn[sourceVn]) : row.UUC,
      };
    });
    const consolidatedOop = consolidateFdhOopRows(oop as Record<string, unknown>[]);
    if (consolidatedOop.mergedRows > 0) {
      console.info(`OOP: consolidated ${consolidatedOop.mergedRows} duplicate rows across ${consolidatedOop.duplicateGroups} keys`);
    }
    const ancBySeq = new Map((anc as Record<string, unknown>[]).map((row) => [String(row.SEQ || ''), row]));
    const fwfCodeByIcode = new Map((fwfMappings as Record<string, unknown>[]).map((row) => [String(row.ICODE || ''), String(row.FWF_CODE || '')]));
    const normalizedAdp = (adp as Record<string, unknown>[]).map((row) => {
      const ancRow = ancBySeq.get(String(row.SEQ || '')) || {};
      return {
        ...row,
        CODE: profile === 'fwf-migrants'
          ? (fwfCodeByIcode.get(String(row._ICODE || '')) || `UNMAPPED:${String(row._ICODE || '')}`)
          : row.CODE,
        GRAVIDA: ancRow.GRAVIDA || '',
        GA_WEEK: ancRow.GA_WEEK || '',
        'DCIP/E_screen': ancRow.DCIP_E_SCREEN || '',
        LMP: ancRow.LMP || '',
        SP_ITEM: '',
      };
    });
    const leaveSequence = new Map<string, number>();
    const normalizedLvd = (lvd as Record<string, unknown>[]).map((row) => {
      const an = String(row.AN || '');
      const sequence = (leaveSequence.get(an) || 0) + 1;
      leaveSequence.set(an, sequence);
      return { ...row, SEQLVD: String(sequence).padStart(3, '0') };
    });

    return {
      INS: normalizedIns,
      PAT: pat as any[],
      OPD: normalizedOpd,
      ORF: orf as any[],
      ODX: odx as any[],
      OOP: consolidatedOop.rows,
      IPD: normalizedIpd,
      IRF: irf as any[],
      IDX: idx as any[],
      IOP: iop as any[],
      CHT: cht as any[],
      CHA: cha as any[],
      AER: aer as any[],
      ADP: normalizedAdp,
      LVD: normalizedLvd,
      DRU: dru as any[],
      _meta: {
        oopDuplicateGroups: consolidatedOop.duplicateGroups,
        oopMergedRows: consolidatedOop.mergedRows,
      },
    };
  } catch (error) {
    console.error('Error fetching export data:', error);
    return null;
  } finally {
    connection.release();
  }
};

export const getDiagsAndProcedures = async (vn: string, an?: string) => {
  const connection = await getUTFConnection();
  try { return await readVisitClinical(connection, vn, an); }
  finally { connection.release(); }
};



// ---- FDH track_trans import ----

export type FdhImportSummary = {
  total: number;
  updated: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
};

const upsertFdhClaimStatusFromApi = async (
  connection: HospitalConnection,
  vn: string,
  hcode: string,
  message: string,
  stmPeriod: string,
  actAmt: number | null,
  settleAt: string,
  rawPayload: unknown,
) => {
  // Try UPDATE first, then INSERT
  const [upd] = await connection.query(
    `UPDATE fdh_claim_status
     SET fdh_claim_status_message = ?,
         fdh_stm_period = ?,
         fdh_act_amt = ?,
         fdh_settle_at = ?,
         raw_payload = ?,
         updated_at = NOW()
     WHERE vn = ?`,
    [message || null, stmPeriod || null, actAmt ?? null, settleAt || null,
     JSON.stringify(rawPayload ?? {}), vn]
  ) as mysql.ResultSetHeader[];
  const affected = (upd as unknown as { affectedRows?: number }).affectedRows ?? 0;
  if (affected === 0) {
    // No existing row — insert new one
    const transactionUid = `track_${vn}`;
    await connection.query(
      `INSERT IGNORE INTO fdh_claim_status
         (vn, transaction_uid, hcode, fdh_claim_status_message, fdh_stm_period, fdh_act_amt, fdh_settle_at, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [vn, transactionUid, hcode,
       message || null, stmPeriod || null, actAmt ?? null, settleAt || null,
       JSON.stringify(rawPayload ?? {})]
    );
  }
};

export const importFdhStatusForDateRange = async (options: {
  token: string;
  apiBaseUrl: string;
  hospitalCode: string;
  startDate: string;
  endDate: string;
}): Promise<FdhImportSummary> => {
  const summary: FdhImportSummary = { total: 0, updated: 0, skipped: 0, errors: 0, errorMessages: [] };
  const connection = await getUTFConnection();
  try {
    await ensureFdhClaimStatusSchema(connection);

    // Query all OPD visits in the date range
    const [visitRows] = await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate,'%Y-%m-%d') AS vstdate
       FROM ovst o
       WHERE o.vstdate BETWEEN ? AND ?
       ORDER BY o.vstdate, o.vn`,
      [options.startDate, options.endDate]
    );
    const visits = Array.isArray(visitRows) ? (visitRows as Record<string, unknown>[]) : [];
    summary.total = visits.length;

    const trackUrl = `${options.apiBaseUrl.replace(/\/+$/, '')}/api/v1/ucs/track_trans`;

    for (const row of visits) {
      const vn = normalizeImportCellValue(row.vn);
      if (!vn) { summary.skipped += 1; continue; }
      try {
        const res = await fetchWithTimeout(trackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.token}`,
          },
          body: JSON.stringify({ hcode: options.hospitalCode, vn }),
          signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
        });

        let payload: Record<string, unknown> = {};
        try { payload = await res.json() as Record<string, unknown>; } catch { /* ignore */ }

        const dataArr = Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>[])
          : (payload.data && typeof payload.data === 'object' ? [payload.data as Record<string, unknown>] : []);
        const dataItem = dataArr[0] || {};

        const message = normalizeImportCellValue(dataItem.status ?? payload.message ?? payload.message_th ?? '');
        const stmPeriod = normalizeImportCellValue(dataItem.stm_period ?? '');
        const actAmt = dataItem.act_amt != null ? Number(dataItem.act_amt) : null;
        const settleAt = normalizeImportCellValue(dataItem.settle_at ?? '');

        await upsertFdhClaimStatusFromApi(connection, vn, options.hospitalCode,
          message, stmPeriod, actAmt, settleAt, payload);
        summary.updated += 1;
      } catch (err) {
        summary.errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        if (summary.errorMessages.length < 10) summary.errorMessages.push(`VN ${vn}: ${msg}`);
      }
    }
  } finally {
    connection.release();
  }
  return summary;
};

export type FdhTrackResult = {
  vn: string;
  message: string;
  stmPeriod: string;
  actAmt: number | null;
  settleAt: string;
  httpStatus: number;
  raw: unknown;
};

/** Track FDH claim status for a specific list of VNs (on-demand from UI) */
export const trackFdhStatusForVns = async (options: {
  token: string;
  apiBaseUrl: string;
  hospitalCode: string;
  vns: string[];
}): Promise<FdhImportSummary & { results: FdhTrackResult[] }> => {
  const summary: FdhImportSummary & { results: FdhTrackResult[] } = {
    total: 0, updated: 0, skipped: 0, errors: 0, errorMessages: [], results: [],
  };
  const connection = await getUTFConnection();
  try {
    const trackUrl = `${options.apiBaseUrl.replace(/\/+$/, '')}/api/v1/ucs/track_trans`;
    summary.total = options.vns.length;
    for (const vn of options.vns) {
      if (!vn?.trim()) { summary.skipped += 1; continue; }
      let httpStatus = 0;
      try {
        const apiRes = await fetchWithTimeout(trackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${options.token}` },
          body: JSON.stringify({ seq: vn }),
          signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
        });
        httpStatus = apiRes.status;
        let payload: Record<string, unknown> = {};
        try { payload = await apiRes.json() as Record<string, unknown>; } catch { /* ignore */ }
        const dataArr = Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>[])
          : (payload.data && typeof payload.data === 'object' ? [payload.data as Record<string, unknown>] : []);
        const dataItem = dataArr[dataArr.length - 1] || {};
        const message = normalizeImportCellValue(
          dataItem.status ?? payload.message_th ?? payload.message ?? payload.messagecode ?? ''
        );
        const stmPeriod = normalizeImportCellValue(dataItem.stm_period ?? '');
        const actAmt = dataItem.act_amt != null ? Number(dataItem.act_amt) : null;
        const settleAt = normalizeImportCellValue(dataItem.settle_at ?? '');
        await upsertFdhClaimStatusFromApi(
          connection, vn, options.hospitalCode, message, stmPeriod, actAmt, settleAt, payload
        );
        summary.updated += 1;
        summary.results.push({ vn, message, stmPeriod, actAmt, settleAt, httpStatus, raw: payload });
      } catch (err) {
        summary.errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        if (summary.errorMessages.length < 10) summary.errorMessages.push(`VN ${vn}: ${msg}`);
        summary.results.push({ vn, message: `ผิดพลาด: ${msg}`, stmPeriod: '', actAmt: null, settleAt: '', httpStatus, raw: null });
      }
    }
  } finally {
    connection.release();
  }
  return summary;
};

