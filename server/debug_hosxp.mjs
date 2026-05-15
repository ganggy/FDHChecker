import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: '192.168.2.254',
  user: 'opd',
  password: 'opd',
  database: 'hos',
  charset: 'utf8mb4'
});

console.log('Connected to HOSxP');

// Check ovst date range
const [ovstRange] = await conn.execute('SELECT MIN(vstdate) as minD, MAX(vstdate) as maxD, COUNT(*) as cnt FROM ovst');
console.log('ovst range:', JSON.stringify(ovstRange));

// Check vn_stat with income
const [vnstatIncome] = await conn.execute('SELECT COUNT(*) as cnt FROM vn_stat WHERE income > 0');
console.log('vn_stat income>0:', JSON.stringify(vnstatIncome));

// Check sample with income join
const [sample] = await conn.execute(`
  SELECT o.vn, o.hn, o.vstdate, v.income
  FROM ovst o
  JOIN vn_stat v ON v.vn = o.vn
  WHERE v.income > 0
  LIMIT 5
`);
console.log('sample ovst+vn_stat:', JSON.stringify(sample));

await conn.end();
