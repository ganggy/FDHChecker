const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'hosxp'
    });
    
    // Check specific HNs with OTHER insurance group
    const hnList = ['000032578', '000031972', '000093930', '000094053', '000023880'];
    
    for (const hn of hnList) {
      const [rows] = await conn.execute(`
        SELECT 
          pt.hn,
          pt.pttype,
          ppt.hipdata_code,
          ppt.name as pttype_name
        FROM patient pt
        LEFT JOIN pttype ppt ON pt.pttype = ppt.pttype
        WHERE pt.hn = ?
      `, [hn]);
      
      if (rows.length > 0) {
        const r = rows[0];
        console.log(`HN: ${r.hn}`);
        console.log(`  hipdata_code: ${r.hipdata_code}`);
        console.log(`  pttype_name: ${r.pttype_name}`);
        console.log('');
      }
    }
    
    conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
