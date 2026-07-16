import mysql from 'mysql2/promise';
import 'dotenv/config';

async function test() {
    const conn = await mysql.createConnection({ host: process.env.HOSXP_HOST, user: process.env.HOSXP_USER, password: process.env.HOSXP_PASSWORD, database: process.env.HOSXP_DB });
    try {
        const an = '690000709';

        const [diags] = await conn.query(`
        SELECT i.diagtype, i.icd10, d.name as codeName
        FROM iptdiag i
        LEFT JOIN icd101 d ON i.icd10 = d.code
        WHERE i.an = ?
        LIMIT 2
      `, [an]);
        console.log('Diags:', diags);

        const [opers] = await conn.query(`
        SELECT i.icd9, d.name as opName
        FROM iptoprt i
        LEFT JOIN icd9cm1 d ON i.icd9 = d.code
        WHERE i.an = ?
        LIMIT 2
      `, [an]);
        console.log('Opers:', opers);

        const [costs] = await conn.query(`
        SELECT inc.name as incomeGroup, SUM(o.sum_price) as sumPrice
        FROM opitemrece o
        LEFT JOIN income inc ON o.income = inc.income
        WHERE o.an = ?
        GROUP BY inc.name
      `, [an]);
        console.log('Costs:', costs);

    } catch (e) { console.error('Error:', e.message); }
    conn.end();
}
test();
