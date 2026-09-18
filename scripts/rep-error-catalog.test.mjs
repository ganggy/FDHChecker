import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('catalog covers every code in the March 2026 NHSO reference including hyphen suffixes', async () => {
  const catalog = JSON.parse(await readFile('public/repErrorCatalog.json', 'utf8'));
  const source = JSON.parse(await readFile('scripts/data/rep-c-20260329-source.json', 'utf8'));
  for (const code of source.sourceCodes) {
    assert.ok(catalog[code]?.description, code);
    if (code in source.additions) assert.ok(catalog[code]?.guide, code);
  }
  assert.equal(Object.keys(source.additions).length, 89);
  assert.match(catalog['256-1'].description, /acute blood loss/);
  assert.match(catalog['940-1'].description, /เปลี่ยนหน่วย/);
});

test('additive import targets the public catalog, preserves existing meanings and is idempotent', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'fdh-catalog-'));
  try {
    await mkdir(join(cwd, 'public'));
    const existing = { type: 'Corrective', description: 'Existing meaning', guide: 'Existing guide' };
    await writeFile(join(cwd, 'public/repErrorCatalog.json'), JSON.stringify({ '101': existing }));
    await writeFile(join(cwd, 'source.tsv'), 'Type\tCode\tDescription\tGuide\nCorrective\t101\tChanged\tChanged\nCorrective\t256-1\tNew\tGuide\n');
    const importer = resolve('scripts/import_rep_error_catalog.mjs');
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, [importer, 'source.tsv'], { cwd });
    const catalog = JSON.parse(await readFile(join(cwd, 'public/repErrorCatalog.json'), 'utf8'));
    assert.deepEqual(catalog['101'], existing);
    assert.equal(catalog['256-1'].description, 'New');
    assert.equal(Object.keys(catalog).length, 2);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
