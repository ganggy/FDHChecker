const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/hosxp/kidney-monitor?startDate=2026-03-20&endDate=2026-03-21',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('✅ API Success');
      console.log(`Total Records: ${json.data.length}`);
      
      if (json.data.length > 0) {
        console.log('\nFirst Record:');
        const r = json.data[0];
        console.log(`HN: ${r.hn}`);
        console.log(`Name: ${r.patientName}`);
        console.log(`Group: ${r.insuranceGroup}`);
        console.log(`Drug: ${r.drugTotalSale}`);
        console.log(`Lab: ${r.labTotalSale}`);
        console.log(`Profit: ${r.profit}`);
      } else {
        console.log('❌ No data returned');
      }
    } catch (e) {
      console.error('❌ Error:', e.message);
      console.log('Response:', data.substring(0, 200));
    }
  });
});

req.on('error', (e) => console.error('❌ Request failed:', e.message));
req.end();
