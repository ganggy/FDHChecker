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

const isFileAlreadyImported = async (filename: string): Promise<boolean> => {
  try {
    const conn = await getRepstmConnection();
    try {
      const [rows] = await conn.query(
        `SELECT id FROM repstm_import_batch 
         WHERE LOWER(source_filename) = LOWER(?) 
            OR LOWER(source_filename) = LOWER(?)
         LIMIT 1`,
        [filename, filename.replace(/\.(xlsx?|zip|csv|ecd)$/i, '')]
      );
      return Array.isArray(rows) && rows.length > 0;
    } finally {
      conn.release();
    }
  } catch {
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

      await page.waitForTimeout(2500);

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

        // Find processed rows that have Excel download buttons
        const rowsMeta = await page.evaluate(() => {
          const tableRows = Array.from(document.querySelectorAll('table tbody tr'));
          return tableRows.map((tr, index) => {
            const text = (tr.textContent || '').trim();
            const isProcessed = text.includes('ประมวลผลแล้ว');
            const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
            const repNo = cells[0] || '';
            const sender = cells[2] || '';
            const sendDate = cells[3] || '';
            const rawFileName = cells[9] || '';
            // In the new portal, Column 13 is REP (EXCEL)
            const excelDownloadAnchor = tr.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, td:nth-child(14) a');
            const hasDownloadBtn = Boolean(excelDownloadAnchor);

            return {
              index,
              isProcessed,
              repNo,
              sender,
              sendDate,
              rawFileName,
              hasDownloadBtn,
            };
          });
        }).catch(() => []);

        const readyRows = rowsMeta.filter((r) => r.isProcessed && r.hasDownloadBtn);
        addLog('info', `หน้า ${p}: พบรายการประมวลผลแล้ว ${readyRows.length} รายการ`);

        for (const rowMeta of readyRows) {
          if (stopRequested) break;

          const baseFilename = rowMeta.rawFileName || `REP_${rowMeta.repNo}.xls`;
          const expectedExcelName = baseFilename.replace(/\.ecd$/i, '.xls');
          workerState.currentFilename = expectedExcelName;
          workerState.totalFound += 1;

          // Check if already in database
          const alreadyImported = await isFileAlreadyImported(expectedExcelName);
          if (alreadyImported) {
            workerState.skippedCount += 1;
            addLog('info', `⏭️ ${expectedExcelName} (${rowMeta.repNo}) มีในระบบแล้ว (ข้าม)`);
            continue;
          }

          // Trigger download in Playwright
          workerState.phase = 'downloading';
          workerState.message = `กำลังดาวน์โหลด ${expectedExcelName}...`;
          addLog('info', `⬇️ กำลังดาวน์โหลด: ${expectedExcelName} (${rowMeta.sendDate})`);

          try {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 30000 }),
              page.evaluate((idx) => {
                const tr = document.querySelectorAll('table tbody tr')[idx];
                const btn = tr?.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, td:nth-child(14) a') as HTMLElement | null;
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
          const prevFirstRepNo = readyRows[0]?.repNo || '';
          const clickedNext = await page.evaluate(() => {
            // 1. Ant Design / Ng-Zorro next button
            const antNext = document.querySelector<HTMLElement>('.ant-pagination-next:not(.ant-pagination-disabled)');
            if (antNext) {
              const btn = (antNext.querySelector('button, a') as HTMLElement) || antNext;
              btn.click();
              return true;
            }
            // 2. Standard Bootstrap pagination
            const bsNext = document.querySelector<HTMLElement>('li.page-item.next:not(.disabled) a, li.next:not(.disabled) a');
            if (bsNext) {
              bsNext.click();
              return true;
            }
            // 3. Any element with title or aria-label="Next Page" or "ถัดไป"
            const ariaNext = document.querySelector<HTMLElement>('[aria-label="Next" i], [title="Next Page" i], [title="ถัดไป" i]');
            if (ariaNext && !ariaNext.classList.contains('disabled')) {
              ariaNext.click();
              return true;
            }
            // 4. Any button or link with text '>' or '›' or '»'
            const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button, li'));
            for (const el of candidates) {
              const txt = (el.textContent || '').trim();
              if ((txt === '>' || txt === '›' || txt === '»') && !el.classList.contains('disabled')) {
                el.click();
                return true;
              }
            }
            return false;
          }).catch(() => false);

          if (clickedNext) {
            await page.waitForTimeout(2000);
            if (prevFirstRepNo) {
              await page.waitForFunction((oldRep) => {
                const firstTr = document.querySelector('table tbody tr');
                const firstTd = firstTr?.querySelector('td')?.textContent?.trim() || '';
                return firstTd !== oldRep;
              }, prevFirstRepNo, { timeout: 6000 }).catch(() => undefined);
            }
          } else {
            addLog('info', `สิ้นสุดการเปลี่ยนหน้า REP (ไม่พบปุ่มถัดไป)`);
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

        await page.waitForTimeout(2500);

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
              const stmNo = cells[0] || '';
              const stmDate = cells[1] || '';
              const rawFileName = cells.find((c) => /\.(xlsx?|zip|csv|ecd)/i.test(c)) || '';
              const dlAnchor = tr.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, a[href*="download" i], a[href*="excel" i], button:has-text("Download")');
              return {
                idx,
                stmNo,
                stmDate,
                rawFileName,
                hasDl: Boolean(dlAnchor),
              };
            });
          }).catch(() => []);

          const downloadableStm = stmRowsMeta.filter((r) => r.hasDl || r.rawFileName);
          addLog('info', `Statement หน้า ${sp}: พบรายการดาวน์โหลด ${downloadableStm.length} รายการ`);

          for (const sRow of downloadableStm) {
            if (stopRequested) break;
            const baseName = sRow.rawFileName || `STM_${sRow.stmNo || sp}_${sRow.idx}.xls`;
            const expectedName = baseName.replace(/\.ecd$/i, '.xls');
            const already = await isFileAlreadyImported(expectedName);
            if (already) {
              workerState.skippedCount += 1;
              addLog('info', `⏭️ ${expectedName} มีในระบบแล้ว (ข้าม)`);
              continue;
            }

            try {
              addLog('info', `⬇️ กำลังดาวน์โหลด Statement: ${expectedName}`);
              const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 30000 }),
                page.evaluate((idx) => {
                  const tr = document.querySelectorAll('table tbody tr')[idx];
                  const btn = tr?.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, a, button') as HTMLElement | null;
                  btn?.click();
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
            await page.evaluate(() => {
              const antNext = document.querySelector<HTMLElement>('.ant-pagination-next:not(.ant-pagination-disabled)');
              if (antNext) {
                const btn = (antNext.querySelector('button, a') as HTMLElement) || antNext;
                btn.click();
              }
            }).catch(() => undefined);
            await page.waitForTimeout(2000);
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
