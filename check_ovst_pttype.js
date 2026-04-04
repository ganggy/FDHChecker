const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'hosxp'
    });
    
    // Check ovst table structure
    const [columns] = await conn.execute('DESCRIBE ovst');
    console.log('OVST columns:');
    columns.forEach(col => {
      if (col.Field.toLowerCase().includes('type') || col.Field.toLowerCase().includes('pt')) {
        console.log(`  ${col.Field} (${col.Type})`);
      }
    });
    
    // Check specific records
    console.log('\n=== HN 000032578 ===');
    const [rows1] = await conn.execute(`
      SELECT o.vn, o.hn, o.pttype, p.pttype, DATE(o.vstdate) as vstdate
      FROM ovst o
      LEFT JOIN patient p ON o.hn = p.hn
      WHERE o.hn = '000032578'
      LIMIT 1
    `);
    console.log(JSON.stringify(rows1, null, 2));
    
    conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
