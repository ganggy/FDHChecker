---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "scripts/import_rep_error_catalog.mjs"
source_hash: "c570cf6b24a90373d9d495e13b055b1646dd5f5c3e7f5beb2ea84d454de56767"
managed_by: "sync-ksp-vault"
---
# import_rep_error_catalog.mjs

> Source: `scripts/import_rep_error_catalog.mjs`
> SHA-256: `c570cf6b24a90373d9d495e13b055b1646dd5f5c3e7f5beb2ea84d454de56767`

````javascript
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

const catalog = {};
for (const line of lines) {
  const [type = '', code = '', description = '', ...guideParts] = line.split('\t');
  const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '');
  if (!normalizedCode) continue;
  catalog[normalizedCode] = {
    type: type.trim(),
    description: description.trim(),
    guide: guideParts.join('\t').trim(),
  };
}

const entries = Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
const jsonPath = resolve('src/config/repErrorCatalog.json');
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`, 'utf8');

const escapeCell = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const markdown = [
  '# REP Error Code Catalog',
  '',
  '> Generated from the NHSO REP error reference supplied to the project. Do not edit generated rows manually; update the TSV source and rerun the importer.',
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

console.log(JSON.stringify({ count: entries.length, jsonPath, vaultPath }));

````
