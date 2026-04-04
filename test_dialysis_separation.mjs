import http from 'http';

console.log('Testing Dialysis Service Separation...\n');

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
        
        console.log('=== PATIENT ===');
        console.log('VN:', patient.vn);
        console.log('Name:', patient.patientName);
        
        console.log('\n=== DIALYSIS SERVICE ===');
        console.log('Dialysis Fee:', patient.dialysisFee);
        console.log('Dialysis Cost:', patient.dialysisCost);
        
        console.log('\n=== LABS ===');
        console.log('Total Labs Sale:', patient.labTotalSale);
        console.log('Total Labs Cost:', patient.labTotalCost);
        if (patient.labs && patient.labs.length > 0) {
          console.log('Number of labs:', patient.labs.length);
          patient.labs.forEach((lab, idx) => {
            console.log(`  ${idx + 1}. ${lab.labName} - ฿${lab.total_price}`);
          });
        }
        
        console.log('\n=== REVENUE BREAKDOWN ===');
        console.log('Dialysis Service: ฿' + patient.dialysisFee);
        console.log('Drugs: ฿' + patient.drugTotalSale);
        console.log('Labs: ฿' + patient.labTotalSale);
        console.log('Total: ฿' + patient.revenue);
        
        console.log('\n✅ Test complete!');
      }
    } catch (err) {
      console.error('Error:', err.message);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
