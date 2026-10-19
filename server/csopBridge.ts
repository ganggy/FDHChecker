import path from 'path';
import fs from 'fs';
import os from 'os';
import type { Browser, BrowserContext, Page } from 'playwright';
import { getAppSetting, setAppSetting } from './db.js';

export const CSOP_SETTINGS_KEY = 'csop_settings';

export interface CsopConfig {
  hcode: string;
  username: string;
  password?: string;
  autoDownload: boolean;
  autoImport: boolean;
  headless: boolean;
}

export const getDefaultCsopConfig = (): CsopConfig => ({
  hcode: '11101',
  username: 'jirawan11101',
  password: '',
  autoDownload: true,
  autoImport: true,
  headless: false,
});

export const getResolvedCsopConfig = async (overrides?: Partial<CsopConfig>): Promise<CsopConfig> => {
  const saved = await getAppSetting<Partial<CsopConfig>>(CSOP_SETTINGS_KEY).catch(() => null);
  return {
    ...getDefaultCsopConfig(),
    ...(saved || {}),
    ...(overrides || {}),
  };
};

export const saveCsopConfig = async (config: Partial<CsopConfig>): Promise<CsopConfig> => {
  const current = await getResolvedCsopConfig();
  const updated: CsopConfig = {
    ...current,
    ...config,
  };
  await setAppSetting(CSOP_SETTINGS_KEY, updated);
  return updated;
};

export interface CsopBrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  ready: boolean;
  phase: 'idle' | 'opening' | 'waiting_turnstile' | 'logging_in' | 'ready' | 'error' | 'closed';
  message: string;
  lastError: string | null;
  createdAt: Date;
  hcode: string;
  username: string;
}

let activeSession: CsopBrowserSession | null = null;

const findBrowserExecutable = (): string | undefined => {
  const configured = String(process.env.CSOP_BROWSER_EXECUTABLE || process.env.ECLAIM_BROWSER_EXECUTABLE || '').trim();
  const candidates: string[] = [
    ...(configured ? [configured] : []),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return undefined;
};

export const getCsopBrowserStatus = async () => {
  if (!activeSession) {
    return {
      alive: false,
      ready: false,
      phase: 'closed',
      message: 'ยังไม่ได้เปิดเชื่อมต่อ CSOP',
      url: null,
      title: null,
      screenshotDataUrl: null,
      error: null,
    };
  }

  try {
    const isConnected = activeSession.browser.isConnected();
    if (!isConnected) {
      activeSession = null;
      return {
        alive: false,
        ready: false,
        phase: 'closed',
        message: 'Browser CSOP ถูกปิดแล้ว',
        url: null,
        title: null,
        screenshotDataUrl: null,
        error: null,
      };
    }

    const url = activeSession.page.url();
    const title = await activeSession.page.title().catch(() => '');

    let screenshotDataUrl: string | null = null;
    if (!activeSession.ready) {
      try {
        const buffer = await activeSession.page.screenshot({ type: 'png', fullPage: false });
        screenshotDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      } catch {
        screenshotDataUrl = null;
      }
    }

    return {
      alive: true,
      ready: activeSession.ready,
      phase: activeSession.phase,
      message: activeSession.message,
      url,
      title,
      screenshotDataUrl,
      error: activeSession.lastError,
    };
  } catch (err) {
    return {
      alive: false,
      ready: false,
      phase: 'error',
      message: (err as Error).message,
      url: null,
      title: null,
      screenshotDataUrl: null,
      error: (err as Error).message,
    };
  }
};

export const startCsopBrowserSession = async (customConfig?: Partial<CsopConfig>) => {
  if (activeSession) {
    try {
      await activeSession.browser.close();
    } catch {
      /* ignore */
    }
    activeSession = null;
  }

  const config = await getResolvedCsopConfig(customConfig);
  const { chromium } = await import('playwright');
  const executablePath = findBrowserExecutable();

  const isHeadless = Boolean(config.headless);

  const browser = await chromium.launch({
    executablePath,
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
  });

  const context = await browser.newContext({
    viewport: isHeadless ? { width: 1280, height: 800 } : null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // Avoid navigator.webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const session: CsopBrowserSession = {
    browser,
    context,
    page,
    ready: false,
    phase: 'opening',
    message: 'กำลังเปิดหน้าระบบ CSOP (https://cs8.chi.or.th/csopupload)...',
    lastError: null,
    createdAt: new Date(),
    hcode: config.hcode,
    username: config.username,
  };
  activeSession = session;

  try {
    await page.goto('https://cs8.chi.or.th/csopupload', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    session.phase = 'logging_in';
    session.message = `กำลังกรอกข้อมูลผู้ใช้ รหัส รพ. ${config.hcode} (${config.username})...`;

    // Fill form
    if (await page.$('#hcode')) await page.fill('#hcode', config.hcode);
    if (await page.$('#username')) await page.fill('#username', config.username);
    if (config.password && (await page.$('#password'))) {
      await page.fill('#password', config.password);
    }

    session.phase = 'waiting_turnstile';
    session.message = 'กรอกข้อมูลเรียบร้อยแล้ว — กรุณาคลิก "Verify you are human" เพื่อเข้าสู่ระบบ';

    // Start background watcher for login success
    void monitorCsopLogin(session);

    return { success: true, message: session.message, phase: session.phase };
  } catch (error) {
    session.phase = 'error';
    session.lastError = (error as Error).message;
    session.message = `เปิด CSOP ไม่สำเร็จ: ${(error as Error).message}`;
    return { success: false, error: session.message };
  }
};

const monitorCsopLogin = async (session: CsopBrowserSession) => {
  const maxAttempts = 180; // 3 minutes max
  for (let i = 0; i < maxAttempts; i++) {
    if (!session.browser.isConnected()) break;

    try {
      const url = session.page.url();
      // Check if URL moved beyond /csopupload login page
      const isPastLoginPage =
        !url.endsWith('/csopupload') &&
        !url.endsWith('/csopupload/') &&
        !url.endsWith('/csopupload/Login') &&
        !url.endsWith('/csopupload/login');

      if (isPastLoginPage) {
        session.ready = true;
        session.phase = 'ready';
        session.message = 'เข้าสู่ระบบ CSOP สำเร็จ พร้อมค้นหาและนำเข้าไฟล์ REP / STM';
        return;
      }

      // Check if turnstile token resolved and submit if not yet submitted
      const token = await session.page.evaluate(() => {
        const el = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
        return el ? el.value : null;
      }).catch(() => null);

      if (token && session.phase === 'waiting_turnstile') {
        session.phase = 'logging_in';
        session.message = 'ผ่านการตรวจสอบ Cloudflare แล้ว กำลังเข้าสู่ระบบ...';
        await session.page.click('#btnLogin').catch(() => {});
      }

      // Check for server validation errors
      const errorMsg = await session.page.evaluate(() => {
        const err = document.querySelector('.msgReg, .text-danger, .field-validation-error');
        return err ? (err.textContent || '').trim() : null;
      }).catch(() => null);

      if (errorMsg && errorMsg.length > 2) {
        session.lastError = errorMsg;
        session.message = `แจ้งเตือนจาก CSOP: ${errorMsg}`;
      }
    } catch {
      /* ignore transient polling errors */
    }

    await session.page.waitForTimeout(1000).catch(() => {});
  }
};

export const clickCsopCoordinates = async (x: number, y: number) => {
  if (!activeSession || !activeSession.browser.isConnected()) {
    throw new Error('CSOP Browser session ไม่ได้เปิดอยู่');
  }
  await activeSession.page.mouse.click(x, y);
  return { success: true };
};

export const closeCsopBrowserSession = async () => {
  if (activeSession) {
    try {
      await activeSession.browser.close();
    } catch {
      /* ignore */
    }
    activeSession = null;
  }
  return { success: true };
};

export const getActiveCsopSession = () => activeSession;
