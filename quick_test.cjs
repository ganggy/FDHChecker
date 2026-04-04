const http = require('http');

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
      const patient = json.data[0];
      
      console.log('\n=== DIALYSIS SERVICE BREAKDOWN ===\n');
      console.log('Total Dialysis Fee:', patient.dialysisFee);
      console.log('Total Dialysis Cost:', patient.dialysisCost);
      console.log('Total Dialysis Profit:', patient.dialysisFee - patient.dialysisCost);
      
      console.log('\n--- Services ---');
      if (patient.dialysisServices && patient.dialysisServices.length > 0) {
        patient.dialysisServices.forEach((svc, i) => {
          console.log(`\n${i+1}. ${svc.serviceName}`);
          console.log(`   Revenue: ฿${svc.total_price}`);
          console.log(`   Cost: ฿${svc.service_cost}`);
          console.log(`   Profit: ฿${svc.profit}`);
        });
      }
      
      console.log('\n✅ Complete!\n');
    } catch (err) {
      console.error('Error:', err.message);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
});

req.end();
