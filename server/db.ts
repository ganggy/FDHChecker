import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import crypto from 'crypto';
import businessRules from './config/business_rules.json';
import { RECEIVABLE_RIGHT_MAPPINGS, type ReceivableRightMapping } from './receivableMapping.js';

dotenv.config();

// ตั้งค่าการเชื่อมต่อ HOSxP
const pool = mysql.createPool({
  host: process.env.HOSXP_HOST,
  user: process.env.HOSXP_USER,
  password: process.env.HOSXP_PASSWORD,
  database: process.env.HOSXP_DB,
  waitForConnections: true,
  connectionLimit: 30,  // Increased from 10 to support sequential processing of 580+ records
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
});

const repstmPool = mysql.createPool({
  host: process.env.REPSTM_HOST || process.env.HOSXP_HOST,
  user: process.env.REPSTM_USER || process.env.HOSXP_USER,
  password: process.env.REPSTM_PASSWORD || process.env.HOSXP_PASSWORD,
  database: process.env.REPSTM_DB || 'repstminv',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
});

const repstmDatabaseName = process.env.REPSTM_DB || 'repstminv';

// Helper function สำหรับจัดการ connection และ charset
export const getUTFConnection = async () => {
  const connection = await pool.getConnection();
  await connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
  return connection;
};

export const getRepstmConnection = async () => {
  const connection = await repstmPool.getConnection();
  await connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
  return connection;
};

const ANEMIA_CBC_REGEX = 'CBC|COMPLETE BLOOD COUNT|FULL BLOOD COUNT|CBC WITHOUT SMEAR|CBC NO SMEAR|CBC W/O SMEAR|CBC W/O DIFF|ซีบีซี|ความสมบูรณ์ของเม็ดเลือด|เม็ดเลือดสมบูรณ์';
const ANEMIA_HBHCT_REGEX = 'HB/HCT|HBHCT|HB HCT|HB-HCT|HB|HGB|HEMOGLOBIN|HCT|HEMATOCRIT|ฮีโมโกลบิน|ฮีมาโตคริต|ความเข้มข้นเลือด';
const SYPHILIS_SCREENING_REGEX = 'TREPONEMA|TREPONEMAL|PALLIDUM|SYPHILIS|ซิฟิลิส|TPHA|TPPA|VDRL|RPR';
const HEP_C_SCREENING_REGEX = 'ANTI[- ]?HCV|HCV[ -]?(AB|ANTIBODY)|HEPATITIS C.*(AB|ANTIBODY)|ไวรัสตับอักเสบซี';
const HEP_B_SCREENING_REGEX = 'HBS[- ]?AG|HBsAg|HEPATITIS B SURFACE ANTIGEN|HEPATITIS B ANTIGEN|ไวรัสตับอักเสบบี';
const TELEMED_ADP_CODE = String((businessRules as any)?.adp_codes?.telmed || 'TELMED').trim().toUpperCase();
const TELEMED_EXPORT_CODE = String((businessRules as any)?.project_codes?.ovstist_tele || '5').trim();

const buildAnemiaLabExistsSql = (alias: string, labKind: 'cbc' | 'hbhct' | 'any' = 'any') => {
  const regex = labKind === 'cbc'
    ? ANEMIA_CBC_REGEX
    : labKind === 'hbhct'
      ? ANEMIA_HBHCT_REGEX
      : `${ANEMIA_CBC_REGEX}|${ANEMIA_HBHCT_REGEX}`;

  return `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND (
          UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${regex}'
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
        AND (
          UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${regex}'
        )
    )
  )
`;
};

const buildAnemiaCbcExistsSql = (alias: string) => buildAnemiaLabExistsSql(alias, 'cbc');
const buildAnemiaHbHctExistsSql = (alias: string) => buildAnemiaLabExistsSql(alias, 'hbhct');

const buildAnemiaFallbackSql = (alias: string, labKind: 'cbc' | 'hbhct' | 'any' = 'hbhct') => `
  EXISTS (
    SELECT 1
    FROM ovstdiag dx
    WHERE dx.vn = ${alias}.vn
      AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z130', 'Z138')
  )
  AND ${buildAnemiaLabExistsSql(alias, labKind)}
`;

const buildAnemiaAgeBandSql = (visitAlias: string) => `
  CASE
    WHEN v.age_y BETWEEN 13 AND 24 THEN '13-24 ปี'
    WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ${visitAlias}.vstdate) BETWEEN 6 AND 12 THEN '6-12 เดือน'
    WHEN v.age_y BETWEEN 3 AND 6 THEN '3-6 ปี'
    ELSE NULL
  END
`;

const buildAnemiaAgeEligibleSql = (visitAlias: string) => `
  (
    v.age_y BETWEEN 13 AND 24
    OR TIMESTAMPDIFF(MONTH, pt.birthday, ${visitAlias}.vstdate) BETWEEN 6 AND 12
    OR v.age_y BETWEEN 3 AND 6
  )
`;

const buildFpgLabExistsSql = (alias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '(^|[^A-Z])(FPG|FBS)([^A-Z]|$)|FASTING PLASMA GLUCOSE|FASTING BLOOD SUGAR|GLUCOSE FASTING'
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '(^|[^A-Z])(FPG|FBS)([^A-Z]|$)|FASTING PLASMA GLUCOSE|FASTING BLOOD SUGAR|GLUCOSE FASTING'
    )
  )
`;

const buildServiceOrLabNameExistsSql = (alias: string, regex: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${regex}'
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${regex}'
    )
  )
`;

const buildTelemedExistsSql = (visitAlias: string, ovstistAlias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      JOIN s_drugitems d ON d.icode = oo.icode
      WHERE oo.vn = ${visitAlias}.vn
        AND UPPER(COALESCE(d.nhso_adp_code, '')) = '${TELEMED_ADP_CODE}'
      LIMIT 1
    )
    OR COALESCE(${ovstistAlias}.export_code, '') = '${TELEMED_EXPORT_CODE}'
  )
`;

const buildPregLabExistsSql = (alias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND (
          UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '(^|[^A-Z])(UPT|URINE PREGNANCY TEST|PREG TEST|PREGNANCY TEST|HCG|BETA HCG)([^A-Z]|$)'
          OR COALESCE(sd.nhso_adp_code, '') = '31101'
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
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '(^|[^A-Z])(UPT|URINE PREGNANCY TEST|PREG TEST|PREGNANCY TEST|HCG|BETA HCG)([^A-Z]|$)'
    )
  )
`;

const buildPostIronMedExistsSql = (alias: string) => `
  EXISTS (
    SELECT 1
    FROM opitemrece oo
    LEFT JOIN drugitems di ON di.icode = oo.icode
    LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
    WHERE oo.vn = ${alias}.vn
      AND UPPER(CONCAT_WS(' ', COALESCE(di.name, ''), COALESCE(sd.name, ''))) REGEXP 'FERROUS|TRIFERDINE|FEROFOLIC|FOLIC|IRON'
  )
`;

const buildFerrokidMedExistsSql = (alias: string) => `
  EXISTS (
    SELECT 1
    FROM opitemrece oo
    LEFT JOIN drugitems di ON di.icode = oo.icode
    LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
    WHERE oo.vn = ${alias}.vn
      AND UPPER(CONCAT_WS(' ', COALESCE(di.name, ''), COALESCE(sd.name, ''))) REGEXP 'FERROKID|FERRO KID|FERRO-KID|KID.*IRON|IRON.*KID'
  )
`;

const UPT_DX_CODES = ['Z320', 'Z321'];
const FPG_DX_CODES = ['Z131', 'Z133', 'Z136'];
const CHOL_DX_CODES = ['Z136'];
const ANEMIA_DX_CODES = ['Z130', 'Z138'];
const IRON_DX_CODES = ['Z130'];
const POSTNATAL_CARE_DX_CODES = ['Z390', 'Z391', 'Z392'];
const POSTNATAL_SUPPLEMENT_DX_CODES = ['Z391', 'Z392'];
const PILL_DX_CODES = ['Z304'];

const ANC_LAB_1_REGEX = {
  cbc: 'CBC|COMPLETE BLOOD COUNT',
  dcip: '(^|[^A-Z])DCIP([^A-Z]|$)',
  abo: 'ABO|ABO/RH|BLOOD GROUP|CELL GROUPING',
  rh: '(^|[^A-Z])RH([^A-Z]|$)|RH GROUP|GROUPING TUBE METHOD',
  hbsag: 'HBS[- ]?AG|HEPATITIS B SURFACE ANTIGEN|HBSAG',
  syphilis: 'TREPONEMA PALLIDUM|SYPHILIS|TPHA|VDRL|RPR',
  hiv: 'ANTI-?HIV|HIV-AB|HIV AB|HIV.*RAPID|RAPID.*HIV',
};

const ANC_LAB_2_REGEX = {
  hiv: 'ANTI-?HIV|HIV-AB|HIV AB|HIV.*RAPID|RAPID.*HIV',
  syphilis: 'TREPONEMA PALLIDUM|SYPHILIS|TPHA|VDRL|RPR',
  cbc: 'CBC|COMPLETE BLOOD COUNT',
};

const ANC_US_REGEX = 'ULTRASOUND|U/S|USG|OBSTETRIC|OB.*US|ANC.*US|SONO';

const buildAncLab1CompleteSql = (alias: string) => `
  ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.cbc)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.dcip)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.abo)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.rh)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.hbsag)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.syphilis)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.hiv)}
`;

const buildAncLab1IdentifySql = (alias: string) => `
  ${buildAncLab1CompleteSql(alias)}
`;

const buildAncLab2CompleteSql = (alias: string) => `
  ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.hiv)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.syphilis)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.cbc)}
`;

const buildAncLab2IdentifySql = (alias: string) => `
  ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.hiv)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.syphilis)}
`;

const buildDxInSql = (expr: string, codes: string[]) =>
  `REPLACE(UPPER(COALESCE(${expr}, '')), '.', '') IN (${codes.map(code => `'${code}'`).join(',')})`;

const buildVisitDiagnosisExistsSql = (alias: string, codes: string[]) => `
  EXISTS (
    SELECT 1
    FROM ovstdiag dx
    WHERE dx.vn = ${alias}.vn
      AND REPLACE(UPPER(dx.icd10), '.', '') IN (${codes.map(code => `'${code}'`).join(',')})
  )
`;

const buildDiagnosisMatchSql = (alias: string, vnStatAlias: string, codes: string[]) => `
  (
    ${buildVisitDiagnosisExistsSql(alias, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.pdx`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx0`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx1`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx2`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx3`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx4`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx5`, codes)}
  )
`;

const buildCholLabExistsSql = (alias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP 'TOTAL CHOLESTEROL|CHOLESTEROL|HDL|HDL-C|HDL CHOLESTEROL'
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP 'TOTAL CHOLESTEROL|CHOLESTEROL|HDL|HDL-C|HDL CHOLESTEROL'
    )
  )
`;

const APP_SETTINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(191) NOT NULL PRIMARY KEY,
    setting_value JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const FDH_STATUS_IMPORT_LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS fdh_status_import_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    transaction_uid VARCHAR(191) NOT NULL,
    hcode VARCHAR(32) NOT NULL,
    environment VARCHAR(16) NOT NULL,
    response_status INT NULL,
    response_message VARCHAR(255) NULL,
    response_message_th TEXT NULL,
    request_payload JSON NOT NULL,
    response_payload JSON NOT NULL,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_transaction_uid (transaction_uid),
    INDEX idx_imported_at (imported_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const FDH_CLAIM_STATUS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS fdh_claim_status (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(25) NULL,
    transaction_uid VARCHAR(191) NOT NULL,
    hcode VARCHAR(32) NULL,
    environment VARCHAR(16) NULL,
    fdh_reservation_status VARCHAR(64) NULL,
    fdh_reservation_datetime DATETIME NULL,
    fdh_claim_status_message VARCHAR(255) NULL,
    error_code VARCHAR(128) NULL,
    raw_payload JSON NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_transaction_uid (transaction_uid),
    INDEX idx_vn (vn),
    INDEX idx_reservation_status (fdh_reservation_status),
    INDEX idx_updated_at (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const AUTHEN_SYNC_LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS authen_sync_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(25) NOT NULL,
    cid VARCHAR(13) NULL,
    hn VARCHAR(25) NULL,
    vstdate DATE NULL,
    claim_code VARCHAR(100) NULL,
    authen_type VARCHAR(50) NULL,
    authen_datetime DATETIME NULL,
    status VARCHAR(32) NOT NULL,
    message TEXT NULL,
    request_url TEXT NULL,
    response_payload JSON NULL,
    synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vn (vn),
    INDEX idx_synced_at (synced_at),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const AUTHEN_SYNC_CANCEL_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS authen_sync_cancel (
    vn VARCHAR(25) NOT NULL PRIMARY KEY,
    cid VARCHAR(13) NULL,
    vstdate DATE NULL,
    reason VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cid (cid),
    INDEX idx_vstdate (vstdate)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const NHSO_CONFIRM_PRIVILEGE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS nhso_confirm_privilege (
    nhso_confirm_privilege_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(25) NOT NULL,
    nhso_seq VARCHAR(100) NULL,
    nhso_authen_code VARCHAR(20) NULL,
    nhso_request_json TEXT NULL,
    nhso_reponse_json TEXT NULL,
    nhso_requst_datetime DATETIME NULL,
    nhso_response_datetime DATETIME NULL,
    confirm_staff VARCHAR(50) NULL,
    nhso_status CHAR(1) NULL,
    debt_id INT NULL,
    nhso_total_amount DOUBLE(18,2) NULL,
    nhso_cancel_response TEXT NULL,
    nhso_cancel_datetime DATETIME NULL,
    cancel_staff VARCHAR(50) NULL,
    nhso_confirm_type_id INT NULL,
    fdh_send_status CHAR(1) NULL,
    fdh_transaction_id VARCHAR(100) NULL,
    pttype CHAR(2) NULL,
    nhso_privilege_amount DOUBLE(18,2) NULL,
    nhso_cash_amount DOUBLE(18,2) NULL,
    testzone VARCHAR(1) NULL,
    sourceID VARCHAR(20) NULL,
    UNIQUE KEY uk_vn (vn)
  ) ENGINE=InnoDB DEFAULT CHARSET=tis620
`;

const REPSTM_IMPORT_BATCH_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS repstm_import_batch (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data_type VARCHAR(16) NOT NULL,
    source_filename VARCHAR(255) NOT NULL,
    batch_hash VARCHAR(64) NULL,
    sheet_name VARCHAR(255) NULL,
    imported_by VARCHAR(128) NULL,
    row_count INT NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_data_type_batch_hash (data_type, batch_hash),
    INDEX idx_data_type_created_at (data_type, created_at),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const REPSTM_IMPORT_ROW_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS repstm_import_row (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    data_type VARCHAR(16) NOT NULL,
    row_no INT NOT NULL,
    ref_key VARCHAR(191) NULL,
    hn VARCHAR(32) NULL,
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    cid VARCHAR(32) NULL,
    amount DECIMAL(15,2) NULL,
    service_date VARCHAR(32) NULL,
    raw_data JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_batch_id (batch_id),
    INDEX idx_data_type_created_at (data_type, created_at),
    INDEX idx_ref_key (ref_key),
    CONSTRAINT fk_repstm_import_row_batch
      FOREIGN KEY (batch_id) REFERENCES repstm_import_batch(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const FDH_CLAIM_DETAIL_BATCH_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS fdh_claim_detail_batch (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    source_filename VARCHAR(255) NOT NULL,
    batch_hash VARCHAR(64) NULL,
    sheet_name VARCHAR(255) NULL,
    imported_by VARCHAR(128) NULL,
    row_count INT NOT NULL DEFAULT 0,
    op_count INT NOT NULL DEFAULT 0,
    ip_count INT NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_fdh_claim_detail_hash (batch_hash),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const FDH_CLAIM_DETAIL_ROW_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS fdh_claim_detail_row (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    row_no INT NOT NULL,
    claim_code VARCHAR(191) NULL,
    hn VARCHAR(32) NULL,
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    patient_type VARCHAR(16) NULL,
    service_datetime DATETIME NULL,
    admit_datetime DATETIME NULL,
    discharge_datetime DATETIME NULL,
    privilege_use VARCHAR(32) NULL,
    sent_at DATETIME NULL,
    upload_uid VARCHAR(191) NULL,
    maininscl VARCHAR(32) NULL,
    claim_status VARCHAR(128) NULL,
    raw_data JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_claim_code (claim_code),
    INDEX idx_batch_id (batch_id),
    INDEX idx_hn (hn),
    INDEX idx_vn (vn),
    INDEX idx_an (an),
    INDEX idx_patient_type (patient_type),
    INDEX idx_claim_status (claim_status),
    INDEX idx_sent_at (sent_at),
    CONSTRAINT fk_fdh_claim_detail_batch
      FOREIGN KEY (batch_id) REFERENCES fdh_claim_detail_batch(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const REP_DATA_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS rep_data (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    record_uid VARCHAR(191) NOT NULL,
    rep_no VARCHAR(64) NULL,
    seq_no VARCHAR(32) NULL,
    tran_id VARCHAR(191) NULL,
    hcode VARCHAR(16) NULL,
    hn VARCHAR(32) NULL,
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    pid VARCHAR(32) NULL,
    patient_name VARCHAR(255) NULL,
    patient_type VARCHAR(64) NULL,
    department VARCHAR(8) NULL,
    admdate DATETIME NULL,
    dchdate DATETIME NULL,
    senddate DATETIME NULL,
    maininscl VARCHAR(32) NULL,
    subinscl VARCHAR(32) NULL,
    errorcode VARCHAR(128) NULL,
    verifycode VARCHAR(128) NULL,
    projectcode VARCHAR(128) NULL,
    filename VARCHAR(255) NOT NULL,
    filefrom VARCHAR(32) NOT NULL DEFAULT 'NHSO',
    percentpay DECIMAL(7,2) NULL,
    income DECIMAL(15,2) NULL,
    compensated DECIMAL(15,2) NULL,
    nhso DECIMAL(15,2) NULL,
    agency DECIMAL(15,2) NULL,
    hc DECIMAL(15,2) NULL,
    ae DECIMAL(15,2) NULL,
    inst DECIMAL(15,2) NULL,
    op DECIMAL(15,2) NULL,
    ip DECIMAL(15,2) NULL,
    dmis DECIMAL(15,2) NULL,
    drug DECIMAL(15,2) NULL,
    ontop DECIMAL(15,2) NULL,
    diff DECIMAL(15,2) NULL,
    down_amount DECIMAL(15,2) NULL,
    up_amount DECIMAL(15,2) NULL,
    yymm VARCHAR(4) NULL,
    yearbudget VARCHAR(4) NULL,
    raw_data JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_record_uid (record_uid),
    INDEX idx_batch_id (batch_id),
    INDEX idx_tran_id (tran_id),
    INDEX idx_hn (hn),
    INDEX idx_vn (vn),
    INDEX idx_an (an),
    INDEX idx_filename (filename),
    INDEX idx_department (department),
    CONSTRAINT fk_rep_data_batch
      FOREIGN KEY (batch_id) REFERENCES repstm_import_batch(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const REP_DATA_VERIFY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS rep_data_verify LIKE rep_data
`;

const REPSTM_STATEMENT_DATA_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS repstm_statement_data (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    data_type VARCHAR(8) NOT NULL,
    record_uid VARCHAR(191) NOT NULL,
    statement_no VARCHAR(128) NULL,
    tran_id VARCHAR(191) NULL,
    hcode VARCHAR(16) NULL,
    hn VARCHAR(32) NULL,
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    pid VARCHAR(32) NULL,
    patient_name VARCHAR(255) NULL,
    patient_type VARCHAR(64) NULL,
    department VARCHAR(8) NULL,
    service_datetime DATETIME NULL,
    senddate DATETIME NULL,
    maininscl VARCHAR(32) NULL,
    subinscl VARCHAR(32) NULL,
    errorcode VARCHAR(128) NULL,
    verifycode VARCHAR(128) NULL,
    amount DECIMAL(15,2) NULL,
    paid_amount DECIMAL(15,2) NULL,
    invoice_amount DECIMAL(15,2) NULL,
    filename VARCHAR(255) NOT NULL,
    filefrom VARCHAR(32) NOT NULL DEFAULT 'NHSO',
    matched_visit_code VARCHAR(32) NULL,
    matched_status VARCHAR(16) NOT NULL DEFAULT 'unmatched',
    raw_data JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_statement_record (data_type, record_uid),
    INDEX idx_statement_batch_id (batch_id),
    INDEX idx_statement_data_type (data_type),
    INDEX idx_statement_tran_id (tran_id),
    INDEX idx_statement_vn (vn),
    INDEX idx_statement_an (an),
    INDEX idx_statement_hn (hn),
    INDEX idx_statement_errorcode (errorcode),
    INDEX idx_statement_service_datetime (service_datetime),
    CONSTRAINT fk_statement_batch
      FOREIGN KEY (batch_id) REFERENCES repstm_import_batch(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const RECEIVABLE_BATCH_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_batch (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_no VARCHAR(64) NOT NULL,
    patient_type VARCHAR(8) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_by VARCHAR(128) NULL,
    notes TEXT NULL,
    item_count INT NOT NULL DEFAULT 0,
    total_receivable DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_batch_no (batch_no),
    INDEX idx_created_at (created_at),
    INDEX idx_period (start_date, end_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const CLAIM_WORK_QUEUE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS claim_work_queue (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(25) NOT NULL,
    hn VARCHAR(25) NULL,
    patient_name VARCHAR(255) NULL,
    fund VARCHAR(128) NULL,
    service_date DATE NULL,
    queue_status VARCHAR(32) NOT NULL DEFAULT 'pending_mr',
    assigned_to VARCHAR(128) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_vn (vn),
    INDEX idx_queue_status (queue_status),
    INDEX idx_service_date (service_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const CLAIM_REJECT_NOTE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS claim_reject_note (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rep_data_id BIGINT NULL,
    tran_id VARCHAR(191) NULL,
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    hn VARCHAR(32) NULL,
    errorcode VARCHAR(128) NULL,
    verifycode VARCHAR(128) NULL,
    resolve_status VARCHAR(32) NOT NULL DEFAULT 'open',
    note TEXT NULL,
    assigned_to VARCHAR(128) NULL,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tran_id (tran_id),
    INDEX idx_vn (vn),
    INDEX idx_resolve_status (resolve_status),
    INDEX idx_errorcode (errorcode)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const RECEIVABLE_ITEM_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_item (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    patient_type VARCHAR(8) NOT NULL,
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    hn VARCHAR(32) NULL,
    cid VARCHAR(32) NULL,
    patient_name VARCHAR(255) NULL,
    pttype VARCHAR(16) NULL,
    pttype_name VARCHAR(255) NULL,
    hipdata_code VARCHAR(32) NULL,
    service_date DATE NULL,
    claimable_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    rep_amount DECIMAL(15,2) NULL,
    diff_amount DECIMAL(15,2) NULL,
    claim_summary TEXT NULL,
    raw_data JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_batch_id (batch_id),
    INDEX idx_vn (vn),
    INDEX idx_an (an),
    INDEX idx_hn (hn),
    CONSTRAINT fk_receivable_item_batch
      FOREIGN KEY (batch_id) REFERENCES receivable_batch(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MOPHCLAIM_SEND_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS mophclaim_send (
    vn VARCHAR(25) NOT NULL,
    type VARCHAR(10) NOT NULL,
    senddate DATE NULL,
    flag CHAR(1) NULL,
    transaction_uid VARCHAR(100) NULL,
    note VARCHAR(200) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (vn, type),
    INDEX idx_flag (flag),
    INDEX idx_senddate (senddate)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const ensureAppSettingsTable = async () => {
  const connection = await getUTFConnection();
  try {
    await connection.query(APP_SETTINGS_TABLE_SQL);
  } finally {
    connection.release();
  }
};

const ensureFdhClaimStatusSchema = async (connection: any): Promise<void> => {
  await connection.query(FDH_CLAIM_STATUS_TABLE_SQL);

  const [columnRows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'fdh_claim_status'`
  );
  const existingColumns = new Set(
    (Array.isArray(columnRows) ? columnRows : [])
      .map((row: any) => String(row.COLUMN_NAME || '').toLowerCase())
  );
  const columns: Array<[string, string]> = [
    ['vn', 'ADD COLUMN vn VARCHAR(25) NULL AFTER id'],
    ['transaction_uid', 'ADD COLUMN transaction_uid VARCHAR(191) NOT NULL AFTER vn'],
    ['hcode', 'ADD COLUMN hcode VARCHAR(32) NULL AFTER transaction_uid'],
    ['environment', 'ADD COLUMN environment VARCHAR(16) NULL AFTER hcode'],
    ['fdh_reservation_status', 'ADD COLUMN fdh_reservation_status VARCHAR(64) NULL AFTER environment'],
    ['fdh_reservation_datetime', 'ADD COLUMN fdh_reservation_datetime DATETIME NULL AFTER fdh_reservation_status'],
    ['fdh_claim_status_message', 'ADD COLUMN fdh_claim_status_message VARCHAR(255) NULL AFTER fdh_reservation_datetime'],
    ['error_code', 'ADD COLUMN error_code VARCHAR(128) NULL AFTER fdh_claim_status_message'],
    ['fdh_stm_period', 'ADD COLUMN fdh_stm_period VARCHAR(200) NULL AFTER error_code'],
    ['fdh_act_amt', 'ADD COLUMN fdh_act_amt DOUBLE(12,2) NULL AFTER fdh_stm_period'],
    ['fdh_settle_at', 'ADD COLUMN fdh_settle_at VARCHAR(200) NULL AFTER fdh_act_amt'],
    ['raw_payload', 'ADD COLUMN raw_payload JSON NULL AFTER fdh_settle_at'],
    ['updated_at', 'ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER raw_payload'],
  ];

  for (const [column, alterSql] of columns) {
    if (!existingColumns.has(column)) {
      await connection.query(`ALTER TABLE fdh_claim_status ${alterSql}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'fdh_claim_status'`
  );
  const existingIndexes = new Set(
    (Array.isArray(indexRows) ? indexRows : [])
      .map((row: any) => String(row.INDEX_NAME || '').toLowerCase())
  );
  const indexes: Array<[string, string]> = [
    ['uk_transaction_uid', 'ADD UNIQUE KEY uk_transaction_uid (transaction_uid)'],
    ['idx_vn', 'ADD INDEX idx_vn (vn)'],
    ['idx_reservation_status', 'ADD INDEX idx_reservation_status (fdh_reservation_status)'],
    ['idx_updated_at', 'ADD INDEX idx_updated_at (updated_at)'],
  ];

  for (const [indexName, alterSql] of indexes) {
    if (!existingIndexes.has(indexName)) {
      try {
        await connection.query(`ALTER TABLE fdh_claim_status ${alterSql}`);
      } catch (error) {
        console.warn(`Unable to add fdh_claim_status index ${indexName}:`, error);
      }
    }
  }
};

export const ensureFdhClaimStatusTable = async () => {
  const connection = await getUTFConnection();
  try {
    await ensureFdhClaimStatusSchema(connection);
  } finally {
    connection.release();
  }
};

export const ensureNhsoClosePrivilegeTable = async () => {
  const connection = await getUTFConnection();
  try {
    await connection.query(NHSO_CONFIRM_PRIVILEGE_TABLE_SQL);
  } finally {
    connection.release();
  }
};

export const ensureRepstmTables = async () => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(REPSTM_IMPORT_BATCH_TABLE_SQL);
    await connection.query(REPSTM_IMPORT_ROW_TABLE_SQL);
    await connection.query(FDH_CLAIM_DETAIL_BATCH_TABLE_SQL);
    await connection.query(FDH_CLAIM_DETAIL_ROW_TABLE_SQL);
    await connection.query(REP_DATA_TABLE_SQL);
    await connection.query(REP_DATA_VERIFY_TABLE_SQL);
    await connection.query(REPSTM_STATEMENT_DATA_TABLE_SQL);
    await connection.query(RECEIVABLE_BATCH_TABLE_SQL);
    await connection.query(RECEIVABLE_ITEM_TABLE_SQL);
    await connection.query(MOPHCLAIM_SEND_TABLE_SQL);

    const repSeqColumnTables = ['rep_data', 'rep_data_verify'];
    for (const tableName of repSeqColumnTables) {
      const [seqColumnRows] = await connection.query(
        `SELECT COLUMN_TYPE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = 'seq_no'
         LIMIT 1`,
        [tableName]
      );
      const seqColumnType = Array.isArray(seqColumnRows)
        ? String((seqColumnRows[0] as Record<string, unknown>)?.COLUMN_TYPE || '').toLowerCase()
        : '';
      if (seqColumnType && !seqColumnType.includes('varchar')) {
        await connection.query(`ALTER TABLE ${tableName} MODIFY COLUMN seq_no VARCHAR(32) NULL`);
      }
    }

    const enableHistoricalRepair = process.env.REPSTM_ENABLE_HISTORICAL_REPAIR === '1';
    if (enableHistoricalRepair) {
      // Optional heavy repair for historical data. Keep disabled by default for fast imports.
      const repFixTables = ['rep_data', 'rep_data_verify'];
      const repBatchSize = 2000;
      for (const tableName of repFixTables) {
        let lastId = 0;
        while (true) {
          const [idRows] = await connection.query(
            `SELECT id
             FROM ${tableName}
             WHERE id > ?
               AND NULLIF(TRIM(COALESCE(seq_no, '')), '') IS NOT NULL
             ORDER BY id
             LIMIT ?`,
            [lastId, repBatchSize]
          );
          const ids = (Array.isArray(idRows) ? idRows : [])
            .map((r) => Number((r as Record<string, unknown>).id || 0))
            .filter((id) => Number.isFinite(id) && id > 0);
          if (ids.length === 0) break;

          await connection.query(
            `UPDATE ${tableName}
             SET
               seq_no = CASE
                 WHEN (
                   UPPER(COALESCE(department, '')) = 'OP'
                   OR (
                     UPPER(COALESCE(department, '')) NOT IN ('OP', 'IP')
                     AND NULLIF(TRIM(COALESCE(an, '')), '') IS NULL
                   )
                 )
                   THEN COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), NULLIF(TRIM(COALESCE(seq_no, '')), ''))
                 ELSE NULLIF(TRIM(COALESCE(seq_no, '')), '')
               END,
               department = CASE
                 WHEN UPPER(COALESCE(department, '')) IN ('OP', 'IP') THEN UPPER(COALESCE(department, ''))
                 WHEN UPPER(COALESCE(patient_type, '')) IN ('OPD', 'OP') THEN 'OP'
                 WHEN NULLIF(TRIM(COALESCE(an, '')), '') IS NOT NULL THEN 'IP'
                 WHEN UPPER(COALESCE(patient_type, '')) IN ('IPD', 'IP') THEN 'IP'
                 ELSE 'OP'
               END,
               vn = CASE
                 WHEN (
                   UPPER(COALESCE(department, '')) = 'OP'
                   OR (
                     UPPER(COALESCE(department, '')) NOT IN ('OP', 'IP')
                     AND NULLIF(TRIM(COALESCE(an, '')), '') IS NULL
                   )
                 )
                   THEN COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), NULLIF(TRIM(COALESCE(seq_no, '')), ''))
                 ELSE NULLIF(TRIM(COALESCE(vn, '')), '')
               END,
               an = CASE
                 WHEN UPPER(COALESCE(patient_type, '')) IN ('OPD', 'OP')
                   THEN NULL
                 WHEN (
                   UPPER(COALESCE(department, '')) = 'IP'
                   OR (
                     UPPER(COALESCE(department, '')) NOT IN ('OP', 'IP')
                     AND (
                       NULLIF(TRIM(COALESCE(an, '')), '') IS NOT NULL
                       OR UPPER(COALESCE(patient_type, '')) IN ('IPD', 'IP')
                     )
                   )
                 )
                   THEN COALESCE(NULLIF(TRIM(COALESCE(an, '')), ''), NULLIF(TRIM(COALESCE(seq_no, '')), ''))
                 WHEN (
                   UPPER(COALESCE(department, '')) = 'OP'
                   OR (
                     UPPER(COALESCE(department, '')) NOT IN ('OP', 'IP')
                     AND NULLIF(TRIM(COALESCE(an, '')), '') IS NULL
                   )
                 )
                   THEN NULL
                 ELSE NULLIF(TRIM(COALESCE(an, '')), '')
               END
             WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
          );

          lastId = ids[ids.length - 1];
        }
      }

      const stmBatchSize = 2000;
      let stmLastId = 0;
      while (true) {
        const [stmIdRows] = await connection.query(
          `SELECT id
           FROM repstm_statement_data
           WHERE id > ?
             AND data_type IN ('STM', 'INV')
           ORDER BY id
           LIMIT ?`,
          [stmLastId, stmBatchSize]
        );
        const stmIds = (Array.isArray(stmIdRows) ? stmIdRows : [])
          .map((r) => Number((r as Record<string, unknown>).id || 0))
          .filter((id) => Number.isFinite(id) && id > 0);
        if (stmIds.length === 0) break;

        await connection.query(
          `UPDATE repstm_statement_data s
           LEFT JOIN rep_data r
             ON NULLIF(TRIM(COALESCE(r.tran_id, '')), '') = NULLIF(TRIM(COALESCE(s.tran_id, '')), '')
           SET
             s.pid = NULLIF(TRIM(COALESCE(s.pid, '')), ''),
             s.hn = COALESCE(NULLIF(TRIM(COALESCE(s.hn, '')), ''), NULLIF(TRIM(COALESCE(r.hn, '')), '')),
             s.department = CASE
               WHEN UPPER(COALESCE(s.department, '')) IN ('OP', 'IP') THEN UPPER(COALESCE(s.department, ''))
               WHEN UPPER(COALESCE(s.patient_type, '')) IN ('OPD', 'OP') THEN 'OP'
               WHEN NULLIF(TRIM(COALESCE(s.an, '')), '') IS NOT NULL THEN 'IP'
               WHEN UPPER(COALESCE(s.patient_type, '')) IN ('IPD', 'IP') THEN 'IP'
               WHEN NULLIF(TRIM(COALESCE(r.an, '')), '') IS NOT NULL THEN 'IP'
               ELSE 'OP'
             END,
             s.vn = CASE
               WHEN (
                 UPPER(COALESCE(s.department, '')) = 'OP'
                 OR (
                   UPPER(COALESCE(s.department, '')) NOT IN ('OP', 'IP')
                   AND NULLIF(TRIM(COALESCE(s.an, '')), '') IS NULL
                   AND UPPER(COALESCE(s.patient_type, '')) NOT IN ('IPD', 'IP')
                 )
                 OR UPPER(COALESCE(s.patient_type, '')) IN ('OPD', 'OP')
               )
                 THEN COALESCE(
                   NULLIF(TRIM(COALESCE(s.vn, '')), ''),
                   CASE WHEN UPPER(COALESCE(s.department, '')) = 'OP' THEN NULLIF(TRIM(COALESCE(s.matched_visit_code, '')), '') ELSE NULL END,
                   NULLIF(TRIM(COALESCE(r.vn, '')), '')
                 )
               ELSE NULLIF(TRIM(COALESCE(s.vn, '')), '')
             END,
             s.an = CASE
               WHEN UPPER(COALESCE(s.patient_type, '')) IN ('OPD', 'OP')
                 THEN NULL
               WHEN (
                 UPPER(COALESCE(s.department, '')) = 'IP'
                 OR (
                   UPPER(COALESCE(s.department, '')) NOT IN ('OP', 'IP')
                   AND (
                     NULLIF(TRIM(COALESCE(s.an, '')), '') IS NOT NULL
                     OR UPPER(COALESCE(s.patient_type, '')) IN ('IPD', 'IP')
                     OR NULLIF(TRIM(COALESCE(r.an, '')), '') IS NOT NULL
                   )
                 )
               )
                 THEN COALESCE(
                   NULLIF(TRIM(COALESCE(s.an, '')), ''),
                   CASE WHEN UPPER(COALESCE(s.department, '')) = 'IP' THEN NULLIF(TRIM(COALESCE(s.matched_visit_code, '')), '') ELSE NULL END,
                   NULLIF(TRIM(COALESCE(r.an, '')), '')
                 )
               ELSE NULL
             END,
             s.matched_visit_code = COALESCE(
               NULLIF(TRIM(COALESCE(s.matched_visit_code, '')), ''),
               CASE
                 WHEN UPPER(COALESCE(s.department, '')) = 'IP' THEN COALESCE(NULLIF(TRIM(COALESCE(s.an, '')), ''), NULLIF(TRIM(COALESCE(r.an, '')), ''))
                 ELSE COALESCE(NULLIF(TRIM(COALESCE(s.vn, '')), ''), NULLIF(TRIM(COALESCE(r.vn, '')), ''))
               END
             ),
             s.matched_status = CASE
               WHEN NULLIF(TRIM(COALESCE(
                 s.matched_visit_code,
                 CASE
                   WHEN UPPER(COALESCE(s.department, '')) = 'IP' THEN COALESCE(NULLIF(TRIM(COALESCE(s.an, '')), ''), NULLIF(TRIM(COALESCE(r.an, '')), ''))
                   ELSE COALESCE(NULLIF(TRIM(COALESCE(s.vn, '')), ''), NULLIF(TRIM(COALESCE(r.vn, '')), ''))
                 END,
                 ''
               )), '') IS NOT NULL THEN 'matched'
               ELSE 'unmatched'
             END
           WHERE s.id IN (${stmIds.map(() => '?').join(',')})`,
          stmIds
        );

        stmLastId = stmIds[stmIds.length - 1];
      }
    }

    const [batchHashColumns] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'repstm_import_batch'
         AND COLUMN_NAME = 'batch_hash'`
    );
    const hasBatchHash = Array.isArray(batchHashColumns)
      && Number((batchHashColumns[0] as Record<string, unknown>).count || 0) > 0;
    if (!hasBatchHash) {
      await connection.query(`
        ALTER TABLE repstm_import_batch
        ADD COLUMN batch_hash VARCHAR(64) NULL AFTER source_filename
      `);
    }

    const [batchHashIndexes] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'repstm_import_batch'
         AND INDEX_NAME = 'uk_data_type_batch_hash'`
    );
    const hasBatchHashIndex = Array.isArray(batchHashIndexes)
      && Number((batchHashIndexes[0] as Record<string, unknown>).count || 0) > 0;
    if (!hasBatchHashIndex) {
      await connection.query(`
        ALTER TABLE repstm_import_batch
        ADD UNIQUE INDEX uk_data_type_batch_hash (data_type, batch_hash)
      `);
    }

    const [filenameUniqueIndexes] = await connection.query(
      `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'repstm_import_batch'
         AND NON_UNIQUE = 0
         AND INDEX_NAME <> 'PRIMARY'
       GROUP BY INDEX_NAME
       HAVING SUM(CASE WHEN COLUMN_NAME = 'source_filename' THEN 1 ELSE 0 END) > 0
          AND SUM(CASE WHEN COLUMN_NAME = 'batch_hash' THEN 1 ELSE 0 END) = 0`
    );
    if (Array.isArray(filenameUniqueIndexes)) {
      for (const row of filenameUniqueIndexes as Record<string, unknown>[]) {
        const indexName = String(row.INDEX_NAME || '').replace(/`/g, '``');
        if (indexName) {
          await connection.query(`ALTER TABLE repstm_import_batch DROP INDEX \`${indexName}\``);
        }
      }
    }
    await connection.query(AUTHEN_SYNC_LOG_TABLE_SQL);
    await connection.query(AUTHEN_SYNC_CANCEL_TABLE_SQL);
    await connection.query(CLAIM_WORK_QUEUE_TABLE_SQL);
    await connection.query(CLAIM_REJECT_NOTE_TABLE_SQL);
  } finally {
    connection.release();
  }
};

const parseStoredSettingValue = <T>(value: unknown): T | null => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return trimmed as T;
    }
  }
  return value as T;
};

export const getAppSetting = async <T = unknown>(settingKey: string): Promise<T | null> => {
  const connection = await getUTFConnection();
  try {
    await connection.query(APP_SETTINGS_TABLE_SQL);
    const [rows] = await connection.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      [settingKey]
    );
    const record = Array.isArray(rows) && rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
    return record ? parseStoredSettingValue<T>(record.setting_value) : null;
  } catch (error) {
    console.error('Error reading app setting:', error);
    return null;
  } finally {
    connection.release();
  }
};

export const setAppSetting = async (settingKey: string, settingValue: unknown) => {
  const connection = await getUTFConnection();
  try {
    await connection.query(APP_SETTINGS_TABLE_SQL);
    await connection.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
      [settingKey, JSON.stringify(settingValue)]
    );
    return { success: true };
  } catch (error) {
    console.error('Error writing app setting:', error);
    return { success: false };
  } finally {
    connection.release();
  }
};

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
    const response = await fetch(requestUrl, {
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
        `SELECT nhso_status, nhso_seq
         FROM nhso_confirm_privilege
         WHERE vn = ?
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
    const finalRows = rawItems.map((row) => {
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
      let errorname = '';
      if (!lot) errorname = 'Error:ไม่พบ Lot No.';
      else if (!dose) errorname = 'Error:ไม่พบ Dose';
      else if (!dateexp || dateexp < serviceDate) errorname = 'Error:วันหมดอายุต้องมากกว่าวันที่บริการ';
      else if (code === 'I12' && serviceDate < '2023-07-01') errorname = 'Error:รหัส I12 ต้องเริ่มให้ตั้งแต่ 1 กรกฎาคม 2566';
      else if (code === '401' && serviceDate >= '2023-07-01') errorname = 'Error:รหัส 401 ต้องให้ก่อน 1 กรกฎาคม 2566';
      else if (['310', '311', '320'].includes(code)) errorname = 'Error:วัคซีน HPV ต้องใช้ตาม QuickWin เท่านั้น';
      else if (/^HPV/.test(code) && serviceDate < '2023-11-01') errorname = 'Warn:รหัส HPVxxx ต้องเริ่มให้ตั้งแต่ 1 พฤศจิกายน 2566';
      else if (/^HPV/.test(code) && (ageY < 11 || ageY > 20)) errorname = 'Warn:รหัส HPVxxx ไม่อยู่กลุ่มอายุ 11-20 ปี';
      else if (code === 'P41' && !merged.preg_no) errorname = 'Error:ไม่ระบุครรภ์ที่';
      else if (code === 'P41' && !merged.ga) errorname = 'Error:ไม่ระบุอายุครรภ์';
      else if (code === 'P41' && (Number(merged.ga) < 27 || Number(merged.ga) > 36)) errorname = 'Error:อายุครรภ์ต้อง 27-36 สัปดาห์';
      else if (!authencode) errorname = 'Warn:ไม่พบรหัส AuthenCode';
      return { ...merged, epi: merged.source_type, type, errorname, ready: errorname === '', missing_reason: errorname };
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
    const response = await fetch(requestUrl, { method: 'GET', headers });
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

const normalizeImportCellValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return JSON.stringify(value);
};

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
  const normalizedRows = rows.map((row) => {
    const normalizedEntries = Object.entries(row).map(([key, value]) => [key.trim(), normalizeImportCellValue(value)]);
    return Object.fromEntries(normalizedEntries.sort(([a], [b]) => a.localeCompare(b)));
  }).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const payload = stableStringify({
    scope,
    rowCount: normalizedRows.length,
    rows: normalizedRows,
  });
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

const parseFlexibleDateTime = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoMatch) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  const dmyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw = '00', minute = '00', second = '00'] = dmyMatch;
    const day = dayRaw.padStart(2, '0');
    const month = monthRaw.padStart(2, '0');
    const year = yearRaw.padStart(4, '0');
    const hour = hourRaw.padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  const dmyDashMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyDashMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw = '00', minute = '00', second = '00'] = dmyDashMatch;
    const day = dayRaw.padStart(2, '0');
    const month = monthRaw.padStart(2, '0');
    const yearNumber = Number(yearRaw);
    const year = String(yearNumber > 2400 ? yearNumber - 543 : yearNumber).padStart(4, '0');
    const hour = hourRaw.padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hour = String(parsed.getHours()).padStart(2, '0');
    const minute = String(parsed.getMinutes()).padStart(2, '0');
    const second = String(parsed.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  return null;
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
  hosConnection: mysql.PoolConnection,
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
  hosConnection: mysql.PoolConnection,
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
  repConnection: mysql.PoolConnection,
  hosConnection: mysql.PoolConnection,
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
    const maininscl = pickRowValueAdvanced(row, ['maininscl', 'สิทธิหลัก']);
    const subinscl = pickRowValueAdvanced(row, ['subinscl', 'สิทธิย่อย']);
    const errorcode = pickRowValueAdvanced(row, ['errorcode', 'error code']);
    const verifycode = pickRowValueAdvanced(row, ['verifycode', 'verify code']);
    const projectcode = pickRowValueAdvanced(row, ['projectcode', 'project code']);
    const percentpay = resolvePercentPay(pickRowValueAdvanced(row, ['percentpay', '%จ่าย', 'ร้อยละ']));
    const compensated = toAmountValue(pickRowValueAdvanced(row, ['ชดเชยสุทธิ', 'compensated', 'ชดเชยสุทธิรวม']));
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
  repConnection: mysql.PoolConnection,
  hosConnection: mysql.PoolConnection,
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
      'invoice_no', 'เลขที่เอกสาร', 'เลขที่ใบแจ้งหนี้', 'document_no', 'docno'
    ]);
    const tranId = pickRowValueAdvanced(row, ['TRAN_ID', 'transaction_uid', 'tranid']);
    const fallbackSiteSettings = (businessRules as Record<string, unknown>)?.site_settings as Record<string, unknown> | undefined;
    const hcode = pickRowValueAdvanced(row, ['HOSPCODE', 'hcode']) || String(fallbackSiteSettings?.hospital_code || '');
    const hn = pickRowValueAdvanced(row, ['HN']);
    const rawVn = pickRowValueAdvanced(row, ['VN', 'SEQ', 'seq', 'visit_no']);
    const rawAn = pickRowValueAdvanced(row, ['AN']);
    const pid = pickRowValueAdvanced(row, ['PID', 'CID']);
    const patientName = pickRowValueAdvanced(row, ['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล']);
    const patientType = pickRowValueAdvanced(row, ['ประเภทผู้ป่วย']);
    const serviceDateTime = parseFlexibleDateTime(pickRowValueAdvanced(row, ['service_datetime', 'service_date', 'date_serv', 'วันที่รับบริการ', 'วันที่']));
    const senddate = parseFlexibleDateTime(pickRowValueAdvanced(row, ['senddate', 'วันส่งข้อมูล']));
    const maininscl = pickRowValueAdvanced(row, ['maininscl', 'สิทธิหลัก']);
    const subinscl = pickRowValueAdvanced(row, ['subinscl', 'สิทธิย่อย']);
    const errorcode = pickRowValueAdvanced(row, ['errorcode', 'error code']);
    const verifycode = pickRowValueAdvanced(row, ['verifycode', 'verify code']);
    const amount = toAmountValue(pickRowValueAdvanced(row, ['amount', 'total', 'ยอดเงิน', 'จำนวนเงิน', 'sum_amount']));
    const paidAmount = toAmountValue(pickRowValueAdvanced(row, ['paid', 'paid_amount', 'ยอดชำระ']));
    const invoiceAmount = toAmountValue(pickRowValueAdvanced(row, ['invoice_amount', 'inv_amount', 'ยอดเรียกเก็บ']));

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
  connection: mysql.PoolConnection,
  batchId: number,
  dataType: 'REP' | 'STM' | 'INV',
  rows: Record<string, unknown>[]
) => {
  const batchSize = 500;
  for (let start = 0; start < rows.length; start += batchSize) {
    const slice = rows.slice(start, start + batchSize);
    const valuesSql = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];

    slice.forEach((row, offset) => {
      const summary = summarizeImportRow(row);
      params.push(
        batchId,
        dataType,
        start + offset + 1,
        summary.refKey,
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
       (batch_id, data_type, row_no, ref_key, hn, vn, an, cid, amount, service_date, raw_data)
       VALUES ${valuesSql}`,
      params
    );
  }
};

export const importRepstmRows = async (payload: {
  dataType: 'REP' | 'STM' | 'INV';
  sourceFilename: string;
  sheetName?: string;
  importedBy?: string;
  notes?: string;
  rows: Record<string, unknown>[];
}) => {
  await ensureRepstmTables();
  const connection = await getRepstmConnection();
  const hosConnection = await getUTFConnection();
  try {
    await connection.beginTransaction();

    const batchHash = buildBatchHash(payload.dataType, payload.rows);
    const [duplicateRows] = await connection.query(
      `SELECT id, row_count, source_filename, created_at
       FROM repstm_import_batch
       WHERE data_type = ? AND batch_hash = ?
       LIMIT 1`,
      [payload.dataType, batchHash]
    );

    if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
      await connection.rollback();
      const existing = duplicateRows[0] as Record<string, unknown>;
      return {
        success: true,
        duplicate: true,
        batchId: Number(existing.id || 0),
        rowCount: Number(existing.row_count || payload.rows.length),
        message: `ข้อมูลชุดนี้ถูกนำเข้าแล้วเมื่อ ${String(existing.created_at || '-')} (ตรวจจากเนื้อหาไฟล์)`,
      };
    }

    const [batchResult] = await connection.query(
      `INSERT INTO repstm_import_batch (data_type, source_filename, batch_hash, sheet_name, imported_by, row_count, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.dataType,
        payload.sourceFilename,
        batchHash,
        payload.sheetName || null,
        payload.importedBy || null,
        payload.rows.length,
        payload.notes || null,
      ]
    );

    const batchId = Number((batchResult as mysql.ResultSetHeader).insertId);

    await insertRepstmImportRows(connection, batchId, payload.dataType, payload.rows);

    if (payload.dataType === 'REP') {
      await importRepDataRows(connection, hosConnection, batchId, {
        sourceFilename: payload.sourceFilename,
        rows: payload.rows,
      });
    } else if (payload.dataType === 'STM' || payload.dataType === 'INV') {
      await importStatementDataRows(connection, hosConnection, batchId, {
        dataType: payload.dataType,
        sourceFilename: payload.sourceFilename,
        rows: payload.rows,
      });
    }

    await connection.commit();
    return { success: true, duplicate: false, batchId, rowCount: payload.rows.length };
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

export const getRepDataRows = async (limit = 200): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(REP_DATA_TABLE_SQL);
    const [rows] = await connection.query(
      `SELECT id, batch_id, rep_no, seq_no, tran_id, hcode, hn, vn, an, pid, patient_name, patient_type, department,
              admdate, dchdate, senddate, maininscl, subinscl, errorcode, verifycode, projectcode, filename,
              percentpay, income, compensated, nhso, agency, hc, ae, inst, op, ip, dmis, drug, ontop,
              diff, down_amount, up_amount, yymm, yearbudget, raw_data, created_at
       FROM rep_data
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [limit]
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
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
  return RECEIVABLE_RIGHT_MAPPINGS.find((item) => item.hosxp_code.toUpperCase() === code)
    || RECEIVABLE_RIGHT_MAPPINGS.find((item) => item.hipdata_code.toUpperCase() === hipdata)
    || null;
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
  const claimableAmount = isIpd
    ? (isWholeVisitReceivableHipdata(row.hipdata_code) ? totalIncome : toReceivableNumber(row.claimable_amount))
    : totalIncome;
  const isWholeVisit = !isIpd || isWholeVisitReceivableHipdata(row.hipdata_code);
  const hipdata = String(row.hipdata_code || '').trim().toUpperCase();

  return {
    ...row,
    claimable_amount: claimableAmount,
    item_count: isWholeVisit ? Math.max(toReceivableNumber(row.item_count), 1) : row.item_count,
    claim_summary: isIpd
      ? (isWholeVisitReceivableHipdata(row.hipdata_code) ? `เบิกได้ทั้ง Visit (${hipdata})` : row.claim_summary)
      : `ยอดรวมใบสั่งยา/ใบเสร็จ Visit (${hipdata})`,
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
             DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
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
           DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%Y-%m-%d') AS service_date,
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

    return resultRows.map(enrichReceivableRow);
  } catch (error) {
    console.error('Error reading receivable candidates:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const getReceivableBatches = async (limit = 50): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await ensureRepstmTables();
    const [rows] = await connection.query(
      `SELECT id, batch_no, patient_type, start_date, end_date, created_by, notes, item_count, total_receivable, created_at
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

// ---- Reconciliation: Compare claimable amounts vs REP/STM/INV per visit ----

export interface ReconciliationQueryParams {
  startDate?: string;
  endDate?: string;
  patientType?: string;
  patientRight?: string;
  hosxpRight?: string;
  financeRight?: string;
  compareStatus?: string;
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
  service_date: string;
  claimable_amount: number;
  rep_amount: number | null;
  rep_no: string | null;
  has_rep: boolean;
  stm_amount: number | null;
  stm_paid_amount: number | null;
  has_stm: boolean;
  inv_amount: number | null;
  inv_invoice_amount: number | null;
  has_inv: boolean;
  diff_rep: number | null;
  diff_stm: number | null;
  diff_inv: number | null;
  compare_status: string;
}

export const getVisitRepStmComparison = async (params: ReconciliationQueryParams): Promise<{
  data: ReconciliationRow[];
  total: number;
  summary: {
    total_visits: number;
    matched: number;
    mismatched: number;
    pending_rep: number;
    pending_stm: number;
    no_data: number;
    total_claimable: number;
    total_rep: number;
    total_stm: number;
    total_inv: number;
  };
}> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(params.startDate || today).slice(0, 10);
  const endDate = String(params.endDate || startDate).slice(0, 10);
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(500, Math.max(10, Number(params.pageSize || 100)));
  const compareStatusFilter = String(params.compareStatus || '').trim();

  // Step 1: get total count and base rows for current page using DB-level pagination
  // When compareStatus filter is active we must scan all rows (slower) but still cap at 5000 for safety
  const candidateParams = {
    startDate,
    endDate,
    patientType: params.patientType,
    patientRight: params.patientRight,
    hosxpRight: params.hosxpRight,
    financeRight: params.financeRight,
  };

  const totalCount = await countReceivableCandidates(candidateParams);

  if (totalCount === 0) {
    const emptySummary = {
      total_visits: 0, matched: 0, mismatched: 0, pending_rep: 0, pending_stm: 0,
      no_data: 0, total_claimable: 0, total_rep: 0, total_stm: 0, total_inv: 0,
    };
    return { data: [], total: 0, summary: emptySummary };
  }

  // Fetch only current page from DB (no compareStatus pre-filter possible at this stage)
  // If compareStatus filter is active, load up to 2000 rows to find enough matches
  const fetchLimit = compareStatusFilter ? Math.min(totalCount, 2000) : pageSize;
  const fetchOffset = compareStatusFilter ? 0 : (page - 1) * pageSize;

  const baseRows = await getReceivableCandidates({
    ...candidateParams,
    limit: fetchLimit,
    offset: fetchOffset,
  });

  if (baseRows.length === 0) {
    const emptySummary = {
      total_visits: 0, matched: 0, mismatched: 0, pending_rep: 0, pending_stm: 0,
      no_data: 0, total_claimable: 0, total_rep: 0, total_stm: 0, total_inv: 0,
    };
    return { data: [], total: 0, summary: emptySummary };
  }

  const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const toNumNull = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  const vns = Array.from(new Set(baseRows.map(r => String(r.vn || '').trim()).filter(Boolean)));
  const ans = Array.from(new Set(baseRows.map(r => String(r.an || '').trim()).filter(Boolean)));

  const repConnection = await getRepstmConnection();
  const repMap = new Map<string, { rep_amount: number; rep_no: string }>();
  const repTranToVisit = new Map<string, string>();
  const stmMap = new Map<string, { stm_amount: number | null; stm_paid_amount: number | null }>();
  const invMap = new Map<string, { inv_amount: number | null; inv_invoice_amount: number | null }>();

  try {
    await ensureRepstmTables();

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
           GROUP_CONCAT(DISTINCT rep_no ORDER BY rep_no SEPARATOR ', ') AS rep_no
         FROM rep_data
         WHERE ${repClauses.join(' OR ')}
         GROUP BY COALESCE(vn, ''), COALESCE(an, '')`,
        repParams
      );
      (Array.isArray(repRows) ? repRows : []).forEach((r) => {
        const rec = r as Record<string, unknown>;
        const vn = String(rec.vn || '').trim();
        const an = String(rec.an || '').trim();
        const entry = { rep_amount: toNum(rec.rep_amount), rep_no: String(rec.rep_no || '') };
        if (vn) repMap.set(`VN:${vn}`, entry);
        if (an) repMap.set(`AN:${an}`, entry);
      });

      const [repTranRows] = await repConnection.query(
        `SELECT
           COALESCE(tran_id, '') AS tran_id,
           COALESCE(vn, '') AS vn,
           COALESCE(an, '') AS an
         FROM rep_data
         WHERE (${repClauses.join(' OR ')})
           AND NULLIF(TRIM(COALESCE(tran_id, '')), '') IS NOT NULL`,
        repParams
      );
      (Array.isArray(repTranRows) ? repTranRows : []).forEach((r) => {
        const rec = r as Record<string, unknown>;
        const tranId = String(rec.tran_id || '').trim();
        const vn = String(rec.vn || '').trim();
        const an = String(rec.an || '').trim();
        if (!tranId) return;
        repTranToVisit.set(tranId, vn || an || '');
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
           COALESCE(s.matched_visit_code, s.vn, s.an, '') AS visit_code,
           COALESCE(s.tran_id, '') AS tran_id,
           s.data_type,
           SUM(COALESCE(s.amount, 0)) AS total_amount,
           SUM(COALESCE(s.paid_amount, 0)) AS total_paid_amount,
           SUM(COALESCE(s.invoice_amount, 0)) AS total_invoice_amount
         FROM repstm_statement_data s
         WHERE s.data_type IN ('STM', 'INV')
           AND (${stmClauses.join(' OR ')})
         GROUP BY COALESCE(s.matched_visit_code, s.vn, s.an, ''), COALESCE(s.tran_id, ''), s.data_type`,
        stmParams
      );
      (Array.isArray(stmRows) ? stmRows : []).forEach((r) => {
        const rec = r as Record<string, unknown>;
        const tranId = String(rec.tran_id || '').trim();
        const vc = String(rec.visit_code || '').trim() || (tranId ? (repTranToVisit.get(tranId) || '') : '');
        const dtype = String(rec.data_type || '').toUpperCase();
        if (!vc) return;
        if (dtype === 'STM') {
          stmMap.set(vc, { stm_amount: toNumNull(rec.total_amount), stm_paid_amount: toNumNull(rec.total_paid_amount) });
        } else if (dtype === 'INV') {
          invMap.set(vc, { inv_amount: toNumNull(rec.total_amount), inv_invoice_amount: toNumNull(rec.total_invoice_amount) });
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

    const repAmt = rep ? rep.rep_amount : null;
    const stmAmt = stm ? stm.stm_amount : null;
    const invAmt = inv ? inv.inv_amount : null;

    const diffRep = repAmt != null ? repAmt - claimable : null;
    const diffStm = stmAmt != null ? stmAmt - claimable : null;
    const diffInv = invAmt != null ? invAmt - claimable : null;

    const hasRep = repAmt != null;
    const hasStm = stmAmt != null;
    const hasInv = invAmt != null;

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
      const stmOk = (stmAmt == null || (diffStm != null && Math.abs(diffStm) < 0.01));
      const invOk = (invAmt == null || (diffInv != null && Math.abs(diffInv) < 0.01));
      if (repOk && stmOk && invOk) compareStatus = 'ตรงกัน';
      else compareStatus = 'ยอดต่าง';
    }
    // Override: if claimable > 0 but no REP
    if (claimable > 0 && !hasRep) {
      if (!hasStm && !hasInv) compareStatus = 'รอ REP';
      else compareStatus = compareStatus === 'ตรงกัน' ? 'ตรงกัน' : 'รอ REP';
    }
    if (claimable > 0 && hasRep && !hasStm && !hasInv) {
      compareStatus = 'รอ STM/INV';
    }

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
      service_date: String(base.service_date || ''),
      claimable_amount: claimable,
      rep_amount: repAmt,
      rep_no: rep ? rep.rep_no || null : null,
      has_rep: hasRep,
      stm_amount: stmAmt,
      stm_paid_amount: stm ? stm.stm_paid_amount : null,
      has_stm: hasStm,
      inv_amount: invAmt,
      inv_invoice_amount: inv ? inv.inv_invoice_amount : null,
      has_inv: hasInv,
      diff_rep: diffRep,
      diff_stm: diffStm,
      diff_inv: diffInv,
      compare_status: compareStatus,
    };
  });

  // --- Step 5: Filter by compareStatus if requested ---
  const filtered = compareStatusFilter
    ? assembled.filter(r => r.compare_status === compareStatusFilter)
    : assembled;

  // --- Step 6: Summary ---
  const summary = {
    total_visits: filtered.length,
    matched: filtered.filter(r => r.compare_status === 'ตรงกัน').length,
    mismatched: filtered.filter(r => r.compare_status === 'ยอดต่าง').length,
    pending_rep: filtered.filter(r => r.compare_status === 'รอ REP').length,
    pending_stm: filtered.filter(r => r.compare_status === 'รอ STM/INV').length,
    no_data: filtered.filter(r => r.compare_status === 'ไม่มีข้อมูล').length,
    total_claimable: Math.round(filtered.reduce((s, r) => s + r.claimable_amount, 0) * 100) / 100,
    total_rep: Math.round(filtered.reduce((s, r) => s + (r.rep_amount ?? 0), 0) * 100) / 100,
    total_stm: Math.round(filtered.reduce((s, r) => s + (r.stm_amount ?? 0), 0) * 100) / 100,
    total_inv: Math.round(filtered.reduce((s, r) => s + (r.inv_amount ?? 0), 0) * 100) / 100,
  };

  // --- Step 7: Paginate ---
  // When compareStatus filter is active: paginate the filtered in-memory set
  // When no filter: data was already fetched page-by-page from DB, so return all assembled rows
  let total: number;
  let data: ReconciliationRow[];
  if (compareStatusFilter) {
    total = filtered.length;
    const offset = (page - 1) * pageSize;
    data = filtered.slice(offset, offset + pageSize);
  } else {
    // DB-level paging was used; total = full count from DB, data = the assembled page rows
    total = totalCount;
    data = filtered; // filtered may only differ from assembled if compareStatus filter applied
  }

  return { data, total, summary };
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
  const connection = await getRepstmConnection();
  try {
    await ensureRepstmTables();
    await connection.beginTransaction();
    const batchNo = `AR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const totalReceivable = items.reduce((sum, item) => sum + toReceivableNumber(item.claimable_amount), 0);

    const [insertResult] = await connection.query(
      `INSERT INTO receivable_batch
        (batch_no, patient_type, start_date, end_date, created_by, notes, item_count, total_receivable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchNo,
        String(payload.patientType || 'ALL').toUpperCase(),
        String(payload.startDate || '').slice(0, 10),
        String(payload.endDate || payload.startDate || '').slice(0, 10),
        payload.createdBy || null,
        payload.notes || null,
        items.length,
        totalReceivable,
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
    return { success: true, batchId, batchNo, itemCount: items.length, totalReceivable };
  } catch (error) {
    await connection.rollback();
    console.error('Error saving receivable batch:', error);
    return { success: false, error };
  } finally {
    connection.release();
  }
};

export const getRepstmImportBatches = async (
  dataType?: 'REP' | 'STM' | 'INV',
  limit = 20
): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(REPSTM_IMPORT_BATCH_TABLE_SQL);
    const [rows] = await connection.query(
      `SELECT id, data_type, source_filename, sheet_name, imported_by, row_count, notes, created_at
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

export const getRepstmImportedRows = async (
  dataType: 'REP' | 'STM' | 'INV',
  limit = 200
): Promise<Record<string, unknown>[]> => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(REPSTM_IMPORT_ROW_TABLE_SQL);
    const [rows] = await connection.query(
      `SELECT r.id, r.batch_id, r.data_type, r.row_no, r.ref_key, r.hn, r.vn, r.an, r.cid, r.amount, r.service_date, r.raw_data, r.created_at,
              b.source_filename, b.sheet_name
       FROM repstm_import_row r
       JOIN repstm_import_batch b ON b.id = r.batch_id
       WHERE r.data_type = ?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?`,
      [dataType, limit]
    );
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } catch (error) {
    console.error('Error reading REP/STM/INV imported rows:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ============================================================
// Work Queue Functions
// ============================================================

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
        (SELECT icd10 FROM ovstdiag WHERE vn = ovst.vn AND diagtype = '1' LIMIT 1) as main_diag,
        CASE 
          WHEN ovst.an IS NOT NULL AND ovst.an != '' THEN 'ผู้ป่วยใน'
          ELSE 'ผู้ป่วยนอก'
        END as serviceType,
        COALESCE(SUM(opitemrece.unitprice * opitemrece.qty), 0) as price,
        
        -- กองทุนพิเศษ Subqueries
        TIMESTAMPDIFF(YEAR, pt.birthday, ovst.vstdate) as age_y,
        CASE WHEN ${buildTelemedExistsSql('ovst', 'ovstist')} THEN 1 ELSE 0 END as has_telmed,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = 'DRUGP' LIMIT 1) as has_drugp,
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
        CASE WHEN v.age_y BETWEEN 45 AND 59 THEN 1 ELSE 0 END as chol_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12004' LIMIT 1) THEN 1 ELSE 0 END as has_chol_adp,
        CASE WHEN ${buildCholLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_chol_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', CHOL_DX_CODES)} THEN 1 ELSE 0 END as has_chol_diag,
        CASE
          WHEN v.age_y BETWEEN 45 AND 59
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
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND (d.nhso_adp_code IN ('FP003_1','FP003_2') OR d.name LIKE '%ANNA%' OR d.name LIKE '%LYNESTRENOL%') LIMIT 1) as has_fp_pill,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = 'FP003_4' LIMIT 1) as has_fp_condom,
        
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

    query += ` GROUP BY ovst.vn, ovst.hn, pt.pname, pt.fname, pt.lname, pttype.name, pttype.hipdata_code, ovst.vstdate, ovst.ovstost, pt.birthday, ovst.pt_subtype, v.age_y ORDER BY ovst.vstdate DESC, ovst.vn DESC`;

    const [rows] = await connection.query(query, params);
    connection.release();

    return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('Error fetching check data from HOSxP:', error);
    // Return empty array to fallback to mock data in index.ts
    return [];
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
export const getDrugPrices = async (vn: string): Promise<Record<string, unknown>[]> => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT 
        opitemrece.icode,
        COALESCE(s_drugitems.name, drugitems.name, opitemrece.icode) as drugName,
        opitemrece.qty,
        opitemrece.unitprice as unitPrice,
        (opitemrece.qty * opitemrece.unitprice) as price,
        s_drugitems.nhso_adp_code,
        s_drugitems.tmlt_code,
        s_drugitems.ttmt_code,
        CASE 
          WHEN s_drugitems.nhso_adp_code IS NOT NULL AND s_drugitems.nhso_adp_code != ''
          THEN 1 
          ELSE 0 
        END as has_adp_mapping
      FROM opitemrece
      INNER JOIN drugitems ON opitemrece.icode = drugitems.icode
      LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
      WHERE opitemrece.vn = ?
      ORDER BY opitemrece.icode`,
      [vn]
    );

    return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('Error fetching drug prices:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ฟังก์ชันดึงข้อมูลค่าบริการ ADP Code (เฉพาะรายการที่ไม่ใช่ยา)
export const getServiceADPCodes = async (vn: string): Promise<Record<string, unknown>[]> => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT DISTINCT
        opitemrece.icode,
        opitemrece.income,
        income.name as income_name,
        COALESCE(nondrugitems.name, opitemrece.icode) as adp_name,
        opitemrece.unitprice as adp_price,
        s_drugitems.nhso_adp_code as adp_code,
        CASE 
          WHEN s_drugitems.nhso_adp_code IS NOT NULL AND s_drugitems.nhso_adp_code != ''
          THEN 1 
          ELSE 0 
        END as can_claim
      FROM opitemrece
      LEFT JOIN income ON opitemrece.income = income.income
      LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
      LEFT JOIN nondrugitems ON opitemrece.icode = nondrugitems.icode
      WHERE opitemrece.vn = ? 
      AND opitemrece.income IS NOT NULL
      AND opitemrece.icode NOT IN (
        SELECT icode FROM drugitems
      )
      ORDER BY opitemrece.income`,
      [vn]
    );

    return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('Error fetching service ADP codes:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ฟังก์ชันดึงข้อมูลรายการใบเสร็จจาก opitemrece โยงกับ s_drugitems
export const getReceiptItems = async (vn: string): Promise<Record<string, unknown>[]> => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT 
        opitemrece.vn,
        opitemrece.hn,
        opitemrece.an,
        opitemrece.icode,
        opitemrece.qty,
        opitemrece.unitprice,
        opitemrece.sum_price,
        opitemrece.discount,
        opitemrece.vstdate,
        opitemrece.income,
        income.name as income_name,
        income.income_group,
        
        -- ชื่อรายการจากตารางต่างๆ
        COALESCE(s_drugitems.name, drugitems.name, nondrugitems.name, opitemrece.icode) as item_name,
          -- ข้อมูลจาก s_drugitems (รหัสต่างๆ)
        s_drugitems.nhso_adp_code,
        s_drugitems.tmlt_code,
        s_drugitems.ttmt_code,
        s_drugitems.name as s_drugname,
        s_drugitems.ename as s_drugname_en,
        s_drugitems.strength as s_strength,
        s_drugitems.units as s_units,
        
        -- จำแนกประเภทรายการ
        CASE 
          WHEN s_drugitems.icode IS NOT NULL THEN 'ยา (s_drugitems)'
          WHEN drugitems.icode IS NOT NULL THEN 'ยา (drugitems)'
          WHEN nondrugitems.icode IS NOT NULL THEN 'เวชภัณฑ์'
          WHEN income.income_group = 'DRUG' THEN 'ยา'
          WHEN income.income_group = 'LAB' THEN 'การตรวจวิเคราะห์'
          WHEN income.income_group = 'XRAY' THEN 'การตรวจเอกซเรย์'
          WHEN income.income_group = 'TREAT' THEN 'การรักษา'
          ELSE 'บริการอื่นๆ'
        END as item_type,
        
        -- สถานะการเบิก/เคลม
        CASE 
          WHEN s_drugitems.nhso_adp_code IS NOT NULL AND s_drugitems.nhso_adp_code != '' THEN 1
          ELSE 0 
        END as has_nhso_adp,
        
        CASE 
          WHEN s_drugitems.tmlt_code IS NOT NULL AND s_drugitems.tmlt_code != '' THEN 1
          ELSE 0 
        END as has_tmlt,
        
        CASE 
          WHEN s_drugitems.ttmt_code IS NOT NULL AND s_drugitems.ttmt_code != '' THEN 1
          ELSE 0 
        END as has_ttmt
        
      FROM opitemrece
      LEFT JOIN income ON opitemrece.income = income.income
      LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
      LEFT JOIN drugitems ON opitemrece.icode = drugitems.icode  
      LEFT JOIN nondrugitems ON opitemrece.icode = nondrugitems.icode
      WHERE opitemrece.vn = ?
      ORDER BY opitemrece.income, opitemrece.icode`,
      [vn]
    );

    return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('Error fetching receipt items with s_drugitems mapping:', error);
    return [];
  } finally {
    connection.release();
  }
};
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
    return null;
  } finally {
    connection.release();
  }
};

// ทดสอบการเชื่อมต่อ
export const testConnection = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    console.log('✅ Successfully connected to HOSxP database');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to HOSxP database:', error);
    console.log('⚠️ Will use mock data instead');
    return false;
  } finally {
    connection.release();
  }
};

// Enhanced database connection test
export const testDatabaseConnection = async (): Promise<{
  isConnected: boolean;
  hasData: boolean;
  tableCount: number;
  sampleRecordCount: number;
  error?: string;
}> => {
  try {
    const connection = await pool.getConnection();

    try {
      // Test basic connection
      await connection.query('SELECT 1');

      // Check if we can access patient data
      const [patientRows] = await connection.query('SELECT COUNT(*) as count FROM patient LIMIT 1');
      const patientCount = (patientRows as Record<string, unknown>[])[0]?.count as number || 0;

      // Check if we have recent visit data
      const [visitRows] = await connection.query(
        'SELECT COUNT(*) as count FROM ovst WHERE vstdate >= CURDATE() - INTERVAL 30 DAY'
      );
      const recentVisitCount = (visitRows as Record<string, unknown>[])[0]?.count as number || 0;

      // Get table count
      const [tableRows] = await connection.query(
        'SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?',
        [process.env.HOSXP_DB || 'hos']
      );
      const tableCount = (tableRows as Record<string, unknown>[])[0]?.count as number || 0;

      return {
        isConnected: true,
        hasData: patientCount > 0 && recentVisitCount > 0,
        tableCount,
        sampleRecordCount: recentVisitCount,
      };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Database connection test failed:', error);
    return {
      isConnected: false,
      hasData: false,
      tableCount: 0,
      sampleRecordCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

// ฟังก์ชันตรวจสอบโครงสร้างตาราง (สำหรับการ debug)
export const getTableInfo = async (tableName: string) => {
  const connection = await pool.getConnection();
  try {
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [process.env.HOSXP_DB || 'hos', tableName]
    );
    return columns || [];
  } catch (error) {
    console.error(`Error getting table info for ${tableName}:`, error);
    return [];
  } finally {
    connection.release();
  }
};

export const getAllTables = async () => {
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?`,
      [process.env.HOSXP_DB || 'hos']
    );
    return tables || [];
  } catch (error) {
    console.error('Error getting all tables:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ฟังก์ชันทดสอบโครงสร้างตาราง s_drugitems
export const testSDrugitemsStructure = async (): Promise<Record<string, unknown>[]> => {
  const connection = await pool.getConnection();
  try {
    console.log('🔍 Testing s_drugitems table structure...');

    // ตรวจสอบว่าตาราง s_drugitems มีอยู่หรือไม่
    const [tableCheck] = await connection.query(
      "SHOW TABLES LIKE 's_drugitems'"
    );

    if (Array.isArray(tableCheck) && tableCheck.length === 0) {
      console.log('❌ Table s_drugitems does not exist');
      return [];
    }

    console.log('✅ Table s_drugitems exists');

    // ตรวจสอบโครงสร้างคอลัมน์
    const [columns] = await connection.query(
      "DESCRIBE s_drugitems"
    );

    console.log('📋 s_drugitems columns:', columns);

    // ตรวจสอบข้อมูลตัวอย่าง 5 รายการแรก
    const [sampleData] = await connection.query(
      "SELECT * FROM s_drugitems LIMIT 5"
    );

    console.log('📊 Sample data from s_drugitems:', sampleData);

    return (Array.isArray(columns) ? columns : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('❌ Error testing s_drugitems structure:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ฟังก์ชันทดสอบการเชื่อมต่อ opitemrece กับ s_drugitems
export const testReceiptJoin = async (vn: string): Promise<Record<string, unknown>[]> => {
  const connection = await pool.getConnection();
  try {
    console.log(`🔍 Testing receipt join for VN: ${vn}`);

    // ตรวจสอบข้อมูลใน opitemrece ก่อน
    const [opitemreceData] = await connection.query(
      "SELECT * FROM opitemrece WHERE vn = ? LIMIT 5",
      [vn]
    );

    console.log('📊 opitemrece data:', opitemreceData);

    if (Array.isArray(opitemreceData) && opitemreceData.length === 0) {
      console.log('❌ No data found in opitemrece for VN:', vn);
      return [];
    }

    // ทดสอบ JOIN แบบเบื้องต้น (ไม่ใช้คอลัมน์ที่มีปัญหา)
    const [basicJoin] = await connection.query(
      `SELECT 
        opitemrece.vn,
        opitemrece.icode,
        opitemrece.qty,
        opitemrece.sum_price,
        s_drugitems.icode as s_icode,
        s_drugitems.name as s_name
      FROM opitemrece
      LEFT JOIN s_drugitems ON opitemrece.icode = s_drugitems.icode
      WHERE opitemrece.vn = ?
      LIMIT 10`,
      [vn]
    );

    console.log('📊 Basic join result:', basicJoin);

    return (Array.isArray(basicJoin) ? basicJoin : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('❌ Error testing receipt join:', error);
    return [];
  } finally {
    connection.release();
  }
};
// ฟังก์ชันดึงข้อมูล Visit ที่เข้าข่ายส่งเบิก FDH
export const getEligibleVisits = async (
  startDate?: string,
  endDate?: string,
  fund?: string,
  applyLimit: boolean = true
): Promise<Record<string, unknown>[]> => {
  const connection = await getUTFConnection();
  try {
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
        pttype.hipdata_code,
        ovst.vsttime,
        
        -- กองทุนพิเศษ Subqueries
        -- บริการจัดการ Tag พื้นฐาน
        CASE WHEN ${buildTelemedExistsSql('ovst', 'ovstist')} THEN 1 ELSE 0 END as has_telmed,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '${businessRules.adp_codes.drugp}' LIMIT 1) as has_drugp,
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
        CASE WHEN v.age_y BETWEEN 45 AND 59 THEN 1 ELSE 0 END as chol_age_eligible,
        CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = '12004' LIMIT 1) THEN 1 ELSE 0 END as has_chol_adp,
        CASE WHEN ${buildCholLabExistsSql('ovst')} THEN 1 ELSE 0 END as has_chol_lab,
        CASE WHEN ${buildDiagnosisMatchSql('ovst', 'v', CHOL_DX_CODES)} THEN 1 ELSE 0 END as has_chol_diag,
        CASE
          WHEN v.age_y BETWEEN 45 AND 59
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
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code IN ('FP003_1','FP003_2') LIMIT 1) as has_fp_pill,
        (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = ovst.vn AND d.nhso_adp_code = 'FP003_4' LIMIT 1) as has_fp_condom,
        
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
          WHEN (pttype.name LIKE '%สุขภาพ%' OR pttype.name LIKE '%บัตรทอง%' OR pttype.name = 'UCS') AND ovst.hospmain != '${process.env.HOSXP_HCODE || businessRules.hospital.hcode}' THEN 'OPANY'
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
        ) as close_status

      FROM ovst
      LEFT JOIN patient pt ON ovst.hn = pt.hn
      LEFT JOIN pttype ON ovst.pttype = pttype.pttype
      LEFT JOIN vn_stat v ON v.vn = ovst.vn
      LEFT JOIN ovstist ON ovstist.ovstist = ovst.ovstist
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (startDate) {
      query += ` AND ovst.vstdate >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND ovst.vstdate <= ?`;
      params.push(endDate);
    }

    if (fund && fund !== 'ทั้งหมด' && fund !== '') {
      query += ` AND pttype.name = ?`;
      params.push(fund);
    }

    query += ` ORDER BY ovst.vstdate DESC, ovst.vsttime DESC`;
    if (applyLimit) {
      query += ` LIMIT ${businessRules.query_limits.default_limit}`;
    }

    const [rows] = await connection.query(query, params);
    return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('Error fetching eligible visits:', error);
    return [];
  } finally {
    connection.release();
  }
};

// ฟังก์ชันดึงข้อมูลแบบละเอียดสำหรับส่งออก 16 แฟ้ม (FDH)
export const getExportData = async (vns: string[]) => {
  if (!vns || vns.length === 0) return null;

  const connection = await getUTFConnection();
  try {
    // 🏥 1. Get hospital code from config (Check multiple column variations)
    let hcode = process.env.HOSXP_HCODE || businessRules.hospital.hcode;
    try {
      const [config] = await connection.query('SELECT * FROM opdconfig LIMIT 1');
      const conf = (config as any)?.[0];
      if (conf) {
        hcode = conf.hospitalcode || conf.hospital_code || hcode;
      }
    } catch (e) {
      console.warn('⚠️ Could not fetch hospitalcode from opdconfig, using default:', hcode);
    }

    console.log(`📦 Generating 16-folder export data for ${vns.length} visits (HCODE: ${hcode})...`);

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
        DATE_FORMAT(COALESCE(vp.expire_date, ovst.vstdate), '%Y%m%d') AS DATEEXP,
        COALESCE(NULLIF(ovst.hospmain, ''), ?) AS HOSPMAIN,
        COALESCE(NULLIF(ovst.hospsub, ''), COALESCE(NULLIF(ovst.hospmain, ''), ?)) AS HOSPSUB,
        '' AS GOVCODE,
        '' AS GOVNAME,
        COALESCE(auth.claim_code, '') AS PERMITNO,
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
        pt.nationality as NATION,
        pt.cid as PERSON_ID,
        CONCAT('"', CONCAT(COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, ''), ',', COALESCE(pt.pname, '')), '"') as NAMEPAT,
        pt.pname as TITLE,
        pt.fname as FNAME,
        pt.lname as LNAME,
        '1' as IDTYPE
      FROM patient pt
      WHERE pt.hn IN (SELECT hn FROM ovst WHERE vn IN (?))
    `, [hcode, vns]);

    // 3. OPD (Visit)
    const opd = await runQuery('OPD', `
      SELECT 
        o.hn AS HN,
        o.main_dep AS CLINIC,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEOPD,
        DATE_FORMAT(o.vsttime, '%H%i') AS TIMEOPD,
        o.vn AS SEQ,
        '1' AS UUC,
        COALESCE(s.cc, '') AS DETAIL,
        '' AS BTEMP,
        '' AS SBP,
        '' AS DBP,
        '' AS PR,
        '' AS RR,
        '' AS OPTYPE,
        '1' AS TYPEIN,
        '' AS TYPEOUT
      FROM ovst o
      LEFT JOIN opdscreen s ON o.vn = s.vn
      WHERE o.vn IN (?)
    `, [vns]);

    // 4. ORF (Refer Out)
    const orf = await runQuery('ORF', `
      SELECT 
        r.hn as HN,
        DATE_FORMAT(o.vstdate, '%Y%m%d') as DATEOPD,
        o.main_dep as CLINIC,
        r.hospcode as REFER,
        COALESCE(r.refer_type, '1') as REFERTYPE,
        r.vn as SEQ,
        DATE_FORMAT(r.refer_date, '%Y%m%d') as REFERDATE
      FROM referout r
      LEFT JOIN ovst o ON r.vn = o.vn
      WHERE r.vn IN (?)
    `, [vns]);

    // 5. ODX (Diagnosis)
    const odx = await runQuery('ODX', `
      SELECT 
        o.hn AS HN,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEDX,
        COALESCE(o.main_dep, '') AS CLINIC,
        dx.icd10 AS DIAG,
        dx.diagtype AS DXTYPE,
        dx.doctor AS DRDX,
        COALESCE(pt.cid, '') AS PERSON_ID,
        dx.vn AS SEQ
      FROM ovstdiag dx
      JOIN ovst o ON dx.vn = o.vn
      LEFT JOIN patient pt ON o.hn = pt.hn
      WHERE dx.vn IN (?)
    `, [vns]);

    // 6. OOP (Procedures)
    const oop = await runQuery('OOP', `
      SELECT 
        ovst.hn AS HN,
        DATE_FORMAT(ovst.vstdate, '%Y%m%d') AS DATEOPD,
        ovst.main_dep AS CLINIC,
        d.icd9 AS OPER,
        d.doctor AS DROPID,
        COALESCE(pt.cid, '') AS PERSON_ID,
        ovst.vn AS SEQ,
        '' AS SERVPRICE
      FROM doctor_operation d
      JOIN ovst ON d.vn = ovst.vn
      LEFT JOIN patient pt ON ovst.hn = pt.hn
      WHERE d.vn IN (?)
    `, [vns]);

    // 7. IPD (Admission)
    const ipd = await runQuery('IPD', `
      SELECT 
        hn AS HN,
        an AS AN,
        DATE_FORMAT(regdate, '%Y%m%d') AS DATEADM,
        DATE_FORMAT(regtime, '%H%i') AS TIMEADM,
        DATE_FORMAT(dchdate, '%Y%m%d') AS DATEDSC,
        DATE_FORMAT(dchtime, '%H%i') AS TIMEDSC,
        dchstts AS DISCHS,
        dchtype AS DISCHT,
        ward AS WARDDSC,
        dept AS DEPT,
        ward AS ADM_W,
        '1' AS UUC,
        '1' AS SVCTYPE
      FROM ipt
      WHERE vn IN (?)
    `, [vns]);

    // 8. IRF (Refer IPD)
    const irf = await runQuery('IRF', `
      SELECT 
        an as AN,
        hospcode as REFER,
        COALESCE(r.refer_type, '1') as REFERTYPE
      FROM referout r
      WHERE r.vn IN (?) AND r.an IS NOT NULL AND r.an != ''
    `, [vns]);

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
        an AS AN,
        icd9 AS OPER,
        '1' AS OPTYPE,
        '' AS DROPID,
        '' AS DATEIN,
        '' AS TIMEIN,
        '' AS DATEOUT,
        '' AS TIMEOUT
      FROM iptoprt
      WHERE an IN (SELECT an FROM ipt WHERE vn IN (?))
    `, [vns]);

    // 11. CHT (Financial Summary)
    const cht = await runQuery('CHT', `
      SELECT 
        o.hn AS HN,
        COALESCE(o.an, '') AS AN,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATE,
        IFNULL(v.income, 0) AS TOTAL,
        IFNULL(v.rcpt_money, 0) AS PAID,
        o.pttype AS PTTYPE,
        COALESCE(pt.cid, '') AS PERSON_ID,
        o.vn AS SEQ,
        '' AS OPD_MEMO,
        '' AS INVOICE_NO,
        '' AS INVOICE_LT
      FROM ovst o
      LEFT JOIN vn_stat v ON o.vn = v.vn
      LEFT JOIN patient pt ON o.hn = pt.hn
      WHERE o.vn IN (?)
    `, [vns]);

    // 12. CHA (Financial Details)
    const cha = await runQuery('CHA', `
      SELECT 
        o.hn as HN,
        o.an as AN,
        DATE_FORMAT(o.vstdate, '%Y%m%d') as DATE,
        o.income as CHRGITEM,
        o.sum_price as AMOUNT,
        pt.cid as PERSON_ID,
        o.vn as SEQ
      FROM opitemrece o
      JOIN patient pt ON o.hn = pt.hn
      WHERE o.vn IN (?)
    `, [vns]);

    // 13. AER (Accident/Emergency)
    const aer = await runQuery('AER', `
      SELECT 
        hn AS HN,
        COALESCE(an, '') AS AN,
        DATE_FORMAT(vstdate, '%Y%m%d') AS DATEOPD,
        '' AS AUTHAE,
        DATE_FORMAT(vstdate, '%Y%m%d') AS AEDATE,
        DATE_FORMAT(vsttime, '%H%i') AS AETIME,
        '1' AS AETYPE,
        '' AS REFER_NO,
        '' AS REFMAINI,
        '' AS IREFTYPE,
        '' AS REFMAINO,
        '' AS OREFTYPE,
        '' AS UCAE,
        '' AS EMTYPE,
        vn AS SEQ,
        '' AS AESTATUS,
        '' AS DALERT,
        '' AS TALERT
      FROM er_regist
      WHERE vn IN (?)
    `, [vns]);

    // 14. ADP (Additionals)
    // รองรับทั้ง ADP จาก nondrugitems และ s_drugitems เพราะกองทุนพิเศษจำนวนมาก map ไว้ใน s_drugitems
    const adp = await runQuery('ADP', `
      SELECT 
        o.hn AS HN,
        COALESCE(o.an, '') AS AN,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATEOPD,
        '' AS BILLMAUD,
        COALESCE(n.nhso_adp_type_id, '4') AS TYPE,
        COALESCE(n.nhso_adp_code, sd.nhso_adp_code, o.icode) AS CODE,
        o.qty AS QTY,
        o.unitprice AS RATE,
        o.vn AS SEQ,
        '' AS CAGCODE,
        '' AS DOSE,
        '' AS CA_TYPE,
        '' AS SERIALNO,
        '0.00' AS TOTCOPAY,
        '' AS USE_STATUS,
        o.sum_price AS TOTAL,
        COALESCE(o.qty, 0) AS QTYDAY,
        COALESCE(sd.tmlt_code, '') AS TMLTCODE,
        '' AS STATUS1,
        '' AS BI,
        '' AS GRAVIDA,
        '' AS GA_WEEK,
        '' AS DCIP,
        '' AS LMP,
        '' AS SP_ITEM
      FROM opitemrece o
      LEFT JOIN nondrugitems n ON o.icode = n.icode
      LEFT JOIN s_drugitems sd ON o.icode = sd.icode
      WHERE o.vn IN (?) 
        AND (
          (n.nhso_adp_code IS NOT NULL AND n.nhso_adp_code != '')
          OR
          (sd.nhso_adp_code IS NOT NULL AND sd.nhso_adp_code != '')
        )
    `, [vns]);

    // 15. LVD (Leave Day)
    const lvd = await runQuery('LVD', `
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
    `, [vns]);

    // 16. DRU (Drugs)
    const dru = await runQuery('DRU', `
      SELECT 
        ? AS HCODE,
        o.hn AS HN,
        COALESCE(o.an, '') AS AN,
        o.main_dep AS CLINIC,
        COALESCE(pt.cid, '') AS PERSON_ID,
        DATE_FORMAT(o.vstdate, '%Y%m%d') AS DATE_SERV,
        o.icode AS DID,
        d.name AS DIDNAME,
        o.qty AS AMOUNT,
        o.unitprice AS DRUGPRIC,
        IFNULL(d.unitcost, 0) AS DRUGCOST,
        COALESCE(s.did, '') AS DIDSTD,
        d.units AS UNIT,
        '' AS UNIT_PACK,
        o.vn AS SEQ,
        '' AS DRUGTYPE,
        '' AS DRUGREMARK,
        '' AS PA_NO,
        '0.00' AS TOTCOPAY,
        '1' AS USE_STATUS,
        o.sum_price AS TOTAL
      FROM opitemrece o
      JOIN drugitems d ON o.icode = d.icode
      LEFT JOIN s_drugitems s ON o.icode = s.icode
      JOIN patient pt ON o.hn = pt.hn
      WHERE o.vn IN (?)
    `, [hcode, vns]);

    return {
      INS: ins as any[],
      PAT: pat as any[],
      OPD: opd as any[],
      ORF: orf as any[],
      ODX: odx as any[],
      OOP: oop as any[],
      IPD: ipd as any[],
      IRF: irf as any[],
      IDX: idx as any[],
      IOP: iop as any[],
      CHT: cht as any[],
      CHA: cha as any[],
      AER: aer as any[],
      ADP: adp as any[],
      LVD: lvd as any[],
      DRU: dru as any[]
    };
  } catch (error) {
    console.error('Error fetching export data:', error);
    return null;
  } finally {
    connection.release();
  }
};

export const getDiagsAndProcedures = async (vn: string) => {
  const connection = await getUTFConnection();
  try {
    const [diags] = await connection.query(`
      SELECT 
        d.icd10 as code,
        i.name as name,
        d.diagtype as type,
        'Diag' as category
      FROM ovstdiag d
      LEFT JOIN icd101 i ON d.icd10 = i.code
      WHERE d.vn = ?
      ORDER BY d.diagtype
    `, [vn]);

    const [procs] = await connection.query(`
      SELECT 
        o.icd9 as code,
        i.name as name,
        '' as type,
        'Procedure' as category
      FROM doctor_operation o
      LEFT JOIN icd9cm1 i ON o.icd9 = i.code
      WHERE o.vn = ?
      UNION ALL
      SELECT 
        eo.er_oper_code as code,
        e.name as name,
        '' as type,
        'Procedure' as category
      FROM er_regist_oper eo
      LEFT JOIN er_oper_code e ON eo.er_oper_code = e.er_oper_code
      WHERE eo.vn = ?
    `, [vn, vn]);

    return {
      diagnoses: Array.isArray(diags) ? diags : [],
      procedures: Array.isArray(procs) ? procs : []
    };
  } catch (error) {
    console.error('Error fetching diags and procs:', error);
    return { diagnoses: [], procedures: [] };
  } finally {
    connection.release();
  }
};

const attachSpecificFundStatusFields = async (connection: mysql.PoolConnection, rows: Record<string, unknown>[]) => {
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

  return rows.map((row) => {
    const vn = normalizeImportCellValue(row.vn);
    const statusInfo = statusMap.get(vn);
    const fdhClaim = fdhClaimMap.get(vn);
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
    };
  });
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
  connection: mysql.PoolConnection,
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
        const res = await fetch(trackUrl, {
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
        const apiRes = await fetch(trackUrl, {
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

export const getSpecificFundData = async (fundType: string, startDate: string, endDate: string) => {
  const connection = await getUTFConnection();
  try {
    if (fundType === 'palliative') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          GROUP_CONCAT(DISTINCT IF(dx.icd10='${businessRules.diagnosis_patterns.palliative[0]}', '${businessRules.diagnosis_patterns.palliative[0]}', NULL)) as z515_code,
          GROUP_CONCAT(DISTINCT IF(dx.icd10='${businessRules.diagnosis_patterns.palliative[1]}', '${businessRules.diagnosis_patterns.palliative[1]}', NULL)) as z718_code,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.palliative[0]}' LIMIT 1) as has_30001,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.palliative[1]}' LIMIT 1) as has_cons01,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.palliative[2]}' LIMIT 1) as has_eva001
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN ovstdiag dx ON o.vn = dx.vn AND dx.icd10 IN (${businessRules.diagnosis_patterns.palliative.map(c => `'${c}'`).join(',')})
        WHERE o.vstdate BETWEEN ? AND ?
          AND (dx.icd10 IN (${businessRules.diagnosis_patterns.palliative.map(c => `'${c}'`).join(',')}) OR EXISTS (SELECT 1 FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code IN (${businessRules.adp_codes.palliative.map(c => `'${c}'`).join(',')})))
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
    }

    if (fundType === 'drugp') {
      const [rows] = await connection.query(`
        SELECT 
          o.vn, o.hn, 
          DATE_FORMAT(o.vstdate, '%Y-%m-%d') as serviceDate,
          DATE_FORMAT(o.vsttime, '%H:%i:%s') as vsttime,
          pt.cid, CONCAT(COALESCE(pt.pname,''), COALESCE(pt.fname,''), ' ', COALESCE(pt.lname,'')) as patientName,
          ptt.name as pttypename, ptt.hipdata_code,
          (SELECT 'Y' FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND d.nhso_adp_code='${businessRules.adp_codes.drugp}' LIMIT 1) as has_drugp
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        WHERE o.vstdate BETWEEN ? AND ?
          AND EXISTS (SELECT 1 FROM opitemrece oo LEFT JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${businessRules.adp_codes.drugp}')
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
    }

    if (fundType === 'knee') {
      const kneeDxSql = `
        v.pdx LIKE 'M17%' OR v.dx0 LIKE 'M17%' OR v.dx1 LIKE 'M17%' OR v.dx2 LIKE 'M17%' OR v.dx3 LIKE 'M17%' OR v.dx4 LIKE 'M17%' OR v.dx5 LIKE 'M17%'
        OR v.pdx IN ('U57.53', 'U5753') OR v.dx0 IN ('U57.53', 'U5753') OR v.dx1 IN ('U57.53', 'U5753') OR v.dx2 IN ('U57.53', 'U5753') OR v.dx3 IN ('U57.53', 'U5753') OR v.dx4 IN ('U57.53', 'U5753') OR v.dx5 IN ('U57.53', 'U5753')
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
          'Y' as knee_age_eligible,
          'Y' as has_knee_diag,
          CONCAT_WS(', ',
            CASE WHEN v.pdx LIKE 'M17%' OR v.pdx IN ('U57.53', 'U5753') THEN v.pdx END,
            CASE WHEN v.dx0 LIKE 'M17%' OR v.dx0 IN ('U57.53', 'U5753') THEN v.dx0 END,
            CASE WHEN v.dx1 LIKE 'M17%' OR v.dx1 IN ('U57.53', 'U5753') THEN v.dx1 END,
            CASE WHEN v.dx2 LIKE 'M17%' OR v.dx2 IN ('U57.53', 'U5753') THEN v.dx2 END,
            CASE WHEN v.dx3 LIKE 'M17%' OR v.dx3 IN ('U57.53', 'U5753') THEN v.dx3 END,
            CASE WHEN v.dx4 LIKE 'M17%' OR v.dx4 IN ('U57.53', 'U5753') THEN v.dx4 END,
            CASE WHEN v.dx5 LIKE 'M17%' OR v.dx5 IN ('U57.53', 'U5753') THEN v.dx5 END
          ) as diag_code,
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
          AND v.age_y >= 40
          AND (${kneeDxSql})
        ORDER BY o.vstdate DESC, o.vn DESC
      `, [startDate, endDate]);
      const kneeRows = rows as Record<string, unknown>[];
      const kneeVns = Array.from(new Set(kneeRows.map((row) => normalizeImportCellValue(row.vn)).filter(Boolean)));
      if (kneeVns.length > 0) {
        const vnPlaceholders = kneeVns.map(() => '?').join(',');
        const [operationRows] = await connection.query(`
          SELECT
            s.vn,
            GROUP_CONCAT(DISTINCT i.icd10tm ORDER BY i.icd10tm SEPARATOR ', ') as oper_code,
            GROUP_CONCAT(DISTINCT i.health_med_operation_item_name ORDER BY i.icd10tm SEPARATOR ', ') as oper_names,
            CASE WHEN MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8727811' THEN 1 ELSE 0 END) = 1 THEN 'Y' ELSE 'N' END as has_knee_massage_thigh,
            CASE WHEN MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8737811' THEN 1 ELSE 0 END) = 1 THEN 'Y' ELSE 'N' END as has_knee_massage_knee,
            CASE WHEN MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8747811' THEN 1 ELSE 0 END) = 1 THEN 'Y' ELSE 'N' END as has_knee_massage_lower_leg,
            CASE WHEN MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8737835' THEN 1 ELSE 0 END) = 1 THEN 'Y' ELSE 'N' END as has_knee_poultice,
            CASE WHEN
              MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8727811' THEN 1 ELSE 0 END) = 1
              AND MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8737811' THEN 1 ELSE 0 END) = 1
              AND MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8747811' THEN 1 ELSE 0 END) = 1
              AND MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') = '8737835' THEN 1 ELSE 0 END) = 1
            THEN 'Y' ELSE 'N' END as has_knee_oper,
            COUNT(DISTINCT REPLACE(i.icd10tm, '-', '')) as knee_oper_count
          FROM health_med_service s
          JOIN health_med_service_operation op ON op.health_med_service_id = s.health_med_service_id
          JOIN health_med_operation_item i ON i.health_med_operation_item_id = op.health_med_operation_item_id
          WHERE s.vn IN (${vnPlaceholders})
            AND REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
          GROUP BY s.vn
        `, kneeVns);
        const operationMap = new Map<string, Record<string, unknown>>();
        if (Array.isArray(operationRows)) {
          for (const operationRow of operationRows as Record<string, unknown>[]) {
            const vn = normalizeImportCellValue(operationRow.vn);
            if (vn) operationMap.set(vn, operationRow);
          }
        }
        for (const row of kneeRows) {
          const vn = normalizeImportCellValue(row.vn);
          const operationRow = operationMap.get(vn);
          if (operationRow) Object.assign(row, operationRow);
          row.knee_poultice_14d_count = row.has_knee_poultice === 'Y' ? 1 : 0;
        }
      }
      return await attachSpecificFundStatusFields(connection, kneeRows);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
          ) as fp_adp_codes
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
          AND (
            pt.birthday < '1992-01-01'
            OR ${buildDiagnosisMatchSql('o', 'v', ['Z115'])}
            OR ${buildServiceOrLabNameExistsSql('o', labRegex)}
          )
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
          CASE WHEN v.age_y BETWEEN 45 AND 59 THEN 'Y' ELSE 'N' END as age_eligible,
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
              v.age_y BETWEEN 45 AND 59
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
          CASE WHEN ${buildServiceOrLabNameExistsSql('o', SYPHILIS_SCREENING_REGEX)} THEN 'Y' ELSE 'N' END as has_syphilis_lab,
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
              AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${SYPHILIS_SCREENING_REGEX}'
          ) as syphilis_service_names,
          (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
        FROM ovst o
        JOIN patient pt ON o.hn = pt.hn
        LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
        LEFT JOIN vn_stat v ON v.vn = o.vn
        WHERE o.vstdate BETWEEN ? AND ?
          AND COALESCE(v.sex, pt.sex) = '1'
          AND ${buildServiceOrLabNameExistsSql('o', SYPHILIS_SCREENING_REGEX)}
        GROUP BY o.vn
        ORDER BY o.vstdate DESC
      `, [startDate, endDate]);
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
      return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
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
              CASE WHEN ${buildServiceOrLabNameExistsSql('o', ANC_US_REGEX)} THEN 'Y' ELSE 'N' END as has_anc_us_proc,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '${adpCode}' LIMIT 1) THEN 'Y' ELSE 'N' END as has_specific_adp,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30012' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_lab1,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30013' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_lab2,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30008' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_dental_exam,
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND d.nhso_adp_code = '30009' LIMIT 1) THEN 'Y' ELSE 'N' END as has_anc_dental_clean,
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
        return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
    }

    // Other PP Funds Mapping
    const otherPPFunds: Record<string, string | string[]> = {
        'preg_test': '30014',
        'pregnancy_test': '30014',
        'postnatal_care': '30015',
        'postnatal_supplements': '30016',
        'fluoride': '15001',
        'contraceptive_pill': ['FP003_1', 'FP003_2'],
        'condom': 'FP003_4'
    };

    if (otherPPFunds[fundType]) {
        const adpParam = otherPPFunds[fundType];
        const adpCondition = Array.isArray(adpParam) 
            ? `d.nhso_adp_code IN (${adpParam.map(c => `'${c}'`).join(',')})`
            : `d.nhso_adp_code = '${adpParam}'`;

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
              CASE WHEN EXISTS (SELECT 1 FROM opitemrece oo JOIN s_drugitems d ON d.icode = oo.icode WHERE oo.vn = o.vn AND ${adpCondition} LIMIT 1) THEN 'Y' ELSE 'N' END as has_specific_adp,
              (SELECT GROUP_CONCAT(DISTINCT d.name SEPARATOR ', ') FROM opitemrece oo JOIN s_drugitems d ON d.icode=oo.icode WHERE oo.vn=o.vn AND ${adpCondition}) as adp_names,
              (SELECT claim_code FROM authenhos WHERE vn = o.vn LIMIT 1) as authencode
            FROM ovst o
            JOIN patient pt ON o.hn = pt.hn
            LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
            LEFT JOIN vn_stat v ON v.vn = o.vn
            WHERE o.vstdate BETWEEN ? AND ?
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
        return await attachSpecificFundStatusFields(connection, rows as Record<string, unknown>[]);
    }

    // สามารถเพิ่มเงื่อนไขกองทุนอื่นๆ ต่อไปได้ที่นี่
    return [];
  } catch (error) {
    console.error('Error fetching specific fund data:', error);
    return [];
  } finally {
    connection.release();
  }
};

export const getKidneyMonitorDetailed = async (startDate: string, endDate: string) => {
  try {
    const connection = await getUTFConnection();

    console.log(`🔍 getKidneyMonitorDetailed: startDate=${startDate}, endDate=${endDate}`);

    // Step 1: Get dialysis visits — ใช้ main_dep='060' (ห้องไตเทียม) เป็นเกณฑ์หลัก
    // ไม่มี LIMIT — ดึงข้อมูลทั้งหมดตามช่วงวันที่
    const patientQuery = `
      SELECT DISTINCT
        ovst.hn,
        ovst.vn,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patientName,
        COALESCE(pttype.hipdata_code, ovst.pttype, 'UNKNOWN') AS hipdata_code,
        COALESCE(pttype.name, CONCAT('Type:', COALESCE(ovst.pttype, 'NULL'))) AS pttypeName,
        ovst.pttype AS raw_pttype,
        DATE_FORMAT(ovst.vstdate, '%Y-%m-%d') AS serviceDate
      FROM ovst
      LEFT JOIN patient pt ON ovst.hn = pt.hn
      LEFT JOIN pttype ON ovst.pttype = pttype.pttype
      WHERE
        ovst.vstdate >= ? AND ovst.vstdate < DATE_ADD(?, INTERVAL 1 DAY)
        AND ovst.main_dep = '060'
      ORDER BY ovst.vstdate DESC
    `;    const [visits] = await connection.query(patientQuery, [startDate, endDate]);
    const totalCount = (visits as any[]).length;
    console.log(`🏥 Found ${totalCount} patient visits for kidney monitor (${startDate} to ${endDate})`);
    // Process visits sequentially (not all at once) to avoid connection pool exhaustion
    const detailedData: any[] = [];
    for (const row of (visits as any[])) {
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
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ค่าล้างไต%'
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ialysi%'
          AND COALESCE(ndi.name, sd.name, oe.icode) NOT LIKE '%ล้างไต%'
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
            WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%' OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ialysi%'
              THEN ${businessRules.costs.dialysis_fixed}  -- Fixed dialysis room cost
            ELSE COALESCE(oe.unitprice * oe.qty, 0) * ${businessRules.costs.fallback_margin}  -- Fallback margin for other services
          END as total_cost,
          CASE 
            WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%' OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ialysi%'
              THEN 0  -- Fixed cost, not estimated
            ELSE 1  -- Estimated using fallback margin
          END as cost_is_estimated,
          CASE 
            WHEN COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%' OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ialysi%'
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
            OR COALESCE(ndi.name, sd.name, oe.icode) LIKE '%ล้างไต%')
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
    const returned = detailedData.length;
    console.log(`✅ Processed ${returned} kidney monitor records - No truncation (all records shown)`);
    return { data: detailedData, totalCount, returned, truncated: false };
  } catch (error) {
    console.error('Error in getKidneyMonitorDetailed:', error);
    return { data: [], totalCount: 0, returned: 0, truncated: false };
  }
};

type FsProjectItem = {
  code: string;
  label: string;
  amount: number;
};

// FS monitor must use only ProjectCode/ADP items from the NHSO 16-file guide.
// Do not infer from broad item names, otherwise one matching visit can be over-counted.
const FS_PROJECT_ITEMS: FsProjectItem[] = [
  { code: '1B004N', label: 'Pap smear ผลปกติ', amount: 250 },
  { code: '1B004P', label: 'Pap smear ผลผิดปกติ', amount: 250 },
  { code: '1B004_0N', label: 'VIA ผลปกติ', amount: 250 },
  { code: '1B004_0P', label: 'VIA ผลผิดปกติ', amount: 250 },
  { code: '1B0046_01', label: 'HPV DNA type 16/18/Other', amount: 280 },
  { code: '1B0046_1', label: 'HPV DNA 14 type fully', amount: 370 },
  { code: '1B005', label: 'Colposcopy', amount: 900 },
  { code: '12001', label: 'คัดกรอง/ประเมินปัจจัยเสี่ยง อายุ 15-34 ปี', amount: 100 },
  { code: '12002', label: 'คัดกรอง/ประเมินปัจจัยเสี่ยง อายุ 35-59 ปี', amount: 150 },
  { code: '12003', label: 'คัดกรองเบาหวาน FPG อายุ 35-59 ปี', amount: 40 },
  { code: '12004', label: 'คัดกรองไขมัน Cholesterol/HDL อายุ 45-59 ปี', amount: 160 },
  { code: '13001', label: 'คัดกรองโลหิตจาง', amount: 65 },
  { code: '14001', label: 'เสริมธาตุเหล็ก Ferrofolic', amount: 80 },
  { code: '15001', label: 'ทาฟลูออไรด์', amount: 100 },
  { code: '30008', label: 'ANC ตรวจฟัน', amount: 0 },
  { code: '30009', label: 'ANC ขัดทำความสะอาดฟัน', amount: 500 },
  { code: '30010', label: 'ANC Ultrasound', amount: 400 },
  { code: '30011', label: 'ANC Visit', amount: 360 },
  { code: '30012', label: 'ANC Lab 1', amount: 600 },
  { code: '30013', label: 'ANC Lab 2 / ใกล้คลอด', amount: 190 },
  { code: '30014', label: 'ตรวจครรภ์ (UPT)', amount: 75 },
  { code: '30015', label: 'ดูแลหลังคลอด', amount: 150 },
  { code: '30016', label: 'เสริมธาตุเหล็กหลังคลอด', amount: 135 },
  { code: '37550', label: 'ตรวจยีน BRCA1/BRCA2', amount: 10000 },
  { code: '90001', label: 'ให้คำปรึกษา/เก็บตัวอย่าง BRCA', amount: 500 },
  { code: '90002', label: 'ตรวจ BRCA ญาติสายตรง', amount: 2500 },
  { code: '90004', label: 'ตัดชิ้นเนื้อช่องปากส่งพยาธิ', amount: 600 },
  { code: '90005', label: 'คัดกรองมะเร็งลำไส้ใหญ่และไส้ตรง', amount: 60 },
  { code: 'AB001', label: 'บริการยุติการตั้งครรภ์', amount: 3000 },
  { code: 'AB002', label: 'บริการยุติการตั้งครรภ์', amount: 3000 },
  { code: 'AB003', label: 'บริการยุติการตั้งครรภ์', amount: 3000 },
  { code: 'FP001', label: 'วางแผนครอบครัว ห่วงอนามัย', amount: 800 },
  { code: 'FP002', label: 'วางแผนครอบครัว ยาฝังคุมกำเนิด', amount: 2500 },
];

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

    const detailRows = [...detailMap.values()];

    const byHipdata = new Map<string, FsAggregate>();
    const byPatientPttype = new Map<string, FsAggregate>();
    const byVisitPttype = new Map<string, FsAggregate>();
    const topServices = new Map<string, FsAggregate>();
    const visits = new Set<string>();
    const patients = new Set<string>();
    let totalAmount = 0;

    detailRows.forEach((row) => {
      totalAmount += row.amount;
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
        w.name as ward,
        DATE_FORMAT(ipt.regdate, '%Y-%m-%d') as admDate,
        ipt.dchdate,
        CASE 
          WHEN ipt.dchdate IS NULL THEN DATEDIFF(CURDATE(), ipt.regdate)
          ELSE DATEDIFF(ipt.dchdate, ipt.regdate) 
        END as los,
        pttype.name as pttype,
        COALESCE(ipt.pttype, pttype.hipdata_code) as hipdata_code,
        
        -- DRG & RW
        (SELECT drg FROM an_stat WHERE an = ipt.an LIMIT 1) as drg,
        (SELECT rw FROM an_stat WHERE an = ipt.an LIMIT 1) as rw,
        
        -- Diagnosis and Procedures
        (SELECT icd10 FROM iptdiag WHERE an = ipt.an AND diagtype = '1' LIMIT 1) as pdx,
        (SELECT GROUP_CONCAT(icd9) FROM iptoprt WHERE an = ipt.an) as or_codes,
        
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
        COALESCE(fdh_detail.upload_uid, fdh.transaction_uid) as fdh_transaction_uid,
        COALESCE(
          fdh_detail.claim_status,
          fdh.fdh_reservation_status,
          fdh.fdh_claim_status_message,
          IF(fdh.transaction_uid IS NOT NULL, 'ส่ง FDH แล้ว', NULL)
        ) as fdh_status_label,
        fdh.fdh_reservation_status,
        COALESCE(fdh_detail.sent_at, fdh.fdh_reservation_datetime) as fdh_reservation_datetime,
        fdh.fdh_claim_status_message,
        fdh.error_code as fdh_error_code,
        fdh.fdh_stm_period,
        fdh.fdh_act_amt,
        fdh.fdh_settle_at,
        fdh.updated_at as fdh_updated_at,
        fdh_detail.claim_code as fdh_claim_code,
        fdh_detail.upload_uid as fdh_upload_uid,
        fdh_detail.claim_status as fdh_claim_detail_status,
        fdh_detail.sent_at as fdh_claim_detail_sent_at,
        CASE
          WHEN ipt.dchdate IS NULL THEN NULL
          WHEN COALESCE(fdh_detail.sent_at, fdh.fdh_reservation_datetime, fdh.updated_at) IS NOT NULL
            THEN DATEDIFF(DATE(COALESCE(fdh_detail.sent_at, fdh.fdh_reservation_datetime, fdh.updated_at)), DATE(ipt.dchdate))
          ELSE DATEDIFF(CURDATE(), DATE(ipt.dchdate))
        END as fdh_days_from_discharge,
        CASE
          WHEN ipt.dchdate IS NULL THEN 'ยังไม่จำหน่าย'
          WHEN COALESCE(fdh_detail.sent_at, fdh.fdh_reservation_datetime, fdh.updated_at) IS NOT NULL THEN 'ส่ง FDH แล้ว'
          ELSE 'ยังไม่ส่ง/ยังไม่พบวันส่ง FDH'
        END as fdh_days_note
        
      FROM ipt
      JOIN patient pt ON ipt.hn = pt.hn
      LEFT JOIN ward w ON ipt.ward = w.ward
      LEFT JOIN pttype ON ipt.pttype = pttype.pttype
      ${hasAuditTable ? 'LEFT JOIN z_fdh_audit_log za ON ipt.an = za.an' : ''}
      LEFT JOIN (
        SELECT d.*
        FROM repstminv.fdh_claim_detail_row d
        JOIN (
          SELECT an, MAX(id) AS max_id
          FROM repstminv.fdh_claim_detail_row
          WHERE IFNULL(an, '') <> ''
            AND UPPER(IFNULL(patient_type, '')) IN ('IP', 'IPD')
          GROUP BY an
        ) latest ON latest.max_id = d.id
      ) fdh_detail ON fdh_detail.an = ipt.an
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
    return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  } catch (error) {
    console.error('Error fetching IPD data:', error);
    return [];
  } finally {
    connection.release();
  }
};

// API สำหรับดึงข้อมูลสรุปชาร์ตผู้ป่วยในแบบละเอียด (IPD Chart Review)
export const getIPDChartDetails = async (an: string) => {
  const t0 = Date.now();
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
      console.error(`IPD chart section failed (${section}) for AN=${an}:`, error);
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
      runSectionQuery('drug', c6, `
        SELECT d.name, SUM(o.qty) as total_qty, SUM(o.sum_price) as total_price
        FROM opitemrece o
        JOIN s_drugitems d ON o.icode = d.icode
        WHERE o.an = ? AND o.sum_price > 0
        GROUP BY o.icode, d.name
        ORDER BY total_price DESC
        LIMIT ${businessRules.query_limits.drug_limit}
      `, [an]),
    ]);

    console.log(`📋 getIPDChartDetails AN=${an} done in ${Date.now() - t0}ms`);

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
