// ข้อมูล mockup สำหรับรายการตรวจสอบกองทุน HOSxP
export const mockFunds = [
  { id: 'UCS', name: 'กองทุนหลักประกันสุขภาพถ้วนหน้า (UCS)' },
  { id: 'SSS', name: 'กองทุนประกันสังคม (SSS)' },
  { id: 'OFC', name: 'กองทุนข้าราชการ (OFC)' },
  { id: 'LGO', name: 'กองทุน อปท.' },
];

export interface ServiceADPItem {
  icode: string;
  income: string;
  income_name: string;
  adp_code?: string;
  adp_name?: string;
  adp_price?: number;
  can_claim?: number;
}

export interface PrescriptionItem {
  icode: string;
  drugName: string;
  qty: number;
  unitPrice: number;
  price: number;
  adp_code?: string;
  nhso_code?: string;
  nhso_name?: string;
  has_adp_mapping?: number;
}

export interface CheckRecord {
  id: number;
  hn: string;
  vn?: string;
  patientName: string;
  fund: string;
  serviceDate: string;
  serviceType: string;
  status: 'ready' | 'pending' | 'rejected';
  issues: string[];
  price: number;
  main_diag?: string;
  pdx?: string;
  vstdate?: string;
  diags?: any[];
  prescriptions?: PrescriptionItem[];
  services?: ServiceADPItem[];
  details?: {
    drugCode?: string;
    procedureCode?: string;
    rightCode?: string;
    standardPrice?: number;
    notes?: string;
  };
  hipdata_code?: string;
  project_code?: string;
  has_anc_diag?: number;
  has_anc_adp?: number;
  has_cx_diag?: number;
  has_cx_adp?: number;
  has_fp_diag?: number;
  has_fp_adp?: number;
  has_pp_diag?: number;
  has_pp_adp?: number;
  has_preg_lab?: number;
  has_preg_item?: number;
  has_instrument?: number;
  has_herb?: number;
  has_knee_oper?: number;
  has_pal_diag?: number;
  has_pal_adp?: number;
  has_telmed?: number;
  has_drugp?: number;
  age_y?: number;
  age?: number;
  sex?: string;
  status_info?: string;
  has_authen?: number;
  has_close?: number;
  authen_code?: string;
  close_code?: string;
}

export const mockChecks: CheckRecord[] = [
  {
    id: 1,
    hn: '123456',
    vn: '2601234',
    patientName: 'นายสมชาย ใจดี',
    fund: 'UCS',
    serviceDate: '2026-03-15',
    serviceType: 'OPD',
    status: 'ready',
    issues: [],
    price: 1200,
    details: {
      drugCode: 'D001',
      procedureCode: 'P001',
      rightCode: 'R001',
      standardPrice: 1200,
      notes: 'ข้อมูลครบถ้วนตามเงื่อนไข',
    },
  },
  {
    id: 2,
    hn: '234567',
    vn: '2601235',
    patientName: 'นางสาวสายใจ รักดี',
    fund: 'SSS',
    serviceDate: '2026-03-15',
    serviceType: 'IPD',
    status: 'pending',
    issues: ['ขาดรหัสหัตถการ', 'ราคายาเกินมาตรฐาน'],
    price: 3500,
    details: {
      drugCode: 'D002',
      procedureCode: '',
      rightCode: 'R002',
      standardPrice: 3000,
      notes: 'ราคาสูงกว่ามาตรฐาน 500 บาท',
    },
  }, {
    id: 3,
    hn: '345678',
    vn: '2601236',
    patientName: 'เด็กชายภูผา กล้าหาญ',
    fund: 'UCS',
    serviceDate: '2026-03-14',
    serviceType: 'OPD',
    status: 'ready',
    issues: [],
    price: 800,
    details: {
      drugCode: 'D003',
      procedureCode: 'P003',
      rightCode: 'R001',
      standardPrice: 800,
      notes: 'ข้อมูลครบถ้วนตามเงื่อนไข',
    },
  },
  {
    id: 4,
    hn: '456789',
    patientName: 'นายมงคล สุขสันต์',
    fund: 'OFC',
    serviceDate: '2026-03-13',
    serviceType: 'IPD',
    status: 'pending',
    issues: ['ขาดรหัสสิทธิ์', 'เอกสารแนบไม่ครบ'],
    price: 5200,
    details: {
      drugCode: 'D004',
      procedureCode: 'P004',
      rightCode: '',
      standardPrice: 5000,
      notes: 'ต้องแนบเอกสารอนุมัติและรหัสสิทธิ์',
    },
  },
  {
    id: 5,
    hn: '567890',
    patientName: 'นางนิยม เรียบร้อย',
    fund: 'LGO',
    serviceDate: '2026-03-12',
    serviceType: 'OPD',
    status: 'ready',
    issues: [],
    price: 950,
    details: {
      drugCode: 'D005',
      procedureCode: 'P002',
      rightCode: 'R003',
      standardPrice: 950,
      notes: 'ผ่านการตรวจสอบแล้ว พร้อมเบิก',
    },
  },
];

// ===== KIDNEY MONITOR MOCK DATA =====
export interface KidneyMonitorRecord {
  hn: string;
  vn: string;
  patientName: string;
  insuranceType: 'UCS+SSS' | 'OFC+LGO' | 'UC-EPO';
  hipdata_code: string;
  serviceDate: string;
  dialysisFee: number;
  drugTotalSale: number;
  drugTotalCost: number;
  labTotalSale: number;
  labTotalCost: number;
  revenue: number;
  costTotal: number;
  profit: number;
  profitMargin: number;
  insuranceGroup: string;
  drugs?: Array<{
    drugName: string;
    qty: number;
    unitcost: number;
    unitprice: number;
  }>;
  labs?: Array<{
    labName: string;
    service_cost: number;
    service_pprice: number;
  }>;
}

export const mockKidneyMonitorData: KidneyMonitorRecord[] = [
  {
    hn: '601234',
    vn: '2601501',
    patientName: 'นายพิสิฐ ทำดีมา',
    insuranceType: 'UCS+SSS',
    hipdata_code: 'N185',
    serviceDate: '2026-03-15',
    dialysisFee: 800,
    drugTotalSale: 450,
    drugTotalCost: 280,
    labTotalSale: 350,
    labTotalCost: 180,
    revenue: 1500,
    costTotal: 1260,
    profit: 240,
    profitMargin: 16.0,
    insuranceGroup: 'UCS+SSS',
    drugs: [
      { drugName: 'Erythropoietin (EPO)', qty: 1, unitcost: 200, unitprice: 280 },
      { drugName: 'Heparin', qty: 1, unitcost: 40, unitprice: 90 },
      { drugName: 'Calcium Acetate', qty: 10, unitcost: 5, unitprice: 16 },
    ],
    labs: [
      { labName: 'Hemoglobin (Hgb)', service_cost: 80, service_pprice: 150 },
      { labName: 'Creatinine', service_cost: 50, service_pprice: 120 },
      { labName: 'Electrolyte Panel', service_cost: 50, service_pprice: 80 },
    ],
  },
  {
    hn: '602345',
    vn: '2601502',
    patientName: 'นางสมหญิง สุขศรัทธา',
    insuranceType: 'OFC+LGO',
    hipdata_code: 'N185',
    serviceDate: '2026-03-15',
    dialysisFee: 800,
    drugTotalSale: 520,
    drugTotalCost: 300,
    labTotalSale: 380,
    labTotalCost: 200,
    revenue: 2000,
    costTotal: 1300,
    profit: 700,
    profitMargin: 35.0,
    insuranceGroup: 'OFC+LGO',
    drugs: [
      { drugName: 'Erythropoietin (EPO)', qty: 1, unitcost: 220, unitprice: 320 },
      { drugName: 'Heparin', qty: 1, unitcost: 40, unitprice: 100 },
      { drugName: 'Sodium Bicarbonate', qty: 20, unitcost: 5, unitprice: 15 },
    ],
    labs: [
      { labName: 'Hemoglobin (Hgb)', service_cost: 100, service_pprice: 180 },
      { labName: 'Phosphate', service_cost: 60, service_pprice: 120 },
      { labName: 'Albumin', service_cost: 40, service_pprice: 80 },
    ],
  },
  {
    hn: '603456',
    vn: '2601503',
    patientName: 'นายกรวิต ยิ่งดี',
    insuranceType: 'UC-EPO',
    hipdata_code: 'N185',
    serviceDate: '2026-03-15',
    dialysisFee: 900,
    drugTotalSale: 580,
    drugTotalCost: 320,
    labTotalSale: 420,
    labTotalCost: 220,
    revenue: 1900,
    costTotal: 1440,
    profit: 460,
    profitMargin: 24.2,
    insuranceGroup: 'UC-EPO',
    drugs: [
      { drugName: 'Erythropoietin (EPO)', qty: 1, unitcost: 240, unitprice: 350 },
      { drugName: 'Heparin', qty: 1, unitcost: 50, unitprice: 110 },
      { drugName: 'Doxercalciferol', qty: 5, unitcost: 8, unitprice: 24 },
    ],
    labs: [
      { labName: 'Hemoglobin (Hgb)', service_cost: 90, service_pprice: 170 },
      { labName: 'Ferritin', service_cost: 70, service_pprice: 150 },
      { labName: 'PTH', service_cost: 60, service_pprice: 100 },
    ],
  },
  {
    hn: '604567',
    vn: '2601504',
    patientName: 'นางจำเริญ หวังดี',
    insuranceType: 'UCS+SSS',
    hipdata_code: 'N185',
    serviceDate: '2026-03-14',
    dialysisFee: 800,
    drugTotalSale: 480,
    drugTotalCost: 290,
    labTotalSale: 360,
    labTotalCost: 190,
    revenue: 1500,
    costTotal: 1280,
    profit: 220,
    profitMargin: 14.67,
    insuranceGroup: 'UCS+SSS',
    drugs: [
      { drugName: 'Erythropoietin (EPO)', qty: 1, unitcost: 210, unitprice: 290 },
      { drugName: 'Heparin', qty: 1, unitcost: 45, unitprice: 95 },
      { drugName: 'Iron Sucrose', qty: 5, unitcost: 7, unitprice: 19 },
    ],
    labs: [
      { labName: 'Hemoglobin (Hgb)', service_cost: 85, service_pprice: 160 },
      { labName: 'Potassium (K)', service_cost: 55, service_pprice: 120 },
      { labName: 'BUN', service_cost: 50, service_pprice: 80 },
    ],
  },
  {
    hn: '605678',
    vn: '2601505',
    patientName: 'นายวิเชียร ใจกว้าง',
    insuranceType: 'OFC+LGO',
    hipdata_code: 'N185',
    serviceDate: '2026-03-14',
    dialysisFee: 800,
    drugTotalSale: 510,
    drugTotalCost: 310,
    labTotalSale: 390,
    labTotalCost: 210,
    revenue: 2000,
    costTotal: 1330,
    profit: 670,
    profitMargin: 33.5,
    insuranceGroup: 'OFC+LGO',
    drugs: [
      { drugName: 'Erythropoietin (EPO)', qty: 1, unitcost: 230, unitprice: 330 },
      { drugName: 'Heparin', qty: 1, unitcost: 48, unitprice: 105 },
      { drugName: 'Folic Acid', qty: 20, unitcost: 2, unitprice: 8 },
    ],
    labs: [
      { labName: 'Hemoglobin (Hgb)', service_cost: 105, service_pprice: 190 },
      { labName: 'Calcium', service_cost: 70, service_pprice: 140 },
      { labName: 'Magnesium', service_cost: 35, service_pprice: 60 },
    ],
  },
  {
    hn: '606789',
    vn: '2601506',
    patientName: 'นางมวย อุไร',
    insuranceType: 'UC-EPO',
    hipdata_code: 'Z49',
    serviceDate: '2026-03-14',
    dialysisFee: 850,
    drugTotalSale: 560,
    drugTotalCost: 330,
    labTotalSale: 410,
    labTotalCost: 215,
    revenue: 1820,
    costTotal: 1395,
    profit: 425,
    profitMargin: 23.35,
    insuranceGroup: 'UC-EPO',
    drugs: [
      { drugName: 'Erythropoietin (EPO)', qty: 1, unitcost: 250, unitprice: 360 },
      { drugName: 'Heparin', qty: 1, unitcost: 52, unitprice: 115 },
      { drugName: 'Vitamin B Complex', qty: 10, unitcost: 3, unitprice: 12 },
    ],
    labs: [
      { labName: 'Hemoglobin (Hgb)', service_cost: 95, service_pprice: 180 },
      { labName: 'Albumin Level', service_cost: 65, service_pprice: 130 },
      { labName: 'Uric Acid', service_cost: 50, service_pprice: 100 },
    ],
  },
];
