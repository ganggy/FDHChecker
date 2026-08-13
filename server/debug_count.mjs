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
