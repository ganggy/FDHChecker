import { Router } from 'express';
import {
  getPcuHerbalReconciliation,
  getPcuHerbalDrillDown,
  HERBAL_MASTER_46,
  getActivePcuConfigs,
  savePcuConfigs,
  DEFAULT_PCU_CONFIGS,
  testSinglePcuConnection,
  type PcuConfig,
} from '../pcuHerbalService.js';

export const pcuHerbalRouter = Router();

// GET /api/pcu-herbal/master-items - รายการยาเวชภัณฑ์สมุนไพร 46 รายการ
pcuHerbalRouter.get('/master-items', async (_req, res) => {
  const pcus = await getActivePcuConfigs();
  return res.json({
    success: true,
    data: HERBAL_MASTER_46,
    pcus: pcus.map(p => ({ code: p.code, name: p.name, host: p.host })),
  });
});

// GET /api/pcu-herbal/config - ดูค่าคอนฟิกการเชื่อมต่อ รพ.สต.
pcuHerbalRouter.get('/config', async (_req, res) => {
  try {
    const configs = await getActivePcuConfigs();
    return res.json({
      success: true,
      data: configs,
      defaults: DEFAULT_PCU_CONFIGS,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงการตั้งค่าได้',
    });
  }
});

// POST /api/pcu-herbal/config - บันทึกค่าคอนฟิกการเชื่อมต่อ รพ.สต.
pcuHerbalRouter.post('/config', async (req, res) => {
  try {
    const { configs } = req.body as { configs: PcuConfig[] };
    if (!Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json({ success: false, error: 'ข้อมูลการตั้งค่าไม่ถูกต้อง' });
    }
    await savePcuConfigs(configs);
    return res.json({ success: true, message: 'บันทึกการตั้งค่าการเชื่อมต่อ รพ.สต. สำเร็จ' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถบันทึกการตั้งค่าได้',
    });
  }
});

// POST /api/pcu-herbal/test-single - ทดสอบการเชื่อมต่อ รพ.สต. แห่งเดียว
pcuHerbalRouter.post('/test-single', async (req, res) => {
  try {
    const config = req.body as PcuConfig;
    if (!config || !config.host) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุข้อมูลการเชื่อมต่อ' });
    }
    const result = await testSinglePcuConnection(config);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ทดสอบการเชื่อมต่อล้มเหลว',
    });
  }
});

// POST /api/pcu-herbal/test-connections - ทดสอบสถานะการเชื่อมต่อทั้งหมด
pcuHerbalRouter.post('/test-connections', async (req, res) => {
  try {
    const targetConfigs: PcuConfig[] = (req.body?.configs && Array.isArray(req.body.configs) && req.body.configs.length > 0)
      ? req.body.configs
      : await getActivePcuConfigs();

    const connectionStatuses = await Promise.all(
      targetConfigs.map(pcu => testSinglePcuConnection(pcu))
    );

    return res.json({ success: true, data: connectionStatuses });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถทดสอบการเชื่อมต่อได้',
    });
  }
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
