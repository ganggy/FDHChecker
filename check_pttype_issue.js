const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'hosxp'
    });
    
    // Check HN 000032578
    const [rows] = await conn.execute(`
      SELECT 
        pt.hn,
        pt.pttype,
        ppt.hipdata_code,
        ppt.name as pttype_name
      FROM patient pt
      LEFT JOIN pttype ppt ON pt.pttype = ppt.pttype
      WHERE pt.hn = '000032578'
    `);
    
    console.log('HN 000032578 Info:');
    if (rows.length > 0) {
      const r = rows[0];
      console.log(`  pttype: ${r.pttype}`);
      console.log(`  hipdata_code: ${r.hipdata_code}`);
      console.log(`  pttype_name: ${r.pttype_name}`);
    }
    
    // Also check what pttype codes have NULL hipdata_code
    const [nullCodes] = await conn.execute(`
      SELECT DISTINCT 
        pt.pttype,
        ppt.hipdata_code,
        ppt.name
      FROM patient pt
      LEFT JOIN pttype ppt ON pt.pttype = ppt.pttype
      WHERE ppt.hipdata_code IS NULL
      LIMIT 10
    `);
    
    console.log('\nPTType codes with NULL hipdata_code:');
    nullCodes.forEach(row => {
      console.log(`  Code: ${row.pttype}, hipdata_code: ${row.hipdata_code}, name: ${row.name}`);
    });
    
    conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
