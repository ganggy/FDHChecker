import { Router, type Request, type Response } from 'express';
import { hospitalPool, type HospitalConnection } from './hospitalDatabase.js';

export const annualHealthCheckupRouter = Router();

export type CheckupItem = {
  name: string;
  price: number;
  qty?: number;
  category: 'xray' | 'lab' | 'other';
  code?: string;
};

export type CheckupVisit = {
  vn: string;
  hn: string;
  vstdate: string;
  vsttime: string;
  pname: string;
  fname: string;
  lname: string;
  fullname: string;
  birthday: string | null;
  age_y: number;
  age_m: number;
  sex: string;
  pttype: string;
  pttype_name: string;
  pcode: string;
  hipdata_code: string;
  xray_items: CheckupItem[];
  xray_total: number;
  lab_items: CheckupItem[];
  lab_total: number;
  other_items: CheckupItem[];
  other_total: number;
  total_price: number;
};

/**
 * จัดกลุ่มและปรับแต่งชื่อรายการ Lab ให้อ่านง่ายเป็น Lab Group มาตรฐาน
 */
export function formatLabGroupName(rawName: string): string {
  if (!rawName) return 'ตรวจทางห้องปฏิบัติการ';
  let name = rawName.trim().replace(/\s+/g, ' ');

  // Standard Lab Checkup Groups
  if (/^CBC\b/i.test(name) || /complete blood count/i.test(name)) return 'CBC';
  if (/^Urine Analysis\b/i.test(name) || /^UA\b/i.test(name) || /urinalysis/i.test(name)) return 'Urine Analysis (UA)';
  if (/^BUN\b/i.test(name) || /blood urea nitrogen/i.test(name)) return 'BUN';
  if (/^Creatinine\b/i.test(name) || /^Cr\b/i.test(name)) return 'Creatinine';
  if (/^Electrolyte\b/i.test(name)) return 'Electrolyte';
  if (/^Lipid profile\b/i.test(name) || /cholesterol.*triglyceride/i.test(name)) return 'Lipid profile';
  if (/^Liver Function\b/i.test(name) || /^LFT\b/i.test(name)) return 'Liver Function Test (LFT)';
  if (/^FBS\b/i.test(name) || /^FPG\b/i.test(name) || /fasting blood sugar/i.test(name)) return 'FBS (น้ำตาลในเลือด)';
  if (/^HbA1c\b/i.test(name)) return 'HbA1c';
  if (/^Uric\b/i.test(name)) return 'Uric acid';
  if (/^Stool Exam\b/i.test(name) || /stool.*examination/i.test(name)) return 'Stool Exam';
  if (/^Occult Blood\b/i.test(name) || /stool occult/i.test(name)) return 'Stool Occult Blood';
  if (/^Cholesterol\b/i.test(name)) return 'Cholesterol';
  if (/^Triglyceride\b/i.test(name)) return 'Triglyceride';
  if (/^HDL\b/i.test(name)) return 'HDL-C';
  if (/^LDL\b/i.test(name)) return 'LDL-C';
  if (/^SGOT\b/i.test(name) || /^AST\b/i.test(name)) return 'SGOT (AST)';
  if (/^SGPT\b/i.test(name) || /^ALT\b/i.test(name)) return 'SGPT (ALT)';
  if (/^Alk\b/i.test(name) || /alkaline phosphatase/i.test(name)) return 'Alkaline Phosphatase';
  if (/^UPT\b/i.test(name) || /urine preg/i.test(name)) return 'Pregnancy Test (UPT)';
  if (/^HBsAg\b/i.test(name)) return 'HBsAg';
  if (/^Anti[- ]?HBs\b/i.test(name)) return 'Anti-HBs';
  if (/^Anti[- ]?HCV\b/i.test(name)) return 'Anti-HCV';
  if (/^VDRL\b/i.test(name) || /^RPR\b/i.test(name)) return 'VDRL / RPR';

  // ตัดรหัสตัวเลขกรมบัญชีกลางท้ายชื่อ เช่น "(31001)", "(32203)", " 32201"
  name = name.replace(/\s*\(\s*\d{4,6}\s*\)\s*$/g, '');
  name = name.replace(/\s+\d{4,6}$/g, '');
  return name.trim();
}

/**
 * ปรับแต่งชื่อรายการ X-Ray ให้อ่านง่าย
 */
export function formatXrayName(rawName: string): string {
  if (!rawName) return 'Chest PA (X-Ray ปอด)';
  let name = rawName.trim().replace(/\s+/g, ' ');
  if (/chest/i.test(name) || /cxr/i.test(name)) return 'Chest PA (X-Ray ปอด)';
  name = name.replace(/\s*\(\s*\d{4,6}\s*\)\s*$/g, '');
  name = name.replace(/\s+\d{4,6}$/g, '');
  return name.trim();
}

/**
 * GET /api/reports/checkup/pttypes
 * ดึงรายการสิทธิการรักษาทั้งหมดในระบบเพื่อนำมาทำตัวกรอง
 */
annualHealthCheckupRouter.get('/pttypes', async (_req: Request, res: Response) => {
  let connection: HospitalConnection | null = null;
  try {
    connection = await hospitalPool.getConnection();
    const [rows] = await connection.query(`
      SELECT pttype, name, pcode, hipdata_code
      FROM pttype
      ORDER BY 
        CASE 
          WHEN hipdata_code IN ('OFC', 'LGO') OR pcode IN ('A1', 'A2') THEN 1 
          ELSE 2 
        END,
        pcode ASC, pttype ASC
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching pttypes for checkup:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ดึงข้อมูลสิทธิการรักษาไม่สำเร็จ'
    });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * GET /api/reports/checkup/visits
 * ค้นหาข้อมูลผู้รับการตรวจสุขภาพตามช่วงวันที่และสิทธิการรักษา
 */
annualHealthCheckupRouter.get('/visits', async (req: Request, res: Response) => {
  const dateStart = String(req.query.date_start || '').trim();
  const dateEnd = String(req.query.date_end || '').trim();
  const pttype = String(req.query.pttype || 'OFC_LGO').trim();
  const search = String(req.query.search || '').trim();

  if (!dateStart || !dateEnd) {
    return res.status(400).json({ success: false, error: 'กรุณาระบุวันที่เริ่มต้นและวันที่สิ้นสุด' });
  }

  let connection: HospitalConnection | null = null;
  try {
    connection = await hospitalPool.getConnection();

    let pttypeClause = '';
    const params: any[] = [dateStart, dateEnd];

    if (pttype === 'OFC_LGO') {
      pttypeClause = `AND (pt.pcode IN ('A1', 'A2') OR pt.hipdata_code IN ('OFC', 'LGO') OR o.pttype IN ('20', '21', '24', '26', '30', 'F4'))`;
    } else if (pttype && pttype !== 'all') {
      const pttypes = pttype.split(',').map((p) => p.trim()).filter(Boolean);
      if (pttypes.length > 0) {
        pttypeClause = `AND o.pttype IN (${pttypes.map(() => '?').join(', ')})`;
        params.push(...pttypes);
      }
    }

    let searchClause = '';
    if (search) {
      searchClause = `AND (p.fname LIKE ? OR p.lname LIKE ? OR p.hn LIKE ? OR o.vn LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    // 1. ดึง Visit ที่มีรายการตรวจแลป หรือเอ็กซเรย์ หรือค่าตรวจในวันนั้น
    const [visitRows] = await connection.query(`
      SELECT 
        o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate, o.vsttime, o.pttype,
        p.pname, p.fname, p.lname, DATE_FORMAT(p.birthday, '%Y-%m-%d') AS birthday, p.sex,
        TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate) AS age_y,
        TIMESTAMPDIFF(MONTH, p.birthday, o.vstdate) % 12 AS age_m,
        pt.name AS pttype_name, pt.pcode, pt.hipdata_code
      FROM ovst o
      JOIN patient p ON p.hn = o.hn
      JOIN pttype pt ON pt.pttype = o.pttype
      WHERE o.vstdate BETWEEN ? AND ?
        ${pttypeClause}
        ${searchClause}
        AND (
          EXISTS (SELECT 1 FROM opitemrece opi WHERE opi.vn = o.vn AND opi.income IN ('04', '05', '06', '07', '23', '66'))
          OR EXISTS (SELECT 1 FROM lab_head lh WHERE lh.vn = o.vn)
          OR EXISTS (SELECT 1 FROM xray_head xh WHERE xh.vn = o.vn)
        )
      ORDER BY o.vstdate ASC, o.vsttime ASC, o.vn ASC
      LIMIT 1000
    `, params);

    const visits = (Array.isArray(visitRows) ? visitRows : []) as Array<any>;
    if (visits.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const vns = visits.map((v) => v.vn);

    // 2. ดึงรายการ X-ray จาก xray_head และ opitemrece (income = '04')
    const [xrayHeadRows] = await connection.query(`
      SELECT xh.vn, xh.xray_list, xh.total_price, xh.xray_price
      FROM xray_head xh
      WHERE xh.vn IN (${vns.map(() => '?').join(', ')})
    `, vns);

    const [xrayOpiRows] = await connection.query(`
      SELECT opi.vn, opi.icode, nd.name AS item_name, opi.qty, opi.unitprice, opi.sum_price
      FROM opitemrece opi
      LEFT JOIN nondrugitems nd ON nd.icode = opi.icode
      WHERE opi.vn IN (${vns.map(() => '?').join(', ')})
        AND opi.income IN ('04', '06')
    `, vns);

    // 3. ดึงรายการ Lab จาก lab_head + lab_order + lab_items
    const [labOrderRows] = await connection.query(`
      SELECT 
        lh.vn, lh.form_name, lo.lab_order_number, lo.lab_items_code,
        COALESCE(NULLIF(li.lab_items_display_name, ''), li.lab_items_name) AS lab_name,
        COALESCE(li.service_price, 0) AS service_price,
        li.icode,
        nd.name AS nondrug_name,
        lg.lab_items_group_name AS group_name
      FROM lab_head lh
      JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
      JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
      LEFT JOIN nondrugitems nd ON nd.icode = li.icode
      LEFT JOIN lab_items_group lg ON lg.lab_items_group_code = li.lab_items_group
      WHERE lh.vn IN (${vns.map(() => '?').join(', ')})
      ORDER BY lo.lab_order_number, li.display_order, li.lab_items_code
    `, vns);

    // 4. ดึงรายการ Lab จาก opitemrece (income = '05') เพื่อยืนยันราคา
    const [labOpiRows] = await connection.query(`
      SELECT opi.vn, opi.icode, nd.name AS item_name, opi.qty, opi.unitprice, opi.sum_price
      FROM opitemrece opi
      LEFT JOIN nondrugitems nd ON nd.icode = opi.icode
      WHERE opi.vn IN (${vns.map(() => '?').join(', ')})
        AND opi.income = '05'
    `, vns);

    // 5. ดึงรายการอื่นๆ ที่คิดเงิน (เช่น EKG, ค่าบริการทางการพยาบาล ฯลฯ)
    const [otherOpiRows] = await connection.query(`
      SELECT opi.vn, opi.icode, nd.name AS item_name, opi.qty, opi.unitprice, opi.sum_price, opi.income
      FROM opitemrece opi
      LEFT JOIN nondrugitems nd ON nd.icode = opi.icode
      WHERE opi.vn IN (${vns.map(() => '?').join(', ')})
        AND opi.income IN ('07', '23', '66', '22')
    `, vns);

    // จัดกลุ่มข้อมูลตาม VN
    const xrayMap = new Map<string, CheckupItem[]>();
    const labMap = new Map<string, CheckupItem[]>();
    const otherMap = new Map<string, CheckupItem[]>();

    // ประมวลผล X-ray (รวมรายการซ้ำและจัดรูปแบบชื่อ)
    for (const row of (Array.isArray(xrayOpiRows) ? xrayOpiRows : []) as any[]) {
      const vn = String(row.vn);
      const list = xrayMap.get(vn) || [];
      const cleanName = formatXrayName(String(row.item_name || ''));
      const price = Number(row.sum_price || row.unitprice || 0);
      const qty = Number(row.qty || 1);
      const existing = list.find((x) => x.name === cleanName);
      if (existing) {
        existing.price += price;
        existing.qty = (existing.qty || 1) + qty;
      } else {
        list.push({
          name: cleanName,
          price,
          qty,
          category: 'xray',
          code: String(row.icode || '')
        });
      }
      xrayMap.set(vn, list);
    }
    // ถ้าใน opitemrece ไม่มี แต่มีใน xray_head ให้ดึงชื่อจาก xray_list
    for (const row of (Array.isArray(xrayHeadRows) ? xrayHeadRows : []) as any[]) {
      const vn = String(row.vn);
      if (!xrayMap.has(vn) || xrayMap.get(vn)?.length === 0) {
        const list = xrayMap.get(vn) || [];
        const cleanName = formatXrayName(String(row.xray_list || ''));
        const price = Number(row.total_price || row.xray_price || 0);
        list.push({ name: cleanName, price, qty: 1, category: 'xray' });
        xrayMap.set(vn, list);
      }
    }

    // ประมวลผล Lab จัดกลุ่มเป็น Lab Group (เช่น CBC, UA, Lipid profile, BUN, Cr) พร้อมราคา
    const opiLabByVn = new Map<string, any[]>();
    for (const row of (Array.isArray(labOpiRows) ? labOpiRows : []) as any[]) {
      const vn = String(row.vn);
      const list = opiLabByVn.get(vn) || [];
      list.push(row);
      opiLabByVn.set(vn, list);
    }

    const labOrdersByVn = new Map<string, any[]>();
    for (const row of (Array.isArray(labOrderRows) ? labOrderRows : []) as any[]) {
      const vn = String(row.vn);
      const list = labOrdersByVn.get(vn) || [];
      list.push(row);
      labOrdersByVn.set(vn, list);
    }

    for (const vn of vns) {
      const opiItems = opiLabByVn.get(vn) || [];
      const orderItems = labOrdersByVn.get(vn) || [];
      const list: CheckupItem[] = [];

      if (opiItems.length > 0) {
        // กรณีมีใน opitemrece (income = '05'): เป็นรายการกลุ่มแลปที่คิดเงินจริงตามใบเสร็จ/ใบเคลม
        const opiGroupMap = new Map<string, CheckupItem>();
        for (const item of opiItems) {
          const rawName = String(item.item_name || 'ตรวจทางห้องปฏิบัติการ');
          const groupName = formatLabGroupName(rawName);
          const price = Number(item.sum_price || item.unitprice || 0);
          const qty = Number(item.qty || 1);
          const key = groupName;

          if (opiGroupMap.has(key)) {
            const existing = opiGroupMap.get(key)!;
            existing.price += price;
            existing.qty = (existing.qty || 1) + qty;
          } else {
            opiGroupMap.set(key, {
              name: groupName,
              price,
              qty,
              category: 'lab',
              code: String(item.icode || '')
            });
          }
        }
        list.push(...Array.from(opiGroupMap.values()));
      } else if (orderItems.length > 0) {
        // กรณีไม่มีใน opitemrece: จัดกลุ่ม Lab ตามชื่อกลุ่ม เพื่อไม่ให้แสดงรายการย่อย 30-50 รายการ
        const orderGroupMap = new Map<string, CheckupItem>();
        for (const item of orderItems) {
          const rawName = item.nondrug_name || item.group_name || item.form_name || item.lab_name;
          const groupName = formatLabGroupName(String(rawName || ''));
          const price = Number(item.service_price || 0);
          const key = groupName;

          if (orderGroupMap.has(key)) {
            const existing = orderGroupMap.get(key)!;
            existing.price += price;
          } else {
            orderGroupMap.set(key, {
              name: groupName,
              price,
              qty: 1,
              category: 'lab',
              code: String(item.icode || item.lab_items_code || '')
            });
          }
        }
        list.push(...Array.from(orderGroupMap.values()));
      }

      labMap.set(vn, list);
    }

    // ประมวลผล Other items
    for (const row of (Array.isArray(otherOpiRows) ? otherOpiRows : []) as any[]) {
      const vn = String(row.vn);
      const list = otherMap.get(vn) || [];
      list.push({
        name: String(row.item_name || 'บริการทางการแพทย์').trim(),
        price: Number(row.sum_price || row.unitprice || 0),
        qty: Number(row.qty || 1),
        category: 'other',
        code: String(row.icode || '')
      });
      otherMap.set(vn, list);
    }

    // รวมร่างผลลัพธ์
    const results: CheckupVisit[] = visits.map((v) => {
      const vn = String(v.vn);
      const xrayItems = xrayMap.get(vn) || [];
      const labItems = labMap.get(vn) || [];
      const otherItems = otherMap.get(vn) || [];

      const xrayTotal = xrayItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const labTotal = labItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const otherTotal = otherItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const totalPrice = xrayTotal + labTotal + otherTotal;

      const pname = String(v.pname || '').trim();
      const fname = String(v.fname || '').trim();
      const lname = String(v.lname || '').trim();
      const fullname = `${pname}${fname} ${lname}`.trim();

      return {
        vn,
        hn: String(v.hn || ''),
        vstdate: String(v.vstdate || ''),
        vsttime: String(v.vsttime || ''),
        pname,
        fname,
        lname,
        fullname,
        birthday: v.birthday ? String(v.birthday) : null,
        age_y: Number(v.age_y || 0),
        age_m: Number(v.age_m || 0),
        sex: String(v.sex || ''),
        pttype: String(v.pttype || ''),
        pttype_name: String(v.pttype_name || ''),
        pcode: String(v.pcode || ''),
        hipdata_code: String(v.hipdata_code || ''),
        xray_items: xrayItems,
        xray_total: xrayTotal,
        lab_items: labItems,
        lab_total: labTotal,
        other_items: otherItems,
        other_total: otherTotal,
        total_price: totalPrice
      };
    });

    return res.json({
      success: true,
      data: results,
      meta: {
        total_records: results.length,
        date_start: dateStart,
        date_end: dateEnd,
        pttype
      }
    });
  } catch (error) {
    console.error('Error fetching checkup visits:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ค้นหาข้อมูลตรวจสุขภาพไม่สำเร็จ'
    });
  } finally {
    if (connection) connection.release();
  }
});
