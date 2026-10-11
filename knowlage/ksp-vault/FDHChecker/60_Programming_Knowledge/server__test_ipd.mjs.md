---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/test_ipd.mjs"
source_hash: "37be8357af9a6b12c24cc9c794c06ccd1f1d492c44bc7b8f01079374d6fe9ce2"
managed_by: "sync-ksp-vault"
---
# test_ipd.mjs

> Source: `server/test_ipd.mjs`
> SHA-256: `37be8357af9a6b12c24cc9c794c06ccd1f1d492c44bc7b8f01079374d6fe9ce2`

````javascript
import mysql from 'mysql2/promise';
import fs from 'fs';
import 'dotenv/config';

async function test() {
    const conn = await mysql.createConnection({
        host: process.env.HOSXP_HOST,
        user: process.env.HOSXP_USER,
        password: process.env.HOSXP_PASSWORD,
        database: process.env.HOSXP_DB,
    });

    const query = `
    SELECT ipt.an, ipt.hn, pt.fname, w.name as ward, ipt.regdate, ipt.dchdate, pttype.name as pttype
    FROM ipt
    JOIN patient pt ON ipt.hn = pt.hn
    LEFT JOIN ward w ON ipt.ward = w.ward
    LEFT JOIN pttype ON ipt.pttype = pttype.pttype
    WHERE DATE(ipt.regdate) >= '2026-03-01'
    ORDER BY ipt.regdate DESC
    LIMIT 5
  `;

    try {
        const [rows] = await conn.query(query);
        const [raw_ipt] = await conn.query("SELECT an, hn, regdate, pttype, ward FROM ipt WHERE regdate >= '2026-03-01' LIMIT 5");

        fs.writeFileSync('test_out.json', JSON.stringify({ joined: rows, raw: raw_ipt }, null, 2));
    } catch (err) {
        console.error(err);
    }

    conn.end();
}
test();

````
