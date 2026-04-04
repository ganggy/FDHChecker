const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'hosxp'
    });
    
    // Find records with UNK or A1 hipdata codes
    const [rows] = await conn.execute(`
      SELECT 
        pt.hn,
        pt.pttype,
        ppt.hipdata_code,
        ppt.name as pttype_name
      FROM patient pt
      LEFT JOIN pttype ppt ON pt.pttype = ppt.pttype
      WHERE ppt.hipdata_code IN ('UNK', 'A1')
      LIMIT 10
    `);
    
    console.log('Records with UNK or A1:');
    rows.forEach(r => {
      console.log(`  HN: ${r.hn}, hipdata_code: ${r.hipdata_code}, pttype_name: ${r.pttype_name}`);
    });
    
    conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
