---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiAuth.ts"
source_hash: "46031eabe7511012bb90f68cd419fd11428d0b4a08bfd4b995029c224b3a0d6e"
managed_by: "sync-ksp-vault"
---
# aiAuth.ts

> Source: `server/aiAuth.ts`
> SHA-256: `46031eabe7511012bb90f68cd419fd11428d0b4a08bfd4b995029c224b3a0d6e`

````typescript
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { fileURLToPath } from 'url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, '..');
const COOKIE_NAME = 'fdh_ai_session';
const SESSION_HOURS = Math.max(1, Number(process.env.FDH_AI_SESSION_HOURS) || 12);
const RATE_LIMIT = Math.max(1, Number(process.env.FDH_AI_RATE_LIMIT_PER_MINUTE) || 120);
const TRUSTED_AUTO_LOGIN = String(process.env.FDH_AI_TRUSTED_NETWORK_AUTO_LOGIN || 'true').toLowerCase() === 'true';
const WINDOW_MS = 60_000;

let cachedAccessKey: string | null | undefined;
let cachedKeyFileMtime = 0;
const requestWindows = new Map<string, number[]>();
const loginWindows = new Map<string, number[]>();

const configuredKeyFile = () => path.resolve(
  process.env.FDH_AI_KEY_FILE || path.join(projectRoot, '.secrets', 'ai-access-key'),
);

export const getAiAccessKey = () => {
  const environmentKey = process.env.FDH_AI_ACCESS_KEY?.trim();
  if (environmentKey) {
    cachedAccessKey = environmentKey;
    return cachedAccessKey;
  }
  try {
    const keyFile = configuredKeyFile();
    const modifiedAt = fs.statSync(keyFile).mtimeMs;
    if (cachedAccessKey !== undefined && modifiedAt === cachedKeyFileMtime) return cachedAccessKey;
    const fileKey = fs.readFileSync(keyFile, 'utf8').trim();
    cachedAccessKey = fileKey || null;
    cachedKeyFileMtime = modifiedAt;
  } catch {
    cachedAccessKey = null;
    cachedKeyFileMtime = 0;
  }
  return cachedAccessKey;
};

export const resetAiAccessKeyCache = () => {
  cachedAccessKey = undefined;
  cachedKeyFileMtime = 0;
};

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const isAccessKeyMatch = (candidate: string, accessKey: string) => safeEqual(candidate, accessKey);

const sign = (value: string, accessKey: string) => (
  crypto.createHmac('sha256', accessKey).update(value).digest('base64url')
);

export const createAiSessionToken = (
  accessKey: string,
  now = Date.now(),
  nonce = crypto.randomBytes(18).toString('base64url'),
) => {
  const expiresAt = now + SESSION_HOURS * 60 * 60_000;
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${sign(payload, accessKey)}`;
};

export const verifyAiSessionToken = (token: string, accessKey: string, now = Date.now()) => {
  const [expiresAtValue, nonce, signature, ...extra] = token.split('.');
  if (!expiresAtValue || !nonce || !signature || extra.length) return false;
  const expiresAt = Number(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const payload = `${expiresAtValue}.${nonce}`;
  return safeEqual(signature, sign(payload, accessKey));
};

const readCookie = (req: Request, name: string) => {
  const cookieHeader = req.header('cookie') || '';
  for (const entry of cookieHeader.split(';')) {
    const [key, ...valueParts] = entry.trim().split('=');
    if (key === name) return decodeURIComponent(valueParts.join('='));
  }
  return '';
};

const accessIdentity = (req: Request, accessKey: string) => {
  const headerKey = req.header('x-fdh-ai-key')?.trim() || '';
  if (headerKey && isAccessKeyMatch(headerKey, accessKey)) {
    return `api:${crypto.createHash('sha256').update(headerKey).digest('hex').slice(0, 20)}`;
  }
  const token = readCookie(req, COOKIE_NAME);
  if (token && verifyAiSessionToken(token, accessKey)) {
    return `session:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 20)}`;
  }
  return null;
};

const consumeRateLimit = (store: Map<string, number[]>, identity: string, limit: number) => {
  const now = Date.now();
  const recent = (store.get(identity) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= limit) {
    store.set(identity, recent);
    return false;
  }
  recent.push(now);
  store.set(identity, recent);
  return true;
};

export const getAiAuthStatus = (req: Request) => {
  const accessKey = getAiAccessKey();
  return {
    configured: Boolean(accessKey),
    authenticated: Boolean(accessKey && accessIdentity(req, accessKey)),
    sessionHours: SESSION_HOURS,
    trustedAutoLogin: TRUSTED_AUTO_LOGIN,
  };
};

export const aiLoginRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const identity = `login:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  if (!consumeRateLimit(loginWindows, identity, 10)) {
    return res.status(429).json({ error: 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 1 นาที' });
  }
  return next();
};

const setSessionCookie = (res: Response, accessKey: string) => {
  const token = createAiSessionToken(accessKey);
  const cookieParts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/ai',
    `Max-Age=${SESSION_HOURS * 60 * 60}`,
  ];
  if (String(process.env.FDH_AI_COOKIE_SECURE || '').toLowerCase() === 'true') cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
};

export const createAiSession = (req: Request, res: Response) => {
  const accessKey = getAiAccessKey();
  if (!accessKey) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า FDH AI Access Key บน Server' });
  const candidate = typeof req.body?.accessKey === 'string' ? req.body.accessKey.trim() : '';
  if (!candidate || !isAccessKeyMatch(candidate, accessKey)) {
    return res.status(401).json({ error: 'AI Access Key ไม่ถูกต้อง' });
  }
  setSessionCookie(res, accessKey);
  return res.json({ authenticated: true, sessionHours: SESSION_HOURS });
};

export const createTrustedAiSession = (_req: Request, res: Response) => {
  if (!TRUSTED_AUTO_LOGIN) return res.status(403).json({ error: 'ปิดการออก AI session อัตโนมัติ' });
  const accessKey = getAiAccessKey();
  if (!accessKey) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า FDH AI Access Key บน Server' });
  setSessionCookie(res, accessKey);
  return res.json({ authenticated: true, sessionHours: SESSION_HOURS, automatic: true });
};

export const clearAiSession = (_req: Request, res: Response) => {
  const cookieParts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/ai',
    'Max-Age=0',
  ];
  if (String(process.env.FDH_AI_COOKIE_SECURE || '').toLowerCase() === 'true') cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
  return res.json({ authenticated: false });
};

export const requireAiAuth = (req: Request, res: Response, next: NextFunction) => {
  const accessKey = getAiAccessKey();
  if (!accessKey) return res.status(503).json({ error: 'AI Access Key ยังไม่ได้ตั้งค่าบน Server' });
  const identity = accessIdentity(req, accessKey);
  if (!identity) return res.status(401).json({ error: 'กรุณากรอก AI Access Key' });
  res.locals.aiAccessIdentity = identity;
  return next();
};

export const aiRequestRateLimit = (_req: Request, res: Response, next: NextFunction) => {
  const identity = String(res.locals.aiAccessIdentity || 'unknown');
  if (!consumeRateLimit(requestWindows, identity, RATE_LIMIT)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: `เกินขีดจำกัด ${RATE_LIMIT} คำขอต่อนาที กรุณารอสักครู่` });
  }
  return next();
};

export const aiAuditTrail = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  res.once('finish', () => {
    console.info('AI_AUDIT', JSON.stringify({
      timestamp: new Date().toISOString(),
      session: String(res.locals.aiAccessIdentity || 'unknown'),
      route: req.originalUrl,
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      client: req.ip || req.socket.remoteAddress || 'unknown',
    }));
  });
  return next();
};

````
