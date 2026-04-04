import { getUTFConnection } from './server/db.js';

async function searchDatabase() {
    const connection = await getUTFConnection();
    try {
        console.log('🔍 กำลังค้นหาตารางเกี่ยวกับ Authen...');

        // ค้นหาตารางที่มีคำว่า auth ในชื่อ
        const [authTables] = await connection.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = 'hos' AND TABLE_NAME LIKE '%auth%'
    `);
        console.log('✅ ตารางเกี่ยวกับ Auth:', authTables);

        console.log('\n🔍 กำลังค้นหาคอลัมน์เกี่ยวกับ project_code...');
        const [projectCols] = await connection.query(`
      SELECT TABLE_NAME, COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'hos' AND COLUMN_NAME LIKE '%project%'
    `);
        console.log('✅ คอลัมน์เกี่ยวกับ Project Code:', projectCols);

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        connection.release();
        process.exit();
    }
}

searchDatabase();
