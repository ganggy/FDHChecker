import dns from 'node:dns';
import type { NextFunction, Request, Response } from 'express';

export type RateLimitLockInfo = {
  ip: string;
  hostname?: string;
  deviceInfo?: string;
  userAgent?: string;
  count: number;
  max: number;
  isLocked: boolean;
  resetAt: number;
  remainingSeconds: number;
  lastAttemptAt?: string;
  lastUsername?: string;
};

export type RateLimiter = {
  (req: Request, res: Response, next: NextFunction): void;
  getLocked: () => RateLimitLockInfo[];
  unlock: (ip: string) => boolean;
  unlockAll: () => number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
  lastAttemptAt?: string;
  lastUsername?: string;
  userAgent?: string;
  deviceInfo?: string;
  hostname?: string;
};

export const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
};

export const parseUserAgent = (uaRaw?: string): string => {
  if (!uaRaw) return 'ไม่ทราบอุปกรณ์/เบราว์เซอร์';
  const ua = uaRaw.trim();
  let os = 'ระบบปฏิบัติการอื่น';
  if (/windows nt 10/i.test(ua)) os = 'Windows 10/11';
  else if (/windows nt 6\.3/i.test(ua)) os = 'Windows 8.1';
  else if (/windows nt 6\.1/i.test(ua)) os = 'Windows 7';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/ipad/i.test(ua)) os = 'iPad';
  else if (/iphone/i.test(ua)) os = 'iPhone';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'เบราว์เซอร์';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera\//i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';

  return `${os} · ${browser}`;
};

export const createRateLimiter = (options: {
  windowMs: number;
  max: number;
  message: string;
}): RateLimiter => {
  const entries = new Map<string, RateLimitEntry>();

  const limiter = ((req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = getClientIp(req);
    const cleanIp = key.replace(/^::ffff:/i, '');
    const current = entries.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;

    entry.count += 1;
    entry.lastAttemptAt = new Date().toISOString();

    const uaHeader = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
    if (uaHeader) {
      entry.userAgent = uaHeader;
      entry.deviceInfo = parseUserAgent(uaHeader);
    }

    if (typeof req.body?.username === 'string' && req.body.username.trim()) {
      entry.lastUsername = req.body.username.trim();
    }

    // Try reverse DNS lookup for client machine hostname asynchronously
    if (!entry.hostname && cleanIp && cleanIp !== 'unknown' && cleanIp !== '::1' && cleanIp !== '127.0.0.1') {
      try {
        dns.reverse(cleanIp, (err, hostnames) => {
          if (!err && Array.isArray(hostnames) && hostnames.length > 0) {
            entry.hostname = hostnames[0];
          }
        });
      } catch {
        // ignore DNS lookup error
      }
    }

    entries.set(key, entry);

    if (entries.size > 5000) {
      for (const [entryKey, value] of entries) {
        if (value.resetAt <= now) entries.delete(entryKey);
      }
    }

    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - entry.count)));
    if (entry.count > options.max) {
      const remainingSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(remainingSec));
      return res.status(429).json({
        success: false,
        error: `${options.message} (เครื่อง/IP: ${cleanIp}) กรุณาติดต่อผู้ดูแลระบบเพื่อปลดล็อก`,
        ip: cleanIp,
        remainingSeconds: remainingSec,
      });
    }
    next();
  }) as RateLimiter;

  limiter.getLocked = (): RateLimitLockInfo[] => {
    const now = Date.now();
    const list: RateLimitLockInfo[] = [];
    for (const [key, entry] of entries) {
      if (entry.resetAt > now && entry.count >= 1) {
        const cleanIp = key.replace(/^::ffff:/i, '');
        list.push({
          ip: cleanIp,
          hostname: entry.hostname,
          deviceInfo: entry.deviceInfo,
          userAgent: entry.userAgent,
          count: entry.count,
          max: options.max,
          isLocked: entry.count > options.max,
          resetAt: entry.resetAt,
          remainingSeconds: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
          lastAttemptAt: entry.lastAttemptAt,
          lastUsername: entry.lastUsername,
        });
      }
    }
    return list.sort((a, b) => (b.isLocked ? 1 : 0) - (a.isLocked ? 1 : 0) || b.count - a.count);
  };

  limiter.unlock = (targetIp: string): boolean => {
    const target = String(targetIp || '').trim().replace(/^::ffff:/i, '');
    if (!target) return false;
    let found = entries.delete(target);
    if (!found) {
      for (const key of Array.from(entries.keys())) {
        const cleanKey = key.replace(/^::ffff:/i, '');
        if (cleanKey === target || cleanKey.endsWith(target) || target.endsWith(cleanKey) || key === target) {
          entries.delete(key);
          found = true;
        }
      }
    }
    return found;
  };

  limiter.unlockAll = (): number => {
    const count = entries.size;
    entries.clear();
    return count;
  };

  return limiter;
};
