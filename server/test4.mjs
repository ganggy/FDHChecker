import mysql from 'mysql2/promise';

async function test() {
    const conn = await mysql.createConnection({ host: '192.168.2.254', user: 'opd', password: 'opd', database: 'hos' });
    try {
        const [cols] = await conn.query('SHOW COLUMNS FROM an_stat');
        console.log('an_stat columns:', cols.filter(c => c.Field.includes('drg') || c.Field.includes('rw') || c.Field.includes('adjrw')));
    } catch (e) { console.error(e.message); }
    conn.end();
}
test();
