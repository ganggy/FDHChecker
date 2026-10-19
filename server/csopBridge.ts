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
  password: 'jirawan11101',
  autoDownload: true,
  autoImport: true,
  headless: process.platform !== 'win32',
});

export const getResolvedCsopConfig = async (overrides?: Partial<CsopConfig>): Promise<CsopConfig> => {
  const saved = await getAppSetting<Partial<CsopConfig>>(CSOP_SETTINGS_KEY).catch(() => null);
  const base = {
    ...getDefaultCsopConfig(),
    ...(saved || {}),
  };
  const effectiveOverrides = overrides ? { ...overrides } : {};
  if (!effectiveOverrides.password && base.password) {
    delete effectiveOverrides.password;
  }
  return {
    ...base,
    ...effectiveOverrides,
  };
};

export const saveCsopConfig = async (config: Partial<CsopConfig>): Promise<CsopConfig> => {
  const current = await getResolvedCsopConfig();
  const passwordToSave = config.password && String(config.password).trim()
    ? String(config.password).trim()
    : current.password || 'jirawan11101';
  const updated: CsopConfig = {
    ...current,
    ...config,
    password: passwordToSave,
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

const userLibsBase = path.join(os.homedir(), '.cache', 'ms-playwright', 'user-libs');
const userLibFlatDir = path.join(userLibsBase, 'lib');
const userLibRootDir = path.join(userLibsBase, 'root');

const buildBrowserLaunchEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env } as NodeJS.ProcessEnv;
  if (process.platform === 'linux' && fs.existsSync(userLibsBase)) {
    const extraDirs = [
      userLibFlatDir,
      path.join(userLibRootDir, 'usr', 'lib', 'x86_64-linux-gnu'),
      path.join(userLibRootDir, 'lib', 'x86_64-linux-gnu'),
      path.join(userLibRootDir, 'usr', 'lib64'),
      path.join(userLibRootDir, 'lib64'),
      path.join(userLibRootDir, 'usr', 'lib'),
      path.join(userLibRootDir, 'lib'),
    ].filter((d) => fs.existsSync(d));
    if (extraDirs.length > 0) {
      const existingLd = String(process.env.LD_LIBRARY_PATH || '').trim();
      const combinedLd = [...extraDirs, ...(existingLd ? [existingLd] : [])].join(':');
      env.LD_LIBRARY_PATH = combinedLd;
      process.env.LD_LIBRARY_PATH = combinedLd;
    }
  }
  return env;
};

const installMissingLinuxSharedLibs = async (binPath?: string) => {
  if (process.platform !== 'linux') return;
  const { execFile } = await import('child_process');
  const script = `
    export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
    BASE_DIR="$HOME/.cache/ms-playwright/user-libs"
    DEB_DIR="$BASE_DIR/debs"
    ROOT_DIR="$BASE_DIR/root"
    LIB_DIR="$BASE_DIR/lib"
    mkdir -p "$DEB_DIR" "$ROOT_DIR" "$LIB_DIR"

    # 1. Try passwordless sudo first if available
    sudo -n npx playwright install-deps chromium >/dev/null 2>&1 || true

    cd "$DEB_DIR" || exit 0
    if command -v apt-get >/dev/null 2>&1 && command -v dpkg-deb >/dev/null 2>&1; then
      CORE_PKGS="libgbm1 libnss3 libnspr4 libatk1.0-0 libatk1.0-0t64 libatk-bridge2.0-0 libatk-bridge2.0-0t64 libcups2 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libasound2 libasound2t64 libatspi2.0-0 libatspi2.0-0t64 libxshmfence1 libx11-xcb1 libxcb-dri3-0 libxcb-randr0 libwayland-server0 libwayland-client0 libpciaccess0 libx11-6 libxext6 libxi6 libxtst6 libxcb1 libexpat1 libpixman-1-0 libxcb-shm0 libxcb-render0 libxrender1"
      ALL_PKGS=$(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances $CORE_PKGS 2>/dev/null | grep "^[a-z0-9]" | grep -v -E "^(libc6|libgcc|gcc|multiarch|debconf|dpkg|coreutils|passwd|adduser|ucf|tzdata)" | sort -u)
      if [ -z "$ALL_PKGS" ]; then
        ALL_PKGS="$CORE_PKGS"
      fi
      apt-get download $ALL_PKGS >/dev/null 2>&1 || {
        for p in $CORE_PKGS; do
          apt-get download "$p" >/dev/null 2>&1 || true
        done
      }
      for deb in "$DEB_DIR"/*.deb; do
        [ -f "$deb" ] && dpkg-deb -x "$deb" "$ROOT_DIR" 2>/dev/null || true
      done
    elif command -v dnf >/dev/null 2>&1; then
      dnf download --destdir="$DEB_DIR" mesa-libgbm nss nspr atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr pango cairo alsa-lib at-spi2-core libxshmfence libwayland-server libwayland-client libpciaccess libX11 libX11-xcb libxcb >/dev/null 2>&1 || true
      cd "$ROOT_DIR" || exit 0
      for rpm in "$DEB_DIR"/*.rpm; do
        [ -f "$rpm" ] && (rpm2cpio "$rpm" | cpio -idmv >/dev/null 2>&1 || true)
      done
    elif command -v yumdownloader >/dev/null 2>&1; then
      yumdownloader --destdir="$DEB_DIR" mesa-libgbm nss nspr atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr pango cairo alsa-lib at-spi2-core libxshmfence libwayland-server libwayland-client libpciaccess libX11 libX11-xcb libxcb >/dev/null 2>&1 || true
      cd "$ROOT_DIR" || exit 0
      for rpm in "$DEB_DIR"/*.rpm; do
        [ -f "$rpm" ] && (rpm2cpio "$rpm" | cpio -idmv >/dev/null 2>&1 || true)
      done
    fi

    # Copy/link all extracted .so* files into flat LIB_DIR
    find "$ROOT_DIR" \\( -type f -o -type l \\) -name "*.so*" -exec cp -Pf {} "$LIB_DIR/" \\; 2>/dev/null || true

    # If binary path is known, inspect ldd for any remaining missing libraries and fetch them
    if [ -n "${binPath || ''}" ] && [ -f "${binPath || ''}" ] && command -v ldd >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
      cd "$DEB_DIR" || exit 0
      MISSING_LIBS=$(LD_LIBRARY_PATH="$LIB_DIR:$LD_LIBRARY_PATH" ldd "${binPath || ''}" 2>/dev/null | awk '/not found/ {print $1}' | sort -u)
      for so in $MISSING_LIBS; do
        GUESS=$(echo "$so" | sed -E 's/\\.so\\.([0-9]+)$/\\1/; s/\\.so$//')
        for cand in "$GUESS" "\${GUESS}t64" "\${GUESS}-0"; do
          apt-get download "$cand" >/dev/null 2>&1 || true
        done
      done
      for deb in "$DEB_DIR"/*.deb; do
        [ -f "$deb" ] && dpkg-deb -x "$deb" "$ROOT_DIR" 2>/dev/null || true
      done
      find "$ROOT_DIR" \\( -type f -o -type l \\) -name "*.so*" -exec cp -Pf {} "$LIB_DIR/" \\; 2>/dev/null || true
    fi
  `;
  await new Promise<void>((resolve) => {
    execFile('bash', ['-c', script], { timeout: 240_000 }, () => resolve());
  });
};

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

  // Scan ~/.cache/ms-playwright
  try {
    const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (fs.existsSync(cacheDir)) {
      const dirs = fs
        .readdirSync(cacheDir)
        .filter((d) => d.startsWith('chromium'))
        .sort()
        .reverse();
      for (const dir of dirs) {
        const subCandidates = [
          path.join(cacheDir, dir, 'chrome-linux', 'chrome'),
          path.join(cacheDir, dir, 'chrome-linux64', 'chrome'),
          path.join(cacheDir, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          path.join(cacheDir, dir, 'chrome-win', 'chrome.exe'),
        ];
        for (const sub of subCandidates) {
          if (fs.existsSync(sub)) return sub;
        }
      }
    }
  } catch {
    /* ignore */
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
  let executablePath = findBrowserExecutable();

  const forceHeadless = String(process.env.CSOP_BROWSER_HEADLESS || process.env.ECLAIM_BROWSER_HEADLESS || '').trim().toLowerCase();
  const isHeadless = forceHeadless
    ? !['0', 'false', 'no'].includes(forceHeadless)
    : process.platform !== 'win32' ? true : Boolean(config.headless);

  const launchArgs = isHeadless
    ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-blink-features=AutomationControlled',
      ]
    : [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
      ];

  let browser: Browser | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      browser = await chromium.launch({
        executablePath,
        headless: isHeadless,
        ignoreDefaultArgs: ['--enable-automation'],
        args: launchArgs,
        env: buildBrowserLaunchEnv() as Record<string, string>,
      });
      break;
    } catch (launchErr) {
      const errMsg = String((launchErr as Error)?.message || launchErr);
      if (attempt < 3 && /Executable doesn't exist|playwright install/i.test(errMsg)) {
        console.log('[csop] Browser executable missing; running automatic npx playwright install chromium...');
        const { execFile } = await import('child_process');
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        await new Promise<void>((resolve, reject) => {
          execFile(
            npxCmd,
            ['playwright', 'install', 'chromium'],
            { cwd: process.cwd(), timeout: 240_000 },
            (error, stdout, stderr) => {
              if (error) reject(new Error(`ติดตั้ง Browser ไม่สำเร็จ: ${stderr || stdout || error.message}`));
              else resolve();
            }
          );
        });
        executablePath = findBrowserExecutable();
        continue;
      }
      if (
        attempt < 3 &&
        /error while loading shared libraries|cannot open shared object file|Target page, context or browser has been closed/i.test(errMsg)
      ) {
        console.log('[csop] Missing Linux shared libraries (e.g. libgbm.so.1); extracting user-space libraries automatically...');
        await installMissingLinuxSharedLibs(executablePath);
        executablePath = findBrowserExecutable();
        continue;
      }
      throw launchErr;
    }
  }

  if (!browser) {
    throw new Error('ไม่สามารถเปิด Browser สำหรับเชื่อมต่อ CSOP ได้');
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'th-TH',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    (window as any).chrome = {
      app: { isInstalled: false },
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
    };
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['th-TH', 'th', 'en-US', 'en'],
    });
  });

  const page = await context.newPage();

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
    const passToUse = config.password || 'jirawan11101';
    if (await page.$('#password')) {
      await page.fill('#password', passToUse);
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

export const autoClickTurnstile = async () => {
  if (!activeSession || !activeSession.browser.isConnected()) {
    throw new Error('CSOP Browser session ไม่ได้เปิดอยู่');
  }
  const page = activeSession.page;
  const turnstileEl = await page.$('.cf-turnstile');
  if (turnstileEl) {
    const box = await turnstileEl.boundingBox();
    if (box) {
      const clickX = box.x + 35;
      const clickY = box.y + (box.height / 2);
      await page.mouse.move(clickX - 20, clickY - 10);
      await page.waitForTimeout(200);
      await page.mouse.move(clickX, clickY);
      await page.mouse.click(clickX, clickY);
      return { success: true, clicked: true };
    }
  }
  return { success: false, message: 'ไม่พบกล่อง Turnstile บนหน้าจอ' };
};

export const refillCsopCredentials = async (customConfig?: Partial<CsopConfig>) => {
  if (!activeSession || !activeSession.browser.isConnected()) {
    throw new Error('CSOP Browser session ไม่ได้เปิดอยู่');
  }
  const config = await getResolvedCsopConfig(customConfig);
  const page = activeSession.page;
  if (await page.$('#hcode')) await page.fill('#hcode', config.hcode);
  if (await page.$('#username')) await page.fill('#username', config.username);
  const passToUse = config.password || 'jirawan11101';
  if (await page.$('#password')) await page.fill('#password', passToUse);
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
