import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkClopidogrel() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.HOSXP_HOST,
      user: process.env.HOSXP_USER,
      password: process.env.HOSXP_PASSWORD,
      database: process.env.HOSXP_DB,
      charset: 'utf8mb4',
    });

    console.log('🔍 Searching for Clopidogrel in drugitems...\n');

    // Search 1: Exact name match
    console.log('1️⃣ Searching: name LIKE "%Clopidogrel%"');
    let [rows] = await connection.query(`
      SELECT icode, name, strength, nhso_adp_code, unitcost
      FROM drugitems 
      WHERE name LIKE '%Clopidogrel%' OR name LIKE '%Clopidogre%'
      LIMIT 20
    `) as any[];
    console.log(`Found: ${rows.length} results\n`);
    rows.forEach((r: any) => console.log(`  - ${r.icode}: ${r.name} (${r.nhso_adp_code})`));

    // Search 2: ADP code
    console.log('\n2️⃣ Searching: nhso_adp_code = "3799977101"');
    [rows] = await connection.query(`
      SELECT icode, name, nhso_adp_code
      FROM drugitems 
      WHERE nhso_adp_code = '3799977101'
      LIMIT 20
    `) as any[];
    console.log(`Found: ${rows.length} results\n`);
    rows.forEach((r: any) => console.log(`  - ${r.icode}: ${r.name}`));

    // Search 3: Check usage
    console.log('\n3️⃣ Checking recent usage (last 30 days)');
    [rows] = await connection.query(`
      SELECT DISTINCT d.name, COUNT(*) as count
      FROM opitemrece oo
      JOIN drugitems d ON d.icode = oo.icode
      WHERE (d.name LIKE '%Clopidogrel%' OR d.nhso_adp_code = '3799977101')
        AND oo.vstdate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY d.name
    `) as any[];
    console.log(`Found: ${rows.length} usages\n`);
    rows.forEach((r: any) => console.log(`  - ${r.name}: ${r.count} records`));

    if (rows.length === 0) {
      console.log('⚠️ No Clopidogrel found! Need to check actual data.\n');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (connection) connection.end();
  }
}

checkClopidogrel();
