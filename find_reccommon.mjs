import mysql from 'mysql2/promise';

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'hosxp',
      password: 'password',
      database: 'hosxp'
    });

    console.log('🔍 ค้นหา Reccommon ในระบบ\n');

    // ค้นหา Reccommon ในแต่ละตาราง
    const [drugItems] = await conn.query(
      `SELECT icode, name FROM drugitems WHERE name LIKE '%Reccommon%' LIMIT 5`
    );
    
    if (drugItems.length > 0) {
      console.log('✅ พบใน drugitems:');
      drugItems.forEach(d => console.log(`   icode: ${d.icode}, name: ${d.name}`));

      // ค้นหาใน opitemrece
      const [opItems] = await conn.query(
        `SELECT DISTINCT icode, income, COUNT(*) as cnt FROM opitemrece WHERE icode IN (${drugItems.map(d => `'${d.icode}'`).join(',')}) GROUP BY icode, income`
      );
      
      console.log('\n📋 Income codes ของ Reccommon:');
      opItems.forEach(d => {
        console.log(`   icode: ${d.icode}, income: ${d.income}, ปรากฏ: ${d.cnt} ครั้ง`);
      });

      // ตรวจสอบ income table
      const incomeList = [...new Set(opItems.map(d => d.income))];
      const [incomeInfo] = await conn.query(
        `SELECT income, name, income_group FROM income WHERE income IN (${incomeList.map(i => `'${i}'`).join(',')})`
      );
      
      console.log('\n💡 Income group info:');
      incomeInfo.forEach(i => {
        console.log(`   income: ${i.income}, name: ${i.name}, group: ${i.income_group}`);
      });
    } else {
      console.log('❌ ไม่พบ Reccommon ในตาราง drugitems');
      
      // ค้นหาใน s_drugitems
      const [sDrugItems] = await conn.query(
        `SELECT icode, name FROM s_drugitems WHERE name LIKE '%Reccommon%' LIMIT 5`
      );
      
      if (sDrugItems.length > 0) {
        console.log('✅ พบใน s_drugitems:');
        sDrugItems.forEach(d => console.log(`   icode: ${d.icode}, name: ${d.name}`));
      }
    }

    await conn.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
})();
