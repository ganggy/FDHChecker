import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/import_rep_error_catalog.mjs <source.tsv>');

const source = await readFile(resolve(sourcePath), 'utf8');
const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
const header = lines.shift()?.split('\t').map((cell) => cell.trim()) || [];
if (header.join('|') !== 'Type|Code|Description|Guide') {
  throw new Error(`Unexpected header: ${header.join(' | ')}`);
}

const jsonPath = resolve('public/repErrorCatalog.json');
const catalog = JSON.parse(await readFile(jsonPath, 'utf8'));
let added = 0;
for (const line of lines) {
  const [type = '', code = '', description = '', ...guideParts] = line.split('\t');
  const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '');
  if (!normalizedCode) continue;
  if (catalog[normalizedCode]) continue;
  added += 1;
  catalog[normalizedCode] = {
    type: type.trim(),
    description: description.trim(),
    guide: guideParts.join('\t').trim(),
  };
}

const entries = Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`, 'utf8');

const escapeCell = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const markdown = [
  '# REP Error Code Catalog',
  '',
  '> Generated from the existing catalog plus additive NHSO references. Source: https://ucapps1.nhso.go.th/eclaimdownload/download/file/C_Validate__20260329_WEB.pdf (2026-03-29). Existing definitions are preserved; rerun scripts/import_rep_error_catalog.mjs with scripts/data/rep-c-20260329.tsv to add missing codes.',
  '',
  `จำนวนรหัสทั้งหมด: ${entries.length}`,
  '',
  '| Type | Code | Description | Guide |',
  '|---|---|---|---|',
  ...entries.map(([code, item]) => `| ${escapeCell(item.type)} | ${escapeCell(code)} | ${escapeCell(item.description)} | ${escapeCell(item.guide)} |`),
  '',
].join('\n');
const vaultPath = resolve('knowlage/vault/REP_ERROR_CODE_CATALOG.md');
await mkdir(dirname(vaultPath), { recursive: true });
await writeFile(vaultPath, markdown, 'utf8');

console.log(JSON.stringify({ added, count: entries.length, jsonPath, vaultPath }));
