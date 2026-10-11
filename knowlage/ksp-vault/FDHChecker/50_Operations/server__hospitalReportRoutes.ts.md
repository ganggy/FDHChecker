---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/hospitalReportRoutes.ts"
source_hash: "59485229ee60794a5f8a8ee2cb3f477c3fde8d1c441c1d44c44c2a6ba1d88290"
managed_by: "sync-ksp-vault"
---
# hospitalReportRoutes.ts

> Source: `server/hospitalReportRoutes.ts`
> SHA-256: `59485229ee60794a5f8a8ee2cb3f477c3fde8d1c441c1d44c44c2a6ba1d88290`

````typescript
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

````
