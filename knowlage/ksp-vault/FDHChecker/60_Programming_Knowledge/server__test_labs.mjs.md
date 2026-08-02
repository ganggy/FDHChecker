---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/test_labs.mjs"
source_hash: "a264a88a0f2f5210ca43f09b169a9d777c089a65b0a17af655b3a46aba81d84b"
managed_by: "sync-ksp-vault"
---
# test_labs.mjs

> Source: `server/test_labs.mjs`
> SHA-256: `a264a88a0f2f5210ca43f09b169a9d777c089a65b0a17af655b3a46aba81d84b`

````javascript
import mysql from 'mysql2/promise';
import 'dotenv/config';

async function test() {
    const conn = await mysql.createConnection({ host: process.env.HOSXP_HOST, user: process.env.HOSXP_USER, password: process.env.HOSXP_PASSWORD, database: process.env.HOSXP_DB });
    try {
        const an = '690000709';

        // 1. Test getting VN
        const [ipt] = await conn.query('SELECT vn FROM ipt WHERE an = ?', [an]);
        const vn = ipt[0]?.vn;
        console.log('VN for AN', an, 'is:', vn);

        // 2. Test Labs using VN
        if (vn) {
            const [labs] = await conn.query(`
          SELECT h.order_date, i.lab_items_name, o.lab_order_result, i.lab_items_normal_value
          FROM lab_head h
          JOIN lab_order o ON h.lab_order_number = o.lab_order_number
          JOIN lab_items i ON o.lab_items_code = i.lab_items_code
          WHERE h.vn = ?
          LIMIT 5
        `, [vn]);
            console.log('Labs using VN:');
            console.dir(labs, { depth: null });
        }

        // 3. Test High-cost drugs/items
        const [drugs] = await conn.query(`
        SELECT d.name, SUM(o.qty) as total_qty, SUM(o.sum_price) as total_price
        FROM opitemrece o
        JOIN s_drugitems d ON o.icode = d.icode
        WHERE o.an = ? AND o.sum_price > 0
        GROUP BY o.icode, d.name
        ORDER BY total_price DESC
        LIMIT 5
      `, [an]);
        console.log('Top Drugs:');
        console.dir(drugs, { depth: null });

    } catch (e) { console.error('Error:', e.message); }
    conn.end();
}
test();

````
