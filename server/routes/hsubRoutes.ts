import { Router } from 'express';
import {
  importHsubDirectory,
  importHsubRawData,
  getHsubDashboardSummary,
  getHsubTransactions,
  getHsubBatches,
} from '../hsubService.js';

export const hsubRouter = Router();

// GET /api/hsub/summary
hsubRouter.get('/summary', async (req, res) => {
  try {
    const hcode = req.query.hcode ? String(req.query.hcode).trim() : undefined;
    const rep = req.query.rep ? String(req.query.rep).trim() : undefined;
    const budgetYear = req.query.budgetYear ? String(req.query.budgetYear).trim() : undefined;

    const summary = await getHsubDashboardSummary({ hcode, rep, budgetYear });
    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[HsubRoutes] Error fetching H-Sub summary:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลสรุปพึงจ่าย รพ.สต. ได้',
    });
  }
});

// POST /api/hsub/import-dir
hsubRouter.post('/import-dir', async (req, res) => {
  try {
    const dir = req.body?.dir ? String(req.body.dir).trim() : undefined;
    const result = await importHsubDirectory(dir);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[HsubRoutes] Error importing H-Sub files:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'นำเข้าไฟล์พึงจ่าย รพ.สต. ล้มเหลว',
    });
  }
});

// POST /api/hsub/import-raw
hsubRouter.post('/import-raw', async (req, res) => {
  try {
    if (Array.isArray(req.body?.files)) {
      const results: any[] = [];
      let totalRecs = 0;
      let totalClaim = 0;
      let totalPaid = 0;
      for (const f of req.body.files) {
        if (!f.filename || !Array.isArray(f.data)) continue;
        const r = await importHsubRawData(String(f.filename), f.data);
        results.push(r);
        totalRecs += r.records;
        totalClaim += r.claim;
        totalPaid += r.paid;
      }
      return res.json({
        success: true,
        data: {
          imported_files: results.length,
          total_records: totalRecs,
          total_claim: totalClaim,
          total_paid: totalPaid,
          files: results,
        },
      });
    }

    const filename = req.body?.filename ? String(req.body.filename).trim() : 'uploaded_report.xls';
    const data = req.body?.data;
    if (!Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง (ต้องมี data array)' });
    }

    const result = await importHsubRawData(filename, data);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[HsubRoutes] Error importing raw H-Sub data:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'นำเข้าข้อมูลไฟล์ล้มเหลว',
    });
  }
});

// GET /api/hsub/transactions
hsubRouter.get('/transactions', async (req, res) => {
  try {
    const hcode = req.query.hcode ? String(req.query.hcode).trim() : undefined;
    const rep = req.query.rep ? String(req.query.rep).trim() : undefined;
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const result = await getHsubTransactions({ hcode, rep, search, page, limit });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[HsubRoutes] Error fetching H-Sub transactions:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงรายการธุรกรรม รพ.สต. ได้',
    });
  }
});

// GET /api/hsub/batches
hsubRouter.get('/batches', async (_req, res) => {
  try {
    const batches = await getHsubBatches();
    return res.json({ success: true, data: batches });
  } catch (error) {
    console.error('[HsubRoutes] Error fetching H-Sub batches:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงรายการไฟล์ที่นำเข้าได้',
    });
  }
});
