import mysql from 'mysql2/promise';

async function test() {
    const conn = await mysql.createConnection({ host: '192.168.2.254', user: 'opd', password: 'opd', database: 'hos' });
    try {
        let query = `
      SELECT 
        ipt.an,
        ipt.hn,
        ipt.vn,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patientName,
        w.name as ward,
        DATE_FORMAT(ipt.regdate, '%Y-%m-%d') as admDate,
        ipt.dchdate,
        CASE 
          WHEN ipt.dchdate IS NULL THEN DATEDIFF(CURDATE(), ipt.regdate)
          ELSE DATEDIFF(ipt.dchdate, ipt.regdate) 
        END as los,
        pttype.name as pttype,
        COALESCE(ipt.pttype, pttype.hipdata_code) as hipdata_code,
        
        -- DRG & RW
        (SELECT drg FROM ipt_drg WHERE an = ipt.an LIMIT 1) as drg,
        (SELECT rw FROM ipt_drg WHERE an = ipt.an LIMIT 1) as rw,
        
        -- Diagnosis and Procedures
        (SELECT icd10 FROM iptdiag WHERE an = ipt.an AND diagtype = '1' LIMIT 1) as pdx,
        (SELECT GROUP_CONCAT(icd9) FROM iptoprt WHERE an = ipt.an) as or_codes,
        
        -- Total Price
        COALESCE((SELECT SUM(sum_price) FROM opitemrece WHERE an = ipt.an), 0) as totalPrice,
        
        -- Status
        CASE WHEN ipt.dchdate IS NULL THEN 'Admitted' ELSE 'Discharged' END as status,
        CASE 
          WHEN ipt.dchdate IS NOT NULL AND (SELECT COUNT(*) FROM iptdiag WHERE an = ipt.an) > 0 THEN 'สรุปชาร์ตแล้ว'
          WHEN ipt.dchdate IS NOT NULL THEN 'รอแพทย์สรุปชาร์ต'
          ELSE 'รอดำเนินการ'
        END as chartStatus
        
      FROM ipt
      JOIN patient pt ON ipt.hn = pt.hn
      LEFT JOIN ward w ON ipt.ward = w.ward
      LEFT JOIN pttype ON ipt.pttype = pttype.pttype
      WHERE 1=1
      AND DATE(ipt.regdate) >= '2026-03-01'
      ORDER BY ipt.regdate DESC LIMIT 5
      `;
        const [rows2] = await conn.query(query);
        console.log('Main query length:', rows2.length);
    } catch (e) { console.error('Error in main query:', e.message); }
    conn.end();
}
test();
