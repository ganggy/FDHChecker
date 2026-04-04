// Backend API Server สำหรับเชื่อมต่อ HOSxP
// ใช้ Node.js + Express

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  getCheckData,
  validateCheckCompletenesss,
  getDrugPrices,
  getProcedures,
  getPatientData,
  testConnection,
} from './db.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// API สำหรับดึงข้อมูลตรวจสอบจาก HOSxP
app.get('/api/hosxp/checks', async (req, res) => {
  try {
    const { fund, startDate, endDate, serviceType } = req.query;

    let query = `
      SELECT 
        vn as id,
        hn,
        (SELECT pt_name FROM patient WHERE patient.hn = ovst.hn LIMIT 1) as patientName,
        fund,
        CAST(DATE_FORMAT(vstdate, '%Y-%m-%d') AS CHAR) as serviceDate,
        CASE 
          WHEN ovst.ispd = 1 THEN 'OPD'
          WHEN ovst.ispd = 2 THEN 'IPD'
          ELSE 'OTHER'
        END as serviceType,
        'สมบูรณ์' as status,
        NULL as issues,
        total_price as price
      FROM ovst
      WHERE 1=1
    `;

    const params: any[] = [];

    if (fund) {
      query += ` AND fund = ?`;
      params.push(fund);
    }

    if (startDate) {
      query += ` AND vstdate >= ?`;
      params.push(new Date(startDate as string));
    }

    if (endDate) {
      query += ` AND vstdate <= ?`;
      params.push(new Date(endDate as string));
    }

    if (serviceType) {
      const ispd = serviceType === 'OPD' ? 1 : 2;
      query += ` AND ispd = ?`;
      params.push(ispd);
    }

    query += ` ORDER BY vstdate DESC LIMIT 1000`;

    const connection = await hosxpPool.getConnection();
    const [rows] = await connection.query(query, params);
    connection.release();

    res.json(rows);
  } catch (error) {
    console.error('Error fetching checks:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูลผู้ป่วย
app.get('/api/hosxp/patients/:hn', async (req, res) => {
  try {
    const { hn } = req.params;

    const query = `
      SELECT 
        hn,
        pt_name as patientName,
        pt_birthdate as birthDate,
        pt_sex as gender,
        pt_nation as nationality
      FROM patient
      WHERE hn = ?
    `;

    const connection = await hosxpPool.getConnection();
    const [rows] = await connection.query(query, [hn]);
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูลรายการบริการ
app.get('/api/hosxp/services/:serviceCode', async (req, res) => {
  try {
    const { serviceCode } = req.params;

    const query = `
      SELECT 
        code as serviceCode,
        name as serviceName,
        price,
        fund
      FROM service_list
      WHERE code = ?
    `;

    const connection = await hosxpPool.getConnection();
    const [rows] = await connection.query(query, [serviceCode]);
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูลยา
app.get('/api/hosxp/drugs/:drugCode', async (req, res) => {
  try {
    const { drugCode } = req.params;

    const query = `
      SELECT 
        code as drugCode,
        name as drugName,
        price,
        unit
      FROM drug_list
      WHERE code = ?
    `;

    const connection = await hosxpPool.getConnection();
    const [rows] = await connection.query(query, [drugCode]);
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Drug not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching drug:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูลจาก rcmdb (REP/STM/INV)
app.get('/api/rcmdb/:dataType', async (req, res) => {
  try {
    const { dataType } = req.params;

    let query = '';
    if (dataType === 'REP') {
      query = 'SELECT * FROM rep_data LIMIT 1000';
    } else if (dataType === 'STM') {
      query = 'SELECT * FROM stm_data LIMIT 1000';
    } else if (dataType === 'INV') {
      query = 'SELECT * FROM inv_data LIMIT 1000';
    } else {
      return res.status(400).json({ error: 'Invalid data type' });
    }

    const connection = await rcmdbPool.getConnection();
    const [rows] = await connection.query(query);
    connection.release();

    res.json(rows);
  } catch (error) {
    console.error('Error fetching rcmdb data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับส่งข้อมูลไปยังระบบ FDH
app.post('/api/fdh/submit', async (req, res) => {
  try {
    const { records, submittedAt, count } = req.body;

    // บันทึกข้อมูลลงฐานข้อมูล FDH (ตัวอย่าง)
    const query = `
      INSERT INTO fdh_submissions (submitted_data, submitted_at, record_count, status)
      VALUES (?, ?, ?, 'PENDING')
    `;

    const connection = await hosxpPool.getConnection();
    await connection.query(query, [JSON.stringify(records), submittedAt, count]);
    connection.release();

    res.json({
      success: true,
      message: 'Data submitted to FDH successfully',
      submittedRecords: count,
      submittedAt,
    });
  } catch (error) {
    console.error('Error submitting to FDH:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`HOSxP Database: ${process.env.HOSXP_HOST || '192.168.2.254'}`);
});
