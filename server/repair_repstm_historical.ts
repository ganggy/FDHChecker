import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const repairRepTable = async (conn: mysql.Connection, tableName: 'rep_data' | 'rep_data_verify') => {
  const [rows] = await conn.query(
    `SELECT id
     FROM ${tableName}
     WHERE NULLIF(TRIM(COALESCE(seq_no, '')), '') IS NOT NULL
     ORDER BY id`
  );
  const ids = (Array.isArray(rows) ? rows : [])
    .map((r) => Number((r as Record<string, unknown>).id || 0))
    .filter((id) => Number.isFinite(id) && id > 0);

  let updated = 0;
  let skippedLocks = 0;

  for (const id of ids) {
    try {
      const [result] = await conn.query(
        `UPDATE ${tableName}
         SET
           seq_no = NULLIF(TRIM(COALESCE(seq_no, '')), ''),
           department = CASE
             WHEN UPPER(COALESCE(department, '')) IN ('OP', 'IP') THEN UPPER(COALESCE(department, ''))
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
             WHEN UPPER(COALESCE(department, '')) = 'OP'
               THEN NULL
             ELSE NULLIF(TRIM(COALESCE(an, '')), '')
           END
         WHERE id = ?`,
        [id]
      );
      updated += Number((result as mysql.ResultSetHeader).affectedRows || 0);
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'ER_LOCK_WAIT_TIMEOUT') {
        skippedLocks += 1;
        continue;
      }
      throw error;
    }
  }

  console.log(`${tableName}: updated=${updated}, skipped_lock=${skippedLocks}, total_target=${ids.length}`);
};

const repairStmTable = async (conn: mysql.Connection) => {
  const [rows] = await conn.query(
    `SELECT id
     FROM repstm_statement_data
     WHERE data_type IN ('STM', 'INV')
     ORDER BY id`
  );
  const ids = (Array.isArray(rows) ? rows : [])
    .map((r) => Number((r as Record<string, unknown>).id || 0))
    .filter((id) => Number.isFinite(id) && id > 0);

  let updated = 0;
  let skippedLocks = 0;

  for (const id of ids) {
    try {
      const [result] = await conn.query(
        `UPDATE repstm_statement_data s
         LEFT JOIN rep_data r
           ON NULLIF(TRIM(COALESCE(r.tran_id, '')), '') = NULLIF(TRIM(COALESCE(s.tran_id, '')), '')
         SET
           s.pid = NULLIF(TRIM(COALESCE(s.pid, '')), ''),
           s.hn = COALESCE(NULLIF(TRIM(COALESCE(s.hn, '')), ''), NULLIF(TRIM(COALESCE(r.hn, '')), '')),
           s.department = CASE
             WHEN UPPER(COALESCE(s.department, '')) IN ('OP', 'IP') THEN UPPER(COALESCE(s.department, ''))
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
             )
               THEN COALESCE(
                 NULLIF(TRIM(COALESCE(s.vn, '')), ''),
                 CASE WHEN UPPER(COALESCE(s.department, '')) = 'OP' THEN NULLIF(TRIM(COALESCE(s.matched_visit_code, '')), '') ELSE NULL END,
                 NULLIF(TRIM(COALESCE(r.vn, '')), '')
               )
             ELSE NULLIF(TRIM(COALESCE(s.vn, '')), '')
           END,
           s.an = CASE
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
         WHERE s.id = ?`,
        [id]
      );
      updated += Number((result as mysql.ResultSetHeader).affectedRows || 0);
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'ER_LOCK_WAIT_TIMEOUT') {
        skippedLocks += 1;
        continue;
      }
      throw error;
    }
  }

  console.log(`repstm_statement_data: updated=${updated}, skipped_lock=${skippedLocks}, total_target=${ids.length}`);
};

const main = async () => {
  const connection = await mysql.createConnection({
    host: process.env.REPSTM_HOST || process.env.HOSXP_HOST,
    user: process.env.REPSTM_USER || process.env.HOSXP_USER,
    password: process.env.REPSTM_PASSWORD || process.env.HOSXP_PASSWORD,
    database: process.env.REPSTM_DB || 'repstminv',
    charset: 'utf8mb4',
  });

  try {
    await connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
    await connection.query('SET SESSION innodb_lock_wait_timeout = 3');

    await repairRepTable(connection, 'rep_data');
    await repairRepTable(connection, 'rep_data_verify');
    await repairStmTable(connection);

    console.log('Historical repair completed');
  } finally {
    await connection.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
