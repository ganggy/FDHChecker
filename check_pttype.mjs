import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '192.168.2.254',
  user: 'opd',
  password: 'opd',
  database: 'hos'
});

async function checkPttype() {
  const conn = await pool.getConnection();
  await conn.query('SET NAMES utf8mb4');
  
  // Check what hipdata_codes exist for LGO/OFC
  const [lgoRecords] = await conn.query(`
    SELECT DISTINCT 
      pttype, 
      name, 
      hipdata_code,
      COUNT(*) as count
    FROM pttype
    WHERE hipdata_code IN ('OFC', 'LGO') 
       OR name LIKE '%OFC%' 
       OR name LIKE '%LGO%'
       OR name LIKE '%อปท%'
    GROUP BY pttype, name, hipdata_code
    LIMIT 20
  `);
  
  console.log('🔍 OFC/LGO pttype records found:');
  console.table(lgoRecords);
  
  // Check sample patient visit to see what pttype they have
  const [sampleVisits] = await conn.query(`
    SELECT 
      o.hn,
      o.vn,
      p.pttype,
      pt.name,
      pt.hipdata_code,
      o.vstdate
    FROM ovst o
    LEFT JOIN patient p ON o.hn = p.hn
    LEFT JOIN pttype pt ON p.pttype = pt.pttype
    WHERE DATE(o.vstdate) >= '2026-03-20'
    LIMIT 15
  `);
  
  console.log('\n📊 Sample patient visits with pttype:');
  console.table(sampleVisits);
  
  conn.release();
  pool.end();
}

checkPttype().catch(console.error);
