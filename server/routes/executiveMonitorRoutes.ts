import { Router } from 'express';
import {
  getExecutiveMonitorSummary,
  SERVICE_CATEGORY_LABELS,
  RIGHT_SCHEME_LABELS,
  SERVICE_CATEGORY_ORDER,
  RIGHT_SCHEME_ORDER,
} from '../executiveMonitorService.js';

export const executiveMonitorRouter = Router();

// GET /api/executive-monitor/filter-options
executiveMonitorRouter.get('/filter-options', (_req, res) => {
  const currentThaiYear = new Date().getFullYear() + 543;
  const years = [
    String(currentThaiYear + 1),
    String(currentThaiYear),
    String(currentThaiYear - 1),
    String(currentThaiYear - 2),
    String(currentThaiYear - 3),
  ];

  const serviceCategories = SERVICE_CATEGORY_ORDER.map((key) => ({
    key,
    ...SERVICE_CATEGORY_LABELS[key],
  }));

  const rightSchemes = RIGHT_SCHEME_ORDER.map((key) => ({
    key,
    ...RIGHT_SCHEME_LABELS[key],
  }));

  return res.json({
    success: true,
    data: {
      budgetYears: years,
      serviceCategories,
      rightSchemes,
    },
  });
});

// GET /api/executive-monitor/summary
executiveMonitorRouter.get('/summary', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : undefined;
    const budgetYear = req.query.budgetYear ? String(req.query.budgetYear).trim() : undefined;
    const serviceCategory = req.query.serviceCategory ? String(req.query.serviceCategory).trim() : undefined;
    const rightScheme = req.query.rightScheme ? String(req.query.rightScheme).trim() : undefined;

    const summary = await getExecutiveMonitorSummary({
      startDate,
      endDate,
      budgetYear,
      serviceCategory,
      rightScheme,
    });

    return res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error getting executive monitor summary:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลภาพรวมสำหรับผู้บริหารได้',
    });
  }
});
