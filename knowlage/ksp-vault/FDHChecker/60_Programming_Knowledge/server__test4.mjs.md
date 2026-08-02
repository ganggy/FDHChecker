---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/test4.mjs"
source_hash: "9bef6ddc92277e399dc89ca0d64aa05d9d7a63de9e15967bd2270fd2e4119197"
managed_by: "sync-ksp-vault"
---
# test4.mjs

> Source: `server/test4.mjs`
> SHA-256: `9bef6ddc92277e399dc89ca0d64aa05d9d7a63de9e15967bd2270fd2e4119197`

````javascript
import mysql from 'mysql2/promise';
import 'dotenv/config';

async function test() {
    const conn = await mysql.createConnection({ host: process.env.HOSXP_HOST, user: process.env.HOSXP_USER, password: process.env.HOSXP_PASSWORD, database: process.env.HOSXP_DB });
    try {
        const [cols] = await conn.query('SHOW COLUMNS FROM an_stat');
        console.log('an_stat columns:', cols.filter(c => c.Field.includes('drg') || c.Field.includes('rw') || c.Field.includes('adjrw')));
    } catch (e) { console.error(e.message); }
    conn.end();
}
test();

````
