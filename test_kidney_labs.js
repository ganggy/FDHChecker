import http from 'http';

console.log('Starting test...');

const options = {
  hostname: 'localhost',
  port: 3506,
  path: '/api/hosxp/kidney-monitor?startDate=2026-03-01&endDate=2026-03-21',
  method: 'GET'
};

console.log('Making request to:', `http://${options.hostname}:${options.port}${options.path}`);

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.data && json.data.length > 0) {
        const firstRecord = json.data[0];
        console.log('\n=== First Patient Record ===');
        console.log('VN:', firstRecord.vn);
        console.log('Patient:', firstRecord.patientName);
          if (firstRecord.labs && firstRecord.labs.length > 0) {
          console.log(`\n=== All ${firstRecord.labs.length} Lab Items ===`);
          firstRecord.labs.forEach((lab, idx) => {
            console.log(`\nLab ${idx + 1}:`);
            console.log('  labcode:', lab.labcode);
            console.log('  labName:', lab.labName);
            console.log('  qty:', lab.qty);
            console.log('  unitcost:', lab.unitcost);
            console.log('  total_price:', lab.total_price);
          });
        } else {
          console.log('\n⚠️ No labs found in first record');
        }
      } else {
        console.log('No data returned');
      }
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      console.log('Response:', data.substring(0, 500));
    }
  });
});

req.on('error', (error) => {
  console.error('Request Error:', error.message);
});

req.end();
