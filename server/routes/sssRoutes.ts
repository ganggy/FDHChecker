import { Router } from 'express';
import type { Request } from 'express';
import businessRules from '../config/business_rules.json';
import { validateDateRange } from '../requestSafety.js';
import {
  autoFixSssCandidates,
  autoFixSssErrorCases,
  buildSssExportZip,
  getSssBatchSettings,
  getSssCandidates,
  getSssErrorCases,
  getSssImportHistory,
  importSssResponseRows,
  resubmitSssErrorCases,
  saveSssClaimOverride,
  updateSssBatchSettings,
  type SssNetworkType,
} from '../sssClaim.js';
import { buildSssIpdExportZip, getSssIpdCandidates } from '../sssIpdClaim.js';
import { readHospitalIdentity } from '../siteProfile.js';
import { getUTFConnection } from '../db.js';

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

const resolveHospitalIdentity = async () => {
  const conn = await getUTFConnection();
  try {
    const his = await readHospitalIdentity(conn).catch(() => ({ hospital_code: '', hospital_name: '' }));
    const siteSettings = (businessRules as { site_settings?: { hospital_code?: string; hospital_name?: string } }).site_settings || {};
    return {
      hcode: String(his.hospital_code || process.env.HOSXP_HCODE || siteSettings.hospital_code || '11101').trim(),
      hospitalName: String(his.hospital_name || siteSettings.hospital_name || 'โรงพยาบาลโคกศรีสุพรรณ').trim(),
    };
  } finally {
    conn.release();
  }
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

sssRouter.post('/candidates/auto-fix', async (req, res) => {
  try {
    const startDate = String(req.body?.startDate || '').trim();
    const endDate = String(req.body?.endDate || '').trim();
    const dateValidation = validateDateRange(startDate, endDate, 366);
    if (!dateValidation.ok) return res.status(400).json({ success: false, error: dateValidation.error });
    const vns = Array.isArray(req.body?.vns) ? req.body.vns.map(String).map((v: string) => v.trim()).filter(Boolean) : undefined;
    const summary = await autoFixSssCandidates({
      startDate,
      endDate,
      networkType: normalizeNetworkType(req.body?.networkType),
      vns,
      updatedBy: (req as AuthenticatedRequest).authUser?.username || 'AutoFix',
    });
    return res.json({
      success: true,
      data: summary,
      message: `Auto-Fix ก่อนส่งสำเร็จ ${summary.fixedCount} รายการ${summary.manualRequiredCount > 0 ? ` (มี ${summary.manualRequiredCount} รายการที่ต้องกดแก้ไขเพิ่มเติม)` : ''}`,
    });
  } catch (error) {
    console.error('Error in SSS candidate auto-fix:', error);
    return res.status(500).json({ success: false, error: (error as Error).message || 'Auto-Fix ก่อนส่งไม่สำเร็จ' });
  }
});

sssRouter.get('/export-config', async (_req, res) => {
  try {
    const identity = await resolveHospitalIdentity();
    const config = await getSssBatchSettings();
    return res.json({
      success: true,
      hcode: identity.hcode,
      hospitalName: identity.hospitalName,
      ssop: {
        lastBatchNo: config.last_ssop_batch,
        nextBatchNo: config.last_ssop_batch + 1,
      },
      aipn: {
        lastBatchNo: config.last_aipn_batch,
        nextBatchNo: config.last_aipn_batch + 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

sssRouter.put('/export-config', async (req, res) => {
  try {
    const { ssopBatchNo, aipnBatchNo } = req.body || {};
    const updated = await updateSssBatchSettings({
      last_ssop_batch: ssopBatchNo != null ? Number(ssopBatchNo) : undefined,
      last_aipn_batch: aipnBatchNo != null ? Number(aipnBatchNo) : undefined,
    });
    return res.json({ success: true, data: updated, message: 'บันทึกเลขงวดสำเร็จ' });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
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
    const identity = await resolveHospitalIdentity();
    const result = await buildSssExportZip({
      startDate,
      endDate,
      networkType: normalizeNetworkType(req.body?.networkType),
      vns,
      batchNo: req.body?.batchNo,
      tflag: req.body?.tflag === 'E' ? 'E' : 'A',
      exportedBy: (req as AuthenticatedRequest).authUser?.username || 'Staff',
      ...identity,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-SSS-Visit-Count', String(result.summary.visitCount));
    res.setHeader('X-SSS-Batch-No', String(result.summary.batchNo));
    return res.send(result.buffer);
  } catch (error) {
    console.error('Error exporting SSS SSOP:', error);
    return res.status(422).json({ success: false, error: (error as Error).message || 'ส่งออก SSOP ไม่สำเร็จ' });
  }
});

sssRouter.get('/error-cases', async (req, res) => {
  try {
    const batchId = req.query.batchId ? Number(req.query.batchId) : undefined;
    const rows = await getSssErrorCases(batchId && Number.isFinite(batchId) ? batchId : undefined);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error loading SSS error cases:', error);
    return res.status(500).json({ success: false, error: (error as Error).message || 'โหลดรายการ Error ไม่สำเร็จ' });
  }
});

sssRouter.post('/error-cases/override', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.vn) return res.status(400).json({ success: false, error: 'กรุณาระบุ VN' });
    const result = await saveSssClaimOverride({
      vn: String(body.vn),
      invoice_no: body.invoice_no != null ? String(body.invoice_no) : undefined,
      clinic: body.clinic != null ? String(body.clinic) : undefined,
      doctor_license: body.doctor_license != null ? String(body.doctor_license) : undefined,
      hospmain: body.hospmain != null ? String(body.hospmain) : undefined,
      pdx: body.pdx != null ? String(body.pdx) : undefined,
      end_datetime: body.end_datetime != null ? String(body.end_datetime) : undefined,
      tflag: body.tflag === 'A' ? 'A' : 'E',
      note: body.note != null ? String(body.note) : undefined,
      updatedBy: (req as AuthenticatedRequest).authUser?.username || 'Staff',
    });
    return res.json({ success: true, data: result, message: 'บันทึกการแก้ไขข้อมูลเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error saving SSS override:', error);
    return res.status(400).json({ success: false, error: (error as Error).message || 'บันทึกการแก้ไขไม่สำเร็จ' });
  }
});

sssRouter.post('/error-cases/auto-fix', async (req, res) => {
  try {
    const batchId = req.body?.batchId && req.body.batchId !== 'ALL' ? Number(req.body.batchId) : undefined;
    const summary = await autoFixSssErrorCases(
      batchId && Number.isFinite(batchId) ? batchId : undefined,
      (req as AuthenticatedRequest).authUser?.username || 'AutoFix',
    );
    return res.json({
      success: true,
      data: summary,
      message: `แก้ไข Auto สำเร็จ ${summary.fixedCount} เคส${summary.manualRequiredCount > 0 ? ` (มี ${summary.manualRequiredCount} เคสที่ต้องตรวจ HospMain/สิทธิเพิ่มเติม)` : ''}`,
    });
  } catch (error) {
    console.error('Error in SSS auto-fix:', error);
    return res.status(500).json({ success: false, error: (error as Error).message || 'Auto-Fix ไม่สำเร็จ' });
  }
});

sssRouter.post('/error-cases/export', async (req, res) => {
  try {
    const vns = Array.isArray(req.body?.vns) ? req.body.vns.map(String).map((v: string) => v.trim()).filter(Boolean) : [];
    if (!vns.length || vns.length > 5000) return res.status(400).json({ success: false, error: 'กรุณาเลือก 1-5,000 รายการที่ต้องการส่งออกซ้ำ' });
    const identity = await resolveHospitalIdentity();
    const result = await resubmitSssErrorCases({
      vns,
      batchNo: req.body?.batchNo,
      tflag: req.body?.tflag === 'A' ? 'A' : 'E',
      exportedBy: (req as AuthenticatedRequest).authUser?.username || 'Staff',
      ...identity,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-SSS-Visit-Count', String(result.summary.visitCount));
    res.setHeader('X-SSS-Batch-No', String(result.summary.batchNo));
    return res.send(result.buffer);
  } catch (error) {
    console.error('Error resubmitting SSS error cases:', error);
    return res.status(422).json({ success: false, error: (error as Error).message || 'ส่งออกรายการแก้ไขไม่สำเร็จ' });
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
    const identity = await resolveHospitalIdentity();
    const result = await buildSssIpdExportZip({
      startDate,
      endDate,
      networkType: normalizeNetworkType(req.body?.networkType),
      ans,
      batchNo: req.body?.batchNo,
      ...identity,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-SSS-Admission-Count', String(result.summary.admissionCount));
    res.setHeader('X-SSS-Batch-No', String(result.summary.batchNo));
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
