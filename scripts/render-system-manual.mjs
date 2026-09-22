// Render the locally generated manual only; no application or hospital connection.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { copyFile } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge', headless: true } : { headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(root, 'docs/manual_system_overview.html')).href);
  await page.evaluate(() => document.fonts.ready);
  const broken = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(link.hash.slice(1))).map(link => link.hash));
  if (broken.length) throw new Error(`Broken anchors: ${broken.join(', ')}`);
  await page.pdf({
    path: path.join(root, 'docs/manual_system_overview.pdf'), format: 'A4',
    printBackground: true, displayHeaderFooter: true,
    margin: { top: '16mm', bottom: '18mm', left: '17mm', right: '17mm' },
    headerTemplate: '<div style="font-size:8px;color:#64748b;width:100%;margin:0 17mm">FDH CHECKER • SYSTEM MANUAL • 2026-09-22</div>',
    footerTemplate: '<div style="font-size:9px;color:#64748b;width:100%;margin:0 17mm;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  await copyFile(path.join(root, 'docs/manual_system_overview.pdf'), path.join(root, 'public/manual_system_overview.pdf'));
  console.log('PDF generated and synced to public; all chapter links resolve');
} finally {
  await browser.close();
}
