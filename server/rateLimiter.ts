import type { NextFunction, Request, Response } from 'express';

export type RateLimitLockInfo = {
  ip: string;
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
};

export const getClientIp = (req: Request): string => {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
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
    const current = entries.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;

    entry.count += 1;
    entry.lastAttemptAt = new Date().toISOString();
    if (typeof req.body?.username === 'string' && req.body.username.trim()) {
      entry.lastUsername = req.body.username.trim();
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
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, error: options.message });
    }
    next();
  }) as RateLimiter;

  limiter.getLocked = (): RateLimitLockInfo[] => {
    const now = Date.now();
    const list: RateLimitLockInfo[] = [];
    for (const [key, entry] of entries) {
      if (entry.resetAt > now && entry.count >= 1) {
        list.push({
          ip: key,
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
    const target = String(targetIp || '').trim();
    if (!target) return false;
    let found = entries.delete(target);
    if (!found) {
      for (const key of Array.from(entries.keys())) {
        if (key === target || key.endsWith(target) || target.endsWith(key)) {
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
