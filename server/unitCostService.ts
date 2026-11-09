import { getUTFConnection, getAppSetting, setAppSetting } from './db.js';
import { getActivePcuConfigs, getPcuPool, type PcuConfig } from './pcuHerbalService.js';

export interface UnitCostItem {
  icode: string;
  name: string;
  category: 'herb_drug' | 'ttm_procedure' | 'pt_procedure' | 'dental_procedure' | 'general_drug' | 'other';
  categoryLabel: string;
  units: string;
  unitCost: number;
  unitPrice: number;
  qty: number;
  totalCost: number;
  totalRevenue: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
  isCostOverridden: boolean;
  status: 'high_profit' | 'moderate_profit' | 'low_profit' | 'zero_cost' | 'loss';
}

export interface UnitCostSummary {
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  totalVisits: number;
  totalQty: number;
  itemCount: number;
  profitItemCount: number;
  lossItemCount: number;
  zeroCostItemCount: number;
}

export interface UnitCostFundGroup {
  fund: string;
  fundLabel: string;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
}

export interface UnitCostMonthlyTrend {
  month: string;
  monthLabel: string;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
}

export interface UnitCostFacilityGroup {
  hospcode: string;
  name: string;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPct: number;
  visitCount: number;
  itemCount: number;
}

export interface UnitCostDrillDownRow {
  vstdate: string;
  vn: string;
  hn: string;
  patient_name: string;
  pttype: string;
  pttype_name: string;
  fund: string;
  icode: string;
  item_name: string;
  qty: number;
  unit_cost: number;
  unit_price: number;
  sum_price: number;
  total_cost: number;
  net_profit: number;
}

export interface UnitCostReportResponse {
  department: string;
  departmentLabel: string;
  facility: string;
  facilityLabel: string;
  period: { startDate: string; endDate: string };
  summary: UnitCostSummary;
  items: UnitCostItem[];
  fundBreakdown: UnitCostFundGroup[];
  facilityBreakdown: UnitCostFacilityGroup[];
  monthlyTrend: UnitCostMonthlyTrend[];
}

export interface CostOverrideMap {
  [icode: string]: {
    unitCost: number;
    updatedAt: string;
    updatedBy?: string;
    note?: string;
  };
}

const COST_OVERRIDE_KEY = 'unit_cost_overrides';

export async function getCostOverrides(): Promise<CostOverrideMap> {
  const overrides = (await getAppSetting<CostOverrideMap>(COST_OVERRIDE_KEY)) || {};
  return overrides || {};
}

export async function saveCostOverride(icode: string, unitCost: number, note?: string, updatedBy?: string): Promise<CostOverrideMap> {
  const current = await getCostOverrides();
  current[icode] = {
    unitCost: Math.max(0, Number(unitCost) || 0),
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'Staff',
    note: note || '',
  };
  await setAppSetting(COST_OVERRIDE_KEY, current);
  return current;
}

const mapFundFromPttype = (pcode: string, hipdataCode: string, pttypeName: string): { fund: string; label: string } => {
  const hip = (hipdataCode || '').toUpperCase();
  const pc = (pcode || '').toUpperCase();
  const name = pttypeName || '';

  if (hip === 'CSH' || pc === '10' || name.includes('ชำระเงิน')) return { fund: 'CASH', label: 'ชำระเงินเอง (Cash)' };
  if (hip === 'SSS' || name.includes('ประกันสังคม')) return { fund: 'SSS', label: 'ประกันสังคม (SSS)' };
  if (hip === 'OFC' || hip === 'A2' || hip === 'CSCD' || pc === 'A1' || name.includes('ข้าราชการ') || name.includes('จ่ายตรง')) return { fund: 'OFC', label: 'ข้าราชการ/เบิกตรง (OFC)' };
  if (hip === 'LGO' || name.includes('อปท') || name.includes('องค์กรปกครองส่วนท้องถิ่น')) return { fund: 'LGO', label: 'อปท. (LGO)' };
  if (hip === 'UCS' || hip === 'WEL' || pc === 'UC' || pc === 'AE' || pc === 'AK' || name.includes('บัตรทอง') || name.includes('ประกันสุขภาพ')) return { fund: 'UCS', label: 'บัตรทอง (UCS)' };
  return { fund: 'OTHER', label: 'สิทธิอื่นๆ' };
};

export async function getUnitCostReport(params: {
  department?: string;
  facility?: string;
  category?: string;
  fund?: string;
  startDate: string;
  endDate: string;
}): Promise<UnitCostReportResponse> {
  const dept = (params.department || 'ttm').toLowerCase();
  const facility = params.facility || '11101';
  const category = (params.category || 'all').toLowerCase();
  const fundFilter = (params.fund || 'ALL').toUpperCase();
  const startDate = params.startDate;
  const endDate = params.endDate;

  const overrides = await getCostOverrides();

  const deptLabels: Record<string, string> = {
    ttm: 'แผนกแพทย์แผนไทย & ยาสมุนไพร',
    pt: 'แผนกกายภาพบำบัด',
    dental: 'แผนกทันตสาธารณสุข',
    pharmacy: 'คลังยาและเวชภัณฑ์ทั้งหมด',
    opd_all: 'บริการผู้ป่วยนอกทั้งหมด (OPD)',
  };

  const facilityLabels: Record<string, string> = {
    '11101': 'รพ.โคกศรีสุพรรณ',
    '05570': 'รพ.สต.โพนค้อ',
    '05572': 'รพ.สต.โคกนาดี',
    '05573': 'รพ.สต.โพนทอง',
    '05571': 'รพ.สต.ม่วงไข่',
    '05569': 'รพ.สต.ห้วยหีบ',
    'cup_all': 'ภาพรวมเครือข่าย CUP โคกศรีสุพรรณ (รพ. + 5 รพ.สต.)',
  };

  // 1. Build Department Filter SQL for HOSxP
  let deptWhere = '';
  if (dept === 'ttm') {
    deptWhere = `
      AND (
        oi.income = '52'
        OR sp.spclty = '14'
        OR kd.department LIKE '%แพทย์แผนไทย%'
        OR d.name LIKE '%สมุนไพร%' OR d.name LIKE '%ขมิ้น%' OR d.name LIKE '%ฟ้าทะลาย%' 
        OR d.name LIKE '%ไพล%' OR d.name LIKE '%เถาวัลย์%' OR d.name LIKE '%ยาชง%' 
        OR d.name LIKE '%ประคบ%' OR d.name LIKE '%ปราบชมพู%' OR d.name LIKE '%หญ้าหนวดแมว%'
        OR nd.name LIKE '%นวด%' OR nd.name LIKE '%ประคบ%' OR nd.name LIKE '%อบสมุนไพร%' OR nd.name LIKE '%แพทย์แผนไทย%'
      )
    `;
    if (category === 'herbal') {
      deptWhere += ` AND d.icode IS NOT NULL`;
    } else if (category === 'procedure') {
      deptWhere += ` AND d.icode IS NULL`;
    }
  } else if (dept === 'pt') {
    deptWhere = ` AND (oi.income = '09' OR kd.department LIKE '%กายภาพ%')`;
  } else if (dept === 'dental') {
    deptWhere = ` AND (oi.income = '16' OR kd.department LIKE '%ทันต%')`;
  } else if (dept === 'pharmacy') {
    deptWhere = ` AND (oi.income IN ('03', '17', '80') OR d.icode IS NOT NULL)`;
  } else {
    // opd_all - no extra filter
    deptWhere = ``;
  }

  // Insurance fund filter SQL
  let fundWhere = '';
  if (fundFilter === 'UCS') {
    fundWhere = ` AND (pt.hipdata_code IN ('UCS', 'WEL') OR pt.pcode IN ('UC', 'AE', 'AK') OR pt.name LIKE '%บัตรทอง%')`;
  } else if (fundFilter === 'SSS') {
    fundWhere = ` AND (pt.hipdata_code = 'SSS' OR pt.name LIKE '%ประกันสังคม%')`;
  } else if (fundFilter === 'OFC') {
    fundWhere = ` AND (pt.hipdata_code IN ('OFC', 'A2', 'CSCD') OR pt.pcode = 'A1' OR pt.name LIKE '%ข้าราชการ%' OR pt.name LIKE '%จ่ายตรง%')`;
  } else if (fundFilter === 'LGO') {
    fundWhere = ` AND (pt.hipdata_code = 'LGO' OR pt.name LIKE '%อปท%')`;
  } else if (fundFilter === 'CASH') {
    fundWhere = ` AND (pt.hipdata_code = 'CSH' OR pt.pcode = '10' OR pt.name LIKE '%ชำระเงิน%')`;
  }

  // 2. Query HOSxP Main Database (if facility is 11101 or cup_all)
  const itemsMap = new Map<string, {
    icode: string;
    name: string;
    category: 'herb_drug' | 'ttm_procedure' | 'pt_procedure' | 'dental_procedure' | 'general_drug' | 'other';
    categoryLabel: string;
    units: string;
    masterUnitCost: number;
    masterUnitPrice: number;
    qty: number;
    totalCost: number;
    totalRevenue: number;
    visitCount: number;
  }>();

  const fundMap = new Map<string, { fund: string; label: string; totalRevenue: number; totalCost: number; visitCount: number }>();
  const monthMap = new Map<string, { month: string; monthLabel: string; totalRevenue: number; totalCost: number; visitCount: number }>();
  const facilityMap = new Map<string, { hospcode: string; name: string; totalRevenue: number; totalCost: number; visitCount: number; itemCount: Set<string> }>();

  // Initialize facility buckets
  facilityMap.set('11101', { hospcode: '11101', name: 'รพ.โคกศรีสุพรรณ', totalRevenue: 0, totalCost: 0, visitCount: 0, itemCount: new Set() });
  facilityMap.set('05570', { hospcode: '05570', name: 'รพ.สต.โพนค้อ', totalRevenue: 0, totalCost: 0, visitCount: 0, itemCount: new Set() });
  facilityMap.set('05572', { hospcode: '05572', name: 'รพ.สต.โคกนาดี', totalRevenue: 0, totalCost: 0, visitCount: 0, itemCount: new Set() });
  facilityMap.set('05573', { hospcode: '05573', name: 'รพ.สต.โพนทอง', totalRevenue: 0, totalCost: 0, visitCount: 0, itemCount: new Set() });
  facilityMap.set('05571', { hospcode: '05571', name: 'รพ.สต.ม่วงไข่', totalRevenue: 0, totalCost: 0, visitCount: 0, itemCount: new Set() });
  facilityMap.set('05569', { hospcode: '05569', name: 'รพ.สต.ห้วยหีบ', totalRevenue: 0, totalCost: 0, visitCount: 0, itemCount: new Set() });

  if (facility === '11101' || facility === 'cup_all') {
    const conn = await getUTFConnection();
    try {
      // A. Items summary
      const [rawItems]: any = await conn.query(`
        SELECT 
          oi.icode,
          COALESCE(d.name, nd.name, oi.icode) as item_name,
          COALESCE(d.units, nd.unit, 'หน่วย') as units,
          CASE 
            WHEN d.icode IS NOT NULL THEN 'herb_drug'
            WHEN oi.income = '52' OR nd.name LIKE '%นวด%' OR nd.name LIKE '%ประคบ%' OR nd.name LIKE '%อบสมุนไพร%' THEN 'ttm_procedure'
            WHEN oi.income = '09' THEN 'pt_procedure'
            WHEN oi.income = '16' THEN 'dental_procedure'
            ELSE 'other'
          END as item_cat,
          COALESCE(d.unitcost, nd.unitcost, oi.cost, 0) as master_unit_cost,
          COALESCE(d.unitprice, nd.price, oi.unitprice, 0) as master_unit_price,
          COUNT(DISTINCT oi.vn) as visit_count,
          SUM(oi.qty) as total_qty,
          SUM(oi.qty * COALESCE(NULLIF(oi.cost, 0), NULLIF(d.unitcost, 0), NULLIF(nd.unitcost, 0), 0)) as total_cost,
          SUM(oi.sum_price) as total_revenue
        FROM opitemrece oi
        LEFT JOIN drugitems d ON d.icode = oi.icode
        LEFT JOIN nondrugitems nd ON nd.icode = oi.icode
        LEFT JOIN ovst o ON o.vn = oi.vn
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN kskdepartment kd ON kd.depcode = o.main_dep
        LEFT JOIN pttype pt ON pt.pttype = oi.pttype
        WHERE oi.vstdate BETWEEN ? AND ?
          ${deptWhere}
          ${fundWhere}
        GROUP BY oi.icode, item_name, units, item_cat, master_unit_cost, master_unit_price
        ORDER BY total_revenue DESC
      `, [startDate, endDate]);

      for (const r of rawItems) {
        const icode = String(r.icode);
        const qty = Number(r.total_qty || 0);
        let unitCost = Number(r.master_unit_cost || 0);

        if (overrides[icode] && overrides[icode].unitCost > 0) {
          unitCost = overrides[icode].unitCost;
        }

        const calculatedCost = unitCost > 0 ? qty * unitCost : Number(r.total_cost || 0);
        const calculatedRev = Number(r.total_revenue || 0);

        let cat = r.item_cat as UnitCostItem['category'];
        let catLabel = 'หัตถการบริการ';
        if (cat === 'herb_drug') catLabel = 'ยาสมุนไพร';
        else if (cat === 'ttm_procedure') catLabel = 'หัตถการแผนไทย';
        else if (cat === 'pt_procedure') catLabel = 'กายภาพบำบัด';
        else if (cat === 'dental_procedure') catLabel = 'ทันตกรรม';

        itemsMap.set(icode, {
          icode,
          name: String(r.item_name || icode),
          category: cat,
          categoryLabel: catLabel,
          units: String(r.units || 'หน่วย'),
          masterUnitCost: unitCost,
          masterUnitPrice: Number(r.master_unit_price || 0),
          qty,
          totalCost: calculatedCost,
          totalRevenue: calculatedRev,
          visitCount: Number(r.visit_count || 0),
        });

        // Add to hospital facility bucket
        const fac11101 = facilityMap.get('11101')!;
        fac11101.totalRevenue += calculatedRev;
        fac11101.totalCost += calculatedCost;
        fac11101.itemCount.add(icode);
      }

      // Count distinct visits for hospital
      const [hosVisitCnt]: any = await conn.query(`
        SELECT COUNT(DISTINCT oi.vn) as total_visits
        FROM opitemrece oi
        LEFT JOIN drugitems d ON d.icode = oi.icode
        LEFT JOIN nondrugitems nd ON nd.icode = oi.icode
        LEFT JOIN ovst o ON o.vn = oi.vn
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN kskdepartment kd ON kd.depcode = o.main_dep
        LEFT JOIN pttype pt ON pt.pttype = oi.pttype
        WHERE oi.vstdate BETWEEN ? AND ?
          ${deptWhere}
          ${fundWhere}
      `, [startDate, endDate]);
      facilityMap.get('11101')!.visitCount = Number(hosVisitCnt[0]?.total_visits || 0);

      // B. Fund Breakdown from HOSxP
      const [rawFunds]: any = await conn.query(`
        SELECT 
          oi.pttype,
          pt.name as pttype_name,
          pt.pcode,
          pt.hipdata_code,
          COUNT(DISTINCT oi.vn) as visit_count,
          SUM(oi.qty * COALESCE(NULLIF(oi.cost, 0), NULLIF(d.unitcost, 0), NULLIF(nd.unitcost, 0), 0)) as total_cost,
          SUM(oi.sum_price) as total_revenue
        FROM opitemrece oi
        LEFT JOIN drugitems d ON d.icode = oi.icode
        LEFT JOIN nondrugitems nd ON nd.icode = oi.icode
        LEFT JOIN ovst o ON o.vn = oi.vn
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN kskdepartment kd ON kd.depcode = o.main_dep
        LEFT JOIN pttype pt ON pt.pttype = oi.pttype
        WHERE oi.vstdate BETWEEN ? AND ?
          ${deptWhere}
          ${fundWhere}
        GROUP BY oi.pttype, pt.name, pt.pcode, pt.hipdata_code
      `, [startDate, endDate]);

      for (const rf of rawFunds) {
        const { fund, label } = mapFundFromPttype(rf.pcode, rf.hipdata_code, rf.pttype_name);
        if (!fundMap.has(fund)) {
          fundMap.set(fund, { fund, label, totalRevenue: 0, totalCost: 0, visitCount: 0 });
        }
        const fg = fundMap.get(fund)!;
        fg.totalRevenue += Number(rf.total_revenue || 0);
        fg.totalCost += Number(rf.total_cost || 0);
        fg.visitCount += Number(rf.visit_count || 0);
      }

      // C. Monthly Trend from HOSxP
      const [rawMonths]: any = await conn.query(`
        SELECT 
          DATE_FORMAT(oi.vstdate, '%Y-%m') as ym,
          COUNT(DISTINCT oi.vn) as visit_count,
          SUM(oi.qty * COALESCE(NULLIF(oi.cost, 0), NULLIF(d.unitcost, 0), NULLIF(nd.unitcost, 0), 0)) as total_cost,
          SUM(oi.sum_price) as total_revenue
        FROM opitemrece oi
        LEFT JOIN drugitems d ON d.icode = oi.icode
        LEFT JOIN nondrugitems nd ON nd.icode = oi.icode
        LEFT JOIN ovst o ON o.vn = oi.vn
        LEFT JOIN spclty sp ON sp.spclty = o.spclty
        LEFT JOIN kskdepartment kd ON kd.depcode = o.main_dep
        LEFT JOIN pttype pt ON pt.pttype = oi.pttype
        WHERE oi.vstdate BETWEEN ? AND ?
          ${deptWhere}
          ${fundWhere}
        GROUP BY ym
        ORDER BY ym
      `, [startDate, endDate]);

      for (const rm of rawMonths) {
        const ym = String(rm.ym);
        const [y, m] = ym.split('-');
        const monthNames = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const mLabel = `${monthNames[Number(m)] || m} ${Number(y) + 543}`;

        if (!monthMap.has(ym)) {
          monthMap.set(ym, { month: ym, monthLabel: mLabel, totalRevenue: 0, totalCost: 0, visitCount: 0 });
        }
        const mg = monthMap.get(ym)!;
        mg.totalRevenue += Number(rm.total_revenue || 0);
        mg.totalCost += Number(rm.total_cost || 0);
        mg.visitCount += Number(rm.visit_count || 0);
      }

    } finally {
      conn.release();
    }
  }

  // 3. Query PCU Databases if facility is specific PCU or cup_all (and department is ttm / pharmacy)
  if (facility !== '11101' && (dept === 'ttm' || dept === 'pharmacy')) {
    const activePcus = await getActivePcuConfigs();
    const pcusToQuery = facility === 'cup_all'
      ? activePcus
      : activePcus.filter((p) => p.code === facility);

    for (const pcu of pcusToQuery) {
      const pool = getPcuPool(pcu);
      try {
        const [pcuRows]: any = await pool.query(`
          SELECT 
            oi.icode,
            d.name as item_name,
            d.units,
            d.unitcost as master_unit_cost,
            d.unitprice as master_unit_price,
            COUNT(DISTINCT oi.vn) as visit_count,
            SUM(oi.qty) as total_qty,
            SUM(oi.qty * COALESCE(NULLIF(oi.cost, 0), NULLIF(d.unitcost, 0), 0)) as total_cost,
            SUM(oi.sum_price) as total_revenue
          FROM opitemrece oi
          INNER JOIN drugitems d ON d.icode = oi.icode
          WHERE oi.vstdate BETWEEN ? AND ?
            AND (
              d.name LIKE '%สมุนไพร%' OR d.name LIKE '%ขมิ้น%' OR d.name LIKE '%ฟ้าทะลาย%' 
              OR d.name LIKE '%ไพล%' OR d.name LIKE '%เถาวัลย์%' OR d.name LIKE '%ยาชง%' 
              OR d.name LIKE '%ประคบ%' OR d.name LIKE '%ปราบชมพู%' OR d.name LIKE '%หญ้าหนวดแมว%'
            )
          GROUP BY oi.icode, d.name, d.units, d.unitcost, d.unitprice
        `, [startDate, endDate]);

        const facBucket = facilityMap.get(pcu.code);
        let pcuVisits = 0;

        for (const pr of pcuRows) {
          const icode = String(pr.icode);
          const qty = Number(pr.total_qty || 0);
          let unitCost = Number(pr.master_unit_cost || 0);
          if (overrides[icode] && overrides[icode].unitCost > 0) {
            unitCost = overrides[icode].unitCost;
          }
          const calculatedCost = unitCost > 0 ? qty * unitCost : Number(pr.total_cost || 0);
          const calculatedRev = Number(pr.total_revenue || 0);

          if (facBucket) {
            facBucket.totalRevenue += calculatedRev;
            facBucket.totalCost += calculatedCost;
            facBucket.itemCount.add(icode);
            pcuVisits = Math.max(pcuVisits, Number(pr.visit_count || 0));
          }

          if (facility === 'cup_all' || facility === pcu.code) {
            if (itemsMap.has(icode)) {
              const existing = itemsMap.get(icode)!;
              existing.qty += qty;
              existing.totalCost += calculatedCost;
              existing.totalRevenue += calculatedRev;
              existing.visitCount += Number(pr.visit_count || 0);
            } else {
              itemsMap.set(icode, {
                icode,
                name: String(pr.item_name || icode),
                category: 'herb_drug',
                categoryLabel: 'ยาสมุนไพร (รพ.สต.)',
                units: String(pr.units || 'หน่วย'),
                masterUnitCost: unitCost,
                masterUnitPrice: Number(pr.master_unit_price || 0),
                qty,
                totalCost: calculatedCost,
                totalRevenue: calculatedRev,
                visitCount: Number(pr.visit_count || 0),
              });
            }
          }
        }
        if (facBucket) facBucket.visitCount = pcuVisits;
      } catch (err: any) {
        console.warn(`Could not query PCU ${pcu.code} for unit cost:`, err?.message);
      }
    }
  }

  // 4. Format and Calculate Profit/Loss for all Items
  const items: UnitCostItem[] = [];
  let grandRevenue = 0;
  let grandCost = 0;
  let totalVisitsAcc = 0;
  let totalQtyAcc = 0;
  let profitItemCount = 0;
  let lossItemCount = 0;
  let zeroCostItemCount = 0;

  for (const it of itemsMap.values()) {
    const netProfit = it.totalRevenue - it.totalCost;
    const marginPct = it.totalRevenue > 0 ? (netProfit / it.totalRevenue) * 100 : 0;
    const isCostOverridden = !!(overrides[it.icode] && overrides[it.icode].unitCost > 0);

    let status: UnitCostItem['status'] = 'moderate_profit';
    if (it.totalCost === 0 && it.totalRevenue > 0) {
      status = 'zero_cost';
      zeroCostItemCount++;
    } else if (netProfit < 0) {
      status = 'loss';
      lossItemCount++;
    } else if (marginPct >= 30) {
      status = 'high_profit';
      profitItemCount++;
    } else if (marginPct > 0) {
      status = 'moderate_profit';
      profitItemCount++;
    } else {
      status = 'low_profit';
    }

    grandRevenue += it.totalRevenue;
    grandCost += it.totalCost;
    totalVisitsAcc += it.visitCount;
    totalQtyAcc += it.qty;

    items.push({
      icode: it.icode,
      name: it.name,
      category: it.category,
      categoryLabel: it.categoryLabel,
      units: it.units,
      unitCost: it.masterUnitCost,
      unitPrice: it.masterUnitPrice,
      qty: it.qty,
      totalCost: it.totalCost,
      totalRevenue: it.totalRevenue,
      netProfit,
      marginPct,
      visitCount: it.visitCount,
      isCostOverridden,
      status,
    });
  }

  // Sort items by revenue descending
  items.sort((a, b) => b.totalRevenue - a.totalRevenue);

  const grandProfit = grandRevenue - grandCost;
  const grandMarginPct = grandRevenue > 0 ? (grandProfit / grandRevenue) * 100 : 0;

  const summary: UnitCostSummary = {
    totalRevenue: grandRevenue,
    totalCost: grandCost,
    netProfit: grandProfit,
    marginPct: grandMarginPct,
    totalVisits: totalVisitsAcc,
    totalQty: totalQtyAcc,
    itemCount: items.length,
    profitItemCount,
    lossItemCount,
    zeroCostItemCount,
  };

  const fundBreakdown: UnitCostFundGroup[] = Array.from(fundMap.values()).map((fg) => ({
    fund: fg.fund,
    fundLabel: fg.label,
    totalRevenue: fg.totalRevenue,
    totalCost: fg.totalCost,
    netProfit: fg.totalRevenue - fg.totalCost,
    marginPct: fg.totalRevenue > 0 ? ((fg.totalRevenue - fg.totalCost) / fg.totalRevenue) * 100 : 0,
    visitCount: fg.visitCount,
  })).sort((a, b) => b.totalRevenue - a.totalRevenue);

  const facilityBreakdown: UnitCostFacilityGroup[] = Array.from(facilityMap.values()).map((fac) => ({
    hospcode: fac.hospcode,
    name: fac.name,
    totalRevenue: fac.totalRevenue,
    totalCost: fac.totalCost,
    netProfit: fac.totalRevenue - fac.totalCost,
    marginPct: fac.totalRevenue > 0 ? ((fac.totalRevenue - fac.totalCost) / fac.totalRevenue) * 100 : 0,
    visitCount: fac.visitCount,
    itemCount: fac.itemCount.size,
  }));

  const monthlyTrend: UnitCostMonthlyTrend[] = Array.from(monthMap.values()).map((mg) => ({
    month: mg.month,
    monthLabel: mg.monthLabel,
    totalRevenue: mg.totalRevenue,
    totalCost: mg.totalCost,
    netProfit: mg.totalRevenue - mg.totalCost,
    marginPct: mg.totalRevenue > 0 ? ((mg.totalRevenue - mg.totalCost) / mg.totalRevenue) * 100 : 0,
    visitCount: mg.visitCount,
  }));

  return {
    department: dept,
    departmentLabel: deptLabels[dept] || dept,
    facility,
    facilityLabel: facilityLabels[facility] || facility,
    period: { startDate, endDate },
    summary,
    items,
    fundBreakdown,
    facilityBreakdown,
    monthlyTrend,
  };
}

export async function getUnitCostDrillDown(params: {
  department?: string;
  facility?: string;
  icode?: string;
  startDate: string;
  endDate: string;
  limit?: number;
}): Promise<UnitCostDrillDownRow[]> {
  const dept = (params.department || 'ttm').toLowerCase();
  const icode = params.icode;
  const startDate = params.startDate;
  const endDate = params.endDate;
  const limit = Math.min(Number(params.limit) || 100, 500);

  const overrides = await getCostOverrides();
  const conn = await getUTFConnection();
  try {
    let whereClause = `oi.vstdate BETWEEN ? AND ?`;
    const sqlParams: any[] = [startDate, endDate];

    if (icode) {
      whereClause += ` AND oi.icode = ?`;
      sqlParams.push(icode);
    } else if (dept === 'ttm') {
      whereClause += ` AND (
        oi.income = '52' OR sp.spclty = '14' OR kd.department LIKE '%แพทย์แผนไทย%'
        OR d.name LIKE '%สมุนไพร%' OR d.name LIKE '%ขมิ้น%' OR d.name LIKE '%ฟ้าทะลาย%' 
        OR d.name LIKE '%ไพล%' OR d.name LIKE '%เถาวัลย์%' OR d.name LIKE '%ยาชง%' 
        OR nd.name LIKE '%นวด%' OR nd.name LIKE '%ประคบ%' OR nd.name LIKE '%อบสมุนไพร%'
      )`;
    } else if (dept === 'pt') {
      whereClause += ` AND (oi.income = '09' OR kd.department LIKE '%กายภาพ%')`;
    } else if (dept === 'dental') {
      whereClause += ` AND (oi.income = '16' OR kd.department LIKE '%ทันต%')`;
    }

    const [rows]: any = await conn.query(`
      SELECT 
        DATE_FORMAT(oi.vstdate, '%Y-%m-%d') as vstdate,
        oi.vn,
        oi.hn,
        CONCAT(COALESCE(p.pname,''), p.fname, ' ', p.lname) as patient_name,
        oi.pttype,
        pt.name as pttype_name,
        pt.pcode,
        pt.hipdata_code,
        oi.icode,
        COALESCE(d.name, nd.name, oi.icode) as item_name,
        oi.qty,
        COALESCE(NULLIF(oi.cost, 0), NULLIF(d.unitcost, 0), NULLIF(nd.unitcost, 0), 0) as unit_cost,
        oi.unitprice as unit_price,
        oi.sum_price
      FROM opitemrece oi
      LEFT JOIN patient p ON p.hn = oi.hn
      LEFT JOIN drugitems d ON d.icode = oi.icode
      LEFT JOIN nondrugitems nd ON nd.icode = oi.icode
      LEFT JOIN ovst o ON o.vn = oi.vn
      LEFT JOIN spclty sp ON sp.spclty = o.spclty
      LEFT JOIN kskdepartment kd ON kd.depcode = o.main_dep
      LEFT JOIN pttype pt ON pt.pttype = oi.pttype
      WHERE ${whereClause}
      ORDER BY oi.vstdate DESC, oi.vn DESC
      LIMIT ?
    `, [...sqlParams, limit]);

    return rows.map((r: any) => {
      const rowIcode = String(r.icode);
      let unitCost = Number(r.unit_cost || 0);
      if (overrides[rowIcode] && overrides[rowIcode].unitCost > 0) {
        unitCost = overrides[rowIcode].unitCost;
      }
      const qty = Number(r.qty || 0);
      const totalCost = unitCost * qty;
      const sumPrice = Number(r.sum_price || 0);
      const { label } = mapFundFromPttype(r.pcode, r.hipdata_code, r.pttype_name);

      return {
        vstdate: r.vstdate,
        vn: String(r.vn || ''),
        hn: String(r.hn || ''),
        patient_name: String(r.patient_name || '-'),
        pttype: String(r.pttype || ''),
        pttype_name: String(r.pttype_name || '-'),
        fund: label,
        icode: rowIcode,
        item_name: String(r.item_name || ''),
        qty,
        unit_cost: unitCost,
        unit_price: Number(r.unit_price || 0),
        sum_price: sumPrice,
        total_cost: totalCost,
        net_profit: sumPrice - totalCost,
      };
    });
  } finally {
    conn.release();
  }
}
