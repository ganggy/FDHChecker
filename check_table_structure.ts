import mssql from 'mssql';

const config = {
  server: 'localhost',
  database: 'HOSXP',
  authentication: {
    type: 'default',
  },
  options: {
    trustServerCertificate: true,
  },
};

const pool = new mssql.ConnectionPool(config);

pool.connect().then(async () => {
  try {
    // Check nondrugitems table structure
    const result = await pool.request().query(`
      SELECT TOP 5 * FROM nondrugitems
    `);
    
    if (result.recordset && result.recordset.length > 0) {
      const columns = Object.keys(result.recordset[0]);
      console.log('\n=== nondrugitems columns ===');
      console.log(columns);
      
      console.log('\n=== First record ===');
      console.log(JSON.stringify(result.recordset[0], null, 2));
    }
    
    // Check s_drugitems table structure
    const result2 = await pool.request().query(`
      SELECT TOP 5 * FROM s_drugitems
    `);
    
    if (result2.recordset && result2.recordset.length > 0) {
      const columns = Object.keys(result2.recordset[0]);
      console.log('\n=== s_drugitems columns ===');
      console.log(columns);
    }
    
    pool.close();
  } catch (err) {
    console.error('Error:', err.message);
    pool.close();
  }
}).catch(err => console.error('Connection error:', err));
