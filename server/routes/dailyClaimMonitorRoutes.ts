import { Router } from 'express';
import { getDailyClaimMonitor } from '../dailyClaimMonitorService.js';
import { validateDateRange } from '../requestSafety.js';

export const dailyClaimMonitorRouter = Router();

// GET /api/daily-claim-monitor/overview
dailyClaimMonitorRouter.get('/overview', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const startDate = String(req.query.startDate || req.query.date || today).trim();
    const endDate = String(req.query.endDate || req.query.date || startDate).trim();

    const dateVal = validateDateRange(startDate, endDate, 90);
    if (!dateVal.ok) {
      return res.status(400).json({ success: false, error: dateVal.error });
    }

    const report = await getDailyClaimMonitor({
      startDate,
      endDate,
      fund: req.query.fund ? String(req.query.fund) : 'ALL',
      patientType: req.query.patientType ? String(req.query.patientType) : 'ALL',
    });

    return res.json({ success: true, data: report });
  } catch (error) {
    console.error('Error in daily claim monitor:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลมอนิเตอร์งานเคลม',
    });
  }
});
