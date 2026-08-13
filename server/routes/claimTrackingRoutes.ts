import { Router } from 'express';
import {
  bulkUpsertWorkQueue,
  getRejectTrackingItems,
  getWorkQueueItems,
  upsertRejectNote,
  upsertWorkQueueItem,
} from '../db.js';
import { boundedInteger } from '../httpClient.js';

export const claimTrackingRouter = Router();

claimTrackingRouter.get('/work-queue', async (req, res) => {
  try {
    const { status, startDate, endDate, fund, search } = req.query;
    const items = await getWorkQueueItems({
      status: status ? String(status) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      fund: fund ? String(fund) : undefined,
      search: search ? String(search) : undefined,
      limit: boundedInteger(req.query.limit, 500, 1, 2_000),
    });
    res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    console.error('GET /api/work-queue error:', error);
    res.status(500).json({ success: false, error: 'โหลดข้อมูล Work Queue ไม่สำเร็จ' });
  }
});

claimTrackingRouter.put('/work-queue/:vn', async (req, res) => {
  try {
    const vn = String(req.params.vn || '').trim();
    if (!vn) return res.status(400).json({ success: false, error: 'VN ไม่ถูกต้อง' });
    const { queueStatus, assignedTo, notes } = req.body as Record<string, string>;
    const result = await upsertWorkQueueItem({ vn, queueStatus, assignedTo, notes });
    return res.json(result);
  } catch (error) {
    console.error('PUT /api/work-queue error:', error);
    return res.status(500).json({ success: false, error: 'อัปเดต Work Queue ไม่สำเร็จ' });
  }
});

claimTrackingRouter.post('/work-queue/bulk', async (req, res) => {
  try {
    const { items } = req.body as { items: Array<Record<string, unknown>> };
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่พบรายการที่จะเพิ่ม' });
    }
    if (items.length > 2_000) {
      return res.status(400).json({ success: false, error: 'เพิ่ม Work Queue ได้ไม่เกิน 2,000 รายการต่อครั้ง' });
    }
    const mapped = items.map((item) => ({
      vn: String(item.vn || item.vstId || ''),
      hn: String(item.hn || ''),
      patientName: String(item.patient_name || item.patientName || ''),
      fund: String(item.maininscl || item.fund || ''),
      serviceDate: String(item.vstdate || item.serviceDate || '').slice(0, 10),
    }));
    const result = await bulkUpsertWorkQueue(mapped);
    return res.json(result);
  } catch (error) {
    console.error('POST /api/work-queue/bulk error:', error);
    return res.status(500).json({ success: false, error: 'เพิ่ม Work Queue ไม่สำเร็จ' });
  }
});

claimTrackingRouter.get('/reject-tracking', async (req, res) => {
  try {
    const { startDate, endDate, errorcode, resolveStatus, fund, search } = req.query;
    const items = await getRejectTrackingItems({
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      errorcode: errorcode ? String(errorcode) : undefined,
      resolveStatus: resolveStatus ? String(resolveStatus) : undefined,
      fund: fund ? String(fund) : undefined,
      search: search ? String(search) : undefined,
      limit: boundedInteger(req.query.limit, 500, 1, 2_000),
    });
    res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    console.error('GET /api/reject-tracking error:', error);
    res.status(500).json({ success: false, error: 'โหลดข้อมูล Reject Tracking ไม่สำเร็จ' });
  }
});

claimTrackingRouter.post('/reject-tracking/note', async (req, res) => {
  try {
    const { repDataId, tranId, vn, an, hn, errorcode, verifycode, resolveStatus, note, assignedTo } = req.body as Record<string, unknown>;
    if (!resolveStatus) return res.status(400).json({ success: false, error: 'resolveStatus จำเป็น' });
    const result = await upsertRejectNote({
      repDataId: repDataId ? Number(repDataId) : undefined,
      tranId: tranId ? String(tranId) : undefined,
      vn: vn ? String(vn) : undefined,
      an: an ? String(an) : undefined,
      hn: hn ? String(hn) : undefined,
      errorcode: errorcode ? String(errorcode) : undefined,
      verifycode: verifycode ? String(verifycode) : undefined,
      resolveStatus: String(resolveStatus),
      note: note ? String(note) : undefined,
      assignedTo: assignedTo ? String(assignedTo) : undefined,
    });
    return res.json(result);
  } catch (error) {
    console.error('POST /api/reject-tracking/note error:', error);
    return res.status(500).json({ success: false, error: 'บันทึก Note ไม่สำเร็จ' });
  }
});
