import mysql from 'mysql2/promise';

async function setupAuditTable() {
    const conn = await mysql.createConnection({ host: '192.168.2.254', user: 'opd', password: 'opd', database: 'hos' });
    try {
        await conn.query(`
        CREATE TABLE IF NOT EXISTS z_fdh_audit_log (
          an VARCHAR(20) PRIMARY KEY,
          status VARCHAR(50) NOT NULL,
          updated_by VARCHAR(100),
          notes TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=tis620;
      `);
        console.log('✅ Audit table created or already exists');

        // Insert dummy record
        await conn.query(`
        INSERT INTO z_fdh_audit_log (an, status, updated_by, notes) 
        VALUES ('690000709', 'AUDITED', 'Demo User', 'OK')
        ON DUPLICATE KEY UPDATE status = 'AUDITED', updated_at = NOW();
      `);
        console.log('✅ Dummy record inserted');

        const [rows] = await conn.query('SELECT * FROM z_fdh_audit_log');
        console.log(rows);
    } catch (e) { console.error('Error:', e.message); }
    conn.end();
}
setupAuditTable();
