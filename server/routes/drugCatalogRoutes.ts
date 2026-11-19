import { Router } from 'express';
import type { Request } from 'express';
import {
  buildDrugCatalogExcelBuffer,
  buildDrugCatalogXmlZip,
  getDrugCatalogItems,
  saveDrugCatalogOverride,
} from '../drugCatalogService.js';

type AuthenticatedRequest = Request & {
  authUser?: { username?: string | null };
};

export const drugCatalogRouter = Router();

drugCatalogRouter.get('/items', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1';
    const result = await getDrugCatalogItems({ includeInactive });
    return res.json({ success: true, data: result.items, summary: result.summary });
  } catch (error) {
    console.error('Error loading DrugCatalog items:', error);
    return res.status(500).json({ success: false, error: (error as Error).message || 'โหลดรายการ DrugCatalog ไม่สำเร็จ' });
  }
});

drugCatalogRouter.post('/override', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.HospDrugCode) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสยา (HospDrugCode)' });
    }
    const result = await saveDrugCatalogOverride({
      ...body,
      updatedBy: (req as AuthenticatedRequest).authUser?.username || 'Staff',
    });
    return res.json({ success: true, data: result, message: 'บันทึกการแก้ไขรายการยาเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error saving DrugCatalog override:', error);
    return res.status(400).json({ success: false, error: (error as Error).message || 'บันทึกการแก้ไขไม่สำเร็จ' });
  }
});

drugCatalogRouter.post('/export', async (req, res) => {
  try {
    const format = String(req.body?.format || 'excel').toLowerCase();
    const includeInactive = Boolean(req.body?.includeInactive);
    const codes: string[] = Array.isArray(req.body?.codes)
      ? req.body.codes.map(String).map((s: string) => s.trim()).filter(Boolean)
      : [];

    const { items } = await getDrugCatalogItems({ includeInactive });
    const selected = codes.length > 0 ? items.filter((it) => codes.includes(it.HospDrugCode)) : items;
    if (selected.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่พบรายการยาที่ต้องการส่งออก' });
    }

    if (format === 'xml' || format === 'zip') {
      const zipRes = await buildDrugCatalogXmlZip(selected);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipRes.filename}"`);
      return res.send(zipRes.buffer);
    }

    const buf = buildDrugCatalogExcelBuffer(selected);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `DrugCatalog_${today}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error) {
    console.error('Error exporting DrugCatalog:', error);
    return res.status(500).json({ success: false, error: (error as Error).message || 'ส่งออก DrugCatalog ไม่สำเร็จ' });
  }
});
