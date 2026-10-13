import mysql, { Pool } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export interface PcuConfig {
  code: string;
  name: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  db: string;
}

export const PCU_CONFIGS: PcuConfig[] = [
  {
    code: '05570',
    name: 'รพ.สต.โพนค้อ',
    host: process.env.PCU_05570_HOST || '209.15.96.29',
    port: Number(process.env.PCU_05570_PORT) || 3306,
    user: process.env.PCU_05570_USER || 'root',
    pass: process.env.PCU_05570_PASSWORD || '',
    db: process.env.PCU_05570_DB || 'hospcu05570',
  },
  {
    code: '05572',
    name: 'รพ.สต.โคกนาดี',
    host: process.env.PCU_05572_HOST || '209.15.96.27',
    port: Number(process.env.PCU_05572_PORT) || 3306,
    user: process.env.PCU_05572_USER || 'root',
    pass: process.env.PCU_05572_PASSWORD || '',
    db: process.env.PCU_05572_DB || 'hospcu05572',
  },
  {
    code: '05573',
    name: 'รพ.สต.โพนทอง',
    host: process.env.PCU_05573_HOST || '209.15.96.25',
    port: Number(process.env.PCU_05573_PORT) || 3306,
    user: process.env.PCU_05573_USER || 'root',
    pass: process.env.PCU_05573_PASSWORD || '',
    db: process.env.PCU_05573_DB || 'hospcu05573',
  },
  {
    code: '05571',
    name: 'รพ.สต.ม่วงไข่',
    host: process.env.PCU_05571_HOST || '202.139.215.221',
    port: Number(process.env.PCU_05571_PORT) || 3306,
    user: process.env.PCU_05571_USER || 'root',
    pass: process.env.PCU_05571_PASSWORD || '',
    db: process.env.PCU_05571_DB || 'hospcu05571',
  },
  {
    code: '05569',
    name: 'รพ.สต.ห้วยหีบ',
    host: process.env.PCU_05569_HOST || '202.139.215.223',
    port: Number(process.env.PCU_05569_PORT) || 3306,
    user: process.env.PCU_05569_USER || 'root',
    pass: process.env.PCU_05569_PASSWORD || '',
    db: process.env.PCU_05569_DB || 'hospcu05569',
  },
];

export interface HerbalMasterItem {
  id: number;
  name: string;
  size: string;
  cost: number;
  unitCost: number;
  keywords: string[];
}

export const HERBAL_MASTER_46: HerbalMasterItem[] = [
  { id: 1, name: 'ขมิ้นชัน', size: "100's", cost: 60.00, unitCost: 0.60, keywords: ['ขมิ้นชัน'] },
  { id: 2, name: 'จันทร์ลีลา', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['จันทร์ลีลา', 'จันทลีลา'] },
  { id: 3, name: 'เถาวัลย์เปรียง', size: "100's", cost: 80.00, unitCost: 0.80, keywords: ['เถาวัลย์เปรียง', 'เถาวัลย์'] },
  { id: 4, name: 'พญายอ', size: '60ml', cost: 40.00, unitCost: 40.00, keywords: ['พญายอ', 'เสลดพังพอน(พญายอ)'] },
  { id: 5, name: 'เพชรสังฆาต แคปซูล', size: "100's", cost: 80.00, unitCost: 0.80, keywords: ['เพชรสังฆาต'] },
  { id: 6, name: 'ฟ้าทะลายโจร แคปซูล', size: "100's", cost: 60.00, unitCost: 0.60, keywords: ['ฟ้าทะลายโจร'] },
  { id: 7, name: 'มะระขี้นก', size: "100's", cost: 80.00, unitCost: 0.80, keywords: ['มะระขี้นก'] },
  { id: 8, name: 'ยาแก้ไอมะขามป้อม', size: '120 ml', cost: 18.00, unitCost: 18.00, keywords: ['มะขามป้อม'] },
  { id: 9, name: 'ยาเขียวหอม', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เขียวหอม'] },
  { id: 10, name: 'ยาชุมเห็ดเทศ', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['ชุมเห็ดเทศ'] },
  { id: 11, name: 'ยาทิงเจอร์ทองพันชั่ง', size: '60ml', cost: 40.00, unitCost: 40.00, keywords: ['ทองพันชั่ง'] },
  { id: 12, name: 'ยาธรณีสัณฆาต', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ธรณีสัณฆาต', 'ธรณีสันฑะฆาต', 'ธรณีสัณฑะฆาต'] },
  { id: 13, name: 'ยาธาตุอบเชย', size: 'ขวด', cost: 14.50, unitCost: 14.50, keywords: ['ธาตุอบเชย'] },
  { id: 14, name: 'ยาบำรุงโลหิต', size: 'ซอง', cost: 25.00, unitCost: 25.00, keywords: ['บำรุงโลหิต'] },
  { id: 15, name: 'ยาเบญจกูล', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เบญจกูล'] },
  { id: 16, name: 'ยาประคบ', size: '200g', cost: 45.00, unitCost: 45.00, keywords: ['ประคบ'] },
  { id: 17, name: 'ยาประสะไพล', size: "100's", cost: 130.00, unitCost: 1.30, keywords: ['ประสะไพล'] },
  { id: 18, name: 'ยารางจืด', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['รางจืด'] },
  { id: 19, name: 'ยาสหัสธารา', size: "100's", cost: 100.00, unitCost: 1.00, keywords: ['สหัสธารา'] },
  { id: 20, name: 'ยาหอมนวโกฐ', size: 'ซอง', cost: 30.00, unitCost: 30.00, keywords: ['หอมนวโกฐ', 'นวโกฐ'] },
  { id: 21, name: 'ยาเหลืองปิดสมุทร', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เหลืองปิดสมุทร'] },
  { id: 22, name: 'ยาอมมะแว้ง', size: "20's", cost: 85.00, unitCost: 4.25, keywords: ['มะแว้ง'] },
  { id: 23, name: 'เสลดพังพอน', size: '60ซีซี', cost: 40.00, unitCost: 40.00, keywords: ['เสลดพังพอน'] },
  { id: 24, name: 'ห้าราก', size: "100's", cost: 120.00, unitCost: 1.20, keywords: ['ห้าราก'] },
  { id: 25, name: 'โลชั่นนวดเท้า', size: 'กระปุก', cost: 50.00, unitCost: 50.00, keywords: ['นวดเท้า', 'โลชั่น'] },
  { id: 26, name: 'ยากระเจี๊ยบแดง', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['กระเจี๊ยบแดง'] },
  { id: 27, name: 'ยาแก้ลมอัมพฤกษ์', size: 'ห่อ(150G)', cost: 30.00, unitCost: 30.00, keywords: ['อัมพฤกษ์'] },
  { id: 28, name: 'ยาขิง', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['ขิง'] },
  { id: 29, name: 'ยาตรีผลา', size: "300's", cost: 300.00, unitCost: 1.00, keywords: ['ตรีผลา'] },
  { id: 30, name: 'ยาธาตุบรรจบ', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ธาตุบรรจบ'] },
  { id: 31, name: 'ยาประสะกระเพรา', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ประสะกระเพรา', 'ประสะกะเพรา'] },
  { id: 32, name: 'ยาประสะจันทร์แดง', size: "50's", cost: 150.00, unitCost: 3.00, keywords: ['ประสะจันทร์แดง', 'ประสะจันทน์แดง'] },
  { id: 33, name: 'ยาปราบชมพูทวีป', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ปราบชมพูทวีป'] },
  { id: 34, name: 'ยาปลูกไฟธาตุ', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ปลูกไฟธาตุ'] },
  { id: 35, name: 'ขี้ผึ้งสมุนไพร', size: 'ขวด', cost: 12.00, unitCost: 12.00, keywords: ['ขี้ผึ้งสมุนไพร', 'ขี้ผึ้ง'] },
  { id: 36, name: 'ยาไฟประลัยกัลป์', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ไฟประลัยกัลป์'] },
  { id: 37, name: 'ยาไฟห้ากอง', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ไฟห้ากอง'] },
  { id: 38, name: 'ยามะขามแขก', size: "100's", cost: 75.00, unitCost: 0.75, keywords: ['มะขามแขก'] },
  { id: 39, name: 'ยาเลือดงาม', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เลือดงาม'] },
  { id: 40, name: 'ชาชงหญ้าดอกขาว', size: 'ซอง', cost: 30.00, unitCost: 30.00, keywords: ['หญ้าดอกขาว'] },
  { id: 41, name: 'ยาหญ้าหนวดแมว', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['หญ้าหนวดแมว'] },
  { id: 42, name: 'ยาหอมอินทจักร์', size: 'ซอง', cost: 50.00, unitCost: 50.00, keywords: ['อินทจักร์', 'อินทจักร'] },
  { id: 43, name: 'ยาอำมฤควาที', size: '15 g (ซอง)', cost: 30.00, unitCost: 30.00, keywords: ['อำมฤควาที', 'อัมฤควาที'] },
  { id: 44, name: 'ยาแก้ลมแก้เส้น', size: "100's", cost: 350.00, unitCost: 3.50, keywords: ['แก้ลมแก้เส้น'] },
  { id: 45, name: 'ยาศุขไสยาสน์', size: "100's", cost: 350.00, unitCost: 3.50, keywords: ['ศุขไสยาสน์', 'สุขไสยาสน์'] },
  { id: 46, name: 'ครีมไพล', size: '35 g', cost: 35.00, unitCost: 35.00, keywords: ['ครีมไพล', 'cream pli'] },
];

const poolCache = new Map<string, Pool>();

export function getPcuPool(pcu: PcuConfig): Pool {
  if (!poolCache.has(pcu.code)) {
    const pool = mysql.createPool({
      host: pcu.host,
      port: pcu.port,
      user: pcu.user,
      password: pcu.pass,
      database: pcu.db,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 5000,
    });
    poolCache.set(pcu.code, pool);
  }
  return poolCache.get(pcu.code)!;
}

export async function getHospitalConnection() {
  return await mysql.createConnection({
    host: process.env.HOSXP_HOST || '127.0.0.1',
    port: Number(process.env.HOSXP_PORT) || 3306,
    user: process.env.HOSXP_USER || 'sa',
    password: process.env.HOSXP_PASSWORD || '',
    database: process.env.HOSXP_DB || 'hosxp',
    connectTimeout: 5000
  });
}

export interface PcuHerbalSummary {
  pcu_code: string;
  pcu_name: string;
  host_ip: string;
  is_online: boolean;
  total_dispense_count: number;
  total_dispensed_qty: number;
  total_drug_cost: number;
  total_charge_amt: number;
  hsub_claim_amt: number;
  hsub_hc_drug: number;
  hsub_total_paid: number;
  gross_profit: number;
  payable_profit: number;
  margin_percentage: number;
  item_breakdown: Array<{
    herbal_id: number;
    herbal_name: string;
    size: string;
    cost_price: number;
    dispense_count: number;
    dispensed_qty: number;
    total_cost: number;
    total_charge: number;
  }>;
}

export async function getPcuHerbalReconciliation(options: {
  hcode?: string;
  startDate?: string;
  endDate?: string;
} = {}) {
  const { hcode, startDate = '2025-10-01', endDate = '2026-10-31' } = options;

  const targetPcus = hcode && hcode !== 'all'
    ? PCU_CONFIGS.filter(p => p.code === hcode)
    : PCU_CONFIGS;

  // 1. Fetch H-Sub amounts from hospital database
  const hospConn = await getHospitalConnection();
  const hsubDataMap = new Map<string, { claim: number; hc_drug: number; total_paid: number; count: number }>();
  try {
    const [hsubRows]: any = await hospConn.query(
      `SELECT 
        hcode, 
        COUNT(*) as cnt,
        SUM(COALESCE(claim_amt, 0)) as total_claim,
        SUM(COALESCE(hc_drug, 0)) as total_hc_drug,
        SUM(COALESCE(total_paid, 0)) as total_paid
      FROM hsub_payment_item
      WHERE (? IS NULL OR service_date >= ?)
        AND (? IS NULL OR service_date <= ?)
      GROUP BY hcode`,
      [startDate, startDate, endDate + ' 23:59:59', endDate + ' 23:59:59']
    );
    for (const r of hsubRows) {
      hsubDataMap.set(String(r.hcode), {
        claim: Number(r.total_claim || 0),
        hc_drug: Number(r.total_hc_drug || 0),
        total_paid: Number(r.total_paid || 0),
        count: Number(r.cnt || 0),
      });
    }
  } catch (err) {
    console.warn('[PcuHerbal] Failed to query hsub_payment_item:', err);
  } finally {
    await hospConn.end();
  }

  // 2. Query each PCU for herbal dispensing
  const results: PcuHerbalSummary[] = [];

  for (const pcu of targetPcus) {
    let isOnline = false;
    let dispenseRows: any[] = [];
    try {
      const pool = getPcuPool(pcu);

      // Query drug dispensing matched with herbal items
      // Match drugitems name with keywords
      const [rows]: any = await pool.query(
        `SELECT 
          o.icode, d.name as drug_name, d.units,
          COUNT(DISTINCT o.vn) as visit_count,
          SUM(o.qty) as total_qty,
          SUM(o.sum_price) as total_charge
        FROM opitemrece o
        JOIN drugitems d ON o.icode = d.icode
        WHERE o.vstdate >= ? AND o.vstdate <= ?
          AND (
            d.name LIKE '%ขมิ้น%' OR d.name LIKE '%ฟ้าทะลาย%' OR d.name LIKE '%เถาวัลย์%' OR 
            d.name LIKE '%ไพล%' OR d.name LIKE '%เพชรสังฆาต%' OR d.name LIKE '%มะระขี้นก%' OR 
            d.name LIKE '%มะขามป้อม%' OR d.name LIKE '%เขียวหอม%' OR d.name LIKE '%ชุมเห็ดเทศ%' OR 
            d.name LIKE '%ทองพันชั่ง%' OR d.name LIKE '%ธรณีสัณฆาต%' OR d.name LIKE '%ธรณีสัณฑะฆาต%' OR 
            d.name LIKE '%ธาตุอบเชย%' OR d.name LIKE '%บำรุงโลหิต%' OR d.name LIKE '%เบญจกูล%' OR 
            d.name LIKE '%ประคบ%' OR d.name LIKE '%รางจืด%' OR d.name LIKE '%สหัสธารา%' OR 
            d.name LIKE '%นวโกฐ%' OR d.name LIKE '%เหลืองปิดสมุทร%' OR d.name LIKE '%มะแว้ง%' OR 
            d.name LIKE '%เสลดพังพอน%' OR d.name LIKE '%ห้าราก%' OR d.name LIKE '%กระเจี๊ยบ%' OR 
            d.name LIKE '%ตรีผลา%' OR d.name LIKE '%ธาตุบรรจบ%' OR d.name LIKE '%จันทร์ลีลา%' OR
            d.name LIKE '%ปราบชมพูทวีป%' OR d.name LIKE '%มะขามแขก%' OR d.name LIKE '%หญ้าดอกขาว%' OR
            d.name LIKE '%หญ้าหนวดแมว%' OR d.name LIKE '%อินทจักร์%' OR d.name LIKE '%อำมฤควาที%' OR
            d.name LIKE '%ศุขไสยาสน์%' OR d.name LIKE '%แก้ลมแก้เส้น%' OR d.name LIKE '%ขี้ผึ้ง%'
          )
        GROUP BY o.icode, d.name, d.units`,
        [startDate, endDate]
      );
      dispenseRows = rows;
      isOnline = true;
    } catch (err: any) {
      console.error(`[PcuHerbal] Error querying PCU ${pcu.code}:`, err.message);
      isOnline = false;
    }

    // Map rows to 46 Master items
    const itemMap = new Map<number, {
      herbal_id: number;
      herbal_name: string;
      size: string;
      cost_price: number;
      dispense_count: number;
      dispensed_qty: number;
      total_cost: number;
      total_charge: number;
    }>();

    for (const master of HERBAL_MASTER_46) {
      itemMap.set(master.id, {
        herbal_id: master.id,
        herbal_name: master.name,
        size: master.size,
        cost_price: master.cost,
        dispense_count: 0,
        dispensed_qty: 0,
        total_cost: 0,
        total_charge: 0,
      });
    }

    let totalDispenseCount = 0;
    let totalDispensedQty = 0;
    let totalDrugCost = 0;
    let totalChargeAmt = 0;

    for (const row of dispenseRows) {
      const drugName = String(row.drug_name || '').toLowerCase();
      // Find matching master item
      const master = HERBAL_MASTER_46.find(m => {
        return m.keywords.some(kw => drugName.includes(kw.toLowerCase()));
      });

      if (master) {
        const item = itemMap.get(master.id)!;
        const qty = Number(row.total_qty || 0);
        const charge = Number(row.total_charge || 0);
        const cost = qty * master.unitCost;

        item.dispense_count += Number(row.visit_count || 0);
        item.dispensed_qty += qty;
        item.total_cost += cost;
        item.total_charge += charge;

        totalDispenseCount += Number(row.visit_count || 0);
        totalDispensedQty += qty;
        totalDrugCost += cost;
        totalChargeAmt += charge;
      }
    }

    const hsub = hsubDataMap.get(pcu.code) || { claim: 0, hc_drug: 0, total_paid: 0, count: 0 };
    const grossProfit = Math.max(0, hsub.total_paid - totalDrugCost);
    const payableProfit = grossProfit; // Default payable is the profit portion
    const marginPct = hsub.total_paid > 0 ? (grossProfit / hsub.total_paid) * 100 : 0;

    results.push({
      pcu_code: pcu.code,
      pcu_name: pcu.name,
      host_ip: pcu.host,
      is_online: isOnline,
      total_dispense_count: totalDispenseCount,
      total_dispensed_qty: totalDispensedQty,
      total_drug_cost: Math.round(totalDrugCost * 100) / 100,
      total_charge_amt: Math.round(totalChargeAmt * 100) / 100,
      hsub_claim_amt: hsub.claim,
      hsub_hc_drug: hsub.hc_drug,
      hsub_total_paid: hsub.total_paid,
      gross_profit: Math.round(grossProfit * 100) / 100,
      payable_profit: Math.round(payableProfit * 100) / 100,
      margin_percentage: Math.round(marginPct * 10) / 10,
      item_breakdown: Array.from(itemMap.values()),
    });
  }

  // Calculate grand totals across all PCUs
  const grandTotal = {
    total_dispense_count: results.reduce((acc, r) => acc + r.total_dispense_count, 0),
    total_dispensed_qty: results.reduce((acc, r) => acc + r.total_dispensed_qty, 0),
    total_drug_cost: Math.round(results.reduce((acc, r) => acc + r.total_drug_cost, 0) * 100) / 100,
    total_charge_amt: Math.round(results.reduce((acc, r) => acc + r.total_charge_amt, 0) * 100) / 100,
    hsub_claim_amt: Math.round(results.reduce((acc, r) => acc + r.hsub_claim_amt, 0) * 100) / 100,
    hsub_hc_drug: Math.round(results.reduce((acc, r) => acc + r.hsub_hc_drug, 0) * 100) / 100,
    hsub_total_paid: Math.round(results.reduce((acc, r) => acc + r.hsub_total_paid, 0) * 100) / 100,
    gross_profit: Math.round(results.reduce((acc, r) => acc + r.gross_profit, 0) * 100) / 100,
    payable_profit: Math.round(results.reduce((acc, r) => acc + r.payable_profit, 0) * 100) / 100,
  };

  return {
    period: { startDate, endDate },
    grand_total: grandTotal,
    pcus: results,
    master_items: HERBAL_MASTER_46,
  };
}

export async function getPcuHerbalDrillDown(options: {
  hcode: string;
  herbalId?: number;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const {
    hcode,
    herbalId,
    startDate = '2025-10-01',
    endDate = '2026-10-31',
    search = '',
    page = 1,
    limit = 50,
  } = options;

  const pcu = PCU_CONFIGS.find(p => p.code === hcode);
  if (!pcu) throw new Error(`ไม่พบข้อมูล รพ.สต. รหัส ${hcode}`);

  const pool = getPcuPool(pcu);
  const offset = (page - 1) * limit;

  let keywordFilters: string[] = [];
  if (herbalId) {
    const master = HERBAL_MASTER_46.find(m => m.id === herbalId);
    if (master) {
      keywordFilters = master.keywords;
    }
  }

  const whereClauses: string[] = [
    'o.vstdate >= ?',
    'o.vstdate <= ?'
  ];
  const queryParams: any[] = [startDate, endDate];

  if (keywordFilters.length > 0) {
    const kwSql = keywordFilters.map(() => 'd.name LIKE ?').join(' OR ');
    whereClauses.push(`(${kwSql})`);
    queryParams.push(...keywordFilters.map(kw => `%${kw}%`));
  } else {
    // General herbal filter
    whereClauses.push(`(
      d.name LIKE '%ขมิ้น%' OR d.name LIKE '%ฟ้าทะลาย%' OR d.name LIKE '%เถาวัลย์%' OR 
      d.name LIKE '%ไพล%' OR d.name LIKE '%เพชรสังฆาต%' OR d.name LIKE '%มะระขี้นก%' OR 
      d.name LIKE '%มะขามป้อม%' OR d.name LIKE '%เขียวหอม%' OR d.name LIKE '%ชุมเห็ดเทศ%' OR 
      d.name LIKE '%ทองพันชั่ง%' OR d.name LIKE '%ธรณีสัณฆาต%' OR d.name LIKE '%ธาตุอบเชย%' OR 
      d.name LIKE '%บำรุงโลหิต%' OR d.name LIKE '%เบญจกูล%' OR d.name LIKE '%ประคบ%' OR 
      d.name LIKE '%รางจืด%' OR d.name LIKE '%สหัสธารา%' OR d.name LIKE '%นวโกฐ%' OR 
      d.name LIKE '%เหลืองปิดสมุทร%' OR d.name LIKE '%มะแว้ง%' OR d.name LIKE '%เสลดพังพอน%' OR 
      d.name LIKE '%ห้าราก%' OR d.name LIKE '%กระเจี๊ยบ%' OR d.name LIKE '%ตรีผลา%' OR 
      d.name LIKE '%ธาตุบรรจบ%' OR d.name LIKE '%จันทร์ลีลา%' OR d.name LIKE '%ปราบชมพูทวีป%' OR 
      d.name LIKE '%มะขามแขก%' OR d.name LIKE '%หญ้าดอกขาว%' OR d.name LIKE '%หญ้าหนวดแมว%' OR 
      d.name LIKE '%อินทจักร์%' OR d.name LIKE '%อำมฤควาที%' OR d.name LIKE '%ศุขไสยาสน์%' OR 
      d.name LIKE '%แก้ลมแก้เส้น%' OR d.name LIKE '%ขี้ผึ้ง%'
    )`);
  }

  if (search.trim()) {
    whereClauses.push('(o.hn LIKE ? OR o.vn LIKE ? OR pt.fname LIKE ? OR pt.lname LIKE ?)');
    const sTerm = `%${search.trim()}%`;
    queryParams.push(sTerm, sTerm, sTerm, sTerm);
  }

  const whereSql = whereClauses.join(' AND ');

  // Total count
  const [countRes]: any = await pool.query(
    `SELECT COUNT(*) as total
     FROM opitemrece o
     JOIN drugitems d ON o.icode = d.icode
     LEFT JOIN patient pt ON o.hn = pt.hn
     WHERE ${whereSql}`,
    queryParams
  );
  const total = Number(countRes[0]?.total || 0);

  // Paginated rows
  const [rows]: any = await pool.query(
    `SELECT 
      o.vn, o.hn, 
      DATE_FORMAT(o.vstdate, '%Y-%m-%d') as vstdate,
      CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patient_name,
      o.icode, d.name as drug_name, d.units,
      o.qty, o.unitprice, o.sum_price
     FROM opitemrece o
     JOIN drugitems d ON o.icode = d.icode
     LEFT JOIN patient pt ON o.hn = pt.hn
     WHERE ${whereSql}
     ORDER BY o.vstdate DESC, o.vn DESC
     LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset]
  );

  // Calculate unit cost based on 46 master table
  const mappedRows = rows.map((r: any) => {
    const dName = String(r.drug_name || '').toLowerCase();
    const master = HERBAL_MASTER_46.find(m => m.keywords.some(kw => dName.includes(kw.toLowerCase())));
    const unitCost = master ? master.unitCost : 0;
    const totalCost = Math.round((Number(r.qty || 0) * unitCost) * 100) / 100;
    const charge = Number(r.sum_price || 0);

    return {
      vn: r.vn,
      hn: r.hn,
      vstdate: r.vstdate,
      patient_name: r.patient_name?.trim() || 'ไม่ระบุชื่อ',
      icode: r.icode,
      drug_name: r.drug_name,
      units: r.units,
      qty: Number(r.qty || 0),
      unit_price: Number(r.unitprice || 0),
      sum_price: charge,
      herbal_master_name: master?.name || r.drug_name,
      herbal_size: master?.size || '-',
      unit_cost: unitCost,
      total_cost: totalCost,
      margin: Math.round((charge - totalCost) * 100) / 100,
    };
  });

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    items: mappedRows,
  };
}
