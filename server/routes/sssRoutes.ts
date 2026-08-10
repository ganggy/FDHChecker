import { Router } from 'express';
import type { Request } from 'express';
import businessRules from '../config/business_rules.json';
import { validateDateRange } from '../requestSafety.js';
import {
  buildSssExportZip,
  getSssCandidates,
  getSssImportHistory,
  importSssResponseRows,
  type SssNetworkType,
} from '../sssClaim.js';
import { buildSssIpdExportZip, getSssIpdCandidates } from '../sssIpdClaim.js';

type AuthenticatedRequest = Request & {
  authUser?: { username?: string | null; display_name?: string | null };
};

const normalizeNetworkType = (value: unknown): SssNetworkType => {
  const normalized = String(value || 'ALL').trim().toUpperCase();
  return normalized === 'IN' || normalized === 'OUT' ? normalized : 'ALL';
};

const summarizeCandidates = (rows: Array<{
  network_type: string;
  validation_status: 'ready' | 'warning' | 'error';
  income?: unknown;
}>) => rows.reduce((summary, row) => {
  summary.total += 1;
  summary[row.network_type === 'OUT' ? 'outNetwork' : 'inNetwork'] += 1;
  summary[row.validation_status] += 1;
  summary.amount += Number(row.income || 0);
  return summary;
}, { total: 0, inNetwork: 0, outNetwork: 0, ready: 0, warning: 0, error: 0, amount: 0 });

const resolveHospitalIdentity = () => {
  const siteSettings = (businessRules as { site_settings?: { hospital_code?: string; hospital_name?: string } }).site_settings || {};
  return {
    hcode: String(process.env.HOSXP_HCODE || siteSettings.hospital_code || '').trim(),
    hospitalName: String(siteSettings.hospital_name || 'โรงพยาบาล').trim(),
  };
};

export const sssRouter = Router();

sssRouter.get('/candidates', async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    if (!startDate || !endDate) return res.status(400).json({ success: false, error: 'กรุณาระบุช่วงวันที่' });
    const data = await getSssCandidates({ startDate, endDate, networkType: normalizeNetworkType(req.query.networkType) });
    return res.json({ success: true, data, summary: summarizeCandidates(data), closePrivilegeCheck: false });
  } catch (error) {
    console.error('Error loading SSS export candidates:', error);
    return res.status(500).json({ success: false, error: 'โหลดรายการสิทธิ์ประกันสังคมไม่สำเร็จ' });
  }
});

sssRouter.post('/export', async (req, res) => {
  try {
    const startDate = String(req.body?.startDate || '').trim();
    const endDate = String(req.body?.endDate || '').trim();
    const vns = Array.isArray(req.body?.vns) ? req.body.vns.map(String).map((value: string) => value.trim()).filter(Boolean) : [];
    const dateValidation = validateDateRange(startDate, endDate, 366);
    if (!dateValidation.ok) return res.status(400).json({ success: false, error: dateValidation.error });
    if (!vns.length || vns.length > 5000) return res.status(400).json({ success: false, error: 'กรุณาเลือก 1-5,000 รายการ' });
    const result = await buildSssExportZip({
      startDate,
      endDate,
      networkType: normalizeNetworkType(req.body?.networkType),
      vns,
      ...resolveHospitalIdentity(),
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-SSS-Visit-Count', String(result.summary.visitCount));
    return res.send(result.buffer);
  } catch (error) {
    console.error('Error exporting SSS SSOP:', error);
    return res.status(422).json({ success: false, error: (error as Error).message || 'ส่งออก SSOP ไม่สำเร็จ' });
  }
});

sssRouter.get('/ipd/candidates', async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    if (!startDate || !endDate) return res.status(400).json({ success: false, error: 'กรุณาระบุช่วงวันที่จำหน่าย' });
    const data = await getSssIpdCandidates({ startDate, endDate, networkType: normalizeNetworkType(req.query.networkType) });
    return res.json({ success: true, data, summary: summarizeCandidates(data), format: 'AIPN-2.1', closePrivilegeCheck: false });
  } catch (error) {
    console.error('Error loading SSS IPD candidates:', error);
    return res.status(500).json({ success: false, error: 'โหลดรายการผู้ป่วยในประกันสังคมไม่สำเร็จ' });
  }
});

sssRouter.post('/ipd/export', async (req, res) => {
  try {
    const startDate = String(req.body?.startDate || '').trim();
    const endDate = String(req.body?.endDate || '').trim();
    const ans = Array.isArray(req.body?.ans) ? req.body.ans.map(String).map((value: string) => value.trim()).filter(Boolean) : [];
    const dateValidation = validateDateRange(startDate, endDate, 366);
    if (!dateValidation.ok) return res.status(400).json({ success: false, error: dateValidation.error });
    if (!ans.length || ans.length > 1000) return res.status(400).json({ success: false, error: 'กรุณาเลือก 1-1,000 AN' });
    const result = await buildSssIpdExportZip({
      startDate,
      endDate,
      networkType: normalizeNetworkType(req.body?.networkType),
      ans,
      ...resolveHospitalIdentity(),
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-SSS-Admission-Count', String(result.summary.admissionCount));
    return res.send(result.buffer);
  } catch (error) {
    console.error('Error exporting SSS AIPN:', error);
    return res.status(422).json({ success: false, error: (error as Error).message || 'ส่งออก AIPN ไม่สำเร็จ' });
  }
});

sssRouter.post('/repstm/import', async (req: AuthenticatedRequest, res) => {
  try {
    const importType = String(req.body?.importType || '').toUpperCase();
    if (!['REP', 'STM'].includes(importType)) return res.status(400).json({ success: false, error: 'ประเภทไฟล์ต้องเป็น REP หรือ STM' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const actor = String(req.authUser?.display_name || req.authUser?.username || '').trim();
    const result = await importSssResponseRows({
      importType: importType as 'REP' | 'STM',
      sourceFilename: String(req.body?.sourceFilename || '').trim() || `${importType}.txt`,
      networkType: normalizeNetworkType(req.body?.networkType),
      importedBy: actor || undefined,
      notes: String(req.body?.notes || '').trim() || undefined,
      rows,
    });
    return res.json({ success: true, ...result, message: result.duplicate ? 'ข้อมูลชุดนี้ถูกนำเข้าแล้ว' : `นำเข้า ${importType} สำเร็จ` });
  } catch (error) {
    console.error('Error importing SSS REP/STM:', error);
    return res.status(500).json({ success: false, error: (error as Error).message || 'นำเข้า REP/STM ประกันสังคมไม่สำเร็จ' });
  }
});

sssRouter.get('/repstm/history', async (req, res) => {
  try {
    const data = await getSssImportHistory(Number(req.query.limit || 30));
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading SSS REP/STM history:', error);
    return res.status(500).json({ success: false, error: 'โหลดประวัตินำเข้า REP/STM ประกันสังคมไม่สำเร็จ' });
  }
});
