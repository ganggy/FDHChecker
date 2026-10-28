import { getUTFConnection } from '../server/db.js';
import { syncDentalIcdAndVnStat } from '../server/dentalAudit.js';

async function run() {
  console.log('=== Starting Historical Dental ICD Synchronization ===');
  console.log('Target: Visits from 2025-10-01 to present with mismatched diagnoses\n');

  const conn = await getUTFConnection();
  try {
    const [rows]: any = await conn.query(`
      SELECT DISTINCT o.vn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') as vstdate, od.icd10 as ovstdiag_pdx, di.icd as dental_pdx
      FROM ovst o
      JOIN ovstdiag od ON od.vn = o.vn AND od.diagtype = '1'
      JOIN dental_icd di ON di.vn = o.vn AND di.dxtype = '1'
      WHERE o.vstdate >= '2025-10-01'
        AND (di.icd <> od.icd10 AND REPLACE(di.icd, '.', '') <> REPLACE(od.icd10, '.', ''))
      ORDER BY o.vstdate DESC
    `);

    const total = rows.length;
    console.log(`Found ${total} mismatched visits to synchronize.\n`);

    if (total === 0) {
      console.log('No mismatched visits found.');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < total; i++) {
      const row = rows[i];
      try {
        await syncDentalIcdAndVnStat(conn, row.vn);
        successCount++;
      } catch (err: any) {
        console.error(`Error syncing VN ${row.vn}:`, err?.message || err);
        errorCount++;
      }

      if ((i + 1) % 50 === 0 || i + 1 === total) {
        console.log(`Progress: ${i + 1}/${total} (${Math.round(((i + 1) / total) * 100)}%) - Success: ${successCount}, Errors: ${errorCount}`);
      }
    }

    console.log('\n=== Synchronization Complete ===');
    console.log(`Total: ${total}`);
    console.log(`Success: ${successCount}`);
    console.log(`Errors: ${errorCount}`);

    // Verification check
    const [remaining]: any = await conn.query(`
      SELECT COUNT(DISTINCT o.vn) AS remaining_count
      FROM ovst o
      JOIN ovstdiag od ON od.vn = o.vn AND od.diagtype = '1'
      JOIN dental_icd di ON di.vn = o.vn AND di.dxtype = '1'
      WHERE o.vstdate >= '2025-10-01'
        AND (di.icd <> od.icd10 AND REPLACE(di.icd, '.', '') <> REPLACE(od.icd10, '.', ''))
    `);
    console.log(`Remaining mismatched visits in period: ${remaining[0].remaining_count}`);

  } finally {
    conn.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
