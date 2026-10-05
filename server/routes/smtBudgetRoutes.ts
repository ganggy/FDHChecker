import { Router } from 'express';
import { syncSmtTransfers, getSmtBudgetSummary } from '../smtBudgetService.js';

export const smtBudgetRouter = Router();

// GET /api/smt-budget/years
smtBudgetRouter.get('/years', (_req, res) => {
  const currentThaiYear = new Date().getFullYear() + 543;
  const years = [
    String(currentThaiYear + 1),
    String(currentThaiYear),
    String(currentThaiYear - 1),
    String(currentThaiYear - 2),
    String(currentThaiYear - 3),
  ];
  return res.json({ success: true, data: years });
});

// GET /api/smt-budget/summary
smtBudgetRouter.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const defaultYear = String(now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0));
    const budgetYear = String(req.query.budgetYear || defaultYear).trim();

    const summary = await getSmtBudgetSummary(budgetYear);
    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error fetching SMT budget summary:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลสรุปงบประมาณ SMT ได้',
    });
  }
});

// POST /api/smt-budget/sync
smtBudgetRouter.post('/sync', async (req, res) => {
  try {
    const budgetYear = req.body?.budgetYear ? String(req.body.budgetYear).trim() : undefined;
    const result = await syncSmtTransfers(budgetYear);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error syncing SMT transfers:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เชื่อมต่อดึงข้อมูลจาก SMT สปสช. ล้มเหลว',
    });
  }
});
