import { Router } from 'express';
import {
  getUnitCostReport,
  getUnitCostDrillDown,
  getCostOverrides,
  saveCostOverride,
} from '../unitCostService.js';
import { validateDateRange } from '../requestSafety.js';

export const unitCostRouter = Router();

// GET /api/unit-cost/report
unitCostRouter.get('/report', async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุช่วงวันที่เริ่มต้นและสิ้นสุด' });
    }

    const dateVal = validateDateRange(startDate, endDate, 730);
    if (!dateVal.ok) {
      return res.status(400).json({ success: false, error: dateVal.error });
    }

    const report = await getUnitCostReport({
      department: req.query.department ? String(req.query.department) : 'ttm',
      facility: req.query.facility ? String(req.query.facility) : '11101',
      category: req.query.category ? String(req.query.category) : 'all',
      fund: req.query.fund ? String(req.query.fund) : 'ALL',
      startDate,
      endDate,
    });

    return res.json({ success: true, data: report });
  } catch (error) {
    console.error('Error in unit cost report:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการคำนวณต้นทุน',
    });
  }
});

// GET /api/unit-cost/drilldown
unitCostRouter.get('/drilldown', async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุช่วงวันที่' });
    }

    const drilldown = await getUnitCostDrillDown({
      department: req.query.department ? String(req.query.department) : 'ttm',
      facility: req.query.facility ? String(req.query.facility) : '11101',
      icode: req.query.icode ? String(req.query.icode) : undefined,
      startDate,
      endDate,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });

    return res.json({ success: true, data: drilldown });
  } catch (error) {
    console.error('Error in unit cost drilldown:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลเจาะลึกได้',
    });
  }
});

// GET /api/unit-cost/cost-settings
unitCostRouter.get('/cost-settings', async (_req, res) => {
  try {
    const settings = await getCostOverrides();
    return res.json({ success: true, data: settings });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลต้นทุนได้',
    });
  }
});

// POST /api/unit-cost/cost-settings
unitCostRouter.post('/cost-settings', async (req, res) => {
  try {
    const { icode, unitCost, note } = req.body || {};
    if (!icode || unitCost == null) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุรหัส icode และราคาต้นทุน' });
    }

    const updated = await saveCostOverride(
      String(icode).trim(),
      Number(unitCost),
      note ? String(note).trim() : undefined,
      (req as any).user?.username || 'Staff'
    );

    return res.json({ success: true, data: updated, message: 'บันทึกการตั้งค่าต้นทุนสำเร็จ' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถบันทึกต้นทุนได้',
    });
  }
});
