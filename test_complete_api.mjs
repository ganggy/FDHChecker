import http from 'http';

console.log('Testing complete Kidney Monitor API response...\n');

// Set a timeout
setTimeout(() => {
  console.error('Request timeout - took too long');
  process.exit(1);
}, 10000);

const options = {
  hostname: 'localhost',
  port: 3506,
  path: '/api/hosxp/kidney-monitor?startDate=2026-03-01&endDate=2026-03-21',
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
      if (json.data && json.data.length > 0) {
        const patient = json.data[0];
        
        console.log('=== PATIENT RECORD ===');
        console.log('VN:', patient.vn);
        console.log('Patient:', patient.patientName);
        console.log('Service Date:', patient.serviceDate);
        console.log('Insurance Type:', patient.insuranceType);
        console.log('Insurance Group:', patient.insuranceGroup);
        
        console.log('\n=== REVENUE BREAKDOWN ===');
        console.log('Dialysis Fee:', patient.dialysisFee);
        console.log('Drug Total Sale:', patient.drugTotalSale);
        console.log('Lab Total Sale:', patient.labTotalSale);
        console.log('Total Revenue:', patient.revenue);
        
        console.log('\n=== COST BREAKDOWN ===');
        console.log('Dialysis Cost:', patient.dialysisCost);
        console.log('Drug Total Cost:', patient.drugTotalCost);
        console.log('Lab Total Cost:', patient.labTotalCost);
        console.log('Total Cost:', patient.costTotal);
        
        console.log('\n=== PROFIT ANALYSIS ===');
        console.log('Total Profit:', patient.profit);
        console.log('Profit Margin:', patient.profitMargin + '%');
        
        console.log('\n=== DRUGS ===');
        if (patient.drugs && patient.drugs.length > 0) {
          patient.drugs.slice(0, 2).forEach((drug, idx) => {
            console.log(`\nDrug ${idx + 1}:`);
            console.log('  Name:', drug.drugName);
            console.log('  Code:', drug.drugcode);
            console.log('  Qty:', drug.qty);
            console.log('  Unit Price:', drug.unitprice);
            console.log('  Unit Cost:', drug.unitcost);
            console.log('  Total Price:', drug.total_price);
            console.log('  Total Cost:', drug.total_cost);
          });
        } else {
          console.log('(No drugs)');
        }
        
        console.log('\n=== LABS ===');
        if (patient.labs && patient.labs.length > 0) {
          patient.labs.slice(0, 3).forEach((lab, idx) => {
            console.log(`\nLab ${idx + 1}:`);
            console.log('  Name:', lab.labName);
            console.log('  Code:', lab.labcode);
            console.log('  Qty:', lab.qty);
            console.log('  Service Cost:', lab.service_cost);
            console.log('  Service Price:', lab.service_pprice);
            console.log('  Total Price:', lab.total_price);
          });
        } else {
          console.log('(No labs)');
        }
        
        console.log('\n✅ API test complete!');
      } else {
        console.log('❌ No data returned from API');
      }
    } catch (err) {
      console.error('❌ JSON Parse Error:', err.message);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request Error:', error.message);
});

req.end();
