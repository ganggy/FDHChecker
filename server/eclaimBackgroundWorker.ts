import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { getEclaimBrowserSession } from './index.js';
import { importRepstmRows } from './repositories/receivables.repository.js';
import { getRepstmConnection } from './db/connection.js';

export interface EclaimWorkerProgress {
  jobId: string;
  running: boolean;
  phase: 'idle' | 'starting' | 'navigating' | 'scraping' | 'downloading' | 'importing' | 'completed' | 'stopped' | 'error';
  message: string;
  portal: 'new_client' | 'legacy_webcomponent' | 'both';
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
  jobId: '',
  running: false,
  phase: 'idle',
  message: 'ระบบพร้อมทำงานในพื้นหลัง',
  portal: 'new_client',
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

const addLog = (type: 'info' | 'success' | 'warning' | 'error', text: string) => {
  const now = new Date();
  const time = now.toLocaleTimeString('th-TH', { hour12: false });
  workerState.logs.unshift({ time, type, text });
  if (workerState.logs.length > 80) workerState.logs.pop();
};

export const getEclaimWorkerStatus = (): EclaimWorkerProgress => {
  return { ...workerState, logs: [...workerState.logs] };
};

export const stopEclaimWorker = (): boolean => {
  if (!workerState.running) return false;
  stopRequested = true;
  workerState.phase = 'stopped';
  workerState.message = 'กำลังส่งคำสั่งหยุดการทำงาน...';
  addLog('warning', 'ผู้ใช้สั่งหยุดการทำงานในพื้นหลัง');
  return true;
};

/** Check database if a source filename has already been imported */
const isFileAlreadyImported = async (filename: string): Promise<boolean> => {
  try {
    const conn = await getRepstmConnection();
    try {
      const cleanName = filename.replace(/\.(ecd|xlsx?|zip)$/i, '');
      const [rows] = await conn.query<any[]>(
        `SELECT id FROM repstm_import_batch 
         WHERE source_filename LIKE ? 
         LIMIT 1`,
        [`%${cleanName}%`]
      );
      return Array.isArray(rows) && rows.length > 0;
    } finally {
      conn.release();
    }
  } catch (err) {
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

  addLog('info', '🚀 เริ่มงานซิงค์ข้อมูล e-Claim ในพื้นหลัง (Background Worker)');

  // Run in background asynchronously without blocking the response
  void (async () => {
    try {
      const page = session.page;
      const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 5, 20));
      const downloadArchiveDir = path.join(process.cwd(), 'downloads', 'nhso-repstm');
      if (!fs.existsSync(downloadArchiveDir)) {
        fs.mkdirSync(downloadArchiveDir, { recursive: true });
      }

      // ─────────────────────────────────────────────────────────────
      // PART 1: REP - รับชุดข้อมูลผลการตรวจสอบ (REP)
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

      // Scrape total pages
      const paginationInfo = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const match = bodyText.match(/(\d+)\s*-\s*(\d+)\s*จากทั้งหมด\s*(\d+)\s*รายการ/);
        const totalItems = match ? parseInt(match[3], 10) : 0;
        const pageItems = match ? parseInt(match[2], 10) - parseInt(match[1], 10) + 1 : 20;
        const totalPages = totalItems > 0 ? Math.ceil(totalItems / Math.max(1, pageItems)) : 1;
        return { totalItems, totalPages };
      }).catch(() => ({ totalItems: 0, totalPages: 1 }));

      workerState.totalPages = Math.min(paginationInfo.totalPages || 1, maxPages);
      addLog('info', `พบผลตรวจทั้งหมด ${paginationInfo.totalItems.toLocaleString()} รายการ (จะตรวจสอบ ${workerState.totalPages} หน้าแรก)`);

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
            const excelDownloadAnchor = tr.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button, a:has-text("Download")');
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
                const btn = tr?.querySelector('td:nth-last-child(1) a, td:nth-last-child(1) button') as HTMLElement | null;
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
          const clickedNext = await page.evaluate(() => {
            const nextBtn = document.querySelector('ul.pagination li.next a, button.btn-next, a:has-text(">")') as HTMLElement | null;
            if (nextBtn) {
              nextBtn.click();
              return true;
            }
            return false;
          }).catch(() => false);

          if (clickedNext) {
            await page.waitForTimeout(1500);
          } else {
            addLog('info', `สิ้นสุดการเปลี่ยนหน้า (ไม่พบปุ่มถัดไป)`);
            break;
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // PART 2: Statement (STM) - รับชุดข้อมูลสรุปผลการเบิกจ่ายรายเดือน
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

        // Check if statement page has download buttons
        const stmRows = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('table tbody tr'));
          return rows.slice(0, 5).map((tr, idx) => ({
            index: idx,
            text: (tr.textContent || '').trim(),
            hasBtn: Boolean(tr.querySelector('a, button')),
          }));
        }).catch(() => []);

        if (stmRows.length > 0) {
          addLog('info', `หน้า Statement: พบข้อมูล ${stmRows.length} แถวแรก`);
        }
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
