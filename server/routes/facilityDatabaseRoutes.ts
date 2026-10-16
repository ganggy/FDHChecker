import { Router } from 'express';
import {
  readFacilityDatabaseConfigs,
  readFacilityDatabaseConfig,
  saveFacilityDatabaseConfig,
  deleteFacilityDatabaseConfig,
  publicFacilityDatabaseConfig,
  listPublicFacilityDatabaseConfigs,
  normalizeFacilityHcode,
  resolveHospitalDatabaseInput,
  type HospitalDatabaseConfig,
} from '../hospitalDatabaseConfig.js';
import {
  testHospitalDatabase,
  reloadFacilityDatabasePool,
} from '../hospitalDatabase.js';

export function createFacilityDatabaseRouter(deps = {
  readAll: readFacilityDatabaseConfigs,
  readOne: readFacilityDatabaseConfig,
  saveOne: saveFacilityDatabaseConfig,
  deleteOne: deleteFacilityDatabaseConfig,
  listPublic: listPublicFacilityDatabaseConfigs,
  test: testHospitalDatabase,
  reload: reloadFacilityDatabasePool,
}) {
  const router = Router();

  // GET / - List all configured facility databases
  router.get('/', (_req, res) => {
    try {
      const list = deps.listPublic();
      return res.json({ success: true, data: list });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'ไม่สามารถโหลดรายการฐานข้อมูล รพ.สต. ได้' });
    }
  });

  // GET /status - Facility status for the authenticated user
  router.get('/status', (req, res) => {
    const authUser = (req as { authUser?: { hcode?: string | null } }).authUser;
    const hcode = authUser?.hcode || null;
    if (!hcode) {
      return res.json({
        success: true,
        data: {
          isFacility: false,
          hcode: null,
          hasDedicatedDatabase: false,
          mode: 'hospital_main',
        },
      });
    }

    const config = deps.readOne(hcode);
    return res.json({
      success: true,
      data: {
        isFacility: true,
        hcode,
        hasDedicatedDatabase: Boolean(config),
        mode: config ? 'facility_dedicated' : 'hospital_main',
        databaseConfig: config ? publicFacilityDatabaseConfig(hcode, config) : null,
      },
    });
  });

  // GET /:hcode - Get single facility config
  router.get('/:hcode', (req, res) => {
    try {
      const hcode = normalizeFacilityHcode(req.params.hcode);
      if (!hcode) {
        return res.status(400).json({ success: false, error: 'รหัสหน่วยบริการไม่ถูกต้อง (ต้องเป็นตัวเลข 5 หลัก)' });
      }
      const config = deps.readOne(hcode);
      if (!config) {
        return res.status(404).json({ success: false, error: `ไม่พบการตั้งค่าฐานข้อมูลสำหรับรหัส ${hcode}` });
      }
      return res.json({ success: true, data: publicFacilityDatabaseConfig(hcode, config) });
    } catch (error) {
      return res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  // POST /:hcode/test - Test connection
  router.post('/:hcode/test', async (req, res) => {
    try {
      const hcode = normalizeFacilityHcode(req.params.hcode);
      if (!hcode) {
        return res.status(400).json({ success: false, error: 'รหัสหน่วยบริการไม่ถูกต้อง (ต้องเป็นตัวเลข 5 หลัก)' });
      }

      const existing = deps.readOne(hcode);
      const fallback: HospitalDatabaseConfig = {
        type: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        database: 'hos',
        schema: '',
        user: '',
        password: '',
        ssl: false,
      };

      let configToTest: HospitalDatabaseConfig;
      if (req.body && Object.keys(req.body).length > 0) {
        configToTest = resolveHospitalDatabaseInput(req.body, existing || fallback);
      } else if (existing) {
        configToTest = existing;
      } else {
        return res.status(400).json({ success: false, error: 'กรุณาระบุข้อมูลการเชื่อมต่อเพื่อทดสอบ' });
      }

      const result = await deps.test(configToTest);
      return res.json({ success: true, data: result });
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: 'เชื่อมต่อฐานข้อมูล รพ.สต. ไม่สำเร็จ ตรวจสอบ Host, Port, Database, User, Password และสถานะเครือข่าย',
      });
    }
  });

  // POST /:hcode/save - Test and save facility config
  router.post('/:hcode/save', async (req, res) => {
    try {
      const hcode = normalizeFacilityHcode(req.params.hcode);
      if (!hcode) {
        return res.status(400).json({ success: false, error: 'รหัสหน่วยบริการไม่ถูกต้อง (ต้องเป็นตัวเลข 5 หลัก)' });
      }

      const existing = deps.readOne(hcode);
      const fallback: HospitalDatabaseConfig = {
        type: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        database: 'hos',
        schema: '',
        user: '',
        password: '',
        ssl: false,
      };

      const resolved = resolveHospitalDatabaseInput(req.body, existing || fallback);

      // Verify connection before saving
      let testResult;
      try {
        testResult = await deps.test(resolved);
      } catch (err) {
        return res.status(502).json({
          success: false,
          error: 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาตรวจสอบข้อมูลการเชื่อมต่อก่อนบันทึก',
        });
      }

      if (!testResult.compatible) {
        return res.status(422).json({
          success: false,
          error: testResult.message,
          data: testResult,
        });
      }

      deps.saveOne(hcode, resolved);
      await deps.reload(hcode);

      return res.json({
        success: true,
        data: publicFacilityDatabaseConfig(hcode, resolved),
        test: testResult,
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  // DELETE /:hcode - Delete facility config
  router.delete('/:hcode', async (req, res) => {
    try {
      const hcode = normalizeFacilityHcode(req.params.hcode);
      if (!hcode) {
        return res.status(400).json({ success: false, error: 'รหัสหน่วยบริการไม่ถูกต้อง (ต้องเป็นตัวเลข 5 หลัก)' });
      }

      const deleted = deps.deleteOne(hcode);
      if (deleted) {
        await deps.reload(hcode);
      }
      return res.json({ success: true, deleted });
    } catch (error) {
      return res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  return router;
}
