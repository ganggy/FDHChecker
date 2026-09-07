import { Router } from 'express';
import {
  activeHospitalDatabaseConfig, testHospitalDatabase,
} from '../hospitalDatabase.js';
import {
  readHospitalDatabaseConfig, publicHospitalDatabaseConfig, resolveHospitalDatabaseInput, saveHospitalDatabaseConfig,
} from '../hospitalDatabaseConfig.js';

// Mount behind requireAdmin: both reads and connection tests contain infrastructure data.
export function createHospitalDatabaseRouter(deps = {
  read: readHospitalDatabaseConfig, test: testHospitalDatabase, save: saveHospitalDatabaseConfig,
  active: activeHospitalDatabaseConfig,
}) {
  const router = Router();
  router.get('/', (_req, res) => {
    try {
      const saved = deps.read();
      return res.json({ success: true, data: publicHospitalDatabaseConfig(saved), active: publicHospitalDatabaseConfig(deps.active),
        restartRequired: JSON.stringify(saved) !== JSON.stringify(deps.active) });
    } catch { return res.status(500).json({ success: false, error: 'อ่านค่าการเชื่อมต่อไม่สำเร็จ กรุณาตรวจไฟล์ตั้งค่าที่เซิร์ฟเวอร์' }); }
  });
  for (const action of ['test', 'save']) {
    router.post(`/${action}`, async (req, res) => {
      let config;
      try { config = resolveHospitalDatabaseInput(req.body, deps.read()); }
      catch (error) { return res.status(400).json({ success: false, error: (error as Error).message }); }
      let result;
      try { result = await deps.test(config); }
      catch {
        // Driver errors can contain usernames, server addresses, SQL, or secret values.
        return res.status(502).json({ success: false, error: 'เชื่อมต่อไม่สำเร็จ ตรวจ Host, Port, ชื่อฐานข้อมูล, บัญชี, SSL และสิทธิ์อ่านตาราง' });
      }
      if (action === 'save') {
        if (!result.compatible) return res.status(422).json({ success: false, error: result.message, data: result });
        try { deps.save(config); }
        catch { return res.status(500).json({ success: false, error: 'บันทึกค่าการเชื่อมต่อไม่สำเร็จ ตรวจสิทธิ์เขียนไฟล์ตั้งค่าที่เซิร์ฟเวอร์' }); }
      }
      return res.json({ success: true, data: result, restartRequired: action === 'save' && JSON.stringify(config) !== JSON.stringify(deps.active) });
    });
  }
  return router;
}
