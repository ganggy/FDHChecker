---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/debug_count.mjs"
source_hash: "8e34b7b78a4d56f5995b2b0ca361b941b1db1c1d9c2f99c187899e5587b30b46"
managed_by: "sync-ksp-vault"
---
# debug_count.mjs

> Source: `server/debug_count.mjs`
> SHA-256: `8e34b7b78a4d56f5995b2b0ca361b941b1db1c1d9c2f99c187899e5587b30b46`

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
