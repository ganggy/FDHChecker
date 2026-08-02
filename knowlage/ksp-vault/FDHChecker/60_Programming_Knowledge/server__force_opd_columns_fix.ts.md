---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/force_opd_columns_fix.ts"
source_hash: "8cc865ece9d1591cda3d23b7e1d32bcc7ec4b4a3ccf872dfa8a1a3d2bbb5778e"
managed_by: "sync-ksp-vault"
---
# force_opd_columns_fix.ts

> Source: `server/force_opd_columns_fix.ts`
> SHA-256: `8cc865ece9d1591cda3d23b7e1d32bcc7ec4b4a3ccf872dfa8a1a3d2bbb5778e`

````typescript
import { getRepstmConnection } from './db.js';

const run = async () => {
  const c = await getRepstmConnection();
  try {
    await c.query('SET SESSION innodb_lock_wait_timeout = 5');

    await c.query(
      `UPDATE rep_data
       SET
         department = 'OP',
         vn = COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), NULLIF(TRIM(COALESCE(seq_no, '')), '')),
         seq_no = COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), NULLIF(TRIM(COALESCE(seq_no, '')), '')),
         an = NULL
       WHERE UPPER(COALESCE(patient_type, '')) IN ('OP', 'OPD')`
    );

    await c.query(
      `UPDATE rep_data_verify
       SET
         department = 'OP',
         vn = COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), NULLIF(TRIM(COALESCE(seq_no, '')), '')),
         seq_no = COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), NULLIF(TRIM(COALESCE(seq_no, '')), '')),
         an = NULL
       WHERE UPPER(COALESCE(patient_type, '')) IN ('OP', 'OPD')`
    );

    const [[r1]] = await c.query(
      `SELECT COUNT(*) AS n
       FROM rep_data
       WHERE UPPER(COALESCE(patient_type, '')) IN ('OP', 'OPD')
         AND NULLIF(TRIM(COALESCE(an, '')), '') IS NOT NULL`
    );
    const [[r2]] = await c.query(
      `SELECT COUNT(*) AS n
       FROM rep_data
       WHERE UPPER(COALESCE(patient_type, '')) IN ('OP', 'OPD')
         AND COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), '') <> COALESCE(NULLIF(TRIM(COALESCE(seq_no, '')), ''), '')`
    );
    const [[r3]] = await c.query(
      `SELECT COUNT(*) AS n
       FROM rep_data_verify
       WHERE UPPER(COALESCE(patient_type, '')) IN ('OP', 'OPD')
         AND NULLIF(TRIM(COALESCE(an, '')), '') IS NOT NULL`
    );
    const [[r4]] = await c.query(
      `SELECT COUNT(*) AS n
       FROM rep_data_verify
       WHERE UPPER(COALESCE(patient_type, '')) IN ('OP', 'OPD')
         AND COALESCE(NULLIF(TRIM(COALESCE(vn, '')), ''), '') <> COALESCE(NULLIF(TRIM(COALESCE(seq_no, '')), ''), '')`
    );

    console.log(
      JSON.stringify(
        {
          rep_data_opd_an_not_empty: Number((r1 as { n?: number }).n || 0),
          rep_data_opd_vn_seq_mismatch: Number((r2 as { n?: number }).n || 0),
          rep_data_verify_opd_an_not_empty: Number((r3 as { n?: number }).n || 0),
          rep_data_verify_opd_vn_seq_mismatch: Number((r4 as { n?: number }).n || 0),
        },
        null,
        2
      )
    );
  } finally {
    c.release();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

````
