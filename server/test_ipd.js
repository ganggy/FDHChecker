import mysql from 'mysql2/promise';
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
        console.log("Joined Rows:", rows);

        const [raw_ipt] = await conn.query("SELECT an, hn, regdate, pttype, ward FROM ipt WHERE regdate >= '2026-03-01' LIMIT 5");
        console.log("Raw IPT Rows:", raw_ipt);
    } catch (err) {
        console.error(err);
    }

    conn.end();
}
test();
