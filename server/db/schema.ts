import { getUTFConnection, getRepstmConnection } from './connection.js';
import { activeHospitalDatabaseConfig } from '../hospitalDatabase.js';

export const FDH_STATUS_IMPORT_LOG_TABLE_SQL = `
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

export const FDH_SUBMISSION_LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS fdh_submission_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_uid VARCHAR(64) NOT NULL,
    profile VARCHAR(32) NOT NULL,
    hcode VARCHAR(32) NOT NULL,
    environment VARCHAR(16) NOT NULL,
    request_count INT NOT NULL DEFAULT 0,
    record_count INT NOT NULL DEFAULT 0,
    request_digest CHAR(64) NOT NULL,
    response_status INT NULL,
    success TINYINT(1) NOT NULL DEFAULT 0,
    response_payload JSON NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_batch_uid (batch_uid),
    INDEX idx_submitted_at (submitted_at),
    INDEX idx_success (success)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const FDH_CLAIM_STATUS_TABLE_SQL = `
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

export const AUTHEN_SYNC_LOG_TABLE_SQL = `
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

export const AUTHEN_SYNC_CANCEL_TABLE_SQL = `
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

export const NHSO_CONFIRM_PRIVILEGE_TABLE_SQL = `
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

export const REPSTM_IMPORT_BATCH_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS repstm_import_batch (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data_type VARCHAR(16) NOT NULL,
    source_filename VARCHAR(255) NOT NULL,
    file_size BIGINT NULL,
    file_hash VARCHAR(64) NULL,
    batch_hash VARCHAR(64) NULL,
    logical_hash VARCHAR(64) NULL,
    completeness_score BIGINT NOT NULL DEFAULT 0,
    distinct_record_count INT NOT NULL DEFAULT 0,
    column_count INT NOT NULL DEFAULT 0,
    non_empty_cell_count INT NOT NULL DEFAULT 0,
    replaces_batch_id BIGINT NULL,
    sheet_name VARCHAR(255) NULL,
    is_subfile TINYINT(1) NOT NULL DEFAULT 0,
    imported_by VARCHAR(128) NULL,
    row_count INT NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_data_type_batch_hash (data_type, batch_hash),
    INDEX idx_data_type_logical_hash (data_type, logical_hash),
    INDEX idx_file_hash (file_hash),
    INDEX idx_source_filename (source_filename),
    INDEX idx_replaces_batch_id (replaces_batch_id),
    INDEX idx_data_type_created_at (data_type, created_at),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const REPSTM_IMPORT_ROW_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS repstm_import_row (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    data_type VARCHAR(16) NOT NULL,
    row_no INT NOT NULL,
    ref_key VARCHAR(191) NULL,
    row_identity VARCHAR(191) NULL,
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
    INDEX idx_data_type_id (data_type, id),
    INDEX idx_ref_key (ref_key),
    INDEX idx_data_type_row_identity (data_type, row_identity),
    INDEX idx_batch_row_identity (batch_id, row_identity),
    CONSTRAINT fk_repstm_import_row_batch
      FOREIGN KEY (batch_id) REFERENCES repstm_import_batch(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const FDH_CLAIM_DETAIL_BATCH_TABLE_SQL = `
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

export const FDH_CLAIM_DETAIL_ROW_TABLE_SQL = `
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

export const REP_DATA_TABLE_SQL = `
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

export const REP_DATA_VERIFY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS rep_data_verify LIKE rep_data
`;

export const REPSTM_STATEMENT_DATA_TABLE_SQL = `
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

export const REPSTM_DELETE_AUDIT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS repstm_delete_audit (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    delete_scope VARCHAR(16) NOT NULL,
    data_type VARCHAR(16) NULL,
    batch_id BIGINT NULL,
    source_filename VARCHAR(255) NULL,
    deleted_row_count INT NOT NULL DEFAULT 0,
    deleted_row_ids JSON NULL,
    deleted_by VARCHAR(128) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_delete_audit_batch (batch_id),
    INDEX idx_delete_audit_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const RECEIVABLE_BATCH_TABLE_SQL = `
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
    opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
    collected_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_batch_no (batch_no),
    INDEX idx_created_at (created_at),
    INDEX idx_period (start_date, end_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const CLAIM_WORK_QUEUE_TABLE_SQL = `
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

export const CLAIM_REJECT_NOTE_TABLE_SQL = `
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

export const RECEIVABLE_ITEM_TABLE_SQL = `
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

export const RECEIVABLE_SETTLEMENT_BATCH_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_settlement_batch (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    settlement_no VARCHAR(64) NOT NULL,
    payer_type VARCHAR(32) NOT NULL DEFAULT 'NHSO',
    statement_no VARCHAR(128) NULL,
    transfer_date DATE NOT NULL,
    bank_account VARCHAR(128) NULL,
    total_claimable DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_received DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_diff DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_disallowance DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_overpay DECIMAL(15,2) NOT NULL DEFAULT 0,
    item_count INT NOT NULL DEFAULT 0,
    created_by VARCHAR(128) NULL,
    notes TEXT NULL,
    journal_payload JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_settlement_no (settlement_no),
    INDEX idx_statement_no (statement_no),
    INDEX idx_transfer_date (transfer_date),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const RECEIVABLE_SETTLEMENT_ITEM_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_settlement_item (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    settlement_batch_id BIGINT NOT NULL,
    patient_type VARCHAR(8) NOT NULL DEFAULT 'OPD',
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    hn VARCHAR(32) NULL,
    cid VARCHAR(32) NULL,
    patient_name VARCHAR(255) NULL,
    service_date DATE NULL,
    pttype VARCHAR(16) NULL,
    pttype_name VARCHAR(255) NULL,
    hipdata_code VARCHAR(32) NULL,
    debtor_code VARCHAR(32) NULL,
    revenue_code VARCHAR(32) NULL,
    claimable_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    diff_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    settle_action VARCHAR(32) NOT NULL DEFAULT 'full',
    error_code VARCHAR(128) NULL,
    statement_record_id BIGINT NULL,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_settlement_batch_id (settlement_batch_id),
    INDEX idx_vn (vn),
    INDEX idx_an (an),
    INDEX idx_hn (hn),
    CONSTRAINT fk_settlement_item_batch
      FOREIGN KEY (settlement_batch_id) REFERENCES receivable_settlement_batch(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const MOPHCLAIM_SEND_TABLE_SQL = `
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


export const ensureFdhClaimStatusSchema = async (connection: any): Promise<void> => {
  if (activeHospitalDatabaseConfig.type === 'postgresql') {
    await connection.query('SELECT vn, transaction_uid FROM fdh_claim_status LIMIT 0');
    return;
  }
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
    await connection.query(activeHospitalDatabaseConfig.type === 'postgresql'
      ? 'SELECT vn FROM nhso_confirm_privilege LIMIT 0'
      : NHSO_CONFIRM_PRIVILEGE_TABLE_SQL);
  } finally {
    connection.release();
  }
};

let repstmTablesEnsured = false;
let repstmTablesEnsurePromise: Promise<void> | null = null;

const ensureRepstmTablesUncached = async () => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(REPSTM_IMPORT_BATCH_TABLE_SQL);
    await connection.query(REPSTM_IMPORT_ROW_TABLE_SQL);
    await connection.query(FDH_CLAIM_DETAIL_BATCH_TABLE_SQL);
    await connection.query(FDH_CLAIM_DETAIL_ROW_TABLE_SQL);
    await connection.query(REP_DATA_TABLE_SQL);
    await connection.query(REP_DATA_VERIFY_TABLE_SQL);
    await connection.query(REPSTM_STATEMENT_DATA_TABLE_SQL);
    await connection.query(REPSTM_DELETE_AUDIT_TABLE_SQL);
    await connection.query(RECEIVABLE_BATCH_TABLE_SQL);
    await connection.query(RECEIVABLE_ITEM_TABLE_SQL);
    await connection.query(RECEIVABLE_SETTLEMENT_BATCH_TABLE_SQL);
    await connection.query(RECEIVABLE_SETTLEMENT_ITEM_TABLE_SQL);
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

    const repstmBatchColumns: Array<[string, string]> = [
      ['file_size', 'ADD COLUMN file_size BIGINT NULL AFTER source_filename'],
      ['file_hash', 'ADD COLUMN file_hash VARCHAR(64) NULL AFTER file_size'],
      ['logical_hash', 'ADD COLUMN logical_hash VARCHAR(64) NULL AFTER batch_hash'],
      ['completeness_score', 'ADD COLUMN completeness_score BIGINT NOT NULL DEFAULT 0 AFTER logical_hash'],
      ['distinct_record_count', 'ADD COLUMN distinct_record_count INT NOT NULL DEFAULT 0 AFTER completeness_score'],
      ['column_count', 'ADD COLUMN column_count INT NOT NULL DEFAULT 0 AFTER distinct_record_count'],
      ['non_empty_cell_count', 'ADD COLUMN non_empty_cell_count INT NOT NULL DEFAULT 0 AFTER column_count'],
      ['replaces_batch_id', 'ADD COLUMN replaces_batch_id BIGINT NULL AFTER non_empty_cell_count'],
      ['is_subfile', 'ADD COLUMN is_subfile TINYINT(1) NOT NULL DEFAULT 0 AFTER sheet_name'],
    ];
    for (const [columnName, alterSql] of repstmBatchColumns) {
      const [columnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'repstm_import_batch'
           AND COLUMN_NAME = ?`,
        [columnName]
      );
      const exists = Array.isArray(columnRows)
        && Number((columnRows[0] as Record<string, unknown>).count || 0) > 0;
      if (!exists) {
        await connection.query(`ALTER TABLE repstm_import_batch ${alterSql}`);
      }
    }

    const receivableBatchColumns: Array<[string, string]> = [
      ['opening_balance', 'ADD COLUMN opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER total_receivable'],
      ['collected_amount', 'ADD COLUMN collected_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER opening_balance'],
      ['closing_balance', 'ADD COLUMN closing_balance DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER collected_amount'],
    ];
    for (const [columnName, alterSql] of receivableBatchColumns) {
      const [columnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'receivable_batch'
           AND COLUMN_NAME = ?`,
        [columnName]
      );
      const exists = Array.isArray(columnRows)
        && Number((columnRows[0] as Record<string, unknown>).count || 0) > 0;
      if (!exists) {
        await connection.query(`ALTER TABLE receivable_batch ${alterSql}`);
      }
    }

    const [rowIdentityColumns] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'repstm_import_row'
         AND COLUMN_NAME = 'row_identity'`
    );
    const hasRowIdentityColumn = Array.isArray(rowIdentityColumns)
      && Number((rowIdentityColumns[0] as Record<string, unknown>).count || 0) > 0;
    if (!hasRowIdentityColumn) {
      await connection.query(`
        ALTER TABLE repstm_import_row
        ADD COLUMN row_identity VARCHAR(191) NULL AFTER ref_key
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

    const repstmBatchIndexes: Array<[string, string]> = [
      ['idx_file_hash', 'ADD INDEX idx_file_hash (file_hash)'],
      ['idx_source_filename', 'ADD INDEX idx_source_filename (source_filename)'],
      ['idx_data_type_logical_hash', 'ADD INDEX idx_data_type_logical_hash (data_type, logical_hash)'],
      ['idx_replaces_batch_id', 'ADD INDEX idx_replaces_batch_id (replaces_batch_id)'],
    ];
    for (const [indexName, alterSql] of repstmBatchIndexes) {
      const [indexRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'repstm_import_batch'
           AND INDEX_NAME = ?`,
        [indexName]
      );
      const exists = Array.isArray(indexRows)
        && Number((indexRows[0] as Record<string, unknown>).count || 0) > 0;
      if (!exists) {
        await connection.query(`ALTER TABLE repstm_import_batch ${alterSql}`);
      }
    }

    const repstmRowIndexes: Array<[string, string]> = [
      ['idx_data_type_row_identity', 'ADD INDEX idx_data_type_row_identity (data_type, row_identity)'],
      ['idx_batch_row_identity', 'ADD INDEX idx_batch_row_identity (batch_id, row_identity)'],
      ['idx_data_type_id', 'ADD INDEX idx_data_type_id (data_type, id)'],
    ];
    for (const [indexName, alterSql] of repstmRowIndexes) {
      const [indexRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'repstm_import_row'
           AND INDEX_NAME = ?`,
        [indexName]
      );
      const exists = Array.isArray(indexRows)
        && Number((indexRows[0] as Record<string, unknown>).count || 0) > 0;
      if (!exists) {
        await connection.query(`ALTER TABLE repstm_import_row ${alterSql}`);
      }
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

export const ensureRepstmTables = async () => {
  if (repstmTablesEnsured) return;
  if (!repstmTablesEnsurePromise) {
    repstmTablesEnsurePromise = ensureRepstmTablesUncached()
      .then(() => {
        repstmTablesEnsured = true;
      })
      .finally(() => {
        repstmTablesEnsurePromise = null;
      });
  }
  await repstmTablesEnsurePromise;
};
