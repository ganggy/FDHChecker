import { Router } from 'express';
import { getAccountingRevenueReport } from './accountingRevenueReport.js';

export const accountingRevenueRouter = Router();
accountingRevenueRouter.get('/revenue-budget', async (req, res) => {
  try {
    return res.json({ success: true, data: await getAccountingRevenueReport({ startDate: String(req.query.startDate || ''), endDate: String(req.query.endDate || '') }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานประมาณการรายได้ได้';
    return res.status(/กรุณา/.test(message) ? 400 : 500).json({ success: false, error: message });
  }
});
