import { Router } from 'express';
import { runHospitalReport, type HospitalReportRequest } from './hospitalReportTools.js';

export const hospitalReportRouter = Router();

hospitalReportRouter.post('/run', async (req, res) => {
  try {
    return res.json({ success: true, data: await runHospitalReport(req.body as HospitalReportRequest) });
  } catch (error) {
    const message = (error as Error).message;
    const validation = /กรุณา|ไม่พบ|ยังไม่พร้อม|ต้องไม่เกิน/.test(message);
    return res.status(validation ? 400 : 503).json({ success: false, error: message });
  }
});
