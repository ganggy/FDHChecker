import assert from 'node:assert';
import test from 'node:test';
import type { Request, Response } from 'express';
import { createRateLimiter, parseUserAgent } from './rateLimiter.js';

const mockReq = (ip: string, username?: string, userAgent?: string): Request => ({
  ip,
  socket: { remoteAddress: ip } as any,
  headers: {
    'user-agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
  },
  body: username ? { username } : {},
} as unknown as Request);

const mockRes = () => {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let jsonBody: any = null;
  return {
    setHeader: (name: string, val: string) => headers.set(name, val),
    getHeader: (name: string) => headers.get(name),
    status: (code: number) => {
      statusCode = code;
      return {
        json: (body: any) => {
          jsonBody = body;
          return { statusCode, jsonBody };
        },
      };
    },
    json: (body: any) => {
      jsonBody = body;
      return { statusCode, jsonBody };
    },
    getStatusCode: () => statusCode,
    getJsonBody: () => jsonBody,
  } as unknown as Response & { getStatusCode: () => number; getJsonBody: () => any };
};

test('parseUserAgent extracts readable OS and browser info', () => {
  const winChrome = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  assert.equal(winChrome, 'Windows 10/11 · Chrome');

  const macSafari = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/15.0 Safari/605.1.15');
  assert.equal(macSafari, 'macOS · Safari');
});

test('rateLimiter tracks requests, parses device, and locks after max exceeded', () => {
  const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 2,
    message: 'Too many requests',
  });

  const ip = '192.168.1.100';
  let nextCalls = 0;
  const next = () => { nextCalls++; };

  // Attempt 1: allowed
  const res1 = mockRes();
  limiter(mockReq(ip, 'user1'), res1, next);
  assert.equal(nextCalls, 1);
  assert.equal((res1 as any).getStatusCode(), 200);

  // Attempt 2: allowed
  const res2 = mockRes();
  limiter(mockReq(ip, 'user1'), res2, next);
  assert.equal(nextCalls, 2);

  // Attempt 3: rejected with 429
  const res3 = mockRes();
  limiter(mockReq(ip, 'user1'), res3, next);
  assert.equal(nextCalls, 2); // next not called
  assert.equal((res3 as any).getStatusCode(), 429);
  assert.match((res3 as any).getJsonBody().error, /Too many requests.*192\.168\.1\.100/);

  // Check getLocked
  const locked = limiter.getLocked();
  assert.equal(locked.length, 1);
  assert.equal(locked[0].ip, ip);
  assert.equal(locked[0].count, 3);
  assert.equal(locked[0].isLocked, true);
  assert.equal(locked[0].lastUsername, 'user1');
  assert.equal(locked[0].deviceInfo, 'Windows 10/11 · Chrome');

  // Unlock specific IP
  const unlocked = limiter.unlock(ip);
  assert.equal(unlocked, true);

  // After unlock, getLocked is empty and new request is allowed
  assert.equal(limiter.getLocked().length, 0);
  const res4 = mockRes();
  limiter(mockReq(ip, 'user1'), res4, next);
  assert.equal(nextCalls, 3);
});

test('rateLimiter unlockAll clears all tracked records', () => {
  const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 1,
    message: 'Too many requests',
  });

  const next = () => {};
  limiter(mockReq('10.0.0.1', 'admin'), mockRes(), next);
  limiter(mockReq('10.0.0.2', 'staff'), mockRes(), next);

  assert.equal(limiter.getLocked().length, 2);
  const cleared = limiter.unlockAll();
  assert.equal(cleared, 2);
  assert.equal(limiter.getLocked().length, 0);
});
