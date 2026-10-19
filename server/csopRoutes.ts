import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import {
  getResolvedCsopConfig,
  saveCsopConfig,
  startCsopBrowserSession,
  getCsopBrowserStatus,
  clickCsopCoordinates,
  closeCsopBrowserSession,
  getActiveCsopSession,
} from './csopBridge.js';

export const csopRouter = Router();

/** GET /api/csop/config */
csopRouter.get('/config', async (_req, res) => {
  try {
    const config = await getResolvedCsopConfig();
    return res.json({
      success: true,
      data: {
        hcode: config.hcode,
        username: config.username,
        hasPassword: Boolean(String(config.password || '').trim()),
        autoDownload: config.autoDownload,
        autoImport: config.autoImport,
        headless: config.headless,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/csop/config */
csopRouter.post('/config', async (req, res) => {
  try {
    const updated = await saveCsopConfig({
      hcode: req.body?.hcode,
      username: req.body?.username,
      password: req.body?.password ? String(req.body.password) : undefined,
      autoDownload: req.body?.autoDownload !== undefined ? Boolean(req.body.autoDownload) : undefined,
      autoImport: req.body?.autoImport !== undefined ? Boolean(req.body.autoImport) : undefined,
      headless: req.body?.headless !== undefined ? Boolean(req.body.headless) : undefined,
    });
    return res.json({
      success: true,
      message: 'บันทึกการตั้งค่า CSOP สำเร็จ',
      data: {
        hcode: updated.hcode,
        username: updated.username,
        hasPassword: Boolean(String(updated.password || '').trim()),
        autoDownload: updated.autoDownload,
        autoImport: updated.autoImport,
        headless: updated.headless,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/csop/browser-login */
csopRouter.post('/browser-login', async (req, res) => {
  try {
    const result = await startCsopBrowserSession(req.body);
    const status = await getCsopBrowserStatus();
    return res.json({
      ...result,
      ...status,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** GET /api/csop/browser-status */
csopRouter.get('/browser-status', async (_req, res) => {
  try {
    const status = await getCsopBrowserStatus();
    return res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/csop/browser-click */
csopRouter.post('/browser-click', async (req, res) => {
  try {
    const x = Number(req.body?.x);
    const y = Number(req.body?.y);
    if (isNaN(x) || isNaN(y)) {
      return res.status(400).json({ success: false, error: 'พิกัด x, y ไม่ถูกต้อง' });
    }
    const result = await clickCsopCoordinates(x, y);
    // Wait briefly and return updated status with new screenshot
    await new Promise((resolve) => setTimeout(resolve, 800));
    const status = await getCsopBrowserStatus();
    return res.json({
      ...result,
      ...status,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/csop/browser-close */
csopRouter.post('/browser-close', async (_req, res) => {
  try {
    const result = await closeCsopBrowserSession();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/csop/inspect-page — inspect all links, navigation menus, and tables on the active CSOP page */
csopRouter.post('/inspect-page', async (_req, res) => {
  const session = getActiveCsopSession();
  if (!session || !session.browser.isConnected()) {
    return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ CSOP' });
  }

  try {
    const page = session.page;
    const url = page.url();
    const title = await page.title().catch(() => '');

    const inspection = await page.evaluate(() => {
      // Collect links
      const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        text: (a.textContent || '').trim().replace(/\s+/g, ' '),
        href: (a as HTMLAnchorElement).href,
        id: a.id || null,
        className: a.className || null,
      })).filter((l) => l.text.length > 0 && !l.href.startsWith('javascript:void(0)'));

      // Collect tables
      const tables = Array.from(document.querySelectorAll('table')).map((tbl, tblIdx) => {
        const headers = Array.from(tbl.querySelectorAll('th')).map((th) => (th.textContent || '').trim());
        const rows = Array.from(tbl.querySelectorAll('tbody tr, tr')).slice(0, 30).map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
          const downloadLinks = Array.from(tr.querySelectorAll('a[href]')).map((a) => ({
            text: (a.textContent || '').trim(),
            href: (a as HTMLAnchorElement).href,
          }));
          return { cells, downloadLinks };
        }).filter((r) => r.cells.length > 0);
        return { tableIndex: tblIdx, headers, rowCount: rows.length, sampleRows: rows };
      });

      return { links, tables };
    });

    return res.json({
      success: true,
      url,
      title,
      ...inspection,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/csop/navigate — navigate to a specific URL or subpath within CSOP */
csopRouter.post('/navigate', async (req, res) => {
  const session = getActiveCsopSession();
  if (!session || !session.browser.isConnected()) {
    return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ CSOP' });
  }

  const targetUrl = String(req.body?.url || '').trim();
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'ไม่ได้รับ URL ที่ต้องการไป' });
  }

  try {
    const fullUrl = targetUrl.startsWith('http')
      ? targetUrl
      : `https://cs8.chi.or.th${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;

    await session.page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = await getCsopBrowserStatus();
    return res.json({ success: true, ...status });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});
