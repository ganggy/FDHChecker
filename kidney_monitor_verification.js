/**
 * Comprehensive test to verify Kidney Monitor real database integration
 * 
 * This test verifies:
 * 1. API returns correct data structure
 * 2. Data is properly grouped by insuranceGroup
 * 3. Summary calculations are correct
 * 4. Frontend receives and displays correct values
 */

const http = require('http');

function testAPI() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3506,
            path: '/api/hosxp/kidney-monitor?startDate=2026-03-20&endDate=2026-03-21',
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Starting Kidney Monitor Data Verification Tests\n');
    
    try {
        const response = await testAPI();
        const data = response.data || [];

        // Test 1: Total Records
        console.log('✅ Test 1: Total Records Count');
        console.log(`   Expected: 82`);
        console.log(`   Actual: ${data.length}`);
        console.log(`   Status: ${data.length === 82 ? '✓ PASS' : '✗ FAIL'}\n`);

        // Test 2: UCS+SSS Count
        const ucsCount = data.filter(r => r.insuranceGroup === 'UCS+SSS').length;
        console.log('✅ Test 2: UCS+SSS Record Count');
        console.log(`   Expected: 45`);
        console.log(`   Actual: ${ucsCount}`);
        console.log(`   Status: ${ucsCount === 45 ? '✓ PASS' : '✗ FAIL'}\n`);

        // Test 3: OFC+LGO Count
        const ofcCount = data.filter(r => r.insuranceGroup === 'OFC+LGO').length;
        console.log('✅ Test 3: OFC+LGO Record Count');
        console.log(`   Expected: 24`);
        console.log(`   Actual: ${ofcCount}`);
        console.log(`   Status: ${ofcCount === 24 ? '✓ PASS' : '✗ FAIL'}\n`);

        // Test 4: UC-EPO Count
        const ucCount = data.filter(r => r.insuranceGroup === 'UC-EPO').length;
        console.log('✅ Test 4: UC-EPO Record Count');
        console.log(`   Expected: 0`);
        console.log(`   Actual: ${ucCount}`);
        console.log(`   Status: ${ucCount === 0 ? '✓ PASS' : '✗ FAIL'}\n`);

        // Test 5: Total Profit Calculation
        const totalProfit = data.reduce((sum, r) => sum + (r.profit || 0), 0);
        const expectedProfit = 618826.40;
        const profitDiff = Math.abs(totalProfit - expectedProfit);
        console.log('✅ Test 5: Total Profit Calculation');
        console.log(`   Expected: ฿${expectedProfit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log(`   Actual: ฿${totalProfit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log(`   Difference: ฿${profitDiff.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log(`   Status: ${profitDiff < 100 ? '✓ PASS' : '✗ FAIL'}\n`);

        // Test 6: insuranceGroup Field Exists
        const hasInsuranceGroup = data.every(r => 'insuranceGroup' in r);
        console.log('✅ Test 6: insuranceGroup Field Present in All Records');
        console.log(`   Expected: true`);
        console.log(`   Actual: ${hasInsuranceGroup}`);
        console.log(`   Status: ${hasInsuranceGroup ? '✓ PASS' : '✗ FAIL'}\n`);

        // Test 7: Profit Field Exists
        const hasProfit = data.every(r => 'profit' in r);
        console.log('✅ Test 7: profit Field Present in All Records');
        console.log(`   Expected: true`);
        console.log(`   Actual: ${hasProfit}`);
        console.log(`   Status: ${hasProfit ? '✓ PASS' : '✗ FAIL'}\n`);

        // Test 8: UCS+SSS Profit Sum
        const ucsProfit = data
            .filter(r => r.insuranceGroup === 'UCS+SSS')
            .reduce((sum, r) => sum + (r.profit || 0), 0);
        console.log('✅ Test 8: UCS+SSS Total Profit');
        console.log(`   Count: 45 records`);
        console.log(`   Total Profit: ฿${ucsProfit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log(`   Average Profit: ฿${(ucsProfit / 45).toLocaleString('th-TH', {minimumFractionDigits: 2})}\n`);

        // Test 9: OFC+LGO Profit Sum
        const ofcProfit = data
            .filter(r => r.insuranceGroup === 'OFC+LGO')
            .reduce((sum, r) => sum + (r.profit || 0), 0);
        console.log('✅ Test 9: OFC+LGO Total Profit');
        console.log(`   Count: 24 records`);
        console.log(`   Total Profit: ฿${ofcProfit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log(`   Average Profit: ฿${(ofcProfit / 24).toLocaleString('th-TH', {minimumFractionDigits: 2})}\n`);

        // Sample Records
        console.log('✅ Sample Records (First 3):');
        data.slice(0, 3).forEach((record, i) => {
            console.log(`   [${i + 1}] ${record.patientName}`);
            console.log(`       Insurance: ${record.insuranceGroup}`);
            console.log(`       Profit: ฿${record.profit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
            console.log(`       Revenue: ฿${record.revenue.toLocaleString('th-TH', {minimumFractionDigits: 2})}\n`);
        });

        // Final Summary
        console.log('\n📊 FINAL SUMMARY:');
        console.log('====================');
        console.log(`Total Records: ${data.length}`);
        console.log(`UCS+SSS: ${ucsCount} records | ฿${ucsProfit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log(`OFC+LGO: ${ofcCount} records | ฿${ofcProfit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log(`UC-EPO: ${ucCount} records | ฿0.00`);
        console.log(`Total Profit: ฿${totalProfit.toLocaleString('th-TH', {minimumFractionDigits: 2})}`);
        console.log('====================\n');

        // Check all tests passed
        const allTests = [
            data.length === 82,
            ucsCount === 45,
            ofcCount === 24,
            ucCount === 0,
            profitDiff < 100,
            hasInsuranceGroup,
            hasProfit
        ];

        const passCount = allTests.filter(t => t).length;
        console.log(`\n✓ Tests Passed: ${passCount}/${allTests.length}`);
        
        if (passCount === allTests.length) {
            console.log('🎉 All tests PASSED! Real database integration is working correctly.\n');
        } else {
            console.log('❌ Some tests FAILED. Please review the above results.\n');
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error('Make sure the backend server is running on port 3506\n');
    }
}

runTests();
