---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/debug_count.mjs"
source_hash: "4038e34202660ef37ceebabe10447b5049000c6184f12af27456cd35dc194b1a"
managed_by: "sync-ksp-vault"
---
# debug_count.mjs

> Source: `server/debug_count.mjs`
> SHA-256: `4038e34202660ef37ceebabe10447b5049000c6184f12af27456cd35dc194b1a`

````javascript
import mysql from 'mysql2/promise';
import 'dotenv/config';

const conn = await mysql.createConnection({
  host: process.env.HOSXP_HOST,
  user: process.env.HOSXP_USER,
  password: process.env.HOSXP_PASSWORD,
  database: process.env.HOSXP_DB,
  charset: 'utf8mb4'
});

const [r] = await conn.execute(
  `SELECT COUNT(*) AS cnt
   FROM ovst o
   LEFT JOIN patient pt ON pt.hn = o.hn
   LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
   LEFT JOIN vn_stat v ON v.vn = o.vn
   WHERE o.vstdate BETWEEN ? AND ?
     AND COALESCE(v.income, 0) > 0`,
  ['2025-01-01', '2025-01-31']
);
console.log('OPD count:', JSON.stringify(r));

await conn.end();

````
