import mysql from 'mysql2/promise';
import 'dotenv/config';

async function test() {
    const conn = await mysql.createConnection({ host: process.env.HOSXP_HOST, user: process.env.HOSXP_USER, password: process.env.HOSXP_PASSWORD, database: process.env.HOSXP_DB });
    try {
        const [cols] = await conn.query('SHOW COLUMNS FROM an_stat');
        console.log('an_stat columns:', cols.filter(c => c.Field.includes('drg') || c.Field.includes('rw') || c.Field.includes('adjrw')));
    } catch (e) { console.error(e.message); }
    conn.end();
}
test();
