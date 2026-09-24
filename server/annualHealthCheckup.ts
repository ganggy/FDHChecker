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
        lh.vn, lo.lab_order_number, lo.lab_items_code,
        COALESCE(NULLIF(li.lab_items_display_name, ''), li.lab_items_name) AS lab_name,
        COALESCE(li.service_price, 0) AS service_price,
        li.icode
      FROM lab_head lh
      JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
      JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
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

    // ประมวลผล X-ray
    for (const row of (Array.isArray(xrayOpiRows) ? xrayOpiRows : []) as any[]) {
      const vn = String(row.vn);
      const list = xrayMap.get(vn) || [];
      list.push({
        name: String(row.item_name || 'ตรวจเอกซเรย์').trim(),
        price: Number(row.sum_price || row.unitprice || 0),
        qty: Number(row.qty || 1),
        category: 'xray',
        code: String(row.icode || '')
      });
      xrayMap.set(vn, list);
    }
    // ถ้าใน opitemrece ไม่มี แต่มีใน xray_head ให้ดึงชื่อจาก xray_list
    for (const row of (Array.isArray(xrayHeadRows) ? xrayHeadRows : []) as any[]) {
      const vn = String(row.vn);
      if (!xrayMap.has(vn) || xrayMap.get(vn)?.length === 0) {
        const list = xrayMap.get(vn) || [];
        const name = String(row.xray_list || 'Chest PA').trim();
        const price = Number(row.total_price || row.xray_price || 0);
        list.push({ name, price, qty: 1, category: 'xray' });
        xrayMap.set(vn, list);
      }
    }

    // ประมวลผล Lab
    // ดึงราคาจาก opitemrece ถ้ามี mapping
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
      const orderItems = labOrdersByVn.get(vn) || [];
      const opiItems = opiLabByVn.get(vn) || [];
      const list: CheckupItem[] = [];

      if (orderItems.length > 0) {
        const seenNames = new Set<string>();
        for (const item of orderItems) {
          const rawName = String(item.lab_name || '').trim();
          if (!rawName || seenNames.has(rawName)) continue;
          seenNames.add(rawName);

          // หาราคาจาก opitemrece ที่ตรงกับ icode หรือใช้ service_price
          let price = Number(item.service_price || 0);
          if (item.icode) {
            const matchedOpi = opiItems.find((o) => String(o.icode) === String(item.icode));
            if (matchedOpi) {
              price = Number(matchedOpi.unitprice || matchedOpi.sum_price || price);
            }
          }

          list.push({
            name: rawName,
            price: price,
            qty: 1,
            category: 'lab',
            code: String(item.lab_items_code || '')
          });
        }
      } else if (opiItems.length > 0) {
        // Fallback ใช้รายการจาก opitemrece
        for (const item of opiItems) {
          list.push({
            name: String(item.item_name || 'ตรวจชันสูตรทางห้องปฏิบัติการ').trim(),
            price: Number(item.sum_price || item.unitprice || 0),
            qty: Number(item.qty || 1),
            category: 'lab',
            code: String(item.icode || '')
          });
        }
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
