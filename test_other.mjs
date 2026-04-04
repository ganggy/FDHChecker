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
    
    const results = [];
    for (const hn of hnList) {
      try {
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
        
        if (rows && rows.length > 0) {
          const r = rows[0];
          results.push({
            hn: r.hn,
            hipdata_code: r.hipdata_code,
            pttype_name: r.pttype_name
          });
        }
      } catch (e) {
        // continue
      }
    }
    
    console.log(JSON.stringify(results, null, 2));
    conn.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
