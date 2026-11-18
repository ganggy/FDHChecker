import { Router } from 'express';
import type { Request } from 'express';
import { syncSmtTransfers, getSmtBudgetSummary } from '../smtBudgetService.js';
import {
  clickSmtBrowserAt,
  closeSmtBrowserSession,
  getSmtBrowserStatus,
  openSmtBrowserSession,
  runSmtAutoDownload,
} from '../smtDownloadService.js';

type AuthenticatedRequest = Request & {
  authUser?: { username?: string | null };
};

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

// GET /api/smt-budget/browser-status
smtBudgetRouter.get('/browser-status', async (_req, res) => {
  try {
    const status = await getSmtBrowserStatus();
    return res.json({ success: true, data: status });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/smt-budget/browser-open
smtBudgetRouter.post('/browser-open', async (_req, res) => {
  try {
    const status = await openSmtBrowserSession();
    return res.json({ success: true, data: status });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/smt-budget/browser-click
smtBudgetRouter.post('/browser-click', async (req, res) => {
  try {
    const x = Number(req.body?.x);
    const y = Number(req.body?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ success: false, error: 'พิกัดไม่ถูกต้อง' });
    }
    const status = await clickSmtBrowserAt(x, y);
    return res.json({ success: true, data: status });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/smt-budget/browser-close
smtBudgetRouter.post('/browser-close', async (_req, res) => {
  try {
    await closeSmtBrowserSession();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/smt-budget/auto-download
smtBudgetRouter.post('/auto-download', async (req, res) => {
  try {
    const now = new Date();
    const defaultYear = String(now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0));
    const budgetYear = String(req.body?.budgetYear || defaultYear).trim();
    const actor = (req as AuthenticatedRequest).authUser?.username || 'SMT-Auto';
    void runSmtAutoDownload(budgetYear, actor);
    return res.json({ success: true, message: 'เริ่มดาวน์โหลดไฟล์รายตัวจาก SMT แล้ว' });
  } catch (error) {
    return res.status(400).json({ success: false, error: (error as Error).message });
  }
});
