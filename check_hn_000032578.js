const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '1234',
    database: 'hosxp'
  });
  
  const [rows] = await conn.execute(`
    SELECT 
      pt.hn, 
      pt.pttype,
      ptt.hipdata_code,
      ptt.name as pttype_name,
      o.vn,
      DATE(o.vstdate) as vstdate
    FROM patient pt
    LEFT JOIN pttype ptt ON pt.pttype = ptt.pttype
    LEFT JOIN ovst o ON pt.hn = o.hn
    WHERE pt.hn = '000032578'
    LIMIT 1
  `);
  
  console.log('Patient Info:', JSON.stringify(rows, null, 2));
  conn.end();
})();
