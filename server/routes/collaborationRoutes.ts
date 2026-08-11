import { Router, raw } from 'express';
import { createReadStream } from 'node:fs';
import {
  createCollaborationMessage,
  createCollaborationAttachment,
  getCollaborationAttachment,
  getCollaborationOverview,
  listCollaborationMessages,
  listCollaborationRooms,
  markCollaborationRead,
} from '../collaboration.js';
import { appendTodaySpecialFundIssues, syncTodayLineBotMessages } from '../collaborationReports.js';

type RequestUser = { id: number; username: string; display_name?: string | null };

const requestUser = (req: unknown) => (req as { authUser?: RequestUser }).authUser;
const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

export const collaborationRouter = Router();

collaborationRouter.get('/collaboration/overview', async (_req, res) => {
  try {
    const overview = await getCollaborationOverview();
    return res.json({ success: true, data: await appendTodaySpecialFundIssues(overview) });
  } catch (error) {
    console.error('Collaboration overview failed:', error);
    return res.status(500).json({ success: false, error: 'โหลดภาพรวมการตรวจสอบไม่สำเร็จ' });
  }
});

collaborationRouter.get('/collaboration/rooms', async (req, res) => {
  try {
    const user = requestUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
    return res.json({ success: true, data: await listCollaborationRooms(user.id) });
  } catch (error) {
    console.error('Collaboration rooms failed:', error);
    return res.status(500).json({ success: false, error: 'โหลดห้องสนทนาไม่สำเร็จ' });
  }
});

collaborationRouter.get('/collaboration/rooms/:roomId/messages', async (req, res) => {
  try {
    const roomId = positiveId(req.params.roomId);
    if (!roomId) return res.status(400).json({ success: false, error: 'ห้องสนทนาไม่ถูกต้อง' });
    const afterId = Math.max(0, Number(req.query.after || 0));
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 200));
    return res.json({ success: true, data: await listCollaborationMessages(roomId, afterId, limit) });
  } catch (error) {
    console.error('Collaboration messages failed:', error);
    return res.status(500).json({ success: false, error: 'โหลดข้อความไม่สำเร็จ' });
  }
});

collaborationRouter.post('/collaboration/rooms/:roomId/messages', async (req, res) => {
  try {
    const user = requestUser(req);
    const roomId = positiveId(req.params.roomId);
    if (!user) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
    if (!roomId) return res.status(400).json({ success: false, error: 'ห้องสนทนาไม่ถูกต้อง' });
    return res.status(201).json({ success: true, data: await createCollaborationMessage(roomId, user, req.body?.body) });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('กรุณา') || message.includes('ไม่พบห้อง') ? 400 : 500;
    return res.status(status).json({ success: false, error: status === 400 ? message : 'ส่งข้อความไม่สำเร็จ' });
  }
});

collaborationRouter.post(
  '/collaboration/rooms/:roomId/attachments',
  raw({ type: () => true, limit: '10mb' }),
  async (req, res) => {
    try {
      const user = requestUser(req);
      const roomId = positiveId(req.params.roomId);
      if (!user) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
      if (!roomId) return res.status(400).json({ success: false, error: 'ห้องสนทนาไม่ถูกต้อง' });
      const filename = String(req.query.filename || 'ไฟล์แนบ');
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const data = await createCollaborationAttachment(roomId, user, filename, req.headers['content-type'], buffer);
      return res.status(201).json({ success: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'แนบไฟล์ไม่สำเร็จ';
      const expected = /ไฟล์|รูป|PDF|ZIP|Office|ห้องสนทนา/.test(message);
      return res.status(expected ? 400 : 500).json({ success: false, error: expected ? message : 'แนบไฟล์ไม่สำเร็จ' });
    }
  }
);

collaborationRouter.get('/collaboration/attachments/:attachmentId', async (req, res) => {
  try {
    const attachmentId = positiveId(req.params.attachmentId);
    if (!attachmentId) return res.status(400).json({ success: false, error: 'ไฟล์แนบไม่ถูกต้อง' });
    const attachment = await getCollaborationAttachment(attachmentId);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
    return createReadStream(attachment.path).on('error', (error) => {
      console.error('Read collaboration attachment failed:', error);
      if (!res.headersSent) res.status(404).json({ success: false, error: 'ไม่พบไฟล์แนบ' });
      else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return res.status(message.includes('ไม่พบ') ? 404 : 500).json({ success: false, error: message.includes('ไม่พบ') ? message : 'เปิดไฟล์แนบไม่สำเร็จ' });
  }
});

collaborationRouter.post('/collaboration/rooms/:roomId/read', async (req, res) => {
  try {
    const user = requestUser(req);
    const roomId = positiveId(req.params.roomId);
    const messageId = positiveId(req.body?.messageId);
    if (!user) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
    if (!roomId || !messageId) return res.status(400).json({ success: false, error: 'ข้อมูลการอ่านข้อความไม่ถูกต้อง' });
    await markCollaborationRead(roomId, user.id, messageId);
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark collaboration read failed:', error);
    return res.status(500).json({ success: false, error: 'บันทึกสถานะอ่านไม่สำเร็จ' });
  }
});

collaborationRouter.post('/collaboration/bot/scan', async (_req, res) => {
  try {
    const botResult = await syncTodayLineBotMessages();
    const overview = await appendTodaySpecialFundIssues(await getCollaborationOverview());
    return res.json({ success: true, data: { ...botResult, overview } });
  } catch (error) {
    console.error('Collaboration bot scan failed:', error);
    return res.status(500).json({ success: false, error: 'บอทสรุปข้อมูลไม่สำเร็จ' });
  }
});
