import { Router } from 'express';
import {
  getPcuHerbalReconciliation,
  getPcuHerbalDrillDown,
  HERBAL_MASTER_46,
  PCU_CONFIGS,
  getPcuPool,
} from '../pcuHerbalService.js';

export const pcuHerbalRouter = Router();

// GET /api/pcu-herbal/master-items - รายการยาเวชภัณฑ์สมุนไพร 46 รายการ
pcuHerbalRouter.get('/master-items', (_req, res) => {
  return res.json({
    success: true,
    data: HERBAL_MASTER_46,
    pcus: PCU_CONFIGS.map(p => ({ code: p.code, name: p.name, host: p.host })),
  });
});

// GET /api/pcu-herbal/summary - สรุปการจ่ายยา เปรียบเทียบ H-Sub และส่วนแบ่งกำไร
pcuHerbalRouter.get('/summary', async (req, res) => {
  try {
    const hcode = req.query.hcode ? String(req.query.hcode).trim() : undefined;
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : '2025-10-01';
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : '2026-10-31';

    const result = await getPcuHerbalReconciliation({ hcode, startDate, endDate });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[PcuHerbalRoutes] Error fetching summary:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลสรุปจ่ายยาสมุนไพรได้',
    });
  }
});

// GET /api/pcu-herbal/drill-down - รายละเอียดรายการจ่ายยาและผู้ป่วย
pcuHerbalRouter.get('/drill-down', async (req, res) => {
  try {
    const hcode = req.query.hcode ? String(req.query.hcode).trim() : '05570';
    const herbalId = req.query.herbalId ? Number(req.query.herbalId) : undefined;
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : '2025-10-01';
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : '2026-10-31';
    const search = req.query.search ? String(req.query.search).trim() : '';
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const result = await getPcuHerbalDrillDown({
      hcode,
      herbalId,
      startDate,
      endDate,
      search,
      page,
      limit,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[PcuHerbalRoutes] Error fetching drill-down:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลรายละเอียดจ่ายยาได้',
    });
  }
});

// POST /api/pcu-herbal/test-connections - ทดสอบสถานะการเชื่อมต่อ 5 รพ.สต.
pcuHerbalRouter.post('/test-connections', async (_req, res) => {
  const connectionStatuses: any[] = [];
  for (const pcu of PCU_CONFIGS) {
    try {
      const pool = getPcuPool(pcu);
      const [rows]: any = await pool.query('SELECT 1 as ok');
      connectionStatuses.push({
        code: pcu.code,
        name: pcu.name,
        host: pcu.host,
        db: pcu.db,
        connected: Boolean(rows?.[0]?.ok),
      });
    } catch (err: any) {
      connectionStatuses.push({
        code: pcu.code,
        name: pcu.name,
        host: pcu.host,
        db: pcu.db,
        connected: false,
        error: err.message,
      });
    }
  }
  return res.json({ success: true, data: connectionStatuses });
});
