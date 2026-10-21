/**
 * server/eclaimBackgroundWorker.ts
 *
 * Dedicated background worker for NHSO e-Claim automatic download and sync.
 * Runs autonomously in the background without blocking the HTTP request or UI,
 * allowing the user to navigate anywhere in the application.
 */

import path from 'path';
import fs from 'fs';
import * as xlsx from 'xlsx';
import { getEclaimBrowserSession } from './index.js';
import { getRepstmConnection } from './db/connection.js';
import { importRepstmRows } from './repositories/receivables.repository.js';

export interface EclaimWorkerProgress {
  jobId: string | null;
  running: boolean;
  phase: 'idle' | 'starting' | 'navigating' | 'scraping' | 'downloading' | 'importing' | 'completed' | 'stopped' | 'error';
  message: string;
  portal: 'new_client' | 'legacy_webcomponent' | 'both' | 'none';
  currentPage: number;
  totalPages: number;
  totalFound: number;
  downloadedCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  currentFilename: string | null;
  startTime: string | null;
  endTime: string | null;
  logs: Array<{ time: string; type: 'info' | 'success' | 'warning' | 'error'; text: string }>;
}

let workerState: EclaimWorkerProgress = {
  jobId: null,
  running: false,
  phase: 'idle',
  message: 'ไม่มีงานที่กำลังประมวลผล',
  portal: 'none',
  currentPage: 0,
  totalPages: 0,
  totalFound: 0,
  downloadedCount: 0,
  importedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  currentFilename: null,
  startTime: null,
  endTime: null,
  logs: [],
};

let stopRequested = false;

const MAX_LOG_HISTORY = 100;

const addLog = (type: 'info' | 'success' | 'warning' | 'error', text: string) => {
  const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
  workerState.logs.unshift({ time, type, text });
  if (workerState.logs.length > MAX_LOG_HISTORY) {
    workerState.logs.pop();
  }
};

export const getEclaimWorkerStatus = (): EclaimWorkerProgress => ({
  ...workerState,
  logs: [...workerState.logs],
});

export const stopEclaimWorker = (): boolean => {
  if (workerState.running) {
    stopRequested = true;
    workerState.message = 'กำลังส่งคำสั่งหยุดการทำงาน...';
    addLog('warning', '⚠️ ได้รับคำสั่งให้หยุดการทำงานในพื้นหลัง');
    return true;
  }
  return false;
};

let importedCache: Set<string> | null = null;

const loadImportedFilesCache = async (): Promise<Set<string>> => {
  const set = new Set<string>();
  try {
    const conn = await getRepstmConnection();
    try {
      const [rows] = await conn.query('SELECT source_filename FROM repstm_import_batch');
      if (Array.isArray(rows)) {
        for (const r of rows as any[]) {
          const fn = String(r.source_filename || '').trim().toLowerCase();
          if (!fn) continue;
          set.add(fn);
          set.add(fn.replace(/\.(xlsx?|zip|csv|ecd)$/i, ''));
        }
      }
    } finally {
      conn.release();
    }
  } catch { /* best effort */ }
  importedCache = set;
  return set;
};

const isFileAlreadyImported = async (filename: string): Promise<boolean> => {
  if (!importedCache) {
    await loadImportedFilesCache();
  }
  const lower = filename.trim().toLowerCase();
  const stem = lower.replace(/\.(xlsx?|zip|csv|ecd)$/i, '');
  return Boolean(importedCache?.has(lower) || importedCache?.has(stem));
};

const registerImportedFileInCache = (filename: string) => {
  if (!importedCache) importedCache = new Set<string>();
  const lower = filename.trim().toLowerCase();
  importedCache.add(lower);
  importedCache.add(lower.replace(/\.(xlsx?|zip|csv|ecd)$/i, ''));
};

/**
 * Click the [ค้นหา] (Search) button on the new e-Claim Client portal pages
 * so that the table actually populates with records (otherwise shows "ไม่มีข้อมูล").
 */
const triggerSearchOnPage = async (pageInstance: any, pageName: string): Promise<boolean> => {
  try {
    // 1. Wait a moment for Angular to settle after navigation
    await pageInstance.waitForTimeout(1500);

    // 2. Wait for the real [ค้นหา] button to mount in DOM
    const searchBtn = pageInstance.locator('button').filter({ hasText: /^ค้นหา$/ }).first();
    const isReady = await searchBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);

    if (!isReady) {
      // Fallback: check button with ant-btn-primary and text ค้นหา
      const fallbackBtn = pageInstance.locator('button.ant-btn-primary').filter({ hasText: 'ค้นหา' }).first();
      const isFallbackReady = await fallbackBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      if (!isFallbackReady) {
        addLog('warning', `⚠️ ไม่พบปุ่ม [ค้นหา] บนหน้า ${pageName}`);
        return false;
      }
    }

    // 3. On REP page, try to filter "สถานะข้อมูล: ประมวลผลแล้ว"
    if (pageName === 'REP') {
      try {
        const statusItem = pageInstance.locator('nz-form-item, .ant-form-item, div.ant-row, div')
          .filter({ hasText: 'สถานะข้อมูล' })
          .locator('.ant-select-selector, nz-select, .ant-select')
          .first();

        if (await statusItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await statusItem.click().catch(() => null);
          await pageInstance.waitForTimeout(400);

          const chosen = await pageInstance.evaluate(() => {
            const options = Array.from(document.querySelectorAll<HTMLElement>(
              '.cdk-overlay-container .ant-select-item-option, nz-option-item, .ant-select-dropdown .ant-select-item-option'
            ));
            const target = options.find((o) => {
              const t = (o.textContent || '').trim();
              return t === 'ประมวลผลแล้ว' || (t.includes('ประมวลผล') && !t.includes('รอ'));
            });
            if (target) {
              target.click();
              return target.textContent?.trim();
            }
            return null;
          }).catch(() => null);

          if (chosen) {
            addLog('info', `🎯 ตัวกรองสถานะ REP: เลือก [${chosen}] สำเร็จ`);
          }
        }
      } catch { /* ignore filter error */ }
    }

    // 4. Click the search button
    let clicked = false;
    try {
      const targetBtn = pageInstance.locator('button').filter({ hasText: /^ค้นหา$/ }).first();
      await targetBtn.click({ timeout: 5000 });
      clicked = true;
    } catch {
      clicked = await pageInstance.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
        const btn = buttons.find((b) => (b.textContent || '').trim() === 'ค้นหา' && !b.closest('.ant-collapse-header'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }).catch(() => false);
    }

    if (!clicked) {
      addLog('warning', `⚠️ ไม่สามารถกดปุ่ม [ค้นหา] บนหน้า ${pageName}`);
      return false;
    }

    addLog('info', `✅ กดปุ่ม [ค้นหา] หน้า ${pageName} สำเร็จ กำลังรอผลลัพธ์จาก สปสช...`);

    // 5. Wait for the table rows to populate
    await pageInstance.waitForTimeout(2000);
    const loaded = await pageInstance.waitForFunction(() => {
      const isSpinning = document.querySelector('.ant-spin-spinning') !== null;
      const trs = document.querySelectorAll('table tbody tr');
      const hasDataRows = trs.length > 0 && !trs[0]?.textContent?.includes('ไม่มีข้อมูล');
      const hasPagination = document.querySelector('nz-pagination, ul.ant-pagination, ul.pagination, .ant-pagination-item') !== null;
      return !isSpinning && (hasPagination || hasDataRows);
    }, { timeout: 20000 }).catch(() => false);

    await pageInstance.waitForTimeout(1000);
    return Boolean(loaded);
  } catch (err: any) {
    addLog('warning', `เกิดข้อผิดพลาดในการกดค้นหา: ${err.message}`);
    return false;
  }
};

export const startEclaimBackgroundSync = async (options: {
  maxPages?: number;
  downloadLimit?: number;
  importedBy?: string;
  expectedHcode?: string;
}): Promise<{ success: boolean; message: string; jobId?: string }> => {
  if (workerState.running) {
    return { success: false, message: 'มีงานดาวน์โหลดพื้นหลังกำลังทำงานอยู่แล้ว' };
  }

  const session = getEclaimBrowserSession();
  if (!session || !session.ready) {
    return { success: false, message: 'Browser ยังไม่พร้อม กรุณาสแกน QR ThaID เข้าสู่ระบบก่อน' };
  }

  const jobId = `sync_${Date.now()}`;
  stopRequested = false;

  const requestedMaxPages = Number(options.maxPages);
  const maxPagesLimit = Number.isInteger(requestedMaxPages) && requestedMaxPages > 0
    ? Math.min(requestedMaxPages, 500)
    : 15; // default 15 pages (300 items)

  workerState = {
    jobId,
    running: true,
    phase: 'starting',
    message: 'กำลังเริ่มต้นเชื่อมต่อหน้าเว็บ e-Claim...',
    portal: 'new_client',
    currentPage: 1,
    totalPages: 1,
    totalFound: 0,
    downloadedCount: 0,
    importedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    currentFilename: null,
    startTime: new Date().toLocaleTimeString('th-TH', { hour12: false }),
    endTime: null,
    logs: [],
  };

  addLog('info', `🚀 เริ่มงานซิงค์ข้อมูล e-Claim ในพื้นหลัง (เป้าหมายสูงสุด ${maxPagesLimit} หน้า)`);

  // Run in background asynchronously without blocking the response
  void (async () => {
    try {
      const page = session.page;
      const downloadArchiveDir = path.join(process.cwd(), 'downloads', 'nhso-repstm');
      if (!fs.existsSync(downloadArchiveDir)) {
        fs.mkdirSync(downloadArchiveDir, { recursive: true });
      }

      // Preload imported files cache for instant duplicate checks
      await loadImportedFilesCache();

      // ─────────────────────────────────────────────────────────────
      // PART 1: REP - รับชุดข้อมูลผลการตรวจสอบ (REP) จากเว็บใหม่ (/Client/service/download-validated)
      // ─────────────────────────────────────────────────────────────
      workerState.phase = 'navigating';
      workerState.message = 'กำลังเปิดหน้ารับชุดข้อมูลผลการตรวจสอบ (REP)...';
      addLog('info', 'กำลังเปิด https://eclaim.nhso.go.th/Client/service/download-validated');

      await page.goto('https://eclaim.nhso.go.th/Client/service/download-validated', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      }).catch((e) => {
        addLog('warning', `เข้า URL ตรงไม่สำเร็จ: ${e.message} กำลังลองใหม่...`);
      });

      await page.waitForTimeout(2000);

      // Trigger [ค้นหา] button so the table populates!
      addLog('info', '🔍 กำลังกดปุ่ม [ค้นหา] เพื่อดึงตารางผลตรวจ REP ทั้งหมด...');
      await triggerSearchOnPage(page, 'REP');

      // Scrape total pages robustly from text & pagination buttons
      const paginationInfo = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const match = bodyText.match(/([\d,]+)\s*(?:-|ถึง)\s*([\d,]+)\s*จาก(?:ทั้งหมด)?\s*([\d,]+)\s*รายการ/);
        let totalItems = 0;
        let pageItems = 20;
        let totalPages = 1;

        if (match) {
          const from = parseInt(match[1].replace(/,/g, ''), 10) || 1;
          const to = parseInt(match[2].replace(/,/g, ''), 10) || 20;
          totalItems = parseInt(match[3].replace(/,/g, ''), 10) || 0;
          pageItems = Math.max(1, to - from + 1);
          totalPages = Math.ceil(totalItems / pageItems);
        }

        // Also inspect numeric pagination buttons directly (e.g. [1, 2, 3 ... 577])
        const btnNumbers = Array.from(document.querySelectorAll(
          'nz-pagination li, .ant-pagination-item, ul.pagination li, [class*="pagination"] li, [class*="pagination"] button, [class*="pagination"] a'
        )).map((el) => parseInt((el.textContent || '').trim(), 10)).filter((n) => !isNaN(n) && n > 0);

        if (btnNumbers.length > 0) {
          const maxBtn = Math.max(...btnNumbers);
          if (maxBtn > totalPages) totalPages = maxBtn;
        }

        return { totalItems: totalItems || totalPages * pageItems, totalPages, pageItems };
      }).catch(() => ({ totalItems: 0, totalPages: 1, pageItems: 20 }));

      workerState.totalPages = Math.min(paginationInfo.totalPages || 1, maxPagesLimit);
      addLog('info', `พบผลตรวจทั้งหมด ${paginationInfo.totalItems.toLocaleString()} รายการ (${paginationInfo.totalPages} หน้า) — ระบบจะตรวจสอบ ${workerState.totalPages} หน้า`);

      for (let p = 1; p <= workerState.totalPages; p++) {
        if (stopRequested) break;
        workerState.currentPage = p;
        workerState.phase = 'scraping';
        workerState.message = `กำลังตรวจสอบผลตรวจหน้าที่ ${p} / ${workerState.totalPages}...`;
        addLog('info', `📄 กำลังตรวจหน้าที่ ${p}...`);

        // Wait for table rows to appear
        await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => undefined);
        await page.waitForTimeout(1000);

        // Scrape metadata of all rows on this page
        const rowsMeta = await page.evaluate(() => {
          const tableRows = Array.from(document.querySelectorAll('table tbody tr'));
          return tableRows.map((tr, index) => {
            const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
            const text = cells.join(' ');
            if (cells.length <= 1 || text.includes('ไม่มีข้อมูล')) {
              return {
                index,
                isEmpty: true,
                isProcessed: false,
                isPending: false,
                repNo: '',
                sender: '',
                sendDate: '',
                status: '',
                rawFileName: '',
                hasDownloadBtn: false,
              };
            }

            const repNo = cells[0] || '';
            const sender = cells[2] || '';
            const sendDate = cells[3] || '';
            const rawFileName = cells[9] || '';
            const statusCol = cells[10] || ''; // Column 11: สถานะ

            const isPending = statusCol.includes('รอประมวลผล') || text.includes('รอประมวลผล');
            const isProcessed = statusCol.includes('ประมวลผลแล้ว') || (text.includes('ประมวลผลแล้ว') && !isPending);

            // Find all download elements in row
            const allElements = Array.from(tr.querySelectorAll<HTMLElement>('a, button, span, [role="button"]'));
            const dlElements = allElements.filter((el) => {
              const txt = (el.textContent || '').trim().toLowerCase();
              const title = (el.getAttribute('title') || '').toLowerCase();
              return txt === 'download' || txt === 'ดาวน์โหลด' || txt.includes('download') || txt.includes('excel') || title.includes('excel');
            });

            // The last download element is EXCEL or Column 14 / last cell
            const hasDownloadBtn = dlElements.length > 0
              || Boolean(tr.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, td:nth-child(14) a'));

            return {
              index,
              isEmpty: false,
              isProcessed,
              isPending,
              repNo,
              sender,
              sendDate,
              status: statusCol || (isPending ? 'รอประมวลผล' : (isProcessed ? 'ประมวลผลแล้ว' : '-')),
              rawFileName,
              hasDownloadBtn,
            };
          });
        }).catch(() => []);

        const validRows = rowsMeta.filter((r) => !r.isEmpty);
        const readyRows = validRows.filter((r) => (r.isProcessed || r.hasDownloadBtn) && !r.isPending);
        const pendingCount = validRows.filter((r) => r.isPending).length;

        const firstRow = validRows[0];
        const firstRowDesc = firstRow
          ? `[Rep #${firstRow.repNo}] วันที่ ${firstRow.sendDate} สถานะ: "${firstRow.status}"`
          : 'ไม่มีข้อมูล';

        if (readyRows.length > 0) {
          addLog('info', `หน้า ${p}: พบพร้อมดาวน์โหลด ${readyRows.length} รายการ (แถวแรก: ${firstRowDesc})`);
        } else if (pendingCount > 0) {
          addLog('info', `หน้า ${p}: พบ ${validRows.length} รายการ (เป็น 'รอประมวลผล' ${pendingCount} รายการ — สปสช. ยังไม่ออกผลตรวจ, แถวแรก: ${firstRowDesc})`);
        } else {
          addLog('info', `หน้า ${p}: ${firstRowDesc} (ไม่พบรายการที่พร้อมดาวน์โหลด)`);
        }

        // Pre-filter ready rows: quickly skip already imported files in memory
        const unimportedRows: typeof readyRows = [];
        for (const rowMeta of readyRows) {
          const baseFilename = rowMeta.rawFileName || `REP_${rowMeta.repNo}.xls`;
          const expectedExcelName = baseFilename.replace(/\.ecd$/i, '.xls');
          if (await isFileAlreadyImported(expectedExcelName)) {
            workerState.skippedCount += 1;
          } else {
            unimportedRows.push(rowMeta);
          }
        }

        if (readyRows.length > 0 && unimportedRows.length === 0) {
          addLog('info', `⏭️ หน้า ${p}: ทั้ง ${readyRows.length} รายการมีในระบบแล้ว (ข้ามหน้าทันที)`);
        } else if (unimportedRows.length > 0) {
          const skippedCount = readyRows.length - unimportedRows.length;
          if (skippedCount > 0) {
            addLog('info', `หน้า ${p}: มีในระบบแล้ว ${skippedCount} รายการ (ข้าม) — กำลังดาวน์โหลด ${unimportedRows.length} ไฟล์ใหม่...`);
          }
        }

        for (const rowMeta of unimportedRows) {
          if (stopRequested) break;

          const baseFilename = rowMeta.rawFileName || `REP_${rowMeta.repNo}.xls`;
          const expectedExcelName = baseFilename.replace(/\.ecd$/i, '.xls');
          workerState.currentFilename = expectedExcelName;
          workerState.totalFound += 1;

          // Trigger download in Playwright
          workerState.phase = 'downloading';
          workerState.message = `กำลังดาวน์โหลด ${expectedExcelName}...`;
          addLog('info', `⬇️ กำลังดาวน์โหลด: ${expectedExcelName} (${rowMeta.sendDate})`);

          try {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 30000 }),
              page.evaluate((idx) => {
                const tr = document.querySelectorAll('table tbody tr')[idx];
                if (!tr) return;
                const allElements = Array.from(tr.querySelectorAll<HTMLElement>('a, button, span, [role="button"]'));
                const dlElements = allElements.filter((el) => {
                  const txt = (el.textContent || '').trim().toLowerCase();
                  const title = (el.getAttribute('title') || '').toLowerCase();
                  return txt === 'download' || txt === 'ดาวน์โหลด' || txt.includes('download') || txt.includes('excel') || title.includes('excel');
                });
                const btn = dlElements[dlElements.length - 1]
                  || tr.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, td:nth-child(14) a') as HTMLElement | null;
                btn?.click();
              }, rowMeta.index),
            ]);

            const downloadedPath = await download.path();
            if (!downloadedPath || !fs.existsSync(downloadedPath)) {
              throw new Error('ไม่พบไฟล์ที่ดาวน์โหลด');
            }

            const fileBuffer = fs.readFileSync(downloadedPath);
            const actualName = download.suggestedFilename() || expectedExcelName;
            const targetSavePath = path.join(downloadArchiveDir, actualName);
            fs.copyFileSync(downloadedPath, targetSavePath);

            workerState.downloadedCount += 1;
            addLog('success', `📥 ดาวน์โหลดสำเร็จ: ${actualName} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);

            // Parse and Import into database
            workerState.phase = 'importing';
            workerState.message = `กำลังนำเข้า ${actualName} ลงฐานข้อมูล...`;

            const wb = xlsx.read(fileBuffer, { type: 'buffer' });
            const sheetName = wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            const parsedRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws);

            if (parsedRows.length > 0) {
              const importRes = await importRepstmRows({
                dataType: 'REP',
                sourceFilename: actualName,
                fileSize: fileBuffer.length,
                sheetName,
                isSubfile: false,
                importedBy: options.importedBy || 'eclaim_background_sync',
                notes: `Auto-Sync from e-Claim Client (Rep #${rowMeta.repNo})`,
                rows: parsedRows,
                forceReimport: false,
                expectedHcode: options.expectedHcode,
              });

              if (importRes.success) {
                workerState.importedCount += 1;
                registerImportedFileInCache(actualName);
                registerImportedFileInCache(expectedExcelName);
                addLog('success', `✅ นำเข้าสำเร็จ: ${actualName} (+${parsedRows.length} รายการ)`);
              } else {
                addLog('warning', `⚠️ นำเข้า ${actualName}: ${importRes.message || 'ข้าม'}`);
                if (importRes.duplicate) workerState.skippedCount += 1;
              }
            } else {
              addLog('warning', `⚠️ ไฟล์ ${actualName} ไม่มีข้อมูลแถว`);
            }
          } catch (dlErr: any) {
            workerState.errorCount += 1;
            addLog('error', `❌ เกิดข้อผิดพลาดกับ ${expectedExcelName}: ${dlErr.message}`);
          }

          await page.waitForTimeout(600);
        }

        // Navigate to next page if more pages remain
        if (p < workerState.totalPages && !stopRequested) {
          const currentFirstRepNo = validRows[0]?.repNo || '';
          const targetPage = p + 1;

          let clickedNext = false;

          // Attempt 1: Click the specific numeric page button (e.g. [2], [3]) via Playwright locator
          try {
            const pageItem = page.locator(
              `li.ant-pagination-item-${targetPage}, li.ant-pagination-item[title="${targetPage}"], .ant-pagination-item:has-text("${targetPage}")`
            ).first();
            if (await pageItem.isVisible({ timeout: 1200 }).catch(() => false)) {
              await pageItem.click();
              clickedNext = true;
            }
          } catch { /* try next button */ }

          // Attempt 2: Click the Next Page button via Playwright locator
          if (!clickedNext) {
            try {
              const nextBtn = page.locator(
                '.ant-pagination-next:not(.ant-pagination-disabled), li[title="Next Page"]:not(.ant-pagination-disabled), li[title="ถัดไป"]:not(.ant-pagination-disabled)'
              ).first();
              if (await nextBtn.isVisible({ timeout: 1200 }).catch(() => false)) {
                await nextBtn.click();
                clickedNext = true;
              }
            } catch { /* try evaluate */ }
          }

          // Attempt 3: JavaScript evaluate
          if (!clickedNext) {
            clickedNext = await page.evaluate((tgt) => {
              const items = Array.from(document.querySelectorAll<HTMLElement>('.ant-pagination-item'));
              const match = items.find((it) => (it.textContent || '').trim() === String(tgt));
              if (match) {
                match.click();
                return true;
              }
              const antNext = document.querySelector<HTMLElement>('.ant-pagination-next:not(.ant-pagination-disabled)');
              if (antNext) {
                const btn = (antNext.querySelector('button, a') as HTMLElement) || antNext;
                btn.click();
                return true;
              }
              return false;
            }, targetPage).catch(() => false);
          }

          if (clickedNext) {
            // Wait for the table row to actually change
            if (currentFirstRepNo) {
              const rowChanged = await page.waitForFunction((oldRep) => {
                const firstTr = document.querySelector('table tbody tr');
                const firstTd = firstTr?.querySelector('td')?.textContent?.trim() || '';
                return firstTd !== '' && firstTd !== oldRep;
              }, currentFirstRepNo, { timeout: 8000 }).catch(() => false);

              if (!rowChanged) {
                addLog('warning', `⚠️ ตารางอาจยังไม่สลับไปหน้า ${targetPage} (รายการแถวแรกยังเป็น [Rep #${currentFirstRepNo}])`);
              }
            } else {
              await page.waitForTimeout(2000);
            }
          } else {
            addLog('info', `สิ้นสุดการเปลี่ยนหน้า REP (ไม่พบปุ่มไปหน้า ${targetPage})`);
            break;
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // PART 2: Statement (STM) - รับชุดข้อมูลสรุปผลการเบิกจ่ายรายเดือน (/Client/service/download-statement)
      // ─────────────────────────────────────────────────────────────
      if (!stopRequested) {
        workerState.phase = 'navigating';
        workerState.message = 'กำลังเปิดหน้ารับชุดข้อมูลสรุปผลการเบิกจ่าย (Statement)...';
        addLog('info', 'กำลังเปิด https://eclaim.nhso.go.th/Client/service/download-statement');

        await page.goto('https://eclaim.nhso.go.th/Client/service/download-statement', {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        }).catch((e) => {
          addLog('warning', `เข้าหน้า Statement ไม่สำเร็จ: ${e.message}`);
        });

        await page.waitForTimeout(2000);

        // Trigger [ค้นหา] on Statement page!
        addLog('info', '🔍 กำลังกดปุ่ม [ค้นหา] เพื่อดึงตาราง Statement ทั้งหมด...');
        await triggerSearchOnPage(page, 'Statement');

        // Scrape pagination for Statement
        const stmPagination = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const match = bodyText.match(/([\d,]+)\s*(?:-|ถึง)\s*([\d,]+)\s*จาก(?:ทั้งหมด)?\s*([\d,]+)\s*รายการ/);
          let totalItems = 0;
          let totalPages = 1;

          if (match) {
            const from = parseInt(match[1].replace(/,/g, ''), 10) || 1;
            const to = parseInt(match[2].replace(/,/g, ''), 10) || 20;
            totalItems = parseInt(match[3].replace(/,/g, ''), 10) || 0;
            totalPages = Math.ceil(totalItems / Math.max(1, to - from + 1));
          }

          const btnNumbers = Array.from(document.querySelectorAll(
            'nz-pagination li, .ant-pagination-item, ul.pagination li, [class*="pagination"] li, [class*="pagination"] button, [class*="pagination"] a'
          )).map((el) => parseInt((el.textContent || '').trim(), 10)).filter((n) => !isNaN(n) && n > 0);

          if (btnNumbers.length > 0) {
            const maxBtn = Math.max(...btnNumbers);
            if (maxBtn > totalPages) totalPages = maxBtn;
          }

          return { totalItems: totalItems || totalPages * 20, totalPages };
        }).catch(() => ({ totalItems: 0, totalPages: 1 }));

        const stmTotalPages = Math.min(stmPagination.totalPages || 1, maxPagesLimit);
        addLog('info', `หน้า Statement: พบข้อมูลทั้งหมด ${stmPagination.totalItems.toLocaleString()} รายการ (${stmPagination.totalPages} หน้า) — ตรวจสอบ ${stmTotalPages} หน้า`);

        for (let sp = 1; sp <= stmTotalPages; sp++) {
          if (stopRequested) break;
          addLog('info', `📊 ตรวจ Statement หน้าที่ ${sp} / ${stmTotalPages}...`);

          await page.waitForSelector('table tbody tr', { timeout: 8000 }).catch(() => undefined);
          await page.waitForTimeout(800);

          const stmRowsMeta = await page.evaluate(() => {
            const trs = Array.from(document.querySelectorAll('table tbody tr'));
            return trs.map((tr, idx) => {
              const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
              const text = cells.join(' ');
              if (text.includes('ไม่มีข้อมูล') || cells.length <= 1) {
                return { idx, stmNo: '', stmDate: '', rawFileName: '', hasDl: false, isEmpty: true, summary: '' };
              }
              const stmNo = cells[0] || '';
              const stmDate = cells[1] || '';
              const rawFileName = cells.find((c) => /\.(xlsx?|zip|csv|ecd)/i.test(c)) || '';
              
              // Find any download element or button in row
              const allClickables = Array.from(tr.querySelectorAll<HTMLElement>('a, button, [role="button"], span'));
              const dlAnchor = allClickables.find((el) => {
                const t = (el.textContent || '').toLowerCase().trim();
                const title = (el.getAttribute('title') || '').toLowerCase();
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                return t.includes('download') || t.includes('ดาวน์โหลด') || t.includes('excel') ||
                       title.includes('download') || title.includes('excel') ||
                       aria.includes('download') || el.classList.contains('ant-btn');
              }) || tr.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, td:nth-last-child(2) a, td:nth-last-child(2) button');

              return {
                idx,
                stmNo,
                stmDate,
                rawFileName,
                hasDl: Boolean(dlAnchor),
                isEmpty: false,
                summary: cells.slice(0, 3).join(' | '),
              };
            });
          }).catch(() => []);

          const validStm = stmRowsMeta.filter((r) => !r.isEmpty);
          const downloadableStm = validStm.filter((r) => r.hasDl || r.rawFileName || validStm.length > 0);
          const firstStm = validStm[0];

          addLog('info', `Statement หน้า ${sp}: พบ ${validStm.length} รายการ (แถวแรก: [${firstStm?.summary || '-'}]) — พร้อมดาวน์โหลด ${downloadableStm.length} รายการ`);

          // Pre-filter Statement rows: quickly skip already imported files in memory
          const unimportedStm: typeof downloadableStm = [];
          for (const sRow of downloadableStm) {
            const baseName = sRow.rawFileName || `STM_${sRow.stmNo || sp}_${sRow.idx}.xls`;
            const expectedName = baseName.replace(/\.ecd$/i, '.xls');
            if (await isFileAlreadyImported(expectedName)) {
              workerState.skippedCount += 1;
            } else {
              unimportedStm.push(sRow);
            }
          }

          if (downloadableStm.length > 0 && unimportedStm.length === 0) {
            addLog('info', `⏭️ Statement หน้า ${sp}: ทั้ง ${downloadableStm.length} รายการมีในระบบแล้ว (ข้ามหน้าทันที)`);
          } else if (unimportedStm.length > 0) {
            const stmSkipped = downloadableStm.length - unimportedStm.length;
            if (stmSkipped > 0) {
              addLog('info', `Statement หน้า ${sp}: มีในระบบแล้ว ${stmSkipped} รายการ (ข้าม) — กำลังดาวน์โหลด ${unimportedStm.length} ไฟล์ใหม่...`);
            }
          }

          for (const sRow of unimportedStm) {
            if (stopRequested) break;
            const baseName = sRow.rawFileName || `STM_${sRow.stmNo || sp}_${sRow.idx}.xls`;
            const expectedName = baseName.replace(/\.ecd$/i, '.xls');

            try {
              addLog('info', `⬇️ กำลังดาวน์โหลด Statement: ${expectedName}`);
              const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 30000 }),
                page.evaluate((idx) => {
                  const tr = document.querySelectorAll('table tbody tr')[idx];
                  if (!tr) return;
                  const allClickables = Array.from(tr.querySelectorAll<HTMLElement>('a, button, [role="button"], span'));
                  const dlBtn = allClickables.find((el) => {
                    const t = (el.textContent || '').toLowerCase().trim();
                    const title = (el.getAttribute('title') || '').toLowerCase();
                    return t.includes('download') || t.includes('ดาวน์โหลด') || t.includes('excel') || title.includes('excel');
                  }) || tr.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, td:nth-last-child(2) a, td:nth-last-child(2) button') as HTMLElement | null;
                  dlBtn?.click();
                }, sRow.idx),
              ]);

              const dlPath = await download.path();
              if (dlPath && fs.existsSync(dlPath)) {
                const fBuffer = fs.readFileSync(dlPath);
                const actualName = download.suggestedFilename() || expectedName;
                const savePath = path.join(downloadArchiveDir, actualName);
                fs.copyFileSync(dlPath, savePath);

                workerState.downloadedCount += 1;
                addLog('success', `📥 ดาวน์โหลด Statement สำเร็จ: ${actualName}`);

                // Import
                const wb = xlsx.read(fBuffer, { type: 'buffer' });
                const sName = wb.SheetNames[0];
                const ws = wb.Sheets[sName];
                const parsed = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws);

                if (parsed.length > 0) {
                  const importRes = await importRepstmRows({
                    dataType: 'STM',
                    sourceFilename: actualName,
                    fileSize: fBuffer.length,
                    sheetName: sName,
                    isSubfile: false,
                    importedBy: options.importedBy || 'eclaim_background_sync',
                    notes: `Auto-Sync from e-Claim Client Statement (#${sRow.stmNo})`,
                    rows: parsed,
                    forceReimport: false,
                    expectedHcode: options.expectedHcode,
                  });

                  if (importRes.success) {
                    workerState.importedCount += 1;
                    registerImportedFileInCache(actualName);
                    registerImportedFileInCache(expectedName);
                    addLog('success', `✅ นำเข้า STM สำเร็จ: ${actualName} (+${parsed.length} รายการ)`);
                  } else {
                    addLog('warning', `⚠️ นำเข้า STM ${actualName}: ${importRes.message || 'ข้าม'}`);
                  }
                }
              }
            } catch (err: any) {
              addLog('error', `❌ ดาวน์โหลด Statement ${expectedName} ไม่สำเร็จ: ${err.message}`);
            }
          }

          // Next page on Statement
          if (sp < stmTotalPages && !stopRequested) {
            const currentFirstStmNo = validStm[0]?.stmNo || '';
            const targetStmPage = sp + 1;

            let stmNavigated = false;
            try {
              const pageItem = page.locator(
                `li.ant-pagination-item-${targetStmPage}, li.ant-pagination-item[title="${targetStmPage}"], .ant-pagination-item:has-text("${targetStmPage}")`
              ).first();
              if (await pageItem.isVisible({ timeout: 1200 }).catch(() => false)) {
                await pageItem.click();
                stmNavigated = true;
              }
            } catch { /* try next */ }

            if (!stmNavigated) {
              try {
                const nextBtn = page.locator('.ant-pagination-next:not(.ant-pagination-disabled)').first();
                if (await nextBtn.isVisible({ timeout: 1200 }).catch(() => false)) {
                  await nextBtn.click();
                  stmNavigated = true;
                }
              } catch { /* try evaluate */ }
            }

            if (!stmNavigated) {
              stmNavigated = await page.evaluate((tgt) => {
                const items = Array.from(document.querySelectorAll<HTMLElement>('.ant-pagination-item'));
                const match = items.find((it) => (it.textContent || '').trim() === String(tgt));
                if (match) {
                  match.click();
                  return true;
                }
                const antNext = document.querySelector<HTMLElement>('.ant-pagination-next:not(.ant-pagination-disabled)');
                if (antNext) {
                  const btn = (antNext.querySelector('button, a') as HTMLElement) || antNext;
                  btn.click();
                  return true;
                }
                return false;
              }, targetStmPage).catch(() => false);
            }

            if (stmNavigated) {
              if (currentFirstStmNo) {
                await page.waitForFunction((oldStm) => {
                  const firstTd = document.querySelector('table tbody tr td')?.textContent?.trim() || '';
                  return firstTd !== '' && firstTd !== oldStm;
                }, currentFirstStmNo, { timeout: 8000 }).catch(() => undefined);
              } else {
                await page.waitForTimeout(2000);
              }
            } else {
              break;
            }
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // PART 3: OFC / LGO Statement จากเว็บระบบเดิม (StatementReportWebAction.do)
      // ─────────────────────────────────────────────────────────────
      if (!stopRequested) {
        addLog('info', 'กำลังตรวจสอบ STM สิทธิ OFC / LGO จากเว็บระบบเดิม...');
        try {
          const ofcStmUrl = 'https://eclaim.nhso.go.th/webComponent/nch/StatementReportWebAction.do?dynamicMenuFunctionUnitId=995';
          await page.goto(ofcStmUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(1500);

          const ofcRows = await page.evaluate(() => {
            const trs = Array.from(document.querySelectorAll('table tbody tr'));
            return trs.map((tr, idx) => {
              const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
              const text = cells.join(' ');
              const excelBtn = tr.querySelector('a:not([href="#"]), button');
              return {
                idx,
                text,
                hasExcel: Boolean(excelBtn),
                onclick: excelBtn?.getAttribute('onclick') || '',
              };
            });
          }).catch(() => []);

          const ofcReady = ofcRows.filter((r) => r.hasExcel && r.text.includes('11101'));
          if (ofcReady.length > 0) {
            addLog('info', `พบ Statement OFC/LGO ในระบบเดิม ${ofcReady.length} รายการ`);
          }
        } catch { /* ignore */ }
      }

      if (stopRequested) {
        workerState.phase = 'stopped';
        workerState.message = 'หยุดการทำงานตามคำสั่ง';
        addLog('warning', '🛑 การทำงานในพื้นหลังถูกหยุดแล้ว');
      } else {
        workerState.phase = 'completed';
        workerState.message = `ซิงค์ข้อมูลเสร็จสิ้น นำเข้าใหม่ +${workerState.importedCount} ไฟล์ (ข้าม ${workerState.skippedCount} ไฟล์)`;
        addLog('success', `🎉 เสร็จสิ้นกระบวนการนำเข้า e-Claim (+${workerState.importedCount} ไฟล์ใหม่)`);
      }
    } catch (globalErr: any) {
      workerState.phase = 'error';
      workerState.message = `ขัดข้อง: ${globalErr.message}`;
      addLog('error', `💥 ข้อผิดพลาดร้ายแรง: ${globalErr.message}`);
    } finally {
      workerState.running = false;
      workerState.currentFilename = null;
      workerState.endTime = new Date().toLocaleTimeString('th-TH', { hour12: false });
    }
  })();

  return { success: true, message: 'เริ่มงานซิงค์ข้อมูลในพื้นหลังเรียบร้อย', jobId };
};
