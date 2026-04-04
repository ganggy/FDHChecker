import mysql from 'mysql2/promise';
import fs from 'fs';

async function test() {
    const conn = await mysql.createConnection({
        host: '192.168.2.254',
        user: 'opd',
        password: 'opd',
        database: 'hos'
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
