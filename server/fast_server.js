// Fast Backend Server สำหรับ FDH AdminDashboard
// ใช้ Node.js + Express แบบ JavaScript (ESM)

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Mock data สำหรับ response เร็ว
const getMockData = () => [
  {
    id: '650321060010',
    hn: '123456',
    vn: '650321060010',
    patientName: 'นายสมชาย ใจดี',
    fund: 'UCS',
    serviceDate: '2026-03-15',
    serviceType: 'ผู้ป่วยนอก',
    price: 1200,
    status: 'สมบูรณ์',
    issues: [],
    _dataSource: 'Mock-Data',
  },
  {
    id: '690326080002',
    hn: '234567',
    vn: '690326080002',
    patientName: 'นางสาวสายใจ รักดี',
    fund: 'SSS',
    serviceDate: '2026-03-15',
    serviceType: 'ผู้ป่วยใน',
    price: 3500,
    status: 'ไม่สมบูรณ์',
    issues: ['ขาดรหัสหัตถการ', 'ราคาไม่ตรงมาตรฐาน'],
    _dataSource: 'Mock-Data',
  },
  {
    id: '690326080003',
    hn: '345678',
    vn: '690326080003',
    patientName: 'เด็กชายภูผา กล้าหาญ',
    fund: 'UCS',
    serviceDate: '2026-03-15',
    serviceType: 'ผู้ป่วยนอก',
    price: 800,
    status: 'สมบูรณ์',
    issues: [],
    _dataSource: 'Mock-Data',
  },
  {
    id: '690326080040',
    hn: '456789',
    vn: '690326080040',
    patientName: 'นายมงคล สุขสันต์',
    fund: 'OFC',
    serviceDate: '2026-03-15',
    serviceType: 'ผู้ป่วยใน',
    price: 5200,
    status: 'ไม่สมบูรณ์',
    issues: ['ขาดรหัสหัตถการ'],
    _dataSource: 'Mock-Data',
  },
  {
    id: '690326080035',
    hn: '567890',
    vn: '690326080035',
    patientName: 'นางนิยม เรียบร้อย',
    fund: 'LGO',
    serviceDate: '2026-03-15',
    serviceType: 'ผู้ป่วยนอก',
    price: 950,
    status: 'สมบูรณ์',
    issues: [],
    _dataSource: 'Mock-Data',
  },
];

// API สำหรับดึงข้อมูลตรวจสอบ
app.get('/api/hosxp/checks', (req, res) => {
  try {
    const { fund, startDate, endDate } = req.query;
    console.log(`📌 Fetching checks - Fund: ${fund || 'All'}, Start: ${startDate || 'N/A'}, End: ${endDate || 'N/A'}`);

    let data = getMockData();

    if (fund && fund !== 'ทั้งหมด') {
      data = data.filter(item => item.fund === fund);
    }

    if (startDate && endDate) {
      data = data.filter(item => item.serviceDate >= startDate && item.serviceDate <= endDate);
    }

    console.log(`✅ Returning ${data.length} mock records`);
    res.json({
      success: true,
      dataSource: 'Mock-Data',
      totalRecords: data.length,
      filters: { fund: fund || 'ทั้งหมด', startDate: startDate || null, endDate: endDate || null },
      data: data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
  }
});

// API สำหรับดึงข้อมูลใบเสร็จ
app.get('/api/hosxp/receipt/:vn', (req, res) => {
  const { vn } = req.params;
  res.json({
    success: true, vn,
    items: [
      { icode: 'D001', drugName: 'ยาแก้ปวด', qty: 2, unitPrice: 50, price: 100, has_adp_mapping: 1 },
      { icode: 'S001', drugName: 'ค่าตรวจ', qty: 1, unitPrice: 200, price: 200, has_adp_mapping: 1 },
    ],
    totalPrice: 300,
    timestamp: new Date().toISOString(),
  });
});

// API สำหรับดึงข้อมูล services/ADP
app.get('/api/hosxp/services/:vn', (req, res) => {
  res.json([]);
});

// API สำหรับดึงข้อมูลผู้ป่วย
app.get('/api/hosxp/patients/:hn', (req, res) => {
  const { hn } = req.params;
  const patient = getMockData().find(r => r.hn === hn);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json({ success: true, hn: patient.hn, patientName: patient.patientName, fund: patient.fund });
});

// API สำหรับดึงรายการกองทุน
app.get('/api/hosxp/funds', (req, res) => {
  res.json([
    { id: 'UCS', name: 'กองทุนหลักประกันสุขภาพถ้วนหน้า (UCS)' },
    { id: 'SSS', name: 'กองทุนประกันสังคม (SSS)' },
    { id: 'OFC', name: 'กองทุนข้าราชการ (OFC)' },
    { id: 'LGO', name: 'กองทุน อปท.' },
  ]);
});

// API สำหรับดึงข้อมูล visit_pttype (ประเภทประกันจากการมารับบริการ)
app.get('/api/hosxp/visit-pttype/:vn', (req, res) => {
  const { vn } = req.params;
  console.log(`📌 Fetching visit_pttype for VN: ${vn}`);
  
  // Mock data - visit_pttype example
  const mockVisitPtypeData = [
    {
      vn: vn,
      pttype: 4,
      pttype_number: 1,
      begin_date: '2024-01-01',
      expire_date: '2026-12-31',
      auth_code: 'AUTH001234',
      auth_status: 'Y',
      pttype_name: 'บัตรประกันสุขภาพ (ร่วมจ่าย30 บาท)',
      hn: '000013485',
      patient_name: 'นางนวลจันทร์ แก้วมะ'
    }
  ];
  
  res.json({
    success: true,
    vn: vn,
    data: mockVisitPtypeData,
    timestamp: new Date().toISOString()
  });
});

// API สำหรับตรวจสอบ auth_code (รหัสสิทธิ)
app.get('/api/hosxp/auth-code/:vn/:pttype', (req, res) => {
  const { vn, pttype } = req.params;
  console.log(`🔐 Validating auth_code for VN: ${vn}, Pttype: ${pttype}`);
  
  // Mock validation result
  const mockValidation = {
    vn: vn,
    pttype: pttype,
    hasAuthCode: true,
    authCode: 'AUTH001234',
    beginDate: '2024-01-01',
    expireDate: '2026-12-31',
    isValid: true,
    message: 'รหัสสิทธิถูกต้อง',
    daysRemaining: 286
  };
  
  res.json({
    success: true,
    data: mockValidation,
    timestamp: new Date().toISOString()
  });
});

// API ส่งข้อมูลไป FDH
app.post('/api/fdh/submit', (req, res) => {
  const { records, submittedAt } = req.body;
  res.json({ success: true, message: 'Data submitted to FDH successfully', submittedRecords: records?.length || 0, submittedAt, timestamp: new Date().toISOString() });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'FAST', database: 'mock', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Fast Server running on port ${PORT}`);
  console.log(`📋 Mode: FAST (Mock Data)`);
  console.log(`🌐 API: http://localhost:${PORT}/api`);
  console.log(`🚀 Ready!`);
});
