import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: '192.168.2.254',
  user: 'opd',
  password: 'opd',
  database: 'hos',
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
