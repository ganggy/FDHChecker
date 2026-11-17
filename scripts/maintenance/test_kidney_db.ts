import { getUTFConnection } from './db';

const testKidneyMonitor = async () => {
  try {
    const conn = await getUTFConnection();
    
    // Test 1: Check if ovst table exists and has data
    console.log('\n=== Test 1: Check OVST table ===');
    const [ovstTest] = await conn.query(`
      SELECT COUNT(*) as cnt FROM ovst LIMIT 1
    `);
    console.log('OVST record count:', ovstTest);

    // Test 2: Check dialysis patients (N185/Z49)
    console.log('\n=== Test 2: Check N185/Z49 patients ===');
    const [dialysisPatients] = await conn.query(`
      SELECT DISTINCT 
        o.vn, o.hn, o.vstdate,
        d.icd10
      FROM ovst o
      JOIN ovstdiag d ON o.vn = d.vn
      WHERE d.icd10 LIKE 'N185%' OR d.icd10 LIKE 'Z49%'
      LIMIT 5
    `);
    console.log('Dialysis patients:', dialysisPatients);

    // Test 3: Check ovstdrug table
    console.log('\n=== Test 3: Check OVSTDRUG table ===');
    const [drugTest] = await conn.query(`
      SELECT COUNT(*) as cnt FROM ovstdrug LIMIT 1
    `);
    console.log('OVSTDRUG record count:', drugTest);

    // Test 4: Check drug join with s_drugitems
    console.log('\n=== Test 4: Check OVSTDRUG + S_DRUGITEMS ===');
    const [drugJoin] = await conn.query(`
      SELECT 
        od.vn, od.drugid, od.qty,
        sd.drugcode, sd.drugname
      FROM ovstdrug od
      LEFT JOIN s_drugitems sd ON od.drugid = sd.drugid
      LIMIT 3
    `);
    console.log('Drug items:', drugJoin);

    // Test 5: Check ovist table structure
    console.log('\n=== Test 5: Check OVIST table ===');
    const [ovistTest] = await conn.query(`
      DESCRIBE ovist
    `);
    console.log('OVIST columns:', ovistTest);

    // Test 6: Check opitemrece columns
    console.log('\n=== Test 6: Check OPITEMRECE columns ===');
    const [opitemTest] = await conn.query(`
      DESCRIBE opitemrece
    `);
    console.log('OPITEMRECE columns:', opitemTest);

    // Test 7: Check ovist + opitemrece join
    console.log('\n=== Test 7: Check OVIST + OPITEMRECE join ===');
    const [ovistJoin] = await conn.query(`
      SELECT 
        ov.vn, ov.icode, oe.name, oe.cost, oe.price
      FROM ovist ov
      LEFT JOIN opitemrece oe ON ov.icode = oe.icode
      LIMIT 3
    `);
    console.log('OVIST join:', ovistJoin);

    conn.release();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

testKidneyMonitor();
