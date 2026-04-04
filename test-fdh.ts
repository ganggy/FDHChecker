import { getEligibleVisits } from './server/db.js';

async function run() {
    console.log('Testing getEligibleVisits...');
    try {
        const data = await getEligibleVisits('2026-03-01', '2026-03-31');
        console.log(`Found ${data.length} records`);
        if (data.length > 0) {
            console.log('Sample record:', data[0]);
        }
    } catch (err) {
        console.error('Error:', err);
    }
    process.exit();
}

run();
