import mysql from 'mysql2/promise';
import 'dotenv/config';

async function test() {
    const conn = await mysql.createConnection({ host: process.env.HOSXP_HOST, user: process.env.HOSXP_USER, password: process.env.HOSXP_PASSWORD, database: process.env.HOSXP_DB });
    try {
        const [rows] = await conn.query('SELECT SUM(sum_price) FROM opitemrece WHERE an = "690000709"');
        console.log('Opitemrece by AN:', rows);
    } catch (e) { console.error('Error in opitemrece AN query:', e.message); }

    try {
        const query = `
      SELECT 
        ipt.an,
        ipt.hn,
        ipt.vn,
        w.name as ward,
        COALESCE((SELECT SUM(sum_price) FROM opitemrece WHERE an = ipt.an), 0) as totalPrice
      FROM ipt
      LEFT JOIN ward w ON ipt.ward = w.ward
      WHERE DATE(ipt.regdate) >= '2026-03-01'
      ORDER BY ipt.regdate DESC LIMIT 5
      `;
        const [rows2] = await conn.query(query);
        console.log('Main query:', rows2.length);
    } catch (e) { console.error('Error in main query:', e.message); }
    conn.end();
}
test();
