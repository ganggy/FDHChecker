import crypto from 'crypto';
import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';

const largeJsonBodyPaths = new Set([
  '/api/repstm/import',
  '/api/fdh/claim-detail/import',
  '/api/fdh/export-zip',
  '/api/fdh/view-data',
  '/api/fdh/submit',
  '/api/receivables/batches',
]);
const standardJsonParser = express.json({ limit: '2mb' });
const importJsonParser = express.json({ limit: '25mb' });

export const parseIsoDateUtc = (value: unknown): number | null => {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? timestamp
    : null;
};

export type DateRangeValidation =
  | { ok: true; start: number; end: number; daySpan: number }
  | { ok: false; error: string };

export const validateDateRange = (startValue: unknown, endValue: unknown, maxDays: number): DateRangeValidation => {
  const hasStart = startValue != null && String(startValue).trim() !== '';
  const hasEnd = endValue != null && String(endValue).trim() !== '';
  if (!hasStart || !hasEnd) return { ok: false, error: 'ต้องระบุวันที่เริ่มและวันที่สิ้นสุดให้ครบ' };
  const start = parseIsoDateUtc(startValue);
  const end = parseIsoDateUtc(endValue);
  if (start == null || end == null) {
    return { ok: false, error: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD และเป็นวันที่ที่ถูกต้อง' };
  }
  if (start > end) return { ok: false, error: 'วันที่เริ่มต้องไม่มากกว่าวันที่สิ้นสุด' };
  const daySpan = Math.floor((end - start) / 86_400_000) + 1;
  if (daySpan > maxDays) {
    return { ok: false, error: `ช่วงวันที่ยาวเกินไป หน้านี้รองรับไม่เกิน ${maxDays.toLocaleString('th-TH')} วันต่อครั้ง` };
  }
  return { ok: true, start, end, daySpan };
};

export const requestTracingMiddleware: RequestHandler = (req, res, next) => {
  const suppliedId = String(req.headers['x-request-id'] || '').trim();
  const requestId = /^[A-Za-z0-9._:-]{8,80}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const startedAt = Date.now();
  res.once('finish', () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 5_000) {
      console.warn(`[slow-request] ${requestId} ${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`);
    }
  });
  next();
};

export const anonymousApiWriteGuard: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/auth/login' || req.path === '/auth/register') return next();
  if (/^Bearer\s+\S+$/i.test(String(req.headers.authorization || '').trim())) return next();
  return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
};

export const jsonBodyParserMiddleware: RequestHandler = (req, res, next) => (
  largeJsonBodyPaths.has(req.path) ? importJsonParser(req, res, next) : standardJsonParser(req, res, next)
);

export const dateRangeGuard: RequestHandler = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const hasStart = req.query.startDate != null && String(req.query.startDate).trim() !== '';
  const hasEnd = req.query.endDate != null && String(req.query.endDate).trim() !== '';
  if (!hasStart && !hasEnd) return next();
  const maxDays = /^\/hosxp\/(checks|eligible-visits)$/.test(req.path) ? 93 : 1_096;
  const validation = validateDateRange(req.query.startDate, req.query.endDate, maxDays);
  if (!validation.ok) return res.status(400).json({ success: false, error: validation.error });
  return next();
};

export const apiNotFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, error: 'ไม่พบ API ที่ร้องขอ' });
};

export const apiErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const parsedError = error as { type?: string; status?: number; message?: string };
  if (parsedError.type === 'entity.too.large' || parsedError.status === 413) {
    return res.status(413).json({ success: false, error: 'ข้อมูลที่ส่งมีขนาดใหญ่เกินกว่าที่ระบบอนุญาต' });
  }
  if (parsedError.type === 'entity.parse.failed' || parsedError.status === 400) {
    return res.status(400).json({ success: false, error: 'รูปแบบ JSON ไม่ถูกต้อง' });
  }
  console.error('Unhandled request error:', parsedError.message || error);
  return res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดภายในระบบ' });
};
