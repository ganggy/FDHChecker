---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/accountingRevenueRoutes.ts"
source_hash: "58766d5cb0b077eeed1f3e470bb17fdbb3c3c90130d20b3718f68b97c4dfb281"
managed_by: "sync-ksp-vault"
---
# accountingRevenueRoutes.ts

> Source: `server/accountingRevenueRoutes.ts`
> SHA-256: `58766d5cb0b077eeed1f3e470bb17fdbb3c3c90130d20b3718f68b97c4dfb281`

````typescript
import { Router } from 'express';
import { ipdMonthlyAccounting } from './ipdMonthlyAccounting.js';
import { getAccountingRevenueReport } from './accountingRevenueReport.js';

export const accountingRevenueRouter = Router();
accountingRevenueRouter.get('/ipd-monthly', async (req,res) => {
  try { res.json({success:true,data:await ipdMonthlyAccounting(Number(req.query.year))}); }
  catch(error) { res.status(400).json({success:false,error:(error as Error).message}); }
});
accountingRevenueRouter.get('/revenue-budget', async (req, res) => {
  try {
    return res.json({ success: true, data: await getAccountingRevenueReport({ startDate: String(req.query.startDate || ''), endDate: String(req.query.endDate || '') }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานประมาณการรายได้ได้';
    return res.status(/กรุณา/.test(message) ? 400 : 500).json({ success: false, error: message });
  }
});

````
