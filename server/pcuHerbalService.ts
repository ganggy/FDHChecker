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

export interface PcuConfig {
  code: string;
  name: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  db: string;
  vpnNote?: string;
}

export const DEFAULT_PCU_CONFIGS: PcuConfig[] = [
  {
    code: '05570',
    name: 'รพ.สต.โพนค้อ',
    host: process.env.PCU_05570_HOST || '209.15.96.29',
    port: Number(process.env.PCU_05570_PORT) || 3306,
    user: process.env.PCU_05570_USER || 'root',
    pass: process.env.PCU_05570_PASSWORD || 'XMQ5s%wJ#m',
    db: process.env.PCU_05570_DB || 'hospcu05570',
    vpnNote: 'GDCC VPN pho4701.health',
  },
  {
    code: '05572',
    name: 'รพ.สต.โคกนาดี',
    host: process.env.PCU_05572_HOST || '209.15.96.27',
    port: Number(process.env.PCU_05572_PORT) || 3306,
    user: process.env.PCU_05572_USER || 'root',
    pass: process.env.PCU_05572_PASSWORD || 'L&wFK5?V#m',
    db: process.env.PCU_05572_DB || 'hospcu05572',
    vpnNote: 'GDCC VPN pho4701.health',
  },
  {
    code: '05573',
    name: 'รพ.สต.โพนทอง',
    host: process.env.PCU_05573_HOST || '209.15.96.25',
    port: Number(process.env.PCU_05573_PORT) || 3306,
    user: process.env.PCU_05573_USER || 'root',
    pass: process.env.PCU_05573_PASSWORD || 'H$Tt8X#5#m',
    db: process.env.PCU_05573_DB || 'hospcu05573',
    vpnNote: 'GDCC VPN pho4701.health',
  },
  {
    code: '05571',
    name: 'รพ.สต.ม่วงไข่',
    host: process.env.PCU_05571_HOST || '202.139.215.221',
    port: Number(process.env.PCU_05571_PORT) || 3306,
    user: process.env.PCU_05571_USER || 'root',
    pass: process.env.PCU_05571_PASSWORD || 'G7T?&qzV#m',
    db: process.env.PCU_05571_DB || 'hospcu05571',
    vpnNote: 'GDCC VPN pho4701.health',
  },
  {
    code: '05569',
    name: 'รพ.สต.ห้วยหีบ',
    host: process.env.PCU_05569_HOST || '202.139.215.223',
    port: Number(process.env.PCU_05569_PORT) || 3306,
    user: process.env.PCU_05569_USER || 'root',
    pass: process.env.PCU_05569_PASSWORD || 'gHY+M9?5#m',
    db: process.env.PCU_05569_DB || 'hospcu05569',
    vpnNote: 'GDCC VPN pho4701.health',
  },
];

export const PCU_CONFIG_SETTING_KEY = 'pcu_herbal_connections_config';

export async function getActivePcuConfigs(): Promise<PcuConfig[]> {
  try {
    const { getAppSetting } = await import('./repositories/system.repository.js');
    const saved = await getAppSetting<PcuConfig[]>(PCU_CONFIG_SETTING_KEY);
    if (saved && Array.isArray(saved) && saved.length > 0) {
      return DEFAULT_PCU_CONFIGS.map(def => {
        const found = saved.find(s => s.code === def.code);
        if (!found) return def;
        return {
          code: def.code,
          name: found.name || def.name,
          host: found.host || def.host,
          port: Number(found.port) || def.port,
          user: found.user || def.user,
          pass: found.pass !== undefined && found.pass !== '' ? found.pass : def.pass,
          db: found.db || def.db,
          vpnNote: found.vpnNote || def.vpnNote,
        };
      });
    }
  } catch (err) {
    console.warn('[PcuHerbal] Failed to read pcu config from app_settings, falling back to defaults:', err);
  }
  return DEFAULT_PCU_CONFIGS;
}

export async function savePcuConfigs(configs: PcuConfig[]): Promise<void> {
  const { setAppSetting } = await import('./repositories/system.repository.js');
  await setAppSetting(PCU_CONFIG_SETTING_KEY, configs);
  resetPcuPools();
}

export const PCU_CONFIGS = DEFAULT_PCU_CONFIGS;

export interface HerbalMasterItem {
  id: number;
  name: string;
  size: string;
  cost: number;
  unitCost: number;
  keywords: string[];
  category: 'herbal' | 'iron_folic';
  monthlyRateNote?: string;
}

export const TRIFERDINE_REIMBURSEMENT_BY_PCU: Record<string, number> = {
  '05569': 45760.00,
  '05571': 27040.00,
  '05572': 195920.00,
  '05573': 21360.00,
  '05570': 0.00,
};

export const TRIFERDINE_MONTHLY_PRICES = [
  { month: '2026-09', monthTh: 'ก.ย. 69', price: 38.52, unitPrice: 38.52 / 30 },
  { month: '2026-08', monthTh: 'ส.ค. 69', price: 38.52, unitPrice: 38.52 / 30 },
  { month: '2026-07', monthTh: 'ก.ค. 69', price: 38.52, unitPrice: 38.52 / 30 },
  { month: '2026-06', monthTh: 'มิ.ย. 69', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2026-05', monthTh: 'พ.ค. 69', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2026-04', monthTh: 'เม.ย. 69', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2026-03', monthTh: 'มี.ค. 69', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2026-02', monthTh: 'ก.พ. 69', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2026-01', monthTh: 'ม.ค. 69', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2025-12', monthTh: 'ธ.ค. 68', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2025-11', monthTh: 'พ.ย. 68', price: 26.75, unitPrice: 26.75 / 30 },
  { month: '2025-10', monthTh: 'ต.ค. 68', price: 26.75, unitPrice: 26.75 / 30 },
];

export function getTriferdinePriceForDate(vstdate: string): { boxPrice: number; unitPrice: number } {
  const d = (vstdate || '').slice(0, 10);
  if (d >= '2026-07-01') {
    return { boxPrice: 38.52, unitPrice: 38.52 / 30 };
  }
  return { boxPrice: 26.75, unitPrice: 26.75 / 30 };
}

export const FOLIC_CONFIG = {
  unitCost: 0.12,
  courseQty: 52,
  courseReimbursement: 80.00,
};

export const ALL_DRUG_MASTER: HerbalMasterItem[] = [
  { id: 1, name: 'ขมิ้นชัน', size: "100's", cost: 60.00, unitCost: 0.60, keywords: ['ขมิ้นชัน'], category: 'herbal' },
  { id: 2, name: 'จันทร์ลีลา', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['จันทร์ลีลา', 'จันทลีลา'], category: 'herbal' },
  { id: 3, name: 'เถาวัลย์เปรียง', size: "100's", cost: 80.00, unitCost: 0.80, keywords: ['เถาวัลย์เปรียง', 'เถาวัลย์'], category: 'herbal' },
  { id: 4, name: 'พญายอ', size: '60ml', cost: 40.00, unitCost: 40.00, keywords: ['พญายอ', 'เสลดพังพอน(พญายอ)'], category: 'herbal' },
  { id: 5, name: 'เพชรสังฆาต แคปซูล', size: "100's", cost: 80.00, unitCost: 0.80, keywords: ['เพชรสังฆาต'], category: 'herbal' },
  { id: 6, name: 'ฟ้าทะลายโจร แคปซูล', size: "100's", cost: 60.00, unitCost: 0.60, keywords: ['ฟ้าทะลายโจร'], category: 'herbal' },
  { id: 7, name: 'มะระขี้นก', size: "100's", cost: 80.00, unitCost: 0.80, keywords: ['มะระขี้นก'], category: 'herbal' },
  { id: 8, name: 'ยาแก้ไอมะขามป้อม', size: '120 ml', cost: 18.00, unitCost: 18.00, keywords: ['มะขามป้อม'], category: 'herbal' },
  { id: 9, name: 'ยาเขียวหอม', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เขียวหอม'], category: 'herbal' },
  { id: 10, name: 'ยาชุมเห็ดเทศ', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['ชุมเห็ดเทศ'], category: 'herbal' },
  { id: 11, name: 'ยาทิงเจอร์ทองพันชั่ง', size: '60ml', cost: 40.00, unitCost: 40.00, keywords: ['ทองพันชั่ง'], category: 'herbal' },
  { id: 12, name: 'ยาธรณีสัณฆาต', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ธรณีสัณฆาต', 'ธรณีสันฑะฆาต', 'ธรณีสัณฑะฆาต'], category: 'herbal' },
  { id: 13, name: 'ยาธาตุอบเชย', size: 'ขวด', cost: 14.50, unitCost: 14.50, keywords: ['ธาตุอบเชย'], category: 'herbal' },
  { id: 14, name: 'ยาบำรุงโลหิต', size: 'ซอง', cost: 25.00, unitCost: 25.00, keywords: ['บำรุงโลหิต'], category: 'herbal' },
  { id: 15, name: 'ยาเบญจกูล', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เบญจกูล'], category: 'herbal' },
  { id: 16, name: 'ยาประคบ', size: '200g', cost: 45.00, unitCost: 45.00, keywords: ['ประคบ'], category: 'herbal' },
  { id: 17, name: 'ยาประสะไพล', size: "100's", cost: 130.00, unitCost: 1.30, keywords: ['ประสะไพล'], category: 'herbal' },
  { id: 18, name: 'ยารางจืด', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['รางจืด'], category: 'herbal' },
  { id: 19, name: 'ยาสหัสธารา', size: "100's", cost: 100.00, unitCost: 1.00, keywords: ['สหัสธารา'], category: 'herbal' },
  { id: 20, name: 'ยาหอมนวโกฐ', size: 'ซอง', cost: 30.00, unitCost: 30.00, keywords: ['หอมนวโกฐ', 'นวโกฐ'], category: 'herbal' },
  { id: 21, name: 'ยาเหลืองปิดสมุทร', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เหลืองปิดสมุทร'], category: 'herbal' },
  { id: 22, name: 'ยาอมมะแว้ง', size: "20's", cost: 85.00, unitCost: 4.25, keywords: ['มะแว้ง'], category: 'herbal' },
  { id: 23, name: 'เสลดพังพอน', size: '60ซีซี', cost: 40.00, unitCost: 40.00, keywords: ['เสลดพังพอน'], category: 'herbal' },
  { id: 24, name: 'ห้าราก', size: "100's", cost: 120.00, unitCost: 1.20, keywords: ['ห้าราก'], category: 'herbal' },
  { id: 25, name: 'โลชั่นนวดเท้า', size: 'กระปุก', cost: 50.00, unitCost: 50.00, keywords: ['นวดเท้า', 'โลชั่น'], category: 'herbal' },
  { id: 26, name: 'ยากระเจี๊ยบแดง', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['กระเจี๊ยบแดง'], category: 'herbal' },
  { id: 27, name: 'ยาแก้ลมอัมพฤกษ์', size: 'ห่อ(150G)', cost: 30.00, unitCost: 30.00, keywords: ['อัมพฤกษ์'], category: 'herbal' },
  { id: 28, name: 'ยาขิง', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['ขิง'], category: 'herbal' },
  { id: 29, name: 'ยาตรีผลา', size: "300's", cost: 300.00, unitCost: 1.00, keywords: ['ตรีผลา'], category: 'herbal' },
  { id: 30, name: 'ยาธาตุบรรจบ', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ธาตุบรรจบ'], category: 'herbal' },
  { id: 31, name: 'ยาประสะกระเพรา', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ประสะกระเพรา', 'ประสะกะเพรา'], category: 'herbal' },
  { id: 32, name: 'ยาประสะจันทร์แดง', size: "50's", cost: 150.00, unitCost: 3.00, keywords: ['ประสะจันทร์แดง', 'ประสะจันทน์แดง'], category: 'herbal' },
  { id: 33, name: 'ยาปราบชมพูทวีป', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ปราบชมพูทวีป'], category: 'herbal' },
  { id: 34, name: 'ยาปลูกไฟธาตุ', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ปลูกไฟธาตุ'], category: 'herbal' },
  { id: 35, name: 'ขี้ผึ้งสมุนไพร', size: 'ขวด', cost: 12.00, unitCost: 12.00, keywords: ['ขี้ผึ้งสมุนไพร', 'ขี้ผึ้ง'], category: 'herbal' },
  { id: 36, name: 'ยาไฟประลัยกัลป์', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ไฟประลัยกัลป์'], category: 'herbal' },
  { id: 37, name: 'ยาไฟห้ากอง', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['ไฟห้ากอง'], category: 'herbal' },
  { id: 38, name: 'ยามะขามแขก', size: "100's", cost: 75.00, unitCost: 0.75, keywords: ['มะขามแขก'], category: 'herbal' },
  { id: 39, name: 'ยาเลือดงาม', size: "100's", cost: 150.00, unitCost: 1.50, keywords: ['เลือดงาม'], category: 'herbal' },
  { id: 40, name: 'ชาชงหญ้าดอกขาว', size: 'ซอง', cost: 30.00, unitCost: 30.00, keywords: ['หญ้าดอกขาว'], category: 'herbal' },
  { id: 41, name: 'ยาหญ้าหนวดแมว', size: 'pack(15ซอง)', cost: 40.00, unitCost: 40.00, keywords: ['หญ้าหนวดแมว'], category: 'herbal' },
  { id: 42, name: 'ยาหอมอินทจักร์', size: 'ซอง', cost: 50.00, unitCost: 50.00, keywords: ['อินทจักร์', 'อินทจักร'], category: 'herbal' },
  { id: 43, name: 'ยาอำมฤควาที', size: '15 g (ซอง)', cost: 30.00, unitCost: 30.00, keywords: ['อำมฤควาที', 'อัมฤควาที'], category: 'herbal' },
  { id: 44, name: 'ยาแก้ลมแก้เส้น', size: "100's", cost: 350.00, unitCost: 3.50, keywords: ['แก้ลมแก้เส้น'], category: 'herbal' },
  { id: 45, name: 'ยาศุขไสยาสน์', size: "100's", cost: 350.00, unitCost: 3.50, keywords: ['ศุขไสยาสน์', 'สุขไสยาสน์'], category: 'herbal' },
  { id: 46, name: 'ครีมไพล', size: '35 g', cost: 35.00, unitCost: 35.00, keywords: ['ครีมไพล', 'cream pli'], category: 'herbal' },
  {
    id: 47,
    name: 'Triferdine 150 mg (TRIferdine)',
    size: "30's",
    cost: 26.75,
    unitCost: 26.75 / 30,
    keywords: ['trifer', 'triferdine', 'triferdin', 'ไตรเฟอร์'],
    category: 'iron_folic',
    monthlyRateNote: 'ต.ค.68-มิ.ย.69 = 26.75฿/30s | ก.ค.69-ก.ย.69 = 38.52฿/30s (ชดเชยคงที่ 5 รพ.สต.)',
  },
  {
    id: 48,
    name: 'Folic Acid (folic 5 mg)',
    size: '52 เม็ด/คอร์ส',
    cost: 6.24,
    unitCost: 0.12,
    keywords: ['folic', 'โฟลิก'],
    category: 'iron_folic',
    monthlyRateNote: 'ต้นทุน 0.12฿/เม็ด | 1 คอร์ส (52 เม็ด) ชดเชย 80.00฿',
  },
];

export const HERBAL_MASTER_46 = ALL_DRUG_MASTER.filter(m => m.category === 'herbal');
export const IRON_FOLIC_MASTER = ALL_DRUG_MASTER.filter(m => m.category === 'iron_folic');

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

export function resetPcuPools(): void {
  for (const pool of poolCache.values()) {
    pool.end().catch(() => undefined);
  }
  poolCache.clear();
}

export async function testSinglePcuConnection(pcu: PcuConfig): Promise<{
  code: string;
  name: string;
  host: string;
  port: number;
  db: string;
  user: string;
  connected: boolean;
  latencyMs: number;
  error?: string;
  diagnostics: string;
}> {
  const startTime = Date.now();
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: pcu.host,
      port: Number(pcu.port) || 3306,
      user: pcu.user || 'root',
      password: pcu.pass || '',
      database: pcu.db || `hospcu${pcu.code}`,
      connectTimeout: 5000,
    });
    const [rows]: any = await conn.query('SELECT 1 as ok, DATABASE() as db, VERSION() as ver');
    const latencyMs = Date.now() - startTime;
    return {
      code: pcu.code,
      name: pcu.name,
      host: pcu.host,
      port: Number(pcu.port) || 3306,
      db: pcu.db,
      user: pcu.user,
      connected: Boolean(rows?.[0]?.ok),
      latencyMs,
      diagnostics: `เชื่อมต่อสำเร็จ (${latencyMs}ms, MySQL ${rows?.[0]?.ver || ''})`,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    let diag = 'ไม่สามารถเชื่อมต่อได้: ' + (err.message || 'Unknown error');
    if (err.code === 'ETIMEDOUT' || err.message?.includes('ETIMEDOUT') || err.message?.includes('timeout')) {
      diag = `ไม่สามารถเชื่อมต่อไปยัง IP ${pcu.host}:${pcu.port} ได้ภายในกำหนด (Timeout) — กรุณาตรวจสอบว่าเซิร์ฟเวอร์ต่อ VPN GDCC (pho4701.health) หรืออยู่ในวงเครือข่าย GDCC หรือไม่`;
    } else if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      diag = `การเชื่อมต่อถูกปฏิเสธ (Connection Refused) — ปลายทางปิดพอร์ต ${pcu.port} หรือ MySQL ไม่ได้เปิด bind-address รับ IP ภายนอก`;
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.errno === 1045 || err.message?.includes('Access denied')) {
      diag = `รหัสผ่านหรือ Username ของ MySQL ไม่ถูกต้อง (Access Denied for user '${pcu.user}')`;
    } else if (err.code === 'ER_BAD_DB_ERROR' || err.errno === 1049 || err.message?.includes('Unknown database')) {
      diag = `ไม่พบชื่อฐานข้อมูล '${pcu.db}' บนเซิร์ฟเวอร์ปลายทาง`;
    } else if (err.code === 'ENOTFOUND') {
      diag = `ไม่พบ Host / IP '${pcu.host}' ในระบบเครือข่าย`;
    }

    return {
      code: pcu.code,
      name: pcu.name,
      host: pcu.host,
      port: Number(pcu.port) || 3306,
      db: pcu.db,
      user: pcu.user,
      connected: false,
      latencyMs,
      error: err.message,
      diagnostics: diag,
    };
  } finally {
    if (conn) {
      await conn.end().catch(() => undefined);
    }
  }
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
  triferdine_reimbursed?: number;
  folic_reimbursed?: number;
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
    category?: string;
  }>;
}

export async function getPcuHerbalReconciliation(options: {
  hcode?: string;
  startDate?: string;
  endDate?: string;
  category?: 'all' | 'herbal' | 'iron_folic';
} = {}) {
  const { hcode, startDate = '2025-10-01', endDate = '2026-10-31', category = 'all' } = options;

  const allPcus = await getActivePcuConfigs();
  const targetPcus = hcode && hcode !== 'all'
    ? allPcus.filter(p => p.code === hcode)
    : allPcus;

  const targetMasterList = category === 'herbal'
    ? HERBAL_MASTER_46
    : category === 'iron_folic'
      ? IRON_FOLIC_MASTER
      : ALL_DRUG_MASTER;

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

  // 2. Query each PCU for herbal & supplement dispensing
  const results: PcuHerbalSummary[] = [];

  for (const pcu of targetPcus) {
    let isOnline = false;
    let dispenseRows: any[] = [];
    try {
      const pool = getPcuPool(pcu);

      const [rows]: any = await pool.query(
        `SELECT 
          o.icode, d.name as drug_name, d.units,
          DATE_FORMAT(o.vstdate, '%Y-%m') as vst_month,
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
            d.name LIKE '%ศุขไสยาสน์%' OR d.name LIKE '%แก้ลมแก้เส้น%' OR d.name LIKE '%ขี้ผึ้ง%' OR
            d.name LIKE '%trifer%' OR d.name LIKE '%ไตรเฟอร์%' OR
            d.name LIKE '%folic%' OR d.name LIKE '%โฟลิก%'
          )
        GROUP BY o.icode, d.name, d.units, DATE_FORMAT(o.vstdate, '%Y-%m')`,
        [startDate, endDate]
      );
      dispenseRows = rows;
      isOnline = true;
    } catch (err: any) {
      console.error(`[PcuHerbal] Error querying PCU ${pcu.code}:`, err.message);
      isOnline = false;
    }

    // Map rows to Master items
    const itemMap = new Map<number, {
      herbal_id: number;
      herbal_name: string;
      size: string;
      cost_price: number;
      dispense_count: number;
      dispensed_qty: number;
      total_cost: number;
      total_charge: number;
      category?: string;
    }>();

    for (const master of targetMasterList) {
      itemMap.set(master.id, {
        herbal_id: master.id,
        herbal_name: master.name,
        size: master.size,
        cost_price: master.cost,
        dispense_count: 0,
        dispensed_qty: 0,
        total_cost: 0,
        total_charge: 0,
        category: master.category,
      });
    }

    let totalDispenseCount = 0;
    let totalDispensedQty = 0;
    let totalDrugCost = 0;
    let totalChargeAmt = 0;

    for (const row of dispenseRows) {
      const drugName = String(row.drug_name || '').toLowerCase();
      // Find matching master item
      const master = targetMasterList.find(m => {
        return m.keywords.some(kw => drugName.includes(kw.toLowerCase()));
      });

      if (master) {
        const item = itemMap.get(master.id)!;
        const qty = Number(row.total_qty || 0);
        const charge = Number(row.total_charge || 0);
        let cost = 0;

        if (master.id === 47) {
          // Triferdine 150 mg:
          // ก.ค.69 (2026-07) ถึง ก.ย.69 (2026-09) = 38.52 / 30 = 1.284 บาท/เม็ด
          // ต.ค.68 ถึง มิ.ย.69 (2026-06) = 26.75 / 30 = 0.89167 บาท/เม็ด
          const vstMonth = String(row.vst_month || '');
          const unitRate = vstMonth >= '2026-07' ? (38.52 / 30) : (26.75 / 30);
          cost = qty * unitRate;
        } else if (master.id === 48) {
          // Folic acid: 0.12 บาท / เม็ด
          cost = qty * 0.12;
        } else {
          // Herbal standard unit cost
          cost = qty * master.unitCost;
        }

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
    const herbalPaid = hsub.total_paid;
    const triferdinePaid = TRIFERDINE_REIMBURSEMENT_BY_PCU[pcu.code] || 0;
    const folicQty = itemMap.get(48)?.dispensed_qty || 0;
    const folicPaid = Math.round((folicQty / 52) * 80 * 100) / 100;

    let totalPaid = 0;
    if (category === 'herbal') {
      totalPaid = herbalPaid;
    } else if (category === 'iron_folic') {
      totalPaid = triferdinePaid + folicPaid;
    } else {
      totalPaid = herbalPaid + triferdinePaid + folicPaid;
    }

    const grossProfit = Math.max(0, totalPaid - totalDrugCost);
    const payableProfit = grossProfit;
    const marginPct = totalPaid > 0 ? (grossProfit / totalPaid) * 100 : 0;

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
      hsub_total_paid: Math.round(totalPaid * 100) / 100,
      triferdine_reimbursed: triferdinePaid,
      folic_reimbursed: folicPaid,
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
    master_items: targetMasterList,
  };
}

export async function getPcuHerbalDrillDown(options: {
  hcode: string;
  herbalId?: number;
  category?: 'all' | 'herbal' | 'iron_folic';
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const {
    hcode,
    herbalId,
    category = 'all',
    startDate = '2025-10-01',
    endDate = '2026-10-31',
    search = '',
    page = 1,
    limit = 50,
  } = options;

  const allPcus = await getActivePcuConfigs();
  const pcu = allPcus.find(p => p.code === hcode);
  if (!pcu) throw new Error(`ไม่พบข้อมูล รพ.สต. รหัส ${hcode}`);

  const pool = getPcuPool(pcu);
  const offset = (page - 1) * limit;

  let keywordFilters: string[] = [];
  if (herbalId) {
    const master = ALL_DRUG_MASTER.find(m => m.id === herbalId);
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
    const herbalSql = `(
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
    )`;
    const ironFolicSql = `(
      d.name LIKE '%trifer%' OR d.name LIKE '%ไตรเฟอร์%' OR 
      d.name LIKE '%folic%' OR d.name LIKE '%โฟลิก%'
    )`;

    if (category === 'herbal') {
      whereClauses.push(herbalSql);
    } else if (category === 'iron_folic') {
      whereClauses.push(ironFolicSql);
    } else {
      whereClauses.push(`(${herbalSql} OR ${ironFolicSql})`);
    }
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

  // Calculate unit cost based on master catalog
  const mappedRows = rows.map((r: any) => {
    const dName = String(r.drug_name || '').toLowerCase();
    const master = ALL_DRUG_MASTER.find(m => m.keywords.some(kw => dName.includes(kw.toLowerCase())));
    let unitCost = 0;
    const vstDateStr = String(r.vstdate || '');

    if (master) {
      if (master.id === 47) {
        // Triferdine 150 mg:
        // ก.ค.69 (2026-07) เป็นต้นไป = 38.52 / 30 = 1.284 บาท
        // ก่อน ก.ค.69 (ต.ค.68 - มิ.ย.69) = 26.75 / 30 = 0.89167 บาท
        unitCost = vstDateStr >= '2026-07-01' ? (38.52 / 30) : (26.75 / 30);
      } else if (master.id === 48) {
        // Folic acid: 0.12 บาท / เม็ด
        unitCost = 0.12;
      } else {
        unitCost = master.unitCost;
      }
    }

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
      category: master?.category || 'herbal',
      unit_cost: Math.round(unitCost * 1000) / 1000,
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
