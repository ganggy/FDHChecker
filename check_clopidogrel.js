// Check for Clopidogrel drug items in database
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.HOSXP_HOST,
  user: process.env.HOSXP_USER,
  password: process.env.HOSXP_PASSWORD,
  database: process.env.HOSXP_DB,
  charset: 'utf8mb4',
});

console.log('🔍 Searching for Clopidogrel variants in drugitems table...\n');

// Search 1: Exact match on name
console.log('1️⃣ Searching: name LIKE "%Clopidogrel%"');
let [rows] = await connection.query(`
  SELECT icode, name, strength, nhso_adp_code, unitcost, sks_drug_code
  FROM drugitems 
  WHERE name LIKE '%Clopidogrel%' OR name LIKE '%Clopidogre%' OR name LIKE '%Clopidogr%'
  LIMIT 20
`);
console.log(`Found: ${rows.length} results`);
rows.forEach(r => console.log(`  - ${r.icode}: ${r.name} (${r.nhso_adp_code})`));

// Search 2: Check ADP code 3799977101
console.log('\n2️⃣ Searching: nhso_adp_code = "3799977101"');
[rows] = await connection.query(`
  SELECT icode, name, strength, nhso_adp_code, unitcost
  FROM drugitems 
  WHERE nhso_adp_code = '3799977101'
  LIMIT 20
`);
console.log(`Found: ${rows.length} results`);
rows.forEach(r => console.log(`  - ${r.icode}: ${r.name} (${r.nhso_adp_code})`));

// Search 3: DID pattern
console.log('\n3️⃣ Searching: did LIKE "1248460000039721217%"');
[rows] = await connection.query(`
  SELECT icode, name, strength, nhso_adp_code, did
  FROM drugitems 
  WHERE did LIKE '1248460000039721217%'
  LIMIT 20
`);
console.log(`Found: ${rows.length} results`);
rows.forEach(r => console.log(`  - ${r.icode}: ${r.name} (${r.did})`));

// Search 4: All drug items with "Clopid" prefix
console.log('\n4️⃣ Searching: name contains "Clopi"');
[rows] = await connection.query(`
  SELECT icode, name, strength, nhso_adp_code
  FROM drugitems 
  WHERE name LIKE '%Clopi%'
  LIMIT 20
`);
console.log(`Found: ${rows.length} results`);
rows.forEach(r => console.log(`  - ${r.icode}: ${r.name}`));

// Search 5: Check recent usage in opitemrece
console.log('\n5️⃣ Checking recent Clopidogrel usage in opitemrece (last 30 days)');
[rows] = await connection.query(`
  SELECT DISTINCT 
    oo.icode, 
    d.name, 
    COUNT(oo.vn) as usage_count,
    MAX(oo.vstdate) as last_used
  FROM opitemrece oo
  JOIN drugitems d ON d.icode = oo.icode
  WHERE (d.name LIKE '%Clopidogrel%' OR d.name LIKE '%Clopidogre%')
    AND oo.vstdate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  GROUP BY oo.icode
  LIMIT 20
`);
console.log(`Found: ${rows.length} usages`);
rows.forEach(r => console.log(`  - ${r.icode}: ${r.name} (used ${r.usage_count}x, last: ${r.last_used})`));

console.log('\n✅ Search complete!');
connection.end();
