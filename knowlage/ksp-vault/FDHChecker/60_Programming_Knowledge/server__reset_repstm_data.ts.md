---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/reset_repstm_data.ts"
source_hash: "a4422c33a3a6f59fdd1ddab4d0609ba4f751fbb56d5137a2bce16cdd065aa24d"
managed_by: "sync-ksp-vault"
---
# reset_repstm_data.ts

> Source: `server/reset_repstm_data.ts`
> SHA-256: `a4422c33a3a6f59fdd1ddab4d0609ba4f751fbb56d5137a2bce16cdd065aa24d`

````typescript
import { getRepstmConnection } from './db.js';

const tables = [
  'claim_reject_note',
  'repstm_statement_data',
  'rep_data_verify',
  'rep_data',
  'repstm_import_row',
  'repstm_import_batch',
] as const;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const connection = await getRepstmConnection();
  try {
    await connection.query('SET SESSION innodb_lock_wait_timeout = 5');

    for (const table of tables) {
      let done = false;
      let attempt = 0;
      while (!done && attempt < 12) {
        attempt += 1;
        try {
          await connection.query(`DELETE FROM ${table}`);
          done = true;
        } catch (error) {
          const message = String((error as { message?: string })?.message || error);
          const isLockTimeout = message.includes('Lock wait timeout exceeded');
          if (!isLockTimeout) throw error;
          console.log(`[retry] ${table} attempt ${attempt} locked, retrying...`);
          await delay(1000);
        }
      }
      if (!done) {
        throw new Error(`Cannot clear table ${table} after retries (still locked)`);
      }
    }

    const result: Record<string, number> = {};
    for (const table of tables) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`);
      const n = Array.isArray(rows) ? Number((rows[0] as { n?: number }).n || 0) : 0;
      result[table] = n;
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    connection.release();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

````
