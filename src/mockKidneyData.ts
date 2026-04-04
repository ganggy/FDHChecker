// Kidney Monitor Mock Data for Testing
export interface KidneyMonitorRecord {
  hn: string;
  vn: string;
  patientName: string;
  insuranceType: 'UCS+SSS' | 'OFC+LGO' | 'UC-EPO';
  hipdata_code: string;
  serviceDate: string;  dialysisFee: number;
  dialysisCost: number;
  otherServiceFee: number;
  otherServiceCost: number;
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
  dialysisServices?: Array<{
    serviceName: string;
    qty: number;
    service_cost: number;
    service_pprice: number;
    total_price: number;
    profit: number;
    costIsEstimated: boolean;
    isDialysis: boolean;
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
    dialysisCost: 1380,
    otherServiceFee: 0,
    otherServiceCost: 0,
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
  },  {
    hn: '602345',
    vn: '2601502',
    patientName: 'นางสมหญิง สุขศรัทธา',
    insuranceType: 'OFC+LGO',
    hipdata_code: 'N185',
    serviceDate: '2026-03-15',
    dialysisFee: 800,
    dialysisCost: 1500,
    otherServiceFee: 0,
    otherServiceCost: 0,
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
    vn: '2601503',    patientName: 'นายกรวิต ยิ่งดี',
    insuranceType: 'UC-EPO',
    hipdata_code: 'N185',
    serviceDate: '2026-03-15',
    dialysisFee: 900,
    dialysisCost: 1380,
    otherServiceFee: 0,
    otherServiceCost: 0,
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
    vn: '2601504',    patientName: 'นางจำเริญ หวังดี',
    insuranceType: 'UCS+SSS',
    hipdata_code: 'N185',
    serviceDate: '2026-03-14',
    dialysisFee: 800,
    dialysisCost: 1380,
    otherServiceFee: 0,
    otherServiceCost: 0,
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
    vn: '2601505',    patientName: 'นายวิเชียร ใจกว้าง',
    insuranceType: 'OFC+LGO',
    hipdata_code: 'N185',
    serviceDate: '2026-03-14',
    dialysisFee: 800,
    dialysisCost: 1500,
    otherServiceFee: 0,
    otherServiceCost: 0,
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
    vn: '2601506',    patientName: 'นางมวย อุไร',
    insuranceType: 'UC-EPO',
    hipdata_code: 'Z49',
    serviceDate: '2026-03-14',
    dialysisFee: 850,
    dialysisCost: 1380,
    otherServiceFee: 0,
    otherServiceCost: 0,
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
  {
    hn: '607890',
    vn: '2601507',    patientName: 'นายสาธร สมหวัง',
    insuranceType: 'UCS+SSS',
    hipdata_code: 'N185',
    serviceDate: '2026-03-13',
    dialysisFee: 800,
    dialysisCost: 1380,
    otherServiceFee: 0,
    otherServiceCost: 0,
    drugTotalSale: 470,
    drugTotalCost: 275,
    labTotalSale: 355,
    labTotalCost: 185,
    revenue: 1500,
    costTotal: 1245,
    profit: 255,
    profitMargin: 17.0,
    insuranceGroup: 'UCS+SSS',
    drugs: [
      { drugName: 'Erythropoietin (EPO)', qty: 1, unitcost: 205, unitprice: 285 },
      { drugName: 'Heparin', qty: 1, unitcost: 42, unitprice: 92 },
      { drugName: 'Vitamin D', qty: 5, unitcost: 4, unitprice: 18 },
    ],
    labs: [
      { labName: 'Hemoglobin (Hgb)', service_cost: 82, service_pprice: 155 },
      { labName: 'Glucose', service_cost: 50, service_pprice: 110 },
      { labName: 'Albumin', service_cost: 53, service_pprice: 90 },
    ],
  },
];
