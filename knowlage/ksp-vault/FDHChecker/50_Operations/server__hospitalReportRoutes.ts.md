---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/hospitalReportRoutes.ts"
source_hash: "3ce29d861927c9338bbec0ee5456a7e493d81117c12b9b41acdd44e92ae6cdd1"
managed_by: "sync-ksp-vault"
---
# hospitalReportRoutes.ts

> Source: `server/hospitalReportRoutes.ts`
> SHA-256: `3ce29d861927c9338bbec0ee5456a7e493d81117c12b9b41acdd44e92ae6cdd1`

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
