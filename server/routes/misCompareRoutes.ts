import { Router } from 'express';
import {
  getMisCompareCatalog,
  getMisCompareOverview,
  getMisComparePage,
} from '../misHosCompareService.js';

export const misCompareRouter = Router();

const getDefaultFiscalYearBe = (): string => {
  const now = new Date();
  return String(now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0));
};

// GET /api/mis-compare/catalog
misCompareRouter.get('/catalog', async (_req, res) => {
  try {
    const data = await getMisCompareCatalog();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching MIS compare catalog:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถโหลดรายการหน้า MIS HOS ได้',
    });
  }
});

// GET /api/mis-compare/overview
misCompareRouter.get('/overview', async (req, res) => {
  try {
    const budgetYear = String(req.query.budgetYear || getDefaultFiscalYearBe()).trim();
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const matchCutoff = req.query.matchCutoff !== '0' && req.query.matchCutoff !== 'false';
    const data = await getMisCompareOverview({ budgetYear, refresh, matchCutoff });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching MIS compare overview:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถเปรียบเทียบ Dashboard ภาพรวม MIS HOS ได้',
    });
  }
});

// GET /api/mis-compare/page/:pageKey
misCompareRouter.get('/page/:pageKey', async (req, res) => {
  try {
    const pageKey = String(req.params.pageKey || '').trim();
    const budgetYear = String(req.query.budgetYear || getDefaultFiscalYearBe()).trim();
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const matchCutoff = req.query.matchCutoff !== '0' && req.query.matchCutoff !== 'false';
    const data = await getMisComparePage({ pageKey, budgetYear, refresh, matchCutoff });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching MIS compare page:', error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลหน้านี้จาก MIS HOS ได้',
    });
  }
});
