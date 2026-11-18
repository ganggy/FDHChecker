import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { getUTFConnection } from './db.js';
import { readHospitalIdentity } from './siteProfile.js';
import { analyzeRepstmArchive } from './repstmArchive.js';
import { importRepstmRows } from './repositories/receivables.repository.js';
import { getSmtBudgetSummary } from './smtBudgetService.js';
import { parseWorksheetRows } from '../src/utils/repstmWorksheetParsing.js';
import { detectTypeFromFileName } from '../src/utils/repstmImportClassification.js';

type Browser = import('playwright').Browser;
type BrowserContext = import('playwright').BrowserContext;
type Page = import('playwright').Page;

export type SmtBrowserPhase = 'idle' | 'opening' | 'waiting_thaid' | 'ready' | 'downloading' | 'done' | 'error';

export interface SmtDownloadLog {
  time: string;
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

export interface SmtBrowserSessionState {
  phase: SmtBrowserPhase;
  currentUrl: string;
  error: string;
  screenshotBase64: string;
  logs: SmtDownloadLog[];
  progress: {
    totalBatches: number;
    processedBatches: number;
    downloadedFiles: number;
    importedRows: number;
    skippedFiles: number;
  };
}

interface SmtBrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  phase: SmtBrowserPhase;
  currentUrl: string;
  error: string;
  screenshotBase64: string;
  logs: SmtDownloadLog[];
  progress: SmtBrowserSessionState['progress'];
  stopRequested: boolean;
}

let activeSession: SmtBrowserSession | null = null;

const nowTimeStr = () => new Date().toLocaleTimeString('th-TH', { hour12: false });

const pushLog = (session: SmtBrowserSession, level: SmtDownloadLog['level'], text: string) => {
  session.logs.push({ time: nowTimeStr(), level, text });
  if (session.logs.length > 150) session.logs.shift();
};

const resolveChromiumExecutable = (): string | undefined => {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (fs.existsSync(cacheDir)) {
      const dirs = fs.readdirSync(cacheDir).filter((d) => d.startsWith('chromium')).sort().reverse();
      for (const d of dirs) {
        const linuxBin = path.join(cacheDir, d, 'chrome-linux', 'chrome');
        if (fs.existsSync(linuxBin)) return linuxBin;
        const winBin = path.join(cacheDir, d, 'chrome-win', 'chrome.exe');
        if (fs.existsSync(winBin)) return winBin;
      }
    }
  } catch {
    // fallback to playwright default
  }
  return undefined;
};

const refreshScreenshotAndPhase = async (session: SmtBrowserSession) => {
  try {
    session.currentUrl = session.page.url();
    const buf = await session.page.screenshot({ type: 'png' }).catch(() => null);
    if (buf) session.screenshotBase64 = buf.toString('base64');

    if (session.phase === 'waiting_thaid' || session.phase === 'opening') {
      const url = session.currentUrl;
      // Auto-click ThaID button if landed on NHSO Keycloak
      if (url.includes('iam.nhso.go.th')) {
        const thaidBtn = session.page.locator('#social-thaid, a[href*="broker/thaid/login"]').first();
        if (await thaidBtn.count().catch(() => 0)) {
          await thaidBtn.click({ timeout: 2000 }).catch(() => undefined);
          await session.page.waitForTimeout(800);
        }
      }

      if (url.startsWith('https://smt.nhso.go.th/smtf/')) {
        const loggedIn = await session.page.evaluate(() => {
          const text = document.body?.innerText || '';
          const hasLoginBtn = /เข้าสู่ระบบ|ลงชื่อเข้าใช้/i.test(text);
          const hasProfile = Boolean(
            document.querySelector('[class*="user"], [class*="profile"], .fa-user, .fa-sign-out')
          );
          const hasToken = Object.keys(sessionStorage).some((k) => /token|auth|user/i.test(k))
            || Object.keys(localStorage).some((k) => /token|auth|user/i.test(k));
          return (!hasLoginBtn && (hasProfile || hasToken)) || (hasProfile && hasToken);
        }).catch(() => false);

        if (loggedIn) {
          session.phase = 'ready';
          pushLog(session, 'success', 'ยืนยันตัวตน ThaID สำเร็จ พร้อมดาวน์โหลดข้อมูลรายตัวแล้ว');
        } else {
          session.phase = 'waiting_thaid';
        }
      } else {
        session.phase = 'waiting_thaid';
      }
    }
  } catch (err) {
    session.error = (err as Error).message;
  }
};

export const getSmtBrowserStatus = async (): Promise<SmtBrowserSessionState> => {
  if (!activeSession) {
    return {
      phase: 'idle',
      currentUrl: '',
      error: '',
      screenshotBase64: '',
      logs: [],
      progress: { totalBatches: 0, processedBatches: 0, downloadedFiles: 0, importedRows: 0, skippedFiles: 0 },
    };
  }
  if (activeSession.phase !== 'downloading') {
    await refreshScreenshotAndPhase(activeSession);
  }
  return {
    phase: activeSession.phase,
    currentUrl: activeSession.currentUrl,
    error: activeSession.error,
    screenshotBase64: activeSession.screenshotBase64,
    logs: [...activeSession.logs],
    progress: { ...activeSession.progress },
  };
};

export const closeSmtBrowserSession = async () => {
  if (!activeSession) return { ok: true };
  activeSession.stopRequested = true;
  await activeSession.browser.close().catch(() => undefined);
  activeSession = null;
  return { ok: true };
};

const buildBrowserLaunchEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  const userLibsBase = path.join(os.homedir(), '.cache', 'ms-playwright', 'user-libs');
  if (process.platform === 'linux' && fs.existsSync(userLibsBase)) {
    const userLibFlatDir = path.join(userLibsBase, 'lib');
    const userLibRootDir = path.join(userLibsBase, 'root');
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
      const existingLd = String(env.LD_LIBRARY_PATH || '').trim();
      env.LD_LIBRARY_PATH = [...extraDirs, ...(existingLd ? [existingLd] : [])].join(':');
    }
  }
  return env;
};

const installMissingLinuxSharedLibs = async () => {
  if (process.platform !== 'linux') return;
  const { execFile } = await import('child_process');
  const script = `
    export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
    BASE_DIR="$HOME/.cache/ms-playwright/user-libs"
    DEB_DIR="$BASE_DIR/debs"
    ROOT_DIR="$BASE_DIR/root"
    LIB_DIR="$BASE_DIR/lib"
    mkdir -p "$DEB_DIR" "$ROOT_DIR" "$LIB_DIR"
    sudo -n npx playwright install-deps chromium >/dev/null 2>&1 || true
    cd "$DEB_DIR" || exit 0
    if command -v apt-get >/dev/null 2>&1 && command -v dpkg-deb >/dev/null 2>&1; then
      CORE_PKGS="libgbm1 libnss3 libnspr4 libatk1.0-0 libatk1.0-0t64 libatk-bridge2.0-0 libatk-bridge2.0-0t64 libcups2 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libasound2 libasound2t64 libatspi2.0-0 libatspi2.0-0t64 libxshmfence1 libx11-xcb1 libxcb-dri3-0 libxcb-randr0 libwayland-server0 libwayland-client0 libpciaccess0 libx11-6 libxext6 libxi6 libxtst6 libxcb1 libexpat1 libpixman-1-0 libxcb-shm0 libxcb-render0 libxrender1"
      for p in $CORE_PKGS; do apt-get download "$p" >/dev/null 2>&1 || true; done
      for deb in "$DEB_DIR"/*.deb; do [ -f "$deb" ] && dpkg-deb -x "$deb" "$ROOT_DIR" 2>/dev/null || true; done
      find "$ROOT_DIR" \\( -type f -o -type l \\) -name "*.so*" -exec cp -Pf {} "$LIB_DIR/" \\; 2>/dev/null || true
    fi
  `;
  await new Promise<void>((resolve) => {
    execFile('bash', ['-c', script], { timeout: 180_000 }, () => resolve());
  });
};

export const openSmtBrowserSession = async (): Promise<SmtBrowserSessionState> => {
  if (activeSession) {
    await closeSmtBrowserSession();
  }
  const { chromium } = await import('playwright');
  const executablePath = resolveChromiumExecutable();
  const launchOpts = {
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  };
  let browser: Browser;
  try {
    browser = await chromium.launch({ ...launchOpts, env: buildBrowserLaunchEnv() });
  } catch (launchErr) {
    const msg = String((launchErr as Error)?.message || launchErr);
    if (process.platform === 'linux' && /shared libraries|cannot open shared object/i.test(msg)) {
      await installMissingLinuxSharedLibs();
      browser = await chromium.launch({ ...launchOpts, env: buildBrowserLaunchEnv() });
    } else {
      throw launchErr;
    }
  }
  // Use standard desktop Chrome User-Agent so GDCC Security Center WAF on iam.nhso.go.th does not block HeadlessChrome
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'th-TH',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  const session: SmtBrowserSession = {
    browser,
    context,
    page,
    phase: 'opening',
    currentUrl: 'https://smt.nhso.go.th/smtf/#/home/budget/summary',
    error: '',
    screenshotBase64: '',
    logs: [],
    progress: { totalBatches: 0, processedBatches: 0, downloadedFiles: 0, importedRows: 0, skippedFiles: 0 },
    stopRequested: false,
  };
  activeSession = session;

  pushLog(session, 'info', 'กำลังเปิดหน้าเว็บ https://smt.nhso.go.th/smtf/ ...');
  await page.goto('https://smt.nhso.go.th/smtf/#/home/budget/summary', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  // If a login button is visible on SMT, try clicking it automatically to jump to ThaID
  const loginTrigger = page.locator('button:has-text("เข้าสู่ระบบ"), a:has-text("เข้าสู่ระบบ")').first();
  if (await loginTrigger.count().catch(() => 0)) {
    pushLog(session, 'info', 'พบปุ่มเข้าสู่ระบบ กำลังเปิดหน้าจอล็อกอิน ThaID...');
    await loginTrigger.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
  }

  await refreshScreenshotAndPhase(session);
  return getSmtBrowserStatus();
};

export const clickSmtBrowserAt = async (x: number, y: number): Promise<SmtBrowserSessionState> => {
  if (!activeSession) throw new Error('ยังไม่ได้เปิดหน้าต่างเชื่อมต่อ SMT');
  await activeSession.page.mouse.click(Math.round(x), Math.round(y));
  await activeSession.page.waitForTimeout(1200);
  await refreshScreenshotAndPhase(activeSession);
  return getSmtBrowserStatus();
};

const toThaiYyyymmdd = (dateVal: unknown): string => {
  if (!dateVal) return '';
  if (dateVal instanceof Date && Number.isFinite(dateVal.getTime())) {
    const y = dateVal.getFullYear();
    const m = String(dateVal.getMonth() + 1).padStart(2, '0');
    const d = String(dateVal.getDate()).padStart(2, '0');
    return `${y < 2400 ? y + 543 : y}${m}${d}`;
  }
  const s = String(dateVal).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    return `${y < 2400 ? y + 543 : y}${iso[2]}${iso[3]}`;
  }
  const parsed = new Date(s);
  if (Number.isFinite(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y < 2400 ? y + 543 : y}${m}${d}`;
  }
  return '';
};

const importDownloadedBuffer = async (
  buffer: Buffer,
  filename: string,
  importedBy: string,
): Promise<{ importedRows: number; skipped: boolean }> => {
  if (/\.pdf$/i.test(filename)) {
    return { importedRows: 0, skipped: true };
  }
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (/\.zip$/i.test(filename)) {
    const analysis = analyzeRepstmArchive(buffer, filename);
    let totalImported = 0;
    let allSkipped = true;
    for (const ds of analysis.datasets) {
      const res = await importRepstmRows({
        dataType: ds.detectedType,
        sourceFilename: ds.sheetName || filename,
        fileSize: buffer.length,
        fileHash,
        sheetName: ds.sheetName,
        isSubfile: analysis.datasets.length > 1,
        importedBy,
        notes: 'Auto-downloaded from SMT (ThaID)',
        rows: ds.rows,
      });
      if (!res.skipped && !res.duplicate) allSkipped = false;
      totalImported += Number(res.rowCount || 0);
    }
    return { importedRows: totalImported, skipped: allSkipped };
  }

  // Excel (.xls / .xlsx)
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { importedRows: 0, skipped: true };
  const detectedType = detectTypeFromFileName(filename) || 'STM';
  const parsed = parseWorksheetRows(wb.Sheets[sheetName], detectedType);
  if (!parsed.rows.length) return { importedRows: 0, skipped: true };

  const res = await importRepstmRows({
    dataType: detectedType,
    sourceFilename: filename,
    fileSize: buffer.length,
    fileHash,
    sheetName,
    importedBy,
    notes: 'Auto-downloaded from SMT (ThaID)',
    rows: parsed.rows,
  });
  return { importedRows: Number(res.rowCount || 0), skipped: Boolean(res.skipped || res.duplicate) };
};

export const runSmtAutoDownload = async (budgetYear: string, importedBy = 'SMT-Auto') => {
  const session = activeSession;
  if (!session) throw new Error('กรุณาเปิดเชื่อมต่อ SMT และยืนยัน ThaID ก่อน');
  if (session.phase === 'downloading') throw new Error('กำลังดาวน์โหลดอยู่ กรุณารอสักครู่');

  session.phase = 'downloading';
  session.error = '';
  session.stopRequested = false;

  const summary = await getSmtBudgetSummary(budgetYear);
  const utfConn = await getUTFConnection();
  let hcode = '11101';
  try {
    const ident = await readHospitalIdentity(utfConn);
    if (ident.hospital_code) hcode = ident.hospital_code;
  } finally {
    utfConn.release();
  }

  // Group unimported transfers by batch_no + run_date
  const unimported = summary.transfers.filter((t) => t.reconcile_status === 'unimported');
  const batchMap = new Map<string, { batchNo: string; runDate: string; thaiDate: string; budgetSource: string; refs: Set<string> }>();
  for (const t of unimported) {
    const batchNo = String(t.batch_no || '').trim();
    const thaiDate = toThaiYyyymmdd(t.run_date);
    if (!batchNo || !thaiDate) continue;
    const key = `${thaiDate}|${batchNo}`;
    if (!batchMap.has(key)) {
      batchMap.set(key, {
        batchNo,
        runDate: thaiDate,
        thaiDate,
        budgetSource: String((t as unknown as { budget_source?: string }).budget_source || 'UC').trim() || 'UC',
        refs: new Set(),
      });
    }
    if (t.ref_doc_no) batchMap.get(key)!.refs.add(String(t.ref_doc_no).trim());
  }

  const batches = [...batchMap.values()];
  session.progress = {
    totalBatches: batches.length,
    processedBatches: 0,
    downloadedFiles: 0,
    importedRows: 0,
    skippedFiles: 0,
  };

  if (batches.length === 0) {
    session.phase = 'done';
    pushLog(session, 'info', 'ไม่พบงวดที่ยังรอไฟล์ STM ในปีงบประมาณนี้');
    return;
  }

  pushLog(session, 'info', `เริ่มดาวน์โหลดรายตัวอัตโนมัติ ${batches.length} งวดโอน (ปีงบ ${budgetYear})...`);

  const vendorId = `00000${hcode}`;
  const tmpDir = path.join(os.tmpdir(), 'fdh_smt_downloads');
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    for (const b of batches) {
      if (session.stopRequested) break;
      const detailUrl = `https://smt.nhso.go.th/smtf/#/home/budget/summary-detail/${vendorId}/${b.thaiDate}/${b.batchNo}/${budgetYear}/${hcode}/${b.budgetSource}`;
      pushLog(session, 'info', `เปิดงวด Batch ${b.batchNo} (${b.runDate})...`);

      await session.page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const loadedDetail = await session.page.waitForFunction(
        (batch) => {
          const text = document.body?.innerText || '';
          return text.includes('รายงานแสดงรายละเอียดการเบิกจ่ายเงินแยกรายการ') && text.includes(batch);
        },
        b.batchNo,
        { timeout: 15000 },
      ).then(() => true).catch(() => false);
      if (!loadedDetail) {
        pushLog(session, 'warn', `ไม่สามารถเปิดหน้ารายละเอียดของ Batch ${b.batchNo} (${b.thaiDate}) ได้ ข้ามงวดนี้`);
        session.progress.processedBatches += 1;
        continue;
      }
      await session.page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => undefined);
      await session.page.waitForTimeout(1000);
      await refreshScreenshotAndPhase(session);

      // Find the exact column offset from the right using the top header row ("Download เอกสาร" -> 3rd from right)
      const individualColIdx = await session.page.evaluate(() => {
        const firstRow = document.querySelector('table thead tr');
        if (firstRow) {
          const cells = Array.from(firstRow.querySelectorAll('th, td'));
          const idx = cells.findIndex((c) => /Download\s*เอกสาร/i.test(c.textContent || ''));
          if (idx >= 0) {
            return { fromRight: cells.length - idx };
          }
        }
        return { fromRight: 3 };
      });

      const rowCount = await session.page.locator('table tbody tr').count();
      for (let i = 0; i < rowCount; i += 1) {
        if (session.stopRequested) break;
        const rowLoc = session.page.locator('table tbody tr').nth(i);
        const rowText = (await rowLoc.innerText().catch(() => '')).trim();
        if (!rowText || /^รวม\b/.test(rowText)) continue;

        const cellCount = await rowLoc.locator('td').count();
        const targetCellIdx = Math.max(0, cellCount - individualColIdx.fromRight);
        const targetCell = rowLoc.locator('td').nth(targetCellIdx);
        const downloadBtns = targetCell.locator('a, button, img, i, svg');
        const btnCount = await downloadBtns.count();
        if (btnCount === 0) continue;

        // Click the main clickable element in the "รายบุคคล" cell
        const clickable = targetCell.locator('a, button').first();
        const btn = (await clickable.count()) > 0 ? clickable : downloadBtns.first();
        if (!(await btn.isVisible().catch(() => false))) continue;

        try {
          const downloadPromise = session.page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
          const popupPromise = session.context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
          await btn.click({ timeout: 3000 });

          const [dl, popup] = await Promise.all([downloadPromise, popupPromise]);
          if (dl) {
            const fname = dl.suggestedFilename() || `SMT_${b.batchNo}_${i + 1}.xlsx`;
            if (/\.pdf$/i.test(fname)) {
              pushLog(session, 'warn', `ข้ามไฟล์ PDF (ไม่ใช่ไฟล์รายบุคคล): ${fname}`);
              continue;
            }
            const savePath = path.join(tmpDir, fname);
            await dl.saveAs(savePath);
            const buf = fs.readFileSync(savePath);
            fs.unlinkSync(savePath);
            const res = await importDownloadedBuffer(buf, fname, importedBy);
            session.progress.downloadedFiles += 1;
            if (res.skipped) {
              session.progress.skippedFiles += 1;
              pushLog(session, 'warn', `ข้ามไฟล์ซ้ำ: ${fname}`);
            } else {
              session.progress.importedRows += res.importedRows;
              pushLog(session, 'success', `นำเข้า ${fname} สำเร็จ (+${res.importedRows} รายการ)`);
            }
          } else if (popup) {
            await popup.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => undefined);
            await popup.waitForTimeout(1500);
            const exportBtn = popup.locator('button:has-text("Export Excel"), a:has-text("Export Excel")').first();
            if (await exportBtn.count().catch(() => 0)) {
              const dmisDl = await Promise.all([
                popup.waitForEvent('download', { timeout: 25000 }).catch(() => null),
                exportBtn.click({ timeout: 5000 }),
              ]).then(([d]) => d);
              if (dmisDl) {
                const fname = dmisDl.suggestedFilename() || `DMIS_${b.batchNo}_${i + 1}.xlsx`;
                const savePath = path.join(tmpDir, fname);
                await dmisDl.saveAs(savePath);
                const buf = fs.readFileSync(savePath);
                fs.unlinkSync(savePath);
                const res = await importDownloadedBuffer(buf, fname, importedBy);
                session.progress.downloadedFiles += 1;
                if (res.skipped) {
                  session.progress.skippedFiles += 1;
                  pushLog(session, 'warn', `ข้ามไฟล์ซ้ำ: ${fname}`);
                } else {
                  session.progress.importedRows += res.importedRows;
                  pushLog(session, 'success', `นำเข้า DMIS ${fname} สำเร็จ (+${res.importedRows} รายการ)`);
                }
              }
            }
            await popup.close().catch(() => undefined);
          } else if (session.page.url().includes('summary-detail-dmis')) {
            await session.page.waitForTimeout(1500);
            const exportBtn = session.page.locator('button:has-text("Export Excel"), a:has-text("Export Excel")').first();
            if (await exportBtn.count().catch(() => 0)) {
              const dmisDl = await Promise.all([
                session.page.waitForEvent('download', { timeout: 25000 }).catch(() => null),
                exportBtn.click({ timeout: 5000 }),
              ]).then(([d]) => d);
              if (dmisDl) {
                const fname = dmisDl.suggestedFilename() || `DMIS_${b.batchNo}_${i + 1}.xlsx`;
                const savePath = path.join(tmpDir, fname);
                await dmisDl.saveAs(savePath);
                const buf = fs.readFileSync(savePath);
                fs.unlinkSync(savePath);
                const res = await importDownloadedBuffer(buf, fname, importedBy);
                session.progress.downloadedFiles += 1;
                if (res.skipped) {
                  session.progress.skippedFiles += 1;
                  pushLog(session, 'warn', `ข้ามไฟล์ซ้ำ: ${fname}`);
                } else {
                  session.progress.importedRows += res.importedRows;
                  pushLog(session, 'success', `นำเข้า DMIS ${fname} สำเร็จ (+${res.importedRows} รายการ)`);
                }
              }
            }
            await session.page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await session.page.waitForFunction(
              (batch) => {
                const text = document.body?.innerText || '';
                return text.includes('รายงานแสดงรายละเอียดการเบิกจ่ายเงินแยกรายการ') && text.includes(batch);
              },
              b.batchNo,
              { timeout: 15000 },
            ).catch(() => undefined);
          }
        } catch (itemErr) {
          pushLog(session, 'warn', `แถวที่ ${i + 1} Batch ${b.batchNo}: ${(itemErr as Error).message}`);
        }
      }

      session.progress.processedBatches += 1;
    }

    session.phase = 'done';
    pushLog(
      session,
      'success',
      `เสร็จสิ้น! ประมวลผล ${session.progress.processedBatches}/${session.progress.totalBatches} งวด | ดาวน์โหลด ${session.progress.downloadedFiles} ไฟล์ | นำเข้า ${session.progress.importedRows} รายการ`,
    );
  } catch (err) {
    session.phase = 'error';
    session.error = (err as Error).message;
    pushLog(session, 'error', `เกิดข้อผิดพลาด: ${session.error}`);
  }
};
